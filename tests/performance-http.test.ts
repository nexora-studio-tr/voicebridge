import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { createServer } from '../src/server/app.js';
import { PerformanceReport } from '../src/core/performance.js';
import { engine, temporary } from './helpers.js';

describe('Private performance endpoint', () => {
  const dir = temporary();
  let service: Awaited<ReturnType<typeof createServer>>;
  const gateway = {
    ready: () => false,
    status: () => ({ connected: false, configured: false, error: 'private-error' }),
    start: vi.fn(async () => {}),
    stop: () => {},
    member: vi.fn(async () => null),
    allowed: () => false,
  };
  async function start(demo = false) {
    service = await createServer({
      root: path.resolve('.'),
      dataDir: dir.root,
      origin: 'http://127.0.0.1:4347',
      gateway,
      local: engine(),
      demo,
    });
  }
  function headers(operator: boolean, demo = false) {
    const s = service.store.createSession({ id: 'private-id', name: 'private-name', operator });
    return { host: '127.0.0.1:4347', cookie: `vb-session${demo ? '-demo' : ''}=${s.id}` };
  }
  afterEach(async () => {
    await service?.app.close();
    dir.remove();
    vi.unstubAllGlobals();
  });
  it('denies anonymous, ordinary members and public demo operators', async () => {
    await start();
    const url = '/api/operator/performance';
    expect(
      (await service.app.inject({ url, headers: { host: '127.0.0.1:4347' } })).statusCode,
    ).toBe(401);
    expect((await service.app.inject({ url, headers: headers(false) })).statusCode).toBe(403);
  });
  it('denies recorded-demo sessions even if marked operator', async () => {
    await start(true);
    expect(
      (await service.app.inject({ url: '/api/operator/performance', headers: headers(true, true) }))
        .statusCode,
    ).toBe(403);
  });
  it('exports fixed fields without private context or outbound requests and disables caching', async () => {
    await start();
    service.store.set('private-context', {
      token: 'secret-token',
      text: 'private-transcript',
      user: 'private-id',
    });
    const outbound = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', outbound);
    const response = await service.app.inject({
      url: '/api/operator/performance',
      headers: headers(true),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const report = PerformanceReport.parse(response.json());
    expect(report.queue).toEqual({ active: 0, waiting: 0, limit: 8, perSpeaker: 2 });
    expect(report.nodeMemory.residentMiB).toBeGreaterThan(0);
    expect(report.recent.queueWait.p95Ms).toBeNull();
    expect(response.body).not.toMatch(/private|secret|transcript|token|captionId|path/i);
    expect(response.body).not.toContain(dir.root);
    expect(outbound).not.toHaveBeenCalled();
    expect(gateway.start).not.toHaveBeenCalled();
    expect(gateway.member).not.toHaveBeenCalled();
  });
});

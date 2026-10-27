import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { createServer } from '../src/server/app.js';
import type { Gateway } from '../src/bot/discord.js';
import type { LocalSetupProbe } from '../src/core/setup.js';
import { LocalWorker } from '../src/server/local.js';
import { deferred, temporary } from './helpers.js';

describe('Operator setup-report boundary', () => {
  const origin = 'http://127.0.0.1:4347';
  let dir: ReturnType<typeof temporary>;
  let service: Awaited<ReturnType<typeof createServer>>;
  let gateway: Gateway;
  const headers = (cookie?: string) => ({ host: '127.0.0.1:4347', ...(cookie ? { cookie } : {}) });
  const operatorHeaders = () =>
    headers(
      'vb-session=' +
        service.store.createSession({
          id: 'operator',
          name: 'Private Operator',
          operator: true,
        }).id,
    );
  beforeEach(() => {
    dir = temporary();
    vi.spyOn(LocalWorker.prototype, 'start').mockImplementation(() => {});
    vi.spyOn(LocalWorker.prototype, 'setupProbe').mockResolvedValue({ kind: 'python-missing' });
    gateway = {
      ready: () => false,
      status: () => ({ connected: false, configured: false, error: 'private-gateway-error' }),
      start: vi.fn(async () => {}),
      stop: vi.fn(),
      member: vi.fn(async () => null),
      allowed: () => false,
    };
  });
  async function start(demo = false) {
    service = await createServer({
      root: path.resolve('.'),
      dataDir: dir.root,
      origin,
      gateway,
      demo,
    });
  }
  afterEach(async () => {
    await service?.app.close();
    dir.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it('rejects anonymous and ordinary members before probing the machine', async () => {
    await start();
    expect(
      (await service.app.inject({ url: '/api/operator/setup-checks', headers: headers() }))
        .statusCode,
    ).toBe(401);
    const s = service.store.createSession({
      id: '333333333333333333',
      name: 'Private User',
      operator: false,
    });
    expect(
      (
        await service.app.inject({
          url: '/api/operator/setup-checks',
          headers: headers('vb-session=' + s.id),
        })
      ).statusCode,
    ).toBe(403);
    expect(LocalWorker.prototype.setupProbe).not.toHaveBeenCalled();
    expect(gateway.member).not.toHaveBeenCalled();
  });
  it('denies demo mode even with a fabricated operator session', async () => {
    await start(true);
    const s = service.store.createSession({ id: 'operator', name: 'Private User', operator: true });
    expect(
      (
        await service.app.inject({
          url: '/api/operator/setup-checks',
          headers: headers('vb-session-demo=' + s.id),
        })
      ).statusCode,
    ).toBe(403);
    expect(LocalWorker.prototype.setupProbe).not.toHaveBeenCalled();
  });
  it('exports an allowlisted snapshot without secrets, IDs, transcripts or live activity', async () => {
    await start();
    const config = {
      applicationId: '111111111111111111',
      guilds: ['222222222222222222'],
      token: 'private-test-bot-token-long-enough',
      clientSecret: 'private-oauth-client-secret',
    };
    service.store.set('discord', config);
    service.store.set('private-test-context', {
      text: 'private-transcript',
      providerKey: 'private-api-key',
    });
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', request);
    const response = await service.app.inject({
      url: '/api/operator/setup-checks',
      headers: operatorHeaders(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const report = response.json();
    expect(Object.keys(report).sort()).toEqual(
      ['schemaVersion', 'scope', 'version', 'collectedAt', 'environment', 'checks'].sort(),
    );
    expect(report.checks.find((c: { id: string }) => c.id === 'discord').state).toBe('pass');
    expect(report.checks.find((c: { id: string }) => c.id === 'worker').reason).toBe(
      'python-missing',
    );
    for (const secret of [
      config.token,
      config.clientSecret,
      config.applicationId,
      config.guilds[0]!,
      'private-',
      dir.root,
      'operator-link',
    ])
      expect(response.body).not.toContain(secret);
    expect(request).not.toHaveBeenCalled();
    expect(gateway.start).not.toHaveBeenCalled();
    expect(gateway.member).not.toHaveBeenCalled();
    service.store.set('discord', { token: config.token });
    const malformed = await service.app.inject({
      url: '/api/operator/setup-checks',
      headers: operatorHeaders(),
    });
    expect(malformed.statusCode).toBe(200);
    expect(malformed.json().checks.find((c: { id: string }) => c.id === 'discord').state).toBe(
      'blocked',
    );
  });
  it('shares only in-flight health probes and collects fresh results on the next request', async () => {
    await start();
    const gate = deferred<LocalSetupProbe>();
    const probe = vi.mocked(LocalWorker.prototype.setupProbe).mockReturnValueOnce(gate.promise);
    const auth = operatorHeaders();
    const requests = Promise.all(
      Array.from({ length: 3 }, () =>
        service.app.inject({ url: '/api/operator/setup-checks', headers: auth }),
      ),
    );
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(1));
    gate.resolve({ kind: 'worker-responding', modelFiles: 'present' });
    const results = await requests;
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect(probe).toHaveBeenCalledTimes(1);
    const next = await service.app.inject({ url: '/api/operator/setup-checks', headers: auth });
    expect(probe).toHaveBeenCalledTimes(2);
    expect(next.json().checks.find((c: { id: string }) => c.id === 'worker').reason).toBe(
      'python-missing',
    );
  });
});

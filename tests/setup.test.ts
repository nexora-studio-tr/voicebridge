import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { setupReport } from '../src/core/setup.js';
import { LocalWorker, workerSetupProbe } from '../src/server/local.js';

const input = {
  node: '24.22.1',
  platform: 'win32',
  architecture: 'x64',
  local: { kind: 'worker-responding', modelFiles: 'present' } as const,
  configured: true,
  connected: true,
  https: true,
};
describe('Installation evidence and sanitized worker classification', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it.each([
    ['24.17.0', 'pass'],
    ['24.22.1', 'pass'],
    ['24.16.9', 'blocked'],
    ['25.0.0', 'blocked'],
    ['22.22.0', 'blocked'],
    ['private-node-path', 'blocked'],
  ])('classifies the supported runtime boundary: %s', (node, state) => {
    const report = setupReport({ ...input, node });
    expect(report.checks.find((c) => c.id === 'node')?.state).toBe(state);
    expect(JSON.stringify(report)).not.toContain('private-node-path');
  });
  it('keeps integrity, sign-in and live speech pending when every automated check passes', () => {
    const report = setupReport(input);
    expect(report.checks.filter((c) => c.state === 'blocked')).toEqual([]);
    for (const id of ['integrity', 'oauth', 'live'])
      expect(report.checks.find((c) => c.id === id)?.state).toBe('manual');
    expect(report).not.toHaveProperty('ready');
    expect(report).not.toHaveProperty('liveTestPassed');
  });
  it('never treats a custom inference adapter as verified Python/models', () => {
    const report = setupReport({ ...input, local: { kind: 'custom' } });
    for (const id of ['worker', 'models'])
      expect(report.checks.find((c) => c.id === id)?.state).toBe('manual');
    expect(report.checks.find((c) => c.id === 'models')?.reason).toBe('custom');
  });
  it('drops arbitrary worker content and rejects contradictory or malformed health', () => {
    const health = {
      ready: true,
      missing: [],
      device: 'private-hardware-name',
      transcript: 'private-speech',
      token: 'private-key',
      path: 'C:/Users/private-name',
    };
    expect(workerSetupProbe(health)).toEqual({ kind: 'worker-responding', modelFiles: 'present' });
    expect(workerSetupProbe({ ...health, missing: ['C:/Users/private-name/model'] })).toEqual({
      kind: 'worker-responding',
      modelFiles: 'missing',
    });
    for (const invalid of [
      null,
      [],
      { ready: 'true', missing: [] },
      { ready: true },
      { ...health, error: 'private-provider-error' },
      { ...health, missing: Array(65).fill('private-path') },
    ])
      expect(workerSetupProbe(invalid)).toEqual({ kind: 'worker-unavailable' });
    const report = setupReport({
      ...input,
      local: workerSetupProbe(health),
      platform: 'private-machine-name',
      architecture: 'private-device-id',
    });
    expect(JSON.stringify(report)).not.toContain('private-');
    expect(report.environment).toEqual({
      platform: 'other',
      architecture: 'other',
      node: input.node,
    });
  });
  it('checks a missing runtime without spawning a process or making a network request', async () => {
    vi.stubEnv('VOICEBRIDGE_PYTHON', path.resolve('artifacts/absent-private-python'));
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', request);
    const worker = new LocalWorker(path.resolve('.'), path.resolve('artifacts'));
    expect(await worker.setupProbe()).toEqual({ kind: 'python-missing' });
    expect(request).not.toHaveBeenCalled();
    worker.stop();
  });
});

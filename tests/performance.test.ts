import { describe, expect, it, vi } from 'vitest';
import { PerformanceWindow } from '../src/core/performance.js';
import { Rooms } from '../src/core/rooms.js';
import { deferred, engine, voice } from './helpers.js';

describe('Content-free rolling performance window', () => {
  it('separates engines and delivery types and uses nearest-rank percentiles', () => {
    const metrics = new PerformanceWindow(() => 0);
    expect(metrics.snapshot().queueWait).toEqual({ count: 0, p50Ms: null, p95Ms: null });
    for (let i = 1; i <= 20; i++) metrics.record({ kind: 'caption', mode: 'local', ms: i * 10 });
    metrics.record({ kind: 'audio', mode: 'local', ms: 210 });
    metrics.record({ kind: 'caption', mode: 'cloud', ms: 9 });
    metrics.record({ kind: 'queue', ms: 3.8 });
    metrics.record({ kind: 'audio', mode: 'local', ms: NaN });
    metrics.record({ kind: 'queue', ms: -5 });
    const result = metrics.snapshot();
    expect(result.outputs[0]).toEqual({
      mode: 'local',
      caption: { count: 20, p50Ms: 100, p95Ms: 190 },
      audio: { count: 1, p50Ms: 210, p95Ms: 210 },
    });
    expect(result.outputs[1]!.caption.p95Ms).toBe(9);
    expect(result.queueWait.p50Ms).toBe(3);
    expect(result.sampleCount).toBe(23);
  });
  it('bounds retention by event count and monotonic age and discloses truncation', () => {
    let now = 0;
    const metrics = new PerformanceWindow(() => now);
    for (let i = 0; i < 700; i++) metrics.record({ kind: 'rejected' });
    expect(metrics.snapshot()).toMatchObject({ sampleCount: 512, limited: true, rejected: 512 });
    now = 299999;
    expect(metrics.snapshot().sampleCount).toBe(512);
    now = 300000;
    expect(metrics.snapshot()).toMatchObject({ sampleCount: 0, limited: false, rejected: 0 });
  });
  it('copies only numeric/fixed fields and returns detached aggregates', () => {
    const metrics = new PerformanceWindow(() => 0);
    const injected = {
      kind: 'job' as const,
      outcome: 'failed' as const,
      text: 'private text',
      error: 'secret error',
      user: 'private id',
    };
    metrics.record(injected);
    const first = metrics.snapshot();
    first.jobs.failed = 999;
    expect(metrics.snapshot().jobs.failed).toBe(1);
    expect(JSON.stringify(metrics.snapshot())).not.toMatch(/private|secret|text|error|user/);
  });
});

function fixture() {
  let time = 0;
  const local = engine();
  local.recognize.mockImplementation(async () => {
    time += 20;
    return 'private spoken words';
  });
  local.translate.mockImplementation(async () => {
    time += 30;
    return 'private translation';
  });
  local.speak.mockImplementation(async () => {
    time += 40;
    return voice();
  });
  const rooms = new Rooms(
    local,
    () => local,
    () => true,
    () => true,
    () => Date.now(),
    () => time,
  );
  const room = rooms.create(
    'private-guild',
    'private guild name',
    'private-channel',
    'private room name',
    'speaker',
  );
  rooms.addSpeaker(room, 'speaker', 'private speaker');
  rooms.consent(room, 'speaker', { local: true, cloud: true, language: 'en' });
  for (const id of ['alice', 'bob']) {
    rooms.join(room, id, 'private listener');
    rooms.subscribe(room, id, () => {});
    rooms.preferences(room, id, { language: 'tr', mode: 'local', audio: true });
  }
  return {
    rooms,
    room,
    local,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
describe('Instrumented room scheduling', () => {
  it('counts shared captions/audio once, not once per listener, and measures queue wait', async () => {
    const f = fixture(),
      gate = deferred<void>();
    f.rooms.queue.push('blocker', () => gate.promise);
    f.rooms.ingest(f.room, 'speaker', voice());
    expect(f.rooms.queue.active).toBe(1);
    expect(f.rooms.queue.length).toBe(1);
    f.advance(50);
    gate.resolve();
    await vi.waitFor(() => expect(f.rooms.queue.active).toBe(0));
    const report = f.rooms.performance.snapshot();
    expect(report.jobs).toEqual({ completed: 1, failed: 0, canceled: 0, noOutput: 0 });
    expect(report.queueWait).toMatchObject({ count: 1, p95Ms: 50 });
    expect(report.outputs[0]).toEqual({
      mode: 'local',
      caption: { count: 1, p50Ms: 100, p95Ms: 100 },
      audio: { count: 1, p50Ms: 140, p95Ms: 140 },
    });
    expect(JSON.stringify(report)).not.toMatch(/private|speaker|alice|bob/);
    expect(f.room.listeners.get('alice')!.captions).toHaveLength(1);
    expect(f.room.listeners.get('bob')!.captions).toHaveLength(1);
  });
  it('reports failed synthesis while preserving useful text and excludes raw errors', async () => {
    const f = fixture();
    f.local.speak.mockRejectedValue(Error('secret credentials and private conversation'));
    f.rooms.ingest(f.room, 'speaker', voice());
    await vi.waitFor(() => expect(f.rooms.performance.snapshot().jobs.failed).toBe(1));
    const report = f.rooms.performance.snapshot();
    expect(report.outputs[0]!.caption.count).toBe(1);
    expect(report.outputs[0]!.audio.count).toBe(0);
    expect(JSON.stringify(report)).not.toMatch(/secret|credentials|private/);
    expect(f.room.listeners.get('alice')!.captions).toHaveLength(1);
  });
  it('distinguishes revoked work and empty recognition from successful jobs', async () => {
    const f = fixture(),
      gate = deferred<string>();
    f.local.recognize.mockReturnValueOnce(gate.promise);
    f.rooms.ingest(f.room, 'speaker', voice());
    f.rooms.consent(f.room, 'speaker', { local: false, cloud: false, language: 'en' });
    gate.resolve('private words');
    await vi.waitFor(() => expect(f.rooms.performance.snapshot().jobs.canceled).toBe(1));
    f.rooms.consent(f.room, 'speaker', { local: true, cloud: false, language: 'en' });
    f.local.recognize.mockResolvedValueOnce('');
    f.rooms.ingest(f.room, 'speaker', voice());
    await vi.waitFor(() => expect(f.rooms.performance.snapshot().jobs.noOutput).toBe(1));
    expect(f.rooms.performance.snapshot().outputs[0]!.caption.count).toBe(0);
  });
  it('records backpressure without accepting more than two waiting jobs per speaker', async () => {
    const f = fixture(),
      gate = deferred<string>();
    f.local.recognize.mockReturnValueOnce(gate.promise);
    for (let i = 0; i < 5; i++) f.rooms.ingest(f.room, 'speaker', voice());
    expect(f.rooms.queue.length).toBe(2);
    expect(f.rooms.performance.snapshot().rejected).toBe(2);
    gate.resolve('hello');
    await vi.waitFor(() => expect(f.rooms.queue.active).toBe(0));
    expect(f.rooms.performance.snapshot().jobs.completed).toBe(3);
  });
  it('keeps local/cloud group measurements separate with text-only delivery', async () => {
    const f = fixture();
    f.rooms.preferences(f.room, 'alice', { language: 'tr', mode: 'local', audio: false });
    f.rooms.preferences(f.room, 'bob', { language: 'tr', mode: 'cloud', audio: false });
    f.rooms.ingest(f.room, 'speaker', voice());
    await vi.waitFor(() => expect(f.rooms.queue.active).toBe(0));
    const report = f.rooms.performance.snapshot();
    expect(report.outputs.map((o) => o.caption.count)).toEqual([1, 1]);
    expect(report.outputs.map((o) => o.audio.count)).toEqual([0, 0]);
    expect(report.jobs.completed).toBe(1);
    expect(f.local.speak).not.toHaveBeenCalled();
  });
  it('does not count audio when its last requesting listener changes preferences during synthesis', async () => {
    const f = fixture(),
      gate = deferred<Buffer>();
    f.rooms.preferences(f.room, 'bob', { language: 'tr', mode: 'local', audio: false });
    f.local.speak.mockReturnValueOnce(gate.promise);
    f.rooms.ingest(f.room, 'speaker', voice());
    await vi.waitFor(() => expect(f.local.speak).toHaveBeenCalledTimes(1));
    f.rooms.preferences(f.room, 'alice', { language: 'tr', mode: 'local', audio: false });
    gate.resolve(voice());
    await vi.waitFor(() => expect(f.rooms.queue.active).toBe(0));
    expect(f.rooms.performance.snapshot().outputs[0]!.audio.count).toBe(0);
    expect(f.rooms.performance.snapshot().outputs[0]!.caption.count).toBe(1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectRoom } from '../src/web/room-stream.js';
import { ApiError } from '../src/web/api.js';
import type { RoomSnapshot, Caption } from '../src/core/contracts.js';

const roomId = 'room';
const clip = (id = 'old'): Caption => ({
  id,
  speakerId: 'speaker',
  speaker: 'Synthetic speaker',
  source: 'Hello',
  text: 'Merhaba',
  sourceLanguage: 'en',
  language: 'tr',
  mode: 'local',
  fallback: false,
  createdAt: 100,
  latencyMs: 5,
  audioUrl: `/api/rooms/${roomId}/audio/${id}`,
});
const room = (captions: Caption[] = []): RoomSnapshot => ({
  id: roomId,
  guildId: 'guild',
  guildName: 'Synthetic fixture',
  channelId: 'channel',
  name: 'Room',
  active: true,
  cloudAvailable: false,
  generation: 0,
  queue: 0,
  preferences: { language: 'tr', mode: 'local', audio: true },
  captions,
  participants: [],
});
function fakeSource() {
  const source = {
    onopen: null as EventSource['onopen'],
    onerror: null as EventSource['onerror'],
    onmessage: null as EventSource['onmessage'],
    close: vi.fn(),
  };
  return Object.assign(source, {
    opened() {
      source.onopen?.call(source as unknown as EventSource, new Event('open'));
    },
    error() {
      source.onerror?.call(source as unknown as EventSource, new Event('error'));
    },
    frame(type: string, data: unknown, sequence = 1, connectionId = 'connection-000001') {
      source.onmessage?.call(
        source as unknown as EventSource,
        new MessageEvent('message', {
          data: JSON.stringify({ type, data, sequence, connectionId }),
        }),
      );
    },
    raw(data: string) {
      source.onmessage?.call(
        source as unknown as EventSource,
        new MessageEvent('message', { data }),
      );
    },
  });
}
function callbacks() {
  type Handlers = Parameters<typeof connectRoom>[1];
  return {
    state: vi.fn<Handlers['state']>(),
    snapshot: vi.fn<Handlers['snapshot']>(),
    event: vi.fn<Handlers['event']>(),
    disconnect: vi.fn<Handlers['disconnect']>(),
    end: vi.fn<Handlers['end']>(),
  };
}
describe('Room stream recovery and stale delivery', () => {
  let connection: ReturnType<typeof connectRoom>;
  let sources: ReturnType<typeof fakeSource>[], time: number;
  let handlers: ReturnType<typeof callbacks>;
  beforeEach(() => {
    vi.useFakeTimers();
    sources = [];
    time = 0;
    handlers = callbacks();
  });
  afterEach(() => {
    connection?.close();
    vi.useRealTimers();
  });
  function start(probe: (signal: AbortSignal) => Promise<unknown> = async () => {}) {
    connection = connectRoom(roomId, handlers, {
      source: () => {
        const s = fakeSource();
        sources.push(s);
        return s;
      },
      probe,
      now: () => time,
      random: () => 0.5,
    });
    return sources[0]!;
  }
  it('waits for a verified room snapshot before reporting live; old snapshot audio is never queued', () => {
    const source = start();
    source.opened();
    expect(connection.state).toBe('connecting');
    source.frame('snapshot', room([clip()]));
    expect(connection.state).toBe('live');
    expect(handlers.event).not.toHaveBeenCalled();
    source.frame('caption', clip(), 2);
    expect(handlers.event).toHaveBeenLastCalledWith({ type: 'caption', data: clip() }, false);
    source.frame('caption', clip('new'), 3);
    expect(handlers.event).toHaveBeenLastCalledWith({ type: 'caption', data: clip('new') }, true);
  });
  it('clears on disconnect, reconnects with a fresh source and ignores late callbacks from the old transport', async () => {
    const old = start();
    old.frame('snapshot', room());
    old.error();
    expect(connection.state).toBe('reconnecting');
    expect(handlers.disconnect).toHaveBeenCalled();
    expect(old.close).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    const fresh = sources[1]!;
    fresh.frame('snapshot', room([clip()]), 1, 'connection-000002');
    old.frame('caption', clip('late'), 2);
    old.error();
    expect(connection.state).toBe('live');
    expect(handlers.event).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404])('stops retrying after an authoritative %s rejection', async (status) => {
    const source = start(async () => {
      throw new ApiError(
        status === 401
          ? 'AUTH_REQUIRED'
          : status === 403
            ? 'VOICE_MEMBERSHIP_REQUIRED'
            : 'ROOM_NOT_FOUND',
        status,
      );
    });
    source.error();
    await vi.advanceTimersByTimeAsync(20000);
    expect(connection.state).toBe('ended');
    expect(sources).toHaveLength(1);
    expect(handlers.end).toHaveBeenCalledOnce();
  });
  it('does not apply an old rejection after manual retry has established a new connection', async () => {
    let reject!: (error: Error) => void;
    const source = start(
      () =>
        new Promise((_resolve, no) => {
          reject = no;
        }),
    );
    source.error();
    connection.retry();
    sources[1]!.frame('snapshot', room());
    reject(new ApiError('AUTH_REQUIRED', 401));
    await Promise.resolve();
    expect(connection.state).toBe('live');
    expect(handlers.end).not.toHaveBeenCalled();
  });
  it('clears immediately on browser offline, suspends retries and resumes on an online event', async () => {
    const source = start();
    source.frame('snapshot', room());
    connection.setOnline(false);
    expect(connection.state).toBe('reconnecting');
    expect(source.close).toHaveBeenCalled();
    expect(handlers.disconnect).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60000);
    expect(sources).toHaveLength(1);
    connection.setOnline(true);
    expect(sources).toHaveLength(2);
    sources[1]!.frame('snapshot', room(), 1, 'connection-000002');
    expect(connection.state).toBe('live');
  });
  it('uses bounded exponential retry and cancels all retry timers on close', async () => {
    start().error();
    await vi.advanceTimersByTimeAsync(999);
    expect(sources).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    sources[1]!.error();
    await vi.advanceTimersByTimeAsync(1999);
    expect(sources).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(sources).toHaveLength(3);
    connection.close();
    await vi.advanceTimersByTimeAsync(60000);
    expect(sources).toHaveLength(3);
  });
  it('ignores duplicate/foreign frames and reconnects on a missing sequence instead of playing a gap', () => {
    const source = start();
    source.frame('snapshot', room());
    source.frame('caption', clip('one'), 2);
    source.frame('caption', clip('duplicate'), 2);
    source.frame('caption', clip('foreign'), 3, 'connection-foreign');
    expect(handlers.event).toHaveBeenCalledTimes(1);
    source.frame('caption', clip('gap'), 4);
    expect(handlers.disconnect).toHaveBeenLastCalledWith('STREAM_INVALID');
    expect(connection.state).toBe('reconnecting');
  });
  it.each(['wrong-room', 'malformed', 'oversized', 'external-audio'])(
    'rejects %s data and clears transient output',
    (kind) => {
      const source = start();
      if (kind === 'wrong-room') source.frame('snapshot', { ...room(), id: 'another-room' });
      else if (kind === 'malformed') source.raw('{');
      else if (kind === 'oversized') source.raw('x'.repeat(512 * 1024 + 1));
      else {
        source.frame('snapshot', room());
        source.frame('caption', { ...clip(), audioUrl: 'https://attacker.invalid/audio' }, 2);
      }
      expect(connection.state).toBe('reconnecting');
      expect(handlers.disconnect).toHaveBeenLastCalledWith('STREAM_INVALID');
      expect(handlers.event).not.toHaveBeenCalled();
    },
  );
  it('ends on membership reset and never resurrects output through queued messages', async () => {
    const source = start();
    source.frame('snapshot', room());
    source.frame('reset', { reason: 'membership' }, 2);
    source.frame('caption', clip('late'), 3);
    await vi.advanceTimersByTimeAsync(30000);
    expect(handlers.end).toHaveBeenCalledWith('VOICE_MEMBERSHIP_REQUIRED');
    expect(handlers.event).not.toHaveBeenCalled();
    expect(sources).toHaveLength(1);
  });
  it('detects a silent stalled stream while valid heartbeat frames keep an active stream healthy', async () => {
    const source = start();
    source.frame('snapshot', room());
    time = 14000;
    source.frame('heartbeat', {}, 2);
    time = 28000;
    await vi.advanceTimersByTimeAsync(1000);
    expect(connection.state).toBe('live');
    time = 30001;
    await vi.advanceTimersByTimeAsync(1000);
    expect(connection.state).toBe('reconnecting');
  });
});

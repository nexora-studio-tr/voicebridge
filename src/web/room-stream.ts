import { z } from 'zod';
import type { Caption, Event as BridgeEvent, RoomSnapshot } from '../core/contracts.js';
import { api, ApiError } from './api.js';

export type RoomConnectionState = 'connecting' | 'live' | 'reconnecting' | 'ended';
type Source = Pick<EventSource, 'onopen' | 'onerror' | 'onmessage' | 'close'>;
const language = z.enum(['tr', 'en']);
const duration = z.number().finite().nonnegative();
const caption = z
  .object({
    id: z.string().min(1).max(100),
    speakerId: z.string().min(1).max(100),
    speaker: z.string().max(200),
    source: z.string().max(6000),
    text: z.string().max(6000),
    sourceLanguage: language,
    language,
    mode: z.enum(['local', 'cloud']),
    fallback: z.boolean(),
    createdAt: z.number().finite().nonnegative(),
    latencyMs: z.number().finite().nonnegative(),
    audioUrl: z.string().max(300).optional(),
    timing: z
      .object({
        queueMs: duration,
        recognitionMs: duration,
        translationMs: duration,
        captionOverheadMs: duration,
        captionMs: duration,
        synthesisMs: duration.optional(),
        audioOverheadMs: duration.optional(),
        audioMs: duration.optional(),
      })
      .optional(),
  })
  .passthrough();
const snapshot = z.object({
  id: z.string().min(1).max(100),
  guildId: z.string().max(100),
  guildName: z.string().max(200),
  channelId: z.string().max(100),
  name: z.string().max(200),
  active: z.literal(true),
  generation: z.number().int().nonnegative(),
  queue: z.number().int().nonnegative(),
  cloudAvailable: z.boolean(),
  preferences: z.object({ language, mode: z.enum(['local', 'cloud']), audio: z.boolean() }),
  captions: z.array(caption).max(30),
  participants: z
    .array(
      z.object({
        id: z.string().max(100),
        name: z.string().max(200),
        local: z.boolean(),
        cloud: z.boolean(),
        language,
        speaking: z.boolean(),
      }),
    )
    .max(50),
});
const envelope = z.object({
  type: z.enum(['snapshot', 'caption', 'state', 'status', 'reset', 'error', 'heartbeat']),
  data: z.unknown(),
  connectionId: z.string().min(16).max(100),
  sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
});
export function connectRoom(
  roomId: string,
  handlers: {
    state: (state: RoomConnectionState) => void;
    snapshot: (room: RoomSnapshot) => void;
    event: (event: BridgeEvent, allowAudio: boolean) => void;
    disconnect: (reason?: string) => void;
    end: (reason: string) => void;
  },
  dependencies: {
    source?: (url: string) => Source;
    probe?: (signal: AbortSignal) => Promise<unknown>;
    now?: () => number;
    random?: () => number;
  } = {},
) {
  const createSource = dependencies.source ?? ((url: string) => new EventSource(url));
  const probe =
    dependencies.probe ??
    ((signal: AbortSignal) => api(`/api/rooms/${roomId}`, 'GET', undefined, signal));
  const now = dependencies.now ?? (() => performance.now());
  const random = dependencies.random ?? Math.random;
  let source: Source | null = null,
    generation = 0,
    closed = false,
    failures = 0;
  let offline = false;
  let state: RoomConnectionState = 'connecting',
    lastFrame = now();
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let probeAbort: AbortController | undefined;
  const update = (next: RoomConnectionState) => {
    state = next;
    handlers.state(next);
  };
  function cancel() {
    clearTimeout(retryTimer);
    probeAbort?.abort();
    source?.close();
    source = null;
    generation++;
  }
  function finish(reason: string) {
    if (closed) return;
    cancel();
    closed = true;
    clearInterval(watchdog);
    handlers.disconnect();
    update('ended');
    handlers.end(reason);
  }
  function open() {
    if (closed) return;
    cancel();
    const epoch = generation,
      current = createSource(`/api/rooms/${roomId}/events`);
    source = current;
    lastFrame = now();
    let connectionId: string | null = null,
      sequence = 0;
    let bufferedIds = new Set<string>();
    const active = () => !closed && epoch === generation && source === current;
    const fail = (reason?: string) => {
      if (!active()) return;
      current.close();
      source = null;
      handlers.disconnect(reason);
      update('reconnecting');
      const delay = Math.min(15000, 1000 * 2 ** Math.min(failures++, 4) * (0.8 + random() * 0.4));
      retryTimer = setTimeout(open, delay);
      const abort = new AbortController();
      probeAbort = abort;
      void probe(AbortSignal.any([abort.signal, AbortSignal.timeout(2500)])).catch((error) => {
        if (closed || abort.signal.aborted || epoch !== generation) return;
        if (error instanceof ApiError && [401, 403, 404].includes(error.status)) finish(error.code);
      });
    };
    current.onopen = () => {
      if (active()) lastFrame = now();
    };
    current.onerror = () => fail();
    current.onmessage = (message) => {
      if (!active()) return;
      try {
        if (message.data.length > 512 * 1024) throw Error('STREAM_INVALID');
        const frame = envelope.parse(JSON.parse(message.data));
        if (!connectionId) {
          if (frame.type !== 'snapshot' || frame.sequence !== 1) throw Error('STREAM_INVALID');
        } else {
          if (frame.connectionId !== connectionId || frame.sequence <= sequence) return;
          if (frame.sequence !== sequence + 1) throw Error('STREAM_INVALID');
        }
        if (frame.type === 'snapshot') {
          const value = snapshot.parse(frame.data) as RoomSnapshot;
          if (value.id !== roomId) throw Error('STREAM_INVALID');
          if (!connectionId) bufferedIds = new Set(value.captions.map((c) => c.id));
          connectionId = frame.connectionId;
          handlers.snapshot(value);
          failures = 0;
          update('live');
        } else if (frame.type === 'caption') {
          const value = caption.parse(frame.data) as Caption;
          if (
            value.audioUrl &&
            (!value.audioUrl.startsWith(`/api/rooms/${roomId}/audio/`) ||
              !/^[a-zA-Z0-9_-]{1,100}$/.test(
                value.audioUrl.slice(value.audioUrl.lastIndexOf('/') + 1),
              ))
          )
            throw Error('STREAM_INVALID');
          handlers.event({ type: 'caption', data: value }, !bufferedIds.has(value.id));
        } else {
          const data = z.record(z.string(), z.unknown()).parse(frame.data);
          if (
            frame.type === 'reset' &&
            ['auth', 'membership', 'connection_lost', 'expired', 'stopped'].includes(
              String(data.reason),
            )
          ) {
            finish(
              data.reason === 'auth'
                ? 'AUTH_REQUIRED'
                : data.reason === 'membership'
                  ? 'VOICE_MEMBERSHIP_REQUIRED'
                  : 'ROOM_NOT_FOUND',
            );
            return;
          }
          handlers.event({ type: frame.type, data }, false);
        }
        sequence = frame.sequence;
        lastFrame = now();
      } catch {
        fail('STREAM_INVALID');
      }
    };
  }
  const watchdog = setInterval(() => {
    if (source && now() - lastFrame > 15000)
      source.onerror?.call(source as EventSource, new Event('error'));
  }, 1000);
  update('connecting');
  open();
  return {
    get state() {
      return state;
    },
    retry() {
      if (closed) return;
      cancel();
      handlers.disconnect();
      failures = 0;
      update('reconnecting');
      if (!offline) open();
    },
    setOnline(value: boolean) {
      if (closed) return;
      if (value) {
        offline = false;
        if (state === 'reconnecting') this.retry();
      } else if (!offline) {
        offline = true;
        cancel();
        handlers.disconnect();
        update('reconnecting');
      }
    },
    close() {
      if (!closed) {
        closed = true;
        cancel();
        clearInterval(watchdog);
      }
    },
  };
}

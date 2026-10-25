import { randomUUID } from 'node:crypto';
import {
  Caption,
  Consent,
  Event,
  Fault,
  Inference,
  Language,
  Mode,
  Preferences,
  Speaker,
  check,
} from './contracts.js';
import { FairQueue, inspectWav } from './audio.js';

interface Listener {
  id: string;
  name: string;
  preferences: Preferences;
  generation: number;
  events: Set<(event: Event) => void>;
  captions: Caption[];
}
interface Media {
  bytes: Buffer;
  expires: number;
  speaker: string;
  epoch: number;
  allowed: Map<string, number>;
}
export interface Room {
  id: string;
  guildId: string;
  guildName: string;
  channelId: string;
  name: string;
  creator: string;
  speakers: Map<string, Speaker>;
  listeners: Map<string, Listener>;
  media: Map<string, Media>;
  active: boolean;
  epoch: number;
  createdAt: number;
  touchedAt: number;
  jobs: Map<AbortController, string>;
}
export interface EngineContext {
  operation: string;
  guildId: string;
  roomId: string;
  actorId: string;
  valid: () => boolean;
}
export class Rooms {
  onConsentChange: (room: Room, id: string) => void = () => {};
  rooms = new Map<string, Room>();
  queue = new FairQueue();
  constructor(
    public local: Inference,
    public cloud: (context: EngineContext) => Inference,
    public authorized: (room: Room, userId: string) => boolean,
    public cloudAllowed: (guild: string) => boolean,
    public now = () => Date.now(),
  ) {}
  create(guildId: string, guildName: string, channelId: string, name: string, creator: string) {
    const existing = [...this.rooms.values()].find((r) => r.active && r.guildId === guildId);
    if (existing) {
      check(existing.channelId === channelId, 'GUILD_ROOM_ACTIVE', 409);
      return existing;
    }
    check(this.rooms.size < 20, 'ROOM_CAPACITY', 429);
    const room: Room = {
      id: randomUUID(),
      guildId,
      guildName,
      channelId,
      name,
      creator,
      speakers: new Map(),
      listeners: new Map(),
      media: new Map(),
      active: true,
      epoch: 0,
      createdAt: this.now(),
      touchedAt: this.now(),
      jobs: new Map(),
    };
    this.rooms.set(room.id, room);
    return room;
  }
  get(id: string) {
    const r = this.rooms.get(id);
    check(r?.active, 'ROOM_NOT_FOUND', 404);
    r.touchedAt = this.now();
    return r;
  }
  addSpeaker(room: Room, id: string, name: string) {
    let s = room.speakers.get(id);
    if (!s) {
      check(room.speakers.size < 50, 'ROOM_CAPACITY', 429);
      s = {
        id,
        name,
        consent: { local: false, cloud: false, language: 'tr' },
        epoch: 0,
        speaking: false,
      };
      room.speakers.set(id, s);
    } else s.name = name;
    return s;
  }
  join(room: Room, id: string, name: string) {
    check(this.authorized(room, id), 'VOICE_MEMBERSHIP_REQUIRED', 403);
    this.addSpeaker(room, id, name);
    let l = room.listeners.get(id);
    if (!l) {
      check(room.listeners.size < 30, 'LISTENER_CAPACITY', 429);
      l = {
        id,
        name,
        preferences: { language: 'tr', mode: 'local', audio: false },
        generation: 0,
        events: new Set(),
        captions: [],
      };
      room.listeners.set(id, l);
    }
    return l;
  }
  consent(room: Room, id: string, input: unknown) {
    check(this.authorized(room, id), 'VOICE_MEMBERSHIP_REQUIRED', 403);
    const s = room.speakers.get(id);
    check(s, 'SPEAKER_NOT_FOUND', 404);
    const consent = Consent.parse(input);
    s.consent = consent;
    s.epoch++;
    this.onConsentChange(room, id);
    for (const [job, speaker] of room.jobs) if (speaker === id) job.abort();
    for (const [key, m] of room.media) if (m.speaker === id) room.media.delete(key);
    // Revocation removes buffered content too; nothing is re-exported from a stale caption cache.
    for (const l of room.listeners.values()) {
      l.captions = l.captions.filter((c) => c.speakerId !== id);
      this.emit(l, { type: 'reset', data: { speakerId: id } });
    }
    this.broadcast(room, { type: 'state', data: { reason: 'consent' } });
    return consent;
  }
  preferences(room: Room, id: string, input: unknown) {
    const l = room.listeners.get(id);
    check(l && this.authorized(room, id), 'VOICE_MEMBERSHIP_REQUIRED', 403);
    const p = Preferences.parse(input);
    if (p.mode === 'cloud') check(this.cloudAllowed(room.guildId), 'CLOUD_DISABLED', 403);
    l.preferences = p;
    l.generation++;
    l.captions = [];
    this.emit(l, { type: 'reset', data: { generation: l.generation } });
    return p;
  }
  subscribe(room: Room, id: string, fn: (event: Event) => void) {
    const l = room.listeners.get(id);
    check(l && this.authorized(room, id), 'VOICE_MEMBERSHIP_REQUIRED', 403);
    check(l.events.size < 3, 'SUBSCRIPTION_LIMIT', 429);
    l.events.add(fn);
    return () => {
      l.events.delete(fn);
    };
  }
  leave(room: Room, id: string) {
    const l = room.listeners.get(id);
    if (l) {
      l.generation++;
      this.emit(l, { type: 'reset', data: { reason: 'membership' } });
      l.events.clear();
      room.listeners.delete(id);
    }
    const s = room.speakers.get(id);
    if (s) {
      s.epoch++;
      s.consent = { ...s.consent, local: false, cloud: false };
      room.speakers.delete(id);
    }
    for (const [job, speaker] of room.jobs) if (speaker === id) job.abort();
    for (const [key, m] of room.media)
      if (m.speaker === id || m.allowed.has(id)) room.media.delete(key);
    this.broadcast(room, { type: 'state', data: { reason: 'membership' } });
  }
  stop(room: Room, reason = 'stopped') {
    room.active = false;
    room.epoch++;
    for (const job of room.jobs.keys()) job.abort();
    room.jobs.clear();
    room.media.clear();
    this.broadcast(room, { type: 'reset', data: { reason } });
    for (const l of room.listeners.values()) l.events.clear();
    room.listeners.clear();
    room.speakers.clear();
    this.rooms.delete(room.id);
  }
  stopAll(reason = 'connection_lost') {
    for (const r of this.rooms.values()) this.stop(r, reason);
  }
  state(room: Room, id: string) {
    const l = room.listeners.get(id);
    return {
      id: room.id,
      guildId: room.guildId,
      guildName: room.guildName,
      name: room.name,
      channelId: room.channelId,
      active: room.active,
      participants: [...room.speakers.values()].map((s) => ({
        id: s.id,
        name: s.name,
        local: s.consent.local,
        cloud: s.consent.cloud,
        language: s.consent.language,
        speaking: s.speaking,
      })),
      preferences: l?.preferences ?? { language: 'tr', mode: 'local', audio: false },
      generation: l?.generation ?? 0,
      queue: this.queue.length,
      cloudAvailable: this.cloudAllowed(room.guildId),
      captions: l?.captions.filter((c) => c.createdAt > this.now() - 90_000) ?? [],
    };
  }
  audio(room: Room, id: string, mediaId: string) {
    const l = room.listeners.get(id),
      m = room.media.get(mediaId);
    check(
      l &&
        m &&
        this.authorized(room, id) &&
        m.expires > this.now() &&
        m.allowed.get(id) === l.generation &&
        room.speakers.get(m.speaker)?.epoch === m.epoch,
      'AUDIO_EXPIRED',
      404,
    );
    return m.bytes;
  }
  private emit(l: Listener, e: Event) {
    for (const fn of l.events) {
      try {
        fn(e);
      } catch {
        l.events.delete(fn);
      }
    }
  }
  broadcast(room: Room, e: Event) {
    for (const l of room.listeners.values()) this.emit(l, e);
  }
  ingest(room: Room, speakerId: string, audio: Buffer, discontinuity = false) {
    const s = room.speakers.get(speakerId);
    if (!room.active || !s?.consent.local || !this.authorized(room, speakerId)) return;
    if (discontinuity) {
      this.broadcast(room, { type: 'status', data: { code: 'AUDIO_GAP', speakerId } });
      return;
    }
    const info = inspectWav(audio);
    if (info.rms < 0.003 || info.seconds < 0.35) return;
    const epoch = s.epoch,
      started = this.now(),
      utterance = randomUUID();
    try {
      this.queue.push(speakerId, async () => {
        const signal = new AbortController();
        room.jobs.set(signal, speakerId);
        const baseValid = () =>
          room.active &&
          s.epoch === epoch &&
          s.consent.local &&
          this.authorized(room, speakerId) &&
          !signal.signal.aborted;
        try {
          if (!baseValid()) return;
          const groups = new Map<
            string,
            { mode: Mode; language: Language; listeners: { l: Listener; generation: number }[] }
          >();
          for (const l of room.listeners.values()) {
            if (!l.events.size || !this.authorized(room, l.id)) continue;
            const mode: Mode =
              l.preferences.mode === 'cloud' && s.consent.cloud ? 'cloud' : 'local';
            const key = mode + ':' + l.preferences.language,
              g = groups.get(key) ?? { mode, language: l.preferences.language, listeners: [] };
            g.listeners.push({ l, generation: l.generation });
            groups.set(key, g);
          }
          const recognition = new Map<Mode, Promise<string>>();
          for (const g of groups.values()) {
            const valid = () =>
              baseValid() &&
              (g.mode !== 'cloud' || (s.consent.cloud && this.cloudAllowed(room.guildId))) &&
              g.listeners.some(
                ({ l, generation }) =>
                  room.listeners.get(l.id) === l &&
                  l.events.size > 0 &&
                  l.generation === generation &&
                  this.authorized(room, l.id),
              );
            if (!valid()) continue;
            const context: EngineContext = {
              operation: utterance,
              guildId: room.guildId,
              roomId: room.id,
              actorId: g.listeners[0]!.l.id,
              valid,
            };
            const engine = g.mode === 'local' ? this.local : this.cloud(context);
            try {
              this.broadcast(room, { type: 'status', data: { code: 'PROCESSING', speakerId } });
              let text = recognition.get(g.mode);
              if (!text) {
                text = engine.recognize(audio, s.consent.language, signal.signal);
                recognition.set(g.mode, text);
              }
              const source = await text;
              if (!valid() || !source.trim()) continue;
              const translated = await engine.translate(
                source,
                s.consent.language,
                g.language,
                signal.signal,
              );
              if (!valid() || !translated.trim()) continue;
              const listeners = g.listeners.filter(
                ({ l, generation }) =>
                  l.events.size > 0 && l.generation === generation && this.authorized(room, l.id),
              );
              const createdAt = this.now();
              const deliver = (mediaId?: string) => {
                for (const { l, generation } of listeners) {
                  if (
                    !valid() ||
                    !l.events.size ||
                    l.generation !== generation ||
                    !this.authorized(room, l.id)
                  )
                    continue;
                  const caption: Caption = {
                    id: utterance,
                    speakerId,
                    speaker: s.name,
                    source,
                    text: translated,
                    sourceLanguage: s.consent.language,
                    language: g.language,
                    mode: g.mode,
                    fallback: l.preferences.mode !== g.mode,
                    createdAt,
                    latencyMs: createdAt - started,
                    ...(mediaId && l.preferences.audio
                      ? { audioUrl: `/api/rooms/${room.id}/audio/${mediaId}` }
                      : {}),
                  };
                  l.captions = [
                    ...l.captions.filter(
                      (c) => c.id !== utterance && c.createdAt > this.now() - 90_000,
                    ),
                    caption,
                  ].slice(-30);
                  this.emit(l, { type: 'caption', data: caption });
                }
              };
              // Captions are delivered before synthesis, so a TTS failure never hides a useful translation.
              deliver();
              let mediaId: string | undefined;
              if (listeners.some(({ l }) => l.preferences.audio)) {
                const bytes = await engine.speak(translated, g.language, signal.signal);
                if (!valid()) continue;
                inspectWav(bytes);
                mediaId = randomUUID();
                for (const [key, m] of room.media)
                  if (m.expires < this.now()) room.media.delete(key);
                while (room.media.size >= 48) room.media.delete(room.media.keys().next().value!);
                room.media.set(mediaId, {
                  bytes,
                  expires: this.now() + 90_000,
                  speaker: speakerId,
                  epoch,
                  allowed: new Map(
                    listeners
                      .filter(({ l }) => l.preferences.audio)
                      .map(({ l, generation }) => [l.id, generation]),
                  ),
                });
                deliver(mediaId);
              }
            } catch (e) {
              const code =
                e instanceof Fault
                  ? e.code
                  : signal.signal.aborted
                    ? 'CANCELED'
                    : 'INFERENCE_FAILED';
              for (const { l, generation } of g.listeners)
                if (l.generation === generation)
                  this.emit(l, { type: 'error', data: { code, speakerId } });
            }
          }
        } finally {
          room.jobs.delete(signal);
          if (room.active)
            this.broadcast(room, { type: 'status', data: { code: 'IDLE', speakerId } });
        }
      });
    } catch (e) {
      this.broadcast(room, {
        type: 'status',
        data: { code: e instanceof Fault ? e.code : 'QUEUE_FULL', speakerId },
      });
    }
  }
}

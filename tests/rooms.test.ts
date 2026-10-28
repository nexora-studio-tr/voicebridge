import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Rooms, type Room } from '../src/core/rooms.js';
import { FairQueue, inspectWav, wav } from '../src/core/audio.js';
import type { Event } from '../src/core/contracts.js';
import { deferred, engine, voice } from './helpers.js';
describe('room pipeline consent and listener isolation', () => {
  let local: ReturnType<typeof engine>,
    cloud: ReturnType<typeof engine>,
    rooms: Rooms,
    room: Room,
    events: Event[],
    allowed: Set<string>,
    cloudAllowed: boolean;
  beforeEach(() => {
    local = engine();
    cloud = engine();
    allowed = new Set(['speaker', 'alice', 'bob']);
    cloudAllowed = true;
    rooms = new Rooms(
      local,
      () => cloud,
      (_r, id) => allowed.has(id),
      () => cloudAllowed,
    );
    room = rooms.create('g', 'Guild', 'c', 'Room', 'speaker');
    rooms.addSpeaker(room, 'speaker', 'Speaker');
    rooms.consent(room, 'speaker', { local: true, cloud: false, language: 'en' });
    rooms.join(room, 'alice', 'Alice');
    events = [];
    rooms.subscribe(room, 'alice', (e) => events.push(e));
  });
  async function completed() {
    await vi.waitFor(() => expect(room.jobs.size).toBe(0));
  }
  it('returns to idle when the recognizer finds no speech instead of leaving a processing indicator', async () => {
    local.recognize.mockResolvedValue('');
    rooms.ingest(room, 'speaker', voice());
    await completed();
    const states = events.flatMap((e) => (e.type === 'status' ? [e.data.code] : []));
    expect(states).toEqual(['PROCESSING', 'IDLE']);
    expect(events.some((e) => e.type === 'caption')).toBe(false);
  });
  it('ignores unconsented, silent and explicitly discontinuous audio', async () => {
    rooms.consent(room, 'speaker', { local: false, cloud: false, language: 'en' });
    rooms.ingest(room, 'speaker', voice());
    rooms.consent(room, 'speaker', { local: true, cloud: false, language: 'en' });
    rooms.ingest(room, 'speaker', wav(Buffer.alloc(16000)));
    rooms.ingest(room, 'speaker', voice(), true);
    await completed();
    expect(local.recognize).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'status' && e.data.code === 'AUDIO_GAP')).toBe(true);
  });
  it('shares recognition and synthesis for listeners with the same preferences', async () => {
    rooms.join(room, 'bob', 'Bob');
    rooms.subscribe(room, 'bob', () => {});
    for (const id of ['alice', 'bob'])
      rooms.preferences(room, id, { language: 'tr', mode: 'local', audio: true });
    rooms.ingest(room, 'speaker', voice());
    await completed();
    expect(local.recognize).toHaveBeenCalledTimes(1);
    expect(local.speak).toHaveBeenCalledTimes(1);
    expect(room.listeners.get('alice')!.captions).toHaveLength(1);
    expect(room.listeners.get('bob')!.captions[0]!.audioUrl).toBe(
      room.listeners.get('alice')!.captions[0]!.audioUrl,
    );
  });
  it('delivers captions before TTS and keeps them if synthesis fails', async () => {
    rooms.preferences(room, 'alice', { language: 'tr', mode: 'local', audio: true });
    const gate = deferred<Buffer>();
    local.speak.mockImplementation(() => gate.promise);
    rooms.ingest(room, 'speaker', voice());
    await vi.waitFor(() => expect(room.listeners.get('alice')!.captions).toHaveLength(1));
    expect(room.listeners.get('alice')!.captions[0]!.audioUrl).toBeUndefined();
    gate.resolve(voice());
    await completed();
    expect(room.listeners.get('alice')!.captions[0]!.audioUrl).toBeDefined();
  });
  it('does not synthesize audio when the listener has not enabled it', async () => {
    rooms.ingest(room, 'speaker', voice());
    await completed();
    expect(local.speak).not.toHaveBeenCalled();
    expect(room.listeners.get('alice')!.captions).toHaveLength(1);
  });
  it('starts no inference after the last web subscriber disconnects', async () => {
    room.listeners.get('alice')!.events.clear();
    rooms.ingest(room, 'speaker', voice());
    await completed();
    expect(local.recognize).not.toHaveBeenCalled();
  });
  it('keeps another listener’s shared audio when one listener leaves', async () => {
    rooms.join(room, 'bob', 'Bob');
    const bobEvents: Event[] = [];
    rooms.subscribe(room, 'bob', (event) => bobEvents.push(event));
    for (const id of ['alice', 'bob'])
      rooms.preferences(room, id, { language: 'tr', mode: 'local', audio: true });
    rooms.ingest(room, 'speaker', voice());
    await completed();
    const media = room.media.keys().next().value!;
    bobEvents.length = 0;
    rooms.leave(room, 'alice');
    expect(() => rooms.audio(room, 'alice', media)).toThrow('AUDIO_EXPIRED');
    expect(inspectWav(rooms.audio(room, 'bob', media)).seconds).toBe(0.5);
    expect(room.media.get(media)!.allowed.has('alice')).toBe(false);
    expect(bobEvents.some((event) => event.type === 'reset')).toBe(false);
  });
  it('removes a departed speaker’s cached captions and audio for every remaining listener', async () => {
    rooms.preferences(room, 'alice', { language: 'tr', mode: 'local', audio: true });
    rooms.ingest(room, 'speaker', voice());
    await completed();
    expect(room.listeners.get('alice')!.captions).toHaveLength(1);
    rooms.leave(room, 'speaker');
    expect(rooms.state(room, 'alice').captions).toEqual([]);
    expect(room.media.size).toBe(0);
    expect(
      events.some((event) => event.type === 'reset' && event.data.speakerId === 'speaker'),
    ).toBe(true);
  });
  it('keeps translated captions when the speech engine fails', async () => {
    rooms.preferences(room, 'alice', { language: 'tr', mode: 'local', audio: true });
    local.speak.mockRejectedValue(new Error('model failed'));
    rooms.ingest(room, 'speaker', voice());
    await completed();
    expect(room.listeners.get('alice')!.captions[0]?.text).toBe('Merhaba 42');
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });
  it('never sends a local-only speaker to a cloud engine', async () => {
    rooms.preferences(room, 'alice', { language: 'tr', mode: 'cloud', audio: false });
    rooms.ingest(room, 'speaker', voice());
    await completed();
    expect(cloud.recognize).not.toHaveBeenCalled();
    expect(room.listeners.get('alice')!.captions[0]).toMatchObject({
      mode: 'local',
      fallback: true,
    });
  });
  it.each(['recognize', 'translate', 'speak'] as const)(
    'drops work when consent is revoked during %s',
    async (stage) => {
      rooms.preferences(room, 'alice', { language: 'tr', mode: 'local', audio: true });
      const gate = deferred<string | Buffer>();
      local[stage].mockImplementation(() => gate.promise);
      rooms.ingest(room, 'speaker', voice());
      await vi.waitFor(() => expect(local[stage]).toHaveBeenCalled());
      rooms.consent(room, 'speaker', { local: false, cloud: false, language: 'en' });
      gate.resolve(stage === 'speak' ? voice() : 'Hello');
      await completed();
      expect(room.listeners.get('alice')!.captions).toHaveLength(0);
      expect(room.media.size).toBe(0);
    },
  );
  it('invalidates fetched audio URLs after a preference change, leave and expiry', async () => {
    rooms.preferences(room, 'alice', { language: 'tr', mode: 'local', audio: true });
    rooms.ingest(room, 'speaker', voice());
    await completed();
    const id = room.media.keys().next().value!;
    expect(inspectWav(rooms.audio(room, 'alice', id)).seconds).toBe(0.5);
    expect(() => rooms.audio(room, 'bob', id)).toThrow('AUDIO_EXPIRED');
    rooms.preferences(room, 'alice', { language: 'en', mode: 'local', audio: true });
    expect(() => rooms.audio(room, 'alice', id)).toThrow('AUDIO_EXPIRED');
  });
  it('does not deliver stale work to a listener who switched languages', async () => {
    const gate = deferred<string>();
    local.recognize.mockImplementation(() => gate.promise);
    rooms.ingest(room, 'speaker', voice());
    rooms.preferences(room, 'alice', { language: 'en', mode: 'local', audio: false });
    gate.resolve('Hello');
    await completed();
    expect(room.listeners.get('alice')!.captions).toHaveLength(0);
  });
  it('checks membership again after asynchronous work and drops disconnected rooms', async () => {
    const gate = deferred<string>();
    local.recognize.mockImplementation(() => gate.promise);
    rooms.ingest(room, 'speaker', voice());
    allowed.delete('speaker');
    rooms.stop(room);
    gate.resolve('Hello');
    await vi.waitFor(() => expect(local.translate).not.toHaveBeenCalled());
    expect(room.listeners.size).toBe(0);
    expect(rooms.rooms.size).toBe(0);
  });
  it('stops subsequent cloud stages after the owner disables cloud', async () => {
    rooms.consent(room, 'speaker', { local: true, cloud: true, language: 'en' });
    rooms.preferences(room, 'alice', { language: 'tr', mode: 'cloud', audio: false });
    const gate = deferred<string>();
    cloud.recognize.mockImplementation(() => gate.promise);
    rooms.ingest(room, 'speaker', voice());
    cloudAllowed = false;
    gate.resolve('Hello');
    await completed();
    expect(cloud.translate).not.toHaveBeenCalled();
  });
});
describe('bounded audio and queue', () => {
  it('rejects truncated and long WAVs before model inference', () => {
    expect(() => inspectWav(voice().subarray(0, 60))).toThrow('TRUNCATED_AUDIO');
    expect(() => inspectWav(wav(Buffer.alloc(16000 * 2 * 21)))).toThrow('AUDIO_DURATION_LIMIT');
  });
  it('rotates waiting speakers and rejects an overfull lane', async () => {
    const queue = new FairQueue(2, 8),
      gate = deferred<void>(),
      seen: string[] = [];
    queue.push('a', () => gate.promise);
    queue.push('a', async () => {
      seen.push('a1');
    });
    queue.push('b', async () => {
      seen.push('b1');
    });
    queue.push('a', async () => {
      seen.push('a2');
    });
    expect(() => queue.push('a', async () => {})).toThrow('QUEUE_FULL');
    gate.resolve();
    await vi.waitFor(() => expect(seen).toHaveLength(3));
    expect(seen).toEqual(['a1', 'b1', 'a2']);
  });
});

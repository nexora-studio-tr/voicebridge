import { describe, expect, it, vi } from 'vitest';
import { Rooms } from '../src/core/rooms.js';
import { deferred, engine, voice } from './helpers.js';
import type { Caption, Event } from '../src/core/contracts.js';

function fixture() {
  let clock = 0,
    wall = 100000;
  const local = engine();
  local.recognize.mockImplementation(async () => {
    clock += 20;
    wall -= 10000;
    return 'Hello';
  });
  local.translate.mockImplementation(async () => {
    clock += 30;
    return 'Merhaba';
  });
  local.speak.mockImplementation(async () => {
    clock += 40;
    return voice();
  });
  const rooms = new Rooms(
    local,
    () => local,
    () => true,
    () => false,
    () => wall,
    () => clock,
  );
  const room = rooms.create('g', 'Synthetic', 'c', 'Fixture', 'speaker');
  rooms.addSpeaker(room, 'speaker', 'Synthetic speaker');
  rooms.consent(room, 'speaker', { local: true, cloud: false, language: 'en' });
  rooms.join(room, 'alice', 'Synthetic listener');
  const events: Event[] = [];
  rooms.subscribe(room, 'alice', (e) => events.push(e));
  return {
    local,
    rooms,
    room,
    events,
    advance: (ms: number) => {
      clock += ms;
    },
    caption: () => room.listeners.get('alice')!.captions[0]!,
  };
}
describe('Queue-inclusive monotonic caption timings', () => {
  it('separates queued time and stages while a backward wall clock cannot make latency negative', async () => {
    const f = fixture(),
      gate = deferred<void>();
    f.rooms.queue.push('blocker', () => gate.promise);
    f.rooms.ingest(f.room, 'speaker', voice());
    f.advance(50);
    gate.resolve();
    await vi.waitFor(() => expect(f.caption()).toBeDefined());
    expect(f.caption().timing).toEqual({
      queueMs: 50,
      recognitionMs: 20,
      translationMs: 30,
      captionOverheadMs: 0,
      captionMs: 100,
    });
    expect(f.caption().latencyMs).toBe(100);
    expect(f.local.speak).not.toHaveBeenCalled();
  });
  it('preserves the early caption snapshot and adds audio timing only after synthesis for requesting listeners', async () => {
    const f = fixture(),
      audio = deferred<Buffer>();
    f.rooms.join(f.room, 'bob', 'Text-only');
    f.rooms.subscribe(f.room, 'bob', () => {});
    f.rooms.preferences(f.room, 'alice', { language: 'tr', mode: 'local', audio: true });
    f.local.speak.mockImplementation(() => audio.promise);
    f.rooms.ingest(f.room, 'speaker', voice());
    await vi.waitFor(() => expect(f.caption()).toBeDefined());
    const first = f.events.find((e) => e.type === 'caption') as { type: 'caption'; data: Caption };
    expect(first.data.timing?.audioMs).toBeUndefined();
    f.advance(40);
    audio.resolve(voice());
    await vi.waitFor(() => expect(f.caption().audioUrl).toBeDefined());
    expect(f.caption().timing).toMatchObject({
      captionMs: 50,
      synthesisMs: 40,
      audioMs: 90,
      audioOverheadMs: 0,
    });
    expect(first.data.timing?.audioMs).toBeUndefined();
    expect(f.room.listeners.get('bob')!.captions[0]!.timing?.audioMs).toBeUndefined();
    expect(f.local.speak).toHaveBeenCalledTimes(1);
  });
  it('keeps shared recognition honest and attributes preceding language-group work separately', async () => {
    const f = fixture();
    f.rooms.join(f.room, 'bob', 'Second language');
    f.rooms.subscribe(f.room, 'bob', () => {});
    f.rooms.preferences(f.room, 'alice', { language: 'tr', mode: 'local', audio: true });
    f.rooms.preferences(f.room, 'bob', { language: 'en', mode: 'local', audio: false });
    f.rooms.ingest(f.room, 'speaker', voice());
    await vi.waitFor(() => expect(f.room.listeners.get('bob')!.captions).toHaveLength(1));
    expect(f.local.recognize).toHaveBeenCalledTimes(1);
    const timing = f.room.listeners.get('bob')!.captions[0]!.timing!;
    expect(timing).toEqual({
      queueMs: 0,
      recognitionMs: 20,
      translationMs: 30,
      captionMs: 120,
      captionOverheadMs: 70,
    });
  });
});

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Fault, type Inference, type Language } from '../core/contracts.js';
import type { Rooms, Room } from '../core/rooms.js';

interface RecordedSample {
  sourceLanguage: Language;
  language: Language;
  source: string;
  text: string;
  sourceAudio: string;
  audio: string;
  pipelineMs: number;
}
export class RecordedDemo implements Inference {
  samples: RecordedSample[] = [];
  private files = new Map<string, Buffer>();
  private hashes = new Map<string, RecordedSample>();
  private timers = new Map<string, ReturnType<typeof setTimeout>[]>();
  constructor(root: string) {
    const dir = path.join(root, 'examples/demo');
    try {
      this.samples = JSON.parse(readFileSync(path.join(dir, 'samples.json'), 'utf8'));
      for (const sample of this.samples) {
        for (const p of [sample.audio, sample.sourceAudio]) {
          if (!/^[a-z0-9-]+\.wav$/.test(p)) throw new Error('Invalid fixture');
          this.files.set(p, readFileSync(path.join(dir, p)));
        }
        this.hashes.set(this.digest(this.files.get(sample.sourceAudio)!), sample);
      }
    } catch {
      this.samples = [];
      this.files.clear();
    }
  }
  private digest(b: Buffer) {
    return createHash('sha256').update(b).digest('hex');
  }
  async recognize(audio: Buffer, _language: Language, signal: AbortSignal) {
    if (signal.aborted) throw new Fault('CANCELED');
    const s = this.hashes.get(this.digest(audio));
    if (!s) throw new Fault('RECORDED_DEMO_ONLY');
    return s.source;
  }
  async translate(text: string, from: Language, to: Language, signal: AbortSignal) {
    if (signal.aborted) throw new Fault('CANCELED');
    if (from === to) return text;
    const s = this.samples.find(
      (s) => s.source === text && s.sourceLanguage === from && s.language === to,
    );
    if (!s) throw new Fault('RECORDED_DEMO_ONLY');
    return s.text;
  }
  async speak(text: string, language: Language, signal: AbortSignal) {
    if (signal.aborted) throw new Fault('CANCELED');
    const s = this.samples.find(
      (s) =>
        (s.source === text && s.sourceLanguage === language) ||
        (s.text === text && s.language === language),
    );
    if (!s) throw new Fault('RECORDED_DEMO_ONLY');
    return this.files.get(
      s.source === text && s.sourceLanguage === language ? s.sourceAudio : s.audio,
    )!;
  }
  play(rooms: Rooms, room: Room) {
    this.stop(room.id);
    if (!this.samples.length) throw new Fault('DEMO_NOT_PREPARED', 503);
    const timers = this.samples.map((sample, i) =>
      setTimeout(
        () => {
          if (room.active)
            rooms.ingest(
              room,
              sample.sourceLanguage === 'tr' ? 'sample-ece' : 'sample-deniz',
              this.files.get(sample.sourceAudio)!,
            );
        },
        i * 4500 + 200,
      ),
    );
    this.timers.set(room.id, timers);
  }
  stop(roomId: string) {
    for (const t of this.timers.get(roomId) ?? []) clearTimeout(t);
    this.timers.delete(roomId);
  }
  close() {
    for (const id of this.timers.keys()) this.stop(id);
  }
}

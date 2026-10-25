import { Fault } from './contracts.js';

export function wav(pcm: Buffer, rate = 16000) {
  const h = Buffer.alloc(44);
  h.write('RIFF');
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
export function inspectWav(b: Buffer) {
  if (
    b.length < 44 ||
    b.length > 4 * 1024 * 1024 ||
    b.toString('ascii', 0, 4) !== 'RIFF' ||
    b.toString('ascii', 8, 12) !== 'WAVE'
  )
    throw new Fault('INVALID_AUDIO');
  let rate = 0,
    channels = 0,
    bits = 0,
    data: Buffer | undefined;
  for (let p = 12; p + 8 <= b.length;) {
    const kind = b.toString('ascii', p, p + 4),
      size = b.readUInt32LE(p + 4),
      start = p + 8;
    if (start + size > b.length) throw new Fault('TRUNCATED_AUDIO');
    if (kind === 'fmt ') {
      if (size < 16 || b.readUInt16LE(start) !== 1) throw new Fault('UNSUPPORTED_AUDIO');
      channels = b.readUInt16LE(start + 2);
      rate = b.readUInt32LE(start + 4);
      bits = b.readUInt16LE(start + 14);
    }
    if (kind === 'data') data = b.subarray(start, start + size);
    p = start + size + (size % 2);
  }
  if (
    !data ||
    channels !== 1 ||
    bits !== 16 ||
    ![16000, 22050, 24000, 44100, 48000].includes(rate) ||
    data.length % 2
  )
    throw new Fault('UNSUPPORTED_AUDIO');
  const seconds = data.length / (rate * 2);
  if (seconds <= 0 || seconds > 20) throw new Fault('AUDIO_DURATION_LIMIT');
  let sum = 0;
  for (let i = 0; i < data.length; i += 2) sum += (data.readInt16LE(i) / 32768) ** 2;
  return { data, rate, seconds, rms: Math.sqrt(sum / (data.length / 2)) };
}

export class FairQueue {
  private lanes = new Map<string, (() => Promise<void>)[]>();
  private running = false;
  constructor(
    private maxPerLane = 2,
    private maxTotal = 8,
  ) {}
  get length() {
    return [...this.lanes.values()].reduce((a, b) => a + b.length, 0);
  }
  push(lane: string, task: () => Promise<void>) {
    const items = this.lanes.get(lane) ?? [];
    if (items.length >= this.maxPerLane || this.length >= this.maxTotal)
      throw new Fault('QUEUE_FULL', 429);
    items.push(task);
    this.lanes.set(lane, items);
    void this.pump();
  }
  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.lanes.size) {
        const [key, items] = this.lanes.entries().next().value!;
        const task = items.shift()!;
        this.lanes.delete(key);
        if (items.length) this.lanes.set(key, items);
        try {
          await task();
        } catch {
          /* Each task reports a content-free failure to its own listeners. */
        }
      }
    } finally {
      this.running = false;
    }
  }
}

import { describe, expect, it } from 'vitest';
import { UtteranceBuffer } from '../src/core/audio.js';

const frame = (value = 2000) => {
  const pcm = Buffer.alloc(640);
  for (let p = 0; p < pcm.length; p += 2) pcm.writeInt16LE(value, p);
  return pcm;
};
describe('utterance boundaries', () => {
  it('preserves English speech past the former six-second word cut', () => {
    const buffer = new UtteranceBuffer('en');
    for (let i = 0; i < 400; i++) expect(buffer.push(frame())).toBeNull();
    expect(buffer.finish()?.length).toBe(8 * 32000);
    expect(buffer.silenceMs).toBe(900);
  });
  it('emits at a quiet boundary after six seconds rather than at a voiced frame', () => {
    const buffer = new UtteranceBuffer('en');
    for (let i = 0; i < 310; i++) expect(buffer.push(frame())).toBeNull();
    for (let i = 0; i < 7; i++) expect(buffer.push(frame(0))).toBeNull();
    const audio = buffer.push(frame(0));
    expect(audio?.length).toBe(318 * 640);
    expect(buffer.finish()).toBeNull();
  });
  it('bounds continuous English while preserving every sample in order exactly once', () => {
    const buffer = new UtteranceBuffer('en'),
      inputs: Buffer[] = [],
      outputs: Buffer[] = [];
    for (let i = 0; i < 950; i++) {
      const input = frame(1000 + i);
      inputs.push(input);
      const output = buffer.push(input);
      if (output) outputs.push(output);
      expect(buffer.length).toBeLessThanOrEqual(12 * 32000);
    }
    const tail = buffer.finish();
    if (tail) outputs.push(tail);
    expect(outputs.every((b) => b.length <= 12 * 32000)).toBe(true);
    expect(Buffer.concat(outputs)).toEqual(Buffer.concat(inputs));
  });
  it('keeps the existing Turkish six-second profile', () => {
    const buffer = new UtteranceBuffer('tr');
    for (let i = 0; i < 300; i++) expect(buffer.push(frame())).toBeNull();
    expect(buffer.push(frame())?.length).toBe(6 * 32000);
    expect(buffer.finish()?.length).toBe(640);
    expect(buffer.silenceMs).toBe(450);
  });
  it('clears all buffered speech when a speaker is interrupted', () => {
    const buffer = new UtteranceBuffer('en');
    buffer.push(frame());
    buffer.clear();
    expect(buffer.length).toBe(0);
    expect(buffer.finish()).toBeNull();
    expect(buffer.push(Buffer.alloc(0))).toBeNull();
    expect(() => buffer.push(Buffer.alloc(3))).toThrow();
    expect(() => buffer.push(Buffer.alloc(12 * 32000 + 2))).toThrow();
  });
});

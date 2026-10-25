import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { vi } from 'vitest';
import { wav } from '../src/core/audio.js';
import type { Inference } from '../src/core/contracts.js';
export const signal = () => new AbortController().signal;
export function temporary() {
  const base = path.resolve('artifacts/tests');
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(path.join(base, 'case-'));
  return {
    root,
    remove: () => {
      if (!root.startsWith(base + path.sep)) throw new Error('Invalid cleanup path');
      rmSync(root, { recursive: true, force: true });
    },
  };
}
export function voice() {
  const pcm = Buffer.alloc(16000);
  for (let i = 0; i < pcm.length / 2; i++)
    pcm.writeInt16LE(Math.round(Math.sin(i / 7) * 5000), i * 2);
  return wav(pcm);
}
export function engine(): Inference & {
  recognize: ReturnType<typeof vi.fn>;
  translate: ReturnType<typeof vi.fn>;
  speak: ReturnType<typeof vi.fn>;
} {
  return {
    recognize: vi.fn(async () => 'Hello 42'),
    translate: vi.fn(async (text: string, from: string, to: string) =>
      from === to ? text : 'Merhaba 42',
    ),
    speak: vi.fn(async () => voice()),
  };
}
export function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

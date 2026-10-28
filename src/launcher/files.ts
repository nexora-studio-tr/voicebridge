import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, realpath, rename, writeFile } from 'node:fs/promises';
import { finished } from 'node:stream/promises';

// Never follow a junction/symlink into another project, model store or user profile.
export async function inside(root: string, relative: string) {
  if (!relative || relative.includes('\0') || path.isAbsolute(relative)) throw Error('UNSAFE_PATH');
  const base = await realpath(root);
  const target = path.resolve(base, relative);
  const rel = path.relative(base, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw Error('UNSAFE_PATH');
  let current = base;
  for (const part of rel.split(path.sep)) {
    current = path.join(current, part);
    const stat = await lstat(current).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return null;
      throw e;
    });
    if (stat?.isSymbolicLink()) throw Error('UNSAFE_PATH');
  }
  return target;
}
export async function sha256(file: string) {
  const hash = createHash('sha256');
  const stream = createReadStream(file);
  for await (const chunk of stream) hash.update(chunk);
  await finished(stream);
  return hash.digest('hex');
}
export async function atomicJson(root: string, relative: string, value: unknown) {
  const target = await inside(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = await inside(root, relative + '.tmp');
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, target);
}

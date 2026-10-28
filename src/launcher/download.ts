import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { inside, sha256 } from './files.js';

export interface DownloadSpec {
  url: string;
  bytes: number;
  sha256: string;
}
export async function download(
  root: string,
  name: string,
  spec: DownloadSpec,
  signal: AbortSignal,
  progress: (bytes: number) => void = () => {},
  transport: typeof fetch = fetch,
) {
  signal.throwIfAborted();
  const url = new URL(spec.url);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.username ||
    url.password ||
    !Number.isSafeInteger(spec.bytes) ||
    spec.bytes < 1 ||
    spec.bytes > 150_000_000 ||
    !/^[a-f0-9]{64}$/.test(spec.sha256)
  )
    throw Error('UNTRUSTED_RUNTIME');
  const target = await inside(root, name),
    partial = await inside(root, name + '.partial');
  await mkdir(path.dirname(target), { recursive: true });
  if (
    (await stat(target).catch(() => null))?.size === spec.bytes &&
    (await sha256(target)) === spec.sha256
  )
    return target;
  let offset = (await stat(partial).catch(() => null))?.size ?? 0;
  if (offset > spec.bytes) {
    await unlink(partial);
    offset = 0;
  }
  if (offset < spec.bytes) {
    const transferSignal = AbortSignal.any([signal, AbortSignal.timeout(600_000)]);
    let destination = url;
    let response: Response | undefined;
    for (let redirects = 0; redirects <= 4; redirects++) {
      response = await transport(destination, {
        headers: offset
          ? { Range: `bytes=${offset}-`, 'Accept-Encoding': 'identity' }
          : { 'Accept-Encoding': 'identity' },
        signal: transferSignal,
        redirect: 'manual',
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || redirects === 4) throw Error('DOWNLOAD_REDIRECT');
      destination = new URL(location, destination);
      if (
        destination.protocol !== 'https:' ||
        destination.username ||
        destination.password ||
        ![
          'github.com',
          'release-assets.githubusercontent.com',
          'objects.githubusercontent.com',
        ].includes(destination.hostname)
      )
        throw Error('DOWNLOAD_REDIRECT');
    }
    if (!response || (response.status !== 200 && response.status !== 206)) {
      await response?.body?.cancel();
      throw Error('DOWNLOAD_FAILED');
    }
    if (!response.body) throw Error('DOWNLOAD_FAILED');
    if (response.status === 206) {
      const range = response.headers.get('content-range');
      if (range !== `bytes ${offset}-${spec.bytes - 1}/${spec.bytes}`) {
        await response.body.cancel();
        throw Error('INVALID_RANGE');
      }
    } else offset = 0; // A server ignoring Range must replace, never append.
    let received = offset;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > spec.bytes) return callback(Error('DOWNLOAD_TOO_LARGE'));
        progress(received);
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
      limiter,
      createWriteStream(partial, { flags: offset ? 'a' : 'w', mode: 0o600 }),
      { signal: transferSignal },
    );
  }
  if ((await stat(partial)).size !== spec.bytes) throw Error('DOWNLOAD_INCOMPLETE');
  if ((await sha256(partial)) !== spec.sha256) {
    await unlink(partial); // Only the verified, contained, generated partial file.
    throw Error('DOWNLOAD_INTEGRITY');
  }
  signal.throwIfAborted();
  await rename(partial, target);
  return target;
}

export const fingerprint = (text: string) => createHash('sha256').update(text).digest('hex');

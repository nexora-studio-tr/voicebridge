import path from 'node:path';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { createLauncherServer } from './server.js';
import { WindowsInstaller } from './installer.js';
import { inside } from './files.js';
import { VERSION } from '../core/contracts.js';

// The shipped entry point has no fixture, arbitrary command or alternate download-source mode.
const root = path.resolve(import.meta.dirname, '../../..');
if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('WINDOWS_X64_REQUIRED');
await mkdir(await inside(root, '.installer'), { recursive: true });
const lock = await inside(root, '.installer/launcher.lock');
let handle;
try {
  handle = await open(lock, 'wx', 0o600);
} catch {
  const existing = z
    .object({
      app: z.literal('voicebridge-launcher'),
      pid: z.number().int().positive(),
      port: z.number().int().min(1024).max(65535),
      token: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .passthrough()
    .parse(JSON.parse(await readFile(lock, 'utf8')));
  let alive = false;
  try {
    process.kill(existing.pid, 0);
    alive = true;
  } catch {}
  if (alive) {
    const response = await fetch(`http://127.0.0.1:${existing.port}/healthz`, {
      signal: AbortSignal.timeout(2000),
    });
    const health = (await response.json()) as { app?: string; version?: string };
    if (health.app !== 'voicebridge-launcher' || health.version !== VERSION)
      throw Error('LAUNCHER_ALREADY_RUNNING');
    console.log(`READY http://127.0.0.1:${existing.port}/install#setup=${existing.token}`);
    process.exit(0);
  }
  await unlink(lock);
  handle = await open(lock, 'wx', 0o600);
}
const token = randomBytes(32).toString('hex');
const installer = new WindowsInstaller(root);
let closing = false;
const service = await createLauncherServer({
  webRoot: path.join(root, 'app/dist/web'),
  token,
  installer,
  quit: () => void close(),
});
async function close() {
  if (closing) return;
  closing = true;
  await installer.stop();
  await service.app.close();
  await unlink(lock).catch(() => {});
  process.exit(0);
}
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
try {
  const origin = await service.app.listen({ host: '127.0.0.1', port: 0 });
  service.setOrigin(origin);
  const port = Number(new URL(origin).port);
  await handle.writeFile(
    JSON.stringify({
      app: 'voicebridge-launcher',
      version: VERSION,
      pid: process.pid,
      port,
      token,
    }),
  );
  await handle.close();
  process.stdout.on('error', () => {});
  console.log(`READY ${origin}/install#setup=${token}`);
} catch {
  await handle.close().catch(() => {});
  await unlink(lock).catch(() => {});
  process.exit(1);
}

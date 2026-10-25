import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { createServer } from './app.js';
const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const demo = process.argv.includes('--demo'),
  port = Number(process.env.PORT ?? (demo ? 4348 : 4347));
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
const origin = process.env.PUBLIC_URL ?? `http://127.0.0.1:${port}`;
const dataDir = path.resolve(
  process.env.VOICEBRIDGE_DATA ?? path.join(root, demo ? '.voicebridge-demo' : '.voicebridge'),
);
await mkdir(dataDir, { recursive: true, mode: 0o700 });
const lock = path.join(dataDir, 'server.lock');
try {
  const f = await open(lock, 'wx', 0o600);
  await f.writeFile(JSON.stringify({ app: 'voicebridge', pid: process.pid }));
  await f.close();
} catch {
  const previous = JSON.parse(await readFile(lock, 'utf8')) as { app: string; pid: number };
  if (previous.app !== 'voicebridge' || !Number.isInteger(previous.pid))
    throw new Error('Unrecognized lock file');
  let alive = false;
  try {
    process.kill(previous.pid, 0);
    alive = true;
  } catch {}
  if (alive) throw new Error('Another VoiceBridge process owns this data directory');
  await unlink(lock);
  const f = await open(lock, 'wx', 0o600);
  await f.writeFile(JSON.stringify({ app: 'voicebridge', pid: process.pid }));
  await f.close();
}
const workerPort = Number(process.env.VOICEBRIDGE_WORKER_PORT ?? 4351);
if (!Number.isInteger(workerPort) || workerPort < 1024 || workerPort > 65535)
  throw new Error('Invalid worker port');
const service = await createServer({ root, dataDir, origin, demo, workerPort });
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await service.app.close();
  await unlink(lock).catch(() => {});
  process.exit(0);
};
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
try {
  await service.app.listen({ host: process.env.LISTEN_HOST ?? '127.0.0.1', port });
  console.log(`VoiceBridge ${demo ? 'recorded demo' : 'operator'}: ${origin}`);
  if (service.operatorUrl)
    console.log('Private operator link is in ' + path.join(dataDir, 'operator-link'));
} catch (e) {
  await service.app.close();
  await unlink(lock).catch(() => {});
  throw e;
}

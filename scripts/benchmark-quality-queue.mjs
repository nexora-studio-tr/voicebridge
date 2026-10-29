// Actual loopback worker + Rooms queue, synthetic fixtures only. No Discord/config store.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalWorker } from '../dist/server/local.js';
import { Rooms } from '../dist/core/rooms.js';
import { root, python, run } from './runtime.mjs';

const [fixtureSet = 'baseline-v1', reportName = 'alpha7-baseline'] = process.argv.slice(2);
if (![fixtureSet, reportName].every((s) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(s)))
  throw new Error('Invalid artifact name');
const directory = path.join(root, 'artifacts/quality-fixtures', fixtureSet);
const out = path.join(root, 'artifacts/quality-baseline', reportName, 'queue.json');
if (existsSync(out)) throw new Error('Queue report already exists; use a new report name');
run(python, [
  path.join(root, 'scripts/benchmark_quality.py'),
  'prepare',
  '--fixture-set',
  fixtureSet,
]);
const manifest = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
const references = JSON.parse(
  readFileSync(path.join(root, 'examples/quality/corpus.json'), 'utf8'),
);
const sources = ['en-01', 'tr-21', 'en-12'];
const fixtures = sources.map((sourceId) => {
  const fixture = manifest.samples.find((r) => r.sourceId === sourceId && r.condition === 'clean');
  if (!fixture || fixture.error) throw new Error('Required synthetic fixture unavailable');
  const audio = readFileSync(path.join(directory, fixture.file));
  if (createHash('sha256').update(audio).digest('hex') !== fixture.audioSha256)
    throw new Error('Synthetic fixture hash mismatch');
  return { ...fixture, audio };
});
const data = path.resolve(process.env.VOICEBRIDGE_DATA ?? path.join(root, '.voicebridge'));
const worker = new LocalWorker(root, data, 4382);
let rooms;
try {
  worker.start();
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if ((await worker.status()).ready) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error('Local worker/models not ready');
  const signal = new AbortController().signal;
  const warmStart = performance.now();
  for (const language of ['en', 'tr']) {
    const source = fixtures.find((f) => f.sourceId.startsWith(language));
    await worker.recognize(source.audio, language, signal);
    const text = references.cases[0].text[language];
    const target = language === 'en' ? 'tr' : 'en';
    const translated = await worker.translate(text, language, target, signal);
    await worker.speak(translated, target, signal);
  }
  const warmupMs = Math.round(performance.now() - warmStart);
  const allowed = new Set(['listener', 'speaker-0', 'speaker-1', 'speaker-2']);
  rooms = new Rooms(
    worker,
    () => {
      throw new Error('Cloud disabled for synthetic queue measurement');
    },
    (_room, id) => allowed.has(id),
    () => false,
  );
  const room = rooms.create(
    'synthetic',
    'Quality queue fixture',
    'voice',
    'Offline test',
    'listener',
  );
  rooms.join(room, 'listener', 'Synthetic listener');
  rooms.preferences(room, 'listener', { language: 'tr', mode: 'local', audio: true });
  const captured = new Map();
  const errors = [];
  const started = performance.now();
  rooms.subscribe(room, 'listener', (event) => {
    if (event.type === 'caption' && event.data.audioUrl)
      captured.set(event.data.speakerId, {
        ...event.data,
        observedAudioMs: Math.round(performance.now() - started),
      });
    if (event.type === 'error') errors.push(String(event.data.code));
  });
  for (const [i, fixture] of fixtures.entries()) {
    const id = 'speaker-' + i;
    rooms.addSpeaker(room, id, id);
    rooms.consent(room, id, { local: true, cloud: false, language: fixture.sourceId.slice(0, 2) });
    rooms.ingest(room, id, fixture.audio);
  }
  const deadline = Date.now() + 180_000;
  while (captured.size < 3 && !errors.length && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 100));
  const samples = fixtures.map((fixture, i) => {
    const caption = captured.get('speaker-' + i);
    let speechBytes = 0;
    if (caption?.audioUrl) {
      speechBytes = rooms.audio(room, 'listener', caption.audioUrl.split('/').at(-1)).length;
    }
    return {
      sourceId: fixture.sourceId,
      audioSha256: fixture.audioSha256,
      timing: caption?.timing ?? null,
      observedAudioMs: caption?.observedAudioMs ?? null,
      speechBytes,
    };
  });
  const passed =
    captured.size === 3 &&
    errors.length === 0 &&
    samples.every((s) => s.timing && s.speechBytes > 1000);
  const report = {
    schemaVersion: 1,
    status: passed ? 'completed' : 'failed',
    synthetic: true,
    liveDiscord: false,
    paidApi: false,
    network: 'authenticated-loopback-only',
    fixtureSetSha256: manifest.fixtureSetSha256,
    engineSha256: createHash('sha256')
      .update(readFileSync(path.join(root, 'worker/engine.py')))
      .digest('hex'),
    host: {
      os: os.platform(),
      cpu: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length,
      memoryGiB: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
    },
    warmupMs,
    scope:
      'Three queued synthetic utterances, one listener, target Turkish. Separate queue/recognition/translation/synthesis clocks from actual Rooms events. Not live latency, throughput or p95 capacity evidence. Capture, Discord and browser playback excluded.',
    samples,
    errors,
  };
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  if (!passed) process.exitCode = 1;
} finally {
  rooms?.stopAll();
  worker.stop();
}

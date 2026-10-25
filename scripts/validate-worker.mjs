import { LocalWorker } from '../dist/server/local.js';
import { Rooms } from '../dist/core/rooms.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { root } from './runtime.mjs';
const data = path.resolve(process.env.VOICEBRIDGE_DATA ?? path.join(root, '.voicebridge'));
const worker = new LocalWorker(root, data, 4381),
  out = path.join(root, 'artifacts/worker');
mkdirSync(out, { recursive: true });
const samples = JSON.parse(readFileSync(path.join(root, 'examples/demo/samples.json'), 'utf8'));
const origin = 'http://127.0.0.1:4381';
try {
  worker.start();
  let ready = false;
  for (let i = 0; i < 50; i++) {
    const health = await worker.status();
    if (health.ready) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) throw new Error('Local worker/models are not ready');
  const unauthorized = await fetch(origin + '/healthz');
  if (unauthorized.status !== 401) throw new Error('Worker authentication failed');
  const signal = new AbortController().signal;
  // Warm model loading is reported separately; this does not imply warm end-to-end latency.
  const warmStart = performance.now();
  await worker.recognize(
    readFileSync(path.join(root, 'examples/demo', samples[0].sourceAudio)),
    'en',
    signal,
  );
  await worker.translate('Please open the document.', 'en', 'tr', signal);
  await worker.speak('Lütfen belgeyi açın.', 'tr', signal);
  const warmupMs = Math.round(performance.now() - warmStart);
  const allowed = new Set(['listener', 'speaker-0', 'speaker-1', 'speaker-2']);
  const rooms = new Rooms(
      worker,
      () => {
        throw new Error('Cloud must not be used in this test');
      },
      (_r, id) => allowed.has(id),
      () => false,
    ),
    room = rooms.create('synthetic', 'Synthetic worker test', 'voice', 'CPU test', 'listener');
  rooms.join(room, 'listener', 'Listener');
  rooms.preferences(room, 'listener', { language: 'tr', mode: 'local', audio: true });
  const captured = new Map(),
    errors = [],
    started = performance.now();
  rooms.subscribe(room, 'listener', (event) => {
    if (event.type === 'caption' && event.data.audioUrl)
      captured.set(event.data.id, {
        ...event.data,
        audioEndToEndMs: Math.round(performance.now() - started),
      });
    else if (event.type === 'error') errors.push(event.data.code);
  });
  for (let i = 0; i < 3; i++) {
    const sample = samples[i],
      id = 'speaker-' + i;
    rooms.addSpeaker(room, id, id);
    rooms.consent(room, id, { local: true, cloud: false, language: sample.sourceLanguage });
    rooms.ingest(room, id, readFileSync(path.join(root, 'examples/demo', sample.sourceAudio)));
  }
  const deadline = Date.now() + 90000;
  while (captured.size < 3 && !errors.length && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 100));
  if (captured.size !== 3 || errors.length)
    throw new Error('Synthetic three-speaker pipeline failed: ' + errors.join(','));
  for (const sample of captured.values()) {
    const id = sample.audioUrl.split('/').at(-1);
    if (rooms.audio(room, 'listener', id).length < 1000) throw new Error('Empty speech output');
  }
  const report = {
    status: 'passed',
    synthetic: true,
    network: 'loopback-only',
    liveDiscord: false,
    paidApi: false,
    warmupMs,
    host: {
      os: os.platform(),
      cpu: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length,
      memoryGiB: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
    },
    scope:
      'Three queued synthetic utterances, one listener, one target language. Not a live-call benchmark or p95 capacity claim.',
    samples: [...captured.values()].map(({ speakerId, latencyMs, audioEndToEndMs, text }) => ({
      speakerId,
      captionMs: latencyMs,
      audioEndToEndMs,
      text,
    })),
  };
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  rooms.stopAll();
  console.log(JSON.stringify(report));
} finally {
  worker.stop();
}

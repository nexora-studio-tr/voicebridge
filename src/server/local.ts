import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { Fault, type Inference, type Language } from '../core/contracts.js';

export class LocalWorker implements Inference {
  private child: ChildProcess | null = null;
  private secret = randomBytes(32).toString('hex');
  constructor(
    private root: string,
    private dataDir: string,
    private port = 4351,
  ) {}
  start() {
    const python =
      process.env.VOICEBRIDGE_PYTHON ??
      path.join(
        this.root,
        '.venv',
        process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
      );
    if (!existsSync(python)) return;
    this.child = spawn(python, [path.join(this.root, 'worker/server.py')], {
      cwd: this.root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        VOICEBRIDGE_WORKER_TOKEN: this.secret,
        VOICEBRIDGE_WORKER_PORT: String(this.port),
        VOICEBRIDGE_MODELS: path.join(this.dataDir, 'models'),
        HF_HUB_OFFLINE: '1',
        HF_HUB_DISABLE_IMPLICIT_TOKEN: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    });
    // The transport logs only fixed status/error kinds, never request content.
    this.child.on('error', () => {});
    this.child.on('exit', () => {
      this.child = null;
    });
    this.child.stdout?.on('data', () => {});
    this.child.stderr?.on('data', () => {});
  }
  stop() {
    this.child?.kill();
    this.child = null;
  }
  private async request(operation: string, body: unknown, signal?: AbortSignal) {
    try {
      const response = await fetch(`http://127.0.0.1:${this.port}/${operation}`, {
        method: body === null ? 'GET' : 'POST',
        headers: {
          authorization: 'Bearer ' + this.secret,
          ...(body === null ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === null ? {} : { body: JSON.stringify(body) }),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
          : AbortSignal.timeout(3000),
      });
      if (!response.ok)
        throw new Fault(response.status === 429 ? 'WORKER_BUSY' : 'LOCAL_INFERENCE_FAILED', 503);
      const data = await response.json();
      return data;
    } catch (e) {
      if (e instanceof Fault) throw e;
      throw new Fault(signal?.aborted ? 'CANCELED' : 'LOCAL_WORKER_UNAVAILABLE', 503);
    }
  }
  async status() {
    try {
      return await this.request('healthz', null);
    } catch {
      return { ready: false, missing: [], device: 'cpu', error: 'LOCAL_WORKER_UNAVAILABLE' };
    }
  }
  async recognize(wav: Buffer, language: Language, signal: AbortSignal) {
    return z
      .object({ text: z.string().max(1200) })
      .parse(await this.request('recognize', { audio: wav.toString('base64'), language }, signal))
      .text;
  }
  async translate(text: string, source: Language, target: Language, signal: AbortSignal) {
    return z
      .object({ text: z.string().max(1200) })
      .parse(await this.request('translate', { text, source, target }, signal)).text;
  }
  async speak(text: string, language: Language, signal: AbortSignal) {
    const result = z
      .object({ audio: z.string().max(6_000_000) })
      .parse(await this.request('speak', { text, language }, signal));
    return Buffer.from(result.audio, 'base64');
  }
}

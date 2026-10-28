import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readFile, stat, statfs, mkdtemp, rename } from 'node:fs/promises';
import { extract } from 'tar';
import { VERSION } from '../core/contracts.js';
import type { Installer, LauncherStatus, InstallPhase } from './contracts.js';
import { atomicJson, inside, sha256 } from './files.js';
import { download, fingerprint, type DownloadSpec } from './download.js';
import { createServer as createNetServer } from 'node:net';
import { z } from 'zod';

export async function freePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(Error('PORT_UNAVAILABLE'));
      server.close(() => resolve(address.port));
    });
  });
}
export function cleanEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'LOCALAPPDATA',
    'USERPROFILE',
    'COMSPEC',
    'PATHEXT',
  ])
    if (process.env[key]) env[key] = process.env[key];
  env.PATH =
    path.dirname(process.execPath) +
    path.delimiter +
    path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  env.PYTHONIOENCODING = 'utf-8';
  env.PYTHONNOUSERSITE = '1';
  env.PIP_DISABLE_PIP_VERSION_CHECK = '1';
  return env;
}
export class WindowsInstaller implements Installer {
  status: LauncherStatus = { version: VERSION, state: 'idle', phase: 'package' };
  private abort: AbortController | null = null;
  private application: ChildProcess | null = null;
  private preparation: Promise<void> | null = null;
  constructor(readonly root: string) {}
  private phase(phase: InstallPhase) {
    this.status = {
      version: VERSION,
      state: 'installing',
      phase,
      freeBytes: this.status.freeBytes,
    };
  }
  private async run(command: string, args: string[], signal?: AbortSignal, events = false) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: path.join(this.root, 'app'),
        windowsHide: true,
        env: cleanEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const abort = () => {
        if (child.exitCode !== null || !child.pid) return;
        if (process.platform === 'win32') {
          // Terminate only this install step and its children, including venv's ensurepip.
          const kill = spawn(
            path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'),
            ['/PID', String(child.pid), '/T', '/F'],
            { windowsHide: true, stdio: 'ignore' },
          );
          kill.once('error', () => child.kill());
        } else child.kill();
      };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      let buffered = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        if (!events) return;
        buffered = (buffered + chunk.toString()).slice(-10000);
        const lines = buffered.split(/\r?\n/);
        buffered = lines.pop() || '';
        for (const line of lines) {
          try {
            const event = JSON.parse(line) as {
              type?: string;
              file?: string;
              bytes?: number;
              total?: number;
            };
            if (
              event.type === 'download' &&
              typeof event.file === 'string' &&
              /^[a-zA-Z0-9/_.-]{1,160}$/.test(event.file)
            )
              Object.assign(this.status, {
                file: event.file,
                bytes: event.bytes,
                total: event.total,
              });
          } catch {
            /* Human pip/model output is deliberately not exposed to the browser. */
          }
        }
      });
      child.stderr?.on('data', () => {});
      let failure: Error | undefined;
      child.once('error', (error) => {
        failure = error;
      });
      child.once('close', (code) => {
        signal?.removeEventListener('abort', abort);
        code === 0 && !signal?.aborted ? resolve() : reject(failure || Error('STEP_FAILED'));
      });
    });
  }
  private async verifyPackage() {
    const manifest = JSON.parse(
      await readFile(await inside(this.root, 'PACKAGE_MANIFEST.json'), 'utf8'),
    ) as Record<string, string>;
    if (
      !manifest['runtime/node.exe'] ||
      !manifest['app/dist/launcher/main.js'] ||
      !manifest['app/worker/requirements.lock']
    )
      throw Error('PACKAGE_INTEGRITY');
    for (const [name, digest] of Object.entries(manifest)) {
      if (
        !/^[a-f0-9]{64}$/.test(digest) ||
        (await sha256(await inside(this.root, name))) !== digest
      )
        throw Error('PACKAGE_INTEGRITY');
    }
  }
  private async python(signal: AbortSignal) {
    const lock = JSON.parse(
      await readFile(await inside(this.root, 'app/launcher/runtime-lock.json'), 'utf8'),
    ) as { python: DownloadSpec & { version: string } };
    const target = await inside(this.root, 'runtime/python/python.exe');
    const marker = await inside(this.root, '.installer/python.json');
    const installed = JSON.parse(await readFile(marker, 'utf8').catch(() => '{}')) as {
      archive?: string;
      exe?: string;
    };
    if (
      installed.archive === lock.python.sha256 &&
      installed.exe &&
      (await sha256(target).catch(() => '')) === installed.exe
    )
      return target;
    const archive = await download(
      this.root,
      '.installer/python.tar.gz',
      lock.python,
      signal,
      (bytes) => {
        Object.assign(this.status, {
          file: 'Python ' + lock.python.version,
          bytes,
          total: lock.python.bytes,
        });
      },
    );
    const temporary = await mkdtemp(await inside(this.root, '.installer/python-extract-'));
    let entries = 0,
      total = 0;
    await extract({
      file: archive,
      cwd: temporary,
      strict: true,
      noChmod: true,
      noMtime: true,
      filter: (name, entry) => {
        const parts = name.replace(/\/$/, '').split('/');
        if (
          ++entries > 20000 ||
          !('type' in entry) ||
          !['File', 'Directory'].includes(entry.type) ||
          parts[0] !== 'python' ||
          parts.some(
            (part) => !part || part === '..' || part.includes('\\') || part.includes(':'),
          ) ||
          name.startsWith('/')
        )
          throw Error('UNSAFE_ARCHIVE');
        total += entry.size;
        if (total > 600_000_000) throw Error('UNSAFE_ARCHIVE');
        signal.throwIfAborted();
        return true;
      },
    });
    signal.throwIfAborted();
    const destination = await inside(this.root, 'runtime/python');
    if (await stat(destination).catch(() => null)) {
      // Preserve an interrupted/modified runtime; never remove user data or models.
      await rename(
        destination,
        await inside(this.root, `.installer/previous-python-${Date.now()}`),
      );
    }
    await rename(path.join(temporary, 'python'), destination);
    await atomicJson(this.root, '.installer/python.json', {
      archive: lock.python.sha256,
      exe: await sha256(target),
    });
    return target;
  }
  prepare() {
    if (this.preparation || this.application) return Promise.reject(Error('INSTALL_BUSY'));
    this.preparation = this.prepareSteps().finally(() => {
      this.preparation = null;
    });
    return this.preparation;
  }
  private async prepareSteps() {
    this.abort = new AbortController();
    const signal = this.abort.signal;
    try {
      this.phase('package');
      const disk = await statfs(this.root);
      this.status.freeBytes = disk.bavail * disk.bsize;
      const priorModels = await stat(await inside(this.root, 'data/models/installed.json')).catch(
        () => null,
      );
      if (this.status.freeBytes < (priorModels ? 512 * 1024 ** 2 : 6 * 1024 ** 3))
        throw Error('DISK_SPACE');
      await this.verifyPackage();
      await mkdir(await inside(this.root, '.installer'), { recursive: true });
      this.phase('python');
      const base = await this.python(signal);
      this.phase('environment');
      const python = await inside(this.root, 'app/.venv/Scripts/python.exe');
      await this.run(base, ['-m', 'venv', '--copies', '--upgrade', '.venv'], signal);
      await this.run(python, ['-c', 'import sys; assert sys.version_info[:2] == (3,12)'], signal);
      this.phase('dependencies');
      const requirements = await readFile(
        await inside(this.root, 'app/worker/requirements.lock'),
        'utf8',
      );
      const wanted = fingerprint(requirements);
      const marker = JSON.parse(
        await readFile(await inside(this.root, '.installer/dependencies.json'), 'utf8').catch(
          () => '{}',
        ),
      ) as { sha256?: string };
      let repair = false;
      if (marker.sha256 === wanted) {
        try {
          await this.run(
            python,
            ['-c', 'import numpy, faster_whisper, ctranslate2, onnxruntime, piper, sentencepiece'],
            signal,
          );
        } catch {
          signal.throwIfAborted();
          repair = true;
        }
      }
      if (marker.sha256 !== wanted || repair) {
        await this.run(
          python,
          [
            '-m',
            'pip',
            '--isolated',
            'install',
            '--only-binary=:all:',
            '--require-virtualenv',
            '--disable-pip-version-check',
            '--no-input',
            '--cache-dir',
            await inside(this.root, '.installer/pip-cache'),
            ...(repair ? ['--force-reinstall'] : []),
            '-r',
            'worker/requirements.lock',
          ],
          signal,
        );
        await atomicJson(this.root, '.installer/dependencies.json', { sha256: wanted });
      }
      await this.run(
        python,
        ['-c', 'import numpy, faster_whisper, ctranslate2, onnxruntime, piper, sentencepiece'],
        signal,
      );
      this.phase('models');
      await this.run(
        python,
        ['worker/install_models.py', '--root', await inside(this.root, 'data/models')],
        signal,
        true,
      );
      await this.run(
        python,
        [
          'worker/install_models.py',
          '--root',
          await inside(this.root, 'data/models'),
          '--verify-only',
        ],
        signal,
      );
      this.status = { version: VERSION, state: 'ready', phase: 'models' };
    } catch (e) {
      const phase = this.status.phase;
      const error = e instanceof Error ? e.message : 'STEP_FAILED';
      this.status = {
        version: VERSION,
        phase,
        state: signal.aborted ? 'paused' : 'failed',
        error: signal.aborted
          ? undefined
          : [
                'DISK_SPACE',
                'PACKAGE_INTEGRITY',
                'DOWNLOAD_INTEGRITY',
                'UNSAFE_ARCHIVE',
                'UNSAFE_PATH',
              ].includes(error)
            ? error
            : 'INSTALL_' + phase.toUpperCase(),
      };
    } finally {
      this.abort = null;
    }
  }
  pause() {
    this.abort?.abort();
  }
  async launch() {
    if (this.status.state !== 'ready') throw Error('SETUP_REQUIRED');
    try {
      await this.start();
    } catch {
      await this.stop();
      this.status = {
        version: VERSION,
        state: 'failed',
        phase: 'models',
        error: 'INVALID_OPTIONS',
      };
    }
  }
  private async start() {
    this.status = { version: VERSION, state: 'starting', phase: 'models' };
    const settings = z
      .object({
        port: z.number().int().min(1024).max(65535).default(4347),
        workerPort: z.number().int().min(1024).max(65535).default(4351),
        publicUrl: z.string().url().optional(),
      })
      .strict()
      .parse(
        JSON.parse(
          await readFile(await inside(this.root, '.installer/options.json'), 'utf8').catch(
            () => '{}',
          ),
        ),
      );
    const port = settings.port,
      worker = settings.workerPort;
    const origin = settings.publicUrl || `http://127.0.0.1:${port}`;
    const parsed = new URL(origin);
    if (
      port === worker ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash ||
      (parsed.protocol !== 'https:' && origin !== `http://127.0.0.1:${port}`)
    )
      throw Error('INVALID_OPTIONS');
    // Stable panel ports preserve the exact Discord OAuth callback across restarts.
    for (const wanted of [port, worker]) {
      try {
        await new Promise<void>((resolve, reject) => {
          const socket = createNetServer();
          socket.once('error', reject);
          socket.listen(wanted, '127.0.0.1', () => socket.close(() => resolve()));
        });
      } catch {
        this.status = { version: VERSION, state: 'failed', phase: 'models', error: 'PORT_IN_USE' };
        return;
      }
    }
    const dataDir = await inside(this.root, 'data');
    await mkdir(dataDir, { recursive: true });
    const child = spawn(process.execPath, ['dist/server/main.js'], {
      cwd: path.join(this.root, 'app'),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...cleanEnvironment(),
        PORT: String(port),
        PUBLIC_URL: origin,
        VOICEBRIDGE_WORKER_PORT: String(worker),
        VOICEBRIDGE_DATA: dataDir,
        VOICEBRIDGE_PYTHON: path.join(this.root, 'app/.venv/Scripts/python.exe'),
      },
    });
    this.application = child;
    child.stdout?.on('data', () => {});
    child.stderr?.on('data', () => {});
    child.on('error', () => {
      this.status = { version: VERSION, state: 'failed', phase: 'models', error: 'START_FAILED' };
    });
    child.on('exit', () => {
      if (this.application === child) {
        this.application = null;
        this.status = { version: VERSION, state: 'ready', phase: 'models' };
      }
    });
    try {
      for (let i = 0; i < 90; i++) {
        if (child.exitCode !== null) throw Error('START_FAILED');
        try {
          const result = await fetch(`http://127.0.0.1:${port}/healthz`, {
            signal: AbortSignal.timeout(1000),
          });
          const health = (await result.json()) as { ok?: boolean; version?: string };
          if (health.ok && health.version === VERSION) {
            const operatorUrl = (
              await readFile(path.join(dataDir, 'operator-link'), 'utf8')
            ).trim();
            if (!operatorUrl.startsWith(`${origin}/#operator=`)) throw Error('START_FAILED');
            this.status = { version: VERSION, state: 'running', phase: 'models', operatorUrl };
            return;
          }
        } catch {
          /* Wait only for this owned child to become ready. */
        }
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      throw Error('START_FAILED');
    } catch {
      await this.stop();
      this.status = { version: VERSION, state: 'failed', phase: 'models', error: 'START_FAILED' };
    }
  }
  async stop() {
    this.pause();
    await this.preparation;
    const child = this.application;
    if (child && child.exitCode === null && child.connected) {
      child.send({ type: 'voicebridge-shutdown' });
      await Promise.race([
        new Promise<void>((resolve) => child.once('exit', () => resolve())),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
      if (child.exitCode === null) child.kill();
    }
    this.application = null;
    if (this.status.state === 'running')
      this.status = { version: VERSION, state: 'ready', phase: 'models' };
  }
}

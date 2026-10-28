import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { download } from '../src/launcher/download.js';
import { inside } from '../src/launcher/files.js';
import { createLauncherServer } from '../src/launcher/server.js';
import { freePort, WindowsInstaller } from '../src/launcher/installer.js';
import { VERSION } from '../src/core/contracts.js';
import type { Installer, LauncherStatus } from '../src/launcher/contracts.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function temporary() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voicebridge-launcher-test-'));
  roots.push(root);
  return root;
}
const bytes = Buffer.from('verified-runtime-fixture');
const spec = {
  url: 'https://github.com/astral-sh/python-build-standalone/releases/download/test/runtime.tar.gz',
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
};
const transport = (handler: (url: string, options: RequestInit) => Response | Promise<Response>) =>
  vi.fn(handler) as unknown as typeof fetch;

describe('Resumable runtime boundary', () => {
  it('rejects redirects outside the pinned release asset hosts before requesting them', async () => {
    const root = await temporary();
    const fetcher = transport(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://attacker.invalid/runtime' },
        }),
    );
    await expect(
      download(root, 'python', spec, new AbortController().signal, () => {}, fetcher),
    ).rejects.toThrow('DOWNLOAD_REDIRECT');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('follows a release asset redirect and still requires the pinned SHA', async () => {
    const root = await temporary();
    let called = 0;
    const fetcher = transport((url) => {
      if (called++ === 0)
        return new Response(null, {
          status: 302,
          headers: { location: 'https://release-assets.githubusercontent.com/fixture' },
        });
      expect(String(url)).toBe('https://release-assets.githubusercontent.com/fixture');
      return new Response(bytes);
    });
    expect(
      await readFile(
        await download(root, 'python', spec, new AbortController().signal, () => {}, fetcher),
      ),
    ).toEqual(bytes);
  });
  it('resumes the exact remainder and promotes only verified bytes', async () => {
    const root = await temporary();
    await writeFile(path.join(root, 'python.partial'), bytes.subarray(0, 5));
    const fetcher = transport((_url, options) => {
      expect(options.headers).toMatchObject({ Range: 'bytes=5-' });
      return new Response(bytes.subarray(5), {
        status: 206,
        headers: { 'content-range': `bytes 5-${bytes.length - 1}/${bytes.length}` },
      });
    });
    const result = await download(
      root,
      'python',
      spec,
      new AbortController().signal,
      () => {},
      fetcher,
    );
    expect(await readFile(result)).toEqual(bytes);
    await expect(stat(path.join(root, 'python.partial'))).rejects.toThrow();
  });
  it('replaces a partial if the server ignores Range', async () => {
    const root = await temporary();
    await writeFile(path.join(root, 'python.partial'), 'wrong');
    const result = await download(
      root,
      'python',
      spec,
      new AbortController().signal,
      () => {},
      transport(() => new Response(bytes)),
    );
    expect(await readFile(result)).toEqual(bytes);
  });
  it('keeps interrupted bytes and resumes after a network failure', async () => {
    const root = await temporary();
    const stream = Readable.from(
      (async function* () {
        yield bytes.subarray(0, 6);
        await new Promise((resolve) => setTimeout(resolve, 30));
        throw Error('connection closed');
      })(),
    );
    await expect(
      download(
        root,
        'python',
        spec,
        new AbortController().signal,
        () => {},
        transport(() => new Response(Readable.toWeb(stream) as ReadableStream)),
      ),
    ).rejects.toThrow();
    expect(await readFile(path.join(root, 'python.partial'))).toEqual(bytes.subarray(0, 6));
    await download(
      root,
      'python',
      spec,
      new AbortController().signal,
      () => {},
      transport(
        () =>
          new Response(bytes.subarray(6), {
            status: 206,
            headers: { 'content-range': `bytes 6-${bytes.length - 1}/${bytes.length}` },
          }),
      ),
    );
    expect(await readFile(path.join(root, 'python'))).toEqual(bytes);
  });
  it('rejects a mismatched Content-Range without appending', async () => {
    const root = await temporary();
    await writeFile(path.join(root, 'python.partial'), bytes.subarray(0, 5));
    await expect(
      download(
        root,
        'python',
        spec,
        new AbortController().signal,
        () => {},
        transport(
          () =>
            new Response(bytes, {
              status: 206,
              headers: { 'content-range': `bytes 0-${bytes.length - 1}/${bytes.length}` },
            }),
        ),
      ),
    ).rejects.toThrow('INVALID_RANGE');
    expect((await readFile(path.join(root, 'python.partial'))).length).toBe(5);
  });
  it('never promotes corrupt or oversized downloads', async () => {
    const root = await temporary();
    await expect(
      download(
        root,
        'python',
        spec,
        new AbortController().signal,
        () => {},
        transport(() => new Response(Buffer.alloc(bytes.length))),
      ),
    ).rejects.toThrow('DOWNLOAD_INTEGRITY');
    await expect(stat(path.join(root, 'python'))).rejects.toThrow();
    await expect(
      download(
        root,
        'python',
        spec,
        new AbortController().signal,
        () => {},
        transport(() => new Response(Buffer.alloc(bytes.length + 1))),
      ),
    ).rejects.toThrow('DOWNLOAD_TOO_LARGE');
  });
  it('does not contact the network for an intact cached runtime', async () => {
    const root = await temporary();
    await writeFile(path.join(root, 'python'), bytes);
    const fetcher = vi.fn();
    await download(root, 'python', spec, new AbortController().signal, () => {}, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects off-host sources, traversal and junction paths', async () => {
    const root = await temporary(),
      outside = await temporary();
    await expect(
      download(
        root,
        '../escape',
        { ...spec, url: 'https://attacker.invalid/file' },
        new AbortController().signal,
      ),
    ).rejects.toThrow('UNTRUSTED_RUNTIME');
    await expect(inside(root, '../escape')).rejects.toThrow('UNSAFE_PATH');
    await mkdir(path.join(outside, 'files'));
    await symlink(
      path.join(outside, 'files'),
      path.join(root, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(inside(root, 'linked/file')).rejects.toThrow('UNSAFE_PATH');
  });
});

describe('Local launcher access and side-effect guards', () => {
  it('probes the configured HTTPS Host over loopback and canonicalizes the operator link', async () => {
    const root = await temporary();
    const port = await freePort(),
      workerPort = await freePort();
    await mkdir(path.join(root, '.installer'));
    await mkdir(path.join(root, 'app/dist/server'), { recursive: true });
    await writeFile(
      path.join(root, '.installer/options.json'),
      JSON.stringify({ port, workerPort, publicUrl: 'https://voice.example.test/' }),
    );
    await writeFile(
      path.join(root, 'app/dist/server/main.js'),
      `
      const { createServer } = require('node:http');
      const { writeFileSync } = require('node:fs');
      const path = require('node:path');
      const origin = process.env.PUBLIC_URL;
      writeFileSync(path.join(process.env.VOICEBRIDGE_DATA, 'operator-link'), origin + '/#operator=synthetic-local-test');
      const server = createServer((req, res) => {
        if (req.headers.host !== new URL(origin).host) { res.writeHead(421).end(); return; }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, version: ${JSON.stringify(VERSION)} }));
      });
      server.listen(Number(process.env.PORT), '127.0.0.1');
      process.on('message', msg => { if (msg.type === 'voicebridge-shutdown') server.close(() => process.exit(0)); });
      process.on('disconnect', () => process.exit(0));
    `,
    );
    const installer = new WindowsInstaller(root);
    installer.status.state = 'ready';
    try {
      await installer.launch();
      expect(installer.status).toMatchObject({
        state: 'running',
        operatorUrl: 'https://voice.example.test/#operator=synthetic-local-test',
      });
      expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(421);
    } finally {
      await installer.stop();
    }
  });
  it('reports invalid advanced settings without remaining stuck in starting', async () => {
    const root = await temporary();
    await mkdir(path.join(root, '.installer'));
    await writeFile(
      path.join(root, '.installer/options.json'),
      JSON.stringify({ port: 4347, workerPort: 4347 }),
    );
    const installer = new WindowsInstaller(root);
    installer.status.state = 'ready';
    await installer.launch();
    expect(installer.status).toMatchObject({ state: 'failed', error: 'INVALID_OPTIONS' });
  });
  const origin = 'http://127.0.0.1:4370',
    token = 'a'.repeat(64);
  async function fixture() {
    const status: LauncherStatus = {
      version: 'test',
      state: 'idle',
      phase: 'package',
      simulation: true,
    };
    const installer: Installer = {
      status,
      prepare: vi.fn(async () => {
        status.state = 'installing';
      }),
      pause: vi.fn(),
      launch: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
    };
    const service = await createLauncherServer({
      webRoot: path.resolve('dist/web'),
      token,
      installer,
      origin,
    });
    const headers = { host: '127.0.0.1:4370', origin, 'x-vb-launcher': '1' };
    const auth = await service.app.inject({
      method: 'POST',
      url: '/api/bootstrap',
      headers,
      payload: { token },
    });
    const cookie = auth.cookies[0]?.name + '=' + auth.cookies[0]?.value;
    return { ...service, installer, headers: { ...headers, cookie }, auth };
  }
  it('uses HttpOnly same-site cookies and denies unauthenticated status', async () => {
    const f = await fixture();
    try {
      expect(f.auth.headers['set-cookie']).toContain('HttpOnly');
      expect(f.auth.headers['set-cookie']).toContain('SameSite=Strict');
      const response = await f.app.inject({
        url: '/api/status',
        headers: { host: '127.0.0.1:4370' },
      });
      expect(response.statusCode).toBe(401);
      const ready = await f.app.inject({ url: '/api/status', headers: f.headers });
      expect(ready.statusCode).toBe(200);
      expect(ready.body).not.toContain(token);
    } finally {
      await f.app.close();
    }
  });
  it('rejects DNS rebinding, cross-origin writes, missing consent and bad tokens', async () => {
    const f = await fixture();
    try {
      expect(
        (
          await f.app.inject({
            url: '/api/status',
            headers: { ...f.headers, host: 'evil.example' },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await f.app.inject({
            method: 'POST',
            url: '/api/install',
            headers: { ...f.headers, origin: 'https://evil.example' },
            payload: { consent: true },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await f.app.inject({
            method: 'POST',
            url: '/api/install',
            headers: f.headers,
            payload: { consent: false },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await f.app.inject({
            method: 'POST',
            url: '/api/bootstrap',
            headers: f.headers,
            payload: { token: 'b'.repeat(64) },
          })
        ).statusCode,
      ).toBe(401);
      expect(f.installer.prepare).not.toHaveBeenCalled();
    } finally {
      await f.app.close();
    }
  });
  it('starts one preparation job, gates launch, and stops only its installer', async () => {
    const f = await fixture();
    try {
      expect(
        (
          await f.app.inject({
            method: 'POST',
            url: '/api/launch',
            headers: f.headers,
            payload: {},
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await f.app.inject({
            method: 'POST',
            url: '/api/install',
            headers: f.headers,
            payload: { consent: true },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await f.app.inject({
            method: 'POST',
            url: '/api/install',
            headers: f.headers,
            payload: { consent: true },
          })
        ).statusCode,
      ).toBe(409);
      expect(f.installer.prepare).toHaveBeenCalledTimes(1);
      await f.app.inject({ method: 'POST', url: '/api/pause', headers: f.headers, payload: {} });
      expect(f.installer.pause).toHaveBeenCalledTimes(1);
      await f.app.inject({ method: 'POST', url: '/api/stop', headers: f.headers, payload: {} });
      expect(f.installer.stop).toHaveBeenCalledTimes(1);
    } finally {
      await f.app.close();
    }
  });
});

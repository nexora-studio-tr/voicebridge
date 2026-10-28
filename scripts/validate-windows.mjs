import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { root } from './runtime.mjs';

if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('Windows x64 required');
const full = process.argv.includes('--full');
const packaged = JSON.parse(
  await readFile(path.join(root, 'artifacts/windows/package.json'), 'utf8'),
);
const archive = path.resolve(packaged.archive);
assert.equal(
  createHash('sha256')
    .update(await readFile(archive))
    .digest('hex'),
  packaged.sha256,
);
const out = path.join(root, 'artifacts/windows', `clean-${Date.now()}`);
await mkdir(out, { recursive: true });
const python = process.env.VOICEBRIDGE_TEST_PYTHON || 'python';
const extracted = spawnSync(python, ['-m', 'zipfile', '-e', archive, out], {
  windowsHide: true,
  encoding: 'utf8',
});
assert.equal(extracted.status, 0, 'Fresh ZIP extraction failed');
const directory = path.join(out, 'VoiceBridge');
const env = {};
for (const key of [
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'LOCALAPPDATA',
  'COMSPEC',
  'PATHEXT',
])
  if (process.env[key]) env[key] = process.env[key];
env.PATH = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const controls = [];
let child, origin, headers;
const checks = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(probe, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result) return result;
    await sleep(250);
  }
  throw Error('Timed out waiting for package state');
}
async function api(route, body) {
  const response = await fetch(origin + '/api/' + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(45000),
  });
  assert.equal(response.ok, true, `Package API failed: ${route} (${response.status})`);
  return response.json();
}
function startNative() {
  child = spawn(path.join(directory, 'VoiceBridge.exe'), ['--headless'], {
    cwd: directory,
    env,
    windowsHide: true,
    stdio: 'ignore',
  });
  child.on('error', () => {});
}
try {
  for (let i = 0; i < 3; i++) {
    const server = createServer((_req, response) => response.end('unrelated-test-process'));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    controls.push(server);
  }
  const ports = controls.slice(0, 2).map((s) => s.address().port);
  await Promise.all(controls.slice(0, 2).map((s) => new Promise((resolve) => s.close(resolve))));
  await mkdir(path.join(directory, '.installer'), { recursive: true });
  await writeFile(
    path.join(directory, '.installer/options.json'),
    JSON.stringify({ port: ports[0], workerPort: ports[1] }),
  );
  startNative();
  const lock = await until(async () => {
    if (child.exitCode !== null) throw Error('Native launcher exited before setup');
    try {
      return JSON.parse(await readFile(path.join(directory, '.installer/launcher.lock'), 'utf8'));
    } catch {
      return null;
    }
  });
  origin = `http://127.0.0.1:${lock.port}`;
  const page = await fetch(origin + '/install');
  assert.equal(page.ok, true);
  assert.match(await page.text(), /<html/);
  assert.equal((await fetch(origin + '/api/status')).status, 401);
  headers = { origin, 'content-type': 'application/json', 'x-vb-launcher': '1' };
  const bootstrap = await fetch(origin + '/api/bootstrap', {
    method: 'POST',
    headers,
    body: JSON.stringify({ token: lock.token }),
  });
  assert.equal(bootstrap.ok, true);
  headers.cookie = bootstrap.headers.get('set-cookie').split(';')[0];
  assert.equal((await api('status')).state, 'idle');
  assert.equal(await stat(path.join(directory, 'runtime/python')).catch(() => null), null);
  assert.equal(await stat(path.join(directory, 'data')).catch(() => null), null);
  checks.push(
    'Fresh ZIP starts through native EXE with PATH excluding host Node/Python; nothing downloaded automatically',
  );
  const denied = await fetch(origin + '/api/install', {
    method: 'POST',
    headers,
    body: JSON.stringify({ consent: false }),
  });
  assert.equal(denied.status, 400);
  checks.push('Real native setup refuses installation without explicit download consent');
  if (full) {
    await api('install', { consent: true });
    let last = '';
    const ready = await until(
      async () => {
        const state = await api('status');
        const stage = state.state + ':' + state.phase;
        if (stage !== last) {
          console.log(stage);
          last = stage;
        }
        if (state.state === 'failed') throw Error(`Clean setup failed: ${state.error}`);
        return state.state === 'ready' ? state : null;
      },
      20 * 60 * 1000,
    );
    assert.equal(ready.state, 'ready');
    const probe = spawnSync(
      path.join(directory, 'app/.venv/Scripts/python.exe'),
      [
        '-c',
        'import sys,numpy,faster_whisper,onnxruntime,piper; assert sys.version_info[:2] == (3,12)',
      ],
      { env, windowsHide: true, encoding: 'utf8' },
    );
    assert.equal(probe.status, 0, 'Private Python dependencies must import');
    checks.push(
      'Pinned standalone Python, private venv, locked binary wheels and SHA-verified models installed from fresh package',
    );
    const launched = await api('launch', {});
    assert.equal(launched.state, 'running');
    assert.match(
      launched.operatorUrl,
      new RegExp(`^http://127\\.0\\.0\\.1:${ports[0]}/#operator=`),
    );
    assert.equal((await (await fetch(`http://127.0.0.1:${ports[0]}/healthz`)).json()).ok, true);
    await until(async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${ports[1]}/healthz`, {
          signal: AbortSignal.timeout(1000),
        });
        return r.status === 401;
      } catch {
        return false;
      }
    }, 30000);
    checks.push(
      'Owned application and authenticated local worker start without Discord credentials or billable API calls',
    );
    await api('stop', {});
    await until(async () => {
      try {
        await fetch(`http://127.0.0.1:${ports[1]}/healthz`, { signal: AbortSignal.timeout(500) });
        return false;
      } catch {
        return true;
      }
    });
    checks.push('Stop closes the owned worker');
  }
  const unrelated = `http://127.0.0.1:${controls[2].address().port}`;
  assert.equal(await (await fetch(unrelated)).text(), 'unrelated-test-process');
  checks.push('Unrelated localhost process remains available');
  await api('quit', {});
  await until(() => child.exitCode !== null);
  origin = null;
  assert.equal(child.exitCode, 0);
  checks.push('Close exits the owned native/Node process chain');
  // Tampering is performed only in this disposable extracted test package.
  await writeFile(path.join(directory, 'app/dist/launcher/main.js'), '\n// tamper test\n', {
    flag: 'a',
  });
  startNative();
  await until(() => child.exitCode !== null);
  assert.equal(child.exitCode, 1);
  checks.push('Native bootstrap rejects modified JavaScript before execution');
  const report = {
    status: 'passed',
    version: packaged.version,
    archiveSha256: packaged.sha256,
    platform: process.platform,
    arch: process.arch,
    mode: full ? 'fresh-package-full-model-install' : 'fresh-package-native-smoke',
    hostNodePythonOnPath: false,
    liveDiscord: 'not-run',
    humanFreshInstalls: 0,
    checks,
  };
  await writeFile(
    path.join(root, 'artifacts/windows/validation.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify({ status: 'passed', mode: report.mode, checks: checks.length }));
} finally {
  if (origin) await api('quit', {}).catch(() => {});
  if (child && child.exitCode === null) {
    await sleep(1500);
    if (child.exitCode === null && child.pid)
      spawnSync(
        path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'),
        ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true, stdio: 'ignore' },
      );
  }
  for (const server of controls)
    if (server.listening) await new Promise((resolve) => server.close(resolve));
}

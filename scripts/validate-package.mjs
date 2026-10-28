import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { root } from './runtime.mjs';
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw Error('Run this check with npm run test:package');
const python = process.env.VOICEBRIDGE_TEST_PYTHON || 'python';
const work = path.join(root, 'artifacts', 'clean-install', `${metadata.version}-${Date.now()}`);
const archive = path.resolve(
  process.env.VOICEBRIDGE_SOURCE_ARCHIVE ||
    path.join(root, 'artifacts', 'release', `voicebridge-${metadata.version}-source.zip`),
);
async function run(command, args, cwd, env = process.env) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '',
      diagnostics = '';
    child.stdout.on('data', (b) => {
      output += b.toString();
    });
    child.stderr.on('data', (b) => {
      diagnostics = (diagnostics + b.toString()).slice(-10000);
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(output)
        : reject(
            Error(`Clean install step failed (${code}): ${diagnostics}\n${output.slice(-5000)}`),
          ),
    );
  });
}
await mkdir(path.dirname(work), { recursive: true });
const unpack = JSON.parse(
  (await run(python, [path.join(root, 'scripts', 'unpack_source.py'), archive, work], root)).trim(),
);
if (unpack.version !== metadata.version) throw Error('Release version mismatch');
const cleanRoot = path.join(work, 'voicebridge');
console.log('Verified release source; installing fresh Node dependencies.');
await run(process.execPath, [npmCli, 'ci', '--ignore-scripts'], cleanRoot);
console.log('Building the extracted release.');
await run(process.execPath, [npmCli, 'run', 'build'], cleanRoot);
console.log('Testing the extracted release in isolated demo/operator profiles.');
const browserOutput = await run(process.execPath, ['scripts/validate-browser.mjs'], cleanRoot, {
  ...process.env,
  VOICEBRIDGE_DATA: path.join(cleanRoot, '.voicebridge-clean'),
});
const browser = JSON.parse(browserOutput.trim().split(/\r?\n/).at(-1));
if (browser.status !== 'passed' || browser.checks < 25)
  throw Error('Clean browser checks did not pass');
const recovery = JSON.parse(
  await readFile(path.join(cleanRoot, 'artifacts/browser/room-recovery-report.json'), 'utf8'),
);
if (
  recovery.status !== 'passed' ||
  recovery.checks.length !== 9 ||
  recovery.humanParticipants !== 0 ||
  recovery.liveDiscord ||
  recovery.paidApi
)
  throw Error('Room recovery evidence did not pass');
for (const file of [
  'room-recovery-report.json',
  'room-reconnecting-en.png',
  'room-recovery-tr.png',
])
  await copyFile(
    path.join(cleanRoot, 'artifacts/browser', file),
    path.join(root, 'artifacts/clean-install', file),
  );
const report = {
  status: 'passed',
  version: metadata.version,
  sourcePackage: {
    sha256: unpack.archiveSha256,
    files: unpack.sourceFiles,
    manifest: unpack.manifest,
  },
  freshSource: true,
  freshNodeModules: true,
  build: 'passed',
  browserChecks: browser.checks,
  recoveryBrowserChecks: recovery.checks.length,
  profiles:
    'isolated recorded-demo/operator profiles and synthetic HTTP/SSE timing/recovery profiles with two independent browser contexts',
  credentialsCopied: false,
  liveDiscord: false,
  paidApi: false,
  pythonModelInstall: 'separate local check; not performed by this Node/demo verifier',
  scope:
    'Automated release installation on the current runner/host; does not claim a different human independently installed it',
};
await writeFile(
  path.join(root, 'artifacts', 'clean-install', 'report.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report));

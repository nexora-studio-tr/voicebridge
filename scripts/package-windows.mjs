import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdir, copyFile, readdir, lstat, readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { root, nodeVersion } from './runtime.mjs';

nodeVersion();
if (process.platform !== 'win32' || process.arch !== 'x64')
  throw Error('Build the Windows x64 package on Windows x64.');
if (!process.env.npm_execpath) throw Error('Run npm run package:windows');
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const sourceArchive = path.join(
  root,
  'artifacts/release',
  `voicebridge-${metadata.version}-source.zip`,
);
const sourceArchiveSha256 = createHash('sha256')
  .update(await readFile(sourceArchive))
  .digest('hex');
const destination = path.join(
  root,
  'artifacts',
  'windows',
  `build-${metadata.version}-${Date.now()}`,
);
await mkdir(destination, { recursive: true });
async function copy(source, target) {
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw Error('Package symlink rejected');
  if (info.isDirectory()) {
    await mkdir(target, { recursive: true });
    for (const name of await readdir(source)) {
      if (['__pycache__', '.git', '.venv', '.bin'].includes(name) || name.endsWith('.pyc'))
        continue;
      await copy(path.join(source, name), path.join(target, name));
    }
  } else {
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }
}
// Deliberately copy only public, required program trees. Never inspect .voicebridge, .env or sibling projects.
for (const directory of ['dist', 'worker', 'launcher'])
  await copy(path.join(root, directory), path.join(destination, 'app', directory));
for (const file of [
  'package.json',
  'package-lock.json',
  'LICENSE',
  'NOTICE',
  'THIRD_PARTY_NOTICES.md',
])
  await copy(path.join(root, file), path.join(destination, 'app', file));
await copy(path.join(root, 'docs'), path.join(destination, 'docs'));
for (const file of ['README.md', 'README.tr.md', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md'])
  await copy(path.join(root, file), path.join(destination, file));
await copy(process.execPath, path.join(destination, 'runtime', 'node.exe'));
// Browser libraries are bundled into dist/web; keep their and their build dependencies' notices
// even though they do not belong in the production Node module tree.
const licensePackages = [];
for (const entry of await readdir(path.join(root, 'node_modules'))) {
  if (entry.startsWith('.')) continue;
  if (entry.startsWith('@')) {
    for (const name of await readdir(path.join(root, 'node_modules', entry)))
      licensePackages.push(entry + '/' + name);
  } else licensePackages.push(entry);
}
for (const name of licensePackages) {
  if (!/^(@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(name)) throw Error('Invalid license package');
  const directory = path.join(root, 'node_modules', name);
  if (!(await lstat(directory)).isDirectory()) continue;
  for (const file of await readdir(directory)) {
    if (!/^(licen[sc]e|notice)(\.[a-z0-9_-]+)?$/i.test(file)) continue;
    if ((await lstat(path.join(directory, file))).isFile())
      await copy(path.join(directory, file), path.join(destination, 'licenses/npm', name, file));
  }
}
const license = await fetch(
  `https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`,
  { signal: AbortSignal.timeout(30000) },
);
if (!license.ok) throw Error('Could not obtain matching Node license');
await writeFile(path.join(destination, 'runtime', 'NODE-LICENSE.txt'), await license.text());
function run(command, args, cwd = destination) {
  const result = spawnSync(command, args, { cwd, windowsHide: true, stdio: 'inherit' });
  if (result.status !== 0) throw Error('Windows package build step failed');
}
run(
  process.execPath,
  [process.env.npm_execpath, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
  path.join(destination, 'app'),
);
async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const manifest = {};
async function inventory(directory) {
  for (const name of (await readdir(directory)).sort()) {
    const file = path.join(directory, name),
      info = await lstat(file);
    if (info.isSymbolicLink()) throw Error('Unexpected production symlink');
    if (info.isDirectory()) await inventory(file);
    else manifest[path.relative(destination, file).replaceAll('\\', '/')] = await digest(file);
  }
}
await inventory(destination);
const manifestPath = path.join(destination, 'PACKAGE_MANIFEST.json');
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
const identity = path.join(destination, 'PackageIdentity.cs');
await writeFile(
  identity,
  `internal static class PackageIdentity { internal const string NodeSha256="${manifest['runtime/node.exe']}"; internal const string ManifestSha256="${await digest(manifestPath)}"; internal const string BootstrapSha256="${manifest['app/dist/launcher/main.js']}"; }\n`,
);
const compiler = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'Microsoft.NET',
  'Framework64',
  'v4.0.30319',
  'csc.exe',
);
run(compiler, [
  '/nologo',
  '/target:winexe',
  '/platform:x64',
  '/optimize+',
  '/reference:System.Windows.Forms.dll',
  '/reference:System.Web.Extensions.dll',
  `/win32manifest:${path.join(root, 'launcher', 'launcher.manifest')}`,
  `/out:${path.join(destination, 'VoiceBridge.exe')}`,
  path.join(root, 'launcher', 'VoiceBridge.cs'),
  identity,
]);
const launchHash = await digest(path.join(destination, 'VoiceBridge.exe'));
await writeFile(
  path.join(destination, 'BUILD.json'),
  JSON.stringify(
    {
      version: metadata.version,
      node: process.versions.node,
      launcherSha256: launchHash,
      manifestSha256: await digest(manifestPath),
      source: 'Matching source archive is published alongside this unsigned Windows package.',
      sourceArchiveSha256,
      signed: false,
    },
    null,
    2,
  ) + '\n',
);
const python = process.env.VOICEBRIDGE_TEST_PYTHON || 'python';
const archive = path.join(
  root,
  'artifacts',
  'release',
  `voicebridge-${metadata.version}-windows-x64.zip`,
);
await mkdir(path.dirname(archive), { recursive: true });
run(python, [path.join(root, 'scripts', 'zip_windows.py'), destination, archive], root);
const report = {
  status: 'packaged',
  version: metadata.version,
  packageRoot: destination,
  archive,
  sha256: await digest(archive),
  launcherSha256: launchHash,
  files: Object.keys(manifest).length,
};
await writeFile(
  path.join(root, 'artifacts', 'windows', 'package.json'),
  JSON.stringify(report, null, 2) + '\n',
);
const checksums = path.join(root, 'artifacts', 'release', 'SHA256SUMS.txt');
const previous = await readFile(checksums, 'utf8').catch(() => '');
await writeFile(
  checksums,
  [
    ...previous.split('\n').filter((line) => line && !line.endsWith(path.basename(archive))),
    report.sha256 + '  ' + path.basename(archive),
  ].join('\n') + '\n',
);
console.log(JSON.stringify(report));

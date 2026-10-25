import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { root, run, nodeVersion } from './runtime.mjs';
const python = path.join(
  root,
  '.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
);
nodeVersion();
const candidates = process.env.VOICEBRIDGE_BASE_PYTHON
  ? [[process.env.VOICEBRIDGE_BASE_PYTHON, []]]
  : process.platform === 'win32'
    ? [
        ['py', ['-3.12']],
        ['python', []],
      ]
    : [
        ['python3.12', []],
        ['python3', []],
      ];
if (!existsSync(python)) {
  let found = false;
  for (const [command, base] of candidates) {
    const probe = spawnSync(
      command,
      [...base, '-c', 'import sys;sys.exit(0 if sys.version_info[:2]==(3,12) else 1)'],
      { cwd: root, windowsHide: true },
    );
    if (probe.status === 0) {
      run(command, [...base, '-m', 'venv', '--copies', '.venv']);
      found = true;
      break;
    }
  }
  if (!found)
    throw new Error(
      'Python 3.12 is required. Set VOICEBRIDGE_BASE_PYTHON to its executable if needed.',
    );
}
run(python, [
  '-m',
  'pip',
  'install',
  '--disable-pip-version-check',
  '-r',
  'worker/requirements.lock',
]);
run(python, [
  'worker/install_models.py',
  '--root',
  process.env.VOICEBRIDGE_DATA
    ? process.env.VOICEBRIDGE_DATA + '/models'
    : root + '/.voicebridge/models',
]);
run(process.execPath, ['scripts/build.mjs']);
console.log(
  'Local setup complete. npm start opens the operator service; npm run demo starts the recorded demo. No Discord connection or paid request has been made.',
);

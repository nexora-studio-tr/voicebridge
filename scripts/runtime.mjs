import { spawnSync } from 'node:child_process';
import path from 'node:path';
export const root = path.resolve(import.meta.dirname, '..');
export const python =
  process.env.VOICEBRIDGE_PYTHON ??
  path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
export function nodeVersion() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major !== 24 || minor < 17)
    throw new Error('VoiceBridge requires Node.js 24.17+ (24.x LTS). Current: ' + process.version);
}
export function run(command, args, extra = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    ...extra,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Command failed with exit ' + result.status);
}

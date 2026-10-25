import { spawnSync } from 'node:child_process';
for (const args of [
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.server.json'],
  ['node_modules/vite/bin/vite.js', 'build'],
]) {
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', windowsHide: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

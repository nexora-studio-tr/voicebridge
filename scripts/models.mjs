import { python, root, run } from './runtime.mjs';
import path from 'node:path';
const data = path.resolve(process.env.VOICEBRIDGE_DATA ?? path.join(root, '.voicebridge'));
run(python, [
  'worker/install_models.py',
  '--root',
  path.join(data, 'models'),
  ...process.argv.slice(2),
]);

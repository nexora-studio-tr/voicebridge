import { python, root, run } from './runtime.mjs';
import path from 'node:path';

run(python, [path.join(root, 'scripts/benchmark_quality.py'), ...process.argv.slice(2)]);

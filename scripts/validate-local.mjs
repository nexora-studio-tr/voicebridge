import { run, python } from './runtime.mjs';
run(python, ['-m', 'unittest', 'discover', '-s', 'worker/tests', '-v']);
run(python, ['worker/install_models.py', '--verify-only']);
run(python, ['scripts/benchmark_local.py']);

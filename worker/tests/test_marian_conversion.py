"""Model-free admission, ownership, cleanup and native Windows job-limit tests."""
import contextlib
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import convert_marian as runner
from marian_job import CREATE_SUSPENDED, WindowsJob
from preflight_marian import MANIFEST, source_sha256


class FakeJob:
    def __init__(self, *args): pass
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def assign(self, process): pass
    def peak_private_bytes(self): return 1024


class ConversionTests(unittest.TestCase):
    def test_low_resources_cannot_create_files_import_models_or_start_processes(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory) / 'untouched'
            with patch.object(runner, 'WORK', work), patch.object(runner, 'inputs', return_value=({}, {}, {})), \
                 patch.object(runner, 'resource_check', return_value={'selectedDirectionReady': False}), \
                 patch.object(runner, 'verify_extracted') as verify, patch.object(runner.subprocess, 'Popen') as spawn, \
                 patch.object(runner, 'WindowsJob') as job:
                with self.assertRaisesRegex(ValueError, 'CONVERSION_RESOURCES_NOT_READY'):
                    runner.convert('en-tr')
                self.assertFalse(work.exists())
                verify.assert_not_called()
                spawn.assert_not_called()
                job.assert_not_called()

    def test_direction_admission_does_not_depend_on_other_direction(self):
        document = json.loads(MANIFEST.read_text('utf8'))
        with patch.object(runner, 'available_memory', return_value=3 * 1024**3), \
             patch.object(runner.shutil, 'disk_usage', return_value=SimpleNamespace(free=20 * 1024**3)), \
             patch.object(runner.importlib.metadata, 'version', side_effect=lambda name: document['dependencies'][name]):
            results = {s['direction']: runner.resource_check(document, s) for s in document['sources']}
        self.assertTrue(results['en-tr']['selectedDirectionReady'])
        self.assertFalse(results['tr-en']['selectedDirectionReady'])
        self.assertEqual(results['en-tr']['privateCommitLimitBytes'], int(1.5 * 1024**3))
        self.assertEqual(results['tr-en']['privateCommitLimitBytes'], 3 * 1024**3)

    def test_monitor_fail_closed_reserves_timeout_and_unknown_memory(self):
        safe = (1024**3, 20 * 1024**3, 3 * 1024**3, 10)
        self.assertIsNone(runner.monitor_reason(*safe))
        self.assertEqual(runner.monitor_reason(None, *safe[1:]), 'SYSTEM_MEMORY_RESERVE')
        self.assertEqual(runner.monitor_reason(0, *safe[1:]), 'SYSTEM_MEMORY_RESERVE')
        self.assertEqual(runner.monitor_reason(safe[0], 0, *safe[2:]), 'EXPERIMENT_DISK_RESERVE')
        self.assertEqual(runner.monitor_reason(*safe[:2], runner.STOP_FOOTPRINT + 1, 10), 'EXPERIMENT_DISK_RESERVE')
        self.assertEqual(runner.monitor_reason(*safe[:3], 601), 'CONVERSION_TIMEOUT')

    def test_default_cli_check_never_runs_even_if_resources_are_ready(self):
        snapshot = json.loads((ROOT / 'docs/reports/quality-model-runner-2026-10-29.json').read_text('utf8'))
        self.assertFalse(snapshot['conversionAttempted'])
        for name, sha in snapshot['sources'].items():
            self.assertEqual(sha, source_sha256(ROOT / name))
        with patch.object(sys, 'argv', ['convert_marian.py', '--direction', 'en-tr']), \
             patch.object(runner, 'inputs', return_value=({}, {}, {})), \
             patch.object(runner, 'resource_check', return_value={'selectedDirectionReady': True}), \
             patch.object(runner, 'convert') as convert, contextlib.redirect_stdout(io.StringIO()) as output:
            runner.main()
            convert.assert_not_called()
            self.assertFalse(json.loads(output.getvalue())['conversionAttempted'])

    def test_worker_nonce_mismatch_cannot_reach_model_verification(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            scratch = work / 'en-tr/conversion-work'
            scratch.mkdir(parents=True)
            (scratch / 'ready.json').write_text('{"token":"different"}')
            with patch.object(runner, 'WORK', work), patch.object(runner, 'inputs', return_value=({}, {}, {})), \
                 patch.object(runner, 'verify_extracted') as verify:
                with self.assertRaisesRegex(ValueError, 'PARENT_HANDSHAKE_MISMATCH'):
                    runner.child('en-tr', 'expected')
                verify.assert_not_called()

    @contextlib.contextmanager
    def fixture(self):
        with tempfile.TemporaryDirectory() as directory, contextlib.ExitStack() as stack:
            work = Path(directory)
            folder = work / 'en-tr'
            folder.mkdir()
            source = {'direction': 'en-tr', 'model': 'model.npz'}
            pinned = {'extractedFiles': [{'name': 'model.npz', 'bytes': 128}]}
            stack.enter_context(patch.object(runner, 'WORK', work))
            stack.enter_context(patch.object(runner, 'inputs', return_value=({}, source, pinned)))
            stack.enter_context(patch.object(runner, 'resource_check', return_value={
                'selectedDirectionReady': True, 'privateCommitLimitBytes': 64 * 1024**2}))
            stack.enter_context(patch.object(runner, 'require_ready'))
            stack.enter_context(patch.object(runner, 'verify_extracted'))
            stack.enter_context(patch.object(runner, 'footprint_bytes', return_value=1024))
            stack.enter_context(patch.object(runner, 'WindowsJob', FakeJob))
            yield work, folder, stack

    def test_existing_semaphore_is_preserved_and_cannot_launch_a_second_child(self):
        with self.fixture() as (work, folder, stack):
            (work / 'conversion.lock').write_text('existing-owner')
            spawn = stack.enter_context(patch.object(runner.subprocess, 'Popen'))
            with self.assertRaises(FileExistsError):
                runner.convert('en-tr')
            self.assertEqual((work / 'conversion.lock').read_text(), 'existing-owner')
            self.assertFalse((folder / 'conversion-work').exists())
            spawn.assert_not_called()

    def test_existing_outputs_and_insufficient_output_allowance_are_preserved(self):
        with self.fixture() as (work, folder, stack):
            target = folder / 'ct2-int8'
            target.mkdir()
            (target / 'model.bin').write_bytes(b'preserve')
            with self.assertRaisesRegex(ValueError, 'CONVERSION_OUTPUT_EXISTS'):
                runner.convert('en-tr')
            self.assertEqual((target / 'model.bin').read_bytes(), b'preserve')
        with self.fixture() as (work, folder, stack):
            stack.enter_context(patch.object(runner, 'footprint_bytes', return_value=runner.STOP_FOOTPRINT - 1))
            with self.assertRaisesRegex(ValueError, 'CONVERSION_OUTPUT_RESERVATION'):
                runner.convert('en-tr')
            self.assertFalse((work / 'conversion.lock').exists())

    def test_job_assignment_failure_never_releases_worker_and_cleans_owned_lock(self):
        class BadJob(FakeJob):
            def assign(self, process): raise OSError('fixture failure')
        with self.fixture() as (work, folder, stack):
            process = Mock()
            process.poll.return_value = None
            stack.enter_context(patch.object(runner, 'WindowsJob', BadJob))
            stack.enter_context(patch.object(runner.subprocess, 'Popen', return_value=process))
            with self.assertRaises(OSError):
                runner.convert('en-tr')
            process.kill.assert_called_once()
            self.assertFalse((work / 'conversion.lock').exists())
            self.assertFalse((folder / 'conversion-work/ready.json').exists())
            self.assertFalse((folder / 'ct2-int8').exists())
            report = json.loads((folder / 'conversion-report.json').read_text())
            self.assertEqual(report['status'], 'failed-not-promoted')

    def test_success_fixture_remains_research_only_and_records_exact_output_hashes(self):
        with self.fixture() as (work, folder, stack):
            def fake_spawn(*args, **kwargs):
                model = folder / 'conversion-work/model'
                model.mkdir()
                (model / 'model.bin').write_bytes(b'synthetic-not-a-model')
                (model / 'config.json').write_text('{}')
                return SimpleNamespace(poll=lambda: 0, returncode=0)
            stack.enter_context(patch.object(runner.subprocess, 'Popen', side_effect=fake_spawn))
            result = runner.convert('en-tr')
            self.assertEqual(result['status'], 'converted-research-only')
            self.assertFalse(result['runtimeActivation'])
            self.assertFalse(result['qualityEvaluated'])
            self.assertEqual({f['name'] for f in result['files']}, {'model.bin', 'config.json'})
            self.assertFalse((work / 'conversion.lock').exists())

    def test_platform_without_native_job_cannot_start_conversion(self):
        with patch.object(runner.sys, 'platform', 'linux'):
            with self.assertRaisesRegex(ValueError, 'WINDOWS_JOB_REQUIRED'):
                runner.require_ready({'selectedDirectionReady': True})

    @unittest.skipUnless(sys.platform == 'win32', 'Native Windows job proof')
    def test_native_job_denies_large_allocation_in_owned_small_test_child(self):
        code = ('import sys\nsys.stdin.buffer.read(1)\n'
                'try:\n bytearray(256*1024*1024)\n print("UNLIMITED")\n'
                'except MemoryError:\n print("LIMITED")\n')
        process = None
        with WindowsJob(64 * 1024**2) as job:
            try:
                process = subprocess.Popen([sys.executable, '-c', code], stdin=subprocess.PIPE,
                                           stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                           creationflags=CREATE_SUSPENDED | 0x08000000)
                job.assign(process)
                output, error = process.communicate(input=b'g', timeout=10)
                self.assertEqual(process.returncode, 0, error.decode('utf8', errors='replace'))
                self.assertEqual(output.strip(), b'LIMITED')
                self.assertGreater(job.peak_private_bytes(), 0)
                self.assertLessEqual(job.peak_private_bytes(), 64 * 1024**2)
            finally:
                if process is not None and process.poll() is None:
                    process.kill()
                    process.wait(timeout=10)


if __name__ == '__main__':
    unittest.main()

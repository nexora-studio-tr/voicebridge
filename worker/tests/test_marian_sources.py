"""Small model-free fixtures for native source integrity and NPZ admission."""
import copy
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from inspect_marian import (digest, extract_source, footprint_bytes, inspect_npz,
                            validate_source_lock, verify_archive, verify_extracted)
from preflight_marian import source_sha256

CONFIG = {'type': 'transformer', 'dim-emb': 4, 'enc-depth': 1, 'dec-depth': 1,
          'dim-vocabs': [3, 3], 'transformer-heads': 2,
          'transformer-ffn-activation': 'swish', 'transformer-preprocess': '',
          'transformer-postprocess': 'dan', 'transformer-postprocess-emb': 'd',
          'transformer-postprocess-top': '', 'transformer-decoder-autoreg': 'self-attention',
          'transformer-no-projection': False, 'transformer-guided-alignment-layer': 'last'}


def npy(value):
    stream = io.BytesIO()
    np.save(stream, value)
    return stream.getvalue()


def npz(path, config=CONFIG, extra=None):
    raw = (yaml.safe_dump(config).encode() if isinstance(config, dict) else config) + b'\0'
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_STORED) as archive:
        archive.writestr('special:model.yml.npy', npy(np.frombuffer(raw, dtype='int8')))
        for name, content in (extra or {'Wemb.npy': npy(np.zeros((3, 4), dtype='float32'))}).items():
            archive.writestr(name, content)


def archive_spec(path):
    with zipfile.ZipFile(path) as archive:
        entries = [{'name': e.filename, 'bytes': e.file_size, 'compressed': e.compress_size,
                    'offset': e.header_offset, 'crc32': f'{e.CRC:08x}'} for e in archive.infolist()]
    return {'archive': {'bytes': path.stat().st_size, 'entries': entries}, 'metadata': []}


class MarianSourceTests(unittest.TestCase):
    def test_verified_lock_does_not_accept_stale_metadata_or_enable_runtime(self):
        manifest = json.loads((ROOT / 'docs/experiments/marian-source-preflight.json').read_text('utf8'))
        lock = json.loads((ROOT / 'docs/experiments/marian-verified-sources.json').read_text('utf8'))
        self.assertEqual(validate_source_lock(lock, manifest), lock)
        report = json.loads((ROOT / 'docs/reports/quality-model-sources-2026-10-29.json').read_text('utf8'))
        self.assertEqual(report['inspectorSha256'], source_sha256(ROOT / 'scripts/inspect_marian.py'))
        self.assertEqual(report['verifiedLockSha256'], source_sha256(ROOT / 'docs/experiments/marian-verified-sources.json'))
        self.assertFalse(report['conversionAttempted'])
        self.assertEqual({s['direction']: s['archiveSha256'] for s in report['sources']},
                         {s['direction']: s['archiveSha256'] for s in lock['sources']})
        edited = copy.deepcopy(lock)
        edited['runtimeActivation'] = True
        with self.assertRaisesRegex(ValueError, 'SOURCE_LOCK_BOUNDARY'):
            validate_source_lock(edited, manifest)
        edited = copy.deepcopy(lock)
        edited['sources'][0]['extractedFiles'][0]['sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'SOURCE_LOCK_METADATA_CHANGED'):
            validate_source_lock(edited, manifest)

    def test_inspection_streams_without_loading_tensor_arrays_or_pickle(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'test.npz'
            npz(path)
            with patch.object(np, 'load', side_effect=AssertionError('No ndarray payload loading')):
                result = inspect_npz(path)
            self.assertTrue(result['configurationPrecheckSupported'])
            self.assertTrue(result['allNestedMemberCrcsVerified'])
            self.assertFalse(result['tensorArraysLoaded'])
            self.assertFalse(result['fullConverterCompatibilityVerified'])
            self.assertFalse(result['pickleAllowed'])
            self.assertEqual(result['arrayCount'], 2)

    def test_pickle_paths_and_duplicate_members_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'test.npz'
            npz(path, extra={'object.npy': npy(np.array([{}], dtype=object))})
            with self.assertRaisesRegex(ValueError, 'NPY_DTYPE_OR_SHAPE'):
                inspect_npz(path)
            npz(path, extra={'../outside.npy': npy(np.zeros(1))})
            with self.assertRaisesRegex(ValueError, 'NPZ_ENTRY'):
                inspect_npz(path)
            npz(path)
            with zipfile.ZipFile(path, 'a') as archive:
                import warnings
                with warnings.catch_warnings():
                    warnings.simplefilter('ignore', UserWarning)
                    archive.writestr('Wemb.npy', npy(np.ones(1)))
            with self.assertRaisesRegex(ValueError, 'NPZ_INVENTORY_LIMIT'):
                inspect_npz(path)

    def test_array_and_yaml_config_bounds_fail_without_large_allocations(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'test.npz'
            npz(path)
            with patch('inspect_marian.MAX_ARRAY_BYTES', 8):
                with self.assertRaisesRegex(ValueError, 'NPY_ARRAY_BOUND'):
                    inspect_npz(path)
            npz(path, config=b' ' * (64 * 1024 + 1))
            with self.assertRaisesRegex(ValueError, 'NPZ_CONFIG_BOUND'):
                inspect_npz(path)
            npz(path, config=b'!!python/object/apply:os.system ["never-run"]')
            with self.assertRaises(yaml.YAMLError):
                inspect_npz(path)

    def test_tensor_payload_crc_corruption_is_detected_without_inference(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'test.npz'
            npz(path)
            with zipfile.ZipFile(path) as archive:
                entry = archive.getinfo('Wemb.npy')
                offset = entry.header_offset + 30 + len(entry.filename) + len(entry.extra) + entry.file_size - 1
            raw = bytearray(path.read_bytes())
            raw[offset] ^= 1
            path.write_bytes(raw)
            with self.assertRaises(zipfile.BadZipFile):
                inspect_npz(path)

    def test_supported_configuration_precheck_is_not_converter_compatibility(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'test.npz'
            for changes in ({'type': 'rnn'}, {'transformer-no-projection': True},
                            {'transformer-postprocess': 'invalid'}):
                npz(path, config={**CONFIG, **changes})
                self.assertFalse(inspect_npz(path)['configurationPrecheckSupported'])

    def test_archive_identity_and_metadata_are_checked_before_reuse(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'source.zip'
            with zipfile.ZipFile(path, 'w') as archive:
                archive.writestr('README.md', b'Upstream notice')
            source = archive_spec(path)
            sha = digest(path)
            self.assertEqual(verify_archive(path, source, sha), sha)
            with self.assertRaisesRegex(ValueError, 'ARCHIVE_IDENTITY'):
                verify_archive(path, source, '0' * 64)
            with self.assertRaisesRegex(ValueError, 'ARCHIVE_SHA256_REQUIRED'):
                verify_archive(path, source, None)
            source['metadata'] = [{'name': 'README.md', 'bytes': 15, 'sha256': '0' * 64}]
            with patch('inspect_marian.shutil.disk_usage', return_value=SimpleNamespace(free=20 * 1024**3)):
                with self.assertRaisesRegex(ValueError, 'EXTRACTED_METADATA_CHANGED'):
                    extract_source(path, source, Path(directory) / 'new')

    def test_zip_traversal_and_symlink_entries_fail_before_extraction(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'source.zip'
            with zipfile.ZipFile(path, 'w') as archive:
                archive.writestr('../outside', b'blocked')
            with self.assertRaisesRegex(ValueError, 'METADATA_NAME'):
                verify_archive(path, archive_spec(path), digest(path))
            entry = zipfile.ZipInfo('link')
            entry.create_system = 3
            entry.external_attr = 0o120777 << 16
            with zipfile.ZipFile(path, 'w') as archive:
                archive.writestr(entry, b'outside')
            with self.assertRaisesRegex(ValueError, 'ARCHIVE_ENTRY_TYPE'):
                verify_archive(path, archive_spec(path), digest(path))

    def test_existing_extraction_and_low_disk_are_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'source.zip'
            with zipfile.ZipFile(path, 'w') as archive:
                archive.writestr('README.md', b'notice')
            folder = Path(directory) / 'out'
            folder.mkdir()
            with self.assertRaisesRegex(ValueError, 'EXTRACTION_EXISTS'):
                extract_source(path, archive_spec(path), folder)
            with patch('inspect_marian.shutil.disk_usage', return_value=SimpleNamespace(free=0)):
                with self.assertRaisesRegex(ValueError, 'EXTRACTION_RESOURCE_BOUND'):
                    extract_source(path, archive_spec(path), Path(directory) / 'blocked')

    def test_cached_extraction_corruption_extra_files_and_excessive_footprint_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            path = folder / 'README.md'
            path.write_bytes(b'notice')
            files = [{'name': path.name, 'bytes': 6, 'sha256': digest(path)}]
            self.assertEqual(verify_extracted(folder, files), files)
            path.write_bytes(b'edited')
            with self.assertRaisesRegex(ValueError, 'EXTRACTED_IDENTITY_CHANGED'):
                verify_extracted(folder, files)
            (folder / 'unexpected').write_bytes(b'no')
            with self.assertRaisesRegex(ValueError, 'EXTRACTED_INVENTORY_CHANGED'):
                verify_extracted(folder, files)
            for i in range(127):
                (folder / str(i)).write_bytes(b'x')
            with self.assertRaisesRegex(ValueError, 'EXPERIMENT_DISK_BUDGET'):
                footprint_bytes(folder)


if __name__ == '__main__':
    unittest.main()

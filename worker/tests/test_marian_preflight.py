"""Research preflight must not authorize downloads or disguise incomplete identities."""
import copy
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from preflight_marian import (MANIFEST, admission, available_memory, piece_coverage,
                             plain_name, source_sha256, validate_manifest, verify_metadata)


class MarianPreflightTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads(MANIFEST.read_text('utf8'))

    def test_sources_retain_archive_identity_metadata_and_distinct_tokenizers(self):
        document = validate_manifest(copy.deepcopy(self.manifest))
        self.assertEqual(sum(s['archive']['bytes'] for s in document['sources']), 1150647069)
        for source in document['sources']:
            self.assertIsNone(source['archive']['publisherSha256'])
            self.assertIsNone(source['archive']['observedSha256'])
            self.assertEqual(source['licenseInArchive'], 'CC-BY-4.0')
            hashes = {f['name']: f['sha256'] for f in source['metadata']}
            self.assertNotEqual(hashes[source['sourceTokenizer']], hashes[source['targetTokenizer']])

    def test_published_snapshot_binds_the_current_lf_source_and_manifest(self):
        report = json.loads((ROOT / 'docs/reports/quality-model-preflight-2026-10-29.json').read_text('utf8'))
        self.assertEqual(report['sourceHashNormalization'], 'lf')
        self.assertEqual(report['preflightScriptSha256'], source_sha256(ROOT / 'scripts/preflight_marian.py'))
        self.assertEqual(report['manifestSha256'], source_sha256(MANIFEST))
        self.assertEqual({s['direction']: s['metadata'] for s in report['sources']},
                         {s['direction']: s['metadata'] for s in self.manifest['sources']})

    def test_activation_flags_duplicate_sources_and_malformed_identities_are_rejected(self):
        for field in ('downloadEnabled', 'runtimeActivation', 'completeDownloadLock'):
            document = copy.deepcopy(self.manifest)
            document[field] = True
            with self.assertRaisesRegex(ValueError, 'PREFLIGHT_ONLY'):
                validate_manifest(document)
        document = copy.deepcopy(self.manifest)
        document['sources'][1] = document['sources'][0]
        with self.assertRaisesRegex(ValueError, 'SOURCE_DIRECTIONS'):
            validate_manifest(document)
        for replacement in ('http://object.pouta.csc.fi/Tatoeba-MT-models/model.zip',
                            'https://object.pouta.csc.fi.attacker.test/Tatoeba-MT-models/model.zip',
                            'https://user@object.pouta.csc.fi/Tatoeba-MT-models/model.zip'):
            document = copy.deepcopy(self.manifest)
            document['sources'][0]['archive']['url'] = replacement
            with self.assertRaisesRegex(ValueError, 'SOURCE_IDENTITY'):
                validate_manifest(document)

    def test_archive_catalogue_size_and_metadata_duplicates_fail_closed(self):
        document = copy.deepcopy(self.manifest)
        document['sources'][0]['archive']['unpackedBytes'] += 1
        with self.assertRaisesRegex(ValueError, 'ARCHIVE_BOUNDS'):
            validate_manifest(document)
        document = copy.deepcopy(self.manifest)
        document['sources'][0]['metadata'].append(document['sources'][0]['metadata'][0])
        with self.assertRaisesRegex(ValueError, 'METADATA_DUPLICATE'):
            validate_manifest(document)
        document = copy.deepcopy(self.manifest)
        document['resourcePolicy']['temporaryBudgetBytes'] = 0
        with self.assertRaisesRegex(ValueError, 'RESOURCE_POLICY'):
            validate_manifest(document)

    def test_resource_check_requires_reserve_ram_and_exact_dependencies(self):
        versions = self.manifest['dependencies']
        ready = admission(self.manifest, 20 * 1024**3, 5 * 1024**3, versions)
        self.assertTrue(ready['resourcesAndDependenciesReady'])
        for report in (admission(self.manifest, 14 * 1024**3, 5 * 1024**3, versions),
                       admission(self.manifest, 20 * 1024**3, 1024**3, versions),
                       admission(self.manifest, 20 * 1024**3, None, versions),
                       admission(self.manifest, 20 * 1024**3, 5 * 1024**3, {**versions, 'numpy': 'other'})):
            self.assertFalse(report['resourcesAndDependenciesReady'])
        # Even a resource pass must never authorize a download, conversion or promotion.
        for field in ('downloadAllowed', 'conversionAllowed', 'runtimePromotion'):
            self.assertFalse(ready[field])

    def test_no_memory_probe_fallback_treats_unknown_as_safe(self):
        with patch('preflight_marian.sys.platform', 'unsupported'):
            self.assertIsNone(available_memory())

    def test_local_metadata_is_bounded_hashed_and_never_executed(self):
        raw = b'never execute metadata'
        source = {'metadata': [{'name': 'preprocess.sh', 'bytes': len(raw),
                                'sha256': hashlib.sha256(raw).hexdigest()}]}
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            with self.assertRaisesRegex(ValueError, 'METADATA_SIZE_OR_MISSING'):
                verify_metadata(folder, source)
            (folder / 'preprocess.sh').write_bytes(raw)
            self.assertEqual(verify_metadata(folder, source), source['metadata'])
            (folder / 'preprocess.sh').write_bytes(b'x' * len(raw))
            with self.assertRaisesRegex(ValueError, 'METADATA_SHA256'):
                verify_metadata(folder, source)
            source['metadata'][0]['name'] = '../outside.txt'
            with self.assertRaisesRegex(ValueError, 'METADATA_NAME'):
                verify_metadata(folder, source)

    def test_escape_names_and_metadata_links_are_refused(self):
        for name in ('../outside', 'C:secret', 'folder/file', 'folder\\file', '..', '.. ', 'file.', '', 'bad\x00name'):
            with self.assertRaisesRegex(ValueError, 'METADATA_NAME'):
                plain_name(name)
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(Path, 'is_symlink', return_value=True):
                with self.assertRaisesRegex(ValueError, 'METADATA_LINK'):
                    verify_metadata(Path(directory), {'metadata': []})

    def test_piece_gaps_and_distinct_id_spaces_remain_visible(self):
        class Tokenizer:
            tokens = ['<unk>', '<s>', '</s>', 'word', 'missing']
            def get_piece_size(self): return len(self.tokens)
            def id_to_piece(self, i): return self.tokens[i]
            def piece_to_id(self, token): return self.tokens.index(token)
            def is_control(self, i): return self.tokens[i] in ('<s>', '</s>')
            def bos_id(self): return 1
            def eos_id(self): return 2
        coverage = piece_coverage(Tokenizer(), ['</s>', '<unk>', 'word'])
        self.assertFalse(coverage['allPiecesInVocabulary'])
        self.assertEqual(coverage['missingControlPieces'], ['<s>'])
        self.assertEqual(coverage['missingOrdinaryPieceCount'], 1)
        self.assertTrue(coverage['unknownFallbackMustBeValidated'])
        self.assertEqual(coverage['sentencepieceEosId'], 2)
        self.assertEqual(coverage['marianEosVocabularyId'], 0)
        with self.assertRaisesRegex(ValueError, 'VOCABULARY_SPECIAL_TOKENS'):
            piece_coverage(Tokenizer(), ['word'])


if __name__ == '__main__':
    unittest.main()

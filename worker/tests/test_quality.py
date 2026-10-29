"""Model-free tests for baseline scoring, frozen inputs and review integrity."""
import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from benchmark_quality import measure_sample, prepare
from quality_metrics import (CONDITIONS, NORMALIZATION, RUBRIC, aggregate, apply_reviews,
                             compare, decode_wav, encode_wav, load_corpus, review_items,
                             score, tokens, variants)


class QualityScoringTests(unittest.TestCase):
    def test_edit_counts_and_micro_average_do_not_hide_short_failures(self):
        wrong = score('one two three', 'one four five six', 'en')
        self.assertEqual((wrong['substitutions'], wrong['insertions'], wrong['deletions']), (2, 1, 0))
        empty = score('keep the backup', '', 'en')
        self.assertEqual((empty['wer'], empty['deletions']), (1, 3))
        long = score('one two three four five six seven eight nine', 'one two three four five six seven eight nine', 'en')
        result = aggregate([{'scores': empty, 'errors': ['asr:empty']}, {'scores': long, 'errors': []},
                            {'scores': None, 'errors': ['asr:RuntimeError']}])
        self.assertEqual(result['wer'], .25)
        self.assertEqual((result['samples'], result['scoredSamples'], result['failedSamples']), (3, 2, 2))
        self.assertIsNone(aggregate([{'scores': None, 'errors': ['fixture:missing']}])['wer'])

    def test_language_case_negations_digits_and_times_are_preserved(self):
        self.assertEqual(tokens('IŞIK İÇİN', 'tr'), ['ışık', 'için'])
        self.assertEqual(tokens('I didn’t say delete.', 'en'), ['i', "didn't", 'say', 'delete'])
        self.assertGreater(score('I cannot hear it', 'I can hear it', 'en')['wer'], 0)
        self.assertGreater(score('fifteen not fifty', '15 not 50', 'en')['wer'], 0)
        self.assertGreater(score('3:15', '3:50', 'en')['cer'], 0)
        self.assertGreater(score('şimdi kapat', 'simdi kapat', 'tr')['cer'], 0)
        self.assertIsNone(score('', 'unexpected speech', 'en')['wer'])

    def test_corpus_split_is_balanced_and_rejects_duplicate_or_oversize_sources(self):
        document, rows = load_corpus(ROOT / 'examples/quality/corpus.json')
        self.assertEqual(len(rows), 60)
        for language in ('en', 'tr'):
            self.assertEqual(sum(r['sourceLanguage'] == language and r['split'] == 'holdout' for r in rows), 6)
        scratch = ROOT / 'artifacts/quality-tests'
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch) as directory:
            path = Path(directory) / 'corpus.json'
            bad = copy.deepcopy(document)
            bad['cases'][1]['id'] = bad['cases'][0]['id']
            path.write_text(json.dumps(bad), 'utf8')
            with self.assertRaisesRegex(ValueError, 'CORPUS_ID'):
                load_corpus(path)
            bad = copy.deepcopy(document)
            bad['cases'][0]['text']['tr'] = 'a' * 321
            path.write_text(json.dumps(bad), 'utf8')
            with self.assertRaisesRegex(ValueError, 'CORPUS_TEXT'):
                load_corpus(path)

    def test_transforms_reuse_clean_bytes_and_are_seeded_bounded_wav(self):
        import numpy as np
        rate = 16000
        source = encode_wav(rate, .2 * np.sin(np.arange(rate) * .08))
        first, repeated, other = variants(source, 15), variants(source, 15), variants(source, 16)
        self.assertEqual(first[0][1], source)
        self.assertEqual(first, repeated)
        self.assertNotEqual(first[1][1], other[1][1])
        self.assertEqual(first[2][1], other[2][1])
        _, pause = decode_wav(first[2][1])
        self.assertEqual(len(pause), rate + round(rate * .45))
        _, noisy = decode_wav(first[1][1])
        _, original = decode_wav(source)
        snr = 20 * np.log10(np.sqrt(np.mean(original ** 2)) / np.sqrt(np.mean((noisy - original) ** 2)))
        self.assertAlmostEqual(snr, 20, places=1)
        with self.assertRaisesRegex(ValueError, 'SYNTHETIC_SOURCE_SILENT'):
            variants(encode_wav(rate, np.zeros(rate)), 0)
        # A tiny but valid source does not crash the insertion-window search.
        self.assertEqual(len(variants(encode_wav(rate, np.array([.2])), 0)), 3)


def sample_rows():
    _, references = load_corpus(ROOT / 'examples/quality/corpus.json')
    return [{**reference, 'sampleId': reference['sourceId'] + '-' + condition,
             'condition': condition, 'audioSha256': 'a' * 64,
             'recognized': reference['reference'], 'translation': reference['targetReference'],
             'directTranslation': reference['targetReference'], 'scores': score(reference['reference'], reference['reference'], reference['sourceLanguage']),
             'timings': {}, 'errors': []}
            for reference in references for condition in CONDITIONS]


class QualityEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.report = {'evaluationId': 'experiment-one', 'rows': sample_rows(),
                       'identity': dict.fromkeys(('corpusSha256', 'fixtureSetSha256', 'scorerSha256'), 'f' * 64),
                       'host': {'processor': 'fixture-cpu'}}
        self.report['identity']['normalization'] = NORMALIZATION

    def test_cached_fixtures_do_not_bypass_current_model_integrity(self):
        scratch = ROOT / 'artifacts/quality-tests'
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch) as directory:
            cached = Path(directory)
            (cached / 'manifest.json').write_text('{}', 'utf8')
            with patch('benchmark_quality.model_identity', side_effect=ValueError('MODIFIED_MODELS')) as verify, \
                 patch('benchmark_quality.fixtures') as reuse, patch('benchmark_quality.create_engine') as inference:
                with self.assertRaisesRegex(ValueError, 'MODIFIED_MODELS'):
                    prepare(cached, Path('unused-test-models'))
                verify.assert_called_once_with(Path('unused-test-models'))
                reuse.assert_not_called()
                inference.assert_not_called()

    def test_reviews_deduplicate_conditions_but_bind_exact_experiment_and_outputs(self):
        items = review_items(self.report)
        self.assertEqual(len(items), 120)
        self.assertEqual(len(items[0]['sampleIds']), 3)
        review = {'evaluationId': self.report['evaluationId'], 'rubricVersion': RUBRIC, 'items': items}
        result = apply_reviews(self.report, review)
        self.assertEqual(result['counts']['pending'], 120)
        self.assertEqual(result['counts']['pass'], 0)
        bad = copy.deepcopy(review)
        bad['evaluationId'] = 'old-experiment'
        with self.assertRaisesRegex(ValueError, 'STALE_REVIEW'):
            apply_reviews(self.report, bad)
        bad = copy.deepcopy(review)
        bad['items'][0]['output'] = 'edited after scoring'
        with self.assertRaisesRegex(ValueError, 'EVIDENCE_CHANGED'):
            apply_reviews(self.report, bad)
        bad = copy.deepcopy(review)
        bad['items'][-1] = bad['items'][0]
        with self.assertRaisesRegex(ValueError, 'INCOMPLETE_OR_DUPLICATE'):
            apply_reviews(self.report, bad)
        review['items'][0]['verdict'] = 'pass'
        with self.assertRaisesRegex(ValueError, 'REVIEW_REASON_REQUIRED'):
            apply_reviews(self.report, review)

    def test_comparison_rejects_different_audio_and_incomplete_inputs(self):
        candidate = copy.deepcopy(self.report)
        self.assertTrue(compare(self.report, candidate)['timingsComparable'])
        candidate['host']['processor'] = 'different-cpu'
        self.assertFalse(compare(self.report, candidate)['timingsComparable'])
        candidate['rows'][0]['audioSha256'] = 'b' * 64
        with self.assertRaisesRegex(ValueError, 'INPUT_MISMATCH'):
            compare(self.report, candidate)
        candidate = copy.deepcopy(self.report)
        candidate['rows'].append(candidate['rows'][0])
        with self.assertRaisesRegex(ValueError, 'INCOMPLETE'):
            compare(self.report, candidate)
        candidate = copy.deepcopy(self.report)
        candidate['identity']['normalization'] = 'maps-numbers-away'
        with self.assertRaisesRegex(ValueError, 'INPUT_MISMATCH'):
            compare(self.report, candidate)

    def test_pipeline_keeps_stage_failures_and_scores_empty_recognition(self):
        reference = load_corpus(ROOT / 'examples/quality/corpus.json')[1][0]
        fixture = {'sampleId': 'en-01-clean', 'condition': 'clean', 'audioSha256': 'a' * 64}
        class EmptyEngine:
            def recognize(self, data, language):
                return ''
            def translate(self, *args):
                raise AssertionError('Empty recognition must not be translated')
        row = measure_sample(EmptyEngine(), reference, fixture, b'fixture', {'text': 'reference output'})
        self.assertEqual(row['scores']['wer'], 1)
        self.assertEqual(row['errors'], ['asr:empty'])
        self.assertIsNone(row['timings']['pipelineMs'])
        fixture['error'] = 'source-synthesis:RuntimeError'
        row = measure_sample(EmptyEngine(), reference, fixture, None, {})
        self.assertIsNone(row['scores'])
        self.assertEqual(row['errors'], [fixture['error']])


if __name__ == '__main__':
    unittest.main()

"""Offline tests for research cohort boundaries and fail-closed promotion evidence."""
import copy
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from probe_sentence_translation import screen, segmented, sentence_spans
from quality_metrics import fingerprint, read_json
from translation_screen_review import assess, review_template


class FakeEngine:
    def __init__(self, baseline):
        self.outputs = {}
        for row in baseline['rows']:
            key = (row['sourceLanguage'], row['targetLanguage'])
            self.outputs[*key, row['reference']] = row['directTranslation']
            self.outputs[*key, row['recognized']] = row['translation']

    def translate(self, text, source, target):
        return self.outputs.get((source, target, text), 'Synthetic output: ' + text)


class TranslationScreenTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.baseline = read_json(ROOT / 'docs/reports/quality-baseline-alpha7-2026-10-29.json')
        cls.items = screen(cls.baseline, FakeEngine(cls.baseline))

    def report(self):
        identity = {'baselineEvaluationId': self.baseline['evaluationId'], 'adapter': 'synthetic-test'}
        return {'identity': identity, 'evaluationId': fingerprint(identity), 'items': copy.deepcopy(self.items)}

    def test_screen_never_exercises_reserved_holdout_and_covers_every_development_pair(self):
        pairs = [(name, item['route']) for item in self.items for name in item['sampleIds']]
        expected = {(r['sampleId'], route) for r in self.baseline['rows'] if r['split'] == 'development'
                    for route in ('direct', 'pipeline')}
        self.assertEqual(len(pairs), 288)
        self.assertEqual(set(pairs), expected)
        self.assertTrue(all(int(item['sourceId'][3:]) % 5 != 0 for item in self.items))
        self.assertTrue(all(item['controlMatchesBaseline'] for item in self.items))

    def test_conservative_research_split_retains_decimal_time_url_and_abbreviations(self):
        text = 'Dr. Ada checks 3.14 at 10:30. Then visits https://example.test/path. Keep the link.'
        spans = sentence_spans(text)
        self.assertEqual(' '.join(spans), text)
        self.assertTrue(spans[0].startswith('Dr. Ada checks 3.14 at 10:30.'))
        self.assertTrue(any('https://example.test/path.' in part for part in spans))
        # Ambiguous URL punctuation may deliberately leave later sentences joined.
        self.assertIn('Keep the link.', ' '.join(spans))

    def test_research_adapter_rejects_empty_excessive_and_partial_output(self):
        fake = FakeEngine(self.baseline)
        for text in ('', 'a' * 1201):
            with self.assertRaisesRegex(ValueError, 'TEXT_LIMIT'):
                segmented(fake, text, 'en', 'tr')
        with self.assertRaisesRegex(ValueError, 'SEGMENT_LIMIT'):
            segmented(fake, 'Wait. ' * 17, 'en', 'tr')
        class Empty:
            def translate(self, *args):
                return ''
        with self.assertRaisesRegex(ValueError, 'EMPTY_SEGMENT'):
            segmented(Empty(), 'Please wait.', 'en', 'tr')
        self.assertEqual(segmented(Empty(), 'Original text.', 'en', 'en'), 'Original text.')

    def test_pending_new_outputs_cannot_pass_and_one_regression_rejects_early(self):
        report = self.report()
        template = review_template(self.baseline, report)
        changed = next(i for i in template['items'] if i['baselineVerdict'] == 'pass' and i['provenance'] == 'new-review-required')
        self.assertEqual(assess(self.baseline, report, template)['status'], 'incomplete-review')
        changed.update(verdict='fail', reason='Synthetic deliberate loss of a required fact.')
        result = assess(self.baseline, report, template)
        self.assertEqual(result['status'], 'rejected-development')
        self.assertFalse(result['runtimePromotion'])
        self.assertGreater(result['counts']['pending'], 0)

    def test_stale_or_edited_judgments_do_not_bind_to_new_outputs(self):
        report = self.report()
        template = review_template(self.baseline, report)
        template['evaluationId'] = 'another-run'
        with self.assertRaisesRegex(ValueError, 'SCREEN_STALE_REVIEW'):
            assess(self.baseline, report, template)
        template = review_template(self.baseline, report)
        template['items'][0]['candidate'] = 'Edited after judgment'
        with self.assertRaisesRegex(ValueError, 'SCREEN_REVIEW_EVIDENCE_CHANGED'):
            assess(self.baseline, report, template)

    def test_missing_duplicate_holdout_or_modified_control_is_rejected(self):
        report = self.report()
        report['items'].pop()
        with self.assertRaisesRegex(ValueError, 'SCREEN_INCOMPLETE'):
            review_template(self.baseline, report)
        report = self.report()
        report['items'].append(report['items'][0])
        with self.assertRaisesRegex(ValueError, 'SCREEN_SAMPLE_DUPLICATE_OR_HOLDOUT'):
            review_template(self.baseline, report)
        report = self.report()
        report['items'][0]['sampleIds'][0] = 'en-05-clean'
        with self.assertRaisesRegex(ValueError, 'SCREEN_SAMPLE_DUPLICATE_OR_HOLDOUT'):
            review_template(self.baseline, report)
        report = self.report()
        report['items'][0]['control'] = 'A changed control is not a candidate improvement'
        with self.assertRaisesRegex(ValueError, 'SCREEN_CONTROL_MISMATCH'):
            review_template(self.baseline, report)

    def test_same_output_review_keeps_original_provenance_and_cannot_be_relabelled(self):
        report = self.report()
        for item in report['items']:
            item['candidate'] = item['baseline']
        template = review_template(self.baseline, report)
        self.assertTrue(all(i['provenance'] == 'identical-baseline-ai-review' for i in template['items']))
        self.assertEqual(assess(self.baseline, report, template)['status'], 'insufficient-improvement')
        template['items'][0].update(verdict='fail', reason='Cannot silently rewrite the historical review')
        with self.assertRaisesRegex(ValueError, 'SCREEN_INHERITED_REVIEW_CHANGED'):
            assess(self.baseline, report, template)


if __name__ == '__main__':
    unittest.main()

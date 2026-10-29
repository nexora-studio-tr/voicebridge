"""Bind development-screen judgments to exact evidence; never auto-promote a runtime."""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

from benchmark_quality import named_directory, write_json
from quality_metrics import fingerprint, read_json

RUBRIC = 'translation-development-screen-v1'


def evidence(baseline, report):
    if report['identity']['baselineEvaluationId'] != baseline['evaluationId'] or fingerprint(report['identity']) != report['evaluationId']:
        raise ValueError('SCREEN_IDENTITY')
    rows = {r['sampleId']: r for r in baseline['rows'] if r['split'] == 'development'}
    if len(rows) != 144 or len({r['sampleId'] for r in baseline['rows']}) != 180:
        raise ValueError('BASELINE_COVERAGE')
    originals = {r['key']: r for r in baseline['criticalReview']['items']}
    expected = {(name, route) for name in rows for route in ('direct', 'pipeline')}
    seen, items = set(), []
    for item in report['items']:
        route = item.get('route')
        if route not in ('direct', 'pipeline') or not item.get('sampleIds'):
            raise ValueError('SCREEN_ROUTE')
        key = item.get('baselineReviewKey')
        if key not in originals:
            raise ValueError('SCREEN_REVIEW_LINK')
        original = originals[key]
        if original['output'] != item['baseline'] or any(original[k] != item[k] for k in ('sourceId', 'route', 'criticalFacts')):
            raise ValueError('SCREEN_BASELINE_REVIEW_CHANGED')
        for name in item['sampleIds']:
            if (name, route) in seen or name not in rows:
                raise ValueError('SCREEN_SAMPLE_DUPLICATE_OR_HOLDOUT')
            row = rows[name]
            input_text = row['reference'] if route == 'direct' else row['recognized']
            output = row['directTranslation'] if route == 'direct' else row['translation']
            if any(item[k] != row[k] for k in ('sourceId', 'targetReference', 'criticalFacts')) or item['input'] != input_text or item['baseline'] != output or row['reviewKeys'][route] != key:
                raise ValueError('SCREEN_INPUT_CHANGED')
            seen.add((name, route))
        if item['control'] != item['baseline'] or not item['controlMatchesBaseline']:
            raise ValueError('SCREEN_CONTROL_MISMATCH')
        if not isinstance(item['candidate'], str) or not item['candidate'].strip() or len(item['candidate']) > 1200:
            raise ValueError('SCREEN_OUTPUT')
        review_key = fingerprint({'evaluationId': report['evaluationId'],
                                  **{k: item[k] for k in ('sourceId', 'route', 'input', 'candidate', 'criticalFacts', 'sampleIds')}})
        unchanged = item['candidate'] == item['baseline']
        items.append({'key': review_key, 'sourceId': item['sourceId'], 'route': route,
                      'input': item['input'], 'sampleIds': item['sampleIds'],
                      'criticalFacts': item['criticalFacts'], 'baseline': item['baseline'],
                      'candidate': item['candidate'], 'baselineVerdict': original['verdict'],
                      'verdict': original['verdict'] if unchanged else 'pending',
                      'reason': original['reason'] if unchanged else '',
                      'provenance': 'identical-baseline-ai-review' if unchanged else 'new-review-required'})
    if seen != expected:
        raise ValueError('SCREEN_INCOMPLETE')
    return items


def review_template(baseline, report):
    return {'evaluationId': report['evaluationId'], 'rubricVersion': RUBRIC,
            'reviewer': 'unassigned', 'kind': 'pending', 'items': evidence(baseline, report)}


def assess(baseline, report, review):
    expected = {i['key']: i for i in evidence(baseline, report)}
    if review.get('evaluationId') != report['evaluationId'] or review.get('rubricVersion') != RUBRIC:
        raise ValueError('SCREEN_STALE_REVIEW')
    supplied = review.get('items', [])
    if len(supplied) != len(expected) or {i['key'] for i in supplied} != set(expected):
        raise ValueError('SCREEN_REVIEW_COVERAGE')
    regressions, improvements, pending = [], set(), 0
    counts = Counter()
    stable_fields = ('sourceId', 'route', 'input', 'sampleIds', 'criticalFacts', 'baseline',
                     'candidate', 'baselineVerdict', 'provenance')
    for item in supplied:
        original = expected[item['key']]
        if any(item.get(k) != original[k] for k in stable_fields):
            raise ValueError('SCREEN_REVIEW_EVIDENCE_CHANGED')
        verdict = item.get('verdict')
        if verdict not in ('pass', 'fail', 'uncertain', 'pending'):
            raise ValueError('SCREEN_REVIEW_VERDICT')
        if verdict != 'pending' and not item.get('reason', '').strip():
            raise ValueError('SCREEN_REVIEW_REASON')
        if item['provenance'] == 'identical-baseline-ai-review' and (verdict != original['verdict'] or item['reason'] != original['reason']):
            raise ValueError('SCREEN_INHERITED_REVIEW_CHANGED')
        counts[verdict] += 1
        pending += verdict == 'pending'
        if item['baselineVerdict'] == 'pass' and verdict in ('fail', 'uncertain'):
            regressions.append({k: item[k] for k in ('key', 'sourceId', 'route', 'sampleIds', 'baseline', 'candidate', 'verdict', 'reason')})
        if item['baselineVerdict'] == 'fail' and verdict == 'pass':
            improvements.add(item['sourceId'] + '/' + item['route'])
    # Finding a regression is sufficient to reject early; pending judgments never count as success.
    status = ('rejected-development' if regressions else 'incomplete-review' if pending else
              'insufficient-improvement' if len(improvements) < 3 else 'development-only-pass')
    return {'schemaVersion': 1, 'status': status, 'runtimePromotion': False,
            'evaluationId': report['evaluationId'], 'reviewer': review.get('reviewer'),
            'reviewKind': review.get('kind'), 'rubricVersion': RUBRIC,
            'reviewUnit': 'Distinct source/route/input; sampleIds bind all affected clip/route pairs.',
            'counts': {k: counts[k] for k in ('pass', 'fail', 'uncertain', 'pending')},
            'regressions': regressions, 'improvedSourceRoutes': sorted(improvements),
            'limits': 'Development text screen only. No new ASR/TTS, holdout, full-pipeline timing, live or independent human acceptance. Even development-only-pass requires frozen full validation before promotion.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('template', 'assess'))
    parser.add_argument('--name', required=True)
    parser.add_argument('--review', type=Path)
    args = parser.parse_args()
    directory = named_directory('translation-screen', args.name)
    baseline = read_json(Path(__file__).resolve().parents[1] / 'docs/reports/quality-baseline-alpha7-2026-10-29.json')
    report = read_json(directory / 'report.json')
    if args.command == 'template':
        output = directory / 'review-template.json'
        if output.exists():
            raise ValueError('SCREEN_TEMPLATE_EXISTS')
        write_json(output, review_template(baseline, report))
        print(json.dumps({'status': 'review-template-created'}))
    else:
        if args.review is None:
            raise ValueError('SCREEN_REVIEW_REQUIRED')
        result = assess(baseline, report, read_json(args.review))
        write_json(directory / 'assessment.json', result)
        print(json.dumps({k: result[k] for k in ('status', 'runtimePromotion', 'counts', 'improvedSourceRoutes')}))


if __name__ == '__main__':
    main()

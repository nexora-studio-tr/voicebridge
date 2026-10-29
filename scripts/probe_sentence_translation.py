"""Development-only screen: translate sentence spans using unchanged installed models.

Research adapter, never imported by the runtime. No ASR/TTS, network or user data.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'worker'))
from engine import Engine
from benchmark_quality import model_identity, named_directory, write_json, versions
from quality_metrics import fingerprint, read_json

# Conservative span boundaries, not a learned sentence detector. Keep source punctuation.
ABBREVIATIONS = frozenset(('dr', 'mr', 'mrs', 'ms', 'prof', 'sr', 'jr', 'st',
                           'vs', 'e.g', 'i.e', 'etc', 'sn', 'doç', 'av', 'no'))
ENDINGS = re.compile(r'''[.!?]+["'”’»\)\]]*(?=\s+|$)''')


def sentence_spans(text):
    """Return exact, nonempty source spans; ambiguous boundaries remain in one span."""
    spans, start = [], 0
    for match in ENDINGS.finditer(text):
        prefix = text[:match.end()].rstrip('"\'”’») ]')
        mark = prefix[-1:]
        word = re.search(r'([^\s]+)\.$', prefix) if mark == '.' else None
        token = word.group(1).casefold() if word else ''
        # Abbreviations, initials/acronyms, numeric ordinals and URLs are ambiguous.
        if mark == '.' and (token in ABBREVIATIONS or (len(token) == 1 and token.isalpha())
                            or '.' in token or '/' in token or '@' in token or token.isdigit()):
            continue
        remainder = text[match.end():].lstrip()
        if remainder and not (remainder[0].isupper() or remainder[0].isdigit() or remainder[0] in '"“‘('):
            continue
        span = text[start:match.end()].strip()
        if span:
            spans.append(span)
        start = match.end()
    tail = text[start:].strip()
    if tail:
        spans.append(tail)
    return spans


def segmented(engine, text, source, target):
    # Do not add target words, force numbers/negation, or carry preceding speaker text.
    text = Engine.text(text)
    Engine.language(source)
    Engine.language(target)
    if source == target:
        return text
    spans = sentence_spans(text)
    if len(spans) > 16:
        raise ValueError('SEGMENT_LIMIT')
    outputs = [engine.translate(part, source, target) for part in spans]
    if any(not output.strip() for output in outputs):
        raise ValueError('EMPTY_SEGMENT')
    result = ' '.join(outputs)
    if len(result) > 1200:
        raise ValueError('OUTPUT_LIMIT')
    return result


def screen(baseline, engine):
    selected = [r for r in baseline['rows'] if r['split'] == 'development']
    if len(selected) != 144:
        raise ValueError('DEVELOPMENT_COVERAGE')
    items, cache = [], {}
    for row in selected:
        for route in ('direct', 'pipeline'):
            text = row['reference'] if route == 'direct' else row['recognized']
            original = row['directTranslation'] if route == 'direct' else row['translation']
            key = (row['sourceId'], route, text)
            if key in cache:
                if cache[key]['baseline'] != original:
                    raise ValueError('BASELINE_INPUT_OUTPUT_CONFLICT')
                cache[key]['sampleIds'].append(row['sampleId'])
                continue
            start = time.perf_counter()
            control = engine.translate(text, row['sourceLanguage'], row['targetLanguage'])
            control_ms = round((time.perf_counter() - start) * 1000, 2)
            start = time.perf_counter()
            candidate = segmented(engine, text, row['sourceLanguage'], row['targetLanguage'])
            candidate_ms = round((time.perf_counter() - start) * 1000, 2)
            item = {'sourceId': row['sourceId'], 'route': route, 'input': text,
                    'targetReference': row['targetReference'], 'criticalFacts': row['criticalFacts'],
                    'spans': sentence_spans(text), 'baseline': original, 'control': control,
                    'controlMatchesBaseline': control == original, 'candidate': candidate,
                    'sampleIds': [row['sampleId']], 'controlMs': control_ms, 'candidateMs': candidate_ms,
                    'baselineReviewKey': row.get('reviewKeys', {}).get(route)}
            cache[key] = item
            items.append(item)
    return items


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--name', default='sentence-c1')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', args.name):
        raise ValueError('INVALID_NAME')
    out = named_directory('translation-screen', args.name)
    if out.exists():
        raise ValueError('SCREEN_EXISTS')
    baseline = read_json(ROOT / 'docs/reports/quality-baseline-alpha7-2026-10-29.json')
    models = model_identity(ROOT / '.voicebridge/models')
    if models != baseline['identity']['models']:
        raise ValueError('MODELS_CHANGED')
    engine = Engine(ROOT / '.voicebridge/models')
    for source, target in (('en', 'tr'), ('tr', 'en')):
        engine.translate('Please wait.' if source == 'en' else 'Lütfen bekle.', source, target)
    items = screen(baseline, engine)
    identity = {'baselineEvaluationId': baseline['evaluationId'], 'models': models, 'runtime': versions(),
                'adapterSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                'engineSha256': hashlib.sha256((ROOT / 'worker/engine.py').read_bytes()).hexdigest()}
    report = {'schemaVersion': 1, 'candidate': 'C1: conservative per-sentence calls, unchanged decoder',
              'evaluationId': fingerprint(identity), 'identity': identity,
              'scope': 'Development only; frozen reference/recognized texts. No new ASR, TTS, audio or holdout evaluation.',
              'synthetic': True, 'paidApi': False, 'liveDiscord': False,
              'items': items, 'controlMismatches': sum(not i['controlMatchesBaseline'] for i in items),
              'changedOutputs': sum(i['candidate'] != i['baseline'] for i in items)}
    write_json(out / 'report.json', report)
    print(json.dumps({'items': len(items), 'controlMismatches': report['controlMismatches'],
                      'changedOutputs': report['changedOutputs'], 'evaluationId': report['evaluationId']}))


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    main()

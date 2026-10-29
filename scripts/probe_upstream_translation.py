"""C2 predeclared development screen: sentence batching with upstream Argos decoding.

No production imports, ASR/TTS, new model, network, provider or holdout evaluation.
"""
from __future__ import annotations

import hashlib
import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'worker'))
from engine import Engine
from benchmark_quality import model_identity, named_directory, write_json, versions
from probe_sentence_translation import sentence_spans
from quality_metrics import fingerprint, read_json


def candidate_translate(engine, text, source, target):
    text = Engine.text(text)
    Engine.language(source)
    Engine.language(target)
    if source == target:
        return text
    spans = sentence_spans(text)
    if len(spans) > 16:
        raise ValueError('SEGMENT_LIMIT')
    # The control warmup loads the same pinned handles; no cache carries speaker text.
    translator, processor = engine.translators[source + '_' + target]
    encoded = [processor.encode(part, out_type=str) for part in spans]
    results = translator.translate_batch(encoded, beam_size=4, max_decoding_length=256,
                                         replace_unknowns=True, length_penalty=0.2)
    if len(results) != len(spans):
        raise ValueError('TRANSLATION_COVERAGE')
    outputs = [processor.decode(result.hypotheses[0]).strip() for result in results]
    if any(not text for text in outputs):
        raise ValueError('EMPTY_SEGMENT')
    output = ' '.join(outputs)
    if len(output) > 1200:
        raise ValueError('OUTPUT_LIMIT')
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--name', default='upstream-c2')
    args = parser.parse_args()
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
            candidate = candidate_translate(engine, text, row['sourceLanguage'], row['targetLanguage'])
            candidate_ms = round((time.perf_counter() - start) * 1000, 2)
            item = {'sourceId': row['sourceId'], 'route': route, 'input': text,
                    'targetReference': row['targetReference'], 'criticalFacts': row['criticalFacts'],
                    'spans': sentence_spans(text), 'baseline': original, 'control': control,
                    'controlMatchesBaseline': control == original, 'candidate': candidate,
                    'sampleIds': [row['sampleId']], 'controlMs': control_ms, 'candidateMs': candidate_ms,
                    'baselineReviewKey': row.get('reviewKeys', {}).get(route)}
            cache[key] = item
            items.append(item)
    sources = ('worker/engine.py', 'scripts/probe_sentence_translation.py', 'scripts/probe_upstream_translation.py')
    identity = {'baselineEvaluationId': baseline['evaluationId'], 'models': models, 'runtime': versions(),
                'source': {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in sources}}
    report = {'schemaVersion': 1, 'candidate': 'C2: per-sentence batch; beam 4, unknown copy, length penalty 0.2; default repeat policies',
              'evaluationId': fingerprint(identity), 'identity': identity,
              'scope': 'Development only; frozen reference/recognized texts. No new ASR, TTS, audio or holdout evaluation.',
              'synthetic': True, 'paidApi': False, 'liveDiscord': False, 'items': items,
              'controlMismatches': sum(not i['controlMatchesBaseline'] for i in items),
              'changedOutputs': sum(i['candidate'] != i['baseline'] for i in items)}
    write_json(out / 'report.json', report)
    print(json.dumps({'items': len(items), 'controlMismatches': report['controlMismatches'],
                      'changedOutputs': report['changedOutputs'], 'evaluationId': report['evaluationId']}))


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    main()

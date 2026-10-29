"""Versioned scoring and synthetic-fixture transforms; no model or network access."""
from __future__ import annotations

import hashlib
import io
import json
import math
import re
import unicodedata
import wave
from collections import Counter
from pathlib import Path

RUBRIC = 'critical-facts-v1'
NORMALIZATION = 'nfc-language-case-unicode-tokens-v1'
CATEGORIES = ('numbers', 'time_dates', 'negation', 'names', 'commands', 'pauses')
CONDITIONS = ('clean', 'noise-20db', 'pause-stress')


def fingerprint(value):
    data = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(data.encode('utf8')).hexdigest()


def read_json(path: Path):
    if path.stat().st_size > 8 * 1024 * 1024:
        raise ValueError('JSON_SIZE_LIMIT')
    return json.loads(path.read_text('utf8'))


def load_corpus(path: Path):
    document = read_json(path)
    if document.get('schemaVersion') != 1 or len(document.get('cases', [])) != 30:
        raise ValueError('CORPUS_SCHEMA')
    seen, rows = set(), []
    counts = Counter()
    for case in document['cases']:
        name = case.get('id')
        category, split = case.get('category'), case.get('split')
        if not isinstance(name, str) or not re.fullmatch(r'\d{2}', name) or name in seen:
            raise ValueError('CORPUS_ID')
        seen.add(name)
        if category not in CATEGORIES or split not in ('development', 'holdout'):
            raise ValueError('CORPUS_GROUP')
        counts[category, split] += 1
        facts = case.get('criticalFacts')
        if not isinstance(facts, list) or not 1 <= len(facts) <= 5 or any(
            not isinstance(f, str) or not f.strip() or len(f) > 250 for f in facts
        ):
            raise ValueError('CORPUS_FACTS')
        for language in ('en', 'tr'):
            text = case.get('text', {}).get(language)
            if not isinstance(text, str) or not text.strip() or len(text) > 320 or any(
                ord(c) < 32 for c in text
            ) or not tokens(text, language):
                raise ValueError('CORPUS_TEXT')
        for language in ('en', 'tr'):
            target = 'tr' if language == 'en' else 'en'
            rows.append({'sourceId': language + '-' + name, 'sourceLanguage': language,
                         'targetLanguage': target, 'category': category, 'split': split,
                         'reference': case['text'][language], 'targetReference': case['text'][target],
                         'criticalFacts': facts})
    if seen != {f'{i:02}' for i in range(1, 31)} or any(
        counts[c, 'development'] != 4 or counts[c, 'holdout'] != 1 for c in CATEGORIES
    ):
        raise ValueError('CORPUS_SPLIT')
    return document, rows


def tokens(text: str, language: str):
    if language not in ('en', 'tr'):
        raise ValueError('UNSUPPORTED_LANGUAGE')
    text = unicodedata.normalize('NFC', text).replace('\u2019', "'")
    if language == 'tr':
        text = text.replace('I', '\u0131').replace('\u0130', 'i')
    text = text.lower()
    # Digits, times/decimal separators and negations survive. No number-word mapping.
    return re.findall(r"\d+(?:[.,:]\d+)*|[^\W_]+(?:'[^\W_]+)*", text, flags=re.UNICODE)


def distance(a, b):
    previous = list(range(len(b) + 1))
    for i, left in enumerate(a, 1):
        current = [i]
        for j, right in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j-1] + 1,
                               previous[j-1] + (left != right)))
        previous = current
    return previous[-1]


def edit_counts(reference, hypothesis):
    table = [list(range(len(hypothesis) + 1))]
    for i, left in enumerate(reference, 1):
        row = [i]
        for j, right in enumerate(hypothesis, 1):
            row.append(min(table[i-1][j] + 1, row[j-1] + 1,
                           table[i-1][j-1] + (left != right)))
        table.append(row)
    i, j = len(reference), len(hypothesis)
    counts = {'substitutions': 0, 'deletions': 0, 'insertions': 0}
    while i or j:
        if i and j and table[i][j] == table[i-1][j-1] + (reference[i-1] != hypothesis[j-1]):
            counts['substitutions'] += reference[i-1] != hypothesis[j-1]
            i -= 1
            j -= 1
        elif i and table[i][j] == table[i-1][j] + 1:
            counts['deletions'] += 1
            i -= 1
        else:
            counts['insertions'] += 1
            j -= 1
    return counts


def score(reference: str, hypothesis: str, language: str):
    ref, hyp = tokens(reference, language), tokens(hypothesis, language)
    counts = edit_counts(ref, hyp)
    ref_chars, hyp_chars = ' '.join(ref), ' '.join(hyp)
    errors, character_errors = sum(counts.values()), distance(ref_chars, hyp_chars)
    return {**counts, 'wordErrors': errors, 'referenceWords': len(ref),
            'characterErrors': character_errors, 'referenceCharacters': len(ref_chars),
            'wer': round(errors / len(ref), 6) if ref else None,
            'cer': round(character_errors / len(ref_chars), 6) if ref_chars else None}


def percentile(values, fraction):
    if not values:
        return None
    values = sorted(values)
    return values[max(0, math.ceil(len(values) * fraction) - 1)]


def aggregate(rows):
    scored = [r['scores'] for r in rows if r.get('scores') is not None]
    words = sum(s['referenceWords'] for s in scored)
    chars = sum(s['referenceCharacters'] for s in scored)
    errors = sum(s['wordErrors'] for s in scored)
    char_errors = sum(s['characterErrors'] for s in scored)
    timings = {}
    for stage in ('asrMs', 'translationMs', 'speechMs', 'pipelineMs'):
        values = [r['timings'][stage] for r in rows if r.get('timings', {}).get(stage) is not None]
        timings[stage] = {'n': len(values), 'p50': percentile(values, .5), 'p95': percentile(values, .95)}
    return {'samples': len(rows), 'scoredSamples': len(scored),
            'failedSamples': sum(bool(r['errors']) for r in rows),
            'wordErrors': errors, 'referenceWords': words,
            'characterErrors': char_errors, 'referenceCharacters': chars,
            'wer': round(errors / words, 6) if words else None,
            'cer': round(char_errors / chars, 6) if chars else None, 'timings': timings}


def summarize(rows):
    groups = {}
    for language in ('en', 'tr'):
        for condition in CONDITIONS:
            for split in ('all', 'development', 'holdout'):
                selected = [r for r in rows if r['sourceLanguage'] == language
                            and r['condition'] == condition and (split == 'all' or r['split'] == split)]
                groups[f'{language}/{condition}/{split}'] = aggregate(selected)
    return groups


def decode_wav(data):
    import numpy as np
    if len(data) > 2 * 1024 * 1024:
        raise ValueError('AUDIO_LIMIT')
    with wave.open(io.BytesIO(data), 'rb') as audio:
        rate = audio.getframerate()
        if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or rate not in (16000, 22050, 24000, 44100, 48000):
            raise ValueError('AUDIO_FORMAT')
        samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype='<i2').astype(np.float64) / 32768
    if not 0 < len(samples) / rate <= 20 or not np.isfinite(samples).all():
        raise ValueError('AUDIO_DURATION')
    return rate, samples


def encode_wav(rate, samples):
    import numpy as np
    result = io.BytesIO()
    with wave.open(result, 'wb') as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        audio.writeframes((np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes())
    return result.getvalue()


def variants(data, seed):
    import numpy as np
    rate, samples = decode_wav(data)
    if len(samples) / rate > 19.5:
        raise ValueError('SYNTHETIC_SOURCE_TOO_LONG_FOR_PAUSE')
    rms = float(np.sqrt(np.mean(samples ** 2)))
    if rms < .003:
        raise ValueError('SYNTHETIC_SOURCE_SILENT')
    noise = np.random.Generator(np.random.PCG64(seed)).normal(size=len(samples))
    noise *= rms / (10 * float(np.sqrt(np.mean(noise ** 2))))
    noisy = samples + noise
    window = max(1, round(rate * .04))
    first = min(len(samples) - 1, round(len(samples) * .3))
    starts = range(first, max(first + 1, round(len(samples) * .7)), window)
    start = min(starts, key=lambda i: float(np.mean(samples[i:i+window] ** 2)))
    boundary = min(len(samples), start + window // 2)
    quiet = float(np.sqrt(np.mean(samples[start:start+window] ** 2))) < .005
    paused = np.concatenate((samples[:boundary], np.zeros(round(rate * .45)), samples[boundary:]))
    return [
        ('clean', data, {'transform': 'none', 'sourceRate': rate}),
        ('noise-20db', encode_wav(rate, noisy), {'transform': 'additive-gaussian', 'snrDb': 20,
             'seed': seed, 'generator': 'PCG64', 'clippedSamples': int(np.sum(np.abs(noisy) > 1))}),
        ('pause-stress', encode_wav(rate, paused), {'transform': 'insert-silence', 'milliseconds': 450,
             'insertFrame': boundary, 'sourceRate': rate, 'boundaryWasQuiet': quiet,
             'limitation': 'Lowest-RMS middle-window insertion can interrupt speech; not a human pause sample.'}),
    ]


def review_items(report):
    items = {}
    for row in report['rows']:
        for route in ('direct', 'pipeline'):
            text = row['directTranslation'] if route == 'direct' else row['translation']
            if not text:
                continue
            # The same output/facts may be reviewed once across conditions, but never across experiments.
            key = fingerprint({'evaluationId': report['evaluationId'], 'sourceId': row['sourceId'],
                               'route': route, 'output': text, 'facts': row['criticalFacts']})
            row.setdefault('reviewKeys', {})[route] = key
            if key not in items:
                items[key] = {'key': key, 'sourceId': row['sourceId'], 'route': route,
                              'reference': row['reference'], 'targetReference': row['targetReference'],
                              'criticalFacts': row['criticalFacts'], 'output': text,
                              'sampleIds': [], 'verdict': 'pending', 'reason': ''}
            items[key]['sampleIds'].append(row['sampleId'])
    return list(items.values())


def apply_reviews(report, review):
    expected = {item['key']: item for item in review_items(report)}
    if review.get('evaluationId') != report['evaluationId'] or review.get('rubricVersion') != RUBRIC:
        raise ValueError('STALE_REVIEW')
    supplied = review.get('items', [])
    if len(supplied) != len(expected) or {i.get('key') for i in supplied} != set(expected):
        raise ValueError('INCOMPLETE_OR_DUPLICATE_REVIEW')
    counts = Counter()
    for item in supplied:
        original = expected[item['key']]
        if any(item.get(k) != original[k] for k in ('sourceId', 'route', 'reference', 'targetReference', 'output', 'criticalFacts', 'sampleIds')):
            raise ValueError('REVIEW_EVIDENCE_CHANGED')
        verdict = item.get('verdict')
        if verdict not in ('pass', 'fail', 'uncertain', 'pending'):
            raise ValueError('INVALID_VERDICT')
        if verdict != 'pending' and (not isinstance(item.get('reason'), str) or not item['reason'].strip()):
            raise ValueError('REVIEW_REASON_REQUIRED')
        counts[verdict] += 1
    report['criticalReview'] = {'rubricVersion': RUBRIC, 'reviewer': review.get('reviewer', 'unspecified'),
                                'kind': review.get('kind', 'unspecified'), 'uniqueOutputs': len(expected),
                                'counts': {k: counts[k] for k in ('pass', 'fail', 'uncertain', 'pending')},
                                'items': supplied}
    return report['criticalReview']


def compare(baseline, candidate):
    for key in ('corpusSha256', 'fixtureSetSha256', 'normalization', 'scorerSha256'):
        if baseline['identity'].get(key) != candidate['identity'].get(key):
            raise ValueError('COMPARISON_INPUT_MISMATCH:' + key)
    before = {r['sampleId']: r for r in baseline['rows']}
    after = {r['sampleId']: r for r in candidate['rows']}
    if len(baseline['rows']) != 180 or len(candidate['rows']) != 180 or len(before) != 180 or len(after) != 180 or before.keys() != after.keys():
        raise ValueError('COMPARISON_INCOMPLETE')
    for name, left in before.items():
        right = after[name]
        if not left.get('audioSha256') or left['audioSha256'] != right.get('audioSha256') or any(
            left.get(k) != right.get(k) for k in ('reference', 'sourceLanguage', 'targetLanguage', 'condition', 'split')
        ):
            raise ValueError('COMPARISON_INPUT_MISMATCH:' + name)
    same_host = baseline['host'] == candidate['host']
    changes = {}
    candidate_groups = summarize(candidate['rows'])
    for key, left in summarize(baseline['rows']).items():
        right = candidate_groups[key]
        changes[key] = {'baseline': left, 'candidate': right,
                        'werDelta': round(right['wer'] - left['wer'], 6) if left['wer'] is not None and right['wer'] is not None else None}
    return {'sameHostMetadata': same_host, 'timingsComparable': same_host,
            'timingCaveat': 'Matching metadata does not prove the same physical host or background load. Warm sequential calls exclude queue/transport/playback.',
            'qualityVerdict': 'No automatic semantic verdict. Review new output evidence separately.', 'groups': changes}

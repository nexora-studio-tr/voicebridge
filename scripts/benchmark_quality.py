"""Offline, frozen-input TR/EN quality baseline. No Discord, credentials or paid APIs."""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import hashlib
import importlib.metadata
import io
import json
import os
import platform
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'worker'))
from engine import Engine  # Sets offline/thread limits before inference imports.
from install_models import install, safe_path
from quality_metrics import (CONDITIONS, NORMALIZATION, RUBRIC, apply_reviews, compare,
                             decode_wav, fingerprint, load_corpus, read_json, review_items,
                             score, summarize, variants)

CORPUS = ROOT / 'examples/quality/corpus.json'
ARTIFACTS = ROOT / 'artifacts'
SEED = 314159


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', 'utf8')
    temporary.replace(path)


def named_directory(group, name):
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', name):
        raise ValueError('INVALID_ARTIFACT_NAME')
    directory = ARTIFACTS / group / name
    if not directory.resolve().is_relative_to(ARTIFACTS.resolve()) or any(
        p.is_symlink() for p in (ARTIFACTS, ARTIFACTS / group, directory)
    ):
        raise ValueError('ARTIFACT_PATH')
    return directory


def versions():
    result = {'python': platform.python_version()}
    for package in ('numpy', 'faster-whisper', 'ctranslate2', 'onnxruntime', 'piper-tts', 'sentencepiece', 'normalizer-tr'):
        try:
            result[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            result[package] = 'not-installed'
    return result


def source_identity():
    names = ('worker/engine.py', 'worker/okur_onnx.py', 'worker/model-lock.json',
             'worker/requirements.txt', 'scripts/benchmark_quality.py', 'scripts/quality_metrics.py')
    return {name: sha(ROOT / name) for name in names}


def model_identity(models):
    # Verification is strictly offline. Capture installer output to keep local absolute paths private.
    with contextlib.redirect_stdout(io.StringIO()):
        install(models, offline=True, verify_only=True)
    lock = read_json(ROOT / 'worker/model-lock.json')
    installed = read_json(models / 'installed.json')
    return {'lockSha256': sha(ROOT / 'worker/model-lock.json'),
            'files': {item['path']: item['sha256'] for item in lock['files']},
            'extracted': installed['extracted']}


def create_engine(models):
    import numpy as np
    import onnxruntime as ort
    np.random.seed(SEED)
    ort.set_seed(SEED)
    engine = Engine(models)
    if not engine.status()['ready']:
        raise ValueError('MODELS_NOT_READY')
    return engine


def fixture_digest(manifest):
    return fingerprint({k: v for k, v in manifest.items() if k not in ('createdAt', 'fixtureSetSha256')})


def fixtures(directory, references):
    manifest = read_json(directory / 'manifest.json')
    if manifest.get('schemaVersion') != 1 or manifest.get('corpusSha256') != sha(CORPUS):
        raise ValueError('FIXTURE_CORPUS_MISMATCH')
    if manifest.get('fixtureSetSha256') != fixture_digest(manifest):
        raise ValueError('FIXTURE_MANIFEST_MODIFIED')
    expected = {r['sourceId'] + '-' + c for r in references for c in CONDITIONS}
    rows = manifest['samples']
    if len(rows) != 180 or {r['sampleId'] for r in rows} != expected:
        raise ValueError('FIXTURE_COVERAGE')
    for row in rows:
        if row.get('sourceId') + '-' + row.get('condition') != row['sampleId']:
            raise ValueError('FIXTURE_SOURCE_MISMATCH')
        expected_file = 'wav/' + row['sampleId'] + '.wav'
        if row.get('error'):
            if row.get('audioSha256') is not None or row.get('file') is not None:
                raise ValueError('FIXTURE_ERROR_CONFLICT')
            continue
        if row.get('file') != expected_file:
            raise ValueError('FIXTURE_PATH')
        audio = safe_path(directory, expected_file)
        if sha(audio) != row['audioSha256']:
            raise ValueError('FIXTURE_AUDIO_MODIFIED:' + row['sampleId'])
        decode_wav(audio.read_bytes())
    return manifest


def prepare(directory, models):
    _, references = load_corpus(CORPUS)
    if (directory / 'manifest.json').exists():
        manifest = fixtures(directory, references)
        print(json.dumps({'status': 'reused-frozen-fixtures', 'samples': len(manifest['samples']),
                          'fixtureSetSha256': manifest['fixtureSetSha256']}), flush=True)
        return manifest
    if directory.exists() and any(directory.iterdir()):
        raise ValueError('PARTIAL_FIXTURE_DIRECTORY_USE_NEW_NAME')
    model = model_identity(models)
    engine = create_engine(models)
    (directory / 'wav').mkdir(parents=True, exist_ok=True)
    manifest = {'schemaVersion': 1, 'synthetic': True, 'createdAt': now(),
                'corpusSha256': sha(CORPUS), 'models': model, 'source': source_identity(),
                'runtime': versions(), 'generation': {'seed': SEED, 'device': 'cpu',
                    'englishVoice': 'Piper en_US-ljspeech-medium', 'turkishVoice': 'Okur',
                    'settings': 'Current Engine.speak defaults; NumPy and ONNX Runtime seeds set before loading.',
                    'limitation': 'Seeds do not guarantee bit-identical synthesis across platforms. Freeze and reuse these exact WAV bytes. Intended text is not human-audited spoken ground truth.'},
                'samples': []}
    for index, reference in enumerate(references):
        try:
            audio = engine.speak(reference['reference'], reference['sourceLanguage'])
            transformed = variants(audio, SEED + index)
            for condition, data, recipe in transformed:
                rate, pcm = decode_wav(data)
                sample_id = reference['sourceId'] + '-' + condition
                filename = 'wav/' + sample_id + '.wav'
                safe_path(directory, filename).write_bytes(data)
                manifest['samples'].append({'sampleId': sample_id, 'sourceId': reference['sourceId'],
                    'condition': condition, 'file': filename, 'audioSha256': hashlib.sha256(data).hexdigest(),
                    'bytes': len(data), 'seconds': round(len(pcm) / rate, 4), 'rate': rate,
                    'recipe': recipe, 'error': None})
        except Exception as error:
            # Preserve missing cases instead of reporting only the sources that synthesized well.
            for condition in CONDITIONS:
                manifest['samples'].append({'sampleId': reference['sourceId'] + '-' + condition,
                    'sourceId': reference['sourceId'], 'condition': condition, 'file': None,
                    'audioSha256': None, 'error': 'source-synthesis:' + type(error).__name__})
        print(f"prepare {index + 1}/60 {reference['sourceId']}", flush=True)
    manifest['fixtureSetSha256'] = fixture_digest(manifest)
    write_json(directory / 'manifest.json', manifest)
    return manifest


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')


def git_metadata():
    def git(*args):
        result = subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True,
                                timeout=10, check=False)
        return result.stdout.strip() if result.returncode == 0 else 'unavailable'
    return {'commit': git('rev-parse', 'HEAD'), 'dirty': bool(git('status', '--porcelain'))}


def host_metadata():
    # No usernames, hostname, serials, network addresses or local paths.
    memory = None
    if sys.platform == 'win32':
        import ctypes
        class Memory(ctypes.Structure):
            _fields_ = [('length', ctypes.c_ulong), ('load', ctypes.c_ulong),
                        *[(n, ctypes.c_ulonglong) for n in ('total', 'available', 'page', 'availablePage', 'virtual', 'availableVirtual', 'extended')]]
        state = Memory()
        state.length = ctypes.sizeof(state)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(state)):
            memory = round(state.total / 1024 ** 3, 1)
    elif hasattr(os, 'sysconf'):
        memory = round(os.sysconf('SC_PHYS_PAGES') * os.sysconf('SC_PAGE_SIZE') / 1024 ** 3, 1)
    return {'os': platform.system(), 'release': platform.release(), 'machine': platform.machine(),
            'processor': platform.processor(), 'logicalCpus': os.cpu_count(), 'memoryGiB': memory}


def elapsed(start):
    return round((time.perf_counter() - start) * 1000, 2)


def measure_sample(engine, reference, fixture, data, direct):
    row = {**reference, **{k: fixture.get(k) for k in ('sampleId', 'condition', 'audioSha256', 'seconds')},
           'recognized': '', 'translation': '', 'directTranslation': direct.get('text', ''),
           'directTranslationMs': direct.get('milliseconds'), 'scores': None, 'errors': [],
           'timings': {k: None for k in ('queueMs', 'asrMs', 'translationMs', 'speechMs', 'pipelineMs')}}
    if direct.get('error'):
        row['errors'].append(direct['error'])
    if fixture.get('error'):
        row['errors'].append(fixture['error'])
        return row
    pipeline_start = time.perf_counter()
    start = time.perf_counter()
    try:
        row['recognized'] = engine.recognize(data, reference['sourceLanguage'])
        row['timings']['asrMs'] = elapsed(start)
        row['scores'] = score(reference['reference'], row['recognized'], reference['sourceLanguage'])
    except Exception as error:
        row['errors'].append('asr:' + type(error).__name__)
        return row
    if not row['recognized'].strip():
        row['errors'].append('asr:empty')
        return row
    start = time.perf_counter()
    try:
        row['translation'] = engine.translate(row['recognized'], reference['sourceLanguage'], reference['targetLanguage'])
        row['timings']['translationMs'] = elapsed(start)
        if not row['translation'].strip():
            raise ValueError('EMPTY_TRANSLATION')
    except Exception as error:
        row['errors'].append('translation:' + type(error).__name__)
        return row
    start = time.perf_counter()
    try:
        speech = engine.speak(row['translation'], reference['targetLanguage'])
        decode_wav(speech)
        row['timings']['speechMs'] = elapsed(start)
    except Exception as error:
        row['errors'].append('speech:' + type(error).__name__)
        return row
    row['timings']['pipelineMs'] = elapsed(pipeline_start)
    return row


def markdown(report):
    percent = lambda value: 'n/a' if value is None else f'{100 * value:.1f}%'
    lines = ['# VoiceBridge synthetic quality baseline', '',
             f"Runtime: {report['runtimeVersion']}; measured commit: `{report['git']['commit']}`; dirty tree: {str(report['git']['dirty']).lower()}.", '',
             '60 original reference texts (30 per language), 180 frozen synthetic clips. CPU, offline, sequential warm calls. No Discord or paid API.', '',
             '**This is a diagnostic baseline, not a live-call accuracy or latency claim.** Intended TTS text is not independently audited spoken ground truth. Voice/pronunciation errors can contribute to ASR differences.', '',
             f"Evaluation ID: `{report['evaluationId']}`", '',
             '| Source | Condition | Split | Scored/expected | Failed | WER | CER | ASR p50/p95 ms | Pipeline p50/p95 ms |',
             '|---|---|---|---:|---:|---:|---:|---:|---:|']
    for key, group in report['groups'].items():
        a, p = group['timings']['asrMs'], group['timings']['pipelineMs']
        lines.append(f"| {' | '.join(key.split('/'))} | {group['scoredSamples']}/{group['samples']} | {group['failedSamples']} | {percent(group['wer'])} | {percent(group['cer'])} | {a['p50']}/{a['p95']} | {p['p50']}/{p['p95']} |")
    review = report['criticalReview']
    lines += ['', '## Critical meaning review', '',
              f"Review type: {review['kind']}; reviewer: {review['reviewer']}. Unique source/route/output judgments: {review['uniqueOutputs']}.",
              ', '.join(f"{name}: {review['counts'].get(name, 0)}" for name in ('pass', 'fail', 'uncertain', 'pending')) + '.', '',
              'Direct translation uses the reference text; pipeline translation uses recognized text. Identical outputs within one source/route are reviewed once across conditions. These counts are not per-clip accuracy percentages. See the JSON for exact evidence and reasons.', '',
              '## Limits', '',
              '- Public holdout: six scenarios per language, separate from development. It is visible, paired and too small for a generalization claim.',
              '- WER/CER use versioned Unicode token normalization; digits and number words are not treated as equivalent. Negations and Turkish letters survive. No translation exact-match score.',
              '- All 180 cases remain visible, including failures. Timing percentiles use successful stages only; each stage includes its sample count in JSON.',
              '- Clean uses original source bytes; noise is seeded Gaussian at 20 dB before clipping; pause stress inserts 450 ms in a low-energy middle window and can interrupt speech.',
              '- These timings exclude capture, Discord transport, queue, browser and playback. Source generation and model warmup are separate. Queue evidence belongs to a separate synthetic report.',
              '- Seeds do not guarantee identical TTS across platforms. Compare using the same frozen fixture hashes, scorer, corpus and hardware; disclose background load.',
              '- No runtime settings or recognition models were tuned from this baseline. Live and independent human review remain pending.', '']
    return '\n'.join(lines)


def run(directory, fixture_directory, models):
    if directory.exists() and any(directory.iterdir()):
        raise ValueError('REPORT_EXISTS_USE_NEW_NAME')
    _, references = load_corpus(CORPUS)
    manifest = fixtures(fixture_directory, references)
    model = model_identity(models)
    source = source_identity()
    identity = {'corpusSha256': sha(CORPUS), 'fixtureSetSha256': manifest['fixtureSetSha256'],
                'normalization': NORMALIZATION, 'scorerSha256': source['scripts/quality_metrics.py'],
                'source': source, 'models': model, 'runtime': versions()}
    report = {'schemaVersion': 1, 'createdAt': now(), 'synthetic': True, 'liveDiscord': False,
              'paidApi': False, 'runtimeVersion': read_json(ROOT / 'package.json')['version'],
              'git': git_metadata(), 'identity': identity, 'evaluationId': fingerprint(identity),
              'host': host_metadata(), 'fixtureGeneration': manifest['generation'],
              'warmup': [], 'rows': []}
    engine = create_engine(models)
    for language in ('en', 'tr'):
        reference = next(r for r in references if r['sourceLanguage'] == language)
        fixture = next(f for f in manifest['samples'] if f['sourceId'] == reference['sourceId'] and f['condition'] == 'clean')
        start = time.perf_counter()
        error = None
        try:
            if fixture.get('error'):
                raise ValueError('WARMUP_FIXTURE_UNAVAILABLE')
            engine.recognize(safe_path(fixture_directory, fixture['file']).read_bytes(), language)
            text = engine.translate(reference['reference'], language, reference['targetLanguage'])
            engine.speak(text, reference['targetLanguage'])
        except Exception as exception:
            error = type(exception).__name__
        report['warmup'].append({'sourceLanguage': language, 'milliseconds': elapsed(start), 'error': error})
    by_source = {r['sourceId']: r for r in references}
    direct = {}
    directory.mkdir(parents=True, exist_ok=True)
    for index, fixture in enumerate(manifest['samples']):
        reference = by_source[fixture['sourceId']]
        if fixture['sourceId'] not in direct:
            start = time.perf_counter()
            try:
                text = engine.translate(reference['reference'], reference['sourceLanguage'], reference['targetLanguage'])
                if not text.strip():
                    raise ValueError('EMPTY_DIRECT_TRANSLATION')
                direct[fixture['sourceId']] = {'text': text, 'milliseconds': elapsed(start)}
            except Exception as error:
                direct[fixture['sourceId']] = {'error': 'direct-translation:' + type(error).__name__}
        data = None if fixture.get('error') else safe_path(fixture_directory, fixture['file']).read_bytes()
        row = measure_sample(engine, reference, fixture, data, direct[fixture['sourceId']])
        report['rows'].append(row)
        # A crash leaves diagnostic progress, never a completed report.
        with (directory / 'progress.jsonl').open('a', encoding='utf8') as output:
            output.write(json.dumps(row, ensure_ascii=False) + '\n')
        print(f"run {index + 1}/180 {fixture['sampleId']} errors={len(row['errors'])}", flush=True)
    report['groups'] = summarize(report['rows'])
    items = review_items(report)
    review = {'evaluationId': report['evaluationId'], 'rubricVersion': RUBRIC,
              'reviewer': 'unassigned', 'kind': 'pending', 'items': items}
    apply_reviews(report, review)
    write_json(directory / 'report.json', report)
    write_json(directory / 'review-template.json', review)
    (directory / 'report.md').write_text(markdown(report), 'utf8')
    print(json.dumps({'status': 'measured-not-accepted', 'samples': len(report['rows']),
                      'failed': sum(bool(r['errors']) for r in report['rows']), 'reviewOutputs': len(items)}), flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for command in ('prepare', 'run'):
        sub = commands.add_parser(command)
        sub.add_argument('--fixture-set', default='baseline-v1')
        sub.add_argument('--models', type=Path, default=Path(os.environ.get('VOICEBRIDGE_DATA', str(ROOT / '.voicebridge'))) / 'models')
        if command == 'run':
            sub.add_argument('--name', required=True)
    review = commands.add_parser('review')
    review.add_argument('--name', required=True)
    review.add_argument('--file', type=Path, required=True)
    comparison = commands.add_parser('compare')
    comparison.add_argument('--baseline', required=True)
    comparison.add_argument('--candidate', required=True)
    args = parser.parse_args()
    if args.command == 'prepare':
        prepare(named_directory('quality-fixtures', args.fixture_set), args.models)
    elif args.command == 'run':
        run(named_directory('quality-baseline', args.name), named_directory('quality-fixtures', args.fixture_set), args.models)
    elif args.command == 'review':
        directory = named_directory('quality-baseline', args.name)
        report = read_json(directory / 'report.json')
        apply_reviews(report, read_json(args.file))
        write_json(directory / 'report.json', report)
        (directory / 'report.md').write_text(markdown(report), 'utf8')
        print(json.dumps(report['criticalReview']['counts']))
    else:
        baseline = read_json(named_directory('quality-baseline', args.baseline) / 'report.json')
        candidate_directory = named_directory('quality-baseline', args.candidate)
        candidate = read_json(candidate_directory / 'report.json')
        result = compare(baseline, candidate)
        write_json(candidate_directory / 'comparison.json', result)
        print(json.dumps({'status': 'compared', 'timingsComparable': result['timingsComparable']}))


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    main()

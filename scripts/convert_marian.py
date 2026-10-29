"""Explicit, offline research conversion. Defaults to a resource check; never activates a model."""
from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import shutil
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from inspect_marian import digest, footprint_bytes, no_links, validate_source_lock, verify_extracted
from marian_job import CREATE_SUSPENDED, WindowsJob
from preflight_marian import MANIFEST, ROOT, admission, available_memory, source_sha256, validate_manifest

WORK = ROOT / 'artifacts/marian-experiment-v1'
LOCK = ROOT / 'docs/experiments/marian-verified-sources.json'
DISK_RESERVE = 10 * 1024**3
MEMORY_RESERVE = 512 * 1024**2
STOP_FOOTPRINT = 5 * 1024**3 - 256 * 1024**2


def inputs(direction):
    document = validate_manifest(json.loads(MANIFEST.read_text('utf8')))
    lock = validate_source_lock(json.loads(LOCK.read_text('utf8')), document)
    source = next(s for s in document['sources'] if s['direction'] == direction)
    pinned = next(s for s in lock['sources'] if s['direction'] == direction)
    return document, source, pinned


def resource_check(document, source):
    installed = {'python': '.'.join(map(str, sys.version_info[:2]))}
    for name in document['dependencies'].keys() - {'python'}:
        try:
            installed[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            installed[name] = None
    result = admission(document, shutil.disk_usage(ROOT).free, available_memory(), installed)
    # Each direction is admitted separately; an EN-only job must not require the TR guard.
    result['selectedDirection'] = source['direction']
    result['selectedDirectionReady'] = (result['diskSufficient']
        and result['directions'][source['direction']]['memorySufficient']
        and all(d['matches'] for d in result['dependencies'].values()))
    result['privateCommitLimitBytes'] = source['minimumAvailableRamBytes'] * 3 // 4
    return result


def require_ready(result):
    if not result['selectedDirectionReady']:
        raise ValueError('CONVERSION_RESOURCES_NOT_READY')
    if sys.platform != 'win32':
        raise ValueError('WINDOWS_JOB_REQUIRED')


def monitor_reason(free_ram, free_disk, footprint, elapsed):
    if free_ram is None or free_ram < MEMORY_RESERVE:
        return 'SYSTEM_MEMORY_RESERVE'
    if free_disk < DISK_RESERVE or footprint > STOP_FOOTPRINT:
        return 'EXPERIMENT_DISK_RESERVE'
    if elapsed > 600:
        return 'CONVERSION_TIMEOUT'
    return None


def child(direction, token):
    document, source, pinned = inputs(direction)
    folder = no_links(WORK / direction)
    scratch = no_links(folder / 'conversion-work')
    # The parent assigns the OS job before releasing the child to import native libraries.
    ready = no_links(scratch / 'ready.json')
    deadline = time.monotonic() + 30
    while not ready.exists():
        if time.monotonic() > deadline:
            raise ValueError('PARENT_HANDSHAKE_TIMEOUT')
        time.sleep(0.1)
    if json.loads(ready.read_text('utf8')).get('token') != token:
        raise ValueError('PARENT_HANDSHAKE_MISMATCH')
    require_ready(resource_check(document, source))
    verify_extracted(folder / 'source', pinned['extractedFiles'])
    from ctranslate2.converters import MarianConverter
    import ctranslate2

    output = no_links(scratch / 'model')
    converter = MarianConverter(str(folder / 'source' / source['model']),
        [str(folder / 'source' / source['sourceVocabulary']),
         str(folder / 'source' / source['targetVocabulary'])])
    converter.convert(str(output), quantization='int8', force=False)
    if not ctranslate2.contains_model(str(output)):
        raise ValueError('CONVERTED_MODEL_STRUCTURE')
    for name in ('source.spm', 'target.spm', 'README.md', 'LICENSE'):
        shutil.copyfile(folder / 'source' / name, output / name)
    provenance = {'sourceArchiveSha256': pinned['archiveSha256'], 'sourceModelSha256': pinned['modelSha256'],
                  'upstreamLicense': pinned['licenseInArchive'], 'conversion': 'CTranslate2 4.8.3 CPU int8',
                  'trainedByNexora': False, 'runtimeActivation': False}
    (output / 'PROVENANCE.json').write_text(json.dumps(provenance, indent=2) + '\n', 'utf8')


def convert(direction):
    document, source, pinned = inputs(direction)
    resources = resource_check(document, source)
    require_ready(resources)  # Before mkdir, lock, hashing weights, native imports or Popen.
    folder = no_links(WORK / direction)
    scratch = no_links(folder / 'conversion-work')
    target = no_links(folder / 'ct2-int8')
    if scratch.exists() or target.exists():
        raise ValueError('CONVERSION_OUTPUT_EXISTS')
    footprint = footprint_bytes(no_links(WORK))
    # Reserve a conservative output allowance before launching, as well as monitoring writes.
    allowance = next(f['bytes'] for f in pinned['extractedFiles'] if f['name'] == source['model']) * 2 + 16 * 1024**2
    if footprint + allowance > STOP_FOOTPRINT:
        raise ValueError('CONVERSION_OUTPUT_RESERVATION')
    verify_extracted(folder / 'source', pinned['extractedFiles'])
    lock_path = no_links(WORK / 'conversion.lock')
    process = None
    start = time.monotonic()
    report = {'schemaVersion': 1, 'direction': direction, 'checkedAt': datetime.now(timezone.utc).isoformat(),
              'runnerSha256': source_sha256(__file__), 'jobGuardSha256': source_sha256(Path(__file__).with_name('marian_job.py')),
              'sourceLockSha256': source_sha256(LOCK), 'resourcesBeforeLaunch': resources,
              'conversionAttempted': False, 'runtimeActivation': False, 'qualityEvaluated': False, 'status': 'started'}
    owned_lock = lock_path.open('x', encoding='utf8')
    try:
        owned_lock.write(str(os.getpid()))
        owned_lock.flush()
        scratch.mkdir()
        token = uuid.uuid4().hex
        env = {**os.environ, 'OMP_NUM_THREADS': '2', 'OPENBLAS_NUM_THREADS': '2',
               'MKL_NUM_THREADS': '2', 'HF_HUB_OFFLINE': '1', 'HF_HUB_DISABLE_IMPLICIT_TOKEN': '1'}
        with WindowsJob(resources['privateCommitLimitBytes']) as job, (scratch / 'worker.log').open('wb') as log:
            process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--_worker', direction, token],
                                       cwd=ROOT, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                       creationflags=CREATE_SUSPENDED | 0x08000000)  # CREATE_NO_WINDOW
            report['conversionAttempted'] = True
            job.assign(process)
            no_links(scratch / 'ready.json').write_text(json.dumps({'token': token}), 'utf8')
            while process.poll() is None:
                reason = monitor_reason(available_memory(), shutil.disk_usage(ROOT).free,
                                        footprint_bytes(WORK), time.monotonic() - start)
                if reason:
                    raise ValueError(reason)
                time.sleep(0.1)
            report['workerExitCode'] = process.returncode
            report['peakPrivateCommitBytes'] = job.peak_private_bytes()
            if process.returncode != 0:
                raise ValueError('CONVERSION_WORKER_FAILED')
        model = no_links(scratch / 'model')
        if not (model / 'model.bin').is_file() or not (model / 'config.json').is_file():
            raise ValueError('CONVERSION_OUTPUT_MISSING')
        # Never write to .voicebridge/models. Promotion requires later quality/safety decisions.
        if not all(path.resolve().is_relative_to(WORK.resolve()) for path in (model, target)):
            raise ValueError('CONVERSION_OUTPUT_ESCAPE')
        model.rename(target)
        report['files'] = [{'name': p.name, 'bytes': p.stat().st_size, 'sha256': digest(p)}
                           for p in sorted(target.iterdir()) if no_links(p).is_file()]
        report['status'] = 'converted-research-only'
        return report
    except BaseException as error:
        report['status'] = 'failed-not-promoted'
        report['reason'] = str(error) if isinstance(error, ValueError) else type(error).__name__
        raise
    finally:
        try:
            if process is not None and process.poll() is None:
                process.kill()
                process.wait(timeout=10)
            report['elapsedMs'] = round((time.monotonic() - start) * 1000)
            no_links(folder / 'conversion-report.json').write_text(json.dumps(report, indent=2) + '\n', 'utf8')
        finally:
            owned_lock.close()
            lock_path.unlink()  # Only this invocation's exclusively created semaphore.


def main():
    if len(sys.argv) == 4 and sys.argv[1] == '--_worker':
        if sys.argv[2] not in ('en-tr', 'tr-en'):
            raise ValueError('INVALID_DIRECTION')
        child(sys.argv[2], sys.argv[3])
        return
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--direction', choices=('en-tr', 'tr-en'), required=True)
    parser.add_argument('--run', action='store_true', help='Explicitly start guarded research conversion if admitted.')
    args = parser.parse_args()
    if args.run:
        report = convert(args.direction)
    else:
        document, source, _ = inputs(args.direction)
        report = {'status': 'check-only', 'resources': resource_check(document, source),
                  'conversionAttempted': False, 'runtimeActivation': False}
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    if '--_worker' in sys.argv:
        main()  # Worker traceback stays in its local log for diagnosis.
    else:
        try:
            main()
        except (ValueError, OSError) as error:
            reason = str(error) if isinstance(error, ValueError) else type(error).__name__
            print(json.dumps({'status': 'blocked-or-failed', 'reason': reason, 'runtimeActivation': False}))
            sys.exit(2)

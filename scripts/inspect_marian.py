"""Offline, bounded inspection of pinned Marian ZIP/NPZ sources; never executes model code."""
from __future__ import annotations

import hashlib
import argparse
import importlib.metadata
import json
import math
import re
import shutil
import stat
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from preflight_marian import (MANIFEST, ROOT, admission, available_memory, plain_name,
                             source_sha256, validate_manifest)

MAX_ARRAY_BYTES = 256 * 1024**2
MAX_NPZ_BYTES = 2 * 1024**3
MAX_CONFIG_BYTES = 64 * 1024


def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as stream:
        while data := stream.read(1024**2):
            value.update(data)
    return value.hexdigest()


def no_links(path):
    path = Path(path).absolute()
    if any(p.is_symlink() or p.is_junction() for p in (path, *path.parents)):
        raise ValueError('EXPERIMENT_LINK')
    return path


def validate_source_lock(lock, manifest):
    if (lock.get('schemaVersion') != 1 or lock.get('sourceManifestSha256') != source_sha256(MANIFEST)
            or lock.get('runtimeActivation') is not False or lock.get('downloadEnabled') is not False
            or lock.get('completeForRuntimeInstallation') is not False
            or lock.get('completeForSourceVerification') is not True):
        raise ValueError('SOURCE_LOCK_BOUNDARY')
    expected = {s['direction']: s for s in manifest['sources']}
    sources = lock.get('sources', [])
    if len(sources) != len(expected) or {s['direction'] for s in sources} != set(expected):
        raise ValueError('SOURCE_LOCK_DIRECTIONS')
    for source in sources:
        original = expected[source['direction']]
        if (source['url'] != original['archive']['url']
                or source['archiveBytes'] != original['archive']['bytes']
                or source['model'] != original['model']
                or not re.fullmatch('[a-f0-9]{64}', source.get('archiveSha256', ''))
                or not re.fullmatch('[a-f0-9]{64}', source.get('modelSha256', ''))):
            raise ValueError('SOURCE_LOCK_IDENTITY')
        entries = {e['name']: e['bytes'] for e in original['archive']['entries']}
        files = source['extractedFiles']
        if len(files) != len(entries) or {f['name'] for f in files} != set(entries):
            raise ValueError('SOURCE_LOCK_FILES')
        for item in files:
            if (item['bytes'] != entries[plain_name(item['name'])]
                    or not re.fullmatch('[a-f0-9]{64}', item.get('sha256', ''))):
                raise ValueError('SOURCE_LOCK_FILE_IDENTITY')
        if next(f['sha256'] for f in files if f['name'] == source['model']) != source['modelSha256']:
            raise ValueError('SOURCE_LOCK_MODEL_IDENTITY')
        pinned = {m['name']: m for m in original['metadata']}
        if any(item != pinned[item['name']] for item in files if item['name'] in pinned):
            raise ValueError('SOURCE_LOCK_METADATA_CHANGED')
    return lock


def verify_extracted(folder, files):
    folder = no_links(folder)
    if {p.name for p in folder.iterdir()} != {item['name'] for item in files}:
        raise ValueError('EXTRACTED_INVENTORY_CHANGED')
    for item in files:
        path = no_links(folder / plain_name(item['name']))
        if not path.is_file() or path.stat().st_size != item['bytes'] or digest(path) != item['sha256']:
            raise ValueError('EXTRACTED_IDENTITY_CHANGED')
    return files


def footprint_bytes(work):
    total, count = 0, 0
    for path in Path(work).rglob('*'):
        no_links(path)
        if path.is_file():
            total += path.stat().st_size
            count += 1
        if total > 5 * 1024**3 or count > 128:
            raise ValueError('EXPERIMENT_DISK_BUDGET')
    return total


def verify_archive(path, source, expected_sha256):
    path = no_links(path)
    if not re.fullmatch('[a-f0-9]{64}', expected_sha256 or ''):
        raise ValueError('ARCHIVE_SHA256_REQUIRED')
    if path.stat().st_size != source['archive']['bytes'] or digest(path) != expected_sha256:
        raise ValueError('ARCHIVE_IDENTITY')
    expected = {entry['name']: entry for entry in source['archive']['entries']}
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) != len(expected) or len({e.filename for e in entries}) != len(entries):
            raise ValueError('ARCHIVE_INVENTORY')
        for entry in entries:
            plain_name(entry.filename)
            spec = expected.get(entry.filename)
            mode = entry.external_attr >> 16
            if (not spec or entry.is_dir() or entry.flag_bits & 1
                    or stat.S_ISLNK(mode) or stat.S_IFMT(mode) not in (0, stat.S_IFREG)
                    or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)):
                raise ValueError('ARCHIVE_ENTRY_TYPE')
            if ((entry.file_size, entry.compress_size, entry.header_offset, f'{entry.CRC:08x}')
                    != (spec['bytes'], spec['compressed'], spec['offset'], spec['crc32'])):
                raise ValueError('ARCHIVE_ENTRY_IDENTITY')
        # Stream every member: CRC validation is part of the check, not just directory parsing.
        for entry in entries:
            with archive.open(entry) as member:
                total = 0
                while data := member.read(1024**2):
                    total += len(data)
                    if total > entry.file_size:
                        raise ValueError('ARCHIVE_MEMBER_LIMIT')
    return expected_sha256


def extract_source(path, source, destination):
    """Call only after verify_archive. Existing directories are never overwritten."""
    destination = no_links(destination)
    if destination.exists():
        raise ValueError('EXTRACTION_EXISTS')
    destination.mkdir(parents=True)
    expected = {item['name']: item for item in source['archive']['entries']}
    pinned_metadata = {item['name']: item for item in source['metadata']}
    receipts = []
    with zipfile.ZipFile(path) as archive:
        for entry in archive.infolist():
            name = plain_name(entry.filename)
            if name not in expected or entry.file_size != expected[name]['bytes']:
                raise ValueError('EXTRACTION_INVENTORY')
            out = no_links(destination / name)
            sha, size = hashlib.sha256(), 0
            with archive.open(entry) as member, out.open('xb') as output:
                while data := member.read(1024**2):
                    size += len(data)
                    if size > entry.file_size or shutil.disk_usage(destination).free < 10 * 1024**3:
                        raise ValueError('EXTRACTION_RESOURCE_BOUND')
                    sha.update(data)
                    output.write(data)
            item = {'name': name, 'bytes': size, 'sha256': sha.hexdigest()}
            if name in pinned_metadata and item != pinned_metadata[name]:
                raise ValueError('EXTRACTED_METADATA_CHANGED')
            receipts.append(item)
    return receipts


def inspect_npz(path):
    # Parse headers/config and stream raw bytes for CRC; never construct tensor arrays.
    import numpy as np
    import yaml

    path = no_links(path)
    arrays, config_bytes = [], None
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if (not 1 <= len(entries) <= 2048 or len({e.filename for e in entries}) != len(entries)
                or sum(e.file_size for e in entries) > MAX_NPZ_BYTES):
            raise ValueError('NPZ_INVENTORY_LIMIT')
        for entry in entries:
            if (not re.fullmatch(r'[A-Za-z0-9_:.+-]+\.npy', entry.filename)
                    or '..' in entry.filename or entry.flag_bits & 1
                    or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)):
                raise ValueError('NPZ_ENTRY')
            with archive.open(entry) as stream:
                version = np.lib.format.read_magic(stream)
                if version == (1, 0):
                    shape, fortran, dtype = np.lib.format.read_array_header_1_0(stream, max_header_size=16384)
                elif version == (2, 0):
                    shape, fortran, dtype = np.lib.format.read_array_header_2_0(stream, max_header_size=16384)
                else:
                    raise ValueError('NPY_VERSION')
                if (dtype.hasobject or dtype.fields is not None or dtype.kind not in 'fiub'
                        or not 1 <= len(shape) <= 4 or any(n < 0 for n in shape)):
                    raise ValueError('NPY_DTYPE_OR_SHAPE')
                size = math.prod(shape) * dtype.itemsize
                if size > MAX_ARRAY_BYTES or stream.tell() + size != entry.file_size:
                    raise ValueError('NPY_ARRAY_BOUND')
                arrays.append({'name': entry.filename[:-4], 'shape': list(shape),
                               'dtype': dtype.str, 'payloadBytes': size, 'fortran': fortran})
                if entry.filename == 'special:model.yml.npy':
                    if dtype != np.dtype('int8') or len(shape) != 1 or not 1 < size <= MAX_CONFIG_BYTES:
                        raise ValueError('NPZ_CONFIG_BOUND')
                    config_bytes = stream.read(size)
                    if len(config_bytes) != size or config_bytes[-1:] != b'\0':
                        raise ValueError('NPZ_CONFIG_TERMINATOR')
                # Closing a partially read ZipExtFile does not verify its CRC.
                while stream.read(1024**2):
                    pass
    if config_bytes is None:
        raise ValueError('NPZ_CONFIG_MISSING')
    config = yaml.safe_load(config_bytes[:-1])
    if not isinstance(config, dict):
        raise ValueError('NPZ_CONFIG_MAPPING')
    keys = ('type', 'dim-emb', 'enc-depth', 'dec-depth', 'dim-vocabs', 'transformer-heads',
            'transformer-ffn-activation', 'transformer-preprocess', 'transformer-postprocess',
            'transformer-postprocess-emb', 'transformer-postprocess-top',
            'transformer-decoder-autoreg', 'transformer-no-projection',
            'transformer-guided-alignment-layer')
    observed = {key: config.get(key) for key in keys}
    pre_norm = 'n' in str(observed['transformer-preprocess'])
    norm_ok = ((observed['transformer-preprocess'] == 'n'
                and observed['transformer-postprocess'] == 'da'
                and config.get('transformer-postprocess-top', '') == 'n') if pre_norm else
               (observed['transformer-preprocess'] == ''
                and observed['transformer-postprocess'] == 'dan'
                and config.get('transformer-postprocess-top', '') == ''))
    supported = (observed['type'] == 'transformer'
                 and observed['transformer-decoder-autoreg'] == 'self-attention'
                 and observed['transformer-no-projection'] is False
                 and observed['transformer-ffn-activation'] in ('relu', 'gelu', 'swish')
                 and observed['transformer-postprocess-emb'] in ('', 'd', 'nd', 'n') and norm_ok)
    return {'arrayCount': len(arrays), 'tensorPayloadBytes': sum(a['payloadBytes'] for a in arrays),
            'largestArrayBytes': max(a['payloadBytes'] for a in arrays),
            'configSha256': hashlib.sha256(config_bytes).hexdigest(),
            'config': observed, 'configurationPrecheckSupported': supported,
            'fullConverterCompatibilityVerified': False, 'tensorArraysLoaded': False,
            'allNestedMemberCrcsVerified': True,
            'pickleAllowed': False, 'arrayHeaders': arrays}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--direction', choices=('en-tr', 'tr-en', 'both'), default='both')
    args = parser.parse_args()
    manifest = validate_manifest(json.loads(MANIFEST.read_text('utf8')))
    lock_path = ROOT / 'docs/experiments/marian-verified-sources.json'
    lock = validate_source_lock(json.loads(lock_path.read_text('utf8')), manifest)
    work = no_links(ROOT / 'artifacts/marian-experiment-v1')
    footprint_bytes(work)
    installed = {'python': '.'.join(map(str, sys.version_info[:2]))}
    for name in manifest['dependencies'].keys() - {'python'}:
        try:
            installed[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            installed[name] = None
    report = {'schemaVersion': 1, 'checkedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
              'scope': 'Local source verification; no conversion, inference, ASR/TTS or quality evaluation.',
              'sourceHashNormalization': 'lf', 'inspectorSha256': source_sha256(__file__),
              'verifiedLockSha256': source_sha256(lock_path),
              'networkRequests': 0, 'conversionAttempted': False, 'runtimeActivation': False,
              'sources': []}
    for source in manifest['sources']:
        if args.direction not in ('both', source['direction']):
            continue
        pinned = next(s for s in lock['sources'] if s['direction'] == source['direction'])
        folder = no_links(work / source['direction'])
        verify_archive(folder / 'source.zip', source, pinned['archiveSha256'])
        if not (folder / 'source').exists():
            if shutil.disk_usage(ROOT).free < 15 * 1024**3:
                raise ValueError('EXTRACTION_DISK_ADMISSION')
            if footprint_bytes(work) + source['archive']['unpackedBytes'] > 5 * 1024**3:
                raise ValueError('EXPERIMENT_DISK_BUDGET')
            extract_source(folder / 'source.zip', source, folder / 'source')
        verify_extracted(folder / 'source', pinned['extractedFiles'])
        result = inspect_npz(folder / 'source' / source['model'])
        report['sources'].append({'direction': source['direction'],
                                  'archiveSha256': pinned['archiveSha256'],
                                  'modelSha256': pinned['modelSha256'],
                                  'verifiedExtractedFiles': len(pinned['extractedFiles']),
                                  'npz': {key: value for key, value in result.items() if key != 'arrayHeaders'}})
        output = no_links(folder / 'array-headers.json')
        output.write_text(json.dumps(result['arrayHeaders'], indent=2) + '\n', 'utf8')
    footprint = footprint_bytes(work)
    report['experimentFootprintBytes'] = footprint
    report['resources'] = admission(manifest, shutil.disk_usage(ROOT).free, available_memory(), installed)
    report['status'] = ('sources-verified-conversion-not-attempted' if report['resources']['resourcesAndDependenciesReady']
                        else 'sources-verified-conversion-resources-blocked')
    output = no_links(work / ('verification-' + args.direction + '.json'))
    output.write_text(json.dumps(report, indent=2) + '\n', 'utf8')
    print(json.dumps({'status': report['status'], 'sources': report['sources'],
                      'experimentFootprintBytes': footprint,
                      'availableRamBytes': report['resources']['availableRamBytes']}))


if __name__ == '__main__':
    main()

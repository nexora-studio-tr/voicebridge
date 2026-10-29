"""Offline admission check for a research-only Marian conversion. Never downloads or loads weights."""
from __future__ import annotations

import argparse
import ctypes
import hashlib
import importlib.metadata
import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'docs/experiments/marian-source-preflight.json'
MAX_METADATA_BYTES = 2 * 1024**2


def source_sha256(path):
    # Source packages/Git use LF on both platforms. Model metadata hashes stay byte-exact.
    return hashlib.sha256(Path(path).read_bytes().replace(b'\r\n', b'\n')).hexdigest()


def plain_name(value):
    if (not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9+_.-]{0,159}', value)
            or value.endswith('.')):
        raise ValueError('METADATA_NAME')
    return value


def validate_manifest(document):
    if (document.get('schemaVersion') != 1 or document.get('downloadEnabled') is not False
            or document.get('runtimeActivation') is not False
            or document.get('completeDownloadLock') is not False):
        raise ValueError('PREFLIGHT_ONLY')
    policy = document.get('resourcePolicy', {})
    if (not 5 * 1024**3 <= policy.get('temporaryBudgetBytes', 0) <= 8 * 1024**3
            or not 10 * 1024**3 <= policy.get('reserveFreeDiskBytes', 0) <= 20 * 1024**3
            or policy.get('maxConversionProcesses') != 1 or policy.get('cpuThreads') != 2):
        raise ValueError('RESOURCE_POLICY')
    sources = document.get('sources', [])
    if len(sources) != 2 or {s.get('direction') for s in sources} != {'en-tr', 'tr-en'}:
        raise ValueError('SOURCE_DIRECTIONS')
    for source in sources:
        if not 2 * 1024**3 <= source.get('minimumAvailableRamBytes', 0) <= 8 * 1024**3:
            raise ValueError('MEMORY_POLICY')
        archive = source['archive']
        url = urlsplit(archive['url'])
        if (url.scheme != 'https' or url.netloc != 'object.pouta.csc.fi'
                or not url.path.startswith('/Tatoeba-MT-models/') or not url.path.endswith('.zip')
                or url.query or url.fragment or not re.fullmatch('[a-f0-9]{32}', archive['observedEtag'])
                or not 0 < archive['bytes'] <= 1024**3):
            raise ValueError('SOURCE_IDENTITY')
        entries = archive['entries']
        names = [plain_name(e['name']) for e in entries]
        if len(names) != len(set(names)) or len(names) > 32:
            raise ValueError('ARCHIVE_ENTRIES')
        if (sum(e['bytes'] for e in entries) != archive['unpackedBytes']
                or any(not 0 <= e['offset'] < archive['bytes'] or e['bytes'] < 0
                       or not 0 <= e['compressed'] <= archive['bytes'] for e in entries)):
            raise ValueError('ARCHIVE_BOUNDS')
        for name in ('model', 'sourceVocabulary', 'targetVocabulary', 'sourceTokenizer', 'targetTokenizer'):
            if plain_name(source[name]) not in names:
                raise ValueError('SOURCE_FILE_MISSING')
        metadata = source['metadata']
        required = {'README.md', 'LICENSE', source['sourceVocabulary'], source['targetVocabulary'],
                    source['sourceTokenizer'], source['targetTokenizer']}
        if not required.issubset({s['name'] for s in metadata}):
            raise ValueError('METADATA_REQUIRED')
        if len(metadata) != len({s['name'] for s in metadata}):
            raise ValueError('METADATA_DUPLICATE')
        for item in metadata:
            entry = next((e for e in entries if e['name'] == plain_name(item['name'])), None)
            if (not entry or item['bytes'] != entry['bytes'] or not 0 < item['bytes'] <= MAX_METADATA_BYTES
                    or not re.fullmatch('[a-f0-9]{64}', item['sha256'])):
                raise ValueError('METADATA_IDENTITY')
    return document


def verify_metadata(folder, source):
    # Refuse symlinks/junctions, including ancestor paths. No archive extraction or scripts.
    folder = Path(folder).absolute()
    for path in (folder, *folder.parents):
        if path.is_symlink() or path.is_junction():
            raise ValueError('METADATA_LINK')
    checked = []
    for item in source['metadata']:
        if not 0 < item['bytes'] <= MAX_METADATA_BYTES:
            raise ValueError('METADATA_SIZE_OR_MISSING')
        path = folder / plain_name(item['name'])
        if path.is_symlink() or path.is_junction():
            raise ValueError('METADATA_LINK')
        if not path.is_file() or path.stat().st_size != item['bytes']:
            raise ValueError('METADATA_SIZE_OR_MISSING')
        if hashlib.sha256(path.read_bytes()).hexdigest() != item['sha256']:
            raise ValueError('METADATA_SHA256')
        checked.append({'name': item['name'], 'bytes': item['bytes'], 'sha256': item['sha256']})
    return checked


def available_memory():
    if sys.platform == 'win32':
        class Memory(ctypes.Structure):
            _fields_ = [('length', ctypes.c_ulong), ('load', ctypes.c_ulong),
                        *[(name, ctypes.c_ulonglong) for name in ('total', 'available', 'page',
                          'availablePage', 'virtual', 'availableVirtual', 'extended')]]
        memory = Memory()
        memory.length = ctypes.sizeof(memory)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(memory)):
            return memory.available
    elif sys.platform.startswith('linux'):
        try:
            data = Path('/proc/meminfo').read_text('ascii')
            match = re.search(r'^MemAvailable:\s+(\d+) kB$', data, re.MULTILINE)
            if match:
                return int(match.group(1)) * 1024
        except OSError:
            pass
    # Unknown memory is never treated as enough memory. No process termination or swap changes.
    return None


def admission(document, free_disk, free_ram, installed):
    policy = document['resourcePolicy']
    required_disk = policy['temporaryBudgetBytes'] + policy['reserveFreeDiskBytes']
    dependencies = {name: {'required': version, 'installed': installed.get(name),
                           'matches': installed.get(name) == version}
                    for name, version in document['dependencies'].items()}
    directions = {}
    for source in document['sources']:
        directions[source['direction']] = {
            'requiredAvailableRamBytes': source['minimumAvailableRamBytes'],
            'memorySufficient': free_ram is not None and free_ram >= source['minimumAvailableRamBytes']}
    return {'freeDiskBytes': free_disk, 'requiredFreeDiskBytes': required_disk,
            'diskSufficient': free_disk >= required_disk, 'availableRamBytes': free_ram,
            'directions': directions, 'dependencies': dependencies,
            'resourcesAndDependenciesReady': free_disk >= required_disk
                and all(r['memorySufficient'] for r in directions.values())
                and all(r['matches'] for r in dependencies.values()),
            'downloadAllowed': False, 'conversionAllowed': False, 'runtimePromotion': False}


def piece_coverage(tokenizer, vocabulary):
    tokens = [tokenizer.id_to_piece(i) for i in range(tokenizer.get_piece_size())]
    if not {'</s>', '<unk>'}.issubset(vocabulary):
        raise ValueError('VOCABULARY_SPECIAL_TOKENS')
    missing = set(tokens) - set(vocabulary)
    missing_control = {p for p in missing if tokenizer.is_control(tokenizer.piece_to_id(p))}
    return {'pieces': len(tokens), 'vocabularyTokens': len(vocabulary),
            'allPiecesInVocabulary': not missing,
            'missingControlPieces': sorted(missing_control),
            'missingOrdinaryPieceCount': len(missing - missing_control),
            'unknownFallbackMustBeValidated': bool(missing - missing_control),
            'sentencepieceBosId': tokenizer.bos_id(), 'sentencepieceEosId': tokenizer.eos_id(),
            'marianEosVocabularyId': vocabulary.index('</s>'),
            'marianUnknownVocabularyId': vocabulary.index('<unk>')}


def inspect_tokenizers(folder, source):
    # Called only after every metadata hash passed; native model weights are never opened.
    import sentencepiece
    from ctranslate2.converters.marian import load_vocab

    vocabulary = load_vocab(str(folder / source['sourceVocabulary']))
    target_vocabulary = load_vocab(str(folder / source['targetVocabulary']))
    if len(vocabulary) != len(set(vocabulary)) or len(target_vocabulary) != len(set(target_vocabulary)):
        raise ValueError('VOCABULARY_DUPLICATE')
    result = {}
    for side, language, vocab in (('source', source['direction'][:2], vocabulary),
                                  ('target', source['direction'][-2:], target_vocabulary)):
        tokenizer = sentencepiece.SentencePieceProcessor(model_file=str(folder / source[side + 'Tokenizer']))
        # Missing ordinary pieces are a recorded adapter concern, not silently a full pass.
        coverage = piece_coverage(tokenizer, vocab)
        text = 'Please wait.' if language == 'en' else 'Lütfen bekle.'
        encoded = tokenizer.encode(text, out_type=str)
        if not encoded or tokenizer.decode(encoded) != text or not set(encoded).issubset(vocab):
            raise ValueError('TOKENIZER_ROUNDTRIP')
        result[side] = {**coverage, 'smokeRoundtrip': True}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--metadata-dir', type=Path, default=ROOT / 'artifacts/marian-preflight')
    parser.add_argument('--inspect-tokenizers', action='store_true')
    args = parser.parse_args()
    document = validate_manifest(json.loads(MANIFEST.read_text('utf8')))
    installed = {'python': '.'.join(map(str, sys.version_info[:2]))}
    for name in document['dependencies'].keys() - {'python'}:
        try:
            installed[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            installed[name] = None
    resources = admission(document, shutil.disk_usage(ROOT).free, available_memory(), installed)
    report = {'schemaVersion': 1, 'status': 'metadata-preflight',
              'scope': 'Offline metadata, dependency and resource admission; no conversion or quality evaluation.',
              'tokenizerInspectionRequested': args.inspect_tokenizers,
              'sourceMetadataObservedAt': document['observedAt'],
              'checkedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
              'sourceHashNormalization': 'lf',
              'preflightScriptSha256': source_sha256(__file__),
              'manifestSha256': source_sha256(MANIFEST),
              'networkRequests': 0, 'weightsDownloaded': False, 'weightsLoaded': False,
              'dependenciesInstalled': False, 'resources': resources, 'sources': []}
    for source in document['sources']:
        folder = args.metadata_dir / source['direction']
        result = {'direction': source['direction'], 'metadata': verify_metadata(folder, source),
                  'archiveVerified': False, 'embeddedModelConfigVerified': False,
                  'licenseInArchive': source['licenseInArchive']}
        if args.inspect_tokenizers:
            if not all(v['matches'] for v in resources['dependencies'].values()):
                raise ValueError('DEPENDENCY_MISMATCH')
            result['tokenizers'] = inspect_tokenizers(folder, source)
        report['sources'].append(result)
    report['status'] = ('metadata-verified-resources-ready' if resources['resourcesAndDependenciesReady']
                        else 'metadata-verified-resources-blocked')
    # A resource pass is not authorization, a complete download lock, or conversion success.
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()

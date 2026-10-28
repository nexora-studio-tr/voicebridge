"""Pinned, resumable-by-file model installer. No account or API key is used."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import shutil
import stat
import sys
import zipfile
from pathlib import Path, PurePosixPath
from urllib.request import Request, urlopen
from urllib.parse import urlparse


def safe_path(root: Path, name: str) -> Path:
    relative = PurePosixPath(name)
    if relative.is_absolute() or not relative.parts or '..' in relative.parts or '\\' in name or ':' in name:
        raise ValueError('Unsafe model path')
    dest = root.joinpath(*relative.parts)
    if not dest.resolve().is_relative_to(root.resolve()):
        raise ValueError('Model path escaped installation directory')
    for parent in (dest, *dest.parents):
        if parent == root.parent:
            break
        if parent.is_symlink():
            raise ValueError('Symlinks are not allowed in the model directory')
    return dest


def digest(file: Path):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def download(root, item, offline):
    target = safe_path(root, item['path'])
    if target.is_file() and target.stat().st_size == item['bytes'] and digest(target) == item['sha256']:
        return target
    if offline:
        raise ValueError('Missing or modified model: ' + item['path'])
    url = urlparse(item['url'])
    if url.scheme != 'https' or url.hostname not in ('huggingface.co', 'data.argosopentech.com'):
        raise ValueError('Untrusted model source')
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = safe_path(root, item['path'] + '.partial')
    offset = partial.stat().st_size if partial.is_file() else 0
    if offset > item['bytes']:
        partial.unlink()
        offset = 0
    print('Downloading ' + item['path'], flush=True)
    if offset < item['bytes']:
        headers = {'User-Agent': 'VoiceBridge model installer', 'Accept-Encoding': 'identity'}
        if offset:
            headers['Range'] = f'bytes={offset}-'
        with urlopen(Request(item['url'], headers=headers), timeout=120) as response:
            status = response.status
            if status not in (200, 206):
                raise ValueError('Model download failed')
            if status == 206:
                if response.headers.get('Content-Range') != f"bytes {offset}-{item['bytes'] - 1}/{item['bytes']}":
                    raise ValueError('Invalid model resume range')
            else:
                offset = 0
            size = offset
            with partial.open('ab' if offset else 'wb') as output:
                while chunk := response.read(1024 * 1024):
                    size += len(chunk)
                    if size > item['bytes']:
                        raise ValueError('Model download exceeded pinned size')
                    output.write(chunk)
                    print(json.dumps({'type': 'download', 'file': item['path'], 'bytes': size, 'total': item['bytes']}), flush=True)
    if partial.stat().st_size != item['bytes']:
        raise ValueError('Model download incomplete; resume to continue')
    if digest(partial) != item['sha256']:
        partial.unlink(missing_ok=True)
        raise ValueError('Model integrity verification failed')
    os.replace(partial, target)
    return target


def extract(archive: Path, root: Path, pair: str):
    extracted = {}
    total = 0
    with zipfile.ZipFile(archive) as source:
        if len(source.infolist()) > 2000:
            raise ValueError('Too many archive entries')
        for item in source.infolist():
            # Validate every path, including entries we will not use (e.g. unused Stanza models).
            safe_path(root, item.filename)
            if stat.S_ISLNK(item.external_attr >> 16):
                raise ValueError('Archive symlink rejected')
            parts = PurePosixPath(item.filename).parts
            if item.is_dir() or len(parts) < 2:
                continue
            relative = PurePosixPath(*parts[1:])
            if not (relative.parts[0] == 'model' or relative.name in ('sentencepiece.model', 'metadata.json', 'README.md', 'README', 'LICENSE', 'LICENSE.txt')):
                continue
            total += item.file_size
            if total > 500 * 1024 * 1024:
                raise ValueError('Model extraction size limit')
            dest_name = f'translation/{pair}/{relative.as_posix()}'
            dest = safe_path(root, dest_name)
            dest.parent.mkdir(parents=True, exist_ok=True)
            with source.open(item) as src, dest.open('wb') as output:
                shutil.copyfileobj(src, output, 1024 * 1024)
            if dest.stat().st_size != item.file_size:
                raise ValueError('Incomplete extraction')
            extracted[dest_name] = digest(dest)
    for required in ('model/model.bin', 'sentencepiece.model', 'metadata.json'):
        if f'translation/{pair}/{required}' not in extracted:
            raise ValueError('Incomplete translation archive')
    return extracted


def install(root: Path, offline=False, verify_only=False):
    lock = json.loads(Path(__file__).with_name('model-lock.json').read_text('utf8'))
    root = root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    files = {item['path']: download(root, item, offline or verify_only) for item in lock['files']}
    marker = root / 'installed.json'
    if verify_only:
        installed = json.loads(marker.read_text('utf8'))
        if installed.get('lockSha256') != digest(Path(__file__).with_name('model-lock.json')):
            raise ValueError('Model lock changed; rerun the installer')
        for name, expected in installed['extracted'].items():
            if digest(safe_path(root, name)) != expected:
                raise ValueError('Extracted model changed: ' + name)
    else:
        extracted = {}
        for pair in ('en_tr', 'tr_en'):
            extracted.update(extract(files[f'downloads/{pair}.argosmodel'], root, pair))
        marker.write_text(json.dumps({'lockSha256': digest(Path(__file__).with_name('model-lock.json')), 'extracted': extracted}, indent=2), encoding='utf8')
    print(json.dumps({'status': 'verified' if verify_only else 'installed', 'pinnedFiles': len(files), 'modelDirectory': str(root)}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1] / '.voicebridge/models')
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    install(args.root, args.offline, args.verify_only)

"""Verify the release manifest and safely extract a fresh source installation."""
import hashlib,json,re,stat,sys,zipfile
from pathlib import Path,PurePosixPath
archive=Path(sys.argv[1]).resolve();target=Path(sys.argv[2]).resolve()
target.mkdir(parents=True,exist_ok=False)
with zipfile.ZipFile(archive) as package:
    entries=package.infolist();names=[entry.filename for entry in entries]
    if len(names)!=len(set(names)) or len(entries)>501:raise ValueError('Archive entry count/duplicates')
    if sum(entry.file_size for entry in entries)>12*1024*1024:raise ValueError('Archive size limit')
    manifest=json.loads(package.read('voicebridge/SOURCE_MANIFEST.json'))
    if set(names)!={'voicebridge/'+name for name in manifest}|{'voicebridge/SOURCE_MANIFEST.json'}:raise ValueError('Manifest coverage mismatch')
    for entry in entries:
        name=PurePosixPath(entry.filename)
        if name.is_absolute() or '..' in name.parts or '\\' in entry.filename or ':' in entry.filename or name.parts[0]!='voicebridge' or stat.S_ISLNK(entry.external_attr>>16):raise ValueError('Unsafe archive path')
        relative=PurePosixPath(*name.parts[1:])
        if any(part in ('.git','.venv','node_modules','artifacts') or part.startswith('.voicebridge') for part in relative.parts):raise ValueError('Runtime data in source package')
        if relative.name.startswith('.env') and relative.name!='.env.example':raise ValueError('Private environment file')
        raw=package.read(entry)
        if str(relative)!='SOURCE_MANIFEST.json' and hashlib.sha256(raw).hexdigest()!=manifest[str(relative)]:raise ValueError('Source hash mismatch')
        path=target.joinpath(*name.parts)
        if not path.resolve().is_relative_to(target):raise ValueError('Extraction escape')
        path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
metadata=json.loads((target/'voicebridge/package.json').read_text('utf8'))
print(json.dumps({'version':metadata['version'],'sourceFiles':len(manifest),'manifest':'verified','archiveSha256':hashlib.sha256(archive.read_bytes()).hexdigest()}))

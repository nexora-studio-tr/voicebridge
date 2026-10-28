"""Archive only the freshly built portable package; reject mutable data and links."""
import sys
import zipfile
from pathlib import Path

root = Path(sys.argv[1]).resolve()
destination = Path(sys.argv[2]).resolve()
for required in ('VoiceBridge.exe', 'PACKAGE_MANIFEST.json', 'runtime/node.exe', 'app/dist/launcher/main.js'):
    if not (root / required).is_file():
        raise ValueError('Incomplete Windows package')
files = sorted(path for path in root.rglob('*') if path.is_file())
if len(files) > 20000:
    raise ValueError('Windows file-count limit')
with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for file in files:
        relative = file.relative_to(root)
        if file.is_symlink() or not file.resolve().is_relative_to(root) or relative.parts[0] in ('.installer', 'data') or any(part in ('.voicebridge', '.venv', '.git') for part in relative.parts) or file.name.startswith('.env'):
            raise ValueError('Private or unexpected package file')
        archive.write(file, 'VoiceBridge/' + relative.as_posix())

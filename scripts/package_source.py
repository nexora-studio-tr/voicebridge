"""Build an allowlisted, secret-checked source ZIP. Never traverses sibling projects."""
import hashlib
import json
import re
import zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DIRS=('src','tests','worker','scripts','docs','examples','.github')
ROOT_FILES=('README.md','README.tr.md','LICENSE','NOTICE','SECURITY.md','CONTRIBUTING.md','CODE_OF_CONDUCT.md','ROADMAP.md','CHANGELOG.md','THIRD_PARTY_NOTICES.md','.gitignore','.gitattributes','.prettierrc.json','.env.example','package.json','package-lock.json','tsconfig.json','tsconfig.server.json','vite.config.ts','vitest.config.ts','Start-VoiceBridge.ps1')
EXTENSIONS={'.ts','.tsx','.js','.mjs','.json','.py','.txt','.lock','.md','.html','.css','.svg','.yml','.yaml','.ps1'}
SECRET_PATTERNS=[re.compile(r'sk-[A-Za-z0-9_-]{25,}'),re.compile(r'(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{23,30}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{25,}'),re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')]
SECRET_PATTERNS.extend([re.compile(r'gh[pousr]_[A-Za-z0-9]{30,}'),re.compile(r'github_pat_[A-Za-z0-9_]{30,}'),re.compile(r'https://(?:canary\.|ptb\.)?discord(?:app)?\.com/api/webhooks/\d+/[A-Za-z0-9_-]{25,}')])


def build():
    metadata=json.loads((ROOT/'package.json').read_text('utf8'))
    version=metadata['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?',version):raise ValueError('Invalid release version')
    lock=json.loads((ROOT/'package-lock.json').read_text('utf8'))
    if lock['version']!=version or lock['packages']['']['version']!=version:raise ValueError('Package versions disagree')
    if f"export const VERSION = '{version}';" not in (ROOT/'src/core/contracts.ts').read_text('utf8'):raise ValueError('Runtime version disagrees')
    selected=[]
    for name in ROOT_FILES:
        path=ROOT/name
        if path.is_file():selected.append(path)
    for name in DIRS:
        for path in (ROOT/name).rglob('*'):
            if any(part in ('__pycache__','node_modules','.venv','.git') for part in path.relative_to(ROOT).parts):continue
            if not path.is_file():continue
            if path.suffix=='.wav':
                if not re.fullmatch(r'examples/demo/(?:source|translated)-[0-3]\.wav',path.relative_to(ROOT).as_posix()):raise ValueError('Unexpected audio asset')
            elif path.suffix=='.png':
                if path.relative_to(ROOT).as_posix() not in ('docs/assets/demo-en.png','docs/assets/demo-tr.png','docs/assets/setup-checks-en.png','docs/assets/setup-checks-tr.png'):raise ValueError('Unexpected screenshot asset')
            elif path.suffix not in EXTENSIONS and path.name not in ('LICENSE','NOTICE'):raise ValueError('Unexpected source file type: '+path.name)
            selected.append(path)
    if len(selected)>500:raise ValueError('Source file-count limit')
    files={}
    for path in sorted(set(selected)):
        if path.is_symlink() or not path.resolve().is_relative_to(ROOT):raise ValueError('Source symlink/path escape')
        raw=path.read_bytes()
        if path.suffix not in ('.wav','.png'):
            text=raw.decode('utf8').replace('\r\n','\n')
            if any(pattern.search(text) for pattern in SECRET_PATTERNS):raise ValueError('Possible secret in source; inspect locally: '+str(path.relative_to(ROOT)))
            raw=text.encode('utf8')
        files[path.relative_to(ROOT).as_posix()]=raw
    if sum(map(len,files.values()))>10*1024*1024:raise ValueError('Source size limit')
    required={'README.md','README.tr.md','LICENSE','NOTICE','worker/model-lock.json','examples/demo/samples.json','docs/reports/local-synthetic.json','docs/reports/worker-synthetic.json'}
    if not required.issubset(files):raise ValueError('Required deliverable is missing: '+str(required-files.keys()))
    out=ROOT/'artifacts/release';out.mkdir(parents=True,exist_ok=True)
    archive=out/f'voicebridge-{version}-source.zip'
    manifest={name:hashlib.sha256(raw).hexdigest() for name,raw in files.items()}
    with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as package:
        for name,raw in {**files,'SOURCE_MANIFEST.json':(json.dumps(manifest,indent=2)+'\n').encode()}.items():
            info=zipfile.ZipInfo('voicebridge/'+name,date_time=(2026,10,25,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16;package.writestr(info,raw)
    sha=hashlib.sha256(archive.read_bytes()).hexdigest()
    (out/'SHA256SUMS.txt').write_text(sha+'  '+archive.name+'\n',encoding='ascii')
    print(json.dumps({'status':'packaged','version':version,'files':len(files),'bytes':archive.stat().st_size,'sha256':sha,'archive':str(archive)}))


if __name__=='__main__':build()

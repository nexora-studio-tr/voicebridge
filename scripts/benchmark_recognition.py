"""Offline synthetic English recognition regression; never connects to Discord or a paid API."""
import argparse, gc, hashlib, importlib.util, io, json, re, sys, time, wave
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'worker'))
from engine import Engine

PHRASES=[
    "The meeting starts at three. Please open the document.",
    "We can continue tomorrow. Thank you for your help.",
    "I didn't say delete the backup. I said keep it until Friday.",
    "We need fifteen minutes, not fifty. Please check the microphone.",
    "I have already sent the invitation, but they haven't replied yet.",
    "We don't need to restart the server. Please keep the current settings.",
]
OUT=ROOT/'artifacts/asr-repair'

NUMBER_WORDS=dict(zip(('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen').split(),map(str,range(20))))
NUMBER_WORDS.update(dict(zip(('twenty thirty forty fifty sixty seventy eighty ninety').split(),map(str,range(20,100,10)))))
def tokens(text,normalize_numbers=True):
    words=re.findall(r"[a-z]+(?:'[a-z]+)?|\d+",text.lower())
    return [NUMBER_WORDS.get(word,word) for word in words] if normalize_numbers else words
def distance(a,b):
    row=list(range(len(b)+1))
    for i,x in enumerate(a,1):
        next_row=[i]
        for j,y in enumerate(b,1): next_row.append(min(row[j]+1,next_row[-1]+1,row[j-1]+(x!=y)))
        row=next_row
    return row[-1]

def generate(engine):
    corpus=[]
    for i,text in enumerate(PHRASES):
        audio=engine.speak(text,'en')
        name=f'english-{i}-clean.wav';(OUT/name).write_bytes(audio)
        corpus.append({'audio':name,'reference':text,'condition':'synthetic clean'})
        with wave.open(io.BytesIO(audio)) as w:
            rate=w.getframerate();samples=np.frombuffer(w.readframes(w.getnframes()),dtype='<i2').astype(np.float32)/32768
        # A deterministic softer, slightly faster synthetic speaker with light background noise.
        samples=np.interp(np.arange(0,len(samples),1.12),np.arange(len(samples)),samples)*.18
        samples+=np.random.default_rng(83+i).normal(0,.004,len(samples))
        stream=io.BytesIO()
        with wave.open(stream,'wb') as w:
            w.setnchannels(1);w.setsampwidth(2);w.setframerate(rate);w.writeframes((np.clip(samples,-1,1)*32767).astype('<i2').tobytes())
        name=f'english-{i}-soft.wav';(OUT/name).write_bytes(stream.getvalue())
        corpus.append({'audio':name,'reference':text,'condition':'synthetic soft/noisy/faster'})
    (OUT/'corpus.json').write_text(json.dumps(corpus,indent=2),encoding='utf8')
    engine.voices.clear();gc.collect()

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine-file',type=Path)
    parser.add_argument('--output',default='after.json')
    parser.add_argument('--generate',action='store_true')
    parser.add_argument('--rescore',action='store_true',help='Re-score an existing report with number-word normalization, without rerunning inference')
    args=parser.parse_args()
    OUT.mkdir(parents=True,exist_ok=True)
    if args.rescore:
        report=json.loads((OUT/args.output).read_text('utf8'))
        for row in report['samples']:
            row['rawWordErrors']=distance(tokens(row['reference'],False),tokens(row['recognized'],False))
            row['wordErrors']=distance(tokens(row['reference']),tokens(row['recognized']))
            row['audioSha256']=hashlib.sha256((OUT/row['audio']).read_bytes()).hexdigest()
        report['wordErrors']=sum(row['wordErrors'] for row in report['samples'])
        report['wordErrorRate']=round(report['wordErrors']/report['referenceWords'],4)
        report['normalization']='case, punctuation, and equivalent standalone cardinal words/numerals (zero to nineteen and tens); no semantic matching'
        (OUT/args.output).write_text(json.dumps(report,indent=2),encoding='utf8')
        print(json.dumps({'wordErrors':report['wordErrors'],'wordErrorRate':report['wordErrorRate'],'samples':len(report['samples'])}));return
    engine_class=Engine
    if args.engine_file:
        spec=importlib.util.spec_from_file_location('baseline_engine',args.engine_file)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);engine_class=module.Engine
    engine=engine_class(ROOT/'.voicebridge/models')
    if args.generate:generate(engine)
    rows=[]
    for sample in json.loads((OUT/'corpus.json').read_text('utf8')):
        started=time.monotonic();text=engine.recognize((OUT/sample['audio']).read_bytes(),'en')
        reference=tokens(sample['reference']);errors=distance(reference,tokens(text))
        row={**sample,'recognized':text,'wordErrors':errors,'rawWordErrors':distance(tokens(sample['reference'],False),tokens(text,False)),
            'referenceWords':len(reference),'elapsedMs':round((time.monotonic()-started)*1000),'audioSha256':hashlib.sha256((OUT/sample['audio']).read_bytes()).hexdigest()}
        rows.append(row);print(json.dumps(row,ensure_ascii=True),flush=True)
    report={'synthetic':True,'liveDiscord':False,'normalization':'case, punctuation, and equivalent standalone cardinal words/numerals (zero to nineteen and tens); no semantic matching','samples':rows,
        'wordErrors':sum(r['wordErrors'] for r in rows),'referenceWords':sum(r['referenceWords'] for r in rows)}
    report['wordErrorRate']=round(report['wordErrors']/report['referenceWords'],4)
    (OUT/args.output).write_text(json.dumps(report,indent=2),encoding='utf8')
    print(json.dumps({'wordErrors':report['wordErrors'],'wordErrorRate':report['wordErrorRate'],'samples':len(rows)}),flush=True)

if __name__=='__main__':main()

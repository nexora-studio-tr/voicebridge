"""Uses generated synthetic speech; no Discord connection or paid API calls."""
import io,json,os,sys,time,wave
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'worker'))
from engine import Engine
if hasattr(sys.stdout,'reconfigure'):sys.stdout.reconfigure(encoding='utf-8')
root=Path(__file__).resolve().parents[1]
out=root/'artifacts/local-validation';out.mkdir(parents=True,exist_ok=True)
engine=Engine(Path(os.environ.get('VOICEBRIDGE_DATA',str(root/'.voicebridge')))/'models')
phrases=[('en','The meeting starts at three. Please open the document.'),('tr','Toplantı saat üçte başlıyor. Lütfen belgeyi açın.'),('en','We can continue tomorrow. Thank you for your help.'),('tr','Yarın devam edebiliriz. Yardımınız için teşekkür ederim.')]
results=[]
for i,(lang,text) in enumerate(phrases):
    target='en' if lang=='tr' else 'tr'
    started=time.monotonic();audio=engine.speak(text,lang);ttsSourceMs=round((time.monotonic()-started)*1000)
    (out/f'source-{i}.wav').write_bytes(audio)
    started=time.monotonic();recognized=engine.recognize(audio,lang);asrMs=round((time.monotonic()-started)*1000)
    started=time.monotonic();translated=engine.translate(recognized,lang,target);translationMs=round((time.monotonic()-started)*1000)
    started=time.monotonic();spoken=engine.speak(translated,target);speechMs=round((time.monotonic()-started)*1000)
    (out/f'translated-{i}.wav').write_bytes(spoken)
    with wave.open(io.BytesIO(audio)) as w:seconds=w.getnframes()/w.getframerate()
    row={'id':i,'sourceLanguage':lang,'language':target,'reference':text,'source':recognized,'text':translated,'sourceSeconds':round(seconds,2),'sourceTtsMs':ttsSourceMs,'asrMs':asrMs,'translationMs':translationMs,'speechMs':speechMs,'pipelineMs':asrMs+translationMs+speechMs,'audio':'translated-'+str(i)+'.wav'}
    if not recognized or not translated or len(spoken)<1000:raise RuntimeError('Empty pipeline result')
    results.append(row);print(json.dumps(row,ensure_ascii=True),flush=True)
(out/'report.json').write_text(json.dumps({'status':'completed','synthetic':True,'device':'CPU','samples':results},indent=2,ensure_ascii=False),encoding='utf8')

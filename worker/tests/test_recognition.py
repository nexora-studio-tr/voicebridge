import io,sys,tempfile,unittest,wave
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from engine import Engine
TEST_ROOT=Path(__file__).resolve().parents[2]/'artifacts/python-tests'
TEST_ROOT.mkdir(parents=True,exist_ok=True)

class FakeRecognizer:
    instances=[]
    def __init__(self,path,**options):
        self.path=Path(path);self.options=options;self.calls=[];self.instances.append(self)
    def transcribe(self,samples,**options):
        self.calls.append(options)
        return iter([SimpleNamespace(text=' recognized speech ',no_speech_prob=.1,avg_logprob=-.3,compression_ratio=1.1)]),None

def audio():
    stream=io.BytesIO()
    with wave.open(stream,'wb') as w:
        w.setnchannels(1);w.setsampwidth(2);w.setframerate(16000)
        w.writeframes((1000).to_bytes(2,'little',signed=True)*16000)
    return stream.getvalue()

class RecognitionTests(unittest.TestCase):
    def setUp(self): FakeRecognizer.instances.clear()
    def test_english_search_preserves_turkish_and_never_reuses_speaker_text_context(self):
        with tempfile.TemporaryDirectory(dir=TEST_ROOT) as folder,patch.dict(sys.modules,{'faster_whisper':SimpleNamespace(WhisperModel=FakeRecognizer)}):
            root=Path(folder);engine=Engine(root)
            self.assertEqual(engine.recognize(audio(),'en'),'recognized speech')
            model=FakeRecognizer.instances[0]
            self.assertEqual(model.path,root/'asr')
            self.assertEqual(model.calls[0]['beam_size'],5)
            self.assertEqual(model.calls[0]['temperature'],0.0)
            self.assertEqual(model.calls[0]['task'],'transcribe')
            self.assertEqual(model.calls[0]['vad_parameters']['min_silence_duration_ms'],700)
            self.assertTrue(model.options['local_files_only'])
            engine.recognize(audio(),'tr');tr=model.calls[1]
            self.assertEqual(tr['language'],'tr');self.assertEqual(tr['beam_size'],1)
            self.assertEqual(tr['vad_parameters']['min_silence_duration_ms'],350)
            self.assertNotIn('temperature',tr)
            engine.recognize(audio(),'en')
            self.assertEqual(len(FakeRecognizer.instances),1)
            self.assertTrue(all(not call['condition_on_previous_text'] for call in model.calls))

if __name__=='__main__':unittest.main()

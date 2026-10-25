import io
import json
import sys
import tempfile
import unittest
import wave
import zipfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine import Engine
from install_models import extract, safe_path
from okur_onnx import timeline, gaussian_noise
import numpy as np
TEST_ROOT=Path(__file__).resolve().parents[2]/'artifacts/python-tests'
TEST_ROOT.mkdir(parents=True,exist_ok=True)


class SafetyTests(unittest.TestCase):
    def test_numpy_timeline_preserves_rounded_word_durations(self):
        cw,start,fw,fp=timeline('a b',np.array([1.5,0.5,2.2],dtype=np.float32))
        np.testing.assert_array_equal(cw,[0,0,1]);np.testing.assert_array_equal(start,[0,0,2]);np.testing.assert_array_equal(fw,[0,0,1,1]);np.testing.assert_allclose(fp,[0,.5,0,.5])

    def test_timeline_rejects_excessive_speech_before_allocating_decoder_frames(self):
        with self.assertRaises(ValueError):timeline('a',np.array([501.]))
        with self.assertRaises(ValueError):timeline('a',np.array([0.]))

    def test_sampling_noise_is_repeatable_and_finite(self):
        np.testing.assert_array_equal(gaussian_noise(0,11),gaussian_noise(0,11))
        self.assertTrue(np.isfinite(gaussian_noise(42,11)).all())
    def test_archive_traversal_is_rejected(self):
        with tempfile.TemporaryDirectory(dir=TEST_ROOT) as folder:
            root=Path(folder)
            for name in ('../outside', '/absolute', 'C:/windows', 'root/../../escape', 'root\\escape'):
                with self.subTest(name=name), self.assertRaises(ValueError): safe_path(root,name)

    def test_archive_symlink_and_zip_slip_are_rejected(self):
        with tempfile.TemporaryDirectory(dir=TEST_ROOT) as folder:
            root=Path(folder)
            archive=root/'bad.zip'
            with zipfile.ZipFile(archive,'w') as z:z.writestr('model/../../escape','bad')
            with self.assertRaises(ValueError):extract(archive,root,'tr_en')
            with zipfile.ZipFile(archive,'w') as z:
                item=zipfile.ZipInfo('model/link');item.external_attr=(0o120777<<16);z.writestr(item,'../../escape')
            with self.assertRaises(ValueError):extract(archive,root,'tr_en')

    def test_required_model_and_notice_files_are_preserved(self):
        with tempfile.TemporaryDirectory(dir=TEST_ROOT) as folder:
            root=Path(folder);archive=root/'model.zip'
            with zipfile.ZipFile(archive,'w') as z:
                for name in ('model/model.bin','sentencepiece.model','metadata.json','README.md'):
                    z.writestr('upstream/'+name,'{}' if name.endswith('json') else 'test')
                z.writestr('upstream/stanza/unused','unused')
            hashes=extract(archive,root,'tr_en')
            self.assertIn('translation/tr_en/README.md',hashes)
            self.assertFalse((root/'translation/tr_en/stanza').exists())

    def test_silence_never_loads_the_recognizer(self):
        engine=Engine(Path('not-installed'))
        stream=io.BytesIO()
        with wave.open(stream,'wb') as w:
            w.setnchannels(1);w.setsampwidth(2);w.setframerate(16000);w.writeframes(bytes(16000))
        self.assertEqual(engine.recognize(stream.getvalue(),'en'),'')
        self.assertIsNone(engine.recognizer)

    def test_input_bounds_and_language_are_checked_before_inference(self):
        engine=Engine(Path('not-installed'))
        for value in ('', 'x'*1201, '\x00',None):
            with self.subTest(value=str(value)[:10]), self.assertRaises(ValueError):engine.text(value)
        with self.assertRaises(ValueError):engine.language('unknown')
        with self.assertRaises(ValueError):engine.recognize(bytes(2*1024*1024+1),'en')
        self.assertFalse(engine.status()['ready'])


if __name__=='__main__':unittest.main()

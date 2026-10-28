import hashlib
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from install_models import download


class Response(io.BytesIO):
    def __init__(self, data, status=200, content_range=None):
        super().__init__(data)
        self.status = status
        self.headers = {'Content-Range': content_range} if content_range else {}


class ModelResumeTests(unittest.TestCase):
    data = b'verified model fixture'

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='voicebridge-model-resume-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.item = {'path': 'model.bin', 'url': 'https://huggingface.co/fixture/model.bin',
                     'bytes': len(self.data), 'sha256': hashlib.sha256(self.data).hexdigest()}

    def test_resume_and_verify(self):
        (self.root / 'model.bin.partial').write_bytes(self.data[:5])
        with patch('install_models.urlopen', return_value=Response(self.data[5:], 206, f'bytes 5-{len(self.data)-1}/{len(self.data)}')) as fetch:
            result = download(self.root, self.item, False)
        self.assertEqual(fetch.call_args.args[0].get_header('Range'), 'bytes=5-')
        self.assertEqual(result.read_bytes(), self.data)

    def test_ignored_range_replaces_partial(self):
        (self.root / 'model.bin.partial').write_bytes(b'wrong')
        with patch('install_models.urlopen', return_value=Response(self.data)):
            self.assertEqual(download(self.root, self.item, False).read_bytes(), self.data)

    def test_interruption_keeps_partial(self):
        class Interrupted(Response):
            count = 0
            def read(inner, _size=-1):
                inner.count += 1
                if inner.count == 1:
                    return self.data[:5]
                raise ConnectionError('disconnected')
        with patch('install_models.urlopen', return_value=Interrupted(b'')):
            with self.assertRaises(ConnectionError):
                download(self.root, self.item, False)
        self.assertEqual((self.root / 'model.bin.partial').read_bytes(), self.data[:5])
        self.assertFalse((self.root / 'model.bin').exists())

    def test_wrong_range_does_not_append(self):
        (self.root / 'model.bin.partial').write_bytes(self.data[:5])
        with patch('install_models.urlopen', return_value=Response(self.data, 206, 'bytes 0-1/2')):
            with self.assertRaisesRegex(ValueError, 'range'):
                download(self.root, self.item, False)
        self.assertEqual((self.root / 'model.bin.partial').read_bytes(), self.data[:5])

    def test_corruption_is_not_promoted(self):
        with patch('install_models.urlopen', return_value=Response(b'x' * len(self.data))):
            with self.assertRaisesRegex(ValueError, 'integrity'):
                download(self.root, self.item, False)
        self.assertFalse((self.root / 'model.bin').exists())
        self.assertFalse((self.root / 'model.bin.partial').exists())

    def test_complete_partial_is_verified_without_network(self):
        (self.root / 'model.bin.partial').write_bytes(self.data)
        with patch('install_models.urlopen') as fetch:
            self.assertEqual(download(self.root, self.item, False).read_bytes(), self.data)
        fetch.assert_not_called()

    def test_cached_model_is_verified_and_does_not_download(self):
        (self.root / 'model.bin').write_bytes(self.data)
        with patch('install_models.urlopen') as fetch:
            self.assertEqual(download(self.root, self.item, True).read_bytes(), self.data)
        fetch.assert_not_called()


if __name__ == '__main__':
    unittest.main()

"""Local-only speech engine. Models are installed separately from pinned sources."""
from __future__ import annotations
import base64
import io
import json
import os
import threading
import time
import wave
from pathlib import Path

os.environ.setdefault('HF_HUB_OFFLINE', '1')
os.environ.setdefault('HF_HUB_DISABLE_IMPLICIT_TOKEN', '1')
os.environ.setdefault('OMP_NUM_THREADS', '2')
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')

class Engine:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.lock = threading.RLock()
        self.recognizer = None
        self.translators = {}
        self.voices = {}

    def status(self):
        required = ['asr/model.bin', 'asr/config.json', 'asr/tokenizer.json', 'asr/vocabulary.txt',
                    'translation/en_tr/model/model.bin', 'translation/tr_en/model/model.bin',
                    'translation/en_tr/sentencepiece.model', 'translation/tr_en/sentencepiece.model',
                    'tts/tr/okur/config.json', 'tts/tr/okur/text.6a21984ac693.onnx',
                    'tts/tr/okur/sample.3c2a91ee5faa.onnx', 'tts/tr/okur/decoder.8f42fa31155e.onnx',
                    'tts/en/en_US-ljspeech-medium.onnx', 'tts/en/en_US-ljspeech-medium.onnx.json']
        missing = [p for p in required if not (self.root / p).is_file()]
        return {'ready': not missing, 'missing': missing, 'device': 'cpu', 'languages': ['tr', 'en'],
                'loaded': {'recognition': self.recognizer is not None,
                           'translation': list(self.translators), 'speech': list(self.voices)}}

    @staticmethod
    def language(value):
        if value not in ('tr', 'en'): raise ValueError('UNSUPPORTED_LANGUAGE')
        return value

    @staticmethod
    def text(value):
        if not isinstance(value, str) or not value.strip() or len(value) > 1200:
            raise ValueError('TEXT_LIMIT')
        if any(ord(c) < 32 and c not in '\n\t' for c in value): raise ValueError('INVALID_TEXT')
        return value.strip()

    def recognize(self, data: bytes, language: str):
        self.language(language)
        if len(data) > 2*1024*1024: raise ValueError('AUDIO_LIMIT')
        with wave.open(io.BytesIO(data), 'rb') as w:
            if w.getnchannels() != 1 or w.getsampwidth() != 2 or w.getframerate() not in (16000,22050,24000,44100,48000):
                raise ValueError('UNSUPPORTED_AUDIO')
            duration = w.getnframes() / w.getframerate()
            if duration <= 0 or duration > 20: raise ValueError('AUDIO_DURATION_LIMIT')
            import numpy as np
            samples = np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').astype(np.float32)/32768
            source_rate = w.getframerate()
            if float(np.sqrt(np.mean(samples*samples))) < 0.003:
                return ''
            if source_rate != 16000:
                # Live Discord decoding is already 16 kHz; bounded WAV fixtures may use a TTS rate.
                if source_rate > 16000:
                    n = np.arange(-15,16)
                    cutoff = 7600/source_rate
                    kernel = np.sinc(2*cutoff*n)*np.hamming(31)
                    samples = np.convolve(samples,kernel/kernel.sum(),mode='same')
                samples = np.interp(np.arange(0,len(samples),source_rate/16000),np.arange(len(samples)),samples).astype(np.float32)
        with self.lock:
            if self.recognizer is None:
                from faster_whisper import WhisperModel
                self.recognizer = WhisperModel(str(self.root/'asr'), device='cpu', compute_type='int8',
                                               cpu_threads=2, num_workers=1, local_files_only=True)
            segments, _ = self.recognizer.transcribe(samples, language=language, beam_size=1,
                best_of=1, condition_on_previous_text=False, vad_filter=True,
                vad_parameters={'min_silence_duration_ms': 350}, no_speech_threshold=0.6)
            accepted = [s.text.strip() for s in segments if s.no_speech_prob < 0.8 and s.avg_logprob > -1.2 and s.compression_ratio < 2.8]
            return ' '.join(accepted)[:1200]

    def translate(self, text: str, source: str, target: str):
        text = self.text(text)
        self.language(source); self.language(target)
        if source == target: return text
        with self.lock:
            name = source+'_'+target
            if name not in self.translators:
                import ctranslate2
                import sentencepiece as spm
                directory = self.root/'translation'/name
                self.translators[name] = (ctranslate2.Translator(str(directory/'model'), device='cpu',
                    compute_type='int8', inter_threads=1, intra_threads=2),
                    spm.SentencePieceProcessor(model_file=str(directory/'sentencepiece.model')))
            translator, processor = self.translators[name]
            encoded = processor.encode(text, out_type=str)
            result = translator.translate_batch([encoded], beam_size=4, max_decoding_length=256,
                repetition_penalty=1.1, no_repeat_ngram_size=3)[0]
            return processor.decode(result.hypotheses[0])[:1200]

    def speak(self, text: str, language: str):
        text = self.text(text); self.language(language)
        if len(text)>400:raise ValueError('TEXT_LIMIT')
        with self.lock:
            if language == 'tr':
                import numpy as np
                if language not in self.voices:
                    from okur_onnx import OnnxSynthesizer
                    self.voices[language] = OnnxSynthesizer(self.root/'tts/tr/okur')
                pcm=(self.voices[language].say(text)*32767).astype('<i2').tobytes()
                result=io.BytesIO()
                with wave.open(result,'wb') as w:
                    w.setnchannels(1);w.setsampwidth(2);w.setframerate(48000);w.writeframes(pcm)
                return result.getvalue()
            if language not in self.voices:
                import onnxruntime as ort
                from piper import PiperVoice
                from piper.config import PiperConfig
                from piper.voice import ESPEAK_DATA_DIR
                name = 'en_US-ljspeech-medium'
                model = self.root/'tts'/language/(name+'.onnx')
                config = json.loads(model.with_suffix('.onnx.json').read_text('utf8'))
                options = ort.SessionOptions(); options.intra_op_num_threads=2; options.inter_op_num_threads=1
                self.voices[language] = PiperVoice(config=PiperConfig.from_dict(config),
                    session=ort.InferenceSession(str(model), sess_options=options, providers=['CPUExecutionProvider']),
                    espeak_data_dir=ESPEAK_DATA_DIR, download_dir=self.root)
            result=io.BytesIO()
            with wave.open(result,'wb') as w:
                self.voices[language].synthesize_wav(text, w)
            data=result.getvalue()
            if len(data)>4*1024*1024: raise ValueError('OUTPUT_LIMIT')
            return data

    def dispatch(self, operation, payload):
        started=time.monotonic()
        if not self.status()['ready']: raise ValueError('MODELS_NOT_INSTALLED')
        if operation=='recognize':
            data=base64.b64decode(payload.get('audio',''),validate=True)
            result={'text':self.recognize(data,payload.get('language'))}
        elif operation=='translate':
            result={'text':self.translate(payload.get('text'),payload.get('source'),payload.get('target'))}
        elif operation=='speak':
            result={'audio':base64.b64encode(self.speak(payload.get('text'),payload.get('language'))).decode('ascii'), 'mime':'audio/wav'}
        else: raise ValueError('UNKNOWN_OPERATION')
        return {**result,'elapsedMs':round((time.monotonic()-started)*1000)}

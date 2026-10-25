"""ONNX-only adaptation of Okur's reference host loop, without its training/PyTorch dependencies.

Copyright 2026 Ahmet Hakan Besel. SPDX-License-Identifier: Apache-2.0
Source: https://github.com/ahmethakanbesel/okur-tts/tree/0889eda23a3eaeda33f8c0af3af729261907bcab
Adapted for VoiceBridge: NumPy word timeline, bounded frames/text, two CPU threads and local-only model paths.
See vendor/okur_frontend/LICENSE, NOTICE and MODEL_CARD.md.
"""
import json
import math
from pathlib import Path
import numpy as np
from vendor.okur_frontend import Frontend, encode, SYMBOLS


def gaussian_noise(seed: int, count: int) -> np.ndarray:
    state = seed & 0xFFFFFFFF
    out = np.empty(count, dtype=np.float32)
    def uniform():
        nonlocal state
        state = (state + 0x6D2B79F5) & 0xFFFFFFFF
        z = state
        z = ((z ^ (z >> 15)) * (z | 1)) & 0xFFFFFFFF
        z ^= (z + (((z ^ (z >> 7)) * (z | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((z ^ (z >> 14)) & 0xFFFFFFFF) / 4294967296.0
    for i in range(0, count, 2):
        u1, u2 = 1.0 - uniform(), uniform()
        r = math.sqrt(-2.0 * math.log(u1))
        out[i] = r * math.cos(2 * math.pi * u2)
        if i + 1 < count:
            out[i + 1] = r * math.sin(2 * math.pi * u2)
    return out


def timeline(letters: str, durations: np.ndarray):
    starts = [i for i, ch in enumerate(letters) if ch != ' ' and (i == 0 or letters[i-1] == ' ')] or [0]
    bounds = np.array([0, *starts[1:], len(letters)], dtype=np.int64)
    counts = np.diff(bounds)
    cw = np.repeat(np.arange(len(counts), dtype=np.int64), counts)
    wstart = np.repeat(bounds[:-1], counts)
    per_word = np.bincount(cw, weights=durations.astype(np.float64), minlength=len(counts))
    ends = np.rint(np.cumsum(per_word)).astype(np.int64)
    frames = np.maximum(np.diff(ends, prepend=0), 0)
    if frames.sum() <= 0 or frames.sum() > 500:
        raise ValueError('AUDIO_DURATION_LIMIT')
    fw = np.repeat(np.arange(len(counts), dtype=np.int64), frames)
    before = (np.cumsum(frames) - frames)[fw]
    fp = ((np.arange(len(fw)) - before) / frames[fw]).astype(np.float32)
    return cw, wstart, fw, fp


class OnnxSynthesizer:
    def __init__(self, directory: Path):
        import onnxruntime as ort
        self.config = json.loads((directory / 'config.json').read_text('utf8'))
        if self.config['symbols'] != list(SYMBOLS) or self.config['sample_rate'] != 48000:
            raise ValueError('Unsupported Okur model configuration')
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        self.sessions = {}
        for name in ('text', 'sample', 'decoder'):
            filename = self.config['files'][name]
            if Path(filename).name != filename or not filename.endswith('.onnx'):
                raise ValueError('Unsafe model graph path')
            self.sessions[name] = ort.InferenceSession(str(directory/filename), options, providers=['CPUExecutionProvider'])
        self.frontend = Frontend()

    def say(self, text):
        letters = self.frontend(text)
        if not letters or len(letters) > 600:
            raise ValueError('TEXT_LIMIT')
        ids = np.array([encode(letters)], dtype=np.int64)
        h, dur = self.sessions['text'].run(None, {'ids': ids})
        cw, wstart, fw, fp = timeline(letters, dur[0])
        steps, c = len(self.config['times']), self.config['latent_dim']
        noise = gaussian_noise(0, steps * len(fw) * c).reshape(steps, 1, len(fw), c)
        z, = self.sessions['sample'].run(None, {'h': h, 'dur': dur.astype(np.float32), 'cw': cw[None], 'wstart': wstart[None], 'fw': fw[None], 'fp': fp[None], 'noise': noise})
        audio, = self.sessions['decoder'].run(None, {'z': z})
        result = np.asarray(audio)[0]
        if result.size > 48000 * 20 or not np.isfinite(result).all():
            raise ValueError('AUDIO_DURATION_LIMIT')
        return np.clip(result, -1, 1)

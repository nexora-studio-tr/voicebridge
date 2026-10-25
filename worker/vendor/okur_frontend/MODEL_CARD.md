---
license: cc-by-4.0
language:
- tr
library_name: onnxruntime
pipeline_tag: text-to-speech
tags:
- text-to-speech
- turkish
- flow-matching
- dmd2
- onnx
- mlx
- webassembly
datasets:
- issai/Turkish_Speech_Corpus
- google/fleurs
metrics:
- wer
- cer
---

# Okur v1.0

A small Turkish text-to-speech model: one voice, 48 kHz, 4 generator steps, 9.8 M parameters in total. Trained from
scratch on openly licensed data. Runs with PyTorch, Apple MLX, ONNX Runtime and in browsers (WebAssembly).
Code and training recipe: https://github.com/ahmethakanbesel/okur-tts. Browser demo: https://huggingface.co/spaces/ahakan/okur-tts

## Files

| File | |
|---|---|
| `acoustic.safetensors` + `acoustic.json` | text encoder, duration predictor, aligner, 4-step DiT student (6.8 M) |
| `decoder.safetensors` + `decoder.json` | latents → 48 kHz audio (3.0 M) |
| `onnx/` | the same model as three ONNX graphs (fp16-stored weights), frontend-independent; used by the browser demo and `okur say` |

No pickles: weights are safetensors, configs are JSON.

## Use

```sh
pip install "okur @ git+https://github.com/ahmethakanbesel/okur-tts"     # or: uv sync in a clone
hf download ahakan/okur-tts --local-dir okur-tts
okur say "Bu konuyla alakalı olarak şirketin karı hala artıyor." --model okur-tts --out speech.wav
```

`--runtime onnx` (default, CPU), `--runtime torch` (CUDA, MPS or CPU) or `--runtime mlx` (Apple silicon).
Or try it without installing anything in the [demo Space](https://huggingface.co/spaces/ahakan/okur-tts), where it runs in the browser.

## Samples

| | |
|---|---|
| Şapkasız yazım → *alâkalı, kârı, hâlâ* | <audio controls src="https://huggingface.co/ahakan/okur-tts/resolve/main/samples/circumflex-plain.mp3"></audio> |
| Sıra sayıları → *üçüncü, ikinci, on beşinci* | <audio controls src="https://huggingface.co/ahakan/okur-tts/resolve/main/samples/ordinals.mp3"></audio> |
| Para ve yüzde | <audio controls src="https://huggingface.co/ahakan/okur-tts/resolve/main/samples/numbers-money.mp3"></audio> |

## Architecture

![Inference pipeline](figures/pipeline.svg)

![DiT block and 4-step sampling](figures/dit.svg)

Text goes through the okur frontend first (number normalization with normalizer-tr, ordinals, circumflex
restoration). The ONNX graphs take letter ids, so other runtimes must use the same frontend: the Rust crate in
`frontend-rs/` produces identical output and compiles to WebAssembly.

## Evaluation

Freya-TR-Eval (495 Turkish sentences, one take per system), Whisper-large-v3 word/character error rate, UTMOS22
naturalness, and speed on the same 8 server CPU cores. “Clean” leaves out the 89 sentences that also appear in
Common Voice.

| System | Size | UTMOS ↑ | WER ↓ | WER clean ↓ | CER clean ↓ | CPU speed ↑ | License |
|---|---|---|---|---|---|---|---|
| **Okur v1.0** | 9.8 M | 2.93 | 1.81% | 1.64% | 0.36% | 28× | Apache-2.0 / CC BY 4.0 |
| EMA Lightning | 8.6 M | 3.29 | **1.10%** | **0.96%** | **0.29%** | 21× | Apache-2.0 |
| Piper (dfki voice) | ≈ 16 M | 3.66 | 3.14% | 2.66% | 0.59% | **55×** | CC BY-NC-SA 4.0 |
| Meta MMS-TTS | 36 M | **3.78** | 5.74% | 5.16% | 1.19% | 12× | CC BY-NC 4.0 |

Okur is the least natural of the four and less intelligible than EMA Lightning. It is the only one that restores
circumflexes, reads ordinals and runs in a browser. In Chrome on an Apple M4 it runs about 24× real time
(WebAssembly, 8 threads); with MLX on the M4's GPU, 67×. Reproduce with `scripts/compare_all.sh`.

## Training data

298 hours, 283,871 clips, 44 speakers:

| Corpus | Hours kept | License |
|---|---|---|
| ISSAI Turkish Speech Corpus | 204 | MIT |
| Mozilla Common Voice 27.0, Turkish | 75 | CC0 |
| MediaSpeech, Turkish | 9 | CC BY 4.0 |
| Google FLEURS, Turkish | 6 | CC BY 4.0 |

The multi-speaker model was then fine-tuned on one Common Voice contributor (about 5 hours) and distilled with DMD2
from 16 sampling steps to 4. Training targets are latents of the frozen ACE-Step 1.5 VAE (MIT); letter durations come
from forced alignment with `mpoyraz/wav2vec2-xls-r-300m-cv7-turkish` (CC BY 4.0). Total compute: about 21 GPU hours on one
RTX 5090 (≈ $12).

The ISSAI corpus card states the MIT license but does not describe where its recordings come from; see its paper
(Mussakhojayeva et al., 2023) for collection details.

## Limitations and intended use

- One voice; naturalness is below models trained on studio recordings of a single speaker.
- Rule-based circumflex restoration: ambiguous *kar* without business context stays *kar*.
- Foreign words and abbreviations are read with Turkish letter sounds.
- Intended for research, accessibility, prototyping and offline or on-device speech. Do not use it to impersonate a
  real person or to pass synthetic speech off as a human recording. The voice is from an anonymous Common Voice
  contributor who released their recordings under CC0.

## Citation

```bibtex
@software{besel2026okur,
  author  = {Be{\c{s}}el, Ahmet Hakan},
  title   = {Okur: a small, open {Turkish} text-to-speech model that runs in the browser},
  year    = {2026},
  version = {1.0.0},
  url     = {https://github.com/ahmethakanbesel/okur-tts},
  note    = {Code: Apache-2.0; weights: CC BY 4.0}
}
```

Please also cite the training corpora listed above and, for the method, DMD2
(Yin et al., 2024) and flow matching (Lipman et al., 2023).

## License

Weights: CC BY 4.0. Attribute “okur” and the training corpora listed above. Code: Apache-2.0.

# Marian sources verified — 29 October 2026

[Türkçe](MODEL-SOURCES-2026-10-29.tr.md) · [Exact observation](quality-model-sources-2026-10-29.json) · [Verified source lock](../experiments/marian-verified-sources.json) · [Earlier preflight](MODEL-PREFLIGHT-2026-10-29.md)

**Both original archives were downloaded and verified locally. Conversion is still blocked by available RAM.** No translation model was activated, no new quality result exists, and the alpha.7 runtime, existing model lock and release assets are unchanged. The scoped local-download approval is recorded; another download approval is not needed for these same files.

## What was verified

The 278,474,341-byte EN → TR and 872,172,728-byte TR → EN archives were retrieved from the same upstream HTTPS URLs using system certificate verification, `If-Match` and fixed size/disk limits. Both response ETags match the previously observed values and the downloaded MD5 values. Full SHA-256 observations are now pinned:

| Direction | Archive SHA-256 |
| --- | --- |
| EN → TR | `f1f074185660501c977b523576775eef7438e35eb938712702ab33cf32061a3a` |
| TR → EN | `59a0280099e09d0f32f18688c07ac5a5fc679e3a09bc843facb29f7b63aa9af3` |

These hashes were **observed on the approved first fetch**, not independently published or signed by the model author. Preserve that trust distinction. The full archive inventory, sizes, CRCs and previously pinned metadata hashes matched. The 14 / 13 extracted files now also have SHA-256 identities. Both archive licenses remain CC-BY-4.0; models are upstream work. No weights, tokenizers or private configuration are included in GitHub source files or the source ZIP.

## NPZ inspection without loading tensor arrays

Each NPZ contains 255 arrays. A bounded inspector parses NPY headers, streams raw bytes to verify every inner ZIP member CRC, and reads only the small `int8` YAML configuration. It never calls `numpy.load`, enables pickle, executes upstream scripts or creates tensor arrays for inference. Object/structured types, unsupported shapes/formats, duplicate/path entries, oversized headers/arrays/configuration and unsafe YAML tags are rejected. This remains a research tool for these pinned inputs, not a general-purpose model sandbox.

| Observation | EN → TR | TR → EN |
| --- | ---: | ---: |
| Tensor/config payload bytes | 299,660,758 | 939,372,606 |
| Largest array bytes | 122,865,664 | 233,713,664 |
| Embedding width / attention heads | 512 / 8 | 1,024 / 16 |
| Encoder / decoder layers | 6 / 6 | 6 / 6 |
| Vocabulary sizes | 59,993 / 59,993 | 57,059 / 57,059 |

The observed Transformer configuration passes an initial check against the installed Marian converter's supported options. **This does not prove full converter compatibility**, int8 output correctness or translation quality. Special-token ID differences, missing ordinary tokenizer pieces and normalization concerns from the earlier preflight remain open.

## Resource boundary and reproducibility

Archives plus extracted sources and observations occupy about **2.23 GiB**, within the approved 5 GiB experiment budget. Free disk remains above the 10 GiB reserve. Available RAM stayed around 1 GiB after the owner's application-close confirmation; the conservative 2 GiB / 4 GiB conversion admission guards were not met. No conversion subprocess was started. No application was closed by the agent, swap adjusted, or unrelated data removed. PyTorch/Transformers were not installed. The report records the exact resource snapshot; it is not a peak-memory benchmark.

Place the separately downloaded, hash-matching archives at `artifacts/marian-experiment-v1/en-tr/source.zip` and `artifacts/marian-experiment-v1/tr-en/source.zip` inside the checkout. In a configured worker development environment, run:

```sh
python scripts/inspect_marian.py
# or: python scripts/inspect_marian.py --direction en-tr
```

The command is offline. It verifies the pinned archives and any cached extraction, safely extracts missing sources without overwriting an existing directory, checks inner NPZ data, and writes only ignored research reports. Missing or altered files fail rather than triggering a download. The source lock is complete for source verification, **not for runtime installation**. Tests use tiny generated archives/arrays and need no real models or network; CI adds the already-pinned PyYAML 6.0.3 to its lightweight test dependencies.

Next: when available RAM meets the admission guards, recheck disk and dependencies, convert one direction at a time into a separate int8 candidate directory, measure conversion memory/output size, validate token behavior, then run the agreed development screen. No automatic activation, cloud fallback, model redistribution, reserved/audio evaluation or live Discord test follows from source verification. The approval remains valid; sufficient resources are the outstanding condition.

# Marian source preflight — 29 October 2026

[Türkçe](MODEL-PREFLIGHT-2026-10-29.tr.md) · [Machine-readable observation](quality-model-preflight-2026-10-29.json) · [Source manifest](../experiments/marian-source-preflight.json) · [Model proposal](../TRANSLATION-MODELS.md)

**Metadata checked; conversion blocked by current available RAM. No new weights installed or runtime change.** This completes a source/resource preflight, not a quality improvement or supported model profile. C1/C2 remain rejected. The application and its existing model lock are unchanged.

## Bounded alternative to the Hugging Face conversion path

The installed [CTranslate2 Marian converter](https://opennmt.net/CTranslate2/guides/marian.html) accepts original Marian NPZ models and vocabulary files. That offers a route without installing PyTorch or Transformers. The upstream archives selected for inspection are:

| Direction | Upstream archive | Download bytes | Unpacked bytes | Archive license |
| --- | --- | ---: | ---: | --- |
| EN → TR | [eng-tur, opus+bt, 2021-04-10](https://object.pouta.csc.fi/Tatoeba-MT-models/eng-tur/opus+bt-2021-04-10.zip) | 278,474,341 | 302,443,539 | CC-BY-4.0 |
| TR → EN | [tur-eng, opusTCv20210807+bt transformer-big, 2022-03-17](https://object.pouta.csc.fi/Tatoeba-MT-models/tur-eng/opusTCv20210807+bt_transformer-big_2022-03-17.zip) | 872,172,728 | 942,106,220 | CC-BY-4.0 |

Total proposed download: **1,150,647,069 bytes, about 1.15 GB / 1.07 GiB**. This is larger than the approximately 620 MB selected Hugging Face weights; avoiding additional conversion frameworks is the tradeoff. These are original source releases, not byte-identical Hugging Face weight files. Their full SHA-256 identities have not yet been established. No claim of equal translation output is made.

Only bounded ZIP directory/header/metadata ranges were fetched with ordinary TLS verification, `If-Match`, exact range lengths and ZIP CRC checks. Windows system TLS worked; a Python certificate-chain failure was not bypassed. README, LICENSE, vocabulary, tokenizer and configuration SHA-256 observations are in the manifest. An observed ETag is a server identifier, **not a publisher SHA-256 or signature**. The manifest intentionally has `completeDownloadLock: false`; it cannot be used as an unattended installer. A full first fetch must record its observed archive SHA-256, validate the pinned metadata, inspect bounded NPZ contents without pickle, and fail if source identity changes. A locally observed digest must not be described as independently published by the author.

Both archive LICENSE files identify **Attribution 4.0 International**, with identical observed SHA-256 `945fbcb37deca05bccd7c3ca0e261679f1f5373515504fdbad68f6f3cf6f49b9`. This differs from the Apache-2.0 label on the previously selected EN → TR Hugging Face card. The native archive route is recorded separately as CC-BY-4.0; do not transfer the card's label to this archive. Preserve upstream authorship, README, license and conversion/quantization notices before any model redistribution. VoiceBridge code remains GPL-3.0-or-later. No model files are included in the source package.

## Tokenization findings

Each source/target SentencePiece model has 32,000 pieces; their hashes differ within both pairs. The EN → TR Marian vocabulary has 59,993 entries, TR → EN has 57,059. The two-tokenizer approach is required. SentencePiece IDs cannot be used as Marian vocabulary IDs: TR → EN has EOS at vocabulary index 43,741 and unknown at 52,508, while SentencePiece EOS is 2.

The metadata smoke check round-trips one neutral sentence per language. This is **not translation testing**. Ordinary SentencePiece pieces absent from the Marian vocabulary were observed: EN → TR source 67 / target 3; TR → EN source 6 / target 10. EN → TR also lacks the SentencePiece control piece `<s>` in its Marian vocabulary. Missing pieces do not by themselves prove the release is broken; unknown-token behavior and special tokens need explicit adapter/conversion tests. They are retained as concerns, not hidden by the successful smoke checks. Upstream preprocessing shell scripts were hashed and read, never executed; normalization is still an adapter decision.

## Dependencies and resource gate

The local environment matches Python 3.12, CTranslate2 4.8.3, NumPy 2.5.4, SentencePiece 0.2.2 and PyYAML 6.0.3. No dependency was added. No native weight/config compatibility, int8 output size, conversion peak RSS, inference latency or quality has been measured.

Admission policy reserves **5 GiB temporary experiment space plus 10 GiB free disk**. The observation had about 25 GiB free disk. The conservative minimum available-RAM guards are **2 GiB for EN → TR and 4 GiB for TR → EN**, one conversion process at a time and two CPU threads. These are provisional protective guards, not measured requirements or peak-memory guarantees. Available RAM was below both guards; the exact snapshot is in the JSON report. No application was closed, swap changed, or unrelated file removed. Disk cleanup remains deferred.

## Recheck and next gate

The source manifest is public; the small verified metadata files remain only in ignored `artifacts/marian-preflight/{en-tr,tr-en}`. From a configured development environment, recheck without network or weight loading:

```sh
python scripts/preflight_marian.py --inspect-tokenizers
```

Without `--inspect-tokenizers`, only standard-library manifest/resource/hash checks run. Missing metadata fails; the script does not fetch it. The test suite uses synthetic metadata and needs no models or network. Even if all resources pass, `downloadAllowed`, `conversionAllowed` and `runtimePromotion` remain false: this tool does not grant approval or perform conversion.

Next: obtain scoped approval for the 1.15 GB experiment; recheck RAM and disk immediately before each child process; perform bounded, separately staged downloads/conversion without changing current models; validate token/normalization behavior; then screen development texts with the existing regression rules. Freeze an accepted adapter before full audio/reserved cases. Live Discord tests remain owner-run. No default activation, release asset replacement or model upload is authorized by this preflight.

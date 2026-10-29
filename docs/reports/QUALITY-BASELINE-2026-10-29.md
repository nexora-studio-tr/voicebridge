# Local TR/EN baseline — 2026-10-29

[Türkçe](QUALITY-BASELINE-2026-10-29.tr.md) · [Method and commands](../QUALITY.md) · [Full evidence](quality-baseline-alpha7-2026-10-29.json) · [Frozen fixture manifest](quality-fixtures-alpha7-2026-10-29.json) · [Queue observations](quality-queue-alpha7-2026-10-29.json)

**Measurement completed; general translation quality is not accepted.** All 180 synthetic clips completed recognition, translation and target speech generation without a stage exception. The critical-fact review nevertheless found lost numbers, changed dates, corrupted names and reversed negation. Operational success is not semantic correctness.

The experiment uses alpha.7's unchanged CPU inference, 60 original TR/EN source texts and three frozen conditions. The source was measured from clean local commit `6a2ef673ac18e6fd55a1c660472aadd9496e574c`. [Published tooling commit e1e7c8](https://github.com/nexora-studio-tr/voicebridge/commit/e1e7c8325d285882f3e92b808fb15191ef54ac12) has the identical Git tree `16d53376d5fa53450c705027eaf57061a9d5911c`; publication through the GitHub connector changed commit metadata. Every source/model/scorer hash remains in the JSON.

Evaluation ID: `4e7fec461073f72c3407faced35c5231b3d2808b9ee4d6765f9b3bb2352f3668`.

## Recognition

Each row covers 30 source clips. Percentages are micro-averaged **word/character error rates**, not accuracy. Digit formatting is deliberately not equated to number words. The full JSON also separates the 24 development and six public holdout sources per language.

| Source  | Condition    | Scored / expected |   WER |   CER |
| ------- | ------------ | ----------------: | ----: | ----: |
| English | Clean        |             30/30 | 13.7% | 10.1% |
| English | 20 dB noise  |             30/30 | 14.4% | 10.4% |
| English | Pause stress |             30/30 | 13.1% |  9.6% |
| Turkish | Clean        |             30/30 | 34.6% |  9.9% |
| Turkish | 20 dB noise  |             30/30 | 38.1% | 10.3% |
| Turkish | Pause stress |             30/30 | 30.7% |  8.8% |

These narrow synthetic results do not rank real Turkish and English callers. Voices differ by language, source pronunciation was not human-audited, and the small public split is not independent. A lower aggregate pause-stress error rate does not show that pauses generally improve recognition. Number formatting and Turkish suffix/spelling differences contribute to WER; the retained raw text and CER help diagnose that contribution without hiding it through normalization.

## Critical meaning

The reviewer was **Codex, an AI preliminary text review with no independent human adjudication**. All 179 unique source/route/output judgments have reasons: **57 pass, 106 fail, 16 uncertain, zero unreviewed**. These are counts of distinct outputs, not per-clip accuracy or a certified language score. Repeated identical outputs across conditions are judged once within each source and route. The limited two-fact rubric can miss other errors.

| Route / source                              | Pass | Fail | Uncertain | Unique outputs |
| ------------------------------------------- | ---: | ---: | --------: | -------------: |
| Correct reference → Turkish, English source |   20 |    8 |         2 |             30 |
| Correct reference → English, Turkish source |   11 |   15 |         4 |             30 |
| Recognized text → Turkish, English source   |   21 |   27 |         1 |             49 |
| Recognized text → English, Turkish source   |    5 |   56 |         9 |             70 |

The routes have different inputs and output counts; they cannot be compared as paired accuracy percentages. Reference translation is useful because it isolates failures that do not depend on the source voice or recognizer. Examples retained exactly in the JSON:

- **English negation, `en-11-clean`:** recognition matches the words of “I didn't say delete the backup. Please keep it until Friday.” The translation says “Yedekleri silemedim, lütfen Cuma gününe kadar devam edin.” Not giving a deletion instruction becomes inability to delete; keeping the backup becomes continuing. Changing only ASR cannot resolve this observed translator failure.
- **Turkish negation, direct `tr-21`:** “Dosyayı kapatmadan önce bir kopyasını kaydet. Asıl dosyayı değiştirme.” becomes “Save a copy before closing the file. Change the original file.” The prohibition is reversed despite bypassing recognition.
- **Dates, direct `en-08`:** April sixth, explicitly not June fourth, becomes a translation that rejects April sixth and chooses June fourth. For this clip the recognized numeric variant translated correctly. That variation is diagnostic, not a repair or a reason to rewrite the reference.
- **Sentence loss, `en-01-pause-stress`:** recognition contains “We need 15 minutes. Not 50, please check the microphone.” Translation drops the first sentence and retains only the rejection of fifty and microphone check.

These observations prioritize translation handling and critical fact preservation before another recognition-only adjustment. The runtime was not tuned from this baseline; no improvement is claimed. A next candidate must address general behavior, reuse the frozen clips, preserve development/holdout separation and obtain a new exact-output review. Do not hardcode replacements for the 30 scenarios or silently force a potentially wrong number/negation into the output.

## Timing scope

Windows 11, Intel Core i3-9100T at 3.10 GHz, four logical CPUs, 7.4 GiB total physical memory reported by the OS; CPU inference only. The machine's background services were not stopped or monitored. Lightweight repository operations occurred during the run. This is a developer-workstation observation, not a controlled capacity benchmark. The full dependency versions, engine profile and model identities are in the reports.

For the clean clips, warm **recognition → translation → speech** P50/P95 was **1608/1969 ms** for English sources and **1510/1685 ms** for Turkish sources (`n=30` each). Nearest-rank percentiles include only successful stages and disclose `n`; source generation and model loading are excluded. Direct-reference translation is measured separately, not added to the pipeline. Capture, Discord transport, queue, browser and playback are excluded.

The separate actual-worker/`Rooms` test queued three synthetic development clips at once, with one listener and Turkish output:

| Source | Queue ms | Recognition ms | Translation ms | Synthesis ms | Caption total ms | Audio total ms |
| ------ | -------: | -------------: | -------------: | -----------: | ---------------: | -------------: |
| en-01  |        0 |           1262 |             98 |          377 |             1361 |           1744 |
| tr-21  |     1739 |           1181 |              5 |          411 |             2926 |           3339 |
| en-12  |     3338 |           1164 |             96 |          351 |             4599 |           4954 |

The small scenario shows accumulated queue wait; it does not establish throughput, supported users, multi-speaker quality or a meaningful p95. The Turkish-source clip already targets Turkish, so it does not exercise cross-language translation. Totals include measured overhead, not just the displayed stage sum. No Discord session or provider request was made.

## Reproduction and acceptance

Published artifacts include the original text, generation recipe, hashes, machine metadata, every scored result and every review reason. The 180 generated WAVs remain local and are **not redistributed**. Regeneration on a different machine may produce different bytes; that is a new fixture set, not reproduction of identical audio. For candidate comparisons, retain the original ignored files and use the guarded commands in the [quality guide](../QUALITY.md).

Local code gates passed: 120 TypeScript tests, typecheck, production build, formatting and 23 Python tests, including seven new quality tests. Exact-head cross-platform/package results are recorded by the [PR](https://github.com/nexora-studio-tr/voicebridge/pull/8) CI. No new runtime release or binary was created by this measurement packet, and existing alpha.7 assets are unchanged. Human listening, independent installation, multi-person Discord, paid-provider compatibility and quality acceptance remain separate and unperformed here.

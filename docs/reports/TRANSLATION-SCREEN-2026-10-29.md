# Translation candidate screen — 2026-10-29

[Türkçe](TRANSLATION-SCREEN-2026-10-29.tr.md) · [Original baseline](QUALITY-BASELINE-2026-10-29.md) · [C1 evidence](quality-screen-sentence-c1-2026-10-29.json) · [C2 evidence](quality-screen-upstream-c2-2026-10-29.json) · [Next model proposal](../TRANSLATION-MODELS.md)

**Both candidates were rejected during development. Neither changes the running translator.** Some outputs improve, but previously correct critical facts regress. This study does not claim a quality improvement or a new runtime release.

The acceptance rule was written before these experiments: no previously passing source/route may become a critical failure or uncertain result; at least three distinct development source/routes with a prior failure must improve; a frozen full audio/holdout evaluation and latency checks follow only if the development screen passes. These are engineering gates, not statistical significance claims.

## Method

The original 180-clip baseline provides frozen reference and recognized texts. Only its **144 development clips** enter this screen, producing **48 direct-reference inputs and 97 distinct recognized inputs**, or **145 source/route/input units**. The units bind **288 clip/route pairs** through their sample lists. Reserved holdout scenarios are not submitted to either candidate. Loading the public baseline is not a blind evaluation.

For each unit, the unchanged alpha.7 translator is called again before the candidate. **All 145 control outputs match the recorded baseline exactly for each candidate.** This establishes that the observed text changes come from these adapters in this run, rather than from a different transcription or a changed control output. It does not prove determinism on other machines.

| Candidate | Change from control                                                                              | Changed outputs | Confirmed regression units | Affected clip/route pairs | New judgments still pending | Decision |
| --------- | ------------------------------------------------------------------------------------------------ | --------------: | -------------------------: | ------------------------: | --------------------------: | -------- |
| C1        | Conservative sentence spans; original decoder settings                                           |          46/145 |                          2 |                         6 |                          40 | Rejected |
| C2        | Same spans, batched decoding; unknown-token copying, length penalty 0.2, default repeat policies |          75/145 |                          5 |                        13 |                          52 | Rejected |

C1 preserves beam size 4, maximum decoding length 256, repetition penalty 1.1 and no-repeat n-gram size 3. C2 retains beam 4 and maximum length 256 while testing the sentence-oriented decoding approach in the [upstream Argos implementation](https://github.com/argosopentech/argos-translate/blob/master/argostranslate/translate.py). This is a small research adapter, not an installation of Argos or a complete replica of its sentence detector. No new library or model is installed.

The **Codex AI preliminary review** deliberately stops after decisive regressions. Unchanged exact outputs inherit their exact baseline AI judgments; changed outputs remain pending unless explicitly reviewed, with a reason. Pending outputs never count as successes. The table's regression counts are observed early-stop findings, not a complete count of all possible defects. Review units differ from the baseline's deduplicated output judgments, so their totals are not accuracy percentages or directly comparable quality scores.

By source language (each direction has 24 reference sources):

| Candidate / source | Input units | Changed | Observed regressions | Pending new judgments |
| ------------------ | ----------: | ------: | -------------------: | --------------------: |
| C1 / English       |          65 |      27 |                    2 |                    23 |
| C1 / Turkish       |          80 |      19 |                    0 |                    17 |
| C2 / English       |          65 |      34 |                    3 |                    19 |
| C2 / Turkish       |          80 |      41 |                    2 |                    33 |

Zero observed regressions in a partially reviewed group is not evidence that the group is error-free.

## Findings that decide the gate

- **Both C1 and C2, direct `en-04`:** the original says eight jobs, three waiting, five finished. The candidates introduce three waiting _people_ and change finished jobs to ongoing finishing. A previously passing critical relationship is lost.
- **C1, direct `en-21`:** saving a copy becomes “bir kopyasını tasarruf edin,” failing to convey the file-save action. Keeping the original unchanged remains, but one retained fact cannot compensate for the other loss.
- **C2, direct `tr-06`:** an accepted meeting time of three fifteen and rejection of three fifty become “The meeting is not three on five, three fiftys.”
- **C2, `en-07` direct and one pipeline input:** review on Monday becomes “Pazartesi günü tekrarlayın” (repeat on Monday).
- **C2, direct `tr-16`:** the explicitly excluded recipient Deniz becomes “the sea.”

There are useful partial improvements. Both candidates restore the missing fifteen-minute sentence in `en-01/pipeline`. C2 also restores the denied deletion instruction and retention until Friday in `en-11/direct` and one pipeline input. C1 clarifies two formerly uncertain direct outputs. However, the zero-regression rule is already violated. **The candidates are not promoted**, even though C2 has three reviewed prior-failure-to-pass source/routes. Unreviewed outputs and incomplete later gates cannot be treated as passes.

The current Turkish direct `tr-21` negation error remains: “Asıl dosyayı değiştirme” still becomes “Change the original file.” These two experiments do not establish that every possible decoding change must fail; they establish that these candidates do not satisfy the agreed gate.

## Evidence and reproduction

The [measured source checkpoint](https://github.com/nexora-studio-tr/voicebridge/commit/b3279bb27543cf235ae781608a81643a4cc5a923) contains the exact original probe sources. Reports retain their source hashes, installed model identities, dependency versions, all control/candidate text and selected review reasons. Later CLI naming and input/output guards do not change the archived experiment; use that checkpoint for the original adapter bytes. The production `worker/engine.py`, original corpus, scorer and model lock are unchanged.

Current research commands use the installed project Python environment and require the existing pinned models. They do not download models, read user credentials, call a provider or connect Discord:

```sh
python scripts/probe_sentence_translation.py --name sentence-c1-replay
python scripts/probe_upstream_translation.py --name upstream-c2-replay
python scripts/translation_screen_review.py template --name sentence-c1-replay
# Review the new exact-output template, then:
python scripts/translation_screen_review.py assess --name sentence-c1-replay --review path/to/review-completed.json
```

Reports go to ignored `artifacts/translation-screen/<name>/`; existing studies are not overwritten. Research scripts are not imported by the application. The conservative splitter may keep ambiguous boundaries joined and is not a supported general sentence detector; quotation/linguistic coverage and cancellation are not certified by these failed prototypes.

The new review validator rejects stale or edited judgments, changed inputs/control, missing/duplicate sample pairs and holdout contamination. Even `development-only-pass` never activates a runtime. Unit coverage also checks corpus partitioning, numeric/URL/abbreviation retention and bounded/empty adapter output. There are **31 Python tests** locally, including seven new research tests. Exact-head cross-platform/package results belong to the corresponding PR's CI.

No ASR, TTS, new audio, full-pipeline P95, live Discord or independent human acceptance was performed for these rejected candidates. Translation-call timings are diagnostic observations only; they are not comparable to end-to-end baseline latency. The next step is a separately scoped local-model evaluation with license, download, conversion and machine-cost checks.

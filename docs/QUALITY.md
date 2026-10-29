# Reproducible local quality checks

[Türkçe](QUALITY.tr.md) · [Validation](VALIDATION.md) · [Model licenses](../THIRD_PARTY_NOTICES.md)

The quality harness separates **recognition**, **reference-text translation**, **recognition-to-translation**, and **speech generation**. It uses the current installed local models, without Discord, credentials, a billable provider, or model downloads. A completed measurement is not a quality acceptance verdict.

## Reference set

[corpus.json](../examples/quality/corpus.json) contains 30 original fictional scenarios in both Turkish and English: 60 source texts. Each of the six categories has four development scenarios and one public holdout scenario per language: numbers, times/dates, negation, names, commands and pauses. The paired holdout is visible and small; it is a reserved regression subset, not a blind or statistically representative evaluation. Do not tune against its results and then call it unseen evidence.

Every source is synthesized once with the installed voice: English Piper LJSpeech medium or Turkish Okur. Three conditions produce **180 clips**:

| Condition      | Recipe                                                         | Limitation                                           |
| -------------- | -------------------------------------------------------------- | ---------------------------------------------------- |
| `clean`        | Original source WAV bytes                                      | Synthetic pronunciation is not independently audited |
| `noise-20db`   | Seeded PCG64 Gaussian noise at 20 dB before clipping           | Not realistic room, microphone or Discord noise      |
| `pause-stress` | Insert 450 ms silence at the lowest-energy middle 40 ms window | Can interrupt a word; not a human pause sample       |

The intended text is a reference for synthetic diagnostics, **not human-verified spoken ground truth**. TTS pronunciation, number reading or truncation can contribute to recognition differences. Confirm suspicious cases by listening before attributing them to the recognizer.

## Run offline

First complete the normal [local model setup](SETUP.md). The harness verifies the pinned model files offline and refuses missing or modified files. It does not install dependencies or download models. Use the project Python environment and Node.js 24.17+.

```sh
npm run quality -- prepare --fixture-set baseline-v1
npm run quality -- run --fixture-set baseline-v1 --name alpha7-baseline
npm run quality:queue -- baseline-v1 alpha7-baseline
```

Use a different safe artifact name for another run. The runner refuses to overwrite a completed report. `prepare` reuses and verifies an existing manifest, rather than regenerating speech silently. A partial preparation needs a new fixture-set name. A source-generation failure is retained as three unavailable samples; it is never silently omitted from coverage.

Output stays under ignored `artifacts/quality-fixtures/<set>/` and `artifacts/quality-baseline/<run>/`. The manifest records individual audio SHA-256 hashes, transformation settings, model identities, source hashes and dependency versions. Seeds help local generation but do not guarantee bit-identical TTS across platforms. Preserve the actual WAV files privately for comparisons. Audio is excluded from source packages and the published baseline; do not commit model weights or fixtures.

The runner warms both directions separately, then measures sequential calls. It retains every expected sample, transcription, output, failure, reference length and edit count. Direct translation runs once per reference source and bypasses recognition. Source synthesis, warmup and the direct-translation control are separate from pipeline timing. Failed stages retain `null` timing; reported percentiles use successful stage samples and expose their count.

## Read scores and review meaning

WER is the sum of substitutions, deletions and insertions divided by the sum of reference words. CER uses the corresponding normalized character edit counts. These are micro-averages, not averages of per-sentence percentages. Empty recognition scores all reference words as deletions; unavailable audio/inference has unscored coverage and an explicit failure. No scored samples means `null`, not zero error.

Normalization is versioned: Unicode NFC, language-aware lowercase, straight apostrophes and Unicode word/number tokens. It removes punctuation around words, while retaining Turkish letters, contractions, decimal/time separators and digit values. **It does not equate number words with digits or remove negation.** Numeric formatting can therefore increase WER even when meaning survives. The meaning rubric handles that separately.

Inspect `review-template.json`. For each exact source/route/output, check **all** supplied critical facts. Record `pass` only when every fact survives, `fail` for a contradicted or missing fact, and `uncertain` when the output is ambiguous. Every non-pending judgment needs a short reason. Other defects may exist outside this limited rubric; `pass` does not certify fluency or overall quality.

Identical outputs within one source/route are reviewed once across conditions. Direct and pipeline judgments remain separate. Counts are unique judgments, not per-clip accuracy percentages. A changed output, corpus, evaluation identity, fact or sample list invalidates the review. Label the reviewer and method honestly, including any AI assistance; maintainer review is not independent human acceptance.

```sh
npm run quality -- review --name alpha7-baseline --file artifacts/quality-baseline/alpha7-baseline/review-completed.json
```

## Compare a candidate

```sh
npm run quality -- run --fixture-set baseline-v1 --name candidate-one
npm run quality -- compare --baseline alpha7-baseline --candidate candidate-one
```

The comparison rejects changed corpus, normalization/scorer, audio hashes, references, directions, splits, duplicates or missing samples. It records candidate model/source identities. Review new meaning outputs again; a lower WER alone is not a translation improvement. Reusing the same fixture set is essential. Different generated audio is a different experiment.

Matching host metadata does not prove the same physical computer or background load. Use the same machine and disclose competing work. Sequential timing excludes queue wait, capture, Discord transport, browser and playback. The separate queue command uses the real loopback worker and `Rooms`, three queued development clips, one listener and Turkish output; it records queue/recognition/translation/synthesis separately. Three samples do not establish capacity or meaningful p95 latency.

No recognition settings, models or queue policy are changed by this harness. Synthetic evidence, independent installation, human listening, multi-person Discord and billable-provider validation remain separate gates. Historical release measurements are not rewritten.

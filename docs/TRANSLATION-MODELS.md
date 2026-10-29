# Next local-model experiment

[Türkçe](TRANSLATION-MODELS.tr.md) · [Rejected adapter study](reports/TRANSLATION-SCREEN-2026-10-29.md) · [Proposal metadata](experiments/local-translation-candidates.json)

This is a proposal, not an installed or supported translation profile. The two current-model adapters failed the agreed regression gate. A model comparison is now a better next investigation than silently replacing known facts or claiming the rejected changes improve quality.

## First candidate pair

| Direction         | Official model / pinned revision                                                                                                              | Card license | Selected source weight                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------- |
| English → Turkish | [Helsinki-NLP/opus-tatoeba-en-tr](https://huggingface.co/Helsinki-NLP/opus-tatoeba-en-tr/commit/7178cf6532017eae305633c7bd5ff100d2563db7)     | Apache-2.0   | `pytorch_model.bin`, about 150 MB      |
| Turkish → English | [Helsinki-NLP/opus-mt-tc-big-tr-en](https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-tr-en/commit/2261c8fc7b1af59caee87f8ff0ecf3fbccfe8391) | CC-BY-4.0    | `model.safetensors`, 469,717,280 bytes |

The [English weight metadata](https://huggingface.co/Helsinki-NLP/opus-tatoeba-en-tr/blob/main/pytorch_model.bin) and [Turkish weight metadata](https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-tr-en/blob/main/model.safetensors) provide SHA-256 identities, retained in the proposal. Approximately **620 MB of selected weights**, plus tokenizer/config files and conversion dependencies, would be needed. Entire repositories contain duplicate framework formats and must not be downloaded indiscriminately. Nothing has been downloaded or converted here; actual conversion size, RAM, latency and quality are unmeasured.

This pair is prioritized as an engineering judgment about a bounded, language-specific experiment, not evidence that it beats Argos. The model cards identify the directions and licenses; models remain upstream work and are not presented as Nexora training. Preserve license/attribution and record conversion/quantization separately before any redistribution. The proposal is not a complete executable download lock: tokenizer/config hashes and exact dependency pins still need completion before installation.

[M2M100 418M](https://huggingface.co/facebook/m2m100_418M) is an MIT-labeled reserve supporting both directions, but its [selected PyTorch weight](https://huggingface.co/facebook/m2m100_418M/tree/main) is about 1.94 GB. It is deferred to limit the first experiment's footprint. [NLLB 600M](https://huggingface.co/facebook/nllb-200-distilled-600M) is labeled CC-BY-NC-4.0; the noncommercial restriction is why it is not selected as the default candidate for this broadly reusable product. These choices do not certify model quality or resolve every upstream-data licensing question.

## Integration boundary

The proposed evaluation uses an isolated conversion environment. PyTorch and Transformers are currently absent from the project environment; they will not be added to the running application environment. CPU/int8 CTranslate2 conversion is a candidate approach: the [official converter documentation](https://opennmt.net/CTranslate2/guides/transformers.html) lists MarianMT and M2M100 and explains required special-token handling. Conversion must explicitly test source/target tokenizer differences, EOS/start tokens, unknowns and normalization; the existing single-SentencePiece adapter cannot simply be reused.

An experiment must finish dependency/file pinning, verify free disk space with a declared temporary footprint, preserve existing models and use offline inference after installation. Prefer safetensors where provided; any legacy PyTorch weight must use an explicit weights-only loader and no remote model code. Runtime limits, consent, budget rules and cancellation remain in force. No automatic cloud fallback, provider bill or 24/7 service is introduced.

Only after approval for the additional local download/conversion work should the candidate be installed in a separate directory. Screen development texts first. If it passes without new critical regressions, freeze the adapter, rerun the original WAV set and review changed exact outputs, then run the reserved subset and timing/safety/package gates. No default activation, model release upload or new runtime version follows merely from installation. Human listening and owner-run Discord acceptance remain separate.

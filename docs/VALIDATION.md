# Validation

## English recognition repair — 2026-10-26

The updated local implementation passed 59 TypeScript tests, 9 Python safety/profile tests, 10 browser checks, strict typecheck/build and pinned-model verification. The authenticated loopback worker also passed the three-speaker synthetic caption/translated-audio pipeline without cloud calls. Five new receive-buffer tests cover pause boundaries, long English speech, hard bounds, ordered sample preservation, interruption clearing and the unchanged Turkish profile.

The [synthetic English comparison](reports/english-recognition.json) reuses identical audio hashes for six Piper/LJSpeech sentences in clean and deterministic soft/noisy/faster variants. With standalone cardinal words/numerals treated equivalently, word errors changed from **3/126 to 0/126** on these twelve samples; raw case/punctuation-only scoring changed from 9/126 to 6/126. The English-only base-model candidate had two normalized errors and was not selected. This is a small one-voice synthetic regression, not evidence of error-free human accents or real Discord microphone conditions.

The selected settings need no new model download. Run `python scripts/benchmark_recognition.py --generate` once to create a new synthetic corpus, then reuse it for comparisons without `--generate`. `--engine-file` can evaluate a trusted local baseline engine; `--rescore --output report.json` records both number-normalized and raw errors without rerunning inference. Results remain in ignored artifacts; no human speech is recorded by this harness.

The updated receive/recognition path has not yet been rechecked with the reporting user's live English speech. The earlier live checks below describe the initial alpha.

## Initial alpha — 2026-10-25

Discord credentials were entered privately by the operator for a dedicated live test. No billable API calls were made. This is alpha software with a bounded one-user live check, not a certified interpreter.

Observed on the local Windows host: **54 backend tests, 8 Python safety tests and 10 browser checks passed**; strict typecheck/build/format passed and all 15 pinned model files were verified. A clean Node/source/demo installation was also exercised from an earlier alpha archive in a fresh directory using the npm cache.

The published source then passed [GitHub Actions on Ubuntu and Windows](https://github.com/nexora-studio-tr/voicebridge/actions/runs/40196645739): fresh npm installation, typecheck, 54 backend tests, build, formatting, 8 Python safety tests, 10 browser checks and source packaging on each runner. See the [machine-readable CI report](reports/github-ci.json) for the tested source commit. These CI jobs do not install the full inference stack/model weights or connect to Discord/paid providers. No second fresh Python/model installation or Linux live-inference result is claimed.

| Area | Evidence |
|---|---|
| TypeScript/build | Strict typecheck and production frontend/backend build |
| Backend | Encryption, one-use login, Host/Origin/CSRF, guild/voice isolation, consent cancellation at every stage, stale audio, shared inference, bounded fair queue, no subscribers → no work, budgets, restart uncertainty, simulated provider protocol |
| Python | Traversal/symlink rejection, notice retention, silence short-circuit, input bounds and bounded NumPy timeline |
| Browser | Real cookie-authenticated SSE/WAV, playback gesture, language reset, TR/EN, keyboard dialog, 390px overflow, CSP/no external requests, automatic WCAG A/AA rules |
| Models | 15 pinned files verified by size/SHA-256 plus extracted files |
| Local inference | [Four synthetic samples](reports/local-synthetic.json), both directions |
| Queue/worker | [Three synthetic utterances](reports/worker-synthetic.json), one listener/target through authenticated loopback worker |
| Discord Gateway / commands | Live connection and test-guild registration passed; [sanitized report](reports/live-connection.json) |
| Human OAuth / DAVE / voice | One-user live check passed; [evidence and tester confirmations](reports/live-local.json) |
| Billable cloud | **Not run; separate small spend approval required** |
| Ubuntu / Windows CI | Fresh source/demo checks passed on both hosted runners; full model installation and Linux live inference remain unverified |

Host: Intel Core i3-9100T, four logical CPUs, 7.4 GiB RAM, no CUDA. Inference uses CPU/int8 where applicable and two threads. Warmup, per-utterance inference and queue-inclusive delivery are different measures. Four synthetic samples do not establish p95 or a live capacity SLA. The original three-speaker/two-target profile is still a test target.

Known quality issue: Argos can mistranslate meeting times, confusing “at three” with “three hours” or producing incomplete statements. Demo outputs are not manually corrected to conceal this. Original text is shown. Noise, accents, packet loss, code-switching and broader human conversations still need evaluation. The gate for reliable general live interpretation remains open.

Provider tests simulate documented REST/WebSocket events. They prove local handling and budget gates, not real account access, invoices or spoken-output fidelity. Automatic accessibility checks cover exercised views and are not full WCAG certification.

Reproduce: `npm run check`, project-venv `python -m unittest discover -s worker/tests -v`, `npx playwright install chromium`, `npm run test:browser`; after model setup, `npm run test:local` and `npm run test:worker`. Reports/screenshots go to ignored `artifacts/`. Sandbox restrictions required approved execution for loopback/browser checks; automated browser/worker checks did not use real Discord or paid APIs; the separate one-user live check is identified below.

## Live-test follow-up

Dedicated-bot Gateway login and test-guild slash-command registration succeeded. The missing Discord OAuth redirect was added and the redirect/consent page now opens. The normal authorization-code exchange returned HTTP 401 `invalid_client`; the operator corrected the credential privately, after which OAuth succeeded. DAVE receive/decode and local translation/playback were then exercised in one real voice room. No billable API call was made. OAuth regression coverage now includes exact callback matching, single-use state, classified failures, secret-only replacement and rejection of application IDs/bot tokens in the secret field. Browser coverage includes the translated error and preserving a saved bot token.

Current local live evidence is recorded in [live-local.json](reports/live-local.json). It distinguishes agent-observed captions/state changes from tester-confirmed audibility and reverse-direction output. No human transcript or raw human audio is bundled. A processing indicator that could remain after cancellation/no-speech and the armed listening state after room departure were corrected after the live check.

The final browser checks also verify that the recorded demo on another localhost port does not replace the real application session. Processing/idle indicators and listening teardown are included in the final source.

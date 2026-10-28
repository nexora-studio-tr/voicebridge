# Validation

## Alpha.6 room recovery — 2026-10-28

Local Windows strict typecheck/build and **108 TypeScript tests** passed. The listening-panel Chromium gate passed **25 checks**, including **9 recovery checks** with two separate browser contexts, distinct synthetic identities, real HTTP/SSE and injected inference. It covers lost frames, cached-caption synchronization without audio replay, delayed synthesis, offline/reconnect, revocation during an outage, cross-listener audio denial, membership loss and speaker departure. The reconnect view passes exercised automatic WCAG A/AA rules; the test also caught and repaired the active audio button's hover contrast.

The initial Windows package run exposed a preference-acknowledgement race: a late HTTP response cleared a newer streamed caption. A deterministic browser regression holds that response behind a delivered caption; clearing happens before dispatch instead.

Pure state-machine tests cover snapshot-before-live, stale transport/probe callbacks, bounded retry and timer disposal, 401/403/404 termination, frame gaps/duplicates, malformed/oversized/wrong-room data, invalid audio paths and heartbeat/offline behavior. Room tests verify that a departing listener cannot invalidate another listener's shared clip, while a departed speaker's retained content is removed.

**Additional live Discord tests are deferred at the owner's request.** No live call is needed to proceed with this release. They remain unperformed, not passed. This update adds no human installation, human voice, speech-quality, billable-provider or multi-user capacity evidence. Historical one-user live observations and the independent-installation ledger are unchanged. Exact-head CI, source-package and native Windows outcomes are recorded in Actions and the release's JSON attachments; adding a workflow is not a pass result.

Türkçe: 108 TypeScript testi ve 25 tarayıcı kontrolü yerelde geçti. İki tarayıcı oturumundaki kimlikler ve çıkarım sentetiktir; gerçek insanlar veya Discord ses bağlantısı değildir. Kullanıcının isteğiyle ek canlı Discord testleri ertelendi; başarılı sayılmadı ve bu sürümü durdurmuyor. [Davranış ve sınırlar](ROOM-RECOVERY.md).

## Alpha.5 Windows launcher — 2026-10-28

Local Windows typecheck/build passed with **91 TypeScript tests**, **16 Python tests** and **8 Chromium launcher checks**. Runtime/model interruption tests use synthetic byte streams, exact Range responses and SHA-256 failures. Launcher browser checks use an explicitly labelled injected installer, exercise TR/EN consent, pause/resume, actionable failure, launch/stop/close, keyboard focus return, 390px layout, automatic WCAG A/AA rules and no external requests. They do not install models or connect Discord.

`npm run package:windows` builds an unsigned native launcher and inventories immutable package files. `npm run test:windows` extracts that ZIP into a new folder with system Node/Python removed from the child PATH, tests private setup access, explicit consent, owned-process shutdown and tamper rejection. `npm run test:windows -- --full` additionally downloads standalone Python, locked wheels and the pinned models, checks module imports, then starts/stops the application and local worker without Discord credentials. Use the exact-head Actions run and its sanitized reports for the actual outcome of that full check; adding the workflow is not evidence that it passed.

No independent human installation, two-person Discord acceptance, billable-provider call, live latency/capacity claim or Windows code signing is added by this release. Existing alpha.4 evidence and assets remain attached to their original source. **Independent installation ledger: 0 reviewed entries.**

Türkçe: 91 TypeScript, 16 Python ve 8 sentetik kurulum ekranı kontrolü yerelde geçti. Temiz Windows paketinin ve tam model kurulumunun gerçek sonucu ilgili commit'in CI raporundan kontrol edilir; iş akışının eklenmesi başarı kanıtı değildir. Bağımsız insan kurulumu ve iki kişilik Discord testi açık kapılardır.

## Unreleased main maintenance — 2026-10-27

The first CI attempt for [beta-path PR #4](https://github.com/nexora-studio-tr/voicebridge/pull/4) exposed an existing SSE shutdown race in the [Ubuntu clean-package check](https://github.com/nexora-studio-tr/voicebridge/actions/runs/40572322986): room reset delivery could write to a response already ended by `preClose`, causing `ERR_STREAM_WRITE_AFTER_END`. Event frames and heartbeats now share a guard against ended or destroyed responses. A real HTTP/SSE regression opens a stream, broadcasts after the shutdown hook ends it, and verifies no further writes and complete room cleanup. Local typecheck, build and **77 TypeScript tests** passed; use the PR's final-head CI for cross-platform package results.

This is a later **main-branch fix**, not a replacement of the tagged alpha.4 source or uploaded release archive. The alpha.4 evidence below remains attached to its original source. No new live Discord, independent human installation or paid-provider test was performed.

Türkçe: Beta belgelerinin ilk CI denemesi, kapanmış altyazı akışına yeniden yazma hatasını yakaladı. `main` dalındaki düzeltme ve gerçek HTTP/SSE regresyonu yerelde 77 test, tip kontrolü ve derlemeden geçti. İşletim sistemi/paket kanıtı için PR'ın son commit'inin CI sonucunu kullan. Etiketli alpha.4 paketi değiştirilmedi; yeni insan veya ücretli API testi yapılmadı.

## Alpha.4 caption timing — 2026-10-27

Local Windows checks passed: strict typecheck/build/format, **76 TypeScript tests**, **9 Python tests** and **16 Chromium checks**. Deterministic timing tests cover queue wait, a backward wall clock, shared recognition, preceding language groups, early caption immutability and audio-only disclosure. The browser uses real HTTP/SSE with a synthetic gateway and inference; it checks TR/EN, keyboard focus, automatic accessibility rules, 390px layout, consent cleanup and no external requests.

These checks do not measure live Discord performance. [Timing scope](CAPTION-TIMING.md) excludes capture, Discord transit and browser playback. Fresh-package and hosted Windows/Ubuntu results are recorded in the exact release attachments and Actions run. Full model installation, two-human acceptance and paid-provider validation remain separate, unchanged gates.

## Alpha.3 setup and support — 2026-10-27

The Windows source passed strict typecheck/build/format, **73 TypeScript tests** and **9 Python tests**. The Chromium gate passed **12 checks**, including both setup-panel languages, a 390px modal, automatic WCAG A/AA rules, an actual JSON download, credential/ID exclusion and rejection of a late report after settings change. Screenshots use an isolated profile with deliberately missing Python and synthetic configuration; no private operator profile or credentials were copied.

The installation snapshot checks Node, existing worker health, file presence, saved configuration and the current Gateway-ready flag. Model integrity, actual loading/inference quality, OAuth completion, certificate/remote reachability and two-person acceptance remain separate. Custom inference adapters do not prove the standard Python/model installation. The read-only probe performs no Discord login, capture, model download or paid call. Reports are operator-only and use fixed fields; they are not uploaded automatically.

These are local observations. Check the exact published commit's Actions run and release validation separately for fresh-package and cross-platform results. Alpha.3 introduces no new translation models or recognition settings. Earlier human observations below belong to earlier alpha versions; **no new two-person or billable-cloud validation is claimed**.

## Alpha.2 source release — 2026-10-26

Local checks passed for version `0.1.0-alpha.2`: 59 TypeScript tests, 9 Python tests, typecheck/build/format, source packaging and ten browser checks against a freshly extracted source ZIP with newly installed Node dependencies.

A separate [full-setup report](reports/alpha2-full-setup.json) records a new Python environment created by `npm run setup` inside that extracted copy. Registry caches and fifteen SHA-256-verified public model-download files were reused; translation models were extracted again and verified. The new environment passed Python tests and the three-speaker **synthetic** caption/translated-audio pipeline. No credentials, runtime database or operator session was copied. This was an automated fresh environment on the same Windows host, not an independent person or second device.

The full-setup report hashes the runtime/dependency file manifest of its preparation archive. Final release evidence separately records the published ZIP hash and checks that this runtime manifest still matches. Documentation-only changes do not imply another fresh Python installation was performed. The release CI verifies and installs its exact source archive on Ubuntu and Windows; the attached `CLEAN-INSTALL.json` and `RELEASE-VALIDATION.json` contain the final run and artifact identity.

The second human was unavailable and the user explicitly chose to publish a [beta invitation](BETA.md) instead. Independent human setup, two-person live testing, and recruitment/feedback from 5–10 volunteers are **pending**, not completed. No video is part of this release. See the one-user live recognition observation below for the narrower executed scope.

## English recognition repair — 2026-10-26

The updated local implementation passed 59 TypeScript tests, 9 Python safety/profile tests, 10 browser checks, strict typecheck/build and pinned-model verification. The authenticated loopback worker also passed the three-speaker synthetic caption/translated-audio pipeline without cloud calls. Five new receive-buffer tests cover pause boundaries, long English speech, hard bounds, ordered sample preservation, interruption clearing and the unchanged Turkish profile.

The repair code also passed [GitHub Actions on Ubuntu and Windows](https://github.com/nexora-studio-tr/voicebridge/actions/runs/40243519472) at commit `7e46b364e81263c54ee729898d549513e32959a8`. Subsequent documentation records the user's live result without changing the tested code.

The [synthetic English comparison](reports/english-recognition.json) reuses identical audio hashes for six Piper/LJSpeech sentences in clean and deterministic soft/noisy/faster variants. With standalone cardinal words/numerals treated equivalently, word errors changed from **3/126 to 0/126** on these twelve samples; raw case/punctuation-only scoring changed from 9/126 to 6/126. The English-only base-model candidate had two normalized errors and was not selected. This is a small one-voice synthetic regression, not evidence of error-free human accents or real Discord microphone conditions.

The selected settings need no new model download. Run `python scripts/benchmark_recognition.py --generate` once to create a new synthetic corpus, then reuse it for comparisons without `--generate`. `--engine-file` can evaluate a trusted local baseline engine; `--rescore --output report.json` records both number-normalized and raw errors without rerunning inference. Results remain in ignored artifacts; no human speech is recorded by this harness.

The reporting user subsequently confirmed correct original English text and Turkish translation for the requested one-sentence live Discord check. This is a human self-report from one speaker, not recorded audio or a broad accent/microphone benchmark. Translated audio playback was not separately confirmed in this repair's live check. The earlier live checks below describe the initial alpha.

## Initial alpha — 2026-10-25

Discord credentials were entered privately by the operator for a dedicated live test. No billable API calls were made. This is alpha software with a bounded one-user live check, not a certified interpreter.

Observed on the local Windows host: **54 backend tests, 8 Python safety tests and 10 browser checks passed**; strict typecheck/build/format passed and all 15 pinned model files were verified. A clean Node/source/demo installation was also exercised from an earlier alpha archive in a fresh directory using the npm cache.

The published source then passed [GitHub Actions on Ubuntu and Windows](https://github.com/nexora-studio-tr/voicebridge/actions/runs/40196645739): fresh npm installation, typecheck, 54 backend tests, build, formatting, 8 Python safety tests, 10 browser checks and source packaging on each runner. See the [machine-readable CI report](reports/github-ci.json) for the tested source commit. These CI jobs do not install the full inference stack/model weights or connect to Discord/paid providers. No second fresh Python/model installation or Linux live-inference result is claimed.

| Area                       | Evidence                                                                                                                                                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript/build           | Strict typecheck and production frontend/backend build                                                                                                                                                                                          |
| Backend                    | Encryption, one-use login, Host/Origin/CSRF, guild/voice isolation, consent cancellation at every stage, stale audio, shared inference, bounded fair queue, no subscribers → no work, budgets, restart uncertainty, simulated provider protocol |
| Python                     | Traversal/symlink rejection, notice retention, silence short-circuit, input bounds and bounded NumPy timeline                                                                                                                                   |
| Browser                    | Real cookie-authenticated SSE/WAV, playback gesture, language reset, TR/EN, keyboard dialog, 390px overflow, CSP/no external requests, automatic WCAG A/AA rules                                                                                |
| Models                     | 15 pinned files verified by size/SHA-256 plus extracted files                                                                                                                                                                                   |
| Local inference            | [Four synthetic samples](reports/local-synthetic.json), both directions                                                                                                                                                                         |
| Queue/worker               | [Three synthetic utterances](reports/worker-synthetic.json), one listener/target through authenticated loopback worker                                                                                                                          |
| Discord Gateway / commands | Live connection and test-guild registration passed; [sanitized report](reports/live-connection.json)                                                                                                                                            |
| Human OAuth / DAVE / voice | One-user live check passed; [evidence and tester confirmations](reports/live-local.json)                                                                                                                                                        |
| Billable cloud             | **Not run; separate small spend approval required**                                                                                                                                                                                             |
| Ubuntu / Windows CI        | Fresh source/demo checks passed on both hosted runners; full model installation and Linux live inference remain unverified                                                                                                                      |

Host: Intel Core i3-9100T, four logical CPUs, 7.4 GiB RAM, no CUDA. Inference uses CPU/int8 where applicable and two threads. Warmup, per-utterance inference and queue-inclusive delivery are different measures. Four synthetic samples do not establish p95 or a live capacity SLA. The original three-speaker/two-target profile is still a test target.

Known quality issue: Argos can mistranslate meeting times, confusing “at three” with “three hours” or producing incomplete statements. Demo outputs are not manually corrected to conceal this. Original text is shown. Noise, accents, packet loss, code-switching and broader human conversations still need evaluation. The gate for reliable general live interpretation remains open.

Provider tests simulate documented REST/WebSocket events. They prove local handling and budget gates, not real account access, invoices or spoken-output fidelity. Automatic accessibility checks cover exercised views and are not full WCAG certification.

Reproduce: `npm run check`, project-venv `python -m unittest discover -s worker/tests -v`, `npx playwright install chromium`, `npm run test:browser`; after model setup, `npm run test:local` and `npm run test:worker`. Reports/screenshots go to ignored `artifacts/`. Sandbox restrictions required approved execution for loopback/browser checks; automated browser/worker checks did not use real Discord or paid APIs; the separate one-user live check is identified below.

## Live-test follow-up

Dedicated-bot Gateway login and test-guild slash-command registration succeeded. The missing Discord OAuth redirect was added and the redirect/consent page now opens. The normal authorization-code exchange returned HTTP 401 `invalid_client`; the operator corrected the credential privately, after which OAuth succeeded. DAVE receive/decode and local translation/playback were then exercised in one real voice room. No billable API call was made. OAuth regression coverage now includes exact callback matching, single-use state, classified failures, secret-only replacement and rejection of application IDs/bot tokens in the secret field. Browser coverage includes the translated error and preserving a saved bot token.

Current local live evidence is recorded in [live-local.json](reports/live-local.json). It distinguishes agent-observed captions/state changes from tester-confirmed audibility and reverse-direction output. No human transcript or raw human audio is bundled. A processing indicator that could remain after cancellation/no-speech and the armed listening state after room departure were corrected after the live check.

The final browser checks also verify that the recorded demo on another localhost port does not replace the real application session. Processing/idle indicators and listening teardown are included in the final source.

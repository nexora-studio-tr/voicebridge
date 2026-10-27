# Changelog

## 0.1.0-alpha.3 — 2026-10-27

- Add guided operator setup checks for Node, the local worker, model-file presence, saved Discord settings and the current Gateway connection, with actionable Turkish/English steps.
- Keep full model integrity, remote access, OAuth and two-person voice acceptance explicitly separate from automated installation checks.
- Add an opt-in JSON support report containing only versions, time, OS/architecture and fixed check results. Configuration changes invalidate the previous browser snapshot. No report is uploaded automatically.
- Restrict reports to the instance operator, deny ordinary members and recorded demos, and share only concurrent local health probes. Checks do not connect Discord, download models, run inference or call paid providers.

## 0.1.0-alpha.2 — 2026-10-26

- Improve local English recognition with five-beam deterministic decoding and longer VAD pauses; retain the existing Turkish recognition profile and pinned models.
- Keep English speech past the former six-second cut, prefer quiet boundaries after six seconds, cap segments at twelve seconds and allow 900 ms stream pauses. Turkish capture remains six seconds/450 ms.
- Preserve consent interruption, bounded memory and discontinuity handling; add regression tests and a reproducible, explicitly synthetic English comparison.
- Clarify that the speaker's input language is independent of the listener's translation language. The reporting user confirmed correct English recognition and Turkish captions in a one-sentence live Discord retest; broader accent/microphone coverage remains unverified.
- Versioned source packaging, fresh-package installation checks, bilingual beta participation guides and a structured beta feedback form. Two-person live testing is deferred to volunteers; no beta cohort is claimed as completed.

## 0.1.0-alpha.1 — 2026-10-25

Initial public alpha.

- Personal Turkish/English captions and opt-in translated speech in a bilingual browser panel.
- Dedicated Discord bot, OAuth sign-in and current voice-membership checks.
- CPU local pipeline: faster-whisper, Argos, Okur (TR) and Piper/LJSpeech (EN).
- Optional owner-key cloud adapters with separate speaker consent and conservative budget reservations.
- Consent cancellation, stale-delivery invalidation, bounded queues and 90-second ephemeral delivery.
- Encrypted local configuration, private one-use operator setup and pinned model verification.
- Synthetic recorded demo, setup scripts, architecture, model notices and reproducible validation reports.
- Backend, Python and browser checks; one-user live Discord translation/playback confirmed in both directions.
- Fresh source/demo CI passed on Ubuntu and Windows; full model installation and live provider checks remain separate.

Known limits: alpha quality; clock-time translation errors; no multi-user capacity or real billable-provider validation. Model weights are downloaded separately. See [validation](docs/VALIDATION.md) and the [roadmap](ROADMAP.md).

Türkçe: İlk açık alfa; kişisel altyazı/ses, yerel modeller, izin ve bütçe sınırları, iki dilli panel/kurulum ve test kanıtlarını içerir. Çok kullanıcılı kapasite ve gerçek ücretli API henüz doğrulanmadı.

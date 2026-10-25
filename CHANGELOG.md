# Changelog

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

Known limits: alpha quality; clock-time translation errors; no multi-user capacity or real billable-provider validation. Model weights are downloaded separately. See [validation](docs/VALIDATION.md) and the [roadmap](ROADMAP.md).

Türkçe: İlk açık alfa; kişisel altyazı/ses, yerel modeller, izin ve bütçe sınırları, iki dilli panel/kurulum ve test kanıtlarını içerir. Çok kullanıcılı kapasite ve gerçek ücretli API henüz doğrulanmadı.

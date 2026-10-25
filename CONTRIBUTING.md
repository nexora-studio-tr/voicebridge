# Contributing

Use Node 24.17+ / 24.x and Python 3.12. Install with `npm ci --ignore-scripts`. Run `npm run check`, `npm run format:check`, Python safety tests and `npm run test:browser` before submitting a change. Heavy local-model tests are separate; never put a live token or paid API key in CI.

Preserve consent cancellation, guild/voice isolation, budget reservation-before-dispatch and no automatic paid fallback. Add behavior tests for changes in those areas. Use the existing Radix controls and both UI languages. Keep model provenance and lock files reviewed; model upgrades need fresh synthetic benchmarks and license notices.

Do not include generated runtime data, private bot sources, human recordings or credentials. Reports must distinguish synthetic, simulated-provider and live observations. See SECURITY.md for sensitive issues. Contributions use the project's GPL-3.0-or-later terms; retained third-party files keep their original licenses.

Türkçe: İzin/bütçe sınırlarını koru, arayüzün iki dilini güncelle ve anlamlı davranış testlerini çalıştır. Canlı token, ücretli API anahtarı veya özel bot kodu ekleme. Sentetik ve gerçek test sonuçlarını birbirine karıştırma.

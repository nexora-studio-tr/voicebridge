# Roadmap / Yol haritası

VoiceBridge ships in usable, bounded increments. These are release gates, not promised dates or capacity claims.

| Stage | Status | Acceptance gate |
| --- | --- | --- |
| 0.1 alpha | Implemented; local evidence recorded | Personal TR/EN captions and speech, recorded demo, dedicated-bot OAuth/voice check, consent cancellation, setup and bilingual docs |
| Setup and beta support | Implemented in alpha.3; automated evidence recorded | Guided operator checks, actionable TR/EN steps, opt-in allowlisted support JSON, authorization/privacy/browser regression gates; this does not complete live acceptance |
| Multi-user hardening | Open | Two or more humans, role/channel changes, overlapping speakers, consent revocation mid-utterance and disconnect/reconnect; publish sanitized observations |
| Quality and capacity | Open | Broader synthetic and consented speech corpus; clock times, accents and noise; queue-inclusive latency and memory measurements on named hardware |
| Cloud acceptance | Open | Separately approved small owner-funded budget; real provider compatibility, timeouts and cap exhaustion; publish cost assumptions without credentials |
| Stable release | Open | Resolve observed failures, independently repeat installation, document tested operating systems and maintenance/upgrade paths |

Potential follow-ups include additional language pairs and improved translation models. Each needs license/provenance review, repeatable quality evidence and hardware measurements before becoming a supported feature.

## Türkçe

Yerel alfa, tek kullanıcılı gerçek Discord kontrolüyle kullanılabilir durumda. Sonraki kapılar çok kullanıcılı izin/oda senaryoları, daha geniş çeviri kalitesi ve kapasite ölçümü, ayrıca onaylanmış küçük bütçeyle ücretli API doğrulamasıdır. Kararlı sürüm ancak bu sonuçlar ve tekrar kurulum kanıtı tamamlandığında etiketlenir. Yeni diller ve modeller doğrulanmadan destekleniyor sayılmaz.

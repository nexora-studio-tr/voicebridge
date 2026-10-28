# Room recovery / Oda bağlantısını kurtarma

Alpha.6 keeps reconnects private and predictable. After a dropped stream or browser offline event, the panel clears captions and queued/in-flight audio, shows **Reconnecting**, and offers **Retry now**. Browser offline pauses retries; returning online reconnects automatically. Failed network attempts use bounded backoff with jitter. Missing heartbeats trigger recovery after approximately 15 seconds of active browser time; a suspended browser can delay timers.

A new connection first receives the authenticated listener's current room snapshot. Only its authorized, still-retained captions are restored: at most 30, within the existing 90-second window. This is not a transcript archive or offline recording. If no subscriber was present, the server does not retrospectively process missed speech. Captions from revoked or departed speakers are removed from the server cache and do not return on reconnect.

Restored captions never start playback, including speech that finishes generating after reconnection for a restored caption ID. A new live utterance can play if the listener previously enabled audio. Authentication failure, membership loss or a closed room stops automatic retries and disarms audio. One listener leaving cannot revoke another listener's permission to a shared audio file.

Each connection has an ephemeral identifier and ordered frame counter. The client rejects wrong-room snapshots, missing sequence frames, malformed/oversized data and invalid audio paths; late callbacks from closed connections or earlier membership probes cannot restore state. Snapshots after consent/preferences changes replace the older HTTP-polling pattern. Identifiers/counters are not persisted or used as analytics.

## Verification and limits

`npm run check` covers recovery state transitions and room authorization/media cleanup. `npm run test:browser` includes two independent Chromium contexts with separate synthetic identities, a real HTTP/SSE server and injected inference. It drops frames, delays synthesis, toggles offline mode, revokes consent and removes membership. These are not humans, real Discord/DAVE tests, speech-quality measurements or capacity benchmarks. Additional live Discord tests were deferred at the owner's request; historical live evidence remains identified separately in [validation](VALIDATION.md).

## Türkçe

Bağlantı kopunca veya tarayıcı çevrimdışı olunca panel altyazıları ve bekleyen sesi temizler. **Yeniden bağlanılıyor** durumu ve **Şimdi yeniden dene** düğmesi görünür. Çevrimdışıyken denemeler durur; bağlantı dönünce otomatik devam eder. Ağ hatalarında denemeler aralıklı yapılır. Akış yaklaşık 15 saniye boyunca yeni veri alamazsa yeniden bağlanır; askıya alınmış tarayıcı zamanlayıcıları geciktirebilir.

Yeniden bağlantıda yalnızca o dinleyicinin erişebildiği güncel oda durumu alınır. En fazla 30 altyazı, mevcut 90 saniyelik süre içinde geri gelebilir. Bu bir konuşma arşivi veya çevrimdışı kayıt değildir; dinleyici yokken kaçan konuşma sonradan işlenmez. İzni iptal edilen veya odadan ayrılan konuşmacının metni yeniden gösterilmez.

Geri gelen altyazıların sesleri, ses üretimi sonradan tamamlansa da otomatik oynatılmaz. Sesli dinleme önceden açıldıysa yeni canlı cümleler oynayabilir. Oturum bitince, üyelik kaybolunca veya oda kapanınca denemeler ve ses durur. Bir dinleyicinin ayrılması diğerinin ortak ses dosyasına erişimini kapatmaz.

Testler gerçek HTTP/SSE üzerinde iki ayrı tarayıcı oturumunu, sentetik kimlikleri ve taklit çıkarımı kullanır. Gerçek Discord, insan konuşması, yeni çeviri kalitesi veya kapasite kanıtı değildir. Ek canlı Discord testleri kullanıcının isteğiyle ertelenmiştir.

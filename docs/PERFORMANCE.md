# Performance / Performans

## English

Open **Settings → Performance** with the instance operator session. Ordinary members, guild administrators without an operator session, and recorded-demo sessions cannot access instance-wide measurements. Opening the section takes one snapshot. **Watch live** refreshes every five seconds while the section and tab are visible. Requests do not overlap, time out after eight seconds, and stop when the section closes. Authentication loss clears the report and stops automatic refresh; refresh manually after signing in again.

This view reads existing numeric observations. It does not start a translation, connect Discord, inspect credentials, run a model health check or trigger a billable request. Use **Setup check** to diagnose installation separately.

| Measurement | Meaning |
| --- | --- |
| Running / waiting jobs | The single fair-queue worker and up to eight waiting utterances globally; no more than two waiting per speaker. These are safety bounds, not a supported user count. |
| Node memory | Resident memory of the current Node process. The JSON also includes its used JS heap. Python, model processes and total system memory are excluded. |
| Local / cloud caption and audio | Separate server delivery distributions for successfully delivered output groups, measured from enqueue time. One engine/language group is counted once regardless of listener count. An audio update does not increment the caption count again. |
| Queue wait | Time from enqueue to processing start for each dequeued utterance, including subsequently canceled work. |
| Completed jobs | An utterance with at least one delivered caption and no valid-group processing failure. A job may serve several language/engine groups. |
| Failed / canceled / without output | An utterance with a processing failure; invalidated speaker/room work; or work with no delivered caption (for example empty recognition or no current listeners). A TTS failure can coexist with a useful delivered caption. Raw errors are not retained. |
| Queue full: rejected | New utterances refused because the global or speaker waiting limit was reached. They never enter processing. |

The in-memory window retains **up to 512 numeric events for five minutes**, using a monotonic clock. Queue, output and terminal job observations each consume an event. If the event cap truncates the window, the UI and JSON disclose this; counts and distributions then cover only retained events, may span less than five minutes, and need not reconcile as complete jobs. There is no disk persistence or automatic upload. Restarting the application clears its measurements. Content revocation clears captions/audio as before; unlinked numeric totals expire separately and cannot identify a speaker or utterance.

P50 is the median and P95 uses the nearest rank (`ceil(n × 0.95)`). `n` is the retained sample count for that distribution. **—** / JSON `null` means no measurement, rather than zero latency. Small samples, synthetic tests and the queue's configured limits do not establish capacity. Capture, silence detection, Discord/network transit and browser playback are excluded; see [caption timing](CAPTION-TIMING.md). No end-to-end latency, speech accuracy or benchmark claim is made.

**Download performance report** saves the displayed snapshot locally. The strict allowlist contains the application version, collection time, process uptime, OS/architecture, Node memory, queue counts, outcome counts and numeric timing summaries. It contains no conversation text/audio, private identifiers, names, paths, URLs, provider keys, raw errors or hardware serials. Review the JSON before choosing to share it. The read-only endpoint is `/api/operator/performance`, requires an operator session and uses `Cache-Control: no-store`.

## Türkçe

Kurulumu yöneten operatör oturumunda **Ayarlar → Performans** bölümünü aç. Normal üyeler, yalnızca Discord sunucu yöneticisi olanlar ve kayıtlı demo bu ölçümlere erişemez. Bölüm açıldığında tek anlık görüntü alınır. **Canlı izle**, bölüm ve sekme görünürken beş saniyede bir yeniler; üst üste istek oluşturmaz. İstek sekiz saniyede zaman aşımına uğrar. Oturum yetkisi kaybolursa rapor temizlenir ve otomatik yenileme durur. Yeniden girişten sonra elle yenileyebilirsin.

**Çalışan/bekleyen iş**, tek işleyici ve en fazla sekiz bekleyen konuşma parçasıdır; konuşmacı başına en fazla iki parça bekler. Bu sınırlar desteklenen kişi sayısı değildir. **Node bellek** yalnızca Node sürecini ölçer; Python, modeller ve toplam sistem belleği dahil değildir.

Yerel/bulut altyazı ve ses süreleri ayrı tutulur ve kuyruk beklemesini kapsar. Her motor/hedef dil grubu bir kez sayılır; aynı çıktıyı iki kişi dinlediğinde sayı ikiye çıkmaz. Ses güncellemesi altyazı sayısını artırmaz. Ses üretimi başarısız olsa bile yararlı metin teslim edilebilir. Tamamlanan, hatalı, iptal edilen, çıktı üretmeyen ve kuyruk dolduğu için reddedilen işler ayrı gösterilir. Hata mesajları tutulmaz.

Son beş dakikanın **en fazla 512 sayısal olayı** bellekte tutulur. Kuyruk, çıktı ve iş sonucu ayrı olaylardır. Sınıra ulaşılırsa yalnızca en yeniler gösterilir ve uyarı çıkar; sayıların beş dakikanın tamamını veya tam işleri kapsadığı varsayılmaz. P50 ortanca, P95 örneklerin %95'ini kapsayan en yakın üst sıradaki süredir. `n`, ilgili ölçümün örnek sayısıdır. **—**, ölçüm olmadığı anlamına gelir. Yakalama, ağ ve tarayıcıda çalma ölçülmez. Az örnek veya sentetik test kapasite/kalite kanıtı değildir.

Ölçümler diske yazılmaz; uygulama yeniden başladığında temizlenir. İzin iptali altyazı ve sesi eskisi gibi kaldırır; kimlikle bağlantısı olmayan sayısal toplamlar kendi süresinde silinir. **Performans raporunu indir**, ekrandaki anlık görüntüyü dosyaya kaydeder. Rapor; sürüm, zaman, süreç çalışma süresi, işletim sistemi/mimari, Node belleği, kuyruk ve sayısal süre/sonuç toplamları içerir. Konuşma, ses, ad, özel ID, yol, adres, anahtar, hata mesajı veya donanım seri numarası içermez. Dosyayı inceleyip kendin paylaş; otomatik gönderilmez. Ekranı açmak Discord'a bağlanmaz, model çalıştırmaz veya ücret oluşturmaz. Motorun hazır olup olmadığını ayrıca **Kurulum kontrolü** ile incele.

Bu sürüm ek canlı Discord, insan kurulumu, konuşma kalitesi, donanım karşılaştırması veya ücretli sağlayıcı testi yapıldığını iddia etmez. Canlı Discord kabul testleri proje sahibine bırakılmıştır.

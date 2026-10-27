# Caption timing / Altyazı süreleri

## English

In a connected room, select the time beside a caption to open **Latency details**. The server measures each complete, valid speech segment from the moment it enters the queue, using a monotonic clock.

| Field | Meaning |
| --- | --- |
| Queue wait | Time before this segment starts processing. |
| Recognition | The shared recognition operation for this segment and processing mode. |
| Translation | This target language's translation operation. |
| Other work and scheduling | Remaining time, including preceding language groups and their audio generation. |
| Caption ready | Total server time through caption delivery preparation. |
| Speech synthesis | Speech generation, shown only after requested audio succeeds. |
| Audio preparation | Additional work between caption readiness and audio readiness. |
| Audio ready · total | Total server time until audio is available to the requesting listener. |

The component durations add up to their respective totals. Captions still arrive before speech generation finishes. Text-only listeners do not receive audio timings; unsuccessful or unrequested synthesis displays **Not measured**. Older captions without the optional timing fields keep their simple time label.

Capture and silence detection, Discord transit, delivery over the listener's network and browser playback are outside this measurement. A slow queue suggests competing work; slow recognition or synthesis suggests investigating the relevant model and host resources. One caption is not a hardware benchmark, end-to-end latency measurement, capacity estimate or quality score. The recorded demo deliberately hides this control.

Timings follow the caption's existing in-memory lifetime and consent rules. They are cleared with the caption on consent revocation or departure. This feature adds no saved conversations, exported reports or external telemetry.

## Türkçe

Bağlı odada altyazının yanındaki süreye basarak **Gecikme ayrıntıları** penceresini aç. Ölçüm, tam ve geçerli konuşma parçası sunucu kuyruğuna girdiğinde başlar; sistem saatindeki değişimlerden etkilenmeyen saat kullanılır.

**Kuyrukta bekleme**, parçanın işleme başlamadan önceki süresidir. **Ses tanıma**, aynı parça ve motor için paylaşılan işlemdir. **Çeviri**, seçilen hedef dilin işlemidir. **Diğer iş ve zamanlama**, önce işlenen dil grupları ve onların ses üretimi dahil kalan süreyi gösterir. Bu dört alanın toplamı **Altyazı hazır** süresidir.

Kişisel sesi açtıysan ve ses başarıyla üretildiyse **Ses üretimi**, **Ses hazırlığı** ve **Ses hazır · toplam** da görünür. Altyazı bekletilmez. Ses istenmediğinde veya üretilemediğinde **Ölçülmedi** yazılır. Eski altyazılar basit süre etiketiyle çalışmaya devam eder.

Ses yakalama, sessizlik algılama, Discord aktarımı, dinleyicinin ağı ve tarayıcıda çalma bu süreye dahil değildir. Kuyruk uzunluğu diğer işlerin beklettiğini; model adımlarının uzaması ilgili modeli ve cihaz kaynaklarını incelemeyi gösterebilir. Tek altyazı kapasite, genel kalite veya uçtan uca gecikme sonucu sayılmaz. Kaydedilmiş demoda bu kontrol gösterilmez.

Süreler altyazıyla aynı geçici bellekte ve izin kurallarıyla tutulur. İzin kapandığında veya odadan çıkıldığında altyazıyla temizlenir. Konuşma kaydı, rapor aktarımı veya dış telemetri eklenmez.

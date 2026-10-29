# Yerel TR/EN başlangıç ölçümü — 29 Ekim 2026

[English](QUALITY-BASELINE-2026-10-29.md) · [Yöntem ve komutlar](../QUALITY.tr.md) · [Tam veri](quality-baseline-alpha7-2026-10-29.json) · [Ses manifesti](quality-fixtures-alpha7-2026-10-29.json) · [Kuyruk ölçümü](quality-queue-alpha7-2026-10-29.json)

**Ölçüm tamamlandı; genel çeviri kalitesi kabul edilmiş değil.** 180 sentetik sesin tamamında tanıma, çeviri ve hedef ses üretimi işlem hatası olmadan tamamlandı. Buna rağmen anlam incelemesinde kayıp sayılar, değişen tarihler, bozulan isimler ve tersine dönen olumsuzluklar görüldü. İşlemin çalışması, doğru çevirdiğini göstermiyor.

Alpha.7'nin mevcut CPU çıkarımı değiştirilmedi. 30 Türkçe ve 30 İngilizce kaynak, üç ses koşuluyla ölçüldü. Ölçülen temiz yerel commit `6a2ef673ac18e6fd55a1c660472aadd9496e574c`; [yayımlanan araç commit'i e1e7c8](https://github.com/nexora-studio-tr/voicebridge/commit/e1e7c8325d285882f3e92b808fb15191ef54ac12) ile aynı Git ağacına sahip: `16d53376d5fa53450c705027eaf57061a9d5911c`. GitHub bağlantısıyla yayın nedeniyle commit üst bilgileri farklı; kod ağacı aynı. Dosya, model ve puanlayıcı özetleri JSON'da korunuyor.

Deney kimliği: `4e7fec461073f72c3407faced35c5231b3d2808b9ee4d6765f9b3bb2352f3668`.

## Tanıma sonucu

Her satır 30 sesi kapsar. Yüzdeler **kelime/karakter hata oranıdır**, doğruluk yüzdesi değildir. Yazıyla sayı ve rakam eşitlenmez. JSON ayrıca dil başına 24 geliştirme ve altı ayrılmış değerlendirme örneğini ayrı gösterir.

| Kaynak    | Koşul            | Puanlanan / beklenen |   WER |   CER |
| --------- | ---------------- | -------------------: | ----: | ----: |
| İngilizce | Temiz            |                30/30 | %13,7 | %10,1 |
| İngilizce | 20 dB gürültü    |                30/30 | %14,4 | %10,4 |
| İngilizce | Duraklama stresi |                30/30 | %13,1 |  %9,6 |
| Türkçe    | Temiz            |                30/30 | %34,6 |  %9,9 |
| Türkçe    | 20 dB gürültü    |                30/30 | %38,1 | %10,3 |
| Türkçe    | Duraklama stresi |                30/30 | %30,7 |  %8,8 |

Bu küçük sentetik küme gerçek Türkçe/İngilizce konuşmacıları sıralamaz. İki dilin kaynak sesi farklıdır; telaffuz bağımsız insan tarafından doğrulanmadı. Ayrılmış küme küçük, açık ve eşlenmiştir. Duraklama grubunun daha düşük toplam hatası, duraksamanın genel olarak daha iyi olduğunu göstermez. Sayı biçimi ve Türkçe ek/yazım farkları WER'e katkı sağlar; ham metin ve CER bu farkları gizlemeden incelemeyi mümkün kılar.

## Kritik anlam incelemesi

İnceleme **Codex tarafından yapılmış yapay zekâ ön değerlendirmesidir; bağımsız insan hakemliği yoktur**. 179 farklı kaynak/yol/çıktının her biri gerekçeli incelendi: **57 geçti, 106 hatalı, 16 belirsiz; bekleyen karar yok**. Bunlar benzersiz çıktı sayılarıdır; ses başına doğruluk oranı veya dil sertifikası değildir. Aynı kaynaktaki aynı yol/çıktı, koşullar arasında bir kez incelenir. Sınırlı iki bilgi ölçütü başka hataları kaçırabilir.

| Yol / kaynak                     | Geçti | Hatalı | Belirsiz | Farklı çıktı |
| -------------------------------- | ----: | -----: | -------: | -----------: |
| Doğru İngilizce metin → Türkçe   |    20 |      8 |        2 |           30 |
| Doğru Türkçe metin → İngilizce   |    11 |     15 |        4 |           30 |
| Tanınan İngilizce metin → Türkçe |    21 |     27 |        1 |           49 |
| Tanınan Türkçe metin → İngilizce |     5 |     56 |        9 |           70 |

Yolların girdileri ve çıktı sayıları farklıdır; yüzdeleri eşlenmiş doğruluk gibi karşılaştırılmaz. Doğru metinden çeviri, seslendirmeden ve tanımadan bağımsız hataları görünür kılar. JSON'da korunmuş örnekler:

- **İngilizce olumsuzluk, `en-11-clean`:** “I didn't say delete the backup. Please keep it until Friday.” kelimeleri doğru tanınıyor. Çeviri “Yedekleri silemedim, lütfen Cuma gününe kadar devam edin.” oluyor. Silme talimatı vermediğini söylemek, silememeye dönüşüyor; yedeği saklama talimatı da kayboluyor. Bu gözlem yalnızca tanıma ayarıyla çözülemez.
- **Türkçe olumsuzluk, doğrudan `tr-21`:** “Dosyayı kapatmadan önce bir kopyasını kaydet. Asıl dosyayı değiştirme.”, “Save a copy before closing the file. Change the original file.” oluyor. Tanıma devre dışıyken bile yasak tersine dönüyor.
- **Tarih, doğrudan `en-08`:** Kabul edilen 6 Nisan ve reddedilen 4 Haziran yer değiştiriyor. Aynı sesin rakam içeren tanınmış metni doğru çevriliyor. Bu fark bir tanılama bulgusudur; düzeltme veya referansı değiştirme gerekçesi değildir.
- **Cümle kaybı, `en-01-pause-stress`:** Tanıma “We need 15 minutes. Not 50, please check the microphone.” içeriyor. Çeviride ilk cümle düşüyor; yalnızca ellinin reddi ve mikrofon kontrolü kalıyor.

Sonraki adayda öncelik çeviri akışı ve kritik bilgilerin korunması olmalı. Bu ölçümle çalışma ayarları değiştirilmedi; iyileşme iddia edilmiyor. Aday, genel davranışı düzeltmeli; aynı sesleri ve veri ayrımını kullanmalı, değişen çıktılar yeniden incelenmeli. Otuz senaryoya özel hazır karşılıklar veya yanlış olabilecek sayı/olumsuzluğu zorla yerleştiren yamalar kullanılmamalı.

## Sürelerin kapsamı

Windows 11, Intel Core i3-9100T 3,10 GHz, dört mantıksal işlemci ve işletim sisteminin bildirdiği 7,4 GiB fiziksel bellek kapasitesi; yalnızca CPU çıkarımı. Arka plan servisleri durdurulmadı veya izlenmedi. Ölçüm sırasında hafif depo işlemleri yapıldı. Bu bir geliştirici bilgisayarı gözlemidir; kontrollü kapasite testi değildir. Bağımlılık sürümleri ve model kimlikleri raporda bulunur.

Temiz seslerde ısıtılmış **tanıma → çeviri → ses üretimi** P50/P95: İngilizce kaynaklarda **1608/1969 ms**, Türkçe kaynaklarda **1510/1685 ms** (`n=30`). Yüzdelikler `ceil(n × p)` sırasına göre, başarılı aşama örnekleriyle hesaplanır; sayıları açıklanır. Kaynak ses üretimi, model yükleme ve ayrı doğrudan çeviri kontrolü bu toplama eklenmez. Yakalama, Discord aktarımı, kuyruk, tarayıcı ve oynatma hariçtir.

Gerçek yerel worker/`Rooms` denemesinde üç geliştirme sesi aynı anda kuyruğa girdi; bir dinleyici Türkçe çıktı istedi:

| Kaynak | Kuyruk ms | Tanıma ms | Çeviri ms | Ses üretimi ms | Altyazı toplam ms | Ses toplam ms |
| ------ | --------: | --------: | --------: | -------------: | ----------------: | ------------: |
| en-01  |         0 |      1262 |        98 |            377 |              1361 |          1744 |
| tr-21  |      1739 |      1181 |         5 |            411 |              2926 |          3339 |
| en-12  |      3338 |      1164 |        96 |            351 |              4599 |          4954 |

Bu küçük senaryo, biriken kuyruk beklemesini gösterir; desteklenen kullanıcı sayısını, çok konuşmacılı kaliteyi veya anlamlı p95 kapasitesini belirlemez. Türkçe kaynak zaten Türkçeyi hedeflediğinden bu örnekte diller arası çeviri çalışmaz. Toplamlarda gösterilen aşamalar dışında ölçülen ek süreler de vardır. Discord'a veya ücretli sağlayıcıya bağlanılmadı.

## Tekrarlama ve kabul

Özgün metin, üretim tarifi, özetler, cihaz bilgisi, her puan ve her inceleme gerekçesi yayımlanır. Üretilen 180 WAV dosyası yerelde kalır; **yeniden dağıtılmaz**. Başka bilgisayarda üretim farklı baytlar verebilir; bu, aynı sesin tekrarı değil yeni bir ses kümesidir. Karşılaştırma için yerel dosyaları koru ve [kalite rehberindeki](../QUALITY.tr.md) korumalı komutları kullan.

Yerelde 120 TypeScript testi, tip/üretim derlemesi, biçim kontrolü ve yedisi yeni kalite testi olmak üzere 23 Python testi geçti. Güncel commit'in çapraz platform/paket durumu [PR'ın CI kaydında](https://github.com/nexora-studio-tr/voicebridge/pull/8) bulunur. Bu paket yeni çalışma sürümü veya ikili dosya çıkarmadı; eski alpha.7 dosyaları değiştirilmedi. İnsan dinlemesi, bağımsız kurulum, çok kişili Discord, ücretli sağlayıcı ve genel kalite kabulü bu çalışmada yapılmış sayılmaz.

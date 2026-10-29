# Çeviri adaylarının ön elemesi — 29 Ekim 2026

[English](TRANSLATION-SCREEN-2026-10-29.md) · [Başlangıç ölçümü](QUALITY-BASELINE-2026-10-29.tr.md) · [C1 verisi](quality-screen-sentence-c1-2026-10-29.json) · [C2 verisi](quality-screen-upstream-c2-2026-10-29.json) · [Sonraki model önerisi](../TRANSLATION-MODELS.tr.md)

**İki aday da geliştirme aşamasında elendi; çalışan çevirici değiştirilmedi.** Bazı çıktılar düzeliyor, fakat daha önce doğru olan kritik bilgiler bozuluyor. Bu çalışma kalite artışı veya yeni çalışma sürümü iddia etmiyor.

Deneylerden önce yazılan kabul kuralı: geçen kaynak/yol yeni kritik hata veya belirsizlik üretmemeli; en az üç farklı geliştirme kaynağı/yolunda önceki hata düzelmeli. Yalnızca bu eleme geçilirse aday dondurulup tam ses/ayrılmış veri ve gecikme denetimine geçilir. Bunlar mühendislik kabul ölçütleri, istatistiksel anlamlılık iddiası değildir.

## Yöntem

Başlangıç raporunun dondurulmuş referansları ve tanınan metinleri kullanıldı. Yalnızca **144 geliştirme sesi** seçildi: **48 doğrudan referans ve 97 farklı tanınmış girdi**, toplam **145 kaynak/yol/girdi birimi**. Örnek listeleri bunları **288 ses/yol çiftine** bağlar. Ayrılmış senaryolar adaylara gönderilmedi. Başlangıç verisinin açık olması nedeniyle bu bir kör test değildir.

Her birimde önce değişmeyen alpha.7 çeviricisi yeniden çağrıldı. **Her iki adayın 145 kontrol çıktısının tamamı önceki raporla birebir eşleşti.** Bu koşul, gözlenen değişikliği farklı döküme veya değişmiş kontrol çıktısına bağlamayı önler; başka bilgisayarda aynı sonucun garantisi değildir.

| Aday | Değişiklik                                                                                                      | Değişen çıktı | Doğrulanan gerileme birimi | Etkilenen ses/yol çifti | Bekleyen yeni karar | Sonuç      |
| ---- | --------------------------------------------------------------------------------------------------------------- | ------------: | -------------------------: | ----------------------: | ------------------: | ---------- |
| C1   | Temkinli cümle ayrımı; mevcut çözümleme ayarları                                                                |        46/145 |                          2 |                       6 |                  40 | Reddedildi |
| C2   | Aynı ayrım, toplu çözümleme; bilinmeyen belirteç kopyalama, 0,2 uzunluk katsayısı, varsayılan tekrar politikası |        75/145 |                          5 |                      13 |                  52 | Reddedildi |

C1; beam 4, en fazla 256 çıktı belirteci, 1,1 tekrar cezası ve üçlü tekrar engelini korur. C2, beam ve çıktı sınırını koruyarak [Argos'un kaynak uygulamasındaki](https://github.com/argosopentech/argos-translate/blob/master/argostranslate/translate.py) cümle odaklı çözümlemeyi dener. Bu küçük araştırma adaptörü, Argos kurulumu veya onun cümle algılayıcısının tam kopyası değildir. Yeni kütüphane/model kurulmadı.

**Codex'in yapay zekâ ön değerlendirmesi**, kesin gerilemeler görüldüğünde erken durur. Aynı kalan çıktı önceki yapay zekâ kararını aynen devralır; değişen çıktı gerekçeyle incelenmediyse bekler. Bekleyenler başarı sayılmaz. Tablodaki gerilemeler erken durdurmada bulunan hatalardır; bütün olası hataların sayısı değildir. İnceleme birimleri başlangıçtaki benzersiz çıktı kararlarından farklıdır; sayıları doğruluk yüzdesi veya doğrudan karşılaştırılabilir genel kalite skoru değildir.

Kaynak dile göre dağılım (her yönde 24 referans kaynak):

| Aday / kaynak  | Girdi birimi | Değişen | Gözlenen gerileme | Bekleyen yeni karar |
| -------------- | -----------: | ------: | ----------------: | ------------------: |
| C1 / İngilizce |           65 |      27 |                 2 |                  23 |
| C1 / Türkçe    |           80 |      19 |                 0 |                  17 |
| C2 / İngilizce |           65 |      34 |                 3 |                  19 |
| C2 / Türkçe    |           80 |      41 |                 2 |                  33 |

Bir kısmı incelenmiş grupta sıfır gözlenen gerileme, o grubun hatasız olduğunun kanıtı değildir.

## Kararı belirleyen bulgular

- **Her iki aday, doğrudan `en-04`:** sekiz işten üçünün beklediği ve beşinin bittiği metinde üç bekleyen _kişi_ üretiliyor; tamamlanma da sürmekte olan bitişe dönüşüyor. Önceki doğru ilişki bozuluyor.
- **C1, doğrudan `en-21`:** dosya kopyasını kaydetme “bir kopyasını tasarruf edin” oluyor. Orijinali değiştirmeme korunurken kaydetme eylemi kayboluyor.
- **C2, doğrudan `tr-06`:** üç on beş toplantısı ve üç ellinin reddi “The meeting is not three on five, three fiftys.” haline geliyor.
- **C2, `en-07` doğrudan ve bir akış girdisi:** pazartesi incelemek, pazartesi tekrar etmeye dönüşüyor.
- **C2, doğrudan `tr-16`:** hariç tutulan alıcı Deniz, “the sea” oluyor.

Kısmi yarar da var. İki aday da `en-01/akış` içindeki düşen on beş dakika cümlesini geri getiriyor. C2, `en-11/doğrudan` ve bir akış girdisinde silme talimatı verilmediğini ve cumaya kadar saklamayı birlikte koruyor. C1 iki eski belirsiz doğrudan çıktıyı netleştiriyor. Ancak sıfır yeni gerileme koşulu bozulduğundan **adaylar çalışma sürümüne alınmadı**. C2'de üç kaynak/yol hatadan geçere dönse de bekleyen çıktılar ve yapılmamış sonraki kontroller başarılı sayılamaz.

Türkçe doğrudan `tr-21` olumsuzluğu hâlâ yanlış: “Asıl dosyayı değiştirme”, “Change the original file.” oluyor. İki deney, mümkün olan bütün ayar değişikliklerinin başarısız olacağını kanıtlamaz; yalnızca bu adayların kabul koşulunu sağlamadığını gösterir.

## Kanıt ve tekrar çalıştırma

[Ölçülen kaynak noktası](https://github.com/nexora-studio-tr/voicebridge/commit/b3279bb27543cf235ae781608a81643a4cc5a923), deneyde kullanılan özgün betikleri içerir. Raporlarda kaynak özetleri, model kimlikleri, bağımlılıklar, bütün kontrol/aday metinleri ve seçilen incelemelerin gerekçeleri vardır. Sonradan eklenen çıktı adı ve girdi/çıktı sınırları arşivlenmiş deneyi değiştirmez; birebir kaynak için bu commit kullanılır. Üretim `worker/engine.py`, corpus, puanlayıcı ve model kilidi aynı kalır.

Güncel araştırma komutları mevcut proje Python ortamını ve kurulu sabit modelleri kullanır. Model indirmez, kimlik bilgisi okumaz, sağlayıcı çağırmaz veya Discord'a bağlanmaz:

```sh
python scripts/probe_sentence_translation.py --name sentence-c1-replay
python scripts/probe_upstream_translation.py --name upstream-c2-replay
python scripts/translation_screen_review.py template --name sentence-c1-replay
# Yeni tam çıktı şablonunu inceleyip sonra:
python scripts/translation_screen_review.py assess --name sentence-c1-replay --review path/to/review-completed.json
```

Çıktılar Git dışında `artifacts/translation-screen/<ad>/` altında tutulur; eski çalışma üzerine yazılmaz. Araştırma betikleri uygulama tarafından yüklenmez. Ayırıcı belirsiz sınırları birleşik bırakabilir; genel amaçlı desteklenen cümle algılayıcı değildir. Alıntı/dil kapsamı veya iptal davranışı bu elenen prototiplerle onaylanmış sayılmaz.

Yeni inceleme doğrulayıcısı eski/değişmiş kararı, farklı girdi/kontrolü, eksik/yinelenen örnek çiftini ve ayrılmış verinin karışmasını reddeder. `development-only-pass` bile çalışma motorunu etkinleştirmez. Birim testleri veri ayrımını, sayı/URL/kısaltma korumasını ve boş/aşırı çıktı sınırlarını da denetler. Yerelde yedisi yeni araştırma testi olmak üzere **31 Python testi** geçti. Güncel commit'in çapraz platform/paket sonucu ilgili PR'ın CI kaydına aittir.

Bu adaylar için yeni ASR, TTS, ses, tam akış P95, canlı Discord veya bağımsız insan kabulü yapılmadı. Kaydedilen çeviri çağrısı süreleri tanılama içindir; başlangıçtaki tam akış gecikmesiyle karşılaştırılamaz. Sonraki adım lisans, indirme, dönüştürme ve cihaz maliyeti belirlenmiş ayrı bir yerel model deneyidir.

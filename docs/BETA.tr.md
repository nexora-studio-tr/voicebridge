# VoiceBridge alpha.5 beta

[English](BETA.md) · [Alpha.4 indir](https://github.com/nexora-studio-tr/voicebridge/releases/tag/v0.1.0-alpha.5) · [Doğrulama kaydı](BETA-STATUS.md) · [Geri bildirim formu](https://github.com/nexora-studio-tr/voicebridge/issues/new?template=beta_feedback.yml)

İlk hedef **sonuçları incelenmiş iki bağımsız temiz kurulum**. İkinci kişi katılmadan da yardımcı olabilirsin. İki kişilik gerçek ses kabul testi ayrı bir kapı; daha geniş çağrı 5–10 gönüllüye açık. Tamamlanmış grup testi iddia edilmiyor. Video veya ücretli API kullanımı istenmiyor.

## Yolunu seç

| Durumun                                        | Başlangıç                                                                                                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Arayüzü görmek ve örnekleri dinlemek istiyorum | [Kayıtlı demo](../README.tr.md#demo): Node.js 24.17+ / 24.x yeterli; Python veya bot gerekmez. Tam kurulum veya insan ses testi sayılmaz. |
| Botu ve yerel modelleri ben çalıştıracağım     | Kendi cihazında/sunucunda [temiz kurulum yap](#temiz-kurulum-yap).                                                                        |
| Başkası kurdu, katılacağım                     | [Misafir olarak katıl](#misafir-olarak-katıl); model veya operatör anahtarı gerekmez.                                                     |

## Temiz kurulum yap

**Windows x64:** aynı sürümün [taşınabilir başlatıcısını](WINDOWS.tr.md) kullan. Node pakette bulunur; Python, bileşenler ve modeller indirme onayından sonra özel ortama hazırlanır. **Discord ayarlarını aç** ile yapılandır, sonra aşağıdaki 3. adımdan devam et. Başlatıcı sürümünü ve kurulum sonucunu bildir; bu paket için sisteme Node/Python kurman gerekmez. Eski kaynak kurulumu yerine yeni özel klasör kullan.

**Kaynak koddan kurulum (Linux dahil):** önce 1–2. adımları, sonra aynı kabul kontrollerini uygula.

1. [Alpha.4 sürümündeki](https://github.com/nexora-studio-tr/voicebridge/releases/tag/v0.1.0-alpha.5) kaynak ZIP ve SHA-256 dosyasını indirip doğrula. Yeni klasöre çıkar. Eski `.venv`, `node_modules`, çalışma veritabanı veya anahtar dosyalarını kopyalama. Node.js **24.17+ / 24.x**, Python **3.12** ve yaklaşık **3 GB** boş disk hazır olsun.
2. [Kurulum rehberini](SETUP.tr.md) izle: `npm ci --ignore-scripts`, `npm run setup`, `npm start`. Ayrı lisanslı yerel modeller indirilir; Discord yine internet kullanır. Aynı bilgisayarda tek kullanımlık `.voicebridge/operator-link` adresini açıp ayrı Discord botunu yapılandır. Anahtarları komut satırına veya hata kaydına yazma.
3. **Ayarlar → Kurulumu denetle** düğmesini kullan. Takıldığın veya belirsiz adımı not et. [Kontrol rehberi](SETUP-CHECKS.md), otomatik kontrolleri elle yapılacak OAuth, model bütünlüğü ve gerçek kullanım testlerinden ayırır. Tamamlanamayan kurulum raporu da faydalıdır.
4. Ses denemesi hazırsa botu ayrıca bağla. Normal ses odasında `/voicebridge start` kullanıp panelde Discord hesabınla giriş yap. Operatör oturumu yapılandırma içindir; dinlemek için çıkış yap veya ayrı tarayıcı profili kullan. Konuştuğun dili **English**, hedefi **Türkçe**, motoru yerel seç; kendi yerel iznini ve kişisel sesli dinlemeyi aç. Kısa örnekten sonra dil yönünü tersine çevir.
5. Kendi iznini kapat, kısa konuş ve yeni çıktı gelmediğini kontrol et; odadan ayrılıp eski ses erişiminin kapanmasını dene. [Formda](https://github.com/nexora-studio-tr/voicebridge/issues/new?template=beta_feedback.yml) temiz kurulumu, tamamladığın ses testlerinden ayrı belirt.

Kurulum hedefi için sürüm, işletim sistemi/tarayıcı, Node/Python sürümü, sonuç ve belirsiz adımları yaz. Tam sunucu kurulumu başarılıysa ve operatör paneli açılıyorsa, gerçek ses testi ertelense de inceleme sonrası kurulum hedefine sayılabilir; yalnızca kurulum kanıtıdır. İstersen izin verilen alanlardan oluşan destek raporunu indir, **eklemeden önce incele** ve herkese açık raporunun doğrulama kaydında bağlantılanmasına onay ver. Hiçbir veri kendiliğinden gönderilmez.

## Misafir olarak katıl

Kurulum sahibinden erişilebilir panel adresini alıp botun ses odasına gir. Kendi Discord hesabınla giriş yap, konuştuğun ve duymak istediğin dilleri seç, kendi **yerel** işleme iznini aç ve kişisel sesi başlat. Python, model, bot token'ı veya kurulum sahibinin operator-link dosyası gerekmez.

Uzaktan katılan kişi kurulum sahibinin **HTTPS** panelini kullanır. `127.0.0.1`, adresi açan cihazın kendisini gösterir; paylaşılması diğer bilgisayarı bağlamaz. Kurulum sahibi [uzak erişim yönergelerini](SETUP.tr.md#uzak-erişim-ve-bulut) izler. VoiceBridge ortak bir herkese açık çeviri hizmeti sağlamaz.

## Anlamı ve izni kontrol et

Kendin oluşturduğun kısa, hassas olmayan cümleler kullan. Örnekler:

- “I didn't say delete the backup. Please keep it until Friday.”
- “We need fifteen minutes, not fifty.”
- “Yarın birlikte çalışabiliriz. Yardımın için teşekkür ederim.”

Önce **orijinal algılanan metni**, sonra çevrilen anlamı incele; ikisini ayrı raporla. Gecikme için altyazının yanındaki [Gecikme ayrıntılarını](CAPTION-TIMING.md) aç; yaklaşık duyma gecikmesi de yararlıdır. Sunucu süreleri mikrofonu, Discord aktarımını veya tarayıcıda oynatmayı kapsamaz; tek örnek kapasiteyi kanıtlamaz.

İki ayrı insanla denemede herkes kendi panel oturumunu ve kendi iznini kullanır. İki yönü, sırayla konuşmayı, kısa çakışmayı, kişisel sesi ve izin iptalini dene. İki sekme veya sentetik sesler iki insan sayılmaz.

## Geri bildirim ve sınırlar

Sonucu veya engeli [beta formunda](https://github.com/nexora-studio-tr/voicebridge/issues/new?template=beta_feedback.yml) paylaş; yalnızca kurulum raporunda konuşma alanı isteğe bağlıdır. Ses kaydı, özel konuşma, anahtar, operator-link, veritabanı, özel ID veya kişisel dosya yolu ekleme. Video gerekmiyor.

Yerel modda çeviri API ücreti yok; donanım/elektrik kurulum sahibine ait. Bulut isteğe bağlı, sahibinin ödediği ve varsayılan kapalı bir seçenek; bu beta için harcama gerekmez. Otomatik kaynak/demo kontrolleri ve önceki tek kullanıcılı gözlemler [test kapsamında](VALIDATION.md) kayıtlı. Bağımsız kurulum, çok kullanıcılı kalite ve iki kişilik gerçek test [doğrulama kaydında](BETA-STATUS.md) ayrı tutulur. Raporlar ancak inceleme ve bağlantı paylaşma izni sonrasında sayılır.

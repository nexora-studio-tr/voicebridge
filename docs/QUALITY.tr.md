# Tekrarlanabilir yerel kalite ölçümü

[English](QUALITY.md) · [Test durumu](VALIDATION.md) · [Model lisansları](../THIRD_PARTY_NOTICES.md)

Ölçüm aracı **konuşma tanıma**, **doğru referans metninin çevirisi**, **tanınan metnin çevirisi** ve **ses üretimini** ayrı değerlendirir. Mevcut yerel modellerle çalışır; Discord bağlantısı, kimlik bilgisi, ücretli API veya model indirmesi kullanmaz. Ölçümün tamamlanması, kalite kabulünün geçtiği anlamına gelmez.

## Referanslar ve ses koşulları

[corpus.json](../examples/quality/corpus.json), iki dilde yazılmış 30 özgün ve kurgusal senaryo içerir: 30 Türkçe, 30 İngilizce kaynak metin. Sayılar, saat/tarih, olumsuzluk, isimler, komutlar ve duraksamalar kategorilerinin her birinde dil başına dört geliştirme ve bir ayrılmış değerlendirme senaryosu vardır. Altı senaryoluk `holdout` herkese açıktır ve iki dilde eşlenmiştir; kör test veya genel başarı kanıtı değildir. Sonuçlarına göre ayar yaptıktan sonra görülmemiş veri olarak sunulamaz.

Kaynaklar İngilizce Piper LJSpeech medium ve Türkçe Okur ile bir kez seslendirilir. Her kaynak için üç koşul toplam **180 ses örneği** oluşturur:

| Koşul          | Uygulama                                                    | Sınır                                                 |
| -------------- | ----------------------------------------------------------- | ----------------------------------------------------- |
| `clean`        | Üretilen kaynak WAV dosyasının değişmeyen baytları          | Telaffuz insan tarafından bağımsız doğrulanmadı       |
| `noise-20db`   | Sabit tohumlu PCG64 Gaussian gürültü; kırpma öncesi 20 dB   | Gerçek mikrofon, oda veya Discord gürültüsü değildir  |
| `pause-stress` | Ortadaki en düşük enerjili 40 ms pencereye 450 ms sessizlik | Kelimeyi bölebilir; gerçek insan duraksaması değildir |

Referans metin, sentetik tanılama içindir; **insanın dinleyerek doğruladığı konuşma dökümü değildir**. Seslendirme motorunun telaffuzu, sayı okuması veya kesilmesi tanıma farkına yol açabilir. Şüpheli örneği tanıma motoruna bağlamadan önce dinlemek gerekir.

## Çevrimdışı çalıştırma

Önce normal [yerel model kurulumunu](SETUP.tr.md) tamamla. Araç sabitlenmiş dosyaları çevrimdışı doğrular; eksik/değişmiş modelde durur. Bağımlılık veya model indirmez. Projenin Python ortamını ve Node.js 24.17+ kullanır.

```sh
npm run quality -- prepare --fixture-set baseline-v1
npm run quality -- run --fixture-set baseline-v1 --name alpha7-baseline
npm run quality:queue -- baseline-v1 alpha7-baseline
```

Yeni ölçüm için farklı bir çıktı adı kullan. Tamamlanmış raporun üzerine yazılmaz. `prepare`, mevcut sesleri tekrar üretmek yerine manifesti ve dosyaları doğrular. Yarım kalan hazırlık için yeni ses kümesi adı gerekir. Kaynak ses üretilemezse üç koşul da hata olarak korunur; kapsamdan sessizce çıkarılmaz.

Sesler `artifacts/quality-fixtures/<küme>/`, raporlar `artifacts/quality-baseline/<ölçüm>/` altında Git dışında tutulur. Manifestte her sesin SHA-256 değeri, dönüşüm ayarları, model/kaynak kimlikleri ve bağımlılık sürümleri vardır. Sabit tohum, farklı platformlarda aynı ses baytlarını garanti etmez. Karşılaştırma için üretilen dosyaları yerelde sakla. Sesler kaynak paketine ve yayımlanan rapora dahil edilmez; model ağırlıklarını veya test seslerini depoya ekleme.

İki yön ayrı ısıtıldıktan sonra çağrılar sırayla ölçülür. Beklenen her örnek, döküm, çıktı, hata ve edit sayısı tutulur. Doğrudan çeviri, kaynak metin başına bir kez çalışır ve tanımayı atlar. Kaynak ses üretimi, model ısıtma ve doğrudan çeviri kontrolü, ana akış süresinden ayrıdır. Başarısız aşamada süre `null` kalır. Yüzdelikler başarılı aşama örneklerinden hesaplanır; örnek sayıları JSON'da gösterilir.

## Skorlar ve anlam incelemesi

WER; toplam değiştirme, silme ve ekleme sayısının toplam referans kelime sayısına bölümüdür. CER, aynı yaklaşımı normalize karakterlerle uygular. Cümle yüzdelerinin ortalaması alınmaz. Boş tanıma, referansın tüm kelimelerini silinmiş sayar. Kullanılamayan ses/çıkarım, hata ve puanlanmamış örnek olarak kalır. Hiç puanlanan örnek yoksa sonuç sıfır hata değil, `null` olur.

Sürümlenmiş normalleştirme; Unicode NFC, dile uygun küçük harf, düz kesme işareti ve Unicode kelime/sayı ayrımını kullanır. Kelime çevresindeki noktalama atılır; Türkçe harfler, İngilizce kısaltmalar, ondalık/saat ayracı ve sayı değerleri korunur. **Yazıyla sayılar rakamlarla eşitlenmez; olumsuzluk silinmez.** Anlam korunurken sayı biçimi WER'i artırabilir; anlam incelemesi bunu ayrıca değerlendirir.

`review-template.json` içindeki her kaynak/yol/çıktıda belirtilen **bütün** kritik bilgileri kontrol et. Hepsi korunuyorsa `pass`, biri eksik veya çelişkiliyse `fail`, belirsizse `uncertain` seç. Bekleyen inceleme `pending` kalır. Tamamlanan her karar kısa gerekçe gerektirir. Bu sınırlı ölçüt dışında hata olabilir; `pass` akıcılık veya genel kalite sertifikası değildir.

Aynı kaynak ve yolda koşullar boyunca değişmeyen çıktı bir kez incelenir; doğrudan ve akış çevirileri ayrıdır. Sayılar benzersiz inceleme kararlarıdır, ses başına doğruluk yüzdesi değildir. Çıktı, deney kimliği, bilgi veya örnek listesi değişirse inceleme reddedilir. İnceleyeni ve yöntemi, yapay zekâ desteği dahil, doğru belirt. Bakımcı incelemesi bağımsız insan kabul testi sayılmaz.

```sh
npm run quality -- review --name alpha7-baseline --file artifacts/quality-baseline/alpha7-baseline/review-completed.json
```

## Yeni sürümle karşılaştırma

```sh
npm run quality -- run --fixture-set baseline-v1 --name candidate-one
npm run quality -- compare --baseline alpha7-baseline --candidate candidate-one
```

Araç; referans kümesi, normalleştirme/puanlayıcı, ses özeti, metin, yön veya veri ayrımı değiştiğinde; eksik ya da yinelenen örnek olduğunda karşılaştırmayı reddeder. Yeni sürümün model/kaynak kimlikleri raporda kalır. Yeni anlam çıktılarını yeniden incele; düşük WER tek başına daha iyi çeviri kanıtı değildir. Aynı dondurulmuş ses kümesini kullanmak şarttır.

Donanım bilgilerinin eşitliği aynı fiziksel bilgisayarı veya arka plan yükünü ispatlamaz. Aynı cihazı kullan ve eşzamanlı yükü belirt. Sıralı ölçüm; kuyruk, mikrofon, Discord aktarımı, tarayıcı ve oynatmayı içermez. Ayrı kuyruk komutu gerçek yerel worker ve `Rooms` ile üç geliştirme sesini, tek dinleyiciyi ve Türkçe çıktıyı kullanır; kuyruk/tanıma/çeviri/seslendirme sürelerini ayırır. Üç örnek kapasite veya anlamlı p95 gecikme iddiasını desteklemez.

Bu araç tanıma ayarını, modeli veya kuyruk politikasını değiştirmez. Sentetik ölçüm, bağımsız kurulum, insanın dinlemesi, çok kişili Discord ve ücretli sağlayıcı kontrolleri ayrı tutulur. Eski sürümlerin sonuçları değiştirilmez.

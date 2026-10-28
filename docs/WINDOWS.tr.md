# Windows başlatıcısı — alpha.6

[English](WINDOWS.md) · [Beta rehberi](BETA.tr.md) · [Model lisansları](../THIRD_PARTY_NOTICES.md)

GitHub sürümünden `voicebridge-0.1.0-alpha.6-windows-x64.zip` ile `SHA256SUMS.txt` dosyasını indir. SHA-256 değerini karşılaştırıp ZIP'i **özel ve yazılabilir bir yerel klasöre tamamen ayıkla**. `VoiceBridge.exe` dosyasını aç. ZIP'in içinden çalıştırma. Paket imzasızdır; Windows yayıncı imzası bulunmaz. Çalıştırmadan önce kaynak ve sürüme güvenip güvenmediğine karar ver.

x64 başlatıcı, Windows'taki .NET Framework 4.8'i ve paketteki Node 24 çalışma ortamını kullanır. Node/Python kurmak, yönetici izni, kayıt defteri veya sistem PATH değişikliği ve SDK gerekmez. Test edilen ortamlar ve kapsam [doğrulama kaydında](VALIDATION.md) yer alır. Otomatik Windows çalıştırıcısı bağımsız insan kurulumu sayılmaz.

## İlk hazırlık

1. Başlatıcı **özel bir yerel kurulum sayfası** açar. İndirmeleri kabul edip **Kurulumu hazırla** demeden model indirilmez.
2. Yaklaşık 3 GB kurulum alanı ve ilk hazırlıkta **6 GB boş alan** ile internet gerekir. Sabitlenmiş Astral bağımsız Python 3.12 dağıtımı, özel Python ortamı, PyPI'den sabit ses bileşenleri ve lisansları belirtilen modeller hazırlanır. Node ve bağımlılık lisansları pakette, Python lisansları kendi arşivinde korunur.
3. **Duraklat**, doğrulanmış dosyaları ve kısmi Python/model indirmelerini tutar. Yeniden açıp **Kontrol et ve devam et** ile sürdür. Kaynak destekliyorsa HTTP Range kullanılır; desteklemiyorsa o dosya baştan indirilir. Tamamlanan her indirmede boyut ve SHA-256 denetlenir. Eksik veya bozuk dosya doğrulanmış çalışma ortamı/model olarak kullanılmaz.
4. Hazır olduğunda **VoiceBridge'i başlat**, ardından **Discord ayarlarını aç**. Ayrı bir Discord bot/OAuth uygulamasını mevcut yerel operatör panelinden yapılandır. Anahtarları sen girersin; başlatıcı hesap oluşturmaz, botu bağlamaz veya ücretli bulutu açmaz.
5. [Beta rehberiyle](BETA.tr.md) devam et. Kayıtlı demo, otomatik kurulum ve iki insanla gerçek ses kabul testi ayrı tutulur.

Varsayılan OAuth geri dönüş adresi yeniden başlatmalarda `http://127.0.0.1:4347/auth/callback` olarak kalır. Panel 4347 veya işçi 4351 bağlantı noktası doluysa başlatıcı çakışmayı bildirir; başka süreci kapatmaz veya geri dönüş adresini sessizce değiştirmez.

## Dosyalar ve kapatma

Çalışırken ayıklanan klasörü taşıma. `data/`, modelleri ve özel uygulama ayarları/veritabanını içerir. `.installer/` indirme önbelleği ile özel yerel erişim bağlantısını tutar. Bunları, operator-link dosyasını veya Python ortamını hata kaydına yükleme. **Başlatıcıyı kapat**, hazırlığı duraklatıp yalnızca kendi başlattığı uygulama ve ses motorunu kapatır. Yalnızca tarayıcı sekmesini kapatmak yerel başlatıcıyı durdurmaz; yeniden açabilirsin.

Eski kurulumun üstüne yeni ZIP'i açma. Yeni sürümü başka klasöre ayıkla ve önce eskisini durdur. Elle veri taşımadan önce özel verileri yedekle. Eski kaynak kurulumundan otomatik taşıma bu sürümün kapsamında değildir. Bilgisayarın başka yerindeki kaynak kurulumu ve modeller değiştirilmez veya otomatik kopyalanmaz.

Devam/onarım, paket dosyalarını ve kurulu bileşenleri kontrol eder. Değiştirilmiş program dosyası varsa doğrulanmış paketi yeniden ayıklamak gerekir; başlatıcı rastgele kod indirmez. Geçersiz özel Python değiştirilirse eski klasörü `.installer/previous-python-*` altında tutulur. Klasörü yazılabilir tut; program yollarında bulut yer tutucuları ve junction bağlantıları desteklenmez.

## Uzaktan katılım / bağlantı noktaları

Panel ve işçi yalnızca loopback'e bağlanır. Uzak katılımcılar için [kurulum rehberindeki](SETUP.md#remote-listeners) erişilebilir HTTPS ters proxy gerekir. Uygulama durmuşken ayıklanan pakette `.installer/options.json` oluşturabilirsin:

```json
{"port":4347,"workerPort":4351,"publicUrl":"https://voice.example.com"}
```

Kendi HTTPS adresini kullanıp Discord'da tam `/auth/callback` adresini tanımla. Panel ve işçi bağlantı noktaları farklı olmalı. Yerel kullanımda `publicUrl` isteğe bağlıdır. Dosya yalnızca bu ayarları kabul eder; çalıştırılacak program veya indirme kaynağı değiştirilemez. Özel ayarları veya başlatıcı erişim anahtarını yayımlama.

## Kaynak koddan derleme ve doğrulama

Windows x64, Node 24.17+ ve Python 3.12 ile sırasıyla `npm ci --ignore-scripts`, `npm run check`, `python scripts/package_source.py`, `npm run package:windows` çalıştır. Eşleşen kaynak ZIP'in özeti `BUILD.json` içine yazılır. `npm run test:launcher` sentetik ekranı; `npm run test:windows -- --full` ise ayıklanmış EXE üzerinden gerçek çalışma ortamı/model kurulumunu denetler. Tam kontrol disk ve internet kullanır, birkaç dakika sürebilir; Discord'a bağlanmaz veya insan konuşmasını sınamaz. Dağıtımda kaynak ZIP, Windows ZIP ve SHA-256 dosyasını birlikte tut.
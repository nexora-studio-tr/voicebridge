# Kurulum ve kullanım

1. Node.js **24.17+ / 24.x** ve Python **3.12** kur. Projede `npm ci --ignore-scripts`, `npm run setup`, ardından `npm start` çalıştır.
2. Python bulunamazsa `VOICEBRIDGE_BASE_PYTHON` değişkenine Python 3.12 yolunu ver. Çalışma yorumlayıcısı `VOICEBRIDGE_PYTHON` ile değişebilir.
3. `.voicebridge/operator-link` içindeki adresi aç. Tek kullanımlıktır, 30 dakika geçerlidir. Yeniden başlatmak yeni bağlantı üretir.
4. [Discord portalında](https://discord.com/developers/applications) ayrı uygulama oluştur. OAuth2 callback olarak paneldeki tam adresi kaydet; varsayılan `http://127.0.0.1:4347/auth/callback`.
5. Uygulama ID, token, OAuth client secret ve test sunucusu ID'lerini yerel forma gir. Ayrıcalıklı üye/mesaj intent'i veya Administrator yetkisi gerekmez. Davet yalnızca `bot applications.commands`, Kanalı Görüntüle ve Bağlan ister.
6. **Canlı deneme en son:** ayrıca Bağlan düğmesine bas, normal ses odasında `/voicebridge start` kullan. Operatör oturumu kurulum içindir; dinlemek için çıkış yapıp Discord ile gir veya ayrı tarayıcı profili kullan.
7. Her kişi kendi dili/izinlerini seçer; dinleyici hedef dili ve sesli dinlemeyi açar. Orijinal sesi kendi Discord istemcisinden kısabilir.

Anahtarları sohbete, komut satırına, hata raporuna veya ekran görüntüsüne yazma.

Uygulama ID sayısal kimliktir; **OAuth client secret değildir**. Client secret, Developer Portal → OAuth2 bölümündeki Gizli Anahtar değeridir ve bot token’dan da farklıdır. Mevcut değeri kaybettiysen anahtar yenilemesini kendin tamamla, yeni değeri yalnızca yerel OAuth client secret alanına girip kaydet. Bot token alanını boş bırakınca kayıtlı token korunur. Kayıtlı callback adresi panelde gösterilen adresle tam eşleşmelidir.

## Uzak erişim ve bulut

`127.0.0.1` başka cihazdan açılmaz. Kendi erişilebilir HTTPS adresini `.env` dosyasında `PUBLIC_URL=https://adresin` biçiminde, son / olmadan ayarla. Reverse proxy public Host'u korumalı, olay akışını tamponlamamalıdır. Python portunu açma. Discord callback'i de public adres + `/auth/callback` olmalıdır. Proje otomatik ücretsiz canlı barındırma sağlamaz.

Portlar uygulama 4347, demo 4348, işçi 4351. Çakışmada PORT, PUBLIC_URL, VOICEBRIDGE_WORKER_PORT değerlerini birlikte düzenle. Demo ayrı `.env.demo` ve veri dizini kullanır.

Operatör veya **Sunucuyu Yönet** yetkili üye bulut anahtarını kaydeder, fiyatları kontrol eder, dört bütçeyi pozitif ayarlar ve bulutu açar. İlk ücretli deneme ayrı küçük harcama onayı gerektirir. Fiyat incelemesi 90 gün geçerlidir. Gün/ay UTC kullanır; oda bütçesi oturum boyuncadır. Paylaşılan tek işlem gruptaki ilk isteyen dinleyicinin limitine yazılır. Belirsiz tutar ücretsiz sayılmaz. Anahtarı kaldırmak bulutu kapatır; ele geçirilmede sağlayıcıdan da iptal et.

## Sorun çözümü

- Model: `npm run models`; doğrulama: `npm run models -- --verify-only`.
- Altyazı yok: panel bağlantısı, konuşmacı onayı/dili ve model durumunu kontrol et. Sessiz, çok kısa, kuyruk sınırını aşan veya kesintili parçalar atlanır.
- İngilizce yanlış algılanıyor: **Konuştuğun dil → English** seç; dinlemek istediğin dil ayrı bir ayardır. Güncel kaynakla `npm run build` çalıştırıp uygulamayı yeniden başlat; Python işçisi de uygulamayla yeniden açılır. Yeni İngilizce çözümleme ve duraklama ayarları mevcut ücretsiz yerel modeli kullanır, ek model/API gerekmez. İngilizce cümle sonu gecikmesi biraz artabilir. Orijinal metindeki hata çeviriye de taşınır; mikrofon ve aksan için canlı sonuçları ayrıca kontrol et.
- Ses yok: Sesli dinlemeyi aç düğmesine bas; tarayıcı sesini kontrol et. Eski kuyruk parçaları atlanabilir.
- Bot giremiyor: kanal Görüntüle/Bağlan ve komutu verenin Sunucuyu Yönet izinlerini kontrol et. Stage desteklenmez.
- Yavaş: ilk yüklemeyi bekle, eşzamanlı konuşmayı ve hedef dilleri azalt. CPU profili kapasite garantisi değildir.
- Kapat: Ctrl+C. Yeniden açılınca bot ayrıca bağlanır. Canlı sürecin kilit dosyasını silme.
- Veritabanı ve master.key dosyasını servis kapalıyken özel biçimde birlikte yedekle. Çalışma verisini paylaşılan/senkronize klasöre veya kaynak paketine ekleme.

Son kabul: özel sunucuda iki gerçek kişiyle DAVE/OAuth, iki dil, onay iptali, kanal/yetki değişimi, server-deafen, kopma ve eski ses erişimini dene. Ardından ayrıca onaylanmış küçük bütçeyle bulut sınırlarını dene. Sentetik demo bu adımların yerine geçmez.

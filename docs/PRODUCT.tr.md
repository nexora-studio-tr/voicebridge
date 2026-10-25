# VoiceBridge ürün kararları

Durum: onaylanmış ürün kararları. Tarih: 2026-10-25. Güncel uygulama/test durumu README ve VALIDATION belgelerinde ayrı gösterilir.

## Kullanıcının kesinleştirdiği kararlar

1. Önce VoiceBridge geliştirilecek; AccessLease ayrı bir sonraki proje olacak.
2. Canlı yazılı altyazının yanında sesli çeviri de bulunacak.
3. Yerel/ücretsiz ve bulut/API ücretli modları aynı üründe bulunacak.
4. Sağlayıcı API anahtarını sunucu sahibi yapılandıracak; oda ve kullanıcı bütçelerini o belirleyecek.
5. Çevrilmiş ses web panelinden, her dinleyicinin seçtiği dilde duyulacak.
6. Bot ve yerel modeller kurulumu yapan kişinin bilgisayarında veya kendi sunucusunda çalışacak.
7. Kullanıcı uygulamayı başlatmayı onayladı; aşamalar arasında otomatik ilerleme, gerçek Discord/ücretli testleri sona bırakma kararı geçerlidir.

## Kullanım akışı

1. Kullanıcı bir Discord ses odasına girer ve `/voicebridge baslat` komutunu kullanır.
2. Yetkisi uygunsa bot odaya katılır, oturumun işleme durumunu duyurur ve kişisel panel bağlantısı verir.
3. Kullanıcı Discord hesabıyla panele girer. Backend, sunucu ve mevcut oda üyeliğini doğrular.
4. Konuşmacı sesinin işlenmesine onay verir; yerel işleme ve buluta gönderme onayları ayrıdır.
5. Dinleyici hedef dili, izin verilen modu ve ses seviyesini seçip **Dinlemeyi başlat** düğmesine basar.
6. Panel konuşmacı, orijinal metin, çeviri ve çevrilmiş sesi gösterir. Tarayıcıdan ayrıca mikrofon açılması gerekmez.
7. Kullanıcı odadan ayrılınca odaya ait yeni metin/ses erişimi durdurulur; oturum sona erince bot ayrılır.

## İki modun anlamı

| Karar | Yerel mod | Bulut modu |
| --- | --- | --- |
| Konuşmayı yazıya çevirme | Operatörün bilgisayarındaki model | Seçilen sağlayıcı profili; gerekli onay yoksa ilgili bölüm yerel kalır |
| Metin çevirisi | Yerel model | Sunucu sahibinin yapılandırdığı sağlayıcı |
| Seslendirme | Yerel model | Sunucu sahibinin yapılandırdığı sağlayıcı |
| Ücret | Çeviri API ücreti yok; donanım/elektrik/internet kullanılır | Sağlayıcı faturası sunucu sahibine aittir |
| Kullanıcı deneyimi | Kişisel altyazı ve ses | Kişisel altyazı ve ses; bütçe ve izin koşulları geçerlidir |

Her dinleyici iki modu da kullanabilir; sunucu sahibi bulut modunu kapatabilir veya bütçe dolduğunda durdurabilir. Bulutun her koşulda daha doğru veya daha hızlı olduğu iddia edilmeyecek; kalite ve hız ölçülecek.

Üründe abonelik, kredi satışı, ödeme alma ve platform tarafından karşılanan API kullanımı bu kapsamda bulunmaz. API anahtarları Discord mesajı/komutuyla istenmez; operatörün güvenli kurulumundan veya yetkili yönetim ekranından yapılandırılır.

## İlk sürüm için varsayılan kapsam

Bu maddeler kullanıcıdan tekrar soru istemeyen başlangıç önerileridir; ölçümlerle kesinleştirilecekler:

- Türkçe ve İngilizce, iki yönde çeviri. Diğer diller model, lisans ve kalite doğrulamasından sonra eklenir.
- Her konuşmacı konuştuğu dili seçebilir; kısa ses parçalarında otomatik dil tahmini zorunlu değildir.
- Bir bot kimliği, bir Discord sunucusunda aynı anda tek ses odasını işler. Farklı sunucular için süreç ve kaynak sınırları uygulanır.
- Başlangıç performans profili: bir oda, en çok üç aynı anda etkin konuşmacı ve iki hedef dil. Bu bir test hedefidir; doğrulanmış kapasite veya sınırsız dinleyici iddiası değildir.
- Orijinal metin, kararlı çeviri, konuşmacı adı ve bağlantı/işlem gecikmesi panelde görünür.
- Sesli dinleme ayrıca açılıp durdurulabilir. Eski, kuyruğa birikmiş sesler atlanabilir.
- Ham ses diske kaydedilmez. Canlı metin ve ses parçaları kısa ömürlü oturum verisidir; kalıcı transkript ve dışa aktarma ilk kapsamın dışındadır.
- Bot ücretsiz işleme yaparken sırf bağlantı hatası veya kapasite sorunu oluştu diye ücretli servise geçmez.

## Pratik sınırlar

- Bilgisayar kapanır veya bot bağlantısı koparsa hizmet durur. Yeniden bağlanma durumu panelde gösterilir.
- Uzak dinleyicilerin panele ulaşması için operatör erişilebilir bir HTTPS adresi sağlar. Yerel kurulum, kendiliğinden herkese açık ücretsiz barındırma sağlamaz.
- Çevrilmiş ses tarayıcıdan gelir. Kullanıcı orijinal Discord sesini istediğinde kendi istemcisinden kısar; bot kullanıcının Discord ses ayarlarını değiştirmez.
- Kulaklık ve tarayıcıdaki ilk oynatma etkileşimi akışın parçasıdır. Bot ortak Discord odasına çeviri sesi yayımlamaz.
- Bulut izni vermeyen konuşmacının ham sesi veya sesi üzerinden çıkarılmış metni dışarı gönderilmez. İlgili bölüm yerel işlenir ve panel bunu açıkça belirtir.
- Bütçe denetimi yeni işlemleri durdurur; sağlayıcının önceden başlatılmış isteği ücretlendirmesini geri alamaz.

## Teslim beklentisi

Çalışan backend ve Discord botu, anlaşılır ve erişilebilir panel, güvenli oturum/oda yönetimi, anlamlı testler, kolay kurulum, sentetik demo ve Türkçe/İngilizce dokümantasyon. Mevcut ticari Discord botu ve kaynakları bu projeden ayrıdır; yeniden kullanılmaz veya yayımlanmaz.

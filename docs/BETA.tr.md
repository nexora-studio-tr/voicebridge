# VoiceBridge alpha.2 beta

[English](BETA.md) · [İndir](https://github.com/nexora-studio-tr/voicebridge/releases/tag/v0.1.0-alpha.2) · [Geri bildirim gönder](https://github.com/nexora-studio-tr/voicebridge/issues/new?template=beta_feedback.yml)

Türkçe/İngilizce Discord çevirisini denemek için **5–10 gönüllü kullanıcı arıyoruz**. Bu bir katılım çağrısıdır; beş-on kişinin testi tamamladığı anlamına gelmez. Video gerekmiyor.

## Nasıl deneyebilirsin?

1. **Temiz kurulum:** Paketi yeni klasöre çıkarıp [kurulum rehberini](SETUP.tr.md) izle. Eski `.venv`, `node_modules`, veritabanı veya anahtar dosyalarını kopyalama. Anlaşılmayan adımları not et.
2. **Tek kişi:** Konuştuğun dili ve duymak istediğin dili ayrı seç. Yerel modda iki çeviri yönünü, altyazıyı ve kişisel sesli dinlemeyi dene.
3. **İki kişi:** İki ayrı insan, kendi panel oturumu ve kendi konuşma izniyle aynı odada olsun. İki yönü, sırayla konuşmayı ve kısa süreli çakışmayı dene. İki tarayıcı sekmesi veya sentetik sesler iki kişi sayılmaz.
4. **Durdur/devam et:** Kendi iznini kapat, odadan ayrıl ve yeniden bağlan. İzin kapalıyken yeni çıktı gelmemeli; eski ses erişimi geçerli kalmamalı.

Modelleri çalıştıran kişi ayrı bot uygulamasını yapılandırır. Uzaktaki katılımcı, kurulum sahibinin erişilebilir HTTPS panel adresini kullanmalıdır; `127.0.0.1` herkesin kendi bilgisayarını gösterir. Ayrıntılar [uzak erişim rehberinde](SETUP.tr.md#uzak-erişim-ve-bulut). Proje ortak bir herkese açık çeviri sunucusu sağlamıyor.

## Kısa örnekler

- İngilizce: “I didn't say delete the backup. Please keep it until Friday.”
- İngilizce: “We need fifteen minutes, not fifty.”
- Türkçe: “Yarın birlikte çalışabiliriz. Yardımın için teşekkür ederim.”

Çeviriden önce **orijinal algılanan metni** kontrol et. Yaklaşık altyazı/ses gecikmesi ve yanlış anlaşılan basit bir örnek yeterli; ölçüm cihazı veya video gerekmiyor.

## Geri bildirim

[Beta formunu aç](https://github.com/nexora-studio-tr/voicebridge/issues/new?template=beta_feedback.yml). Sürüm, işletim sistemi/tarayıcı, denenen senaryo, farklı insan sayısı, kurulum sonucu ve sorunları yaz. Genel CPU/RAM bilgisi isteğe bağlıdır. Ses kaydı, token, operator-link, veritabanı, özel sunucu/kullanıcı ID'si veya kişisel konuşma paylaşma.

Beta yerel modla yapılır: çeviri API ücreti yoktur; cihaz ve elektrik kurulum sahibine aittir. Bulut ayrı ve isteğe bağlıdır; bu beta için harcama istenmiyor.

## Durum

Otomatik kaynak/demo kontrolleri ve tek kullanıcılı canlı kontrol vardır; [test kapsamına bak](VALIDATION.md). İkinci kişi şu an bulunamadığı için kullanıcı beta çağrısıyla yayımlamayı seçti. **Başka bir insanın bağımsız kurulumu, iki kişilik gerçek test ve 5–10 kişilik geri bildirim grubu henüz tamamlanmadı.** Yalnızca gelen gerçek sonuçlar kaydedilecek. Sonraki düzeltmeler tekrarlanabilen kurulum hatalarına, yanlış anlama/çeviriye ve aşırı gecikmeye göre seçilecek.

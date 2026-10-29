# Sonraki yerel model deneyi

[English](TRANSLATION-MODELS.md) · [Elenen adaptörler](reports/TRANSLATION-SCREEN-2026-10-29.tr.md) · [Öneri metaverisi](experiments/local-translation-candidates.json) · [Kaynak ön kontrolü](reports/MODEL-PREFLIGHT-2026-10-29.tr.md) · [Doğrulanan kaynaklar](reports/MODEL-SOURCES-2026-10-29.tr.md)

Bu bir öneridir; kurulu veya desteklendiği doğrulanmış profil değildir. Mevcut modellerle denenen iki adaptör gerileme koşulunu geçemedi. Sonraki araştırma, bilinen bilgileri zorla değiştirmek veya elenen adaya kalite artışı demek yerine model karşılaştırmasına odaklanır. Sonraki kaynak ön kontrolü PyTorch gerektirmeyen özgün Marian yolunu buldu; ayrıntısı aşağıda, model ağırlığı kurulmadı.

[Sınırlı Windows çalıştırıcısı](MARIAN-CONVERSION.tr.md) hazırlandı ve küçük yapay örneklerle test edildi. Varsayılan mod yalnızca kaynakları kontrol eder; gerçek model dönüştürmesi RAM koşulunu bekliyor. Çalışma profili etkinleştirilmez veya daha iyi çeviri iddia edilmez.

## İlk aday çifti

| Yön                | Resmî model / sabitlenen kaynak                                                                                                               | Karttaki lisans | Seçilen kaynak ağırlık                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------- |
| İngilizce → Türkçe | [Helsinki-NLP/opus-tatoeba-en-tr](https://huggingface.co/Helsinki-NLP/opus-tatoeba-en-tr/commit/7178cf6532017eae305633c7bd5ff100d2563db7)     | Apache-2.0      | `pytorch_model.bin`, yaklaşık 150 MB  |
| Türkçe → İngilizce | [Helsinki-NLP/opus-mt-tc-big-tr-en](https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-tr-en/commit/2261c8fc7b1af59caee87f8ff0ecf3fbccfe8391) | CC-BY-4.0       | `model.safetensors`, 469.717.280 bayt |

[İngilizce dosyanın](https://huggingface.co/Helsinki-NLP/opus-tatoeba-en-tr/blob/main/pytorch_model.bin) ve [Türkçe dosyanın](https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-tr-en/blob/main/model.safetensors) kaynak sayfalarındaki SHA-256 değerleri öneride korunur. Yaklaşık **620 MB seçilmiş ağırlığa** ek olarak tokenizer/yapılandırma ve dönüştürme bağımlılıkları gerekir. Depoların toplam boyutunda yinelenen çatı biçimleri bulunur; bütün depo topluca indirilmez. Tablodaki Hugging Face ağırlıkları indirilmedi. Özgün arşivler aşağıdaki ayrı yolda alındı; dönüştürme çıktı boyutu, RAM, süre ve kalite hâlâ ölçülmedi.

Bu öncelik, dar ve iki yöne özel bir deney için mühendislik kararıdır; Argos'tan daha iyi olduğunun kanıtı değildir. Lisans ve dil yönleri model kartlarına dayanır. Modeller upstream çalışmadır, Nexora'nın eğittiği ürün gibi sunulmaz. Dağıtımdan önce lisans/atıf korunmalı; dönüştürme ve nicemleme ayrıca belirtilmeli. Öneri tam bir çalıştırılabilir indirme kilidi değildir: kurulumdan önce tokenizer/yapılandırma özetleri ve bağımlılık sürümleri tamamlanmalı.

[M2M100 418M](https://huggingface.co/facebook/m2m100_418M), MIT etiketli ve iki yönü kapsayan yedektir; fakat [seçilecek PyTorch ağırlığı](https://huggingface.co/facebook/m2m100_418M/tree/main) yaklaşık 1,94 GB olduğundan ilk deneyde öncelikli değildir. [NLLB 600M](https://huggingface.co/facebook/nllb-200-distilled-600M) kartında CC-BY-NC-4.0 vardır; ticari olmayan kullanım sınırı nedeniyle geniş kullanıma açık ürünün varsayılan adayı olarak seçilmedi. Bu kararlar kalite garantisi veya bütün upstream veri haklarının çözüldüğü iddiası değildir.

## Ön kontrolden sonra özgün Marian alternatifi

[Kaynak ön kontrol raporu](reports/MODEL-PREFLIGHT-2026-10-29.tr.md) ve [ayrı manifest](experiments/marian-source-preflight.json), toplam 1.150.647.069 bayt özgün Marian NPZ arşivini kaydeder. Kurulu dönüştürücü/bağımlılıklar, PyTorch veya Transformers olmadan sözlük ve ayrı kaynak/hedef SentencePiece modellerini inceleyebiliyor. İlk ön kontrolde yalnızca küçük metaveri aralıkları alındı; aşağıdaki sonraki doğrulama arşiv kimliklerini ve NPZ yapısal denetimini tamamladı. Tam dönüştürücü uyumu, dönüştürme tüketimi ve kalite hâlâ doğrulanmadı. Tablodaki seçilmiş Hugging Face ağırlıklarına göre daha büyük indirme, daha az ek bağımlılık anlamına gelir.

İki özgün arşivde de **CC-BY-4.0** LICENSE var; buna yukarıdaki Hugging Face kartında ayrı paketlenmiş ağırlıkları Apache-2.0 etiketlenen EN → TR de dahil. Kaynak kimlikleri ve lisans gözlemleri ayrı tutulur. Metaveride farklı belirteç kimlikleri ve Marian sözlüğünde bulunmayan tokenizer parçaları görüldü; özel belirteç, bilinmeyen parça ve normalleştirme davranışı açıkça test edilmeli. Mevcut boş RAM koruyucu 2 GiB / 4 GiB eşiklerini geçmedi; disk, 5 GiB geçici alan + 10 GiB rezervi karşıladı. Eşikler ölçülmüş dönüştürme tüketimi değildir. Manifest veya çevrimdışı ön kontrol aracı indirme/dönüştürme ya da çalışma sürümüne alma izni vermez.

Somut onay sonrasında iki özgün arşiv indirildi ve [tamamı doğrulandı](reports/MODEL-SOURCES-2026-10-29.tr.md). [Ayrı kaynak doğrulama kilidi](experiments/marian-verified-sources.json), gözlenen arşiv ve çıkarılan dosya SHA-256 kimliklerini sabitler. Çevrimdışı NPZ inceleyicisi tensor dizisi yüklemeden başlıkları, sınırlı güvenli YAML'ı ve iç ZIP CRC'lerinin tamamını doğruladı. İki yapılandırma ilk seçenek kontrolünü geçti; tam dönüştürücü uyumu denenmedi. Boş RAM eşiğin altında kaldığından dönüştürme yapılmadı. Bu, kaynak hazırlığıdır; çeviri kalitesi artışı veya çalışma sürümüne kurulum değildir.

## Uygulama sınırı

Dönüştürme ayrı bir ortamda yapılmalı. Proje ortamında PyTorch ve Transformers şu anda yok; çalışan uygulamanın ortamına eklenmeyecek. CPU/int8 CTranslate2 bir aday yaklaşımdır: [resmî dönüştürücü belgesi](https://opennmt.net/CTranslate2/guides/transformers.html) MarianMT/M2M100 desteğini ve özel belirteç gereksinimlerini açıklar. Kaynak/hedef tokenizer farkı, EOS/başlangıç belirteci, bilinmeyen sözcük ve normalleştirme ayrıca test edilmeli; mevcut tek SentencePiece adaptörü doğrudan kopyalanamaz.

Kurulumdan önce dosya/bağımlılık sabitlemesi tamamlanmalı, geçici alan bütçesi açıklanıp boş disk denetlenmeli. Mevcut modeller korunmalı ve kurulum sonrasında çıkarım çevrimdışı çalışmalı. Varsa safetensors tercih edilmeli; eski PyTorch biçimi yalnızca ağırlık yükleme modu ve uzaktan model kodu çalıştırmadan ele alınmalı. Metin/ses sınırları, izin, bütçe ve iptal kuralları korunmalı. Otomatik bulut geçişi, sağlayıcı faturası veya 7/24 hizmet eklenmez.

Ek yerel indirme/dönüştürme işi onaylandıktan sonra ayrı aday klasörü kullanılmalı. Önce geliştirme metinleri ölçülür. Yeni kritik gerileme yoksa adaptör dondurulur; aynı WAV kümesi, yeni çıktı incelemeleri, ayrılmış son kontrol, süre/güvenlik/paket denetimleri yürütülür. Kurulum tek başına varsayılan etkinleştirme, model yayını veya yeni çalışma sürümü doğurmaz. İnsan dinlemesi ve kullanıcıya ait canlı Discord kabulü ayrı kalır.

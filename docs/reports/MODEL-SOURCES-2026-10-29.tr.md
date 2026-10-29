# Marian kaynakları doğrulandı — 29 Ekim 2026

[English](MODEL-SOURCES-2026-10-29.md) · [Tam gözlem](quality-model-sources-2026-10-29.json) · [Doğrulanan kaynak kilidi](../experiments/marian-verified-sources.json) · [Önceki ön kontrol](MODEL-PREFLIGHT-2026-10-29.tr.md)

**İki özgün arşiv yerelde indirildi ve doğrulandı. Boş RAM dönüştürme eşiğini hâlâ karşılamıyor.** Yeni çeviri modeli etkinleştirilmedi, yeni kalite sonucu yok; alpha.7 motoru, mevcut model kilidi ve sürüm varlıkları değişmedi. Somut yerel indirme onayı alındı; aynı dosyalar için tekrar indirme onayı gerekmiyor.

## Doğrulananlar

278.474.341 bayt EN → TR ve 872.172.728 bayt TR → EN arşivleri aynı upstream HTTPS adreslerinden sistem sertifika doğrulaması, `If-Match` ve sabit boyut/disk sınırlarıyla alındı. Yanıt ETag değerleri önceki gözlemle ve indirilen dosyaların MD5 değerleriyle eşleşti. Tam SHA-256 gözlemleri artık sabit:

| Yön | Arşiv SHA-256 |
| --- | --- |
| EN → TR | `f1f074185660501c977b523576775eef7438e35eb938712702ab33cf32061a3a` |
| TR → EN | `59a0280099e09d0f32f18688c07ac5a5fc679e3a09bc843facb29f7b63aa9af3` |

Bu değerler **onaylı ilk indirmede gözlendi**; model yazarı tarafından bağımsız yayımlanmış veya imzalanmış özet değildir. Bu güven ayrımı korunur. Tam arşiv envanteri, boyutları, CRC değerleri ve önceden sabit metaveri özetleri eşleşti. Çıkarılan 14 / 13 dosyanın da SHA-256 kimliği var. İki arşiv CC-BY-4.0 içeriyor; modeller upstream çalışmadır. GitHub kaynaklarına veya kaynak ZIP'ine ağırlık, tokenizer ya da özel yapılandırma eklenmedi.

## Tensor dizileri yüklemeden NPZ incelemesi

Her NPZ 255 dizi içeriyor. Sınırlı inceleyici NPY başlıklarını ayrıştırıyor, iç ZIP üyelerinin tamamını küçük tamponlarla okuyarak CRC doğruluyor ve yalnızca küçük `int8` YAML yapılandırmasını okuyor. `numpy.load` çağırmıyor, pickle açmıyor, upstream betik çalıştırmıyor veya çıkarım için tensor dizisi oluşturmuyor. Nesne/yapılı tür, desteklenmeyen boyut/biçim, yinelenen/yol içeren giriş, aşırı başlık/dizi/yapılandırma ve güvenli olmayan YAML etiketi reddediliyor. Bu, sabit kaynaklar için araştırma aracıdır; genel amaçlı model yalıtım sistemi değildir.

| Gözlem | EN → TR | TR → EN |
| --- | ---: | ---: |
| Tensor/yapılandırma veri baytı | 299.660.758 | 939.372.606 |
| En büyük dizi, bayt | 122.865.664 | 233.713.664 |
| Gömme genişliği / attention başlığı | 512 / 8 | 1.024 / 16 |
| Encoder / decoder katmanı | 6 / 6 | 6 / 6 |
| Sözlük büyüklükleri | 59.993 / 59.993 | 57.059 / 57.059 |

Gözlenen Transformer yapılandırması kurulu Marian dönüştürücüsünün desteklediği seçeneklerin ilk kontrolünü geçiyor. **Bu, tam dönüştürücü uyumunu**, int8 çıktının doğruluğunu veya çeviri kalitesini kanıtlamaz. Önceki incelemedeki belirteç kimliği farkları, eksik sıradan parçalar ve normalleştirme konusu açık kalır.

## Kaynak sınırı ve tekrar çalıştırma

Arşivler, çıkarılan kaynaklar ve gözlemler yaklaşık **2,23 GiB** tutuyor; onaylanan 5 GiB sınırının içinde. Boş disk 10 GiB rezervinin üzerinde. Kullanıcının uygulamaları kapattığını bildirmesinden sonra da boş RAM yaklaşık 1 GiB kaldı; koruyucu 2 GiB / 4 GiB dönüştürme eşikleri karşılanmadı. Dönüştürme alt işlemi başlatılmadı. Kullanıcı uygulaması kapatılmadı, takas ayarı değiştirilmedi veya ilgisiz veri silinmedi. PyTorch/Transformers kurulmadı. JSON raporu tam anlık değeri içerir; tepe bellek ölçümü değildir.

Ayrı indirilmiş, özetleri eşleşen arşivleri proje içinde `artifacts/marian-experiment-v1/en-tr/source.zip` ve `artifacts/marian-experiment-v1/tr-en/source.zip` yollarına koy. Hazır worker geliştirme ortamında:

```sh
python scripts/inspect_marian.py
# yalnızca bir yön: python scripts/inspect_marian.py --direction en-tr
```

Komut çevrimdışıdır. Sabit arşivi ve varsa çıkarılmış önbelleği doğrular; eksik kaynağı mevcut dizinin üzerine yazmadan güvenle çıkarır, iç NPZ verisini denetler ve yalnızca yok sayılan araştırma raporlarını yazar. Eksik/değişmiş dosyada indirme başlatmak yerine hata verir. Kilit kaynak doğrulaması için tamamdır; **çalışma sürümüne kurulum kilidi değildir**. Testler küçük yapay arşiv/dizi kullanır; gerçek model veya ağ istemez. CI, hafif test bağımlılıklarına zaten sabit PyYAML 6.0.3'ü ekler.

Sıradaki iş: boş RAM eşiği sağlanınca disk/bağımlılıkları yeniden denetle; yönleri sırayla ayrı int8 aday klasörüne dönüştür, bellek/çıktı boyutunu ölç, belirteç davranışını doğrula ve geliştirme elemesini çalıştır. Kaynak doğrulaması otomatik etkinleştirme, bulut geçişi, model yayımlama, ayrılmış veri/ses değerlendirmesi veya canlı Discord testi başlatmaz. Onay geçerli; bekleyen koşul yeterli kaynaktır.

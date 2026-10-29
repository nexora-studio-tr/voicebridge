# Marian kaynak ön kontrolü — 29 Ekim 2026

[English](MODEL-PREFLIGHT-2026-10-29.md) · [Ölçüm kaydı](quality-model-preflight-2026-10-29.json) · [Kaynak manifesti](../experiments/marian-source-preflight.json) · [Model önerisi](../TRANSLATION-MODELS.tr.md)

**Metaveriler denetlendi; mevcut boş RAM dönüştürme eşiğinin altında. Yeni ağırlık kurulmadı, çalışma sürümü değişmedi.** Bu aşama kaynak/kaynak tüketimi ön kontrolüdür; kalite iyileştirmesi veya desteklenen model profili değildir. C1/C2 hâlâ elenmiştir. Uygulama ve mevcut model kilidi korunur.

## Hugging Face yoluna sınırlı alternatif

Kurulu [CTranslate2 Marian dönüştürücüsü](https://opennmt.net/CTranslate2/guides/marian.html), özgün Marian NPZ ve sözlük dosyalarını kabul eder. Böylece PyTorch/Transformers kurulmadan bir yol denenebilir. İncelenen upstream arşivler:

| Yön | Kaynak arşiv | İndirme, bayt | Açılmış, bayt | Arşiv lisansı |
| --- | --- | ---: | ---: | --- |
| EN → TR | [eng-tur, opus+bt, 2021-04-10](https://object.pouta.csc.fi/Tatoeba-MT-models/eng-tur/opus+bt-2021-04-10.zip) | 278.474.341 | 302.443.539 | CC-BY-4.0 |
| TR → EN | [tur-eng, opusTCv20210807+bt transformer-big, 2022-03-17](https://object.pouta.csc.fi/Tatoeba-MT-models/tur-eng/opusTCv20210807+bt_transformer-big_2022-03-17.zip) | 872.172.728 | 942.106.220 | CC-BY-4.0 |

Önerilen toplam indirme **1.150.647.069 bayt, yaklaşık 1,15 GB / 1,07 GiB**. Önceki yaklaşık 620 MB seçilmiş Hugging Face ağırlığından büyüktür; karşılığında ek dönüştürme çatıları kurulmaz. Bunlar özgün kaynak sürümlerdir; Hugging Face ağırlıklarıyla bayt kimliği veya aynı çeviriyi üretmeleri doğrulanmadı. Tam arşiv SHA-256 değerleri henüz yok.

Yalnızca sınırlı ZIP dizin/başlık/metaveri aralıkları normal TLS doğrulaması, `If-Match`, tam aralık uzunluğu ve ZIP CRC denetimiyle alındı. Windows sistem TLS'i çalıştı; Python sertifika zinciri hatası doğrulama kapatılarak aşılmadı. README, LICENSE, sözlük, tokenizer ve yapılandırma SHA-256 gözlemleri manifestte. ETag bir sunucu kimliğidir; **yayıncının SHA-256 değeri veya imzası değildir**. `completeDownloadLock: false` bilerek korunur; bu manifest gözetimsiz kurulum kilidi değildir. İlk tam indirmede gözlenen arşiv SHA-256 kaydedilmeli, sabit metaveriler doğrulanmalı, NPZ içeriği sınırlandırılarak ve pickle kullanılmadan incelenmeli; kaynak kimliği değişirse işlem durmalıdır. Yerel gözlem yayıncı tarafından bağımsız yayımlanmış özet diye sunulmaz.

İki arşivin LICENSE dosyası da **Attribution 4.0 International** içeriyor; gözlenen ortak SHA-256 `945fbcb37deca05bccd7c3ca0e261679f1f5373515504fdbad68f6f3cf6f49b9`. Bu, önceki EN → TR Hugging Face kartındaki Apache-2.0 etiketinden farklı. Özgün arşiv yolu ayrı CC-BY-4.0 olarak kaydedildi; kart etiketi bu arşive taşınmaz. Model dağıtımından önce upstream yazar/README/lisans ve dönüştürme/nicemleme bilgileri korunmalı. VoiceBridge kodu GPL-3.0-or-later olarak kalır. Kaynak paketinde model dosyası yoktur.

## Tokenizer bulguları

Her kaynak/hedef SentencePiece modeli 32.000 parça içeriyor; iki yönde de kaynak ve hedef özetleri farklı. EN → TR Marian sözlüğü 59.993, TR → EN 57.059 giriş içeriyor. İki ayrı tokenizer gerekiyor. SentencePiece sayısal kimlikleri Marian sözlük kimlikleri gibi kullanılamaz: TR → EN sözlüğünde EOS 43.741, bilinmeyen parça 52.508; SentencePiece EOS ise 2.

Küçük kontrol her dilde nötr bir cümleyi kodlayıp geri açtı. Bu **çeviri testi değildir**. Marian sözlüğünde bulunmayan sıradan parçalar gözlendi: EN → TR kaynak 67 / hedef 3; TR → EN kaynak 6 / hedef 10. EN → TR sözlüğünde SentencePiece kontrol parçası `<s>` de yok. Bu bulgu tek başına sürümün bozuk olduğunu kanıtlamaz; bilinmeyen parça ve özel belirteç davranışı adaptör/dönüştürme testinde açıkça doğrulanmalı. Eksikler başarılı küçük denemeyle gizlenmedi. Upstream ön işleme kabuk betikleri okunup özetlendi, çalıştırılmadı; normalleştirme kararı hâlâ bekliyor.

## Bağımlılıklar ve kaynak sınırı

Yerel ortam Python 3.12, CTranslate2 4.8.3, NumPy 2.5.4, SentencePiece 0.2.2 ve PyYAML 6.0.3 ile eşleşiyor. Bağımlılık eklenmedi. Asıl ağırlık/gömülü yapılandırma uyumu, int8 çıktı boyutu, dönüştürme tepe belleği, çıkarım süresi ve kalite ölçülmedi.

Ön kontrol **5 GiB geçici deney alanı + 10 GiB boş disk rezervi** ayırır. Gözlemde yaklaşık 25 GiB boş disk vardı. Koruyucu boş RAM alt sınırları **EN → TR için 2 GiB, TR → EN için 4 GiB**; tek dönüştürme işlemi ve iki CPU iş parçacığı planlanır. Bunlar ölçülmüş gereksinim veya tepe bellek garantisi değildir. Boş RAM iki eşiğin de altındaydı; tam anlık değer JSON raporundadır. Uygulama kapatılmadı, takas ayarı değiştirilmedi, ilgisiz dosya silinmedi. Disk temizliği ertelenmiş olarak kalır.

## Yeniden kontrol ve sonraki kapı

Kaynak manifesti yayımlanabilir; küçük doğrulanmış metaveriler yalnızca yok sayılan `artifacts/marian-preflight/{en-tr,tr-en}` dizininde. Hazır geliştirme ortamında ağ veya model ağırlığı yüklemeden yeniden kontrol:

```sh
python scripts/preflight_marian.py --inspect-tokenizers
```

`--inspect-tokenizers` olmadan yalnızca standart kütüphaneyle manifest/kaynak/özet denetlenir. Metaveri eksikse hata verir; kendisi indirmez. Testler yapay dosyalar kullanır, model veya ağ gerektirmez. Bütün kaynak sınırları geçse bile `downloadAllowed`, `conversionAllowed`, `runtimePromotion` false kalır; araç izin vermez veya dönüştürmez.

Sıradaki iş: 1,15 GB deney için somut onayı al; her alt işlem öncesi RAM/disk durumunu yeniden denetle; mevcut modelleri değiştirmeden sınırlı indirme ve ayrı dönüştürmeyi yap; belirteç/normalleştirme davranışını doğrula; ardından mevcut gerileme kurallarıyla yalnızca geliştirme metinlerini ele. Kabul edilen adaptör donduktan sonra tam ses/ayrılmış veri aşamasına geçilir. Canlı Discord testleri kullanıcıya aittir. Bu ön kontrol varsayılan etkinleştirme, sürüm paketi değiştirme veya model yayımlama yetkisi vermez.

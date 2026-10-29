# Sınırlı Marian dönüştürmesi

[English](MARIAN-CONVERSION.md) · [Doğrulanan kaynaklar](reports/MODEL-SOURCES-2026-10-29.tr.md) · [Yalnızca kontrol gözlemi](reports/quality-model-runner-2026-10-29.json)

Araştırma hazırlığıdır. Çalıştırıcı ve koruma testleri tamamlandı; **iki gerçek model de henüz dönüştürülmedi veya değerlendirilmedi**. Boş RAM eşiklerin altında. Mevcut uygulama ve model kilidi değişmedi. Çevrimdışı dönüştürme, ürün kurulumundan ayrı bir geliştirici işlemidir.

Hazır Windows worker ortamında tek yönü denetle:

```powershell
.\.venv\Scripts\python.exe scripts\convert_marian.py --direction en-tr
```

Varsayılan mod yalnızca kaynakları kontrol eder. Eşikler geçse bile alt işlem başlatmaz, dönüştürme klasörü oluşturmaz, ağırlık indirmez veya model etkinleştirmez. Kaydedilen kontrol gözlemi kod özetlerini ve karşılanmayan kaynak koşulunu içerir.

Seçilen yönün RAM/disk/bağımlılık denetimi geçince açık komut dönüştürmeyi çalıştırabilir:

```powershell
.\.venv\Scripts\python.exe scripts\convert_marian.py --direction en-tr --run
# Daha sonra, kendi kaynak koşulu sağlandığında:
.\.venv\Scripts\python.exe scripts\convert_marian.py --direction tr-en --run
```

2 GiB / 4 GiB boş RAM eşikleri koruyucu giriş kurallarıdır; ölçülmüş model gereksinimi değildir. Kaynak dosyaları sabit doğrulama kilidiyle eşleşmeli. Çalıştırma Windows ister; diğer platformlarda daha zayıf bir yola geçmeden durur. Platformlar arası hafif testler giriş/yaşam döngüsü mantığını; Windows'a özel test gerçek Job Object sınırını denetler.

Alt işlem [askıda oluşturulur](https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags), sahip olunan Job Object'e bağlanır, ardından [başlatılır](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-resumethread). Windows sanal ortam başlatıcısı ve gerçek Python yorumlayıcısı ilk çalıştıkları andan itibaren kapsanır. Bu zincir için en fazla iki işletim sistemi işlemi ve ortak 1,5 GiB / 3 GiB özel bellek taahhüdü sınırı vardır. Tekil kilit aynı anda bir dönüştürmeye izin verir. Job kapanınca yalnızca ona bağlanan alt işlem zinciri sonlandırılır; kullanıcının diğer uygulamaları yönetilmez.

Ana işlem boş RAM, disk ve deney boyutunu izler. Bellek bilinmiyorsa veya 512 MiB altına düşerse, boş disk 10 GiB altına inerse, deney durdurma eşiği aşılırsa ya da on dakika dolarsa durur. Başlangıçta çıktı alanı ayrılır; izleme, 5 GiB çalışma bütçesinin 256 MiB altında durdurur. Bu izleme işletim sistemi disk kotası değildir. OMP/OpenBLAS/MKL iş parçacığı isteği ikiye ayarlanır. Özel bellek taahhüdü fiziksel RSS değildir; rapor ölçülen büyüklüğü açıkça adlandırır.

Başarılı araştırma çıktısı `artifacts/marian-experiment-v1/<yön>/ct2-int8` altında; kaynak/hedef tokenizer, upstream README/LICENSE ve dönüştürme kaydıyla tutulur. Çalıştırıcı `.voicebridge/models` içine yazmaz. Dosya özetleri, süre ve gözlenen tepe job bellek taahhüdünü kaydeder; alt işlem başarıyla bitmeden ve beklenen dosyalar oluşmadan başarı bildirmez. Varolan çıktı üzerine yazılmaz. Hata halinde yerel işlem günlüğü/raporu korunur; çıktı etkinleştirilmez. Ele alınan hatalarda kendi kilidi kaldırılır; ana işlemin ani kapanması manuel incelenecek kilit bırakabilir. Başka etkin işlemin kilidi kaldırılmamalı.

Doğrulama, 64 MiB job sınırı altındaki küçük bir işlemin 256 MiB ayırmayı denediğinde `MemoryError` almasını kapsar. Bu korumayı doğrular; **gerçek model dönüştürmesini veya kalitesini doğrulamaz**. Tam dönüştürücü uyumu, çıktı boyutu, gerçek model tepe belleği, belirteç/normalleştirme ve geliştirme elemesi bekliyor. Bulut geçişi, upstream model yayını, çalışma sürümü değişikliği, ayrılmış veri/ses değerlendirmesi veya canlı Discord testi eklenmedi.

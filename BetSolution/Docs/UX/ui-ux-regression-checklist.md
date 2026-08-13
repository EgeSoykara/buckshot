# UI/UX Regression Checklist

Bu kontrol listesi, görsel veya etkileşimli bir değişiklikten sonra masaüstü ve mobil oyun akışını doğrulamak için kullanılır.

## Kontroller

- [x] Ana ekranın başlığı, giriş alanları ve altı karakter kartı yatay taşma olmadan görünür.
- [x] Karakter kartları tıklama, odak ve yön tuşlarıyla seçilebilir; `aria-checked` seçimi izler.
- [x] Oda oluşturma ve katılma akışı iki ayrı istemcide tamamlanır.
- [x] Seçilen karakterin adı, can sınırı ve pasifi her iki istemciye aynı gelir.
- [x] 3B karakterler, masa, pompalı, sis, tentacle’lar ve eşya tepsileri WebGL hatası olmadan çizilir.
- [x] Sıra ve hedef değiştiğinde pompalı doğru koltuğa döner.
- [x] 390 × 844 mobil görünümde sayfa yatay taşmaz; HUD ve oyuncu listesi kullanılabilir kalır.
- [x] Adrenalin, rakipte ekipman yokken tüketilmez ve arayüz kilitlenmez.
- [x] Oyun kuralları, pasif metinleri ve README aynı davranışı tarif eder.
- [x] Tarayıcı konsolunda güncel paket için hata veya uyarı yoktur.

## 13 Ağustos 2026 doğrulama kaydı

- Masaüstü: 1280 × 720, iki gerçek Socket.IO istemcisi, Günahkâr ve Boşluk karakterleriyle oda/maç akışı.
- Mobil: 390 × 844; `documentElement.scrollWidth === innerWidth`.
- Otomasyon: `npm test` 16/16, `npm run check`, `git diff --check`, `/health` 200.
- Olumsuz senaryolar: boş rakip envanterinde adrenalin; son fişekte bira; testereden sonra boş ve dolu fişek sırası; son boş fişekten sonra yeni hazneye taşınan testere güçlendirmesi.

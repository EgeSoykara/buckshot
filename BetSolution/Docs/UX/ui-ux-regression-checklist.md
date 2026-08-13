# UI/UX Regression Checklist

Bu kontrol listesi, görsel veya etkileşimli bir değişiklikten sonra masaüstü ve mobil oyun akışını doğrulamak için kullanılır.

## Kontroller

- [x] Ana ekranın başlığı, giriş alanları ve altı karakter kartı yatay taşma olmadan görünür.
- [x] Karakter kartları tıklama, odak ve yön tuşlarıyla seçilebilir; `aria-checked` seçimi izler.
- [x] Oda oluşturma ve katılma akışı iki ayrı istemcide tamamlanır.
- [x] Seçilen karakterin adı, can sınırı ve pasifi her iki istemciye aynı gelir.
- [x] 3B karakterler, masa, pompalı, sis, okült mühürler ve eşya tepsileri WebGL hatası olmadan çizilir.
- [x] Sıra ve hedef değiştiğinde pompalı doğru koltuğa döner.
- [x] Tur sahibi hedefi seçtiği anda, atış yapılmadan önce pompalı ve hedef kilidi turu bekleyen oyuncuların ekranında da aynı koltuğa döner.
- [x] Hedef seçimi ateşten ayrıdır; namlu yönü, oyuncu kartı, nişangâh ve ateş düğmesi aynı hedef adını gösterir.
- [x] Dolu ve boş fişek sonuçları farklı animasyon, ses ritmi ve sonuç metniyle; ateş eden → hedef rotasıyla görünür.
- [x] Raund başında kırmızı dolu ve mavi boş fişekler tek tek sayılır, sıralamanın gizli olduğu belirtilir ve pompalıya tek tek yüklenir; sürekli mühimmat sayacı görünmez.
- [x] Dolu ve boş atıştan sonra doğru renkteki kovan tahliye penceresinden çıkar, masaya düşer, seker ve yerde kalır.
- [x] 390 × 844 mobil görünümde sayfa yatay taşmaz; HUD ve oyuncu listesi kullanılabilir kalır.
- [x] Adrenalin, rakipte ekipman yokken tüketilmez ve arayüz kilitlenmez.
- [x] Oyun kuralları, pasif metinleri ve README aynı davranışı tarif eder.
- [x] Tarayıcı konsolunda güncel paket için hata veya uyarı yoktur.

## 13 Ağustos 2026 doğrulama kaydı

- Masaüstü: 1280 × 720, iki gerçek Socket.IO istemcisi, Günahkâr ve Boşluk karakterleriyle oda/maç akışı.
- Atış okunabilirliği: iki istemcide Ada → Baran ve Baran → Ada hedef kilitleri; `DOLU!` hasar paneli ile `BOŞ · KLİK` hasarsız paneli ayrı ayrı doğrulandı.
- Kilit önceliği: seçili hedef ve gerçekleşen atış, başka oyuncu üzerindeki hover/odak önizlemesinden üstün kalır; namlu, nişangâh ve tetik etiketi ayrışmaz.
- Çoklu istemci namlu senkronu: Ada yalnızca Baran'ı hedeflediğinde, ateş etmeden önce Baran'ın ekranında pompalı Baran'a döndü; `HEDEF: BARAN · KENDİN`, hedef halkası ve `ADA → BARAN · KENDİN` rotası birlikte görüntülendi.
- Raund sunumu: iki istemcide `3 DOLU + 3 BOŞ`, kırmızı/mavi fişek dizisi, `SIRALAMA GİZLİ` uyarısı ve yükleme süresince kilitli hedef/ekipman kontrolleri doğrulandı; eski sağ üst mühimmat sayacı kaldırıldı.
- Kovan fiziği: gerçek dolu atıştan sonra kırmızı, gerçek boş atıştan sonra mavi kovan pompalıdan tahliye edilerek masa üzerinde ayrı ayrı görüntülendi.
- Mobil: 390 × 844; `documentElement.scrollWidth === innerWidth`.
- Otomasyon: `npm test` 19/19, `npm run check`, `git diff --check`, `/health` 200.
- Olumsuz senaryolar: boş rakip envanterinde adrenalin; son fişekte bira; testereden sonra boş ve dolu fişek sırası; son boş fişekten sonra yeni hazneye taşınan testere güçlendirmesi.

# UI/UX Regression Checklist

Bu kontrol listesi, görsel veya etkileşimli bir değişiklikten sonra masaüstü ve mobil oyun akışını doğrulamak için kullanılır.

## Kontroller

- [x] Ana ekranın başlığı, giriş alanları ve altı karakter kartı yatay taşma olmadan görünür.
- [x] Karakter kartları tıklama, odak ve yön tuşlarıyla seçilebilir; `aria-checked` seçimi izler.
- [x] Oda oluşturma ve katılma akışı iki ayrı istemcide tamamlanır.
- [x] Seçilen karakterin adı, can sınırı ve pasifi her iki istemciye aynı gelir.
- [x] 3B karakterler, masa, pompalı, sis, okült mühürler ve eşya tepsileri WebGL hatası olmadan çizilir.
- [x] Altı karakter, pompalı ve dokuz ekipman tek Blender GLB kaynağından yüklenir; eski geometrik model yolu bulunmaz.
- [x] Dokuz ekipmanın özel animasyonu `game:item-used` olayıyla bütün istemcilere yayılır; kelepçe ve adrenalin aynı hedef oyuncuyu kullanır.
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
- Otomasyon: `npm test` 24/24, `npm run check`, `git diff --check`, `/health` 200.
- Olumsuz senaryolar: boş rakip envanterinde adrenalin; son fişekte bira; testereden sonra boş ve dolu fişek sırası; son boş fişekten sonra yeni hazneye taşınan testere güçlendirmesi.

## 13 Ağustos 2026 Blender ve ekipman animasyonu doğrulama kaydı

- Blender MCP: açık Steam Blender 5.2.0 LTS sahnesine canlı erişim doğrulandı; kaynak sahne `blender/last-chamber-kit.blend` olarak kaydedildi ve web çıktısı Blender glTF 2.0 dışa aktarıcısıyla üretildi.
- Varlık kapsamı: altı karakter, pompalı ve dokuz ekipman GLB içinde `asset_kind`, `character_id`, `item_type` ve hareketli `lc_role` alanlarıyla doğrulandı; web için sahne düğümü sayısı 1015'ten 113'e indirildi. 47 PBR materyalin tamamı gömülü base-color, normal ve roughness haritası taşır.
- Tam geçiş: istemcideki eski geometrik karakter, pompalı ve ekipman üreticileri kaldırıldı; `public/assets/last-chamber-kit.glb` tek model otoritesidir.
- Masaüstü: 1280 × 720'de iki gerçek Socket.IO istemcisiyle oda kurma, katılma, raund yükleme ve FPS tur görünümü çalıştırıldı; iki istemcinin konsolunda hata veya uyarı görülmedi.
- Ekipman senkronu: bira sonucunun doğru kovan rengini, kelepçenin sıradaki oyuncuyu ve adrenalinin eşyanın çalındığı oyuncuyu animasyon olayına taşıdığı sunucu testlerinde doğrulandı. İstemci bu tek olaydan testere/kıvılcım, telefon, içecek, sigara/duman, kelepçe, büyüteç, çevirici, adrenalin ve ilaç koreografilerini üretir.
- Etkileşim kilidi: ekipman koreografileri kuyrukta eksiksiz oynarken hedef, ekipman ve tetik eylemleri hem görsel hem işlev düzeyinde kilitli kalır; kuyruk boşaldığında yeniden açılır.
- Görsel inceleme: düşük pozlamalı yeşil sis, sıcak kenar ışığı, PBR pompalı, ayrı tepsi yuvaları ve FPS tutuş noktaları 1280 × 720 ekran görüntüsüyle kontrol edildi.
- Otomasyon: `npm test` 24/24, `npm run check`, `git diff --check` temiz.

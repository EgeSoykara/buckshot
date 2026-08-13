# Last Chamber

Arkadaşlarınla tarayıcıdan oynayabileceğin, 2–6 kişilik gerçek zamanlı 3B masa gerilim oyunu. Mekanik olarak şans, hedef seçimi ve ekipman kullanımını birleştirir; bütün kodlar, 3B modeller ve görsel kimlik bu proje için özgün hazırlanmıştır.

## Oyuncular nasıl katılır?

1. Bir oyuncu **Yeni Oda Kur** düğmesine basar.
2. Ekrandaki bağlantıyı arkadaşlarına gönderir.
3. Arkadaşları bağlantıyı açıp isimlerini yazar ve **Katıl** düğmesine basar.
4. Oda sahibi, en az iki kişi masadayken oyunu başlatır.

Kurulum veya hesap gerekmez. Oda en fazla 6 kişiyi destekler. Bağlantısı kısa süreli kesilen oyuncu aynı tarayıcıdan otomatik olarak masaya döner.

## Oyun kuralları

- Her oyuncu 3 canla başlar.
- Sıranda kendini veya hayatta olan başka bir oyuncuyu hedefleyebilirsin.
- Kendine gelen boş fişek sıranı korur. Diğer bütün atışlardan sonra sıra ilerler.
- Hazne bitince dolu ve boş fişeklerden oluşan yeni bir hazne yüklenir.
- Son hayatta kalan oyuncu kazanır.
- **Büyüteç** sıradaki fişeği gösterir; **Bira** fişeği çıkarır; **Sigara** can yeniler; **Kelepçe** rakibin turunu atlar; **El Testeresi** dolu fişeği 2 hasara çıkarır.
- **Telefon** rastgele bir fişeği bildirir; **Çevirici** sıradaki fişeği tersine çevirir; **Adrenalin** ekipman çalar; **Eski İlaç** şansa bağlı can kazandırır veya kaybettirir.
- Bir tur 30 saniyedir. Süre dolarsa sunucu otomatik hedef seçer.

## Render'a yayınlama

Depoda hazır bir `render.yaml` Blueprint dosyası bulunur.

1. [Render Dashboard](https://dashboard.render.com/) üzerinden **New → Blueprint** seç.
2. `EgeSoykara/buckshot` GitHub deposunu bağla.
3. Blueprint'i onaylayıp **Apply** düğmesine bas.
4. Dağıtım bitince verilen `onrender.com` bağlantısını arkadaşlarınla paylaş.

WebSocket ve HTTP aynı Node servisi üzerinde çalışır. Herhangi bir ortam değişkeni veya veritabanı gerekmez. Odalar bellekte tutulduğu için servis yeniden başlatıldığında açık odalar sıfırlanır.

## Yerelde çalıştırma

Node.js 20 veya üzeri gerekir.

```bash
npm install
npm run dev
```

Ardından `http://localhost:3000` adresini aç.

## Doğrulama

```bash
npm test
npm run check
```

- Sunucu: Express + Socket.IO
- 3B istemci: Three.js
- Dağıtım: Render Web Service

## Lisans

MIT — ayrıntılar için [LICENSE](LICENSE).

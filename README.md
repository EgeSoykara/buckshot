# Last Chamber

Arkadaşlarınla tarayıcıdan oynayabileceğin, 2–6 kişilik gerçek zamanlı 3B Lovecraftian masa gerilim oyunu. Mekanik olarak şans, hedef seçimi, karakter pasifleri ve ekipman kullanımını birleştirir; bütün kodlar, 3B modeller ve görsel kimlik bu proje için özgün hazırlanmıştır.

Her oyuncu seçtiği kimliğe ait farklı yüz, beden, kıyafet, mutasyon ve pasifle temsil edilir. Bu seçim sunucuda saklanır, bütün oyunculara yayınlanır ve yeniden bağlantıda korunur. Sisli 3B masa, okült mühürler, fiziksel eşya tepsileri ve ayrıntılı pompalı oyun durumuna tepki verir. Önce hedef seçilir; sunucuya kaydedilen kırmızı namlu yönü, nişangâh ve hedef halkası odadaki bütün oyuncuların ekranında aynı kilidi gösterir. Ayrı tetik düğmesiyle ateş edilir. Dolu atışlarda ateş/parlama ve hasar, boş atışlarda kararma, mekanik klik ve pompa animasyonu gösterilir; iki sonuçta da ateş eden ile hedef ekranda açıkça yazılır.

## Oyuncular nasıl katılır?

1. Bir oyuncu **Yeni Oda Kur** düğmesine basar.
2. Ekrandaki bağlantıyı arkadaşlarına gönderir.
3. Arkadaşları bağlantıyı açıp isimlerini ve karakterlerini seçer, ardından **Katıl** düğmesine basar.
4. Oda sahibi, en az iki kişi masadayken oyunu başlatır.

Kurulum veya hesap gerekmez. Oda en fazla 6 kişiyi destekler. Bağlantısı kısa süreli kesilen oyuncu aynı tarayıcıdan otomatik olarak masaya döner.

## Oyun kuralları

- Oyuncular karakterlerine göre 3 veya 4 canla başlar.
- Sıranda kendini veya hayatta olan başka bir oyuncuyu seçip namluyu kilitler, ardından ayrı **Ateş Et** düğmesiyle tetiği çekersin.
- Kendine gelen boş fişek sıranı korur. Diğer bütün atışlardan sonra sıra ilerler.
- Hazne bitince dolu ve boş fişeklerden oluşan yeni bir hazne yüklenir.
- Son hayatta kalan oyuncu kazanır.
- **Büyüteç** sıradaki fişeği gösterir; **Bira** fişeği çıkarır; **Sigara** can yeniler; **Kelepçe** rakibin turunu atlar; **El Testeresi** dolu fişeği 2 hasara çıkarır.
- **Telefon** rastgele bir fişeği bildirir; **Çevirici** sıradaki fişeği tersine çevirir; **Adrenalin** ekipman çalar; **Eski İlaç** şansa bağlı can kazandırır veya kaybettirir.
- Bir tur 30 saniyedir. Süre dolarsa sunucu otomatik hedef seçer.

## Karakterler ve pasifler

| Karakter | Pasif | Etki |
| --- | --- | --- |
| Denizci | Tuzlu Kan | Bira kullandığında 1 can yeniler. |
| Tanık | Önsezi | Her yeni haznenin ilk fişeğini yükleme anında görür. |
| Konak | Derin Cepler | Ekipman sınırı 4 yerine 5’tir. |
| Âlim | Yasak Bilgi | Her haznede kullandığı ilk büyüteç tükenmez. |
| Günahkâr | Kefaret | Maça 4 canla başlar ve 4 cana kadar iyileşebilir. |
| Boşluk | Hiçlik Perdesi | Her haznede aldığı ilk dolu fişek hasarını 1 azaltır. |

Aynı karakter birden fazla oyuncu tarafından seçilebilir. Her oyuncunun modeli ve pasifi bağımsız uygulanır.

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

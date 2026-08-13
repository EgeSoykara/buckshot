export const CHARACTER_RULES = Object.freeze({
  mariner: Object.freeze({
    name: "DENİZCİ",
    english: "THE MARINER",
    passive: "TUZLU KAN",
    short: "BİRA +1 CAN",
    description: "Bira kullandığında 1 can yenilersin.",
    maxHealth: 3,
    itemLimit: 4
  }),
  witness: Object.freeze({
    name: "TANIK",
    english: "THE WITNESS",
    passive: "ÖNSEZİ",
    short: "İLK FİŞEĞİ GÖR",
    description: "Her yeni haznenin ilk fişeğini yükleme anında görürsün.",
    maxHealth: 3,
    itemLimit: 4
  }),
  host: Object.freeze({
    name: "KONAK",
    english: "THE HOST",
    passive: "DERİN CEPLER",
    short: "5 EŞYA",
    description: "Toplam 5 ekipman taşıyabilirsin.",
    maxHealth: 3,
    itemLimit: 5
  }),
  scholar: Object.freeze({
    name: "ÂLİM",
    english: "THE SCHOLAR",
    passive: "YASAK BİLGİ",
    short: "ÜCRETSİZ BAKIŞ",
    description: "Her haznedeki ilk büyüteç kullanımın ekipmanı tüketmez.",
    maxHealth: 3,
    itemLimit: 4
  }),
  penitent: Object.freeze({
    name: "GÜNAHKÂR",
    english: "THE PENITENT",
    passive: "KEFARET",
    short: "4 CAN",
    description: "Maça 4 canla başlar ve 4 cana kadar iyileşirsin.",
    maxHealth: 4,
    itemLimit: 4
  }),
  hollow: Object.freeze({
    name: "BOŞLUK",
    english: "THE HOLLOW",
    passive: "HİÇLİK PERDESİ",
    short: "-1 HASAR",
    description: "Her haznede aldığın ilk dolu fişek hasarı 1 azalır.",
    maxHealth: 3,
    itemLimit: 4
  })
});

export const CHARACTER_IDS = Object.freeze(Object.keys(CHARACTER_RULES));

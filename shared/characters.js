export const CHARACTER_RULES = Object.freeze({
  mariner: Object.freeze({
    name: "DENİZCİ",
    english: "THE MARINER",
    passive: "TUZLU KAN",
    short: "BİRA +1 CAN",
    mark: "+",
    color: "#d7ff3f",
    description: "Bira kullandığında 1 can yenilersin.",
    maxHealth: 3,
    itemLimit: 4
  }),
  witness: Object.freeze({
    name: "TANIK",
    english: "THE WITNESS",
    passive: "ÖNSEZİ",
    short: "İLK FİŞEĞİ GÖR",
    mark: "◉",
    color: "#79c8ef",
    description: "Her yeni haznenin ilk fişeğini yükleme anında görürsün.",
    maxHealth: 3,
    itemLimit: 4
  }),
  host: Object.freeze({
    name: "KONAK",
    english: "THE HOST",
    passive: "DERİN CEPLER",
    short: "5 EŞYA",
    mark: "▦",
    color: "#c6df5a",
    description: "Toplam 5 ekipman taşıyabilirsin.",
    maxHealth: 3,
    itemLimit: 5
  }),
  scholar: Object.freeze({
    name: "ÂLİM",
    english: "THE SCHOLAR",
    passive: "YASAK BİLGİ",
    short: "ÜCRETSİZ BAKIŞ",
    mark: "◇",
    color: "#d88adc",
    description: "Her haznedeki ilk büyüteç kullanımın ekipmanı tüketmez.",
    maxHealth: 3,
    itemLimit: 4
  }),
  penitent: Object.freeze({
    name: "GÜNAHKÂR",
    english: "THE PENITENT",
    passive: "KEFARET",
    short: "4 CAN",
    mark: "♥",
    color: "#e1a94b",
    description: "Maça 4 canla başlar ve 4 cana kadar iyileşirsin.",
    maxHealth: 4,
    itemLimit: 4
  }),
  hollow: Object.freeze({
    name: "BOŞLUK",
    english: "THE HOLLOW",
    passive: "HİÇLİK PERDESİ",
    short: "-1 HASAR",
    mark: "◌",
    color: "#68d8c0",
    description: "Her haznede aldığın ilk dolu fişek hasarı 1 azalır.",
    maxHealth: 3,
    itemLimit: 4
  })
});

export const CHARACTER_IDS = Object.freeze(Object.keys(CHARACTER_RULES));

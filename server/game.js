import crypto from "node:crypto";
import { CHARACTER_IDS, CHARACTER_RULES } from "../shared/characters.js";

export const MAX_PLAYERS = 6;
export const TURN_DURATION_MS = 30_000;
export const ROUND_LOAD_DURATION_MS = 6_000;
export { CHARACTER_IDS, CHARACTER_RULES };

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ITEM_POOL = [
  "magnifier",
  "beer",
  "cigarettes",
  "handcuffs",
  "handsaw",
  "phone",
  "inverter",
  "adrenaline",
  "medicine"
];
const ITEM_LABELS = {
  magnifier: "büyüteç",
  beer: "bira",
  cigarettes: "sigara",
  handcuffs: "kelepçe",
  handsaw: "el testeresi",
  phone: "telefon",
  inverter: "çevirici",
  adrenaline: "adrenalin",
  medicine: "eski ilaç"
};

export function makeCode(existing = new Set()) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let code = "";
    for (let i = 0; i < 5; i += 1) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
    if (!existing.has(code)) return code;
  }
  throw new Error("Oda kodu üretilemedi.");
}

export function cleanName(value) {
  return String(value ?? "")
    .replace(/[<>\n\r]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 18);
}

export function cleanCharacter(value) {
  const character = String(value ?? "").trim().toLowerCase();
  if (!Object.hasOwn(CHARACTER_RULES, character)) throw new Error("Geçerli bir karakter seçmelisin.");
  return character;
}

export function shuffle(values, random = Math.random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function makeMagazine(round = 1, random = Math.random) {
  const size = Math.min(8, 5 + round);
  const live = Math.max(2, Math.min(size - 2, Math.ceil(size / 2)));
  return shuffle([...Array(live).fill("live"), ...Array(size - live).fill("blank")], random);
}

function makeToken() {
  return crypto.randomBytes(18).toString("base64url");
}

function playerView(player) {
  const rules = CHARACTER_RULES[player.character];
  return {
    id: player.id,
    name: player.name,
    character: player.character,
    characterName: rules.name,
    passiveName: rules.passive,
    health: player.health,
    maxHealth: rules.maxHealth,
    itemLimit: rules.itemLimit,
    alive: player.alive,
    connected: player.connected,
    ready: player.ready,
    items: [...player.items],
    sawed: player.sawed,
    skipTurns: player.skipTurns
  };
}

export class GameRoom {
  constructor(code, hostSocketId, hostName, hostCharacter, now = Date.now()) {
    this.code = code;
    this.phase = "lobby";
    this.hostId = hostSocketId;
    this.players = [];
    this.round = 0;
    this.magazine = [];
    this.roundLoadout = { live: 0, blank: 0, total: 0 };
    this.roundReadyAt = null;
    this.currentPlayerId = null;
    this.aimTargetId = null;
    this.turnDeadline = null;
    this.lastAction = "Oda kuruldu. Rakiplerini bekliyorsun.";
    this.updatedAt = now;
    this.winnerId = null;
    this.addPlayer(hostSocketId, hostName, hostCharacter, now);
  }

  addPlayer(socketId, rawName, rawCharacter, now = Date.now()) {
    if (this.phase !== "lobby") throw new Error("Oyun başladı; yeni oyuncu alınmıyor.");
    if (this.players.length >= MAX_PLAYERS) throw new Error("Bu oda dolu.");
    const name = cleanName(rawName);
    const character = cleanCharacter(rawCharacter);
    if (!name) throw new Error("Bir oyuncu adı yazmalısın.");
    if (this.players.some((player) => player.name.toLocaleLowerCase("tr") === name.toLocaleLowerCase("tr"))) {
      throw new Error("Bu isim odada zaten kullanılıyor.");
    }

    const player = {
      id: socketId,
      token: makeToken(),
      name,
      character,
      health: CHARACTER_RULES[character].maxHealth,
      alive: true,
      connected: true,
      ready: false,
      items: [],
      sawed: false,
      skipTurns: 0,
      scholarFreeRound: 0,
      hollowWardRound: 0,
      vision: null,
      disconnectedAt: null
    };
    this.players.push(player);
    const host = this.player(this.hostId);
    if (!this.hostId || !host?.connected) this.hostId = player.id;
    this.updatedAt = now;
    this.lastAction = `${name} masaya oturdu.`;
    return player;
  }

  reconnect(socketId, token, now = Date.now()) {
    const player = this.players.find((candidate) => candidate.token === token);
    if (!player) throw new Error("Eski oturum bulunamadı.");
    const oldId = player.id;
    player.id = socketId;
    player.connected = true;
    player.disconnectedAt = null;
    if (this.hostId === oldId) this.hostId = socketId;
    if (this.currentPlayerId === oldId) this.currentPlayerId = socketId;
    if (this.aimTargetId === oldId) this.aimTargetId = socketId;
    if (this.winnerId === oldId) this.winnerId = socketId;
    this.updatedAt = now;
    this.lastAction = `${player.name} yeniden bağlandı.`;
    return player;
  }

  start(socketId, now = Date.now()) {
    if (socketId !== this.hostId) throw new Error("Oyunu yalnızca oda sahibi başlatabilir.");
    if (this.phase !== "lobby" && this.phase !== "finished") throw new Error("Oyun zaten başladı.");
    this.players = this.players.filter((player) => player.connected);
    if (this.players.length < 2) throw new Error("Başlamak için en az 2 oyuncu gerekli.");

    this.phase = "playing";
    this.round = 0;
    this.winnerId = null;
    this.aimTargetId = null;
    for (const player of this.players) {
      player.health = CHARACTER_RULES[player.character].maxHealth;
      player.alive = true;
      player.items = [];
      player.sawed = false;
      player.skipTurns = 0;
      player.scholarFreeRound = 0;
      player.hollowWardRound = 0;
      player.vision = null;
    }
    this.loadRound(now);
    this.currentPlayerId = this.alivePlayers()[0].id;
    this.turnDeadline = this.roundReadyAt + TURN_DURATION_MS;
    this.lastAction = "İlk hazne yüklendi. Masa sessizleşti.";
  }

  loadRound(now = Date.now()) {
    this.round += 1;
    this.magazine = makeMagazine(this.round);
    const live = this.magazine.filter((shell) => shell === "live").length;
    this.roundLoadout = { live, blank: this.magazine.length - live, total: this.magazine.length };
    this.roundReadyAt = now + ROUND_LOAD_DURATION_MS;
    for (const player of this.alivePlayers()) {
      const itemLimit = CHARACTER_RULES[player.character].itemLimit;
      while (player.items.length < itemLimit && player.items.length < this.round + 1) {
        player.items.push(ITEM_POOL[crypto.randomInt(ITEM_POOL.length)]);
      }
      player.vision = player.character === "witness"
        ? { round: this.round, shell: this.magazine[0] }
        : null;
    }
    this.updatedAt = now;
  }

  alivePlayers() {
    return this.players.filter((player) => player.alive);
  }

  player(socketId) {
    return this.players.find((player) => player.id === socketId);
  }

  nextAlive(fromId, includeSkipped = true) {
    const start = Math.max(0, this.players.findIndex((player) => player.id === fromId));
    for (let offset = 1; offset <= this.players.length; offset += 1) {
      const candidate = this.players[(start + offset) % this.players.length];
      if (!candidate.alive) continue;
      if (includeSkipped && candidate.skipTurns > 0) {
        candidate.skipTurns -= 1;
        this.lastAction += ` ${candidate.name} kelepçeli olduğu için pas geçildi.`;
        continue;
      }
      return candidate;
    }
    return this.player(fromId)?.alive ? this.player(fromId) : null;
  }

  assertTurn(socketId) {
    if (this.phase !== "playing") throw new Error("Oyun şu anda aktif değil.");
    if (this.currentPlayerId !== socketId) throw new Error("Henüz senin sıran değil.");
    const actor = this.player(socketId);
    if (!actor?.alive) throw new Error("Bu turda elendin.");
    return actor;
  }

  aim(socketId, targetId, now = Date.now()) {
    const actor = this.assertTurn(socketId);
    const target = this.player(targetId);
    if (!target?.alive) throw new Error("Geçerli bir hedef seç.");
    this.aimTargetId = target.id;
    this.updatedAt = now;
    return { actorId: actor.id, targetId: target.id };
  }

  shoot(socketId, targetId, now = Date.now()) {
    const actor = this.assertTurn(socketId);
    const target = this.player(targetId);
    if (!target?.alive) throw new Error("Geçerli bir hedef seç.");
    const shell = this.magazine.shift();
    if (!shell) throw new Error("Hazne boş.");
    const selfShot = actor.id === target.id;
    let damaged = false;
    let damage = actor.sawed ? 2 : 1;
    let warded = false;

    if (shell === "live") {
      actor.sawed = false;
      if (target.character === "hollow" && target.hollowWardRound !== this.round) {
        target.hollowWardRound = this.round;
        damage = Math.max(0, damage - 1);
        warded = true;
      }
      target.health -= damage;
      damaged = damage > 0;
      if (target.health <= 0) {
        target.health = 0;
        target.alive = false;
      }
    }

    if (shell === "blank") {
      this.lastAction = selfShot
        ? `${actor.name} silahı kendine çevirdi: BOŞ. Sıra onda kalıyor.`
        : `${actor.name}, ${target.name} için tetiği çekti: BOŞ.`;
    } else {
      const wardMessage = warded ? " Hiçlik Perdesi hasarı 1 azalttı." : "";
      this.lastAction = `${actor.name} ateş etti: DOLU! ${target.name} ${target.alive ? `${damage} can kaybetti.` : "elendi."}${wardMessage}`;
    }

    this.aimTargetId = null;
    const alive = this.alivePlayers();
    if (alive.length === 1) {
      this.phase = "finished";
      this.winnerId = alive[0].id;
      this.currentPlayerId = null;
      this.turnDeadline = null;
      this.lastAction = `${alive[0].name} masadan sağ çıktı.`;
    } else {
      if (this.magazine.length === 0) this.loadRound(now);
      if (!(selfShot && shell === "blank") || !actor.alive) this.advanceTurn(actor.id);
      this.turnDeadline = Math.max(now, this.roundReadyAt ?? now) + TURN_DURATION_MS;
    }
    this.updatedAt = now;
    return { shell, selfShot, damaged, warded, damage: shell === "live" ? damage : 0, actorId: actor.id, targetId: target.id };
  }

  advanceTurn(fromId = this.currentPlayerId) {
    const candidate = this.nextAlive(fromId, true);
    if (candidate) this.currentPlayerId = candidate.id;
    this.aimTargetId = null;
    return candidate;
  }

  useItem(socketId, item, now = Date.now()) {
    const actor = this.assertTurn(socketId);
    const index = actor.items.indexOf(item);
    if (index < 0) throw new Error("Bu ekipmana sahip değilsin.");
    let privateMessage = null;
    let consumeItem = true;
    let loadNextRoundAfterConsumption = false;
    const maxHealth = CHARACTER_RULES[actor.character].maxHealth;

    if (item === "cigarettes") {
      if (actor.health >= maxHealth) throw new Error("Canın zaten tam.");
      actor.health += 1;
      this.lastAction = `${actor.name} bir sigara yaktı ve 1 can yeniledi.`;
    } else if (item === "magnifier") {
      privateMessage = this.magazine[0] === "live" ? "Sıradaki fişek DOLU." : "Sıradaki fişek BOŞ.";
      if (actor.character === "scholar" && actor.scholarFreeRound !== this.round) {
        actor.scholarFreeRound = this.round;
        consumeItem = false;
        privateMessage += " Yasak Bilgi büyüteci bu haznede bir kez korudu.";
      }
      this.lastAction = `${actor.name} büyüteçle hazneyi kontrol etti.`;
    } else if (item === "beer") {
      const removed = this.magazine.shift();
      if (!removed) throw new Error("Hazne zaten boş.");
      privateMessage = removed === "live" ? "Dolu fişeği çıkardın." : "Boş fişeği çıkardın.";
      if (actor.character === "mariner" && actor.health < maxHealth) {
        actor.health += 1;
        privateMessage += " Tuzlu Kan 1 can yeniledi.";
      }
      this.lastAction = `${actor.name} pompalıyı birayla zorlayıp fişeği çıkardı.`;
      loadNextRoundAfterConsumption = this.magazine.length === 0;
    } else if (item === "handcuffs") {
      const target = this.nextAlive(actor.id, false);
      if (!target || target.id === actor.id) throw new Error("Kelepçelenecek rakip yok.");
      target.skipTurns += 1;
      this.lastAction = `${actor.name}, ${target.name} oyuncusunu kelepçeledi.`;
    } else if (item === "handsaw") {
      if (actor.sawed) throw new Error("Namlu zaten kesilmiş durumda.");
      actor.sawed = true;
      this.lastAction = `${actor.name} pompalının namlusunu kısalttı. Sonraki dolu fişek 2 hasar verecek.`;
    } else if (item === "phone") {
      if (!this.magazine.length) throw new Error("Hazne boş.");
      const position = crypto.randomInt(this.magazine.length);
      privateMessage = `${position + 1}. fişek ${this.magazine[position] === "live" ? "DOLU" : "BOŞ"}.`;
      this.lastAction = `${actor.name} gizemli telefondan bir ipucu aldı.`;
    } else if (item === "inverter") {
      if (!this.magazine.length) throw new Error("Hazne boş.");
      this.magazine[0] = this.magazine[0] === "live" ? "blank" : "live";
      privateMessage = "Sıradaki fişeğin durumu tersine çevrildi.";
      this.lastAction = `${actor.name} kutupları tersine çevirdi.`;
    } else if (item === "adrenaline") {
      const victims = this.alivePlayers().filter((player) => player.id !== actor.id && player.items.length);
      if (!victims.length) {
        privateMessage = "Rakiplerde çalınabilecek ekipman yok. Adrenalin sende kaldı.";
        this.lastAction = `${actor.name} adrenalinle hamle yaptı ama çalınabilecek ekipman bulamadı.`;
        this.updatedAt = now;
        return { privateMessage, used: false };
      }
      const victim = victims[crypto.randomInt(victims.length)];
      const stolenIndex = crypto.randomInt(victim.items.length);
      const [stolen] = victim.items.splice(stolenIndex, 1);
      actor.items.push(stolen);
      privateMessage = `${victim.name} oyuncusundan ${ITEM_LABELS[stolen] ?? stolen} çaldın.`;
      this.lastAction = `${actor.name} adrenalinle bir rakibin ekipmanını kaptı.`;
    } else if (item === "medicine") {
      if (crypto.randomInt(2) === 0) {
        actor.health = Math.min(maxHealth, actor.health + 2);
        privateMessage = "İlaç işe yaradı: 2 can kazandın.";
      } else {
        actor.health = Math.max(1, actor.health - 1);
        privateMessage = "İlaç ters tepti: 1 can kaybettin.";
      }
      this.lastAction = `${actor.name} tarihi geçmiş ilacı kullandı.`;
    } else {
      throw new Error("Bilinmeyen ekipman.");
    }

    if (consumeItem) actor.items.splice(index, 1);
    if (loadNextRoundAfterConsumption) {
      this.loadRound(now);
      this.turnDeadline = this.roundReadyAt + TURN_DURATION_MS;
    }
    this.updatedAt = now;
    return { privateMessage, used: true, consumed: consumeItem };
  }

  disconnect(socketId, now = Date.now()) {
    const player = this.player(socketId);
    if (!player) return false;
    player.connected = false;
    player.disconnectedAt = now;
    if (this.hostId === socketId) {
      const successor = this.players.find((candidate) => candidate.id !== socketId && candidate.connected);
      if (successor) this.hostId = successor.id;
    }
    this.updatedAt = now;
    const newHost = this.player(this.hostId);
    this.lastAction = newHost && newHost.id !== socketId
      ? `${player.name} bağlantıyı kaybetti. Oda sahipliği ${newHost.name} oyuncusuna geçti.`
      : `${player.name} bağlantıyı kaybetti; geri dönmesi bekleniyor.`;
    return true;
  }

  removeDisconnectedLobbyPlayers(now = Date.now(), graceMs = 30_000) {
    if (this.phase !== "lobby") return;
    this.players = this.players.filter((player) => player.connected || now - player.disconnectedAt < graceMs);
    if (!this.player(this.hostId)?.connected) this.hostId = this.players.find((player) => player.connected)?.id ?? null;
  }

  publicState(viewerId, now = Date.now()) {
    const viewer = this.player(viewerId);
    const liveCount = this.magazine.filter((shell) => shell === "live").length;
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      players: this.players.map(playerView),
      round: this.round,
      roundLoadout: { ...this.roundLoadout },
      roundReadyInMs: this.roundReadyAt ? Math.max(0, this.roundReadyAt - now) : 0,
      shellsRemaining: this.magazine.length,
      liveRemaining: liveCount,
      blankRemaining: this.magazine.length - liveCount,
      currentPlayerId: this.currentPlayerId,
      aimTargetId: this.aimTargetId,
      turnRemainingMs: this.turnDeadline
        ? Math.max(0, this.turnDeadline - Math.max(now, this.roundReadyAt ?? now))
        : 0,
      lastAction: this.lastAction,
      winnerId: this.winnerId,
      viewerId,
      viewerToken: viewer?.token ?? null,
      characterInsight: viewer?.character === "witness" && viewer.vision?.round === this.round
        ? {
            round: viewer.vision.round,
            message: `Önsezi: Bu hazne yüklenirken ilk fişek ${viewer.vision.shell === "live" ? "DOLUYDU" : "BOŞTU"}.`
          }
        : null
    };
  }
}

export class RoomStore {
  constructor() {
    this.rooms = new Map();
  }

  create(socketId, name, character) {
    const code = makeCode(new Set(this.rooms.keys()));
    const room = new GameRoom(code, socketId, name, character);
    this.rooms.set(code, room);
    return room;
  }

  get(rawCode) {
    return this.rooms.get(String(rawCode ?? "").trim().toUpperCase());
  }

  findBySocket(socketId) {
    return [...this.rooms.values()].find((room) => room.player(socketId));
  }

  cleanup(now = Date.now()) {
    for (const [code, room] of this.rooms) {
      room.removeDisconnectedLobbyPlayers(now);
      const allGone = room.players.every((player) => !player.connected);
      if ((allGone && now - room.updatedAt > 15 * 60_000) || now - room.updatedAt > 4 * 60 * 60_000) {
        this.rooms.delete(code);
      }
    }
  }
}

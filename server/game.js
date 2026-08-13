import crypto from "node:crypto";

export const MAX_PLAYERS = 6;
export const STARTING_HEALTH = 3;
export const TURN_DURATION_MS = 30_000;

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
  return {
    id: player.id,
    name: player.name,
    health: player.health,
    alive: player.alive,
    connected: player.connected,
    ready: player.ready,
    items: [...player.items],
    sawed: player.sawed,
    skipTurns: player.skipTurns
  };
}

export class GameRoom {
  constructor(code, hostSocketId, hostName, now = Date.now()) {
    this.code = code;
    this.phase = "lobby";
    this.hostId = hostSocketId;
    this.players = [];
    this.round = 0;
    this.magazine = [];
    this.currentPlayerId = null;
    this.turnDeadline = null;
    this.lastAction = "Oda kuruldu. Rakiplerini bekliyorsun.";
    this.updatedAt = now;
    this.winnerId = null;
    this.addPlayer(hostSocketId, hostName, now);
  }

  addPlayer(socketId, rawName, now = Date.now()) {
    if (this.phase !== "lobby") throw new Error("Oyun başladı; yeni oyuncu alınmıyor.");
    if (this.players.length >= MAX_PLAYERS) throw new Error("Bu oda dolu.");
    const name = cleanName(rawName);
    if (!name) throw new Error("Bir oyuncu adı yazmalısın.");
    if (this.players.some((player) => player.name.toLocaleLowerCase("tr") === name.toLocaleLowerCase("tr"))) {
      throw new Error("Bu isim odada zaten kullanılıyor.");
    }

    const player = {
      id: socketId,
      token: makeToken(),
      name,
      health: STARTING_HEALTH,
      alive: true,
      connected: true,
      ready: false,
      items: [],
      sawed: false,
      skipTurns: 0,
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
    for (const player of this.players) {
      player.health = STARTING_HEALTH;
      player.alive = true;
      player.items = [];
      player.sawed = false;
      player.skipTurns = 0;
    }
    this.loadRound(now);
    this.currentPlayerId = this.alivePlayers()[0].id;
    this.turnDeadline = now + TURN_DURATION_MS;
    this.lastAction = "İlk hazne yüklendi. Masa sessizleşti.";
  }

  loadRound(now = Date.now()) {
    this.round += 1;
    this.magazine = makeMagazine(this.round);
    for (const player of this.alivePlayers()) {
      while (player.items.length < 4 && player.items.length < this.round + 1) {
        player.items.push(ITEM_POOL[crypto.randomInt(ITEM_POOL.length)]);
      }
      player.sawed = false;
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

  shoot(socketId, targetId, now = Date.now()) {
    const actor = this.assertTurn(socketId);
    const target = this.player(targetId);
    if (!target?.alive) throw new Error("Geçerli bir hedef seç.");
    const shell = this.magazine.shift();
    if (!shell) throw new Error("Hazne boş.");
    const selfShot = actor.id === target.id;
    let damaged = false;
    const damage = actor.sawed ? 2 : 1;
    actor.sawed = false;

    if (shell === "live") {
      target.health -= damage;
      damaged = true;
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
      this.lastAction = `${actor.name} ateş etti: DOLU! ${target.name} ${target.alive ? `${damage} can kaybetti.` : "elendi."}`;
    }

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
      this.turnDeadline = now + TURN_DURATION_MS;
    }
    this.updatedAt = now;
    return { shell, selfShot, damaged, damage: shell === "live" ? damage : 0, actorId: actor.id, targetId: target.id };
  }

  advanceTurn(fromId = this.currentPlayerId) {
    const candidate = this.nextAlive(fromId, true);
    if (candidate) this.currentPlayerId = candidate.id;
    return candidate;
  }

  useItem(socketId, item, now = Date.now()) {
    const actor = this.assertTurn(socketId);
    const index = actor.items.indexOf(item);
    if (index < 0) throw new Error("Bu ekipmana sahip değilsin.");
    let privateMessage = null;

    if (item === "cigarettes") {
      if (actor.health >= STARTING_HEALTH) throw new Error("Canın zaten tam.");
      actor.health += 1;
      this.lastAction = `${actor.name} bir sigara yaktı ve 1 can yeniledi.`;
    } else if (item === "magnifier") {
      privateMessage = this.magazine[0] === "live" ? "Sıradaki fişek DOLU." : "Sıradaki fişek BOŞ.";
      this.lastAction = `${actor.name} büyüteçle hazneyi kontrol etti.`;
    } else if (item === "beer") {
      const removed = this.magazine.shift();
      if (!removed) throw new Error("Hazne zaten boş.");
      privateMessage = removed === "live" ? "Dolu fişeği çıkardın." : "Boş fişeği çıkardın.";
      this.lastAction = `${actor.name} pompalıyı birayla zorlayıp fişeği çıkardı.`;
      if (this.magazine.length === 0) this.loadRound(now);
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
      if (!victims.length) throw new Error("Çalınabilecek ekipman yok.");
      const victim = victims[crypto.randomInt(victims.length)];
      const stolenIndex = crypto.randomInt(victim.items.length);
      const [stolen] = victim.items.splice(stolenIndex, 1);
      actor.items.push(stolen);
      privateMessage = `${victim.name} oyuncusundan ${ITEM_LABELS[stolen] ?? stolen} çaldın.`;
      this.lastAction = `${actor.name} adrenalinle bir rakibin ekipmanını kaptı.`;
    } else if (item === "medicine") {
      if (crypto.randomInt(2) === 0) {
        actor.health = Math.min(STARTING_HEALTH, actor.health + 2);
        privateMessage = "İlaç işe yaradı: 2 can kazandın.";
      } else {
        actor.health = Math.max(1, actor.health - 1);
        privateMessage = "İlaç ters tepti: 1 can kaybettin.";
      }
      this.lastAction = `${actor.name} tarihi geçmiş ilacı kullandı.`;
    } else {
      throw new Error("Bilinmeyen ekipman.");
    }

    actor.items.splice(index, 1);
    this.updatedAt = now;
    return { privateMessage };
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
      shellsRemaining: this.magazine.length,
      liveRemaining: liveCount,
      blankRemaining: this.magazine.length - liveCount,
      currentPlayerId: this.currentPlayerId,
      turnRemainingMs: this.turnDeadline ? Math.max(0, this.turnDeadline - now) : 0,
      lastAction: this.lastAction,
      winnerId: this.winnerId,
      viewerId,
      viewerToken: viewer?.token ?? null
    };
  }
}

export class RoomStore {
  constructor() {
    this.rooms = new Map();
  }

  create(socketId, name) {
    const code = makeCode(new Set(this.rooms.keys()));
    const room = new GameRoom(code, socketId, name);
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

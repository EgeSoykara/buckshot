import test from "node:test";
import assert from "node:assert/strict";
import { cleanName, GameRoom, makeMagazine, MAX_PLAYERS, RoomStore, STARTING_HEALTH } from "../server/game.js";

test("oyuncu adları temizlenir ve sınırlandırılır", () => {
  assert.equal(cleanName("  <Ege>\n  Soykara "), "Ege Soykara");
  assert.equal(cleanName("abcdefghijklmnopqrstu"), "abcdefghijklmnopqr");
});

test("haznede hem dolu hem boş fişek bulunur", () => {
  for (let round = 1; round <= 6; round += 1) {
    const magazine = makeMagazine(round, () => .42);
    assert.ok(magazine.includes("live"));
    assert.ok(magazine.includes("blank"));
    assert.ok(magazine.length >= 6 && magazine.length <= 8);
  }
});

test("oda en fazla altı oyuncu alır ve oyunu yalnızca ev sahibi başlatır", () => {
  const room = new GameRoom("ABCDE", "p1", "Bir");
  for (let i = 2; i <= MAX_PLAYERS; i += 1) room.addPlayer(`p${i}`, `Oyuncu ${i}`);
  assert.throws(() => room.addPlayer("p7", "Yedi"), /dolu/);
  assert.throws(() => room.start("p2"), /oda sahibi/);
  room.start("p1", 1000);
  assert.equal(room.phase, "playing");
  assert.equal(room.currentPlayerId, "p1");
  assert.equal(room.players.every((player) => player.health === STARTING_HEALTH), true);
});

test("kendine gelen boş fişek sırayı korur; rakibe ateş sıra geçirir", () => {
  const room = new GameRoom("ABCDE", "p1", "Bir");
  room.addPlayer("p2", "İki");
  room.start("p1", 1000);
  room.magazine = ["blank", "blank", "live"];

  const selfResult = room.shoot("p1", "p1", 2000);
  assert.equal(selfResult.shell, "blank");
  assert.equal(room.currentPlayerId, "p1");

  room.shoot("p1", "p2", 3000);
  assert.equal(room.currentPlayerId, "p2");
});

test("canı biten oyuncu elenir ve son kalan kazanır", () => {
  const room = new GameRoom("ABCDE", "p1", "Bir");
  room.addPlayer("p2", "İki");
  room.start("p1", 1000);
  room.player("p2").health = 1;
  room.magazine = ["live"];

  room.shoot("p1", "p2", 2000);
  assert.equal(room.phase, "finished");
  assert.equal(room.winnerId, "p1");
  assert.equal(room.player("p2").alive, false);
});

test("masa ekipmanları fişekleri, canı, hasarı ve sırayı değiştirir", () => {
  const room = new GameRoom("ABCDE", "p1", "Bir");
  room.addPlayer("p2", "İki");
  room.addPlayer("p3", "Üç");
  room.start("p1", 1000);
  const actor = room.player("p1");
  actor.health = 2;
  actor.items = ["magnifier", "inverter", "beer", "cigarettes", "handcuffs", "handsaw"];
  room.magazine = ["live", "blank", "live"];

  assert.match(room.useItem("p1", "magnifier", 1100).privateMessage, /DOLU/);
  room.useItem("p1", "inverter", 1200);
  assert.equal(room.magazine[0], "blank");
  assert.match(room.useItem("p1", "beer", 1300).privateMessage, /Boş/);
  room.useItem("p1", "cigarettes", 1400);
  assert.equal(actor.health, STARTING_HEALTH);
  room.useItem("p1", "handcuffs", 1500);
  assert.equal(room.player("p2").skipTurns, 1);
  room.useItem("p1", "handsaw", 1600);
  assert.equal(actor.sawed, true);

  room.magazine = ["live", "blank"];
  const shot = room.shoot("p1", "p3", 2000);
  assert.equal(shot.damage, 2);
  assert.equal(room.player("p3").health, 1);
  assert.equal(actor.sawed, false);
  assert.equal(room.player("p2").skipTurns, 0);
  assert.equal(room.currentPlayerId, "p3");
  assert.deepEqual(actor.items, []);
});

test("telefon bilgi verir ve adrenalin rakip ekipmanı çalar", () => {
  const room = new GameRoom("ABCDE", "p1", "Bir");
  room.addPlayer("p2", "İki");
  room.start("p1", 1000);
  room.magazine = ["blank", "live", "blank"];
  room.player("p1").items = ["phone", "adrenaline"];
  room.player("p2").items = ["handsaw"];

  assert.match(room.useItem("p1", "phone", 1200).privateMessage, /fişek/);
  room.useItem("p1", "adrenaline", 1300);
  assert.deepEqual(room.player("p1").items, ["handsaw"]);
  assert.deepEqual(room.player("p2").items, []);
});

test("çalınacak ekipman yoksa adrenalin korunur ve oyun durumu bozulmaz", () => {
  const room = new GameRoom("ABCDE", "p1", "Bir");
  room.addPlayer("p2", "İki");
  room.start("p1", 1000);
  room.player("p1").items = ["adrenaline"];
  room.player("p2").items = [];

  assert.throws(() => room.useItem("p1", "adrenaline", 1200), /Çalınabilecek ekipman yok/);
  assert.deepEqual(room.player("p1").items, ["adrenaline"]);
  assert.equal(room.currentPlayerId, "p1");
  assert.equal(room.phase, "playing");
});

test("oturum anahtarıyla yeniden bağlanma kimliği ve sırayı taşır", () => {
  const room = new RoomStore().create("old-socket", "Bir");
  room.addPlayer("p2", "İki");
  room.start("old-socket", 1000);
  const token = room.player("old-socket").token;
  room.disconnect("old-socket", 1500);
  room.reconnect("new-socket", token, 2000);
  assert.equal(room.hostId, "p2");
  assert.equal(room.currentPlayerId, "new-socket");
  assert.equal(room.player("new-socket").connected, true);
});

test("oda sahibi koparsa bağlı oyuncu sahipliği devralır", () => {
  const room = new GameRoom("ABCDE", "p1", "Bir");
  room.addPlayer("p2", "İki");
  room.addPlayer("p3", "Üç");
  room.disconnect("p1", 1000);
  assert.equal(room.hostId, "p2");
  room.start("p2", 2000);
  assert.equal(room.phase, "playing");
  assert.deepEqual(room.players.map((player) => player.id), ["p2", "p3"]);
});

test("altı oyunculu maç son oyuncu kalana kadar tamamlanır", () => {
  const room = new GameRoom("ABCDE", "p1", "Bir");
  for (let i = 2; i <= 6; i += 1) room.addPlayer(`p${i}`, `Oyuncu ${i}`);
  room.start("p1", 1000);

  const eliminate = (shooter, target, now) => {
    room.player(target).health = 1;
    room.magazine = ["live", "blank"];
    room.shoot(shooter, target, now);
  };
  eliminate("p1", "p2", 2000);
  eliminate("p3", "p4", 3000);
  eliminate("p5", "p6", 4000);
  eliminate("p1", "p3", 5000);
  eliminate("p5", "p1", 6000);

  assert.equal(room.phase, "finished");
  assert.equal(room.winnerId, "p5");
  assert.deepEqual(room.alivePlayers().map((player) => player.id), ["p5"]);
});

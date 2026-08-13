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

test("ekipmanlar tüketilir ve kalkan tek dolu fişeği durdurur", () => {
  const room = new GameRoom("ABCDE", "p1", "Bir");
  room.addPlayer("p2", "İki");
  room.start("p1", 1000);
  room.player("p1").items = ["shield"];
  room.useItem("p1", "shield", 1500);
  assert.equal(room.player("p1").shielded, true);
  assert.deepEqual(room.player("p1").items, []);

  room.magazine = ["live", "blank"];
  const shot = room.shoot("p1", "p1", 2000);
  assert.equal(shot.blocked, true);
  assert.equal(room.player("p1").health, STARTING_HEALTH);
  assert.equal(room.player("p1").shielded, false);
});

test("oturum anahtarıyla yeniden bağlanma kimliği ve sırayı taşır", () => {
  const room = new RoomStore().create("old-socket", "Bir");
  room.addPlayer("p2", "İki");
  room.start("old-socket", 1000);
  const token = room.player("old-socket").token;
  room.disconnect("old-socket", 1500);
  room.reconnect("new-socket", token, 2000);
  assert.equal(room.hostId, "new-socket");
  assert.equal(room.currentPlayerId, "new-socket");
  assert.equal(room.player("new-socket").connected, true);
});

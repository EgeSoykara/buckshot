import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveAimTarget } from "../shared/aiming.js";
import { FIRST_PERSON_CAMERA_HEIGHT, FIRST_PERSON_CAMERA_RADIUS, SEAT_RADIUS, firstPersonViewForPlayer, minimumGunTrayClearance, minimumItemSlotClearance, playerSeatAngle } from "../shared/table-layout.js";
import {
  CHARACTER_RULES,
  cleanCharacter,
  cleanName,
  GameRoom,
  makeMagazine,
  MAX_PLAYERS,
  ROUND_LOAD_DURATION_MS,
  RoomStore,
} from "../server/game.js";

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

test("Blender varlık seti geçerli GLB içerir ve tüm oynanabilir modelleri tanımlar", () => {
  const asset = readFileSync(new URL("../public/assets/last-chamber-kit.glb", import.meta.url));
  const buildSource = readFileSync(new URL("../blender/build_lovecraft_asset_kit.py", import.meta.url), "utf8");
  assert.equal(asset.subarray(0, 4).toString(), "glTF");
  assert.ok(asset.byteLength > 1_000_000);
  const jsonChunkLength = asset.readUInt32LE(12);
  const json = JSON.parse(asset.subarray(20, 20 + jsonChunkLength).toString("utf8").trim());
  const roots = json.scenes[json.scene].nodes.map((nodeIndex) => json.nodes[nodeIndex]);
  const extras = roots.map((node) => node.extras ?? {});
  assert.equal(extras.filter((data) => data.asset_kind === "shotgun").length, 1);
  assert.deepEqual(extras.filter((data) => data.asset_kind === "character").map((data) => data.character_id).sort(), Object.keys(CHARACTER_RULES).sort());
  assert.deepEqual(extras.filter((data) => data.asset_kind === "item").map((data) => data.item_type).sort(), ["magnifier", "beer", "cigarettes", "handcuffs", "handsaw", "phone", "inverter", "adrenaline", "medicine"].sort());
  const nodeRoles = new Set(json.nodes.map((node) => node.extras?.lc_role).filter(Boolean));
  for (const role of ["body", "head", "leftArm", "rightArm", "leftHand", "rightHand", "barrelAssembly", "pump", "bolt", "muzzle", "leftGrip", "rightGrip"]) assert.ok(nodeRoles.has(role), `GLB rolü eksik: ${role}`);
  assert.equal(json.materials.filter((material) => material.pbrMetallicRoughness?.baseColorTexture).length, json.materials.length);
  assert.equal(json.materials.filter((material) => material.pbrMetallicRoughness?.metallicRoughnessTexture).length, json.materials.length);
  assert.equal(json.materials.filter((material) => material.normalTexture).length, json.materials.length);
  assert.ok(json.images.length >= json.materials.length * 3);
  for (const character of Object.keys(CHARACTER_RULES)) assert.match(buildSource, new RegExp(`"${character}"`));
  for (const item of ["magnifier", "beer", "cigarettes", "handcuffs", "handsaw", "phone", "inverter", "adrenaline", "medicine"]) {
    assert.match(buildSource, new RegExp(`item_root\\("${item}"\\)`));
  }
});

test("raund başında dolu ve boş fişek sayımı yayınlanır; tur saati yükleme sonrasında başlar", () => {
  const room = new GameRoom("ABCDE", "p1", "Bir", "mariner");
  room.addPlayer("p2", "İki", "host");
  room.start("p1", 1000);

  const loadingState = room.publicState("p2", 1500);
  assert.equal(loadingState.roundLoadout.live + loadingState.roundLoadout.blank, loadingState.roundLoadout.total);
  assert.equal(loadingState.roundLoadout.total, room.magazine.length);
  assert.equal(loadingState.roundReadyInMs, ROUND_LOAD_DURATION_MS - 500);
  assert.equal(loadingState.turnRemainingMs, 30_000);

  const readyState = room.publicState("p2", 1000 + ROUND_LOAD_DURATION_MS);
  assert.equal(readyState.roundReadyInMs, 0);
  assert.equal(readyState.turnRemainingMs, 30_000);
});

test("karakter seçimi yalnızca tanımlı kimlikleri kabul eder", () => {
  assert.equal(cleanCharacter(" Scholar "), "scholar");
  assert.throws(() => cleanCharacter("dealer"), /Geçerli bir karakter/);
});

test("namlu kilidi sunucu hedefini, yerel seçimi ve atış hedefini doğru önceliklendirir", () => {
  assert.equal(resolveAimTarget({ shotTargetId: null, shotVisualUntil: 0, selectedTargetId: null, authoritativeTargetId: null, hoveredPlayerId: "p2" }, 1000), "p2");
  assert.equal(resolveAimTarget({ shotTargetId: null, shotVisualUntil: 0, selectedTargetId: null, authoritativeTargetId: "p3", hoveredPlayerId: "p2" }, 1000), "p3");
  assert.equal(resolveAimTarget({ shotTargetId: null, shotVisualUntil: 0, selectedTargetId: "p1", authoritativeTargetId: "p3", hoveredPlayerId: "p2" }, 1000), "p1");
  assert.equal(resolveAimTarget({ shotTargetId: "p4", shotVisualUntil: 2000, selectedTargetId: "p1", authoritativeTargetId: "p3", hoveredPlayerId: "p2" }, 1000), "p4");
  assert.equal(resolveAimTarget({ shotTargetId: "p4", shotVisualUntil: 2000, selectedTargetId: "p1", authoritativeTargetId: "p3", hoveredPlayerId: "p2" }, 2000), "p1");
});

test("hedef kilidi bütün oyunculara görünür ve atıştan sonra temizlenir", () => {
  const room = new GameRoom("ABCDE", "p1", "Bir", "mariner");
  room.addPlayer("p2", "İki", "host");
  room.start("p1", 1000);
  room.magazine = ["blank", "live"];

  const aim = room.aim("p1", "p2", 1500);
  assert.deepEqual(aim, { actorId: "p1", targetId: "p2" });
  assert.equal(room.publicState("p1", 1500).aimTargetId, "p2");
  assert.equal(room.publicState("p2", 1500).aimTargetId, "p2");
  assert.throws(() => room.aim("p2", "p1", 1600), /sıran değil/i);

  room.shoot("p1", "p2", 2000);
  assert.equal(room.aimTargetId, null);
  assert.equal(room.currentPlayerId, "p2");
});

test("oda en fazla altı oyuncu alır ve oyunu yalnızca ev sahibi başlatır", () => {
  const room = new GameRoom("ABCDE", "p1", "Bir", "mariner");
  const characters = ["witness", "host", "scholar", "hollow", "mariner"];
  for (let i = 2; i <= MAX_PLAYERS; i += 1) room.addPlayer(`p${i}`, `Oyuncu ${i}`, characters[i - 2]);
  assert.throws(() => room.addPlayer("p7", "Yedi", "penitent"), /dolu/);
  assert.throws(() => room.start("p2"), /oda sahibi/);
  room.start("p1", 1000);
  assert.equal(room.phase, "playing");
  assert.equal(room.currentPlayerId, "p1");
  assert.equal(room.players.every((player) => player.health === CHARACTER_RULES[player.character].maxHealth), true);
});

test("kendine gelen boş fişek sırayı korur; rakibe ateş sıra geçirir", () => {
  const room = new GameRoom("ABCDE", "p1", "Bir", "mariner");
  room.addPlayer("p2", "İki", "host");
  room.start("p1", 1000);
  room.magazine = ["blank", "blank", "live"];

  const selfResult = room.shoot("p1", "p1", 2000);
  assert.equal(selfResult.shell, "blank");
  assert.equal(room.currentPlayerId, "p1");

  room.shoot("p1", "p2", 3000);
  assert.equal(room.currentPlayerId, "p2");
});

test("canı biten oyuncu elenir ve son kalan kazanır", () => {
  const room = new GameRoom("ABCDE", "p1", "Bir", "mariner");
  room.addPlayer("p2", "İki", "host");
  room.start("p1", 1000);
  room.player("p2").health = 1;
  room.magazine = ["live"];

  const shot = room.shoot("p1", "p2", 2000);
  assert.equal(room.phase, "finished");
  assert.equal(room.winnerId, "p1");
  assert.equal(room.player("p2").alive, false);
  assert.equal(shot.killed, true);
});

test("ölüm olayı yalnızca son canı bitiren atışta yayınlanır", () => {
  const room = new GameRoom("ABCDE", "p1", "Bir", "mariner");
  room.addPlayer("p2", "İki", "host");
  room.start("p1", 1000);
  room.magazine = ["live", "live", "blank"];

  const firstShot = room.shoot("p1", "p2", 2000);
  assert.equal(firstShot.killed, false);
  room.currentPlayerId = "p1";
  room.player("p2").health = 1;
  const finalShot = room.shoot("p1", "p2", 3000);
  assert.equal(finalShot.killed, true);
});

test("eşya tepsileri altı hedef hattının dışında güvenli boşlukta kalır", () => {
  assert.ok(minimumGunTrayClearance() > .3);
});

test("masa eşyalarının yuvaları birbirine girmeyecek açıklıkta kalır", () => {
  assert.ok(minimumItemSlotClearance() > .09);
});

test("iki oyuncu karşılıklı oturur ve FPS kameraları masaya bakar", () => {
  const angleDifference = Math.abs(playerSeatAngle(0, 2) - playerSeatAngle(1, 2));
  assert.ok(Math.abs(angleDifference - Math.PI) < Number.EPSILON);
  for (const playerIndex of [0, 1]) {
    const view = firstPersonViewForPlayer(playerIndex, 2);
    const inwardDot = view.position.x * (view.target.x - view.position.x) + view.position.z * (view.target.z - view.position.z);
    assert.ok(inwardDot < 0);
  }
  assert.ok(FIRST_PERSON_CAMERA_RADIUS - SEAT_RADIUS >= 1.5);
  assert.ok(FIRST_PERSON_CAMERA_HEIGHT >= 1.6);
});

test("masa ekipmanları fişekleri, canı, hasarı ve sırayı değiştirir", () => {
  const room = new GameRoom("ABCDE", "p1", "Bir", "mariner");
  room.addPlayer("p2", "İki", "witness");
  room.addPlayer("p3", "Üç", "host");
  room.start("p1", 1000);
  const actor = room.player("p1");
  actor.health = 2;
  actor.items = ["magnifier", "inverter", "beer", "cigarettes", "handcuffs", "handsaw"];
  room.magazine = ["live", "blank", "live"];

  assert.match(room.useItem("p1", "magnifier", 1100).privateMessage, /DOLU/);
  room.useItem("p1", "inverter", 1200);
  assert.equal(room.magazine[0], "blank");
  const beerResult = room.useItem("p1", "beer", 1300);
  assert.match(beerResult.privateMessage, /Boş.*Tuzlu Kan/);
  assert.equal(beerResult.animationShell, "blank");
  assert.equal(actor.health, CHARACTER_RULES.mariner.maxHealth);
  actor.health = 2;
  room.useItem("p1", "cigarettes", 1400);
  assert.equal(actor.health, CHARACTER_RULES.mariner.maxHealth);
  const cuffsResult = room.useItem("p1", "handcuffs", 1500);
  assert.equal(cuffsResult.animationTargetId, "p2");
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
  const room = new GameRoom("ABCDE", "p1", "Bir", "mariner");
  room.addPlayer("p2", "İki", "host");
  room.start("p1", 1000);
  room.magazine = ["blank", "live", "blank"];
  room.player("p1").items = ["phone", "adrenaline"];
  room.player("p2").items = ["handsaw"];

  assert.match(room.useItem("p1", "phone", 1200).privateMessage, /fişek/);
  const adrenalineResult = room.useItem("p1", "adrenaline", 1300);
  assert.equal(adrenalineResult.animationTargetId, "p2");
  assert.deepEqual(room.player("p1").items, ["handsaw"]);
  assert.deepEqual(room.player("p2").items, []);
});

test("çalınacak ekipman yoksa adrenalin korunur ve oyun durumu bozulmaz", () => {
  const room = new GameRoom("ABCDE", "p1", "Bir", "mariner");
  room.addPlayer("p2", "İki", "host");
  room.start("p1", 1000);
  room.player("p1").items = ["adrenaline"];
  room.player("p2").items = [];

  const result = room.useItem("p1", "adrenaline", 1200);
  assert.equal(result.used, false);
  assert.match(result.privateMessage, /Adrenalin sende kaldı/);
  assert.deepEqual(room.player("p1").items, ["adrenaline"]);
  assert.equal(room.currentPlayerId, "p1");
  assert.equal(room.phase, "playing");
});

test("bira son fişeği çıkarınca yeni hazne ekipmanı tüketimden sonra tamamlanır", () => {
  const room = new GameRoom("ABCDE", "p1", "Bir", "mariner");
  room.addPlayer("p2", "İki", "host");
  room.start("p1", 1000);
  room.player("p1").items = ["beer"];
  room.magazine = ["blank"];

  room.useItem("p1", "beer", 1200);

  assert.equal(room.round, 2);
  assert.equal(room.player("p1").items.length, 3);
});

test("el testeresi boş fişekte korunur ve sonraki dolu fişekte iki hasar verir", () => {
  const room = new GameRoom("ABCDE", "p1", "Bir", "mariner");
  room.addPlayer("p2", "İki", "host");
  room.start("p1", 1000);
  room.player("p1").items = ["handsaw"];
  room.magazine = ["blank", "live", "blank"];

  room.useItem("p1", "handsaw", 1100);
  room.shoot("p1", "p1", 1200);
  assert.equal(room.player("p1").sawed, true);
  const liveShot = room.shoot("p1", "p2", 1300);
  assert.equal(liveShot.damage, 2);
  assert.equal(room.player("p1").sawed, false);
});

test("el testeresi son boş fişekten sonra yeni haznedeki dolu fişeğe taşınır", () => {
  const room = new GameRoom("ABCDE", "p1", "Bir", "mariner");
  room.addPlayer("p2", "İki", "host");
  room.start("p1", 1000);
  room.player("p1").items = ["handsaw"];
  room.magazine = ["blank"];

  room.useItem("p1", "handsaw", 1100);
  room.shoot("p1", "p1", 1200);
  assert.equal(room.round, 2);
  assert.equal(room.player("p1").sawed, true);

  room.magazine = ["live", "blank"];
  const liveShot = room.shoot("p1", "p2", 1300);
  assert.equal(liveShot.damage, 2);
  assert.equal(room.player("p1").sawed, false);
});

test("oturum anahtarıyla yeniden bağlanma kimliği ve sırayı taşır", () => {
  const room = new RoomStore().create("old-socket", "Bir", "scholar");
  room.addPlayer("p2", "İki", "host");
  room.start("old-socket", 1000);
  const token = room.player("old-socket").token;
  room.disconnect("old-socket", 1500);
  room.reconnect("new-socket", token, 2000);
  assert.equal(room.hostId, "p2");
  assert.equal(room.currentPlayerId, "new-socket");
  assert.equal(room.player("new-socket").connected, true);
  assert.equal(room.player("new-socket").character, "scholar");
});

test("oda sahibi koparsa bağlı oyuncu sahipliği devralır", () => {
  const room = new GameRoom("ABCDE", "p1", "Bir", "mariner");
  room.addPlayer("p2", "İki", "host");
  room.addPlayer("p3", "Üç", "witness");
  room.disconnect("p1", 1000);
  assert.equal(room.hostId, "p2");
  room.start("p2", 2000);
  assert.equal(room.phase, "playing");
  assert.deepEqual(room.players.map((player) => player.id), ["p2", "p3"]);
});

test("altı oyunculu maç son oyuncu kalana kadar tamamlanır", () => {
  const room = new GameRoom("ABCDE", "p1", "Bir", "mariner");
  for (let i = 2; i <= 6; i += 1) room.addPlayer(`p${i}`, `Oyuncu ${i}`, i % 2 ? "host" : "witness");
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

test("altı karakterin pasifleri sunucu durumunu ve oyun kurallarını değiştirir", () => {
  const room = new GameRoom("ABCDE", "mariner", "Denizci", "mariner");
  room.addPlayer("witness", "Tanık", "witness");
  room.addPlayer("host", "Konak", "host");
  room.addPlayer("scholar", "Âlim", "scholar");
  room.addPlayer("penitent", "Günahkâr", "penitent");
  room.addPlayer("hollow", "Boşluk", "hollow");
  room.start("mariner", 1000);

  const publicPlayers = room.publicState("witness", 1100).players;
  assert.equal(publicPlayers.find((player) => player.id === "penitent").maxHealth, 4);
  assert.equal(room.player("penitent").health, 4);
  assert.match(room.publicState("witness", 1100).characterInsight.message, /ilk fişek/);

  room.round = 4;
  room.player("host").items = [];
  room.loadRound(1200);
  assert.equal(room.player("host").items.length, CHARACTER_RULES.host.itemLimit);

  room.currentPlayerId = "scholar";
  room.player("scholar").items = ["magnifier"];
  room.magazine = ["live", "blank"];
  const freeLook = room.useItem("scholar", "magnifier", 1300);
  assert.equal(freeLook.consumed, false);
  assert.deepEqual(room.player("scholar").items, ["magnifier"]);
  room.useItem("scholar", "magnifier", 1400);
  assert.deepEqual(room.player("scholar").items, []);

  room.currentPlayerId = "hollow";
  room.player("hollow").health = 3;
  room.player("hollow").hollowWardRound = 0;
  room.magazine = ["live", "live", "blank"];
  const firstHit = room.shoot("hollow", "hollow", 1500);
  assert.equal(firstHit.warded, true);
  assert.equal(firstHit.damage, 0);
  assert.equal(room.player("hollow").health, 3);
  room.currentPlayerId = "hollow";
  const secondHit = room.shoot("hollow", "hollow", 1600);
  assert.equal(secondHit.warded, false);
  assert.equal(secondHit.damage, 1);
  assert.equal(room.player("hollow").health, 2);
});

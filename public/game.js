import * as THREE from "/vendor/three/three.module.js";

const $ = (selector) => document.querySelector(selector);
const socket = window.io({ transports: ["websocket", "polling"] });
const ui = {
  home: $("#home-screen"), room: $("#room-screen"), connection: $("#connection"),
  name: $("#player-name"), code: $("#room-code"), create: $("#create-button"), join: $("#join-button"),
  roomCode: $("#room-code-label"), copyCode: $("#copy-code"), share: $("#share-button"),
  playerCount: $("#player-count"), playerList: $("#player-list"), lobby: $("#lobby-panel"),
  start: $("#start-button"), hostHint: $("#host-hint"), gameHud: $("#game-hud"),
  ammo: $("#ammo-readout"), live: $("#live-count"), blank: $("#blank-count"), round: $("#round-label"),
  turnKicker: $("#turn-kicker"), turnTitle: $("#turn-title"), lastAction: $("#last-action"),
  targetList: $("#target-list"), itemList: $("#item-list"), timerBar: $("#timer-bar"), timerText: $("#timer-text"),
  winner: $("#winner-panel"), winnerName: $("#winner-name"), restart: $("#restart-button"), restartHint: $("#restart-hint"),
  toast: $("#toast"), secret: $("#secret-toast"), secretMessage: $("#secret-message"), flash: $("#flash"), sound: $("#sound-toggle")
};
ui.rules = $("#rules-dialog");
ui.rulesButton = $("#rules-button");
ui.rulesClose = $("#rules-close");
ui.reticle = $("#aim-reticle");
ui.turnAnnouncer = $("#turn-announcer");
ui.turnAnnouncerName = $("#turn-announcer-name");

const itemInfo = {
  magnifier: { name: "BÜYÜTEÇ", mark: "◉", description: "Sıradaki fişeği gizlice gör." },
  beer: { name: "BİRA", mark: "▰", description: "Sıradaki fişeği ateşlemeden çıkar." },
  cigarettes: { name: "SİGARA", mark: "═", description: "Bir can yenile." },
  handcuffs: { name: "KELEPÇE", mark: "∞", description: "Sıradaki rakibin turunu atla." },
  handsaw: { name: "EL TESTERESİ", mark: "╱", description: "Sonraki dolu fişeği 2 hasara çıkar." },
  phone: { name: "TELEFON", mark: "▯", description: "Rastgele bir fişeğin yerini öğren." },
  inverter: { name: "ÇEVİRİCİ", mark: "⇄", description: "Sıradaki fişeği dolu/boş tersine çevir." },
  adrenaline: { name: "ADRENALİN", mark: "✦", description: "Rakipten rastgele ekipman çal." },
  medicine: { name: "ESKİ İLAÇ", mark: "+", description: "Şansa göre 2 can kazan veya 1 kaybet." }
};
let state = null;
let turnEndAt = 0;
let toastTimer;
let secretTimer;
let soundEnabled = true;
let audioContext;
let hoveredPlayerId = null;
let previousCurrentPlayerId = null;

const savedName = localStorage.getItem("last-chamber-name");
if (savedName) ui.name.value = savedName;
const queryCode = new URLSearchParams(location.search).get("room");
if (queryCode) ui.code.value = queryCode.toUpperCase().slice(0, 5);

function showToast(message, error = false) {
  clearTimeout(toastTimer);
  ui.toast.textContent = message;
  ui.toast.classList.toggle("error", error);
  ui.toast.classList.add("show");
  toastTimer = setTimeout(() => ui.toast.classList.remove("show"), 2800);
}

function saveName() {
  const name = ui.name.value.trim();
  if (!name) {
    showToast("Önce oyuncu adını yaz.", true);
    ui.name.focus();
    return null;
  }
  localStorage.setItem("last-chamber-name", name);
  return name;
}

function sessionKey(code) { return `last-chamber-session-${code}`; }

function joinRoom() {
  const name = saveName();
  const code = ui.code.value.trim().toUpperCase();
  if (!name) return;
  if (code.length !== 5) return showToast("5 haneli oda kodunu yaz.", true);
  socket.emit("room:join", { code, name });
}

ui.create.addEventListener("click", () => {
  const name = saveName();
  if (name) socket.emit("room:create", { name });
});
ui.join.addEventListener("click", joinRoom);
ui.code.addEventListener("keydown", (event) => { if (event.key === "Enter") joinRoom(); });
ui.code.addEventListener("input", () => { ui.code.value = ui.code.value.toUpperCase().replace(/[^A-Z2-9]/g, ""); });
ui.start.addEventListener("click", () => socket.emit("game:start"));
ui.restart.addEventListener("click", () => socket.emit("game:start"));

async function shareRoom() {
  if (!state) return;
  const url = `${location.origin}${location.pathname}?room=${state.code}`;
  try {
    if (navigator.share && matchMedia("(max-width: 700px)").matches) {
      await navigator.share({ title: "Last Chamber", text: `Odaya katıl — Kod: ${state.code}`, url });
    } else {
      await navigator.clipboard.writeText(url);
      showToast("Davet bağlantısı kopyalandı.");
    }
  } catch (error) {
    if (error?.name !== "AbortError") showToast(`Oda kodu: ${state.code}`);
  }
}
ui.copyCode.addEventListener("click", shareRoom);
ui.share.addEventListener("click", shareRoom);

ui.sound.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  ui.sound.textContent = soundEnabled ? "◉" : "○";
  showToast(soundEnabled ? "Ses açıldı." : "Ses kapatıldı.");
});
ui.rulesButton.addEventListener("click", () => ui.rules.showModal());
ui.rulesClose.addEventListener("click", () => ui.rules.close());
ui.rules.addEventListener("click", (event) => {
  if (event.target === ui.rules) ui.rules.close();
});

socket.on("connect", () => {
  ui.connection.className = "connection online";
  ui.connection.querySelector("span").textContent = "ÇEVRİM İÇİ";
  const reconnectCode = state?.code || queryCode;
  if (reconnectCode) {
    const saved = JSON.parse(localStorage.getItem(sessionKey(reconnectCode)) || "null");
    if (saved?.playerToken) socket.emit("room:reconnect", saved);
  }
});
socket.on("disconnect", () => {
  ui.connection.className = "connection offline";
  ui.connection.querySelector("span").textContent = "BAĞLANTI KESİLDİ";
});
socket.on("session", (session) => {
  localStorage.setItem(sessionKey(session.roomCode), JSON.stringify(session));
  history.replaceState({}, "", `?room=${session.roomCode}`);
});
socket.on("session:expired", ({ message }) => {
  const expiredCode = state?.code || queryCode;
  if (expiredCode) localStorage.removeItem(sessionKey(expiredCode));
  state = null;
  ui.room.classList.add("hidden");
  ui.home.classList.remove("hidden");
  history.replaceState({}, "", location.pathname);
  showToast(message || "Eski oda artık açık değil. Yeni bir oda kurabilirsin.", true);
});
socket.on("game:error", ({ message }) => showToast(message, true));
socket.on("room:state", (nextState) => {
  state = nextState;
  turnEndAt = Date.now() + nextState.turnRemainingMs;
  ui.home.classList.add("hidden");
  ui.room.classList.remove("hidden");
  renderState();
  sceneMode(nextState.phase);
});
socket.on("game:secret", ({ message }) => {
  clearTimeout(secretTimer);
  ui.secretMessage.textContent = message;
  ui.secret.classList.remove("hidden");
  playTone(420, .12, "sine");
  secretTimer = setTimeout(() => ui.secret.classList.add("hidden"), 4000);
});
socket.on("game:shot", (result) => animateShot(result));
socket.on("game:item-used", (result) => animateItem(result));

function renderState() {
  const me = state.players.find((player) => player.id === state.viewerId);
  const isHost = state.hostId === state.viewerId;
  ui.roomCode.textContent = state.code;
  ui.playerCount.textContent = `${state.players.length}/6`;
  ui.playerList.innerHTML = state.players.map((player, index) => {
    const hearts = Array.from({ length: 3 }, (_, heart) => `<i class="heart ${heart >= player.health ? "empty" : ""}"></i>`).join("");
    const flags = [player.id === state.hostId ? "ODA SAHİBİ" : "", !player.connected ? "KOPTU" : "", player.skipTurns ? "KELEPÇELİ" : "", player.sawed ? "KESİK NAMLU" : "", player.items.length ? `${player.items.length} EKİPMAN` : ""].filter(Boolean).join(" · ");
    return `<div class="player-card ${player.id === state.currentPlayerId ? "current" : ""} ${!player.alive ? "dead" : ""} ${!player.connected ? "disconnected" : ""}">
      <span class="player-index">${String(index + 1).padStart(2, "0")}</span>
      <div class="player-meta"><b>${escapeHtml(player.name)}${player.id === state.viewerId ? " · SEN" : ""}</b><span>${flags || (player.alive ? "MASADA" : "ELENDİ")}</span></div>
      <div class="hearts">${hearts}</div>
    </div>`;
  }).join("");

  ui.lobby.classList.toggle("hidden", state.phase !== "lobby");
  ui.gameHud.classList.toggle("hidden", state.phase !== "playing");
  ui.winner.classList.toggle("hidden", state.phase !== "finished");
  ui.ammo.classList.toggle("hidden", state.phase === "lobby");
  ui.start.classList.toggle("hidden", !isHost);
  ui.hostHint.classList.toggle("hidden", isHost);
  ui.restart.classList.toggle("hidden", !isHost);
  ui.restartHint.classList.toggle("hidden", isHost);
  ui.start.disabled = state.players.length < 2 || state.players.some((player) => !player.connected);

  if (state.phase === "playing") {
    const current = state.players.find((player) => player.id === state.currentPlayerId);
    const myTurn = state.currentPlayerId === state.viewerId;
    ui.live.textContent = state.liveRemaining;
    ui.blank.textContent = state.blankRemaining;
    ui.round.textContent = `HAZNE ${state.round}`;
    ui.turnKicker.textContent = myTurn ? "SIRA SENDE" : `${current?.name ?? "—"} OYNUYOR`;
    ui.turnTitle.textContent = myTurn ? "HEDEFİNİ SEÇ" : "MASAYI İZLE";
    ui.lastAction.textContent = state.lastAction;
    if (state.currentPlayerId && state.currentPlayerId !== previousCurrentPlayerId) announceTurn(current?.name ?? "—");
    previousCurrentPlayerId = state.currentPlayerId;
    ui.targetList.innerHTML = state.players.filter((player) => player.alive).map((player) =>
      `<button class="target-button ${player.id === state.viewerId ? "self" : ""}" data-target="${player.id}" ${myTurn ? "" : "disabled"}>${player.id === state.viewerId ? "KENDİNE" : escapeHtml(player.name)}</button>`
    ).join("");
    ui.targetList.querySelectorAll("button").forEach((button) => {
      button.addEventListener("pointerenter", () => setHoveredTarget(button.dataset.target));
      button.addEventListener("pointerleave", () => setHoveredTarget(null));
      button.addEventListener("focus", () => setHoveredTarget(button.dataset.target));
      button.addEventListener("blur", () => setHoveredTarget(null));
      button.addEventListener("click", () => {
        setHoveredTarget(null);
        socket.emit("game:shoot", { targetId: button.dataset.target });
        disableActions();
      });
    });
    ui.itemList.innerHTML = (me?.items ?? []).map((item) => {
      const info = itemInfo[item] ?? { name: item, mark: "·", description: item };
      return `<button class="item-button" data-item="${item}" title="${info.description}" ${myTurn ? "" : "disabled"}><i>${info.mark}</i><span>${info.name}</span></button>`;
    }).join("") || "<span class='micro'>EKİPMAN YOK</span>";
    ui.itemList.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
      socket.emit("game:item", { item: button.dataset.item });
      disableActions();
    }));
  } else if (state.phase === "finished") {
    previousCurrentPlayerId = null;
    const winner = state.players.find((player) => player.id === state.winnerId);
    ui.winnerName.textContent = winner?.name ?? "KAZANAN";
  }
  syncSeats(state.players);
  syncItemProps(me?.items ?? []);
}

function announceTurn(name) {
  ui.turnAnnouncerName.textContent = name;
  ui.turnAnnouncer.classList.remove("hidden");
  ui.turnAnnouncer.style.animation = "none";
  void ui.turnAnnouncer.offsetWidth;
  ui.turnAnnouncer.style.animation = "";
  setTimeout(() => ui.turnAnnouncer.classList.add("hidden"), 1800);
}

function disableActions() {
  ui.targetList.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  ui.itemList.querySelectorAll("button").forEach((button) => { button.disabled = true; });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

setInterval(() => {
  if (!state || state.phase !== "playing") return;
  const remaining = Math.max(0, turnEndAt - Date.now());
  ui.timerText.textContent = Math.ceil(remaining / 1000);
  ui.timerBar.style.width = `${Math.min(100, (remaining / 30_000) * 100)}%`;
}, 200);

// Procedural Three.js table. No external art assets are used.
const renderer = new THREE.WebGLRenderer({ canvas: $("#scene"), antialias: true, alpha: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080807);
scene.fog = new THREE.FogExp2(0x080807, 0.042);
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, .1, 100);
camera.position.set(8.6, 7.1, 10.8);
camera.lookAt(0, -.2, 0);

scene.add(new THREE.HemisphereLight(0x786e5b, 0x080807, .55));
const keyLight = new THREE.SpotLight(0xffdca0, 95, 32, Math.PI / 5, .65, 1.4);
keyLight.position.set(-3, 10, 4);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
scene.add(keyLight);
const redLight = new THREE.PointLight(0xa82413, 18, 15, 2);
redLight.position.set(5, 2, -4);
scene.add(redLight);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x11100e, roughness: .95 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -2.65;
floor.receiveShadow = true;
scene.add(floor);

const backWall = new THREE.Mesh(new THREE.PlaneGeometry(30, 14), new THREE.MeshStandardMaterial({ color: 0x151411, roughness: 1 }));
backWall.position.set(0, 3.5, -9);
backWall.receiveShadow = true;
scene.add(backWall);
for (let x = -12; x <= 12; x += 4) {
  const beam = new THREE.Mesh(new THREE.BoxGeometry(.18, 12, .28), new THREE.MeshStandardMaterial({ color: 0x292621, roughness: .75, metalness: .35 }));
  beam.position.set(x, 2.8, -8.8);
  scene.add(beam);
}
const lampShade = new THREE.Mesh(new THREE.CylinderGeometry(.28, 1.35, .9, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0x161614, roughness: .38, metalness: .75, side: THREE.DoubleSide }));
lampShade.position.set(-1.4, 6.8, .3);
scene.add(lampShade);
const lampBulb = new THREE.Mesh(new THREE.SphereGeometry(.32, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffdca0, emissive: 0xffb84f, emissiveIntensity: 5 }));
lampBulb.position.set(-1.4, 6.4, .3);
scene.add(lampBulb);

const monitor = new THREE.Group();
const monitorCase = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.55, .42), new THREE.MeshStandardMaterial({ color: 0x24241f, roughness: .52, metalness: .35 }));
const monitorScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.85, 1.05), new THREE.MeshStandardMaterial({ color: 0x233b27, emissive: 0x17351c, emissiveIntensity: 2.2, roughness: .35 }));
monitorScreen.position.z = -.23;
monitorCase.castShadow = true;
monitor.add(monitorCase, monitorScreen);
monitor.position.set(-6.2, 2.2, -8.45);
monitor.rotation.y = Math.PI;
scene.add(monitor);
const warningSprite = makeNameSprite("CHAMBER ACTIVE", "#d7ff3f");
warningSprite.scale.set(1.75, .44, 1);
warningSprite.position.set(-6.2, 2.2, -8.65);
scene.add(warningSprite);

const pipeMaterial = new THREE.MeshStandardMaterial({ color: 0x30302b, roughness: .5, metalness: .6 });
for (const x of [5.7, 6.35]) {
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(.13, .13, 7.5, 12), pipeMaterial);
  pipe.position.set(x, 2.1, -8.55);
  pipe.castShadow = true;
  scene.add(pipe);
}
const fan = new THREE.Group();
const fanHub = new THREE.Mesh(new THREE.CylinderGeometry(.18, .18, .5, 10), pipeMaterial);
fanHub.rotation.x = Math.PI / 2;
fan.add(fanHub);
for (let i = 0; i < 4; i += 1) {
  const blade = new THREE.Mesh(new THREE.BoxGeometry(2.5, .11, .38), new THREE.MeshStandardMaterial({ color: 0x1c1c19, roughness: .72, metalness: .28 }));
  blade.position.x = 1.1;
  blade.rotation.z = i * Math.PI / 2;
  fan.add(blade);
}
fan.position.set(2.8, 6.9, -1.6);
fan.rotation.x = Math.PI / 2;
scene.add(fan);

const table = new THREE.Group();
const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.7, .42, 10), new THREE.MeshStandardMaterial({ color: 0x2a2118, roughness: .72, metalness: .05 }));
tableTop.position.y = -1.1;
tableTop.castShadow = tableTop.receiveShadow = true;
table.add(tableTop);
const felt = new THREE.Mesh(new THREE.CylinderGeometry(4.8, 4.8, .055, 64), new THREE.MeshStandardMaterial({ color: 0x202922, roughness: .92 }));
felt.position.y = -.86;
felt.receiveShadow = true;
table.add(felt);
const tableRim = new THREE.Mesh(new THREE.TorusGeometry(5.08, .17, 10, 10), new THREE.MeshStandardMaterial({ color: 0x4b3422, roughness: .58, metalness: .08 }));
tableRim.rotation.x = Math.PI / 2;
tableRim.position.y = -.78;
tableRim.castShadow = true;
table.add(tableRim);
for (let i = 0; i < 4; i += 1) {
  const leg = new THREE.Mesh(new THREE.BoxGeometry(.42, 2, .42), new THREE.MeshStandardMaterial({ color: 0x17120d, roughness: .8 }));
  leg.position.set(Math.cos(i * Math.PI / 2 + .7) * 3.5, -1.8, Math.sin(i * Math.PI / 2 + .7) * 3.5);
  leg.castShadow = true;
  table.add(leg);
}
scene.add(table);

const gun = new THREE.Group();
const darkMetal = new THREE.MeshStandardMaterial({ color: 0x252725, roughness: .3, metalness: .8 });
const wornMetal = new THREE.MeshStandardMaterial({ color: 0x5b5a51, roughness: .38, metalness: .65 });
const wood = new THREE.MeshStandardMaterial({ color: 0x4a2416, roughness: .55, metalness: .05 });
const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.22, .27, 5.2, 14), darkMetal);
barrel.rotation.z = Math.PI / 2;
barrel.position.x = -.3;
barrel.castShadow = true;
gun.add(barrel);
const pump = new THREE.Mesh(new THREE.CylinderGeometry(.39, .39, 1.35, 12), wood);
pump.rotation.z = Math.PI / 2;
pump.position.set(.55, -.02, 0);
pump.castShadow = true;
gun.add(pump);
const muzzle = new THREE.Mesh(new THREE.TorusGeometry(.225, .06, 8, 18), wornMetal);
muzzle.rotation.y = Math.PI / 2;
muzzle.position.x = 2.3;
gun.add(muzzle);
const receiver = new THREE.Mesh(new THREE.BoxGeometry(1.5, .75, .68), wornMetal);
receiver.position.set(-1.75, -.05, 0);
receiver.castShadow = true;
gun.add(receiver);
const stock = new THREE.Mesh(new THREE.BoxGeometry(2.5, .64, .78), wood);
stock.position.set(-3.55, -.18, 0);
stock.rotation.z = -.1;
stock.castShadow = true;
gun.add(stock);
const grip = new THREE.Mesh(new THREE.BoxGeometry(.55, 1.35, .62), wood);
grip.position.set(-2.05, -.8, 0);
grip.rotation.z = -.28;
grip.castShadow = true;
gun.add(grip);
const triggerGuard = new THREE.Mesh(new THREE.TorusGeometry(.31, .055, 8, 14, Math.PI * 1.4), darkMetal);
triggerGuard.rotation.set(Math.PI / 2, 0, -.55);
triggerGuard.position.set(-1.55, -.56, 0);
gun.add(triggerGuard);
const muzzleLight = new THREE.PointLight(0xffb14a, 0, 6, 2);
muzzleLight.position.set(2.55, 0, 0);
gun.add(muzzleLight);
gun.position.set(0, -.2, 0);
gun.rotation.y = 0;
gun.rotation.z = .04;
scene.add(gun);

const shells = new THREE.Group();
const redShell = new THREE.MeshStandardMaterial({ color: 0x8c2116, roughness: .6 });
const brass = new THREE.MeshStandardMaterial({ color: 0xb38a42, roughness: .3, metalness: .7 });
for (let i = 0; i < 8; i += 1) {
  const shell = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.12, .12, .72, 12), redShell);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(.13, .13, .16, 12), brass);
  cap.position.y = -.43;
  shell.add(body, cap);
  shell.position.set(-1.4 + (i % 4) * .38, -.42, 1.55 + Math.floor(i / 4) * .4);
  shell.rotation.z = Math.PI / 2;
  shell.castShadow = true;
  shells.add(shell);
}
scene.add(shells);

function makeNameSprite(name, color = "#d7ff3f") {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(8,8,7,.88)";
  context.fillRect(8, 8, 496, 112);
  context.strokeStyle = color;
  context.lineWidth = 3;
  context.strokeRect(8, 8, 496, 112);
  context.fillStyle = "#f0ede5";
  context.font = "700 42px Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(name).slice(0, 18).toUpperCase(), 256, 64, 450);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(1.68, .42, 1);
  return sprite;
}

const seats = [];
const characterProfiles = [
  { coat: 0x7b2f25, shirt: 0x171411, skin: 0xa96f4e, hair: 0x1b1511, accent: 0xd7ff3f, head: [1, 1.08, .94], hat: "flat" },
  { coat: 0x29465b, shirt: 0xc6bda9, skin: 0x71452f, hair: 0x0d0c0b, accent: 0x79c8ef, head: [.92, 1.02, 1], hat: "glasses" },
  { coat: 0x4d5d2d, shirt: 0x252219, skin: 0xc18a68, hair: 0x312318, accent: 0xc6df5a, head: [1.05, .98, .92], hat: "beanie" },
  { coat: 0x5e315e, shirt: 0x171217, skin: 0x80533b, hair: 0x130f12, accent: 0xd88adc, head: [.9, 1.12, .92], hat: "patch" },
  { coat: 0x684620, shirt: 0x28231d, skin: 0xb77855, hair: 0x3c2517, accent: 0xe1a94b, head: [1.08, 1, .96], hat: "band" },
  { coat: 0x28594f, shirt: 0x131b1a, skin: 0x63402f, hair: 0x0e1110, accent: 0x68d8c0, head: [.95, 1.06, .94], hat: "hood" }
];

function makeCharacter(index) {
  const profile = characterProfiles[index];
  const seat = new THREE.Group();
  const chairMaterial = new THREE.MeshStandardMaterial({ color: 0x241c16, roughness: .8 });
  const clothing = new THREE.MeshStandardMaterial({ color: profile.coat, roughness: .86 });
  const shirt = new THREE.MeshStandardMaterial({ color: profile.shirt, roughness: .9 });
  const skin = new THREE.MeshStandardMaterial({ color: profile.skin, roughness: .87 });
  const hairMaterial = new THREE.MeshStandardMaterial({ color: profile.hair, roughness: .95 });
  const accentMaterial = new THREE.MeshStandardMaterial({ color: profile.accent, emissive: profile.accent, emissiveIntensity: .65, roughness: .55 });
  const black = new THREE.MeshStandardMaterial({ color: 0x0c0c0b, roughness: .65, metalness: .2 });
  const body = new THREE.Group();
  const headRig = new THREE.Group();
  const leftArm = new THREE.Group();
  const rightArm = new THREE.Group();
  const leftHand = new THREE.Group();
  const rightHand = new THREE.Group();
  const mesh = (geometry, material, parent, position = [0,0,0], rotation = [0,0,0], scale = [1,1,1]) => {
    const part = new THREE.Mesh(geometry, material);
    part.position.set(...position);
    part.rotation.set(...rotation);
    part.scale.set(...scale);
    part.castShadow = true;
    part.receiveShadow = true;
    parent.add(part);
    return part;
  };
  const chairBack = new THREE.Mesh(new THREE.BoxGeometry(1.45, 2.05, .22), chairMaterial);
  chairBack.position.set(0, .2, .48);
  const chairSeat = new THREE.Mesh(new THREE.BoxGeometry(1.55, .22, 1.45), chairMaterial);
  chairSeat.position.set(0, -.62, -.08);
  mesh(new THREE.CylinderGeometry(.42, .65, 1.42, 10), clothing, body, [0, .42, 0]);
  mesh(new THREE.BoxGeometry(.52, 1.12, .08), shirt, body, [0, .48, -.57]);
  mesh(new THREE.BoxGeometry(.07, .92, .07), accentMaterial, body, [0, .53, -.64], [0,0,-.03]);
  mesh(new THREE.SphereGeometry(.19, 12, 8), clothing, body, [-.57, .86, -.02]);
  mesh(new THREE.SphereGeometry(.19, 12, 8), clothing, body, [.57, .86, -.02]);
  mesh(new THREE.CylinderGeometry(.18, .2, .28, 10), skin, headRig, [0, 1.25, -.05]);
  const head = mesh(new THREE.SphereGeometry(.43, 20, 16), skin, headRig, [0, 1.68, -.08], [0,0,0], profile.head);
  mesh(new THREE.ConeGeometry(.09, .25, 10), skin, headRig, [0, 1.66, -.49], [Math.PI / 2, 0, 0]);
  mesh(new THREE.BoxGeometry(.28, .035, .025), black, headRig, [0, 1.48, -.48], [.05,0,0]);
  const eyeMaterial = new THREE.MeshStandardMaterial({ color: profile.accent, emissive: profile.accent, emissiveIntensity: 3 });
  for (const side of [-1, 1]) {
    mesh(new THREE.SphereGeometry(.038, 8, 6), eyeMaterial, headRig, [side * .15, 1.72, -.47]);
    mesh(new THREE.BoxGeometry(.19, .035, .035), hairMaterial, headRig, [side * .15, 1.84, -.46], [0,0,side * -.12]);
  }

  if (profile.hat === "flat") {
    mesh(new THREE.CylinderGeometry(.48, .46, .18, 12), hairMaterial, headRig, [0, 2.08, -.05]);
    mesh(new THREE.BoxGeometry(.62, .06, .36), hairMaterial, headRig, [0, 2.02, -.37]);
  } else if (profile.hat === "glasses") {
    for (const side of [-1,1]) mesh(new THREE.TorusGeometry(.14, .025, 8, 18), black, headRig, [side*.16, 1.72, -.49]);
    mesh(new THREE.BoxGeometry(.12, .025, .025), black, headRig, [0, 1.72, -.5]);
    mesh(new THREE.SphereGeometry(.445, 16, 8, 0, Math.PI*2, 0, Math.PI/2), hairMaterial, headRig, [0, 1.86, -.06]);
  } else if (profile.hat === "beanie") {
    mesh(new THREE.SphereGeometry(.47, 16, 10, 0, Math.PI*2, 0, Math.PI/2), clothing, headRig, [0, 1.9, -.05], [0,0,0], [1, .8, 1]);
    mesh(new THREE.TorusGeometry(.43, .06, 8, 20), clothing, headRig, [0, 1.93, -.05], [Math.PI/2,0,0]);
  } else if (profile.hat === "patch") {
    mesh(new THREE.BoxGeometry(.24, .14, .035), black, headRig, [.15, 1.72, -.51], [0,0,-.08]);
    mesh(new THREE.BoxGeometry(.72, .025, .02), black, headRig, [0, 1.79, -.5], [0,0,.12]);
    mesh(new THREE.SphereGeometry(.445, 16, 8, 0, Math.PI*2, 0, Math.PI/2), hairMaterial, headRig, [0, 1.86, -.06]);
  } else if (profile.hat === "band") {
    mesh(new THREE.SphereGeometry(.445, 16, 8, 0, Math.PI*2, 0, Math.PI/2), hairMaterial, headRig, [0, 1.86, -.06]);
    mesh(new THREE.BoxGeometry(.88, .11, .08), accentMaterial, headRig, [0, 1.91, -.37]);
  } else {
    mesh(new THREE.TorusGeometry(.48, .14, 8, 20, Math.PI*1.45), clothing, headRig, [0, 1.72, -.05], [0,0,.8]);
  }

  const setupArm = (side, armRig, handRig) => {
    armRig.position.set(side * .56, .84, -.02);
    mesh(new THREE.CylinderGeometry(.15, .18, .76, 10), clothing, armRig, [0, -.3, -.18], [Math.PI/3.2, 0, side*.12]);
    handRig.position.set(side * .68, .05, -.92);
    mesh(new THREE.CylinderGeometry(.12, .14, .62, 10), clothing, handRig, [0, .2, .18], [Math.PI/2.6,0,side*.12]);
    mesh(new THREE.SphereGeometry(.17, 12, 9), skin, handRig, [0, -.05, -.05], [0,0,0], [1.05,.72,1.2]);
    body.add(armRig, handRig);
  };
  setupArm(-1, leftArm, leftHand);
  setupArm(1, rightArm, rightHand);
  for (const side of [-1,1]) {
    mesh(new THREE.CylinderGeometry(.2, .22, .92, 10), clothing, body, [side*.34, -.66, .25], [Math.PI/2.25,0,0]);
    mesh(new THREE.BoxGeometry(.36, .26, .72), black, body, [side*.34, -1.05, -.25]);
  }
  seat.add(chairBack, chairSeat, body, headRig);
  const activeRing = new THREE.Mesh(new THREE.TorusGeometry(.9, .035, 8, 32), new THREE.MeshStandardMaterial({ color: 0xd7ff3f, emissive: 0x728a1d, emissiveIntensity: 2, transparent: true, opacity: .8 }));
  activeRing.rotation.x = Math.PI / 2;
  activeRing.position.y = -.73;
  activeRing.visible = false;
  seat.add(activeRing);
  seat.userData.activeRing = activeRing;
  seat.userData.body = body;
  seat.userData.head = headRig;
  seat.userData.leftArm = leftArm;
  seat.userData.rightArm = rightArm;
  seat.userData.leftHand = leftHand;
  seat.userData.rightHand = rightHand;
  seat.userData.hit = 0;
  seat.userData.action = 0;
  seat.userData.baseAngle = 0;
  seat.userData.label = null;
  seat.userData.labelName = "";
  return seat;
}

for (let i = 0; i < 6; i += 1) {
  const angle = i / 6 * Math.PI * 2 + Math.PI / 2;
  const seat = makeCharacter(i);
  seat.position.set(Math.cos(angle) * 5.75, -1.08, Math.sin(angle) * 5.75);
  seat.rotation.y = -angle + Math.PI / 2;
  seat.userData.baseAngle = seat.rotation.y;
  seat.visible = false;
  scene.add(seat);
  seats.push(seat);
}

const itemProps = new THREE.Group();
itemProps.position.set(-.25, -.66, 2.4);
scene.add(itemProps);
let itemPropSignature = "";
let itemPulseUntil = 0;

function makeItemProp(type) {
  const prop = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x77776f, roughness: .3, metalness: .75 });
  const brassItem = new THREE.MeshStandardMaterial({ color: 0xb48a3b, roughness: .35, metalness: .55 });
  const red = new THREE.MeshStandardMaterial({ color: 0x8b2117, roughness: .62 });
  const paper = new THREE.MeshStandardMaterial({ color: 0xd0c8b5, roughness: .92 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x5d3317, roughness: .25, metalness: .15, transparent: true, opacity: .86 });
  const add = (geometry, material, position = [0, 0, 0], rotation = [0, 0, 0]) => {
    const part = new THREE.Mesh(geometry, material);
    part.position.set(...position);
    part.rotation.set(...rotation);
    part.castShadow = true;
    prop.add(part);
    return part;
  };
  if (type === "magnifier") {
    add(new THREE.TorusGeometry(.28, .055, 10, 24), steel, [0, .18, 0], [Math.PI / 2, 0, 0]);
    add(new THREE.CylinderGeometry(.05, .06, .5, 8), steel, [.35, .05, 0], [0, 0, -Math.PI / 4]);
  } else if (type === "beer") {
    add(new THREE.CylinderGeometry(.16, .2, .72, 12), glass, [0, .36, 0]);
    add(new THREE.CylinderGeometry(.09, .12, .28, 12), glass, [0, .85, 0]);
    add(new THREE.CylinderGeometry(.1, .1, .04, 12), brassItem, [0, 1.01, 0]);
  } else if (type === "cigarettes") {
    add(new THREE.BoxGeometry(.52, .16, .72), paper, [0, .08, 0]);
    for (const x of [-.16, 0, .16]) add(new THREE.CylinderGeometry(.035, .035, .6, 8), paper, [x, .18, 0], [Math.PI / 2, 0, 0]);
  } else if (type === "handcuffs") {
    add(new THREE.TorusGeometry(.22, .045, 8, 20), steel, [-.25, .13, 0], [Math.PI / 2, 0, 0]);
    add(new THREE.TorusGeometry(.22, .045, 8, 20), steel, [.25, .13, 0], [Math.PI / 2, 0, 0]);
    add(new THREE.BoxGeometry(.25, .05, .05), steel, [0, .13, 0]);
  } else if (type === "handsaw") {
    add(new THREE.BoxGeometry(.95, .06, .28), steel, [.08, .15, 0], [0, -.12, 0]);
    add(new THREE.BoxGeometry(.34, .16, .4), new THREE.MeshStandardMaterial({ color: 0x3f2014, roughness: .7 }), [-.54, .15, 0]);
  } else if (type === "phone") {
    add(new THREE.BoxGeometry(.52, .12, .86), new THREE.MeshStandardMaterial({ color: 0x171a17, roughness: .45, metalness: .3 }), [0, .08, 0]);
    add(new THREE.BoxGeometry(.38, .02, .56), new THREE.MeshStandardMaterial({ color: 0x6d8b72, emissive: 0x1d3822, emissiveIntensity: 1.5 }), [0, .15, -.02]);
  } else if (type === "inverter") {
    add(new THREE.CylinderGeometry(.13, .13, .72, 10), red, [0, .14, 0], [0, 0, Math.PI / 2]);
    add(new THREE.CylinderGeometry(.14, .14, .22, 10), brassItem, [.43, .14, 0], [0, 0, Math.PI / 2]);
    add(new THREE.TorusGeometry(.25, .035, 8, 18), steel, [0, .14, 0], [Math.PI / 2, 0, 0]);
  } else if (type === "adrenaline") {
    add(new THREE.CylinderGeometry(.07, .07, .78, 10), new THREE.MeshStandardMaterial({ color: 0xa9d9ba, transparent: true, opacity: .72 }), [0, .15, 0], [0, 0, Math.PI / 2]);
    add(new THREE.CylinderGeometry(.09, .09, .08, 10), steel, [-.44, .15, 0], [0, 0, Math.PI / 2]);
    add(new THREE.CylinderGeometry(.018, .018, .4, 6), steel, [.58, .15, 0], [0, 0, Math.PI / 2]);
  } else {
    add(new THREE.CylinderGeometry(.23, .25, .48, 12), paper, [0, .25, 0]);
    add(new THREE.CylinderGeometry(.18, .2, .13, 12), red, [0, .56, 0]);
    add(new THREE.BoxGeometry(.18, .04, .04), red, [0, .26, -.24]);
    add(new THREE.BoxGeometry(.04, .18, .04), red, [0, .26, -.24]);
  }
  prop.scale.setScalar(.72);
  return prop;
}

function syncItemProps(items) {
  const signature = items.join("|");
  if (signature === itemPropSignature) return;
  itemPropSignature = signature;
  itemProps.traverse((object) => {
    object.geometry?.dispose();
    if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
    else object.material?.dispose();
  });
  itemProps.clear();
  items.slice(0, 4).forEach((item, index) => {
    const prop = makeItemProp(item);
    prop.position.set((index - (Math.min(items.length, 4) - 1) / 2) * .95, 0, 0);
    prop.rotation.y = (index - 1.5) * .12;
    itemProps.add(prop);
  });
}

const dustGeometry = new THREE.BufferGeometry();
const dustPositions = new Float32Array(360 * 3);
for (let i = 0; i < dustPositions.length; i += 3) {
  dustPositions[i] = (Math.random() - .5) * 24;
  dustPositions[i + 1] = Math.random() * 11 - 3;
  dustPositions[i + 2] = (Math.random() - .5) * 24;
}
dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: 0xc7b990, size: .022, transparent: true, opacity: .32 }));
scene.add(dust);

function syncSeats(players) {
  seats.forEach((seat, index) => {
    seat.visible = index < players.length;
    if (index < players.length) {
      const player = players[index];
      seat.scale.setScalar(player.alive ? 1 : .88);
      seat.rotation.z = player.alive ? 0 : -.18;
      seat.userData.activeRing.visible = player.id === state.currentPlayerId || player.id === hoveredPlayerId;
      if (seat.userData.labelName !== player.name) {
        if (seat.userData.label) seat.remove(seat.userData.label);
        seat.userData.label = makeNameSprite(player.name, player.id === state.viewerId ? "#d7ff3f" : "#8b877d");
        seat.userData.label.position.set(0, 2.65, .05);
        seat.add(seat.userData.label);
        seat.userData.labelName = player.name;
      }
    }
  });
  shells.children.forEach((shell, index) => { shell.visible = state?.phase === "playing" && index < state.shellsRemaining; });
  const current = players.find((player) => player.id === state.currentPlayerId);
  barrel.scale.y = current?.sawed ? .68 : 1;
  barrel.position.x = current?.sawed ? -.72 : -.3;
  muzzle.position.x = current?.sawed ? .46 : 2.3;
  pump.position.x = current?.sawed ? -.1 : .55;
  pendingGunPlayerId = state.currentPlayerId;
}

function setHoveredTarget(playerId) {
  hoveredPlayerId = playerId;
  ui.reticle.classList.toggle("hidden", !playerId);
  seats.forEach((seat, index) => {
    const id = state?.players[index]?.id;
    seat.userData.activeRing.visible = id === state?.currentPlayerId || id === hoveredPlayerId;
  });
  if (playerId) aimGunAt(playerId);
  else pendingGunPlayerId = state?.currentPlayerId ?? null;
}

let desiredCamera = new THREE.Vector3(8.6, 7.1, 10.8);
let desiredGunYaw = 0;
let pendingGunPlayerId = null;
let shotLockUntil = 0;
let gunRecoil = 0;
let pumpAction = 0;
let muzzleEnergy = 0;
let cameraShake = 0;

function aimGunAt(playerId) {
  const index = state?.players.findIndex((player) => player.id === playerId) ?? -1;
  if (index < 0 || !seats[index]) return;
  const position = seats[index].position;
  desiredGunYaw = -Math.atan2(position.z, position.x);
}

function sceneMode(phase) {
  desiredCamera = phase === "playing" ? new THREE.Vector3(7.2, 6.4, 9.2) : new THREE.Vector3(8.6, 7.1, 10.8);
  gun.visible = phase !== "lobby";
  itemProps.visible = phase === "playing";
}
sceneMode("lobby");

function playTone(frequency, duration, type = "square", gain = .07) {
  if (!soundEnabled) return;
  audioContext ||= new AudioContext();
  const oscillator = audioContext.createOscillator();
  const volume = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, frequency * .45), audioContext.currentTime + duration);
  volume.gain.setValueAtTime(gain, audioContext.currentTime);
  volume.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + duration);
  oscillator.connect(volume).connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + duration);
}

function animateShot(result) {
  aimGunAt(result.targetId);
  shotLockUntil = performance.now() + 700;
  gunRecoil = 1;
  pumpAction = 1;
  gun.rotation.z -= .2;
  setTimeout(() => { gun.rotation.z = .04; }, 170);
  const actorIndex = state?.players.findIndex((player) => player.id === result.actorId) ?? -1;
  const targetIndex = state?.players.findIndex((player) => player.id === result.targetId) ?? -1;
  if (seats[actorIndex]) seats[actorIndex].userData.action = 1;
  if (seats[targetIndex]) seats[targetIndex].userData.hit = result.shell === "live" ? 1 : .35;
  if (result.shell === "live") {
    ui.flash.classList.remove("fire");
    void ui.flash.offsetWidth;
    ui.flash.classList.add("fire");
    muzzleEnergy = 1;
    cameraShake = 1;
    playTone(85, .42, "sawtooth", .15);
  } else {
    playTone(160, .08, "square", .045);
  }
}

function animateItem({ item }) {
  itemPulseUntil = performance.now() + 650;
  const info = itemInfo[item];
  showToast(`${info?.name ?? "Ekipman"} kullanıldı.`);
  playTone(280, .13, "triangle", .055);
}

const clock = new THREE.Clock();
function frame() {
  const time = clock.getElapsedTime();
  cameraShake *= .84;
  const cinematicCamera = desiredCamera.clone();
  cinematicCamera.x += Math.sin(time * .12) * .28 + (Math.random() - .5) * cameraShake * .18;
  cinematicCamera.y += Math.sin(time * .17) * .08 + (Math.random() - .5) * cameraShake * .12;
  cinematicCamera.z += Math.cos(time * .12) * .2;
  camera.position.lerp(cinematicCamera, .022);
  camera.lookAt(0, -.18, -.15);
  if (performance.now() > shotLockUntil && pendingGunPlayerId) aimGunAt(pendingGunPlayerId);
  const yawDelta = Math.atan2(Math.sin(desiredGunYaw - gun.rotation.y), Math.cos(desiredGunYaw - gun.rotation.y));
  gun.rotation.y += yawDelta * .075;
  gunRecoil *= .86;
  pumpAction *= .88;
  muzzleEnergy *= .76;
  gun.position.x = -Math.cos(gun.rotation.y) * gunRecoil * .36;
  gun.position.z = Math.sin(gun.rotation.y) * gunRecoil * .36;
  gun.position.y = -.2 + Math.sin(time * .7) * .014;
  pump.position.x = (barrel.scale.y < 1 ? -.1 : .55) - pumpAction * .52;
  muzzleLight.position.x = muzzle.position.x + .22;
  muzzleLight.intensity = muzzleEnergy * 85;
  seats.forEach((seat, index) => {
    if (!seat.visible) return;
    const player = state?.players[index];
    const active = player?.id === state?.currentPlayerId;
    seat.userData.hit *= .88;
    seat.userData.action *= .9;
    const breath = Math.sin(time * 1.15 + index);
    seat.position.y = -1.08 + breath * (active ? .035 : .012);
    seat.rotation.z = (player?.alive ? 0 : -.2) + seat.userData.hit * (index % 2 ? .16 : -.16);
    seat.userData.body.scale.y = 1 + breath * .012;
    seat.userData.body.rotation.x += ((active ? -.055 : 0) - seat.userData.body.rotation.x) * .055;
    seat.userData.head.rotation.y = Math.sin(time * .47 + index) * .055;
    seat.userData.head.rotation.x += ((active ? -.05 : .02) + seat.userData.hit * .25 - seat.userData.head.rotation.x) * .08;
    seat.userData.leftArm.rotation.x = seat.userData.action * -.42;
    seat.userData.rightArm.rotation.x = seat.userData.action * -.42;
    seat.userData.leftHand.rotation.x = seat.userData.action * -.28;
    seat.userData.rightHand.rotation.x = seat.userData.action * -.28;
    if (seat.userData.activeRing) seat.userData.activeRing.rotation.z = time * .7;
  });
  const itemPulse = performance.now() < itemPulseUntil ? 1 + Math.sin(time * 28) * .12 : 1;
  itemProps.scale.setScalar(itemPulse);
  itemProps.children.forEach((prop, index) => { prop.rotation.y += .003 * (index % 2 ? 1 : -1); });
  dust.rotation.y = time * .008;
  fan.rotation.z = time * 1.35;
  monitorScreen.material.emissiveIntensity = 1.75 + Math.sin(time * 7.4) * .18 + Math.sin(time * 19.1) * .08;
  warningSprite.material.opacity = .82 + Math.sin(time * 5.3) * .12;
  keyLight.intensity = 92 + Math.sin(time * 2.1) * 4 + Math.sin(time * 7.7) * 2;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
});

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

const itemNames = { scanner: "TARAYICI", medkit: "İLK YARDIM", extractor: "ÇIKARICI", shield: "KALKAN" };
let state = null;
let turnEndAt = 0;
let toastTimer;
let secretTimer;
let soundEnabled = true;
let audioContext;

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

function renderState() {
  const me = state.players.find((player) => player.id === state.viewerId);
  const isHost = state.hostId === state.viewerId;
  ui.roomCode.textContent = state.code;
  ui.playerCount.textContent = `${state.players.length}/6`;
  ui.playerList.innerHTML = state.players.map((player, index) => {
    const hearts = Array.from({ length: 3 }, (_, heart) => `<i class="heart ${heart >= player.health ? "empty" : ""}"></i>`).join("");
    const flags = [player.id === state.hostId ? "ODA SAHİBİ" : "", !player.connected ? "KOPTU" : ""].filter(Boolean).join(" · ");
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
    ui.targetList.innerHTML = state.players.filter((player) => player.alive).map((player) =>
      `<button class="target-button ${player.id === state.viewerId ? "self" : ""}" data-target="${player.id}" ${myTurn ? "" : "disabled"}>${player.id === state.viewerId ? "KENDİNE" : escapeHtml(player.name)}</button>`
    ).join("");
    ui.targetList.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
      socket.emit("game:shoot", { targetId: button.dataset.target });
      disableActions();
    }));
    ui.itemList.innerHTML = (me?.items ?? []).map((item) => `<button class="item-button" data-item="${item}" ${myTurn ? "" : "disabled"}>${itemNames[item] ?? item}</button>`).join("") || "<span class='micro'>EKİPMAN YOK</span>";
    ui.itemList.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
      socket.emit("game:item", { item: button.dataset.item });
      disableActions();
    }));
  } else if (state.phase === "finished") {
    const winner = state.players.find((player) => player.id === state.winnerId);
    ui.winnerName.textContent = winner?.name ?? "KAZANAN";
  }
  syncSeats(state.players);
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

const table = new THREE.Group();
const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.7, .42, 10), new THREE.MeshStandardMaterial({ color: 0x2a2118, roughness: .72, metalness: .05 }));
tableTop.position.y = -1.1;
tableTop.castShadow = tableTop.receiveShadow = true;
table.add(tableTop);
const felt = new THREE.Mesh(new THREE.CylinderGeometry(4.8, 4.8, .055, 64), new THREE.MeshStandardMaterial({ color: 0x202922, roughness: .92 }));
felt.position.y = -.86;
felt.receiveShadow = true;
table.add(felt);
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
gun.position.set(.6, -.2, .1);
gun.rotation.y = -.22;
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

const seats = [];
const seatColors = [0x854038, 0x394f65, 0x58643b, 0x69436b, 0x735332, 0x3f6560];
for (let i = 0; i < 6; i += 1) {
  const angle = i / 6 * Math.PI * 2 + Math.PI / 2;
  const seat = new THREE.Group();
  const chair = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.1, .35), new THREE.MeshStandardMaterial({ color: seatColors[i], roughness: .86 }));
  chair.position.y = .1;
  chair.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(.38, 16, 12), new THREE.MeshStandardMaterial({ color: 0x161513, roughness: .95 }));
  head.position.set(0, 1.75, -.1);
  head.castShadow = true;
  seat.add(chair, head);
  seat.position.set(Math.cos(angle) * 6.1, -1.15, Math.sin(angle) * 6.1);
  seat.rotation.y = -angle + Math.PI / 2;
  seat.visible = false;
  scene.add(seat);
  seats.push(seat);
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
    }
  });
  shells.children.forEach((shell, index) => { shell.visible = state?.phase === "playing" && index < state.shellsRemaining; });
}

let desiredCamera = new THREE.Vector3(8.6, 7.1, 10.8);
function sceneMode(phase) {
  desiredCamera = phase === "playing" ? new THREE.Vector3(6.4, 6.1, 8.2) : new THREE.Vector3(8.6, 7.1, 10.8);
  gun.visible = phase !== "lobby";
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
  const initial = gun.rotation.z;
  gun.rotation.z -= .2;
  setTimeout(() => { gun.rotation.z = initial; }, 170);
  if (result.shell === "live") {
    ui.flash.classList.remove("fire");
    void ui.flash.offsetWidth;
    ui.flash.classList.add("fire");
    playTone(85, .42, "sawtooth", .15);
  } else {
    playTone(160, .08, "square", .045);
  }
}

const clock = new THREE.Clock();
function frame() {
  const time = clock.getElapsedTime();
  camera.position.lerp(desiredCamera, .025);
  camera.lookAt(0, -.25, 0);
  gun.position.y = -.2 + Math.sin(time * .7) * .014;
  dust.rotation.y = time * .008;
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

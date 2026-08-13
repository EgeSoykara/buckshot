import * as THREE from "/vendor/three/three.module.js";
import { CHARACTER_RULES } from "/shared/characters.js?v=20260813-characters-v1";
import { resolveAimTarget } from "/shared/aiming.js?v=20260813-aiming-v2";
import { ITEM_SLOT_POSITIONS, ITEM_TRAY_RADIUS, SEAT_RADIUS, firstPersonViewForPlayer, itemTrayAngle, playerSeatAngle, playerSeatSlot, radialPoint, seatAngle } from "/shared/table-layout.js?v=20260813-fps-layout-v1";

const $ = (selector) => document.querySelector(selector);
const socket = window.io({ transports: ["websocket", "polling"] });
const ui = {
  home: $("#home-screen"), room: $("#room-screen"), connection: $("#connection"),
  name: $("#player-name"), code: $("#room-code"), create: $("#create-button"), join: $("#join-button"),
  roomCode: $("#room-code-label"), copyCode: $("#copy-code"), share: $("#share-button"),
  playerCount: $("#player-count"), playerList: $("#player-list"), lobby: $("#lobby-panel"),
  start: $("#start-button"), hostHint: $("#host-hint"), gameHud: $("#game-hud"),
  turnKicker: $("#turn-kicker"), turnTitle: $("#turn-title"), lastAction: $("#last-action"),
  passivePanel: $("#passive-panel"), passiveName: $("#passive-name"), passiveDescription: $("#passive-description"),
  targetConfirm: $("#target-confirm"), selectedTargetName: $("#selected-target-name"), fire: $("#fire-button"), fireLabel: $("#fire-button-label"),
  targetList: $("#target-list"), itemList: $("#item-list"), timerBar: $("#timer-bar"), timerText: $("#timer-text"),
  winner: $("#winner-panel"), winnerName: $("#winner-name"), restart: $("#restart-button"), restartHint: $("#restart-hint"),
  toast: $("#toast"), secret: $("#secret-toast"), secretMessage: $("#secret-message"), flash: $("#flash"), sound: $("#sound-toggle"),
  shotResult: $("#shot-result"), shotRoute: $("#shot-route"), shotOutcome: $("#shot-outcome"), shotDetail: $("#shot-detail")
};
ui.rules = $("#rules-dialog");
ui.rulesButton = $("#rules-button");
ui.rulesClose = $("#rules-close");
ui.reticle = $("#aim-reticle");
ui.reticleLabel = $("#aim-reticle-label");
ui.turnAnnouncer = $("#turn-announcer");
ui.turnAnnouncerName = $("#turn-announcer-name");
ui.roundReveal = $("#round-reveal");
ui.roundRevealKicker = $("#round-reveal-kicker");
ui.roundLive = $("#round-live-count");
ui.roundBlank = $("#round-blank-count");
ui.roundShellList = $("#round-shell-list");
ui.roundRevealStatus = $("#round-reveal-status");
ui.deathBlood = $("#death-blood");
ui.characterList = $("#character-list");
ui.characterList.innerHTML = Object.entries(CHARACTER_RULES).map(([id, character], index) => `
  <button class="character-card ${index === 0 ? "selected" : ""}" type="button" role="radio" aria-checked="${index === 0}" data-character="${id}" title="${character.passive}: ${character.description}">
    <span class="portrait portrait-${id}"><i>${String(index + 1).padStart(2, "0")}</i></span>
    <span class="character-meta"><b>${character.name}</b><small>${character.passive} · ${character.short}</small></span>
    <em>${character.english}</em>
  </button>
`).join("");
ui.characterButtons = [...document.querySelectorAll(".character-card")];

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
let shotResultTimer;
let soundEnabled = true;
let audioContext;
let hoveredPlayerId = null;
let selectedTargetId = null;
let previousCurrentPlayerId = null;
let shotTargetId = null;
let shotActorId = null;
let shotVisualUntil = 0;
let roundReadyUntil = 0;
let roundAnimationStart = 0;
let roundAnimationTimers = [];
let deathBloodTimer;

function isRoundLoading() {
  return state?.phase === "playing" && Date.now() < roundReadyUntil;
}

const characterIds = new Set(Object.keys(CHARACTER_RULES));
let selectedCharacter = localStorage.getItem("last-chamber-character");
if (!characterIds.has(selectedCharacter)) selectedCharacter = "mariner";

function selectCharacter(characterId, announce = false) {
  if (!characterIds.has(characterId)) return;
  selectedCharacter = characterId;
  localStorage.setItem("last-chamber-character", characterId);
  document.body.dataset.character = characterId;
  ui.characterButtons.forEach((button) => {
    const selected = button.dataset.character === characterId;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-checked", String(selected));
  });
  if (announce) {
    const name = ui.characterButtons.find((button) => button.dataset.character === characterId)?.querySelector(".character-meta b")?.textContent;
    showToast(`${name ?? "Karakter"} seçildi.`);
    playTone(190, .09, "triangle", .035);
  }
}

selectCharacter(selectedCharacter);
ui.characterButtons.forEach((button) => button.addEventListener("click", () => selectCharacter(button.dataset.character, true)));
ui.characterList.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
  const currentIndex = ui.characterButtons.findIndex((button) => button.dataset.character === selectedCharacter);
  const nextButton = ui.characterButtons[(currentIndex + direction + ui.characterButtons.length) % ui.characterButtons.length];
  selectCharacter(nextButton.dataset.character, true);
  nextButton.focus();
});

if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
  ui.home.addEventListener("pointermove", (event) => {
    const x = (event.clientX / innerWidth - .5) * -15;
    const y = (event.clientY / innerHeight - .5) * -10;
    ui.home.style.setProperty("--parallax-x", `${x}px`);
    ui.home.style.setProperty("--parallax-y", `${y}px`);
  });
  ui.home.addEventListener("pointerleave", () => {
    ui.home.style.setProperty("--parallax-x", "0px");
    ui.home.style.setProperty("--parallax-y", "0px");
  });
}

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
  socket.emit("room:join", { code, name, character: selectedCharacter });
}

ui.create.addEventListener("click", () => {
  const name = saveName();
  if (name) socket.emit("room:create", { name, character: selectedCharacter });
});
ui.join.addEventListener("click", joinRoom);
ui.code.addEventListener("keydown", (event) => { if (event.key === "Enter") joinRoom(); });
ui.code.addEventListener("input", () => { ui.code.value = ui.code.value.toUpperCase().replace(/[^A-Z2-9]/g, ""); });
ui.start.addEventListener("click", () => socket.emit("game:start"));
ui.restart.addEventListener("click", () => socket.emit("game:start"));
ui.fire.addEventListener("click", fireSelectedTarget);

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
socket.on("game:error", ({ message }) => {
  showToast(message, true);
  restoreActions();
});
socket.on("room:state", (nextState) => {
  const previousRound = state?.round ?? 0;
  const receivedAt = Date.now();
  state = nextState;
  roundReadyUntil = receivedAt + nextState.roundReadyInMs;
  turnEndAt = roundReadyUntil + nextState.turnRemainingMs;
  ui.home.classList.add("hidden");
  ui.room.classList.remove("hidden");
  renderState();
  sceneMode(nextState.phase);
  if (nextState.phase === "playing" && nextState.round !== previousRound && nextState.roundReadyInMs > 0) {
    beginRoundLoading(nextState, previousRound > 0 ? 2_250 : 0);
  }
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
    const hearts = Array.from({ length: player.maxHealth }, (_, heart) => `<i class="heart ${heart >= player.health ? "empty" : ""}"></i>`).join("");
    const flags = [player.id === state.hostId ? "ODA SAHİBİ" : "", !player.connected ? "KOPTU" : "", player.skipTurns ? "KELEPÇELİ" : "", player.sawed ? "KESİK NAMLU" : "", player.items.length ? `${player.items.length} EKİPMAN` : ""].filter(Boolean).join(" · ");
    return `<div class="player-card ${player.id === state.currentPlayerId ? "current" : ""} ${!player.alive ? "dead" : ""} ${!player.connected ? "disconnected" : ""}" data-player-id="${player.id}">
      <span class="player-index">${String(index + 1).padStart(2, "0")}</span>
      <div class="player-meta"><b>${escapeHtml(player.name)}${player.id === state.viewerId ? " · SEN" : ""}</b><span><strong>${escapeHtml(player.characterName)}</strong> · ${flags || (player.alive ? "MASADA" : "ELENDİ")}</span></div>
      <div class="hearts">${hearts}</div>
    </div>`;
  }).join("");

  ui.lobby.classList.toggle("hidden", state.phase !== "lobby");
  ui.gameHud.classList.toggle("hidden", state.phase !== "playing");
  ui.winner.classList.toggle("hidden", state.phase !== "finished");
  ui.start.classList.toggle("hidden", !isHost);
  ui.hostHint.classList.toggle("hidden", isHost);
  ui.restart.classList.toggle("hidden", !isHost);
  ui.restartHint.classList.toggle("hidden", isHost);
  ui.start.disabled = state.players.length < 2 || state.players.some((player) => !player.connected);

  if (state.phase === "playing") {
    const current = state.players.find((player) => player.id === state.currentPlayerId);
    const myTurn = state.currentPlayerId === state.viewerId;
    const loading = isRoundLoading();
    ui.turnKicker.textContent = loading ? `HAZNE ${state.round} YÜKLENİYOR` : (myTurn ? "SIRA SENDE" : `${current?.name ?? "—"} OYNUYOR`);
    ui.turnTitle.textContent = loading ? "FİŞEKLERİ HATIRLA" : (myTurn ? "HEDEFİNİ SEÇ" : "MASAYI İZLE");
    ui.lastAction.textContent = state.lastAction;
    const myCharacter = CHARACTER_RULES[me?.character];
    ui.passiveName.textContent = `${myCharacter?.name ?? "KARAKTER"} / ${myCharacter?.passive ?? "PASİF"}`;
    ui.passiveDescription.textContent = state.characterInsight?.message ?? myCharacter?.description ?? "Kimliğinin masadaki etkisi etkin.";
    ui.passivePanel.classList.toggle("insight", Boolean(state.characterInsight));
    if (state.currentPlayerId && state.currentPlayerId !== previousCurrentPlayerId) {
      hoveredPlayerId = null;
      selectedTargetId = null;
      ui.reticle.classList.add("hidden");
      if (!loading) announceTurn(current?.name ?? "—");
    }
    previousCurrentPlayerId = state.currentPlayerId;
    if (myTurn && state.aimTargetId) selectedTargetId = state.aimTargetId;
    else if (!myTurn) selectedTargetId = null;
    const displayedTargetId = myTurn ? selectedTargetId : state.aimTargetId;
    ui.targetList.innerHTML = state.players.filter((player) => player.alive).map((player) =>
      `<button class="target-button ${player.id === state.viewerId ? "self" : ""} ${player.id === displayedTargetId ? "selected" : ""}" data-target="${player.id}" aria-pressed="${player.id === displayedTargetId}" aria-label="Hedef seç: ${player.id === state.viewerId ? "kendin" : escapeHtml(player.name)}" ${myTurn && !loading ? "" : "disabled"}>${player.id === state.viewerId ? "KENDİNE" : escapeHtml(player.name)}</button>`
    ).join("");
    ui.targetList.querySelectorAll("button").forEach((button) => {
      button.addEventListener("pointerenter", () => setHoveredTarget(button.dataset.target));
      button.addEventListener("pointerleave", () => setHoveredTarget(null));
      button.addEventListener("focus", () => setHoveredTarget(button.dataset.target));
      button.addEventListener("blur", () => setHoveredTarget(null));
      button.addEventListener("click", () => selectTarget(button.dataset.target));
    });
    updateTargetControls();
    ui.itemList.innerHTML = (me?.items ?? []).map((item) => {
      const info = itemInfo[item] ?? { name: item, mark: "·", description: item };
      const usable = canUseItem(item, me);
      const description = item === "adrenaline" && !usable ? "Rakiplerde çalınabilecek ekipman yok." : info.description;
      return `<button class="item-button ${usable ? "" : "unavailable"}" data-item="${item}" title="${description}" ${myTurn && usable && !loading ? "" : "disabled"}><i>${info.mark}</i><span>${info.name}</span></button>`;
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
  syncItemProps(state.players);
}

function shuffledRoundShells(loadout) {
  const shells = [
    ...Array(loadout?.live ?? 0).fill("live"),
    ...Array(loadout?.blank ?? 0).fill("blank")
  ];
  for (let index = shells.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shells[index], shells[swapIndex]] = [shells[swapIndex], shells[index]];
  }
  return shells;
}

function beginRoundLoading(nextState, delay = 0) {
  roundAnimationTimers.forEach(clearTimeout);
  roundAnimationTimers = [];
  const sequence = shuffledRoundShells(nextState.roundLoadout);
  const revealStep = 145;
  const loadStart = delay > 0 ? 800 : 1_500;
  const loadStep = 310;
  roundAnimationStart = performance.now() + delay;
  prepareLoadingShells(sequence, loadStart);
  disableActions();

  ui.roundRevealKicker.textContent = `HAZNE ${String(nextState.round).padStart(2, "0")} · MÜHİMMAT SAYIMI`;
  ui.roundLive.textContent = String(nextState.roundLoadout?.live ?? 0);
  ui.roundBlank.textContent = String(nextState.roundLoadout?.blank ?? 0);
  ui.roundRevealStatus.textContent = "FİŞEKLER SAYILIYOR";
  ui.roundShellList.innerHTML = sequence.map((type, index) =>
    `<i class="round-shell ${type}" data-shell-index="${index}" style="--shell-tilt:${index % 2 ? 4 : -4}deg"></i>`
  ).join("");
  ui.roundReveal.classList.add("hidden");

  roundAnimationTimers.push(setTimeout(() => {
    ui.roundReveal.classList.remove("hidden");
    sequence.forEach((_type, index) => {
      roundAnimationTimers.push(setTimeout(() => {
        ui.roundShellList.children[index]?.classList.add("revealed");
        playTone(sequence[index] === "live" ? 155 : 245, .055, "triangle", .025);
      }, index * revealStep));
    });
  }, delay));

  roundAnimationTimers.push(setTimeout(() => {
    ui.roundRevealStatus.textContent = "POMPALIYA YÜKLENİYOR";
    sequence.forEach((_type, index) => {
      roundAnimationTimers.push(setTimeout(() => {
        ui.roundShellList.children[index]?.classList.add("loading");
        playTone(78, .075, "square", .035);
      }, index * loadStep));
    });
  }, delay + loadStart));

  const finishDelay = Math.max(900, nextState.roundReadyInMs + 40);
  roundAnimationTimers.push(setTimeout(finishRoundLoading, finishDelay));
}

function finishRoundLoading() {
  if (isRoundLoading()) {
    roundAnimationTimers.push(setTimeout(finishRoundLoading, Math.max(40, roundReadyUntil - Date.now() + 30)));
    return;
  }
  ui.roundRevealStatus.textContent = "HAZNE HAZIR";
  ui.roundReveal.classList.add("hidden");
  shells.children.forEach((shell) => { shell.visible = false; });
  if (state?.phase === "playing") {
    renderState();
    const current = state.players.find((player) => player.id === state.currentPlayerId);
    announceTurn(current?.name ?? "—");
  }
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
  ui.fire.disabled = true;
}

function canUseItem(item, me = state?.players.find((player) => player.id === state?.viewerId)) {
  if (item !== "adrenaline") return true;
  return Boolean(state?.players.some((player) => player.alive && player.id !== me?.id && player.items.length > 0));
}

function restoreActions() {
  if (!state || state.phase !== "playing" || state.currentPlayerId !== state.viewerId || isRoundLoading()) return;
  ui.targetList.querySelectorAll("button").forEach((button) => { button.disabled = false; });
  ui.itemList.querySelectorAll("button").forEach((button) => {
    button.disabled = !canUseItem(button.dataset.item);
  });
  updateTargetControls();
}

function targetName(playerId) {
  const player = state?.players.find((candidate) => candidate.id === playerId);
  if (!player) return "—";
  return player.id === state.viewerId ? `${player.name} · KENDİN` : player.name;
}

function effectiveAimTargetId() {
  return resolveAimTarget({
    shotTargetId,
    shotVisualUntil,
    selectedTargetId,
    authoritativeTargetId: state?.aimTargetId,
    hoveredPlayerId
  }, performance.now());
}

function updateAimIndicators(playerId = effectiveAimTargetId()) {
  const label = targetName(playerId).toLocaleUpperCase("tr-TR");
  ui.reticle.classList.toggle("hidden", !playerId);
  ui.reticleLabel.textContent = playerId ? `HEDEF: ${label}` : "HEDEF KİLİTLİ";
  ui.playerList.querySelectorAll(".player-card").forEach((card) => card.classList.toggle("aimed", card.dataset.playerId === playerId));
  seats.forEach((seat, index) => {
    const id = state?.players[index]?.id;
    seat.userData.activeRing.visible = id === state?.currentPlayerId;
    seat.userData.targetRing.visible = id === playerId;
  });
}

function updateTargetControls() {
  if (!state || state.phase !== "playing") return;
  const myTurn = state.currentPlayerId === state.viewerId;
  const loading = isRoundLoading();
  const target = state.players.find((player) => player.id === selectedTargetId && player.alive);
  const observedTarget = state.players.find((player) => player.id === state.aimTargetId && player.alive);
  const displayedTargetId = myTurn ? selectedTargetId : observedTarget?.id;
  const current = state.players.find((player) => player.id === state.currentPlayerId);
  ui.targetConfirm.classList.toggle("locked", Boolean(myTurn && target && !loading));
  ui.selectedTargetName.textContent = myTurn
    ? (target ? targetName(target.id).toLocaleUpperCase("tr-TR") : "ÖNCE HEDEF SEÇ")
    : (observedTarget
        ? `${current?.name ?? "—"} → ${targetName(observedTarget.id)}`.toLocaleUpperCase("tr-TR")
        : `${current?.name ?? "—"} HEDEF SEÇİYOR`);
  ui.fire.disabled = loading || !myTurn || !target;
  ui.fireLabel.textContent = target ? `ATEŞ ET: ${target.id === state.viewerId ? "KENDİNE" : target.name.toLocaleUpperCase("tr-TR")}` : "TETİK KİLİTLİ";
  ui.targetList.querySelectorAll("button").forEach((button) => {
    const selected = button.dataset.target === displayedTargetId;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  updateAimIndicators();
}

function selectTarget(playerId) {
  if (!state || state.phase !== "playing" || state.currentPlayerId !== state.viewerId || isRoundLoading()) return;
  const target = state.players.find((player) => player.id === playerId && player.alive);
  if (!target) return;
  selectedTargetId = target.id;
  shotVisualUntil = 0;
  setHoveredTarget(null);
  updateTargetControls();
  playTone(235, .07, "triangle", .04);
  socket.emit("game:aim", { targetId: target.id });
  requestAnimationFrame(() => ui.fire.focus({ preventScroll: true }));
}

function fireSelectedTarget() {
  if (!state || state.phase !== "playing" || state.currentPlayerId !== state.viewerId || isRoundLoading()) return;
  const target = state.players.find((player) => player.id === selectedTargetId && player.alive);
  if (!target) return showToast("Önce namlunun çevrileceği hedefi seç.", true);
  shotTargetId = target.id;
  shotVisualUntil = performance.now() + 2400;
  pendingGunPlayerId = target.id;
  aimGunAt(target.id);
  socket.emit("game:shoot", { targetId: target.id });
  disableActions();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

setInterval(() => {
  if (!state || state.phase !== "playing") return;
  if (isRoundLoading()) {
    ui.timerText.textContent = "30";
    ui.timerBar.style.width = "100%";
    return;
  }
  const remaining = Math.max(0, turnEndAt - Date.now());
  ui.timerText.textContent = Math.ceil(remaining / 1000);
  ui.timerBar.style.width = `${Math.min(100, (remaining / 30_000) * 100)}%`;
}, 200);

// Procedural Three.js table and characters. Every seat is rebuilt from the server-authoritative identity.
const renderer = new THREE.WebGLRenderer({ canvas: $("#scene"), antialias: true, alpha: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.4));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.42;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x06100f);
scene.fog = new THREE.FogExp2(0x0a1d1a, 0.023);
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, .1, 100);
camera.position.set(8.6, 7.1, 10.8);
camera.lookAt(0, -.2, 0);

scene.add(new THREE.HemisphereLight(0xb9d9cf, 0x020403, 1.65));
scene.add(new THREE.AmbientLight(0x789e94, 1.55));
const keyLight = new THREE.SpotLight(0xd9eadf, 310, 36, Math.PI / 3.7, .7, 1.2);
keyLight.position.set(-3, 10, 4);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
scene.add(keyLight);
const fillLight = new THREE.SpotLight(0x6fb8b0, 165, 30, Math.PI / 2.8, .82, 1.15);
fillLight.position.set(8, 7, 6);
fillLight.target.position.set(0, 0, 0);
scene.add(fillLight, fillLight.target);
const rimLight = new THREE.PointLight(0xb8653c, 92, 20, 2);
rimLight.position.set(-5, 3.5, -2.5);
scene.add(rimLight);
const clinicalLight = new THREE.PointLight(0x4da89b, 82, 18, 2);
clinicalLight.position.set(5, 3, -4);
scene.add(clinicalLight);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x060b0a, roughness: .94 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -2.65;
floor.receiveShadow = true;
scene.add(floor);
const floorGrid = new THREE.GridHelper(80, 80, 0x31534c, 0x10201d);
floorGrid.position.y = -2.635;
floorGrid.material.transparent = true;
floorGrid.material.opacity = .28;
scene.add(floorGrid);

const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x111917, roughness: .92, side: THREE.DoubleSide });
const backWall = new THREE.Mesh(new THREE.PlaneGeometry(30, 14), wallMaterial);
backWall.position.set(0, 3.5, -9);
backWall.receiveShadow = true;
scene.add(backWall);
for (const side of [-1, 1]) {
  const sideWall = new THREE.Mesh(new THREE.PlaneGeometry(30, 14), wallMaterial);
  sideWall.position.set(side * 14.5, 3.5, 0);
  sideWall.rotation.y = Math.PI / 2;
  sideWall.receiveShadow = true;
  scene.add(sideWall);
}
const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0x090f0e, roughness: .96, side: THREE.DoubleSide }));
ceiling.position.y = 8.1;
ceiling.rotation.x = Math.PI / 2;
scene.add(ceiling);
for (let x = -12; x <= 12; x += 4) {
  const beam = new THREE.Mesh(new THREE.BoxGeometry(.13, 12, .2), new THREE.MeshStandardMaterial({ color: 0x27302d, roughness: .72, metalness: .32 }));
  beam.position.set(x, 2.8, -8.8);
  scene.add(beam);
}
const fluorescentMaterial = new THREE.MeshStandardMaterial({ color: 0x71867f, emissive: 0x47776d, emissiveIntensity: 1.3, roughness: .34 });
for (const x of [-4.2, 0, 4.2]) {
  for (const z of [-3.4, 3.4]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(3.25, .13, 1.08), fluorescentMaterial);
    panel.position.set(x, 7.92, z);
    scene.add(panel);
    const panelLight = new THREE.PointLight(0x8dbdb0, 28, 10, 1.8);
    panelLight.position.set(x, 7.45, z);
    scene.add(panelLight);
  }
}

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
const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.7, .42, 10), new THREE.MeshStandardMaterial({ color: 0x180e09, roughness: .74, metalness: .04 }));
tableTop.position.y = -1.1;
tableTop.castShadow = tableTop.receiveShadow = true;
table.add(tableTop);
const felt = new THREE.Mesh(new THREE.CylinderGeometry(4.8, 4.8, .055, 64), new THREE.MeshStandardMaterial({ color: 0x0a1d19, emissive: 0x04100d, emissiveIntensity: .28, roughness: .96 }));
felt.position.y = -.86;
felt.receiveShadow = true;
table.add(felt);
const tableRim = new THREE.Mesh(new THREE.TorusGeometry(5.08, .17, 10, 10), new THREE.MeshStandardMaterial({ color: 0x533724, roughness: .52, metalness: .12 }));
tableRim.rotation.x = Math.PI / 2;
tableRim.position.y = -.78;
tableRim.castShadow = true;
table.add(tableRim);
for (let i = 0; i < 4; i += 1) {
  const leg = new THREE.Mesh(new THREE.BoxGeometry(.42, 2, .42), new THREE.MeshStandardMaterial({ color: 0x20150f, roughness: .84 }));
  leg.position.set(Math.cos(i * Math.PI / 2 + .7) * 3.5, -1.8, Math.sin(i * Math.PI / 2 + .7) * 3.5);
  leg.castShadow = true;
  table.add(leg);
}
scene.add(table);

const sigilMaterial = new THREE.MeshStandardMaterial({ color: 0x608c7d, emissive: 0x2c6d5b, emissiveIntensity: 1.65, roughness: .52, transparent: true, opacity: .72 });
for (const radius of [1.25, 2.28, 3.55]) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, .025, 6, 96), sigilMaterial);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -.815;
  table.add(ring);
}
for (let i = 0; i < 12; i += 1) {
  const runeLine = new THREE.Mesh(new THREE.BoxGeometry(2.9, .018, .035), sigilMaterial);
  runeLine.position.set(Math.cos(i * Math.PI / 6) * 1.55, -.81, Math.sin(i * Math.PI / 6) * 1.55);
  runeLine.rotation.y = -i * Math.PI / 6 + (i % 2 ? .32 : -.32);
  table.add(runeLine);
}

function makeMistTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(128, 128, 8, 128, 128, 128);
  gradient.addColorStop(0, "rgba(150,203,188,.34)");
  gradient.addColorStop(.35, "rgba(92,151,138,.17)");
  gradient.addColorStop(1, "rgba(20,55,49,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(canvas);
}

const mist = new THREE.Group();
const mistTexture = makeMistTexture();
for (let i = 0; i < 16; i += 1) {
  const cloud = new THREE.Sprite(new THREE.SpriteMaterial({ map: mistTexture, color: 0x9bc7bb, transparent: true, opacity: .12, depthWrite: false }));
  const angle = i / 16 * Math.PI * 2;
  const radius = 2.2 + (i % 5) * 1.25;
  cloud.position.set(Math.cos(angle) * radius, -1.35 + (i % 4) * .42, Math.sin(angle) * radius);
  const size = 4.6 + (i % 4) * 1.2;
  cloud.scale.set(size * 1.7, size, 1);
  cloud.userData.origin = cloud.position.clone();
  cloud.userData.phase = i * .91;
  mist.add(cloud);
}
scene.add(mist);

function makeSurfaceTexture(kind) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  context.fillStyle = kind === "wood" ? "#b16a3d" : "#9a9d98";
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 90; i += 1) {
    const y = Math.random() * canvas.height;
    context.strokeStyle = kind === "wood"
      ? `rgba(${45 + Math.random() * 35},${18 + Math.random() * 20},8,${.08 + Math.random() * .2})`
      : `rgba(255,255,245,${.025 + Math.random() * .06})`;
    context.lineWidth = kind === "wood" ? .6 + Math.random() * 2.4 : .35;
    context.beginPath();
    context.moveTo(0, y);
    for (let x = 0; x <= canvas.width; x += 24) {
      context.lineTo(x, y + Math.sin(x * .035 + i) * (kind === "wood" ? 4 : .8));
    }
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(kind === "wood" ? 2.4 : 4, 1);
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function makeGunDecal(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(225,220,197,.78)";
  context.font = "700 38px monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, 256, 48);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide });
}

const gun = new THREE.Group();
const metalTexture = makeSurfaceTexture("metal");
const woodTexture = makeSurfaceTexture("wood");
const darkMetal = new THREE.MeshPhysicalMaterial({ color: 0x242a28, map: metalTexture, roughness: .19, metalness: .96, clearcoat: .22, clearcoatRoughness: .38 });
const wornMetal = new THREE.MeshPhysicalMaterial({ color: 0x777b76, map: metalTexture, roughness: .26, metalness: .9, clearcoat: .18, clearcoatRoughness: .42 });
const gunBlack = new THREE.MeshPhysicalMaterial({ color: 0x090c0b, roughness: .38, metalness: .78, clearcoat: .12 });
const wood = new THREE.MeshPhysicalMaterial({ color: 0x734024, map: woodTexture, roughness: .38, metalness: .02, clearcoat: .48, clearcoatRoughness: .31 });
const woodDark = new THREE.MeshPhysicalMaterial({ color: 0x421f14, map: woodTexture, roughness: .5, metalness: .02, clearcoat: .34, clearcoatRoughness: .4 });
const brassDetail = new THREE.MeshStandardMaterial({ color: 0x9a793d, roughness: .34, metalness: .72 });

const barrelAssembly = new THREE.Group();
barrelAssembly.position.set(-1.03, .03, 0);
const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.18, .205, 3.8, 24), darkMetal);
barrel.rotation.z = Math.PI / 2;
barrel.position.set(1.9, .13, 0);
barrelAssembly.add(barrel);
const magazineTube = new THREE.Mesh(new THREE.CylinderGeometry(.135, .15, 3.18, 20), gunBlack);
magazineTube.rotation.z = Math.PI / 2;
magazineTube.position.set(1.53, -.2, 0);
barrelAssembly.add(magazineTube);
const barrelRib = new THREE.Mesh(new THREE.BoxGeometry(3.35, .055, .13), wornMetal);
barrelRib.position.set(1.69, .335, 0);
barrelAssembly.add(barrelRib);
const frontSight = new THREE.Mesh(new THREE.SphereGeometry(.075, 12, 8), brassDetail);
frontSight.position.set(3.52, .405, 0);
barrelAssembly.add(frontSight);
const muzzle = new THREE.Mesh(new THREE.TorusGeometry(.19, .04, 10, 24), wornMetal);
muzzle.rotation.y = Math.PI / 2;
muzzle.position.set(3.8, .13, 0);
barrelAssembly.add(muzzle);
const magazineCap = new THREE.Mesh(new THREE.CylinderGeometry(.17, .17, .12, 18), wornMetal);
magazineCap.rotation.z = Math.PI / 2;
magazineCap.position.set(3.14, -.2, 0);
barrelAssembly.add(magazineCap);
const barrelClamp = new THREE.Mesh(new THREE.BoxGeometry(.13, .48, .4), wornMetal);
barrelClamp.position.set(2.75, -.02, 0);
barrelAssembly.add(barrelClamp);
const chamberCollar = new THREE.Mesh(new THREE.CylinderGeometry(.235, .255, .34, 24), wornMetal);
chamberCollar.rotation.z = Math.PI / 2;
chamberCollar.position.set(.12, .11, 0);
barrelAssembly.add(chamberCollar);
const chamberBand = new THREE.Mesh(new THREE.TorusGeometry(.242, .026, 10, 24), darkMetal);
chamberBand.rotation.y = Math.PI / 2;
chamberBand.position.set(.28, .11, 0);
barrelAssembly.add(chamberBand);
const muzzleBore = new THREE.Mesh(new THREE.CircleGeometry(.155, 24), gunBlack);
muzzleBore.rotation.y = Math.PI / 2;
muzzleBore.position.set(3.806, .13, 0);
barrelAssembly.add(muzzleBore);
gun.add(barrelAssembly);

const pump = new THREE.Group();
pump.position.set(.35, -.17, 0);
const pumpBody = new THREE.Mesh(new THREE.CylinderGeometry(.31, .34, 1.18, 16), woodDark);
pumpBody.rotation.z = Math.PI / 2;
pump.add(pumpBody);
for (const end of [-.58, .58]) {
  const ferrule = new THREE.Mesh(new THREE.TorusGeometry(.325, .025, 8, 20), darkMetal);
  ferrule.rotation.y = Math.PI / 2;
  ferrule.position.x = end;
  pump.add(ferrule);
}
for (let x = -.46; x <= .46; x += .185) {
  const rib = new THREE.Mesh(new THREE.TorusGeometry(.345, .018, 7, 18), wood);
  rib.rotation.y = Math.PI / 2;
  rib.position.x = x;
  pump.add(rib);
}
gun.add(pump);

const receiverShape = new THREE.Shape();
receiverShape.moveTo(-.66, -.35);
receiverShape.lineTo(-.58, .34);
receiverShape.lineTo(.48, .39);
receiverShape.lineTo(.66, .23);
receiverShape.lineTo(.62, -.28);
receiverShape.lineTo(.43, -.38);
receiverShape.closePath();
const receiverGeometry = new THREE.ExtrudeGeometry(receiverShape, { depth: .64, bevelEnabled: true, bevelSegments: 3, bevelSize: .045, bevelThickness: .045 });
receiverGeometry.translate(0, 0, -.32);
const receiver = new THREE.Mesh(receiverGeometry, wornMetal);
receiver.position.set(-1.67, -.02, 0);
gun.add(receiver);
const receiverTop = new THREE.Mesh(new THREE.BoxGeometry(1.22, .1, .5), darkMetal);
receiverTop.position.set(-1.62, .42, 0);
gun.add(receiverTop);
const ejectionPort = new THREE.Mesh(new THREE.BoxGeometry(.55, .27, .025), gunBlack);
ejectionPort.position.set(-1.42, .08, .365);
gun.add(ejectionPort);
for (const [x, y, width, height] of [[-1.42, .235, .64, .035], [-1.42, -.075, .64, .035], [-1.755, .08, .035, .275], [-1.085, .08, .035, .275]]) {
  const portEdge = new THREE.Mesh(new THREE.BoxGeometry(width, height, .035), darkMetal);
  portEdge.position.set(x, y, .382);
  gun.add(portEdge);
}
const actionBolt = new THREE.Group();
const exposedBolt = new THREE.Mesh(new THREE.BoxGeometry(.39, .16, .022), wornMetal);
exposedBolt.position.set(-1.51, .08, .382);
actionBolt.add(exposedBolt);
const boltHandle = new THREE.Mesh(new THREE.SphereGeometry(.075, 16, 10), darkMetal);
boltHandle.position.set(-1.2, .03, .43);
actionBolt.add(boltHandle);
const extractor = new THREE.Mesh(new THREE.BoxGeometry(.13, .035, .035), gunBlack);
extractor.position.set(-1.32, .12, .405);
actionBolt.add(extractor);
gun.add(actionBolt);
const loadingPort = new THREE.Mesh(new THREE.BoxGeometry(.58, .025, .33), gunBlack);
loadingPort.position.set(-1.48, -.42, 0);
gun.add(loadingPort);
const carrier = new THREE.Mesh(new THREE.BoxGeometry(.48, .018, .24), brassDetail);
carrier.position.set(-1.47, -.438, 0);
gun.add(carrier);
const rearSight = new THREE.Mesh(new THREE.BoxGeometry(.16, .105, .25), gunBlack);
rearSight.position.set(-1.05, .51, 0);
gun.add(rearSight);
const rearSightNotch = new THREE.Mesh(new THREE.BoxGeometry(.055, .12, .07), wornMetal);
rearSightNotch.position.set(-1.02, .55, 0);
gun.add(rearSightNotch);
for (const x of [-1.92, -1.5]) {
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, .025, 12), gunBlack);
  pin.rotation.x = Math.PI / 2;
  pin.position.set(x, -.1, .37);
  gun.add(pin);
}
const safety = new THREE.Mesh(new THREE.CylinderGeometry(.055, .055, .78, 14), new THREE.MeshStandardMaterial({ color: 0x7f1d17, roughness: .35, metalness: .35 }));
safety.rotation.x = Math.PI / 2;
safety.position.set(-1.92, -.26, 0);
gun.add(safety);
for (const side of [-1, 1]) {
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(.82, .16), makeGunDecal("12 GA · LC-06"));
  decal.position.set(-1.68, .22, side * .356);
  decal.rotation.y = side < 0 ? Math.PI : 0;
  gun.add(decal);
}
for (const x of [-2.08, -1.78, -1.25]) {
  const screw = new THREE.Mesh(new THREE.CylinderGeometry(.052, .052, .02, 16), gunBlack);
  screw.rotation.x = Math.PI / 2;
  screw.position.set(x, .08, .374);
  gun.add(screw);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(.075, .012, .012), wornMetal);
  slot.position.set(x, .08, .387);
  gun.add(slot);
}

const stockShape = new THREE.Shape();
stockShape.moveTo(-1.38, -.43);
stockShape.lineTo(-1.42, .36);
stockShape.quadraticCurveTo(-.62, .45, .1, .27);
stockShape.lineTo(1.15, .1);
stockShape.lineTo(1.18, -.22);
stockShape.quadraticCurveTo(.2, -.28, -.46, -.5);
stockShape.closePath();
const stockGeometry = new THREE.ExtrudeGeometry(stockShape, { depth: .69, bevelEnabled: true, bevelSegments: 3, bevelSize: .055, bevelThickness: .055 });
stockGeometry.translate(0, 0, -.345);
const stock = new THREE.Mesh(stockGeometry, wood);
stock.rotation.z = -.035;
stock.position.set(-3.43, -.12, 0);
gun.add(stock);
const cheekRest = new THREE.Mesh(new THREE.BoxGeometry(1.25, .13, .58), woodDark);
cheekRest.position.set(-3.08, .16, 0);
cheekRest.rotation.z = -.08;
gun.add(cheekRest);
const buttPlate = new THREE.Mesh(new THREE.BoxGeometry(.14, .86, .82), gunBlack);
buttPlate.position.set(-4.72, -.25, 0);
buttPlate.rotation.z = -.07;
gun.add(buttPlate);
for (let y = -.54; y <= .08; y += .14) {
  const groove = new THREE.Mesh(new THREE.BoxGeometry(.025, .025, .72), wornMetal);
  groove.position.set(-4.8, y, 0);
  groove.rotation.z = -.07;
  gun.add(groove);
}
const grip = new THREE.Mesh(new THREE.CylinderGeometry(.24, .31, 1.18, 18), woodDark);
grip.position.set(-2.13, -.73, 0);
grip.rotation.z = -.26;
gun.add(grip);
for (const side of [-1, 1]) {
  for (let row = 0; row < 5; row += 1) {
    const checkering = new THREE.Mesh(new THREE.BoxGeometry(.58, .018, .012), woodDark);
    checkering.position.set(-3.66 + row * .13, -.18 + row * .035, side * .357);
    checkering.rotation.set(0, side < 0 ? Math.PI : 0, .55);
    gun.add(checkering);
  }
  const actionBar = new THREE.Mesh(new THREE.BoxGeometry(1.7, .045, .035), wornMetal);
  actionBar.position.set(-.2, -.24, side * .17);
  gun.add(actionBar);
}
const triggerGuard = new THREE.Mesh(new THREE.TorusGeometry(.31, .052, 10, 20, Math.PI * 1.45), darkMetal);
triggerGuard.rotation.set(Math.PI / 2, 0, -.58);
triggerGuard.position.set(-1.58, -.55, 0);
gun.add(triggerGuard);
const trigger = new THREE.Mesh(new THREE.BoxGeometry(.05, .34, .08), brassDetail);
trigger.position.set(-1.62, -.57, 0);
trigger.rotation.z = -.25;
gun.add(trigger);
const slingLoop = new THREE.Mesh(new THREE.TorusGeometry(.13, .025, 8, 20), wornMetal);
slingLoop.rotation.x = Math.PI / 2;
slingLoop.position.set(-4.2, -.63, 0);
gun.add(slingLoop);
gun.traverse((object) => {
  if (object.isMesh) object.castShadow = object.receiveShadow = true;
});
const muzzleLight = new THREE.PointLight(0xffb14a, 0, 6, 2);
muzzleLight.position.set(2.95, .15, 0);
gun.add(muzzleLight);
gun.position.set(0, -.16, 0);
gun.scale.setScalar(.62);
gun.rotation.y = 0;
gun.rotation.z = .04;
scene.add(gun);

const shells = new THREE.Group();
const redShell = new THREE.MeshStandardMaterial({ color: 0xb3261d, roughness: .48, metalness: .05 });
const blueShell = new THREE.MeshStandardMaterial({ color: 0x246f9f, roughness: .48, metalness: .05 });
const brass = new THREE.MeshStandardMaterial({ color: 0xb38a42, roughness: .3, metalness: .7 });
const primer = new THREE.MeshStandardMaterial({ color: 0x6f6d65, roughness: .25, metalness: .88 });
const spentShells = new THREE.Group();
const spentShellBodies = [];

function makeShotgunShell(type, spent = false) {
  const shell = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.12, .12, .72, 16), type === "live" ? redShell : blueShell);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(.13, .13, .16, 12), brass);
  cap.position.y = -.43;
  const primerDisc = new THREE.Mesh(new THREE.CylinderGeometry(.052, .052, .006, 12), primer);
  primerDisc.position.y = -.515;
  if (spent) primerDisc.scale.setScalar(.72);
  shell.add(body, cap, primerDisc);
  shell.rotation.z = Math.PI / 2;
  shell.userData.shellType = type;
  shell.traverse((object) => {
    if (object.isMesh) object.castShadow = object.receiveShadow = true;
  });
  return shell;
}

function removeShotgunShell(parent, shell) {
  parent.remove(shell);
  shell.traverse((object) => object.geometry?.dispose());
}

function prepareLoadingShells(sequence, loadStart = 1_500) {
  shells.traverse((object) => object.geometry?.dispose());
  shells.clear();
  sequence.forEach((type, index) => {
    const shell = makeShotgunShell(type);
    const rowOffset = (sequence.length - 1) * .21;
    shell.position.set(-rowOffset + index * .42, -.42, 1.62 + Math.abs(index - (sequence.length - 1) / 2) * .025);
    shell.userData.restPosition = shell.position.clone();
    shell.userData.revealAt = index * 145;
    shell.userData.loadAt = loadStart + index * 310;
    shell.visible = false;
    shells.add(shell);
  });
}

function ejectSpentShell(type) {
  const shell = makeShotgunShell(type, true);
  const gunRotation = gun.getWorldQuaternion(new THREE.Quaternion());
  shell.position.copy(gun.localToWorld(new THREE.Vector3(-1.2, .08, .46)));
  shell.quaternion.copy(gunRotation);
  shell.rotateZ(Math.PI / 2);
  spentShells.add(shell);
  spentShellBodies.push({
    shell,
    bornAt: performance.now(),
    velocity: new THREE.Vector3(.12 + Math.random() * .24, 1.05 + Math.random() * .28, 1.55 + Math.random() * .38).applyQuaternion(gunRotation),
    spin: new THREE.Vector3(8 + Math.random() * 5, 12 + Math.random() * 7, 7 + Math.random() * 5),
    bounces: 0
  });
  while (spentShellBodies.length > 18) {
    const oldest = spentShellBodies.shift();
    removeShotgunShell(spentShells, oldest.shell);
  }
  playTone(118, .06, "triangle", .04);
}

scene.add(shells, spentShells);

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
  { id: "mariner", coat: 0x7f302b, shirt: 0x211a17, skin: 0xa96f55, hair: 0x1a110e, accent: 0xd7ff3f, eldritch: 0x3d6657, head: [1, 1.08, .94], hat: "flat", mutation: "gills" },
  { id: "witness", coat: 0x28556b, shirt: 0xb8b39f, skin: 0x704738, hair: 0x0e0c0b, accent: 0x79c8ef, eldritch: 0x3f7773, head: [.92, 1.02, 1], hat: "glasses", mutation: "gills" },
  { id: "host", coat: 0x4e6030, shirt: 0x29241d, skin: 0xbd8569, hair: 0x2b1d16, accent: 0xc6df5a, eldritch: 0x58653a, head: [1.05, .98, .92], hat: "beanie", mutation: "thirdEye" },
  { id: "scholar", coat: 0x603760, shirt: 0x211921, skin: 0x845a49, hair: 0x170f17, accent: 0xd88adc, eldritch: 0x614064, head: [.9, 1.12, .92], hat: "patch", mutation: "horns" },
  { id: "penitent", coat: 0x755224, shirt: 0x2d271e, skin: 0xb9795a, hair: 0x352015, accent: 0xe1a94b, eldritch: 0x6a5635, head: [1.08, 1, .96], hat: "band", mutation: "spines" },
  { id: "hollow", coat: 0x285d53, shirt: 0x192c28, skin: 0x604238, hair: 0x0f1816, accent: 0x68d8c0, eldritch: 0x335f55, head: [.95, 1.06, .94], hat: "hood", mutation: "thirdEye" }
];
const characterProfileById = new Map(characterProfiles.map((profile, index) => [profile.id, { ...profile, index }]));
const organicCanvas = document.createElement("canvas");
organicCanvas.width = organicCanvas.height = 128;
const organicContext = organicCanvas.getContext("2d");
const organicPixels = organicContext.createImageData(128, 128);
for (let i = 0; i < organicPixels.data.length; i += 4) {
  const grain = 105 + Math.random() * 110;
  organicPixels.data[i] = grain;
  organicPixels.data[i + 1] = grain;
  organicPixels.data[i + 2] = grain;
  organicPixels.data[i + 3] = 255;
}
organicContext.putImageData(organicPixels, 0, 0);
const organicBump = new THREE.CanvasTexture(organicCanvas);
organicBump.wrapS = organicBump.wrapT = THREE.RepeatWrapping;
organicBump.repeat.set(3, 3);

function makeCharacter(characterId) {
  const profile = characterProfileById.get(characterId);
  if (!profile) throw new Error(`Bilinmeyen 3B karakter: ${characterId}`);
  const seat = new THREE.Group();
  const chairMaterial = new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: .8 });
  const clothing = new THREE.MeshStandardMaterial({ color: profile.coat, emissive: profile.coat, emissiveIntensity: .16, roughness: .8, bumpMap: organicBump, bumpScale: .018 });
  const shirt = new THREE.MeshStandardMaterial({ color: profile.shirt, emissive: profile.shirt, emissiveIntensity: .11, roughness: .86, bumpMap: organicBump, bumpScale: .012 });
  const skin = new THREE.MeshStandardMaterial({ color: profile.skin, emissive: 0x301811, emissiveIntensity: .24, roughness: .82, bumpMap: organicBump, bumpScale: .012 });
  const hairMaterial = new THREE.MeshStandardMaterial({ color: profile.hair, roughness: .95 });
  const accentMaterial = new THREE.MeshStandardMaterial({ color: profile.accent, emissive: profile.accent, emissiveIntensity: .65, roughness: .55 });
  const eldritchMaterial = new THREE.MeshStandardMaterial({ color: profile.eldritch, emissive: profile.eldritch, emissiveIntensity: .18, roughness: .72 });
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
  mesh(new THREE.BoxGeometry(.38, .82, .08), clothing, body, [-.23, .57, -.62], [0,0,-.2]);
  mesh(new THREE.BoxGeometry(.38, .82, .08), clothing, body, [.23, .57, -.62], [0,0,.2]);
  mesh(new THREE.BoxGeometry(1.05, .12, .16), black, body, [0, -.08, -.48]);
  for (const y of [.22, .5, .78]) mesh(new THREE.SphereGeometry(.045, 10, 8), accentMaterial, body, [0, y, -.68]);
  mesh(new THREE.SphereGeometry(.19, 12, 8), clothing, body, [-.57, .86, -.02]);
  mesh(new THREE.SphereGeometry(.19, 12, 8), clothing, body, [.57, .86, -.02]);
  mesh(new THREE.CylinderGeometry(.18, .2, .28, 10), skin, headRig, [0, 1.25, -.05]);
  const head = mesh(new THREE.SphereGeometry(.43, 20, 16), skin, headRig, [0, 1.68, -.08], [0,0,0], profile.head);
  mesh(new THREE.ConeGeometry(.09, .25, 10), skin, headRig, [0, 1.66, -.49], [Math.PI / 2, 0, 0]);
  mesh(new THREE.SphereGeometry(.31, 18, 12), skin, headRig, [0, 1.49, -.14], [0,0,0], [1.08,.56,.92]);
  for (const side of [-1, 1]) {
    mesh(new THREE.SphereGeometry(.13, 14, 10), skin, headRig, [side * .31, 1.6, -.37], [0,0,side * .08], [1.15,.62,.72]);
    mesh(new THREE.SphereGeometry(.105, 14, 10), skin, headRig, [side * .45, 1.67, -.07], [0,0,side * .12], [.48,1,.7]);
  }
  mesh(new THREE.BoxGeometry(.28, .035, .025), black, headRig, [0, 1.48, -.48], [.05,0,0]);
  mesh(new THREE.BoxGeometry(.18, .025, .018), accentMaterial, headRig, [.03, 1.435, -.465], [0,0,-.06]);
  const eyeMaterial = new THREE.MeshStandardMaterial({ color: profile.accent, emissive: profile.accent, emissiveIntensity: 3 });
  for (const side of [-1, 1]) {
    mesh(new THREE.SphereGeometry(.038, 8, 6), eyeMaterial, headRig, [side * .15, 1.72, -.47]);
    mesh(new THREE.BoxGeometry(.19, .035, .035), hairMaterial, headRig, [side * .15, 1.84, -.46], [0,0,side * -.12]);
  }
  for (let wrinkle = 0; wrinkle < 3; wrinkle += 1) {
    mesh(new THREE.TorusGeometry(.16 + wrinkle * .025, .008, 5, 18, Math.PI * .7), hairMaterial, headRig, [0, 1.88 + wrinkle * .045, -.4], [0,0,.42]);
  }
  if (profile.index % 2) {
    mesh(new THREE.BoxGeometry(.012, .27, .018), accentMaterial, headRig, [-.19, 1.68, -.485], [0,0,-.32]);
  }

  if (profile.mutation === "gills") {
    for (const side of [-1, 1]) {
      for (let gill = 0; gill < 3; gill += 1) {
        mesh(new THREE.ConeGeometry(.12, .34, 8), eldritchMaterial, headRig, [side * .43, 1.62 - gill * .14, -.08], [0,0,side * -Math.PI / 2], [1,.55,1]);
      }
    }
  } else if (profile.mutation === "horns") {
    mesh(new THREE.ConeGeometry(.13, .72, 12), eldritchMaterial, headRig, [-.27, 2.18, -.04], [0,0,.28]);
    mesh(new THREE.ConeGeometry(.13, .72, 12), eldritchMaterial, headRig, [.27, 2.18, -.04], [0,0,-.28]);
  } else if (profile.mutation === "spines") {
    for (const side of [-1, 1]) {
      for (let spine = 0; spine < 3; spine += 1) mesh(new THREE.ConeGeometry(.08, .36, 8), eldritchMaterial, body, [side * (.5 + spine * .1), .95 - spine * .22, .02], [0,0,side * -.8]);
    }
  }

  if (profile.mutation === "thirdEye" || profile.index % 2 === 0) {
    mesh(new THREE.SphereGeometry(.062, 12, 10), eyeMaterial, headRig, [0, 1.94, -.43], [0,0,0], [1,1.25,.5]);
    mesh(new THREE.TorusGeometry(.095, .018, 8, 18), eldritchMaterial, headRig, [0, 1.94, -.44]);
  } else {
    for (const side of [-1, 1]) {
      mesh(new THREE.SphereGeometry(.034, 10, 8), eyeMaterial, headRig, [side * .27, 1.6, -.43], [0,0,0], [1,1.15,.55]);
      mesh(new THREE.SphereGeometry(.026, 10, 8), eyeMaterial, headRig, [side * .3, 1.51, -.39], [0,0,0], [1,1.1,.5]);
    }
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
    for (const finger of [-1, 0, 1]) {
      mesh(new THREE.ConeGeometry(.026, .2, 8), eldritchMaterial, handRig, [finger * .065, -.12, -.15], [Math.PI / 2, 0, finger * .08]);
    }
    body.add(armRig, handRig);
  };
  setupArm(-1, leftArm, leftHand);
  setupArm(1, rightArm, rightHand);
  for (const side of [-1,1]) {
    mesh(new THREE.CylinderGeometry(.2, .22, .92, 10), clothing, body, [side*.34, -.66, .25], [Math.PI/2.25,0,0]);
    mesh(new THREE.BoxGeometry(.36, .26, .72), black, body, [side*.34, -1.05, -.25]);
  }
  seat.add(chairBack, chairSeat, body, headRig);
  const activeRing = new THREE.Mesh(new THREE.TorusGeometry(.94, .055, 10, 40), new THREE.MeshStandardMaterial({ color: profile.accent, emissive: profile.accent, emissiveIntensity: 2.8, transparent: true, opacity: .92 }));
  activeRing.rotation.x = Math.PI / 2;
  activeRing.position.y = -.73;
  activeRing.visible = false;
  const targetRing = new THREE.Mesh(new THREE.TorusGeometry(1.13, .045, 10, 48), new THREE.MeshStandardMaterial({ color: 0xff5c3b, emissive: 0xff2d12, emissiveIntensity: 3.2, transparent: true, opacity: .95 }));
  targetRing.rotation.x = Math.PI / 2;
  targetRing.position.y = -.71;
  targetRing.visible = false;
  const seatGlow = new THREE.PointLight(profile.accent, 42, 4.8, 1.8);
  seatGlow.position.set(0, 1.65, -1.28);
  const faceLight = new THREE.PointLight(0xd8c7ac, 24, 3.2, 2);
  faceLight.position.set(0, 2.05, -1.05);
  seat.add(activeRing, targetRing, seatGlow, faceLight);
  seat.userData.activeRing = activeRing;
  seat.userData.targetRing = targetRing;
  seat.userData.body = body;
  seat.userData.head = headRig;
  seat.userData.leftArm = leftArm;
  seat.userData.rightArm = rightArm;
  seat.userData.leftHand = leftHand;
  seat.userData.rightHand = rightHand;
  seat.userData.hit = 0;
  seat.userData.action = 0;
  seat.userData.blankPulse = 0;
  seat.userData.exploded = false;
  seat.userData.baseAngle = 0;
  seat.userData.label = null;
  seat.userData.labelName = "";
  seat.userData.characterId = characterId;
  return seat;
}

for (let i = 0; i < 6; i += 1) {
  const angle = seatAngle(i);
  const position = radialPoint(angle, SEAT_RADIUS);
  const seat = makeCharacter(characterProfiles[i].id);
  seat.position.set(position.x, -1.08, position.z);
  seat.rotation.y = -angle + Math.PI / 2;
  seat.userData.baseAngle = seat.rotation.y;
  seat.visible = false;
  scene.add(seat);
  seats.push(seat);
}

function disposeGroup(group) {
  group.traverse((object) => {
    object.geometry?.dispose();
    if (Array.isArray(object.material)) {
      object.material.forEach((material) => {
        material.map?.dispose();
        material.dispose();
      });
    } else if (object.material) {
      object.material.map?.dispose();
      object.material.dispose();
    }
  });
}

function ensureSeatCharacter(index, characterId, forceRebuild = false) {
  const currentSeat = seats[index];
  if (!forceRebuild && currentSeat?.userData.characterId === characterId) return currentSeat;
  const angle = seatAngle(index);
  const position = radialPoint(angle, SEAT_RADIUS);
  const nextSeat = makeCharacter(characterId);
  nextSeat.position.set(position.x, -1.08, position.z);
  nextSeat.rotation.y = -angle + Math.PI / 2;
  nextSeat.userData.baseAngle = nextSeat.rotation.y;
  nextSeat.visible = currentSeat?.visible ?? false;
  scene.add(nextSeat);
  if (currentSeat) {
    scene.remove(currentSeat);
    disposeGroup(currentSeat);
  }
  seats[index] = nextSeat;
  return nextSeat;
}

function placeSeatForPlayer(seat, playerIndex, playerCount) {
  const angle = playerSeatAngle(playerIndex, playerCount);
  const position = radialPoint(angle, SEAT_RADIUS);
  seat.position.set(position.x, -1.08, position.z);
  seat.rotation.y = -angle + Math.PI / 2;
  seat.userData.baseAngle = seat.rotation.y;
}

const deathEffects = new THREE.Group();
const deathBodies = [];
const deathPuddles = [];
const bloodMaterial = new THREE.MeshPhysicalMaterial({ color: 0x690705, emissive: 0x250100, emissiveIntensity: .4, roughness: .58, metalness: .02, clearcoat: .32, clearcoatRoughness: .4 });
const fleshMaterial = new THREE.MeshStandardMaterial({ color: 0x7c2419, emissive: 0x260402, emissiveIntensity: .24, roughness: .8 });
const boneMaterial = new THREE.MeshStandardMaterial({ color: 0xd0c0a2, roughness: .9 });
const deathLight = new THREE.PointLight(0xbd160b, 0, 8, 2);
let deathLightEnergy = 0;
scene.add(deathEffects, deathLight);

function clearDeathEffects(ownerId = null) {
  const materials = new Set();
  for (let index = deathBodies.length - 1; index >= 0; index -= 1) {
    const body = deathBodies[index];
    if (ownerId && body.ownerId !== ownerId) continue;
    deathEffects.remove(body.mesh);
    body.mesh.geometry?.dispose();
    if (body.ownedMaterial) materials.add(body.mesh.material);
    deathBodies.splice(index, 1);
  }
  for (let index = deathPuddles.length - 1; index >= 0; index -= 1) {
    const puddle = deathPuddles[index];
    if (ownerId && puddle.ownerId !== ownerId) continue;
    deathEffects.remove(puddle.mesh);
    puddle.mesh.geometry?.dispose();
    puddle.mesh.material?.dispose();
    deathPuddles.splice(index, 1);
  }
  materials.forEach((material) => material?.dispose());
}

function showDeathBlood(index) {
  const seat = seats[index];
  if (!seat || !ui.deathBlood) return;
  const projected = seat.localToWorld(new THREE.Vector3(0, 1.15, -.15)).project(camera);
  const x = Math.min(92, Math.max(8, (projected.x * .5 + .5) * 100));
  const y = Math.min(86, Math.max(12, (-projected.y * .5 + .5) * 100));
  ui.deathBlood.style.setProperty("--blood-x", `${x}%`);
  ui.deathBlood.style.setProperty("--blood-y", `${y}%`);
  ui.deathBlood.innerHTML = Array.from({ length: 24 }, (_, particle) => {
    const angle = particle / 24 * Math.PI * 2 + (particle % 5) * .11;
    const distance = 90 + (particle % 7) * 25;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance + 55 + (particle % 3) * 18;
    const size = 5 + (particle % 6) * 2.4;
    return `<i style="--blood-dx:${dx.toFixed(1)}px;--blood-dy:${dy.toFixed(1)}px;--blood-size:${size.toFixed(1)}px;--blood-rotate:${(angle * 57.3).toFixed(1)}deg;--blood-delay:${(particle % 4) * .018}s;--blood-duration:${1.05 + (particle % 5) * .11}s"></i>`;
  }).join("");
  clearTimeout(deathBloodTimer);
  ui.deathBlood.classList.remove("hidden");
  void ui.deathBlood.offsetWidth;
  deathBloodTimer = setTimeout(() => {
    ui.deathBlood.classList.add("hidden");
    ui.deathBlood.innerHTML = "";
  }, 1850);
}

function addDeathBody({ ownerId, mesh, position, velocity, spin, floorY, ownedMaterial = false }) {
  mesh.position.copy(position);
  mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
  mesh.castShadow = mesh.receiveShadow = true;
  deathEffects.add(mesh);
  deathBodies.push({ ownerId, mesh, velocity, spin, floorY, bounces: 0, bornAt: performance.now(), ownedMaterial });
}

function explodeCharacter(index, ownerId) {
  const seat = seats[index];
  if (!seat?.visible || seat.userData.exploded) return;
  seat.userData.exploded = true;
  seat.userData.body.visible = false;
  seat.userData.head.visible = false;
  seat.userData.activeRing.visible = false;
  seat.userData.targetRing.visible = false;
  if (seat.userData.label) seat.userData.label.visible = false;

  const profile = characterProfileById.get(seat.userData.characterId) ?? characterProfiles[0];
  const coatMaterial = new THREE.MeshStandardMaterial({ color: profile.coat, roughness: .82, bumpMap: organicBump, bumpScale: .018 });
  const skinMaterial = new THREE.MeshStandardMaterial({ color: profile.skin, emissive: 0x2d0906, emissiveIntensity: .2, roughness: .78 });
  const worldQuaternion = seat.getWorldQuaternion(new THREE.Quaternion());
  const blastAxis = seat.position.clone().setY(0).normalize();
  const worldAt = (x, y, z) => seat.localToWorld(new THREE.Vector3(x, y, z));
  const launch = (side, lift = 2.8, force = 1.25) => new THREE.Vector3(
    blastAxis.x * force + side * (1.05 + Math.random() * .9),
    lift + Math.random() * 1.9,
    blastAxis.z * force + (Math.random() - .5) * 1.6
  );
  const fragments = [
    { geometry: new THREE.DodecahedronGeometry(.43, 0), material: skinMaterial, local: [0, 1.69, -.08], side: -.25, lift: 3.6 },
    { geometry: new THREE.DodecahedronGeometry(.48, 0), material: coatMaterial, local: [-.18, .62, 0], side: -.62, lift: 3.1 },
    { geometry: new THREE.DodecahedronGeometry(.46, 0), material: coatMaterial, local: [.2, .38, .02], side: .58, lift: 2.9 },
    { geometry: new THREE.CylinderGeometry(.14, .18, .72, 8), material: coatMaterial, local: [-.62, .48, -.25], side: -1.1, lift: 3.25 },
    { geometry: new THREE.CylinderGeometry(.14, .18, .72, 8), material: coatMaterial, local: [.62, .48, -.25], side: 1.1, lift: 3.45 },
    { geometry: new THREE.CylinderGeometry(.17, .2, .82, 8), material: coatMaterial, local: [-.34, -.48, .05], side: -.72, lift: 2.55 },
    { geometry: new THREE.CylinderGeometry(.17, .2, .82, 8), material: coatMaterial, local: [.34, -.48, .05], side: .8, lift: 2.75 },
    { geometry: new THREE.CylinderGeometry(.085, .095, .46, 8), material: fleshMaterial, local: [-.23, .72, -.02], side: -.32, lift: 3.9 },
    { geometry: new THREE.CylinderGeometry(.075, .085, .42, 8), material: boneMaterial, local: [.2, .68, -.01], side: .4, lift: 4.15 },
    { geometry: new THREE.TetrahedronGeometry(.24, 0), material: fleshMaterial, local: [0, 1.22, -.04], side: .18, lift: 3.75 }
  ];
  fragments.forEach((fragment) => {
    const mesh = new THREE.Mesh(fragment.geometry, fragment.material);
    mesh.quaternion.copy(worldQuaternion);
    addDeathBody({
      ownerId,
      mesh,
      position: worldAt(...fragment.local),
      velocity: launch(fragment.side, fragment.lift, 1.1 + Math.random() * .75),
      spin: new THREE.Vector3((Math.random() - .5) * 12, (Math.random() - .5) * 14, (Math.random() - .5) * 12),
      floorY: -2.52,
      ownedMaterial: fragment.material === coatMaterial || fragment.material === skinMaterial
    });
  });
  for (let particle = 0; particle < 32; particle += 1) {
    const size = .025 + Math.random() * .065;
    const drop = new THREE.Mesh(new THREE.SphereGeometry(size, 7, 5), bloodMaterial);
    const side = (Math.random() - .5) * 2.8;
    addDeathBody({
      ownerId,
      mesh: drop,
      position: worldAt((Math.random() - .5) * .75, .45 + Math.random() * 1.25, -.08),
      velocity: launch(side, 1.8 + Math.random() * 3.3, .45 + Math.random() * 1.3),
      spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
      floorY: -2.56
    });
  }

  const stainDirection = seat.position.clone().setY(0).normalize().multiplyScalar(4.62);
  const puddleMaterial = new THREE.MeshStandardMaterial({ color: 0x4c0302, emissive: 0x160000, emissiveIntensity: .35, roughness: .38, transparent: true, opacity: .82, depthWrite: false });
  const puddle = new THREE.Mesh(new THREE.CircleGeometry(.84, 30), puddleMaterial);
  puddle.rotation.x = -Math.PI / 2;
  puddle.rotation.z = Math.random() * Math.PI;
  puddle.position.set(stainDirection.x, -.775, stainDirection.z);
  puddle.scale.set(.08, .08, .08);
  puddle.receiveShadow = true;
  deathEffects.add(puddle);
  deathPuddles.push({ ownerId, mesh: puddle, bornAt: performance.now() });

  deathLight.position.copy(worldAt(0, .8, 0));
  deathLightEnergy = 1;
  cameraShake = 1.75;
  showDeathBlood(index);
  playTone(48, .62, "sawtooth", .12);
  setTimeout(() => playTone(72, .38, "square", .07), 90);
}

const itemTrays = [];
const trayMaterial = new THREE.MeshStandardMaterial({ color: 0x181c18, roughness: .84, metalness: .08 });
const trayEdgeMaterial = new THREE.MeshStandardMaterial({ color: 0x706149, roughness: .48, metalness: .36 });
for (let i = 0; i < 6; i += 1) {
  const angle = itemTrayAngle(i);
  const position = radialPoint(angle, ITEM_TRAY_RADIUS);
  const tray = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.72, .1, 1), trayMaterial.clone());
  base.receiveShadow = true;
  tray.add(base);
  for (const z of [-.48, .48]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(2.82, .12, .055), trayEdgeMaterial);
    edge.position.set(0, .08, z);
    tray.add(edge);
  }
  for (const x of [-1.38, 1.38]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(.055, .12, 1), trayEdgeMaterial);
    edge.position.set(x, .08, 0);
    tray.add(edge);
  }
  const props = new THREE.Group();
  props.position.y = .1;
  tray.add(props);
  for (const [x, z] of ITEM_SLOT_POSITIONS) {
    const slotMaterial = new THREE.MeshStandardMaterial({ color: 0x43514a, emissive: 0x0d1713, emissiveIntensity: .28, roughness: .76, metalness: .24 });
    const slotRing = new THREE.Mesh(new THREE.TorusGeometry(.205, .018, 8, 24), slotMaterial);
    slotRing.rotation.x = Math.PI / 2;
    slotRing.position.set(x, .09, z);
    const slotInset = new THREE.Mesh(new THREE.CylinderGeometry(.18, .18, .012, 20), trayMaterial);
    slotInset.position.set(x, .065, z);
    tray.add(slotRing, slotInset);
  }
  tray.position.set(position.x, -.72, position.z);
  tray.rotation.y = -angle + Math.PI / 2;
  tray.userData.props = props;
  tray.userData.signature = "";
  tray.userData.base = base;
  tray.visible = false;
  scene.add(tray);
  itemTrays.push(tray);
}
let itemPulseUntil = 0;
let itemPulsePlayerId = null;

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
  prop.scale.setScalar(.68);
  return prop;
}

function syncItemProps(players) {
  itemTrays.forEach((tray, playerIndex) => {
    const player = players[playerIndex];
    const physicalSlot = playerSeatSlot(playerIndex, players.length);
    const trayAngle = itemTrayAngle(physicalSlot);
    const trayPosition = radialPoint(trayAngle, ITEM_TRAY_RADIUS);
    tray.position.set(trayPosition.x, -.72, trayPosition.z);
    tray.rotation.y = -trayAngle + Math.PI / 2;
    tray.visible = state?.phase === "playing" && Boolean(player?.alive);
    if (!player) return;
    tray.userData.base.material.color.set(player.id === state.viewerId ? 0x28331f : 0x181c18);
    tray.userData.base.material.emissive.set(player.id === state.currentPlayerId ? 0x26330f : 0x000000);
    tray.userData.base.material.emissiveIntensity = player.id === state.currentPlayerId ? .55 : 0;
    const signature = player.items.join("|");
    if (signature === tray.userData.signature) return;
    tray.userData.signature = signature;
    const props = tray.userData.props;
    props.traverse((object) => {
      object.geometry?.dispose();
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
      else object.material?.dispose();
    });
    props.clear();
    player.items.slice(0, player.itemLimit).forEach((item, index) => {
      const prop = makeItemProp(item);
      const [x, z] = ITEM_SLOT_POSITIONS[index];
      prop.position.set(x, .02, z);
      prop.rotation.y = (index % 2 ? -.09 : .09) + (index > 2 ? .04 : -.04);
      prop.userData.baseY = .02;
      prop.scale.multiplyScalar(.62);
      props.add(prop);
    });
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
const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: 0x86b6aa, size: .024, transparent: true, opacity: .3 }));
scene.add(dust);

function syncSeats(players) {
  players.forEach((player, index) => {
    const reviveExplodedSeat = Boolean(player.alive && seats[index]?.userData.exploded);
    if (reviveExplodedSeat) clearDeathEffects(player.id);
    const seat = ensureSeatCharacter(index, player.character, reviveExplodedSeat);
    placeSeatForPlayer(seat, index, players.length);
  });
  seats.forEach((seat, index) => {
    const player = players[index];
    const hideLocalBody = state?.phase === "playing" && player?.id === state.viewerId;
    seat.visible = index < players.length && !hideLocalBody;
    if (index < players.length) {
      seat.scale.setScalar(seat.userData.exploded ? 1 : (player.alive ? 1 : .88));
      seat.rotation.z = seat.userData.exploded ? 0 : (player.alive ? 0 : -.18);
      seat.userData.activeRing.visible = !seat.userData.exploded && player.id === state.currentPlayerId;
      seat.userData.targetRing.visible = !seat.userData.exploded && player.id === effectiveAimTargetId();
      if (seat.userData.labelName !== player.name) {
        if (seat.userData.label) seat.remove(seat.userData.label);
        seat.userData.label = makeNameSprite(player.name, player.id === state.viewerId ? "#d7ff3f" : "#8b877d");
        seat.userData.label.position.set(0, 2.65, .05);
        seat.add(seat.userData.label);
        seat.userData.labelName = player.name;
      }
      if (seat.userData.label) seat.userData.label.visible = !seat.userData.exploded;
    }
  });
  const current = players.find((player) => player.id === state.currentPlayerId);
  barrelAssembly.scale.x = current?.sawed ? .52 : 1;
  pendingGunPlayerId = effectiveAimTargetId();
}

function setHoveredTarget(playerId) {
  hoveredPlayerId = playerId;
  const effectiveTargetId = effectiveAimTargetId();
  updateAimIndicators(effectiveTargetId);
  pendingGunPlayerId = effectiveTargetId;
  aimGunAt(pendingGunPlayerId);
}

let desiredCamera = new THREE.Vector3(8.6, 7.1, 10.8);
const desiredCameraTarget = new THREE.Vector3(0, -.18, -.15);
const smoothedCameraTarget = desiredCameraTarget.clone();
let desiredFov = 42;
let desiredGunYaw = 0;
const desiredGunPosition = new THREE.Vector3(0, -.3, 0);
const smoothedGunPosition = desiredGunPosition.clone();
const gunDirectionScratch = new THREE.Vector3();
const cameraFallbackScratch = new THREE.Vector3();
const cameraFocusScratch = new THREE.Vector3();
const leftGunGrip = new THREE.Vector3(.2, -.12, -.2);
const rightGunGrip = new THREE.Vector3(-1.88, -.47, .18);
const leftGripScratch = new THREE.Vector3();
const rightGripScratch = new THREE.Vector3();
const leftHandRest = new THREE.Vector3(-.68, .05, -.92);
const rightHandRest = new THREE.Vector3(.68, .05, -.92);
let pendingGunPlayerId = null;
let shotLockUntil = 0;
let gunRecoil = 0;
let pumpAction = 0;
let muzzleEnergy = 0;
let cameraShake = 0;

function activeGunActorId() {
  return shotActorId && performance.now() < shotVisualUntil ? shotActorId : state?.currentPlayerId ?? null;
}

function aimGunAt(playerId, actorId = activeGunActorId()) {
  const actorIndex = state?.players.findIndex((player) => player.id === actorId) ?? -1;
  if (actorIndex < 0 || !seats[actorIndex]) return;
  const targetIndex = state.players.findIndex((player) => player.id === playerId);
  const actorPosition = seats[actorIndex].position;
  const direction = gunDirectionScratch;
  const selfAim = targetIndex === actorIndex;
  if (targetIndex >= 0 && !selfAim && seats[targetIndex]) {
    direction.subVectors(seats[targetIndex].position, actorPosition);
  } else if (selfAim) {
    direction.set(actorPosition.x, 0, actorPosition.z);
  } else {
    direction.set(-actorPosition.x, 0, -actorPosition.z);
  }
  if (direction.lengthSq() < .001) direction.set(1, 0, 0);
  direction.normalize();
  const holdOffset = selfAim ? -1.62 : 1.68;
  desiredGunPosition.set(
    actorPosition.x + direction.x * holdOffset,
    selfAim ? -.18 : -.32,
    actorPosition.z + direction.z * holdOffset
  );
  desiredGunYaw = -Math.atan2(direction.z, direction.x);
}

function cameraFocusForPlayer(viewerIndex, fallback) {
  const actorId = activeGunActorId();
  const actorIndex = state?.players.findIndex((player) => player.id === actorId) ?? -1;
  if (actorIndex < 0 || !seats[actorIndex]) return fallback;
  const targetId = effectiveAimTargetId();
  const targetIndex = state.players.findIndex((player) => player.id === targetId);
  const actorPosition = seats[actorIndex].position;
  if (viewerIndex === actorIndex) {
    if (targetIndex >= 0 && targetIndex !== actorIndex && seats[targetIndex]) {
      return cameraFocusScratch.set(seats[targetIndex].position.x, .12, seats[targetIndex].position.z);
    }
    if (targetIndex === actorIndex) {
      return cameraFocusScratch.set(actorPosition.x * .52, -.04, actorPosition.z * .52);
    }
    return fallback;
  }
  const focus = cameraFocusScratch.set(actorPosition.x, .04, actorPosition.z);
  if (targetIndex >= 0 && targetIndex !== actorIndex && seats[targetIndex]) {
    focus.x += (seats[targetIndex].position.x - focus.x) * .34;
    focus.z += (seats[targetIndex].position.z - focus.z) * .34;
  } else {
    focus.x *= .76;
    focus.z *= .76;
  }
  return focus;
}

function sceneMode(phase) {
  const portrait = innerWidth / innerHeight < .8;
  const viewerIndex = state?.players.findIndex((player) => player.id === state.viewerId) ?? -1;
  const firstPerson = phase === "playing" && viewerIndex >= 0;
  if (firstPerson) {
    const view = firstPersonViewForPlayer(viewerIndex, state.players.length);
    desiredCamera.set(view.position.x, view.position.y, view.position.z);
    desiredCameraTarget.set(view.target.x, view.target.y, view.target.z);
    desiredFov = portrait ? 66 : 60;
  } else {
    desiredCamera = portrait ? new THREE.Vector3(8.6, 7.1, 10.8) : new THREE.Vector3(6.1, 5.2, 7.9);
    desiredCameraTarget.set(0, -.18, -.15);
    desiredFov = 42;
  }
  gun.visible = phase !== "lobby";
  itemTrays.forEach((tray, index) => { tray.visible = phase === "playing" && Boolean(state?.players[index]?.alive); });
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

function showShotResult(result) {
  const actor = state?.players.find((player) => player.id === result.actorId);
  const target = state?.players.find((player) => player.id === result.targetId);
  const actorName = actor?.name ?? "OYUNCU";
  const targetLabel = result.selfShot ? `${target?.name ?? "OYUNCU"} · KENDİSİ` : target?.name ?? "HEDEF";
  const live = result.shell === "live";
  ui.shotRoute.textContent = `${actorName} → ${targetLabel}`;
  ui.shotOutcome.textContent = live ? "DOLU!" : "BOŞ · KLİK";
  ui.shotDetail.textContent = live
    ? (result.killed ? `${target?.name ?? "Hedef"} parçalandı · nihai ölüm` : (result.damage > 0 ? `${target?.name ?? "Hedef"} ${result.damage} can kaybetti` : "Atış perde tarafından durduruldu"))
    : (result.selfShot ? "Hasar yok · sıra aynı oyuncuda" : "Hasar yok · sıra ilerliyor");
  clearTimeout(shotResultTimer);
  ui.shotResult.classList.remove("hidden", "live", "blank");
  void ui.shotResult.offsetWidth;
  ui.shotResult.classList.add(live ? "live" : "blank");
  shotResultTimer = setTimeout(() => ui.shotResult.classList.add("hidden"), live ? 1850 : 2200);
}

function animateShot(result) {
  const live = result.shell === "live";
  const now = performance.now();
  shotActorId = result.actorId;
  shotTargetId = result.targetId;
  shotVisualUntil = now + (result.killed ? 2700 : (live ? 1900 : 2300));
  hoveredPlayerId = null;
  selectedTargetId = null;
  aimGunAt(result.targetId, result.actorId);
  pendingGunPlayerId = result.targetId;
  shotLockUntil = shotVisualUntil;
  gunRecoil = live ? 1 : .13;
  pumpAction = live ? 1 : 0;
  gun.rotation.z += live ? -.2 : .105;
  setTimeout(() => { gun.rotation.z = .04; }, live ? 170 : 360);
  const actorIndex = state?.players.findIndex((player) => player.id === result.actorId) ?? -1;
  const targetIndex = state?.players.findIndex((player) => player.id === result.targetId) ?? -1;
  if (seats[actorIndex]) seats[actorIndex].userData.action = 1;
  if (seats[targetIndex]) {
    seats[targetIndex].userData.hit = live ? 1 : 0;
    seats[targetIndex].userData.blankPulse = live ? 0 : 1;
  }
  ui.flash.classList.remove("fire", "blank");
  void ui.flash.offsetWidth;
  updateAimIndicators(result.targetId);
  updateTargetControls();
  showShotResult(result);
  if (live) {
    void ui.flash.offsetWidth;
    ui.flash.classList.add("fire");
    muzzleEnergy = 1;
    cameraShake = result.killed ? 1.4 : 1;
    playTone(85, .42, "sawtooth", .15);
    setTimeout(() => ejectSpentShell(result.shell), 235);
    if (result.killed && targetIndex >= 0) setTimeout(() => explodeCharacter(targetIndex, result.targetId), 105);
  } else {
    ui.flash.classList.add("blank");
    cameraShake = .16;
    playTone(225, .045, "square", .07);
    setTimeout(() => playTone(135, .065, "square", .055), 105);
    setTimeout(() => {
      pumpAction = 1;
      playTone(92, .09, "triangle", .045);
    }, 310);
    setTimeout(() => ejectSpentShell(result.shell), 520);
  }
}

function animateItem({ actorId, item }) {
  itemPulseUntil = performance.now() + 650;
  itemPulsePlayerId = actorId;
  const info = itemInfo[item];
  showToast(`${info?.name ?? "Ekipman"} kullanıldı.`);
  playTone(280, .13, "triangle", .055);
}

const clock = new THREE.Clock();
let previousFrameAt = performance.now();
function frame() {
  const frameNow = performance.now();
  const delta = Math.min(.034, Math.max(.001, (frameNow - previousFrameAt) / 1000));
  previousFrameAt = frameNow;
  const time = clock.getElapsedTime();
  if (shotTargetId && performance.now() >= shotVisualUntil) {
    shotTargetId = null;
    shotActorId = null;
    pendingGunPlayerId = effectiveAimTargetId();
    updateAimIndicators();
  }
  if (performance.now() > shotLockUntil) aimGunAt(pendingGunPlayerId);
  const viewerIndex = state?.players.findIndex((player) => player.id === state.viewerId) ?? -1;
  const firstPerson = state?.phase === "playing" && viewerIndex >= 0;
  const firstPersonView = firstPerson ? firstPersonViewForPlayer(viewerIndex, state.players.length) : null;
  if (firstPersonView) {
    desiredCamera.set(firstPersonView.position.x, firstPersonView.position.y, firstPersonView.position.z);
    cameraFallbackScratch.set(firstPersonView.target.x, firstPersonView.target.y, firstPersonView.target.z);
    const cameraFocus = cameraFocusForPlayer(viewerIndex, cameraFallbackScratch);
    desiredCameraTarget.copy(cameraFocus);
  }
  cameraShake *= .84;
  const cinematicCamera = desiredCamera.clone();
  if (firstPersonView) {
    const tangentX = -Math.sin(firstPersonView.angle);
    const tangentZ = Math.cos(firstPersonView.angle);
    const headSway = Math.sin(time * .7) * .018;
    cinematicCamera.x += tangentX * headSway + (Math.random() - .5) * cameraShake * .12;
    cinematicCamera.y += Math.sin(time * .9) * .01 + (Math.random() - .5) * cameraShake * .1;
    cinematicCamera.z += tangentZ * headSway + (Math.random() - .5) * cameraShake * .12;
  } else {
    cinematicCamera.x += Math.sin(time * .12) * .28 + (Math.random() - .5) * cameraShake * .18;
    cinematicCamera.y += Math.sin(time * .17) * .08 + (Math.random() - .5) * cameraShake * .12;
    cinematicCamera.z += Math.cos(time * .12) * .2;
  }
  camera.position.lerp(cinematicCamera, firstPerson ? .075 : .022);
  smoothedCameraTarget.lerp(desiredCameraTarget, firstPerson ? .09 : .04);
  camera.lookAt(smoothedCameraTarget);
  camera.fov += (desiredFov - camera.fov) * .08;
  if (Math.abs(camera.fov - desiredFov) > .01) camera.updateProjectionMatrix();
  const yawDelta = Math.atan2(Math.sin(desiredGunYaw - gun.rotation.y), Math.cos(desiredGunYaw - gun.rotation.y));
  gun.rotation.y += yawDelta * .075;
  gunRecoil *= .86;
  pumpAction *= .88;
  muzzleEnergy *= .76;
  smoothedGunPosition.lerp(desiredGunPosition, .105);
  gun.position.x = smoothedGunPosition.x - Math.cos(gun.rotation.y) * gunRecoil * .3;
  gun.position.z = smoothedGunPosition.z + Math.sin(gun.rotation.y) * gunRecoil * .3;
  gun.position.y = smoothedGunPosition.y + Math.sin(time * .7) * .014;
  pump.position.x = .35 - pumpAction * .52;
  actionBolt.position.x = -pumpAction * .3;
  carrier.position.y = -.438 + pumpAction * .075;
  carrier.rotation.z = pumpAction * -.12;
  muzzleLight.position.x = barrelAssembly.position.x + muzzle.position.x * barrelAssembly.scale.x + .22;
  muzzleLight.position.y = barrelAssembly.position.y + muzzle.position.y;
  muzzleLight.intensity = muzzleEnergy * 85;

  if (roundAnimationStart > 0 && shells.children.length) {
    const elapsed = frameNow - roundAnimationStart;
    const loadingPortWorld = gun.localToWorld(new THREE.Vector3(-1.48, -.43, 0));
    shells.children.forEach((shell) => {
      if (elapsed < shell.userData.revealAt) {
        shell.visible = false;
        return;
      }
      if (elapsed < shell.userData.loadAt) {
        const revealProgress = Math.min(1, (elapsed - shell.userData.revealAt) / 220);
        shell.visible = true;
        shell.position.copy(shell.userData.restPosition);
        shell.position.y += (1 - revealProgress) * .34;
        shell.scale.setScalar(.55 + revealProgress * .45);
        return;
      }
      const loadProgress = Math.min(1, (elapsed - shell.userData.loadAt) / 270);
      shell.visible = loadProgress < 1;
      shell.position.lerpVectors(shell.userData.restPosition, loadingPortWorld, loadProgress * loadProgress);
      shell.scale.setScalar(1 - loadProgress * .48);
      shell.rotation.x = loadProgress * Math.PI * 1.5;
      shell.rotation.z = Math.PI / 2 + loadProgress * .35;
    });
  }

  for (let index = spentShellBodies.length - 1; index >= 0; index -= 1) {
    const body = spentShellBodies[index];
    body.velocity.y -= 4.4 * delta;
    body.velocity.multiplyScalar(.992);
    body.shell.position.addScaledVector(body.velocity, delta);
    body.shell.rotation.x += body.spin.x * delta;
    body.shell.rotation.y += body.spin.y * delta;
    body.shell.rotation.z += body.spin.z * delta;
    if (body.shell.position.y < -.64) {
      body.shell.position.y = -.64;
      if (Math.abs(body.velocity.y) > .13 && body.bounces < 4) {
        body.velocity.y = Math.abs(body.velocity.y) * .38;
        body.velocity.x *= .68;
        body.velocity.z *= .68;
        body.spin.multiplyScalar(.72);
        body.bounces += 1;
        if (body.bounces < 3) playTone(95 + body.bounces * 18, .035, "triangle", .018);
      } else {
        body.velocity.set(0, 0, 0);
        body.spin.multiplyScalar(.82);
      }
    }
    if (frameNow - body.bornAt > 24_000) {
      removeShotgunShell(spentShells, body.shell);
      spentShellBodies.splice(index, 1);
    }
  }

  deathLightEnergy *= .82;
  deathLight.intensity = deathLightEnergy * 115;
  for (let index = deathBodies.length - 1; index >= 0; index -= 1) {
    const body = deathBodies[index];
    body.velocity.y -= 5.7 * delta;
    body.velocity.multiplyScalar(.994);
    body.mesh.position.addScaledVector(body.velocity, delta);
    body.mesh.rotation.x += body.spin.x * delta;
    body.mesh.rotation.y += body.spin.y * delta;
    body.mesh.rotation.z += body.spin.z * delta;
    const radius = Math.hypot(body.mesh.position.x, body.mesh.position.z);
    const surfaceY = radius < 5.02 ? -.74 : body.floorY;
    if (body.mesh.position.y < surfaceY) {
      body.mesh.position.y = surfaceY;
      if (Math.abs(body.velocity.y) > .24 && body.bounces < 3) {
        body.velocity.y = Math.abs(body.velocity.y) * .3;
        body.velocity.x *= .64;
        body.velocity.z *= .64;
        body.spin.multiplyScalar(.7);
        body.bounces += 1;
      } else {
        body.velocity.set(0, 0, 0);
        body.spin.multiplyScalar(.8);
      }
    }
  }
  deathPuddles.forEach((puddle) => {
    const age = Math.min(1, (frameNow - puddle.bornAt) / 720);
    puddle.mesh.scale.set(1.25 * age, .72 * age, 1);
    puddle.mesh.material.opacity = .82 - Math.sin(age * Math.PI) * .08;
  });

  gun.updateWorldMatrix(true, true);
  const holdingActorId = activeGunActorId();
  seats.forEach((seat, index) => {
    if (!seat.visible) return;
    if (seat.userData.exploded) {
      seat.position.y = -1.08;
      seat.rotation.z = 0;
      return;
    }
    const player = state?.players[index];
    const active = player?.id === state?.currentPlayerId;
    const holdingGun = player?.id === holdingActorId && player?.alive;
    seat.userData.hit *= .88;
    seat.userData.action *= .9;
    seat.userData.blankPulse *= .9;
    const breath = Math.sin(time * 1.15 + index);
    seat.position.y = -1.08 + breath * (active ? .035 : .012);
    seat.rotation.z = (player?.alive ? 0 : -.2) + seat.userData.hit * (index % 2 ? .16 : -.16);
    seat.userData.body.scale.y = 1 + breath * .012;
    seat.userData.body.rotation.x += ((holdingGun ? -.09 : (active ? -.055 : 0)) - seat.userData.body.rotation.x) * .055;
    seat.userData.head.rotation.y = Math.sin(time * .47 + index) * .055;
    seat.userData.head.rotation.x += ((active ? -.05 : .02) + seat.userData.hit * .25 - seat.userData.head.rotation.x) * .08;
    const armTarget = holdingGun ? -1.02 : seat.userData.action * -.42;
    seat.userData.leftArm.rotation.x += (armTarget - seat.userData.leftArm.rotation.x) * .14;
    seat.userData.rightArm.rotation.x += (armTarget - seat.userData.rightArm.rotation.x) * .14;
    seat.userData.leftHand.rotation.x += ((holdingGun ? -.34 : seat.userData.action * -.28) - seat.userData.leftHand.rotation.x) * .14;
    seat.userData.rightHand.rotation.x += ((holdingGun ? -.34 : seat.userData.action * -.28) - seat.userData.rightHand.rotation.x) * .14;
    if (holdingGun) {
      seat.updateWorldMatrix(true, false);
      gun.localToWorld(leftGripScratch.copy(leftGunGrip));
      gun.localToWorld(rightGripScratch.copy(rightGunGrip));
      seat.userData.leftHand.position.lerp(seat.worldToLocal(leftGripScratch), .18);
      seat.userData.rightHand.position.lerp(seat.worldToLocal(rightGripScratch), .18);
    } else {
      seat.userData.leftHand.position.lerp(leftHandRest, .12);
      seat.userData.rightHand.position.lerp(rightHandRest, .12);
    }
    if (seat.userData.activeRing) seat.userData.activeRing.rotation.z = time * .7;
    if (seat.userData.targetRing) {
      const targetPulse = 1 + Math.sin(time * 8.5) * .045 + seat.userData.blankPulse * .18;
      seat.userData.targetRing.rotation.z = -time * 1.35;
      seat.userData.targetRing.scale.setScalar(targetPulse);
      seat.userData.targetRing.material.emissiveIntensity = 3.2 + seat.userData.blankPulse * 5;
    }
  });
  const itemPulseActive = performance.now() < itemPulseUntil;
  itemTrays.forEach((tray, trayIndex) => {
    const player = state?.players[trayIndex];
    const itemPulse = itemPulseActive && player?.id === itemPulsePlayerId ? 1 + Math.sin(time * 28) * .1 : 1;
    tray.userData.props.scale.setScalar(itemPulse);
    tray.userData.props.children.forEach((prop, index) => {
      prop.position.y = (prop.userData.baseY ?? .02) + Math.sin(time * 1.4 + index) * .006;
    });
  });
  dust.rotation.y = time * .008;
  mist.children.forEach((cloud) => {
    const drift = time * .075 + cloud.userData.phase;
    cloud.position.x = cloud.userData.origin.x + Math.sin(drift) * .72;
    cloud.position.y = cloud.userData.origin.y + Math.sin(drift * 1.7) * .18;
    cloud.position.z = cloud.userData.origin.z + Math.cos(drift * .83) * .54;
    cloud.material.opacity = .075 + (Math.sin(drift * 1.25) + 1) * .035;
  });
  fan.rotation.z = time * 1.35;
  monitorScreen.material.emissiveIntensity = 1.75 + Math.sin(time * 7.4) * .18 + Math.sin(time * 19.1) * .08;
  warningSprite.material.opacity = .82 + Math.sin(time * 5.3) * .12;
  keyLight.intensity = 304 + Math.sin(time * 2.1) * 8 + Math.sin(time * 7.7) * 4;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.4));
  if (state) sceneMode(state.phase);
});

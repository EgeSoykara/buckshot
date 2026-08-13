import http from "node:http";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server } from "socket.io";
import { RoomStore } from "./game.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 20_000,
  pingTimeout: 15_000,
  maxHttpBufferSize: 100_000
});
const rooms = new RoomStore();
const indexHtml = readFileSync(path.join(root, "public/index.html"), "utf8");

app.disable("x-powered-by");
app.get("/health", (_request, response) => response.status(200).json({ ok: true }));
app.use("/vendor/three", express.static(path.join(root, "node_modules/three/build"), { immutable: true, maxAge: "1y" }));
app.use(express.static(path.join(root, "public"), { index: false, maxAge: "1h" }));
app.get("/{*path}", (request, response) => {
  const protocol = request.get("x-forwarded-proto")?.split(",")[0] || request.protocol;
  const host = (request.get("host") || "localhost").replace(/[^a-zA-Z0-9.:-]/g, "");
  response.type("html").send(indexHtml.replaceAll("%ORIGIN%", `${protocol}://${host}`));
});

function fail(socket, error) {
  socket.emit("game:error", { message: error instanceof Error ? error.message : "Beklenmeyen bir hata oluştu." });
}

function broadcast(room) {
  for (const player of room.players) {
    if (player.connected) io.to(player.id).emit("room:state", room.publicState(player.id));
  }
}

function joinSocketRoom(socket, room, player) {
  socket.join(room.code);
  socket.data.roomCode = room.code;
  socket.data.playerToken = player.token;
  socket.emit("session", { roomCode: room.code, playerToken: player.token, playerId: player.id });
  broadcast(room);
}

io.on("connection", (socket) => {
  socket.on("room:create", ({ name } = {}) => {
    try {
      if (rooms.findBySocket(socket.id)) throw new Error("Zaten bir odadasın.");
      const room = rooms.create(socket.id, name);
      joinSocketRoom(socket, room, room.player(socket.id));
    } catch (error) {
      fail(socket, error);
    }
  });

  socket.on("room:join", ({ code, name } = {}) => {
    try {
      if (rooms.findBySocket(socket.id)) throw new Error("Zaten bir odadasın.");
      const room = rooms.get(code);
      if (!room) throw new Error("Oda bulunamadı. Kodu kontrol et.");
      const player = room.addPlayer(socket.id, name);
      joinSocketRoom(socket, room, player);
    } catch (error) {
      fail(socket, error);
    }
  });

  socket.on("room:reconnect", ({ roomCode, playerToken } = {}) => {
    try {
      const room = rooms.get(roomCode);
      if (!room) throw new Error("Oda artık açık değil.");
      const player = room.reconnect(socket.id, playerToken);
      joinSocketRoom(socket, room, player);
    } catch (error) {
      socket.emit("session:expired", { message: error instanceof Error ? error.message : "Oturum bulunamadı." });
    }
  });

  socket.on("game:start", () => {
    try {
      const room = rooms.findBySocket(socket.id);
      if (!room) throw new Error("Önce bir odaya katıl.");
      room.start(socket.id);
      broadcast(room);
    } catch (error) {
      fail(socket, error);
    }
  });

  socket.on("game:shoot", ({ targetId } = {}) => {
    try {
      const room = rooms.findBySocket(socket.id);
      if (!room) throw new Error("Oda bulunamadı.");
      const result = room.shoot(socket.id, targetId);
      io.to(room.code).emit("game:shot", result);
      broadcast(room);
    } catch (error) {
      fail(socket, error);
    }
  });

  socket.on("game:item", ({ item } = {}) => {
    try {
      const room = rooms.findBySocket(socket.id);
      if (!room) throw new Error("Oda bulunamadı.");
      const result = room.useItem(socket.id, item);
      if (result.privateMessage) socket.emit("game:secret", { message: result.privateMessage });
      io.to(room.code).emit("game:item-used", { actorId: socket.id, item });
      broadcast(room);
    } catch (error) {
      fail(socket, error);
    }
  });

  socket.on("disconnect", () => {
    const room = rooms.findBySocket(socket.id);
    if (room?.disconnect(socket.id)) broadcast(room);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.rooms.values()) {
    if (room.phase !== "playing" || !room.turnDeadline || room.turnDeadline > now) continue;
    const actor = room.player(room.currentPlayerId);
    const candidates = room.alivePlayers().filter((player) => player.id !== actor?.id);
    if (!actor || candidates.length === 0) continue;
    try {
      const target = candidates[Math.floor(Math.random() * candidates.length)];
      const result = room.shoot(actor.id, target.id, now);
      room.lastAction = `${actor.name} süresi dolduğu için otomatik ateş etti. ${room.lastAction}`;
      io.to(room.code).emit("game:shot", result);
      broadcast(room);
    } catch {
      room.advanceTurn();
      room.turnDeadline = now + 30_000;
      broadcast(room);
    }
  }
  rooms.cleanup(now);
}, 1_000).unref();

const port = Number(process.env.PORT) || 3000;
server.listen(port, "0.0.0.0", () => {
  console.log(`Last Chamber listening on http://0.0.0.0:${port}`);
});

export { app, io, rooms, server };

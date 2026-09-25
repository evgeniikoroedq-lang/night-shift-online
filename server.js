import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });
const rooms = new Map();

app.use(express.static("public"));
app.get("/health", (_, res) => res.json({ ok: true, rooms: rooms.size }));

function roomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({length: 6}, () => chars[Math.floor(Math.random()*chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function send(ws, type, data={}) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ type, ...data }));
}
function broadcast(room, type, data={}) {
  for (const p of room.players.values()) send(p.ws, type, data);
}
function state(room) {
  return [...room.players.values()].map(p => ({
    id: p.id, name: p.name, x: p.x, y: p.y
  }));
}

wss.on("connection", ws => {
  ws.id = crypto.randomUUID();

  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return send(ws, "error", {message:"Invalid message"}); }

    if (msg.type === "create") {
      const code = roomCode();
      const room = { code, players: new Map(), started: false };
      rooms.set(code, room);
      addPlayer(room, ws, String(msg.name || "Игрок").slice(0,16));
      return;
    }

    if (msg.type === "join") {
      const code = String(msg.code || "").toUpperCase();
      const room = rooms.get(code);
      if (!room) return send(ws, "error", {message:"Комната не найдена"});
      if (room.players.size >= 6) return send(ws, "error", {message:"Комната заполнена"});
      if (room.started) return send(ws, "error", {message:"Игра уже началась"});
      addPlayer(room, ws, String(msg.name || "Игрок").slice(0,16));
      return;
    }

    const room = rooms.get(ws.roomCode);
    if (!room) return;

    if (msg.type === "start") {
      if (room.players.size < 2) return send(ws, "error", {message:"Нужно минимум 2 игрока"});
      room.started = true;
      broadcast(room, "started", { players: state(room) });
      return;
    }

    if (msg.type === "move") {
      const p = room.players.get(ws.id);
      if (!p || !room.started) return;
      p.x = Math.max(5, Math.min(95, Number(msg.x) || p.x));
      p.y = Math.max(8, Math.min(92, Number(msg.y) || p.y));
      broadcast(room, "state", { players: state(room) });
    }
  });

  ws.on("close", () => {
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    room.players.delete(ws.id);
    broadcast(room, "state", { players: state(room) });
    if (room.players.size === 0) rooms.delete(room.code);
  });
});

function addPlayer(room, ws, name) {
  ws.roomCode = room.code;
  room.players.set(ws.id, { id: ws.id, ws, name, x: 50, y: 70 });
  send(ws, "joined", { code: room.code, id: ws.id, players: state(room), host: room.players.size === 1 });
  broadcast(room, "state", { players: state(room) });
}

server.listen(process.env.PORT || 3000, () => {
  console.log(`Night Shift server: http://localhost:${process.env.PORT || 3000}`);
});
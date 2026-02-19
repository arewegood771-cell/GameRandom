const express = require('express');
const http    = require('http');
const WebSocket = require('ws');
const path = require('path');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// ─── Room State ───────────────────────────────────────────
// rooms: { roomCode: { host, phase, players: { id: playerData }, createdAt } }
const rooms = {};

const KILLS_TO_WIN  = 10;
const ROOM_TTL_MS   = 1000 * 60 * 30; // 30 min cleanup

function genCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return [0,1,2,3].map(() => c[Math.floor(Math.random() * c.length)]).join('');
}

function genId() {
  return Math.random().toString(36).substr(2, 9);
}

// Cleanup stale rooms every 5 min
setInterval(() => {
  const now = Date.now();
  for (const code in rooms) {
    if (now - rooms[code].createdAt > ROOM_TTL_MS) {
      delete rooms[code];
      console.log(`Cleaned up room ${code}`);
    }
  }
}, 5 * 60 * 1000);

// ─── WebSocket ────────────────────────────────────────────
// Track: ws -> { id, roomCode, name }
const clients = new Map(); // ws -> meta

function broadcast(roomCode, msg, excludeId = null) {
  const str = JSON.stringify(msg);
  for (const [ws, meta] of clients) {
    if (meta.roomCode === roomCode && meta.id !== excludeId && ws.readyState === WebSocket.OPEN) {
      ws.send(str);
    }
  }
}

function broadcastAll(roomCode, msg) {
  const str = JSON.stringify(msg);
  for (const [ws, meta] of clients) {
    if (meta.roomCode === roomCode && ws.readyState === WebSocket.OPEN) {
      ws.send(str);
    }
  }
}

function sendTo(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

wss.on('connection', (ws) => {
  const id = genId();
  clients.set(ws, { id, roomCode: null, name: '' });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const meta = clients.get(ws);

    switch (msg.type) {

      // ── CREATE ROOM ──
      case 'create_room': {
        const code = genCode();
        const spawnIdx = 0;
        rooms[code] = {
          code,
          host: id,
          phase: 'lobby',
          createdAt: Date.now(),
          players: {
            [id]: {
              id, name: msg.name, avatar: msg.avatar,
              x: 80, y: 80, angle: 0,
              hp: 100, ammo: 8, kills: 0, deaths: 0,
              alive: true, bullets: []
            }
          }
        };
        meta.roomCode = code;
        meta.name = msg.name;
        sendTo(ws, { type: 'room_created', code, playerId: id, room: rooms[code] });
        console.log(`Room ${code} created by ${msg.name}`);
        break;
      }

      // ── JOIN ROOM ──
      case 'join_room': {
        const room = rooms[msg.code];
        if (!room) { sendTo(ws, { type: 'error', msg: 'Room tidak ditemukan!' }); break; }
        if (room.phase !== 'lobby') { sendTo(ws, { type: 'error', msg: 'Game sudah berjalan!' }); break; }
        if (Object.keys(room.players).length >= 10) { sendTo(ws, { type: 'error', msg: 'Room penuh!' }); break; }

        const spawns = [{x:80,y:80},{x:1520,y:80},{x:80,y:1120},{x:1520,y:1120},{x:800,y:100},{x:800,y:1100},{x:100,y:600},{x:1500,y:600},{x:400,y:500},{x:1200,y:500}];
        const spawnIdx = Object.keys(room.players).length % spawns.length;
        const sp = spawns[spawnIdx];

        room.players[id] = {
          id, name: msg.name, avatar: msg.avatar,
          x: sp.x, y: sp.y, angle: 0,
          hp: 100, ammo: 8, kills: 0, deaths: 0,
          alive: true, bullets: []
        };
        meta.roomCode = msg.code;
        meta.name = msg.name;

        sendTo(ws, { type: 'room_joined', code: msg.code, playerId: id, room });
        broadcast(msg.code, { type: 'player_joined', player: room.players[id] }, id);
        console.log(`${msg.name} joined room ${msg.code}`);
        break;
      }

      // ── START GAME ──
      case 'start_game': {
        const room = rooms[meta.roomCode];
        if (!room || room.host !== id) break;
        const spawns = [{x:80,y:80},{x:1520,y:80},{x:80,y:1120},{x:1520,y:1120},{x:800,y:100},{x:800,y:1100},{x:100,y:600},{x:1500,y:600},{x:400,y:500},{x:1200,y:500}];
        Object.keys(room.players).forEach((pid, i) => {
          const sp = spawns[i % spawns.length];
          Object.assign(room.players[pid], { x: sp.x, y: sp.y, hp: 100, ammo: 8, kills: 0, deaths: 0, alive: true, bullets: [] });
        });
        room.phase = 'game';
        broadcastAll(meta.roomCode, { type: 'game_started', room });
        console.log(`Room ${meta.roomCode} game started`);
        break;
      }

      // ── PLAYER STATE UPDATE (position, angle, ammo, hp) ──
      case 'player_update': {
        const room = rooms[meta.roomCode];
        if (!room || !room.players[id]) break;
        const p = room.players[id];
        p.x     = msg.x;
        p.y     = msg.y;
        p.angle = msg.angle;
        p.hp    = msg.hp;
        p.ammo  = msg.ammo;
        p.alive = msg.alive;
        // Relay to others
        broadcast(meta.roomCode, { type: 'player_update', id, x: p.x, y: p.y, angle: p.angle, hp: p.hp, alive: p.alive }, id);
        break;
      }

      // ── BULLET FIRED ──
      case 'bullet_fired': {
        broadcast(meta.roomCode, { type: 'bullet_fired', shooterId: id, x: msg.x, y: msg.y, angle: msg.angle }, id);
        break;
      }

      // ── REGISTER HIT ──
      case 'register_hit': {
        const room = rooms[meta.roomCode];
        if (!room || !room.players[msg.targetId] || !room.players[id]) break;
        const target = room.players[msg.targetId];
        const shooter = room.players[id];
        if (!target.alive) break;

        target.hp -= msg.damage;
        if (target.hp <= 0) {
          target.hp = 0;
          target.alive = false;
          target.deaths++;
          shooter.kills++;

          broadcastAll(meta.roomCode, {
            type: 'player_killed',
            killerId: id, killerName: shooter.name,
            targetId: msg.targetId, targetName: target.name,
            killerKills: shooter.kills
          });

          if (shooter.kills >= KILLS_TO_WIN) {
            room.phase = 'winner';
            broadcastAll(meta.roomCode, { type: 'game_over', winnerId: id, winnerName: shooter.name, winnerAvatar: shooter.avatar });
          }
        } else {
          // Just relay damage
          broadcastAll(meta.roomCode, { type: 'player_damaged', targetId: msg.targetId, hp: target.hp });
        }
        break;
      }

      // ── PLAYER RESPAWN ──
      case 'respawn': {
        const room = rooms[meta.roomCode];
        if (!room || !room.players[id]) break;
        const spawns = [{x:80,y:80},{x:1520,y:80},{x:80,y:1120},{x:1520,y:1120},{x:800,y:100},{x:800,y:1100},{x:100,y:600},{x:1500,y:600},{x:400,y:500},{x:1200,y:500}];
        const sp = spawns[Math.floor(Math.random() * spawns.length)];
        const p = room.players[id];
        p.x = sp.x; p.y = sp.y; p.hp = 100; p.ammo = 8; p.alive = true;
        broadcastAll(meta.roomCode, { type: 'player_respawned', id, x: p.x, y: p.y });
        break;
      }

      // ── BACK TO LOBBY ──
      case 'back_to_lobby': {
        const room = rooms[meta.roomCode];
        if (!room || room.host !== id) break;
        room.phase = 'lobby';
        delete room.winner;
        Object.values(room.players).forEach(p => Object.assign(p, { kills:0, deaths:0, hp:100, ammo:8, alive:true, bullets:[] }));
        broadcastAll(meta.roomCode, { type: 'back_to_lobby', room });
        break;
      }

      // ── LEAVE ROOM ──
      case 'leave_room': {
        handleLeave(ws, meta);
        break;
      }
    }
  });

  ws.on('close', () => {
    const meta = clients.get(ws);
    if (meta) handleLeave(ws, meta);
    clients.delete(ws);
  });

  // Ping keep-alive
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

function handleLeave(ws, meta) {
  const room = rooms[meta.roomCode];
  if (!room) return;
  delete room.players[meta.id];
  if (Object.keys(room.players).length === 0) {
    delete rooms[meta.roomCode];
    console.log(`Room ${meta.roomCode} deleted (empty)`);
  } else {
    if (room.host === meta.id) {
      // Transfer host to next player
      room.host = Object.keys(room.players)[0];
    }
    broadcast(meta.roomCode, { type: 'player_left', id: meta.id, newHost: room.host });
  }
  meta.roomCode = null;
}

// Heartbeat to detect dead connections
const heartbeat = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) { ws.terminate(); return; }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`🔫 TEMBAK! server running on port ${PORT}`);
});

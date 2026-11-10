// WebSocket relay for two features, both using 4-letter room codes:
//
// Phone controller: a game screen and the phones paired with it.
//   game  -> ws(s)://HOST/ws?role=game&room=ABCD
//   phone -> ws(s)://HOST/ws?role=pad&room=ABCD
//   Phone messages go to the room's game; game messages go to the room's phones.
//
// Multiplayer: everyone flying in the same room sees each other.
//   player -> ws(s)://HOST/ws?role=mp&room=ABCD&city=...&look=...
//   The first player's city and look become the room's; everyone who joins
//   gets them in the welcome message.
//   Each player gets an id; their messages are tagged with it and passed to
//   the other players. When a player leaves, the others get {t:'leave', id}.
//   lobby  -> ws(s)://HOST/ws?role=lobby
//   Gets {t:'rooms', rooms:[{code, city, look, players:[{name, city, vehicle}]}]} whenever
//   the open rooms change, so the menu can list them with a Join button.
//
// Beer Run leaderboard (the Fort Collins delivery game):
//   board -> ws(s)://HOST/ws?role=board&game=beer | rings:<city> | rampage:<city>
//   Gets {t:'board', week:[...], all:[...]} (top 10 each: {name, score, deliveries, vehicle, when})
//   now and whenever it changes. Send {t:'score', name, score, deliveries, vehicle}
//   after a shift to get {t:'placed', week, all} (your ranks) back.
//   Kept in STATE_DIR/beer-run.json.
// Run: node server/relay.js   (PORT env, default 8787; STATE_DIR, default server/data)
import { WebSocketServer } from 'ws';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT) || 8787;
const rooms = new Map(); // code -> { game, pads: Set }

const wss = new WebSocketServer({ port: PORT, path: '/ws', maxPayload: 4096 });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const role = url.searchParams.get('role');
  const code = (url.searchParams.get('room') || '').toUpperCase();
  if (role === 'lobby') return joinLobby(ws);
  if (role === 'board') return joinBoard(ws, (url.searchParams.get('game') || 'beer').slice(0, 40));
  if (!/^[A-Z]{4}$/.test(code) || !['game', 'pad', 'mp'].includes(role)) {
    ws.close(1008, 'bad room or role');
    return;
  }
  if (role === 'mp') {
    const city = (url.searchParams.get('city') || '').slice(0, 32);
    const look = (url.searchParams.get('look') || '').slice(0, 16);
    return joinFlight(ws, code, { city, look });
  }
  let room = rooms.get(code);
  if (!room) rooms.set(code, (room = { game: null, pads: new Set() }));

  const send = (sock, msg) => sock && sock.readyState === 1 && sock.send(msg);
  const notifyGame = () => send(room.game, JSON.stringify({ t: 'pads', n: room.pads.size }));

  if (role === 'game') {
    room.game?.close(1000, 'replaced');
    room.game = ws;
    notifyGame();
    for (const pad of room.pads) send(pad, JSON.stringify({ t: 'game', online: true }));
  } else {
    room.pads.add(ws);
    send(ws, JSON.stringify({ t: 'game', online: !!room.game }));
    notifyGame();
  }

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    const msg = data.toString();
    if (role === 'pad') send(room.game, msg);
    else for (const pad of room.pads) send(pad, msg);
  });

  ws.on('close', () => {
    if (role === 'game' && room.game === ws) {
      room.game = null;
      for (const pad of room.pads) send(pad, JSON.stringify({ t: 'game', online: false }));
    } else {
      room.pads.delete(ws);
      notifyGame();
    }
    if (!room.game && room.pads.size === 0) rooms.delete(code);
  });
});

// ------------------------------------------------------------------ multiplayer
const flights = new Map(); // code -> Map(id -> ws)
const info = new Map(); // ws -> { name, city, vehicle } from the player's latest state
const lobby = new Set();

function roomList() {
  const rooms = [];
  for (const [code, room] of flights) {
    const players = [...room.values()].map((ws) => info.get(ws)).filter(Boolean);
    if (players.length) rooms.push({ code, players, ...roomSettings.get(code) });
  }
  return JSON.stringify({ t: 'rooms', rooms });
}
let lobbyTimer = null;
function updateLobby() {
  // Batch changes: at most one update per half second.
  if (lobbyTimer) return;
  lobbyTimer = setTimeout(() => {
    lobbyTimer = null;
    const msg = roomList();
    for (const ws of lobby) if (ws.readyState === 1) ws.send(msg);
  }, 500);
}
function joinLobby(ws) {
  lobby.add(ws);
  ws.send(roomList());
  ws.on('close', () => lobby.delete(ws));
}
let nextId = 1;
const roomSettings = new Map(); // code -> { city, look }, set by whoever starts the room
function joinFlight(ws, code, wanted) {
  let room = flights.get(code);
  if (!room) {
    flights.set(code, (room = new Map()));
    roomSettings.set(code, wanted);
  }
  if (room.size >= 8) {
    ws.close(1008, 'room full');
    return;
  }
  const id = nextId++;
  room.set(id, ws);
  const others = (fn) => {
    for (const [oid, sock] of room) if (oid !== id && sock.readyState === 1) fn(sock);
  };
  // Everyone in a room flies the same city and look (vehicles are each player's own).
  ws.send(JSON.stringify({ t: 'welcome', id, players: room.size, settings: roomSettings.get(code) }));
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    let m;
    try {
      m = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (typeof m !== 'object' || m === null) return;
    m.id = id; // players can't speak for each other
    if (m.t === 'state') {
      const prev = info.get(ws);
      const now = { name: String(m.name || 'Pilot').slice(0, 16), city: String(m.city || ''), vehicle: String(m.vehicle || '') };
      if (!prev || prev.name !== now.name || prev.city !== now.city || prev.vehicle !== now.vehicle) {
        info.set(ws, now);
        updateLobby();
      }
    }
    const out = JSON.stringify(m);
    others((sock) => sock.send(out));
  });
  ws.on('close', () => {
    room.delete(id);
    info.delete(ws);
    updateLobby();
    others((sock) => sock.send(JSON.stringify({ t: 'leave', id })));
    if (room.size === 0) {
      flights.delete(code);
      roomSettings.delete(code);
    }
  });
}

// Drop dead connections (phones that went to sleep) every 30 s.
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) ws.terminate();
    else {
      ws.isAlive = false;
      ws.ping();
    }
  }
}, 30000);
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
});

console.log(`Lego Sky relay (phone controller + multiplayer) listening on :${PORT}/ws`);

// ------------------------------------------------------------------ Beer Run leaderboard
const STATE_DIR = process.env.STATE_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), 'data');
const BOARD_FILE = path.join(STATE_DIR, 'beer-run.json');
const WEEK = 7 * 24 * 3600 * 1000;
let scores = [];
try {
  scores = JSON.parse(fs.readFileSync(BOARD_FILE, 'utf8'));
} catch {}
const watchers = new Map(); // ws -> game

/** Top tens for one game ('beer', 'rings:<city>', 'rampage:<city>'). Old entries without a game are Beer Run's. */
function boards(game) {
  const byScore = (a, b) => b.score - a.score;
  const since = Date.now() - WEEK;
  const mine = scores.filter((s) => (s.game || 'beer') === game);
  return { game, week: mine.filter((s) => s.when > since).sort(byScore).slice(0, 10), all: mine.sort(byScore).slice(0, 10) };
}

function saveScores() {
  // Keep each game's best 100 ever plus everything from the last week.
  const since = Date.now() - WEEK;
  const best = new Set();
  for (const g of new Set(scores.map((s) => s.game || 'beer'))) {
    for (const s of scores.filter((x) => (x.game || 'beer') === g).sort((a, b) => b.score - a.score).slice(0, 100)) best.add(s);
  }
  scores = scores.filter((s) => best.has(s) || s.when > since);
  fs.mkdir(STATE_DIR, { recursive: true }, () => {
    fs.writeFile(BOARD_FILE + '.tmp', JSON.stringify(scores), (err) => !err && fs.rename(BOARD_FILE + '.tmp', BOARD_FILE, () => {}));
  });
}

function joinBoard(ws, game) {
  watchers.set(ws, game);
  ws.send(JSON.stringify({ t: 'board', ...boards(game) }));
  let last = 0;
  ws.on('message', (data, isBinary) => {
    if (isBinary || Date.now() - last < 10000) return; // one score per shift, not a flood
    let m;
    try {
      m = JSON.parse(data.toString());
    } catch {
      return;
    }
    const score = Math.round(Number(m.score));
    if (m.t !== 'score' || !(score > 0 && score < 1000000)) return;
    last = Date.now();
    const entry = {
      name: String(m.name || 'Pilot').slice(0, 16), score, when: last, game,
      note: String(m.note || '').slice(0, 24),
      deliveries: Math.max(0, Math.min(999, Math.round(Number(m.deliveries) || 0))),
      vehicle: m.vehicle === 'heli' ? 'heli' : 'plane',
    };
    scores.push(entry);
    saveScores();
    const b = boards(game);
    const rank = (list) => list.indexOf(entry) + 1 || null;
    ws.send(JSON.stringify({ t: 'placed', week: rank(b.week), all: rank(b.all) }));
    const msg = JSON.stringify({ t: 'board', ...b });
    for (const [w, g] of watchers) if (g === game && w.readyState === 1) w.send(msg);
  });
  ws.on('close', () => watchers.delete(ws));
}

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
//   Room games (plan 05 part 3): the first player in a room is its host (the
//   crown passes to whoever has been there longest if they leave). The host
//   starts a game: {t:'game-start', game, options}. Everyone gets {t:'game', ...}
//   with the phase (countdown -> live -> results), server times (startsAt, goAt,
//   endsAt) and who is playing, and the server's clock in welcome/game messages
//   (now) so countdowns agree. Players send game-join / game-skip during the
//   countdown and game-score while playing; the server keeps the order and
//   announces the results, so everyone sees the same winner. Host only:
//   game-go-now, game-cancel, game-end.
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
// Giant squid (plan 07): the relay runs the squid's rules (src/squidbrain.js,
//   the same file solo play uses) for each room, so everyone sees the same
//   attack. Players send squid-near (where they are, about 5 a second, while
//   close), squid-hit, squid-fed, and squid-free / squid-lost (the held player
//   judges their own struggle). Everyone gets {t:'squid', city, i, s, out, now}.
// Run: node server/relay.js   (PORT env, default 8787; STATE_DIR, default server/data)
import { WebSocketServer } from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { newSquid, step as squidStep, publicSquid, bossHealth } from '../src/squidbrain.js';
// Tests only: start ordinary squids with this much health (so a two-punch fight can be scripted).
const SQUID_TEST_HEALTH = +process.env.SQUID_TEST_HEALTH || undefined;

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
    const g = meta.get(code)?.game;
    if (players.length) rooms.push({ code, players, ...roomSettings.get(code), ...(g?.phase === 'countdown' ? { starting: g.game } : {}) });
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
const meta = new Map(); // code -> { order: [ids, oldest first], host, game }

// ------------------------------------------------------------------ room games
// kind 'race': places by finishing order (server receipt), then by progress.
// kind 'score': places by score (highest first); ends at endsAt.
// kind 'tag': last player not caught wins (scores hold 1 for "caught").
const GAMES = {
  sky: { kind: 'race', limit: 900 }, // Sky Race (rings), 15 min cap
  rampage: { kind: 'score', duration: 120 },
  tag: { kind: 'tag', duration: 180 },
  potty: { kind: 'race', limit: 900 },
  keg: { kind: 'score', duration: 600, target: 5 },
  landing: { kind: 'score', limit: 300 },
  toss: { kind: 'score', limit: 240 },
  squid: { kind: 'score', duration: 240 }, // Squid Hunt: the relay runs the boss and awards the points
};
const COUNTDOWN = 30; // seconds (host can start now)
const GO_DELAY = 4.5; // seconds from "everyone to the start line" to GO (3, 2, 1)

function roomBroadcast(code, obj) {
  const room = flights.get(code);
  if (!room) return;
  const out = JSON.stringify(obj);
  for (const sock of room.values()) if (sock.readyState === 1) sock.send(out);
}
function gameMsg(code) {
  const g = meta.get(code)?.game;
  return { t: 'game', now: Date.now(), ...(g ? publicGame(g) : { phase: 'none' }) };
}
function publicGame(g) {
  const { timer, seats, pending, ...rest } = g;
  return rest;
}
function setGameTimer(code, at, fn) {
  const g = meta.get(code)?.game;
  if (!g) return;
  clearTimeout(g.timer);
  g.timer = setTimeout(fn, Math.max(0, at - Date.now()));
}
function sendGame(code) {
  roomBroadcast(code, gameMsg(code));
  updateLobby();
}
function goLive(code) {
  const g = meta.get(code)?.game;
  if (!g || g.phase !== 'countdown') return;
  const room = flights.get(code);
  g.players = g.players.filter((id) => room?.has(id));
  if (!g.players.length) return cancelGame(code);
  g.phase = 'live';
  g.slots = Object.fromEntries(g.players.map((id, i) => [id, i]));
  g.goAt = Date.now() + GO_DELAY * 1000;
  const spec = GAMES[g.game];
  const len = spec.duration || spec.limit;
  g.endsAt = g.goAt + len * 1000;
  g.scores = Object.fromEntries(g.players.map((id) => [id, { score: 0, progress: 0, done: false }]));
  g.finished = [];
  if (g.game === 'potty') g.seats = {}; // toilet index -> { holder, until, queue }
  if (g.game === 'squid') {
    // The boss: more health with more players (a longer fight, not a shorter one).
    const city = roomSettings.get(code)?.city || '';
    const m = meta.get(code);
    const sq = { city, i: g.options.boss, s: newSquid({ boss: true, health: bossHealth(g.players.length) }) };
    m.squids.set(`${city}:${g.options.boss}`, sq);
    roomBroadcast(code, squidMsg(sq));
  }
  if (g.game === 'keg') kegNew(g, null);
  if (g.game === 'tag') {
    // One player starts "it", picked by the server.
    const it = g.players[Math.floor(Math.random() * g.players.length)];
    g.scores[it].it = true;
  }
  setGameTimer(code, g.endsAt, () => finishGame(code));
  sendGame(code);
}
/** After Squid Hunt: the boss goes back to being a normal squid. */
function endBoss(code, g) {
  if (g?.game !== 'squid') return;
  const m = meta.get(code);
  const city = roomSettings.get(code)?.city || '';
  const key = `${city}:${g.options.boss}`;
  if (!m?.squids.has(key)) return;
  const sq = { city, i: g.options.boss, s: newSquid() };
  m.squids.set(key, sq);
  roomBroadcast(code, squidMsg(sq));
}
function cancelGame(code) {
  const m = meta.get(code);
  if (!m?.game) return;
  endBoss(code, m.game);
  clearTimeout(m.game.timer);
  for (const seat of Object.values(m.game.seats || {})) clearTimeout(seat.timer);
  m.game = null;
  sendGame(code);
}
function finishGame(code) {
  const m = meta.get(code);
  const g = m?.game;
  if (!g || g.phase !== 'live') return;
  clearTimeout(g.timer);
  for (const seat of Object.values(g.seats || {})) clearTimeout(seat.timer);
  endBoss(code, g);
  const spec = GAMES[g.game];
  const name = (id) => info.get(flights.get(code)?.get(id))?.name || g.names?.[id] || 'Pilot';
  let order;
  if (spec.kind === 'race') {
    const rest = g.players.filter((id) => !g.finished.includes(id)).sort((a, b) => (g.scores[b]?.progress || 0) - (g.scores[a]?.progress || 0));
    order = [...g.finished, ...rest];
  } else if (spec.kind === 'tag') {
    // Not caught first (still free at the end), then by how long they lasted.
    order = [...g.players].sort((a, b) => {
      const A = g.scores[a];
      const B = g.scores[b];
      if (!!A.caughtAt !== !!B.caughtAt) return A.caughtAt ? 1 : -1;
      return (B.caughtAt || 0) - (A.caughtAt || 0);
    });
  } else {
    order = [...g.players].sort((a, b) => (g.scores[b]?.score || 0) - (g.scores[a]?.score || 0));
  }
  g.results = order.map((id, i) => ({ id, name: name(id), place: i + 1, ...g.scores[id], left: !flights.get(code)?.has(id) }));
  g.phase = 'results';
  const w = g.results[0];
  if (w && !w.left) m.trophies[w.id] = (m.trophies[w.id] || 0) + 1;
  g.trophies = m.trophies;
  sendGame(code);
}
// Keg Rush: one keg at a time, at a landmark (index into the city's list; the
// host's game tells the server how many there are). First to reach it holds it;
// delivering it to the target scores; a bump drops it where the carrier was.
function kegNew(g, from) {
  const n = Math.max(2, g.options.spots || 2);
  let at;
  do at = Math.floor(Math.random() * n); while (at === from && n > 1);
  let to;
  do to = Math.floor(Math.random() * n); while (to === at);
  g.keg = { at, to, holder: null, x: null, z: null };
}

// Potty Time: one seat per toilet. The server keeps the queue and the clock, so
// every screen shows the same robot on the seat. Sitting takes 4 s; mashing the
// button takes 0.15 s off per press, down to 1.5 s.
const SIT_MS = 4000;
function pottyBroadcast(code, i) {
  const g = meta.get(code)?.game;
  const seat = g?.seats?.[i];
  if (seat) roomBroadcast(code, { t: 'potty-seat', i, holder: seat.holder, until: seat.until, queue: seat.queue, now: Date.now() });
  // (mashing shortens the wait: pottyDone re-checks the time when its timer fires)
}
function pottyNext(code, i) {
  const g = meta.get(code)?.game;
  const seat = g?.seats?.[i];
  if (!seat || g.phase !== 'live') return;
  const room = flights.get(code);
  seat.queue = seat.queue.filter((x) => room?.has(x));
  seat.holder = seat.queue.shift() ?? null;
  seat.since = Date.now();
  seat.until = seat.holder ? seat.since + SIT_MS : 0;
  clearTimeout(seat.timer);
  if (seat.holder) seat.timer = setTimeout(() => pottyDone(code, i), SIT_MS);
  pottyBroadcast(code, i);
}
function pottyDone(code, i) {
  const g = meta.get(code)?.game;
  const seat = g?.seats?.[i];
  if (!seat?.holder || g.phase !== 'live') return;
  if (Date.now() < seat.until - 30) {
    clearTimeout(seat.timer);
    seat.timer = setTimeout(() => pottyDone(code, i), seat.until - Date.now());
    return;
  }
  const id = seat.holder;
  const sc = g.scores[id];
  roomBroadcast(code, { t: 'potty-done', i, id });
  if (sc && !sc.done) {
    sc.progress++;
    if (sc.progress >= (g.options.laps * 2 + 1)) {
      sc.done = true;
      sc.time = Math.round(Date.now() - g.goAt);
      g.finished.push(id);
    }
  }
  roomBroadcast(code, { t: 'game-scores', scores: g.scores, finished: g.finished });
  const live = g.players.filter((x) => flights.get(code)?.has(x));
  if (live.length && live.every((x) => g.scores[x].done)) return finishGame(code);
  pottyNext(code, i);
}

function onGameMessage(code, id, m) {
  const meta_ = meta.get(code);
  if (!meta_) return;
  const isHost = meta_.host === id;
  let g = meta_.game;
  const now = Date.now();
  if (m.t === 'game-start') {
    if (!isHost || !GAMES[m.game] || (g && (g.phase === 'countdown' || g.phase === 'live'))) return;
    const options = typeof m.options === 'object' && m.options ? m.options : {};
    const clean = {
      vehicle: options.vehicle === 'heli' ? 'heli' : options.vehicle === 'bot' ? 'bot' : 'plane',
      laps: Math.max(1, Math.min(5, Math.round(Number(options.laps) || 3))),
      spots: Math.max(2, Math.min(500, Math.round(Number(options.spots) || 2))),
      boss: Math.max(0, Math.min(7, Math.round(Number(options.boss) || 0))),
    };
    const room = flights.get(code);
    meta_.game = g = {
      game: m.game, options: clean, phase: 'countdown', startsAt: now + COUNTDOWN * 1000,
      players: [...room.keys()], skipped: [], names: {},
    };
    setGameTimer(code, g.startsAt, () => goLive(code));
    return sendGame(code);
  }
  if (!g) return;
  if (m.t === 'game-cancel' && isHost && g.phase !== 'results') return cancelGame(code);
  if (m.t === 'game-close' && isHost && g.phase === 'results') return cancelGame(code);
  if (m.t === 'game-go-now' && isHost && g.phase === 'countdown') {
    g.startsAt = now;
    return goLive(code);
  }
  if (m.t === 'game-end' && isHost && g.phase === 'live') return finishGame(code);
  if (g.phase === 'countdown' && (m.t === 'game-join' || m.t === 'game-skip')) {
    g.players = g.players.filter((x) => x !== id);
    g.skipped = g.skipped.filter((x) => x !== id);
    (m.t === 'game-join' ? g.players : g.skipped).push(id);
    return sendGame(code);
  }
  if (g.game === 'potty' && g.phase === 'live' && g.players.includes(id) && now >= g.goAt) {
    const i = Math.round(Number(m.i));
    const sc = g.scores[id];
    // Only the toilet that is this player's next stop (even steps of the route).
    if (m.t === 'game-potty' && sc && !sc.done && i === sc.progress / 2 && Number.isInteger(i)) {
      const seat = (g.seats[i] ||= { holder: null, until: 0, queue: [] });
      if (seat.holder === id || seat.queue.includes(id)) return;
      seat.queue.push(id);
      if (!seat.holder) pottyNext(code, i);
      else pottyBroadcast(code, i);
      return;
    }
    if (m.t === 'game-mash') {
      const seat = g.seats[i];
      if (seat?.holder === id) {
        seat.until = Math.max(seat.until - 150, seat.since + 1500);
        clearTimeout(seat.timer);
        seat.timer = setTimeout(() => pottyDone(code, i), seat.until - now);
      }
      return;
    }
  }
  if (g.game === 'keg' && g.phase === 'live' && g.players.includes(id) && now >= g.goAt && g.keg) {
    const k = g.keg;
    if (m.t === 'game-keg-pick' && !k.holder && !(k.lock === id && now < k.lockUntil)) k.holder = id;
    else if (m.t === 'game-keg-bump' && k.holder && k.holder !== id && Number.isFinite(+m.x) && Number.isFinite(+m.z)) {
      // Dropped where the carrier was; the one who dropped it can't grab it back for 3 s.
      Object.assign(k, { holder: null, x: +m.x, z: +m.z, bumpedBy: id, lock: k.holder, lockUntil: now + 3000 });
    } else if (m.t === 'game-keg-deliver' && k.holder === id) {
      const sc = g.scores[id];
      sc.score = (sc.score || 0) + 1;
      if (sc.score >= GAMES.keg.target) {
        roomBroadcast(code, { t: 'game-scores', scores: g.scores, finished: g.finished });
        return finishGame(code);
      }
      kegNew(g, k.at);
      roomBroadcast(code, { t: 'game-scores', scores: g.scores, finished: g.finished });
    } else return;
    roomBroadcast(code, { t: 'keg', keg: g.keg, now });
    return;
  }
  if (m.t === 'game-score' && g.phase === 'live' && g.players.includes(id) && now >= g.goAt) {
    const sc = g.scores[id];
    const spec = GAMES[g.game];
    if (!sc || sc.done) return;
    // Basic sanity: progress goes up one step at a time, scores grow at a sane rate.
    const progress = Math.round(Number(m.progress) || 0);
    const okStep = g.game !== 'potty' || sc.progress % 2 === 1; // in Potty Time only snack stops are self-reported
    if ((progress === sc.progress + 1 && okStep) || progress === sc.progress) sc.progress = progress;
    const score = Math.round(Number(m.score) || 0);
    const secs = (now - g.goAt) / 1000;
    if (g.game !== 'keg' && score >= 0 && score <= 5000 + secs * 2000) sc.score = score;
    if (spec.kind === 'tag' && m.caught && !sc.caughtAt && !sc.it) {
      sc.caughtAt = now - g.goAt;
      sc.it = true; // infection: the caught join the "it" team
      sc.by = Number(m.by) || null;
    }
    if (m.done && spec.kind === 'race' && g.game !== 'potty') {
      sc.done = true;
      sc.time = Math.round(now - g.goAt);
      g.finished.push(id);
    }
    if (m.done && spec.kind !== 'race') {
      sc.done = true;
      sc.time = Math.round(now - g.goAt);
    }
    // Everyone done (or everyone caught): results now.
    const live = g.players.filter((x) => flights.get(code)?.has(x));
    if (spec.kind === 'tag' ? live.every((x) => g.scores[x].it) : live.every((x) => g.scores[x].done)) return finishGame(code);
    if (spec.target && sc.score >= spec.target) return finishGame(code);
    // Live scoreboard, at most a few times a second per game.
    if (!g.pending) {
      g.pending = true;
      setTimeout(() => {
        g.pending = false;
        if (meta_.game === g && g.phase === 'live') roomBroadcast(code, { t: 'game-scores', scores: g.scores, finished: g.finished });
      }, 250);
    }
  }
}
// ------------------------------------------------------------------ giant squid
// One brain per squid (keyed "city:index"), stepped on each report and ten
// times a second; a change of state or anything that happened is broadcast.
const SQUID_MSGS = new Set(['squid-near', 'squid-hit', 'squid-fed', 'squid-free', 'squid-lost']);
const HIT_KINDS = new Set(['punch', 'stomp', 'car', 'melon']);
function squidFor(rmeta, city, i, boss) {
  const key = `${city}:${i}`;
  let sq = rmeta.squids.get(key);
  if (!sq && rmeta.squids.size < 40) rmeta.squids.set(key, (sq = { city, i, s: newSquid({ boss: !!boss, health: boss ? undefined : SQUID_TEST_HEALTH }) }));
  return sq;
}
function squidMsg(sq, out = []) {
  return { t: 'squid', city: sq.city, i: sq.i, s: publicSquid(sq.s), out, now: Date.now() };
}
function squidRun(code, sq, events) {
  const was = sq.s;
  const res = squidStep(sq.s, Date.now() / 1000, events);
  sq.s = res.state;
  if (res.out.length || res.state.phase !== was.phase || res.state.seq !== was.seq) roomBroadcast(code, squidMsg(sq, res.out));
  return res.out;
}
function onSquidMessage(code, id, m, rmeta) {
  const city = String(m.city || '').slice(0, 32);
  const i = Math.round(Number(m.i));
  if (!city || !(i >= 0 && i < 8)) return;
  const g = rmeta.game;
  const hunt = g?.game === 'squid' && g.phase === 'live';
  const sq = squidFor(rmeta, city, i, hunt && m.boss);
  if (!sq) return;
  if (m.t === 'squid-near') {
    const num = (v) => (Number.isFinite(+v) ? +v : 0);
    // While another room game runs, the squids leave everyone alone.
    const busy = g?.phase === 'live' && g.game !== 'squid';
    squidRun(code, sq, [{ type: 'near', id, d: num(m.d), alt: num(m.alt), kind: String(m.kind || '').slice(0, 8), x: num(m.x), y: num(m.y), z: num(m.z), el: !!m.el && !busy }]);
  } else if (m.t === 'squid-hit') {
    const kind = HIT_KINDS.has(m.kind) ? m.kind : 'punch';
    const out = squidRun(code, sq, [{ type: 'hit', id, dmg: Number(m.dmg) || 0, kind }]);
    if (hunt) huntScore(code, rmeta, sq, id, out, m);
  } else if (m.t === 'squid-fed') squidRun(code, sq, [{ type: 'fed', id }]);
  else if (m.t === 'squid-free') squidRun(code, sq, [{ type: 'free', id }]);
  else if (m.t === 'squid-lost') {
    const out = squidRun(code, sq, [{ type: 'lost', id }]);
    if (hunt && out.some((o) => o.type === 'drag')) huntScore(code, rmeta, sq, id, out, m);
  }
}
/** Squid Hunt in a room: the relay awards the points, so every screen agrees. */
function huntScore(code, rmeta, sq, id, out, m) {
  const g = rmeta.game;
  if (!g?.scores || Date.now() < g.goAt) return;
  const add = (pid, n) => {
    if (g.scores[pid]) g.scores[pid].score = Math.max(0, (g.scores[pid].score || 0) + n);
  };
  const size = [0.25, 0.5, 1, 2, 4, 8].includes(+m.size) ? +m.size : 1;
  for (const o of out) {
    if (o.type === 'hit') {
      add(o.id, o.kind === 'melon' ? 2 : o.kind === 'car' ? 3 : o.kind === 'stomp' ? 4 : size >= 4 ? 3 : size >= 2 ? 2 : 1);
      if (o.freed && o.freed !== o.id) add(o.id, 5);
    } else if (o.type === 'beaten') {
      add(o.by, 10);
      for (const pid of g.players) if (flights.get(code)?.has(pid)) add(pid, 10);
    } else if (o.type === 'drag') add(o.id, -3);
  }
  roomBroadcast(code, { t: 'game-scores', scores: g.scores, finished: g.finished });
  if (out.some((o) => o.type === 'beaten')) finishGame(code);
}
// Ten times a second: timers run out (wind-ups, struggles, rests) even when nobody reports.
setInterval(() => {
  for (const [code, rmeta] of meta) {
    for (const sq of rmeta.squids?.values() || []) {
      if (sq.s.phase === 'asleep' && !Object.keys(sq.s.near).length) continue;
      squidRun(code, sq, []);
    }
  }
}, 100);

function joinFlight(ws, code, wanted) {
  let room = flights.get(code);
  if (!room) {
    flights.set(code, (room = new Map()));
    roomSettings.set(code, wanted);
    meta.set(code, { order: [], host: null, game: null, trophies: {}, props: new Map(), smashed: new Set(), opts: { shove: true }, squids: new Map() });
  }
  const rmeta = meta.get(code);
  if (room.size >= 8) {
    ws.close(1008, 'room full');
    return;
  }
  const id = nextId++;
  room.set(id, ws);
  rmeta.order.push(id);
  if (!rmeta.host) rmeta.host = id;
  const others = (fn) => {
    for (const [oid, sock] of room) if (oid !== id && sock.readyState === 1) fn(sock);
  };
  // Everyone in a room flies the same city and look (vehicles are each player's own).
  ws.send(JSON.stringify({ t: 'welcome', id, players: room.size, settings: roomSettings.get(code), host: rmeta.host, now: Date.now(), trophies: rmeta.trophies, opts: rmeta.opts }));
  // Catch up on the shared world, in pieces.
  const city = roomSettings.get(code)?.city;
  const ps = [...rmeta.props.values()];
  const sm = [...rmeta.smashed];
  const chunks = Math.max(Math.ceil(ps.length / 150), Math.ceil(sm.length / 600));
  for (let k = 0; k < chunks; k++) {
    ws.send(JSON.stringify({ t: 'catchup', city, props: ps.slice(k * 150, k * 150 + 150), smashed: sm.slice(k * 600, k * 600 + 600) }));
  }
  if (rmeta.cars?.size) ws.send(JSON.stringify({ t: 'catchup', city, cars: [...rmeta.cars].slice(0, 3000) }));
  // The squids as they are now (a fleeing or resting one shows as asleep).
  for (const sq of rmeta.squids.values()) ws.send(JSON.stringify(squidMsg(sq)));
  if (rmeta.game?.phase === 'countdown') {
    rmeta.game.players.push(id); // joined during the countdown: you're in
    sendGame(code);
  } else ws.send(JSON.stringify(gameMsg(code)));
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
    if (SQUID_MSGS.has(m.t)) return onSquidMessage(code, id, m, rmeta);
    if (typeof m.t === 'string' && m.t.startsWith('game-')) {
      const g = rmeta.game;
      if (g && m.name) g.names[id] = String(m.name).slice(0, 16);
      return onGameMessage(code, id, m);
    }
    // Room options (robot shoving on or off): host only, remembered for late joiners.
    if (m.t === 'room-opts') {
      if (rmeta.host !== id || typeof m.opts !== 'object' || !m.opts) return;
      rmeta.opts = { ...rmeta.opts, shove: m.opts.shove !== false };
      m.opts = rmeta.opts;
      const out = JSON.stringify(m);
      for (const sock of room.values()) if (sock.readyState === 1) sock.send(out); // the host gets it back too
      return;
    }
    // Remember the shared world for players who join later: where moved or
    // resized objects ended up, and which buildings are down (capped).
    if (m.t === 'prop' || m.t === 'pick') {
      const pid = String(m.pid || '').slice(0, 24);
      if (pid && (rmeta.props.size < 600 || rmeta.props.has(pid))) {
        rmeta.props.set(pid, { pid, kind: String(m.kind || '').slice(0, 16), tint: +m.tint || 0, x: +m.x || 0, z: +m.z || 0, yaw: +m.yaw || 0, scale: +m.scale || 1, held: m.t === 'pick' ? 1 : m.held ? 1 : 0 });
      }
    } else if (m.t === 'car-gone' && Number.isInteger(m.i)) {
      if ((rmeta.cars ||= new Set()).size < 3000) rmeta.cars.add(m.i);
    } else if (m.t === 'smash' && Array.isArray(m.ids)) {
      for (const sid of m.ids.slice(0, 60)) if (rmeta.smashed.size < 6000 && Number.isInteger(sid)) rmeta.smashed.add(sid);
    }
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
    const name = info.get(ws)?.name;
    info.delete(ws);
    updateLobby();
    others((sock) => sock.send(JSON.stringify({ t: 'leave', id })));
    rmeta.order = rmeta.order.filter((x) => x !== id);
    const g = rmeta.game;
    if (g && name) g.names[id] = name;
    if (room.size === 0) {
      clearTimeout(g?.timer);
      flights.delete(code);
      roomSettings.delete(code);
      meta.delete(code);
      return;
    }
    if (rmeta.host === id) {
      // The crown passes to whoever has been in the room longest.
      rmeta.host = rmeta.order[0];
      others((sock) => sock.send(JSON.stringify({ t: 'host', host: rmeta.host })));
    }
    if (g?.phase === 'countdown') {
      g.players = g.players.filter((x) => x !== id);
      sendGame(code);
    } else if (g?.phase === 'live') {
      const live = g.players.filter((x) => room.has(x));
      if (!live.length) cancelGame(code);
      else if (GAMES[g.game].kind === 'race' ? live.every((x) => g.scores[x].done) : false) finishGame(code);
      else sendGame(code);
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

// Phone-controller relay: passes messages between a game screen and the phones
// paired with it. Rooms are 4-letter codes shown on the game screen.
//
//   game  -> ws(s)://HOST/ws?role=game&room=ABCD
//   phone -> ws(s)://HOST/ws?role=pad&room=ABCD
//
// Phone messages go to the room's game; game messages go to the room's phones.
// Run: node server/relay.js   (PORT env, default 8787)
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 8787;
const rooms = new Map(); // code -> { game, pads: Set }

const wss = new WebSocketServer({ port: PORT, path: '/ws', maxPayload: 4096 });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const role = url.searchParams.get('role');
  const code = (url.searchParams.get('room') || '').toUpperCase();
  if (!/^[A-Z]{4}$/.test(code) || (role !== 'game' && role !== 'pad')) {
    ws.close(1008, 'bad room or role');
    return;
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

console.log(`Phone-controller relay listening on :${PORT}/ws`);

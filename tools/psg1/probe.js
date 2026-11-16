// Test helpers injected into BOTH players' pages for plan 06 (task 1.7):
// the Chrome tab (paste into Claude in Chrome's javascript tool) and the PSG1
// (node tools/psg1/cdp.cjs inject). Needs the page opened with ?debug.
//   __t.state()   one snapshot to compare side by side ("both screens agree")
//   __t.near(d)   move me d metres beside the nearest other player (saves minutes per test)
window.__t = {
  r: (v, n = 1) => Math.round(v * 10 ** n) / 10 ** n,
  state() {
    const g = window.__game, f = g.flight, mp = g.mp, rg = g.roomGame?.() || {};
    const p = g.isBot ? g.bot().walk?.pos || f.pos : f.pos;
    return {
      me: mp.myId, name: mp.name, status: mp.status, room: mp.room, host: mp.host ?? null,
      pos: [p.x, p.y, p.z].map((v) => this.r(v)), speed: this.r(f.speed), vehicle: JSON.parse(localStorage.getItem('legosky.settings') || '{}').vehicle || null, bot: !!g.isBot,
      players: [...mp.players.values()].map((o) => ({ id: o.id, name: o.name, city: o.city, vehicle: o.vehicle, bot: o.bot, size: o.size,
        ride: o.ride?.kind || null, pos: [o.pos.x, o.pos.y, o.pos.z].map((v) => this.r(v)) })),
      game: rg.g ? { game: rg.g.game, phase: rg.g.phase, players: rg.g.players, left: rg.g.startsAt ? this.r((rg.g.startsAt - mp.serverNow()) / 1000) : null } : null,
      psg1: document.body.classList.contains('psg1'),
      fps: document.getElementById('fps')?.textContent || null,
      t: Date.now(),
    };
  },
  near(d = 15) {
    const g = window.__game, f = g.flight;
    const o = [...g.mp.players.values()].sort((a, b) => a.pos.distanceTo(f.pos) - b.pos.distanceTo(f.pos))[0];
    if (!o) return 'nobody here';
    f.pos.set(o.pos.x + d, o.pos.y, o.pos.z);
    if (g.isBot) g.bot().walk?.pos?.copy(f.pos);
    return `beside ${o.name}`;
  },
};
'probe ready';

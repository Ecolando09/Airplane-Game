import * as THREE from 'three';
import { SQUID, newSquid, step, isAwake, isOut, canBeHit, punchDamage, publicSquid, ranges, huntPoints, HUNT_POINTS, bossHealth } from './squidbrain.js';
import { findSquidSpots, SquidModel, nearWater } from './squid.js';

// The giant squid in the game (plan 07): connects the rules (squidbrain.js) and
// the looks (squid.js) to the player. Solo and offline, this runs the brain
// itself; in a multiplayer room the relay runs it and sends the state, and this
// only reports where the player is and what they did.
//
// The player held by a tentacle is the judge of their own struggle: the meter
// fills with the escape for their vehicle (throttle and turbo, lift, the horn,
// punches, a barrel roll, a watermelon) and they report "free" or "lost".

/** The squid's marker colour on screen: deep navy blue. */
export const SQUID_NAVY = '#0b1f4d';

/** The big cities get up to three squids; the others one. */
export const BIG_CITIES = ['sanfrancisco', 'hongkong', 'tokyo', 'singapore'];

const HINTS = {
  plane: 'Full throttle and TURBO to pull free, or a barrel roll to snap the tentacle!',
  heli: 'Hold LIFT up (turbo helps) to pull free!',
  boat: 'Mash the HORN boost to break free!',
  car: 'Mash the HORN boost to break free!',
  bot: 'SMASH the tentacle to break free!',
  tiny: "Too small to fight it! A friend can punch it, or throw a 🍉",
};

export class SquidPlay {
  /**
   * hooks: player() → { el, kind, pos, size, throttle, turbo, lift } (el: may be grabbed),
   *        room() → in a live multiplayer room, send(msg), serverNow() (ms), myId(), friendPos(id),
   *        message(html, s), toast(text, color), sound(kind), noise(kind, size), shake(k),
   *        lose(kind), freed(), beaten(), splat(), burst(x, y, z, size, hex, n), onHit(out, mine)
   */
  constructor(scene, world, { light = false, city = '', hooks }) {
    Object.assign(this, { scene, world, light, city, hooks });
    const found = findSquidSpots(world, { big: BIG_CITIES.includes(city) });
    this.spots = found.spots;
    this.deepArea = found.deepArea;
    this.squids = this.spots.map((sp) => ({ spot: sp, s: newSquid(), model: null, age0: 0 }));
    this.clock = 0; // solo time (s), advanced by the frame step so tests can step it
    this.wasRoom = hooks.room(); // (a room's catch-up can arrive before the first frame)
    this.held = null; // { i, since (s), meter, start: Vector3, kind, lostSent, freeSent }
    this.sendAt = 0;
    this.on = true; // Settings → Sea monster
    this.boss = -1; // Squid Hunt: the index of the boss squid
    this.lastHit = -9;
    this._v = new THREE.Vector3();
    this._ui();
  }

  /** The on-screen struggle meter and the ink splat. */
  _ui() {
    const hud = document.getElementById('hud') || document.body;
    this.meterEl = Object.assign(document.createElement('div'), { id: 'squidMeter', hidden: true });
    this.meterEl.style.cssText = 'position:absolute;left:50%;top:22%;transform:translateX(-50%);width:min(420px,80vw);padding:10px 14px;'
      + 'background:rgba(20,10,40,.82);border:3px solid #ff5fa2;border-radius:14px;color:#fff;font:700 16px system-ui,sans-serif;text-align:center;z-index:30;pointer-events:none';
    this.meterEl.innerHTML = '<div class="t">🦑 GRABBED BY THE SQUID!</div><div class="h" style="font-weight:500;font-size:13px;margin:4px 0 8px"></div>'
      + '<div style="height:16px;background:#3a2a5a;border-radius:8px;overflow:hidden"><i style="display:block;height:100%;width:0;background:linear-gradient(90deg,#ff5fa2,#ffd21f)"></i></div>'
      + '<div style="height:6px;background:#3a2a5a;border-radius:3px;overflow:hidden;margin-top:5px"><b style="display:block;height:100%;width:100%;background:#7df0ff"></b></div>';
    hud.appendChild(this.meterEl);
    this.inkEl = Object.assign(document.createElement('div'), { id: 'squidInk', hidden: true });
    this.inkEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:25;'
      + 'background:radial-gradient(circle at 30% 40%,rgba(20,8,36,.92) 0 18%,transparent 19%),radial-gradient(circle at 70% 55%,rgba(20,8,36,.9) 0 22%,transparent 23%),'
      + 'radial-gradient(circle at 50% 30%,rgba(20,8,36,.85) 0 14%,transparent 15%),radial-gradient(circle at 42% 70%,rgba(20,8,36,.88) 0 16%,transparent 17%)';
    document.body.appendChild(this.inkEl);
  }

  /** Time on the squids' clock (s): the server's in a room, else our own. */
  now() {
    return this.hooks.room() ? this.hooks.serverNow() / 1000 : this.clock;
  }

  /** The squid nearest (x, z), with its distance: { sq, d } or null. */
  nearest(x, z) {
    let best = null;
    for (const sq of this.squids) {
      const d = Math.hypot(sq.spot.x - x, sq.spot.z - z);
      if (!best || d < best.d) best = { sq, d };
    }
    return best;
  }

  /** Is the player held right now (the frame loop then skips their own movement)? */
  get holding() {
    return !!this.held;
  }

  // ---------------------------------------------------------------- per frame
  update(dt, ctl = {}) {
    const room = this.hooks.room();
    if (room !== this.wasRoom) {
      // Joined or left a room: the relay (or we) own the squids from now on.
      this.wasRoom = room;
      for (const sq of this.squids) sq.s = newSquid({ boss: sq.s.boss, health: sq.s.boss ? sq.s.maxHealth : undefined });
      this._release(false);
    }
    this.clock += dt;
    const now = this.now();
    const me = this.on ? this.hooks.player() : { el: false };
    const myId = room ? this.hooks.myId() : 'me';
    for (const sq of this.squids) {
      const events = [];
      let report = null;
      if (me.pos) {
        const d = Math.hypot(me.pos.x - sq.spot.x, me.pos.z - sq.spot.z);
        const r = ranges(sq.s);
        if (d < r.aware + 60 && this.on) {
          const alt = me.pos.y - sq.spot.y;
          const el = !!me.el && (sq.s.boss || this.boss < 0) && nearWater(this.world, me.pos.x, me.pos.z);
          report = { type: 'near', id: myId, d, alt, kind: me.kind, x: me.pos.x, y: me.pos.y, z: me.pos.z, el };
        }
      }
      if (room) {
        if (report && now - (sq.sentAt || 0) > 0.2) {
          sq.sentAt = now;
          const { type, id, ...rest } = report;
          this.hooks.send({ t: 'squid-near', city: this.city, i: sq.spot.i, boss: sq.s.boss ? 1 : 0, ...roundAll(rest) });
        }
      } else {
        if (report) events.push(report);
        const res = step(sq.s, now, events);
        sq.s = res.state;
        for (const o of res.out) this._onOut(sq, o, 'me');
      }
    }
    this._struggle(dt, ctl, now, me);
    this._animate(dt, now);
  }

  /** A squid's state from the relay (room games and the shared world). */
  onMessage(m) {
    if (m.t !== 'squid' || m.city !== this.city) return;
    const sq = this.squids[m.i];
    if (!sq || !m.s) return;
    this.wasRoom = true; // the relay owns the squids now (don't reset this state on the next frame)
    this.got = (this.got || 0) + 1; // (messages received: for tests)
    sq.s = { ...m.s, near: {}, hitBy: m.s.hitBy || [] };
    for (const o of m.out || []) this._onOut(sq, o, this.hooks.myId());
    // Held by a state we never saw the grab for (joined mid-grab): not us, nothing to do.
    if (this.held && this.held.i === m.i && !(sq.s.phase === 'hold' && sq.s.target?.id === this.hooks.myId())) {
      if (sq.s.phase !== 'drag') this._release(true);
    }
  }

  /** What the brain said happened: sounds, effects, messages, and the struggle. */
  _onOut(sq, o, myId) {
    const h = this.hooks;
    const me = o.id === myId;
    const sp = sq.spot;
    const model = sq.model;
    const close = this._distTo(sp) < 450;
    switch (o.type) {
      case 'wake':
        if (close && !sq.s.boss) {
          h.message('🦑 Something huge stirs under the water…<small>Bubbles and a shadow: stay high or keep away</small>', 3);
          h.noise('rumble', 0.8);
          h.shake(0.5);
        }
        for (let n = 0; n < 3; n++) h.burst(sp.x + (Math.random() - 0.5) * 20, sp.y, sp.z + (Math.random() - 0.5) * 20, 3, 0xe8f6ff, 4);
        break;
      case 'windup':
        if (me) {
          h.message('⚠️ THE SQUID IS ABOUT TO STRIKE!<small>Climb, turbo or turn away, now!</small>', 1.6);
          h.sound('rise');
        }
        if (close) h.noise('rumble', 0.6);
        break;
      case 'strike':
        h.burst(sp.x, sp.y + 2, sp.z, 18 * (sq.s.boss ? 1.3 : 1), 0xe8f6ff, 26);
        h.burst(sp.x, sp.y + 2, sp.z, 14, 0x3d8fd0, 18);
        if (close) {
          h.noise('splash', 1);
          h.shake(0.7);
        }
        break;
      case 'grab':
        if (me) this._grabbed(sq, o.kind);
        break;
      case 'miss':
        if (close) h.burst(sp.x, sp.y + 1, sp.z, 8, 0xe8f6ff, 10);
        break;
      case 'free':
      case 'drop':
        model?.squirt();
        if (this.held?.i === sp.i && me) this._release(true);
        if (this._distTo(sp) < 140) h.splat();
        break;
      case 'drag':
        if (me && this.held?.i === sp.i) {
          const kind = this.held.kind;
          this.held = null;
          this.meterEl.hidden = true;
          h.burst(sp.x, sp.y + 1, sp.z, 12, 0xe8f6ff, 20);
          h.noise('splash', 1);
          h.lose(kind);
        }
        break;
      case 'hit':
        if (model) model.flinch = 1;
        if (o.dmg >= 2) model?.squirt();
        if (o.freed && o.freed === myId) this._release(true);
        h.onHit?.(o, o.id === myId, sq);
        break;
      case 'flinch':
        h.noise('splash', 0.5);
        break;
      case 'stun':
        if (model) model.flash = SQUID.STUN;
        h.zap?.(sq);
        break;
      case 'fed':
        if (close) h.message('🦑 The squid grabbed the car instead!<small>That buys about 20 seconds</small>', 2.5);
        h.burst(sp.x, sp.y + 1, sp.z, 10, 0xe8f6ff, 14);
        break;
      case 'flee':
        model?.squirt();
        if (close || o.hitBy?.includes(myId)) h.toast('🦑 The squid has had enough! It dives deep for three minutes.', '#7a3fd0');
        if (o.hitBy?.includes(myId)) h.beaten();
        if (this.held?.i === sp.i) this._release(true);
        break;
      case 'beaten':
        model?.squirt();
        if (this.held?.i === sp.i) this._release(true);
        h.bossBeaten?.(o, sq);
        break;
      default:
        break;
    }
  }

  _distTo(sp) {
    const p = this.hooks.player().pos;
    return p ? Math.hypot(p.x - sp.x, p.z - sp.z) : 1e9;
  }

  // ---------------------------------------------------------------- the struggle
  _grabbed(sq, kind) {
    const me = this.hooks.player();
    const tiny = kind === 'bot' && me.size < 1;
    this.held = { i: sq.spot.i, since: this.now(), meter: 0, start: me.pos.clone(), kind, tiny, punches: 0 };
    this.meterEl.hidden = false;
    this.meterEl.querySelector('.h').textContent = HINTS[tiny ? 'tiny' : kind] || HINTS.plane;
    this.hooks.message('', 0.01);
    this.hooks.noise('splash', 1);
    this.hooks.shake(1);
  }

  /** A button press that counts in the struggle: 'smash' (punch or horn), 'roll' (barrel roll). Returns true if used. */
  press(what) {
    const H = this.held;
    if (!H) return false;
    if (what === 'roll' && H.kind === 'plane') H.meter = 1;
    else if (what === 'smash' && (H.kind === 'boat' || H.kind === 'car')) H.meter += 0.13;
    else if (what === 'smash' && H.kind === 'bot') {
      const size = this.hooks.player().size || 1;
      if (size < 1) {
        this.hooks.message('Too small to fight it off! A friend can punch the tentacle, or throw a 🍉', 2);
        return true;
      }
      H.meter += size >= 4 ? 1 : size >= 2 ? 0.5 : 1 / 3 + 0.001;
      this.hooks.burst(this.hooks.player().pos.x, this.hooks.player().pos.y + 6 * size, this.hooks.player().pos.z, 4, 0xc8412b, 6);
    } else return false;
    return true;
  }

  _struggle(dt, ctl, now, me) {
    const H = this.held;
    if (!H) return;
    const sq = this.squids[H.i];
    if (H.kind === 'plane') {
      const thr = me.throttle ?? 0;
      if (thr >= 0.95) H.meter += dt * 0.3 * (me.turbo > 1 ? me.turbo : 1);
    } else if (H.kind === 'heli') {
      const lift = ctl.liftSet ?? ctl.pitch ?? 0;
      if (lift > 0.5) H.meter += dt * 0.3 * lift * (me.turbo > 1 ? 2 : 1);
    }
    const left = Math.max(0, SQUID.HOLD - (now - H.since));
    this.meterEl.querySelector('i').style.width = `${Math.min(1, H.meter) * 100}%`;
    this.meterEl.querySelector('b').style.width = `${(left / SQUID.HOLD) * 100}%`;
    const room = this.hooks.room();
    if (H.meter >= 1 && !H.freeSent) {
      H.freeSent = true;
      if (room) this.hooks.send({ t: 'squid-free', city: this.city, i: H.i });
      else this._solo(sq, { type: 'free', id: 'me' });
    } else if (left <= 0 && !H.lostSent && !H.freeSent) {
      H.lostSent = true;
      if (room) this.hooks.send({ t: 'squid-lost', city: this.city, i: H.i });
      else this._solo(sq, { type: 'lost', id: 'me' });
    }
  }

  /** Apply one event to a solo squid at once. */
  _solo(sq, ev) {
    const res = step(sq.s, this.now(), [ev]);
    sq.s = res.state;
    for (const o of res.out) this._onOut(sq, o, 'me');
  }

  _release(tell) {
    if (!this.held) return;
    this.held = null;
    this.meterEl.hidden = true;
    if (tell) {
      this.hooks.message('💪 You broke free! Get away from the water!', 2);
      this.hooks.freed();
    }
  }

  /** Where the held player is: in the tentacle's grip, pulled down toward the water. */
  holdPos(out) {
    const H = this.held;
    const sp = this.squids[H.i].spot;
    const a = Math.min(1, Math.max(0, (this.now() - H.since) / SQUID.HOLD));
    const dx = H.start.x - sp.x;
    const dz = H.start.z - sp.z;
    const d = Math.hypot(dx, dz) || 1;
    const r = THREE.MathUtils.lerp(Math.min(d, 45), 18, a);
    const t = this.clock;
    out.set(sp.x + (dx / d) * r + Math.sin(t * 7) * 0.8, 0, sp.z + (dz / d) * r + Math.cos(t * 6) * 0.8);
    const top = Math.min(H.start.y, sp.y + SQUID.REACH_ALT);
    out.y = THREE.MathUtils.lerp(top, sp.y + 4, a) + Math.sin(t * 9) * 0.6;
    return out;
  }

  // ---------------------------------------------------------------- fighting and feeding
  /**
   * A punch, stomp or thrown thing landed at (x, y, z) with radius r. kind:
   * 'punch' | 'stomp' | 'car'. Returns true if it hit a squid.
   */
  blast(x, y, z, r, kind, size = 1) {
    if (!this.on) return false;
    for (const sq of this.squids) {
      if (!canBeHit(sq.s.phase)) continue;
      const sp = sq.spot;
      const reach = isOut(sq.s.phase) ? SQUID.ARM_R : SQUID.BODY_R;
      if (Math.hypot(x - sp.x, z - sp.z) > reach * (sq.s.boss ? 1.25 : 1) + r) continue;
      if (y - r > sp.y + 60 || y + r < sp.y - 12) continue; // (a giant robot's fist lands high, but hits wide)
      if (this.held?.i === sp.i && kind === 'punch') {
        // Held: punching the tentacle is the struggle, not a hit on the squid.
        this.press('smash');
        return true;
      }
      const dmg = kind === 'punch' ? punchDamage(size) : kind === 'stomp' ? SQUID.STOMP : SQUID.CAR;
      this.hit(sq, kind, dmg, size);
      return true;
    }
    return false;
  }

  /** Report a hit on a squid (damage decided by the hitter's game). */
  hit(sq, kind, dmg, size = 1) {
    this.lastHit = this.clock;
    if (this.hooks.room()) this.hooks.send({ t: 'squid-hit', city: this.city, i: sq.spot.i, dmg, kind, size });
    else this._solo(sq, { type: 'hit', id: 'me', dmg, kind, size });
  }

  /** A thrown thing came down at (x, z): in the water beside an awake squid, it's eaten instead of you. */
  landed(x, z) {
    if (!this.on || this.clock - this.lastHit < 0.25 || !this.world.isWater(x, z)) return false;
    for (const sq of this.squids) {
      if (!['aware', 'windup', 'strike', 'hold'].includes(sq.s.phase)) continue;
      if (Math.hypot(x - sq.spot.x, z - sq.spot.z) > SQUID.FEED_R) continue;
      if (this.hooks.room()) this.hooks.send({ t: 'squid-fed', city: this.city, i: sq.spot.i });
      else this._solo(sq, { type: 'fed', id: 'me' });
      return true;
    }
    return false;
  }

  /** A watermelon at p: did it hit a squid that's up? (anywhere within its body or raised arms) */
  melonHit(p) {
    for (const sq of this.squids) {
      if (!canBeHit(sq.s.phase)) continue;
      const sp = sq.spot;
      const reach = (isOut(sq.s.phase) ? SQUID.ARM_R : SQUID.BODY_R + 6) * (sq.s.boss ? 1.25 : 1);
      if (Math.hypot(p.x - sp.x, p.z - sp.z) < reach && p.y < sp.y + (isOut(sq.s.phase) ? 50 : 8) && p.y > sp.y - 6) return sq;
    }
    return null;
  }

  /** The squid holding me (a held player's melon always hits it). */
  get holder() {
    return this.held ? this.squids[this.held.i] : null;
  }

  /** An awake squid within the watermelon prompt's range of (x, z)? */
  awakeNear(x, z, r = SQUID.MELON_R) {
    return this.on && this.squids.some((sq) => isAwake(sq.s.phase) && Math.hypot(x - sq.spot.x, z - sq.spot.z) < r);
  }

  // ---------------------------------------------------------------- drawing
  _animate(dt, now) {
    const cam = this.hooks.camera?.();
    const me = this.hooks.player().pos;
    const eye = cam?.position || me;
    for (const sq of this.squids) {
      const sp = sq.spot;
      const d = eye ? Math.hypot(eye.x - sp.x, eye.z - sp.z) : 0;
      const show = this.on && d < 4000;
      if (show && !sq.model) sq.model = new SquidModel(this.scene, sp, { light: this.light, boss: sq.s.boss });
      if (sq.model && sq.model.boss !== sq.s.boss) {
        sq.model.dispose();
        sq.model = new SquidModel(this.scene, sp, { light: this.light, boss: sq.s.boss });
      }
      if (!sq.model) continue;
      const m = sq.model;
      for (const o of [m.group, m.shadow, m.ripple, m.ripple2, m.ink, m.bulge]) o.visible = show && (o !== m.bulge || o.visible);
      if (!show) continue;
      let target = null;
      const t = sq.s.target;
      if (t) {
        if (this.held?.i === sp.i) target = this.hooks.player().pos;
        else target = this.hooks.friendPos?.(t.id) || this._v.set(t.x, t.y, t.z);
      }
      m.update(dt, { phase: sq.s.phase, age: Math.max(0, now - sq.s.t), target, time: this.clock, near: d < 2200 });
    }
  }

  /** Squids for the minimap and the robot radar: within MAP_R of (x, z). */
  marks(x, z, r = SQUID.MAP_R) {
    if (!this.on) return [];
    return this.squids.filter((sq) => Math.hypot(sq.spot.x - x, sq.spot.z - z) < r)
      .map((sq) => ({ x: sq.spot.x, z: sq.spot.z, awake: isAwake(sq.s.phase), boss: sq.s.boss }));
  }

  /**
   * On-screen markers, like the landmark pins: a deep navy "🦑 Giant squid"
   * tag over each squid within 3 km (it says AWAKE! when it stirs). Returns
   * items for the game's label layout; markers not returned are hidden.
   */
  labelItems(p, fmtDist) {
    const items = [];
    for (const sq of this.squids) {
      if (!sq.label) {
        sq.label = Object.assign(document.createElement('div'), { className: 'label pin squid' });
        sq.label.style.setProperty('--pin', SQUID_NAVY);
        (document.getElementById('labels') || document.body).appendChild(sq.label);
      }
      const d = Math.hypot(sq.spot.x - p.x, sq.spot.z - p.z);
      if (!this.on || d > 3000) {
        sq.label.style.display = 'none';
        continue;
      }
      const awake = isAwake(sq.s.phase);
      const text = `🦑 ${sq.s.boss ? 'Squid boss' : 'Giant squid'}${awake ? ' · AWAKE!' : ''} · ${fmtDist(d)}`;
      if (sq.label.textContent !== text) sq.label.textContent = text;
      items.push({ el: sq.label, x: sq.spot.x, y: sq.spot.y + 60, z: sq.spot.z, d, pin: true });
    }
    return items;
  }

  /** The squid nearest downtown: the Squid Hunt boss. -1 if the city has none. */
  bossIndex(downtown) {
    let best = -1;
    let bd = Infinity;
    for (const sq of this.squids) {
      const d = Math.hypot(sq.spot.x - downtown.x, sq.spot.z - downtown.z);
      if (d < bd) {
        bd = d;
        best = sq.spot.i;
      }
    }
    return best;
  }

  /** Squid Hunt solo: squid i becomes the boss (more health, two extra arms, short rests, never flees). */
  makeBoss(i, health = bossHealth(0)) {
    this.boss = i;
    const sq = this.squids[i];
    if (sq && !this.hooks.room()) sq.s = newSquid({ boss: true, health });
    this._release(false);
  }

  /** Back to normal squids. */
  endBoss() {
    const sq = this.squids[this.boss];
    if (sq && !this.hooks.room()) sq.s = newSquid();
    this.boss = -1;
  }

  /** Settings → Sea monster: off hides them and stops every attack. */
  setOn(on) {
    this.on = on;
    if (!on) {
      this._release(false);
      for (const sq of this.squids) if (sq.model) for (const o of [sq.model.group, sq.model.shadow, sq.model.ripple, sq.model.ripple2, sq.model.ink, sq.model.bulge]) o.visible = false;
    }
  }

  /** For tests and the late-join catch-up: each squid's public state. */
  states() {
    return this.squids.map((sq) => ({ i: sq.spot.i, ...publicSquid(sq.s) }));
  }

  dispose() {
    for (const sq of this.squids) {
      sq.model?.dispose();
      sq.label?.remove();
    }
    this.meterEl.remove();
    this.inkEl.remove();
  }
}

const fmtClock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * Squid Hunt, solo (plan 07): four minutes against the boss squid nearest
 * downtown. Points: watermelon hit 2, punch 1 to 3 by robot size, thrown car 3,
 * stomp 4, the final blow 10 and 10 more for beating it. Pulled under: lose 3
 * and come back after 5 seconds, 300 m out. In a room the relay keeps the
 * score (server/relay.js) and this only keeps the clock.
 * hooks: toast, sound, onEnd(result), room (true in a room game)
 */
export const HUNT_TIME = 240;
export class SquidHunt {
  constructor(squid, hooks) {
    Object.assign(this, { squid, hooks });
    this.active = false;
  }

  start() {
    this.active = true;
    this.timeLeft = HUNT_TIME;
    this.total = 0;
    this.hits = 0;
    this.lost = 0;
    this.last = '';
    this.since = 99;
    this.beaten = false;
  }

  stop() {
    this.active = false;
  }

  dispose() {}

  /** A hit on the boss (from the squid's outs). */
  onHit(o, mine, size = 1) {
    if (!this.active || !mine || this.hooks.room) return;
    const pts = huntPoints(o.kind, size) + (o.freed && o.freed !== o.id ? HUNT_POINTS.free : 0);
    this.total += pts;
    this.hits++;
    this.last = `+${pts} ${o.kind === 'melon' ? '🍉' : o.kind === 'punch' ? '👊' : o.kind === 'car' ? '🚗' : '💥'}`;
    this.since = 0;
  }

  /** Pulled under: lose 3. */
  onLost() {
    if (!this.active) return;
    this.lost++;
    if (!this.hooks.room) this.total = Math.max(0, this.total + HUNT_POINTS.lost);
    this.last = `${HUNT_POINTS.lost} pulled under`;
    this.since = 0;
  }

  /** The boss is beaten: the final blow and the bonus, then the end. */
  onBeaten(o, mine) {
    if (!this.active) return;
    if (!this.hooks.room) this.total += (mine ? HUNT_POINTS.final : 0) + HUNT_POINTS.bonus;
    this.beaten = true;
    this._end();
  }

  update(dt) {
    if (!this.active) return;
    this.timeLeft -= dt;
    this.since += dt;
    if (this.timeLeft <= 10 && !this.warned) {
      this.warned = true;
      this.hooks.toast('⏱ 10 seconds left!', '#c91a09');
    }
    if (this.timeLeft <= 0) this._end();
  }

  _end() {
    if (!this.active) return;
    this.active = false;
    const score = Math.round(this.total);
    this.hooks.onEnd({ score, beaten: this.beaten, hits: this.hits, lost: this.lost, time: HUNT_TIME - Math.max(0, this.timeLeft), stars: score >= 60 ? 3 : score >= 30 ? 2 : score > 0 ? 1 : 0 });
  }

  labelItems() {
    return [];
  }

  mapMarks() {
    const sq = this.squid.squids[this.squid.boss];
    return sq ? [{ x: sq.spot.x, z: sq.spot.z, color: '#0b1f4d', guide: true, kind: 'squid' }] : [];
  }

  mapRoute() {
    return null;
  }

  hud(pos, heading) {
    const sq = this.squid.squids[this.squid.boss];
    const hp = sq ? `${sq.s.health}/${sq.s.maxHealth}` : '';
    let mission = null;
    if (sq && pos) {
      const dx = sq.spot.x - pos.x;
      const dz = sq.spot.z - pos.z;
      const bearing = (Math.atan2(dx, -dz) * 180) / Math.PI;
      const d = Math.hypot(dx, dz);
      mission = {
        color: '#0b1f4d', icon: '🦑', rel: bearing - heading, step: `SQUID BOSS · ❤️ ${hp}`,
        where: d > 200 ? 'Fly or wade out to it' : 'Melons, punches, stomps, thrown cars!', next: '',
        dist: d < 300 ? `${Math.round(d * 3.281)} ft` : `${(d / 1609).toFixed(1)} mi`, time: '', frac: sq.s.maxHealth ? sq.s.health / sq.s.maxHealth : 0, hurry: false,
      };
    }
    return {
      cash: `🦑 ${Math.round(this.total)} pts`, clock: fmtClock(Math.max(0, this.timeLeft)), hurry: this.timeLeft < 15,
      combo: '', happy: this.since < 1.5 ? this.last : '', hold: null, dwell: 0, dwellText: '', mission,
    };
  }
}

function roundAll(o) {
  const r = {};
  for (const [k, v] of Object.entries(o)) r[k] = typeof v === 'number' ? Math.round(v * 10) / 10 : v;
  return r;
}

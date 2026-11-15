// The giant squid's rules (plan 07): a pure state machine with no drawing and
// no browser code, so the same file runs in the browser (solo and offline play)
// and inside server/relay.js (multiplayer rooms). One set of rules: solo and
// multiplayer can't drift apart.
//
//   let s = newSquid();
//   ({ state: s, out } = step(s, nowSeconds, events));
//
// Events (what the players' games report):
//   { type: 'near', id, d, alt, kind, x, y, z, el }  someone within range: d = metres from the
//        squid across the water, alt = height above the water, el = it may grab them
//   { type: 'hit', id, dmg, kind }   a punch, thrown car, stomp or watermelon landed on it
//   { type: 'fed', id }              a car was thrown in the water beside it
//   { type: 'free', id }             the held player broke free (they judge their own struggle)
//   { type: 'lost', id }             the held player's struggle ran out
// Out (what happened, for sounds, effects and messages): { type, ... } with type one of
//   wake, windup, strike, grab, miss, free, drag, drop, hit, flinch, stun, fed, flee, beaten, rest, sleep.
//
// States: asleep → aware → windup → strike → hold → drag, or after a miss, an
// escape or a meal: recover → sink → rest (45 s) → asleep. Hit to 0 health it
// flees (3 minutes asleep); the Squid Hunt boss never rests long and never flees.

/** Every tuning number in one place. Distances in metres, times in seconds. */
export const SQUID = {
  AWARE_R: 150, // notices you within this (bubbles, rumble, warning)
  STRIKE_R: 60, // winds up to strike within this
  MAX_ALT: 80, // ignores anything higher above the water
  REACH_ALT: 45, // at the end of the strike, the tentacle reaches this high
  SHORE_R: 30, // ignores anyone on dry land farther than this from the water
  MAP_R: 400, // minimap ripple and robot radar blip
  MELON_R: 600, // the watermelon prompt shows within this of an awake squid
  WINDUP: 1.2, // the warning before a strike: the water bulges, tips break the surface
  STRIKE: 0.7, // tentacles reaching
  HOLD: 4, // the struggle
  HOLD_GRACE: 3, // no word from the held player after the struggle: pulled under anyway
  DRAG: 1.6, // pulled under
  RECOVER: 2.5, // after letting go it stays up a moment: time to hit it
  SINK: 2,
  REST: 45, // before it can wake again (stops an endless grab loop after a respawn)
  FORGET: 4, // nobody near this long: back to sleep
  STUN: 4, // electrocuted by a watermelon
  EAT: 2.5,
  FED_REST: 20, // a thrown car buys this long
  FLEE: 3,
  FLEE_REST: 180, // beaten: three minutes asleep
  HEALTH: 6,
  FEED_R: 90, // a car landing in the water this close is grabbed instead of you
  BODY_R: 16, // a hit within this of the mantle counts
  ARM_R: 42, // ... or within this while its arms are up
  // Damage: punches by robot size (¼ ½ 1 2 4 8), the rest flat.
  PUNCH: { 0.25: 1, 0.5: 1, 1: 1, 2: 2, 4: 3, 8: 3 },
  CAR: 2,
  MELON: 2,
  STOMP: 3,
  // Squid Hunt: one boss squid, more health, two extra arms, no long rests.
  BOSS: { AWARE_R: 520, STRIKE_R: 75, HEALTH_SOLO: 30, HEALTH_BASE: 14, HEALTH_PER: 12, REST: 4, ARMS: 12 },
  ARMS: 10, // eight arms and two long tentacles
};

const UP = new Set(['aware', 'windup', 'strike', 'hold', 'recover', 'stunned', 'eat']);
/** States where it can be hit (somewhere near the surface). */
export const canBeHit = (phase) => UP.has(phase);
/** States shown as "awake" to players (the minimap mark pulses, the melon prompt shows). */
export const isAwake = (phase) => !['asleep', 'rest', 'beaten', 'flee', 'sink', 'drag'].includes(phase);
/** Out of the water (body and arms showing). */
export const isOut = (phase) => ['strike', 'hold', 'recover', 'stunned', 'eat'].includes(phase);

/** A fresh, sleeping squid. boss: the Squid Hunt one. */
export function newSquid({ boss = false, health } = {}) {
  const h = health ?? (boss ? SQUID.BOSS.HEALTH_SOLO : SQUID.HEALTH);
  return { phase: 'asleep', t: 0, until: 0, target: null, health: h, maxHealth: h, boss, quiet: 0, hitBy: [], near: {}, seq: 0 };
}

/** The ranges for this squid (the boss notices you from farther away). */
export const ranges = (s) => (s.boss ? { aware: SQUID.BOSS.AWARE_R, strike: SQUID.BOSS.STRIKE_R } : { aware: SQUID.AWARE_R, strike: SQUID.STRIKE_R });

/** The players' report a squid would act on: eligible, low enough and close enough. */
function candidates(s, r) {
  return Object.values(s.near).filter((n) => n.el && n.alt < SQUID.MAX_ALT && n.d < r);
}

/** Advance one squid to time `now` (seconds), applying `events` first. Returns { state, out }. */
export function step(state, now, events = []) {
  const s = { ...state, near: { ...state.near }, hitBy: [...state.hitBy] };
  const out = [];
  const go = (phase, len, extra = {}) => {
    s.phase = phase;
    s.t = now;
    s.until = len == null ? 0 : now + len;
    s.seq++;
    Object.assign(s, extra);
  };
  const rest = (len = s.boss ? SQUID.BOSS.REST : SQUID.REST) => {
    go('rest', len, { target: null });
    out.push({ type: 'rest', until: s.until });
  };
  const holding = () => s.phase === 'hold' && s.target;
  const drop = () => {
    if (!holding()) return;
    out.push({ type: 'drop', id: s.target.id });
  };

  for (const ev of events) {
    if (ev.type === 'near') {
      s.near[ev.id] = { id: ev.id, d: +ev.d, alt: +ev.alt, kind: ev.kind, x: +ev.x || 0, y: +ev.y || 0, z: +ev.z || 0, el: !!ev.el, at: now };
    } else if (ev.type === 'gone') {
      delete s.near[ev.id];
    } else if (ev.type === 'hit') {
      if (!canBeHit(s.phase)) continue;
      const kind = ev.kind;
      const dmg = Math.max(0, Math.min(5, Math.round(+ev.dmg || 0)));
      if (!s.hitBy.includes(ev.id)) s.hitBy.push(ev.id);
      s.health = Math.max(0, s.health - dmg);
      out.push({ type: 'hit', id: ev.id, dmg, kind, health: s.health, freed: holding() && (kind === 'melon' || ev.id !== s.target.id) ? s.target.id : null });
      if (s.health <= 0) {
        drop();
        if (s.boss) {
          go('beaten', null, { target: null });
          out.push({ type: 'beaten', by: ev.id, hitBy: s.hitBy });
        } else {
          go('flee', SQUID.FLEE, { target: null });
          out.push({ type: 'flee', by: ev.id, hitBy: s.hitBy });
        }
        continue;
      }
      if (kind === 'melon') {
        drop();
        go('stunned', SQUID.STUN, { target: null });
        out.push({ type: 'stun', id: ev.id });
      } else {
        out.push({ type: 'flinch', id: ev.id });
        // A friend's hit (or a car) makes it let go of whoever it holds.
        if (holding() && ev.id !== s.target.id) {
          drop();
          go('recover', SQUID.RECOVER, { target: null });
        }
      }
    } else if (ev.type === 'fed') {
      if (!['aware', 'windup', 'strike', 'hold'].includes(s.phase)) continue;
      drop();
      go('eat', SQUID.EAT, { target: null });
      out.push({ type: 'fed', id: ev.id });
    } else if (ev.type === 'free') {
      if (!holding() || s.target.id !== ev.id) continue;
      out.push({ type: 'free', id: ev.id });
      go('recover', SQUID.RECOVER, { target: null });
    } else if (ev.type === 'lost') {
      if (!holding() || s.target.id !== ev.id) continue;
      out.push({ type: 'drag', id: ev.id });
      go('drag', SQUID.DRAG);
    }
  }

  // Forget reports that stopped coming (left the area, or the game went quiet).
  for (const id in s.near) if (now - s.near[id].at > 3) delete s.near[id];
  const r = ranges(s);
  const near = candidates(s, r.aware);
  const due = s.until && now >= s.until;
  switch (s.phase) {
    case 'asleep':
      if (near.length) {
        go('aware', null, { quiet: now });
        out.push({ type: 'wake' });
      }
      break;
    case 'aware': {
      if (near.length) s.quiet = now;
      else if (now - s.quiet > SQUID.FORGET) {
        go('asleep', null);
        out.push({ type: 'sleep' });
        break;
      }
      const close = candidates(s, r.strike).sort((a, b) => a.d - b.d)[0];
      if (close) {
        go('windup', SQUID.WINDUP, { target: { id: close.id, kind: close.kind, x: close.x, y: close.y, z: close.z } });
        out.push({ type: 'windup', id: close.id, kind: close.kind });
      }
      break;
    }
    case 'windup':
      if (s.target && s.near[s.target.id]) Object.assign(s.target, pick(s.near[s.target.id]));
      if (due) {
        go('strike', SQUID.STRIKE);
        out.push({ type: 'strike', id: s.target?.id });
      }
      break;
    case 'strike': {
      const n = s.target && s.near[s.target.id];
      if (n) Object.assign(s.target, pick(n));
      if (!due) break;
      if (n && n.el && n.d < r.strike * 1.15 && n.alt < SQUID.REACH_ALT) {
        go('hold', SQUID.HOLD + SQUID.HOLD_GRACE);
        out.push({ type: 'grab', id: s.target.id, kind: n.kind });
      } else {
        out.push({ type: 'miss', id: s.target?.id });
        go('recover', SQUID.RECOVER, { target: null });
      }
      break;
    }
    case 'hold':
      if (due) {
        // The held player never said: pulled under all the same.
        out.push({ type: 'drag', id: s.target?.id });
        go('drag', SQUID.DRAG);
      }
      break;
    case 'drag':
      if (due) rest();
      break;
    case 'recover':
    case 'stunned':
      if (due) go('sink', SQUID.SINK, { target: null });
      break;
    case 'sink':
      if (due) rest();
      break;
    case 'eat':
      if (due) rest(s.boss ? SQUID.BOSS.REST : SQUID.FED_REST);
      break;
    case 'flee':
      if (due) rest(SQUID.FLEE_REST);
      break;
    case 'rest':
      if (due) {
        s.health = s.maxHealth;
        s.hitBy = [];
        go('asleep', null, { target: null });
        out.push({ type: 'sleep' });
      }
      break;
    default:
      break;
  }
  return { state: s, out };
}

const pick = (n) => ({ x: n.x, y: n.y, z: n.z, kind: n.kind });

/** What every client needs to draw it (no per-player reports). */
export function publicSquid(s) {
  const { near, ...rest } = s;
  return rest;
}

/** Damage a robot punch does, by robot size. */
export const punchDamage = (size) => SQUID.PUNCH[size] ?? (size >= 4 ? 3 : size >= 2 ? 2 : 1);

/** Squid Hunt boss health: solo, or for a room of n players. */
export const bossHealth = (players = 0) => (players ? SQUID.BOSS.HEALTH_BASE + SQUID.BOSS.HEALTH_PER * players : SQUID.BOSS.HEALTH_SOLO);

/** Squid Hunt points for a hit (punch points by robot size), freeing a friend, or the final blow. */
export const HUNT_POINTS = { melon: 2, punch: { 0.25: 1, 0.5: 1, 1: 1, 2: 2, 4: 3, 8: 3 }, car: 3, stomp: 4, free: 5, final: 10, lost: -3, bonus: 10 };
export function huntPoints(kind, size = 1) {
  if (kind === 'punch') return HUNT_POINTS.punch[size] ?? 1;
  return HUNT_POINTS[kind] ?? 0;
}

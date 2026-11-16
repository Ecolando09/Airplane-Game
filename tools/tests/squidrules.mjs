// The giant squid's rules on their own (no browser): how tough it is, how far it
// reaches, and how it fights back.
//
//   node tools/tests/squidrules.mjs
import { newSquid, step, SQUID, bossHealth } from '../../src/squidbrain.js';
import { check, failed } from './helpers.mjs';

/** A little driver: one player 'a' at distance d, alt metres up, stepping time forward. */
function sim({ d = 120, alt = 10, kind = 'plane', boss = false } = {}) {
  let s = newSquid({ boss });
  let t = 0;
  const seen = [];
  const near = () => ({ type: 'near', id: 'a', d, alt, kind, el: true });
  return {
    get s() { return s; },
    seen,
    run(secs, events = []) {
      let first = true;
      for (let k = 0; k < secs / 0.1; k++) {
        t += 0.1;
        const r = step(s, t, [near(), ...(first ? events : [])]);
        first = false;
        s = r.state;
        seen.push(...r.out);
      }
    },
  };
}

check('a normal squid has 20 health, the solo Squid Hunt boss 45', newSquid().health === 20 && newSquid({ boss: true }).health === 45);
check('room boss: 20 + 14 per player', bossHealth(2) === 48 && bossHealth(4) === 76);

// Reach: it grabs a plane 90 m out and 70 m up (it used to give up past 60 m out, 45 m up).
{
  const r = sim({ d: 90, alt: 70 });
  r.run(4);
  check('it reaches a plane 90 m away and 70 m up', r.seen.some((o) => o.type === 'grab'), r.seen.map((o) => o.type).join(','));
}
{
  const r = sim({ d: 90, alt: 85 });
  r.run(4);
  check('... but not one 85 m up (it strikes and misses)', r.seen.some((o) => o.type === 'miss') && !r.seen.some((o) => o.type === 'grab'), r.seen.map((o) => o.type).join(','));
}
{
  const r = sim({ d: 200, alt: 10 });
  r.run(4);
  check('it notices you 200 m out, but only strikes when you come closer', r.s.phase === 'aware' && !r.seen.some((o) => o.type === 'windup'), r.s.phase);
}

// Angry: hit from 120 m (beyond its normal strike), it comes for you anyway, with a short warning.
{
  const r = sim({ d: 120 });
  r.run(0.3);
  r.run(0.1, [{ type: 'hit', id: 'a', dmg: 2, kind: 'car' }]);
  const w = r.seen.find((o) => o.type === 'windup');
  check('hit from 120 m, it strikes back at you (an angry wind-up)', w && w.angry, JSON.stringify(w));
  check('... with a shorter warning', Math.abs(r.s.until - r.s.t - SQUID.ANGRY_WINDUP) < 1e-9, String(r.s.until - r.s.t));
  r.run(2);
  check('... and grabs you from 120 m', r.seen.some((o) => o.type === 'grab'), r.seen.map((o) => o.type).join(','));
}
{
  const r = sim({ d: 160 });
  r.run(0.3);
  r.run(2, [{ type: 'hit', id: 'a', dmg: 2, kind: 'car' }]);
  check('hit from 160 m (out of its angry reach): no strike back', !r.seen.some((o) => o.type === 'windup' || o.type === 'grab'), r.seen.map((o) => o.type).join(','));
}

// Melons: a stun, then a guard time when melons hurt but don't stun.
{
  const r = sim({ d: 120 });
  r.run(0.3);
  r.run(0.1, [{ type: 'hit', id: 'a', dmg: 2, kind: 'melon' }]);
  check('a watermelon stuns it', r.s.phase === 'stunned');
  const guardUntil = r.s.stunOk;
  check(`it can't be stunned again for ${SQUID.STUN + SQUID.STUN_GUARD} s`, Math.abs(guardUntil - r.s.t - SQUID.STUN - SQUID.STUN_GUARD) < 1e-9);
  // Wake it straight back up as if the guard were still on, and melon it again.
  const t0 = r.s.t;
  r.run(0.1);
  const s2 = { ...r.s, phase: 'aware', t: t0 + 1, until: 0, quiet: t0 + 1 };
  const out = step(s2, t0 + 1.1, [{ type: 'near', id: 'a', d: 120, alt: 10, kind: 'plane', el: true }, { type: 'hit', id: 'a', dmg: 2, kind: 'melon' }]);
  check('a second melon during the guard: hurts, no stun, and it comes for the thrower', out.state.health === 16 && out.state.phase === 'windup' && out.state.angry && out.out.some((o) => o.resisted), JSON.stringify(out.out));
}

// Hurt: below half health it winds up faster.
{
  const s = { ...newSquid(), phase: 'aware', health: 9, t: 0, quiet: 0 };
  const o = step(s, 0.1, [{ type: 'near', id: 'a', d: 50, alt: 10, kind: 'plane', el: true }]);
  check('below half health it winds up faster', o.state.phase === 'windup' && Math.abs(o.state.until - o.state.t - SQUID.HURT_WINDUP) < 1e-9, String(o.state.until - o.state.t));
}

process.exit(failed() ? 1 : 0);

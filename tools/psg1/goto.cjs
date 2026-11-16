// Move the PSG1's controller highlight (.padfocus) to a menu element using only
// the D-pad, the way a player would (plan 06).
//   node tools/psg1/goto.cjs mpLeave            element id (or a CSS selector)
//   node tools/psg1/goto.cjs "#mpRooms button" 60   selector, max presses
// Prints each step; exits 1 if it can't get there.
const { evaluate } = require('./cdp.cjs');
const { press } = require('./pad.cjs');

const target = process.argv[2];
const max = Number(process.argv[3] || 50);
const sel = /^[A-Za-z][\w-]*$/.test(target) ? `#${target}` : target;

const where = () => evaluate(`(() => {
  const t = document.querySelector(${JSON.stringify(sel)});
  const f = document.querySelector('.padfocus');
  if (!t) return { err: 'no element ' + ${JSON.stringify(sel)} };
  const label = (e) => e ? (e.id || e.className.split(' ')[0]) + ':' + (e.textContent || e.value || '').trim().slice(0, 24) : 'none';
  const at = !!f && (f === t || t.contains(f));
  const below = f ? t.getBoundingClientRect().top > f.getBoundingClientRect().top + 2 : true;
  return { at, below, now: label(f) };
})()`);

(async () => {
  let last = null, stuck = 0;
  for (let i = 0; i <= max; i++) {
    const w = await where();
    if (w.err) throw new Error(w.err);
    console.log(`${i} ${w.now}`);
    if (w.at) return;
    stuck = w.now === last ? stuck + 1 : 0;
    if (stuck > 3) throw new Error('highlight is not moving');
    last = w.now;
    press([w.below ? 'DOWN' : 'UP']);
  }
  throw new Error(`did not reach ${sel} in ${max} presses`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

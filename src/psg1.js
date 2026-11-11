// PSG1 support (Play Solana's handheld: a 1240 x 1080 screen and built-in
// gamepad with Nintendo-style labels, A on the right and B at the bottom), and
// gamepad navigation of menus, which every build uses.
//
// In the PSG1 build the page is a fixed 620 x 540 CSS pixels (src/psg1.css),
// touch controls are hidden, and hints name the PSG1's buttons.

// PSG1 mode is the PSG1 app's own build (vite build --mode psg1): the website
// never turns it on.
export const isPsg1 = () => __PSG1__;

/** Switch the page into PSG1 mode. */
export function enablePsg1() {
  document.body.classList.add('psg1');
  document.body.classList.remove('is-touch');
}
if (__PSG1__) enablePsg1();

/**
 * Button names as printed on the PSG1, for hints. The browser's standard
 * gamepad numbers buttons by position: 0 bottom, 1 right, 2 left, 3 top.
 */
export const PSG1_LABEL = { 0: 'B', 1: 'A', 2: 'Y', 3: 'X', 4: 'L1', 5: 'R1', 6: 'L2', 7: 'R2', 8: 'SELECT', 9: 'START', 12: '▲', 13: '▼', 14: '◀', 15: '▶' };

/** A small round button glyph for hints, e.g. pad('A'). */
export const pad = (label) => `<kbd class="pad pad-${label.replace(/[^A-Z0-9]/g, '') || 'dpad'}">${label}</kbd>`;

// ------------------------------------------------------------------ menu navigation (any gamepad)
// Moves a highlight between the buttons of whatever is on top (the menu or a
// pop-up) with the D-pad or stick, presses the highlighted one, and goes back.

const FOCUSABLE = 'button, summary, input, select, [tabindex="0"]';

function visible(el) {
  if (el.disabled || el.closest('[hidden]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const st = getComputedStyle(el);
  return st.visibility !== 'hidden' && st.display !== 'none' && st.pointerEvents !== 'none';
}

export class PadNav {
  /** @param getRoot () => the element whose buttons can be reached, or null */
  constructor(getRoot) {
    this.getRoot = getRoot;
    this.current = null;
    this.root = null;
  }

  items() {
    const root = this.getRoot();
    if (!root) return [];
    // Inside a closed <details>, only its summary can be reached.
    return [...root.querySelectorAll(FOCUSABLE)].filter((el) => {
      const d = el.parentElement?.closest('details');
      if (d && !d.open && el.tagName !== 'SUMMARY') return false;
      return visible(el);
    });
  }

  /** Highlight an element (or the best first choice in the current root). */
  focus(el) {
    this.current?.classList.remove('padfocus');
    this.current = el || null;
    if (!el) return;
    el.classList.add('padfocus');
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /** Call every frame: re-picks a highlight when the root changes. */
  sync() {
    const root = this.getRoot();
    if (root !== this.root) {
      this.root = root;
      if (!root) return this.focus(null);
      const first = root.querySelector('.big.go:not([hidden]):not([disabled])') || this.items()[0];
      this.focus(first && visible(first) ? first : this.items()[0]);
    } else if (this.current && (!this.current.isConnected || !visible(this.current))) {
      this.focus(this.items()[0]);
    }
  }

  /** Move the highlight: dx, dy in -1..1 (one of them zero). */
  move(dx, dy) {
    const items = this.items();
    if (!items.length) return;
    if (!this.current || !items.includes(this.current)) return this.focus(items[0]);
    const a = this.current.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let best = null;
    let bestScore = Infinity;
    for (const el of items) {
      if (el === this.current) continue;
      const b = el.getBoundingClientRect();
      const bx = b.left + b.width / 2;
      const by = b.top + b.height / 2;
      const along = dx ? (bx - ax) * dx : (by - ay) * dy;
      // Must be in that direction (a little overlap allowed for rows of cards).
      const edge = dx ? (dx > 0 ? b.left - a.right : a.left - b.right) : (dy > 0 ? b.top - a.bottom : a.top - b.bottom);
      if (along <= 4 || edge < -Math.min(a.width, a.height) * 0.6) continue;
      const across = dx ? Math.abs(by - ay) : Math.abs(bx - ax);
      const score = along + across * 2.5;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (best) this.focus(best);
  }

  /** Press the highlighted element. */
  press() {
    const el = this.current;
    if (!el || !visible(el)) return false;
    if (el.tagName === 'INPUT' && el.type === 'range') return false;
    if (el.tagName === 'INPUT' && el.type !== 'checkbox') {
      el.focus();
      return true;
    }
    el.click();
    return true;
  }

  /** Left/right on a slider changes its value. Returns true if handled. */
  nudge(dx) {
    const el = this.current;
    if (!el || el.tagName !== 'INPUT' || el.type !== 'range') return false;
    const step = Number(el.step) || 1;
    el.value = String(Math.min(Number(el.max), Math.max(Number(el.min), Number(el.value) + dx * step)));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
}

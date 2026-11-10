// Tiny synthesized propeller engine (no audio files needed).
export class EngineSound {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.osc = ctx.createOscillator();
    this.osc.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.osc.connect(this.filter);
    this.osc2.connect(this.filter);
    this.filter.connect(this.gain).connect(ctx.destination);
    this.osc.start();
    this.osc2.start();
  }

  update(throttle, speed) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 38 + throttle * 55 + speed * 0.3;
    this.osc.frequency.setTargetAtTime(f, t, 0.1);
    this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.1);
    this.filter.frequency.setTargetAtTime(300 + throttle * 900, t, 0.1);
    this.gain.gain.setTargetAtTime(this.muted ? 0 : 0.04 + throttle * 0.08, t, 0.15);
  }

  toggle() {
    this.muted = !this.muted;
  }

  /** Short game sounds: 'load' (rising), 'cash' (cha-ching), 'miss' (falling), 'break' (crunch). */
  blip(kind) {
    if (!this.ctx || this.muted) return;
    const notes = {
      load: [[523, 0], [659, 0.08], [784, 0.16]],
      cash: [[988, 0], [1319, 0.07], [1568, 0.14], [2093, 0.21]],
      miss: [[392, 0], [311, 0.12]],
      break: [[180, 0], [120, 0.06], [90, 0.12]],
      throw: [[620, 0], [440, 0.06]],
      transform: [[196, 0], [294, 0.07], [392, 0.14], [587, 0.21], [784, 0.28]],
    }[kind] || [];
    const t0 = this.ctx.currentTime;
    for (const [f, at] of notes) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = kind === 'break' || kind === 'transform' ? 'sawtooth' : 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(0.12, t0 + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.18);
      o.connect(g).connect(this.ctx.destination);
      o.start(t0 + at);
      o.stop(t0 + at + 0.2);
    }
  }
}

// All sound is synthesized (no audio files): the engine, wind, booms,
// splashes, short game blips and an optional background tune.
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
    // One second of white noise, reused for wind, booms and splashes.
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // Wind: looping noise through a band-pass that opens up with speed.
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(ctx.destination);
    wind.start();
    // Jetpack: a low rushing roar, faded in while the robot's jets burn.
    const jet = ctx.createBufferSource();
    jet.buffer = this.noise;
    jet.loop = true;
    this.jetFilter = ctx.createBiquadFilter();
    this.jetFilter.type = 'lowpass';
    this.jetFilter.frequency.value = 700;
    this.jetGain = ctx.createGain();
    this.jetGain.gain.value = 0;
    jet.connect(this.jetFilter).connect(this.jetGain).connect(ctx.destination);
    jet.start(0, 0.37);
    if (this.wantMusic) this.setMusic(true);
  }

  /** A burst of filtered noise: 'boom' (explosion, size 0..1), 'crash', 'splash', 'step'. */
  noiseHit(kind, size = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const P = {
      boom: { f0: 900, f1: 60, len: 0.9, vol: 0.5 }, crash: { f0: 2400, f1: 90, len: 1.3, vol: 0.6 },
      splash: { f0: 3000, f1: 700, len: 0.7, vol: 0.3, type: 'bandpass' }, step: { f0: 160, f1: 50, len: 0.14, vol: 0.35 },
    }[kind];
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = P.type || 'lowpass';
    f.frequency.setValueAtTime(P.f0, t);
    f.frequency.exponentialRampToValueAtTime(P.f1, t + P.len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(P.vol * Math.min(1, size), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + P.len);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t, Math.random());
    src.stop(t + P.len + 0.05);
  }

  /** Jetpack roar: power 0 (off) to about 1.5 (turbo). */
  jet(power) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.jetGain.gain.setTargetAtTime(this.muted ? 0 : Math.min(0.22, power * 0.14), t, power ? 0.05 : 0.15);
    this.jetFilter.frequency.setTargetAtTime(500 + power * 600, t, 0.1);
  }

  /** Optional background tune: a slow, gentle arpeggio that never ends. */
  setMusic(on) {
    this.wantMusic = on;
    if (!this.ctx) return;
    clearInterval(this.musicTimer);
    if (!on) return;
    const CHORDS = [[262, 330, 392, 494], [220, 262, 330, 392], [175, 220, 262, 330], [196, 247, 294, 392]];
    let n = 0;
    this.musicTimer = setInterval(() => {
      if (this.muted || this.ctx.state !== 'running') return;
      const chord = CHORDS[Math.floor(n / 8) % CHORDS.length];
      const f = chord[[0, 1, 2, 3, 2, 1, 2, 3][n % 8]] * (n % 16 === 15 ? 2 : 1);
      n++;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.035, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(g).connect(this.ctx.destination);
      o.start(t);
      o.stop(t + 1);
    }, 300);
  }

  update(throttle, speed) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 38 + throttle * 55 + speed * 0.3;
    this.osc.frequency.setTargetAtTime(f, t, 0.1);
    this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.1);
    this.filter.frequency.setTargetAtTime(300 + throttle * 900, t, 0.1);
    this.gain.gain.setTargetAtTime(this.muted ? 0 : 0.04 + throttle * 0.08, t, 0.15);
    // Wind rises with speed (quiet below 40 mph, a roar in turbo).
    const w = Math.min(1, Math.max(0, (speed - 18) / 110));
    this.windFilter.frequency.setTargetAtTime(350 + w * 1500, t, 0.3);
    this.windGain.gain.setTargetAtTime(this.muted ? 0 : w * 0.16, t, 0.3);
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
      grow: [[330, 0], [440, 0.05], [587, 0.1], [784, 0.15], [1047, 0.2]],
      shrink: [[1047, 0], [784, 0.05], [587, 0.1], [440, 0.15], [330, 0.2]],
      star: [[784, 0], [988, 0.09], [1175, 0.18], [1568, 0.3]],
      ring: [[880, 0], [1320, 0.06]],
      potty: [[880, 0], [988, 0.12], [880, 0.24]], // "uh-oh" chime
      flush: [[520, 0], [440, 0.1], [360, 0.2], [290, 0.3], [230, 0.4], [180, 0.5], [140, 0.6]],
      transform: [[196, 0], [294, 0.07], [392, 0.14], [587, 0.21], [784, 0.28]],
      horn: [[415, 0], [523, 0], [415, 0.2], [523, 0.2]],
    }[kind] || [];
    const t0 = this.ctx.currentTime;
    for (const [f, at] of notes) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = kind === 'horn' ? 'square' : kind === 'break' || kind === 'transform' || kind === 'flush' ? 'sawtooth' : 'triangle';
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

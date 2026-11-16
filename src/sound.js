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
      rumble: { f0: 220, f1: 40, len: 1.8, vol: 0.55 }, // the giant squid waking under the water
      crackle: { f0: 6000, f1: 1800, len: 0.5, vol: 0.25, type: 'bandpass' }, // a watermelon's lightning
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

  /**
   * Each frame: the siren of the emergency vehicle being driven (or a friend's
   * nearby). kind: 'police' (fast wail), 'ambulance' (yelp), 'firetruck' (slow,
   * low wail with a horn tone), or null for silence. vol 0..1.
   */
  siren(kind, vol = 1) {
    if (!this.ctx) return;
    this.chime(kind === 'truck' ? vol : 0); // the ice cream truck plays music instead
    if (kind === 'truck') kind = null;
    const ctx = this.ctx;
    if (!this.sirenOsc) {
      this.sirenOsc = ctx.createOscillator();
      this.sirenOsc.type = 'sawtooth';
      this.sirenOsc2 = ctx.createOscillator();
      this.sirenOsc2.type = 'square';
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 2600;
      this.sirenGain = ctx.createGain();
      this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(f);
      this.sirenOsc2.connect(f);
      f.connect(this.sirenGain).connect(ctx.destination);
      this.sirenOsc.start();
      this.sirenOsc2.start();
    }
    const t = ctx.currentTime;
    let hz = 0;
    if (kind === 'police') hz = 750 + 600 * (0.5 - 0.5 * Math.cos((t * Math.PI * 2) / 2.6)); // wail
    else if (kind === 'ambulance') hz = (t * 3) % 1 < 0.5 ? 960 : 770; // hi-lo
    else if (kind === 'firetruck') hz = 420 + 520 * (0.5 - 0.5 * Math.cos((t * Math.PI * 2) / 4.5)); // slow mechanical wail
    if (hz) {
      this.sirenOsc.frequency.setTargetAtTime(hz, t, 0.02);
      this.sirenOsc2.frequency.setTargetAtTime(kind === 'firetruck' ? 147 : hz * 1.005, t, 0.02);
    }
    this.sirenGain.gain.setTargetAtTime(this.muted || !kind ? 0 : 0.055 * Math.min(1, vol), t, 0.05);
  }

  /**
   * Each frame: the ice cream truck's music, a music-box tune on a loop. vol 0..1 (0: silent).
   */
  chime(vol) {
    const ctx = this.ctx;
    if (!this.chimeOsc) {
      if (!vol) return;
      this.chimeOsc = ctx.createOscillator();
      this.chimeOsc.type = 'triangle';
      this.chimeOsc2 = ctx.createOscillator();
      this.chimeOsc2.type = 'sine';
      this.chimeGain = ctx.createGain();
      this.chimeGain.gain.value = 0;
      const g2 = ctx.createGain();
      g2.gain.value = 0.35; // the bell's ring, an octave up
      this.chimeOsc.connect(this.chimeGain);
      this.chimeOsc2.connect(g2).connect(this.chimeGain);
      this.chimeGain.connect(ctx.destination);
      this.chimeOsc.start();
      this.chimeOsc2.start();
    }
    // An original little tune in C (0 = rest), one note every 0.22 s.
    const E5 = 659, G5 = 784, C6 = 1047, A5 = 880, C5 = 523, D5 = 587, F5 = 698, B5 = 988;
    const TUNE = [E5, G5, C6, G5, A5, G5, E5, C5, D5, E5, F5, D5, G5, 0, 0, 0, E5, G5, C6, G5, A5, C6, B5, A5, G5, E5, D5, E5, C5, 0, 0, 0];
    const t = ctx.currentTime;
    const step = t / 0.22;
    const hz = TUNE[Math.floor(step) % TUNE.length];
    if (hz) {
      this.chimeOsc.frequency.setTargetAtTime(hz, t, 0.005);
      this.chimeOsc2.frequency.setTargetAtTime(hz * 2, t, 0.005);
    }
    const ring = hz ? Math.exp(-(step % 1) * 2.5) : 0; // each note rings and fades, like a music box
    this.chimeGain.gain.setTargetAtTime(this.muted || !vol ? 0 : 0.09 * Math.min(1, vol) * ring, t, 0.012);
  }

  /** Short game sounds: 'load' (rising), 'cash' (cha-ching), 'miss' (falling), 'break' (crunch). */
  blip(kind, vol = 1) {
    if (!this.ctx || this.muted || vol <= 0.01) return;
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
      hi5: [[1047, 0], [1319, 0.05], [1568, 0.1], [2093, 0.16]],
      emote: [[660, 0], [880, 0.07]],
      rise: [[110, 0], [147, 0.15], [196, 0.3], [262, 0.45], [349, 0.6], [466, 0.75]], // the squid winding up to strike
      melon: [[300, 0], [520, 0.05]],
    }[kind] || [];
    const t0 = this.ctx.currentTime;
    for (const [f, at] of notes) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = kind === 'horn' ? 'square' : kind === 'break' || kind === 'transform' || kind === 'flush' ? 'sawtooth' : 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.12 * Math.min(1, vol)), t0 + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.18);
      o.connect(g).connect(this.ctx.destination);
      o.start(t0 + at);
      o.stop(t0 + at + 0.2);
    }
  }
}

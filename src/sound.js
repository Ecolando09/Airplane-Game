// All sound is synthesized (no audio files): the engine, wind, booms,
// splashes, short game blips and an optional background tune.
/** A note name ('C5', 'F#4', 'Bb3', '-' for a rest) as a frequency in Hz (A4 = 440). */
export function noteHz(name) {
  if (!name || name === '-') return 0;
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) return 0;
  const semi = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return 440 * 2 ** ((12 * (+m[3] + 1) + semi - 69) / 12);
}

// The ice cream truck's songs. step: seconds per step; a number after a colon is
// the note's length in steps (1 if left out); bar: steps per bar, after a lead-in
// of `lead` steps (the soft low note marks each bar). Sprinkles was written for
// this game; the other two are old enough to be free for anyone to use.
export const SONGS = [
  { name: 'Sprinkles', step: 0.22, bar: 4, lead: 0,
    notes: 'E5 G5 C6 G5 A5 G5 E5 C5 D5 E5 F5 D5 G5 -:3 E5 G5 C6 G5 A5 C6 B5 A5 G5 E5 D5 E5 C5 -:3' },
  { name: 'Pop Goes the Weasel', step: 0.17, bar: 6, lead: 0,
    notes: 'C5:2 C5 D5:2 D5 E5 G5 E5 C5:2 G4 ' + 'C5:2 C5 D5:2 D5 E5:3 C5:2 G4 '
      + 'C5:2 C5 D5:2 D5 E5 G5 E5 C5:3 ' + 'A5:3 D5:2 F5 E5:3 C5:3' },
  { name: 'The Entertainer', step: 0.15, bar: 8, lead: 2,
    notes: 'D5 D#5 ' + 'E5 C6:2 E5 C6:2 E5 C6:6 C6 D6 D#6 ' + 'E6 C6 D6 E6:2 B5 D6:2 C6:6 D5 D#5 '
      + 'E5 C6:2 E5 C6:2 E5 C6:7 A5 G5 ' + 'F#5 A5 C6 E6:2 D6 C6 A5 D6:6 D5 D#5 '
      + 'E5 C6:2 E5 C6:2 E5 C6:6 C6 D6 D#6 ' + 'E6 C6 D6 E6:2 B5 D6:2 C6:6 C6 D6 '
      + 'E6 C6 D6 E6:2 C6 D6 C6 ' + 'E6 C6 D6 E6:2 C6 D6 C6 ' + 'E6 C6 D6 E6:2 B5 D6:2 C6:6' },
];
const parsed = new Map();
/** A song as notes with their lengths in steps: { step, bar, lead, notes: [{ hz, len }] }. */
function parseSong(song) {
  if (!parsed.has(song)) {
    const notes = song.notes.trim().split(/\s+/).map((w) => {
      const [n, l] = w.split(':');
      return { hz: noteHz(n), len: +(l || 1) };
    });
    parsed.set(song, { step: song.step, bar: song.bar, lead: song.lead, notes });
  }
  return parsed.get(song);
}

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
   * nearby). kind: 'police' (a quick toy-like "wee-woo"), 'ambulance' (hi-lo),
   * 'firetruck' (slow, low wail with a horn tone), 'truck' (the ice cream
   * truck's music: song 0 to 2), or null for silence. vol 0..1.
   */
  siren(kind, vol = 1, song = 0) {
    if (!this.ctx) return;
    this.chime(kind === 'truck' ? vol : 0, song); // the ice cream truck plays music instead
    if (kind === 'truck') kind = null;
    const ctx = this.ctx;
    if (!this.sirenOsc) {
      if (!kind) return; // (nothing made until a siren is first heard)
      this.sirenOsc = ctx.createOscillator();
      this.sirenOsc.type = 'sawtooth';
      this.sirenOsc2 = ctx.createOscillator();
      this.sirenOsc2.type = 'square';
      this.sirenFilter = ctx.createBiquadFilter();
      this.sirenFilter.type = 'lowpass';
      this.sirenFilter.frequency.value = 2600;
      this.sirenGain = ctx.createGain();
      this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(this.sirenFilter);
      this.sirenOsc2.connect(this.sirenFilter);
      this.sirenFilter.connect(this.sirenGain).connect(ctx.destination);
      this.sirenOsc.start();
      this.sirenOsc2.start();
    }
    const t = ctx.currentTime;
    let hz = 0;
    if (kind === 'police') {
      // A quick "wee-woo": up from 650 to 1,250 Hz in 0.2 s, back down in 0.35 s.
      const p = t % 0.55;
      hz = p < 0.2 ? 650 + 600 * (p / 0.2) : 1250 - 600 * ((p - 0.2) / 0.35);
    } else if (kind === 'ambulance') hz = (t * 3) % 1 < 0.5 ? 960 : 770; // hi-lo
    else if (kind === 'firetruck') hz = 420 + 520 * (0.5 - 0.5 * Math.cos((t * Math.PI * 2) / 4.5)); // slow mechanical wail
    if (hz) {
      this.sirenOsc.frequency.setTargetAtTime(hz, t, 0.012);
      // Police: the second voice an octave down (rounder, no wobble); fire truck: its horn tone.
      this.sirenOsc2.frequency.setTargetAtTime(kind === 'firetruck' ? 147 : kind === 'police' ? hz / 2 : hz * 1.005, t, 0.012);
      this.sirenFilter.frequency.setTargetAtTime(kind === 'police' ? 1800 : 2600, t, 0.02);
    }
    this.sirenGain.gain.setTargetAtTime(this.muted || !kind ? 0 : 0.055 * Math.min(1, vol), t, 0.05);
  }

  /**
   * Each frame: the ice cream truck's music. vol 0..1 (0: off), song 0..2 (SONGS).
   * Notes are scheduled on the audio clock up to 0.2 s ahead, so the frame rate
   * changes neither the timing nor the tone. Each note is a small bell that rings
   * into the next, like a music box; a soft low note marks each bar. Everything
   * goes through one master volume (chimeGain), set here from vol and mute,
   * because a scheduled note can't be taken back. this.clock (tests) overrides
   * the audio clock; this.chimeLog (tests) collects scheduled note times.
   */
  chime(vol, song = 0) {
    const ctx = this.ctx;
    const play = !!vol && !this.muted;
    const now = this.clock ? this.clock() : ctx.currentTime;
    if (!this.chimeGain) {
      if (!play) return; // cheap when there's nothing to play: no audio nodes made
      this.chimeGain = ctx.createGain();
      this.chimeGain.gain.value = 0;
      this.chimeGain.connect(ctx.destination);
    }
    const cs = this.chimeState;
    song = SONGS[song] ? song : 0;
    if (cs && (!play || cs.song !== song)) {
      // Off, or another song: fade what's already scheduled, start over next time.
      cs.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.015);
      const g = cs.gain;
      setTimeout(() => g.disconnect(), 400);
      this.chimeState = null;
    }
    this.chimeGain.gain.setTargetAtTime(this.muted || !vol ? 0 : 0.11 * Math.min(1, vol), ctx.currentTime, 0.03);
    if (!play) return;
    if (!this.chimeState) {
      const gain = ctx.createGain(); // this play-through's own fader (see above)
      gain.connect(this.chimeGain);
      this.chimeState = { song, gain, next: now + 0.05, i: 0, pos: 0 };
    }
    const st = this.chimeState;
    const tune = parseSong(SONGS[song]);
    if (st.next < now - 0.05) st.next = now + 0.03; // fell behind (hidden tab, long frame): carry on from now, no burst
    const lite = !!this.lite;
    const at = this.clock ? ctx.currentTime - now : 0; // test clock -> audio clock
    while (st.next < now + 0.2) {
      const n = tune.notes[st.i];
      const len = n.len * tune.step;
      if (n.hz) {
        const downbeat = st.pos >= tune.lead && (st.pos - tune.lead) % tune.bar === 0;
        this._bell(st.gain, n.hz, st.next + at, lite, downbeat && !lite);
        this.chimeLog?.push(+st.next.toFixed(4));
      }
      st.next += len;
      st.pos += n.len;
      st.i++;
      if (st.i >= tune.notes.length) {
        st.i = 0;
        st.pos = 0;
      }
    }
  }

  /** One music-box note at time t: a sine, a quieter one an octave up, a faint quick one at 3x; optionally a soft low note. */
  _bell(out, hz, t, lite, bass) {
    const ctx = this.ctx;
    const t0 = Math.max(t, ctx.currentTime);
    const voice = (type, f, amp, fade) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(amp, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0005, t0 + fade);
      o.connect(g).connect(out);
      o.start(t0);
      o.stop(t0 + fade + 0.02);
      o.onended = () => g.disconnect();
    };
    voice('sine', hz, 0.55, 0.7);
    voice('sine', hz * 2, 0.2, 0.5);
    if (!lite) voice('sine', hz * 3, 0.07, 0.12);
    if (bass) voice('triangle', hz / 4, 0.3, 0.6);
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

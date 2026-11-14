// The dashboard seen from the driver's seat (first-person view): a car's
// steering wheel and dials, a boat's wheel, compass and throttle, a plane's
// instrument panel and yoke, a helicopter's panel and stick. Drawn as SVG over
// the bottom of the screen, tinted the vehicle's colour, with live needles.

const NS = 'http://www.w3.org/2000/svg';
const css = `
#dash { position: fixed; left: 0; right: 0; bottom: 0; height: 36vh; pointer-events: none; display: none; }
#dash.on { display: block; }
#dash svg { width: 100%; height: 100%; display: block; }
#dash text { font: 700 15px system-ui, sans-serif; fill: #f2f2f2; text-anchor: middle; }
#dash .small { font-size: 11px; fill: #b8c0c8; }
`;

/** A round dial: face, tick marks from a0 to a1 degrees, label, a needle with id. */
function dial(cx, cy, r, label, id, { a0 = -135, a1 = 135, ticks = 9, face = '#141a20' } = {}) {
  let s = `<circle cx="${cx}" cy="${cy}" r="${r + 5}" fill="#3b4148"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="${face}"/>`;
  for (let i = 0; i < ticks; i++) {
    const a = ((a0 + ((a1 - a0) * i) / (ticks - 1) - 90) * Math.PI) / 180;
    s += `<line x1="${cx + Math.cos(a) * r * 0.78}" y1="${cy + Math.sin(a) * r * 0.78}" x2="${cx + Math.cos(a) * r * 0.95}" y2="${cy + Math.sin(a) * r * 0.95}" stroke="#e8e8e8" stroke-width="3"/>`;
  }
  s += `<text class="small" x="${cx}" y="${cy + r * 0.5}">${label}</text>`;
  if (id) s += `<g id="${id}" transform="rotate(${a0} ${cx} ${cy})"><line x1="${cx}" y1="${cy + r * 0.12}" x2="${cx}" y2="${cy - r * 0.85}" stroke="#ff5a2a" stroke-width="4" stroke-linecap="round"/></g>`;
  return s + `<circle cx="${cx}" cy="${cy}" r="${r * 0.1}" fill="#888"/>`;
}

/** An attitude indicator: sky and ground that tilt and slide with the aircraft. */
const horizon = (cx, cy, r, label) => `
  <clipPath id="attClip"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
  <circle cx="${cx}" cy="${cy}" r="${r + 5}" fill="#3b4148"/>
  <g clip-path="url(#attClip)"><g id="nAtt"><rect x="${cx - 100}" y="${cy - 100}" width="200" height="100" fill="#3c8fe0"/><rect x="${cx - 100}" y="${cy}" width="200" height="100" fill="#8a5a2b"/><line x1="${cx - 100}" y1="${cy}" x2="${cx + 100}" y2="${cy}" stroke="#fff" stroke-width="3"/></g></g>
  <path d="M${cx - 32} ${cy + 2} L${cx - 10} ${cy + 2} L${cx} ${cy + 12} L${cx + 10} ${cy + 2} L${cx + 32} ${cy + 2}" fill="none" stroke="#ffb300" stroke-width="5"/>
  <text class="small" x="${cx}" y="${cy + r + 22}">${label}</text>`;

/** A digital readout box. */
const readout = (x, y, w, id, label) =>
  `<rect x="${x - w / 2}" y="${y - 20}" width="${w}" height="30" rx="6" fill="#0b1014" stroke="#3b4148" stroke-width="3"/><text id="${id}" x="${x}" y="${y + 1}" style="fill:#7dffb0">0</text><text class="small" x="${x}" y="${y + 26}">${label}</text>`;

const BUILD = {
  car: (tint) => `
    <path d="M0 300 L0 120 Q500 40 1000 120 L1000 300 Z" fill="#1d2126"/>
    <path d="M0 122 Q500 42 1000 122 L1000 136 Q500 58 0 136 Z" fill="${tint}" opacity="0.85"/>
    ${dial(250, 190, 62, 'MPH', 'nSpeed')}
    ${dial(400, 190, 52, 'RPM ×1000', 'nRpm', { ticks: 8 })}
    ${readout(560, 175, 100, 'tGear', 'GEAR')}
    <g id="nWheel" transform="rotate(0 320 300)">
      <circle cx="320" cy="300" r="150" fill="none" stroke="#111" stroke-width="30"/>
      <circle cx="320" cy="300" r="150" fill="none" stroke="#2b2f34" stroke-width="22"/>
      <path d="M180 300 L460 300" stroke="#2b2f34" stroke-width="26"/>
      <path d="M320 300 L320 450" stroke="#2b2f34" stroke-width="26"/>
      <circle cx="320" cy="300" r="40" fill="${tint}"/><circle cx="320" cy="300" r="40" fill="none" stroke="#111" stroke-width="5"/>
    </g>`,
  boat: (tint) => `
    <path d="M0 300 L0 150 Q500 70 1000 150 L1000 300 Z" fill="#6b4524"/>
    <path d="M0 150 Q500 70 1000 150 L1000 164 Q500 86 0 164 Z" fill="${tint}"/>
    ${dial(635, 205, 58, 'COMPASS', null, { ticks: 13, a0: -180, a1: 180, face: '#efe6cf' })}
    <g id="nCompass"><text x="635" y="160" style="fill:#c0281e">N</text></g>
    ${dial(200, 210, 46, 'KNOTS', 'nSpeed')}
    <rect x="60" y="170" width="26" height="110" rx="10" fill="#2b2f34"/>
    <g id="nThrottle"><rect x="44" y="200" width="58" height="22" rx="8" fill="#d33"/></g>
    <text class="small" x="73" y="295">THROTTLE</text>
    <g id="nWheel" transform="rotate(0 430 330)">
      <circle cx="430" cy="330" r="130" fill="none" stroke="#7a4b22" stroke-width="22"/>
      <circle cx="430" cy="330" r="34" fill="#a8732f"/>
      ${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<g transform="rotate(${a} 430 330)"><rect x="424" y="160" width="12" height="170" fill="#8a5a2b"/><circle cx="430" cy="160" r="12" fill="#a8732f"/></g>`).join('')}
    </g>`,
  plane: (tint) => `
    <path d="M0 300 L0 95 Q500 30 1000 95 L1000 300 Z" fill="#2c3238"/>
    <path d="M0 95 Q500 30 1000 95 L1000 110 Q500 46 0 110 Z" fill="${tint}"/>
    ${dial(120, 170, 46, 'AIRSPEED', 'nSpeed')}
    ${horizon(235, 170, 46, 'ATTITUDE')}
    ${dial(350, 170, 46, 'ALT ×100 FT', 'nAlt', { a0: 0, a1: 324, ticks: 10 })}
    ${dial(465, 170, 46, 'HEADING', null, { a0: -180, a1: 180, ticks: 13 })}
    <g id="nCompass"><text x="465" y="137" style="fill:#ffb300">N</text></g>
    ${dial(580, 170, 46, 'CLIMB', 'nVs', { a0: -150, a1: -30, ticks: 7 })}
    ${dial(680, 175, 34, 'THROTTLE', 'nRpm', { ticks: 6 })}
    <g id="nWheel" transform="rotate(0 400 330)">
      <rect x="388" y="250" width="24" height="90" fill="#22272c"/>
      <path d="M280 250 L280 205 Q280 190 295 190 L320 190 L330 240 L470 240 L480 190 L505 190 Q520 190 520 205 L520 250 Z" fill="#22272c"/>
      <circle cx="400" cy="245" r="16" fill="${tint}"/>
    </g>`,
  heli: (tint) => `
    <path d="M0 300 L0 130 Q500 60 1000 130 L1000 300 Z" fill="#262b30"/>
    <path d="M0 130 Q500 60 1000 130 L1000 144 Q500 76 0 144 Z" fill="${tint}"/>
    ${dial(220, 205, 46, 'KNOTS', 'nSpeed')}
    ${horizon(335, 205, 46, 'ATTITUDE')}
    ${dial(450, 205, 46, 'ALT ×100 FT', 'nAlt', { a0: 0, a1: 324, ticks: 10 })}
    ${dial(565, 205, 46, 'HEADING', null, { a0: -180, a1: 180, ticks: 13 })}
    <g id="nCompass"><text x="565" y="172" style="fill:#ffb300">N</text></g>
    ${dial(670, 210, 34, 'ROTOR', 'nRpm', { ticks: 6 })}
    <g id="nWheel" transform="rotate(0 100 330)">
      <rect x="90" y="190" width="20" height="140" rx="8" fill="#1b1f23"/>
      <rect x="80" y="170" width="40" height="40" rx="12" fill="#1b1f23"/><circle cx="100" cy="182" r="6" fill="#d33"/>
    </g>`,
};

export class Dashboard {
  constructor() {
    const st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
    this.el = document.createElement('div');
    this.el.id = 'dash';
    const canvas = document.getElementById('game');
    canvas?.after ? canvas.after(this.el) : document.body.appendChild(this.el);
    this.key = '';
    this.n = {};
  }

  /** type: 'car' | 'boat' | 'plane' | 'heli' | null (hidden); tint: CSS colour. */
  show(type, tint = '#c62828') {
    this.el.classList.toggle('on', !!type);
    if (!type) return;
    const key = `${type}:${tint}`;
    if (key === this.key) return;
    this.key = key;
    this.type = type;
    this.el.innerHTML = `<svg xmlns="${NS}" viewBox="0 0 1000 300" preserveAspectRatio="xMidYMax slice">${BUILD[type](tint)}</svg>`;
    this.n = {};
    for (const id of ['nSpeed', 'nRpm', 'nAlt', 'nVs', 'nAtt', 'nCompass', 'nWheel', 'nThrottle', 'tGear']) this.n[id] = this.el.querySelector(`#${id}`);
  }

  get visible() {
    return this.el.classList.contains('on');
  }

  /**
   * s: { mph, maxMph, throttle 0..1, altFt, vs (ft/min), heading (deg), pitch, roll (radians), steer -1..1, gear }
   */
  update(s) {
    if (!this.visible) return;
    const n = this.n;
    const rot = (el, deg, cx, cy) => el?.setAttribute('transform', `rotate(${deg.toFixed(1)} ${cx} ${cy})`);
    const sweep = (v, a0 = -135, a1 = 135) => a0 + (a1 - a0) * Math.max(0, Math.min(1, v));
    const t = this.type;
    const c = { car: { sp: [250, 190], rpm: [400, 190], wheel: [320, 300] }, boat: { sp: [200, 210], wheel: [430, 330], comp: [635, 205] },
      plane: { sp: [120, 170], rpm: [680, 175], alt: [350, 170], vs: [580, 170], att: [235, 170], comp: [465, 170], wheel: [400, 330] },
      heli: { sp: [220, 205], rpm: [670, 210], alt: [450, 205], att: [335, 205], comp: [565, 205], wheel: [100, 330] } }[t];
    rot(n.nSpeed, sweep(s.mph / (s.maxMph || 160)), ...c.sp);
    if (c.rpm) rot(n.nRpm, sweep(t === 'car' ? 0.15 + 0.75 * (((s.mph % 30) / 30) * 0.6 + s.throttle * 0.4) : s.throttle), ...c.rpm);
    if (c.alt) rot(n.nAlt, ((s.altFt / 100) % 10) * 36, ...c.alt);
    if (c.vs) rot(n.nVs, sweep(0.5 + s.vs / 4000, -150, -30), ...c.vs);
    if (c.comp) rot(n.nCompass, -s.heading, ...c.comp);
    if (c.att) n.nAtt?.setAttribute('transform', `rotate(${((-s.roll * 180) / Math.PI).toFixed(1)} ${c.att[0]} ${c.att[1]}) translate(0 ${(s.pitch * 120).toFixed(1)})`);
    const wheelTurn = t === 'car' || t === 'boat' ? s.steer * 120 : s.steer * 25;
    if (t === 'heli' || t === 'plane') {
      // A yoke or stick also moves with pitch.
      n.nWheel?.setAttribute('transform', `rotate(${wheelTurn.toFixed(1)} ${c.wheel[0]} ${c.wheel[1]}) translate(0 ${(s.stick * 18).toFixed(1)})`);
    } else rot(n.nWheel, wheelTurn, ...c.wheel);
    if (n.nThrottle) n.nThrottle.setAttribute('transform', `translate(0 ${((1 - s.throttle) * 50).toFixed(1)})`);
    if (n.tGear) n.tGear.textContent = s.gear;
  }
}

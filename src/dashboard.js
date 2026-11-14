// The dashboard seen from the driver's seat (first-person view): a car's
// steering wheel and dials, a boat's wheel, compass and throttle, a plane's
// instrument panel and yoke, a helicopter's panel and stick. Drawn as SVG over
// the bottom of the screen, tinted the vehicle's colour, with live needles.

const NS = 'http://www.w3.org/2000/svg';
const css = `
#dash { position: fixed; left: 0; right: 0; bottom: 0; height: min(25vh, 260px); pointer-events: none; display: none; }
#dash.on { display: block; }
#dash svg { width: 100%; height: 100%; display: block; overflow: visible; }
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

/** A steering wheel (rotated by id nWheel). */
const steeringWheel = (cx, cy, rim, hub, r = 150) => `
  <g id="nWheel" transform="rotate(0 ${cx} ${cy})">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#000" stroke-width="30"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${rim}" stroke-width="22"/>
    <path d="M${cx - r + 10} ${cy} L${cx + r - 10} ${cy}" stroke="${rim}" stroke-width="26"/>
    <path d="M${cx} ${cy} L${cx} ${cy + r}" stroke="${rim}" stroke-width="26"/>
    <circle cx="${cx}" cy="${cy}" r="40" fill="${hub}"/><circle cx="${cx}" cy="${cy}" r="40" fill="none" stroke="#000" stroke-width="5"/>
  </g>`;

/** The light and siren switch box, with lamps that glow when on. */
const switchBox = (x, y, chrome = false) => `
  <rect x="${x - 10}" y="${y - 52}" width="200" height="94" rx="10" fill="${chrome ? '#b9c0c6' : '#2b2f34'}" stroke="#111" stroke-width="3"/>
  <circle id="iLights" cx="${x + 40}" cy="${y - 14}" r="18" fill="#3a1010"/>
  <circle id="iSiren" cx="${x + 140}" cy="${y - 14}" r="18" fill="#3a2a10"/>
  <text x="${x + 40}" y="${y + 28}" style="fill:${chrome ? '#111' : '#f2f2f2'};font-size:12px">LIGHTS</text>
  <text x="${x + 140}" y="${y + 28}" style="fill:${chrome ? '#111' : '#f2f2f2'};font-size:12px">SIREN</text>`;

/** The light bar's glow reflected along the top of the dashboard. */
const flashBar = ([a, b]) => `
  <g id="iFlash" opacity="0">
    <rect id="iFlashA" x="-3000" y="0" width="3500" height="26" fill="${a}" opacity="0.55"/>
    <rect id="iFlashB" x="500" y="0" width="3500" height="26" fill="${b}" opacity="0.55"/>
  </g>`;

/** A digital readout box. */
const readout = (x, y, w, id, label) =>
  `<rect x="${x - w / 2}" y="${y - 20}" width="${w}" height="30" rx="6" fill="#0b1014" stroke="#3b4148" stroke-width="3"/><text id="${id}" x="${x}" y="${y + 1}" style="fill:#7dffb0">0</text><text class="small" x="${x}" y="${y + 26}">${label}</text>`;

const BUILD = {
  car: (tint) => `
    <path d="M-3000 300 L-3000 120 L0 120 Q500 40 1000 120 L4000 120 L4000 300 Z" fill="#1d2126"/>
    <path d="M-3000 122 L0 122 Q500 42 1000 122 L4000 122 L4000 136 L1000 136 Q500 58 0 136 L-3000 136 Z" fill="${tint}" opacity="0.85"/>
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
    <path d="M-3000 300 L-3000 150 L0 150 Q500 70 1000 150 L4000 150 L4000 300 Z" fill="#6b4524"/>
    <path d="M-3000 150 L0 150 Q500 70 1000 150 L4000 150 L4000 164 L1000 164 Q500 86 0 164 L-3000 164 Z" fill="${tint}"/>
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
  // Patrol car: dark dash, wheel, speedo and rpm, a laptop on a stand, the radio and the light/siren switch box.
  police: () => `
    <path d="M-3000 300 L-3000 120 L0 120 Q500 40 1000 120 L4000 120 L4000 300 Z" fill="#15181c"/>
    <path d="M-3000 122 L0 122 Q500 42 1000 122 L4000 122 L4000 134 L1000 134 Q500 56 0 134 L-3000 134 Z" fill="#0d0f12"/>
    ${flashBar(['#ff2020', '#2a6bff'])}
    ${dial(250, 190, 62, 'MPH', 'nSpeed', { ticks: 11 })}
    ${dial(400, 190, 50, 'RPM ×1000', 'nRpm', { ticks: 8 })}
    <rect x="470" y="92" width="190" height="122" rx="8" fill="#2b2f34"/>
    <rect x="480" y="100" width="170" height="100" rx="4" fill="#0d2238"/>
    <text x="565" y="124" style="fill:#7dc4ff;font-size:13px">DISPATCH</text>
    <text x="565" y="146" style="fill:#d6ecff;font-size:12px">UNIT 7 · ON PATROL</text>
    <text id="tPlate" x="565" y="170" style="fill:#7dffb0;font-size:12px">PLATE CHECK: CLEAR</text>
    <text x="565" y="190" style="fill:#7dc4ff;font-size:11px">CH 2 · 155.475</text>
    <rect x="555" y="214" width="20" height="40" fill="#2b2f34"/>
    ${switchBox(690, 196)}
    ${steeringWheel(320, 300, '#1b1d20', '#2a62d8')}`,
  // Ambulance: light grey dash, wheel, speedo, a heart monitor and the switch box.
  ambulance: () => `
    <path d="M-3000 300 L-3000 120 L0 120 Q500 40 1000 120 L4000 120 L4000 300 Z" fill="#5c636b"/>
    <path d="M-3000 122 L0 122 Q500 42 1000 122 L4000 122 L4000 136 L1000 136 Q500 58 0 136 L-3000 136 Z" fill="#d81b1b"/>
    ${flashBar(['#ff2020', '#ffffff'])}
    ${dial(250, 192, 60, 'MPH', 'nSpeed')}
    ${dial(395, 195, 44, 'FUEL', 'nRpm', { a0: -60, a1: 60, ticks: 5 })}
    <rect x="465" y="100" width="190" height="110" rx="10" fill="#22272c"/>
    <rect x="475" y="110" width="170" height="78" rx="4" fill="#06140c"/>
    <polyline id="tEcg" points="" fill="none" stroke="#3dff7a" stroke-width="3" stroke-linejoin="round"/>
    <text id="tBpm" x="560" y="204" style="fill:#3dff7a;font-size:13px">♥ 72 BPM</text>
    ${switchBox(690, 196)}
    <g transform="translate(130 160)"><rect x="-22" y="-8" width="44" height="16" fill="#d81b1b"/><rect x="-8" y="-22" width="16" height="44" fill="#d81b1b"/></g>
    ${steeringWheel(320, 300, '#2b2f34', '#d81b1b')}`,
  // Fire engine: red dash, a big wheel, chrome-rimmed speedo, air pressure and water tank gauges, chrome toggles.
  fire: () => `
    <path d="M-3000 300 L-3000 110 L0 110 Q500 30 1000 110 L4000 110 L4000 300 Z" fill="#8e0c20"/>
    <path d="M-3000 112 L0 112 Q500 32 1000 112 L4000 112 L4000 126 L1000 126 Q500 48 0 126 L-3000 126 Z" fill="#d7dbe0"/>
    ${flashBar(['#ff2020', '#ff2020'])}
    ${dial(225, 190, 58, 'MPH', 'nSpeed', { face: '#101418' })}
    ${dial(365, 178, 38, 'AIR PSI', 'nAir', { a0: -120, a1: 120, ticks: 7 })}
    ${dial(470, 178, 38, 'WATER', 'nWater', { a0: -120, a1: 120, ticks: 5 })}
    ${dial(575, 178, 38, 'PUMP', 'nRpm', { a0: -120, a1: 120, ticks: 7 })}
    <text x="470" y="240" style="fill:#ffd21f;font-size:13px">ENGINE 9</text>
    ${switchBox(690, 196, true)}
    ${steeringWheel(300, 310, '#111', '#c8102e', 170)}`,
  plane: (tint) => `
    <path d="M-3000 300 L-3000 95 L0 95 Q500 30 1000 95 L4000 95 L4000 300 Z" fill="#2c3238"/>
    <path d="M-3000 95 L0 95 Q500 30 1000 95 L4000 95 L4000 110 L1000 110 Q500 46 0 110 L-3000 110 Z" fill="${tint}"/>
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
    <path d="M-3000 300 L-3000 130 L0 130 Q500 60 1000 130 L4000 130 L4000 300 Z" fill="#262b30"/>
    <path d="M-3000 130 L0 130 Q500 60 1000 130 L4000 130 L4000 144 L1000 144 Q500 76 0 144 L-3000 144 Z" fill="${tint}"/>
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
    // Only the part from the top of the panel down is drawn into the (short) box, whole
    // and centred; the panel itself carries on flat to the screen's edges.
    const body = BUILD[type](tint);
    const m = body.match(/L0 (\d+) Q500 (\d+) 1000/);
    const top = m ? Math.round((+m[1] + +m[2]) / 2) - 6 : 60;
    this.el.innerHTML = `<svg xmlns="${NS}" viewBox="0 ${top} 1000 ${300 - top}" preserveAspectRatio="xMidYMax meet">${body}</svg>`;
    this.n = {};
    for (const id of ['nSpeed', 'nRpm', 'nAlt', 'nVs', 'nAtt', 'nCompass', 'nWheel', 'nThrottle', 'tGear', 'nAir', 'nWater', 'iLights', 'iSiren', 'iFlash', 'iFlashA', 'iFlashB', 'tEcg', 'tBpm', 'tPlate']) this.n[id] = this.el.querySelector(`#${id}`);
  }

  /** How much of the screen's height the dashboard covers, in pixels (0 when hidden). */
  get height() {
    return this.visible ? this.el.getBoundingClientRect().height : 0;
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
    const c = { car: { sp: [250, 190], rpm: [400, 190], wheel: [320, 300] }, police: { sp: [250, 190], rpm: [400, 190], wheel: [320, 300] },
      ambulance: { sp: [250, 192], rpm: [395, 195], wheel: [320, 300] }, fire: { sp: [225, 190], rpm: [575, 178], wheel: [300, 310] }, boat: { sp: [200, 210], wheel: [430, 330], comp: [635, 205] },
      plane: { sp: [120, 170], rpm: [680, 175], alt: [350, 170], vs: [580, 170], att: [235, 170], comp: [465, 170], wheel: [400, 330] },
      heli: { sp: [220, 205], rpm: [670, 210], alt: [450, 205], att: [335, 205], comp: [565, 205], wheel: [100, 330] } }[t];
    rot(n.nSpeed, sweep(s.mph / (s.maxMph || 160)), ...c.sp);
    const road = t === 'car' || t === 'police' || t === 'fire';
    if (c.rpm && t !== 'ambulance') rot(n.nRpm, sweep(road ? 0.15 + 0.75 * (((s.mph % 30) / 30) * 0.6 + s.throttle * 0.4) : s.throttle), ...c.rpm);
    if (c.alt) rot(n.nAlt, ((s.altFt / 100) % 10) * 36, ...c.alt);
    if (c.vs) rot(n.nVs, sweep(0.5 + s.vs / 4000, -150, -30), ...c.vs);
    if (c.comp) rot(n.nCompass, -s.heading, ...c.comp);
    if (c.att) n.nAtt?.setAttribute('transform', `rotate(${((-s.roll * 180) / Math.PI).toFixed(1)} ${c.att[0]} ${c.att[1]}) translate(0 ${(s.pitch * 120).toFixed(1)})`);
    const wheelTurn = t === 'heli' || t === 'plane' ? s.steer * 25 : s.steer * 120;
    if (t === 'heli' || t === 'plane') {
      // A yoke or stick also moves with pitch.
      n.nWheel?.setAttribute('transform', `rotate(${wheelTurn.toFixed(1)} ${c.wheel[0]} ${c.wheel[1]}) translate(0 ${(s.stick * 18).toFixed(1)})`);
    } else rot(n.nWheel, wheelTurn, ...c.wheel);
    if (n.nThrottle) n.nThrottle.setAttribute('transform', `translate(0 ${((1 - s.throttle) * 50).toFixed(1)})`);
    if (n.tGear) n.tGear.textContent = s.gear;
    // Emergency vehicles: switch lamps, the light bar's glow and the gauges that just sit there.
    const now = performance.now() / 1000;
    if (n.iLights) n.iLights.setAttribute('fill', s.lights ? '#ff3b3b' : '#3a1010');
    if (n.iSiren) n.iSiren.setAttribute('fill', s.siren ? '#ffb300' : '#3a2a10');
    if (n.iFlash) {
      n.iFlash.setAttribute('opacity', s.lights ? '1' : '0');
      const half = (now * 1.6) % 1 < 0.5;
      n.iFlashA.setAttribute('opacity', half ? '0.6' : '0.05');
      n.iFlashB.setAttribute('opacity', half ? '0.05' : '0.6');
    }
    if (n.nRpm && t === 'ambulance') rot(n.nRpm, 35, ...c.rpm);
    if (n.nAir) rot(n.nAir, 40 + Math.sin(now * 0.7) * 6, 365, 178);
    if (n.nWater) rot(n.nWater, 70, 470, 178);
    if (n.tEcg && (this._ecgT || 0) < now - 0.05) {
      // A heart monitor trace scrolling along.
      this._ecgT = now;
      let pts = '';
      for (let i = 0; i <= 42; i++) {
        const x = 478 + i * 4;
        const ph = (i / 42 + now * 0.9) % 0.5;
        const y = 150 - (ph > 0.2 && ph < 0.23 ? 30 : ph > 0.23 && ph < 0.26 ? -14 : ph > 0.3 && ph < 0.36 ? 6 : 0);
        pts += `${x},${y} `;
      }
      n.tEcg.setAttribute('points', pts);
    }
  }
}

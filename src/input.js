import { isPsg1 } from './psg1.js';
import { Tilt } from './tilt.js';

// Keyboard, touch and gamepad input merged into one control state.
export class Input {
  constructor() {
    this.keys = new Set();
    this.handlers = {};
    this.invertPitch = false;
    this.sens = 1; // steering sensitivity, 0.5 to 1.5
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.touchStick = { x: 0, y: 0 };
    this.touchThrottle = null;
    this.touchLift = null;
    this.touchRudder = 0; // helicopter LIFT slider: -1 descend .. 0 hold .. +1 climb
    this.touchBrake = false;
    this.remote = null;
    this.tilt = new Tilt();

    const actions = {
      KeyC: 'cam', KeyR: 'reset', KeyM: 'mute', KeyI: 'invert', KeyB: 'floats', KeyN: 'map',
      KeyP: 'potty', Period: 'bigger', Comma: 'smaller', KeyF: 'transform', KeyG: 'grab', KeyX: 'smash',
      KeyT: 'turboKey', KeyL: 'autoland', Enter: 'respawn', NumpadEnter: 'respawn', Digit1: 'turbo1', Digit2: 'turbo2', Digit3: 'turbo3', Escape: 'pause', Backquote: 'colliders', BracketRight: 'grow', BracketLeft: 'shrink', KeyV: 'drive',
    };
    addEventListener('keydown', (e) => {
      if (e.repeat || e.target.closest?.('input, textarea')) return; // typing a name, not flying
      this.keys.add(e.code);
      if (e.code === 'KeyI') this.invertPitch = !this.invertPitch;
      if (actions[e.code]) this.emit(actions[e.code]);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('gamepaddisconnected', () => {
      if (navigator.getGamepads?.().some((g) => g)) return;
      this.padActive = false;
      this.emit('padGone');
    });
    this._setupTouch();
    // The virtual gamepad the PSG1 app feeds (see pad()), in the browser's standard button order.
    if (__PSG1__) window.legoSkyPad = {
      id: 'psg1_gamepad (app bridge)', connected: true, t: -1e9, axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
      set(buttons, axes, app) {
        if (app) this.app = true;
        (buttons || []).forEach((v, i) => this.buttons[i] && Object.assign(this.buttons[i], { pressed: v > 0.5, value: v }));
        (axes || []).forEach((v, i) => (this.axes[i] = v));
        this.t = performance.now();
      },
    };
  }

  on(name, fn) {
    this.handlers[name] = fn;
  }

  emit(name, arg) {
    this.handlers[name]?.(arg);
  }

  /**
   * The connected gamepad, or the "virtual" one an app can feed when its web
   * view doesn't pass the built-in controls through the Gamepad API: the PSG1
   * app calls window.legoSkyPad.set(buttons, axes) with the standard layout.
   */
  pad() {
    if (__PSG1__) {
      const v = window.legoSkyPad;
      if (v.app || performance.now() - v.t < 5000) return v; // the app's buttons (tests set it too)
    }
    return navigator.getGamepads?.().find((g) => g && g.connected !== false) || null;
  }


  read() {
    const k = (...codes) => (codes.some((c) => this.keys.has(c)) ? 1 : 0);
    let pitch = k('KeyS', 'ArrowDown') - k('KeyW', 'ArrowUp');
    pitch = -pitch; // W / Up = climb
    let roll = k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft');
    let yaw = k('KeyE') - k('KeyQ');
    let throttle = k('ShiftLeft', 'ShiftRight', 'Equal', 'NumpadAdd') - k('ControlLeft', 'ControlRight', 'Minus', 'NumpadSubtract');
    let throttleSet;
    let liftSet;
    let brake = k('Space') === 1;

    // Touch: tilt steering or the on-screen stick (the robot always walks by stick)
    if (this.tilt.active && !this.botMode) {
      roll = this.tilt.roll;
      pitch = this.tilt.pitch;
    } else if (this.touchStick.x || this.touchStick.y) {
      roll = this.touchStick.x;
      pitch = -this.touchStick.y;
    }
    if (this.touchThrottle !== null) throttleSet = this.touchThrottle;
    if (this.touchLift !== null) liftSet = this.touchLift;
    if (this.touchRudder) yaw = this.touchRudder;
    brake ||= this.touchBrake;

    // Phone controller (via the relay); ignored if it stops sending for half a second.
    const rm = this.remote;
    if (rm && performance.now() - rm.time < 500) {
      if (rm.pitch || rm.roll) {
        pitch = rm.pitch;
        roll = rm.roll;
      }
      if (rm.yaw) yaw = rm.yaw;
      throttleSet = rm.throttle;
      if (typeof rm.lift === 'number') liftSet = rm.lift;
      brake ||= rm.brake;
    }

    // Gamepad
    const gp = this.pad();
    if (gp) {
      const dz = (v) => (Math.abs(v) < 0.12 ? 0 : v);
      if (this.heliMode && !this.botMode) {
        // Helicopter: left stick steers, right stick up/down is lift. (A robot made
        // from the helicopter walks with the left stick like any robot.)
        if (dz(gp.axes[0])) roll = dz(gp.axes[0]);
        if (dz(gp.axes[3] ?? 0)) liftSet = -dz(gp.axes[3]);
      } else if (dz(gp.axes[0]) || dz(gp.axes[1])) {
        roll = dz(gp.axes[0]);
        pitch = -dz(gp.axes[1]);
      }
      if (dz(gp.axes[2] ?? 0)) yaw = dz(gp.axes[2]);
      const rt = gp.buttons[7]?.value ?? 0;
      const lt = gp.buttons[6]?.value ?? 0;
      if (rt || lt) throttle = rt - lt;
      else if (this.heliMode && !this.botMode) {
        // No triggers on the PSG1 (official specs): in the helicopter the left
        // stick's up/down, unused otherwise, is forward speed.
        if (dz(gp.axes[1])) throttle = -dz(gp.axes[1]);
      } else if (dz(gp.axes[3] ?? 0)) {
        // Plane (and robot run): right stick up/down works the throttle.
        throttle = -dz(gp.axes[3]);
      }
      if (gp.buttons[0]?.pressed) brake = true;
    }

    if (this.invertPitch && !this.botMode) pitch = -pitch;
    // Robot: Shift, or the stick pushed all the way, runs.
    const run = throttle > 0 || Math.hypot(this.touchStick.x, this.touchStick.y) > 0.93
      || (gp && Math.hypot(gp.axes[0], gp.axes[1]) > 0.93);
    // Steering sensitivity (Settings): gentler or sharper stick, tilt and keys.
    const sens = this.sens ?? 1;
    const lim = (v) => Math.max(-1, Math.min(1, v * sens));
    return { pitch: lim(pitch), roll: lim(roll), yaw, throttle, throttleSet, liftSet, brake, run };
  }

  _setupTouch() {
    const stick = document.getElementById('stick');
    const knob = document.getElementById('knob');
    let stickId = null;
    const moveStick = (t) => {
      const r = stick.getBoundingClientRect();
      const R = r.width / 2;
      let x = (t.clientX - r.left - R) / R;
      let y = (t.clientY - r.top - R) / R;
      const len = Math.hypot(x, y);
      if (len > 1) {
        x /= len;
        y /= len;
      }
      this.touchStick = { x, y };
      knob.style.transform = `translate(${x * R * 0.7}px, ${y * R * 0.7}px)`;
    };
    stick.addEventListener('touchstart', (e) => {
      e.preventDefault();
      stickId = e.changedTouches[0].identifier;
      moveStick(e.changedTouches[0]);
    });
    stick.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === stickId) moveStick(t);
    });
    const endStick = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) {
          stickId = null;
          this.touchStick = { x: 0, y: 0 };
          knob.style.transform = '';
        }
      }
    };
    stick.addEventListener('touchend', endStick);
    stick.addEventListener('touchcancel', endStick);

    const thr = document.getElementById('throttleTouch');
    const thrKnob = document.getElementById('throttleKnob');
    const setThr = (t) => {
      const r = thr.getBoundingClientRect();
      const v = Math.min(1, Math.max(0, 1 - (t.clientY - r.top) / r.height));
      this.touchThrottle = v;
      thrKnob.style.bottom = `${v * (r.height - 36)}px`;
    };
    thr.addEventListener('touchstart', (e) => {
      e.preventDefault();
      setThr(e.changedTouches[0]);
    });
    thr.addEventListener('touchmove', (e) => {
      e.preventDefault();
      setThr(e.changedTouches[0]);
    });

    // Rudder bar above the joystick: drag left/right, springs back to center.
    const rud = document.getElementById('rudderTouch');
    const rudKnob = document.getElementById('rudderKnob');
    let rudId = null;
    const setRud = (t) => {
      const r = rud.getBoundingClientRect();
      const v = Math.min(1, Math.max(-1, ((t.clientX - r.left) / r.width) * 2 - 1));
      this.touchRudder = Math.abs(v) < 0.1 ? 0 : v;
      rudKnob.style.transform = `translateX(${v * (r.width / 2 - 22)}px)`;
    };
    const endRud = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== rudId) continue;
        rudId = null;
        this.touchRudder = 0;
        rudKnob.style.transform = '';
      }
    };
    rud.addEventListener('touchstart', (e) => {
      e.preventDefault();
      rudId = e.changedTouches[0].identifier;
      setRud(e.changedTouches[0]);
    });
    rud.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === rudId) setRud(t);
    });
    rud.addEventListener('touchend', endRud);
    rud.addEventListener('touchcancel', endRud);

    // Helicopter LIFT slider: stays where you leave it; snaps to the middle (hold height).
    const lift = document.getElementById('liftTouch');
    const liftKnob = document.getElementById('liftKnob');
    const setLift = (t) => {
      const r = lift.getBoundingClientRect();
      let v = (1 - (t.clientY - r.top) / r.height) * 2 - 1;
      v = Math.min(1, Math.max(-1, v));
      if (Math.abs(v) < 0.15) v = 0;
      this.touchLift = v;
      liftKnob.style.bottom = `${((v + 1) / 2) * (r.height - 36)}px`;
    };
    if (lift) {
      lift.addEventListener('touchstart', (e) => {
        e.preventDefault();
        setLift(e.changedTouches[0]);
      });
      lift.addEventListener('touchmove', (e) => {
        e.preventDefault();
        setLift(e.changedTouches[0]);
      });
    }

    for (const b of document.querySelectorAll('#touchButtons button')) {
      const act = b.dataset.act;
      if (act === 'tilt') {
        b.addEventListener('click', () => this.setTilt(!this.tilt.active));
      } else if (act === 'recenter') {
        b.addEventListener('click', () => this.tilt.recenter());
      } else if (act === 'brake') {
        b.addEventListener('touchstart', (e) => {
          e.preventDefault();
          this.touchBrake = true;
        });
        b.addEventListener('touchend', () => (this.touchBrake = false));
      } else {
        b.addEventListener('click', () => this.emit(act));
      }
    }
  }

  /**
   * Gamepad buttons that trigger actions. Call once per frame.
   *
   * Playing (Xbox layout, e.g. a GameSir phone controller): B floats (robot:
   * grab, throw or drive), X robot mode, Y camera, RB turbo (robot: smash), LB
   * auto-land (robot: turbo), Menu pause, View big map, D-pad up/down big
   * map/potty (robot: bigger/smaller), D-pad left potty, right "not now".
   * Playing (PSG1 layout, by position): A (right) floats/grab, Y (left) robot
   * mode, X (top) camera, R1 turbo/smash, L1 auto-land (robot: turbo), START
   * pause, SELECT big map, D-pad up/down big map/potty (robot: bigger/smaller),
   * D-pad left potty, D-pad right "not now" / skip a lesson step.
   *
   * In menus and pop-ups (nav = true): D-pad or left stick moves the highlight,
   * A presses it (Xbox: A bottom; PSG1: A right), B goes back, L1/R1 change
   * city, START plays.
   */
  pollButtons(nav) {
    const gp = this.pad();
    if (!gp) return;
    const P = isPsg1(); // PSG1 labels: A (confirm) is the right button
    const prev = (this._prevButtons ||= []);
    const down = (i) => !!gp.buttons[i]?.pressed;
    const fresh = (i) => down(i) && !prev[i];
    // The first press or stick push tells the game a controller is in use (phones
    // then hide their touch buttons). Browsers only reveal a pad after a press anyway.
    if (!this.padActive && (gp.buttons.some((b) => b.pressed) || gp.axes.some((a) => Math.abs(a) > 0.5))) {
      this.padActive = true;
      this.emit('padActive', gp);
    }
    if (nav) {
      // Direction with key-repeat: first move at once, then every 0.15 s after 0.4 s.
      const ax = gp.axes[0] || 0;
      const ay = gp.axes[1] || 0;
      const dir = down(12) || ay < -0.6 ? 'up' : down(13) || ay > 0.6 ? 'down' : down(14) || ax < -0.6 ? 'left' : down(15) || ax > 0.6 ? 'right' : '';
      const now = performance.now();
      if (dir !== this._navDir) {
        this._navDir = dir;
        this._navAt = now + 400;
        if (dir) this.emit('nav', dir);
      } else if (dir && now > this._navAt) {
        this._navAt = now + 150;
        this.emit('nav', dir);
      }
      if (fresh(P ? 1 : 0)) this.emit('navPress');
      if (fresh(P ? 0 : 1)) this.emit('navBack');
      if (fresh(9)) this.emit('navStart');
      if (fresh(4)) this.emit('navCity', -1);
      if (fresh(5)) this.emit('navCity', 1);
    } else {
      this._navDir = 'hold'; // a direction held while a menu closes doesn't count as a move
      const map = P
        ? { 1: 'floats', 2: 'transform', 3: 'cam', 4: 'l1', 5: 'turbo', 8: 'map', 9: 'pause', 10: 'shrink', 11: 'grow', 12: 'dUp', 13: 'dDown', 14: 'dLeft', 15: 'dRight' }
        : { 1: 'floats', 2: 'transform', 3: 'cam', 4: 'l1', 5: 'turbo', 8: 'map', 9: 'pause', 10: 'shrink', 11: 'grow', 12: 'dUp', 13: 'dDown', 14: 'dLeft', 15: 'dRight' };
      for (const i in map) if (fresh(Number(i))) this.emit(map[i]);
    }
    gp.buttons.forEach((b, i) => (prev[i] = !!b.pressed));
  }

  /**
   * Switch tilt steering on or off and update the touch controls to match.
   * Call from a tap: iPhones ask for motion-sensor permission the first time.
   */
  async setTilt(on) {
    if (on && !(await this.tilt.enable())) on = false;
    if (!on) this.tilt.disable();
    document.querySelector('#touchButtons [data-act=tilt]')?.classList.toggle('on', on);
    document.getElementById('stick').hidden = on;
    document.getElementById('recenter').hidden = !on;
    return on;
  }

  /** Reset touch throttle to match the plane after a restart. */
  /** Center the helicopter LIFT slider (hold height). */
  resetLift() {
    if (this.touchLift !== null) this.touchLift = 0;
    const lift = document.getElementById('liftTouch');
    if (lift) document.getElementById('liftKnob').style.bottom = `${(lift.clientHeight - 36) / 2}px`;
  }

  syncThrottle(v) {
    if (this.touchThrottle !== null) this.touchThrottle = v;
    const thr = document.getElementById('throttleTouch');
    document.getElementById('throttleKnob').style.bottom = `${v * (thr.clientHeight - 36)}px`;
  }
}

import { Tilt } from './tilt.js';

// Keyboard, touch and gamepad input merged into one control state.
export class Input {
  constructor() {
    this.keys = new Set();
    this.handlers = {};
    this.invertPitch = false;
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
      KeyT: 'turbo', Digit1: 'turbo1', Digit2: 'turbo2', Digit3: 'turbo3', Escape: 'pause',
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
    this._setupTouch();
  }

  on(name, fn) {
    this.handlers[name] = fn;
  }

  emit(name) {
    this.handlers[name]?.();
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

    // Touch: tilt steering or the on-screen stick
    if (this.tilt.active) {
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
    const gp = navigator.getGamepads?.().find((g) => g);
    if (gp) {
      const dz = (v) => (Math.abs(v) < 0.12 ? 0 : v);
      if (this.heliMode) {
        // Helicopter: left stick steers, right stick up/down is lift.
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
      if (gp.buttons[0]?.pressed) brake = true;
    }

    if (this.invertPitch) pitch = -pitch;
    return { pitch, roll, yaw, throttle, throttleSet, liftSet, brake };
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
   * Gamepad buttons that trigger actions (Xbox layout): B floats, Y camera,
   * RB turbo, Menu restart, View big map, A starts from the menu. Call once per frame.
   */
  pollButtons(inMenu) {
    const gp = navigator.getGamepads?.().find((g) => g);
    if (!gp) return;
    const map = inMenu ? { 0: 'menuStart', 3: 'menuAir' } : { 1: 'floats', 3: 'cam', 5: 'turbo', 9: 'reset', 8: 'map' };
    this._prevButtons ||= [];
    gp.buttons.forEach((b, i) => {
      if (b.pressed && !this._prevButtons[i] && map[i]) this.emit(map[i]);
      this._prevButtons[i] = b.pressed;
    });
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

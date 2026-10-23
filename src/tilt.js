// Tilt steering from the phone's motion sensor. Hold the phone sideways like a
// steering wheel: rotate it to bank, tip the top edge away to dive and toward
// you to climb. Angles are measured from a "center" pose captured on enable or
// re-center, using gravity rotated into screen coordinates so it works in
// either landscape direction.
// iOS reports the motion sensor's z axis with the opposite sign from Android.
const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const Z_SIGN = IS_IOS ? -1 : 1;

export class Tilt {
  constructor() {
    this.active = false;
    this.center = null;
    this.gravity = null;
    this.roll = 0;
    this.pitch = 0;
    addEventListener('devicemotion', (e) => this._onMotion(e));
  }

  static get supported() {
    return 'DeviceMotionEvent' in window;
  }

  /** Must be called from a tap (iOS asks for permission). Returns true if on. */
  async enable() {
    const DME = window.DeviceMotionEvent;
    if (typeof DME?.requestPermission === 'function') {
      try {
        if ((await DME.requestPermission()) !== 'granted') return false;
      } catch {
        return false;
      }
    }
    this.active = true;
    this.center = null;
    return true;
  }

  disable() {
    this.active = false;
    this.roll = this.pitch = 0;
  }

  recenter() {
    this.center = null;
  }

  _screenGravity() {
    const g = this.gravity;
    const a = ((screen.orientation?.angle ?? window.orientation ?? 0) * Math.PI) / 180;
    const sx = g.x * Math.cos(a) + g.y * Math.sin(a);
    const sy = -g.x * Math.sin(a) + g.y * Math.cos(a);
    return { steer: Math.atan2(sx, sy), lean: Math.atan2(g.z, Math.hypot(sx, sy)) };
  }

  _onMotion(e) {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x === null) return;
    this.gravity = { x: g.x, y: g.y, z: g.z };
    if (!this.active) return;
    const s = this._screenGravity();
    if (!this.center) this.center = s;
    let d = s.steer - this.center.steer;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    const clamp = (v) => Math.max(-1, Math.min(1, v));
    const dead = (v) => (Math.abs(v) < 0.06 ? 0 : v);
    this.roll = dead(clamp(-d / 0.6));
    // Tip the top edge toward you to climb (like pulling back on a yoke).
    this.pitch = dead(clamp((-(s.lean - this.center.lean) / 0.45) * Z_SIGN));
  }
}

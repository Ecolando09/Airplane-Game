import * as THREE from 'three';

// Multiplayer: everyone in the same 4-letter room sees each other's vehicles.
// Positions go through the relay (/ws?role=mp) about 10 times a second and are
// smoothed on arrival. Players in a different city show up in the list only.
const SEND_EVERY = 0.1; // seconds
const COLORS = ['#e8590c', '#7048e8', '#1098ad', '#d6336c', '#2b8a3e', '#f08c00', '#364fc7'];

export const randomRoomCode = () =>
  Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');

export class Multiplayer {
  /**
   * @param {object} opts.makeVehicle (vehicle) => model with .group (and optional updateBoosters, floats, propeller)
   */
  constructor({ scene, makeVehicle, onChange, onJoin, onLeave, onRoomSettings, getSettings }) {
    this.scene = scene;
    this.makeVehicle = makeVehicle;
    this.onChange = onChange;
    this.onJoin = onJoin;
    this.onLeave = onLeave;
    this.onRoomSettings = onRoomSettings;
    this.getSettings = getSettings;
    this.settings = null; // the room's city and look, once connected
    this.room = null;
    this.name = '';
    this.ws = null;
    this.players = new Map(); // id -> remote player
    this.sendTimer = 0;
    this.status = 'off'; // off | connecting | on | error
  }

  join(room, name) {
    this.leave();
    this.room = room;
    this.name = name;
    this.status = 'connecting';
    this._connect();
    this.onChange?.();
  }

  leave() {
    this.room = null;
    this.settings = null;
    this.status = 'off';
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    for (const id of [...this.players.keys()]) this._remove(id);
    this.onChange?.();
  }

  _connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    // Proposed city/look: used only if this connection creates the room.
    const want = this.settings || this.getSettings();
    const q = `role=mp&room=${this.room}&city=${encodeURIComponent(want.city)}&look=${encodeURIComponent(want.look)}`;
    const ws = (this.ws = new WebSocket(`${proto}://${location.host}/ws?${q}`));
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.t === 'welcome') {
        this.myId = m.id;
        this.status = 'on';
        if (m.settings?.city) {
          this.settings = m.settings;
          this.onRoomSettings?.(m.settings);
        }
        this.onChange?.();
      } else if (m.t === 'state') this._onState(m);
      else if (m.t === 'leave') this._remove(m.id);
    };
    ws.onclose = () => {
      for (const id of [...this.players.keys()]) this._remove(id);
      if (!this.room) return;
      this.status = 'error';
      this.onChange?.();
      setTimeout(() => this.room && this.ws === ws && this._connect(), 3000);
    };
  }

  _onState(m) {
    let p = this.players.get(m.id);
    if (!p) {
      p = { id: m.id, color: COLORS[(m.id - 1) % COLORS.length], pos: new THREE.Vector3(), quat: new THREE.Quaternion(), model: null };
      p.target = { pos: new THREE.Vector3(m.x, m.y, m.z), quat: new THREE.Quaternion(m.qx, m.qy, m.qz, m.qw) };
      p.pos.copy(p.target.pos);
      p.quat.copy(p.target.quat);
      this.players.set(m.id, p);
      p.isNew = true;
    }
    const changed = p.name !== m.name || p.city !== m.city;
    Object.assign(p, {
      name: String(m.name || 'Pilot').slice(0, 16), city: m.city, vehicle: m.vehicle === 'heli' ? 'heli' : 'plane',
      speed: +m.speed || 0, turbo: +m.turbo || 1, floats: !!m.floats, crashed: !!m.crashed, seen: performance.now(),
    });
    if (p.isNew) {
      p.isNew = false;
      this.onJoin?.(p);
      this.onChange?.();
    }
    p.target.pos.set(+m.x, +m.y, +m.z);
    p.target.quat.set(+m.qx, +m.qy, +m.qz, +m.qw).normalize();
    if (changed) this.onChange?.();
  }

  _remove(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.model) this.scene.remove(p.model.group);
    p.label?.remove();
    this.players.delete(id);
    if (this.room) this.onLeave?.(p);
    this.onChange?.();
  }

  /** Drop all remote models (after the look changes) so they are rebuilt in the new style. */
  resetModels() {
    for (const p of this.players.values()) {
      if (p.model) this.scene.remove(p.model.group);
      p.model = null;
    }
  }

  /** Players flying in the given city, with live models. */
  visible(city) {
    return [...this.players.values()].filter((p) => p.city === city && performance.now() - p.seen < 5000);
  }

  update(dt, me) {
    // Send my state.
    this.sendTimer -= dt;
    if (this.status === 'on' && this.sendTimer <= 0 && this.ws?.readyState === 1) {
      this.sendTimer = SEND_EVERY;
      const g = me.group;
      this.ws.send(JSON.stringify({
        t: 'state', name: this.name, city: me.city, vehicle: me.vehicle,
        x: +g.position.x.toFixed(2), y: +g.position.y.toFixed(2), z: +g.position.z.toFixed(2),
        qx: +g.quaternion.x.toFixed(4), qy: +g.quaternion.y.toFixed(4), qz: +g.quaternion.z.toFixed(4), qw: +g.quaternion.w.toFixed(4),
        speed: +me.speed.toFixed(1), turbo: me.turbo, floats: me.floats, crashed: me.crashed,
      }));
    }
    // Move the others smoothly toward their latest reported position.
    const k = 1 - Math.exp(-dt * 8);
    for (const p of this.players.values()) {
      const show = p.city === me.city && performance.now() - p.seen < 5000 && !p.crashed;
      if (show && (!p.model || p.model.vehicle !== p.vehicle)) {
        if (p.model) this.scene.remove(p.model.group);
        p.model = this.makeVehicle(p.vehicle);
        p.model.vehicle = p.vehicle;
        this.scene.add(p.model.group);
      }
      if (!p.model) continue;
      p.model.group.visible = show;
      if (!show) continue;
      if (p.pos.distanceTo(p.target.pos) > 200) p.pos.copy(p.target.pos); // restarted elsewhere: jump
      else p.pos.lerp(p.target.pos, k);
      p.quat.slerp(p.target.quat, k);
      p.model.group.position.copy(p.pos);
      p.model.group.quaternion.copy(p.quat);
      if (p.model.propeller) {
        if (p.vehicle === 'heli') p.model.propeller.rotation.y += 30 * dt;
        else p.model.propeller.rotation.z += (10 + p.speed) * dt;
      }
      if (p.model.floats) {
        p.model.floats.visible = p.floats;
        p.model.floats.scale.setScalar(p.floats ? 1 : 0.001);
      }
      p.model.updateBoosters?.(p.turbo > 1 ? 1 : 0, p.turbo, 1, performance.now() / 1000);
    }
  }
}

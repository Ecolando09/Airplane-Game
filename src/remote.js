import QRCode from 'qrcode';

// Game-side link to phone controllers through the relay at /ws.
// The phone page (remote.html) sends stick/throttle input and button presses;
// the game sends back a little telemetry so the phone can show speed and altitude.
export class RemoteLink {
  constructor(input, { onStatus }) {
    this.input = input;
    this.onStatus = onStatus;
    this.code = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
    this.pads = 0;
    this.ws = null;
    this.retry = 0;
  }

  get padUrl() {
    return new URL(`remote.html?room=${this.code}`, location.href).href;
  }

  qrDataUrl() {
    return QRCode.toDataURL(this.padUrl, { margin: 1, width: 320, color: { dark: '#1b2a34', light: '#ffffff' } });
  }

  connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = (this.ws = new WebSocket(`${proto}://${location.host}/ws?role=game&room=${this.code}`));
    ws.onopen = () => {
      this.retry = 0;
      this.onStatus('waiting');
    };
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.t === 'pads') {
        this.pads = m.n;
        this.onStatus(m.n ? 'connected' : 'waiting');
      } else if (m.t === 'in') {
        this.input.remote = {
          pitch: clamp(m.pitch), roll: clamp(m.roll), yaw: clamp(m.yaw),
          throttle: Math.min(1, Math.max(0, Number(m.throttle) || 0)), brake: !!m.brake, time: performance.now(),
        };
      } else if (m.t === 'act' && typeof m.a === 'string') {
        this.input.emit(m.a);
      }
    };
    ws.onclose = () => {
      this.pads = 0;
      this.onStatus('offline');
      // Keep trying in the background (the relay may be restarting).
      this.retry = Math.min(this.retry + 1, 6);
      setTimeout(() => this.connect(), 1000 * this.retry);
    };
  }

  sendTelemetry(t) {
    if (this.pads && this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'tel', ...t }));
  }
}

const clamp = (v) => Math.min(1, Math.max(-1, Number(v) || 0));

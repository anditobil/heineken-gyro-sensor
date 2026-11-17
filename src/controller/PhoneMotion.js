import { EventEmitter } from '../core/EventEmitter.js';

const IOS = typeof navigator !== 'undefined'
  && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const G = 9.80665;

/** True on phones / tablets (coarse pointer or touch support). */
export const isTouchDevice = typeof window !== 'undefined'
  && (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 1);

/**
 * Phone gyroscope + accelerometer as a motion source (DeviceMotionEvent).
 *
 * Every `devicemotion` event is converted into a packet with exactly the same shape as a
 * joy-con-webhid 0x30 report (gyroscopes[..][3].dps, accelerometers[..].{x,y,z}.acc), so the
 * existing pipeline – SensorProcessor (bias, drift, smoothing) and TiltTracker (gravity
 * tracking for phone tilt) – works unchanged.
 *
 * Frame: the device axes are rotated by the current screen orientation so that x = screen
 * right, y = screen up, z = out of the screen in portrait AND landscape. Units: °/s and G,
 * with the accelerometer reading +1 G "up" at rest (Joy-Con convention). iOS reports
 * accelerationIncludingGravity with the opposite sign, which is corrected here.
 *
 * Needs HTTPS (or localhost). On iOS 13+ `enable()` must be called from a tap.
 */
export class PhoneMotion extends EventEmitter {
  constructor(settings) {
    super();
    this.settings = settings;
    this.supported = typeof window !== 'undefined' && 'DeviceMotionEvent' in window;
    this.enabled = false;
    this.lastAt = 0;
    this.state = this.supported ? 'off' : 'unsupported'; // off | on | denied | unsupported | insecure
    if (this.supported && !window.isSecureContext) this.state = 'insecure';
    this._onMotion = (e) => this._handle(e);
  }

  get needsPermission() {
    return typeof window.DeviceMotionEvent?.requestPermission === 'function';
  }

  get receiving() {
    return performance.now() - this.lastAt < 300;
  }

  /** Start listening (asks for permission on iOS). Call from a user gesture. */
  async enable() {
    if (!this.supported || this.state === 'insecure') return false;
    if (this.enabled) return true;
    try {
      if (this.needsPermission) {
        const r = await window.DeviceMotionEvent.requestPermission();
        if (r !== 'granted') {
          this.state = 'denied';
          this.emit('state', this.state);
          return false;
        }
      }
    } catch {
      this.state = 'denied';
      this.emit('state', this.state);
      return false;
    }
    window.addEventListener('devicemotion', this._onMotion);
    this.enabled = true;
    this.state = 'on';
    this.emit('state', this.state);
    return true;
  }

  disable() {
    window.removeEventListener('devicemotion', this._onMotion);
    this.enabled = false;
    if (this.state === 'on') this.state = 'off';
    this.emit('state', this.state);
  }

  _handle(e) {
    const rr = e.rotationRate;
    const ag = e.accelerationIncludingGravity;
    if (!rr || !ag || ag.x == null || rr.alpha == null) return;
    const now = performance.now();
    this.lastAt = now;
    const flip = this.settings.get('mobile')?.flip ? -1 : 1;
    const aSign = (IOS ? -1 : 1) / G;
    // Device frame: rotationRate.beta = about x, gamma = about y, alpha = about z (°/s).
    let gx = rr.beta || 0, gy = rr.gamma || 0;
    const gz = rr.alpha || 0;
    let ax = (ag.x || 0) * aSign, ay = (ag.y || 0) * aSign;
    const az = (ag.z || 0) * aSign;
    // Rotate x/y into screen space for the current orientation.
    const angle = ((screen.orientation?.angle ?? window.orientation ?? 0) * Math.PI) / 180;
    if (angle) {
      // angle 90 = phone turned counter-clockwise (top edge on the left): screen right is the
      // device's -y axis and screen up is its +x axis.
      const c = Math.cos(angle), s = Math.sin(angle);
      [gx, gy] = [gx * c - gy * s, gx * s + gy * c];
      [ax, ay] = [ax * c - ay * s, ax * s + ay * c];
    }
    const p = this._packet ||= {
      gyroscopes: [[{ dps: 0 }, { dps: 0 }, { dps: 0 }]],
      accelerometers: [{ x: { acc: 0 }, y: { acc: 0 }, z: { acc: 0 } }],
    };
    const g = p.gyroscopes[0], a = p.accelerometers[0];
    g[0].dps = gx * flip; g[1].dps = gy * flip; g[2].dps = gz;
    a.x.acc = ax * flip; a.y.acc = ay * flip; a.z.acc = az;
    this.emit('imu', p, now);
  }
}

import { clamp } from '../core/MathUtils.js';

const DEG = Math.PI / 180;

/** Tilt angle (degrees) → move command: dead zone 3°, full tilt 25° → −1..1. */
export function tiltToCommand(deg, deadZone = 3, fullTilt = 25) {
  const a = Math.abs(deg);
  if (a <= deadZone) return 0;
  return Math.sign(deg) * Math.min(1, (a - deadZone) / Math.max(1e-6, fullTilt - deadZone));
}

/**
 * Phone tilt: a gravity vector in the sensor frame that is rotated by the (bias-corrected)
 * gyro every packet, with a slow pull toward the accelerometer so it cannot drift.
 * The gyro makes it react instantly; the accelerometer keeps it honest.
 *
 * Frame (PhoneMotion): x = screen right, y = screen up, z = out of the screen.
 * The tilt is the angle of the screen-right axis against gravity, relative to the pose
 * captured by recenter() at "GO". Tilting the right edge down = positive.
 */
export class TiltTracker {
  constructor() {
    this.up = [0, 0, 1];
    this.neutral = 0;
    this.lastT = 0;
  }

  /** gyro: bias-corrected °/s, accel: G (+1 G "up" at rest). */
  process(gyro, accel, now) {
    const dt = this.lastT ? clamp((now - this.lastT) / 1000, 0.001, 0.1) : 1 / 60;
    this.lastT = now;
    const up = this.up;
    const wx = gyro.x * DEG * dt, wy = gyro.y * DEG * dt, wz = gyro.z * DEG * dt;
    // A world-fixed vector seen from a frame rotating by ω changes by −ω × v.
    const cx = wy * up[2] - wz * up[1];
    const cy = wz * up[0] - wx * up[2];
    const cz = wx * up[1] - wy * up[0];
    up[0] -= cx; up[1] -= cy; up[2] -= cz;
    const am = Math.hypot(accel.x, accel.y, accel.z);
    if (am > 0.75 && am < 1.25) {
      const k = 0.06;
      up[0] += (accel.x / am - up[0]) * k;
      up[1] += (accel.y / am - up[1]) * k;
      up[2] += (accel.z / am - up[2]) * k;
    }
    const un = Math.hypot(up[0], up[1], up[2]) || 1;
    up[0] /= un; up[1] /= un; up[2] /= un;
  }

  /** Raw angle: positive when the screen-right edge points down. */
  angle() {
    return -Math.asin(clamp(this.up[0], -1, 1)) / DEG;
  }

  recenter() {
    this.neutral = this.angle();
  }

  /** Degrees from the neutral pose. */
  delta() {
    let d = this.angle() - this.neutral;
    d = ((d + 540) % 360) - 180;
    return d;
  }
}

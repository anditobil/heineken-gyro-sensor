import { EventEmitter } from '../core/EventEmitter.js';

/**
 * Gyro calibration.
 *
 * A MEMS gyroscope reports angular VELOCITY with a small constant offset (bias),
 * typically 0.5–5 °/s on a Joy-Con, and the bias drifts with temperature. If the
 * bias is not removed, a roll lying perfectly still looks like a slowly spinning
 * roll and the character creeps forward on its own.
 *
 * Steps:
 *  1. Neutral/bias capture: roll lies still for ~2 s. Mean of every axis = bias,
 *     standard deviation = noise floor. If the roll moved, the capture is rejected.
 *     The mean accelerometer vector = neutral gravity direction (steering baseline).
 *  2. Axis detection: the player rolls the roll forward. We integrate the
 *     bias-corrected angular velocity of every axis; the axis with the largest
 *     accumulated angle is the spin axis, and its sign tells us which way is forward.
 *  3. Continuous drift compensation is handled in SensorProcessor (re-estimates the
 *     bias whenever the roll has been resting for a while).
 */
export class GyroCalibration extends EventEmitter {
  constructor() {
    super();
    this.bias = { x: 0, y: 0, z: 0 };
    this.noise = { x: 0, y: 0, z: 0 };
    this.neutralAccel = { x: 0, y: 0, z: -1 };
    this.calibrated = false;
    this.calibratedAt = 0;
    this.source = 'none'; // 'none' | 'auto' | 'manual'
    this.mode = 'idle'; // 'idle' | 'still' | 'axis'
    this.progress = 0;
    this.message = 'Not calibrated';
    this._samples = null;
    this._duration = 0;
    this._startTime = 0;
    this._axisAccum = null;
  }

  /** Begin bias capture. `auto` = silent background capture (on connect / level start). */
  startStill({ durationMs = 2000, auto = false } = {}) {
    this.mode = 'still';
    this._auto = auto;
    this._duration = durationMs;
    this._startTime = 0;
    this._samples = { gx: [], gy: [], gz: [], ax: [], ay: [], az: [] };
    this.progress = 0;
    if (!auto) this.message = 'Keep the roll completely still…';
    this.emit('update');
  }

  /** Begin axis detection: player rolls forward for `durationMs`. */
  startAxisDetect({ durationMs = 3000 } = {}) {
    this.mode = 'axis';
    this._duration = durationMs;
    this._startTime = 0;
    this._axisAccum = { x: 0, y: 0, z: 0 };
    this._lastT = 0;
    this.progress = 0;
    this.message = 'Roll the roll FORWARD now (about 3 s)…';
    this.emit('update');
  }

  cancel() {
    if (this.mode === 'idle') return;
    this.mode = 'idle';
    this.message = this.calibrated ? 'Calibrated' : 'Not calibrated';
    this.emit('update');
  }

  /**
   * Feed one averaged IMU sample (raw deg/s, raw G) with a timestamp in ms.
   * Returns nothing; emits 'update' / 'done' / 'failed'.
   */
  feed(gyro, accel, now) {
    if (this.mode === 'idle') return;
    if (!this._startTime) this._startTime = now;
    const elapsed = now - this._startTime;
    this.progress = Math.min(1, elapsed / this._duration);

    if (this.mode === 'still') {
      const s = this._samples;
      s.gx.push(gyro.x); s.gy.push(gyro.y); s.gz.push(gyro.z);
      s.ax.push(accel.x); s.ay.push(accel.y); s.az.push(accel.z);
      // Early abort if it is obviously moving (manual capture only).
      if (!this._auto && s.gx.length > 5) {
        const mag = Math.hypot(gyro.x, gyro.y, gyro.z);
        if (mag > 120) return this._fail('The roll moved. Put it down, let go, and try again.');
      }
      if (elapsed >= this._duration) this._finishStill();
      else this.emit('update');
    } else if (this.mode === 'axis') {
      const dt = this._lastT ? (now - this._lastT) / 1000 : 0;
      this._lastT = now;
      if (dt > 0 && dt < 0.2) {
        this._axisAccum.x += (gyro.x - this.bias.x) * dt;
        this._axisAccum.y += (gyro.y - this.bias.y) * dt;
        this._axisAccum.z += (gyro.z - this.bias.z) * dt;
      }
      if (elapsed >= this._duration) this._finishAxis();
      else this.emit('update');
    }
  }

  _finishStill() {
    const s = this._samples;
    const n = s.gx.length;
    if (n < 30) return this._fail('Too few sensor reports. Is the Joy-Con awake and connected?');
    const mean = (a) => a.reduce((p, c) => p + c, 0) / a.length;
    const std = (a, m) => Math.sqrt(a.reduce((p, c) => p + (c - m) * (c - m), 0) / a.length);
    const mx = mean(s.gx), my = mean(s.gy), mz = mean(s.gz);
    const sx = std(s.gx, mx), sy = std(s.gy, my), sz = std(s.gz, mz);
    const maxStd = Math.max(sx, sy, sz);
    // A resting Joy-Con has roughly 0.2–1.5 °/s noise. Above ~4 °/s it was being touched.
    if (maxStd > 4) {
      if (this._auto) {
        this.mode = 'idle';
        this.emit('update');
        return; // silently ignore: the player was moving the roll
      }
      return this._fail(`Too much motion (noise ${maxStd.toFixed(1)}°/s). Let go of the roll and retry.`);
    }
    // A Joy-Con's zero-rate offset is a few °/s. A larger steady reading means the
    // roll was slowly turning (e.g. rolling on a slope) – never accept that as bias.
    const maxMean = Math.max(Math.abs(mx), Math.abs(my), Math.abs(mz));
    if (maxMean > 10) {
      if (this._auto) {
        this.mode = 'idle';
        this.emit('update');
        return;
      }
      return this._fail(`The roll seems to be turning slowly (${maxMean.toFixed(1)}°/s). Put it on a flat surface and retry.`);
    }
    this.bias = { x: mx, y: my, z: mz };
    this.noise = { x: sx, y: sy, z: sz };
    const ax = mean(s.ax), ay = mean(s.ay), az = mean(s.az);
    const g = Math.hypot(ax, ay, az) || 1;
    this.neutralAccel = { x: ax / g, y: ay / g, z: az / g };
    this.calibrated = true;
    this.calibratedAt = performance.now();
    this.source = this._auto ? 'auto' : 'manual';
    this.mode = 'idle';
    this.progress = 1;
    this.message = `Calibrated (bias ${mx.toFixed(2)}, ${my.toFixed(2)}, ${mz.toFixed(2)} °/s)`;
    this.emit('update');
    this.emit('done', { type: 'still', bias: this.bias, noise: this.noise, auto: this._auto });
  }

  _finishAxis() {
    const a = this._axisAccum;
    const entries = [['x', a.x], ['y', a.y], ['z', a.z]];
    entries.sort((p, q) => Math.abs(q[1]) - Math.abs(p[1]));
    const [axis, angle] = entries[0];
    const second = Math.abs(entries[1][1]);
    this.mode = 'idle';
    if (Math.abs(angle) < 120) {
      return this._fail(`Only ${Math.abs(angle).toFixed(0)}° of rotation detected – roll it further (at least half a turn).`);
    }
    if (second > Math.abs(angle) * 0.75) {
      return this._fail('Rotation was ambiguous. Roll straight forward along the floor/table and retry.');
    }
    const sign = angle >= 0 ? 1 : -1;
    this.message = `Spin axis: ${axis.toUpperCase()} (${sign > 0 ? '+' : '−'}), ${Math.abs(angle).toFixed(0)}° measured`;
    this.emit('update');
    this.emit('done', { type: 'axis', axis, sign, angle });
  }

  _fail(message) {
    this.mode = 'idle';
    this.message = message;
    this.emit('update');
    this.emit('failed', message);
  }
}

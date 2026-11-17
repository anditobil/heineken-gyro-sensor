import { EventEmitter } from '../core/EventEmitter.js';
import { OneEuroFilter, applyDeadZone, clamp, lerp } from '../core/MathUtils.js';
import { CONSTANTS } from '../core/Config.js';

/**
 * Turns raw IMU packets (Joy-Con 0x30 report shape, or PhoneMotion's copy of it)
 * into a move command in [−1, 1].
 *
 *   raw gyro (°/s, mean of the per-sample arrays)
 *     → minus calibrated bias                         (GyroCalibration)
 *     → still detection + slow drift compensation
 *     → spin axis × axisSign × invert
 *     → One-Euro filter
 *     → 0 while still, else dead zone + rescale × sensitivity, clamped
 *
 * The gyro measures angular VELOCITY, so the spin speed of the roll maps directly
 * to rolling speed. Packets older than INPUT_STALE_MS give a command of 0.
 * No DOM / three.js dependency, so it runs in the Node tests.
 */
export class SensorProcessor extends EventEmitter {
  constructor(settings, calibration) {
    super();
    this.settings = settings;
    this.calibration = calibration;

    this.raw = { gyro: { x: 0, y: 0, z: 0 }, accel: { x: 0, y: 0, z: 0 } };
    this.corrected = { x: 0, y: 0, z: 0 };
    this.omegaRaw = 0;
    this.omegaFiltered = 0;
    this.command = 0;
    this.accelMagnitude = 1;
    this.isStill = false;
    this.stillTime = 0;
    this.driftUpdates = 0;
    this.lastPacketAt = -Infinity;
    this.packetCount = 0;
    this._lastFilterT = 0;

    this.filter = new OneEuroFilter();
    this._applyFilterSettings();
    settings.on('change', (group) => {
      if (group === 'gyro') this._applyFilterSettings();
    });
  }

  _applyFilterSettings() {
    const g = this.settings.get('gyro');
    this.filter.minCutoff = lerp(8, 0.4, clamp(g.smoothing, 0, 1));
    this.filter.beta = lerp(0.0005, 0.05, clamp(g.responsiveness, 0, 1));
  }

  resetFilters() {
    this.filter.reset();
    this.command = 0;
    this.omegaFiltered = 0;
  }

  /** @param detail packet with gyroscopes[i][axis].dps and accelerometers[i].{x,y,z}.acc */
  process(detail, now) {
    const gs = detail.gyroscopes;
    const as = detail.accelerometers;
    const n = Math.min(gs?.length || 0, as?.length || 0);
    if (!n) return;

    let gx = 0, gy = 0, gz = 0, ax = 0, ay = 0, az = 0;
    for (let i = 0; i < n; i++) {
      const g = gs[i];
      const a = as[i];
      gx += g[0]?.dps ?? 0; gy += g[1]?.dps ?? 0; gz += g[2]?.dps ?? 0;
      ax += a.x?.acc ?? 0; ay += a.y?.acc ?? 0; az += a.z?.acc ?? 0;
    }
    gx /= n; gy /= n; gz /= n; ax /= n; ay /= n; az /= n;

    const raw = this.raw;
    raw.gyro.x = gx; raw.gyro.y = gy; raw.gyro.z = gz;
    raw.accel.x = ax; raw.accel.y = ay; raw.accel.z = az;
    this.accelMagnitude = Math.hypot(ax, ay, az);

    this.calibration.feed(raw.gyro, raw.accel, now);

    const dt = this._lastFilterT ? clamp((now - this._lastFilterT) / 1000, 0.001, 0.1) : 1 / 66;
    this._lastFilterT = now;
    this.lastPacketAt = now;
    this.packetCount++;

    const cfg = this.settings.get('gyro');
    const bias = this.calibration.bias;
    const c = this.corrected;
    c.x = gx - bias.x;
    c.y = gy - bias.y;
    c.z = gz - bias.z;

    // 2. Still detection
    const gyroMag = Math.hypot(c.x, c.y, c.z);
    const stillNow = gyroMag < 3.5 && Math.abs(this.accelMagnitude - 1) < 0.06;
    this.stillTime = stillNow ? this.stillTime + dt : 0;
    this.isStill = this.stillTime > 0.35;

    // 3. Drift compensation: after 1 s still, EMA the bias toward the raw reading (τ = 3 s)
    if (cfg.driftCompensation && this.stillTime > 1.0 && this.calibration.mode === 'idle') {
      const k = 1 - Math.exp(-dt / 3);
      bias.x += (gx - bias.x) * k;
      bias.y += (gy - bias.y) * k;
      bias.z += (gz - bias.z) * k;
      this.driftUpdates++;
    }

    // 4. Spin axis
    const axis = cfg.axis === 'y' ? c.y : cfg.axis === 'z' ? c.z : c.x;
    this.omegaRaw = axis * (cfg.axisSign || 1) * (cfg.invert ? -1 : 1);

    // 5. One-Euro
    this.omegaFiltered = this.filter.filter(this.omegaRaw, dt);

    // 6. Command
    let cmd = 0;
    if (!this.isStill) {
      const fullScale = Math.max(cfg.deadZone + 30, cfg.maxRotationSpeed);
      cmd = applyDeadZone(this.omegaFiltered, cfg.deadZone, fullScale) * cfg.sensitivity;
    }
    this.command = clamp(cmd, -1, 1);
    this.emit('processed');
  }

  /** 7. Command for gameplay; 0 if no packet arrived in the last 250 ms. */
  getCommand(now) {
    if (!this.isLive(now)) return 0;
    return this.command;
  }

  isLive(now) {
    return now - this.lastPacketAt <= CONSTANTS.INPUT_STALE_MS;
  }
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Frame-rate independent exponential smoothing. `rate` = 1/seconds. */
export const damp = (current, target, rate, dt) => lerp(current, target, 1 - Math.exp(-rate * dt));

/** Move `current` toward `target` by at most `maxDelta`. */
export const approach = (current, target, maxDelta) => {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
};

/**
 * Dead zone with smooth re-scaling: sign(v) · max(0, |v| − dz) / (fs − dz).
 * Output starts at 0 right at the threshold, so there is no jump at the edge.
 */
export const applyDeadZone = (value, deadZone, fullScale) => {
  const mag = Math.abs(value);
  if (mag <= deadZone) return 0;
  return (Math.sign(value) * (mag - deadZone)) / Math.max(1e-6, fullScale - deadZone);
};

class LowPass {
  constructor() {
    this.y = 0;
    this.initialized = false;
  }
  filter(x, alpha) {
    if (!this.initialized) {
      this.y = x;
      this.initialized = true;
    } else {
      this.y = alpha * x + (1 - alpha) * this.y;
    }
    return this.y;
  }
}

/**
 * One Euro Filter (Casiez et al. 2012): heavy smoothing when the signal is slow,
 * low lag when it changes quickly.
 */
export class OneEuroFilter {
  constructor({ minCutoff = 1.0, beta = 0.02, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }

  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  reset() {
    this.x = new LowPass();
    this.dx = new LowPass();
    this.lastValue = 0;
    this.hasLast = false;
  }

  filter(value, dt) {
    if (dt <= 0) dt = 1 / 60;
    const dValue = this.hasLast ? (value - this.lastValue) / dt : 0;
    this.lastValue = value;
    this.hasLast = true;
    const edValue = this.dx.filter(dValue, OneEuroFilter.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edValue);
    return this.x.filter(value, OneEuroFilter.alpha(cutoff, dt));
  }
}

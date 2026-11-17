import { CONSTANTS } from './Config.js';

/**
 * requestAnimationFrame loop with a fixed physics timestep (accumulator pattern).
 *   fixedUpdate(dt) – 0..n times per frame at PHYSICS_HZ (120 Hz)
 *   update(dt)      – once per frame (visuals, camera, UI)
 */
export class GameLoop {
  constructor({ fixedUpdate, update, render }) {
    this.fixedUpdate = fixedUpdate;
    this.update = update;
    this.render = render;
    this.step = 1 / CONSTANTS.PHYSICS_HZ;
    this.running = false;
    this._last = 0;
    this._acc = 0;
    this._tick = this._tick.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    this._acc = 0;
    requestAnimationFrame(this._tick);
  }

  _tick(now) {
    if (!this.running) return;
    requestAnimationFrame(this._tick);
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (dt > CONSTANTS.MAX_FRAME_DT) dt = CONSTANTS.MAX_FRAME_DT;
    if (dt < 0) dt = 0;

    this._acc += dt;
    let steps = 0;
    while (this._acc >= this.step && steps < 14) {
      this.fixedUpdate(this.step);
      this._acc -= this.step;
      steps++;
    }
    if (steps >= 14) this._acc = 0; // spiral-of-death guard

    this.update(dt);
    this.render();
  }
}

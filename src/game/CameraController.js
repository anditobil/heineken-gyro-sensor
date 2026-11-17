import * as THREE from 'three';
import { damp, clamp } from '../core/MathUtils.js';

/**
 * Front view of the tower shaft, following the can's depth with exponential damping,
 * plus trauma-based shake on hits. The menu uses the same view as a backdrop.
 */
export class CameraController {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3(0, 2, 13.5);
    this.look = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._desiredLook = new THREE.Vector3();
    this.trauma = 0;
    this._t = 0;
    /** true = show the whole 12 m shaft width (tutorial board); false = closer gameplay view */
    this.wide = false;
  }

  /**
   * Framing per screen shape.
   * Landscape: the original front view (13.5 m away, fov 58).
   * Portrait gameplay: closer (11.5 m, fov 68) and following the can sideways more, so the
   * can stays big and in view even though the whole shaft no longer fits the narrow screen.
   * Portrait + wide (tutorial): far enough to see the whole board with both end caps.
   */
  _framing() {
    const aspect = this.camera.aspect;
    if (this.wide) {
      // Tutorial: fixed and centred, far enough that the 12 m board (+ margin) fits the width.
      // Drone view: same viewing distance, but raised 20° so you look down onto the board a little.
      const halfW = 5.6;
      const dist = Math.max(9, halfW / (Math.tan((60 * Math.PI) / 360) * aspect));
      const pitch = (20 * Math.PI) / 180;
      return { dist: dist * Math.cos(pitch), fov: 60, kx: 0, kl: 0, up: dist * Math.sin(pitch), down: 0.6 };
    }
    if (aspect >= 0.8) return { dist: 13.5, fov: 58, kx: 0.35, kl: 0.45, up: 2.2, down: -1.6 };
    return { dist: 11.5, fov: 68, kx: 0.6, kl: 0.6, up: 2.2, down: -1.6 };
  }

  shake(amount) {
    this.trauma = clamp(this.trauma + amount, 0, 1);
  }

  _computeFollow(target) {
    const f = this._framing();
    this._desired.set(target.x * f.kx, target.y + f.up, target.z + f.dist);
    this._desiredLook.set(target.x * f.kl, target.y + f.down, target.z);
    if (Math.abs(this.camera.fov - f.fov) > 0.01) {
      this.camera.fov = f.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  snap(target) {
    this._computeFollow(target);
    this.pos.copy(this._desired);
    this.look.copy(this._desiredLook);
    this.trauma = 0;
    this._apply();
  }

  update(dt, target) {
    this._t += dt;
    this._computeFollow(target);
    this.pos.x = damp(this.pos.x, this._desired.x, 4, dt);
    this.pos.y = damp(this.pos.y, this._desired.y, 5, dt);
    this.pos.z = damp(this.pos.z, this._desired.z, 4, dt);
    this.look.x = damp(this.look.x, this._desiredLook.x, 4, dt);
    this.look.y = damp(this.look.y, this._desiredLook.y, 6, dt);
    this.look.z = damp(this.look.z, this._desiredLook.z, 4, dt);
    this._apply(dt);
  }

  _apply(dt = 0) {
    this.camera.position.copy(this.pos);
    if (this.trauma > 0) {
      const s = this.trauma * this.trauma * 0.35;
      const t = this._t * 40;
      this.camera.position.x += Math.sin(t * 1.1) * s;
      this.camera.position.y += Math.sin(t * 1.7 + 1) * s;
      this.camera.position.z += Math.sin(t * 1.3 + 2) * s * 0.5;
      this.trauma = Math.max(0, this.trauma - dt * 1.6);
    }
    this.camera.lookAt(this.look);
  }
}

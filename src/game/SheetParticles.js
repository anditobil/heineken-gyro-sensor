import * as THREE from 'three';

const MAX_DROPS = 160;
const GRAVITY = 16;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Water splash on a hit: small glossy droplets burst out, arc under gravity and shrink away.
 * Each drop is stretched along its velocity so fast drops read as streaks.
 * (Class name kept from the old paper-sheet particles; same burst/update/clear API.)
 */
export class SheetParticles {
  constructor(parent, material) {
    this.parent = parent;
    const geo = new THREE.SphereGeometry(1, 10, 8);
    this.mesh = new THREE.InstancedMesh(geo, material, MAX_DROPS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
    this.items = Array.from({ length: MAX_DROPS }, () => ({
      alive: false, life: 0, maxLife: 1, size: 0.05,
      p: new THREE.Vector3(), v: new THREE.Vector3(),
    }));
    this._dummy = new THREE.Object3D();
    this._dir = new THREE.Vector3();
  }

  spawn(x, y, z, vx, vy, vz, life, size) {
    const it = this.items.find((i) => !i.alive);
    if (!it) return;
    it.alive = true;
    it.life = it.maxLife = life;
    it.size = size;
    it.p.set(x, y, z);
    it.v.set(vx, vy, vz);
  }

  /** Radial splash with an upward bias. `count` big drops plus a spray of tiny ones. */
  burst(x, y, z, count = 14, power = 5) {
    const total = Math.round(count * 1.8);
    for (let i = 0; i < total; i++) {
      const tiny = i >= count;
      const a = Math.random() * Math.PI * 2;
      const sp = power * (tiny ? 0.8 + Math.random() * 0.9 : 0.45 + Math.random() * 0.7);
      this.spawn(
        x + Math.cos(a) * 0.15, y + Math.sin(a) * 0.15, z,
        Math.cos(a) * sp,
        Math.abs(Math.sin(a)) * sp * 0.6 + power * (0.5 + Math.random() * 0.6),
        (Math.random() - 0.3) * power * 0.6,
        (tiny ? 0.35 : 0.55) + Math.random() * 0.35,
        tiny ? 0.025 + Math.random() * 0.025 : 0.05 + Math.random() * 0.06,
      );
    }
  }

  update(dt) {
    let n = 0;
    const d = this._dummy;
    for (const it of this.items) {
      if (!it.alive) continue;
      it.life -= dt;
      if (it.life <= 0) { it.alive = false; continue; }
      it.v.y -= GRAVITY * dt;
      it.v.multiplyScalar(Math.exp(-0.6 * dt));
      it.p.addScaledVector(it.v, dt);
      const speed = it.v.length();
      const k = Math.min(1, it.life / (it.maxLife * 0.5)); // shrink in the last half of its life
      const s = it.size * k;
      d.position.copy(it.p);
      if (speed > 0.01) d.quaternion.setFromUnitVectors(UP, this._dir.copy(it.v).divideScalar(speed));
      d.scale.set(s, s * (1 + Math.min(2.5, speed * 0.18)), s);
      d.updateMatrix();
      this.mesh.setMatrixAt(n++, d.matrix);
    }
    this.mesh.count = n;
    if (n) this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    for (const it of this.items) it.alive = false;
    this.mesh.count = 0;
  }

  dispose() {
    this.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
  }
}

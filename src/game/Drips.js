import * as THREE from 'three';

const MAX = 90;
const GRAVITY = 9.8;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Fridge condensation: clear water drops around the visible part of the tower.
 *  - shelf drips: a drop slowly swells under a shelf's front edge, then falls
 *  - wall runs: a drop crawls down the tile wall or a side wall, wobbling, then fades
 * Purely visual (no gameplay). Instanced spheres, stretched along their motion.
 */
export class Drips {
  constructor(parent) {
    this.parent = parent;
    const geo = new THREE.SphereGeometry(1, 10, 8);
    // Water: almost clear in the middle, visible mainly at the rim and in the highlights
    // (fresnel), like a real drop. No emission, so it never looks like a white bead.
    this.mat = new THREE.MeshStandardMaterial({
      color: 0xdff4ff, roughness: 0.0, metalness: 0.0, transparent: true, opacity: 0.55,
      envMapIntensity: 1.4, depthWrite: false,
    });
    this.mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        float fres = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.2);
        gl_FragColor.a = clamp(0.04 + fres * 0.9, 0.0, 1.0) * opacity;`,
      );
    };
    this.mesh = new THREE.InstancedMesh(geo, this.mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    parent.add(this.mesh);
    this.items = Array.from({ length: MAX }, () => ({
      alive: false, kind: 'drip', t: 0, life: 0, size: 0.05,
      p: new THREE.Vector3(), v: new THREE.Vector3(), floor: -1e9, phase: 0,
    }));
    this._d = new THREE.Object3D();
    this._dir = new THREE.Vector3();
    this._shelfAcc = 0;
    this._wallAcc = 0;
  }

  clear() {
    for (const it of this.items) it.alive = false;
    this.mesh.count = 0;
  }

  _free() {
    return this.items.find((i) => !i.alive);
  }

  /**
   * @param drop  DropMode (shelves, can position, shaft geometry)
   * @param view  { wallZ, half, depth, thick }
   */
  update(dt, drop, view) {
    if (!drop.cfg || dt <= 0) return;
    const yMin = drop.y - 12, yMax = drop.y + 7; // roughly what the camera sees

    // ── spawn shelf drips (~2.6/s spread over visible shelves) ──
    this._shelfAcc += dt * 2.2;
    while (this._shelfAcc >= 1) {
      this._shelfAcc -= 1;
      const visible = drop.shelves.filter((s) => s.y > yMin && s.y < yMax);
      if (!visible.length) break;
      const s = visible[(Math.random() * visible.length) | 0];
      const it = this._free();
      if (!it) break;
      const x = s.x0 + s.off + 0.2 + Math.random() * (s.x1 - s.x0 - 0.4);
      it.alive = true;
      it.kind = 'drip';
      it.shelf = s;
      it.localX = x - s.off;
      it.t = 0;
      it.form = 0.8 + Math.random() * 1.2; // seconds to swell before falling
      it.size = 0.04 + Math.random() * 0.03;
      // hang from the lower FRONT edge (in view), just under the neon line
      it.p.set(x, s.y - view.thick - 0.03, view.depth / 2 + 0.03);
      it.v.set(0, 0, 0);
      const below = this._shelfBelow(drop, x, it.p.y);
      it.floor = below ? below.y : -1e9;
      it.floorShelf = below;
      it.life = 4;
    }

    // ── spawn wall runs (~1.4/s): back tiles or the inner face of a side wall ──
    this._wallAcc += dt * 1.3;
    while (this._wallAcc >= 1) {
      this._wallAcc -= 1;
      const it = this._free();
      if (!it) break;
      it.alive = true;
      it.kind = 'run';
      it.t = 0;
      it.size = 0.032 + Math.random() * 0.022;
      it.life = 2.2 + Math.random() * 2;
      it.phase = Math.random() * 10;
      const y = yMin + 3 + Math.random() * (yMax - yMin - 3);
      const r = Math.random();
      if (r < 0.6) {
        it.p.set(-view.half + 0.4 + Math.random() * (view.half * 2 - 0.8), y, view.wallZ + 0.19);
        it.side = 0;
      } else {
        const side = r < 0.8 ? -1 : 1;
        it.p.set(side * (view.half + 0.005), y, -view.depth / 2 + Math.random() * view.depth);
        it.side = side;
      }
      it.v.set(0, -(0.25 + Math.random() * 0.35), 0);
    }

    // ── simulate + write instances ──
    let n = 0;
    const d = this._d;
    for (const it of this.items) {
      if (!it.alive) continue;
      it.t += dt;
      let sx = it.size, sy = it.size;
      if (it.kind === 'drip') {
        if (it.t < it.form) {
          // swelling under the shelf, riding along if the shelf moves
          const k = it.t / it.form;
          it.p.x = it.localX + it.shelf.off;
          sx = it.size * (0.3 + 0.7 * k);
          sy = sx * (1 + 0.5 * k);
        } else {
          it.v.y -= GRAVITY * dt;
          it.p.addScaledVector(it.v, dt);
          if (it.p.y < it.floor) {
            // landed: feed a puddle on that shelf, just behind its front edge
            if (it.floorShelf) this.onLand?.(it.floorShelf, it.p.x, view.depth / 2 - 0.2 - Math.random() * 0.3);
            it.alive = false;
            continue;
          }
          if (it.t > it.life) { it.alive = false; continue; }
        }
      } else {
        // crawling run: speeds up and slows down, small sideways wobble, fades out
        const wob = Math.sin(it.t * 3 + it.phase) * 0.05 * dt;
        if (it.side === 0) it.p.x += wob; else it.p.z += wob;
        it.p.y += it.v.y * dt * (0.6 + 0.6 * Math.abs(Math.sin(it.t * 1.7 + it.phase)));
        const fade = Math.min(1, it.t / 0.3) * Math.min(1, (it.life - it.t) / 0.6);
        if (it.t > it.life) { it.alive = false; continue; }
        sx = it.size * fade;
        sy = sx * 1.6;
      }
      d.position.copy(it.p);
      const speed = it.v.length();
      if (it.kind === 'drip' && it.t >= it.form && speed > 0.01) {
        d.quaternion.setFromUnitVectors(UP, this._dir.copy(it.v).divideScalar(speed));
        sy = sx * (1 + Math.min(2.2, speed * 0.25));
      } else {
        d.quaternion.identity();
      }
      d.scale.set(sx, sy, it.kind === 'run' ? sx * 0.5 : sx);
      d.updateMatrix();
      this.mesh.setMatrixAt(n++, d.matrix);
    }
    this.mesh.count = n;
    if (n) this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Nearest shelf under (x, y), so falling drops stop (and pool) there. */
  _shelfBelow(drop, x, y) {
    let best = null;
    for (const s of drop.shelves) {
      if (s.y < y - 0.05 && x >= s.x0 + s.off && x <= s.x1 + s.off && (!best || s.y > best.y)) best = s;
    }
    return best;
  }

  dispose() {
    this.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

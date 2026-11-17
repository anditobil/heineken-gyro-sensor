import * as THREE from 'three';
import { CONSTANTS } from '../core/Config.js';

const HALF_W = CONSTANTS.STRIP_WIDTH / 2;
const SHEET_LENGTH = CONSTANTS.SHEET_LENGTH;

/**
 * One continuous ribbon (the drink trail). Fixed-size buffers, grown only when a level
 * needs more capacity (never inside the frame loop).
 */
export class Strip {
  /** @param widthZ  true → ribbon width along world Z (front view, path in the X/Y plane) */
  constructor(parent, material, capacity, widthZ = true) {
    this.parent = parent;
    this.material = material;
    this.widthZ = widthZ;
    this.capacity = 0;
    this.count = 0;
    this.length = 0;
    this.mesh = null;
    this.allocate(capacity);
  }

  allocate(capacity) {
    if (capacity <= this.capacity) return;
    if (this.mesh) {
      this.parent.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    this.capacity = capacity;
    this.px = new Float32Array(capacity);
    this.py = new Float32Array(capacity);
    this.pz = new Float32Array(capacity);
    this.cum = new Float32Array(capacity); // cumulative length → texture V

    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(capacity * 2 * 3);
    this.uvs = new Float32Array(capacity * 2 * 2);
    const normals = new Float32Array(capacity * 2 * 3);
    for (let i = 0; i < capacity * 2; i++) normals[i * 3 + 1] = 1;
    const index = new (capacity * 2 > 65535 ? Uint32Array : Uint16Array)((capacity - 1) * 6);
    for (let i = 0; i < capacity - 1; i++) {
      const a = i * 2;
      index.set([a, a + 2, a + 1, a + 1, a + 2, a + 3], i * 6);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false; // bounds change every step
    this.mesh.visible = false;
    this.parent.add(this.mesh);
  }

  clear() {
    this.count = 0;
    this.length = 0;
    this.mesh.geometry.setDrawRange(0, 0);
    this.mesh.visible = false;
  }

  /** Adds a point; returns the length of the new segment. */
  push(x, y, z) {
    if (this.count >= this.capacity) return 0;
    const i = this.count;
    let seg = 0;
    if (i > 0) {
      seg = Math.hypot(x - this.px[i - 1], y - this.py[i - 1], z - this.pz[i - 1]);
      this.length += seg;
    }
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.cum[i] = this.length;
    this.count++;
    this._writeVertex(i);
    if (i > 0) this._writeVertex(i - 1); // re-orient the previous point
    this._commit();
    return seg;
  }

  /** Removes the last point; returns the removed segment length. */
  pop() {
    if (this.count <= 1) return 0;
    const i = this.count - 1;
    const seg = Math.hypot(this.px[i] - this.px[i - 1], this.py[i] - this.py[i - 1], this.pz[i] - this.pz[i - 1]);
    this.count--;
    this.length -= seg;
    this._commit();
    return seg;
  }

  lastIndex() {
    return this.count - 1;
  }

  _writeVertex(i) {
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(this.count - 1, i + 1);
    let nx, nz;
    if (this.widthZ) {
      // Width runs along Z on shelves. Where the drink pours down (vertical segments)
      // the ribbon twists toward the camera so the falling streak stays readable.
      const ddx = this.px[i1] - this.px[i0];
      const ddy = this.py[i1] - this.py[i0];
      const l = Math.hypot(ddx, ddy);
      const vertical = l > 1e-5 ? Math.abs(ddy) / l : 0;
      const a = vertical * 1.4;
      nx = Math.sin(a) * HALF_W;
      nz = Math.cos(a) * HALF_W;
    } else {
      let dx = this.px[i1] - this.px[i0];
      let dz = this.pz[i1] - this.pz[i0];
      const len = Math.hypot(dx, dz);
      if (len < 1e-5) { dx = 0; dz = -1; } else { dx /= len; dz /= len; }
      nx = -dz * HALF_W;
      nz = dx * HALF_W;
    }
    const y = this.py[i];
    const p = this.positions;
    const o = i * 6;
    p[o] = this.px[i] + nx; p[o + 1] = y; p[o + 2] = this.pz[i] + nz;
    p[o + 3] = this.px[i] - nx; p[o + 4] = y; p[o + 5] = this.pz[i] - nz;
    const v = this.cum[i] / SHEET_LENGTH;
    const u = this.uvs;
    u[i * 4] = 0; u[i * 4 + 1] = v;
    u[i * 4 + 2] = 1; u[i * 4 + 3] = v;
  }

  _commit() {
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.uv.needsUpdate = true;
    g.setDrawRange(0, Math.max(0, (this.count - 1) * 6));
    this.mesh.visible = this.count > 1;
  }

  dispose() {
    this.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
  }
}

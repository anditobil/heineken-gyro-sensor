import * as THREE from 'three';

const MAX = 70;
const Y_OFF = 0.026; // just above the shelf cap

/** Soft, slightly irregular blob for the puddle edge (alpha map). */
function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 128);
  // a few overlapping soft circles → organic outline
  for (const [x, y, r] of [[64, 64, 46], [46, 58, 30], [84, 70, 28], [60, 82, 24], [74, 48, 22]]) {
    const grad = g.createRadialGradient(x, y, r * 0.35, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/**
 * Water pooling on the shelves: thin, clear, reflective films. A few are already there when
 * a level loads (the fridge is wet), and new ones grow where falling drips land. They ride
 * along with moving shelves. Visual only.
 */
export class Puddles {
  constructor(parent) {
    this.parent = parent;
    const geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    this.alphaTex = blobTexture();
    this.mat = new THREE.MeshStandardMaterial({
      color: 0xd6f1ff, roughness: 0.0, metalness: 0.15, transparent: true, opacity: 1,
      alphaMap: this.alphaTex, envMapIntensity: 1.6, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    // Water film: nearly invisible straight on, more visible (reflective) at grazing angles.
    this.mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        float fres = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 1.6);
        gl_FragColor.a = diffuseColor.a * clamp(0.1 + fres * 0.55, 0.0, 0.6);`,
      );
    };
    this.mesh = new THREE.InstancedMesh(geo, this.mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
    parent.add(this.mesh);
    this.items = [];
    this._d = new THREE.Object3D();
  }

  /** Wet shelves from the start: a couple of puddles per shelf. */
  seed(shelves, depth) {
    this.items = [];
    for (const s of shelves) {
      if (s.goal) continue;
      const w = s.x1 - s.x0;
      const n = Math.max(1, Math.round(w / 3.2));
      for (let i = 0; i < n; i++) {
        const x = s.x0 + 0.4 + Math.random() * (w - 0.8);
        const z = -depth / 2 + 0.3 + Math.random() * (depth - 0.6);
        this.add(s, x, z, true);
      }
    }
  }

  /** New puddle (or a grown one) on shelf `s` at world x, z. */
  add(s, x, z, grown = false) {
    if (this.items.length >= MAX) this.items.shift(); // oldest dries up
    const r = 0.14 + Math.random() * 0.22;
    this.items.push({
      shelf: s, lx: x - s.off, z, r, k: grown ? 1 : 0.05,
      sx: 0.7 + Math.random() * 0.8, rot: Math.random() * Math.PI,
    });
  }

  /** A drip landed here: grow an existing nearby puddle, or start a new one. */
  splash(s, x, z) {
    const lx = x - s.off;
    const near = this.items.find((p) => p.shelf === s && Math.abs(p.lx - lx) < p.r * 1.2 && Math.abs(p.z - z) < 0.5);
    if (near) {
      near.r = Math.min(0.55, near.r + 0.02);
      near.k = Math.min(near.k, 0.85); // small ripple: shrink a touch, then regrow
    } else {
      this.add(s, x, z);
    }
  }

  update(dt) {
    const d = this._d;
    let n = 0;
    for (const p of this.items) {
      if (p.k < 1) p.k = Math.min(1, p.k + dt * 0.8);
      const r = p.r * (0.3 + 0.7 * p.k);
      d.position.set(p.lx + p.shelf.off, p.shelf.y + Y_OFF, p.z);
      d.rotation.set(0, p.rot, 0);
      d.scale.set(r * p.sx, 1, r);
      d.updateMatrix();
      this.mesh.setMatrixAt(n++, d.matrix);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.alphaTex.dispose();
  }
}

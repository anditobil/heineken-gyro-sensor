import * as THREE from 'three';

const PICK_DX = 0.6;
const PICK_DY = 0.75;

/** Extruded five-point star, centred, facing the camera. */
export function starGeometry(outer = 0.42, inner = 0.18, depth = 0.14) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i / 10) * Math.PI * 2;
    const r = i % 2 ? inner : outer;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/**
 * Collectible red stars placed in a level (`cfg.stars`). Spinning, bobbing, with a soft glow.
 * Picked up when the can's centre passes close by; they pop and splash.
 */
export class Stars {
  constructor() {
    this.items = [];
    this.time = 0;
  }

  get total() { return this.items.length; }
  get collected() { return this.items.filter((i) => i.taken).length; }

  build(drop, list) {
    this.items = [];
    if (!list?.length) return;
    const starMat = new THREE.MeshStandardMaterial({ color: 0xe3131b, roughness: 0.35, metalness: 0.0, emissive: 0x8a0006, emissiveIntensity: 0.35 });
    // Neutral white halo: a red halo over the green wall would read as orange.
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.14, depthWrite: false });
    const geo = starGeometry();
    const glowGeo = new THREE.CircleGeometry(0.62, 40);
    // White outline like the star in the Heineken logo: a slightly larger, thinner white star
    // right behind the red one (still 3D when it spins).
    const outlineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.0, emissive: 0xffffff, emissiveIntensity: 0.15 });
    const outlineGeo = starGeometry(0.42 * 1.13, 0.18 * 1.13, 0.09);
    drop.disposables.push(starMat, glowMat, geo, glowGeo, outlineMat, outlineGeo);
    for (const p of list) {
      const g = new THREE.Group();
      const spin = new THREE.Group();
      const star = new THREE.Mesh(geo, starMat);
      star.castShadow = true;
      spin.add(star, new THREE.Mesh(outlineGeo, outlineMat));
      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.position.z = -0.25;
      g.add(spin, glow);
      g.position.set(p.x, p.y, 0);
      // Drawn in the overlay (after bloom/grade) so the green glow can't turn the red orange.
      const layer = drop.overlay || drop.world;
      layer.add(g);
      drop.disposables.push({ dispose: () => layer.remove(g) });
      this.items.push({ x: p.x, y: p.y, group: g, spin, glow, taken: false, pop: 0, phase: p.x * 1.7 });
    }
  }

  reset() {
    for (const it of this.items) {
      it.taken = false;
      it.pop = 0;
      it.group.visible = true;
      it.group.scale.setScalar(1);
    }
  }

  /** Physics step: returns the star picked up this step (or null). */
  check(drop) {
    for (const it of this.items) {
      if (it.taken) continue;
      if (Math.abs(drop.x - it.x) < PICK_DX && Math.abs(drop.y - it.y) < PICK_DY) {
        it.taken = true;
        it.pop = 1;
        drop.sheets.burst(it.x, it.y, 0.3, 12, 4);
        return it;
      }
    }
    return null;
  }

  animate(dt) {
    this.time += dt;
    for (const it of this.items) {
      if (it.taken) {
        if (it.pop <= 0) continue;
        it.pop = Math.max(0, it.pop - dt * 3);
        it.group.scale.setScalar(it.pop * (1 + (1 - it.pop) * 0.8));
        it.group.visible = it.pop > 0;
        continue;
      }
      it.spin.rotation.y += dt * 2.4;
      it.group.position.y = it.y + Math.sin(this.time * 3 + it.phase) * 0.08;
      it.glow.scale.setScalar(1 + Math.sin(this.time * 4 + it.phase) * 0.15);
    }
  }
}

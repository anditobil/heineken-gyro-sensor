import * as THREE from 'three';
import { DROP_LEVELS } from './dropLevels.js';

/**
 * Playable tutorial: one full-width board, the can starts in the middle and a red star
 * waits at each end. Rolling left and right to collect both finishes the tutorial.
 */
export const TUTORIAL_LEVEL = {
  id: 0, name: 'Tutorial', subtitle: 'Roll left and right', paper: 110, hitLoss: 0, parTime: 0,
  start: { x: 0, y: 0 },
  theme: DROP_LEVELS[0].theme, // overridden by HOUSE_THEME in DropMode
  shelves: [{ x0: -6, x1: 6, y: 0 }],
  wallBottom: -30, // the camera looks down past the board; keep the shaft wall in view
  wallLogo: false, // the box overlay already shows the logo
  saws: [],
  signs: [],
};

const ITEM_X = 5.0; // can centre can reach ±5.54 (wall at ±6, radius 0.46)
const ITEM_Y = 0.65;
const PICK_DX = 0.55;

function starGeometry(outer = 0.42, inner = 0.18, depth = 0.14) {
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

export class Tutorial {
  constructor() {
    this.items = [];
    this.time = 0;
  }

  get collected() {
    return this.items.filter((i) => i.taken).length;
  }

  get total() {
    return this.items.length;
  }

  get done() {
    return this.total > 0 && this.collected === this.total;
  }

  /** Builds the stars inside the DropMode world (disposed with it on the next load). */
  begin(drop) {
    this.items = [];
    this.time = 0;
    const starMat = new THREE.MeshStandardMaterial({ color: 0xe3131b, roughness: 0.35, metalness: 0.0, emissive: 0x8a0006, emissiveIntensity: 0.35 });
    // Neutral white halo: a red halo over the green wall would read as orange.
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.14, depthWrite: false });
    const starGeo = starGeometry();
    const glowGeo = new THREE.CircleGeometry(0.62, 40);
    // White outline like the star in the Heineken logo: a slightly larger, thinner white star
    // right behind the red one (still 3D when it spins).
    const outlineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.0, emissive: 0xffffff, emissiveIntensity: 0.15 });
    const outlineGeo = starGeometry(0.42 * 1.13, 0.18 * 1.13, 0.09);
    drop.disposables.push(starMat, glowMat, starGeo, glowGeo, outlineMat, outlineGeo);

    for (const side of [-1, 1]) {
      const g = new THREE.Group();
      const spin = new THREE.Group();
      const star = new THREE.Mesh(starGeo, starMat);
      star.castShadow = true;
      spin.add(star, new THREE.Mesh(outlineGeo, outlineMat));
      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.position.z = -0.25;
      g.add(spin, glow);
      g.position.set(side * ITEM_X, ITEM_Y, 0);
      // Drawn in the overlay (after bloom/grade) so the green glow can't turn the red orange.
      const layer = drop.overlay || drop.world;
      layer.add(g);
      drop.disposables.push({ dispose: () => layer.remove(g) });
      this.items.push({ side, group: g, spin, ring: glow, taken: false, pop: 0 });
    }
  }

  /** Physics step: returns the item picked up this step (or null). */
  check(drop) {
    for (const it of this.items) {
      if (it.taken) continue;
      if (Math.abs(drop.x - it.side * ITEM_X) < PICK_DX && Math.abs(drop.y - ITEM_Y) < 0.8) {
        it.taken = true;
        it.pop = 1;
        drop.sheets.burst(it.side * ITEM_X, ITEM_Y, 0.3, 14, 4);
        return it;
      }
    }
    return null;
  }

  /** Per-frame animation: spin, bob, glow pulse, pop-out when taken. */
  animate(dt) {
    this.time += dt;
    for (const it of this.items) {
      if (it.taken) {
        it.pop = Math.max(0, it.pop - dt * 3);
        it.group.scale.setScalar(it.pop * (1 + (1 - it.pop) * 0.8));
        it.group.visible = it.pop > 0;
        continue;
      }
      it.spin.rotation.y += dt * 2.4;
      it.group.position.y = ITEM_Y + Math.sin(this.time * 3 + it.side) * 0.08;
      it.ring.scale.setScalar(1 + Math.sin(this.time * 4) * 0.15);
    }
  }
}

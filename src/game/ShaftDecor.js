import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { brandUrl } from '../ui/Brand.js';

/**
 * Visual dressing of the tower in the "Drop into the moment" look:
 *  - back wall of glossy green rounded tiles; tiles behind the can's path light up white
 *    (this is the trail now, instead of the old ribbon)
 *  - wet glass shelves with neon edge lines
 *  - green side walls with a neon strip on the inner edge
 *  - metal sign plates with neon borders
 *  - optional brand logo on the wall (public/brand/heineken-house-logo.*)
 * Everything is procedural; brand files are only loaded, never drawn.
 */

const NEON = new THREE.Color('#7dff3d');
const TILE = 1.0;
const TILE_GREENS = ['#08451a', '#0a5020', '#073d17', '#0c5a24'].map((c) => new THREE.Color(c));
const TILE_LIT = new THREE.Color('#eef3ee');
const LIGHT_TIME = 0.28; // s for a tile to turn white

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

/** Deterministic pseudo-random (so the droplets look the same every run). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const texCache = new Map();
/** Base colour sprinkled with small water droplets (highlight + soft shadow). */
export function dropletTexture(base, seed = 7, density = 140) {
  const key = `${base}:${seed}:${density}`;
  if (texCache.has(key)) return texCache.get(key);
  const [c, g] = canvas(256, 256);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  const r = rng(seed);
  for (let i = 0; i < density; i++) {
    const x = r() * 256, y = r() * 256, s = 0.8 + r() * r() * 4.5;
    g.fillStyle = 'rgba(0,30,10,0.28)';
    g.beginPath(); g.arc(x + s * 0.35, y + s * 0.45, s, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(235,255,240,0.55)';
    g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.beginPath(); g.arc(x - s * 0.35, y - s * 0.35, Math.max(0.5, s * 0.3), 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  texCache.set(key, t);
  return t;
}

/** Neon material: bright, ignores tone mapping so it reads as light. */
function neonMat(intensity = 1) {
  // HDR ×2.6: well above the bloom threshold → a rich green glow on the shelf neon.
  return new THREE.MeshBasicMaterial({ color: NEON.clone().multiplyScalar(intensity * 2.6) });
}

// ───────────────────────── tile wall ─────────────────────────

export class TileWall {
  constructor(world, disposables, { top, bottom, z, halfWidth }) {
    this.top = top;
    this.cols = Math.round(halfWidth * 2 / TILE) + 1; // tile centres from −halfWidth … +halfWidth
    this.x0 = -halfWidth;
    this.rows = Math.ceil((top - bottom) / TILE);
    const count = this.cols * this.rows;
    const geo = new RoundedBoxGeometry(TILE * 0.93, TILE * 0.93, 0.16, 2, 0.09);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.05, envMapIntensity: 0.45 });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.receiveShadow = true;
    const m = new THREE.Matrix4();
    this.base = [];
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const i = row * this.cols + col;
        m.makeTranslation(this.x0 + col * TILE, top - (row + 0.5) * TILE, z);
        this.mesh.setMatrixAt(i, m);
        const base = TILE_GREENS[(col * 7 + row * 13 + ((col * row) % 3)) % TILE_GREENS.length];
        this.base.push(base);
        this.mesh.setColorAt(i, base);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    world.add(this.mesh);
    // Dark grout behind the tiles
    const groutGeo = new THREE.PlaneGeometry(this.cols * TILE + 1, this.rows * TILE);
    const groutMat = new THREE.MeshStandardMaterial({ color: '#04230e', roughness: 0.9 });
    const grout = new THREE.Mesh(groutGeo, groutMat);
    grout.position.set(0, top - (this.rows * TILE) / 2, z - 0.09);
    world.add(grout);
    disposables.push(geo, mat, groutGeo, groutMat);
    this.lit = new Float32Array(count); // 0 = green … 1 = white
    this.animating = new Set();
    this._c = new THREE.Color();
  }

  /** Light the tile behind (x, y). */
  light(x, y) {
    const col = Math.round((x - this.x0) / TILE);
    const row = Math.floor((this.top - y) / TILE);
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return;
    const i = row * this.cols + col;
    if (this.lit[i] > 0 || this.animating.has(i)) return;
    this.animating.add(i);
  }

  update(dt) {
    if (!this.animating.size) return;
    for (const i of this.animating) {
      this.lit[i] = Math.min(1, this.lit[i] + dt / LIGHT_TIME);
      this._c.copy(this.base[i]).lerp(TILE_LIT, this.lit[i]);
      this.mesh.setColorAt(i, this._c);
      if (this.lit[i] >= 1) this.animating.delete(i);
    }
    this.mesh.instanceColor.needsUpdate = true;
  }

  reset() {
    this.lit.fill(0);
    this.animating.clear();
    for (let i = 0; i < this.base.length; i++) this.mesh.setColorAt(i, this.base[i]);
    this.mesh.instanceColor.needsUpdate = true;
  }
}

// ───────────────────────── side walls ─────────────────────────

export function buildSideWalls(world, disposables, { top, bottom, half, depth }) {
  const height = top - bottom;
  const tex = dropletTexture('#145f24', 3, 90).clone();
  tex.repeat.set(1, height / 2);
  tex.needsUpdate = true;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.1, envMapIntensity: 0.15 });
  const geo = new THREE.BoxGeometry(0.8, height, depth);
  // Thick enough to never be thinner than a pixel (thin lines flicker when the camera moves).
  const stripGeo = new THREE.BoxGeometry(0.12, height, 0.12);
  const strip = neonMat(0.3); // side walls: about the same glow as the shelf neon
  for (const s of [-1, 1]) {
    const side = new THREE.Mesh(geo, mat);
    side.position.set(s * (half + 0.4), (top + bottom) / 2, 0);
    side.receiveShadow = true;
    world.add(side);
    // Neon line on the inner front edge
    const inner = new THREE.Mesh(stripGeo, strip);
    inner.position.set(s * (half + 0.04), (top + bottom) / 2, depth / 2);
    world.add(inner);
  }
  disposables.push(tex, mat, geo, stripGeo, strip);
}

// ───────────────────────── shelves ─────────────────────────

export function shelfMaterials(disposables) {
  const capTex = dropletTexture('#3f7f4c', 11, 160).clone();
  capTex.repeat.set(2.5, 0.6);
  capTex.needsUpdate = true;
  const bodyTex = dropletTexture('#17602a', 5, 120).clone();
  bodyTex.repeat.set(3, 0.3);
  bodyTex.needsUpdate = true;
  const goalCanvas = (() => {
    const [c, g] = canvas(128, 128);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      g.fillStyle = (x + y) % 2 ? '#0d5a23' : '#f2f5f2';
      g.fillRect(x * 32, y * 32, 32, 32);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const m = {
    body: new THREE.MeshStandardMaterial({ map: bodyTex, roughness: 0.12, metalness: 0.5, envMapIntensity: 0.6 }),
    cap: new THREE.MeshStandardMaterial({ map: capTex, roughness: 0.06, metalness: 0.65, envMapIntensity: 0.9 }),
    moveCap: new THREE.MeshStandardMaterial({ map: capTex, color: '#d6ffd6', roughness: 0.08, metalness: 0.4, emissive: '#2bd93a', emissiveIntensity: 0.25 }),
    goalCap: new THREE.MeshStandardMaterial({ map: goalCanvas, roughness: 0.25, metalness: 0.2 }),
    neon: neonMat(0.5),
    neonSoft: neonMat(0.45), // below the bloom threshold: a clean line, no glow
    goalTex: goalCanvas,
  };
  disposables.push(m.body, m.cap, m.moveCap, m.goalCap, m.neon, m.neonSoft, goalCanvas, capTex, bodyTex);
  return m;
}

export function buildShelf(c, mats, disposables, { thick, depth }) {
  const w = c.x1 - c.x0;
  const g = new THREE.Group();
  const bodyGeo = new RoundedBoxGeometry(w, thick, depth, 2, 0.06);
  const body = new THREE.Mesh(bodyGeo, mats.body);
  body.position.y = -thick / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  const capGeo = new THREE.BoxGeometry(w - 0.08, 0.03, depth - 0.08);
  if (c.goal) mats.goalTex.repeat.set(w, 1);
  const cap = new THREE.Mesh(capGeo, c.goal ? mats.goalCap : c.move ? mats.moveCap : mats.cap);
  cap.position.y = 0.005;
  cap.receiveShadow = true;
  // Neon edges: bright line under the front edge, softer line on the top front edge
  const lowGeo = new THREE.BoxGeometry(w, 0.09, 0.09);
  const low = new THREE.Mesh(lowGeo, mats.neon);
  low.position.set(0, -thick + 0.045, depth / 2);
  const highGeo = new THREE.BoxGeometry(w, 0.045, 0.045);
  const high = new THREE.Mesh(highGeo, mats.neonSoft);
  high.position.set(0, 0.01, depth / 2 + 0.005);
  g.add(body, cap, low, high);
  g.position.set((c.x0 + c.x1) / 2, c.y, 0);
  disposables.push(bodyGeo, capGeo, lowGeo, highGeo);
  return g;
}

// ───────────────────────── signs ─────────────────────────

/** Metal plate with a neon border, corner bolts and slanted white text. */
export function plateTexture(text, { sub = '' } = {}) {
  const [c, g] = canvas(1024, 512);
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#1f8a34');
  grad.addColorStop(1, '#0c5420');
  // Glow + neon border
  g.shadowColor = 'rgba(125,255,61,0.9)';
  g.shadowBlur = 28;
  g.strokeStyle = '#a6ff6a';
  g.lineWidth = 10;
  g.fillStyle = grad;
  g.beginPath(); g.roundRect(26, 26, 972, 460, 46); g.fill(); g.stroke();
  g.shadowBlur = 0;
  // Droplets
  const r = rng(text.length * 31 + 7);
  for (let i = 0; i < 70; i++) {
    const x = 50 + r() * 924, y = 50 + r() * 412, s = 1 + r() * 4;
    g.fillStyle = 'rgba(230,255,235,0.35)';
    g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill();
  }
  // Bolts
  for (const [x, y] of [[64, 64], [960, 64], [64, 448], [960, 448]]) {
    const bg = g.createRadialGradient(x - 4, y - 4, 1, x, y, 12);
    bg.addColorStop(0, '#ffffff');
    bg.addColorStop(1, '#7c8a80');
    g.fillStyle = bg;
    g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.fill();
  }
  // Text (uppercase, slanted, white with a soft shadow)
  const lines = String(text).toUpperCase().split('\n');
  const size = lines.length > 2 ? 104 : lines.length === 2 ? 124 : 150;
  g.save();
  g.translate(512, sub ? 230 : 256);
  g.transform(1, 0, -0.16, 1, 0, 0);
  g.font = `700 ${size}px "FuturaCond", "Arial Narrow", "Arial Black", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,30,10,0.6)';
  g.shadowBlur = 10;
  g.shadowOffsetY = 6;
  g.fillStyle = '#ffffff';
  lines.forEach((line, i) => g.fillText(line, 0, (i - (lines.length - 1) / 2) * size * 1.0));
  g.restore();
  if (sub) {
    g.font = '700 40px "FuturaCond", "Arial Narrow", sans-serif';
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.fillText(sub.toUpperCase().split('').join(String.fromCharCode(8202)), 512, 430);
    g.fillRect(250, 425, 110, 4);
    g.fillRect(664, 425, 110, 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function buildSign(world, disposables, { x, y, z, w, h, text, sub }) {
  const tex = plateTexture(text, { sub });
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.25, metalness: 0.3 });
  const geo = new THREE.PlaneGeometry(w, h);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  world.add(m);
  disposables.push(tex, mat, geo);
}

/**
 * Brand logo on the wall, only if the official file is present. It goes into `layer`
 * (the overlay scene, drawn after ambient occlusion) so it stays crisp white.
 */
export function buildWallLogo(world, disposables, { x, y, z, w, layer = world }) {
  brandUrl('heineken-house-logo').then((src) => {
    if (!src || !world.parent) return; // no file, or the level was already unloaded
    new THREE.TextureLoader().load(src, (tex) => {
      if (!world.parent) return tex.dispose();
      // Drawn after tone mapping into a display-space buffer: keep the raw sRGB values.
      tex.colorSpace = THREE.NoColorSpace;
      tex.anisotropy = 8;
      const aspect = tex.image.width / tex.image.height || 2;
      const geo = new THREE.PlaneGeometry(w, w / aspect);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      layer.add(m);
      disposables.push(tex, mat, geo, { dispose: () => layer.remove(m) });
    });
  });
}

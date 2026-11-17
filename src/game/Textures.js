import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Procedural canvas textures (no image files). Cached ones are generated once. */
const cache = new Map();

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function finish(c, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

/** Dark wall with faint vertical lines (one repeat = 1.2 m). */
export function stripeTexture(base, line) {
  return cached(`stripe:${base}:${line}`, () => {
    const [c, g] = canvas(128, 128);
    g.fillStyle = base;
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = line;
    for (const [x, w, a] of [[6, 2, 0.5], [30, 1, 0.35], [52, 3, 0.25], [77, 1, 0.45], [98, 2, 0.3], [118, 1, 0.4]]) {
      g.globalAlpha = a;
      g.fillRect(x, 0, w, 128);
    }
    g.globalAlpha = 1;
    return finish(c);
  });
}

/** Rounded bathroom tile, one tile per texture repeat. */
export function tileTexture(base, grout) {
  return cached(`tile:${base}:${grout}`, () => {
    const [c, g] = canvas(128, 128);
    g.fillStyle = grout;
    g.fillRect(0, 0, 128, 128);
    const r = 18;
    const pad = 5;
    g.fillStyle = base;
    g.beginPath();
    g.roundRect(pad, pad, 128 - pad * 2, 128 - pad * 2, r);
    g.fill();
    const grad = g.createLinearGradient(0, 0, 128, 128);
    grad.addColorStop(0, 'rgba(255,255,255,0.45)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.05)');
    grad.addColorStop(1, 'rgba(0,0,0,0.06)');
    g.fillStyle = grad;
    g.beginPath();
    g.roundRect(pad, pad, 128 - pad * 2, 128 - pad * 2, r);
    g.fill();
    return finish(c);
  });
}

export function checkerTexture() {
  return cached('checker', () => {
    const [c, g] = canvas(128, 128);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      g.fillStyle = (x + y) % 2 ? '#222233' : '#ffffff';
      g.fillRect(x * 32, y * 32, 32, 32);
    }
    return finish(c, { aniso: 4 });
  });
}

/**
 * Drink trail texture: almost white (the material tints it green) with faint
 * perforation lines across the ribbon. U across width, V along length.
 */
export function stripTexture() {
  return cached('strip', () => {
    const [c, g] = canvas(128, 256);
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 128, 256);
    // Faint bubbles
    g.fillStyle = 'rgba(200,255,225,0.55)';
    for (let i = 0; i < 18; i++) {
      const x = 12 + ((i * 37) % 104), y = 10 + ((i * 71) % 236);
      g.beginPath(); g.arc(x, y, 2 + (i % 3), 0, Math.PI * 2); g.fill();
    }
    // Perforation line at the repeat boundary
    g.fillStyle = 'rgba(40,110,70,0.35)';
    for (let x = 2; x < 128; x += 9) g.fillRect(x, 0, 5, 3);
    // Soft edges
    const grad = g.createLinearGradient(0, 0, 128, 0);
    grad.addColorStop(0, 'rgba(160,210,180,0.7)');
    grad.addColorStop(0.1, 'rgba(255,255,255,0)');
    grad.addColorStop(0.9, 'rgba(255,255,255,0)');
    grad.addColorStop(1, 'rgba(160,210,180,0.7)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 256);
    return finish(c);
  });
}

/** Sign card with wrapped text (`\n` = new line). Not cached: disposed with the level. */
export function signTexture(text, { bg = '#0b3d1c', fg = '#ffffff', accent = '#3dff4a' } = {}) {
  const [c, g] = canvas(512, 256);
  g.fillStyle = accent;
  g.beginPath(); g.roundRect(0, 0, 512, 256, 36); g.fill();
  g.fillStyle = bg;
  g.beginPath(); g.roundRect(7, 7, 498, 242, 31); g.fill();
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const lines = String(text).toUpperCase().split('\n');
  const size = lines.length > 2 ? 52 : 62;
  g.font = `700 ${size}px "FuturaCond", "Arial Narrow", "Arial Black", sans-serif`;
  lines.forEach((line, i) => {
    g.fillText(line, 256, 128 + (i - (lines.length - 1) / 2) * size * 1.15);
  });
  return finish(c, { repeat: false });
}

let sawGeoCache = null;

/** 18-tooth saw blade (disc + cone teeth) in the X/Y plane, radius 1 (scale by r). */
export function sawGeometry() {
  if (sawGeoCache) return sawGeoCache;
  const parts = [];
  const disc = new THREE.CylinderGeometry(1, 1, 0.06, 48);
  disc.rotateX(Math.PI / 2);
  parts.push(disc);
  const teeth = 18;
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const tooth = new THREE.ConeGeometry(0.11, 0.22, 3);
    tooth.scale(1, 1, 0.5);
    tooth.translate(0, 1.05, 0);
    tooth.rotateZ(a + 0.25);
    parts.push(tooth);
  }
  sawGeoCache = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  parts.forEach((g) => g.dispose());
  return sawGeoCache;
}

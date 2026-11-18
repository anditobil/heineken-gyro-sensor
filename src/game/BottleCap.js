import * as THREE from 'three';
import { brandUrl } from '../ui/Brand.js';

/**
 * Spinning hazard: a real 3D crown cork (bottle cap), radius 1 (scale by the hazard radius).
 * Faces the camera (+Z) like the old saw blades:
 *  - top: slightly domed disc with the official print (public/brand/bottle-cap.*)
 *  - rim: rounded roll where the top meets the skirt
 *  - skirt: 21 crimped flutes flaring outward and backward (real geometry, not a picture)
 * The print only covers the flat top (up to the silver ring); the teeth are modelled.
 */

const TOP_R = 0.86; // flat printed area
const SKIRT_R = 1.0; // outer reach of the flutes
const SKIRT_DEPTH = 0.34;
const FLUTES = 21;
const IMG_TOP = 550 / 1254; // printed top radius / image size in the supplied file

let shared = null;

function build() {
  // ── domed top with planar UVs into the cap image ──
  const top = new THREE.CircleGeometry(TOP_R, 72);
  const pos = top.attributes.position;
  const uv = top.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const r = Math.hypot(x, y) / TOP_R;
    pos.setZ(i, 0.06 * (1 - r * r)); // gentle dome
    uv.setXY(i, 0.5 + (x / TOP_R) * IMG_TOP, 0.5 + (y / TOP_R) * IMG_TOP);
  }
  top.computeVertexNormals();

  // ── crimped skirt: rings from the top edge out/back to the flared lip ──
  const seg = FLUTES * 10, rows = 8;
  const verts = [], idx = [];
  for (let j = 0; j <= rows; j++) {
    const v = j / rows; // 0 = top edge, 1 = lip
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const flute = Math.cos(a * FLUTES); // −1 … 1
      const bulge = Math.sin(v * Math.PI) * 0.035; // rounded profile
      const r = TOP_R + (SKIRT_R - TOP_R) * Math.pow(v, 0.8) + bulge + flute * 0.05 * Math.pow(v, 0.9);
      const z = -SKIRT_DEPTH * v + flute * 0.03 * v;
      verts.push(Math.cos(a) * r, Math.sin(a) * r, z);
    }
  }
  const row = seg + 1;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * row + i, b = a + row;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const skirt = new THREE.BufferGeometry();
  skirt.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  skirt.setIndex(idx);
  skirt.computeVertexNormals();

  // ── rolled rim between print and skirt ──
  const rim = new THREE.TorusGeometry(TOP_R, 0.035, 10, 96);

  // ── materials ──
  const topMat = new THREE.MeshStandardMaterial({ color: 0x1f8a34, metalness: 0.35, roughness: 0.32 });
  const skirtMat = new THREE.MeshStandardMaterial({ color: 0x1b8a2c, metalness: 0.6, roughness: 0.26, side: THREE.DoubleSide });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xd9dee4, metalness: 0.85, roughness: 0.2 });

  brandUrl('bottle-cap').then((src) => {
    if (!src) return; // no file: plain green top (no logo drawn in code)
    new THREE.TextureLoader().load(src, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      topMat.map = t;
      topMat.color.set(0xffffff);
      topMat.needsUpdate = true;
    });
  });

  return { top, skirt, rim, topMat, skirtMat, rimMat };
}

/** One cap (Group). Geometry/materials are shared by all caps. */
export function createBottleCap() {
  shared ||= build();
  const g = new THREE.Group();
  const top = new THREE.Mesh(shared.top, shared.topMat);
  top.position.z = 0.012;
  const rim = new THREE.Mesh(shared.rim, shared.rimMat);
  rim.position.z = 0.0;
  const skirt = new THREE.Mesh(shared.skirt, shared.skirtMat);
  g.add(top, rim, skirt);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

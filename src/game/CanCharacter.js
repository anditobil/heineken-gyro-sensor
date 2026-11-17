import * as THREE from 'three';
import { brandUrl } from '../ui/Brand.js';

export const CAN_R = 0.46;
const CAN_L = 1.15;
export const CAN_GREEN = '#19b35a';

/**
 * Generic wrap-around label (no brand marks): glossy green with silver bands and droplets.
 * The official label replaces it when public/brand/can-label.(svg|png) exists.
 */
function labelTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 384;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, '#0b5a22');
  grad.addColorStop(0.5, '#1f9a3c');
  grad.addColorStop(1, '#0b5a22');
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  // Silver bands near both ends
  g.fillStyle = 'rgba(235,240,245,0.95)';
  g.fillRect(0, 22, c.width, 14);
  g.fillRect(0, c.height - 36, c.width, 14);
  // Two light ovals on opposite sides so the roll is readable
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 10;
  for (const x of [c.width * 0.25, c.width * 0.75]) {
    g.beginPath(); g.ellipse(x, c.height / 2, 150, 104, 0, 0, Math.PI * 2); g.stroke();
  }
  // Condensation droplets
  let seed = 9;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 220; i++) {
    const x = r() * c.width, y = 40 + r() * (c.height - 80), s = 1 + r() * r() * 6;
    g.fillStyle = 'rgba(230,255,235,0.45)';
    g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath(); g.arc(x - s * 0.3, y - s * 0.3, Math.max(0.6, s * 0.35), 0, Math.PI * 2); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Generic aluminium lid (faces the camera). Official art: public/brand/can-lid.(svg|png). */
function lidTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const m = 256;
  const grad = g.createRadialGradient(m - 70, m - 90, 20, m, m, m);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.6, '#c9d1da');
  grad.addColorStop(1, '#8e98a4');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = 'rgba(90,100,112,0.6)';
  g.lineWidth = 8;
  for (const rr of [m - 30, m - 70]) {
    g.beginPath(); g.arc(m, m, rr, 0, Math.PI * 2); g.stroke();
  }
  g.lineWidth = 34;
  g.strokeStyle = '#1f9a3c';
  g.beginPath(); g.arc(m, m, m - 10, 0, Math.PI * 2); g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Swap in an official texture from public/brand/ when it exists. */
function useBrandTexture(name, material, setup) {
  brandUrl(name).then((src) => {
    if (!src) return;
    new THREE.TextureLoader().load(src, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      setup?.(t);
      const old = material.map;
      material.map = t;
      material.needsUpdate = true;
      old?.dispose();
    });
  });
}

/**
 * Player character: a green drink can lying on its side and rolling along X.
 * The can axis points toward the camera, so the lid faces the viewer.
 */
export class CanCharacter {
  constructor(parent) {
    this.group = new THREE.Group(); // positioned at the can centre
    this.tilt = new THREE.Group(); // yaw so the label is visible
    this.tilt.rotation.y = 0; // straight: axis perpendicular to the wall, lid faces the camera
    this.spin = new THREE.Group(); // rolling rotation around the can axis (local Z)
    this.group.add(this.tilt);
    this.tilt.add(this.spin);
    parent.add(this.group);

    this.tex = labelTexture();
    this.lidTex = lidTexture();
    const metal = new THREE.MeshStandardMaterial({ color: 0xeef1f6, metalness: 0.85, roughness: 0.22 });
    const label = new THREE.MeshStandardMaterial({ map: this.tex, metalness: 0.55, roughness: 0.25, emissive: 0x06301a, emissiveIntensity: 0.25 });
    // Official label: keep its proportions instead of stretching it once around the can.
    // It covers the part of the circumference that matches its aspect; the rest repeats
    // the label's green edge (clamped).
    useBrandTexture('can-label', label, (t) => {
      const circumference = 2 * Math.PI * CAN_R;
      const height = CAN_L * 0.82;
      const span = Math.min(1, ((t.image.width / t.image.height) * height) / circumference);
      t.wrapS = THREE.ClampToEdgeWrapping;
      t.repeat.set(1 / span, 1);
      t.offset.set(-(1 / span - 1) / 2, 0);
      label.color.set(0xffffff);
      label.emissiveIntensity = 0.12;
    });
    const dark = new THREE.MeshStandardMaterial({ color: 0xc9d0da, metalness: 0.8, roughness: 0.3 });
    this.mats = [metal, label, dark];

    const body = new THREE.Mesh(new THREE.CylinderGeometry(CAN_R, CAN_R, CAN_L * 0.82, 40, 1, true), label);
    // Tapered necks + rims at both ends
    const neckGeo = new THREE.CylinderGeometry(CAN_R * 0.86, CAN_R, CAN_L * 0.08, 40, 1, true);
    const neckTop = new THREE.Mesh(neckGeo, metal);
    neckTop.position.y = CAN_L * 0.45;
    const neckBot = new THREE.Mesh(neckGeo, metal);
    neckBot.position.y = -CAN_L * 0.45;
    neckBot.rotation.z = Math.PI;
    const rimGeo = new THREE.TorusGeometry(CAN_R * 0.86, 0.025, 8, 40);
    const rimTop = new THREE.Mesh(rimGeo, metal);
    rimTop.rotation.x = Math.PI / 2;
    rimTop.position.y = CAN_L * 0.49;
    const rimBot = rimTop.clone();
    rimBot.position.y = -CAN_L * 0.49;
    const lidGeo = new THREE.CircleGeometry(CAN_R * 0.86, 40);
    const lidMat = new THREE.MeshStandardMaterial({ map: this.lidTex, metalness: 0.6, roughness: 0.25, emissive: 0x30343c, emissiveIntensity: 0.15 });
    useBrandTexture('can-lid', lidMat);
    this.mats.push(lidMat);
    const lidTop = new THREE.Mesh(lidGeo, lidMat);
    lidTop.rotation.x = -Math.PI / 2;
    lidTop.position.y = CAN_L * 0.485;
    const lidBot = new THREE.Mesh(lidGeo, dark);
    lidBot.rotation.x = Math.PI / 2;
    lidBot.position.y = -CAN_L * 0.485;
    // Pull tab on the lid
    const tab = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.025, 6, 16), metal);
    tab.rotation.x = Math.PI / 2;
    tab.position.set(0, CAN_L * 0.495, -0.1);
    const opening = new THREE.Mesh(new THREE.CircleGeometry(0.07, 16), new THREE.MeshBasicMaterial({ color: 0x1b1b24 }));
    opening.rotation.x = -Math.PI / 2;
    opening.position.set(0, CAN_L * 0.49, -0.24);
    this.mats.push(opening.material);

    const can = new THREE.Group();
    can.add(body, neckTop, neckBot, rimTop, rimBot, lidTop, lidBot, tab, opening);
    can.rotation.x = Math.PI / 2; // axis along Z (toward the camera), lid with tab faces the viewer
    can.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    this.spin.add(can);
    this.can = can;

    this.squash = 0;
    this.hitFlash = 0;
  }

  setVisible(v) {
    this.group.visible = v;
  }

  onLand(impact) {
    this.squash = Math.min(0.25, impact * 0.03);
  }

  onHit() {
    this.hitFlash = 1;
  }

  /** x, y = can centre (parent space), vx = rolling speed along +X. */
  update(dt, x, y, vx, invulnerable) {
    this.group.position.set(x, y, 0);
    // Roll: moving right (+X) spins clockwise as seen from the camera (−Z rotation).
    this.spin.rotation.z -= (vx * dt) / CAN_R;
    // Land squash (vertical) with a quick recovery
    this.squash = Math.max(0, this.squash - dt * 1.6);
    const s = this.squash;
    this.group.scale.set(1 + s * 0.6, 1 - s, 1 + s * 0.6);
    // Hit wobble + blink while invulnerable
    this.hitFlash = Math.max(0, this.hitFlash - dt * 2);
    this.tilt.rotation.z = Math.sin(this.hitFlash * 30) * this.hitFlash * 0.3;
    this.group.visible = !(invulnerable > 0 && Math.floor(invulnerable * 12) % 2 === 0);
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.group.traverse((o) => o.geometry?.dispose());
    this.mats.forEach((m) => m.dispose());
    this.tex.dispose();
    this.lidTex.dispose();
  }
}

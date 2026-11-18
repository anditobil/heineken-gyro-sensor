import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DROP_LEVELS, SHAFT_WIDTH } from './dropLevels.js';
import { Strip } from './Strip.js';
import { SheetParticles } from './SheetParticles.js';
import { stripTexture } from './Textures.js';
import { createBottleCap } from './BottleCap.js';
import { TileWall, buildSideWalls, shelfMaterials, buildShelf, buildWallLogo } from './ShaftDecor.js';
import { HOUSE_THEME } from './theme.js';
import { approach, clamp } from '../core/MathUtils.js';
import { CanCharacter, CAN_R } from './CanCharacter.js';
import { Stars } from './Stars.js';
import { Drips } from './Drips.js';
import { Puddles } from './Puddles.js';

const GRAVITY = 22;
const MAX_FALL = 18;
const SHELF_THICK = 0.35;
const SHELF_DEPTH = 1.8;
const SPACING = 0.12;
const HALF = SHAFT_WIDTH / 2;
export const DROP_SPEED_FACTOR = 0.7; // CAN DROP uses movement.maxSpeed × 0.7

/**
 * CAN DROP world + simulation.
 * A front view of a tower shaft: the player rolls the can left/right, gravity drops it
 * through the gaps, saws are in the way, the goal shelf is at the bottom. A green drink
 * trail is laid along the exact path (also hanging down every drop); rolling back over
 * it winds it up again (refund). Physics is 2D (X/Y) in shaft coordinates, drawn at z = 0.
 */
export class DropMode {
  constructor(scene, settings) {
    this.scene = scene;
    this.settings = settings;
    // Single-level game: only "Saw Tower" (level 2) is played; levels 1 and 3 stay in the data file.
    this.levels = DROP_LEVELS.slice(1, 2); // level 2 "Saw Tower" (use slice(0, 1) for level 1)
    // Lives replace the drink as the fail condition: the trail is visual only and never runs out.
    this.drinkLimited = false;
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);

    this.world = null;
    this.disposables = [];
    this.shelves = [];
    this.saws = [];
    this.cfg = null;
    this.index = 0;
    this.time = 0;
    this.goalY = 0;

    const tex = stripTexture();
    this.paperMat = new THREE.MeshStandardMaterial({
      map: tex, color: 0x5cf0a4, emissive: 0x12a050, emissiveIntensity: 0.35, side: THREE.DoubleSide, roughness: 0.6,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.tornMat = this.paperMat.clone();
    this.tornMat.color.set(0x1f9a57);
    this.tornMat.emissiveIntensity = 0.1;
    // The trail is now shown by the wall tiles lighting up; the ribbon is kept for the
    // drink/refund logic but not drawn.
    this.paperMat.visible = false;
    this.tornMat.visible = false;
    // Splash = water droplets
    // Water droplets: clear, glossy, slightly blue (env reflections give the sparkle)
    this.sheetMat = new THREE.MeshStandardMaterial({ color: 0xd8f4ff, emissive: 0x6fcfff, emissiveIntensity: 0.25, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.78, envMapIntensity: 1.4 });
    this.sawMat = new THREE.MeshStandardMaterial({ color: 0xe9eef5, metalness: 0.75, roughness: 0.18, emissive: 0x9aa6b8, emissiveIntensity: 0.15 });
    this.hubMat = new THREE.MeshStandardMaterial({ color: 0xff4d6d, roughness: 0.45 });
    this.railMat = new THREE.MeshStandardMaterial({ color: 0x6b6b8a, roughness: 0.6 });

    this.strips = [];
    this.active = null;
    this.sheets = new SheetParticles(this.root, this.sheetMat);
    this.can = new CanCharacter(this.root); // the player character (green can)
    this.events = { hit: null, finished: false, star: null };
    this.stars = new Stars();
    this.drips = new Drips(this.root); // fridge condensation (visual only)
    this.puddles = new Puddles(this.root); // water pooling on the shelves
    this.drips.onLand = (shelf, x, z) => this.puddles.splash(shelf, x, z);
    this.worldPos = new THREE.Vector3();
    this.reset();
  }

  get count() { return this.levels.length; }
  get current() { return this.cfg; }
  get length() { return this.cfg ? this.cfg.start.y - this.goalY : 1; }
  get progress() { return this.cfg ? clamp(this.cfg.start.y - this.y, 0, this.length) : 0; }
  get maxSpeed() { return this.settings.get('movement').maxSpeed * DROP_SPEED_FACTOR; }

  // ───────────────────────── level building ─────────────────────────

  load(index) {
    return this.loadConfig(this.levels[index], index);
  }

  /** Builds any level config (also the tutorial board, which is not in `levels`). */
  loadConfig(cfg, index = -1) {
    this.unload();
    this.index = index;
    this.cfg = cfg;
    this.world = new THREE.Group();
    this.root.add(this.world);
    this.root.visible = true;
    const th = HOUSE_THEME; // Sync Challenge look for every level
    this.theme = th;

    const goals = cfg.shelves.filter((s) => s.goal);
    this.goalY = Math.min(...(goals.length ? goals : cfg.shelves).map((s) => s.y));
    const top = 9;
    const bottom = cfg.wallBottom ?? this.goalY - 8;
    const height = top - bottom;

    // Back wall of glossy green tiles (they light up white along the path = the trail)
    const wallZ = -SHELF_DEPTH / 2 - 0.4;
    this.tiles = new TileWall(this.world, this.disposables, { top, bottom, z: wallZ + 0.08, halfWidth: HALF });
    buildSideWalls(this.world, this.disposables, { top, bottom, half: HALF, depth: SHELF_DEPTH + 1.6 });
    // Brand logo on the wall (gameplay). The tutorial box already shows the logo as an overlay.
    if (cfg.wallLogo !== false) buildWallLogo(this.world, this.disposables, { x: -2.6, y: 3.9, z: wallZ + 0.2, w: 3.6, layer: this.overlay || this.world });

    // Wet glass shelves with neon edges
    const shelfMats = shelfMaterials(this.disposables);
    for (const c of cfg.shelves) {
      const g = buildShelf(c, shelfMats, this.disposables, { thick: SHELF_THICK, depth: SHELF_DEPTH });
      this.world.add(g);
      this.shelves.push({ ...c, off: 0, velX: 0, mesh: g });
    }

    // Collectible stars (level data `stars`)
    this.stars.build(this, cfg.stars);
    // Wet shelves from the start
    this.puddles.seed(this.shelves, SHELF_DEPTH);

    // Hazards: spinning 3D bottle caps (were saw blades) + rails on the back wall
    for (const c of cfg.saws) {
      const g = new THREE.Group();
      // A slight tilt shows the cap's crimped skirt, so it reads as a 3D object.
      const tilt = new THREE.Group();
      tilt.rotation.set(0.32, -0.28, 0);
      const blade = createBottleCap(); // spins around its own axis (local Z)
      blade.scale.setScalar(c.r);
      tilt.add(blade);
      g.add(tilt);
      g.position.set(c.x, c.y, 0);
      this.world.add(g);
      const railZ = -SHELF_DEPTH / 2 - 0.18; // in front of the wall tiles
      if (c.type === 'line') {
        const len = Math.hypot(c.x2 - c.x, c.y2 - c.y);
        const railGeo = new THREE.CapsuleGeometry(0.07, len, 4, 8);
        const rail = new THREE.Mesh(railGeo, this.railMat);
        rail.position.set((c.x + c.x2) / 2, (c.y + c.y2) / 2, railZ);
        rail.rotation.z = -Math.atan2(c.x2 - c.x, c.y2 - c.y);
        this.world.add(rail);
        this.disposables.push(railGeo);
      } else if (c.type === 'orbit') {
        const ringGeo = new THREE.TorusGeometry(c.radius, 0.07, 8, 48);
        const ring = new THREE.Mesh(ringGeo, this.railMat);
        ring.position.set(c.x, c.y, railZ);
        this.world.add(ring);
        this.disposables.push(ringGeo);
      } else {
        const boltGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.6, 10).rotateX(Math.PI / 2);
        const bolt = new THREE.Mesh(boltGeo, this.railMat);
        bolt.position.set(c.x, c.y, railZ + 0.2);
        this.world.add(bolt);
        this.disposables.push(boltGeo);
      }
      this.saws.push({ ...c, cx: c.x, cy: c.y, mesh: g, blade });
    }

    // No text signs on the wall (level signs and the GOAL banner are switched off on request).
    // To bring them back: buildSign(this.world, this.disposables, { x, y, z: wallZ + 0.3, w: 2.9, h: 1.45, text }).

    this.time = 0;
    this.reset();
    return cfg;
  }

  unload() {
    if (this.world) {
      this.root.remove(this.world);
      for (const d of this.disposables) d.dispose();
    }
    this.disposables = [];
    this.world = null;
    this.tiles = null;
    this.shelves = [];
    this.saws = [];
    for (const s of this.strips) s.clear();
    this.sheets.clear();
    this.root.visible = false;
  }

  // ───────────────────────── run state ─────────────────────────

  reset() {
    const cfg = this.cfg;
    this.total = cfg ? cfg.paper : 100;
    this.remaining = this.total;
    this.lost = 0;
    this.r = CAN_R;
    this.x = cfg ? cfg.start.x : 0;
    this.y = (cfg ? cfg.start.y : 0) + this.r;
    this.vx = 0;
    this.vy = 0;
    this.grounded = true;
    this.groundY = cfg ? cfg.start.y : 0;
    this.groundShelf = null;
    this.invulnerable = 0;
    this.slowTimer = 0;
    this.landImpact = 0;
    this.justLanded = false;
    this.unrollRate = 0;
    this._layDelay = 0;
    this._empty = false;
    this.tiles?.reset();
    this.stars.reset();
    this.drips?.clear();
    for (const s of this.strips) {
      s.clear();
      s.mesh.material = this.paperMat;
    }
    this.sheets.clear();
    this.active = null;
    if (cfg) {
      this.active = this._takeStrip();
      // Trail end taped to the top shelf, 0.9 behind the start.
      this.active.push(this.x - 0.9, this.groundY + 0.012, 0);
    }
  }

  _takeStrip() {
    const length = this.drinkLimited ? this.total : Math.max(this.total, 400);
    const capacity = Math.ceil((length / SPACING) * 1.3) + 64;
    let strip = this.strips.find((s) => s.count === 0 && s !== this.active);
    if (!strip) {
      if (this.strips.length < 8) {
        strip = new Strip(this.root, this.paperMat, capacity, true);
        this.strips.push(strip);
      } else {
        strip = this.strips.shift(); // recycle the oldest
        this.strips.push(strip);
        strip.clear();
      }
    }
    strip.allocate(capacity);
    strip.mesh.material = this.paperMat;
    return strip;
  }

  loseChunk(amount) {
    if (!this.drinkLimited) return false;
    const a = Math.min(amount, this.remaining);
    this.remaining -= a;
    this.lost += a;
    if (this.remaining <= 0) this._empty = true;
    return this._empty;
  }

  get empty() { return this._empty; }

  // ───────────────────────── simulation ─────────────────────────

  /**
   * One fixed physics step.
   * @param move   −1..1 (right = +)
   * @param active false → no input (countdown, menu backdrop, result screen)
   */
  step(dt, move, active) {
    const ev = this.events;
    ev.hit = null;
    ev.finished = false;
    ev.star = null;
    this.justLanded = false;
    if (!this.cfg) return ev;
    this.time += dt;
    const t = this.time;

    // Moving shelves
    for (const s of this.shelves) {
      if (!s.move) continue;
      const prev = s.off;
      s.off = Math.sin(t * s.move.speed + (s.move.phase || 0)) * s.move.amp;
      s.velX = (s.off - prev) / dt;
      s.mesh.position.x = (s.x0 + s.x1) / 2 + s.off;
    }
    // Saws
    for (const s of this.saws) {
      if (s.type === 'line') {
        const k = 0.5 - 0.5 * Math.cos(t * s.speed + (s.phase || 0));
        s.cx = s.x + (s.x2 - s.x) * k;
        s.cy = s.y + (s.y2 - s.y) * k;
      } else if (s.type === 'orbit') {
        const a = t * s.speed + (s.phase || 0);
        s.cx = s.x + Math.cos(a) * s.radius;
        s.cy = s.y + Math.sin(a) * s.radius;
      }
      s.mesh.position.set(s.cx, s.cy, 0);
    }

    // Horizontal movement
    if (!active) move = 0;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.slowTimer = Math.max(0, this.slowTimer - dt);
    const mv = this.settings.get('movement');
    const maxSpeed = mv.maxSpeed * DROP_SPEED_FACTOR * (this.slowTimer > 0 ? 0.5 : 1);
    const m = clamp(move, -1, 1);
    if (Math.abs(m) > 0.01) {
      const target = m * maxSpeed;
      const opposing = Math.sign(target) !== Math.sign(this.vx) && Math.abs(this.vx) > 0.2;
      const acc = (this.grounded ? mv.acceleration : mv.acceleration * 0.45) * (opposing ? 1.8 : 1);
      this.vx = approach(this.vx, target, acc * dt);
    } else {
      this.vx = approach(this.vx, 0, (this.grounded ? mv.friction * 1.2 : 0.8) * dt);
    }
    if (this.grounded && this.groundShelf?.move) this.x += this.groundShelf.velX * dt;

    // Vertical
    const wasGrounded = this.grounded;
    this.vy = Math.max(this.vy - GRAVITY * dt, -MAX_FALL);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this._collide();
    if (this.grounded && !wasGrounded && this.landImpact > 3) {
      this.justLanded = true;
      this.can.onLand(this.landImpact);
    }

    // Saw hits
    if (this.invulnerable <= 0) {
      for (const s of this.saws) {
        const dx = this.x - s.cx, dy = this.y - s.cy;
        const rr = this.r * 0.95 + s.r * 0.88;
        if (dx * dx + dy * dy < rr * rr) {
          this._hit(s, dx, dy);
          ev.hit = s;
          break;
        }
      }
    }

    this._layPaper(dt);
    if (active) {
      this.tiles?.light(this.x, this.y);
      ev.star = this.stars.check(this);
    }

    if (this.grounded && this.groundShelf?.goal && !this._empty) ev.finished = true;
    return ev;
  }

  _collide() {
    this.grounded = false;
    this.groundShelf = null;
    const r = this.r;
    for (const s of this.shelves) {
      const minX = s.x0 + s.off, maxX = s.x1 + s.off;
      const maxY = s.y, minY = s.y - SHELF_THICK;
      const qx = clamp(this.x, minX, maxX);
      const qy = clamp(this.y, minY, maxY);
      const dx = this.x - qx, dy = this.y - qy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      let d = Math.sqrt(d2), nx, ny;
      if (d < 1e-6) { nx = 0; ny = 1; d = 0; } else { nx = dx / d; ny = dy / d; }
      const pen = r - d;
      this.x += nx * pen;
      this.y += ny * pen;
      const vn = this.vx * nx + this.vy * ny;
      if (vn < 0) {
        if (ny > 0.6) this.landImpact = -vn;
        this.vx -= vn * nx;
        this.vy -= vn * ny;
      }
      if (ny > 0.6) {
        this.grounded = true;
        this.groundShelf = s;
        this.groundY = maxY;
      }
    }
    if (this.x < -HALF + r) { this.x = -HALF + r; if (this.vx < 0) this.vx = 0; }
    if (this.x > HALF - r) { this.x = HALF - r; if (this.vx > 0) this.vx = 0; }
  }

  _hit(saw, dx, dy) {
    const d = Math.hypot(dx, dy) || 1;
    this.vx = (dx / d) * 7;
    this.vy = Math.max((dy / d) * 7, 4);
    this.grounded = false;
    this.invulnerable = 1.2;
    this.slowTimer = 0.8;
    this.loseChunk(this.cfg.hitLoss);
    // Tear: the old strip stays (dark green), a new loose end starts after 0.4 s.
    if (this.active && this.active.count > 1) this.active.mesh.material = this.tornMat;
    this.active = this._takeStrip();
    this._layDelay = 0.4;
    this.sheets.burst(this.x, this.y, 0.4, 18, 6); // water splash
    this.can.onHit();
  }

  _layPaper(dt) {
    let laid = 0;
    this._layDelay = Math.max(0, this._layDelay - dt);
    const strip = this.active;
    if (strip && !this._empty && this._layDelay <= 0) {
      const cx = this.x;
      const cy = this.grounded ? this.groundY + 0.012 : this.y - this.r * 0.9;
      if (strip.count === 0) {
        strip.push(cx, cy, 0);
      } else {
        // Rolling back over the trail winds it up again (refund): grounded, on a flat run
        // (same height), and closer to the previous point than to the last one.
        // Checked BEFORE laying, so a fast can (0.055 m per step at full speed) cannot
        // skip past the refund window and lay new trail on top of the old one.
        let refunded = false;
        if (this.grounded) {
          while (strip.count >= 2) {
            const li = strip.lastIndex();
            const lx = strip.px[li], ly = strip.py[li];
            const px = strip.px[li - 1], py = strip.py[li - 1];
            if (Math.abs(ly - py) > 0.05 || Math.abs(cy - ly) > 0.1) break;
            const dLast = Math.hypot(cx - lx, cy - ly);
            const dPrev = Math.hypot(cx - px, cy - py);
            if (dPrev >= dLast - 0.02) break;
            this.remaining = Math.min(this.total, this.remaining + strip.pop());
            refunded = true;
          }
        }
        const li = strip.lastIndex();
        const d = Math.hypot(cx - strip.px[li], cy - strip.py[li]);
        if (!refunded && d >= SPACING) {
          const used = strip.push(cx, cy, 0);
          this.remaining -= used;
          laid += used;
        }
      }
    }
    if (this.drinkLimited && this.remaining <= 0 && !this._empty) {
      this.remaining = 0;
      this._empty = true;
    }
    this.unrollRate += (laid / dt - this.unrollRate) * Math.min(1, dt * 8);
  }

  /** Per-frame visuals; returns the can's world position. */
  update(dt) {
    for (const s of this.saws) s.blade.rotation.z -= dt * 1.2; // slow spin: the print stays readable
    this.sheets.update(dt, this.time);
    this.tiles?.update(dt);
    this.stars.animate(dt);
    this.puddles.update(dt);
    this.drips.update(dt, this, { wallZ: -SHELF_DEPTH / 2 - 0.4, half: HALF, depth: SHELF_DEPTH, thick: SHELF_THICK });
    this.can.update(dt, this.x, this.y, this.vx, this.invulnerable);
    this.worldPos.set(this.x, this.y, 0);
    return this.worldPos;
  }
}

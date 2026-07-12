// The Reed Skiff afloat: boat entities on the water of the Upturn. A skiff
// is a real little thing in the world — buoyancy eases it up to the surface
// line where it bobs, a boarded Wanderling paddles it camera-relative with a
// watery glide, driving it up a bank leaves it crawling ashore, and two firm
// kicks fold it back into the satchel item. Persisted like the kilns:
// an additive save field of positions + headings.

import * as THREE from "three";
import { BLOCKS, BOAT, WATER } from "./blocks.js";
import { mulberry32 } from "./noise.js";
import { HEIGHT } from "./world.js";

const MAX_BOATS = 8;       // deployed skiffs at once (the shore gets crowded)
const HALF_W = 0.6;        // hull collision half-width
const HULL_H = 0.55;       // hull collision height
const DRAFT = 0.3;         // how deep the hull sits below the surface line
const SEAT_Y = 0.32;       // rider feet above the hull bottom
const WATER_SPEED = 6.5;   // top paddling speed afloat (blocks/s)
const LAND_SPEED = 0.8;    // the ashore crawl
const THRUST_WATER = 0.9;  // 1/s approach toward the wanted velocity (inertia)
const DRAG_WATER = 0.45;   // 1/s glide decay with no paddle in the water
const THRUST_LAND = 3.0;
const DRAG_LAND = 6.0;
const YAW_EASE = 5.0;      // 1/s: the hull swings its bow toward travel
const MAX_STEP = 0.4;      // max movement per collision substep
const STEP_UP = 0.45;      // max ledge the hull rides up when driven ashore
const GRAVITY = 18;        // a beached skiff settles gently
const KICKS_TO_BREAK = 2;

// --- the procedural hull -------------------------------------------------------

function paintWood(seed, base, variance, lash) {
  const canvas = document.createElement("canvas");
  canvas.width = 16; canvas.height = 16;
  const ctx = canvas.getContext("2d");
  const rand = mulberry32(seed);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = (rand() * 2 - 1) * variance;
    const seam = y % 5 === 4 ? -18 : 0; // lapped plank courses
    ctx.fillStyle = `rgb(${base[0] + d + seam},${base[1] + d + seam},${base[2] + d + seam})`;
    ctx.fillRect(x, y, 1, 1);
  }
  if (lash) { // reed lashings cinched across the planking
    for (const lx of [3, 8, 13]) {
      for (let y = 0; y < 16; y++) {
        const strand = (y + lx) % 2 === 0 ? 14 : -10;
        ctx.fillStyle = `rgb(${168 + strand},${146 + strand},${100 + strand})`;
        if (rand() < 0.85) ctx.fillRect(lx, y, 1, 1);
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Boats {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.boats = [];
    this.onDrop = opts.onDrop;   // (x, y, z, id) => item drop
    this.onHit = opts.onHit;     // () => kick-thud sfx
    this.onBreak = opts.onBreak; // () => break sfx

    // shared materials, tinted by the day/night cycle like mob skins
    this._materials = [];
    const mat = (tex) => {
      const m = new THREE.MeshBasicMaterial({ map: tex });
      this._materials.push(m);
      return m;
    };
    this._hullMat = mat(paintWood(0xb0a7, [166, 134, 80], 8, true));
    this._trimMat = mat(paintWood(0xb0a8, [198, 160, 64], 7, false));
    this._darkMat = mat(paintWood(0xb0a9, [118, 92, 54], 8, false));
  }

  setLight(level, tint) {
    for (const m of this._materials) {
      m.color.copy(tint).multiplyScalar(Math.min(1, level + 0.15));
    }
  }

  canDeploy() { return this.boats.length < MAX_BOATS; }

  // hull bottom at local y=0; long axis on z (bow toward +z, like mob yaw)
  _buildHull() {
    const g = new THREE.Group();
    const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    const bottom = box(0.95, 0.18, 1.62, this._hullMat);
    bottom.position.set(0, 0.09, 0);
    g.add(bottom);
    for (const side of [-1, 1]) { // side walls
      const wall = box(0.14, 0.32, 1.46, this._hullMat);
      wall.position.set(side * 0.42, 0.34, 0);
      g.add(wall);
      // the two gunwale rails, mustard trim along the sheer line
      const rail = box(0.18, 0.09, 1.7, this._trimMat);
      rail.position.set(side * 0.42, 0.54, 0);
      g.add(rail);
    }
    for (const end of [-1, 1]) { // bow + stern transoms
      const transom = box(0.78, 0.32, 0.16, this._darkMat);
      transom.position.set(0, 0.34, end * 0.76);
      g.add(transom);
    }
    const bench = box(0.68, 0.08, 0.3, this._darkMat); // the rower's bench
    bench.position.set(0, 0.32, -0.18);
    g.add(bench);
    return g;
  }

  deploy(x, y, z, yaw = 0) {
    if (!this.canDeploy()) return null;
    const mesh = this._buildHull();
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    this.scene.add(mesh);
    const b = {
      x, y, z, yaw, // y is the hull BOTTOM
      vx: 0, vy: 0, vz: 0,
      hits: 0, hurtT: 0, age: Math.random() * 6,
      inWater: false, mesh,
    };
    this.boats.push(b);
    return b;
  }

  // the surface line above a floating hull: the top face of the highest
  // water cell in this column, or null when the hull isn't in water at all
  _surfaceY(world, b) {
    const bx = Math.floor(b.x), bz = Math.floor(b.z);
    let cy = Math.floor(b.y + DRAFT * 0.5);
    if (world.getBlock(bx, cy, bz) !== WATER) {
      cy = Math.floor(b.y); // a hull settling from above samples its bottom
      if (world.getBlock(bx, cy, bz) !== WATER) return null;
    }
    while (cy + 1 < HEIGHT && world.getBlock(bx, cy + 1, bz) === WATER) cy++;
    return cy + 1;
  }

  update(dt, world, player) {
    for (let i = this.boats.length - 1; i >= 0; i--) {
      const b = this.boats[i];
      // frozen while its chunk is missing (like the primed kegs)
      if (!world.isGenerated(Math.floor(b.x) >> 4, Math.floor(b.z) >> 4)) continue;
      b.age += dt;
      b.hurtT = Math.max(0, b.hurtT - dt);
      const ridden = player.riding === b && !player.dead;

      const surface = this._surfaceY(world, b);
      b.inWater = surface !== null;

      // --- rider input: Sneak steps ashore, WASD paddles camera-relative ---
      let ax = 0, az = 0, hasInput = false;
      if (ridden) {
        if (player.keys.has("ShiftLeft") || player.keys.has("ShiftRight")) {
          this._dismount(world, player, b);
        } else {
          const f = (player.keys.has("KeyW") ? 1 : 0) - (player.keys.has("KeyS") ? 1 : 0);
          const s = (player.keys.has("KeyD") ? 1 : 0) - (player.keys.has("KeyA") ? 1 : 0);
          if (f !== 0 || s !== 0) {
            const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
            ax = -sin * f + cos * s;
            az = -cos * f - sin * s;
            const len = Math.hypot(ax, az);
            ax /= len; az /= len;
            hasInput = true;
          }
        }
      }

      // --- horizontal glide: thrust toward the wanted velocity, watery drag ---
      const speedCap = b.inWater ? WATER_SPEED : LAND_SPEED;
      const rate = b.inWater
        ? (hasInput ? THRUST_WATER : DRAG_WATER)
        : (hasInput ? THRUST_LAND : DRAG_LAND);
      const k = Math.min(1, rate * dt);
      b.vx += (ax * speedCap - b.vx) * k;
      b.vz += (az * speedCap - b.vz) * k;

      // --- vertical: buoyancy eases the hull to the surface line; gravity
      // otherwise, until something solid catches it ---
      if (b.inWater) {
        b.vy = 0;
        b.y += (surface - DRAFT - b.y) * Math.min(1, 6 * dt);
      } else {
        b.vy = Math.max(-20, b.vy - GRAVITY * dt);
      }

      this._move(world, b, dt);
      if (b.y < -12) { this._removeAt(i, player); continue; } // lost to the void

      // the hull swings its bow toward travel
      const speed = Math.hypot(b.vx, b.vz);
      if (speed > 0.35) {
        const target = Math.atan2(b.vx, b.vz);
        let d = target - b.yaw;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        b.yaw += d * Math.min(1, YAW_EASE * dt);
      }

      // --- presentation: gentle bob afloat, a kicked flinch ---
      const bob = b.inWater ? Math.sin(b.age * 1.7) * 0.035 : 0;
      const roll = b.inWater ? Math.sin(b.age * 1.3 + 1) * 0.02 : 0;
      b.mesh.position.set(b.x, b.y + bob, b.z);
      b.mesh.rotation.y = b.yaw;
      b.mesh.rotation.z = roll;
      b.mesh.scale.setScalar(b.hurtT > 0 ? 1.06 : 1);

      // the seat carries the rider (player physics stays suspended)
      if (ridden && player.riding === b) {
        player.pos.x = b.x;
        player.pos.y = b.y + SEAT_Y + bob;
        player.pos.z = b.z;
      }
    }
  }

  // substepped per-axis AABB collision (hull-sized), with a small step-up so
  // a driven hull rides onto a bank instead of nosing into it forever
  _move(world, b, dt) {
    const maxDisp = Math.max(Math.abs(b.vx), Math.abs(b.vy), Math.abs(b.vz)) * dt;
    const steps = Math.max(1, Math.ceil(maxDisp / MAX_STEP));
    const sdt = dt / steps;
    for (let s = 0; s < steps; s++) {
      this._axis(world, b, "x", b.vx * sdt);
      this._axis(world, b, "z", b.vz * sdt);
      if (b.vy !== 0) this._axis(world, b, "y", b.vy * sdt);
    }
  }

  _axis(world, b, axis, disp) {
    if (disp === 0) return;
    b[axis] += disp;
    const eps = 0.001;
    const x0 = Math.floor(b.x - HALF_W), x1 = Math.floor(b.x + HALF_W - eps);
    // one row below the hull too: tall blocks (fence, colHeight 1.5) reach up
    const y0 = Math.floor(b.y) - 1, y1 = Math.floor(b.y + HULL_H - eps);
    const z0 = Math.floor(b.z - HALF_W), z1 = Math.floor(b.z + HALF_W - eps);
    for (let by = y0; by <= y1; by++) for (let bz = z0; bz <= z1; bz++) for (let bx = x0; bx <= x1; bx++) {
      const bDef = BLOCKS[world.getBlock(bx, by, bz)];
      if (!bDef.solid) continue;
      const top = by + bDef.colHeight;
      if (b.y >= top - eps) continue;
      if (axis === "x" || axis === "z") {
        // ride up a shallow bank: only a low ledge, only with headroom
        if (top - b.y <= STEP_UP + eps && !this._collidesAt(world, b.x, top + eps, b.z)) {
          b.y = top + eps;
          return;
        }
        if (axis === "x") {
          b.x = disp > 0 ? bx - HALF_W - eps : bx + 1 + HALF_W + eps;
          b.vx = 0;
        } else {
          b.z = disp > 0 ? bz - HALF_W - eps : bz + 1 + HALF_W + eps;
          b.vz = 0;
        }
      } else {
        if (disp > 0) b.y = by - HULL_H - eps;
        else b.y = top + eps; // beached on the block's real top
        b.vy = 0;
      }
      return;
    }
  }

  _collidesAt(world, px, py, pz) {
    const eps = 0.001;
    const x0 = Math.floor(px - HALF_W), x1 = Math.floor(px + HALF_W - eps);
    const y0 = Math.floor(py) - 1, y1 = Math.floor(py + HULL_H - eps);
    const z0 = Math.floor(pz - HALF_W), z1 = Math.floor(pz + HALF_W - eps);
    for (let by = y0; by <= y1; by++) for (let bz = z0; bz <= z1; bz++) for (let bx = x0; bx <= x1; bx++) {
      const d = BLOCKS[world.getBlock(bx, by, bz)];
      if (d.solid && py < by + d.colHeight - eps) return true;
    }
    return false;
  }

  // step the rider ashore: try the four quarters around the hull for a spot
  // a Wanderling fits (two clear cells over ground or water); failing all
  // of them, stand them atop the hull
  _dismount(world, player, b) {
    const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);   // bow direction
    const rx = Math.cos(b.yaw), rz = -Math.sin(b.yaw);  // starboard
    const spots = [
      [b.x + rx * 1.2, b.z + rz * 1.2], [b.x - rx * 1.2, b.z - rz * 1.2],
      [b.x + fx * 1.6, b.z + fz * 1.6], [b.x - fx * 1.6, b.z - fz * 1.6],
    ];
    let placed = false;
    outer: for (const [px, pz] of spots) {
      for (const dy of [0, 1, -1]) {
        const py = Math.floor(b.y) + dy;
        if (py < 1 || py + 1 >= HEIGHT) continue;
        const cx = Math.floor(px), cz = Math.floor(pz);
        if (BLOCKS[world.getBlock(cx, py, cz)].solid) continue;
        if (BLOCKS[world.getBlock(cx, py + 1, cz)].solid) continue;
        const below = world.getBlock(cx, py - 1, cz);
        const bDef = BLOCKS[below];
        if (bDef.solid) { // firm footing on the block's real top
          player.pos.x = px; player.pos.y = py - 1 + bDef.colHeight + 0.02; player.pos.z = pz;
          placed = true; break outer;
        }
        if (below === WATER) { // stepping into the shallows is fine — swim
          player.pos.x = px; player.pos.y = py - 0.4; player.pos.z = pz;
          placed = true; break outer;
        }
      }
    }
    if (!placed) { // stand on the hull itself
      player.pos.x = b.x;
      player.pos.y = b.y + HULL_H + 0.05;
      player.pos.z = b.z;
    }
    player.riding = null;
    player.vel.x = player.vel.y = player.vel.z = 0;
    player.resetFall();
  }

  // slab test against every hull, nearest first (the mobs.rayHit shape)
  rayHit(origin, dir, maxDist) {
    let best = null, bestT = maxDist;
    for (const b of this.boats) {
      const min = [b.x - HALF_W, b.y, b.z - HALF_W];
      const max = [b.x + HALF_W, b.y + HULL_H, b.z + HALF_W];
      const o = [origin.x, origin.y, origin.z];
      const d = [dir.x, dir.y, dir.z];
      let t0 = 0, t1 = bestT, ok = true;
      for (let a = 0; a < 3 && ok; a++) {
        if (Math.abs(d[a]) < 1e-9) {
          if (o[a] < min[a] || o[a] > max[a]) ok = false;
        } else {
          let near = (min[a] - o[a]) / d[a];
          let far = (max[a] - o[a]) / d[a];
          if (near > far) { const t = near; near = far; far = t; }
          t0 = Math.max(t0, near);
          t1 = Math.min(t1, far);
          if (t0 > t1) ok = false;
        }
      }
      if (ok && t0 < bestT) { best = b; bestT = t0; }
    }
    return best;
  }

  // a kick lands on the hull: the second one folds it back into the item
  punch(b, player) {
    b.hits++;
    b.hurtT = 0.25;
    if (b.hits >= KICKS_TO_BREAK) {
      const i = this.boats.indexOf(b);
      if (i !== -1) {
        this._removeAt(i, player);
        if (this.onDrop) this.onDrop(b.x, b.y + 0.4, b.z, BOAT);
        if (this.onBreak) this.onBreak();
      }
    } else if (this.onHit) {
      this.onHit();
    }
  }

  _removeAt(i, player) {
    const b = this.boats[i];
    if (player && player.riding === b) { // the seat vanished under them
      player.riding = null;
      player.resetFall();
    }
    this.scene.remove(b.mesh);
    this.boats.splice(i, 1);
  }

  // a Cinder Door crossing: every hull leaves the scene (the caller
  // serialized this dimension's fleet first; load() rebuilds the other's)
  clear(player) {
    while (this.boats.length) this._removeAt(0, player);
  }

  // --- persistence: an additive save field, positions + headings ---------------

  serialize() {
    const r = (v) => Math.round(v * 100) / 100;
    return this.boats.map((b) => [r(b.x), r(b.y), r(b.z), r(b.yaw)]);
  }

  load(arr) {
    if (!Array.isArray(arr)) return;
    for (const e of arr) {
      if (!Array.isArray(e) || e.length < 4) continue;
      const [x, y, z, yaw] = e;
      if (![x, y, z, yaw].every(Number.isFinite)) continue;
      if (y < -8 || y > HEIGHT + 8) continue;
      this.deploy(x, y, z, yaw);
    }
  }
}

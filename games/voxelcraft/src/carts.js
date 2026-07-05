// The Trundle rolling: cart entities on the Waybar web. A trundle is a
// riveted sky-iron tub on four wheels that moves ALONG the rail graph only —
// a boarded Wanderling thrusts it forward/back along the track (W/S),
// corners redirect it, slopes pull it downhill and bleed it uphill, and off
// the end of the line it rolls to a stop on the ground like a beached skiff.
// Persisted like the boats: an additive save field of positions + headings
// (velocity is zeroed on load — a reloaded trundle wakes parked).

import * as THREE from "three";
import { BLOCKS, CART, isRail, WATER } from "./blocks.js";
import { railInfo } from "./rails.js";
import { mulberry32 } from "./noise.js";
import { HEIGHT } from "./world.js";

const MAX_CARTS = 8;        // deployed trundles at once
const HALF_W = 0.45;        // tub collision half-width
const BODY_H = 0.75;        // tub collision height (rayHit box)
const SEAT_Y = 0.42;        // rider feet above the cart bottom
const RIDE_Y = 0.06;        // cart bottom above the rail cell base
const THRUST_ACCEL = 5.0;   // bl/s² of rider push along the track
const MAX_THRUST = 7.0;     // thrust alone tops out here...
const MAX_SPEED = 9.5;      // ...gravity can carry it to the hard cap
const RAIL_FRICTION = 0.25; // 1/s proportional coasting decay on rail
const RAIL_FRICTION_C = 0.2; // bl/s² constant term so a coast actually stops
const SLOPE_G = 11;         // downhill pull while on a slope cell (bl/s²)
const SHOVE_ACCEL = 9;      // walking into a cart pushes it away (bl/s²)
const SHOVE_MAX = 2.2;      // a shove never launches it
const FREE_DRAG = 3.5;      // 1/s rolling drag off the rails
const GRAVITY = 24;         // an off-rail trundle settles like anything else
const MAX_STEP = 0.35;      // max movement per free-mode collision substep
const YAW_EASE = 7.0;       // 1/s: the tub swings its nose toward travel
const KICKS_TO_BREAK = 2;

// --- the procedural tub ---------------------------------------------------------

function paintTex(seed, painter) {
  const canvas = document.createElement("canvas");
  canvas.width = 16; canvas.height = 16;
  const ctx = canvas.getContext("2d");
  painter(ctx, mulberry32(seed));
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const paintIron = (base, variance, rivets) => (ctx, rand) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = (rand() * 2 - 1) * variance;
    const seam = x % 8 === 7 ? -16 : 0; // riveted plate seams
    ctx.fillStyle = `rgb(${base[0] + d + seam},${base[1] + d + seam},${base[2] + d + seam})`;
    ctx.fillRect(x, y, 1, 1);
  }
  if (rivets) {
    for (const [rx, ry] of [[3, 3], [11, 3], [3, 12], [11, 12], [7, 7]]) {
      ctx.fillStyle = "rgb(196,203,218)";
      ctx.fillRect(rx, ry, 1, 1);
    }
  }
};

export class Carts {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.carts = [];
    this.onDrop = opts.onDrop;   // (x, y, z, id) => item drop
    this.onHit = opts.onHit;     // () => kick-clang sfx
    this.onBreak = opts.onBreak; // () => break sfx

    // shared materials, tinted by the day/night cycle like the skiffs
    this._materials = [];
    const mat = (tex) => {
      const m = new THREE.MeshBasicMaterial({ map: tex });
      this._materials.push(m);
      return m;
    };
    this._ironMat = mat(paintTex(0xca11, paintIron([140, 147, 162], 7, true)));
    this._darkMat = mat(paintTex(0xca12, paintIron([96, 102, 116], 7, false)));
    this._trimMat = mat(paintTex(0xca13, paintIron([197, 106, 43], 9, false)));
    this._wheelMat = mat(paintTex(0xca14, paintIron([56, 58, 68], 6, false)));
  }

  setLight(level, tint) {
    for (const m of this._materials) {
      m.color.copy(tint).multiplyScalar(Math.min(1, level + 0.15));
    }
  }

  canDeploy() { return this.carts.length < MAX_CARTS; }

  // cart bottom at local y=0; long axis on z (nose toward +z, like the boats)
  _buildBody() {
    const g = new THREE.Group();
    const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    // four sky-iron wheels outboard of the tub
    for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const wheel = box(0.1, 0.3, 0.3, this._wheelMat);
      wheel.position.set(sx * 0.46, 0.15, sz * 0.42);
      g.add(wheel);
    }
    const floor = box(0.82, 0.1, 1.2, this._darkMat);
    floor.position.set(0, 0.25, 0);
    g.add(floor);
    for (const side of [-1, 1]) { // long walls
      const wall = box(0.1, 0.36, 1.2, this._ironMat);
      wall.position.set(side * 0.36, 0.48, 0);
      g.add(wall);
      // the rust-orange trim board along each rim (Wanderling colors)
      const rim = box(0.12, 0.07, 1.28, this._trimMat);
      rim.position.set(side * 0.36, 0.69, 0);
      g.add(rim);
    }
    for (const end of [-1, 1]) { // end walls
      const wall = box(0.62, 0.36, 0.1, this._ironMat);
      wall.position.set(0, 0.48, end * 0.55);
      g.add(wall);
      const rim = box(0.62, 0.07, 0.12, this._trimMat);
      rim.position.set(0, 0.69, end * 0.55);
      g.add(rim);
    }
    return g;
  }

  deploy(x, y, z, yaw = 0) {
    if (!this.canDeploy()) return null;
    const mesh = this._buildBody();
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    this.scene.add(mesh);
    const c = {
      x, y, z, yaw, // y is the cart BOTTOM
      vx: 0, vy: 0, vz: 0,
      hits: 0, hurtT: 0,
      mesh,
    };
    this.carts.push(c);
    return c;
  }

  // is a cart already parked on this rail cell? (deploys don't stack)
  cartAt(bx, by, bz) {
    return this.carts.find((c) =>
      Math.floor(c.x) === bx && Math.floor(c.z) === bz &&
      Math.abs(c.y - by) < 1.2) || null;
  }

  // the rail cell carrying this cart, or null. Same column only; the y
  // candidates cover flat rails (feet in the rail's cell) and slope tops
  // (the cart rides up to a block above the slope's base cell).
  _railCell(world, c) {
    const bx = Math.floor(c.x), bz = Math.floor(c.z);
    const y0 = Math.floor(c.y + 0.45);
    for (const by of [y0, y0 - 1]) {
      const id = world.getBlock(bx, by, bz);
      if (isRail(id)) return { x: bx, y: by, z: bz, id };
    }
    return null;
  }

  update(dt, world, player) {
    for (let i = this.carts.length - 1; i >= 0; i--) {
      const c = this.carts[i];
      // frozen while its chunk is missing (like the skiffs)
      if (!world.isGenerated(Math.floor(c.x) >> 4, Math.floor(c.z) >> 4)) continue;
      c.hurtT = Math.max(0, c.hurtT - dt);
      const ridden = player.riding === c && !player.dead;

      // Sneak steps off — same idiom as the skiff
      if (ridden && (player.keys.has("ShiftLeft") || player.keys.has("ShiftRight"))) {
        this._dismount(world, player, c);
      }
      const riding = player.riding === c && !player.dead;

      // walking into an empty cart shoves it (the rail projection below
      // keeps the push honest: only the along-track component survives)
      if (!riding && !player.dead) this._shove(c, player, dt);

      const cell = this._railCell(world, c);
      if (cell) this._updateOnRail(dt, world, c, cell, riding ? player : null);
      else this._updateFree(dt, world, c);

      if (c.y < -12) { this._removeAt(i, player); continue; } // lost to the void

      // the tub swings its nose toward travel
      const speed = Math.hypot(c.vx, c.vz);
      if (speed > 0.3) {
        const target = Math.atan2(c.vx, c.vz);
        let d = target - c.yaw;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        c.yaw += d * Math.min(1, YAW_EASE * dt);
      }

      c.mesh.position.set(c.x, c.y, c.z);
      c.mesh.rotation.y = c.yaw;
      c.mesh.scale.setScalar(c.hurtT > 0 ? 1.06 : 1);

      // the seat carries the rider (player physics stays suspended)
      if (riding && player.riding === c) {
        player.pos.x = c.x;
        player.pos.y = c.y + SEAT_Y;
        player.pos.z = c.z;
      }
    }
  }

  // --- on the rails ---------------------------------------------------------------

  _updateOnRail(dt, world, c, cell, rider) {
    const info = railInfo(cell.id);

    // slope gravity: a constant pull toward the low end while on the cell
    if (info.kind === "slope") {
      c.vx -= info.up[0] * SLOPE_G * dt;
      c.vz -= info.up[1] * SLOPE_G * dt;
    }

    // rider thrust: W/S pushes along the track, in the direction the rider
    // faces (so "forward" is wherever the Wanderling is looking down the line)
    let thrusting = false;
    if (rider) {
      const f = (rider.keys.has("KeyW") ? 1 : 0) - (rider.keys.has("KeyS") ? 1 : 0);
      if (f !== 0) {
        const look = rider.lookDir();
        let ax, az;
        if (info.kind === "corner") {
          // push along whichever exit arm the rider faces most
          const [e0, e1] = info.exits;
          const pick = Math.abs(look.x * e0[0] + look.z * e0[1]) >=
            Math.abs(look.x * e1[0] + look.z * e1[1]) ? e0 : e1;
          ax = Math.abs(pick[0]); az = Math.abs(pick[1]);
        } else {
          ax = info.axis === "x" ? 1 : 0;
          az = info.axis === "x" ? 0 : 1;
        }
        const sense = Math.sign(look.x * ax + look.z * az) || 1;
        const tx = ax * sense * f, tz = az * sense * f;
        // thrust alone never pushes past MAX_THRUST (braking always works)
        const along = c.vx * tx + c.vz * tz;
        if (along < MAX_THRUST) {
          c.vx += tx * THRUST_ACCEL * dt;
          c.vz += tz * THRUST_ACCEL * dt;
          thrusting = true;
        }
      }
    }

    // mild rail friction while coasting (proportional + a constant nib so it
    // actually parks instead of creeping forever)
    if (!thrusting) {
      const sp = Math.hypot(c.vx, c.vz);
      if (sp > 0) {
        const ns = Math.max(0, sp - (RAIL_FRICTION * sp + RAIL_FRICTION_C) * dt);
        c.vx *= ns / sp; c.vz *= ns / sp;
      }
    }

    // the hard cap (gravity included)
    const sp = Math.hypot(c.vx, c.vz);
    if (sp > MAX_SPEED) { c.vx *= MAX_SPEED / sp; c.vz *= MAX_SPEED / sp; }

    c.vy = 0;
    this._advance(world, c, dt);
    this._settleY(world, c);
  }

  // advance the cart along the track for `dtBudget` seconds: velocity is
  // projected onto the track (cross components die — a sideways shove can't
  // become track speed), straights snap to the centerline, corners turn the
  // velocity at the cell center, slopes ride their axis. Stops constraining
  // the moment the cart runs off the rail end (its velocity carries into
  // free mode next frame).
  _advance(world, c, dtBudget) {
    let t = dtBudget;
    let guard = 40;
    while (t > 1e-6 && guard-- > 0) {
      const cell = this._railCell(world, c);
      if (!cell) return;
      const info = railInfo(cell.id);
      const cx = cell.x + 0.5, cz = cell.z + 0.5;

      // project the velocity onto the track; d is the unit motion direction
      let d;
      if (info.kind === "corner") {
        d = Math.abs(c.vx) >= Math.abs(c.vz)
          ? [Math.sign(c.vx) || 1, 0] : [0, Math.sign(c.vz) || 1];
        const along = c.vx * d[0] + c.vz * d[1];
        c.vx = d[0] * along; c.vz = d[1] * along;
      } else if (info.axis === "x") {
        c.vz = 0; d = [Math.sign(c.vx) || 1, 0];
      } else {
        c.vx = 0; d = [0, Math.sign(c.vz) || 1];
      }
      const sp = Math.hypot(c.vx, c.vz);
      if (sp < 1e-7) return;

      // snap the cross axis onto the arm the cart is riding
      if (d[0] !== 0) c.z = cz; else c.x = cx;

      // the next event along the motion: a corner's center turn (when heading
      // inward off a non-exit edge), or the cell border (a hair past it, so
      // the next iteration reads the next cell)
      const turning = info.kind === "corner" &&
        !info.exits.some(([a, b]) => a === d[0] && b === d[1]);
      let e;
      if (turning) {
        e = Math.max(0, d[0] !== 0 ? (cx - c.x) * d[0] : (cz - c.z) * d[1]);
      } else {
        e = d[0] > 0 ? cell.x + 1 + 0.001 - c.x
          : d[0] < 0 ? c.x - (cell.x - 0.001)
          : d[1] > 0 ? cell.z + 1 + 0.001 - c.z
          : c.z - (cell.z - 0.001);
        e = Math.max(e, 0.002);
      }
      const step = Math.min(t * sp, e);
      c.x += d[0] * step; c.z += d[1] * step;
      t -= step / sp;
      if (turning && step >= e - 1e-9) {
        // at the center: turn onto the exit that isn't the edge we came from
        c.x = cx; c.z = cz;
        const out = info.exits.find(([a, b]) => !(a === -d[0] && b === -d[1])) ||
          info.exits[0];
        c.vx = out[0] * sp; c.vz = out[1] * sp;
      }
    }
  }

  // seat the cart on its track: flat height on straights and bends, the
  // linear ramp on slopes (continuous with the rails one block up/down)
  _settleY(world, c) {
    const cell = this._railCell(world, c);
    if (!cell) return;
    const info = railInfo(cell.id);
    if (info.kind === "slope") {
      const fx = c.x - cell.x - 0.5, fz = c.z - cell.z - 0.5;
      const t = 0.5 + fx * info.up[0] + fz * info.up[1]; // 0 low -> 1 high
      c.y = cell.y + RIDE_Y + Math.max(0, Math.min(1, t));
    } else {
      c.y = cell.y + RIDE_Y;
    }
  }

  // --- off the rails ---------------------------------------------------------------

  _updateFree(dt, world, c) {
    // rolling drag + gravity, then substepped AABB collision (skiff idiom)
    const k = Math.min(1, FREE_DRAG * dt);
    c.vx -= c.vx * k;
    c.vz -= c.vz * k;
    c.vy = Math.max(-20, c.vy - GRAVITY * dt);
    const maxDisp = Math.max(Math.abs(c.vx), Math.abs(c.vy), Math.abs(c.vz)) * dt;
    const steps = Math.max(1, Math.ceil(maxDisp / MAX_STEP));
    const sdt = dt / steps;
    for (let s = 0; s < steps; s++) {
      this._axis(world, c, "x", c.vx * sdt);
      this._axis(world, c, "z", c.vz * sdt);
      if (c.vy !== 0) this._axis(world, c, "y", c.vy * sdt);
    }
  }

  _axis(world, c, axis, disp) {
    if (disp === 0) return;
    c[axis] += disp;
    const eps = 0.001;
    const x0 = Math.floor(c.x - HALF_W), x1 = Math.floor(c.x + HALF_W - eps);
    // one row below too: tall blocks (fence, colHeight 1.5) reach up
    const y0 = Math.floor(c.y) - 1, y1 = Math.floor(c.y + BODY_H - eps);
    const z0 = Math.floor(c.z - HALF_W), z1 = Math.floor(c.z + HALF_W - eps);
    for (let by = y0; by <= y1; by++) for (let bz = z0; bz <= z1; bz++) for (let bx = x0; bx <= x1; bx++) {
      const bDef = BLOCKS[world.getBlock(bx, by, bz)];
      if (!bDef.solid) continue;
      const top = by + bDef.colHeight;
      if (c.y >= top - eps) continue;
      if (axis === "x") {
        c.x = disp > 0 ? bx - HALF_W - eps : bx + 1 + HALF_W + eps;
        c.vx = 0;
      } else if (axis === "z") {
        c.z = disp > 0 ? bz - HALF_W - eps : bz + 1 + HALF_W + eps;
        c.vz = 0;
      } else {
        if (disp > 0) c.y = by - BODY_H - eps;
        else c.y = top + eps; // parked on the block's real top
        c.vy = 0;
      }
      return;
    }
  }

  // walking into an empty trundle nudges it away — capped, so it's a shove,
  // never a launch (on rail the along-track projection eats the sideways
  // part). Only while the walker is actually closing on it: the Wanderling
  // passes THROUGH the tub (no player-cart collision), and without the
  // approach gate the far side would shove it right back where it was.
  _shove(c, player, dt) {
    const dx = c.x - player.pos.x, dz = c.z - player.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.85 || d < 1e-4) return;
    if (player.pos.y < c.y - 1.4 || player.pos.y > c.y + 1.2) return;
    if (player.vel.x * dx + player.vel.z * dz <= 0.1) return; // not walking in
    const sp = Math.hypot(c.vx, c.vz);
    if (sp >= SHOVE_MAX) return;
    c.vx += (dx / d) * SHOVE_ACCEL * dt;
    c.vz += (dz / d) * SHOVE_ACCEL * dt;
  }

  // step the rider off: try the four quarters around the tub for a spot a
  // Wanderling fits; failing all of them, stand them atop the cart
  _dismount(world, player, c) {
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);   // nose direction
    const rx = Math.cos(c.yaw), rz = -Math.sin(c.yaw);  // right side
    const spots = [
      [c.x + rx * 1.2, c.z + rz * 1.2], [c.x - rx * 1.2, c.z - rz * 1.2],
      [c.x + fx * 1.5, c.z + fz * 1.5], [c.x - fx * 1.5, c.z - fz * 1.5],
    ];
    let placed = false;
    outer: for (const [px, pz] of spots) {
      for (const dy of [0, 1, -1]) {
        const py = Math.floor(c.y) + dy;
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
    if (!placed) { // stand on the tub itself
      player.pos.x = c.x;
      player.pos.y = c.y + BODY_H + 0.05;
      player.pos.z = c.z;
    }
    player.riding = null;
    player.vel.x = player.vel.y = player.vel.z = 0;
    player.resetFall();
  }

  // slab test against every tub, nearest first (the mobs.rayHit shape)
  rayHit(origin, dir, maxDist) {
    let best = null, bestT = maxDist;
    for (const c of this.carts) {
      const min = [c.x - HALF_W, c.y, c.z - HALF_W];
      const max = [c.x + HALF_W, c.y + BODY_H, c.z + HALF_W];
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
      if (ok && t0 < bestT) { best = c; bestT = t0; }
    }
    return best;
  }

  // a kick lands on the tub: the second one folds it back into the item
  punch(c, player) {
    c.hits++;
    c.hurtT = 0.25;
    if (c.hits >= KICKS_TO_BREAK) {
      const i = this.carts.indexOf(c);
      if (i !== -1) {
        this._removeAt(i, player);
        if (this.onDrop) this.onDrop(c.x, c.y + 0.4, c.z, CART);
        if (this.onBreak) this.onBreak();
      }
    } else if (this.onHit) {
      this.onHit();
    }
  }

  _removeAt(i, player) {
    const c = this.carts[i];
    if (player && player.riding === c) { // the seat vanished under them
      player.riding = null;
      player.resetFall();
    }
    this.scene.remove(c.mesh);
    this.carts.splice(i, 1);
  }

  // --- persistence: an additive save field, positions + headings ---------------

  serialize() {
    const r = (v) => Math.round(v * 100) / 100;
    return this.carts.map((c) => [r(c.x), r(c.y), r(c.z), r(c.yaw)]);
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

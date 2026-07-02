// Thrown sling-stones: little ballistic projectiles. A Wanderling throws
// with a foot-hand (four fingers and a thumb — wonderful grip, see LORE.md),
// so the stone leaves fast and flat. Substepped point physics like the item
// drops; a hit mob takes the strike a punch would, only harder; a landed
// stone sometimes survives as a pickup, but usually shatters.

import * as THREE from "three";
import { SLING_STONE, BLOCKS } from "./blocks.js";
import { buildBlockGeometry } from "./mesher.js";

const MAX_LIVE = 24;         // stones in flight at once
const THROW_SPEED = 18;      // blocks/second off the foot-hand
const GRAVITY = 22;
const DAMAGE = 3;            // three whole punches, delivered at range
const SURVIVE_CHANCE = 0.25; // a landed stone's odds of staying whole
const MAX_AGE = 20;          // seconds — a stray stone doesn't fly forever

export class SlingStones {
  constructor(scene, materials, opts) {
    this.scene = scene;
    this.stones = [];
    this.mobs = opts.mobs;
    this.onSpawnDrop = opts.onSpawnDrop; // (x, y, z, id)
    this.onImpact = opts.onImpact;       // (x, y, z, shattered)
    this.geometry = buildBlockGeometry(SLING_STONE, 0.4);
    this.geometry.translate(-0.5, -0.5, -0.5); // tumble around the center
    this.material = materials.cutout;    // shared chunk material (drop idiom)
  }

  canThrow() { return this.stones.length < MAX_LIVE; }

  // spawn at the eye, flying along dir (a unit vector)
  throw(x, y, z, dir) {
    if (!this.canThrow()) return false;
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.scale.setScalar(0.35);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.stones.push({
      x, y, z,
      vx: dir.x * THROW_SPEED,
      vy: dir.y * THROW_SPEED,
      vz: dir.z * THROW_SPEED,
      age: 0, mesh,
    });
    return true;
  }

  update(dt, world) {
    for (let i = this.stones.length - 1; i >= 0; i--) {
      const s = this.stones[i];
      // frozen while its chunk is missing — same contract as the item drops
      // (getBlock would read AIR and the stone would sail through the world)
      if (!world.isGenerated(Math.floor(s.x) >> 4, Math.floor(s.z) >> 4)) continue;
      s.age += dt;
      if (s.age > MAX_AGE || s.y < -40) { this._remove(i); continue; }

      s.vy = Math.max(-40, s.vy - GRAVITY * dt);
      // substepped flight so a full-speed stone (~0.3 bl/frame) can never
      // tunnel through a wall or a mob between frames
      const maxDisp = Math.max(Math.abs(s.vx), Math.abs(s.vy), Math.abs(s.vz)) * dt;
      const steps = Math.max(1, Math.ceil(maxDisp / 0.25));
      const sdt = dt / steps;
      let landed = false;
      for (let st = 0; st < steps; st++) {
        const px = s.x, py = s.y, pz = s.z;
        s.x += s.vx * sdt; s.y += s.vy * sdt; s.z += s.vz * sdt;
        const m = this._mobAt(s.x, s.y, s.z);
        if (m) {
          // the strike a punch would land, only harder — knocked along the
          // stone's flight line, and the mob reacts exactly as if punched
          this.mobs.strike(m, DAMAGE, { x: px - s.vx, z: pz - s.vz });
          this._land(i, px, py, pz);
          landed = true;
          break;
        }
        if (this._solidAt(world, s.x, s.y, s.z)) {
          this._land(i, px, py, pz); // rest just outside the face it struck
          landed = true;
          break;
        }
      }
      if (landed) continue;
      s.mesh.position.set(s.x, s.y, s.z);
      s.mesh.rotation.y = s.age * 9; // tumbling in flight
    }
  }

  // point-in-solid, honoring partial heights (a stone sails over a slab)
  _solidAt(world, x, y, z) {
    const def = BLOCKS[world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))];
    return def.solid && y < Math.floor(y) + def.colHeight;
  }

  // point-vs-AABB against every mob, padded a touch so grazes still count
  _mobAt(x, y, z) {
    for (const m of this.mobs.mobs) {
      const hw = m.spec.halfW + 0.08;
      if (x > m.x - hw && x < m.x + hw &&
          y > m.y - 0.05 && y < m.y + m.spec.height + 0.05 &&
          z > m.z - hw && z < m.z + hw) return m;
    }
    return null;
  }

  // impact: a lucky quarter survive as pickup-able stones; the rest shatter
  _land(i, x, y, z) {
    this._remove(i);
    const survived = Math.random() < SURVIVE_CHANCE;
    if (survived && this.onSpawnDrop) this.onSpawnDrop(x, y, z, SLING_STONE);
    if (this.onImpact) this.onImpact(x, y, z, !survived);
  }

  _remove(i) {
    this.scene.remove(this.stones[i].mesh); // geometry/material are shared
    this.stones.splice(i, 1);
  }

  clear() { while (this.stones.length) this._remove(0); }
}

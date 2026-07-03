// Ballistic projectiles: thrown sling-stones and loosed quills. A Wanderling
// throws with a foot-hand (four fingers and a thumb — wonderful grip, see
// LORE.md), so a stone leaves fast and flat; a Springstave does the leaving
// for the quill. Substepped point physics like the item drops; a hit mob
// takes the strike a punch would, only harder; a landed projectile sometimes
// survives as a pickup, but usually breaks.

import * as THREE from "three";
import { SLING_STONE, BLOCKS } from "./blocks.js";
import { buildBlockGeometry } from "./mesher.js";

const MAX_LIVE = 24;         // projectiles in flight at once
const MAX_AGE = 20;          // seconds — a stray shot doesn't fly forever

// the sling stone's numbers (the default shot — callers override per shot)
const STONE_CFG = {
  itemId: SLING_STONE,
  speed: 18,          // blocks/second off the foot-hand
  gravity: 22,
  damage: 3,          // three whole punches, delivered at range
  surviveChance: 0.25,
  scale: 0.35,
};

export class Projectiles {
  constructor(scene, materials, opts) {
    this.scene = scene;
    this.live = [];
    this.mobs = opts.mobs;
    this.onSpawnDrop = opts.onSpawnDrop; // (x, y, z, id)
    this.onImpact = opts.onImpact;       // (x, y, z, shattered)
    this.material = materials.cutout;    // shared chunk material (drop idiom)
    this._geo = new Map();               // itemId -> centered geometry
  }

  _geometry(id) {
    let g = this._geo.get(id);
    if (!g) {
      g = buildBlockGeometry(id, 0.4);
      g.translate(-0.5, -0.5, -0.5); // tumble around the center
      this._geo.set(id, g);
    }
    return g;
  }

  canThrow() { return this.live.length < MAX_LIVE; }

  // spawn at the eye, flying along dir (a unit vector). cfg overrides the
  // stone defaults per shot — a drawn quill passes its charge-scaled numbers.
  throw(x, y, z, dir, cfg = {}) {
    if (!this.canThrow()) return false;
    const c = { ...STONE_CFG, ...cfg };
    const mesh = new THREE.Mesh(this._geometry(c.itemId), this.material);
    mesh.scale.setScalar(c.scale);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.live.push({
      x, y, z,
      vx: dir.x * c.speed,
      vy: dir.y * c.speed,
      vz: dir.z * c.speed,
      age: 0, mesh, cfg: c,
    });
    return true;
  }

  update(dt, world) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const s = this.live[i];
      // frozen while its chunk is missing — same contract as the item drops
      // (getBlock would read AIR and the shot would sail through the world)
      if (!world.isGenerated(Math.floor(s.x) >> 4, Math.floor(s.z) >> 4)) continue;
      s.age += dt;
      if (s.age > MAX_AGE || s.y < -40) { this._remove(i); continue; }

      s.vy = Math.max(-40, s.vy - s.cfg.gravity * dt);
      // substepped flight so a full-speed shot can never tunnel through a
      // wall or a mob between frames
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
          // shot's flight line, and the mob reacts exactly as if punched
          this.mobs.strike(m, s.cfg.damage, { x: px - s.vx, z: pz - s.vz });
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

  // point-in-solid, honoring partial heights (a shot sails over a slab)
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

  // impact: the lucky survive as pickup-able items; the rest break
  _land(i, x, y, z) {
    const s = this.live[i];
    this._remove(i);
    const survived = Math.random() < s.cfg.surviveChance;
    if (survived && this.onSpawnDrop) this.onSpawnDrop(x, y, z, s.cfg.itemId);
    if (this.onImpact) this.onImpact(x, y, z, !survived);
  }

  _remove(i) {
    this.scene.remove(this.live[i].mesh); // geometry/material are shared
    this.live.splice(i, 1);
  }

  clear() { while (this.live.length) this._remove(0); }
}

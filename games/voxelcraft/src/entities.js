// Item drops: small spinning block meshes with simple physics, magnetized
// toward the player and collected on contact.

import * as THREE from "three";
import { BLOCKS, isSolid } from "./blocks.js";
import { buildBlockGeometry } from "./mesher.js";

const MAX_DROPS = 200;
const DESPAWN_SECONDS = 300;
const PICKUP_DIST = 1.2;
const MAGNET_DIST = 2.6;
const GRAVITY = 18;

export class ItemDrops {
  constructor(scene, materials) {
    this.scene = scene;
    this.materials = materials;
    this.drops = [];
    this._geoCache = new Map(); // id -> centered geometry, shared by all drops
  }

  _geometry(id) {
    let geo = this._geoCache.get(id);
    if (!geo) {
      geo = buildBlockGeometry(id, 0.45);
      geo.translate(-0.5, -0.5, -0.5);
      this._geoCache.set(id, geo);
    }
    return geo;
  }

  // opts.dur / opts.mod: tool wear and a woven thread riding on the drop —
  // handed back on pickup so a tossed half-worn threaded Cracker comes back
  // exactly as it left
  spawn(x, y, z, id, qty = 1, opts = {}) {
    if (!BLOCKS[id]) return;
    if (this.drops.length >= MAX_DROPS) {
      // evict the oldest SINGLE first — FIFO could delete a huge chest-spill
      // stack to make room for one leaf
      let evict = this.drops.findIndex((d) => d.qty === 1);
      if (evict === -1) {
        evict = 0;
        for (let i = 1; i < this.drops.length; i++) {
          if (this.drops[i].qty < this.drops[evict].qty) evict = i;
        }
      }
      this._remove(evict);
    }
    const mesh = new THREE.Mesh(
      this._geometry(id),
      BLOCKS[id].kind === "cross" ? this.materials.cutout : this.materials.opaque
    );
    mesh.scale.setScalar(qty > 1 ? 0.32 : 0.25); // stacks read slightly bigger
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.drops.push({
      id, qty, mesh,
      dur: opts.dur,
      mod: opts.mod,
      x, y, z,
      vx: opts.vel ? opts.vel.x : (Math.random() - 0.5) * 2.2,
      vy: opts.vel ? opts.vel.y : 2.4 + Math.random() * 1.2,
      vz: opts.vel ? opts.vel.z : (Math.random() - 0.5) * 2.2,
      age: Math.random() * 6, // desync the bob/spin phases
      life: 0,
      pickupDelay: opts.pickupDelay ?? 0.5, // Q-drops/spills must not boomerang
      retryAt: 0, // full-inventory pickups back off instead of thrashing
    });
  }

  update(dt, world, player, onPickup) {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      // freeze drops whose chunk streamed out — otherwise getBlock reads AIR
      // and they fall through the world and get deleted
      if (!world.isGenerated(Math.floor(d.x) >> 4, Math.floor(d.z) >> 4)) continue;
      d.age += dt;
      d.life += dt;
      if (d.life > DESPAWN_SECONDS) { this._remove(i); continue; }

      // physics: gravity + substepped per-axis integration so fast drops
      // never tunnel through floors/walls (frame hitches make dt large)
      d.vy = Math.max(-30, d.vy - GRAVITY * dt);
      const maxDisp = Math.max(Math.abs(d.vx), Math.abs(d.vy), Math.abs(d.vz)) * dt;
      const steps = Math.max(1, Math.ceil(maxDisp / 0.4));
      const sdt = dt / steps;
      let grounded = false;
      for (let s = 0; s < steps; s++) {
        const ny = d.y + d.vy * sdt;
        const sampleY = d.vy < 0 ? ny - 0.12 : ny + 0.12;
        const yCell = Math.floor(sampleY);
        const yDef = BLOCKS[world.getBlock(Math.floor(d.x), yCell, Math.floor(d.z))];
        // partial-height blocks (slabs) only catch below their actual top
        if (yDef.solid && sampleY < yCell + yDef.colHeight) {
          if (d.vy < 0) { d.y = yCell + yDef.colHeight + 0.12; grounded = true; }
          d.vy = 0;
        } else {
          d.y = ny;
        }
        const nx = d.x + d.vx * sdt;
        if (isSolid(world.getBlock(Math.floor(nx), Math.floor(d.y), Math.floor(d.z)))) d.vx = 0;
        else d.x = nx;
        const nz = d.z + d.vz * sdt;
        if (isSolid(world.getBlock(Math.floor(d.x), Math.floor(d.y), Math.floor(nz)))) d.vz = 0;
        else d.z = nz;
      }
      if (grounded) {
        d.vx *= Math.max(0, 1 - 8 * dt);
        d.vz *= Math.max(0, 1 - 8 * dt);
      }
      if (d.y < -40) { this._remove(i); continue; }

      // pickup: drift toward a living player, collect on contact. onPickup
      // returns how many were ACCEPTED — a full inventory keeps the rest on
      // the ground and backs off before retrying
      if (!player.dead && d.life > d.pickupDelay) {
        const px = player.pos.x - d.x, py = player.pos.y + 0.9 - d.y, pz = player.pos.z - d.z;
        const dist = Math.hypot(px, py, pz);
        if (dist < PICKUP_DIST && d.life >= d.retryAt) {
          const accepted = onPickup(d.id, d.qty, d.dur, d.mod);
          if (accepted >= d.qty) {
            this._remove(i);
            continue;
          }
          d.qty -= accepted;
          d.retryAt = d.life + 0.6;
        }
        if (dist < MAGNET_DIST) {
          const pull = 26 * dt / Math.max(dist, 0.3);
          d.vx += px * pull; d.vy += py * pull; d.vz += pz * pull;
        }
      }

      d.mesh.position.set(d.x, d.y + 0.12 + Math.sin(d.age * 2.4) * 0.05, d.z);
      d.mesh.rotation.y = d.age * 1.6;
    }
  }

  _remove(i) {
    const d = this.drops[i];
    this.scene.remove(d.mesh); // geometry is cached/shared — no dispose
    this.drops.splice(i, 1);
  }

  clear() {
    while (this.drops.length) this._remove(0);
  }
}

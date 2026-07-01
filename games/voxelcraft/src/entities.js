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

  spawn(x, y, z, id) {
    if (!BLOCKS[id]) return;
    if (this.drops.length >= MAX_DROPS) this._remove(0);
    const mesh = new THREE.Mesh(
      this._geometry(id),
      BLOCKS[id].kind === "cross" ? this.materials.cutout : this.materials.opaque
    );
    mesh.scale.setScalar(0.25);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.drops.push({
      id, mesh,
      x, y, z,
      vx: (Math.random() - 0.5) * 2.2,
      vy: 2.4 + Math.random() * 1.2,
      vz: (Math.random() - 0.5) * 2.2,
      age: Math.random() * 6, // desync the bob/spin phases
      life: 0,
    });
  }

  update(dt, world, player, onPickup) {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      d.life += dt;
      if (d.life > DESPAWN_SECONDS) { this._remove(i); continue; }

      // physics: gravity, rest on solid ground, horizontal friction
      d.vy -= GRAVITY * dt;
      const ny = d.y + d.vy * dt;
      if (d.vy < 0 && isSolid(world.getBlock(Math.floor(d.x), Math.floor(ny - 0.12), Math.floor(d.z)))) {
        d.vy = 0;
        d.y = Math.floor(ny - 0.12) + 1.12;
        d.vx *= Math.max(0, 1 - 8 * dt);
        d.vz *= Math.max(0, 1 - 8 * dt);
      } else {
        d.y = ny;
      }
      d.x += d.vx * dt;
      d.z += d.vz * dt;
      if (d.y < -40) { this._remove(i); continue; }

      // pickup: drift toward a living player, collect on contact
      if (!player.dead) {
        const px = player.pos.x - d.x, py = player.pos.y + 0.9 - d.y, pz = player.pos.z - d.z;
        const dist = Math.hypot(px, py, pz);
        if (dist < PICKUP_DIST) {
          onPickup(d.id);
          this._remove(i);
          continue;
        }
        if (dist < MAGNET_DIST && d.life > 0.5) {
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

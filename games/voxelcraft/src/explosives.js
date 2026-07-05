// The Blast Keg's second act: primed keg entities and the spherical
// demolition they end in. A primed keg is a real little thing in the world —
// it blinks ember-orange, ticks faster and faster, falls if its shelf is
// mined out, and finally hollows a ragged crater. Danger is real but polite:
// three whole seconds of announcement (see LORE.md).

import * as THREE from "three";
import {
  AIR, BEDROCK, WATER, CHEST, KILN, BLAST_KEG, DOOR,
  BLOCKS, isDoor, isDoorLower, isPlant, dropFor,
} from "./blocks.js";
import { buildBlockGeometry } from "./mesher.js";

const MAX_PRIMED = 16;     // simultaneous primed kegs (chain reactions!)
const FUSE_SECONDS = 3;
const RADIUS = 3.5;        // blast sphere radius in blocks
const MAX_BLOCKS = 400;    // destruction cap per explosion
const DROP_CHANCE = 0.3;   // destroyed blocks that pay out their drop
const MAX_DAMAGE = 12;     // HP at ground zero
const HURT_RANGE = 5.5;    // damage/knockback reach (a bit past the crater)
const KNOCKBACK = 11;
const GRAVITY = 14;        // kegs fall a little slower than a Wanderling

export class PrimedKegs {
  constructor(scene, materials, opts) {
    this.scene = scene;
    this.kegs = [];
    this.mobs = opts.mobs;
    this.onRemesh = opts.onRemesh;       // (chunks[], lightTouched)
    this.onSpawnDrop = opts.onSpawnDrop; // (x, y, z, id, qty)
    this.onTick = opts.onTick;           // fuse tick sfx
    this.onBoom = opts.onBoom;           // (x, y, z) boom sfx + particles
    this.geometry = buildBlockGeometry(BLAST_KEG, 0.35);
    this.geometry.translate(-0.5, -0.5, -0.5); // pulse around the keg center
    this.map = materials.opaque.uniforms.map.value; // shared atlas texture
  }

  canPrime() { return this.kegs.length < MAX_PRIMED; }

  // x/y/z: block coords of the (already removed) keg block. The material is
  // per-keg and unlit, so the fuse-pulse tint stays visible in cave dark.
  prime(x, y, z, fuse = FUSE_SECONDS) {
    if (!this.canPrime()) return false;
    const material = new THREE.MeshBasicMaterial({ map: this.map, vertexColors: true });
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    this.scene.add(mesh);
    this.kegs.push({
      x: x + 0.5, y, z: z + 0.5, // y is the keg's BOTTOM
      vy: 0, fuse, tickIn: 0, age: 0, mesh, material,
    });
    return true;
  }

  update(dt, world, player) {
    for (let i = this.kegs.length - 1; i >= 0; i--) {
      const k = this.kegs[i];
      // frozen while its chunk is missing — a blast must never chew on
      // ungenerated terrain (setBlock would refuse and the crater would lie)
      if (!world.isGenerated(Math.floor(k.x) >> 4, Math.floor(k.z) >> 4)) continue;
      k.age += dt;
      k.fuse -= dt;

      // small gravity: the keg drops until something solid catches it
      k.vy = Math.max(-20, k.vy - GRAVITY * dt);
      const ny = k.y + k.vy * dt;
      const floorCell = Math.floor(ny - 0.001);
      if (k.vy < 0 && BLOCKS[world.getBlock(Math.floor(k.x), floorCell, Math.floor(k.z))].solid) {
        k.y = floorCell + 1;
        k.vy = 0;
      } else {
        k.y = ny;
      }
      if (k.y < -8) { this._remove(i); continue; } // fizzles in the void

      // accelerating tick + blink: urgency you can hear and see
      k.tickIn -= dt;
      if (k.tickIn <= 0) {
        k.tickIn = Math.max(0.07, k.fuse * 0.22);
        if (this.onTick) this.onTick();
      }
      const hz = 3 + (FUSE_SECONDS - Math.max(0, k.fuse)) * 2.2;
      const flash = Math.sin(k.age * hz * Math.PI * 2) > 0;
      if (flash) k.material.color.setRGB(2.4, 1.5, 0.9);   // ember surge
      else k.material.color.setRGB(0.72, 0.7, 0.68);       // settles dark
      k.mesh.scale.setScalar(flash ? 1.08 : 0.98);
      k.mesh.position.set(k.x, k.y + 0.5, k.z);

      if (k.fuse <= 0) {
        this._remove(i);
        this._explode(k.x, k.y + 0.5, k.z, world, player);
      }
    }
  }

  _explode(ex, ey, ez, world, player) {
    const affected = new Set();
    const destroyedCells = [];
    let lightTouched = false;
    let destroyed = 0;
    const bx = Math.floor(ex), by = Math.floor(ey), bz = Math.floor(ez);
    const R = Math.ceil(RADIUS);

    // remove one cell: spills containers, tallies chunks/light, rolls the drop
    const wreck = (x, y, z, id, dropChance) => {
      if (id === CHEST || id === KILN) {
        // the blast is not a thief — contents spill as drops
        const key = `${x},${y},${z}`;
        const entry = id === CHEST ? world.chests.get(key) : world.kilns.get(key);
        const slots = id === CHEST ? entry : entry && entry.slots;
        if (slots) {
          for (const s of slots) {
            if (s) this.onSpawnDrop(x + 0.5, y + 0.6, z + 0.5, s.id, s.count);
          }
        }
        (id === CHEST ? world.chests : world.kilns).delete(key);
      }
      const chunks = world.setBlock(x, y, z, AIR);
      if (chunks.length === 0) return false; // ungenerated/out of world — untouched
      for (const c of chunks) affected.add(c);
      if (BLOCKS[id].lightEmit > 0) lightTouched = true; // a torch died here
      destroyed++;
      destroyedCells.push([x, y, z]);
      if (Math.random() < dropChance) {
        const d = dropFor(id);
        if (d !== null) this.onSpawnDrop(x + 0.5, y + 0.4, z + 0.5, d, 1);
      }
      return true;
    };

    outer:
    for (let dy = -R; dy <= R; dy++) {
      for (let dz = -R; dz <= R; dz++) {
        for (let dx = -R; dx <= R; dx++) {
          if (destroyed >= MAX_BLOCKS) break outer;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          // distance falloff with jitter: ragged crater edges, not a marble
          if (dist > RADIUS * (0.75 + Math.random() * 0.33)) continue;
          const x = bx + dx, y = by + dy, z = bz + dz;
          const id = world.getBlock(x, y, z);
          if (id === AIR || id === BEDROCK || id === WATER) continue;
          if (BLOCKS[id].hardness === Infinity) continue;
          if (id === BLAST_KEG) {
            // chain ignition: the neighbor keg lights with a short random
            // fuse — unless the cap is full, in which case it rudely survives
            if (!this.canPrime()) continue;
            const chunks = world.setBlock(x, y, z, AIR);
            if (chunks.length === 0) continue;
            for (const c of chunks) affected.add(c);
            this.prime(x, y, z, 0.3 + Math.random() * 0.5);
            continue;
          }
          if (isDoor(id)) {
            // both halves go together; at most one door item drops
            const lowerY = isDoorLower(id) ? y : y - 1;
            const lo = world.getBlock(x, lowerY, z);
            const up = world.getBlock(x, lowerY + 1, z);
            let any = false;
            if (isDoor(lo)) any = wreck(x, lowerY, z, lo, 0) || any;
            if (isDoor(up)) any = wreck(x, lowerY + 1, z, up, 0) || any;
            if (any && Math.random() < DROP_CHANCE) {
              this.onSpawnDrop(x + 0.5, lowerY + 0.4, z + 0.5, DOOR, 1);
            }
            continue;
          }
          wreck(x, y, z, id, DROP_CHANCE);
        }
      }
    }

    // pop plants left floating on destroyed ground (just outside the sphere)
    for (const [x, y, z] of destroyedCells) {
      const above = world.getBlock(x, y + 1, z);
      if (isPlant(above)) wreck(x, y + 1, z, above, DROP_CHANCE);
    }

    // hurt + throw the player. damage() self-guards creative mode, but the
    // shove applies in both — a blast is a blast. Knockback goes first so a
    // killing blow zeroes it (corpses don't fly).
    const px = player.pos.x - ex, py = player.pos.y + 0.9 - ey, pz = player.pos.z - ez;
    const pd = Math.hypot(px, py, pz);
    if (pd < HURT_RANGE && !player.dead) {
      const falloff = 1 - pd / HURT_RANGE;
      const n = Math.max(pd, 0.5);
      player.vel.x += (px / n) * KNOCKBACK * falloff;
      player.vel.y += Math.max(0.35, py / n) * KNOCKBACK * 0.8 * falloff;
      player.vel.z += (pz / n) * KNOCKBACK * falloff;
      player.damage(Math.max(1, Math.round(MAX_DAMAGE * falloff)), "a blast keg");
    }

    // mobs take the same falloff damage; deaths pay out in mobs.update
    if (this.mobs) {
      for (const m of this.mobs.mobs) {
        const mx = m.x - ex, my = m.y + m.spec.height * 0.5 - ey, mz = m.z - ez;
        const md = Math.hypot(mx, my, mz);
        if (md >= HURT_RANGE) continue;
        const falloff = 1 - md / HURT_RANGE;
        m.hp -= Math.max(1, Math.round(MAX_DAMAGE * falloff));
        m.hurtT = 0.3;
        const resist = 1 - (m.spec.knockResist || 0);
        const n = Math.max(md, 0.5);
        m.vx += (mx / n) * KNOCKBACK * falloff * resist;
        m.vy += Math.max(2, (my / n) * KNOCKBACK * falloff) * resist;
        m.vz += (mz / n) * KNOCKBACK * falloff * resist;
      }
    }

    if (this.onBoom) this.onBoom(ex, ey, ez);
    if (affected.size > 0) this.onRemesh([...affected], lightTouched);
  }

  _remove(i) {
    const k = this.kegs[i];
    this.scene.remove(k.mesh);
    k.material.dispose(); // geometry is shared; materials are per-keg
    this.kegs.splice(i, 1);
  }

  clear() { while (this.kegs.length) this._remove(0); }
}

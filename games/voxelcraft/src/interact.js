// Block targeting + editing: voxel raycast (DDA), highlight box, break/place
// with hold-repeat, pick-block, and break particles.

import * as THREE from "three";
import { AIR, BEDROCK, CHEST, BLOCKS, isSolid, dropFor } from "./blocks.js";
import { HEIGHT } from "./world.js";
import { EYE_HEIGHT } from "./player.js";

const REACH_CREATIVE = 5;
const REACH_SURVIVAL = 4.5;
const ACTION_REPEAT_MS = 240;

// Amanatides & Woo voxel traversal.
export function raycast(world, origin, dir, maxDist = REACH_CREATIVE) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = dir.x > 0 ? 1 : -1, stepY = dir.y > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
  const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;
  let tMaxX = dir.x !== 0 ? (dir.x > 0 ? (x + 1 - origin.x) : (origin.x - x)) * tDeltaX : Infinity;
  let tMaxY = dir.y !== 0 ? (dir.y > 0 ? (y + 1 - origin.y) : (origin.y - y)) * tDeltaY : Infinity;
  let tMaxZ = dir.z !== 0 ? (dir.z > 0 ? (z + 1 - origin.z) : (origin.z - z)) * tDeltaZ : Infinity;
  let normal = [0, 0, 0];
  let t = 0;

  while (t <= maxDist) {
    const id = world.getBlock(x, y, z);
    if (id !== AIR && BLOCKS[id].bucket !== "water") {
      return { x, y, z, id, normal, dist: t };
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      t = tMaxX; tMaxX += tDeltaX; x += stepX; normal = [-stepX, 0, 0];
    } else if (tMaxY < tMaxZ) {
      t = tMaxY; tMaxY += tDeltaY; y += stepY; normal = [0, -stepY, 0];
    } else {
      t = tMaxZ; tMaxZ += tDeltaZ; z += stepZ; normal = [0, 0, -stepZ];
    }
  }
  return null;
}

export class Interaction {
  constructor(world, player, scene, hotbar, opts) {
    this.world = world;
    this.player = player;
    this.scene = scene;
    this.hotbar = hotbar; // {selectedId()}
    this.onEdit = opts.onEdit;       // (affectedChunks, {ids}) => remesh now
    this.onSound = opts.onSound;     // (kind, blockId) => audio
    this.onPick = opts.onPick;       // (blockId) => set hotbar slot
    this.onSwing = opts.onSwing;     // () => held-item swing animation
    this.canConsume = opts.canConsume; // (id) => bool, takes from inventory (survival)
    this.onSpawnDrop = opts.onSpawnDrop; // (x, y, z, id) => item drop entity
    this.onOpenChest = opts.onOpenChest;   // (x, y, z) => open chest UI (survival)
    this.onChestBreak = opts.onChestBreak; // (x, y, z) => spill contents
    this.mobs = opts.mobs;           // Mobs instance (punching)
    this.avgColor = opts.avgColor;   // tile -> [r,g,b]

    this.target = null;
    this.buttons = new Set();
    this._nextAction = 0;
    this._lastBreakKey = null; // sweep-breaking: break as soon as target changes

    // survival mining state
    this._mineKey = null;
    this._mineProgress = 0;
    this._hitSoundTimer = 0;
    this.crack = new THREE.Mesh(
      new THREE.BoxGeometry(1.004, 1.004, 1.004),
      new THREE.MeshBasicMaterial({
        map: opts.crackTextures[0], transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -4,
      })
    );
    this.crackTextures = opts.crackTextures;
    this.crack.renderOrder = 3;
    this.crack.visible = false;
    scene.add(this.crack);

    const box = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(box),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 })
    );
    this.highlight.visible = false;
    scene.add(this.highlight);

    this.particles = new ParticleBurst(scene);
  }

  onMouseDown(button) {
    this.buttons.add(button);
    this._act(button);
    this._nextAction = performance.now() + ACTION_REPEAT_MS + 60;
  }
  onMouseUp(button) {
    this.buttons.delete(button);
    if (button === 0) this._lastBreakKey = null;
  }
  clearInput() { this.buttons.clear(); this._lastBreakKey = null; }

  update(dt) {
    if (this.player.dead) {
      this.target = null;
      this.highlight.visible = false;
      this.crack.visible = false;
      this.particles.update(dt);
      return;
    }

    const survival = this.player.mode === "survival";
    const eye = { x: this.player.pos.x, y: this.player.eyeY, z: this.player.pos.z };
    this.target = raycast(this.world, eye, this.player.lookDir(),
      survival ? REACH_SURVIVAL : REACH_CREATIVE);

    if (this.target) {
      this.highlight.visible = true;
      this.highlight.position.set(this.target.x + 0.5, this.target.y + 0.5, this.target.z + 0.5);
    } else {
      this.highlight.visible = false;
    }

    const now = performance.now();
    if (survival) {
      this._updateMining(dt);
      // place repeat still applies in survival
      if (this.buttons.has(2) && now >= this._nextAction) {
        this._place();
        this._nextAction = now + ACTION_REPEAT_MS;
      }
    } else {
      this.crack.visible = false;
      // creative: hold-to-repeat + sweep-breaking
      if (this.buttons.size > 0 && now >= this._nextAction) {
        for (const b of this.buttons) this._act(b);
        this._nextAction = now + ACTION_REPEAT_MS;
      } else if (this.buttons.has(0) && this.target) {
        const key = `${this.target.x},${this.target.y},${this.target.z}`;
        if (this._lastBreakKey !== null && key !== this._lastBreakKey) {
          this._break();
          this._nextAction = now + ACTION_REPEAT_MS;
        }
      }
    }

    this.particles.update(dt);
  }

  // survival: hold LMB on a block until its hardness timer completes
  _updateMining(dt) {
    const t = this.target;
    if (!this.buttons.has(0) || !t || BLOCKS[t.id].hardness === Infinity) {
      this._mineKey = null;
      this._mineProgress = 0;
      this.crack.visible = false;
      return;
    }
    const key = `${t.x},${t.y},${t.z}`;
    if (key !== this._mineKey) {
      this._mineKey = key;
      this._mineProgress = 0;
      this._hitSoundTimer = 0;
    }
    const hardness = BLOCKS[t.id].hardness;
    this._mineProgress += dt;

    this._hitSoundTimer -= dt;
    if (this._hitSoundTimer <= 0) {
      this._hitSoundTimer = 0.25;
      this.onSound("hit", t.id);
      if (this.onSwing) this.onSwing();
    }

    if (this._mineProgress >= hardness) {
      this._completeBreak(t);
      this._mineKey = null;
      this._mineProgress = 0;
      this.crack.visible = false;
      return;
    }

    const stage = Math.min(3, Math.floor((this._mineProgress / hardness) * 4));
    this.crack.material.map = this.crackTextures[stage];
    this.crack.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5);
    this.crack.visible = true;
  }

  // survival break: remove the block, spawn its drop (and the popped plant's)
  _completeBreak(t) {
    if (t.id === CHEST && this.onChestBreak) this.onChestBreak(t.x, t.y, t.z);
    const affected = this.world.setBlock(t.x, t.y, t.z, AIR);
    const above = this.world.getBlock(t.x, t.y + 1, t.z);
    let popped = null;
    if (above !== AIR && BLOCKS[above].kind === "cross") {
      popped = above;
      this.world.setBlock(t.x, t.y + 1, t.z, AIR);
    }
    this.onEdit(affected, { ids: [t.id, popped], x: t.x, y: t.y, z: t.z, broken: t.id, popped });
    this.onSound("break", t.id);
    this.particles.burst(t.x, t.y, t.z, this.avgColor[BLOCKS[t.id].tiles.side] || [0.5, 0.5, 0.5]);

    const drop = dropFor(t.id);
    if (drop !== null) this.onSpawnDrop(t.x + 0.5, t.y + 0.4, t.z + 0.5, drop);
    const rand = BLOCKS[t.id].randomDrop;
    if (rand && Math.random() < rand.chance) {
      this.onSpawnDrop(t.x + 0.5, t.y + 0.4, t.z + 0.5, rand.id);
    }
    if (popped !== null) {
      const plantDrop = dropFor(popped);
      if (plantDrop !== null) this.onSpawnDrop(t.x + 0.5, t.y + 1.3, t.z + 0.5, plantDrop);
    }
  }

  _act(button) {
    if ((this.target || button === 0) && this.onSwing) this.onSwing();
    // punching a mob takes priority over the block behind it
    if (button === 0 && this.mobs) {
      const eye = { x: this.player.pos.x, y: this.player.eyeY, z: this.player.pos.z };
      const reach = this.player.mode === "survival" ? REACH_SURVIVAL : REACH_CREATIVE;
      const maxDist = this.target ? this.target.dist : reach;
      if (this.mobs.punch(eye, this.player.lookDir(), Math.min(reach, maxDist), this.player.pos)) return;
    }
    // survival LMB is handled by the mining loop, not instant breaking
    if (button === 0 && this.player.mode !== "survival") this._break();
    else if (button === 1 && this.target) this.onPick(this.target.id);
    else if (button === 2) this._place();
  }

  _break() {
    const t = this.target;
    if (!t) return;
    if (t.id === BEDROCK) return; // the world floor is indestructible
    if (t.id === CHEST && this.onChestBreak) this.onChestBreak(t.x, t.y, t.z);
    this._lastBreakKey = `${t.x},${t.y},${t.z}`;
    const def = BLOCKS[t.id];
    const affected = this.world.setBlock(t.x, t.y, t.z, AIR);
    // breaking the support under a plant pops the plant too
    const above = this.world.getBlock(t.x, t.y + 1, t.z);
    let popped = null;
    if (above !== AIR && BLOCKS[above].kind === "cross") {
      popped = above;
      this.world.setBlock(t.x, t.y + 1, t.z, AIR);
    }
    this.onEdit(affected, { ids: [t.id, popped], x: t.x, y: t.y, z: t.z, broken: t.id, popped });
    this.onSound("break", t.id);
    this.particles.burst(t.x, t.y, t.z, this.avgColor[def.tiles.side] || [0.5, 0.5, 0.5]);
  }

  _place() {
    const t = this.target;
    if (!t) return;
    // right-click on a chest opens it (sneak to place against it instead)
    if (t.id === CHEST && this.player.mode === "survival" && !this.player._sneaking && this.onOpenChest) {
      this.onOpenChest(t.x, t.y, t.z);
      return;
    }
    const id = this.hotbar.selectedId();
    if (id === AIR) return;
    const def = BLOCKS[id];

    let px = t.x, py = t.y, pz = t.z;
    const targetDef = BLOCKS[t.id];
    // plants are replaceable in place; otherwise place against the hit face
    if (targetDef.kind !== "cross") {
      px += t.normal[0]; py += t.normal[1]; pz += t.normal[2];
    }
    const existing = this.world.getBlock(px, py, pz);
    if (existing !== AIR && BLOCKS[existing].kind !== "cross" && BLOCKS[existing].bucket !== "water") return;

    // don't place a solid block overlapping the player
    if (def.solid && this._overlapsPlayer(px, py, pz)) return;
    // plants need soil
    if (def.kind === "cross" && !isSolid(this.world.getBlock(px, py - 1, pz))) return;
    // setBlock silently fails outside the world or in an ungenerated chunk —
    // rule those out BEFORE consuming inventory
    if (py < 0 || py >= HEIGHT) return;
    const targetChunk = this.world.getChunk(px >> 4, pz >> 4);
    if (!targetChunk || !targetChunk.generated) return;
    // survival: consumes one from the inventory — last check, so a failed
    // placement never eats a block
    if (this.player.mode === "survival" && !this.canConsume(id)) return;
    // overwriting a plant/torch in survival pops its drop instead of
    // silently destroying it
    if (this.player.mode === "survival" && existing !== AIR && BLOCKS[existing].kind === "cross") {
      const plantDrop = dropFor(existing);
      if (plantDrop !== null) this.onSpawnDrop(px + 0.5, py + 0.3, pz + 0.5, plantDrop);
    }

    const affected = this.world.setBlock(px, py, pz, id);
    if (affected.length === 0) return;
    // include the replaced block: overwriting a torch must clear its light
    this.onEdit(affected, { ids: [id, existing], x: px, y: py, z: pz, placed: id });
    this.onSound("place", id);
  }

  _overlapsPlayer(bx, by, bz) {
    const a = this.player.aabb();
    return bx + 1 > a.minX && bx < a.maxX &&
           by + 1 > a.minY && by < a.maxY &&
           bz + 1 > a.minZ && bz < a.maxZ;
  }
}

// Small CPU-side particle burst for block breaking.
class ParticleBurst {
  constructor(scene, max = 240) {
    this.max = max;
    this.positions = new Float32Array(max * 3);
    this.velocities = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.12, vertexColors: true, sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  burst(bx, by, bz, color, count = 16) {
    for (let i = 0; i < count; i++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const j = idx * 3;
      this.positions[j] = bx + 0.2 + Math.random() * 0.6;
      this.positions[j + 1] = by + 0.2 + Math.random() * 0.6;
      this.positions[j + 2] = bz + 0.2 + Math.random() * 0.6;
      this.velocities[j] = (Math.random() - 0.5) * 3.4;
      this.velocities[j + 1] = Math.random() * 4 + 1;
      this.velocities[j + 2] = (Math.random() - 0.5) * 3.4;
      const shade = 0.75 + Math.random() * 0.4;
      this.colors[j] = color[0] * shade;
      this.colors[j + 1] = color[1] * shade;
      this.colors[j + 2] = color[2] * shade;
      this.life[idx] = 0.55;
    }
  }

  update(dt) {
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      const j = i * 3;
      this.velocities[j + 1] -= 14 * dt;
      this.positions[j] += this.velocities[j] * dt;
      this.positions[j + 1] += this.velocities[j + 1] * dt;
      this.positions[j + 2] += this.velocities[j + 2] * dt;
      if (this.life[i] <= 0) {
        this.positions[j + 1] = -1000; // park dead particles out of sight
      }
    }
    if (any) this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

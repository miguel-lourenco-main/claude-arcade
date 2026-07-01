// Block targeting + editing: voxel raycast (DDA), highlight box, break/place
// with hold-repeat, pick-block, and break particles.

import * as THREE from "three";
import { AIR, BEDROCK, BLOCKS, isSolid } from "./blocks.js";
import { EYE_HEIGHT } from "./player.js";

const REACH = 5;
const ACTION_REPEAT_MS = 240;

// Amanatides & Woo voxel traversal.
export function raycast(world, origin, dir, maxDist = REACH) {
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
    this.onEdit = opts.onEdit;       // (affectedChunks) => remesh now
    this.onSound = opts.onSound;     // (kind, blockId) => audio
    this.onPick = opts.onPick;       // (blockId) => set hotbar slot
    this.avgColor = opts.avgColor;   // tile -> [r,g,b]

    this.target = null;
    this.buttons = new Set();
    this._nextAction = 0;

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
  onMouseUp(button) { this.buttons.delete(button); }
  clearInput() { this.buttons.clear(); }

  update(dt) {
    const eye = { x: this.player.pos.x, y: this.player.eyeY, z: this.player.pos.z };
    this.target = raycast(this.world, eye, this.player.lookDir());

    if (this.target) {
      this.highlight.visible = true;
      this.highlight.position.set(this.target.x + 0.5, this.target.y + 0.5, this.target.z + 0.5);
    } else {
      this.highlight.visible = false;
    }

    // hold-to-repeat
    const now = performance.now();
    if (this.buttons.size > 0 && now >= this._nextAction) {
      for (const b of this.buttons) this._act(b);
      this._nextAction = now + ACTION_REPEAT_MS;
    }

    this.particles.update(dt);
  }

  _act(button) {
    if (button === 0) this._break();
    else if (button === 1 && this.target) this.onPick(this.target.id);
    else if (button === 2) this._place();
  }

  _break() {
    const t = this.target;
    if (!t) return;
    const def = BLOCKS[t.id];
    const affected = this.world.setBlock(t.x, t.y, t.z, AIR);
    // breaking the support under a plant pops the plant too
    const above = this.world.getBlock(t.x, t.y + 1, t.z);
    if (above !== AIR && BLOCKS[above].kind === "cross") {
      this.world.setBlock(t.x, t.y + 1, t.z, AIR);
    }
    this.onEdit(affected);
    this.onSound("break", t.id);
    this.particles.burst(t.x, t.y, t.z, this.avgColor[def.tiles.side] || [0.5, 0.5, 0.5]);
  }

  _place() {
    const t = this.target;
    if (!t) return;
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

    const affected = this.world.setBlock(px, py, pz, id);
    if (affected.length === 0) return;
    this.onEdit(affected);
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

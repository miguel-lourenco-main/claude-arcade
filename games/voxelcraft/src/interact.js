// Block targeting + editing: voxel raycast (DDA), highlight box, break/place
// with hold-repeat, pick-block, and break particles.

import * as THREE from "three";
import {
  AIR, BEDROCK, CHEST, WORKBENCH, KILN, BED, LADDER, DOOR, DOOR_TOP, BLAST_KEG,
  BLOCKS, isSolid, isPlant, isDoor, isDoorLower, DOOR_TOGGLE, dropFor,
} from "./blocks.js";
import { HEIGHT } from "./world.js";
import { EYE_HEIGHT, MAX_HUNGER } from "./player.js";

const REACH_CREATIVE = 5;
const REACH_SURVIVAL = 4.5;
const ACTION_REPEAT_MS = 240;
const EAT_SECONDS = 1.2;      // hold right-click this long to finish a bite
const CHEW_INTERVAL = 0.28;   // chewing sound cadence while eating

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
    this.onOpenBench = opts.onOpenBench;   // () => open workbench UI (survival)
    this.onOpenKiln = opts.onOpenKiln;     // (x, y, z) => open kiln UI (survival)
    this.onSleep = opts.onSleep;           // (x, y, z) => Moss Cot rest (survival)
    this.onPrimeKeg = opts.onPrimeKeg;     // (x, y, z) => light a Blast Keg
    this.onChestBreak = opts.onChestBreak; // (x, y, z) => spill contents
    this.onKilnBreak = opts.onKilnBreak;   // (x, y, z) => spill kiln slots
    this.onEat = opts.onEat;               // (kind) => chew/swallow sfx
    this.onDoor = opts.onDoor;             // (opened) => hinge-creak sfx
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

    // eating state (hold right-click on a food item)
    this.eating = false;
    this._eatProgress = 0;
    this._chewTimer = 0;
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
      this._updateEating(dt);
      // place repeat still applies in survival (eating owns the button)
      if (!this.eating && this.buttons.has(2) && now >= this._nextAction) {
        this._place();
        this._nextAction = now + ACTION_REPEAT_MS;
      }
    } else {
      this.crack.visible = false;
      this.eating = false;
      this._eatProgress = 0;
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

  // survival: hold RMB with a food item selected to eat it — a real per-frame
  // progress timer, not the coarse place-repeat cadence
  _updateEating(dt) {
    const id = this.hotbar.selectedId();
    const def = BLOCKS[id];
    // right-click on a chest/workbench/kiln/cot still routes, food in hand or not
    const t = this.target;
    const interactive = t &&
      (t.id === CHEST || t.id === WORKBENCH || t.id === KILN || t.id === BED ||
       t.id === BLAST_KEG || isDoor(t.id)) &&
      !this.player._sneaking;
    const wants = this.buttons.has(2) && def && def.food && !interactive &&
      this.player.hunger < MAX_HUNGER - 1e-9;
    if (!wants) {
      this.eating = false;
      this._eatProgress = 0;
      return;
    }
    if (!this.eating) {
      this.eating = true;
      this._eatProgress = 0;
      this._chewTimer = 0;
    }
    this._eatProgress += dt;
    this._chewTimer -= dt;
    if (this._chewTimer <= 0) {
      this._chewTimer = CHEW_INTERVAL;
      if (this.onEat) this.onEat("chew");
      if (this.onSwing) this.onSwing();
    }
    if (this._eatProgress >= EAT_SECONDS) {
      this._eatProgress = 0;
      // consume LAST: a failed take (stale slot) must not feed the player
      if (this.canConsume(id) && this.player.eat(def.food.restore)) {
        if (this.onEat) this.onEat("swallow");
      } else {
        this.eating = false;
      }
    }
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
    // a mob standing in front of the block absorbs the mining, MC-style —
    // otherwise the crack renders through the pig and the wall breaks
    if (this.mobs) {
      const eye = { x: this.player.pos.x, y: this.player.eyeY, z: this.player.pos.z };
      if (this.mobs.rayHit(eye, this.player.lookDir(), t.dist)) {
        this._mineKey = null;
        this._mineProgress = 0;
        this.crack.visible = false;
        return;
      }
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
    if (isDoor(t.id)) { this._breakDoor(t); return; }
    if (t.id === CHEST && this.onChestBreak) this.onChestBreak(t.x, t.y, t.z);
    if (t.id === KILN && this.onKilnBreak) this.onKilnBreak(t.x, t.y, t.z);
    const affected = this.world.setBlock(t.x, t.y, t.z, AIR);
    const above = this.world.getBlock(t.x, t.y + 1, t.z);
    let popped = null;
    if (isPlant(above)) {
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
    // punching a mob takes priority over the block behind it. Recompute the
    // block clamp with a FRESH raycast — this.target is from last frame's
    // camera direction and a flick+click could punch through a wall
    if (button === 0 && this.mobs) {
      const eye = { x: this.player.pos.x, y: this.player.eyeY, z: this.player.pos.z };
      const dir = this.player.lookDir();
      const reach = this.player.mode === "survival" ? REACH_SURVIVAL : REACH_CREATIVE;
      const block = raycast(this.world, eye, dir, reach);
      if (this.mobs.punch(eye, dir, block ? block.dist : reach, this.player.pos)) return;
    }
    // survival LMB is handled by the mining loop, not instant breaking
    if (button === 0 && this.player.mode !== "survival") this._break();
    else if (button === 1 && this.target) {
      // any door half picks as the one user-visible door item
      this.onPick(isDoor(this.target.id) ? DOOR : this.target.id);
    }
    else if (button === 2) this._place();
  }

  _break() {
    const t = this.target;
    if (!t) return;
    if (t.id === BEDROCK) return; // the world floor is indestructible
    this._lastBreakKey = `${t.x},${t.y},${t.z}`;
    if (isDoor(t.id)) { this._breakDoor(t); return; }
    if (t.id === CHEST && this.onChestBreak) this.onChestBreak(t.x, t.y, t.z);
    if (t.id === KILN && this.onKilnBreak) this.onKilnBreak(t.x, t.y, t.z);
    const def = BLOCKS[t.id];
    const affected = this.world.setBlock(t.x, t.y, t.z, AIR);
    // breaking the support under a plant pops the plant too
    const above = this.world.getBlock(t.x, t.y + 1, t.z);
    let popped = null;
    if (isPlant(above)) {
      popped = above;
      this.world.setBlock(t.x, t.y + 1, t.z, AIR);
    }
    this.onEdit(affected, { ids: [t.id, popped], x: t.x, y: t.y, z: t.z, broken: t.id, popped });
    this.onSound("break", t.id);
    this.particles.burst(t.x, t.y, t.z, this.avgColor[def.tiles.side] || [0.5, 0.5, 0.5]);
  }

  // breaking either door half removes both; survival drops ONE door item.
  // A plant standing on the (solid, closed) top half pops with it.
  _breakDoor(t) {
    const lowerY = isDoorLower(t.id) ? t.y : t.y - 1;
    const affected = new Set();
    const lower = this.world.getBlock(t.x, lowerY, t.z);
    const upper = this.world.getBlock(t.x, lowerY + 1, t.z);
    if (isDoor(lower)) for (const c of this.world.setBlock(t.x, lowerY, t.z, AIR)) affected.add(c);
    if (isDoor(upper)) for (const c of this.world.setBlock(t.x, lowerY + 1, t.z, AIR)) affected.add(c);
    if (affected.size === 0) return;
    const above = this.world.getBlock(t.x, lowerY + 2, t.z);
    let popped = null;
    if (isPlant(above)) {
      popped = above;
      for (const c of this.world.setBlock(t.x, lowerY + 2, t.z, AIR)) affected.add(c);
    }
    // popped is reported at the UPPER half's cell so main.js's sapling
    // bookkeeping (info.y + 1) stays true when the top half was the target
    this.onEdit([...affected], {
      ids: [t.id, popped], x: t.x, y: lowerY + 1, z: t.z, broken: t.id, popped,
    });
    this.onSound("break", t.id);
    this.particles.burst(t.x, t.y, t.z, this.avgColor[BLOCKS[t.id].tiles.side] || [0.5, 0.5, 0.5]);
    if (this.player.mode === "survival") {
      this.onSpawnDrop(t.x + 0.5, lowerY + 0.4, t.z + 0.5, DOOR);
      if (popped !== null) {
        const plantDrop = dropFor(popped);
        if (plantDrop !== null) this.onSpawnDrop(t.x + 0.5, lowerY + 2.3, t.z + 0.5, plantDrop);
      }
    }
  }

  // right-click on any door half: swap BOTH halves between open and closed.
  // Closing checks the player isn't standing in the doorway first.
  _toggleDoor(t) {
    const lowerY = isDoorLower(t.id) ? t.y : t.y - 1;
    const lower = this.world.getBlock(t.x, lowerY, t.z);
    const upper = this.world.getBlock(t.x, lowerY + 1, t.z);
    if (!isDoorLower(lower)) return; // orphaned half — nothing sane to toggle
    const opening = lower === DOOR; // closed now -> about to swing open
    if (!opening &&
        (this._overlapsPlayer(t.x, lowerY, t.z) || this._overlapsPlayer(t.x, lowerY + 1, t.z))) {
      return; // never slam the door shut on the Wanderling inside it
    }
    const affected = new Set();
    for (const c of this.world.setBlock(t.x, lowerY, t.z, DOOR_TOGGLE[lower])) affected.add(c);
    if (isDoor(upper) && !isDoorLower(upper)) {
      for (const c of this.world.setBlock(t.x, lowerY + 1, t.z, DOOR_TOGGLE[upper])) affected.add(c);
    }
    if (affected.size === 0) return;
    this.onEdit([...affected], {
      ids: [DOOR_TOGGLE[lower]], x: t.x, y: lowerY, z: t.z,
    });
    if (this.onDoor) this.onDoor(opening);
  }

  _place() {
    const t = this.target;
    if (!t) return;
    // right-click on a door toggles it — in BOTH modes (sneak to place against)
    if (isDoor(t.id) && !this.player._sneaking) {
      this._toggleDoor(t);
      return;
    }
    // right-click on a Blast Keg primes it — in BOTH modes, like the door
    // (sneak to place against it instead)
    if (t.id === BLAST_KEG && !this.player._sneaking && this.onPrimeKeg) {
      this.onPrimeKeg(t.x, t.y, t.z);
      return;
    }
    // right-click on a chest/workbench opens it (sneak to place against it)
    if (t.id === CHEST && this.player.mode === "survival" && !this.player._sneaking && this.onOpenChest) {
      this.onOpenChest(t.x, t.y, t.z);
      return;
    }
    if (t.id === WORKBENCH && this.player.mode === "survival" && !this.player._sneaking && this.onOpenBench) {
      this.onOpenBench();
      return;
    }
    if (t.id === KILN && this.player.mode === "survival" && !this.player._sneaking && this.onOpenKiln) {
      this.onOpenKiln(t.x, t.y, t.z);
      return;
    }
    if (t.id === BED && this.player.mode === "survival" && !this.player._sneaking && this.onSleep) {
      this.onSleep(t.x, t.y, t.z);
      return;
    }
    const id = this.hotbar.selectedId();
    if (id === AIR) return;
    const def = BLOCKS[id];
    // items (food etc.) can never be placed — not even in creative
    if (def.placeable === false) return;

    let px = t.x, py = t.y, pz = t.z;
    // plants are replaceable in place; otherwise place against the hit face
    // (sturdy crosses — ladders, open door halves — are never built over)
    if (!isPlant(t.id)) {
      px += t.normal[0]; py += t.normal[1]; pz += t.normal[2];
    }
    // a cell is buildable if it's air, a plant, or water
    const canReplace = (bid) => bid === AIR || isPlant(bid) || BLOCKS[bid].bucket === "water";
    const existing = this.world.getBlock(px, py, pz);
    if (!canReplace(existing)) return;

    // the door occupies TWO cells — hand it off to its own path
    if (id === DOOR) { this._placeDoor(px, py, pz, existing); return; }

    // don't place a solid block overlapping the player
    if (def.solid && this._overlapsPlayer(px, py, pz)) return;
    if (id === LADDER) {
      // ladders mount on walls: at least one solid horizontal neighbor
      if (!isSolid(this.world.getBlock(px + 1, py, pz)) &&
          !isSolid(this.world.getBlock(px - 1, py, pz)) &&
          !isSolid(this.world.getBlock(px, py, pz + 1)) &&
          !isSolid(this.world.getBlock(px, py, pz - 1))) return;
    } else if (def.kind === "cross" && !isSolid(this.world.getBlock(px, py - 1, pz))) {
      return; // plants need soil
    }
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
    this._popReplacedPlant(existing, px, py, pz);

    const affected = this.world.setBlock(px, py, pz, id);
    if (affected.length === 0) return;
    // include the replaced block: overwriting a torch must clear its light
    this.onEdit(affected, { ids: [id, existing], x: px, y: py, z: pz, placed: id });
    this.onSound("place", id);
  }

  _popReplacedPlant(existing, px, py, pz) {
    if (this.player.mode !== "survival" || !isPlant(existing)) return;
    const plantDrop = dropFor(existing);
    if (plantDrop !== null) this.onSpawnDrop(px + 0.5, py + 0.3, pz + 0.5, plantDrop);
  }

  // the Plank Door: needs its cell AND the one above free, plus a solid
  // floor; consumes ONE item and writes both halves
  _placeDoor(px, py, pz, existing) {
    if (py < 1 || py + 1 >= HEIGHT) return;
    const canReplace = (bid) => bid === AIR || isPlant(bid) || BLOCKS[bid].bucket === "water";
    const upperEx = this.world.getBlock(px, py + 1, pz);
    if (!canReplace(upperEx)) return;
    if (!isSolid(this.world.getBlock(px, py - 1, pz))) return; // solid floor
    if (this._overlapsPlayer(px, py, pz) || this._overlapsPlayer(px, py + 1, pz)) return;
    const targetChunk = this.world.getChunk(px >> 4, pz >> 4);
    if (!targetChunk || !targetChunk.generated) return;
    if (this.player.mode === "survival" && !this.canConsume(DOOR)) return;
    this._popReplacedPlant(existing, px, py, pz);
    this._popReplacedPlant(upperEx, px, py + 1, pz);

    const affected = new Set();
    for (const c of this.world.setBlock(px, py, pz, DOOR)) affected.add(c);
    for (const c of this.world.setBlock(px, py + 1, pz, DOOR_TOP)) affected.add(c);
    if (affected.size === 0) return;
    this.onEdit([...affected], {
      ids: [DOOR, existing, upperEx], x: px, y: py, z: pz, placed: DOOR,
    });
    this.onSound("place", DOOR);
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

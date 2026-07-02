// The Pearlfall: on clear nights the old sky sheds a few of its pearls.
// Streaks cross the dome at shallow angles, and once or twice a shower one
// dives all the way down and LANDS — a flash, a polite boom, a two-block
// crater, and a glowing STARSTONE seated at the middle of it.
//
// LORE.md: the stars are the drained ocean floor's old pearls, and what fell
// once as sky-iron still shakes loose in smaller, stranger pieces. Two house
// rules, both lore-load-bearing:
//   1. The sky is DONE hurting people. A landing never damages the player —
//      it keeps a respectful distance (>= 12 blocks) and knocks first.
//   2. The sky does not undo a Wanderling's work. If the crater bowl would
//      chew any player-edited cell, the cratering is skipped entirely (the
//      pearl still arrives, just without redecorating).
//
// Whether a given night gets a shower is seeded from (world seed, day), so
// every Wanderling in the same world sees the same sky. Shower state itself
// is transient — nothing here is saved; a landed starstone lives on in the
// world edit overlay like any other placed block.

import * as THREE from "three";
import { mulberry32 } from "./noise.js";
import { AIR, WATER, BEDROCK, STARSTONE, BLOCKS, isPlant, dropFor } from "./blocks.js";
import { HEIGHT, chunkKey, blockIndex } from "./world.js";

const SHOWER_CHANCE = 0.34;        // ~1 night in 3
const NIGHT_START = 0.55;          // sky.time window a shower may begin in
const NIGHT_END = 0.9;
const START_WINDOW = 0.04;         // ~24s of day-fraction to catch the start
const NIGHT_LIGHT = 0.35;          // below this the sky counts as night
const MAX_STREAKS = 7;             // ambient streaks alive at once
const DOME_R = 290;                // streak shell radius (inside the far plane)
const LAND_MIN = 20, LAND_MAX = 45; // landing distance band from the player
const LAND_KEEPOUT = 12;           // never land closer than this
const DIVE_SECONDS = 1.15;         // a landing streak's approach time
const FLASH_SECONDS = 0.45;

export class MeteorShowers {
  // opts: {world, player, onLand(chunks), onBoom(x,y,z), onSpawnDrop(x,y,z,id),
  //        onAnnounce(text)}
  constructor(scene, seed, opts) {
    this.scene = scene;
    this.seed = seed >>> 0;
    this.world = opts.world;
    this.player = opts.player;
    this.onLand = opts.onLand;
    this.onBoom = opts.onBoom;
    this.onSpawnDrop = opts.onSpawnDrop;
    this.onAnnounce = opts.onAnnounce;

    this.active = false;
    this.timer = 0;
    this.duration = 0;
    this.landIn = [];      // seconds-into-shower marks still owed a landing
    this._spawnIn = 0;
    this._plan = null;     // cached per-night plan {day, start, ...}

    this.streaks = [];     // ambient dome streaks (camera-relative coords)
    this.divers = [];      // landing streaks (world coords)
    this.flashes = [];     // impact glow sprites
    this.landings = [];    // [{x,y,z}] where starstone was placed (test hook)

    // the dome rig follows the camera like the sky's own (sky.js)
    this.rig = new THREE.Group();
    scene.add(this.rig);

    this._streakGeo = new THREE.PlaneGeometry(1, 1);
    this._streakTex = this._makeStreakTexture();
    this._flashTex = this._makeFlashTexture();
    this._flashMat = new THREE.SpriteMaterial({
      map: this._flashTex, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, fog: false,
    });

    // scratch vectors/matrix for the per-frame orientation math
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._m = new THREE.Matrix4();
  }

  // a bright elongated tail: transparent at the left, white-hot at the right
  // (the streak's head rides the +x end of the plane)
  _makeStreakTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 64; canvas.height = 8;
    const ctx = canvas.getContext("2d");
    const grad = ctx.createLinearGradient(0, 0, 64, 0);
    grad.addColorStop(0, "rgba(190,205,255,0)");
    grad.addColorStop(0.65, "rgba(205,218,255,0.45)");
    grad.addColorStop(0.92, "rgba(240,246,255,0.9)");
    grad.addColorStop(1, "rgba(255,255,255,1)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 8);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }

  _makeFlashTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext("2d");
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.35, "rgba(220,230,255,0.7)");
    grad.addColorStop(1, "rgba(180,200,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }

  _makeStreakMesh(len, width) {
    const mat = new THREE.MeshBasicMaterial({
      map: this._streakTex, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, fog: false,
      side: THREE.DoubleSide, opacity: 0,
    });
    const mesh = new THREE.Mesh(this._streakGeo, mat);
    mesh.scale.set(len, width, 1);
    mesh.renderOrder = 3; // over the cloud plane
    mesh.frustumCulled = false;
    return mesh;
  }

  // one plan per calendar night, seeded — deterministic in (seed, day)
  _planFor(day) {
    if (this._plan && this._plan.day === day) return this._plan;
    const rand = mulberry32((this.seed ^ Math.imul(day + 1, 0x85297a4d)) >>> 0);
    const falls = rand() < SHOWER_CHANCE;
    this._plan = {
      day,
      spent: false,
      start: falls ? NIGHT_START + rand() * (NIGHT_END - NIGHT_START) : -1,
      duration: 40 + rand() * 50, // the spec'd 40-90s
      landings: 1 + ((rand() * 3) | 0),
    };
    return this._plan;
  }

  _begin(duration, landings) {
    this.active = true;
    this.timer = 0;
    this.duration = duration;
    this._spawnIn = 0;
    // the first pearl comes down early (a shower announces its intentions);
    // the rest spread across the body of the shower
    this.landIn = [1.5 + Math.random() * 3];
    for (let i = 1; i < landings; i++) {
      this.landIn.push(4 + Math.random() * duration * 0.7);
    }
    this.landIn.sort((a, b) => a - b);
    if (this.onAnnounce) this.onAnnounce("Pearls shake loose from the old sky.");
  }

  // test/debug hook: begin a shower right now regardless of the night's plan
  // (landings still follow the normal targeting rules)
  forceShower(seconds) {
    this._begin(
      Number.isFinite(seconds) && seconds > 0 ? seconds : 40 + Math.random() * 50,
      1 + ((Math.random() * 3) | 0));
  }

  update(dt, sky, camera) {
    const night = sky.lightLevel < NIGHT_LIGHT;

    // natural trigger: the planned start, on a CLEAR night only. The window
    // is short, so a night rained (or slept) past its start simply keeps its
    // pearls — sky.rain < 0.2 is the "clear" the spec asks for.
    if (!this.active) {
      const plan = this._planFor(sky.day);
      if (plan.start >= 0 && !plan.spent && night && sky.rain < 0.2 &&
          sky.time >= plan.start && sky.time <= plan.start + START_WINDOW) {
        plan.spent = true;
        this._begin(plan.duration, plan.landings);
      }
    }

    if (this.active) {
      this.timer += dt;
      // rain rolling in mid-shower (or dawn) draws the curtain early. The
      // 1s grace matters: meteors update BEFORE the sky each frame, so a
      // test that jumps sky.time to night and calls forceShower in the same
      // frame would otherwise see one stale daylight reading and end at birth
      if (this.timer >= this.duration ||
          (this.timer > 1 && (sky.rain > 0.5 || !night))) {
        this.active = false;
        this.landIn.length = 0;
      } else {
        this._spawnIn -= dt;
        if (this._spawnIn <= 0 && this.streaks.length < MAX_STREAKS) {
          this._spawnIn = 0.18 + Math.random() * 0.5;
          this._spawnStreak();
        }
        while (this.landIn.length > 0 && this.timer >= this.landIn[0]) {
          this.landIn.shift();
          this._startDive();
        }
      }
    }

    if (this.streaks.length === 0 && this.divers.length === 0 &&
        this.flashes.length === 0) return;

    this.rig.position.copy(camera.position);

    // ambient dome streaks (camera-relative, like the sky rig's bodies)
    for (let i = this.streaks.length - 1; i >= 0; i--) {
      const s = this.streaks[i];
      s.age += dt;
      if (s.age >= s.life) { this._removeStreak(this.streaks, i, this.rig); continue; }
      s.pos.addScaledVector(s.vel, dt);
      s.mesh.position.copy(s.pos);
      s.mesh.material.opacity = Math.sin(Math.PI * (s.age / s.life)) * 0.9;
      this._orient(s.mesh, s.pos, s.vel);
    }

    // landing divers (world coords)
    for (let i = this.divers.length - 1; i >= 0; i--) {
      const d = this.divers[i];
      d.t += dt / DIVE_SECONDS;
      if (d.t >= 1) {
        this._removeStreak(this.divers, i, this.scene);
        this._impact(d);
        continue;
      }
      // a slight ease-in: the pearl commits as it comes
      const k = d.t * (0.6 + 0.4 * d.t);
      d.pos.copy(d.from).lerp(d.to, k);
      d.mesh.position.copy(d.pos);
      d.mesh.material.opacity = Math.min(1, d.t / 0.15);
      this._v1.copy(d.to).sub(d.from); // travel direction stands in for vel
      const rel = this._v2.copy(d.pos).sub(camera.position);
      this._orientWorld(d.mesh, rel, this._v1);
    }

    // impact flashes: a quick bloom that swallows itself
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.age += dt;
      if (f.age >= FLASH_SECONDS) {
        this.scene.remove(f.sprite);
        f.sprite.material.dispose();
        this.flashes.splice(i, 1);
        continue;
      }
      const k = f.age / FLASH_SECONDS;
      f.sprite.scale.setScalar(1.5 + k * 13);
      f.sprite.material.opacity = 1 - k;
    }
  }

  _removeStreak(list, i, parent) {
    const s = list[i];
    parent.remove(s.mesh);
    s.mesh.material.dispose(); // geometry + texture are shared
    list.splice(i, 1);
  }

  _spawnStreak() {
    // a point high on the dome, sliding sideways-and-down at a shallow angle
    const az = Math.random() * Math.PI * 2;
    const elev = 0.35 + Math.random() * 0.8; // ~20°-66° up
    const pos = new THREE.Vector3(
      Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev),
    ).multiplyScalar(DOME_R);
    // horizontal tangent around the dome, plus a modest downward slide
    const vel = new THREE.Vector3().crossVectors(pos, new THREE.Vector3(0, 1, 0))
      .normalize().multiplyScalar((Math.random() < 0.5 ? -1 : 1) * (55 + Math.random() * 55));
    vel.y = -(12 + Math.random() * 18);
    const mesh = this._makeStreakMesh(13 + Math.random() * 11, 1.1 + Math.random() * 0.6);
    mesh.position.copy(pos);
    this.rig.add(mesh);
    this.streaks.push({ mesh, pos, vel, age: 0, life: 1.1 + Math.random() * 0.9 });
  }

  // the surface cell a pearl would seat on: topmost solid block of the
  // column, or -1 for water/ungenerated ground (pearls that hit the old sea
  // are lost back to it)
  _surfaceAt(bx, bz) {
    if (!this.world.isGenerated(bx >> 4, bz >> 4)) return -1;
    for (let y = HEIGHT - 1; y > 0; y--) {
      const id = this.world.getBlock(bx, y, bz);
      if (id === WATER) return -1;
      if (BLOCKS[id].solid) return y;
    }
    return -1;
  }

  _startDive() {
    const p = this.player.pos;
    for (let attempt = 0; attempt < 12; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = LAND_MIN + Math.random() * (LAND_MAX - LAND_MIN);
      const bx = Math.floor(p.x + Math.cos(ang) * dist);
      const bz = Math.floor(p.z + Math.sin(ang) * dist);
      // the keep-out re-check guards the block-floor rounding above
      if (Math.hypot(bx + 0.5 - p.x, bz + 0.5 - p.z) < LAND_KEEPOUT) continue;
      const topY = this._surfaceAt(bx, bz);
      if (topY < 0) continue;
      const to = new THREE.Vector3(bx + 0.5, topY + 1, bz + 0.5);
      // approach from high up at a shallow-ish slant, azimuth random
      const az = Math.random() * Math.PI * 2;
      const elev = 0.6 + Math.random() * 0.4; // ~34°-57°
      const from = to.clone().add(new THREE.Vector3(
        Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev),
      ).multiplyScalar(60));
      const mesh = this._makeStreakMesh(11, 0.8);
      mesh.position.copy(from);
      this.scene.add(mesh);
      this.divers.push({ mesh, from, to, pos: from.clone(), t: 0, bx, topY, bz });
      return;
    }
    // no seat found (all water/ungenerated): this pearl passes overhead
  }

  _isEdited(x, y, z) {
    const overlay = this.world.edits.get(chunkKey(x >> 4, z >> 4));
    return !!overlay && overlay.has(blockIndex(x & 15, y, z & 15));
  }

  // test hook: land a pearl on the surface column at (x, z) right now
  impactAt(x, z) {
    const bx = Math.floor(x), bz = Math.floor(z);
    const topY = this._surfaceAt(bx, bz);
    if (topY < 0) return false;
    this._impact({ bx, topY, bz });
    return true;
  }

  _impact(d) {
    const { bx, topY, bz } = d;
    const world = this.world;
    if (!world.isGenerated(bx >> 4, bz >> 4)) return; // the ground left first

    if (this.onBoom) this.onBoom(bx + 0.5, topY + 1, bz + 0.5);
    const sprite = new THREE.Sprite(this._flashMat.clone());
    sprite.position.set(bx + 0.5, topY + 1.4, bz + 0.5);
    sprite.scale.setScalar(1.5);
    this.scene.add(sprite);
    this.flashes.push({ sprite, age: 0 });

    // NOTE: the landing never touches player.damage — the sky is done
    // hurting people (LORE.md). The keep-out band is politeness on top.

    const affected = new Set();

    // the crater bowl: the shallow shell within 1.4 of just above the
    // center — the center cell itself is the starstone's seat
    const cells = [];
    for (let dy = 0; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          if (Math.hypot(dx, dy - 0.5, dz) > 1.4) continue;
          cells.push([bx + dx, topY + dy, bz + dz]);
        }
      }
    }
    // the sky does not undo a Wanderling's work: ANY player edit in the
    // bowl (or under the seat) skips the cratering wholesale
    const edited = this._isEdited(bx, topY, bz) ||
      cells.some(([x, y, z]) => this._isEdited(x, y, z));
    if (!edited) {
      for (const [x, y, z] of cells) {
        const id = world.getBlock(x, y, z);
        if (id === AIR || id === WATER || id === BEDROCK) continue;
        if (BLOCKS[id].hardness === Infinity) continue;
        for (const c of world.setBlock(x, y, z, AIR)) affected.add(c);
        // crater debris vaporizes (no drops), but a plant perched on a
        // carved cell pops off honestly, drop and all
        const above = world.getBlock(x, y + 1, z);
        if (isPlant(above)) {
          for (const c of world.setBlock(x, y + 1, z, AIR)) affected.add(c);
          const drop = dropFor(above);
          if (drop !== null && this.onSpawnDrop) {
            this.onSpawnDrop(x + 0.5, y + 1.3, z + 0.5, drop);
          }
        }
      }
    }

    // seat the starstone at the center — or, if the center is spoken for (a
    // player edit, the World's Back), on the first open cell above instead
    let py = topY;
    const centerId = world.getBlock(bx, topY, bz);
    if (this._isEdited(bx, topY, bz) || centerId === BEDROCK ||
        BLOCKS[centerId].hardness === Infinity) {
      py = -1;
      for (let y = topY + 1; y <= Math.min(HEIGHT - 1, topY + 4); y++) {
        if (world.getBlock(bx, y, bz) === AIR) { py = y; break; }
      }
    }
    if (py >= 0) {
      for (const c of world.setBlock(bx, py, bz, STARSTONE)) affected.add(c);
      this.landings.push({ x: bx, y: py, z: bz });
    }

    if (affected.size > 0 && this.onLand) this.onLand([...affected]);
    if (this.onAnnounce) this.onAnnounce("Something of the old sky has come down nearby.", 3000);
  }

  // orient a camera-relative streak: long axis along its (screen-projected)
  // velocity, face toward the camera at the rig origin
  _orient(mesh, relPos, vel) {
    this._orientWorld(mesh, relPos, vel);
  }

  _orientWorld(mesh, rel, vel) {
    const view = this._v3.copy(rel).normalize();
    const along = this._v1.copy(vel).addScaledVector(view, -vel.dot(view));
    if (along.lengthSq() < 1e-6) along.set(1, 0, 0);
    along.normalize();
    const up = this._v2.crossVectors(view, along).normalize();
    this._m.makeBasis(along, up, view);
    mesh.quaternion.setFromRotationMatrix(this._m);
  }
}

// Passive mobs: blocky pigs that wander the surface, hop up single blocks,
// oink occasionally, and can be punched around (3 HP).

import * as THREE from "three";
import { GRASS, isSolid } from "./blocks.js";
import { mulberry32 } from "./noise.js";

const MAX_MOBS = 6;
const SPAWN_INTERVAL = 4;     // seconds between spawn attempts
const SPAWN_MIN = 18, SPAWN_MAX = 40;
const DESPAWN_DIST = 72;
const HALF_W = 0.35;
const MOB_HEIGHT = 0.85;
const WALK_SPEED = 1.5;
const GRAVITY = 32;
const HOP_SPEED = 8;          // enough for a 1-block step
const MAX_STEP = 0.4;         // collision substep displacement

function pigTexture(face) {
  const canvas = document.createElement("canvas");
  canvas.width = 16; canvas.height = 16;
  const ctx = canvas.getContext("2d");
  const rand = mulberry32(face ? 0x9161 : 0xf00d);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = (rand() * 2 - 1) * 10;
    ctx.fillStyle = `rgb(${236 + d},${160 + d},${168 + d})`;
    ctx.fillRect(x, y, 1, 1);
  }
  if (face) {
    // eyes + snout on the face tile
    ctx.fillStyle = "#1c1c28";
    ctx.fillRect(3, 5, 2, 2); ctx.fillRect(11, 5, 2, 2);
    ctx.fillStyle = "#d87f8c";
    ctx.fillRect(5, 9, 6, 4);
    ctx.fillStyle = "#7c3a44";
    ctx.fillRect(6, 10, 1, 2); ctx.fillRect(9, 10, 1, 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Mobs {
  constructor(scene) {
    this.scene = scene;
    this.mobs = [];
    this._spawnTimer = 0;

    // shared materials — tinted per-frame by day/night (mobs use unlit
    // materials; the sky tint keeps them from glowing at midnight)
    this.skinMat = new THREE.MeshBasicMaterial({ map: pigTexture(false) });
    this.faceMat = new THREE.MeshBasicMaterial({ map: pigTexture(true) });
    this._body = new THREE.BoxGeometry(0.62, 0.5, 0.95);
    this._head = new THREE.BoxGeometry(0.45, 0.45, 0.35);
    this._leg = new THREE.BoxGeometry(0.16, 0.32, 0.16);
  }

  setLight(level, tint) {
    const c = (mat) => mat.color.copy(tint).multiplyScalar(Math.min(1, level + 0.15));
    c(this.skinMat); c(this.faceMat);
  }

  _makePig() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(this._body, this.skinMat);
    body.position.y = 0.5;
    group.add(body);
    // face material on the +z side of the head
    const headMats = [this.skinMat, this.skinMat, this.skinMat, this.skinMat, this.faceMat, this.skinMat];
    const head = new THREE.Mesh(this._head, headMats);
    head.position.set(0, 0.62, 0.6);
    group.add(head);
    const legs = [];
    for (const [lx, lz] of [[-0.2, 0.32], [0.2, 0.32], [-0.2, -0.32], [0.2, -0.32]]) {
      const leg = new THREE.Mesh(this._leg, this.skinMat);
      leg.position.set(lx, 0.16, lz);
      group.add(leg);
      legs.push(leg);
    }
    return { group, legs };
  }

  spawnAt(x, y, z) {
    const { group, legs } = this._makePig();
    group.position.set(x, y, z);
    this.scene.add(group);
    this.mobs.push({
      group, legs,
      x, y, z,
      vx: 0, vy: 0, vz: 0,
      yaw: Math.random() * Math.PI * 2,
      state: "idle",
      stateT: 1 + Math.random() * 2,
      walkPhase: 0,
      hp: 3,
      hurtT: 0,
      oinkT: 4 + Math.random() * 10,
      onGround: false,
      hitWall: false,
    });
  }

  // spawn attempts on grass around the player; despawn when far
  _spawnDespawn(dt, world, player) {
    this._spawnTimer -= dt;
    if (this._spawnTimer <= 0 && this.mobs.length < MAX_MOBS) {
      this._spawnTimer = SPAWN_INTERVAL;
      const a = Math.random() * Math.PI * 2;
      const r = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
      const x = Math.floor(player.pos.x + Math.cos(a) * r);
      const z = Math.floor(player.pos.z + Math.sin(a) * r);
      if (world.isGenerated(x >> 4, z >> 4)) {
        // find the surface from above
        for (let y = 90; y > 2; y--) {
          const id = world.getBlock(x, y, z);
          if (id === 0) continue;
          if (id === GRASS) this.spawnAt(x + 0.5, y + 1.01, z + 0.5);
          break;
        }
      }
    }
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      if (Math.hypot(m.x - player.pos.x, m.z - player.pos.z) > DESPAWN_DIST) this._remove(i);
    }
  }

  update(dt, world, player, sfx) {
    this._spawnDespawn(dt, world, player);

    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      if (!world.isGenerated(Math.floor(m.x) >> 4, Math.floor(m.z) >> 4)) continue;

      if (m.hp <= 0) { this._remove(i); continue; }
      m.hurtT = Math.max(0, m.hurtT - dt);

      // wander AI
      m.stateT -= dt;
      if (m.stateT <= 0) {
        if (m.state === "idle") {
          m.state = "walk";
          m.stateT = 1 + Math.random() * 2;
          m.yaw = Math.random() * Math.PI * 2;
        } else {
          m.state = "idle";
          m.stateT = 1.5 + Math.random() * 2.5;
        }
      }
      const walking = m.state === "walk";
      const tx = walking ? Math.sin(m.yaw) * WALK_SPEED : 0;
      const tz = walking ? Math.cos(m.yaw) * WALK_SPEED : 0;
      m.vx += (tx - m.vx) * Math.min(1, 10 * dt);
      m.vz += (tz - m.vz) * Math.min(1, 10 * dt);
      m.vy = Math.max(-30, m.vy - GRAVITY * dt);

      this._move(world, m, dt);

      // hop up 1-block steps; give up on walls sometimes
      if (m.hitWall && m.onGround) {
        if (Math.random() < 0.8) m.vy = HOP_SPEED;
        else { m.yaw += Math.PI * (0.5 + Math.random()); m.stateT = Math.min(m.stateT, 0.6); }
      }

      // occasional oink when the player is near
      m.oinkT -= dt;
      if (m.oinkT <= 0) {
        m.oinkT = 6 + Math.random() * 10;
        if (Math.hypot(m.x - player.pos.x, m.z - player.pos.z) < 24) sfx.oink();
      }

      // presentation
      m.walkPhase += Math.hypot(m.vx, m.vz) * dt * 5;
      const swing = Math.sin(m.walkPhase) * 0.65;
      m.legs[0].rotation.x = swing; m.legs[3].rotation.x = swing;
      m.legs[1].rotation.x = -swing; m.legs[2].rotation.x = -swing;
      m.group.position.set(m.x, m.y, m.z);
      m.group.rotation.y = m.yaw;
      const flash = m.hurtT > 0 ? 1 : 0;
      m.group.scale.setScalar(1 + flash * 0.06);
    }
  }

  // substepped per-axis AABB collision (footprint 0.7, height 0.85)
  _move(world, m, dt) {
    const maxDisp = Math.max(Math.abs(m.vx), Math.abs(m.vy), Math.abs(m.vz)) * dt;
    const steps = Math.max(1, Math.ceil(maxDisp / MAX_STEP));
    const sdt = dt / steps;
    m.onGround = false;
    m.hitWall = false;
    for (let s = 0; s < steps; s++) {
      this._axis(world, m, "x", m.vx * sdt);
      this._axis(world, m, "z", m.vz * sdt);
      this._axis(world, m, "y", m.vy * sdt);
    }
  }

  _axis(world, m, axis, disp) {
    if (disp === 0) return;
    m[axis] += disp;
    const eps = 0.001;
    const x0 = Math.floor(m.x - HALF_W), x1 = Math.floor(m.x + HALF_W - eps);
    const y0 = Math.floor(m.y), y1 = Math.floor(m.y + MOB_HEIGHT - eps);
    const z0 = Math.floor(m.z - HALF_W), z1 = Math.floor(m.z + HALF_W - eps);
    for (let by = y0; by <= y1; by++) for (let bz = z0; bz <= z1; bz++) for (let bx = x0; bx <= x1; bx++) {
      if (!isSolid(world.getBlock(bx, by, bz))) continue;
      if (axis === "x") {
        m.x = disp > 0 ? bx - HALF_W - eps : bx + 1 + HALF_W + eps;
        m.vx = 0; m.hitWall = true;
      } else if (axis === "z") {
        m.z = disp > 0 ? bz - HALF_W - eps : bz + 1 + HALF_W + eps;
        m.vz = 0; m.hitWall = true;
      } else {
        if (disp > 0) m.y = by - MOB_HEIGHT - eps;
        else { m.y = by + 1 + eps; m.onGround = true; }
        m.vy = 0;
      }
      return;
    }
  }

  // ray vs mob AABBs (slab test); returns the nearest hit within maxDist
  rayHit(origin, dir, maxDist) {
    let best = null, bestT = maxDist;
    for (const m of this.mobs) {
      const min = [m.x - HALF_W, m.y, m.z - HALF_W];
      const max = [m.x + HALF_W, m.y + MOB_HEIGHT, m.z + HALF_W];
      const o = [origin.x, origin.y, origin.z];
      const d = [dir.x, dir.y, dir.z];
      let t0 = 0, t1 = bestT;
      let ok = true;
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
      if (ok && t0 < bestT) { best = m; bestT = t0; }
    }
    return best;
  }

  // punch: 1 damage + knockback away from the attacker
  punch(origin, dir, maxDist, fromPos) {
    const m = this.rayHit(origin, dir, maxDist);
    if (!m) return false;
    m.hp -= 1;
    m.hurtT = 0.3;
    const dx = m.x - fromPos.x, dz = m.z - fromPos.z;
    const len = Math.max(0.2, Math.hypot(dx, dz));
    m.vx += (dx / len) * 6;
    m.vz += (dz / len) * 6;
    m.vy = 5;
    this.onMobHurt?.();
    return true;
  }

  _remove(i) {
    this.scene.remove(this.mobs[i].group);
    this.mobs.splice(i, 1);
  }
}

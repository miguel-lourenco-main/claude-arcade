// First-person player: pointer-lock look, AABB voxel collision, walking /
// sprinting / sneaking / jumping / swimming / creative flight.

import { isSolid, WATER, CACTUS } from "./blocks.js";

const HALF_W = 0.3;
const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.62;

const GRAVITY = 32;
const TERMINAL_VELOCITY = 78;
const JUMP_SPEED = 8.95;          // ~1.25 block jump
const WALK_SPEED = 4.32;
const SPRINT_SPEED = 5.6;
const SNEAK_SPEED = 1.31;
const FLY_SPEED = 11;
const FLY_SPRINT_SPEED = 22;
const SWIM_SPEED = 2.2;
const SWIM_UP_MAX = 3.5;
const WATER_EXIT_BOOST = 6;       // upward kick when swimming into a bank
const MAX_STEP_DISP = 0.4;        // max movement per collision substep (anti-tunneling)
const STEP_DISTANCE = 2.2;        // blocks walked between footstep sounds

// survival ("normal") limitations
export const MAX_HEALTH = 20;     // 10 hearts
const AIR_SECONDS = 15;           // breath underwater before drowning
const FALL_SAFE = 3;              // blocks of fall that deal no damage (MC rule)
const REGEN_DELAY = 5;            // seconds after damage before regen starts
const REGEN_RATE = 0.5;           // HP per second (no hunger system, peaceful-style)

// horizontal acceleration (blocks/s²): crisp starts, crisper stops on ground,
// deliberately weaker steering in the air — replaces the old exponential
// velocity blend, whose long tail made stopping feel like gliding on ice
const ACCEL_GROUND = 70;
const FRICTION_GROUND = 50;
const ACCEL_AIR = 12;
const ACCEL_WATER = 16;
const ACCEL_FLY = 45;
const FRICTION_FLY = 80; // firm enough that sprint-fly (22 bl/s) stops in ~2 blocks


export class Player {
  constructor(world) {
    this.world = world;
    this.pos = { x: 0.5, y: 60, z: 0.5 }; // feet center
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0;    // radians, 0 = looking toward -z (north)
    this.pitch = 0;
    this.onGround = false;
    this.flying = false;
    this.sprinting = false;
    this.inWater = false;
    this.eyeInWater = false;
    // "camera": classic FPS movement, WASD relative to where you look.
    // "static": WASD along fixed world axes (W=north/-z), camera independent.
    this.moveMode = "camera";
    this.sensitivity = 1; // mouse-look multiplier (pause-menu setting)

    this.keys = new Set();
    this._lastSpaceTap = 0;
    this._lastForwardTap = 0;
    this._hitWall = false;      // horizontal collision this tick
    this._walked = 0;           // distance since last footstep
    this.onStep = null;         // (blockIdUnderfoot) => void

    // survival state ("creative" ignores all of it)
    this.mode = "creative";     // "creative" | "survival"
    this.health = MAX_HEALTH;
    this.air = AIR_SECONDS;
    this.dead = false;
    this.onDamage = null;       // (amount, cause) => void
    this.onDeath = null;        // (cause) => void
    this._peakY = 0;            // highest point of the current fall
    this._sinceDamage = 999;
    this._drownTimer = 0;
    this._cactusTimer = 0;
    this._voidTimer = 0;
  }

  get maxAir() { return AIR_SECONDS; }

  damage(amount, cause) {
    if (this.mode !== "survival" || this.dead || amount <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this._sinceDamage = 0;
    if (this.onDamage) this.onDamage(amount, cause);
    if (this.health <= 0) {
      this.dead = true;
      this.vel.x = this.vel.y = this.vel.z = 0;
      this.clearInput();
      if (this.onDeath) this.onDeath(cause);
    }
  }

  respawn(spawnPoint) {
    Object.assign(this.pos, spawnPoint);
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.health = MAX_HEALTH;
    this.air = AIR_SECONDS;
    this.dead = false;
    this.flying = false;
    this._peakY = this.pos.y;
    this._sinceDamage = 999;
  }

  get eyeY() { return this.pos.y + EYE_HEIGHT; }

  lookDir() {
    const cp = Math.cos(this.pitch);
    return {
      x: -Math.sin(this.yaw) * cp,
      y: Math.sin(this.pitch),
      z: -Math.cos(this.yaw) * cp,
    };
  }

  onMouseMove(dx, dy) {
    // pointer lock can emit huge spurious deltas on fast flicks — clamp them,
    // or one bad event whips the camera to a random heading
    const MAX_DELTA = 300;
    dx = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, dx));
    dy = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, dy));
    const k = 0.0023 * this.sensitivity;
    this.yaw -= dx * k;
    // keep yaw wrapped so it never accumulates float error over long sessions
    if (this.yaw > Math.PI) this.yaw -= 2 * Math.PI;
    else if (this.yaw < -Math.PI) this.yaw += 2 * Math.PI;
    this.pitch -= dy * k;
    const lim = Math.PI / 2 - 0.001;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  onKeyDown(code) {
    if (code === "Space" && this.mode !== "survival") { // no flight in survival
      const now = performance.now();
      if (now - this._lastSpaceTap < 260) {
        this.flying = !this.flying;
        this.vel.y = 0;
        this._lastSpaceTap = 0;
      } else {
        this._lastSpaceTap = now;
      }
    }
    // double-tap-to-sprint: W in camera mode; any movement key in static
    // mode (there W only ever means north, so sprint must arm from all four)
    const sprintKeys = this.moveMode === "static"
      ? ["KeyW", "KeyA", "KeyS", "KeyD"] : ["KeyW"];
    if (sprintKeys.includes(code)) {
      const now = performance.now();
      if (now - (this._lastMoveTap?.[code] || 0) < 300 && !this.keys.has(code)) {
        this.sprinting = true;
      }
      (this._lastMoveTap ??= {})[code] = now;
    }
    this.keys.add(code);
  }

  onKeyUp(code) {
    this.keys.delete(code);
    if (this.moveMode === "static") {
      // sprint ends when all movement input is released
      if (!["KeyW", "KeyA", "KeyS", "KeyD"].some((k) => this.keys.has(k))) {
        this.sprinting = false;
      }
    } else if (code === "KeyW") {
      this.sprinting = false;
    }
  }

  clearInput() { this.keys.clear(); this.sprinting = false; }

  update(dt) {
    if (this.dead) return;
    this._updateWaterState();

    const forward = (this.keys.has("KeyW") ? 1 : 0) - (this.keys.has("KeyS") ? 1 : 0);
    const strafe = (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0);
    const sneaking = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    const jumping = this.keys.has("Space");

    // wanted horizontal velocity in world space.
    // forward = (-sin yaw, -cos yaw); right = (cos yaw, -sin yaw) — the strafe
    // z-term is NEGATIVE sin, or A/D invert when facing east/west
    let dirX, dirZ;
    if (this.moveMode === "camera") {
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      dirX = -sin * forward + cos * strafe;
      dirZ = -cos * forward - sin * strafe;
    } else {
      // world-static: the camera can look anywhere, movement stays on the grid
      dirX = strafe;
      dirZ = -forward;
    }
    const len = Math.hypot(dirX, dirZ);
    if (len > 1) { dirX /= len; dirZ /= len; }

    // sprint needs actual movement input: forward in camera mode, any
    // direction in static mode
    const sprintInput = this.moveMode === "static"
      ? (forward !== 0 || strafe !== 0) : forward > 0;
    let speed;
    if (this.flying) speed = this.sprinting ? FLY_SPRINT_SPEED : FLY_SPEED;
    else if (this.inWater) speed = SWIM_SPEED;
    else if (sneaking) speed = SNEAK_SPEED;
    else if (this.sprinting && sprintInput) speed = SPRINT_SPEED;
    else speed = WALK_SPEED;
    this.sprintActive = speed === SPRINT_SPEED || (this.flying && this.sprinting);

    // linear acceleration toward the wanted velocity, applied as a VECTOR
    // approach (not per-axis): a rotating camera swings the target around
    // without bleeding speed, and stops stay firm
    const hasInput = forward !== 0 || strafe !== 0;

    if (this.flying) {
      // omnidirectional flight: forward follows the full look direction, so
      // looking down + W descends; strafe stays horizontal; Space/Shift
      // remain direct up/down. (Static mode keeps its grid semantics.)
      const up = (jumping ? 1 : 0) - (sneaking ? 1 : 0);
      let tx, ty, tz;
      if (this.moveMode === "camera") {
        const look = this.lookDir();
        const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
        tx = look.x * forward + rx * strafe;
        ty = look.y * forward + up;
        tz = look.z * forward + rz * strafe;
      } else {
        tx = dirX; ty = up; tz = dirZ;
      }
      const len = Math.hypot(tx, ty, tz);
      if (len > 1) { tx /= len; ty /= len; tz /= len; }
      const accel = ((hasInput || up !== 0) ? ACCEL_FLY : FRICTION_FLY) * dt;
      const dvx = tx * speed - this.vel.x;
      const dvy = ty * speed - this.vel.y;
      const dvz = tz * speed - this.vel.z;
      const d = Math.hypot(dvx, dvy, dvz);
      if (d > 1e-9) {
        const s = Math.min(1, accel / d);
        this.vel.x += dvx * s; this.vel.y += dvy * s; this.vel.z += dvz * s;
      }
    } else {
      const accel = (this.inWater ? ACCEL_WATER
        : this.onGround ? (hasInput ? ACCEL_GROUND : FRICTION_GROUND)
        : ACCEL_AIR) * dt;
      const dvx = dirX * speed - this.vel.x;
      const dvz = dirZ * speed - this.vel.z;
      const d = Math.hypot(dvx, dvz);
      if (d > 1e-9) {
        const s = Math.min(1, accel / d);
        this.vel.x += dvx * s; this.vel.z += dvz * s;
      }

      if (this.inWater) {
        this.vel.y -= 4 * dt;                      // gentle sink
        if (jumping) this.vel.y += 16 * dt;        // swim up
        this.vel.y = Math.max(-3, Math.min(SWIM_UP_MAX, this.vel.y));
        // swimming against a bank while pressing up/forward: boost out of the
        // water (exempt from the swim clamp, or the ledge is never clearable)
        if (jumping && (this._hitWall || this.onGround) && hasInput) {
          this.vel.y = WATER_EXIT_BOOST;
        }
      } else {
        this.vel.y -= GRAVITY * dt;
        if (this.vel.y < -TERMINAL_VELOCITY) this.vel.y = -TERMINAL_VELOCITY;
        if (jumping && this.onGround) {
          this.vel.y = JUMP_SPEED;
          this.onGround = false;
        }
      }
    }

    this._sneaking = sneaking;
    const wasAirborne = !this.onGround;
    this._moveWithCollisions(dt);
    if (this.flying && this.onGround) this.flying = false;

    if (this.mode === "survival") this._updateSurvival(dt, wasAirborne);

    // footsteps
    if (this.onGround && !this.inWater) {
      this._walked += Math.hypot(this.vel.x, this.vel.z) * dt;
      if (this._walked > STEP_DISTANCE) {
        this._walked = 0;
        if (this.onStep) {
          const below = this.world.getBlock(
            Math.floor(this.pos.x), Math.floor(this.pos.y - 0.5), Math.floor(this.pos.z));
          this.onStep(below);
        }
      }
    } else {
      this._walked = STEP_DISTANCE * 0.6; // land into a quick step
    }
  }

  // survival-only hazards: fall damage, drowning, cactus, void, slow regen
  _updateSurvival(dt, wasAirborne) {
    this._sinceDamage += dt;

    // fall damage: MC rule, damage = blocks fallen minus 3
    if (this.flying || this.inWater) {
      this._peakY = this.pos.y;
    } else if (!this.onGround) {
      this._peakY = Math.max(this._peakY, this.pos.y);
    } else {
      if (wasAirborne) {
        const fall = this._peakY - this.pos.y;
        // round, not floor: the landing snap leaves feet a hair above the
        // block top, which would shave 1 HP off every integer-height fall
        if (fall > FALL_SAFE + 0.5) this.damage(Math.round(fall - FALL_SAFE), "fall");
      }
      this._peakY = this.pos.y;
    }

    // drowning: air runs out, then 1 heart per second
    if (this.eyeInWater) {
      this.air = Math.max(0, this.air - dt);
      if (this.air <= 0) {
        this._drownTimer += dt;
        if (this._drownTimer >= 1) { this._drownTimer -= 1; this.damage(2, "drowning"); }
      }
    } else {
      this.air = Math.min(AIR_SECONDS, this.air + dt * 4);
      this._drownTimer = 0;
    }

    // cactus contact
    this._cactusTimer -= dt;
    if (this._cactusTimer <= 0 && this._touchesCactus()) {
      this._cactusTimer = 0.5;
      this.damage(1, "cactus");
    }

    // the void
    if (this.pos.y < -5) {
      this._voidTimer += dt;
      if (this._voidTimer >= 0.5) { this._voidTimer -= 0.5; this.damage(4, "the void"); }
    } else {
      this._voidTimer = 0;
    }

    // passive regen (no hunger system — peaceful-style)
    if (!this.dead && this.health < MAX_HEALTH && this._sinceDamage > REGEN_DELAY) {
      this.health = Math.min(MAX_HEALTH, this.health + REGEN_RATE * dt);
    }
  }

  _touchesCactus() {
    const p = this.pos, pad = 0.08;
    const x0 = Math.floor(p.x - HALF_W - pad), x1 = Math.floor(p.x + HALF_W + pad);
    const y0 = Math.floor(p.y - 0.05), y1 = Math.floor(p.y + PLAYER_HEIGHT);
    const z0 = Math.floor(p.z - HALF_W - pad), z1 = Math.floor(p.z + HALF_W + pad);
    for (let by = y0; by <= y1; by++) for (let bz = z0; bz <= z1; bz++) for (let bx = x0; bx <= x1; bx++) {
      if (this.world.getBlock(bx, by, bz) === CACTUS) return true;
    }
    return false;
  }

  _updateWaterState() {
    const w = this.world;
    const { x, y, z } = this.pos;
    const feet = w.getBlock(Math.floor(x), Math.floor(y + 0.2), Math.floor(z));
    const torso = w.getBlock(Math.floor(x), Math.floor(y + 0.9), Math.floor(z));
    this.inWater = feet === WATER || torso === WATER;
    this.eyeInWater = w.getBlock(Math.floor(x), Math.floor(this.eyeY), Math.floor(z)) === WATER;
  }

  _moveWithCollisions(dt) {
    const dispX = this.vel.x * dt, dispY = this.vel.y * dt, dispZ = this.vel.z * dt;
    const maxDisp = Math.max(Math.abs(dispX), Math.abs(dispY), Math.abs(dispZ));
    const steps = Math.max(1, Math.ceil(maxDisp / MAX_STEP_DISP));
    const wasOnGround = this.onGround;
    this.onGround = false;
    this._hitWall = false;
    for (let i = 0; i < steps; i++) {
      this._moveAxis("x", dispX / steps, wasOnGround);
      this._moveAxis("z", dispZ / steps, wasOnGround);
      this._moveAxis("y", dispY / steps, wasOnGround);
    }
  }

  // any solid block directly under the AABB (with a small tolerance)
  _hasSupport() {
    const p = this.pos;
    const y = Math.floor(p.y - 0.05);
    const x0 = Math.floor(p.x - HALF_W), x1 = Math.floor(p.x + HALF_W - 0.001);
    const z0 = Math.floor(p.z - HALF_W), z1 = Math.floor(p.z + HALF_W - 0.001);
    for (let bz = z0; bz <= z1; bz++) for (let bx = x0; bx <= x1; bx++) {
      if (isSolid(this.world.getBlock(bx, y, bz))) return true;
    }
    return false;
  }

  _moveAxis(axis, disp, wasOnGround) {
    if (disp === 0) return;
    const p = this.pos;
    const before = p[axis];
    p[axis] += disp;

    // sneak edge-guard: never walk off a ledge while sneaking
    if (axis !== "y" && this._sneaking && wasOnGround && !this.flying && !this.inWater) {
      if (!this._hasSupport()) {
        p[axis] = before;
        this.vel[axis] = 0;
        return;
      }
    }

    const minX = p.x - HALF_W, maxX = p.x + HALF_W;
    const minY = p.y, maxY = p.y + PLAYER_HEIGHT;
    const minZ = p.z - HALF_W, maxZ = p.z + HALF_W;
    const eps = 0.001;

    const x0 = Math.floor(minX), x1 = Math.floor(maxX - eps);
    const y0 = Math.floor(minY), y1 = Math.floor(maxY - eps);
    const z0 = Math.floor(minZ), z1 = Math.floor(maxZ - eps);

    for (let by = y0; by <= y1; by++) {
      for (let bz = z0; bz <= z1; bz++) {
        for (let bx = x0; bx <= x1; bx++) {
          if (!isSolid(this.world.getBlock(bx, by, bz))) continue;
          if (axis === "x") {
            p.x = disp > 0 ? bx - HALF_W - eps : bx + 1 + HALF_W + eps;
            this.vel.x = 0;
            this._hitWall = true;
          } else if (axis === "z") {
            p.z = disp > 0 ? bz - HALF_W - eps : bz + 1 + HALF_W + eps;
            this.vel.z = 0;
            this._hitWall = true;
          } else {
            if (disp > 0) {
              p.y = by - PLAYER_HEIGHT - eps;
            } else {
              p.y = by + 1 + eps;
              this.onGround = true;
            }
            this.vel.y = 0;
          }
          return;
        }
      }
    }
  }

  // AABB used to block placing solid blocks inside the player
  aabb() {
    return {
      minX: this.pos.x - HALF_W, maxX: this.pos.x + HALF_W,
      minY: this.pos.y, maxY: this.pos.y + PLAYER_HEIGHT,
      minZ: this.pos.z - HALF_W, maxZ: this.pos.z + HALF_W,
    };
  }
}

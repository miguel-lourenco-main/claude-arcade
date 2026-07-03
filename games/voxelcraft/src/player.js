// First-person player: pointer-lock look, AABB voxel collision, walking /
// sprinting / sneaking / jumping / swimming / creative flight.

import {
  BLOCKS, isSolid, WATER, CACTUS, LADDER, ICE, SNOW_LAYER, armorProtection,
} from "./blocks.js";

const HALF_W = 0.3;
const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.62;

const GRAVITY = 32;
const TERMINAL_VELOCITY = 78;
const JUMP_SPEED = 8.95;          // ~1.25 block jump
const WALK_SPEED = 4.32;
const SPRINT_SPEED = 6.7;         // 1.55x walk — a real commitment of hunger
const SNEAK_SPEED = 1.31;
const FLY_SPEED = 11;
const FLY_SPRINT_SPEED = 22;
const SWIM_SPEED = 2.2;
const SWIM_SPRINT_SPEED = 3.9;
const SWIM_UP_MAX = 3.5;
const WATER_EXIT_BOOST = 6;       // upward kick when swimming into a bank
const LADDER_CLIMB = 2.3;         // blocks/s up (forward/jump) or down (sneak)
const LADDER_SLIDE = 0.8;         // idle drift down the rungs
const LADDER_SIDE_SPEED = 2.0;    // damped horizontal shuffle while gripping
const MAX_STEP_DISP = 0.4;        // max movement per collision substep (anti-tunneling)
const STEP_DISTANCE = 2.2;        // blocks walked between footstep sounds

// survival ("normal") limitations
export const MAX_HEALTH = 20;     // 10 hearts
export const MAX_HUNGER = 20;     // 10 bowls
const AIR_SECONDS = 15;           // breath underwater before drowning
const FALL_SAFE = 3;              // blocks of fall that deal no damage (MC rule)
const REGEN_DELAY = 5;            // seconds after damage before regen starts
const REGEN_RATE = 0.5;           // HP per second, gated on a well-fed satchel
const REGEN_MIN_HUNGER = 18;      // regen only while this fed or better
const REGEN_HUNGER_COST = 0.4;    // hunger spent per HP healed
const HUNGER_PASSIVE = 0.02;      // hunger per second while doing anything
const HUNGER_SPRINT = 0.06;       // extra while sprinting (total 0.08 = 4x walking)
const HUNGER_JUMP = 0.12;         // hunger per jump
const SPRINT_JUMP_EXTRA = 0.2;    // additional cost of a jump taken at a sprint
const SPRINT_MIN_HUNGER = 3;      // too hungry to run: sprint needs hunger > this
const STARVE_INTERVAL = 2.5;      // seconds between starvation ticks at 0 hunger

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
    this.sprinting = false;   // the double-tap latch (hold keys bypass it)
    this.isEating = null;     // () => bool hook — main.js wires interact.eating
    this.inWater = false;
    this.eyeInWater = false;
    this.onLadder = false;
    // riding a Reed Skiff: the boat entity that owns this player's physics
    // (boats.js seats, drives, and dismounts; update() suspends everything)
    this.riding = null;
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
    // respawn anchor set by sleeping in a Moss Cot: {x, y, z} feet position on
    // top of the bed, or null for the world spawn. main.js validates the bed
    // still stands before using it (and clears it when the cot is broken).
    this.spawnPoint = null;
    this.health = MAX_HEALTH;
    this.hunger = MAX_HUNGER;
    this.air = AIR_SECONDS;
    this.dead = false;
    this.onDamage = null;       // (amount, cause) => void
    this.onDeath = null;        // (cause) => void
    // the 4 wear slots (main.js owns the array; the Satchel window edits it).
    // Entries are stacks {id, count: 1, dur?} or null, in WEAR_KINDS order.
    this.wear = null;
    this.onArmorBreak = null;   // (blockId) => a worn piece shattered
    this.onArmorWear = null;    // () => dur ticked down on the worn set
    this._peakY = 0;            // highest point of the current fall
    this._sinceDamage = 999;
    this._drownTimer = 0;
    this._cactusTimer = 0;
    this._voidTimer = 0;
    this._starveTimer = 0;
  }

  get maxAir() { return AIR_SECONDS; }

  damage(amount, cause) {
    if (this.mode !== "survival" || this.dead || amount <= 0) return;
    amount = this._absorb(amount, cause);
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

  // worn armor absorbs a fraction of PHYSICAL damage (mob hits, spines,
  // cactus, keg blasts, falls) — drowning, starvation, and the void go
  // straight through the plate. Falls use armorProtection's reduced formula
  // (25% value, treads in full — see blocks.js). Every absorbing hit costs
  // 1 dur on EACH worn piece (they all contributed); a piece at 0 shatters
  // out of its wear slot. Death never touches the wear slots — the set keeps
  // protecting after a respawn (there is no death-drop in the Upturn).
  _absorb(amount, cause) {
    const wear = this.wear;
    if (!wear) return amount;
    if (cause === "drowning" || cause === "starvation" || cause === "the void") {
      return amount;
    }
    const red = armorProtection(wear, cause === "fall");
    if (red <= 0) return amount;
    for (let i = 0; i < wear.length; i++) {
      const s = wear[i];
      const a = s && BLOCKS[s.id] ? BLOCKS[s.id].armor : null;
      if (!a) continue;
      const left = (Number.isInteger(s.dur) ? s.dur : a.maxDur) - 1;
      if (left <= 0) {
        wear[i] = null;
        if (this.onArmorBreak) this.onArmorBreak(s.id);
      } else {
        s.dur = left;
      }
    }
    if (this.onArmorWear) this.onArmorWear();
    return amount * (1 - red);
  }

  respawn(spawnPoint) {
    this.riding = null; // death unseats — the skiff stays where it was
    Object.assign(this.pos, spawnPoint);
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.health = MAX_HEALTH;
    this.hunger = MAX_HUNGER;
    this.air = AIR_SECONDS;
    this.dead = false;
    this.flying = false;
    this._peakY = this.pos.y;
    this._sinceDamage = 999;
  }

  // forget any fall in progress — must be called on every non-physics
  // relocation (teleport, mode switch, safety net) or the next landing
  // computes fall damage from the stale peak
  resetFall() { this._peakY = this.pos.y; }

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

    // riding a skiff: all physics is the boat's problem (boats.js moves the
    // seat and reads WASD/Sneak itself). No swimming, no hunger drain, no
    // fall — a seated Wanderling exerts nothing. Space does nothing here.
    if (this.riding) {
      this._sneaking = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
      this.sprintActive = false; // no pounding down the bench — FOV settles
      this.vel.x = this.vel.y = this.vel.z = 0;
      this.onGround = false;
      this._peakY = this.pos.y;
      this._sinceDamage += dt;
      if (!this.eyeInWater) { // catching breath on the bench
        this.air = Math.min(AIR_SECONDS, this.air + dt * 4);
      }
      return;
    }

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
    // sprint intent: the double-tap latch OR a held sprint key. A too-empty
    // satchel (hunger <= 3, survival) both blocks it and drops the latch, so
    // running yourself hungry ends the sprint until you eat back over the line
    const holdSprint = this.keys.has("CapsLock") || this.keys.has("ControlLeft");
    const starvedOut = this.mode === "survival" && this.hunger <= SPRINT_MIN_HUNGER;
    if (starvedOut) this.sprinting = false;
    // sneaking and eating suppress the sprint without dropping the latch —
    // release the crouch mid-run and the stride picks right back up
    const wantSprint = (this.sprinting || holdSprint) && !starvedOut &&
      !sneaking && !(this.isEating && this.isEating());
    let speed;
    if (this.flying) speed = wantSprint ? FLY_SPRINT_SPEED : FLY_SPEED;
    else if (this.inWater) speed = wantSprint && sprintInput ? SWIM_SPRINT_SPEED : SWIM_SPEED;
    else if (sneaking) speed = SNEAK_SPEED;
    else if (wantSprint && sprintInput) speed = SPRINT_SPEED;
    else speed = WALK_SPEED;
    this.sprintActive = speed === SPRINT_SPEED || speed === SWIM_SPRINT_SPEED ||
      (this.flying && wantSprint);

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
    } else if (this.onLadder) {
      // ladder grip (Wanderling hand-feet were made for this): gravity is
      // suspended; forward/jump climbs, sneak descends, idle drifts down a
      // slow slide; horizontal movement is damped to a shuffle
      const accel = (hasInput ? ACCEL_GROUND : FRICTION_GROUND) * 0.5 * dt;
      const side = Math.min(speed, LADDER_SIDE_SPEED);
      const dvx = dirX * side - this.vel.x;
      const dvz = dirZ * side - this.vel.z;
      const d = Math.hypot(dvx, dvz);
      if (d > 1e-9) {
        const s = Math.min(1, accel / d);
        this.vel.x += dvx * s; this.vel.z += dvz * s;
      }
      if (forward > 0 || jumping) this.vel.y = LADDER_CLIMB;
      else if (sneaking) this.vel.y = -LADDER_CLIMB;
      else this.vel.y = Math.max(-LADDER_SLIDE, this.vel.y - GRAVITY * dt);
    } else if (this.inWater) {
      // swimming follows the camera: look down + forward dives, look up
      // surfaces — Space/Shift still push straight up/down
      const up = (jumping ? 1 : 0) - (sneaking ? 1 : 0);
      let tx, ty, tz;
      if (this.moveMode === "camera") {
        const look = this.lookDir();
        const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
        tx = look.x * forward + rx * strafe;
        ty = look.y * forward;
        tz = look.z * forward + rz * strafe;
      } else {
        tx = dirX; ty = 0; tz = dirZ;
      }
      ty += up * 0.9;
      const len = Math.hypot(tx, ty, tz);
      if (len > 1) { tx /= len; ty /= len; tz /= len; }
      const accel = ACCEL_WATER * dt;
      const dvx = tx * speed - this.vel.x;
      const dvy = ty * speed - this.vel.y;
      const dvz = tz * speed - this.vel.z;
      const d = Math.hypot(dvx, dvy, dvz);
      if (d > 1e-9) {
        const s = Math.min(1, accel / d);
        this.vel.x += dvx * s; this.vel.y += dvy * s; this.vel.z += dvz * s;
      }
      if (!hasInput && up === 0) {
        this.vel.y = Math.max(-1.2, this.vel.y - 3 * dt); // idle sink
      }
      this.vel.y = Math.max(-4.2, Math.min(Math.max(SWIM_UP_MAX, speed), this.vel.y));
      // boost out of the water at a bank: the jump path works from the
      // bottom too, but the look-up path REQUIRES an actual wall — otherwise
      // wading through shallow water while looking up pogo-launches forever
      if (((jumping && (this._hitWall || this.onGround)) || (ty > 0.2 && this._hitWall)) &&
          (hasInput || jumping)) {
        this.vel.y = WATER_EXIT_BOOST;
      }
    } else {
      // frost-country footing: River Glass halves traction (starts and stops
      // alike — the slide), a Snowdrift drags the stride to 0.9x
      let traction = 1, stride = 1;
      if (this.onGround) {
        const fx = Math.floor(this.pos.x), fz = Math.floor(this.pos.z);
        const below = this.world.getBlock(fx, Math.floor(this.pos.y - 0.05), fz);
        // the feet cell too: standing ON a drift puts the feet INSIDE its
        // cell (y = cell + 0.12), so the below-probe alone can miss it
        const feet = this.world.getBlock(fx, Math.floor(this.pos.y + 0.05), fz);
        if (below === ICE) traction = 0.5;
        else if (below === SNOW_LAYER || feet === SNOW_LAYER) stride = 0.9;
      }
      const accel = (this.onGround ? (hasInput ? ACCEL_GROUND : FRICTION_GROUND) * traction
        : ACCEL_AIR) * dt;
      const dvx = dirX * speed * stride - this.vel.x;
      const dvz = dirZ * speed * stride - this.vel.z;
      const d = Math.hypot(dvx, dvz);
      if (d > 1e-9) {
        const s = Math.min(1, accel / d);
        this.vel.x += dvx * s; this.vel.z += dvz * s;
      }
      this.vel.y -= GRAVITY * dt;
      if (this.vel.y < -TERMINAL_VELOCITY) this.vel.y = -TERMINAL_VELOCITY;
      if (jumping && this.onGround) {
        this.vel.y = JUMP_SPEED;
        this.onGround = false;
        if (this.mode === "survival") {
          // a jump taken at a sprint costs extra — bunny-hopping is fast
          // but it eats
          this.hunger = Math.max(0, this.hunger -
            (HUNGER_JUMP + (this.sprintActive ? SPRINT_JUMP_EXTRA : 0)));
        }
      }
    }

    this._sneaking = sneaking;
    const wasAirborne = !this.onGround;
    this._moveWithCollisions(dt);
    if (this.flying && this.onGround) this.flying = false;

    if (this.mode === "survival") {
      // re-sample water at the post-move position: a fast landing into
      // shallow water must count as a water landing
      this._updateWaterState();
      this._updateSurvival(dt, wasAirborne);
    } else {
      this._peakY = this.pos.y; // creative can never leave a stale fall peak
    }

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

    // fall damage: MC rule, damage = blocks fallen minus 3 (a gripped ladder
    // is as safe as water — no fall accumulates through it)
    if (this.flying || this.inWater || this.onLadder) {
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

    // hunger drain: nothing while standing perfectly still, a slow burn
    // while doing anything, extra while sprinting (jumps charge separately)
    const idle = Math.hypot(this.vel.x, this.vel.z) < 0.05 && Math.abs(this.vel.y) < 0.05;
    if (!idle) {
      let drain = HUNGER_PASSIVE;
      if (this.sprintActive) drain += HUNGER_SPRINT;
      this.hunger = Math.max(0, this.hunger - drain * dt);
    }

    // starvation: an empty satchel gnaws down to (never below) half a heart
    if (this.hunger <= 0) {
      this._starveTimer += dt;
      if (this._starveTimer >= STARVE_INTERVAL) {
        this._starveTimer -= STARVE_INTERVAL;
        if (this.health > 1) this.damage(Math.min(1, this.health - 1), "starvation");
      }
    } else {
      this._starveTimer = 0;
    }

    // passive regen: requires a well-fed Wanderling, and healing costs food
    if (!this.dead && this.health < MAX_HEALTH && this._sinceDamage > REGEN_DELAY &&
        this.hunger >= REGEN_MIN_HUNGER) {
      const heal = Math.min(REGEN_RATE * dt, MAX_HEALTH - this.health);
      this.health += heal;
      this.hunger = Math.max(0, this.hunger - heal * REGEN_HUNGER_COST);
    }
  }

  // eat a food item: restore hunger (clamped). Returns false at full hunger.
  eat(restore) {
    if (this.hunger >= MAX_HUNGER - 1e-9) return false;
    this.hunger = Math.min(MAX_HUNGER, this.hunger + restore);
    return true;
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
    // ladder grip is sampled exactly like water: feet or torso in a rung cell
    this.onLadder = feet === LADDER || torso === LADDER;
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
    // scan one row BELOW the feet too: tall blocks (fence/gate, colHeight
    // 1.5) reach into the cell above them — a jumper at +1.2 must still hit
    // the fence standing in the cell underneath. The `minY >= top` check
    // below skips that row for every normal-height block.
    const y0 = Math.floor(minY) - 1, y1 = Math.floor(maxY - eps);
    const z0 = Math.floor(minZ), z1 = Math.floor(maxZ - eps);

    // Downward Y sweeps clamp to the HIGHEST overlapped block top, not the
    // first cell found (the scan runs bottom-up): a fast fall can cross a
    // Snowdrift's 0.12 shell AND its support block in one substep, and
    // clamping to the support would leave the feet embedded in the drift.
    let landTop = -Infinity;

    for (let by = y0; by <= y1; by++) {
      for (let bz = z0; bz <= z1; bz++) {
        for (let bx = x0; bx <= x1; bx++) {
          const bDef = BLOCKS[this.world.getBlock(bx, by, bz)];
          if (!bDef.solid) continue;
          // partial-height blocks (slabs) only collide up to their colHeight:
          // feet at or above the block top means no overlap at all
          const top = by + bDef.colHeight;
          if (minY >= top - eps) continue;
          if (axis === "x" || axis === "z") {
            // auto-step onto low blocks (colHeight <= 0.5): a slab's half rise
            // is walked, not jumped — but only from the ground, moving level
            // or down, and only when the lifted AABB is fully clear
            if (wasOnGround && !this.flying && bDef.colHeight <= 0.5 &&
                this.vel.y <= 0.01 && top - p.y <= 0.5 + eps &&
                !this._boxCollides(p.x, top + eps, p.z)) {
              p.y = top + eps;
              this.onGround = true;
              return;
            }
            if (axis === "x") {
              p.x = disp > 0 ? bx - HALF_W - eps : bx + 1 + HALF_W + eps;
              this.vel.x = 0;
            } else {
              p.z = disp > 0 ? bz - HALF_W - eps : bz + 1 + HALF_W + eps;
              this.vel.z = 0;
            }
            this._hitWall = true;
          } else {
            if (disp > 0) {
              p.y = by - PLAYER_HEIGHT - eps;
              this.vel.y = 0;
            } else {
              // don't resolve yet — a taller partial block (a drift's shell
              // above its support) may still be found later in the scan
              landTop = Math.max(landTop, top);
              continue;
            }
          }
          return;
        }
      }
    }
    if (landTop > -Infinity) {
      p.y = landTop + eps; // stand ON the block's real top (slab: +0.5, drift: +0.12)
      this.onGround = true;
      this.vel.y = 0;
    }
  }

  // does the player AABB, moved to (px, py, pz), intersect any solid block?
  // Uses per-block colHeight — the auto-step clearance test.
  _boxCollides(px, py, pz) {
    const eps = 0.001;
    const x0 = Math.floor(px - HALF_W), x1 = Math.floor(px + HALF_W - eps);
    // one row below the feet: tall blocks (colHeight > 1) reach up here
    const y0 = Math.floor(py) - 1, y1 = Math.floor(py + PLAYER_HEIGHT - eps);
    const z0 = Math.floor(pz - HALF_W), z1 = Math.floor(pz + HALF_W - eps);
    for (let by = y0; by <= y1; by++) for (let bz = z0; bz <= z1; bz++) for (let bx = x0; bx <= x1; bx++) {
      const d = BLOCKS[this.world.getBlock(bx, by, bz)];
      if (d.solid && py < by + d.colHeight - eps) return true;
    }
    return false;
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

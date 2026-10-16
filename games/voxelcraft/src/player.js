// First-person player: pointer-lock look, AABB voxel collision, walking /
// sprinting / sneaking / jumping / swimming / creative flight.

import {
  BLOCKS, isSolid, WATER, LAVA, isFluid, CACTUS, LADDER, ICE, SNOW_LAYER,
  MUD, armorProtection,
} from "./blocks.js";
import { wearSkips, tideCarries } from "./loom.js";

const HALF_W = 0.3;
const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.62;
// the crouch: sneaking folds a Wanderling down — the eye drops and the
// hitbox shortens to fit under a slab-high ceiling (a 1.5 gap; the box is a
// hair under so the landing epsilon still fits it). Standing back up waits
// for the headroom; the eye eases rather than snapping.
export const CROUCH_HEIGHT = 1.49;
export const CROUCH_EYE_DROP = 0.35; // eye 1.62 -> 1.27 at a full crouch
const CROUCH_EASE = 14;              // per-second easing of the eye

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
const LADDER_CLIMB = 2.3;         // blocks/s up (forward/jump) or down (back)
const LADDER_SLIDE = 0.8;         // idle drift down the rungs (sneak grips: none)
const LADDER_SIDE_SPEED = 2.0;    // damped horizontal shuffle while gripping
const MAX_STEP_DISP = 0.4;        // max movement per collision substep (anti-tunneling)
const STEP_DISTANCE = 2.2;        // blocks walked between footstep sounds

// the Whims: timed statuses worn briefly (see LORE.md). The table is the
// whole framework — a whim is an id, a display name, and at most a speed
// multiplier; the timed behaviors (Emberglow's regen, Mire-rot's gnaw,
// Kelpguard's damage shave) live in _updateSurvival/damage below.
export const EFFECTS = {
  fleetfoot: { name: "Fleetfoot", speed: 1.3 },   // Sunwisp Broth
  emberglow: { name: "Emberglow" },               // Emberbell Broth: quiet regen
  mirerot: { name: "Mire-rot" },                  // the Mirewalker's gift
  kelpguard: { name: "Kelpguard" },               // Kelpsalve: damage shave + cure
  dimmed: { name: "Dimmed", speed: 0.6 },         // the dark leaning on you
  tidebreath: { name: "Tidebreath" },             // Tidebreath Broth: sea-lungs
};
const EMBERGLOW_INTERVAL = 2.5;  // seconds per healed heart-half
const MIREROT_INTERVAL = 2;      // seconds per gnawed heart-half
const KELPGUARD_SHAVE = 0.8;     // incoming damage multiplier

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
const HUNGER_SPRINT = 0.05;       // extra while sprinting (total 0.07 = 3.5x walking)
const HUNGER_JUMP = 0.06;         // hunger per jump (was 0.12: hopping starved you)
const SPRINT_JUMP_EXTRA = 0.1;    // additional cost of a jump taken at a sprint
const SPRINT_MIN_HUNGER = 3;      // too hungry to run: sprint needs hunger > this
const STARVE_INTERVAL = 2.5;      // seconds between starvation ticks at 0 hunger
// saturation: a hidden buffer that every exertion drains BEFORE hunger moves.
// Food grants it alongside its restore; it can never exceed the current
// hunger (a full belly can only be so full). No HUD shows it — the hearty
// foods say so in their description text instead (blocks.js `desc`).
export const FOOD_SATURATION_RATIO = 0.3; // a food with no stated saturation
const SATURATION_START = 5;       // a fresh (or respawned) Wanderling's buffer

// the saturation a food def grants (blocks.js food.saturation, else a light
// default from its restore)
export function saturationOf(food) {
  if (!food) return 0;
  return Number.isFinite(food.saturation)
    ? Math.max(0, food.saturation)
    : food.restore * FOOD_SATURATION_RATIO;
}

// horizontal acceleration (blocks/s²): crisp starts, crisper stops on ground,
// deliberately weaker steering in the air — replaces the old exponential
// velocity blend, whose long tail made stopping feel like gliding on ice
const ACCEL_GROUND = 70;
const FRICTION_GROUND = 50;
const ACCEL_AIR = 12;
const ACCEL_WATER = 16;
const ACCEL_FLY = 45;
const FRICTION_FLY = 80; // firm enough that sprint-fly (22 bl/s) stops in ~2 blocks

// --- the Wanderwing's glide (see LORE.md + blocks.js) ------------------------
// Hold Space while falling with a Wanderwing worn: the fall slows to a gentle
// terminal and forward speed accrues, steered by the camera. Pitch trades
// height for speed — nose down to dive (faster, steeper), nose up to flare
// (bleed speed, a breath of lift). Every value here is blocks/second or a
// per-second easing rate.
const GLIDE_FALL = 2.5;         // level descent rate — the advertised terminal
const GLIDE_DIVE_SINK = 12;     // extra descent at a full nose-down dive
const GLIDE_FLARE_LIFT = 4;     // upward push at a full nose-up flare
const GLIDE_VY_EASE = 3.5;      // how quickly vy chases its target
const GLIDE_FWD_MAX = 11;       // the level cruise the forward speed accrues to
const GLIDE_DIVE_FWD = 5;       // forward-speed bonus at a full dive
const GLIDE_FLARE_BLEED = 6;    // forward speed shed at a full flare
const GLIDE_FWD_EASE = 1.6;     // how quickly the forward speed accrues
const GLIDE_FWD_CAP = 17;       // a hard lid, so a long dive can't run away
const GLIDE_TURN_EASE = 3.2;    // how hard the camera heading steers the track
const GLIDE_SECONDS_PER_DUR = 2.5; // glide seconds spent per point of wing wear
const GLIDE_SAFE_LAND = 12;     // impact speed below this lands clean
const GLIDE_IMPACT_FACTOR = 0.5;// the wing absorbs most of a hard slam
const GLIDE_BOOST = 8;          // a Festival Rocket's mid-glide thrust (bl/s)
const GLIDE_BOOST_CAP = 16;     // the ceiling a boost can raise cruise to


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
    this.inWater = false;     // any FLUID at feet/torso (water or Emberwash)
    this.inLava = false;      // specifically the Emberwash — it burns
    this.eyeInWater = false;  // water only: drowning + underwater fog
    this.eyeInLava = false;   // molten over the eyes — burns like contact
    this.onLadder = false;
    // the crouch: `crouched` is the hitbox state (held while sneaking, and
    // kept while the ceiling is too low to stand); `crouch` eases 0..1 and
    // drives the eye height and the third-person sink
    this.crouched = false;
    this.crouch = 0;
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
    this.saturation = SATURATION_START; // hidden; drains before hunger
    this.air = AIR_SECONDS;
    this.dead = false;
    this.onDamage = null;       // (amount, cause) => void
    this.onDeath = null;        // (cause) => void
    // the 4 wear slots (main.js owns the array; the Satchel window edits it).
    // Entries are stacks {id, count: 1, dur?} or null, in WEAR_KINDS order.
    this.wear = null;
    this.onArmorBreak = null;   // (blockId) => a worn piece shattered
    this.onArmorWear = null;    // () => dur ticked down on the worn set
    // the Wanderwing's glide (see the GLIDE_* constants): a soft latch — it
    // arms while falling with Space held and a wing worn, and holds through a
    // flare's brief climb until Space releases, the ground arrives, or the
    // wing frays. `_glideSpeed` is the accrued forward speed it steers.
    this.gliding = false;
    this._glideSpeed = 0;
    this._glideDurTimer = 0;
    this.onGlideFray = null;    // (blockId) => the wing frayed mid-air
    this.onGlideWear = null;    // () => a glide-second ticked the wing's dur
    // the Whims: effect id -> seconds left. Survival-only (mode switches
    // and respawns clear it); persisted as an additive save field.
    this.effects = new Map();
    this.onEffectStart = null;  // (id) => a whim newly took hold (HUD note)
    this._glowTimer = 0;
    this._rotTimer = 0;
    this._peakY = 0;            // highest point of the current fall
    this._sinceDamage = 999;
    this._drownTimer = 0;
    this._lavaTimer = 0;
    this._cactusTimer = 0;
    this._voidTimer = 0;
    this._starveTimer = 0;
  }

  // the Tide Thread (loom.js): do the worn treads know the water? Swim pace
  // and the Mire Sod stride both ask. WEAR_KINDS order puts treads last.
  _tideThread() {
    return tideCarries(this.wear && this.wear[3]);
  }

  // the Nacre Crown's gift (armor.tide): the wearer's lungs remember the
  // sea, and the air meter doubles. A getter, so the HUD, the drown timer,
  // and the refill clamp all agree the moment the crown goes on or off.
  get maxAir() {
    for (const s of this.wear || []) {
      const a = s && BLOCKS[s.id] && BLOCKS[s.id].armor;
      if (a && a.tide) return AIR_SECONDS * 2;
    }
    return AIR_SECONDS;
  }

  // a whim takes hold: refreshed to the longer of current/new, never stacked.
  // Kelpguard is also the cure — applying it washes the Mire-rot out.
  addEffect(id, seconds) {
    if (!EFFECTS[id] || this.mode !== "survival" || this.dead) return;
    const fresh = !this.effects.has(id);
    this.effects.set(id, Math.max(this.effects.get(id) || 0, seconds));
    if (id === "kelpguard") this.effects.delete("mirerot");
    if (fresh && this.onEffectStart) this.onEffectStart(id);
  }

  hasEffect(id) { return this.effects.has(id); }

  // the combined speed multiplier of every active whim (1 = unaffected)
  effectSpeedMul() {
    let mul = 1;
    for (const id of this.effects.keys()) {
      const s = EFFECTS[id].speed;
      if (s) mul *= s;
    }
    return mul;
  }

  clearEffects() {
    this.effects.clear();
    this._glowTimer = 0;
    this._rotTimer = 0;
  }

  damage(amount, cause) {
    if (this.mode !== "survival" || this.dead || amount <= 0) return;
    // Kelpguard: the salve shaves every hurt before the plate weighs in
    if (this.effects.has("kelpguard")) amount *= KELPGUARD_SHAVE;
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
    if (cause === "drowning" || cause === "starvation" || cause === "the void" ||
        cause === "the mire-rot") { // sickness ignores the plate
      return amount;
    }
    const red = armorProtection(wear, cause === "fall");
    if (red <= 0) return amount;
    for (let i = 0; i < wear.length; i++) {
      const s = wear[i];
      const a = s && BLOCKS[s.id] ? BLOCKS[s.id].armor : null;
      if (!a || a.glide) continue; // the Wanderwing wears from gliding, not hits
      // a Knotwood Thread woven through the piece: wear lands half as often
      if (wearSkips(s)) continue;
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
    this.clearEffects(); // the grave keeps the whims
    Object.assign(this.pos, spawnPoint);
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.health = MAX_HEALTH;
    this.hunger = MAX_HUNGER;
    this.saturation = SATURATION_START;
    this.air = AIR_SECONDS;
    this.dead = false;
    this.flying = false;
    this.gliding = false;
    this.crouched = false;
    this.crouch = 0;
    this._peakY = this.pos.y;
    this._sinceDamage = 999;
  }

  // forget any fall in progress — must be called on every non-physics
  // relocation (teleport, mode switch, safety net) or the next landing
  // computes fall damage from the stale peak
  resetFall() { this._peakY = this.pos.y; this.gliding = false; }

  // the wear index of a worn Wanderwing (armor.glide), or -1 if none is worn
  _wingSlot() {
    const wear = this.wear;
    if (!wear) return -1;
    for (let i = 0; i < wear.length; i++) {
      const s = wear[i];
      const a = s && BLOCKS[s.id] ? BLOCKS[s.id].armor : null;
      if (a && a.glide) return i;
    }
    return -1;
  }

  // is the wing carrying the fall this tick? Armed while airborne with Space
  // held and a wing worn; it STARTS only from a descent (vy < 0) but then
  // holds through a flare's brief climb until Space frees it or ground/fray
  // ends it (both cleared where they happen). Water/ladder/riding never reach
  // here — those are handled by earlier branches / the ride early-return.
  _wingGlideActive(jumping) {
    if (this.onGround || !jumping || this._wingSlot() < 0) return false;
    return this.gliding || this.vel.y < 0;
  }

  // one tick of glide: ease the descent toward a gentle terminal (steeper on
  // a dive, a breath of lift on a flare), accrue forward speed, steer the
  // track by the camera heading, and spend the wing's dur by glide seconds.
  _glide(dt) {
    if (!this.gliding) { // just deployed: inherit the current ground speed
      this._glideSpeed = Math.hypot(this.vel.x, this.vel.z);
    }
    this.gliding = true;
    // pitch in [-π/2, π/2]; lookDir.y = sin(pitch), so nose-down is pitch < 0
    const dive = -Math.sin(this.pitch); // +1 fully nose-down, -1 fully nose-up
    const sink = Math.max(0, dive), lift = Math.max(0, -dive);
    // a flare only lifts by trading the forward speed it has: with speed in
    // hand it converts to height, and once that speed bleeds off the lift
    // fades back to terminal — so holding a flare can never climb forever
    const speedFrac = Math.min(1, this._glideSpeed / GLIDE_FWD_MAX);
    // vertical: gentle terminal, dive to sink faster, flare for a touch of lift
    const vyTarget = -GLIDE_FALL - sink * GLIDE_DIVE_SINK
      + lift * GLIDE_FLARE_LIFT * speedFrac;
    this.vel.y += (vyTarget - this.vel.y) * Math.min(1, dt * GLIDE_VY_EASE);
    // forward speed accrues toward cruise — higher diving, bled flaring
    const fwdTarget = Math.max(2,
      GLIDE_FWD_MAX + sink * GLIDE_DIVE_FWD - lift * GLIDE_FLARE_BLEED);
    this._glideSpeed += (fwdTarget - this._glideSpeed) * Math.min(1, dt * GLIDE_FWD_EASE);
    this._glideSpeed = Math.max(0, Math.min(GLIDE_FWD_CAP, this._glideSpeed));
    // steer the horizontal track toward where the camera looks (yaw only)
    const hx = -Math.sin(this.yaw), hz = -Math.cos(this.yaw);
    const turn = Math.min(1, dt * GLIDE_TURN_EASE);
    this.vel.x += (hx * this._glideSpeed - this.vel.x) * turn;
    this.vel.z += (hz * this._glideSpeed - this.vel.z) * turn;
    // durability: one point per GLIDE_SECONDS_PER_DUR of flight (survival only)
    if (this.mode === "survival") {
      this._glideDurTimer += dt;
      if (this._glideDurTimer >= GLIDE_SECONDS_PER_DUR) {
        this._glideDurTimer -= GLIDE_SECONDS_PER_DUR;
        this._wearWing();
      }
    }
  }

  // can a Festival Rocket boost the glide right now? (mid-glide, wing worn —
  // interact.js checks this BEFORE consuming the rocket, so a boost that can't
  // happen never eats one)
  canGlideBoost() { return this.gliding && this._wingSlot() >= 0; }

  // a rocket spent mid-glide: thrust along the look vector. The forward cruise
  // jumps by the impulse (capped, so repeated rockets plateau rather than run
  // away), the horizontal track snaps onto the look heading, and a nose-up aim
  // trades the thrust into a climb — the long-distance flight loop. The wing
  // pays one point of dur for the push.
  glideBoost() {
    if (!this.canGlideBoost()) return false;
    const dir = this.lookDir();
    this._glideSpeed = Math.min(GLIDE_BOOST_CAP, this._glideSpeed + GLIDE_BOOST);
    const hlen = Math.hypot(dir.x, dir.z) || 1;
    this.vel.x = (dir.x / hlen) * this._glideSpeed;
    this.vel.z = (dir.z / hlen) * this._glideSpeed;
    this.vel.y += dir.y * GLIDE_BOOST; // aim up to climb, down to dive
    this._wearWing();                   // one point of the wing for the thrust
    return true;
  }

  // spend one point of the worn wing's durability; at 0 it frays mid-air —
  // it shatters out of the slot, the glide folds, and the fall resumes
  _wearWing() {
    const i = this._wingSlot();
    if (i < 0) return;
    const s = this.wear[i];
    const a = BLOCKS[s.id].armor;
    const left = (Number.isInteger(s.dur) ? s.dur : a.maxDur) - 1;
    if (left <= 0) {
      const id = s.id;
      this.wear[i] = null;
      this.gliding = false; // next tick has no wing: the fall resumes
      if (this.onGlideFray) this.onGlideFray(id);
    } else {
      s.dur = left;
      if (this.onGlideWear) this.onGlideWear();
    }
  }

  get eyeY() { return this.pos.y + EYE_HEIGHT - CROUCH_EYE_DROP * this.crouch; }

  // the collision height right now (crouched or standing)
  get height() { return this.crouched ? CROUCH_HEIGHT : PLAYER_HEIGHT; }

  // fold down while sneaking (not when flying or swimming — there's nothing
  // to crouch on); unfold only when the standing box would fit
  _updateCrouch(dt, sneaking) {
    const want = sneaking && !this.flying && !this.inWater;
    if (want) this.crouched = true;
    else if (this.crouched &&
             !this._boxCollides(this.pos.x, this.pos.y, this.pos.z, PLAYER_HEIGHT)) {
      this.crouched = false;
    }
    const target = this.crouched ? 1 : 0;
    this.crouch += (target - this.crouch) * Math.min(1, dt * CROUCH_EASE);
    if (Math.abs(target - this.crouch) < 1e-3) this.crouch = target;
  }

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
      this.crouched = false; // the bench sets the seat height, not the crouch
      this.crouch = 0;
      this.sprintActive = false; // no pounding down the bench — FOV settles
      this.vel.x = this.vel.y = this.vel.z = 0;
      this.onGround = false;
      this._peakY = this.pos.y;
      this._sinceDamage += dt;
      if (!this.eyeInWater) { // catching breath on the bench
        this.air = Math.min(this.maxAir, this.air + dt * 4);
      }
      return;
    }

    const forward = (this.keys.has("KeyW") ? 1 : 0) - (this.keys.has("KeyS") ? 1 : 0);
    const strafe = (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0);
    const sneaking = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    const jumping = this.keys.has("Space");
    this._updateCrouch(dt, sneaking);

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
    else if (this.inWater) {
      speed = wantSprint && sprintInput ? SWIM_SPRINT_SPEED : SWIM_SPEED;
      if (this.inLava) speed *= 0.55; // the melt is thicker than any river
      else if (this._tideThread()) speed *= 1.5; // the sea carries you
    }
    // a crouch kept by a low ceiling walks at the sneak pace too
    else if (sneaking || this.crouched) speed = SNEAK_SPEED;
    else if (wantSprint && sprintInput) speed = SPRINT_SPEED;
    else speed = WALK_SPEED;
    this.sprintActive = speed === SPRINT_SPEED || speed === SWIM_SPRINT_SPEED ||
      (this.flying && wantSprint);
    // the Whims' pace: Fleetfoot quickens, Dimmed drags — applied after the
    // sprint check reads the base speed, and never to hunger drain rates
    if (this.mode === "survival" && this.effects.size > 0) {
      speed *= this.effectSpeedMul();
    }

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
      // suspended; forward/jump climbs, back descends, sneak GRIPS (holds
      // the rung, no slide), idle drifts down a slow slide; horizontal
      // movement is damped to a shuffle
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
      else if (sneaking) this.vel.y = 0; // grip-hold: hand-feet locked on
      else if (forward < 0) this.vel.y = -LADDER_CLIMB;
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
    } else if (this._wingGlideActive(jumping)) {
      // the Wanderwing is spread: the wind takes over from gravity
      this._glide(dt);
    } else {
      if (this.gliding) this.gliding = false; // Space released / no wing: fold
      // footing: River Glass halves traction (starts and stops alike — the
      // slide), a Snowdrift drags the stride to 0.9x, and Mire Sod sucks at
      // the hand-feet — the bog is crossed at three-quarter pace
      let traction = 1, stride = 1;
      if (this.onGround) {
        const fx = Math.floor(this.pos.x), fz = Math.floor(this.pos.z);
        const below = this.world.getBlock(fx, Math.floor(this.pos.y - 0.05), fz);
        // the feet cell too: standing ON a drift puts the feet INSIDE its
        // cell (y = cell + 0.12), so the below-probe alone can miss it
        const feet = this.world.getBlock(fx, Math.floor(this.pos.y + 0.05), fz);
        if (below === ICE) traction = 0.5;
        else if (below === SNOW_LAYER || feet === SNOW_LAYER) stride = 0.9;
        else if (below === MUD && !this._tideThread()) stride = 0.75;
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
          this.exhaust(HUNGER_JUMP + (this.sprintActive ? SPRINT_JUMP_EXTRA : 0));
        }
      }
    }

    this._sneaking = sneaking;
    const wasAirborne = !this.onGround;
    const glideVy = this.gliding ? this.vel.y : 0; // impact speed for a slam
    this._moveWithCollisions(dt);
    if (this.flying && this.onGround) this.flying = false;
    // a glide that meets the ground: a gentle flared touch is free, but
    // slamming down faster than the safe speed still stings — the wing just
    // absorbs most of it. The height-based fall path is already neutralized
    // (gliding zeroes the peak below), so this is the only glide-landing hurt.
    if (this.gliding && this.onGround) {
      const impact = -glideVy;
      if (this.mode === "survival" && impact > GLIDE_SAFE_LAND) {
        this.damage(Math.round((impact - GLIDE_SAFE_LAND) * GLIDE_IMPACT_FACTOR), "fall");
      }
      this.gliding = false;
    }

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

    // the Whims run their clocks down (and off)
    if (this.effects.size > 0) {
      for (const [id, left] of this.effects) {
        if (left - dt <= 0) this.effects.delete(id);
        else this.effects.set(id, left - dt);
      }
      // Emberglow: a warm ember heals steadily and asks NOTHING of the
      // satchel (that's the point of a broth over a meal)
      if (this.effects.has("emberglow")) {
        this._glowTimer += dt;
        if (this._glowTimer >= EMBERGLOW_INTERVAL) {
          this._glowTimer -= EMBERGLOW_INTERVAL;
          this.health = Math.min(MAX_HEALTH, this.health + 1);
        }
      } else this._glowTimer = 0;
      // Mire-rot: gnaws like starvation — down to (never past) half a heart
      if (this.effects.has("mirerot")) {
        this._rotTimer += dt;
        if (this._rotTimer >= MIREROT_INTERVAL) {
          this._rotTimer -= MIREROT_INTERVAL;
          if (this.health > 1) this.damage(Math.min(1, this.health - 1), "the mire-rot");
        }
      } else this._rotTimer = 0;
    }

    // fall damage: MC rule, damage = blocks fallen minus 3 (a gripped ladder
    // is as safe as water — no fall accumulates through it, and a spread
    // Wanderwing carries the height the way water does: glide-landings are
    // scored by impact speed in update(), never by how far you soared)
    if (this.flying || this.inWater || this.onLadder || this.gliding) {
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

    // drowning: air runs out, then 1 heart per second. Tidebreath (the
    // broth's whim) keeps the meter brim-full for its minute — the lungs
    // think they're home.
    if (this.eyeInWater) {
      if (this.effects.has("tidebreath")) {
        this.air = this.maxAir;
        this._drownTimer = 0;
      } else {
        this.air = Math.max(0, this.air - dt);
        if (this.air <= 0) {
          this._drownTimer += dt;
          if (this._drownTimer >= 1) { this._drownTimer -= 1; this.damage(2, "drowning"); }
        }
      }
    } else {
      // maxAir, not the raw constant: the Nacre Crown's doubled meter must
      // refill past the old ceiling here too
      this.air = Math.min(this.maxAir, this.air + dt * 4);
      this._drownTimer = 0;
    }

    // the Emberwash: fast ticking burns while any of the body is in the melt
    // (armor absorbs its share — heat is physical enough for plate to matter)
    this._lavaTimer -= dt;
    if (this._lavaTimer <= 0 && (this.inLava || this.eyeInLava)) {
      this._lavaTimer = 0.4;
      this.damage(3, "the Emberwash");
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
      this.exhaust(drain * dt);
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
      this.exhaust(heal * REGEN_HUNGER_COST);
    }
  }

  // spend food on an exertion: the saturation buffer pays first, and only
  // what it can't cover moves the hunger meter
  exhaust(amount) {
    if (!(amount > 0)) return;
    const fromSat = Math.min(this.saturation, amount);
    this.saturation -= fromSat;
    this.hunger = Math.max(0, this.hunger - (amount - fromSat));
  }

  // eat a food item: restore hunger (clamped) and top up the saturation
  // buffer (capped at the new hunger). Returns false at full hunger.
  eat(restore, saturation = 0) {
    if (this.hunger >= MAX_HUNGER - 1e-9) return false;
    this.hunger = Math.min(MAX_HUNGER, this.hunger + restore);
    this.saturation = Math.min(this.hunger, this.saturation + Math.max(0, saturation));
    return true;
  }

  _touchesCactus() {
    const p = this.pos, pad = 0.08;
    const x0 = Math.floor(p.x - HALF_W - pad), x1 = Math.floor(p.x + HALF_W + pad);
    const y0 = Math.floor(p.y - 0.05), y1 = Math.floor(p.y + this.height);
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
    const eye = w.getBlock(Math.floor(x), Math.floor(this.eyeY), Math.floor(z));
    // inWater is really "in a fluid": the Emberwash carries the swimmer the
    // same way water does (or you'd fall through it like air) — it just burns
    this.inWater = isFluid(feet) || isFluid(torso);
    this.inLava = feet === LAVA || torso === LAVA;
    this.eyeInWater = eye === WATER;
    this.eyeInLava = eye === LAVA;
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
    const minY = p.y, maxY = p.y + this.height;
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
              p.y = by - this.height - eps;
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
  // Uses per-block colHeight — the auto-step clearance test (and, with a
  // standing height passed, the crouch's can-I-stand-up test).
  _boxCollides(px, py, pz, height = this.height) {
    const eps = 0.001;
    const x0 = Math.floor(px - HALF_W), x1 = Math.floor(px + HALF_W - eps);
    // one row below the feet: tall blocks (colHeight > 1) reach up here
    const y0 = Math.floor(py) - 1, y1 = Math.floor(py + height - eps);
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
      minY: this.pos.y, maxY: this.pos.y + this.height,
      minZ: this.pos.z - HALF_W, maxZ: this.pos.z + HALF_W,
    };
  }
}

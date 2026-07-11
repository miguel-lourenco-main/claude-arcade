// Slipstream — fixed-timestep race simulation.
// Pure module (node-safe): no DOM, no canvas, no audio. Emits events
// per step so the shell can drive sound/particles/UI from them.

import { SEG_LEN, ROAD_WIDTH, DRAW_DIST, segAt } from './track.js';

export const MAX_SPEED = SEG_LEN * 60;        // one segment per tick at 60 Hz
export const ACCEL = MAX_SPEED / 5;
export const BRAKE = -MAX_SPEED;
export const COAST = -MAX_SPEED / 5;
export const OFFROAD_DECEL = -MAX_SPEED / 1.4;
export const OFFROAD_LIMIT = MAX_SPEED / 4;
export const CENTRIFUGAL = 0.29;              // outward pull = speed x curve
export const CAM_HEIGHT = 1000;
export const FOV = 100;
export const CAM_DEPTH = 1 / Math.tan((FOV / 2) * Math.PI / 180);
export const PLAYER_Z = CAM_HEIGHT * CAM_DEPTH;
export const PLAYER_W = 0.34;                 // widths in road-halfwidth units
export const CAR_W = 0.34;
export const SPIN_TIME = 1.15;                // seconds of spin-out after a crash
export const GEARS = [0, 0.16, 0.34, 0.53, 0.72, 0.88]; // ratio lower bounds

export function createState(track) {
  return {
    track,
    phase: 'racing',          // racing | gameover | finished
    running: false,           // false while the countdown holds the clock
    position: 0,              // camera z along the track
    playerX: 0,               // lateral, in road-halfwidth units (|x|>1 = off-road)
    speed: 0,
    prev: { position: 0, playerX: 0, speed: 0 },
    stageIdx: 0,
    timeLeft: track.stages[0].time,
    raceTime: 0,
    gear: 0,
    spin: 0,
    collideCd: 0,
    offRoad: false,
    onRumble: false,
    score: 0,
    passes: 0,
    topSpeed: 0,
    results: null,
    cars: track.cars.map((c) => ({
      z: c.z,
      offset: c.offset,
      speed: c.speedFrac * MAX_SPEED,
      kind: c.kind,
    })),
    events: [],
  };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function overlap(x1, w1, x2, w2, pad = 1) {
  const half = (w1 + w2) * pad * 0.5;
  return Math.abs(x1 - x2) < half;
}

function gearOf(ratio) {
  for (let g = GEARS.length - 1; g >= 0; g--) if (ratio >= GEARS[g]) return g;
  return 0;
}

// Light lane-change AI: slower traffic drifts around whatever is ahead.
function carSteer(s, car, pz) {
  const rel = car.z - pz;
  if (Math.abs(rel) > DRAW_DIST * SEG_LEN) return 0;       // far from the action
  const look = 20 * SEG_LEN;
  // avoid the player
  if (rel < 0 && rel > -look && car.speed > s.speed) {
    if (overlap(s.playerX, PLAYER_W, car.offset, CAR_W, 1.4)) {
      return car.offset > s.playerX ? 0.6 : -0.6;
    }
  }
  // avoid slower traffic ahead
  for (const other of s.cars) {
    if (other === car) continue;
    const d = other.z - car.z;
    if (d > 0 && d < look && other.speed < car.speed &&
        overlap(car.offset, CAR_W, other.offset, CAR_W, 1.3)) {
      return other.offset > car.offset ? -0.6 : 0.6;
    }
  }
  return 0;
}

export function step(s, input, dt) {
  s.events.length = 0;
  s.prev.position = s.position;
  s.prev.playerX = s.playerX;
  s.prev.speed = s.speed;

  const track = s.track;
  const pz = s.position + PLAYER_Z;
  const playerSeg = segAt(track, pz);
  const ratio = s.speed / MAX_SPEED;

  const control = s.phase === 'racing' && s.spin <= 0;
  const throttle = control && !!input.throttle;
  const brake = control && !!input.brake;
  const steer = control ? (input.left ? -1 : 0) + (input.right ? 1 : 0) : 0;

  // ---- steering: speed-scaled (no steering when stopped) ----
  const dx = dt * 2 * ratio;
  s.playerX += steer * dx;

  // ---- centrifugal pull: speed x curve pushes the car OUTWARD ----
  s.playerX -= dx * ratio * playerSeg.curve * CENTRIFUGAL;

  // ---- longitudinal ----
  if (s.phase !== 'racing') {
    s.speed += COAST * dt;                         // roll to a stop
  } else if (throttle) {
    s.speed += ACCEL * dt;
  } else if (brake) {
    s.speed += BRAKE * dt;
  } else {
    s.speed += COAST * dt;
  }

  // ---- road edges: rumble strips, then heavy off-road drag ----
  const ax = Math.abs(s.playerX);
  s.onRumble = s.phase === 'racing' && ax > 0.78 && ax <= 1.0 && s.speed > MAX_SPEED * 0.05;
  s.offRoad = ax > 1.0;
  if (s.offRoad && s.speed > OFFROAD_LIMIT) {
    s.speed += OFFROAD_DECEL * dt;
    if (s.speed < OFFROAD_LIMIT) s.speed = OFFROAD_LIMIT;
  }

  if (s.spin > 0) {
    s.spin = Math.max(0, s.spin - dt);
    s.speed += COAST * dt;                         // extra scrub while spinning
  }
  if (s.collideCd > 0) s.collideCd -= dt;

  s.speed = clamp(s.speed, 0, MAX_SPEED);
  s.playerX = clamp(s.playerX, -2.4, 2.4);

  // ---- gear thresholds ----
  const g = gearOf(s.speed / MAX_SPEED);
  if (g !== s.gear) {
    s.events.push({ type: 'gear', dir: g > s.gear ? 1 : -1, gear: g });
    s.gear = g;
  }

  // ---- advance ----
  s.position += s.speed * dt;
  const newPz = s.position + PLAYER_Z;

  // ---- traffic ----
  for (const car of s.cars) {
    const wasAhead = car.z > pz;
    car.offset = clamp(car.offset + carSteer(s, car, pz) * dt, -0.92, 0.92);
    car.z += car.speed * dt;
    let wrapped = false;
    if (car.z > track.raceLength) { car.z -= track.raceLength; wrapped = true; }

    if (!wrapped && s.phase === 'racing') {
      const isAhead = car.z > newPz;
      // overtake detection (player passes car)
      if (wasAhead && !isAhead) {
        s.passes++;
        s.score += 300;
        if (Math.abs(car.offset - s.playerX) < 0.8 && s.speed - car.speed > MAX_SPEED * 0.18) {
          s.score += 200;
          s.events.push({ type: 'whoosh' });
        }
      } else if (!wasAhead && isAhead && Math.abs(car.offset - s.playerX) < 0.8) {
        s.events.push({ type: 'whoosh' });       // traffic blows past the player
      }
      // collision: same segment, faster than the car, overlapping laterally
      if (s.collideCd <= 0 &&
          Math.floor(car.z / SEG_LEN) === Math.floor(newPz / SEG_LEN) &&
          s.speed > car.speed * 1.02 &&
          overlap(s.playerX, PLAYER_W, car.offset, CAR_W, 1.0)) {
        s.speed = Math.max(MAX_SPEED * 0.06, car.speed * 0.3);
        s.spin = SPIN_TIME;
        s.collideCd = 1.6;
        s.position = Math.min(s.position, Math.max(0, car.z - PLAYER_Z - SEG_LEN * 0.4));
        s.events.push({ type: 'crash' });
      }
    }
  }

  // ---- checkpoints ----
  const stages = track.stages;
  if (s.phase === 'racing' && s.stageIdx < stages.length - 1 &&
      s.position + PLAYER_Z >= stages[s.stageIdx + 1].fromZ) {
    s.stageIdx++;
    const st = stages[s.stageIdx];
    s.timeLeft += st.time;
    s.events.push({ type: 'checkpoint', name: st.name, add: st.time, stage: s.stageIdx });
  }

  // ---- finish line ----
  if (s.phase === 'racing' && s.position + PLAYER_Z >= track.finishSeg * SEG_LEN) {
    s.phase = 'finished';
    const timeBonus = Math.round(s.timeLeft) * 120;
    const passBonus = s.passes * 150;
    const speedBonus = Math.round((s.topSpeed / MAX_SPEED) * 100) * 20;
    s.results = {
      timeLeft: s.timeLeft,
      raceTime: s.raceTime,
      passes: s.passes,
      topSpeed: s.topSpeed,
      timeBonus, passBonus, speedBonus,
      total: Math.round(s.score + timeBonus + passBonus + speedBonus),
    };
    s.score = s.results.total;
    s.events.push({ type: 'finish' });
  }

  // ---- clock & score ----
  if (s.phase === 'racing' && s.running) {
    s.raceTime += dt;
    s.timeLeft -= dt;
    s.score += s.speed * dt * 0.01;
    if (s.speed > s.topSpeed) s.topSpeed = s.speed;
    if (s.timeLeft <= 0) {
      s.timeLeft = 0;
      s.phase = 'gameover';
      s.events.push({ type: 'timeup' });
    }
  }

  return s.events;
}

// Demo driver for the attract mode (and the headless feasibility test):
// hugs the inside of upcoming bends, brakes into corners, dodges traffic.
export function autopilot(s) {
  const track = s.track;
  const pz = s.position + PLAYER_Z;
  const seg = segAt(track, pz);
  const segs = track.segments;

  let maxC = 0;
  for (let i = 0; i < 55; i++) {
    const sg = segs[Math.min(seg.i + i, segs.length - 1)];
    if (Math.abs(sg.curve) > Math.abs(maxC)) maxC = sg.curve;
  }

  let targetX = clamp(maxC * 0.11, -0.5, 0.5);   // hug the inside line
  for (const car of s.cars) {
    const rel = car.z - pz;
    if (rel > 0 && rel < SEG_LEN * 30 && Math.abs(car.offset - targetX) < 0.55) {
      targetX = clamp(car.offset > 0 ? car.offset - 0.85 : car.offset + 0.85, -0.8, 0.8);
      break;
    }
  }

  const err = targetX - s.playerX;
  const targetSpeed = MAX_SPEED * (1 - (Math.min(Math.abs(maxC), 6) / 6) * 0.5);
  return {
    left: err < -0.04,
    right: err > 0.04,
    throttle: s.speed <= targetSpeed + MAX_SPEED * 0.04,
    brake: s.speed > targetSpeed + MAX_SPEED * 0.04,
  };
}

// Dustkart — fixed-timestep race simulation.
// Pure (node-safe): no DOM, no canvas, no audio. Six karts (player + 5 AI)
// on a wrapping circuit: drift/boost handling, start-boost window, item
// pads + the five-item kit, rubberbanded racing-line AI, kart bumping,
// spin-outs, laps and live position ranking. Emits events per step so the
// shell can drive sound/particles/UI.
// Classic script: reads/attaches via the Dustkart namespace. Load after
// circuits.js.

(function () {
'use strict';
const NS = typeof globalThis !== 'undefined' ? globalThis : window;
const DK = NS.Dustkart = NS.Dustkart || {};
const { SEG_LEN, LAPS, segAt } = DK;

const MAX_SPEED = SEG_LEN * 46;          // world units / second
const ACCEL = MAX_SPEED / 4.4;
const BRAKE = -MAX_SPEED / 1.1;
const COAST = -MAX_SPEED / 5;
const OFFROAD_DECEL = -MAX_SPEED / 1.3;
const OFFROAD_LIMIT = MAX_SPEED * 0.27;
const CENTRIFUGAL = 0.31;                // outward pull = speed x curve
const STEER_RATE = 2.15;                 // halfwidths/sec at full speed
const BOOST_MAX = MAX_SPEED * 1.24;      // over-max speed while boosting

const CAM_HEIGHT = 1000;
const FOV = 100;
const CAM_DEPTH = 1 / Math.tan((FOV / 2) * Math.PI / 180);
const PLAYER_Z = CAM_HEIGHT * CAM_DEPTH;

const KART_W = 0.30;                     // widths in road-halfwidth units
const KART_LEN = 230;                    // longitudinal bump reach (world units)
const SPIN_TIME = 1.05;                  // two full rotations over this
const INVULN_TIME = 1.6;                 // post-spin grace

// drift tuning
const DRIFT_MIN_RATIO = 0.42;            // speed needed to start a drift
const DRIFT_KEEP_RATIO = 0.33;           // below this the drift cancels
const DRIFT_T1 = 0.75;                   // seconds of charge for tier 1
const DRIFT_T2 = 1.7;                    // seconds of charge for tier 2
const BOOST_T1 = 0.62;                   // mini-boost seconds
const BOOST_T2 = 1.25;

// start boost
const LAUNCH_WINDOW = 0.42;              // press accel within this before GO
const LAUNCH_BOOST = 1.3;
const BOG_TIME = 1.1;

const PAD_COOLDOWN = 4;
const RB_RANGE = SEG_LEN * 200;          // rubberband saturates at this gap
const RB_MAX = 0.08;                     // +-8% top speed, capped

const ITEM_KINDS = ['gust', 'slick', 'burr', 'barkshield', 'tangleroot'];

// Position-weighted item tables (leader gets weak, last gets strong).
const ITEM_WEIGHTS = [
  { gust: 25, slick: 45, burr: 0,  barkshield: 30, tangleroot: 0 },  // 1st
  { gust: 35, slick: 35, burr: 10, barkshield: 20, tangleroot: 0 },  // 2nd
  { gust: 35, slick: 20, burr: 30, barkshield: 15, tangleroot: 0 },  // 3rd
  { gust: 30, slick: 15, burr: 35, barkshield: 10, tangleroot: 10 }, // 4th
  { gust: 25, slick: 10, burr: 40, barkshield: 5,  tangleroot: 20 }, // 5th
  { gust: 15, slick: 0,  burr: 40, barkshield: 10, tangleroot: 35 }, // 6th
];

// The burrowfolk roster — all original little critters.
const ROSTER = [
  { name: 'Pip',    top: 1.0 },                    // the player
  { name: 'Bramble',top: 0.97,  line: -0.06 },
  { name: 'Nib',    top: 0.985, line: 0.05 },
  { name: 'Tansy',  top: 0.945, line: -0.1 },
  { name: 'Moler',  top: 0.96,  line: 0.09 },
  { name: 'Fenwick',top: 0.975, line: 0.0 },
];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function weightsFor(rank) {
  return ITEM_WEIGHTS[clamp(rank, 1, 6) - 1];
}

function pickItem(rank, rng) {
  const w = weightsFor(rank);
  let total = 0;
  for (const k of ITEM_KINDS) total += w[k];
  let r = rng() * total;
  for (const k of ITEM_KINDS) {
    r -= w[k];
    if (r <= 0) return k;
  }
  return 'gust';
}

function createRace(circuit, opts = {}) {
  const rng = opts.rng || Math.random;
  const karts = ROSTER.map((p, i) => ({
    i,
    name: p.name,
    isPlayer: i === 0 && !opts.demo,
    persona: { top: p.top, line: p.line || 0 },
    // grid: player at the back, two staggered columns just past the line
    z: 300 + (ROSTER.length - 1 - i) * 150,
    x: i % 2 === 0 ? -0.4 : 0.4,
    speed: 0,
    laps: 0,
    progress: 0,
    rank: i + 1,
    pose: 0,
    prev: { z: 0, x: 0, speed: 0 },
    // drift
    drift: { on: false, dir: 0, charge: 0, tier: 0 },
    boostT: 0,
    bogT: 0,
    // status
    spinT: 0,
    invulnT: 0,
    shield: false,
    item: null,
    offRoad: false,
    // start boost
    pressAt: null,
    // laps / timing
    lapStartT: 0,
    lastLap: 0,
    bestLap: 0,
    finished: false,
    finishOrder: 0,
    finishT: 0,
    // ai
    aiT: rng() * 0.5,
    aiSteerBias: 0,
  }));
  karts.forEach((k) => { k.prev = { z: k.z, x: k.x, speed: 0 }; k.progress = k.z; });

  const state = {
    circuit,
    demo: !!opts.demo,
    rng,
    phase: opts.demo ? 'racing' : 'countdown',   // countdown | racing | finished
    countT: 3.35,
    time: 0,
    karts,
    order: karts.slice(),
    slicks: [],
    burrs: [],
    pads: circuit.pads.map((p) => ({ seg: p.seg, z: p.z, x: p.x, cd: 0 })),
    finishCount: 0,
    results: null,
    bumpCd: 0,
    events: [],
  };
  updateRanks(state);
  return state;
}

function updateRanks(state) {
  const L = state.circuit.length;
  for (const k of state.karts) {
    k.progress = k.laps * L + k.z;
  }
  state.order = state.karts.slice().sort((a, b) => {
    const ka = a.finished ? 1e12 * (100 - a.finishOrder) : a.progress;
    const kb = b.finished ? 1e12 * (100 - b.finishOrder) : b.progress;
    return kb - ka;
  });
  state.order.forEach((k, i) => { k.rank = i + 1; });
}

// ---- items ------------------------------------------------------------

function applySpin(state, kart, cause) {
  if (kart.invulnT > 0 || kart.spinT > 0) return false;
  if (kart.shield) {
    kart.shield = false;
    state.events.push({ type: 'shieldHit', kart, cause });
    return false;
  }
  kart.spinT = SPIN_TIME;
  kart.speed *= 0.4;
  if (kart.drift.on) { kart.drift.on = false; kart.drift.charge = 0; kart.drift.tier = 0; }
  state.events.push({ type: 'spin', kart, cause });
  return true;
}

function fireItem(state, kart) {
  const kind = kart.item;
  if (!kind) return;
  kart.item = null;
  const L = state.circuit.length;
  switch (kind) {
    case 'gust':
      kart.boostT = Math.max(kart.boostT, 1.35);
      break;
    case 'slick': {
      let z = kart.z - 280;
      if (z < 0) z += L;
      state.slicks.push({ z, x: clamp(kart.x, -0.95, 0.95), life: 18, armT: 0.5 });
      break;
    }
    case 'burr': {
      // homes on the kart directly ahead in the running order
      const target = state.order[kart.rank - 2] || null;
      state.burrs.push({
        z: (kart.z + 220) % L,
        x: kart.x,
        speed: MAX_SPEED * 1.5,
        target, life: 7, owner: kart,
      });
      break;
    }
    case 'barkshield':
      kart.shield = true;
      break;
    case 'tangleroot': {
      let hit = 0;
      for (const other of state.karts) {
        if (other !== kart && other.rank < kart.rank && !other.finished) {
          if (applySpin(state, other, 'tangleroot')) hit++;
        }
      }
      state.events.push({ type: 'tangle', kart, hit });
      break;
    }
  }
  state.events.push({ type: 'fire', kind, kart });
}

// distance forward from a to b along the wrapping loop
function distAhead(L, a, b) {
  let d = b - a;
  if (d < 0) d += L;
  return d;
}

// signed shortest distance from a to b on the loop
function signedDist(L, a, b) {
  let d = b - a;
  if (d > L / 2) d -= L;
  if (d < -L / 2) d += L;
  return d;
}

// ---- AI ---------------------------------------------------------------

function aiControl(state, k, dt) {
  const circuit = state.circuit;
  const segs = circuit.segments;
  const N = circuit.N;
  const segIdx = Math.floor(k.z / SEG_LEN) % N;

  // corner speed: worst distance-weighted curve coming up
  let maxC = 0;
  for (let j = 2; j < 34; j++) {
    const c = Math.abs(segs[(segIdx + j) % N].curve) * (1 - j / 48);
    if (c > maxC) maxC = c;
  }
  const rb = rubberband(state, k);
  const effTop = MAX_SPEED * (k.persona.top + rb);
  const tgtSpeed = effTop * (1 - (Math.min(maxC, 7) / 7) * 0.32);

  // follow the racing line a little ahead, plus a personality offset
  let tx = segs[(segIdx + 10) % N].line + k.persona.line;

  // dodge slicks ahead
  for (const s of state.slicks) {
    const d = distAhead(circuit.length, k.z, s.z);
    if (d < SEG_LEN * 26 && Math.abs(s.x - tx) < 0.34) {
      tx = s.x > tx ? s.x - 0.55 : s.x + 0.55;
      break;
    }
  }
  tx = clamp(tx, -0.85, 0.85);

  const err = tx - k.x;
  const steer = err > 0.035 ? 1 : err < -0.035 ? -1 : 0;

  // item heuristics on a slow think-timer
  let fire = false;
  k.aiT -= dt;
  if (k.aiT <= 0) {
    k.aiT = 0.35 + state.rng() * 0.5;
    if (k.item) {
      switch (k.item) {
        case 'barkshield': fire = true; break;
        case 'gust': fire = Math.abs(segs[segIdx].curve) < 2; break;
        case 'slick': {
          const behind = state.order[k.rank];       // rank is 1-based; next behind
          fire = !!behind && distAhead(circuit.length, behind.z, k.z) < SEG_LEN * 18;
          break;
        }
        case 'burr': {
          const ahead = state.order[k.rank - 2];
          fire = !!ahead && distAhead(circuit.length, k.z, ahead.z) < SEG_LEN * 45;
          break;
        }
        case 'tangleroot': fire = k.rank >= 4; break;
      }
    }
  }

  return {
    left: steer < 0, right: steer > 0,
    throttle: k.speed < tgtSpeed,
    brake: k.speed > tgtSpeed * 1.18,
    drift: false,
    fire,
  };
}

function rubberband(state, k) {
  if (state.demo) return 0;
  const player = state.karts[0];
  if (k === player) return 0;
  const diff = player.progress - k.progress;   // positive: kart is behind the player
  return clamp(diff / RB_RANGE, -1, 1) * RB_MAX;
}

// ---- per-kart physics ---------------------------------------------------

function updateKart(state, k, input, dt) {
  const circuit = state.circuit;
  const L = circuit.length;
  k.prev.z = k.z; k.prev.x = k.x; k.prev.speed = k.speed;

  if (k.spinT > 0) {
    k.spinT -= dt;
    if (k.spinT <= 0) { k.spinT = 0; k.invulnT = INVULN_TIME; }
  }
  if (k.invulnT > 0) k.invulnT -= dt;
  if (k.bogT > 0) k.bogT -= dt;
  if (k.boostT > 0) k.boostT -= dt;

  const seg = segAt(circuit, k.z);
  const ratio = k.speed / MAX_SPEED;
  const control = state.phase !== 'countdown' && k.spinT <= 0;
  const steer = control ? (input.left ? -1 : 0) + (input.right ? 1 : 0) : 0;
  const throttle = control && !!input.throttle;
  const brake = control && !!input.brake;

  // ---- drift state machine (player only; AI corners on the line) ----
  const d = k.drift;
  if (k.isPlayer) {
    if (!d.on) {
      if (control && input.drift && steer !== 0 && ratio > DRIFT_MIN_RATIO) {
        d.on = true; d.dir = steer; d.charge = 0; d.tier = 0;
        state.events.push({ type: 'driftStart', kart: k });
      }
    } else {
      const wrongWay = steer === -d.dir;
      const tooSlow = ratio < DRIFT_KEEP_RATIO;
      if (!input.drift || !control) {
        // released: the earned tier pays out as a mini-boost
        if (control && d.tier >= 1) {
          k.boostT = Math.max(k.boostT, d.tier === 2 ? BOOST_T2 : BOOST_T1);
          state.events.push({ type: 'boost', kart: k, tier: d.tier });
        }
        d.on = false; d.charge = 0; d.tier = 0;
      } else if (wrongWay || tooSlow) {
        d.on = false; d.charge = 0; d.tier = 0;   // cancelled, no boost
        state.events.push({ type: 'driftCancel', kart: k });
      } else {
        d.charge += dt;
        const tier = d.charge >= DRIFT_T2 ? 2 : d.charge >= DRIFT_T1 ? 1 : 0;
        if (tier !== d.tier) {
          d.tier = tier;
          state.events.push({ type: 'driftTier', kart: k, tier });
        }
      }
    }
  }

  // ---- lateral: steering scaled by speed + centrifugal pull ----
  const base = STEER_RATE * ratio * dt;
  let centrif = 1;
  if (d.on) {
    // sliding: the locked drift direction dominates, grip drops
    k.x += d.dir * base * 1.3 + steer * base * 0.5;
    centrif = 1.45;
  } else {
    k.x += steer * base;
  }
  k.x -= base * ratio * seg.curve * CENTRIFUGAL * centrif;
  k.x = clamp(k.x, -2.2, 2.2);

  // ---- longitudinal ----
  const rb = k.isPlayer ? 0 : rubberband(state, k);
  let effMax = MAX_SPEED * (k.persona.top + rb);
  if (k.bogT > 0) effMax = Math.min(effMax, MAX_SPEED * 0.25);

  if (k.boostT > 0) {
    k.speed += (BOOST_MAX - k.speed) * Math.min(1, dt * 7);
  } else if (k.spinT > 0) {
    k.speed += COAST * 2 * dt;
  } else if (throttle) {
    const power = k.bogT > 0 ? 0.15 : 1;
    k.speed += ACCEL * power * dt;
  } else if (brake) {
    k.speed += BRAKE * dt;
  } else {
    k.speed += COAST * dt;
  }

  // ---- off-road: heavy slowdown unless boosting ----
  k.offRoad = Math.abs(k.x) > 1.0;
  if (k.offRoad && k.boostT <= 0 && k.speed > OFFROAD_LIMIT) {
    k.speed += OFFROAD_DECEL * dt;
    if (k.speed < OFFROAD_LIMIT) k.speed = OFFROAD_LIMIT;
  }

  k.speed = clamp(k.speed, 0, k.boostT > 0 ? BOOST_MAX : effMax);

  // ---- advance with wrap + lap counting (direction-checked) ----
  const travelled = k.speed * dt;
  let nz = k.z + travelled;
  if (nz >= L) {
    nz -= L;
    k.laps++;             // crossed the start/finish going forward
    onLap(state, k);
  } else if (nz < 0) {
    nz += L;
    k.laps--;             // (defensive: backwards crossing un-counts)
  }

  // segment-range checks over the distance covered this tick
  if (state.phase === 'racing' && !k.finished) {
    checkPads(state, k, travelled);
    checkSlicks(state, k, travelled);
  }

  k.z = nz;

  // pose for the renderer: -2..2 (hard = drifting)
  k.pose = d.on ? d.dir * 2 : steer;

  // fire the held item
  if (control && input.fire && k.item && state.phase === 'racing' && !k.finished) {
    fireItem(state, k);
  }
}

function onLap(state, k) {
  if (state.demo) { k.lapStartT = state.time; return; }
  if (k.finished) return;
  const lapTime = state.time - k.lapStartT;
  k.lastLap = lapTime;
  if (lapTime > 1 && (k.bestLap === 0 || lapTime < k.bestLap)) k.bestLap = lapTime;
  k.lapStartT = state.time;
  if (k.laps >= LAPS) {
    k.finished = true;
    k.finishOrder = ++state.finishCount;
    k.finishT = state.time;
    state.events.push({ type: 'finish', kart: k });
  } else {
    state.events.push({ type: 'lap', kart: k, laps: k.laps, lapTime });
  }
}

function checkPads(state, k, travelled) {
  if (k.item) return;
  const L = state.circuit.length;
  for (const pad of state.pads) {
    if (pad.cd > 0) continue;
    const dist = distAhead(L, k.prev.z, pad.z);
    if (dist <= travelled && Math.abs(k.x - pad.x) < 0.3) {
      pad.cd = PAD_COOLDOWN;
      k.item = pickItem(k.rank, state.rng);
      state.events.push({ type: 'item', kart: k, kind: k.item });
      return;
    }
  }
}

function checkSlicks(state, k, travelled) {
  const L = state.circuit.length;
  for (let i = state.slicks.length - 1; i >= 0; i--) {
    const s = state.slicks[i];
    if (s.armT > 0) continue;
    const dist = distAhead(L, k.prev.z, s.z);
    if (dist <= travelled && Math.abs(k.x - s.x) < 0.3) {
      if (applySpin(state, k, 'slick')) state.slicks.splice(i, 1);
      else if (!k.shield) state.slicks.splice(i, 1); // shield popped it
      return;
    }
  }
}

// ---- world objects -------------------------------------------------------

function updateBurrs(state, dt) {
  const L = state.circuit.length;
  for (let i = state.burrs.length - 1; i >= 0; i--) {
    const b = state.burrs[i];
    b.life -= dt;
    if (b.life <= 0) { state.burrs.splice(i, 1); continue; }
    b.z = (b.z + b.speed * dt) % L;
    const t = b.target;
    if (t && !t.finished) {
      const d = distAhead(L, b.z, t.z);
      if (d < L * 0.5) {
        b.x += clamp(t.x - b.x, -1, 1) * dt * 2.4;
        if (d < 180 && Math.abs(t.x - b.x) < 0.36) {
          applySpin(state, t, 'burr');
          state.burrs.splice(i, 1);
        }
      }
    }
  }
}

function updateSlicks(state, dt) {
  for (let i = state.slicks.length - 1; i >= 0; i--) {
    const s = state.slicks[i];
    if (s.armT > 0) s.armT -= dt;
    s.life -= dt;
    if (s.life <= 0) state.slicks.splice(i, 1);
  }
}

function collideKarts(state, dt) {
  const L = state.circuit.length;
  const ks = state.karts;
  if (state.bumpCd > 0) state.bumpCd -= dt;
  for (let i = 0; i < ks.length; i++) {
    for (let j = i + 1; j < ks.length; j++) {
      const a = ks[i], b = ks[j];
      const dz = signedDist(L, a.z, b.z);
      if (Math.abs(dz) > KART_LEN) continue;
      const dx = b.x - a.x;
      if (Math.abs(dx) > KART_W + 0.02) continue;
      // bump apart with speed loss for the trailing kart
      const push = (KART_W + 0.02 - Math.abs(dx)) / 2 + 0.015;
      const sign = dx >= 0 ? 1 : -1;
      a.x -= push * sign;
      b.x += push * sign;
      const rear = a.progress < b.progress ? a : b;
      const front = rear === a ? b : a;
      rear.speed *= 0.87;
      front.speed *= 0.985;
      if ((a.isPlayer || b.isPlayer) && state.bumpCd <= 0) {
        state.bumpCd = 0.35;
        state.events.push({ type: 'bump' });
      }
    }
  }
}

// ---- the step -------------------------------------------------------------

function step(state, input, dt) {
  state.events.length = 0;
  const player = state.karts[0];

  if (state.phase === 'countdown') {
    for (const k of state.karts) { k.prev.z = k.z; k.prev.x = k.x; k.prev.speed = k.speed; }
    const before = Math.ceil(state.countT);
    state.countT -= dt;
    const after = Math.ceil(state.countT);
    if (after !== before && after >= 0 && after <= 3) {
      state.events.push({ type: after <= 0 ? 'go' : 'beep', n: after });
    }
    // start-boost window: remember when the accelerator was first pressed
    if (input.throttle) {
      if (player.pressAt === null) player.pressAt = state.countT;
    } else {
      player.pressAt = null;   // released — the attempt resets
    }
    if (state.countT <= 0) {
      state.phase = 'racing';
      state.time = 0;
      for (const k of state.karts) k.lapStartT = 0;
      // player launch / bog
      if (player.pressAt !== null) {
        if (player.pressAt <= LAUNCH_WINDOW) {
          player.boostT = LAUNCH_BOOST;
          state.events.push({ type: 'launch' });
        } else {
          player.bogT = BOG_TIME;
          state.events.push({ type: 'bog' });
        }
      }
      // some AI nail their launch too
      for (const k of state.karts) {
        if (!k.isPlayer && state.rng() < 0.45) k.boostT = 0.4 + state.rng() * 0.7;
      }
    }
    return state.events;
  }

  state.time += dt;

  for (const k of state.karts) {
    let inp;
    if (k.isPlayer && !k.finished && state.phase === 'racing') inp = input;
    else inp = aiControl(state, k, dt);
    updateKart(state, k, inp, dt);
  }

  updateRanks(state);
  for (const pad of state.pads) if (pad.cd > 0) pad.cd -= dt;
  updateBurrs(state, dt);
  updateSlicks(state, dt);
  collideKarts(state, dt);

  // race ends the moment the player takes the flag
  if (state.phase === 'racing' && player.finished && !state.demo) {
    state.phase = 'finished';
    state.results = state.order.map((k, idx) => ({
      pos: idx + 1,
      name: k.name,
      isPlayer: k.isPlayer,
      bestLap: k.bestLap,
      time: k.finished ? k.finishT : 0,
      finished: k.finished,
    }));
    state.events.push({ type: 'raceOver', playerPos: player.rank });
  }

  return state.events;
}

Object.assign(DK, {
  MAX_SPEED, ACCEL, BRAKE, COAST, OFFROAD_DECEL, OFFROAD_LIMIT, CENTRIFUGAL,
  STEER_RATE, BOOST_MAX, CAM_HEIGHT, FOV, CAM_DEPTH, PLAYER_Z,
  KART_W, KART_LEN, SPIN_TIME, INVULN_TIME,
  DRIFT_MIN_RATIO, DRIFT_KEEP_RATIO, DRIFT_T1, DRIFT_T2, BOOST_T1, BOOST_T2,
  LAUNCH_WINDOW, LAUNCH_BOOST, BOG_TIME, PAD_COOLDOWN, RB_RANGE, RB_MAX,
  ITEM_KINDS, ROSTER,
  createRace, step, aiControl, applySpin, fireItem, weightsFor, pickItem,
  rubberband, distAhead, signedDist,
});

if (typeof module !== 'undefined' && module.exports) module.exports = DK;
})();

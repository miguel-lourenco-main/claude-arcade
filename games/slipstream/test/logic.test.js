// Slipstream — core-rule logic tests (plain node asserts, no DOM).
// Run: node games/slipstream/test/logic.test.js
// The src files are classic scripts; require() runs them for their side
// effects, which populates the globalThis.Slipstream namespace.

'use strict';
const assert = require('assert');

require('../src/track.js');
require('../src/sim.js');

const {
  buildTrack, SEG_LEN, segAt,
  createState, step, autopilot,
  MAX_SPEED, OFFROAD_LIMIT, PLAYER_Z, SPIN_TIME, GEARS,
} = globalThis.Slipstream;

const DT = 1 / 60;
const IDLE = { left: false, right: false, throttle: false, brake: false };
const GAS = { ...IDLE, throttle: true };

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok   ${name}`);
}

function straightTrack(nSegs = 4000) {
  const segments = [];
  for (let i = 0; i < nSegs; i++) {
    segments.push({ i, curve: 0, y1: 0, y2: 0, stripe: Math.floor(i / 3) % 2 === 0, stage: 0, sprites: [] });
  }
  const finishSeg = nSegs - 500;
  return {
    seed: 0, segments,
    stages: [{ name: 'TEST', theme: 0, time: 999, from: 0, to: finishSeg, fromZ: 0 }],
    finishSeg, raceLength: finishSeg * SEG_LEN, length: nSegs * SEG_LEN, cars: [],
  };
}

function run(s, input, seconds, collect) {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) {
    const evs = step(s, typeof input === 'function' ? input(s) : input, DT);
    if (collect) collect.push(...evs);
  }
}

console.log('track');

test('track is deterministic for the same seed', () => {
  const a = buildTrack(), b = buildTrack();
  assert.strictEqual(a.segments.length, b.segments.length);
  for (let i = 0; i < a.segments.length; i += 97) {
    assert.strictEqual(a.segments[i].curve, b.segments[i].curve);
    assert.strictEqual(a.segments[i].y2, b.segments[i].y2);
  }
});

test('five stages with contiguous boundaries and time credits', () => {
  const t = buildTrack();
  assert.strictEqual(t.stages.length, 5);
  t.stages.forEach((st, i) => {
    if (i > 0) assert.strictEqual(st.from, t.stages[i - 1].to);
    assert.ok(st.time > 0, 'every stage grants clock time');
  });
});

test('traffic is seeded on the course', () => {
  const t = buildTrack();
  assert.ok(t.cars.length >= 20);
  t.cars.forEach((c) => {
    assert.ok(c.z > 0 && c.z < t.raceLength);
    assert.ok(c.speedFrac > 0 && c.speedFrac < 1);
  });
});

test('segAt clamps outside the track', () => {
  const t = buildTrack();
  assert.strictEqual(segAt(t, -1).i, 0);
  assert.strictEqual(segAt(t, t.length + 1e6).i, t.segments.length - 1);
});

console.log('driving');

test('throttle accelerates to max speed; countdown holds the clock', () => {
  const s = createState(straightTrack());
  s.running = false;                       // countdown state
  run(s, GAS, 1);
  assert.strictEqual(s.raceTime, 0, 'clock frozen while running=false');
  s.running = true;
  run(s, GAS, 12);
  assert.ok(s.speed > MAX_SPEED * 0.97, `speed ${s.speed}`);
  assert.ok(s.position > 0);
});

test('coasting decays, braking stops, no reverse', () => {
  const s = createState(straightTrack());
  s.running = true;
  run(s, GAS, 8);
  const v0 = s.speed;
  run(s, IDLE, 1);
  assert.ok(s.speed < v0);
  run(s, { ...IDLE, brake: true }, 3);
  assert.strictEqual(s.speed, 0);
});

test('steering moves playerX and is speed-scaled (none when stopped)', () => {
  const s = createState(straightTrack());
  s.running = true;
  run(s, { ...IDLE, right: true }, 1);
  assert.strictEqual(s.playerX, 0, 'no steering at 0 speed');
  s.speed = MAX_SPEED;
  run(s, { ...GAS, right: true }, 0.5);
  assert.ok(s.playerX > 0.5, `playerX ${s.playerX}`);
  const sSlow = createState(straightTrack());
  sSlow.running = true;
  sSlow.speed = MAX_SPEED * 0.25;
  run(sSlow, { ...IDLE, right: true }, 0.5);
  assert.ok(sSlow.playerX < s.playerX, 'slower car steers less');
});

test('centrifugal pull pushes outward and scales with speed', () => {
  const t = buildTrack();
  const bendR = t.segments.find((sg) => sg.curve >= 4);
  const mk = (frac) => {
    const s = createState(t);
    s.running = true; s.cars = [];
    s.position = bendR.i * SEG_LEN - PLAYER_Z;
    s.speed = MAX_SPEED * frac;
    for (let i = 0; i < 30; i++) step(s, IDLE, DT);
    return s.playerX;
  };
  const fast = mk(0.9), slow = mk(0.3);
  assert.ok(fast < -0.05, `right bend pushes left, playerX ${fast}`);
  assert.ok(Math.abs(fast) > Math.abs(slow) * 2, 'pull grows with speed');
});

test('off-road drags speed down to the limit; rumble zone flagged first', () => {
  const s = createState(straightTrack());
  s.running = true;
  s.speed = MAX_SPEED;
  s.playerX = 0.9;
  step(s, IDLE, DT);
  assert.ok(s.onRumble && !s.offRoad, 'rumble strip at the road edge');
  s.playerX = 1.4;
  run(s, GAS, 3);
  assert.ok(s.offRoad);
  assert.ok(s.speed <= OFFROAD_LIMIT + 1, `speed capped at ${s.speed}`);
});

test('gears: five upshifts on a full pull, events emitted', () => {
  const s = createState(straightTrack());
  s.running = true;
  const evs = [];
  run(s, GAS, 12, evs);
  const ups = evs.filter((e) => e.type === 'gear' && e.dir > 0);
  assert.strictEqual(ups.length, GEARS.length - 1);
  assert.strictEqual(s.gear, GEARS.length - 1);
});

console.log('traffic');

test('rear-ending traffic crashes: spin-out + hard slowdown + event', () => {
  const s = createState(straightTrack());
  s.running = true;
  s.cars = [{ z: PLAYER_Z + SEG_LEN * 6, offset: 0, speed: MAX_SPEED * 0.1, kind: 0 }];
  s.speed = MAX_SPEED * 0.9;
  const evs = [];
  run(s, GAS, 0.5, evs);                   // crash lands within ~0.2s; spin lasts 1.15s
  assert.ok(evs.some((e) => e.type === 'crash'));
  assert.ok(s.speed < MAX_SPEED * 0.5, `speed ${s.speed}`);
  assert.ok(s.spin > 0 && s.spin <= SPIN_TIME, `spin ${s.spin}`);
});

test('clean overtake scores a pass; close fast pass whooshes', () => {
  const s = createState(straightTrack());
  s.running = true;
  s.cars = [{ z: PLAYER_Z + SEG_LEN * 8, offset: 0.55, speed: MAX_SPEED * 0.2, kind: 0 }];
  s.speed = MAX_SPEED * 0.95;
  s.playerX = -0.15;
  const before = s.score;
  const evs = [];
  run(s, GAS, 3, evs);
  assert.strictEqual(s.passes, 1);
  assert.ok(s.score > before + 300, 'pass adds score');
  assert.ok(evs.some((e) => e.type === 'whoosh'));
});

console.log('clock / checkpoints / finish');

test('checkpoint adds the next stage time and advances the stage', () => {
  const t = buildTrack();
  const s = createState(t);
  s.running = true; s.cars = [];
  s.position = t.stages[1].fromZ - PLAYER_Z - SEG_LEN * 4;
  s.speed = MAX_SPEED * 0.8;
  const t0 = s.timeLeft;
  const evs = [];
  run(s, GAS, 1.5, evs);
  const cp = evs.find((e) => e.type === 'checkpoint');
  assert.ok(cp, 'checkpoint event fired');
  assert.strictEqual(cp.add, t.stages[1].time);
  assert.strictEqual(s.stageIdx, 1);
  assert.ok(s.timeLeft > t0 - 1.5 + t.stages[1].time - 1, 'time credited');
});

test('clock at zero ends the race and the car coasts to a stop', () => {
  const s = createState(buildTrack());
  s.running = true; s.cars = [];
  s.timeLeft = 0.4;
  s.speed = MAX_SPEED * 0.7;
  const evs = [];
  run(s, GAS, 1, evs);
  assert.strictEqual(s.phase, 'gameover');
  assert.ok(evs.some((e) => e.type === 'timeup'));
  run(s, GAS, 8, evs);
  assert.strictEqual(s.speed, 0, 'throttle ignored after game over');
});

test('finish computes results with time/pass/speed bonuses', () => {
  const t = straightTrack(1200);           // finish at seg 700
  const s = createState(t);
  s.running = true;
  s.passes = 3;
  const evs = [];
  run(s, GAS, 30, evs);
  assert.strictEqual(s.phase, 'finished');
  assert.ok(evs.some((e) => e.type === 'finish'));
  const r = s.results;
  assert.strictEqual(r.passBonus, 3 * 150);
  assert.strictEqual(r.timeBonus, Math.round(r.timeLeft) * 120);
  assert.strictEqual(r.speedBonus, Math.round((r.topSpeed / MAX_SPEED) * 100) * 20);
  assert.strictEqual(s.score, r.total);
});

test('autopilot completes the full designed course', () => {
  const s = createState(buildTrack());
  s.running = true;
  let ticks = 0;
  const cap = 60 * 60 * 8;
  while (s.phase === 'racing' && ticks < cap) { step(s, autopilot(s), DT); ticks++; }
  assert.strictEqual(s.phase, 'finished', `phase=${s.phase} after ${ticks} ticks`);
  assert.strictEqual(s.stageIdx, s.track.stages.length - 1);
  assert.ok(s.results.total > 0);
});

console.log(`\nall ${passed} logic tests passed`);

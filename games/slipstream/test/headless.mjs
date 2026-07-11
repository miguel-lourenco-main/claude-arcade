// Slipstream — headless engine tests. Run: node test/headless.mjs
// Drives the pure track/sim modules from node; no DOM required.

import { buildTrack, SEG_LEN, segAt } from '../src/track.js';
import {
  createState, step, autopilot,
  MAX_SPEED, OFFROAD_LIMIT, PLAYER_Z, SPIN_TIME,
} from '../src/sim.js';

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`  ok   ${name}${extra ? '  (' + extra + ')' : ''}`);
  else { console.error(`  FAIL ${name}${extra ? '  (' + extra + ')' : ''}`); failures++; }
}

const DT = 1 / 60;
const IDLE = { left: false, right: false, throttle: false, brake: false };
const GAS = { ...IDLE, throttle: true };

// Minimal synthetic course (one long straight) to isolate pure physics
// from the designed track's curves.
function straightTrack(nSegs = 4000) {
  const segments = [];
  for (let i = 0; i < nSegs; i++) {
    segments.push({
      i, curve: 0, y1: 0, y2: 0,
      stripe: Math.floor(i / 3) % 2 === 0,
      stage: 0, sprites: [],
    });
  }
  const finishSeg = nSegs - 500;
  return {
    seed: 0, segments,
    stages: [{ name: 'TEST', theme: 0, time: 999, from: 0, to: finishSeg, fromZ: 0 }],
    finishSeg,
    raceLength: finishSeg * SEG_LEN,
    length: nSegs * SEG_LEN,
    cars: [],
  };
}

function run(s, input, seconds, collect) {
  const ticks = Math.round(seconds / DT);
  for (let i = 0; i < ticks; i++) {
    const inp = typeof input === 'function' ? input(s) : input;
    const evs = step(s, inp, DT);
    if (collect) for (const e of evs) collect.push(e);
  }
}

// ---------------------------------------------------------------- track
console.log('track construction');
const track = buildTrack();
check('has a healthy segment count', track.segments.length > 3000, `${track.segments.length} segments`);
check('five stages', track.stages.length === 5);
check('stage boundaries are monotonic',
  track.stages.every((st, i) => i === 0 || st.from === track.stages[i - 1].to));
check('elevation is continuous',
  track.segments.every((seg, i) => i === 0 || Math.abs(seg.y1 - track.segments[i - 1].y2) < 1e-6));
check('run-out road past the finish',
  track.segments.length - track.finishSeg > 350, `${track.segments.length - track.finishSeg} spare`);
check('deterministic (same seed, same course)', (() => {
  const t2 = buildTrack();
  return t2.segments.length === track.segments.length &&
    t2.segments.every((sg, i) =>
      sg.curve === track.segments[i].curve && sg.y2 === track.segments[i].y2) &&
    t2.cars.every((c, i) => c.z === track.cars[i].z && c.offset === track.cars[i].offset);
})());
check('traffic seeded on the course',
  track.cars.length > 20 && track.cars.every((c) => c.z > 0 && c.z < track.raceLength));
check('rumble stripe bands alternate',
  track.segments[0].stripe !== track.segments[3].stripe &&
  track.segments[0].stripe === track.segments[1].stripe);
check('roadside sprites placed', track.segments.reduce((n, sg) => n + sg.sprites.length, 0) > 400);

// ---------------------------------------------------------------- acceleration
console.log('acceleration / coasting / braking');
{
  const s = createState(straightTrack());
  s.running = true;
  run(s, GAS, 12);
  check('reaches near max speed under throttle', s.speed > MAX_SPEED * 0.97, `${Math.round(s.speed)}`);
  check('position advances', s.position > 0);
  check('gear climbed to top', s.gear === 5, `gear ${s.gear + 1}`);
  const v0 = s.speed;
  run(s, IDLE, 1.5);
  check('coasting decays speed', s.speed < v0 - MAX_SPEED * 0.03);
  run(s, { ...IDLE, brake: true }, 2);
  check('braking stops the car', s.speed === 0);
  const xBefore = s.playerX;
  run(s, { ...IDLE, left: true }, 1);
  check('no steering when stopped', s.playerX === xBefore);
}

// ---------------------------------------------------------------- centrifugal
console.log('centrifugal pull');
{
  // find a sustained right-hand bend
  const bend = track.segments.find((sg) => sg.curve >= 4);
  check('course has a hard right bend', !!bend);
  const s = createState(track);
  s.running = true;
  s.cars = [];
  s.position = bend.i * SEG_LEN - PLAYER_Z;
  s.speed = MAX_SPEED * 0.9;
  s.prev.speed = s.speed;
  run(s, GAS, 0.5);
  check('right bend pushes the car outward (left)', s.playerX < -0.05, `playerX ${s.playerX.toFixed(3)}`);

  const bendL = track.segments.find((sg) => sg.curve <= -4);
  const s2 = createState(track);
  s2.running = true;
  s2.cars = [];
  s2.position = bendL.i * SEG_LEN - PLAYER_Z;
  s2.speed = MAX_SPEED * 0.9;
  run(s2, GAS, 0.5);
  check('left bend pushes the car outward (right)', s2.playerX > 0.05, `playerX ${s2.playerX.toFixed(3)}`);

  // pull scales with speed: slow car drifts less
  const s3 = createState(track);
  s3.running = true;
  s3.cars = [];
  s3.position = bend.i * SEG_LEN - PLAYER_Z;
  s3.speed = MAX_SPEED * 0.3;
  let drift3 = 0;
  for (let i = 0; i < 30; i++) { step(s3, { ...IDLE }, DT); }
  drift3 = Math.abs(s3.playerX);
  const s4 = createState(track);
  s4.running = true;
  s4.cars = [];
  s4.position = bend.i * SEG_LEN - PLAYER_Z;
  s4.speed = MAX_SPEED * 0.9;
  for (let i = 0; i < 30; i++) { step(s4, { ...IDLE }, DT); }
  check('pull scales with speed', Math.abs(s4.playerX) > drift3 * 2,
    `fast ${Math.abs(s4.playerX).toFixed(3)} vs slow ${drift3.toFixed(3)}`);
}

// ---------------------------------------------------------------- off-road & rumble
console.log('off-road / rumble strips');
{
  const s = createState(track);
  s.running = true;
  s.cars = [];
  s.speed = MAX_SPEED;
  s.playerX = 1.4;
  run(s, GAS, 3);
  check('off-road flag set', s.offRoad);
  check('heavy off-road deceleration caps speed', s.speed <= OFFROAD_LIMIT + 1, `${Math.round(s.speed)}`);

  const s2 = createState(track);
  s2.running = true;
  s2.cars = [];
  s2.speed = MAX_SPEED * 0.8;
  s2.playerX = 0.9;
  step(s2, IDLE, DT);
  check('rumble strip zone flagged at the road edge', s2.onRumble && !s2.offRoad);
}

// ---------------------------------------------------------------- gears
console.log('gear shift events');
{
  const s = createState(straightTrack());
  s.running = true;
  const evs = [];
  run(s, GAS, 12, evs);
  const ups = evs.filter((e) => e.type === 'gear' && e.dir > 0);
  check('five upshifts on a full pull', ups.length === 5, `${ups.length}`);
}

// ---------------------------------------------------------------- traffic
console.log('traffic: collision, spin-out, passes');
{
  const s = createState(track);
  s.running = true;
  s.cars = [{ z: s.position + PLAYER_Z + SEG_LEN * 6, offset: 0, speed: MAX_SPEED * 0.1, kind: 0 }];
  s.speed = MAX_SPEED * 0.9;
  s.playerX = 0;
  const evs = [];
  run(s, GAS, 2, evs);
  check('collision event fired', evs.some((e) => e.type === 'crash'));
  check('collision causes hard slowdown + spin-out', s.spin > 0 || evs.some((e) => e.type === 'crash'));
  const crashTickSpeed = s.speed;
  check('speed knocked far down after crash', crashTickSpeed < MAX_SPEED * 0.5, `${Math.round(crashTickSpeed)}`);

  // clean pass in the next lane over
  const s2 = createState(straightTrack());
  s2.running = true;
  s2.cars = [{ z: s2.position + PLAYER_Z + SEG_LEN * 8, offset: 0.55, speed: MAX_SPEED * 0.2, kind: 0 }];
  s2.speed = MAX_SPEED * 0.95;
  s2.playerX = -0.15;
  const evs2 = [];
  run(s2, GAS, 3, evs2);
  check('overtake counted', s2.passes === 1, `${s2.passes}`);
  check('close fast pass emits whoosh', evs2.some((e) => e.type === 'whoosh'));
}

// ---------------------------------------------------------------- checkpoints & clock
console.log('checkpoint timer');
{
  const s = createState(track);
  s.running = true;
  s.cars = [];
  const st1 = track.stages[1];
  s.position = st1.fromZ - PLAYER_Z - SEG_LEN * 4;
  s.speed = MAX_SPEED * 0.8;
  const t0 = s.timeLeft;
  const evs = [];
  run(s, GAS, 1.5, evs);
  const cp = evs.find((e) => e.type === 'checkpoint');
  check('crossing a stage boundary fires a checkpoint', !!cp);
  check('checkpoint adds time', cp && s.timeLeft > t0 - 1.5 + st1.time - 1, `+${cp && cp.add}s`);
  check('stage index advanced', s.stageIdx === 1);

  const s2 = createState(track);
  s2.running = true;
  s2.cars = [];
  s2.timeLeft = 0.4;
  s2.speed = MAX_SPEED * 0.7;
  const evs2 = [];
  run(s2, GAS, 1, evs2);
  check('clock at zero ends the race', s2.phase === 'gameover' && evs2.some((e) => e.type === 'timeup'));
  run(s2, GAS, 8, evs2);
  check('game over slows the car to a stop (throttle ignored)', s2.speed === 0, `${Math.round(s2.speed)}`);
}

// ---------------------------------------------------------------- full race via autopilot
console.log('full course feasibility (autopilot)');
{
  const s = createState(track);
  s.running = true;
  const evs = [];
  let ticks = 0;
  const maxTicks = 60 * 60 * 8; // 8 minutes hard cap
  while (s.phase === 'racing' && ticks < maxTicks) {
    const e = step(s, autopilot(s), DT);
    for (const ev of e) evs.push(ev);
    ticks++;
  }
  const cps = evs.filter((e) => e.type === 'checkpoint').length;
  check('autopilot reaches all checkpoints', cps === track.stages.length - 1, `${cps}`);
  check('autopilot finishes the course', s.phase === 'finished',
    `phase=${s.phase} stage=${s.stageIdx + 1} raceTime=${s.raceTime.toFixed(1)}s timeLeft=${s.timeLeft.toFixed(1)}s`);
  if (s.results) {
    console.log(`       results: time ${s.results.raceTime.toFixed(1)}s, spare ${s.results.timeLeft.toFixed(1)}s, ` +
      `passes ${s.results.passes}, top ${Math.round(s.results.topSpeed)}, score ${s.results.total}`);
    check('score computed', s.results.total > 0);
    check('finishing leaves sensible spare time (not too tight, not trivial)',
      s.results.timeLeft > 12 && s.results.timeLeft < 60, `${s.results.timeLeft.toFixed(1)}s spare`);
  }
  check('spin-out timer never sticks', s.spin >= 0 && s.spin <= SPIN_TIME);
}

// ---------------------------------------------------------------- interpolation support
console.log('render interpolation support');
{
  const s = createState(track);
  s.running = true;
  s.cars = [];
  s.speed = MAX_SPEED * 0.5;
  step(s, GAS, DT);
  check('prev snapshot captured for interpolation',
    s.prev.position < s.position && typeof s.prev.playerX === 'number');
  check('segAt clamps beyond the track end',
    segAt(track, track.length + 99999).i === track.segments.length - 1 && segAt(track, -50).i === 0);
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);

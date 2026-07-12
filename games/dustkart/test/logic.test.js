// Dustkart — node-runnable pure-logic tests (no DOM, no canvas).
// Run: node games/dustkart/test/logic.test.js   (exit 0 on pass)

'use strict';
const assert = require('node:assert');
require('../src/circuits.js');
require('../src/sim.js');
const DK = globalThis.Dustkart;

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log(`  ok   ${name}`);
}

// deterministic rng for reproducible races
function seededRng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1103515245 + 12345) >>> 0) / 4294967296;
}

const DT = 1 / 60;
const NO_INPUT = { left: false, right: false, throttle: false, brake: false, drift: false, fire: false };

function freshRace(ci = 0, opts = {}) {
  const c = DK.buildCircuit(ci);
  return DK.createRace(c, { rng: seededRng(opts.seed || 99), ...opts });
}

// fast-forward through the countdown without pressing anything
function goLive(st) {
  DK.step(st, NO_INPUT, 4);
  assert.strictEqual(st.phase, 'racing');
  // park the AI far away so player-physics tests are undisturbed
  for (let i = 1; i < st.karts.length; i++) {
    st.karts[i].z = (st.karts[i].z + st.circuit.length * 0.5) % st.circuit.length;
    st.karts[i].speed = 0;
  }
}

// ------------------------------------------------------------- circuits
console.log('circuits:');

ok('three circuits build, wrap-closed in height, segments contiguous', () => {
  assert.strictEqual(DK.CIRCUIT_INFO.length, 3);
  for (let i = 0; i < 3; i++) {
    const c = DK.buildCircuit(i);
    assert.ok(c.N > 500, `${c.name} has ${c.N} segments`);
    assert.strictEqual(c.length, c.N * DK.SEG_LEN);
    // vertical closure: last y2 meets first y1
    assert.ok(Math.abs(c.segments[c.N - 1].y2 - c.segments[0].y1) < 1e-6);
    for (let s = 0; s < c.N - 1; s++) {
      assert.ok(Math.abs(c.segments[s].y2 - c.segments[s + 1].y1) < 1e-6, 'contiguous heights');
    }
  }
});

ok('each circuit has item pads on calm road', () => {
  for (let i = 0; i < 3; i++) {
    const c = DK.buildCircuit(i);
    assert.ok(c.pads.length >= 15, `${c.name} has ${c.pads.length} pad slots`);
    for (const p of c.pads) {
      assert.ok(Math.abs(c.segments[p.seg].curve) < 1.2, 'pads sit on calm segments');
      assert.strictEqual(p.z, p.seg * DK.SEG_LEN);
    }
  }
});

ok('racing line stays on the road and cuts toward apexes', () => {
  for (let i = 0; i < 3; i++) {
    const c = DK.buildCircuit(i);
    for (const s of c.segments) assert.ok(Math.abs(s.line) <= 0.62);
    // in the middle of the hardest bend, the line leans toward the inside
    let hardest = c.segments[0];
    for (const s of c.segments) if (Math.abs(s.curve) > Math.abs(hardest.curve)) hardest = s;
    const entry = c.segments[(hardest.i - 10 + c.N) % c.N];
    assert.ok(entry.line * hardest.curve > 0, 'line sign matches bend direction near the apex');
  }
});

ok('circuit shapes are distinct: hairpins and chicanes exist', () => {
  const cSun = DK.buildCircuit(0), cBram = DK.buildCircuit(1);
  const maxCurve = (c) => Math.max(...c.segments.map((s) => Math.abs(s.curve)));
  assert.ok(maxCurve(cBram) >= 6, 'Bramble Hollow has a hairpin');
  assert.ok(maxCurve(cSun) <= 4.5, 'Sunspur is the fast circuit');
  // chicane: a hard sign flip within a short window
  let flip = false;
  for (let i = 0; i < cSun.N - 40; i++) {
    const a = cSun.segments[i].curve;
    if (a >= 3.5) {
      for (let j = i + 1; j < i + 60; j++) {
        if (cSun.segments[j % cSun.N].curve <= -3.5) { flip = true; break; }
      }
    }
    if (flip) break;
  }
  assert.ok(flip, 'Sunspur has a chicane');
});

ok('minimap polyline is normalized and closes the loop', () => {
  for (let i = 0; i < 3; i++) {
    const c = DK.buildCircuit(i);
    assert.strictEqual(c.map.length, c.N);
    for (const p of c.map) {
      assert.ok(p.x >= -0.02 && p.x <= 1.02 && p.y >= -0.02 && p.y <= 1.02);
    }
    const a = c.map[0], b = c.map[c.N - 1];
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 0.02, 'polyline endpoints meet');
  }
});

ok('segAt wraps in both directions', () => {
  const c = DK.buildCircuit(0);
  assert.strictEqual(DK.segAt(c, 0).i, 0);
  assert.strictEqual(DK.segAt(c, c.length + DK.SEG_LEN * 1.5).i, 1);
  assert.strictEqual(DK.segAt(c, -1).i, c.N - 1);
});

// ------------------------------------------------------------- handling
console.log('handling:');

ok('throttle accelerates toward max, brake slows, coast decays', () => {
  const st = freshRace();
  goLive(st);
  const p = st.karts[0];
  p.z = st.circuit.length * 0.25; p.x = 0;
  for (let i = 0; i < 240; i++) { p.x = 0; DK.step(st, { ...NO_INPUT, throttle: true }, DT); }
  assert.ok(p.speed > DK.MAX_SPEED * 0.85, `accelerated to ${p.speed}`);
  assert.ok(p.speed <= DK.MAX_SPEED + 1, 'clamped at max');
  const v0 = p.speed;
  DK.step(st, { ...NO_INPUT, brake: true }, DT);
  assert.ok(p.speed < v0 - 50, 'brake bites');
  const v1 = p.speed;
  DK.step(st, NO_INPUT, DT);
  assert.ok(p.speed < v1, 'coasting decays');
});

ok('steering is scaled by speed (parked karts cannot steer)', () => {
  const st = freshRace();
  goLive(st);
  const p = st.karts[0];
  p.z = st.circuit.length * 0.25; p.x = 0; p.speed = 0;
  DK.step(st, { ...NO_INPUT, right: true }, DT);
  assert.strictEqual(p.x, 0, 'no steering at standstill');
  p.speed = DK.MAX_SPEED * 0.6;
  const x0 = p.x;
  DK.step(st, { ...NO_INPUT, right: true }, DT);
  assert.ok(p.x > x0, 'steering works at speed');
});

ok('centrifugal force pulls outward through bends', () => {
  const st = freshRace();
  goLive(st);
  const c = st.circuit;
  let bendSeg = null;
  for (const s of c.segments) if (s.curve > 3) { bendSeg = s; break; }
  assert.ok(bendSeg, 'found a right-hand bend');
  const p = st.karts[0];
  p.z = bendSeg.i * DK.SEG_LEN; p.x = 0; p.speed = DK.MAX_SPEED * 0.9;
  DK.step(st, NO_INPUT, DT);
  assert.ok(p.x < 0, 'pushed toward the outside (left) of a right bend');
});

ok('off-road drags speed down hard — unless boosting', () => {
  const st = freshRace();
  goLive(st);
  const p = st.karts[0];
  p.z = st.circuit.length * 0.25; p.x = 1.6; p.speed = DK.MAX_SPEED;
  for (let i = 0; i < 90; i++) { p.x = 1.6; DK.step(st, { ...NO_INPUT, throttle: true }, DT); }
  assert.ok(p.offRoad, 'flagged off-road');
  assert.ok(p.speed <= DK.OFFROAD_LIMIT * 1.05, `dragged to ${p.speed} <= ${DK.OFFROAD_LIMIT}`);
  p.boostT = 2;
  for (let i = 0; i < 30; i++) { p.x = 1.6; DK.step(st, { ...NO_INPUT, throttle: true }, DT); }
  assert.ok(p.speed > DK.MAX_SPEED * 0.8, 'boost ignores the off-road drag');
});

// ------------------------------------------------------------- countdown & start boost
console.log('start boost:');

ok('countdown beeps then GO, no press = clean start', () => {
  const st = freshRace();
  const seen = [];
  while (st.phase === 'countdown') {
    for (const e of DK.step(st, NO_INPUT, DT)) seen.push(e.type);
  }
  assert.ok(seen.filter((t) => t === 'beep').length >= 3, '3 beeps');
  assert.ok(seen.includes('go'), 'GO fired');
  assert.strictEqual(st.karts[0].boostT, 0);
  assert.strictEqual(st.karts[0].bogT, 0);
});

ok('accelerating inside the launch window grants a start boost', () => {
  const st = freshRace();
  const evs = [];
  while (st.phase === 'countdown') {
    const press = st.countT <= DK.LAUNCH_WINDOW - 0.05;
    for (const e of DK.step(st, { ...NO_INPUT, throttle: press }, DT)) evs.push(e.type);
  }
  assert.ok(evs.includes('launch'), 'launch event');
  assert.ok(st.karts[0].boostT > 1, 'boost applied');
});

ok('jumping the gun bogs the kart down', () => {
  const st = freshRace();
  const evs = [];
  while (st.phase === 'countdown') {
    for (const e of DK.step(st, { ...NO_INPUT, throttle: true }, DT)) evs.push(e.type);
  }
  assert.ok(evs.includes('bog'), 'bog event');
  assert.ok(st.karts[0].bogT > 0, 'bogged');
  // a bogged kart barely accelerates for the bog second
  const p = st.karts[0];
  for (let i = 0; i < 30; i++) DK.step(st, { ...NO_INPUT, throttle: true }, DT);
  assert.ok(p.speed < DK.MAX_SPEED * 0.26, `crawling at ${p.speed}`);
});

// ------------------------------------------------------------- drift
console.log('drift:');

function driftSetup() {
  const st = freshRace();
  goLive(st);
  const p = st.karts[0];
  p.z = st.circuit.length * 0.25;
  p.speed = DK.MAX_SPEED * 0.85;
  p.x = 0;
  return { st, p };
}

ok('holding drift while turning at speed starts a slide; charge builds tiers', () => {
  const { st, p } = driftSetup();
  const inp = { ...NO_INPUT, throttle: true, right: true, drift: true };
  DK.step(st, inp, DT);
  assert.ok(p.drift.on, 'drift started');
  assert.strictEqual(p.drift.dir, 1);
  assert.strictEqual(p.pose, 2, 'hard drift pose');
  const evs = [];
  let ticks = 0;
  while (p.drift.tier < 2 && ticks++ < 60 * 3) {
    p.x = 0; p.speed = DK.MAX_SPEED * 0.85;
    for (const e of DK.step(st, inp, DT)) evs.push(e);
  }
  assert.strictEqual(p.drift.tier, 2, 'reached tier 2');
  const tiers = evs.filter((e) => e.type === 'driftTier').map((e) => e.tier);
  assert.deepStrictEqual(tiers, [1, 2], 'tier 1 then tier 2 announced');
});

ok('releasing the drift pays out a mini-boost scaled to the tier', () => {
  // tier 1
  let { st, p } = driftSetup();
  const inp = { ...NO_INPUT, throttle: true, right: true, drift: true };
  while (p.drift.tier < 1) { p.x = 0; p.speed = DK.MAX_SPEED * 0.85; DK.step(st, inp, DT); }
  let evs = DK.step(st, { ...inp, drift: false }, DT);
  assert.ok(evs.some((e) => e.type === 'boost' && e.tier === 1), 'tier-1 boost event');
  assert.ok(Math.abs(p.boostT - DK.BOOST_T1) < 0.02, `~${DK.BOOST_T1}s of boost`);
  assert.ok(!p.drift.on);
  // tier 2
  ({ st, p } = driftSetup());
  while (p.drift.tier < 2) { p.x = 0; p.speed = DK.MAX_SPEED * 0.85; DK.step(st, inp, DT); }
  evs = DK.step(st, { ...inp, drift: false }, DT);
  assert.ok(evs.some((e) => e.type === 'boost' && e.tier === 2), 'tier-2 boost event');
  assert.ok(Math.abs(p.boostT - DK.BOOST_T2) < 0.02, `~${DK.BOOST_T2}s of boost`);
  // boost carries the kart over max speed
  for (let i = 0; i < 30; i++) { p.x = 0; DK.step(st, { ...NO_INPUT, throttle: true }, DT); }
  assert.ok(p.speed > DK.MAX_SPEED * 1.05, 'over-max while boosting');
});

ok('steering against the drift cancels it without a boost', () => {
  const { st, p } = driftSetup();
  const inp = { ...NO_INPUT, throttle: true, right: true, drift: true };
  while (p.drift.tier < 1) { p.x = 0; p.speed = DK.MAX_SPEED * 0.85; DK.step(st, inp, DT); }
  const evs = DK.step(st, { ...NO_INPUT, throttle: true, left: true, drift: true }, DT);
  assert.ok(evs.some((e) => e.type === 'driftCancel'), 'cancel event');
  assert.ok(!p.drift.on && p.boostT === 0, 'no boost paid');
});

ok('dropping below the keep-speed cancels the drift', () => {
  const { st, p } = driftSetup();
  const inp = { ...NO_INPUT, right: true, drift: true };
  DK.step(st, inp, DT);
  assert.ok(p.drift.on);
  p.speed = DK.MAX_SPEED * 0.2;
  const evs = DK.step(st, inp, DT);
  assert.ok(evs.some((e) => e.type === 'driftCancel'));
  assert.ok(!p.drift.on && p.boostT === 0);
});

ok('a drift cannot start below the minimum speed', () => {
  const { st, p } = driftSetup();
  p.speed = DK.MAX_SPEED * 0.3;
  DK.step(st, { ...NO_INPUT, right: true, drift: true }, DT);
  assert.ok(!p.drift.on);
});

// ------------------------------------------------------------- laps, progress, ranking
console.log('laps & ranking:');

ok('crossing the start/finish wraps position and counts the lap', () => {
  const st = freshRace();
  goLive(st);
  const p = st.karts[0];
  const L = st.circuit.length;
  p.z = L - 100; p.x = 0; p.speed = DK.MAX_SPEED * 0.9;
  st.time = 40; p.lapStartT = 5;
  const evs = DK.step(st, { ...NO_INPUT, throttle: true }, DT);
  assert.strictEqual(p.laps, 1, 'lap counted');
  assert.ok(p.z < 1000, 'position wrapped');
  const lapEv = evs.find((e) => e.type === 'lap');
  assert.ok(lapEv && Math.abs(lapEv.lapTime - 35) < 0.1, 'lap time recorded');
  assert.ok(Math.abs(p.bestLap - 35) < 0.1, 'best lap kept');
});

ok('progress = laps * length + z drives the live ranking', () => {
  const st = freshRace();
  goLive(st);
  const L = st.circuit.length;
  st.karts.forEach((k, i) => { k.laps = i === 0 ? 2 : 0; k.z = 1000 + i * 500; k.speed = 0; });
  DK.step(st, NO_INPUT, DT);
  const p = st.karts[0];
  assert.ok(Math.abs(p.progress - (2 * L + p.z)) < 1e-6);
  assert.strictEqual(p.rank, 1, 'two laps up = 1st');
  assert.strictEqual(st.order[0], p);
  for (let i = 1; i < st.order.length; i++) {
    assert.ok(st.order[i - 1].progress >= st.order[i].progress, 'order sorted by progress');
  }
});

// ------------------------------------------------------------- items
console.log('items:');

ok('item weights favor the leader weak / the last strong', () => {
  const w1 = DK.weightsFor(1), w6 = DK.weightsFor(6);
  assert.strictEqual(w1.burr, 0, 'leader never draws the burr');
  assert.strictEqual(w1.tangleroot, 0, 'leader never draws tangleroot');
  assert.ok(w1.slick + w1.barkshield + w1.gust > 0);
  assert.strictEqual(w6.slick, 0, 'last place never draws the slick');
  assert.ok(w6.tangleroot >= 30 && w6.burr >= 30, 'last place draws strong items');
  for (let r = 1; r <= 6; r++) {
    for (let t = 0; t < 20; t++) {
      assert.ok(DK.ITEM_KINDS.includes(DK.pickItem(r, seededRng(t * 7 + r))));
    }
  }
});

ok('driving over an item pad grants an item and cools the pad down', () => {
  const st = freshRace();
  goLive(st);
  const p = st.karts[0];
  const pad = st.pads[0];
  p.z = (pad.z - 150 + st.circuit.length) % st.circuit.length;
  p.speed = DK.MAX_SPEED * 0.8;
  let evs = [];
  for (let i = 0; i < 4; i++) {
    p.x = pad.x;
    evs = evs.concat(DK.step(st, { ...NO_INPUT, throttle: true }, DT));
  }
  assert.ok(p.item, `got ${p.item}`);
  assert.ok(evs.some((e) => e.type === 'item' && e.kart === p));
  assert.ok(pad.cd > DK.PAD_COOLDOWN - 0.5, 'pad cooling down');
  // a kart already holding an item cannot double-dip
  const held = p.item;
  pad.cd = 0;
  p.z = (pad.z - 150 + st.circuit.length) % st.circuit.length;
  for (let i = 0; i < 4; i++) { p.x = pad.x; DK.step(st, { ...NO_INPUT, throttle: true }, DT); }
  assert.strictEqual(p.item, held, 'still holding the same item');
  assert.strictEqual(pad.cd, 0, 'pad untouched');
});

ok('sap slick drops behind and spins whoever runs it over', () => {
  const st = freshRace();
  goLive(st);
  const p = st.karts[0];
  p.z = st.circuit.length * 0.25; p.x = 0; p.speed = DK.MAX_SPEED * 0.8;
  p.item = 'slick';
  DK.step(st, { ...NO_INPUT, throttle: true, fire: true }, DT);
  assert.strictEqual(st.slicks.length, 1, 'slick on the road');
  assert.ok(st.slicks[0].z < p.z, 'dropped behind');
  // run the player over it
  st.slicks[0].armT = 0;
  const slickX = st.slicks[0].x;
  p.z = (st.slicks[0].z - 200 + st.circuit.length) % st.circuit.length;
  let evs = [];
  for (let i = 0; i < 4 && !p.spinT; i++) {
    p.x = slickX;
    evs = evs.concat(DK.step(st, { ...NO_INPUT, throttle: true }, DT));
  }
  assert.ok(evs.some((e) => e.type === 'spin' && e.cause === 'slick'), 'spun out');
  assert.ok(p.spinT > 0, 'spinning');
  assert.strictEqual(st.slicks.length, 0, 'slick consumed');
});

ok('spin-out lasts ~1s then grants brief invulnerability', () => {
  const st = freshRace();
  goLive(st);
  const p = st.karts[0];
  p.z = st.circuit.length * 0.25; p.speed = DK.MAX_SPEED;
  DK.applySpin(st, p, 'test');
  assert.ok(p.spinT > 0 && p.speed < DK.MAX_SPEED * 0.5, 'heavy slowdown');
  let ticks = 0;
  while (p.spinT > 0 && ticks++ < 120) DK.step(st, NO_INPUT, DT);
  assert.ok(ticks >= Math.floor(DK.SPIN_TIME / DT) - 3 && ticks <= Math.ceil(DK.SPIN_TIME / DT) + 3, `spin lasted ${ticks} ticks`);
  assert.ok(p.invulnT > 0, 'invulnerable after the spin');
  assert.strictEqual(DK.applySpin(st, p, 'test'), false, 'cannot be spun while invulnerable');
});

ok('barkshield absorbs one hit', () => {
  const st = freshRace();
  goLive(st);
  const p = st.karts[0];
  p.item = 'barkshield';
  DK.fireItem(st, p);
  assert.ok(p.shield, 'shield up');
  const spun = DK.applySpin(st, p, 'burr');
  assert.strictEqual(spun, false, 'hit absorbed');
  assert.ok(!p.shield, 'shield consumed');
  assert.strictEqual(p.spinT, 0, 'no spin');
  assert.ok(st.events.some((e) => e.type === 'shieldHit'));
});

ok('homing burr chases and spins the kart ahead', () => {
  const st = freshRace();
  goLive(st);
  const L = st.circuit.length;
  const owner = st.karts[0];
  const prey = st.karts[1];
  owner.z = L * 0.25; owner.x = 0; owner.speed = DK.MAX_SPEED * 0.8;
  prey.z = L * 0.25 + DK.SEG_LEN * 25; prey.x = 0.4; prey.speed = DK.MAX_SPEED * 0.7;
  prey.laps = owner.laps;
  DK.step(st, NO_INPUT, DT); // refresh ranks: prey directly ahead of owner
  assert.ok(prey.rank === owner.rank - 1, 'prey is directly ahead');
  owner.item = 'burr';
  DK.fireItem(st, owner);
  assert.strictEqual(st.burrs.length, 1);
  assert.strictEqual(st.burrs[0].target, prey, 'locked on the kart ahead');
  let spun = false;
  for (let i = 0; i < 60 * 5 && !spun; i++) {
    for (const e of DK.step(st, { ...NO_INPUT, throttle: true }, DT)) {
      if (e.type === 'spin' && e.kart === prey && e.cause === 'burr') spun = true;
    }
  }
  assert.ok(spun, 'burr caught its target');
});

ok('tangleroot snares every kart ahead — and nobody behind', () => {
  const st = freshRace();
  goLive(st);
  const L = st.circuit.length;
  st.karts.forEach((k, i) => { k.z = 2000 + i * 3000; k.laps = 0; k.speed = 0; k.invulnT = 0; });
  DK.step(st, NO_INPUT, DT);   // ranks: karts[5] leads, karts[0] last
  const owner = st.order[3];   // 4th place
  owner.item = 'tangleroot';
  DK.fireItem(st, owner);
  const spins = st.events.filter((e) => e.type === 'spin' && e.cause === 'tangleroot');
  assert.strictEqual(spins.length, 3, 'exactly the three karts ahead');
  for (const e of spins) assert.ok(e.kart.rank < owner.rank);
  assert.strictEqual(owner.spinT, 0, 'the thrower is safe');
  assert.strictEqual(st.order[4].spinT, 0, 'karts behind are safe');
  void L;
});

ok('gust vial boosts straight over max speed', () => {
  const st = freshRace();
  goLive(st);
  const p = st.karts[0];
  p.z = st.circuit.length * 0.25; p.x = 0; p.speed = DK.MAX_SPEED;
  p.item = 'gust';
  DK.step(st, { ...NO_INPUT, throttle: true, fire: true }, DT);
  assert.ok(p.boostT > 1, 'boosting');
  for (let i = 0; i < 30; i++) { p.x = 0; DK.step(st, { ...NO_INPUT, throttle: true }, DT); }
  assert.ok(p.speed > DK.MAX_SPEED * 1.1, 'over max');
});

// ------------------------------------------------------------- AI
console.log('ai:');

ok('rubberbanding: mild capped bonus behind, penalty ahead', () => {
  const st = freshRace();
  const player = st.karts[0];
  const ai = st.karts[1];
  player.progress = 100000; ai.progress = 100000 - DK.RB_RANGE * 5;
  assert.strictEqual(DK.rubberband(st, ai), DK.RB_MAX, 'far behind: max bonus (capped)');
  ai.progress = 100000 + DK.RB_RANGE * 5;
  assert.strictEqual(DK.rubberband(st, ai), -DK.RB_MAX, 'far ahead: max penalty (capped)');
  ai.progress = 100000 - DK.RB_RANGE / 2;
  const rb = DK.rubberband(st, ai);
  assert.ok(rb > 0 && rb < DK.RB_MAX, 'partial gap: partial bonus');
  assert.strictEqual(DK.rubberband(st, player), 0, 'never applies to the player');
});

ok('AI follows the racing line and manages corner speed', () => {
  const st = freshRace();
  goLive(st);
  const ai = st.karts[1];
  // far left of the line on a straight: AI steers right
  const straightSeg = st.circuit.segments.findIndex((s) => Math.abs(s.curve) < 0.01);
  ai.z = straightSeg * DK.SEG_LEN; ai.x = -1.5; ai.speed = DK.MAX_SPEED * 0.5;
  const inp = DK.aiControl(st, ai, DT);
  assert.ok(inp.right && !inp.left, 'steers back toward the line');
  // heading into the hardest hairpin at full tilt: AI brakes
  let hardest = st.circuit.segments[0];
  for (const s of st.circuit.segments) if (Math.abs(s.curve) > Math.abs(hardest.curve)) hardest = s;
  ai.z = ((hardest.i - 6 + st.circuit.N) % st.circuit.N) * DK.SEG_LEN;
  ai.speed = DK.MAX_SPEED;
  const inp2 = DK.aiControl(st, ai, DT);
  assert.ok(inp2.brake && !inp2.throttle, 'brakes for the hairpin');
});

ok('AI fires the burr when a kart is ahead in range', () => {
  const st = freshRace();
  goLive(st);
  const L = st.circuit.length;
  const ai = st.karts[1];
  const prey = st.karts[2];
  ai.z = L * 0.3; ai.x = 0; prey.z = L * 0.3 + DK.SEG_LEN * 20; prey.x = 0;
  DK.step(st, NO_INPUT, DT);
  ai.item = 'burr';
  let fired = false;
  for (let i = 0; i < 60 && !fired; i++) fired = DK.aiControl(st, ai, DT).fire;
  assert.ok(fired, 'AI pulled the trigger');
});

ok('a full AI-only demo race completes laps without stalling', () => {
  const c = DK.buildCircuit(1);
  const st = DK.createRace(c, { demo: true, rng: seededRng(5) });
  assert.ok(!st.karts[0].isPlayer, 'no player kart in demo');
  for (let i = 0; i < 60 * 60; i++) DK.step(st, NO_INPUT, DT);
  for (const k of st.karts) {
    assert.ok(k.progress > c.length * 0.8, `${k.name} kept moving (${(k.progress / c.length).toFixed(2)} laps)`);
  }
});

// ------------------------------------------------------------- contact & race end
console.log('contact & race end:');

ok('kart-vs-kart contact bumps them apart with speed loss for the rear', () => {
  const st = freshRace();
  goLive(st);
  const a = st.karts[1], b = st.karts[2];
  const L = st.circuit.length;
  a.z = L * 0.25; b.z = L * 0.25 + 40;
  a.x = -0.05; b.x = 0.05;
  a.speed = 5000; b.speed = 5000;
  a.laps = b.laps = 0;
  a.boostT = b.boostT = 0;   // clear any random AI start boost
  const dx0 = Math.abs(b.x - a.x);
  DK.step(st, NO_INPUT, DT);
  assert.ok(Math.abs(b.x - a.x) > dx0, 'pushed apart');
  assert.ok(a.speed < 4700, `rear kart lost speed (${a.speed})`);
});

ok('player finishing 3 laps ends the race with a full results table', () => {
  const st = freshRace();
  goLive(st);
  const p = st.karts[0];
  const L = st.circuit.length;
  p.laps = DK.LAPS - 1;
  p.z = L - 400; p.x = 0; p.speed = DK.MAX_SPEED * 0.9;
  st.time = 90; p.lapStartT = 60; p.bestLap = 31;
  let over = null;
  for (let i = 0; i < 60 && !over; i++) {
    for (const e of DK.step(st, { ...NO_INPUT, throttle: true }, DT)) {
      if (e.type === 'raceOver') over = e;
    }
  }
  assert.ok(over, 'raceOver event');
  assert.strictEqual(st.phase, 'finished');
  assert.ok(p.finished && p.finishOrder >= 1);
  assert.strictEqual(st.results.length, 6, 'six rows');
  st.results.forEach((r, i) => assert.strictEqual(r.pos, i + 1));
  const mine = st.results.find((r) => r.isPlayer);
  assert.ok(mine && mine.finished && Math.abs(mine.bestLap - 30) < 2, 'player row has the best lap');
  assert.strictEqual(over.playerPos, mine.pos);
});

console.log(`\nall ${passed} logic tests passed`);

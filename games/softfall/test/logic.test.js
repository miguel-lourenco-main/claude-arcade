"use strict";
/* Softfall — pure-logic tests. Run with: node test/logic.test.js
   Plain asserts against src/logic.js (dual-environment); exits 0 on pass. */

const assert = require("node:assert");
const L = require("../src/logic.js");

let count = 0;
function test(name, fn) {
  fn();
  count++;
  console.log("ok - " + name);
}

// deterministic RNG for seeded terrain tests
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// a hand-built flat world for landing-rule tests: ground at y=500 everywhere,
// one ×3 pad spanning x 400..600
function flatWorld() {
  const heights = new Float64Array(L.SEGS + 1).fill(500);
  const pads = [{ x0: 400, x1: 600, y: 500, mult: 3 }];
  return { heights, pads };
}
// a ship resting exactly on that pad, feet at ground level
function shipOnPad(over = {}) {
  return Object.assign(
    { x: 500, y: 500 - L.FOOT_Y, vx: 0, vy: 10, angle: 0, fuel: 50 },
    over
  );
}

// ---------- helpers ----------

test("wrapX wraps into [0, W)", () => {
  assert.strictEqual(L.wrapX(0), 0);
  assert.strictEqual(L.wrapX(L.W), 0);
  assert.strictEqual(L.wrapX(-10), L.W - 10);
  assert.strictEqual(L.wrapX(L.W + 25), 25);
});

test("clamp / lerp behave", () => {
  assert.strictEqual(L.clamp(5, 0, 10), 5);
  assert.strictEqual(L.clamp(-1, 0, 10), 0);
  assert.strictEqual(L.clamp(11, 0, 10), 10);
  assert.strictEqual(L.lerp(10, 20, 0.5), 15);
});

test("normAng folds into (-PI, PI]", () => {
  assert.ok(Math.abs(L.normAng(3 * Math.PI) - Math.PI) < 1e-9);
  assert.ok(Math.abs(L.normAng(-3 * Math.PI + 0.1) - (Math.PI + 0.1 - 2 * Math.PI)) < 1e-9);
  assert.strictEqual(L.normAng(0.5), 0.5);
});

// ---------- terrain generation ----------

test("genTerrain: 200 seeds — invariants hold on every one", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rng = mulberry32(seed);
    const { heights, pads } = L.genTerrain(rng);

    assert.strictEqual(heights.length, L.SEGS + 1, "SEGS+1 samples");
    // wrap-consistent so the horizontal world wrap never hits a cliff
    assert.strictEqual(heights[0], heights[L.SEGS], "first == last sample");
    for (let i = 0; i <= L.SEGS; i++) {
      assert.ok(heights[i] >= L.H * 0.34 - 1e-9 && heights[i] <= L.H * 0.94 + 1e-9,
        "height " + i + " clamped");
    }

    // four pads (README), sorted by x, each flat and matching the heightline
    assert.strictEqual(pads.length, 4, "seed " + seed + ": 4 pads");
    for (let p = 1; p < pads.length; p++) assert.ok(pads[p].x0 >= pads[p - 1].x0, "pads sorted");
    let easy = 0;
    for (const pad of pads) {
      assert.ok(pad.mult >= 1 && pad.mult <= 5, "mult in 1..5");
      if (pad.mult <= 2) easy++;
      const i0 = Math.round(pad.x0 / L.DX), i1 = Math.round(pad.x1 / L.DX);
      for (let i = i0; i <= i1; i++) {
        assert.strictEqual(heights[i], pad.y, "pad is flattened into the heightline");
      }
      // smaller pads pay bigger multipliers: check width/mult pairing
      const cells = i1 - i0;
      const widthByMult = { 1: 14, 2: 10, 3: 7, 4: 5, 5: 4 };
      assert.strictEqual(cells, widthByMult[pad.mult], "pad width matches its multiplier");
    }
    assert.ok(easy >= 1, "at least one wide easy (x1/x2) pad");
  }
});

test("terrainY interpolates linearly between samples and wraps", () => {
  const { heights } = L.genTerrain(mulberry32(7));
  const i = 20;
  const mid = (heights[i] + heights[i + 1]) / 2;
  assert.ok(Math.abs(L.terrainY(heights, (i + 0.5) * L.DX) - mid) < 1e-9);
  assert.strictEqual(L.terrainY(heights, 0), heights[0]);
  // x = W wraps to x = 0 (and heights are wrap-consistent anyway)
  assert.strictEqual(L.terrainY(heights, L.W), heights[0]);
  assert.strictEqual(L.terrainY(heights, -L.DX / 2), L.terrainY(heights, L.W - L.DX / 2));
});

test("padAt finds the pad under x (inclusive edges), null elsewhere, wraps", () => {
  const { pads } = flatWorld();
  assert.strictEqual(L.padAt(pads, 500), pads[0]);
  assert.strictEqual(L.padAt(pads, 400), pads[0]);
  assert.strictEqual(L.padAt(pads, 600), pads[0]);
  assert.strictEqual(L.padAt(pads, 399.9), null);
  assert.strictEqual(L.padAt(pads, 601), null);
  assert.strictEqual(L.padAt(pads, 500 + L.W), pads[0]); // wrapped
});

// ---------- ship physics ----------

test("stepShip: gravity accelerates downward when coasting", () => {
  const ship = { x: 100, y: 100, vx: 0, vy: 0, angle: 0, fuel: 100 };
  const t = L.stepShip(ship, {}, 1 / 120);
  assert.strictEqual(t, false, "not thrusting");
  assert.ok(Math.abs(ship.vy - L.GRAVITY / 120) < 1e-9, "vy += g*dt");
  assert.strictEqual(ship.vx, 0);
});

test("stepShip: upright thrust fights gravity and burns fuel", () => {
  const ship = { x: 100, y: 100, vx: 0, vy: 0, angle: 0, fuel: 100 };
  const t = L.stepShip(ship, { thrust: true }, 1 / 120);
  assert.strictEqual(t, true, "thrusting");
  assert.ok(Math.abs(ship.vy - (L.GRAVITY - L.THRUST) / 120) < 1e-9, "net upward accel");
  assert.ok(Math.abs(ship.fuel - (100 - L.BURN_RATE / 120)) < 1e-9, "fuel burned");
});

test("stepShip: no thrust on an empty tank", () => {
  const ship = { x: 100, y: 100, vx: 0, vy: 0, angle: 0, fuel: 0 };
  const t = L.stepShip(ship, { thrust: true }, 1 / 120);
  assert.strictEqual(t, false);
  assert.ok(Math.abs(ship.vy - L.GRAVITY / 120) < 1e-9, "gravity only");
  assert.strictEqual(ship.fuel, 0, "fuel never goes negative");
});

test("stepShip: tilted thrust accelerates along the nose", () => {
  const a = Math.PI / 4;
  const ship = { x: 100, y: 100, vx: 0, vy: 0, angle: a, fuel: 100 };
  L.stepShip(ship, { thrust: true }, 1 / 120);
  assert.ok(Math.abs(ship.vx - Math.sin(a) * L.THRUST / 120) < 1e-9, "vx along sin(a)");
});

test("stepShip: left/right rotate at constant angular speed", () => {
  const dt = 1 / 120;
  let ship = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, fuel: 100 };
  L.stepShip(ship, { left: true }, dt);
  assert.ok(Math.abs(ship.angle - (-L.ROT_SPEED * dt)) < 1e-12, "left rotates CCW");
  ship = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, fuel: 100 };
  L.stepShip(ship, { right: true }, dt);
  assert.ok(Math.abs(ship.angle - L.ROT_SPEED * dt) < 1e-12, "right rotates CW");
  ship = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, fuel: 100 };
  L.stepShip(ship, { left: true, right: true }, dt);
  assert.strictEqual(ship.angle, 0, "both keys cancel");
});

test("stepShip: horizontal wrap and soft ceiling", () => {
  const ship = { x: L.W - 1, y: 0, vx: 240, vy: 0, angle: 0, fuel: 100 };
  L.stepShip(ship, {}, 1 / 120);
  assert.ok(ship.x >= 0 && ship.x < L.W, "x wrapped into the world");
  const high = { x: 0, y: -500, vx: 0, vy: -10, angle: 0, fuel: 100 };
  L.stepShip(high, {}, 1 / 120);
  assert.strictEqual(high.y, -160, "clamped at the soft ceiling");
});

// ---------- contact & landing rules ----------

test("contactPoints: upright ship has feet at ±FOOT_X, FOOT_Y", () => {
  const { feet, hull } = L.contactPoints({ x: 100, y: 200, angle: 0 });
  assert.deepStrictEqual(feet[0], [100 - L.FOOT_X, 200 + L.FOOT_Y]);
  assert.deepStrictEqual(feet[1], [100 + L.FOOT_X, 200 + L.FOOT_Y]);
  assert.deepStrictEqual(hull[0], [100, 200 - 13], "nose");
});

test("contactPoints rotate with the ship", () => {
  const { feet } = L.contactPoints({ x: 0, y: 0, angle: Math.PI / 2 });
  // local (FOOT_X, FOOT_Y) rotated 90°: (x c - y s, x s + y c) = (-FOOT_Y, FOOT_X)
  assert.ok(Math.abs(feet[1][0] - (-L.FOOT_Y)) < 1e-9);
  assert.ok(Math.abs(feet[1][1] - L.FOOT_X) < 1e-9);
});

test("landing: in the air is 'none'", () => {
  const { heights, pads } = flatWorld();
  const res = L.evaluateLanding(shipOnPad({ y: 400 }), heights, pads);
  assert.strictEqual(res.type, "none");
});

test("landing: gentle, upright, both feet on the pad — touchdown", () => {
  const { heights, pads } = flatWorld();
  const res = L.evaluateLanding(shipOnPad(), heights, pads);
  assert.strictEqual(res.type, "land");
  assert.strictEqual(res.pad, pads[0]);
});

test("landing: safe-threshold edges are inclusive", () => {
  const { heights, pads } = flatWorld();
  assert.strictEqual(
    L.evaluateLanding(shipOnPad({ vx: L.SAFE_VX }), heights, pads).type, "land");
  assert.strictEqual(
    L.evaluateLanding(shipOnPad({ vy: L.SAFE_VY }), heights, pads).type, "land");
  assert.strictEqual(
    L.evaluateLanding(shipOnPad({ angle: L.SAFE_ANG * 0.999 }), heights, pads).type, "land");
});

test("crash: too fast sideways (|vx| > 14)", () => {
  const { heights, pads } = flatWorld();
  const res = L.evaluateLanding(shipOnPad({ vx: L.SAFE_VX + 0.1 }), heights, pads);
  assert.strictEqual(res.type, "crash");
  assert.strictEqual(res.cause, "too fast sideways");
});

test("crash: came down too hard (vy > 26)", () => {
  const { heights, pads } = flatWorld();
  const res = L.evaluateLanding(shipOnPad({ vy: L.SAFE_VY + 0.1 }), heights, pads);
  assert.strictEqual(res.type, "crash");
  assert.strictEqual(res.cause, "came down too hard");
});

test("crash: came in tilted (>8 degrees)", () => {
  const { heights, pads } = flatWorld();
  const res = L.evaluateLanding(shipOnPad({ angle: 9 * Math.PI / 180 }), heights, pads);
  assert.strictEqual(res.type, "crash");
  assert.strictEqual(res.cause, "came in tilted");
});

test("crash: rough ground (feet off any pad)", () => {
  const { heights, pads } = flatWorld();
  const res = L.evaluateLanding(shipOnPad({ x: 100 }), heights, pads);
  assert.strictEqual(res.type, "crash");
  assert.strictEqual(res.cause, "rough ground");
});

test("crash: straddling the pad edge (feet on different surfaces)", () => {
  const { heights, pads } = flatWorld();
  // left foot at 600-24+... : put right foot past x1=600, left foot on the pad
  const res = L.evaluateLanding(shipOnPad({ x: 600 - L.FOOT_X + 1 }), heights, pads);
  assert.strictEqual(res.type, "crash");
  assert.strictEqual(res.cause, "rough ground");
});

test("crash: hull impact beats every other check", () => {
  const { heights, pads } = flatWorld();
  // buried: hull points (y-13, y+5) below ground even though feet are too
  const res = L.evaluateLanding(shipOnPad({ y: 520 }), heights, pads);
  assert.strictEqual(res.type, "crash");
  assert.strictEqual(res.cause, "hull impact");
});

test("grazing the pad while moving up is not a landing", () => {
  const { heights, pads } = flatWorld();
  const res = L.evaluateLanding(shipOnPad({ vy: -1 }), heights, pads);
  assert.strictEqual(res.type, "none");
});

// ---------- scoring & refuel ----------

test("landingPoints = mult * (100 + round(fuel))", () => {
  assert.strictEqual(L.landingPoints(1, 0), 100);
  assert.strictEqual(L.landingPoints(3, 50.4), 3 * 150);
  assert.strictEqual(L.landingPoints(5, 99.6), 5 * 200);
});

test("refuel decays x0.72 per landing with a floor of 10", () => {
  assert.strictEqual(L.refuelAmount(1), 65);
  assert.strictEqual(L.refuelAmount(2), Math.round(65 * 0.72));       // 47
  assert.strictEqual(L.refuelAmount(3), Math.round(65 * 0.72 * 0.72)); // 34
  let prev = Infinity;
  for (let n = 1; n <= 20; n++) {
    const r = L.refuelAmount(n);
    assert.ok(r <= prev, "monotonically non-increasing");
    assert.ok(r >= 10, "floor of 10");
    prev = r;
  }
  assert.strictEqual(L.refuelAmount(20), 10, "eventually hits the floor");
});

// ---------- integration: a full simulated drop lands safely ----------

test("simulated free-fall from 8u above a pad ends in a touchdown", () => {
  const { heights, pads } = flatWorld();
  const ship = shipOnPad({ y: 500 - L.FOOT_Y - 8, vy: 0 });
  let result = null;
  for (let i = 0; i < 1200 && !result; i++) {
    L.stepShip(ship, {}, 1 / 120);
    const res = L.evaluateLanding(ship, heights, pads);
    if (res.type !== "none") result = res;
  }
  assert.ok(result, "reached the ground");
  assert.strictEqual(result.type, "land", "gentle drop is a safe landing");
});

test("simulated hard drop from 60u smashes into the pad", () => {
  const { heights, pads } = flatWorld();
  const ship = shipOnPad({ y: 500 - L.FOOT_Y - 60, vy: 0 });
  let result = null;
  for (let i = 0; i < 2400 && !result; i++) {
    L.stepShip(ship, {}, 1 / 120);
    const res = L.evaluateLanding(ship, heights, pads);
    if (res.type !== "none") result = res;
  }
  assert.ok(result, "reached the ground");
  assert.strictEqual(result.type, "crash");
  assert.strictEqual(result.cause, "came down too hard");
});

console.log("\nlogic.test.js: " + count + " tests passed");

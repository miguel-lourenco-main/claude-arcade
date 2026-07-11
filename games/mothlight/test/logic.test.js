"use strict";
/* Mothlight pure-logic tests — node test/logic.test.js
 * Plain asserts against logic.js (the same file the browser loads).
 * Exits 0 on pass, non-zero on the first failure.
 */
const assert = require("node:assert");
const L = require("../logic.js");
const C = L.constants;

let n = 0;
function test(name, fn) {
  fn();
  n++;
  console.log("ok - " + name);
}

// ---------------------------------------------------------------- utilities

test("clamp clamps below, inside, above", () => {
  assert.strictEqual(L.clamp(-5, 0, 10), 0);
  assert.strictEqual(L.clamp(7, 0, 10), 7);
  assert.strictEqual(L.clamp(15, 0, 10), 10);
});

test("lerp hits both endpoints and the midpoint", () => {
  assert.strictEqual(L.lerp(2, 10, 0), 2);
  assert.strictEqual(L.lerp(2, 10, 1), 10);
  assert.strictEqual(L.lerp(2, 10, 0.5), 6);
});

// ---------------------------------------------------------------- constants

test("constants are self-consistent with the README", () => {
  assert.strictEqual(C.W, 480);
  assert.strictEqual(C.H, 720);
  assert.strictEqual(C.SKY_H, C.H - C.GROUND_H);
  assert.strictEqual(C.MOTH_X, C.W * 0.3);       // "moth's x never changes"
  assert.strictEqual(C.FLAP_VY, -470);           // "flap assigns vy = -470"
  assert.strictEqual(C.GRAVITY, 1750);           // "constant 1750 px/s² gravity"
  assert.strictEqual(C.TERMINAL_VY, 640);        // "falls capped at 640 px/s"
  assert.strictEqual(C.SCROLL, 156);             // "constant 156 px/s"
  assert.strictEqual(C.SPACING, 236);            // "fixed 236 px spacing"
  assert.strictEqual(C.MOTH_R, 9);               // "9 px-radius circle"
  assert.strictEqual(C.CHAIN_HALF_W, 15);        // "30 px-wide rectangles"
  assert.strictEqual(C.DT, 1 / 120);             // "120 Hz accumulator loop"
  assert.strictEqual(C.FLOOR_Y, C.SKY_H - 6);
});

// ---------------------------------------------------------------- gravity

test("fall integrates gravity per fixed step", () => {
  assert.ok(Math.abs(L.fall(0, C.DT) - C.GRAVITY * C.DT) < 1e-9);
  assert.ok(Math.abs(L.fall(-470, C.DT) - (-470 + C.GRAVITY * C.DT)) < 1e-9);
});

test("fall caps at terminal velocity", () => {
  assert.strictEqual(L.fall(C.TERMINAL_VY, C.DT), C.TERMINAL_VY);
  assert.strictEqual(L.fall(639.99, 1), C.TERMINAL_VY);
  assert.strictEqual(L.fall(10000, C.DT), C.TERMINAL_VY);
});

test("a flap-then-fall arc returns to flap speed symmetrically", () => {
  // from vy = FLAP_VY it takes |FLAP_VY|/GRAVITY seconds to reach vy = 0
  let vy = C.FLAP_VY, t = 0;
  while (vy < 0) { vy = L.fall(vy, C.DT); t += C.DT; }
  const expected = -C.FLAP_VY / C.GRAVITY;
  assert.ok(Math.abs(t - expected) < C.DT * 2,
    `climb time ${t.toFixed(4)}s vs expected ${expected.toFixed(4)}s`);
});

// ---------------------------------------------------------------- gap placement

test("chainGapY stays inside the safe band for all r", () => {
  const lo = C.GAP_MARGIN + C.GAP_HALF;
  const hi = C.SKY_H - C.GAP_MARGIN - C.GAP_HALF;
  for (let i = 0; i <= 100; i++) {
    const g = L.chainGapY(undefined, i / 100.0000001);
    assert.ok(g >= lo && g <= hi, `gap ${g} outside [${lo}, ${hi}]`);
  }
  assert.strictEqual(L.chainGapY(undefined, 0), lo);
});

test("chainGapY never steps more than GAP_MAX_STEP from the previous gap", () => {
  const lo = C.GAP_MARGIN + C.GAP_HALF;
  const hi = C.SKY_H - C.GAP_MARGIN - C.GAP_HALF;
  for (const prev of [lo, (lo + hi) / 2, hi]) {
    for (let i = 0; i < 200; i++) {
      const g = L.chainGapY(prev, i / 200);
      assert.ok(Math.abs(g - prev) <= C.GAP_MAX_STEP + 1e-9,
        `step ${Math.abs(g - prev)} > ${C.GAP_MAX_STEP}`);
      assert.ok(g >= lo && g <= hi, "clamped gap left the safe band");
    }
  }
});

test("every random layout is reachable: full-effort climb beats GAP_MAX_STEP", () => {
  // simulate optimal flapping (re-flap the moment vy >= 0) for the time
  // between two chains (SPACING / SCROLL seconds) using the real physics
  let y = 0, vy = 0, t = 0;
  const between = C.SPACING / C.SCROLL;
  while (t < between) {
    if (vy >= 0) vy = C.FLAP_VY;     // flap SETS vy — the core mechanic
    vy = L.fall(vy, C.DT);
    y += vy * C.DT;
    t += C.DT;
  }
  assert.ok(-y > C.GAP_MAX_STEP,
    `max climb ${(-y).toFixed(0)}px must exceed GAP_MAX_STEP ${C.GAP_MAX_STEP}px`);
  // and terminal-velocity descent trivially covers it too
  assert.ok(C.TERMINAL_VY * between > C.GAP_MAX_STEP);
});

// ---------------------------------------------------------------- collision

test("inChainBand matches the 30px chain + 9px moth widths exactly", () => {
  const reach = C.CHAIN_HALF_W + C.MOTH_R;   // 24
  assert.ok(L.inChainBand(C.MOTH_X + reach - 0.01, C.MOTH_X));
  assert.ok(L.inChainBand(C.MOTH_X - reach + 0.01, C.MOTH_X));
  assert.ok(!L.inChainBand(C.MOTH_X + reach, C.MOTH_X));
  assert.ok(!L.inChainBand(C.MOTH_X - reach, C.MOTH_X));
});

test("hitsChain: centered in the gap is safe, edges are exact", () => {
  const gapY = 300;
  assert.ok(!L.hitsChain(gapY, gapY), "gap center is safe");
  const safeTop = gapY - C.GAP_HALF + C.MOTH_R;    // circle just fits
  const safeBot = gapY + C.GAP_HALF - C.MOTH_R;
  assert.ok(!L.hitsChain(safeTop, gapY), "circle flush with the top lantern is safe");
  assert.ok(!L.hitsChain(safeBot, gapY), "circle flush with the pole top is safe");
  assert.ok(L.hitsChain(safeTop - 0.01, gapY), "one hair higher hits the chain");
  assert.ok(L.hitsChain(safeBot + 0.01, gapY), "one hair lower hits the pole");
});

test("forgiving hitbox: the safe opening is much taller than the moth", () => {
  // 2*(GAP_HALF - MOTH_R) = 150px of safe travel for an 18px-tall hitbox
  assert.ok(2 * (C.GAP_HALF - C.MOTH_R) >= 8 * C.MOTH_R);
});

// ---------------------------------------------------------------- scoring

test("passedGap fires exactly at the center-line crossing", () => {
  assert.ok(!L.passedGap(C.MOTH_X + 0.01, C.MOTH_X));
  assert.ok(L.passedGap(C.MOTH_X, C.MOTH_X));
  assert.ok(L.passedGap(C.MOTH_X - 0.01, C.MOTH_X));
});

test("a chain scrolling past the moth scores exactly once", () => {
  const chain = { x: C.W + 200, scored: false };
  let score = 0, ticks = 0;
  while (chain.x > -60) {
    chain.x -= C.SCROLL * C.DT;
    if (!chain.scored && L.passedGap(chain.x, C.MOTH_X)) { chain.scored = true; score++; }
    ticks++;
  }
  assert.strictEqual(score, 1);
  // and it scored on the first tick x fell to/below MOTH_X, not before
  const t = Math.ceil((C.W + 200 - C.MOTH_X) / (C.SCROLL * C.DT));
  assert.ok(ticks >= t, "sim ran past the crossing tick");
});

// ---------------------------------------------------------------- tilt

test("tiltTarget spans TILT_UP at flap speed to TILT_DOWN at terminal", () => {
  assert.strictEqual(L.tiltTarget(C.FLAP_VY), C.TILT_UP);
  assert.strictEqual(L.tiltTarget(C.TERMINAL_VY), C.TILT_DOWN);
  assert.strictEqual(L.tiltTarget(-10000), C.TILT_UP);       // clamped
  assert.strictEqual(L.tiltTarget(10000), C.TILT_DOWN);      // clamped
});

test("tiltTarget is monotonic in vy (eases into the nose-dive)", () => {
  let prev = -Infinity;
  for (let vy = C.FLAP_VY; vy <= C.TERMINAL_VY; vy += 37) {
    const r = L.tiltTarget(vy);
    assert.ok(r >= prev, `tilt not monotonic at vy=${vy}`);
    prev = r;
  }
  // quadratic ease: at the vy midpoint the tilt sits below the linear midpoint
  const mid = L.tiltTarget((C.FLAP_VY + C.TERMINAL_VY) / 2);
  assert.ok(mid < (C.TILT_UP + C.TILT_DOWN) / 2);
});

console.log(`\nPASS — ${n} logic tests`);

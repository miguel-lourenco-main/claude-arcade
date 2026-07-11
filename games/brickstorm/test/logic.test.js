"use strict";
/* Brickstorm pure-logic tests — node test/logic.test.js
 * Plain asserts, exits 0 on pass, non-zero (throw) on failure.
 */
const assert = require("node:assert");
const path = require("node:path");

const L = require(path.join(__dirname, "..", "logic.js"));
const C = L.constants;

let n = 0;
function test(name, fn) {
  fn();
  n++;
  console.log("ok " + n + " - " + name);
}

// ---------------------------------------------------------------------------
// utils

test("clamp clamps below, inside, above", () => {
  assert.strictEqual(L.clamp(-5, 0, 10), 0);
  assert.strictEqual(L.clamp(5, 0, 10), 5);
  assert.strictEqual(L.clamp(15, 0, 10), 10);
});

test("mulberry32 is deterministic and in [0,1)", () => {
  const a = L.mulberry32(1234), b = L.mulberry32(1234), c = L.mulberry32(9999);
  const sa = [], sb = [], sc = [];
  for (let i = 0; i < 50; i++) { sa.push(a()); sb.push(b()); sc.push(c()); }
  assert.deepStrictEqual(sa, sb, "same seed => same sequence");
  assert.notDeepStrictEqual(sa, sc, "different seed => different sequence");
  for (const v of sa) assert.ok(v >= 0 && v < 1, "value in [0,1)");
});

// ---------------------------------------------------------------------------
// level patterns

test("every pattern yields only 0/1 and nothing below its row count", () => {
  for (const pattern of L.PATTERNS) {
    for (let rows = 1; rows <= C.MAX_ROWS; rows++) {
      for (let r = 0; r < C.MAX_ROWS; r++) {
        for (let c = 0; c < C.COLS; c++) {
          const v = pattern(r, c, rows);
          assert.ok(v === 0 || v === 1, "pattern cell is 0 or 1");
          if (r >= rows) assert.strictEqual(v, 0, "no bricks past `rows`");
        }
      }
    }
  }
});

test("checkerboard pattern alternates cells", () => {
  const checker = L.PATTERNS[1];
  assert.strictEqual(checker(0, 0, 5), 1);
  assert.strictEqual(checker(0, 1, 5), 0);
  assert.strictEqual(checker(1, 0, 5), 0);
  assert.strictEqual(checker(1, 1, 5), 1);
});

test("pyramid pattern widens with each row", () => {
  const pyramid = L.PATTERNS[2];
  const width = (r) => {
    let w = 0;
    for (let c = 0; c < C.COLS; c++) w += pyramid(r, c, C.MAX_ROWS);
    return w;
  };
  assert.strictEqual(width(0), 2);
  assert.strictEqual(width(1), 4);
  assert.strictEqual(width(4), 10);
  assert.strictEqual(width(5), 12);
});

test("rain-columns pattern leaves every third column empty", () => {
  const rain = L.PATTERNS[3];
  for (let c = 0; c < C.COLS; c++) {
    assert.strictEqual(rain(0, c, 5), c % 3 === 2 ? 0 : 1);
  }
});

test("twin fortresses leave the outer and middle columns empty", () => {
  const twin = L.PATTERNS[5];
  assert.strictEqual(twin(0, 0, 5), 0);
  assert.strictEqual(twin(0, 1, 5), 1);
  assert.strictEqual(twin(0, 5, 5), 0);
  assert.strictEqual(twin(0, 6, 5), 0);
  assert.strictEqual(twin(0, C.COLS - 2, 5), 1);
  assert.strictEqual(twin(0, C.COLS - 1, 5), 0);
});

// ---------------------------------------------------------------------------
// level generation

test("buildLevel is deterministic per level", () => {
  assert.deepStrictEqual(L.buildLevel(1), L.buildLevel(1));
  assert.deepStrictEqual(L.buildLevel(7), L.buildLevel(7));
  assert.notDeepStrictEqual(L.buildLevel(1), L.buildLevel(2));
});

test("level 1 is a 5-row solid band: 60 bricks, top 2 rows hp 2, rest hp 1", () => {
  const bricks = L.buildLevel(1);
  assert.strictEqual(bricks.length, 5 * C.COLS);
  for (const b of bricks) {
    assert.ok(b.row >= 0 && b.row < 5);
    assert.strictEqual(b.hp, b.row < 2 ? 2 : 1);
    assert.strictEqual(b.maxHp, b.hp);
    assert.strictEqual(b.alive, true);
    assert.strictEqual(b.w, C.BRICK_W);
    assert.strictEqual(b.h, C.BRICK_H);
    assert.strictEqual(b.y, C.BRICK_TOP + b.row * C.BRICK_H);
  }
});

test("brick x positions stay inside the playfield", () => {
  for (const lvl of [1, 3, 5, 8, 13]) {
    for (const b of L.buildLevel(lvl)) {
      assert.ok(b.x >= 0 && b.x + b.w <= C.W, "brick inside canvas");
    }
  }
});

test("row count grows with level and caps at MAX_ROWS", () => {
  const maxRow = (lvl) => Math.max(...L.buildLevel(lvl).map(b => b.row));
  assert.strictEqual(maxRow(1), 4);   // 5 rows
  assert.strictEqual(maxRow(3), 5);   // 6 rows
  assert.strictEqual(maxRow(9), 8);   // capped at 9 rows
  assert.strictEqual(maxRow(31), 8);  // still capped far later
});

test("hp scales with level and never exceeds 3", () => {
  const top = L.buildLevel(4).filter(b => b.row < 2);
  assert.ok(top.length > 0);
  for (const b of top) assert.strictEqual(b.hp, 3, "level>=4 top rows are hp 3");
  const mid = L.buildLevel(3).filter(b => b.row >= 2 && b.row < 4);
  for (const b of mid) assert.strictEqual(b.hp, 2, "level>=3 rows 2-3 are hp 2");
  for (const lvl of [1, 4, 10, 25, 40]) {
    for (const b of L.buildLevel(lvl)) assert.ok(b.hp >= 1 && b.hp <= 3);
  }
});

test("power-up bricks: at least 3, ~11% of bricks, valid kinds", () => {
  const kinds = new Set(["wide", "multi", "slow"]);
  for (const lvl of [1, 2, 3, 6, 12]) {
    const bricks = L.buildLevel(lvl);
    const powered = bricks.filter(b => b.power);
    const expected = Math.max(3, Math.round(bricks.length * 0.11));
    assert.strictEqual(powered.length, Math.min(expected, bricks.length));
    for (const b of powered) assert.ok(kinds.has(b.power), "kind is wide/multi/slow");
  }
});

// ---------------------------------------------------------------------------
// speed model

test("ballSpeed: base, per-level, ramp, top-row boost, cap, slow", () => {
  const base = { level: 1, rampLevel: 0, topRowsTouched: false, slowed: false };
  assert.strictEqual(L.ballSpeed(base), C.BASE_SPEED);
  assert.strictEqual(L.ballSpeed({ ...base, level: 3 }),
    C.BASE_SPEED + 2 * C.SPEED_PER_LEVEL);
  assert.ok(Math.abs(L.ballSpeed({ ...base, rampLevel: 2 })
    - C.BASE_SPEED * (1 + 2 * C.RAMP_STEP)) < 1e-9, "+9% per ramp level");
  assert.ok(Math.abs(L.ballSpeed({ ...base, topRowsTouched: true })
    - C.BASE_SPEED * (1 + C.TOP_ROW_BOOST)) < 1e-9, "+14% top-row boost");
  assert.strictEqual(
    L.ballSpeed({ level: 40, rampLevel: 4, topRowsTouched: true, slowed: false }),
    C.SPEED_CAP, "capped at SPEED_CAP");
  assert.ok(Math.abs(L.ballSpeed({ ...base, slowed: true })
    - C.BASE_SPEED * C.SLOW_SCALE) < 1e-9, "slow scales x0.62");
  assert.ok(Math.abs(L.ballSpeed({ level: 40, rampLevel: 4, topRowsTouched: true, slowed: true })
    - C.SPEED_CAP * C.SLOW_SCALE) < 1e-9, "slow applies after the cap");
});

test("computeRampLevel crosses thresholds 4/12/24/40", () => {
  assert.strictEqual(L.computeRampLevel(0), 0);
  assert.strictEqual(L.computeRampLevel(3), 0);
  assert.strictEqual(L.computeRampLevel(4), 1);
  assert.strictEqual(L.computeRampLevel(11), 1);
  assert.strictEqual(L.computeRampLevel(12), 2);
  assert.strictEqual(L.computeRampLevel(24), 3);
  assert.strictEqual(L.computeRampLevel(40), 4);
  assert.strictEqual(L.computeRampLevel(1000), 4, "never past the last threshold");
});

// ---------------------------------------------------------------------------
// collision math

test("circleRectSide: miss returns null", () => {
  const rect = { x: 100, y: 100, w: 36, h: 16 };
  assert.strictEqual(L.circleRectSide({ x: 50, y: 50, r: 6 }, rect), null);
  assert.strictEqual(L.circleRectSide({ x: 100 - 7, y: 100 - 7, r: 6 }, rect), null,
    "corner just out of reach");
});

test("circleRectSide: side hits resolve to x, top/bottom hits to y", () => {
  const rect = { x: 100, y: 100, w: 36, h: 16 };
  assert.strictEqual(L.circleRectSide({ x: 96, y: 108, r: 6 }, rect), "x", "left face");
  assert.strictEqual(L.circleRectSide({ x: 140, y: 108, r: 6 }, rect), "x", "right face");
  assert.strictEqual(L.circleRectSide({ x: 118, y: 96, r: 6 }, rect), "y", "top face");
  assert.strictEqual(L.circleRectSide({ x: 118, y: 120, r: 6 }, rect), "y", "bottom face");
});

test("bounceOffBrick reflects and pushes the ball out of the brick", () => {
  const brick = { x: 100, y: 100, w: 36, h: 16 };
  // hit the left face while moving right -> vx flips negative, ball sits left of brick
  const b1 = { x: 99, y: 108, r: 6, vx: 200, vy: 90 };
  L.bounceOffBrick(b1, brick, "x");
  assert.ok(b1.vx < 0, "vx now points away from brick");
  assert.strictEqual(b1.x, brick.x - b1.r);
  // hit the top face while moving down -> vy flips negative, ball sits above brick
  const b2 = { x: 118, y: 101, r: 6, vx: 60, vy: 200 };
  L.bounceOffBrick(b2, brick, "y");
  assert.ok(b2.vy < 0, "vy now points away from brick");
  assert.strictEqual(b2.y, brick.y - b2.r);
});

test("enforceMinVertical keeps |vy| >= 28% of speed and preserves speed", () => {
  const b = { vx: 300, vy: 4, r: 6 };
  const before = Math.hypot(b.vx, b.vy);
  L.enforceMinVertical(b);
  const after = Math.hypot(b.vx, b.vy);
  assert.ok(Math.abs(before - after) < 1e-6, "speed preserved");
  assert.ok(Math.abs(b.vy) >= after * C.MIN_VY_FRAC - 1e-9, "min vertical enforced");
  assert.ok(b.vy > 0, "vy sign preserved");
  // vy === 0 defaults to upward
  const b2 = { vx: 300, vy: 0, r: 6 };
  L.enforceMinVertical(b2);
  assert.ok(b2.vy < 0, "zero vy resolves upward");
  // already-vertical-enough balls are untouched
  const b3 = { vx: 10, vy: -300, r: 6 };
  L.enforceMinVertical(b3);
  assert.strictEqual(b3.vx, 10);
  assert.strictEqual(b3.vy, -300);
});

console.log(`\nall ${n} logic tests passed`);

"use strict";

/* Node-runnable pure-logic tests for Wyrm (games/wyrm/logic.js).
 * Plain asserts, no test framework. Exits 0 on pass, 1 on failure.
 *   node games/wyrm/test/logic.test.js
 */

const assert = require("assert");
const L = require("../logic.js");

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log("ok - " + name);
}
function approx(a, b, eps) {
  assert(Math.abs(a - b) < (eps || 1e-9), a + " !~= " + b);
}

// ---- constants -------------------------------------------------------------
ok("board constants match the README (26x22 grid, start length 4)", () => {
  assert.strictEqual(L.COLS, 26);
  assert.strictEqual(L.ROWS, 22);
  assert.strictEqual(L.START_LEN, 4);
  assert.strictEqual(L.QUEUE_MAX, 2);
});

// ---- speed ramp -------------------------------------------------------------
ok("tps starts at 8/s and ramps +0.28 per ember", () => {
  assert.strictEqual(L.tps(0), 8);
  approx(L.tps(1), 8.28);
  approx(L.tps(10), 10.8);
});

ok("tps caps at 15/s", () => {
  assert.strictEqual(L.tps(25), 15); // 8 + 25*0.28 = 15 exactly
  assert.strictEqual(L.tps(26), 15);
  assert.strictEqual(L.tps(1000), 15);
});

// ---- scoring ----------------------------------------------------------------
ok("each ember pays 10 base points plus a speed bonus", () => {
  assert.strictEqual(L.biteScore(0), 10);              // 8 tps -> no bonus
  assert.strictEqual(L.biteScore(1), 11);              // round(0.28*3)=1
  assert.strictEqual(L.biteScore(2), 12);              // round(0.56*3)=2
  assert.strictEqual(L.biteScore(25), 10 + 21);        // capped tps: (15-8)*3
  assert.strictEqual(L.biteScore(500), 31);            // bonus caps with tps
});

// ---- direction helpers --------------------------------------------------------
ok("dirNameOf round-trips every direction vector", () => {
  for (const name of ["up", "down", "left", "right"]) {
    assert.strictEqual(L.dirNameOf(L.DIRS[name]), name);
  }
});

ok("KEYMAP covers arrows and WASD", () => {
  assert.strictEqual(L.KEYMAP.ArrowUp, "up");
  assert.strictEqual(L.KEYMAP.KeyW, "up");
  assert.strictEqual(L.KEYMAP.ArrowDown, "down");
  assert.strictEqual(L.KEYMAP.KeyS, "down");
  assert.strictEqual(L.KEYMAP.ArrowLeft, "left");
  assert.strictEqual(L.KEYMAP.KeyA, "left");
  assert.strictEqual(L.KEYMAP.ArrowRight, "right");
  assert.strictEqual(L.KEYMAP.KeyD, "right");
});

// ---- input queue ---------------------------------------------------------------
ok("queueDirection rejects a 180-degree reversal of the current direction", () => {
  const q = [];
  assert.strictEqual(L.queueDirection(q, L.DIRS.right, "left"), false);
  assert.deepStrictEqual(q, []);
});

ok("queueDirection rejects a no-op (same direction)", () => {
  const q = [];
  assert.strictEqual(L.queueDirection(q, L.DIRS.right, "right"), false);
  assert.deepStrictEqual(q, []);
});

ok("queueDirection accepts a perpendicular turn", () => {
  const q = [];
  assert.strictEqual(L.queueDirection(q, L.DIRS.right, "up"), true);
  assert.deepStrictEqual(q, ["up"]);
});

ok("double-tap 180 is rejected against the LAST QUEUED direction", () => {
  // moving right, tap up then down within one tick window: the down tap
  // reverses the queued up and must be rejected (the classic self-kill).
  const q = [];
  L.queueDirection(q, L.DIRS.right, "up");
  assert.strictEqual(L.queueDirection(q, L.DIRS.right, "down"), false);
  assert.deepStrictEqual(q, ["up"]);
  // but a second legal turn (left after up, while moving right) queues fine
  assert.strictEqual(L.queueDirection(q, L.DIRS.right, "left"), true);
  assert.deepStrictEqual(q, ["up", "left"]);
});

ok("queue buffers at most QUEUE_MAX (2) turns per tick window", () => {
  const q = ["up", "left"];
  assert.strictEqual(L.queueDirection(q, L.DIRS.right, "down"), false);
  assert.strictEqual(q.length, 2);
});

ok("queueDirection ignores unknown direction names", () => {
  const q = [];
  assert.strictEqual(L.queueDirection(q, L.DIRS.right, "warp"), false);
  assert.deepStrictEqual(q, []);
});

// ---- starting body ---------------------------------------------------------------
ok("makeSnake builds a 4-long body head-first at mid-board, laid out leftward", () => {
  const s = L.makeSnake();
  assert.strictEqual(s.length, L.START_LEN);
  assert.deepStrictEqual(s[0], { x: 11, y: 11 });
  for (let i = 1; i < s.length; i++) {
    assert.strictEqual(s[i].x, s[0].x - i);
    assert.strictEqual(s[i].y, s[0].y);
  }
});

// ---- movement ---------------------------------------------------------------------
ok("a normal step pushes the head and pops the tail (constant length, pure)", () => {
  const s = L.makeSnake();
  const before = JSON.stringify(s);
  const r = L.step(s, L.DIRS.right, { x: 0, y: 0 });
  assert.strictEqual(r.died, false);
  assert.strictEqual(r.ate, false);
  assert.strictEqual(r.snake.length, s.length);
  assert.deepStrictEqual(r.snake[0], { x: 12, y: 11 });
  assert.deepStrictEqual(r.snake[r.snake.length - 1], { x: 9, y: 11 });
  assert.strictEqual(JSON.stringify(s), before); // input not mutated
});

ok("hitting each of the four walls dies", () => {
  const mk = (x, y) => [{ x, y }, { x: 12, y: 12 }, { x: 13, y: 12 }, { x: 14, y: 12 }];
  assert.strictEqual(L.step(mk(0, 5), L.DIRS.left, null).died, true);
  assert.strictEqual(L.step(mk(L.COLS - 1, 5), L.DIRS.right, null).died, true);
  assert.strictEqual(L.step(mk(5, 0), L.DIRS.up, null).died, true);
  assert.strictEqual(L.step(mk(5, L.ROWS - 1), L.DIRS.down, null).died, true);
});

ok("stepping into your own body dies", () => {
  // head (10,10), body below and to the right; moving down bites segment 1
  const s = [
    { x: 10, y: 10 }, { x: 10, y: 11 }, { x: 11, y: 11 },
    { x: 11, y: 10 }, { x: 12, y: 10 },
  ];
  const r = L.step(s, L.DIRS.down, null);
  assert.strictEqual(r.died, true);
});

ok("stepping into the current TAIL cell is legal when not eating (it vacates)", () => {
  // 2x2 loop: head (10,10), tail (10,11); moving down enters the tail cell
  const s = [
    { x: 10, y: 10 }, { x: 11, y: 10 }, { x: 11, y: 11 }, { x: 10, y: 11 },
  ];
  const r = L.step(s, L.DIRS.down, { x: 0, y: 0 });
  assert.strictEqual(r.died, false);
  assert.deepStrictEqual(r.snake[0], { x: 10, y: 11 });
  assert.strictEqual(r.snake.length, 4);
});

ok("eating grows the wyrm by one (tail is kept)", () => {
  const s = L.makeSnake();
  const r = L.step(s, L.DIRS.right, { x: 12, y: 11 });
  assert.strictEqual(r.died, false);
  assert.strictEqual(r.ate, true);
  assert.strictEqual(r.snake.length, s.length + 1);
  assert.deepStrictEqual(r.snake[0], { x: 12, y: 11 });
  assert.deepStrictEqual(r.snake[r.snake.length - 1], { x: 8, y: 11 }); // old tail kept
});

ok("when eating, the tail does NOT vacate — entering it dies", () => {
  // same 2x2 loop, but with food sitting on the tail cell: growing means the
  // tail stays put, so the move is a self collision. (Unreachable in play —
  // food never spawns on the snake — but the rule must hold.)
  const s = [
    { x: 10, y: 10 }, { x: 11, y: 10 }, { x: 11, y: 11 }, { x: 10, y: 11 },
  ];
  const r = L.step(s, L.DIRS.down, { x: 10, y: 11 });
  assert.strictEqual(r.died, true);
});

// ---- food spawning ---------------------------------------------------------------
ok("freeCells excludes exactly the snake's cells", () => {
  const s = L.makeSnake();
  const free = L.freeCells(s);
  assert.strictEqual(free.length, L.COLS * L.ROWS - s.length);
  for (const seg of s) {
    assert(!free.includes(seg.y * L.COLS + seg.x), "snake cell listed as free");
  }
});

ok("spawnFood never lands on the snake (500 random trials)", () => {
  const s = L.makeSnake();
  const onSnake = (f) => s.some((seg) => seg.x === f.x && seg.y === f.y);
  for (let i = 0; i < 500; i++) {
    const f = L.spawnFood(s, Math.random);
    assert(f && !onSnake(f), "food spawned on the snake: " + JSON.stringify(f));
    assert(f.x >= 0 && f.x < L.COLS && f.y >= 0 && f.y < L.ROWS);
  }
});

ok("spawnFood is deterministic under an injected rng and picks free cells only", () => {
  // snake occupies cell index 0; rand()=0 must pick the FIRST FREE cell (index 1)
  const s = [{ x: 0, y: 0 }];
  const f = L.spawnFood(s, () => 0);
  assert.deepStrictEqual(f, { x: 1, y: 0 });
  const last = L.spawnFood(s, () => 0.999999);
  assert.deepStrictEqual(last, { x: L.COLS - 1, y: L.ROWS - 1 });
});

ok("spawnFood with one free cell returns exactly that cell", () => {
  const s = [];
  for (let i = 1; i < L.COLS * L.ROWS; i++) {
    s.push({ x: i % L.COLS, y: Math.floor(i / L.COLS) });
  }
  const f = L.spawnFood(s, Math.random);
  assert.deepStrictEqual(f, { x: 0, y: 0 });
});

ok("spawnFood on a full board returns null (the ASCENDED win condition)", () => {
  const s = [];
  for (let i = 0; i < L.COLS * L.ROWS; i++) {
    s.push({ x: i % L.COLS, y: Math.floor(i / L.COLS) });
  }
  assert.strictEqual(L.spawnFood(s, Math.random), null);
});

console.log("\nlogic.test.js: all " + passed + " tests passed");

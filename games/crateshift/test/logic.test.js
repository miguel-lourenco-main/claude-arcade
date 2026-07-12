// Crateshift logic tests — plain node, plain asserts, exit 0 on pass.
// Run: node games/crateshift/test/logic.test.js
"use strict";

const assert = require("assert");
const path = require("path");
const logic = require(path.join(__dirname, "..", "logic.js"));
const LEVELS = require(path.join(__dirname, "..", "levels.js"));

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}

const K = (x, y) => x + "," + y;

// Count map characters across a level definition.
function census(def) {
  const counts = { worker: 0, crates: 0, pads: 0 };
  for (const row of def.map) {
    for (const ch of row) {
      if (ch === "@" || ch === "+") counts.worker++;
      if (ch === "$" || ch === "*") counts.crates++;
      if (ch === "." || ch === "*" || ch === "+") counts.pads++;
    }
  }
  return counts;
}

// ---------------------------------------------------------------- level set

test("the set ships exactly 21 levels (README, 63-star select header)", () => {
  assert.strictEqual(LEVELS.length, 21);
});

test("every level has a name and positive integer par/parPushes", () => {
  for (const lv of LEVELS) {
    assert.ok(typeof lv.name === "string" && lv.name.length > 0, lv.name);
    assert.ok(Number.isInteger(lv.par) && lv.par > 0, lv.name);
    assert.ok(Number.isInteger(lv.parPushes) && lv.parPushes > 0, lv.name);
    assert.ok(Array.isArray(lv.map) && lv.map.every((r) => typeof r === "string"), lv.name);
  }
});

test("every level has one worker and as many crates as pads (>= 1)", () => {
  for (const lv of LEVELS) {
    const c = census(lv);
    assert.strictEqual(c.worker, 1, lv.name);
    assert.ok(c.crates >= 1, lv.name);
    assert.strictEqual(c.crates, c.pads, `${lv.name}: ${c.crates} crates vs ${c.pads} pads`);
  }
});

test("parPushes is at least the number of crates starting off their pads", () => {
  for (const lv of LEVELS) {
    const s = logic.parseLevel(lv);
    const off = s.crates.filter((c) => !logic.onTarget(s, c)).length;
    assert.ok(lv.parPushes >= off, `${lv.name}: parPushes ${lv.parPushes} < ${off} off-pad crates`);
    assert.ok(lv.par >= lv.parPushes, `${lv.name}: par < parPushes`);
  }
});

test("every crate, pad, and the worker sit on interior floor; floor never touches the map edge", () => {
  for (const lv of LEVELS) {
    const s = logic.parseLevel(lv);
    assert.ok(s.floor.has(K(s.player.x, s.player.y)), lv.name);
    for (const c of s.crates) assert.ok(s.floor.has(K(c.x, c.y)), lv.name);
    for (const t of s.targets) assert.ok(s.floor.has(t), `${lv.name}: pad ${t} outside interior`);
    for (const k of s.floor) {
      const [x, y] = k.split(",").map(Number);
      assert.ok(x > 0 && y > 0 && x < s.w - 1 && y < s.h - 1, `${lv.name}: floor leaks to edge at ${k}`);
    }
  }
});

// ---------------------------------------------------------------- parsing

test("parseLevel reads First Push exactly (walls, pad, crate, worker, floor)", () => {
  const s = logic.parseLevel(LEVELS[0]);
  assert.strictEqual(s.w, 7);
  assert.strictEqual(s.h, 5);
  assert.deepStrictEqual({ x: s.player.x, y: s.player.y }, { x: 2, y: 2 });
  assert.strictEqual(s.crates.length, 1);
  assert.deepStrictEqual({ x: s.crates[0].x, y: s.crates[0].y }, { x: 3, y: 2 });
  assert.ok(s.targets.has("4,2") && s.targets.size === 1);
  assert.ok(s.wall.has("0,0") && s.wall.has("6,4") && !s.wall.has("1,1"));
  assert.strictEqual(s.floor.size, 15); // 5x3 interior
  assert.strictEqual(s.history.length, 0);
  assert.strictEqual(s.solved, false);
});

test("'*' parses as crate-on-pad and '+' as worker-on-pad", () => {
  const s = logic.parseLevel({
    name: "t", par: 1, parPushes: 1,
    map: ["#####", "#+* #", "#####"],
  });
  assert.deepStrictEqual({ x: s.player.x, y: s.player.y }, { x: 1, y: 1 });
  assert.ok(s.targets.has("1,1") && s.targets.has("2,1"));
  assert.strictEqual(s.crates.length, 1);
  assert.ok(logic.onTarget(s, s.crates[0]));
});

test("static corner detection: non-target corners flagged, pads never", () => {
  const s = logic.parseLevel(LEVELS[0]);
  for (const k of ["1,1", "5,1", "1,3", "5,3"]) {
    assert.ok(s.corners.has(k), `expected corner at ${k}`);
  }
  assert.ok(!s.corners.has("4,2"), "the pad must not be a corner");
  assert.ok(!s.corners.has("3,2"), "open mid-floor is not a corner");
});

// ---------------------------------------------------------------- movement

test("a plain step moves the worker and records one non-push history entry", () => {
  const s = logic.parseLevel(LEVELS[0]);
  const res = logic.move(s, "down");
  assert.ok(res && !res.crate);
  assert.deepStrictEqual({ x: s.player.x, y: s.player.y }, { x: 2, y: 3 });
  assert.strictEqual(logic.movesCount(s), 1);
  assert.strictEqual(logic.pushesCount(s), 0);
  assert.deepStrictEqual({ px: res.px, py: res.py, nx: res.nx, ny: res.ny },
    { px: 2, py: 2, nx: 2, ny: 3 });
});

test("walking into a wall returns null and changes nothing", () => {
  const s = logic.parseLevel(LEVELS[0]);
  logic.move(s, "up"); // to 2,1
  const res = logic.move(s, "up"); // wall at 2,0
  assert.strictEqual(res, null);
  assert.deepStrictEqual({ x: s.player.x, y: s.player.y }, { x: 2, y: 1 });
  assert.strictEqual(logic.movesCount(s), 1);
});

test("pushing a crate onto its pad flags entered + solves the level", () => {
  const s = logic.parseLevel(LEVELS[0]);
  const res = logic.move(s, "right"); // pushes 3,2 -> 4,2 (the pad)
  assert.ok(res && res.crate);
  assert.deepStrictEqual({ x: res.crate.ref.x, y: res.crate.ref.y }, { x: 4, y: 2 });
  assert.strictEqual(res.crate.entered, true);
  assert.strictEqual(res.crate.left, false);
  assert.strictEqual(res.crate.deadlocked, false);
  assert.strictEqual(logic.pushesCount(s), 1);
  assert.ok(logic.isSolved(s) && s.solved);
});

test("a push against a wall beyond the crate is blocked (null, no state change)", () => {
  const s = logic.parseLevel({
    name: "t", par: 1, parPushes: 1,
    map: ["#####", "#@$.#", "#####"],
  });
  logic.move(s, "right"); // crate to the pad at 3,1 (against the wall)
  const res = logic.move(s, "right"); // wall beyond
  assert.strictEqual(res, null);
  assert.strictEqual(logic.movesCount(s), 1);
  assert.deepStrictEqual({ x: s.crates[0].x, y: s.crates[0].y }, { x: 3, y: 1 });
});

test("two crates in a row never budge", () => {
  const s = logic.parseLevel({
    name: "t", par: 1, parPushes: 1,
    map: ["#######", "#@$$..#", "#######"],
  });
  const res = logic.move(s, "right");
  assert.strictEqual(res, null);
  assert.deepStrictEqual({ x: s.player.x, y: s.player.y }, { x: 1, y: 1 });
  assert.deepStrictEqual([s.crates[0].x, s.crates[1].x], [2, 3]);
  assert.strictEqual(logic.movesCount(s), 0);
});

test("pushing a crate into a non-target corner flags deadlocked", () => {
  const s = logic.parseLevel({
    name: "t", par: 1, parPushes: 1,
    map: ["#####", "#@$ #", "# . #", "#####"],
  });
  const res = logic.move(s, "right"); // crate 2,1 -> 3,1: corner (wall up + wall right)
  assert.ok(res && res.crate);
  assert.strictEqual(res.crate.deadlocked, true);
  assert.ok(logic.inCorner(s, res.crate.ref));
});

test("pushing a crate off its pad flags left", () => {
  const s = logic.parseLevel({
    name: "t", par: 1, parPushes: 1,
    map: ["######", "#@*. #", "######"],
  });
  const res = logic.move(s, "right"); // pad 2,1 -> pad 3,1: neither entered nor left
  assert.strictEqual(res.crate.entered, false);
  assert.strictEqual(res.crate.left, false);
  const res2 = logic.move(s, "right"); // pad 3,1 -> floor 4,1
  assert.strictEqual(res2.crate.left, true);
  assert.strictEqual(res2.crate.entered, false);
  assert.ok(!logic.onTarget(s, res2.crate.ref));
});

test("undo restores the worker, the pushed crate, and the counters", () => {
  const s = logic.parseLevel(LEVELS[1]); // Corner Caution
  logic.move(s, "left"); // push crate 3,2 onto pad 2,2
  assert.strictEqual(logic.pushesCount(s), 1);
  const res = logic.undo(s);
  assert.ok(res && res.crate);
  assert.deepStrictEqual({ x: s.player.x, y: s.player.y }, { x: 4, y: 2 });
  assert.deepStrictEqual({ x: s.crates[0].x, y: s.crates[0].y }, { x: 3, y: 2 });
  assert.strictEqual(logic.movesCount(s), 0);
  assert.strictEqual(logic.pushesCount(s), 0);
});

test("undo with an empty history returns null", () => {
  const s = logic.parseLevel(LEVELS[0]);
  assert.strictEqual(logic.undo(s), null);
});

test("undo walks the full history back to the start position", () => {
  const s = logic.parseLevel(LEVELS[1]);
  const seq = ["down", "down", "left", "left", "up"];
  for (const d of seq) assert.ok(logic.move(s, d), d);
  for (let i = 0; i < seq.length; i++) assert.ok(logic.undo(s));
  assert.deepStrictEqual({ x: s.player.x, y: s.player.y }, { x: 4, y: 2 });
  assert.deepStrictEqual({ x: s.crates[0].x, y: s.crates[0].y }, { x: 3, y: 2 });
  assert.deepStrictEqual({ x: s.crates[1].x, y: s.crates[1].y }, { x: 3, y: 4 });
  assert.strictEqual(logic.movesCount(s), 0);
});

// ---------------------------------------------------------------- scoring

test("starsFor: 3 at/under par, 2 within 1.6x par, 1 for any other finish", () => {
  assert.strictEqual(logic.starsFor(10, 9), 3);
  assert.strictEqual(logic.starsFor(10, 10), 3);
  assert.strictEqual(logic.starsFor(10, 11), 2);
  assert.strictEqual(logic.starsFor(10, 16), 2); // ceil(16.0)
  assert.strictEqual(logic.starsFor(10, 17), 1);
  assert.strictEqual(logic.starsFor(1, 1), 3);
  assert.strictEqual(logic.starsFor(1, 2), 2); // ceil(1.6)
  assert.strictEqual(logic.starsFor(1, 3), 1);
});

// ---------------------------------------------------------------- solver

// Move-optimal breadth-first solver with dead-square (static corner) pruning.
// Returns { moves, path } or null when the cap is hit.
function solve(def, cap) {
  const s = logic.parseLevel(def);
  const dirs = Object.entries(logic.DIR);
  const solid = (x, y) => s.wall.has(K(x, y)) || !s.floor.has(K(x, y));
  const solvedSet = (crates) => crates.every(([x, y]) => s.targets.has(K(x, y)));

  const start = {
    p: [s.player.x, s.player.y],
    crates: s.crates.map((c) => [c.x, c.y]),
    path: "",
  };
  const enc = (p, crates) =>
    p[0] + "," + p[1] + "|" + crates.map(([x, y]) => x + "," + y).sort().join(";");

  if (solvedSet(start.crates)) return { moves: 0, path: "" };
  const seen = new Set([enc(start.p, start.crates)]);
  let frontier = [start];
  let depth = 0;
  while (frontier.length) {
    if (seen.size > cap) return null;
    depth++;
    const next = [];
    for (const node of frontier) {
      for (const [name, d] of dirs) {
        const nx = node.p[0] + d.dx, ny = node.p[1] + d.dy;
        if (solid(nx, ny)) continue;
        const ci = node.crates.findIndex(([x, y]) => x === nx && y === ny);
        let crates = node.crates;
        if (ci !== -1) {
          const bx = nx + d.dx, by = ny + d.dy;
          if (solid(bx, by)) continue;
          if (node.crates.some(([x, y]) => x === bx && y === by)) continue;
          if (s.corners.has(K(bx, by))) continue; // dead-square pruning
          crates = node.crates.map((c, i) => (i === ci ? [bx, by] : c));
        }
        const k = enc([nx, ny], crates);
        if (seen.has(k)) continue;
        seen.add(k);
        const path = node.path + name[0]; // u/d/l/r
        if (solvedSet(crates)) return { moves: depth, path };
        next.push({ p: [nx, ny], crates, path });
      }
    }
    frontier = next;
  }
  return { moves: -1, path: null }; // exhausted: unsolvable
}

const DIR_OF = { u: "up", d: "down", l: "left", r: "right" };

test("BFS solver verifies par (move-optimal) on every tractable level", () => {
  const CAP = 600000;
  let verified = 0;
  const skipped = [];
  LEVELS.forEach((lv, i) => {
    const sol = solve(lv, CAP);
    if (sol === null) { skipped.push(lv.name); return; }
    assert.notStrictEqual(sol.moves, -1, `${lv.name} is unsolvable!`);
    if (i === 18) {
      // Last Shift: par is a replayed push-optimal solution, not move-optimal
      assert.ok(sol.moves <= lv.par, `${lv.name}: optimal ${sol.moves} > par ${lv.par}`);
    } else {
      assert.strictEqual(sol.moves, lv.par, `${lv.name}: optimal ${sol.moves} != par ${lv.par}`);
    }
    verified++;
  });
  assert.ok(verified >= 15, `only ${verified} levels fit the state cap`);
  console.log(`      (par verified on ${verified}/${LEVELS.length}; capped: ${skipped.join(", ") || "none"})`);
});

test("replaying a solver solution through logic.move wins at par with 3 stars", () => {
  for (const i of [0, 3, 7]) { // First Push, Swap Meet, The Squeeze
    const lv = LEVELS[i];
    const sol = solve(lv, 600000);
    assert.ok(sol && sol.path !== null, lv.name);
    const s = logic.parseLevel(lv);
    for (const ch of sol.path) assert.ok(logic.move(s, DIR_OF[ch]), `${lv.name}: blocked replay`);
    assert.ok(s.solved && logic.isSolved(s), lv.name);
    assert.strictEqual(logic.movesCount(s), lv.par, lv.name);
    assert.strictEqual(logic.starsFor(lv.par, logic.movesCount(s)), 3, lv.name);
  }
});

console.log(`\ncrateshift logic tests: ${passed} passed`);

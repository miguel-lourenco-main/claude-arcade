/* Lamplighter — node-runnable pure-logic tests (no browser, no deps).
   Run: node games/lamplighter/test/logic.test.js  (exit 0 on pass) */

"use strict";

const assert = require("assert");
const path = require("path");

const MAZE = require(path.join(__dirname, "..", "src", "maze.js"));
const Sfx = require(path.join(__dirname, "..", "src", "audio.js"));

const { WALL, PATH, DEN, DOOR, COLS, ROWS, TUNNEL_ROW, DIRS, mulberry32, generateMaze, bfsField } = MAZE;

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok  " + name);
}

/* ---------- rng ---------- */

test("mulberry32 is deterministic for a given seed", () => {
  const a = mulberry32(12345), b = mulberry32(12345);
  for (let i = 0; i < 100; i++) assert.strictEqual(a(), b());
});

test("mulberry32 output stays in [0, 1)", () => {
  const r = mulberry32(999);
  for (let i = 0; i < 10000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1, "out of range: " + v);
  }
});

test("different seeds diverge", () => {
  const a = mulberry32(1), b = mulberry32(2);
  let same = 0;
  for (let i = 0; i < 20; i++) if (a() === b()) same++;
  assert.ok(same < 20, "seeds 1 and 2 produced identical streams");
});

/* ---------- maze generation (property-checked across many seeds) ---------- */

const SEEDS = [];
for (let s = 1; s <= 30; s++) SEEDS.push(s * 7919);
const MAZES = SEEDS.map((s) => generateMaze(mulberry32(s)));

test("generateMaze returns a maze for every seed", () => {
  for (const m of MAZES) {
    assert.ok(m && m.grid && m.lanterns && m.braziers && m.spawn);
  }
});

test("grid has the documented dimensions (21x23)", () => {
  for (const m of MAZES) {
    assert.strictEqual(m.grid.length, ROWS);
    for (const row of m.grid) assert.strictEqual(row.length, COLS);
  }
});

test("maze is left-right symmetric", () => {
  for (const m of MAZES)
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++)
        assert.strictEqual(
          m.grid[y][x], m.grid[y][COLS - 1 - x],
          "asymmetry at " + x + "," + y
        );
});

test("outer border is wall except the wrapping tunnel row", () => {
  for (const m of MAZES) {
    for (let x = 0; x < COLS; x++) {
      assert.strictEqual(m.grid[0][x], WALL);
      assert.strictEqual(m.grid[ROWS - 1][x], WALL);
    }
    for (let y = 0; y < ROWS; y++) {
      if (y === TUNNEL_ROW) continue;
      assert.strictEqual(m.grid[y][0], WALL, "left border open at y=" + y);
      assert.strictEqual(m.grid[y][COLS - 1], WALL, "right border open at y=" + y);
    }
  }
});

test("wrapping side tunnels exist on the middle row", () => {
  for (const m of MAZES) {
    for (let x = 0; x <= 6; x++) {
      assert.strictEqual(m.grid[TUNNEL_ROW][x], PATH);
      assert.strictEqual(m.grid[TUNNEL_ROW][COLS - 1 - x], PATH);
    }
  }
});

test("den chamber and door are where main.js expects them", () => {
  for (const m of MAZES) {
    for (let x = 9; x <= 11; x++) assert.strictEqual(m.grid[11][x], DEN);
    assert.strictEqual(m.grid[10][10], DOOR);
    assert.deepStrictEqual(m.doorTop, { x: 10, y: 9 });
    assert.deepStrictEqual(m.denCenter, { x: 10, y: 11 });
    assert.strictEqual(m.grid[9][10], PATH, "tile above the door must be corridor");
  }
});

test("spawn tile is a corridor", () => {
  for (const m of MAZES) {
    assert.deepStrictEqual(m.spawn, { x: 10, y: 17 });
    assert.strictEqual(m.grid[m.spawn.y][m.spawn.x], PATH);
  }
});

test("four braziers sit on corridor tiles at the four corners", () => {
  for (const m of MAZES) {
    assert.strictEqual(m.braziers.length, 4);
    const want = [[1, 1], [19, 1], [1, 21], [19, 21]];
    for (let i = 0; i < 4; i++) {
      assert.strictEqual(m.braziers[i].x, want[i][0]);
      assert.strictEqual(m.braziers[i].y, want[i][1]);
      assert.strictEqual(m.grid[m.braziers[i].y][m.braziers[i].x], PATH);
    }
  }
});

test("at least 28 lanterns, all on corridor tiles, none on spawn/braziers", () => {
  for (const m of MAZES) {
    assert.ok(m.lanterns.length >= 28, "only " + m.lanterns.length + " lanterns");
    for (const l of m.lanterns) {
      assert.strictEqual(m.grid[l.y][l.x], PATH);
      assert.ok(!(l.x === m.spawn.x && l.y === m.spawn.y), "lantern on spawn");
      assert.ok(
        !m.braziers.some((b) => b.x === l.x && b.y === l.y),
        "lantern on a brazier"
      );
    }
  }
});

test("lanterns are spaced at least 2 apart (Chebyshev)", () => {
  for (const m of MAZES) {
    for (let i = 0; i < m.lanterns.length; i++)
      for (let j = i + 1; j < m.lanterns.length; j++) {
        const a = m.lanterns[i], b = m.lanterns[j];
        const d = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
        assert.ok(d >= 2, "lanterns too close: " + JSON.stringify([a, b]));
      }
  }
});

test("every corridor tile (so every lantern and brazier) is reachable from spawn", () => {
  for (const m of MAZES) {
    const reach = bfsField(m.grid, m.spawn.x, m.spawn.y);
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++)
        if (m.grid[y][x] === PATH)
          assert.ok(reach[y * COLS + x] >= 0, "unreachable corridor at " + x + "," + y);
  }
});

test("bfsField wraps across the tunnel row (x=0 to x=20 is distance 1)", () => {
  for (const m of MAZES) {
    const d = bfsField(m.grid, 0, TUNNEL_ROW);
    assert.strictEqual(d[TUNNEL_ROW * COLS + 0], 0);
    assert.strictEqual(d[TUNNEL_ROW * COLS + (COLS - 1)], 1, "tunnel does not wrap");
  }
});

test("doorField guides gloams home: 0 at the door-top, finite on all corridors", () => {
  for (const m of MAZES) {
    assert.strictEqual(m.doorField[9 * COLS + 10], 0);
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++)
        if (m.grid[y][x] === PATH)
          assert.ok(m.doorField[y * COLS + x] >= 0, "no path home from " + x + "," + y);
  }
});

test("scatter corners are the four brazier tiles", () => {
  for (const m of MAZES) {
    assert.strictEqual(m.corners.length, 4);
    for (const c of m.corners) {
      assert.ok(m.braziers.some((b) => b.x === c.x && b.y === c.y));
      assert.strictEqual(m.grid[c.y][c.x], PATH);
    }
  }
});

test("lamp glow pools cover the lamp tile and stay within path-distance 2", () => {
  for (const m of MAZES) {
    for (const lamp of m.lanterns.concat(m.braziers)) {
      assert.ok(lamp.glow.length >= 1);
      assert.deepStrictEqual(
        { x: lamp.glow[0].x, y: lamp.glow[0].y, d: lamp.glow[0].d },
        { x: lamp.x, y: lamp.y, d: 0 }
      );
      for (const t of lamp.glow) {
        assert.ok(t.d >= 0 && t.d <= 2);
        assert.strictEqual(m.grid[t.y][t.x], PATH, "glow on a non-corridor tile");
      }
    }
  }
});

test("no dead ends outside the tunnel mouths (corridors loop)", () => {
  for (const m of MAZES) {
    for (let y = 1; y < ROWS - 1; y++) {
      for (let x = 0; x < COLS; x++) {
        if (m.grid[y][x] !== PATH) continue;
        if (y === TUNNEL_ROW && (x <= 2 || x >= COLS - 3)) continue; /* tunnel mouths */
        let open = 0;
        for (const d of DIRS) {
          let nx = x + d.dx;
          const ny = y + d.dy;
          if (ny < 0 || ny >= ROWS) continue;
          if (nx < 0) nx = COLS - 1;
          if (nx >= COLS) nx = 0;
          const t = m.grid[ny][nx];
          if (t === PATH || t === DOOR) open++;
        }
        assert.ok(open >= 2, "dead end at " + x + "," + y);
      }
    }
  }
});

test("same seed generates the same maze (procedural determinism)", () => {
  const a = generateMaze(mulberry32(424242));
  const b = generateMaze(mulberry32(424242));
  assert.deepStrictEqual(a.grid, b.grid);
  assert.deepStrictEqual(
    a.lanterns.map((l) => [l.x, l.y]),
    b.lanterns.map((l) => [l.x, l.y])
  );
});

/* ---------- audio logic (no AudioContext in node; the class must stay inert) ---------- */

test("Sfx defaults to enabled and setEnabled flips the mute state", () => {
  const s = new Sfx("test.audio.key");
  assert.strictEqual(s.enabled, true);
  s.setEnabled(false);
  assert.strictEqual(s.enabled, false);
  s.setEnabled(true);
  assert.strictEqual(s.enabled, true);
});

test("Sfx is inert before unlock: ready() false, all cues are safe no-ops", () => {
  const s = new Sfx("test.audio.key2");
  assert.ok(!s.ready(), "ready() must be falsy before unlock");
  s.lantern(1);
  s.brazier();
  s.banish(2);
  s.death();
  s.clear();
  s.readyCue();
  s.tone(440, 880, 0.1, "sine", 0.2);
  s.noise(0.1, 0.1, 800, 1);
});

console.log("\nall " + passed + " logic tests passed");

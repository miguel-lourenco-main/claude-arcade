// Dowser logic tests — plain node, plain asserts, exit 0 on pass.
// Run: node games/dowser/test/logic.test.js
"use strict";

const assert = require("assert");
const path = require("path");
const core = require(path.join(__dirname, "..", "src", "core.js"));

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}

// Build a board from an ASCII picture: '#' = hollow, '.' = clear.
function boardFrom(rows) {
  const b = core.createBoard(rows[0].length, rows.length, 0);
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      if (rows[r][c] === "#") {
        b.hazard[core.idx(b, r, c)] = 1;
        b.hollows++;
      }
    }
  }
  core.computeCounts(b);
  b.seeded = true;
  return b;
}

// Deterministic LCG so seeding tests are reproducible.
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ---------------------------------------------------------------- presets

test("presets match the shipped difficulties", () => {
  assert.deepStrictEqual(
    Object.keys(core.PRESETS),
    ["seedplot", "meadow", "longfield"]
  );
  assert.deepStrictEqual(
    { c: core.PRESETS.seedplot.cols, r: core.PRESETS.seedplot.rows, h: core.PRESETS.seedplot.hollows },
    { c: 9, r: 9, h: 10 }
  );
  assert.deepStrictEqual(
    { c: core.PRESETS.meadow.cols, r: core.PRESETS.meadow.rows, h: core.PRESETS.meadow.hollows },
    { c: 16, r: 16, h: 40 }
  );
  assert.deepStrictEqual(
    { c: core.PRESETS.longfield.cols, r: core.PRESETS.longfield.rows, h: core.PRESETS.longfield.hollows },
    { c: 30, r: 16, h: 99 }
  );
});

test("createBoard sizes every layer and starts clean", () => {
  const b = core.createBoard(9, 9, 10);
  assert.strictEqual(b.hazard.length, 81);
  assert.strictEqual(b.count.length, 81);
  assert.strictEqual(b.revealed.length, 81);
  assert.strictEqual(b.flagged.length, 81);
  assert.strictEqual(b.seeded, false);
  assert.strictEqual(b.revealedCount, 0);
  assert.strictEqual(b.flagCount, 0);
  assert.strictEqual(b.burstAt, -1);
});

// ---------------------------------------------------------------- seeding

test("first-click safety: the safe cell and all 8 neighbors stay clear", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const b = core.createBoard(9, 9, 10);
    core.seedHazards(b, 4, 4, lcg(seed));
    assert.strictEqual(b.seeded, true);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        assert.strictEqual(b.hazard[core.idx(b, 4 + dr, 4 + dc)], 0,
          `hazard leaked into the safe zone (seed ${seed})`);
      }
    }
  }
});

test("seeding places exactly `hollows` hazards", () => {
  const b = core.createBoard(16, 16, 40);
  core.seedHazards(b, 0, 0, lcg(7));
  assert.strictEqual(b.hazard.reduce((a, v) => a + v, 0), 40);
});

test("seeding clamps when the pool is smaller than `hollows`", () => {
  const b = core.createBoard(3, 3, 10); // pool = 9 - 4 excluded = 5
  core.seedHazards(b, 0, 0, lcg(3));
  assert.strictEqual(b.hazard.reduce((a, v) => a + v, 0), 5);
});

test("adjacency counts equal the true number of neighboring hollows", () => {
  const b = core.createBoard(9, 9, 10);
  core.seedHazards(b, 4, 4, lcg(11));
  for (let r = 0; r < b.rows; r++) {
    for (let c = 0; c < b.cols; c++) {
      if (b.hazard[core.idx(b, r, c)]) continue;
      let expect = 0;
      for (const [nr, nc] of core.neighbors(b, r, c)) expect += b.hazard[core.idx(b, nr, nc)];
      assert.strictEqual(b.count[core.idx(b, r, c)], expect, `bad count at ${r},${c}`);
    }
  }
});

// ---------------------------------------------------------------- reveal / flood fill

test("digging a zero-plot flood-fills every connected safe cell", () => {
  const b = boardFrom([
    "#....",
    ".....",
    ".....",
    ".....",
    "....#",
  ]);
  const opened = core.reveal(b, 2, 2);
  assert.strictEqual(opened, 23); // all 25 cells minus the 2 hollows
  assert.strictEqual(b.revealedCount, 23);
  assert.strictEqual(b.revealed[core.idx(b, 0, 0)], 0, "hollow must stay hidden");
  assert.strictEqual(b.revealed[core.idx(b, 4, 4)], 0, "hollow must stay hidden");
});

test("numbered plots stop the flood fill", () => {
  const b = boardFrom([
    "..#..",
    "..#..",
    "..#..",
  ]);
  const opened = core.reveal(b, 1, 0);
  // left column (3 zeros) + middle column of numbers (3) — the wall stops it
  assert.strictEqual(opened, 6);
  assert.strictEqual(b.revealed[core.idx(b, 0, 3)], 0, "fill crossed the number wall");
  assert.strictEqual(b.revealed[core.idx(b, 1, 4)], 0, "fill crossed the number wall");
});

test("digging a numbered plot reveals only that plot", () => {
  const b = boardFrom([
    "#..",
    "...",
    "...",
  ]);
  const opened = core.reveal(b, 1, 1); // count 1
  assert.strictEqual(opened, 1);
  assert.strictEqual(b.revealedCount, 1);
});

test("digging a hollow returns -1 and records burstAt", () => {
  const b = boardFrom([
    "#..",
    "...",
    "...",
  ]);
  assert.strictEqual(core.reveal(b, 0, 0), -1);
  assert.strictEqual(b.burstAt, core.idx(b, 0, 0));
  assert.strictEqual(b.revealed[core.idx(b, 0, 0)], 0);
});

test("re-digging a revealed plot is a no-op", () => {
  const b = boardFrom([
    "#..",
    "...",
    "...",
  ]);
  core.reveal(b, 1, 1);
  assert.strictEqual(core.reveal(b, 1, 1), 0);
  assert.strictEqual(b.revealedCount, 1);
});

// ---------------------------------------------------------------- flags

test("a marker blocks digging that plot", () => {
  const b = boardFrom([
    "#..",
    "...",
    "...",
  ]);
  assert.strictEqual(core.toggleFlag(b, 1, 1), true);
  assert.strictEqual(core.reveal(b, 1, 1), 0);
  assert.strictEqual(b.revealed[core.idx(b, 1, 1)], 0);
});

test("flood fill skips marked plots", () => {
  const b = boardFrom([
    "#....",
    ".....",
    ".....",
    ".....",
    "....#",
  ]);
  core.toggleFlag(b, 2, 3);
  const opened = core.reveal(b, 2, 2);
  assert.strictEqual(b.revealed[core.idx(b, 2, 3)], 0, "fill dug through a marker");
  assert.strictEqual(opened, 22); // 23 minus the flagged cell
});

test("toggleFlag plants, pulls, and tracks flagCount", () => {
  const b = boardFrom([
    "#..",
    "...",
    "...",
  ]);
  core.toggleFlag(b, 0, 0);
  assert.strictEqual(b.flagCount, 1);
  assert.strictEqual(b.flagged[core.idx(b, 0, 0)], 1);
  core.toggleFlag(b, 0, 0);
  assert.strictEqual(b.flagCount, 0);
  assert.strictEqual(b.flagged[core.idx(b, 0, 0)], 0);
});

test("toggleFlag refuses revealed plots", () => {
  const b = boardFrom([
    "#..",
    "...",
    "...",
  ]);
  core.reveal(b, 1, 1);
  assert.strictEqual(core.toggleFlag(b, 1, 1), false);
  assert.strictEqual(b.flagCount, 0);
});

// ---------------------------------------------------------------- chording

test("chord with matching flags digs the remaining neighbors", () => {
  const b = boardFrom([
    "#..",
    "...",
    "...",
  ]);
  core.reveal(b, 1, 1);       // the 1
  core.toggleFlag(b, 0, 0);   // correct marker on the hollow
  const opened = core.chord(b, 1, 1);
  assert.strictEqual(opened, 7); // everything else opens
  assert.strictEqual(core.isWin(b), true);
});

test("chord does nothing when flags don't match the number", () => {
  const b = boardFrom([
    "#..",
    "...",
    "...",
  ]);
  core.reveal(b, 1, 1);
  assert.strictEqual(core.chord(b, 1, 1), 0); // 0 flags != 1
  core.toggleFlag(b, 0, 0);
  core.toggleFlag(b, 0, 1);
  assert.strictEqual(core.chord(b, 1, 1), 0); // 2 flags != 1
});

test("chord on a hidden or zero plot does nothing", () => {
  const b = boardFrom([
    "#..",
    "...",
    "...",
  ]);
  assert.strictEqual(core.chord(b, 1, 1), 0); // hidden
  core.reveal(b, 2, 2);
  assert.strictEqual(core.chord(b, 2, 2), 0); // zero count
});

test("a mis-flagged chord bursts the hollow", () => {
  const b = boardFrom([
    "#..",
    "...",
    "...",
  ]);
  core.reveal(b, 1, 1);
  core.toggleFlag(b, 0, 1); // wrong plot flagged
  assert.strictEqual(core.chord(b, 1, 1), -1);
  assert.strictEqual(b.burstAt, core.idx(b, 0, 0));
});

// ---------------------------------------------------------------- win

test("win when every non-hollow plot is revealed; flags irrelevant", () => {
  const b = boardFrom([
    "#..",
    "...",
    "...",
  ]);
  assert.strictEqual(core.isWin(b), false);
  core.reveal(b, 2, 2); // floods all 8 safe cells
  assert.strictEqual(b.revealedCount, 8);
  assert.strictEqual(core.isWin(b), true); // hollow never flagged — still a win
});

test("full simulated game on a seeded 9x9 ends in a win", () => {
  const b = core.createBoard(9, 9, 10);
  core.seedHazards(b, 4, 4, lcg(42));
  core.reveal(b, 4, 4);
  for (let r = 0; r < b.rows; r++) {
    for (let c = 0; c < b.cols; c++) {
      const i = core.idx(b, r, c);
      if (!b.hazard[i] && !b.revealed[i]) {
        assert.notStrictEqual(core.reveal(b, r, c), -1, "safe dig burst");
      }
    }
  }
  assert.strictEqual(core.isWin(b), true);
  assert.strictEqual(b.revealedCount, 71);
});

console.log(`\ndowser logic tests: ${passed} passed`);

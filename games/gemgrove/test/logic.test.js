'use strict';
// Gemgrove pure-logic tests — plain node, plain asserts, exit 0 on pass.
// Run: node games/gemgrove/test/logic.test.js
const assert = require('assert');
const L = require('../logic.js');

const { COLS, ROWS, NTYPES, key, kr, kc } = L;

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok - ' + name);
}

// Build an 8x8 grid from 8 strings of 8 digits (gem types 0-5).
function board(rows) {
  assert.strictEqual(rows.length, ROWS, 'board() needs 8 rows');
  return rows.map((s) => {
    assert.strictEqual(s.length, COLS, 'board() rows need 8 cols');
    return [...s].map((ch) => L.defaultCell(Number(ch)));
  });
}

// A base pattern with NO runs and NO valid moves (verified below), used as a
// quiet canvas to paint deterministic scenarios onto.
const INERT = [
  '01230123',
  '23012301',
  '01230123',
  '23012301',
  '01230123',
  '23012301',
  '01230123',
  '23012301',
];

// ---------------------------------------------------------------- helpers

test('key/kr/kc round-trip every cell', () => {
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const k = key(r, c);
      assert.strictEqual(kr(k), r);
      assert.strictEqual(kc(k), c);
    }
});

test('isAdjacent: orthogonal neighbours only', () => {
  assert.ok(L.isAdjacent({ r: 3, c: 3 }, { r: 3, c: 4 }));
  assert.ok(L.isAdjacent({ r: 3, c: 3 }, { r: 2, c: 3 }));
  assert.ok(!L.isAdjacent({ r: 3, c: 3 }, { r: 4, c: 4 }), 'diagonal is not adjacent');
  assert.ok(!L.isAdjacent({ r: 3, c: 3 }, { r: 3, c: 3 }), 'self is not adjacent');
  assert.ok(!L.isAdjacent({ r: 3, c: 3 }, { r: 3, c: 5 }), 'distance 2 is not adjacent');
});

// ---------------------------------------------------------------- levels

test('levelTarget: 1000 base, +850 per level', () => {
  assert.strictEqual(L.levelTarget(1), 1000);
  assert.strictEqual(L.levelTarget(2), 1850);
  assert.strictEqual(L.levelTarget(10), 1000 + 9 * 850);
});

test('levelMoves: 20 base, +1 every 3 levels', () => {
  assert.strictEqual(L.levelMoves(1), 20);
  assert.strictEqual(L.levelMoves(3), 20);
  assert.strictEqual(L.levelMoves(4), 21);
  assert.strictEqual(L.levelMoves(7), 22);
});

// ---------------------------------------------------------------- findRuns

test('findRuns: the inert pattern has zero runs', () => {
  assert.strictEqual(L.findRuns(board(INERT)).length, 0);
});

test('findRuns: detects a horizontal 3-run with the right cells', () => {
  const g = board(INERT);
  g[4][2].t = 5; g[4][3].t = 5; g[4][4].t = 5;
  const runs = L.findRuns(g);
  assert.strictEqual(runs.length, 1);
  assert.strictEqual(runs[0].dir, 'row');
  assert.strictEqual(runs[0].t, 5);
  assert.deepStrictEqual(runs[0].cells, [
    { r: 4, c: 2 }, { r: 4, c: 3 }, { r: 4, c: 4 },
  ]);
});

test('findRuns: detects a vertical 4-run', () => {
  const g = board(INERT);
  for (let r = 2; r <= 5; r++) g[r][6].t = 4;
  const runs = L.findRuns(g);
  assert.strictEqual(runs.length, 1);
  assert.strictEqual(runs[0].dir, 'col');
  assert.strictEqual(runs[0].cells.length, 4);
});

test('findRuns: a run of exactly 2 is not a match', () => {
  const g = board(INERT);
  g[0][0].t = 5; g[0][1].t = 5;
  assert.strictEqual(L.findRuns(g).length, 0);
});

test('findRuns: an L-intersection reports both the row and column runs', () => {
  const g = board(INERT);
  g[0][0].t = 5; g[0][1].t = 5; g[0][2].t = 5;   // row run through (0,0)
  g[1][0].t = 5; g[2][0].t = 5;                  // column run through (0,0)
  const runs = L.findRuns(g);
  assert.strictEqual(runs.length, 2);
  assert.deepStrictEqual(runs.map((r) => r.dir).sort(), ['col', 'row']);
});

// ---------------------------------------------------------------- matchAt

test('matchAt: true only where a 3+ line crosses the cell', () => {
  const g = board(INERT);
  g[7][5].t = 1; g[7][6].t = 1; g[7][7].t = 1;
  assert.ok(L.matchAt(g, 7, 5) && L.matchAt(g, 7, 6) && L.matchAt(g, 7, 7));
  assert.ok(!L.matchAt(g, 7, 4));
  assert.ok(!L.matchAt(g, 0, 0));
});

// ---------------------------------------------------------------- valid moves

test('computeValidMoves: the inert pattern has zero valid moves', () => {
  assert.strictEqual(L.computeValidMoves(board(INERT)).length, 0);
});

test('computeValidMoves: finds a single planted swap and leaves the grid intact', () => {
  const g = board(INERT);
  // make swapping (3,3)<->(3,4) create a vertical 3-run of type 5 at column 3
  g[1][3].t = 5; g[2][3].t = 5; g[3][4].t = 5;
  const snapshot = g.map((row) => row.map((cl) => cl.t)).flat().join('');
  const moves = L.computeValidMoves(g);
  assert.strictEqual(moves.length, 1);
  assert.deepStrictEqual(moves[0], { a: { r: 3, c: 3 }, b: { r: 3, c: 4 } });
  const after = g.map((row) => row.map((cl) => cl.t)).flat().join('');
  assert.strictEqual(after, snapshot, 'probe swaps must be undone');
});

// ---------------------------------------------------------------- generation

test('generateBoard: 8x8, sane types, no ready-made matches, >=1 valid move (x50)', () => {
  for (let i = 0; i < 50; i++) {
    const g = L.generateBoard();
    assert.strictEqual(g.length, ROWS);
    for (const row of g) {
      assert.strictEqual(row.length, COLS);
      for (const cl of row) {
        assert.ok(cl.t >= 0 && cl.t < NTYPES);
        assert.strictEqual(cl.s, null);
      }
    }
    assert.strictEqual(L.findRuns(g).length, 0, 'no pre-existing matches');
    assert.ok(L.computeValidMoves(g).length > 0, 'at least one valid move');
  }
});

// ---------------------------------------------------------------- resolveClear

test('resolveClear: plain 3-run clears 3 cells, forges nothing', () => {
  const g = board(INERT);
  g[4][2].t = 5; g[4][3].t = 5; g[4][4].t = 5;
  const res = L.resolveClear(g, L.findRuns(g), 1, null);
  assert.strictEqual(res.clearSet.size, 3);
  assert.strictEqual(res.spawns.size, 0);
  assert.ok(!res.crossFired && !res.burstFired);
});

test('resolveClear: 4-run forges a cross at the swap site (chain 1)', () => {
  const g = board(INERT);
  for (let c = 2; c <= 5; c++) g[6][c].t = 5;
  const swapSites = [{ r: 6, c: 5 }, { r: 5, c: 5 }];
  const res = L.resolveClear(g, L.findRuns(g), 1, swapSites);
  assert.strictEqual(res.clearSet.size, 4);
  assert.strictEqual(res.spawns.size, 1);
  const sp = res.spawns.get(key(6, 5));
  assert.ok(sp, 'spawn lands on the swap site');
  assert.strictEqual(sp.s, 'cross');
  assert.strictEqual(sp.t, 5);
});

test('resolveClear: 4-run mid-cascade (chain 2) forges at the run middle', () => {
  const g = board(INERT);
  for (let c = 2; c <= 5; c++) g[6][c].t = 5;
  const res = L.resolveClear(g, L.findRuns(g), 2, null);
  assert.strictEqual(res.spawns.size, 1);
  assert.ok(res.spawns.get(key(6, 4)), 'middle cell (index len>>1) gets the cross');
});

test('resolveClear: 5-run forges a burst', () => {
  const g = board(INERT);
  for (let c = 1; c <= 5; c++) g[2][c].t = 5;
  const res = L.resolveClear(g, L.findRuns(g), 1, null);
  assert.strictEqual(res.clearSet.size, 5);
  const spawns = [...res.spawns.values()];
  assert.strictEqual(spawns.length, 1);
  assert.strictEqual(spawns[0].s, 'burst');
});

test('resolveClear: L/T intersection forges a burst at the crossing cell', () => {
  const g = board(INERT);
  g[0][0].t = 5; g[0][1].t = 5; g[0][2].t = 5;
  g[1][0].t = 5; g[2][0].t = 5;
  const res = L.resolveClear(g, L.findRuns(g), 1, null);
  assert.strictEqual(res.clearSet.size, 5);
  const sp = res.spawns.get(key(0, 0));
  assert.ok(sp, 'burst sits on the intersection');
  assert.strictEqual(sp.s, 'burst');
});

test('resolveClear: matched cross expands the clear to its full row + column', () => {
  const g = board(INERT);
  g[4][2].t = 5; g[4][3].t = 5; g[4][4].t = 5;
  g[4][3].s = 'cross';
  const res = L.resolveClear(g, L.findRuns(g), 1, null);
  assert.ok(res.crossFired);
  for (let i = 0; i < COLS; i++) assert.ok(res.clearSet.has(key(4, i)), 'row 4 all clears');
  for (let i = 0; i < ROWS; i++) assert.ok(res.clearSet.has(key(i, 3)), 'col 3 all clears');
  // full row + full column share one cell; the run cells sit inside row 4
  assert.strictEqual(res.clearSet.size, ROWS + COLS - 1);
});

test('resolveClear: matched burst detonates its 3x3 area', () => {
  const g = board(INERT);
  g[4][2].t = 5; g[4][3].t = 5; g[4][4].t = 5;
  g[4][3].s = 'burst';
  const res = L.resolveClear(g, L.findRuns(g), 1, null);
  assert.ok(res.burstFired);
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++)
      assert.ok(res.clearSet.has(key(4 + dr, 3 + dc)));
  // the 3-run cells all sit inside the 3x3, so exactly 9 clear
  assert.strictEqual(res.clearSet.size, 9);
});

test('resolveClear: specials chain each other (cross ignites a burst)', () => {
  const g = board(INERT);
  g[4][2].t = 5; g[4][3].t = 5; g[4][4].t = 5;
  g[4][3].s = 'cross';        // clears row 4 + col 3
  g[4][7].s = 'burst';        // sits in row 4 -> should detonate too
  const res = L.resolveClear(g, L.findRuns(g), 1, null);
  assert.ok(res.crossFired && res.burstFired);
  assert.ok(res.clearSet.has(key(3, 6)), 'burst corner cleared via the chain');
  assert.ok(res.clearSet.has(key(5, 6)), 'burst corner cleared via the chain');
});

test('resolveClear: burst at the board corner clips its 3x3 to the frame', () => {
  const g = board(INERT);
  g[0][0].t = 5; g[0][1].t = 5; g[0][2].t = 5;
  g[0][0].s = 'burst';
  const res = L.resolveClear(g, L.findRuns(g), 1, null);
  // 2x2 area around (0,0) inside the frame + (0,2) from the run
  assert.strictEqual(res.clearSet.size, 5);
  assert.ok(res.clearSet.has(key(1, 0)) && res.clearSet.has(key(1, 1)));
});

// ---------------------------------------------------------------- gravity

test('compactAndRefill: survivors keep order, holes fill from above, no nulls', () => {
  const g = board(INERT);
  // punch three holes in column 2 (rows 3, 5, 6)
  const survivors = [];
  for (let r = 0; r < ROWS; r++)
    if (r !== 3 && r !== 5 && r !== 6) survivors.push(g[r][2].t);
  g[3][2] = null; g[5][2] = null; g[6][2] = null;
  L.compactAndRefill(g);
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      assert.ok(g[r][c], 'no cell left null');
  // bottom 5 of column 2 are the survivors, order preserved
  for (let i = 0; i < survivors.length; i++)
    assert.strictEqual(g[3 + i][2].t, survivors[i]);
  // the 3 new cells arrive from above the frame (negative oy)
  for (let r = 0; r < 3; r++) {
    assert.strictEqual(g[r][2].oy, -3);
    assert.ok(g[r][2].t >= 0 && g[r][2].t < NTYPES);
  }
  // moved survivors carry a negative offset so they animate down
  assert.ok(g[3][2].oy < 0);
});

test('compactAndRefill: a full column is untouched', () => {
  const g = board(INERT);
  const before = [];
  for (let r = 0; r < ROWS; r++) before.push(g[r][0]);
  L.compactAndRefill(g);
  for (let r = 0; r < ROWS; r++) {
    assert.strictEqual(g[r][0], before[r], 'same cell object');
    assert.strictEqual(g[r][0].oy, 0, 'no animation offset');
  }
});

// ---------------------------------------------------------------- reshuffle

test('applyShuffle: preserves the gem multiset (+specials), ends matchless with a move', () => {
  const g = board(INERT); // inert = deadlocked, exactly what triggers a shuffle
  g[2][2].s = 'cross';
  g[5][5].s = 'burst';
  const countTypes = (grid) => {
    const n = new Array(NTYPES).fill(0);
    for (const row of grid) for (const cl of row) n[cl.t]++;
    return n.join(',');
  };
  const before = countTypes(g);
  L.applyShuffle(g);
  assert.strictEqual(countTypes(g), before, 'same gems, rearranged');
  const specials = [];
  for (const row of g) for (const cl of row) if (cl.s) specials.push(cl.s);
  assert.deepStrictEqual(specials.sort(), ['burst', 'cross'], 'specials survive');
  assert.strictEqual(L.findRuns(g).length, 0, 'no ready-made matches');
  assert.ok(L.computeValidMoves(g).length > 0, 'at least one valid move');
});

test('applyShuffle: pathological single-colour board falls back to a fresh fill', () => {
  const g = board(INERT);
  for (const row of g) for (const cl of row) cl.t = 0; // unshufflable multiset
  g[0][0].s = 'burst';
  L.applyShuffle(g);
  assert.strictEqual(L.findRuns(g).length, 0);
  assert.ok(L.computeValidMoves(g).length > 0);
  let bursts = 0;
  for (const row of g) for (const cl of row) if (cl.s === 'burst') bursts++;
  assert.strictEqual(bursts, 1, 'the special is re-seeded');
});

console.log(`\ngemgrove logic tests: ${passed} passed`);

// Fuse — logic tests. Run: node games/fuse/test/logic.test.js
// Plain asserts, no deps. Exits 0 on pass, throws (non-zero) on fail.
'use strict';

const assert = require('node:assert');
const { Game, SIZE, WIN_VALUE } = require('../src/logic.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

// A tile literal.
const T = (id, value, r, c) => ({ id, value, r, c });

// A queue-backed rng: pops queued values, then falls back to 0.
function rngQueue(vals) {
  const q = vals.slice();
  return () => (q.length ? q.shift() : 0);
}

// Build a game with an exact board (bypasses the two constructor spawns).
function makeGame(tiles, { score = 0, won = false, over = false, rng } = {}) {
  const g = new Game(() => 0); // constructor spawns are discarded by restore()
  g.restore({ tiles, score, won, keepPlaying: false, over });
  g.prev = null;
  if (rng) g.rng = rng; // installed AFTER construction so the queue is intact
  return g;
}

function at(g, r, c) {
  return g.tiles.find((t) => t.r === r && t.c === c) || null;
}

// A full 15-tile board with no adjacent equal pairs; (3,3) is empty.
// The only legal move is a slide (e.g. right on row 3), after which the
// spawned 2-or-4 at (3,0) cannot pair with any neighbour → game over.
const NEAR_DEATH = [
  T(1, 2, 0, 0), T(2, 4, 0, 1), T(3, 8, 0, 2), T(4, 16, 0, 3),
  T(5, 32, 1, 0), T(6, 64, 1, 1), T(7, 128, 1, 2), T(8, 256, 1, 3),
  T(9, 512, 2, 0), T(10, 1024, 2, 1), T(11, 4, 2, 2), T(12, 8, 2, 3),
  T(13, 16, 3, 0), T(14, 32, 3, 1), T(15, 64, 3, 2),
];

// ---------------------------------------------------------------- basics

test('constants: 4x4 board, win at 2048', () => {
  assert.strictEqual(SIZE, 4);
  assert.strictEqual(WIN_VALUE, 2048);
});

test('new game starts with exactly two tiles and score 0', () => {
  const g = new Game(() => 0);
  assert.strictEqual(g.tiles.length, 2);
  assert.strictEqual(g.score, 0);
  assert.strictEqual(g.over, false);
  assert.strictEqual(g.won, false);
  assert.strictEqual(g.prev, null);
});

// ------------------------------------------------------- slides + merges

test('tiles slide across empty cells to the destination edge', () => {
  const g = makeGame([T(1, 2, 0, 3)]);
  const res = g.move('left');
  assert.strictEqual(res.moved, true);
  assert.strictEqual(at(g, 0, 0).value, 2);
});

test('equal tiles fuse and double; score gains the merged value', () => {
  const g = makeGame([T(1, 2, 0, 0), T(2, 2, 0, 3)]);
  const res = g.move('left');
  assert.strictEqual(res.moved, true);
  assert.strictEqual(res.gained, 4);
  assert.strictEqual(g.score, 4);
  assert.strictEqual(at(g, 0, 0).value, 4);
  assert.strictEqual(res.merged.length, 1);
  assert.strictEqual(res.absorbed.length, 1);
});

test('merge-locking: 4 2 2 →left gives 4 4, never 8', () => {
  const g = makeGame([T(1, 4, 0, 0), T(2, 2, 0, 1), T(3, 2, 0, 2)]);
  g.move('left');
  assert.strictEqual(at(g, 0, 0).value, 4);
  assert.strictEqual(at(g, 0, 1).value, 4);
  assert.ok(!g.tiles.some((t) => t.value === 8), 'no double-merge into 8');
});

test('merge-locking: 2 2 2 2 →left gives 4 4 (two separate merges)', () => {
  const g = makeGame([T(1, 2, 0, 0), T(2, 2, 0, 1), T(3, 2, 0, 2), T(4, 2, 0, 3)]);
  const res = g.move('left');
  assert.strictEqual(res.gained, 8);
  assert.strictEqual(at(g, 0, 0).value, 4);
  assert.strictEqual(at(g, 0, 1).value, 4);
  assert.ok(!g.tiles.some((t) => t.value === 8));
});

test('destination-edge priority: 2 2 2 →left gives 4 2 (edge pair merges)', () => {
  const g = makeGame([T(1, 2, 0, 0), T(2, 2, 0, 1), T(3, 2, 0, 2)]);
  g.move('left');
  assert.strictEqual(at(g, 0, 0).value, 4);
  assert.strictEqual(at(g, 0, 1).value, 2);
});

test('all four directions slide to their destination edge', () => {
  for (const [dir, cell] of [
    ['left', [1, 0]], ['right', [1, 3]], ['up', [0, 1]], ['down', [3, 1]],
  ]) {
    const g = makeGame([T(1, 8, 1, 1)]);
    g.move(dir);
    assert.deepStrictEqual([g.tiles.find((t) => t.id === 1).r, g.tiles.find((t) => t.id === 1).c].map(Number), cell.map(Number), dir + ' lands at edge');
  }
});

// -------------------------------------------------------- illegal moves

test('illegal move: nothing slides/merges → no spawn, no score, no snapshot', () => {
  const g = makeGame([T(1, 2, 0, 0)]);
  const res = g.move('left'); // already flush left
  assert.strictEqual(res.moved, false);
  assert.strictEqual(g.tiles.length, 1, 'nothing spawned');
  assert.strictEqual(g.score, 0);
  assert.strictEqual(g.prev, null, 'no undo snapshot taken');
});

test('legal move spawns exactly one new tile', () => {
  const g = makeGame([T(1, 2, 0, 3)]);
  const res = g.move('left');
  assert.strictEqual(g.tiles.length, 2);
  assert.ok(res.spawned && res.spawned.id !== 1);
});

// ----------------------------------------------------------- 90/10 spawn

test('spawn value: rng < 0.9 gives 2, rng >= 0.9 gives 4', () => {
  const g2 = makeGame([T(1, 8, 0, 0)], { rng: rngQueue([0, 0.89]) });
  assert.strictEqual(g2.spawn().value, 2);
  const g4 = makeGame([T(1, 8, 0, 0)], { rng: rngQueue([0, 0.9]) });
  assert.strictEqual(g4.spawn().value, 4);
});

test('spawn lands in the rng-chosen EMPTY cell only', () => {
  // 15 tiles, only (3,3) empty — any rng index must resolve to (3,3).
  const g = makeGame(NEAR_DEATH, { rng: rngQueue([0.7, 0.5]) });
  const s = g.spawn();
  assert.deepStrictEqual([s.r, s.c], [3, 3]);
  assert.strictEqual(g.spawn(), null, 'full board spawns nothing');
});

test('spawn statistics: roughly 10% fours over 5000 spawns', () => {
  let fours = 0;
  const N = 5000;
  for (let i = 0; i < N; i++) {
    const g = makeGame([T(1, 8, 0, 0)], { rng: Math.random });
    if (g.spawn().value === 4) fours++;
  }
  const frac = fours / N;
  assert.ok(frac > 0.06 && frac < 0.15, `4-rate ${frac} outside [0.06, 0.15]`);
});

// ------------------------------------------------------------------ undo

test('undo restores the exact pre-move state and is single-step', () => {
  const g = makeGame([T(1, 2, 0, 0), T(2, 2, 0, 1)]);
  const before = JSON.stringify(g.serialize());
  g.move('left');
  assert.notStrictEqual(JSON.stringify(g.serialize()), before);
  assert.strictEqual(g.undo(), true);
  assert.strictEqual(JSON.stringify(g.serialize()), before);
  assert.strictEqual(g.undo(), false, 'only one snapshot');
});

test('an illegal move does not clobber the undo snapshot', () => {
  const g = makeGame([T(1, 8, 0, 1)]);
  const before = JSON.stringify(g.serialize());
  g.move('left'); // legal: 8 slides to (0,0); a 2 spawns at (0,1)
  const res = g.move('left'); // illegal: 8|2 packed left, nothing merges
  assert.strictEqual(res.moved, false);
  assert.strictEqual(g.undo(), true);
  assert.strictEqual(JSON.stringify(g.serialize()), before);
});

// ------------------------------------------------------------------- win

test('first 2048 fuse sets justWon + won', () => {
  const g = makeGame([T(1, 1024, 0, 0), T(2, 1024, 0, 1)]);
  const res = g.move('left');
  assert.strictEqual(res.justWon, true);
  assert.strictEqual(g.won, true);
  assert.strictEqual(at(g, 0, 0).value, 2048);
});

test('after winning once, later big fuses do not re-trigger justWon', () => {
  const g = makeGame([T(1, 1024, 0, 0), T(2, 1024, 0, 1)], { won: true });
  const res = g.move('left');
  assert.strictEqual(res.justWon, false);
  assert.strictEqual(g.won, true);
});

// ------------------------------------------------------------- game over

test('canMove: full board with one adjacent pair → true; none → false', () => {
  const full = NEAR_DEATH.concat([T(16, 128, 3, 3)]); // 128 above is at (1,2), not adjacent
  assert.strictEqual(makeGame(full).canMove(), false);
  const pair = NEAR_DEATH.concat([T(16, 64, 3, 3)]); // pairs with 64 at (3,2)
  assert.strictEqual(makeGame(pair).canMove(), true);
});

test('game over: move that fills the last cell with no pairs sets over', () => {
  const g = makeGame(NEAR_DEATH, { rng: rngQueue([0, 0.5]) }); // spawn a 2 at (3,0)
  const res = g.move('right'); // row 3 slides right, spawn fills the hole
  assert.strictEqual(res.moved, true);
  assert.strictEqual(res.over, true);
  assert.strictEqual(g.over, true);
  assert.strictEqual(g.emptyCells().length, 0);
});

test('moves are rejected once the game is over (undo still possible)', () => {
  const g = makeGame(NEAR_DEATH, { rng: rngQueue([0, 0.5]) });
  g.move('right');
  assert.strictEqual(g.move('left').moved, false);
  assert.strictEqual(g.undo(), true, 'undo works out of a game over');
  assert.strictEqual(g.over, false);
  assert.strictEqual(g.tiles.length, 15);
});

// ----------------------------------------------------------- persistence

test('serialize/restore roundtrip preserves tiles, score and flags', () => {
  const g = makeGame([T(3, 8, 1, 2), T(7, 16, 3, 3)], { score: 120, won: true });
  const s = g.serialize();
  const g2 = new Game(() => 0);
  g2.restore(s);
  assert.deepStrictEqual(g2.serialize(), s);
  assert.ok(g2.nextId > 7, 'nextId advances past restored ids');
});

test('load() accepts a valid {cur, prev} bundle including the undo snapshot', () => {
  const g = makeGame([T(1, 2, 0, 0), T(2, 2, 0, 1)]);
  g.move('left');
  const bundle = { cur: g.serialize(), prev: g.prev };
  const g2 = new Game(() => 0);
  assert.strictEqual(g2.load(bundle), true);
  assert.strictEqual(g2.score, g.score);
  assert.strictEqual(g2.undo(), true, 'persisted undo snapshot usable');
});

test('load() rejects corrupt saves and leaves the game untouched', () => {
  const bad = [
    null,
    {},
    { cur: { tiles: [] } }, // empty board
    { cur: { tiles: [T(1, 2, 0, 0), T(2, 2, 0, 0)] } }, // overlapping cells
    { cur: { tiles: [T(1, 2, 9, 0)] } }, // out of range
    { cur: { tiles: [T(1, 1, 0, 0)] } }, // value < 2
    { cur: { tiles: [{ id: 1, value: 2, r: 0.5, c: 0 }] } }, // non-integer
  ];
  for (const b of bad) {
    const g = new Game(() => 0);
    const snap = JSON.stringify(g.serialize());
    assert.strictEqual(g.load(b), false, 'rejects ' + JSON.stringify(b));
    assert.strictEqual(JSON.stringify(g.serialize()), snap);
  }
});

test('load() with a corrupt prev keeps cur but drops the snapshot', () => {
  const g = new Game(() => 0);
  const ok = g.load({ cur: { tiles: [T(1, 2, 0, 0)], score: 5 }, prev: { tiles: [] } });
  assert.strictEqual(ok, true);
  assert.strictEqual(g.prev, null);
});

console.log(`\nPASS — ${passed} logic tests`);

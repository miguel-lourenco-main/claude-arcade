// Reversi logic tests — plain node asserts over the pure engine.
// Run: node games/reversi/test/logic.test.js
"use strict";
var assert = require("assert");
var E = require("../src/engine.js").ReversiEngine;

var EMPTY = E.EMPTY, BLACK = E.BLACK, WHITE = E.WHITE;

var passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok - " + name);
}

function emptyBoard() { return new Int8Array(64); }

function initialBoard() {
  var b = emptyBoard();
  b[27] = WHITE; b[28] = BLACK;
  b[35] = BLACK; b[36] = WHITE;
  return b;
}

// Board used by the browser test's forced-pass scenario: after Black plays
// idx 2, White must pass while Black still has a move; after Black then
// plays idx 4, the game is over (double pass) with Black winning.
function passBoard() {
  var b = emptyBoard();
  b[0] = BLACK; b[1] = WHITE;
  b[5] = WHITE; b[6] = BLACK; b[7] = BLACK;
  return b;
}

test("initial position: Black has exactly the four standard openings", function () {
  var moves = E.legalMoves(initialBoard(), BLACK).map(function (m) { return m.idx; });
  assert.deepStrictEqual(moves.sort(function (a, b) { return a - b; }), [19, 26, 37, 44]);
});

test("computeFlips: d3 opening flips exactly the bracketed white disc", function () {
  var flips = E.computeFlips(initialBoard(), 19, BLACK);
  assert.deepStrictEqual(flips, [27]);
});

test("computeFlips: occupied or non-bracketing squares are illegal (null)", function () {
  var b = initialBoard();
  assert.strictEqual(E.computeFlips(b, 27, BLACK), null); // occupied
  assert.strictEqual(E.computeFlips(b, 0, BLACK), null);  // brackets nothing
  assert.strictEqual(E.isLegal(b, 27, BLACK), false);
  assert.strictEqual(E.isLegal(b, 0, BLACK), false);
  assert.strictEqual(E.isLegal(b, 19, BLACK), true);
});

test("computeFlips: flips every bracketed line in multiple directions at once", function () {
  // Black plays idx 18 (r2,c2): flips right line (19,20 -> 21 black),
  // down line (26 -> 34 black) and down-right diagonal (27 -> 36 black).
  var b = emptyBoard();
  b[19] = WHITE; b[20] = WHITE; b[21] = BLACK;
  b[26] = WHITE; b[34] = BLACK;
  b[27] = WHITE; b[36] = BLACK;
  var flips = E.computeFlips(b, 18, BLACK).slice().sort(function (x, y) { return x - y; });
  assert.deepStrictEqual(flips, [19, 20, 26, 27]);
});

test("computeFlips: a line ending on the board edge without an own disc does not flip", function () {
  // Row 0: B at 5, W at 6,7 — line runs off the edge, so idx 4 for black
  // gains nothing rightward and is illegal.
  var b = emptyBoard();
  b[5] = WHITE; b[6] = WHITE; b[7] = WHITE;
  b[4] = BLACK;
  assert.strictEqual(E.isLegal(b, 3, BLACK), false);
});

test("applyMove/undoMove: roundtrip restores the exact board", function () {
  var b = initialBoard();
  var before = Array.from(b);
  var flips = E.computeFlips(b, 19, BLACK);
  E.applyMove(b, 19, BLACK, flips);
  assert.strictEqual(b[19], BLACK);
  assert.strictEqual(b[27], BLACK);
  E.undoMove(b, 19, BLACK, flips);
  assert.deepStrictEqual(Array.from(b), before);
});

test("counts: tallies discs and empties", function () {
  var c = E.counts(initialBoard());
  assert.deepStrictEqual(c, { black: 2, white: 2, empty: 60 });
});

test("forced-pass scenario: after Black plays 2, White has no move but Black does", function () {
  var b = passBoard();
  var flips = E.computeFlips(b, 2, BLACK);
  assert.deepStrictEqual(flips, [1]);
  E.applyMove(b, 2, BLACK, flips);
  assert.strictEqual(E.hasMove(b, WHITE), false, "White must be forced to pass");
  assert.strictEqual(E.hasMove(b, BLACK), true, "Black must still have a move");
  assert.deepStrictEqual(E.legalMoves(b, BLACK).map(function (m) { return m.idx; }), [4]);
});

test("double-pass terminal: after Black's second move nobody can move", function () {
  var b = passBoard();
  E.applyMove(b, 2, BLACK, E.computeFlips(b, 2, BLACK));
  E.applyMove(b, 4, BLACK, E.computeFlips(b, 4, BLACK));
  assert.strictEqual(E.hasMove(b, BLACK), false);
  assert.strictEqual(E.hasMove(b, WHITE), false);
  var c = E.counts(b);
  assert.strictEqual(c.black, 7);
  assert.strictEqual(c.white, 0);
});

test("bestMoveGreedy picks the move that flips the most discs", function () {
  // Two options for black: idx 3 flips one (2), idx 20 flips three (19,18,17).
  var b = emptyBoard();
  b[1] = BLACK; b[2] = WHITE;                       // 3 flips 1 disc
  b[16] = BLACK; b[17] = WHITE; b[18] = WHITE; b[19] = WHITE; // 20 flips 3
  assert.strictEqual(E.bestMoveGreedy(b, BLACK), 20);
});

test("bestMoveGreedy returns -1 with no legal move", function () {
  assert.strictEqual(E.bestMoveGreedy(emptyBoard(), BLACK), -1);
});

test("bestMovePositional prefers a corner over a same-flip edge move", function () {
  // Black can play corner 0 (flips 1) or interior 18 (flips 17): the weight
  // table (corner=100) must choose the corner.
  var b = emptyBoard();
  b[1] = WHITE; b[2] = BLACK;
  b[17] = WHITE; b[16] = BLACK;
  b[40] = BLACK; b[41] = WHITE; // some extra material, idx 42 also legal
  assert.strictEqual(E.bestMovePositional(b, BLACK), 0);
});

test("searchDeep returns a legal move from the initial position", function () {
  var b = initialBoard();
  var res = E.searchDeep(b, BLACK, { depth: 5, exactAt: 12 });
  assert.ok([19, 26, 37, 44].indexOf(res.idx) >= 0, "move " + res.idx + " must be legal");
  assert.strictEqual(res.exact, false);
});

test("searchDeep does not mutate the board it searches", function () {
  var b = initialBoard();
  var before = Array.from(b);
  E.searchDeep(b, BLACK, { depth: 4, exactAt: 10 });
  assert.deepStrictEqual(Array.from(b), before);
});

// Near-full endgame board: everything white except black at idx 0, with the
// two corners 7 (end of row 0) and 56 (bottom of column 0) empty. Black to
// move has exactly those two (symmetric) moves; playing both in sequence
// (white must pass in between; the second corner also flips the long
// diagonal between them) ends 21-43, i.e. an exact score of -22.
function endgameBoard() {
  var b = new Int8Array(64).fill(WHITE);
  b[0] = BLACK;
  b[7] = EMPTY;
  b[56] = EMPTY;
  return b;
}

test("searchDeep exact endgame: solver engages and returns the exact score", function () {
  var b = endgameBoard();
  var res = E.searchDeep(b, BLACK, { depth: 2, exactAt: 10 });
  assert.strictEqual(res.exact, true, "2 empties <= exactAt must use the exact solver");
  assert.ok(res.idx === 7 || res.idx === 56, "must pick one of the two legal corners, got " + res.idx);
  assert.ok(E.isLegal(b, res.idx, BLACK));
  assert.strictEqual(res.score, -22, "exact final disc differential");
});

test("negamax/solveExact are exported (needed by the file:// chunked fallback)", function () {
  assert.strictEqual(typeof E.negamax, "function");
  assert.strictEqual(typeof E.solveExact, "function");
});

test("chunked-fallback root loop picks the same move as searchDeep", function () {
  // Replicates main.js searchDeepChunked's per-root-move loop synchronously
  // and checks parity with the engine's own searchDeep at equal settings.
  function chunkedPick(board, player, opts) {
    var moves = E.legalMoves(board, player);
    if (!moves.length) return -1;
    if (moves.length === 1) return moves[0].idx;
    var exact = E.counts(board).empty <= opts.exactAt;
    moves.sort(function (a, b) { return E.WEIGHTS[b.idx] - E.WEIGHTS[a.idx]; });
    var bestIdx = moves[0].idx, alpha = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      E.applyMove(board, m.idx, player, m.flips);
      var v = exact
        ? -E.solveExact(board, 3 - player, -Infinity, -alpha, false)
        : -E.negamax(board, 3 - player, opts.depth - 1, -Infinity, -alpha, false);
      E.undoMove(board, m.idx, player, m.flips);
      if (v > alpha) { alpha = v; bestIdx = m.idx; }
    }
    return bestIdx;
  }
  // Mid-game position reached by a few fixed moves.
  var b = initialBoard();
  [19, 18, 26, 20, 21].forEach(function (idx, i) {
    var p = i % 2 === 0 ? BLACK : WHITE;
    var f = E.computeFlips(b, idx, p);
    assert.ok(f, "scripted move " + idx + " must be legal");
    E.applyMove(b, idx, p, f);
  });
  var opts = { depth: 4, exactAt: 10 };
  assert.strictEqual(chunkedPick(b.slice(), WHITE, opts),
    E.searchDeep(b.slice(), WHITE, opts).idx);
  // And in exact mode on the endgame position:
  var eb = endgameBoard();
  var eopts = { depth: 2, exactAt: 10 };
  assert.strictEqual(chunkedPick(eb.slice(), BLACK, eopts),
    E.searchDeep(eb.slice(), BLACK, eopts).idx);
});

test("full game simulation: greedy vs positional terminates legally", function () {
  var b = initialBoard();
  var player = BLACK;
  var passes = 0, plies = 0;
  while (passes < 2 && plies < 200) {
    var idx = player === BLACK ? E.bestMoveGreedy(b, player) : E.bestMovePositional(b, player);
    if (idx < 0) {
      passes++;
      player = 3 - player;
      continue;
    }
    passes = 0;
    var flips = E.computeFlips(b, idx, player);
    assert.ok(flips, "AI produced an illegal move at ply " + plies);
    E.applyMove(b, idx, player, flips);
    player = 3 - player;
    plies++;
  }
  assert.ok(plies <= 60, "at most 60 discs can be placed");
  var c = E.counts(b);
  assert.strictEqual(c.black + c.white + c.empty, 64);
  assert.strictEqual(E.hasMove(b, BLACK), false);
  assert.strictEqual(E.hasMove(b, WHITE), false);
});

console.log("\nAll " + passed + " logic tests passed.");

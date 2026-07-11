// Core game-rule tests — run with: node games/chess/test/logic.test.js
// Complements perft.test.js (move-generation counts) and search.test.js (AI)
// with direct assertions on the rules the UI relies on: legal moves, castling,
// en passant, promotion, check/checkmate/stalemate, draws, undo, FEN, SAN,
// findMove, and the sliced-search stepper that backs the file:// fallback.
"use strict";
const assert = require("assert");
const E = require("../src/engine.js");
const S = require("../src/search.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
}
function moveList(pos) {
  return E.legalMoves(pos).map((m) =>
    E.algebraic(E.moveFrom(m)) + E.algebraic(E.moveTo(m)) +
    (E.movePromo(m) ? "=" + E.movePromo(m) : ""));
}

// ---- basic legality ---------------------------------------------------------
test("start position has 20 legal moves", () => {
  assert.strictEqual(E.legalMoves(E.fromFen(E.START_FEN)).length, 20);
});

test("pinned piece may not move (absolute pin)", () => {
  // Black rook e8 pins white bishop e2 against king e1: bishop has no moves
  const pos = E.fromFen("4r2k/8/8/8/8/8/4B3/4K3 w - - 0 1");
  const bishopMoves = moveList(pos).filter((m) => m.startsWith("e2"));
  assert.strictEqual(bishopMoves.length, 0, "pinned bishop must not move");
});

test("findMove resolves a move and rejects illegal ones", () => {
  const pos = E.fromFen(E.START_FEN);
  const m = E.findMove(pos, E.parseSquare("e2"), E.parseSquare("e4"), 0);
  assert.ok(m, "e2e4 should exist");
  assert.strictEqual(E.findMove(pos, E.parseSquare("e2"), E.parseSquare("e5"), 0), 0,
    "e2e5 must not exist");
});

// ---- castling ----------------------------------------------------------------
test("castling both sides when rights + empty path", () => {
  const pos = E.fromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  const ms = moveList(pos);
  assert.ok(ms.includes("e1g1"), "white O-O available");
  assert.ok(ms.includes("e1c1"), "white O-O-O available");
});

test("castling forbidden through an attacked square", () => {
  // Black rook on f8 attacks f1 — white may not castle kingside
  const pos = E.fromFen("5r1k/8/8/8/8/8/8/R3K2R w KQ - 0 1");
  const ms = moveList(pos);
  assert.ok(!ms.includes("e1g1"), "O-O through attacked f1 must be illegal");
  assert.ok(ms.includes("e1c1"), "O-O-O still legal");
});

test("castling forbidden while in check", () => {
  const pos = E.fromFen("4r2k/8/8/8/8/8/8/R3K2R w KQ - 0 1");
  assert.ok(!moveList(pos).includes("e1g1"), "may not castle out of check");
});

test("moving the rook drops that side's castling right", () => {
  const pos = E.fromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  const m = E.findMove(pos, E.parseSquare("h1"), E.parseSquare("g1"), 0);
  E.makeMove(pos, m);
  assert.ok(E.toFen(pos).includes(" Qkq "), `expected Qkq in ${E.toFen(pos)}`);
});

// ---- en passant ----------------------------------------------------------------
test("en passant capture removes the passed pawn", () => {
  // White pawn e5, black just played d7d5
  const pos = E.fromFen("rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3");
  const m = E.findMove(pos, E.parseSquare("e5"), E.parseSquare("d6"), 0);
  assert.ok(m && E.isEP(m), "exd6 e.p. must be legal");
  E.makeMove(pos, m);
  assert.strictEqual(pos.board[E.parseSquare("d5")], E.EMPTY, "captured pawn removed");
  E.unmakeMove(pos);
  assert.strictEqual(E.toFen(pos), "rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3");
});

test("en passant right expires after an unrelated move", () => {
  const pos = E.fromFen("rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3");
  E.makeMove(pos, E.findMove(pos, E.parseSquare("g1"), E.parseSquare("f3"), 0));
  E.makeMove(pos, E.findMove(pos, E.parseSquare("g8"), E.parseSquare("f6"), 0));
  assert.strictEqual(E.findMove(pos, E.parseSquare("e5"), E.parseSquare("d6"), 0), 0,
    "e.p. no longer available");
});

// ---- promotion ------------------------------------------------------------------
test("pawn on 7th generates all four promotion moves", () => {
  const pos = E.fromFen("8/P6k/8/8/8/8/8/K7 w - - 0 1");
  const promos = E.legalMoves(pos)
    .filter((m) => E.moveFrom(m) === E.parseSquare("a7") && E.movePromo(m))
    .map((m) => E.movePromo(m)).sort((a, b) => a - b);
  assert.deepStrictEqual(promos, [E.KNIGHT, E.BISHOP, E.ROOK, E.QUEEN].sort((a, b) => a - b));
});

test("promotion replaces the pawn with the chosen piece", () => {
  const pos = E.fromFen("8/P6k/8/8/8/8/8/K7 w - - 0 1");
  const m = E.findMove(pos, E.parseSquare("a7"), E.parseSquare("a8"), E.QUEEN);
  E.makeMove(pos, m);
  assert.strictEqual(pos.board[E.parseSquare("a8")], E.makePiece(E.QUEEN, E.WHITE));
});

// ---- check / mate / stalemate ------------------------------------------------------
test("check is detected", () => {
  const pos = E.fromFen("4k3/8/8/8/8/8/8/4KR2 w - - 0 1");
  E.makeMove(pos, E.findMove(pos, E.parseSquare("f1"), E.parseSquare("f8"), 0));
  const st = E.gameStatus(pos);
  assert.strictEqual(st.check, true);
  assert.strictEqual(st.over, false);
});

test("fool's mate is checkmate", () => {
  const pos = E.fromFen(E.START_FEN);
  for (const [from, to] of [["f2", "f3"], ["e7", "e5"], ["g2", "g4"], ["d8", "h4"]]) {
    E.makeMove(pos, E.findMove(pos, E.parseSquare(from), E.parseSquare(to), 0));
  }
  const st = E.gameStatus(pos);
  assert.strictEqual(st.over, true);
  assert.strictEqual(st.reason, "checkmate");
  assert.strictEqual(st.result, "0-1");
});

test("stalemate is a draw", () => {
  const st = E.gameStatus(E.fromFen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"));
  assert.strictEqual(st.over, true);
  assert.strictEqual(st.reason, "stalemate");
});

// ---- draws ---------------------------------------------------------------------------
test("insufficient material K+N vs K", () => {
  const st = E.gameStatus(E.fromFen("8/8/8/3k4/8/8/3NK3/8 w - - 0 1"));
  assert.strictEqual(st.over, true);
  assert.strictEqual(st.reason, "insufficient material");
});

test("50-move rule triggers at halfmove 100", () => {
  const st = E.gameStatus(E.fromFen("8/8/8/3k4/8/8/3RK3/8 w - - 100 80"));
  assert.strictEqual(st.over, true);
  assert.strictEqual(st.reason, "50-move rule");
});

test("threefold repetition via shuffled knights", () => {
  const pos = E.fromFen(E.START_FEN);
  const cycle = [["g1", "f3"], ["g8", "f6"], ["f3", "g1"], ["f6", "g8"]];
  for (let i = 0; i < 2; i++) {
    for (const [from, to] of cycle) {
      E.makeMove(pos, E.findMove(pos, E.parseSquare(from), E.parseSquare(to), 0));
    }
  }
  const st = E.gameStatus(pos);
  assert.strictEqual(st.over, true);
  assert.strictEqual(st.reason, "threefold repetition");
});

// ---- undo (make/unmake reversibility, the UI's Undo) ---------------------------------
test("make/unmake restores FEN and hashes through a mixed sequence", () => {
  const pos = E.fromFen("r3k2r/pPppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/P1PBBPPP/R3K2R w KQkq - 0 1");
  const fen0 = E.toFen(pos), h1 = pos.h1, h2 = pos.h2;
  const played = [];
  for (let i = 0; i < 6; i++) {
    const ms = E.legalMoves(pos);
    const m = ms[i % ms.length];
    played.push(m);
    E.makeMove(pos, m);
  }
  for (let i = 0; i < played.length; i++) E.unmakeMove(pos);
  assert.strictEqual(E.toFen(pos), fen0);
  assert.strictEqual(pos.h1, h1);
  assert.strictEqual(pos.h2, h2);
});

// ---- FEN / SAN -------------------------------------------------------------------------
test("FEN round-trips a mid-game position", () => {
  const fen = "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 5";
  assert.strictEqual(E.toFen(E.fromFen(fen)), fen);
});

test("invalid FEN is rejected", () => {
  assert.throws(() => E.fromFen("this is not a fen"));
  assert.throws(() => E.fromFen("8/8/8/8/8/8/8/8 w - - 0 1"), /king/i);
});

test("SAN: capture, check and mate suffixes", () => {
  let pos = E.fromFen("rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2");
  const cap = E.findMove(pos, E.parseSquare("e4"), E.parseSquare("d5"), 0);
  assert.strictEqual(E.san(pos, cap), "exd5");

  pos = E.fromFen("rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2");
  const mate = E.findMove(pos, E.parseSquare("d8"), E.parseSquare("h4"), 0);
  assert.strictEqual(E.san(pos, mate), "Qh4#");
});

// ---- stepper (main-thread fallback engine) -----------------------------------------------
test("stepper finds mate in 1 and matches search()", () => {
  const fen = "6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1"; // Ra8#
  const stepper = S.createStepper(E.fromFen(fen), { maxDepth: 4, timeMs: 5000 });
  let steps = 0;
  while (stepper.step(200)) steps++;
  const r = stepper.result();
  assert.ok(steps >= 1, "at least one depth iteration ran");
  assert.strictEqual(E.algebraic(E.moveFrom(r.move)) + E.algebraic(E.moveTo(r.move)), "a1a8");
  assert.ok(r.score > 90000, `mate score expected, got ${r.score}`);
  const direct = S.search(E.fromFen(fen), { maxDepth: 4, timeMs: 5000 });
  assert.strictEqual(direct.move, r.move, "stepper and search agree");
});

test("stepper slices stay within their per-step budget", () => {
  // Busy middlegame at depth 6: without slicing a step would run for seconds.
  const pos = E.fromFen("r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 5");
  const stepper = S.createStepper(pos, { maxDepth: 6, timeMs: 60000 });
  const budget = 150;
  const durations = [];
  while (true) {
    const t0 = Date.now();
    const more = stepper.step(budget);
    durations.push(Date.now() - t0);
    if (!more) break;
  }
  // checkTime polls every 2048 nodes, so allow modest overshoot. Judge slicing by the
  // typical step (p90), not the single worst one — an OS scheduling stall under load can
  // spike any one step. The hard cap still catches a real regression: an unsliced search
  // at this depth blocks for multiple seconds.
  const sorted = [...durations].sort((a, b) => a - b);
  const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
  const worst = sorted[sorted.length - 1];
  assert.ok(p90 < budget + 350, `p90 step blocked ${p90}ms (budget ${budget}ms)`);
  assert.ok(worst < 2000, `worst step blocked ${worst}ms — slicing looks broken`);
  const r = stepper.result();
  assert.ok(E.legalMoves(pos).includes(r.move), "sliced search still returns a legal move");
});

test("stepper with no legal moves reports no move", () => {
  const stepper = S.createStepper(E.fromFen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"), { maxDepth: 3, timeMs: 1000 });
  while (stepper.step(50)) { /* drain */ }
  assert.strictEqual(stepper.result().move, 0);
});

console.log(`\nALL ${passed} LOGIC TESTS PASSED`);

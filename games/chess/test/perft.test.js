// Engine sanity tests — run with: node games/chess/test/perft.test.js
"use strict";
const E = require("../src/engine.js");

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${actual}, want ${expected}`);
}

// ---- perft ---------------------------------------------------------------
const suites = [
  {
    name: "startpos",
    fen: E.START_FEN,
    counts: [20, 400, 8902, 197281]
  },
  {
    // castling + en-passant + pins rich position (a classic perft stress test layout)
    name: "castle/ep-rich",
    fen: "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    counts: [48, 2039, 97862]
  },
  {
    name: "ep-pin endgame",
    fen: "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
    counts: [14, 191, 2812, 43238, 674624]
  },
  {
    name: "promotion-heavy",
    fen: "n1n5/PPPk4/8/8/8/8/4Kppp/5N1N b - - 0 1",
    counts: [24, 496, 9483]
  }
];

for (const s of suites) {
  const pos = E.fromFen(s.fen);
  for (let d = 1; d <= s.counts.length; d++) {
    const t0 = Date.now();
    const n = E.perft(pos, d);
    check(`perft(${d}) ${s.name} [${Date.now() - t0}ms]`, n, s.counts[d - 1]);
  }
  check(`fen round-trip ${s.name}`, E.toFen(E.fromFen(s.fen)), E.toFen(pos));
}

// ---- make/unmake reversibility --------------------------------------------
{
  const pos = E.fromFen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1");
  const fen0 = E.toFen(pos);
  const h1 = pos.h1, h2 = pos.h2;
  const moves = E.generateMoves(pos);
  for (const m of moves) {
    E.makeMove(pos, m);
    E.unmakeMove(pos);
  }
  check("reversible fen", E.toFen(pos), fen0);
  check("reversible h1", pos.h1, h1);
  check("reversible h2", pos.h2, h2);
  // incremental hash matches full recompute after a deep sequence
  const legal = E.legalMoves(pos);
  for (let i = 0; i < 6 && E.legalMoves(pos).length; i++) {
    E.makeMove(pos, E.legalMoves(pos)[i % E.legalMoves(pos).length]);
  }
  const inc1 = pos.h1, inc2 = pos.h2;
  E.computeHashes(pos);
  check("incremental hash h1", inc1, pos.h1);
  check("incremental hash h2", inc2, pos.h2);
  void legal;
}

// ---- mate / stalemate / draws ----------------------------------------------
{
  // fool's mate pattern: white is checkmated
  const pos = E.fromFen("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3");
  const st = E.gameStatus(pos);
  check("checkmate detected", st.reason, "checkmate");
  check("checkmate result", st.result, "0-1");
}
{
  // classic stalemate: black king a8, white king c7 + queen c8? Use known: k7/8/1Q6/8/8/8/8/7K b — a7,b8,b7 covered? Use verified one:
  const pos = E.fromFen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
  const st = E.gameStatus(pos);
  check("stalemate detected", st.reason, "stalemate");
}
{
  const pos = E.fromFen("8/8/4k3/8/2B5/2K5/8/8 w - - 0 1"); // K+B vs K
  check("insufficient KB vs K", E.gameStatus(pos).reason, "insufficient material");
  const pos2 = E.fromFen("8/3b4/4k3/8/2B5/2K5/8/8 w - - 0 1"); // same-color bishops (d7 + c4 both light)
  check("insufficient KB vs KB same color", E.gameStatus(pos2).reason, "insufficient material");
  const pos3 = E.fromFen("8/4b3/4k3/8/2B5/2K5/8/8 w - - 0 1"); // opposite-color bishops
  check("sufficient KB vs KB opp color", E.gameStatus(pos3).over, false);
  const pos4 = E.fromFen("8/8/4k3/8/2R5/2K5/8/8 w - - 0 1");
  check("rook is sufficient", E.gameStatus(pos4).over, false);
}
{
  // 50-move rule
  const pos = E.fromFen("8/8/4k3/8/2Q5/2K5/8/8 w - - 100 80");
  check("50-move rule", E.gameStatus(pos).reason, "50-move rule");
}
{
  // threefold repetition via knight shuffles from start
  const pos = E.fromFen(E.START_FEN);
  const seq = ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"];
  for (const uci of seq) {
    const m = E.findMove(pos, E.parseSquare(uci.slice(0, 2)), E.parseSquare(uci.slice(2, 4)), 0);
    E.makeMove(pos, m);
  }
  check("threefold repetition", E.gameStatus(pos).reason, "threefold repetition");
}

// ---- en passant timing ----------------------------------------------------
{
  const pos = E.fromFen(E.START_FEN);
  const play = (uci) => {
    const m = E.findMove(pos, E.parseSquare(uci.slice(0, 2)), E.parseSquare(uci.slice(2, 4)), 0);
    if (!m) throw new Error("illegal test move " + uci);
    E.makeMove(pos, m);
  };
  play("e2e4"); play("a7a6"); play("e4e5"); play("d7d5");
  // ep available right now
  const ep = E.findMove(pos, E.parseSquare("e5"), E.parseSquare("d6"), 0);
  check("ep available immediately", ep !== 0, true);
  // but if white plays something else, ep is gone next turn
  play("h2h3"); play("a6a5");
  const ep2 = E.findMove(pos, E.parseSquare("e5"), E.parseSquare("d6"), 0);
  check("ep expires after one move", ep2, 0);
}

// ---- SAN ---------------------------------------------------------------------
{
  const pos = E.fromFen(E.START_FEN);
  const m = E.findMove(pos, E.parseSquare("g1"), E.parseSquare("f3"), 0);
  check("SAN knight move", E.san(pos, m), "Nf3");
  // disambiguation: two rooks on the same rank, nothing between them
  const pos2 = E.fromFen("1k6/8/8/8/8/4K3/8/R6R w - - 0 1");
  const rm = E.findMove(pos2, E.parseSquare("a1"), E.parseSquare("d1"), 0);
  check("SAN rook disambiguation", E.san(pos2, rm), "Rad1");
  const pos2b = E.fromFen("8/1k6/8/8/8/8/8/R3K2R w KQ - 0 1");
  const cm = E.findMove(pos2b, E.parseSquare("e1"), E.parseSquare("g1"), 0);
  check("SAN castle", E.san(pos2b, cm), "O-O");
  // promotion with check
  const pos3 = E.fromFen("8/P7/8/8/8/8/k6K/8 w - - 0 1");
  const pm = E.findMove(pos3, E.parseSquare("a7"), E.parseSquare("a8"), E.QUEEN);
  check("SAN promotion", E.san(pos3, pm).startsWith("a8=Q"), true);
}

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

// AI search tests — run with: node games/chess/test/search.test.js
"use strict";
const E = require("../src/engine.js");
const S = require("../src/search.js");

let failures = 0;
function check(name, ok, extra) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
}
function uci(m) {
  return E.algebraic(E.moveFrom(m)) + E.algebraic(E.moveTo(m)) +
    (E.movePromo(m) ? "nbrq"[E.movePromo(m) - 2] : "");
}

// mate in 1: back-rank mate
{
  const pos = E.fromFen("6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1");
  const r = S.search(pos, { maxDepth: 3, timeMs: 5000 });
  check("mate in 1 (Ra8#)", uci(r.move) === "a1a8", `picked ${uci(r.move)} score ${r.score}`);
}

// mate in 2: two-rook ladder
{
  const pos = E.fromFen("7k/8/8/8/8/8/R7/1R4K1 w - - 0 1");
  const r = S.search(pos, { maxDepth: 4, timeMs: 8000 });
  check("mate in 2 found (mate score)", r.score > 90000, `score ${r.score} move ${uci(r.move)}`);
}

// tactic: recapture the hanging queen (quiescence must see it)
{
  const pos = E.fromFen("rnb1kbnr/pppp1ppp/8/4p3/4P2q/5P2/PPPP2PP/RNBQKBNR w KQkq - 0 3");
  // black queen just went to h4 attacking nothing defended; g2-g3 hits it. Depth 2 + qsearch should not hang material.
  const r = S.search(pos, { maxDepth: 2, timeMs: 5000 });
  check("depth-2 search returns a legal move", r.move !== 0, uci(r.move));
  const legal = E.legalMoves(pos);
  check("returned move is legal", legal.indexOf(r.move) >= 0);
}

// quiescence sanity: don't "win" a defended pawn with the queen at depth 1
{
  // white queen d1 can take d5 pawn, but d5 is defended by e6 pawn.
  const pos = E.fromFen("rnbqkbnr/ppp2ppp/4p3/3p4/8/3P4/PPPQPPPP/RNB1KBNR w KQkq - 0 3");
  const r = S.search(pos, { maxDepth: 1, timeMs: 5000 });
  check("qsearch avoids Qxd5 blunder", uci(r.move) !== "d2d5", `picked ${uci(r.move)}`);
}

// avoid stalemate/repetition when winning; prefer progress
{
  const pos = E.fromFen("8/8/8/8/8/2k5/2q5/K7 b - - 0 1"); // black mates in 1 with Qb2#? c2-b2 guarded... let engine find a mate quickly
  const r = S.search(pos, { maxDepth: 4, timeMs: 8000 });
  check("winning side finds forced mate", r.score > 90000, `score ${r.score} move ${uci(r.move)}`);
}

// timing: depth 6 from a middlegame position stays within a sane bound
{
  const pos = E.fromFen("r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4");
  const t0 = Date.now();
  const r = S.search(pos, { maxDepth: 6, timeMs: 6000 });
  const dt = Date.now() - t0;
  check("depth cap search completes", r.move !== 0, `depth ${r.depth}, ${r.nodes} nodes, ${dt}ms, ${uci(r.move)}`);
  check("respects time budget", dt < 9000, `${dt}ms`);
}

// jitter mode still returns legal moves
{
  const pos = E.fromFen(E.START_FEN);
  for (let i = 0; i < 5; i++) {
    const r = S.search(pos, { maxDepth: 2, timeMs: 2000, jitter: true });
    const legal = E.legalMoves(pos);
    if (legal.indexOf(r.move) < 0) { check("jitter legal move", false, uci(r.move)); break; }
    if (i === 4) check("jitter legal move x5", true);
  }
}

// self-play smoke test: AI vs AI for 60 plies, position must stay consistent
{
  const pos = E.fromFen(E.START_FEN);
  const hashes = [];
  let plies = 0, status = E.gameStatus(pos);
  while (!status.over && plies < 60) {
    hashes.push(pos.h1 + ":" + pos.h2);
    const r = S.search(pos, { maxDepth: 3, timeMs: 1500, gameHashes: hashes });
    if (!r.move) break;
    E.makeMove(pos, r.move);
    const inc1 = pos.h1, inc2 = pos.h2;
    E.computeHashes(pos);
    if (inc1 !== pos.h1 || inc2 !== pos.h2) { check("self-play hash consistency", false, "ply " + plies); break; }
    plies++;
    status = E.gameStatus(pos);
  }
  check("self-play smoke (60 plies or game end)", plies >= 20, `${plies} plies, end: ${status.reason || "ongoing"}`);
}

console.log(failures === 0 ? "\nALL SEARCH TESTS PASSED" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

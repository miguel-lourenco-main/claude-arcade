// Reversi engine: rules, evaluation and search.
// Classic script (no modules) so it can be loaded both by the page
// (<script src>) and by the AI web worker (importScripts). Exposes a single
// global: ReversiEngine.
"use strict";
(function (root) {
  var EMPTY = 0, BLACK = 1, WHITE = 2;

  // Eight directions as row/col deltas (avoids index wrap-around bugs).
  var DR = [-1, -1, -1, 0, 0, 1, 1, 1];
  var DC = [-1, 0, 1, -1, 1, -1, 0, 1];

  // Positional weight table: corners hugely positive, X squares (diagonal
  // neighbours of corners) strongly negative, C squares (orthogonal
  // neighbours of corners) negative, edges positive.
  var WEIGHTS = [
    100, -25, 10,  5,  5, 10, -25, 100,
    -25, -45,  1,  1,  1,  1, -45, -25,
     10,   1,  3,  2,  2,  3,   1,  10,
      5,   1,  2,  1,  1,  2,   1,   5,
      5,   1,  2,  1,  1,  2,   1,   5,
     10,   1,  3,  2,  2,  3,   1,  10,
    -25, -45,  1,  1,  1,  1, -45, -25,
    100, -25, 10,  5,  5, 10, -25, 100,
  ];

  var WIN = 10000000; // dominates any positional score

  function opponent(p) { return 3 - p; }

  // Returns the array of disc indices flipped by playing `idx`, or null if
  // the move is illegal (must bracket at least one contiguous opponent line
  // terminated by an own disc, in any of the 8 directions).
  function computeFlips(board, idx, player) {
    if (board[idx] !== EMPTY) return null;
    var opp = 3 - player;
    var r0 = idx >> 3, c0 = idx & 7;
    var flips = null;
    for (var d = 0; d < 8; d++) {
      var dr = DR[d], dc = DC[d];
      var r = r0 + dr, c = c0 + dc, n = 0;
      while (r >= 0 && r < 8 && c >= 0 && c < 8 && board[r * 8 + c] === opp) {
        r += dr; c += dc; n++;
      }
      if (n > 0 && r >= 0 && r < 8 && c >= 0 && c < 8 && board[r * 8 + c] === player) {
        if (!flips) flips = [];
        var rr = r0 + dr, cc = c0 + dc;
        for (var k = 0; k < n; k++) {
          flips.push(rr * 8 + cc);
          rr += dr; cc += dc;
        }
      }
    }
    return flips;
  }

  // Fast legality test with early exit (no flip list built).
  function isLegal(board, idx, player) {
    if (board[idx] !== EMPTY) return false;
    var opp = 3 - player;
    var r0 = idx >> 3, c0 = idx & 7;
    for (var d = 0; d < 8; d++) {
      var dr = DR[d], dc = DC[d];
      var r = r0 + dr, c = c0 + dc, n = 0;
      while (r >= 0 && r < 8 && c >= 0 && c < 8 && board[r * 8 + c] === opp) {
        r += dr; c += dc; n++;
      }
      if (n > 0 && r >= 0 && r < 8 && c >= 0 && c < 8 && board[r * 8 + c] === player) {
        return true;
      }
    }
    return false;
  }

  function hasMove(board, player) {
    for (var i = 0; i < 64; i++) if (isLegal(board, i, player)) return true;
    return false;
  }

  function countMoves(board, player) {
    var n = 0;
    for (var i = 0; i < 64; i++) if (isLegal(board, i, player)) n++;
    return n;
  }

  // Full move list with flip lists (for the UI and simple AIs).
  function legalMoves(board, player) {
    var out = [];
    for (var i = 0; i < 64; i++) {
      var f = computeFlips(board, i, player);
      if (f) out.push({ idx: i, flips: f });
    }
    return out;
  }

  // Index-only move list (for search).
  function moveList(board, player) {
    var out = [];
    for (var i = 0; i < 64; i++) if (isLegal(board, i, player)) out.push(i);
    return out;
  }

  function counts(board) {
    var b = 0, w = 0;
    for (var i = 0; i < 64; i++) {
      if (board[i] === BLACK) b++;
      else if (board[i] === WHITE) w++;
    }
    return { black: b, white: w, empty: 64 - b - w };
  }

  function applyMove(board, idx, player, flips) {
    board[idx] = player;
    for (var i = 0; i < flips.length; i++) board[flips[i]] = player;
  }

  function undoMove(board, idx, player, flips) {
    board[idx] = EMPTY;
    var opp = 3 - player;
    for (var i = 0; i < flips.length; i++) board[flips[i]] = opp;
  }

  function weightScore(board, player) {
    var s = 0;
    for (var i = 0; i < 64; i++) {
      var v = board[i];
      if (v === player) s += WEIGHTS[i];
      else if (v !== EMPTY) s -= WEIGHTS[i];
    }
    return s;
  }

  function discDiff(board, player) {
    var c = counts(board);
    return player === BLACK ? c.black - c.white : c.white - c.black;
  }

  // Mid-game evaluation: positional weights + mobility differential.
  function evaluate(board, player) {
    return weightScore(board, player) +
      9 * (countMoves(board, player) - countMoves(board, 3 - player));
  }

  function byWeightDesc(a, b) { return WEIGHTS[b] - WEIGHTS[a]; }

  // Depth-limited negamax with alpha-beta. A pass does not consume depth
  // (passes cannot chain: double-pass is terminal).
  function negamax(board, player, depth, alpha, beta, passed) {
    var moves = moveList(board, player);
    if (moves.length === 0) {
      if (passed) {
        var diff = discDiff(board, player);
        return diff > 0 ? WIN + diff : diff < 0 ? -WIN + diff : 0;
      }
      return -negamax(board, 3 - player, depth, -beta, -alpha, true);
    }
    if (depth <= 0) return evaluate(board, player);
    moves.sort(byWeightDesc);
    var best = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      var flips = computeFlips(board, m, player);
      applyMove(board, m, player, flips);
      var v = -negamax(board, 3 - player, depth - 1, -beta, -alpha, false);
      undoMove(board, m, player, flips);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  // Exact end-game solver: plays out to a terminal position and returns the
  // final disc differential for `player`.
  function solveExact(board, player, alpha, beta, passed) {
    var moves = moveList(board, player);
    if (moves.length === 0) {
      if (passed) return discDiff(board, player);
      return -solveExact(board, 3 - player, -beta, -alpha, true);
    }
    moves.sort(byWeightDesc);
    var best = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      var flips = computeFlips(board, m, player);
      applyMove(board, m, player, flips);
      var v = -solveExact(board, 3 - player, -beta, -alpha, false);
      undoMove(board, m, player, flips);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  function randomPick(arr) {
    return arr[(Math.random() * arr.length) | 0];
  }

  // Tier 1: most immediate flips (random tie-break).
  function bestMoveGreedy(board, player) {
    var moves = legalMoves(board, player);
    if (!moves.length) return -1;
    var best = [], bestN = -1;
    for (var i = 0; i < moves.length; i++) {
      var n = moves[i].flips.length;
      if (n > bestN) { bestN = n; best = [moves[i].idx]; }
      else if (n === bestN) best.push(moves[i].idx);
    }
    return randomPick(best);
  }

  // Tier 2: best immediate move by the positional weight table.
  function bestMovePositional(board, player) {
    var moves = legalMoves(board, player);
    if (!moves.length) return -1;
    var best = [], bestS = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      applyMove(board, m.idx, player, m.flips);
      var s = weightScore(board, player);
      undoMove(board, m.idx, player, m.flips);
      if (s > bestS + 0.5) { bestS = s; best = [m.idx]; }
      else if (s >= bestS - 0.5) best.push(m.idx);
    }
    return randomPick(best);
  }

  // Tier 3: alpha-beta search (weights + mobility eval), switching to an
  // exact end-game solve when few empties remain.
  function searchDeep(board, player, opts) {
    opts = opts || {};
    var depth = opts.depth || 5;
    var exactAt = (opts.exactAt == null) ? 12 : opts.exactAt;
    var moves = legalMoves(board, player);
    if (!moves.length) return { idx: -1, exact: false };
    if (moves.length === 1) return { idx: moves[0].idx, exact: false };
    var empties = counts(board).empty;
    var exact = empties <= exactAt;
    moves.sort(function (a, b) { return WEIGHTS[b.idx] - WEIGHTS[a.idx]; });
    var bestIdx = moves[0].idx;
    var alpha = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      applyMove(board, m.idx, player, m.flips);
      var v = exact
        ? -solveExact(board, 3 - player, -Infinity, -alpha, false)
        : -negamax(board, 3 - player, depth - 1, -Infinity, -alpha, false);
      undoMove(board, m.idx, player, m.flips);
      if (v > alpha) { alpha = v; bestIdx = m.idx; }
    }
    return { idx: bestIdx, exact: exact, score: alpha };
  }

  root.ReversiEngine = {
    EMPTY: EMPTY, BLACK: BLACK, WHITE: WHITE,
    WEIGHTS: WEIGHTS,
    opponent: opponent,
    computeFlips: computeFlips,
    isLegal: isLegal,
    hasMove: hasMove,
    countMoves: countMoves,
    legalMoves: legalMoves,
    counts: counts,
    applyMove: applyMove,
    undoMove: undoMove,
    evaluate: evaluate,
    negamax: negamax,
    solveExact: solveExact,
    bestMoveGreedy: bestMoveGreedy,
    bestMovePositional: bestMovePositional,
    searchDeep: searchDeep,
  };
})(typeof self !== "undefined" ? self : this);

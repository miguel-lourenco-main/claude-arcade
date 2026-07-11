/*
 * search.js — the AI. Iterative-deepening negamax with alpha-beta pruning,
 * a transposition table, MVV-LVA + killer + history move ordering, and a
 * quiescence search over captures/promotions at the horizon.
 *
 * Evaluation: material + piece-square tables (with a tapered king table for
 * the endgame) + a small mobility term + a small pawn-shield king-safety term.
 *
 * Depends on ChessEngine (engine.js). Runs in browser, worker, and node.
 */
(function (global) {
  "use strict";
  var E = global.ChessEngine || (typeof require !== "undefined" ? require("./engine.js") : null);

  var PAWN = E.PAWN, KNIGHT = E.KNIGHT, BISHOP = E.BISHOP,
      ROOK = E.ROOK, QUEEN = E.QUEEN, KING = E.KING,
      WHITE = E.WHITE, EMPTY = E.EMPTY;

  var MATE = 100000, MATE_FLOOR = 90000;
  var VALUE = [0, 100, 320, 330, 500, 900, 20000];

  // ---- piece-square tables (from White's point of view, index 0 = a1) -------
  // Written rank 8 first for readability, then flipped once at load.
  function flip(t) {
    var out = new Int16Array(64);
    for (var r = 0; r < 8; r++) for (var f = 0; f < 8; f++) out[(7 - r) * 8 + f] = t[r * 8 + f];
    return out;
  }
  var PST_PAWN = flip([
      0,  0,  0,  0,  0,  0,  0,  0,
     55, 55, 55, 55, 55, 55, 55, 55,
     12, 14, 22, 32, 32, 22, 14, 12,
      6,  8, 12, 26, 26, 12,  8,  6,
      2,  4,  8, 22, 22,  8,  4,  2,
      3, -2,  0,  6,  6,  0, -2,  3,
      4,  8,  8,-18,-18,  8,  8,  4,
      0,  0,  0,  0,  0,  0,  0,  0
  ]);
  var PST_KNIGHT = flip([
    -48,-36,-28,-28,-28,-28,-36,-48,
    -36,-18,  0,  0,  0,  0,-18,-36,
    -28,  0, 12, 16, 16, 12,  0,-28,
    -28,  4, 16, 22, 22, 16,  4,-28,
    -28,  0, 16, 22, 22, 16,  0,-28,
    -28,  4, 12, 16, 16, 12,  4,-28,
    -36,-18,  0,  4,  4,  0,-18,-36,
    -48,-30,-28,-28,-28,-28,-30,-48
  ]);
  var PST_BISHOP = flip([
    -18, -8, -8, -8, -8, -8, -8,-18,
     -8,  0,  0,  0,  0,  0,  0, -8,
     -8,  0,  6, 10, 10,  6,  0, -8,
     -8,  4,  6, 10, 10,  6,  4, -8,
     -8,  0, 10, 10, 10, 10,  0, -8,
     -8,  8,  8, 10, 10,  8,  8, -8,
     -8, 12,  0,  0,  0,  0, 12, -8,
    -18, -8,-12, -8, -8,-12, -8,-18
  ]);
  var PST_ROOK = flip([
      0,  0,  0,  0,  0,  0,  0,  0,
      6, 12, 12, 12, 12, 12, 12,  6,
     -6,  0,  0,  0,  0,  0,  0, -6,
     -6,  0,  0,  0,  0,  0,  0, -6,
     -6,  0,  0,  0,  0,  0,  0, -6,
     -6,  0,  0,  0,  0,  0,  0, -6,
     -6,  0,  0,  0,  0,  0,  0, -6,
      0,  0,  0,  5,  5,  0,  0,  0
  ]);
  var PST_QUEEN = flip([
    -24,-12,-12, -6, -6,-12,-12,-24,
    -12,  0,  0,  0,  0,  0,  0,-12,
    -12,  0,  6,  6,  6,  6,  0,-12,
     -6,  0,  6,  6,  6,  6,  0, -6,
      0,  0,  6,  6,  6,  6,  0, -6,
    -12,  6,  6,  6,  6,  6,  0,-12,
    -12,  0,  6,  0,  0,  0,  0,-12,
    -24,-12,-12, -6, -6,-12,-12,-24
  ]);
  var PST_KING_MG = flip([
    -36,-48,-48,-60,-60,-48,-48,-36,
    -36,-48,-48,-60,-60,-48,-48,-36,
    -36,-48,-48,-60,-60,-48,-48,-36,
    -36,-48,-48,-60,-60,-48,-48,-36,
    -24,-36,-36,-48,-48,-36,-36,-24,
    -12,-24,-24,-24,-24,-24,-24,-12,
     24, 24,  0,  0,  0,  0, 24, 24,
     24, 36, 12,  0,  0, 12, 36, 24
  ]);
  var PST_KING_EG = flip([
    -60,-48,-36,-24,-24,-36,-48,-60,
    -36,-24,-12,  0,  0,-12,-24,-36,
    -36,-12, 24, 36, 36, 24,-12,-36,
    -36,-12, 36, 48, 48, 36,-12,-36,
    -36,-12, 36, 48, 48, 36,-12,-36,
    -36,-12, 24, 36, 36, 24,-12,-36,
    -36,-36,  0,  0,  0,  0,-36,-36,
    -60,-36,-36,-36,-36,-36,-36,-60
  ]);
  var PST = [null, PST_PAWN, PST_KNIGHT, PST_BISHOP, PST_ROOK, PST_QUEEN, null];

  var KNIGHT_OFFS = [31, 33, 14, 18, -31, -33, -14, -18];
  var BISHOP_OFFS = [15, 17, -15, -17];
  var ROOK_OFFS = [1, -1, 16, -16];

  function pstIndex(sq0x88, color) {
    var f = sq0x88 & 7, r = sq0x88 >> 4;
    return color === WHITE ? r * 8 + f : (7 - r) * 8 + f;
  }

  // ---- evaluation (from the side-to-move's perspective) -----------------------
  function evaluate(pos) {
    var b = pos.board;
    var score = 0;           // white - black
    var phase = 0;           // non-pawn material, for the king table taper
    var mobility = 0;
    var s, p, t, c, i, d, to;

    for (s = 0; s < 128; s++) {
      if (s & 0x88) continue;
      p = b[s];
      if (p === EMPTY) continue;
      t = p & 7; c = p >> 3;
      var sign = c === WHITE ? 1 : -1;
      if (t !== KING) {
        score += sign * VALUE[t];
        score += sign * PST[t][pstIndex(s, c)];
        if (t !== PAWN) phase += VALUE[t];
      }
      // small mobility term for minor/major pieces
      if (t === KNIGHT) {
        var nmob = 0;
        for (i = 0; i < 8; i++) {
          to = s + KNIGHT_OFFS[i];
          if ((to & 0x88) === 0 && (b[to] === EMPTY || (b[to] >> 3) !== c)) nmob++;
        }
        mobility += sign * 3 * (nmob - 4);
      } else if (t === QUEEN) {
        var qmob = rayMob(b, s, c, BISHOP_OFFS) + rayMob(b, s, c, ROOK_OFFS);
        mobility += sign * (qmob - 14);
      } else if (t === BISHOP || t === ROOK) {
        var smob = rayMob(b, s, c, t === BISHOP ? BISHOP_OFFS : ROOK_OFFS);
        mobility += sign * (t === BISHOP ? 3 : 2) * (smob - (t === BISHOP ? 6 : 7));
      }
    }

    // king placement: taper between middlegame and endgame tables
    var egWeight = Math.max(0, Math.min(1, 1 - phase / 3200));
    for (c = 0; c < 2; c++) {
      var ks = pos.kingSq[c];
      var idx = pstIndex(ks, c);
      var kScore = PST_KING_MG[idx] * (1 - egWeight) + PST_KING_EG[idx] * egWeight;
      score += (c === WHITE ? 1 : -1) * (kScore | 0);
    }

    // king safety: pawn shield in front of the king (middlegame only)
    if (egWeight < 0.7) {
      for (c = 0; c < 2; c++) {
        var kf = pos.kingSq[c] & 7, kr = pos.kingSq[c] >> 4;
        var ahead = c === WHITE ? kr + 1 : kr - 1;
        if (ahead >= 0 && ahead <= 7) {
          var shield = 0;
          for (d = -1; d <= 1; d++) {
            var f2 = kf + d;
            if (f2 < 0 || f2 > 7) continue;
            var ss = ahead * 16 + f2;
            if (b[ss] === ((PAWN) | (c << 3))) shield += 8;
          }
          score += (c === WHITE ? 1 : -1) * shield;
        }
      }
    }

    score += mobility;
    return pos.side === WHITE ? score : -score;
  }

  function rayMob(b, s, c, offs) {
    var count = 0;
    for (var i = 0; i < offs.length; i++) {
      var to = s + offs[i];
      while ((to & 0x88) === 0) {
        if (b[to] === EMPTY) { count++; to += offs[i]; continue; }
        if ((b[to] >> 3) !== c) count++;
        break;
      }
    }
    return count;
  }

  // ---- search ---------------------------------------------------------------
  function AbortSearch() {}

  function Searcher(pos, opts) {
    this.pos = pos;
    this.maxDepth = opts.maxDepth || 4;
    this.timeMs = opts.timeMs || 60000;
    this.startTime = Date.now();
    this.nodes = 0;
    this.tt = new Map();                 // lo-hash -> {hi, depth, flag, score, move}
    this.killers = [];                   // [ply][2]
    this.history = new Int32Array(128 * 128);
    this.pathHashes = [];                // hashes along the current search path
    this.gameHashes = opts.gameHashes || [];   // "h1:h2" strings of prior game states
    this.onInfo = opts.onInfo || null;
    for (var i = 0; i < 64; i++) this.killers.push([0, 0]);
  }

  var TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;

  Searcher.prototype.checkTime = function () {
    if ((this.nodes & 2047) === 0 && Date.now() - this.startTime > this.timeMs) {
      throw new AbortSearch();
    }
  };

  Searcher.prototype.isRepetition = function () {
    var pos = this.pos;
    var key = pos.h1 + ":" + pos.h2;
    for (var i = this.pathHashes.length - 2; i >= 0; i--) {
      if (this.pathHashes[i] === key) return true;
    }
    for (var j = 0; j < this.gameHashes.length; j++) {
      if (this.gameHashes[j] === key) return true;
    }
    return false;
  };

  // MVV-LVA + promo bonus for capture ordering
  function captureScore(pos, m) {
    var victim = E.moveCaptured(m);
    var attacker = pos.board[E.moveFrom(m)] & 7;
    var s = victim * 100 - attacker;
    if (E.movePromo(m)) s += E.movePromo(m) * 100;
    return s;
  }

  Searcher.prototype.orderMoves = function (moves, ttMove, ply) {
    var pos = this.pos, self = this;
    var scored = moves.map(function (m) {
      var s;
      if (m === ttMove) s = 10000000;
      else if (E.isCapture(m) || E.movePromo(m)) s = 1000000 + captureScore(pos, m);
      else if (m === self.killers[ply][0]) s = 900000;
      else if (m === self.killers[ply][1]) s = 800000;
      else s = self.history[(E.moveFrom(m) << 7) | E.moveTo(m)] || 0;
      return { m: m, s: s };
    });
    scored.sort(function (a, b) { return b.s - a.s; });
    return scored.map(function (x) { return x.m; });
  };

  Searcher.prototype.quiescence = function (alpha, beta) {
    this.nodes++;
    this.checkTime();
    var pos = this.pos;
    var stand = evaluate(pos);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;

    var moves = E.generateCaptures(pos);
    var self = this;
    moves.sort(function (a, b) { return captureScore(pos, b) - captureScore(pos, a); });
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      // delta pruning: skip captures that cannot possibly raise alpha
      if (!E.movePromo(m) && stand + VALUE[E.moveCaptured(m)] + 200 < alpha) continue;
      E.makeMove(pos, m);
      if (E.leftInCheck(pos)) { E.unmakeMove(pos); continue; }
      var score = -self.quiescence(-beta, -alpha);
      E.unmakeMove(pos);
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  };

  Searcher.prototype.negamax = function (depth, alpha, beta, ply) {
    this.nodes++;
    this.checkTime();
    var pos = this.pos;

    if (ply > 0 && (this.isRepetition() || pos.halfmove >= 100)) return 0;

    var inChk = E.inCheck(pos);
    if (inChk) depth++; // check extension

    if (depth <= 0) return this.quiescence(alpha, beta);

    var alphaOrig = alpha;
    var key = pos.h1;
    var entry = this.tt.get(key);
    var ttMove = 0;
    if (entry && entry.hi === pos.h2) {
      ttMove = entry.move;
      if (entry.depth >= depth && ply > 0) {
        var es = entry.score;
        // un-adjust mate scores stored relative to root
        if (es > MATE_FLOOR) es -= ply;
        else if (es < -MATE_FLOOR) es += ply;
        if (entry.flag === TT_EXACT) return es;
        if (entry.flag === TT_LOWER && es > alpha) alpha = es;
        else if (entry.flag === TT_UPPER && es < beta) beta = es;
        if (alpha >= beta) return es;
      }
    }

    var moves = this.orderMoves(E.generateMoves(pos), ttMove, ply);
    var best = -Infinity, bestMove = 0, legalCount = 0;

    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      E.makeMove(pos, m);
      if (E.leftInCheck(pos)) { E.unmakeMove(pos); continue; }
      legalCount++;
      this.pathHashes.push(pos.h1 + ":" + pos.h2);
      var score;
      try {
        score = -this.negamax(depth - 1, -beta, -alpha, ply + 1);
      } finally {
        this.pathHashes.pop();
        E.unmakeMove(pos);
      }
      if (score > best) {
        best = score;
        bestMove = m;
        if (score > alpha) {
          alpha = score;
          if (alpha >= beta) {
            if (!E.isCapture(m) && !E.movePromo(m)) {
              if (this.killers[ply][0] !== m) {
                this.killers[ply][1] = this.killers[ply][0];
                this.killers[ply][0] = m;
              }
              this.history[(E.moveFrom(m) << 7) | E.moveTo(m)] += depth * depth;
            }
            break;
          }
        }
      }
    }

    if (legalCount === 0) {
      return inChk ? -(MATE - ply) : 0; // checkmate / stalemate
    }

    // store in TT (mate scores stored relative to root)
    var stored = best;
    if (stored > MATE_FLOOR) stored += ply;
    else if (stored < -MATE_FLOOR) stored -= ply;
    var flag = best <= alphaOrig ? TT_UPPER : (best >= beta ? TT_LOWER : TT_EXACT);
    if (this.tt.size > 400000) this.tt.clear();
    this.tt.set(key, { hi: pos.h2, depth: depth, flag: flag, score: stored, move: bestMove });
    return best;
  };

  // Root search with iterative deepening.
  // opts: {maxDepth, timeMs, jitter, gameHashes, onInfo}
  function search(pos, opts) {
    var searcher = new Searcher(pos, opts);
    var legal = E.legalMoves(pos);
    if (legal.length === 0) return { move: 0, score: 0, depth: 0, nodes: 0 };
    if (legal.length === 1 && !opts.jitter) {
      return { move: legal[0], score: 0, depth: 0, nodes: 1 };
    }

    var bestMove = legal[0], bestScore = -Infinity, completedDepth = 0;
    var rootScores = null;

    for (var depth = 1; depth <= searcher.maxDepth; depth++) {
      var iterBest = 0, iterScore = -Infinity;
      var iterScores = [];
      var alpha = -Infinity, beta = Infinity;
      var ordered = searcher.orderMoves(legal, bestMove, 0);
      try {
        for (var i = 0; i < ordered.length; i++) {
          var m = ordered[i];
          E.makeMove(pos, m);
          searcher.pathHashes.push(pos.h1 + ":" + pos.h2);
          var score;
          try {
            score = -searcher.negamax(depth - 1, -beta, -alpha, 1);
          } finally {
            searcher.pathHashes.pop();
            E.unmakeMove(pos);
          }
          iterScores.push({ move: m, score: score });
          if (score > iterScore) {
            iterScore = score;
            iterBest = m;
            if (score > alpha) alpha = score;
          }
        }
      } catch (e) {
        if (e instanceof AbortSearch) break;
        throw e;
      }
      bestMove = iterBest;
      bestScore = iterScore;
      completedDepth = depth;
      rootScores = iterScores;
      if (searcher.onInfo) {
        searcher.onInfo({ depth: depth, score: bestScore, nodes: searcher.nodes });
      }
      // found a forced mate — no point going deeper
      if (bestScore > MATE_FLOOR || bestScore < -MATE_FLOOR) break;
      // don't start an iteration we probably can't finish
      if (Date.now() - searcher.startTime > searcher.timeMs * 0.5) break;
    }

    // easy-level jitter: pick randomly among moves within a window of the best
    if (opts.jitter && rootScores && rootScores.length > 1) {
      var window = 60;
      var pool = rootScores.filter(function (rs) { return rs.score >= bestScore - window; });
      if (pool.length > 1) {
        var pick = pool[Math.floor(Math.random() * pool.length)];
        bestMove = pick.move;
        bestScore = pick.score;
      }
    }

    return { move: bestMove, score: bestScore, depth: completedDepth, nodes: searcher.nodes };
  }

  var ChessSearch = { search: search, evaluate: evaluate, MATE: MATE };
  global.ChessSearch = ChessSearch;
  if (typeof module !== "undefined" && module.exports) module.exports = ChessSearch;
})(typeof self !== "undefined" ? self : globalThis);

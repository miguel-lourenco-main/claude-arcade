/*
 * engine.js — pure chess logic. No DOM, no timers; runs in browser, worker, and node.
 *
 * Board: 0x88 mailbox (Int8Array of 128). sq = rank*16 + file, rank 0 = rank "1".
 * Moves: packed integers (see encode/decode below).
 * Hashing: dual 32-bit Zobrist keys (h1,h2) over placement + side + castling + ep file.
 * make/unmake is exactly reversible: castling rights, ep square, halfmove clock and
 * both hashes are saved on a history stack and restored on unmake.
 */
(function (global) {
  "use strict";

  // ---- piece constants -------------------------------------------------
  var EMPTY = 0, PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
  var WHITE = 0, BLACK = 1;

  function makePiece(type, color) { return type | (color << 3); }
  function typeOf(p) { return p & 7; }
  function colorOf(p) { return p >> 3; }

  // castling right bits
  var CR_WK = 1, CR_WQ = 2, CR_BK = 4, CR_BQ = 8;

  // squares (0x88)
  function sq(file, rank) { return rank * 16 + file; }
  function fileOf(s) { return s & 7; }
  function rankOf(s) { return s >> 4; }
  function onBoard(s) { return (s & 0x88) === 0; }
  function algebraic(s) {
    return "abcdefgh"[fileOf(s)] + (rankOf(s) + 1);
  }
  function parseSquare(str) {
    if (!str || str.length < 2) return -1;
    var f = str.charCodeAt(0) - 97, r = str.charCodeAt(1) - 49;
    if (f < 0 || f > 7 || r < 0 || r > 7) return -1;
    return sq(f, r);
  }

  // ---- move encoding ----------------------------------------------------
  // bits 0-6 from | 7-13 to | 14-16 promo type | 17-19 captured type | 20+ flags
  var F_EP = 1 << 20, F_DOUBLE = 1 << 21, F_CASTLE = 1 << 22;

  function encodeMove(from, to, promo, captured, flags) {
    return from | (to << 7) | ((promo || 0) << 14) | ((captured || 0) << 17) | (flags || 0);
  }
  function moveFrom(m) { return m & 127; }
  function moveTo(m) { return (m >> 7) & 127; }
  function movePromo(m) { return (m >> 14) & 7; }
  function moveCaptured(m) { return (m >> 17) & 7; }
  function isEP(m) { return (m & F_EP) !== 0; }
  function isDouble(m) { return (m & F_DOUBLE) !== 0; }
  function isCastle(m) { return (m & F_CASTLE) !== 0; }
  function isCapture(m) { return moveCaptured(m) !== 0; }

  // ---- movement offsets ---------------------------------------------------
  var KNIGHT_OFFS = [31, 33, 14, 18, -31, -33, -14, -18];
  var BISHOP_OFFS = [15, 17, -15, -17];
  var ROOK_OFFS = [1, -1, 16, -16];
  var KING_OFFS = [1, -1, 16, -16, 15, 17, -15, -17];

  // castling-rights mask: rights &= mask[from] & mask[to]
  var CASTLE_MASK = new Int8Array(128).fill(15);
  CASTLE_MASK[sq(4, 0)] = 15 & ~(CR_WK | CR_WQ); // e1
  CASTLE_MASK[sq(0, 0)] = 15 & ~CR_WQ;           // a1
  CASTLE_MASK[sq(7, 0)] = 15 & ~CR_WK;           // h1
  CASTLE_MASK[sq(4, 7)] = 15 & ~(CR_BK | CR_BQ); // e8
  CASTLE_MASK[sq(0, 7)] = 15 & ~CR_BQ;           // a8
  CASTLE_MASK[sq(7, 7)] = 15 & ~CR_BK;           // h8

  // ---- zobrist ------------------------------------------------------------
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (t ^ (t >>> 14)) >>> 0;
    };
  }
  function makeZobrist(seed) {
    var rnd = mulberry32(seed);
    var z = { pieces: [], side: rnd(), castle: [], epFile: [] };
    for (var p = 0; p < 16; p++) {
      var row = new Uint32Array(128);
      for (var s = 0; s < 128; s++) row[s] = rnd();
      z.pieces.push(row);
    }
    for (var c = 0; c < 16; c++) z.castle.push(rnd());
    for (var f = 0; f < 8; f++) z.epFile.push(rnd());
    return z;
  }
  var Z1 = makeZobrist(0x9e3779b9);
  var Z2 = makeZobrist(0x7f4a7c15);

  // ---- position -------------------------------------------------------------
  var START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  function Position() {
    this.board = new Int8Array(128);
    this.side = WHITE;
    this.castling = 0;
    this.ep = -1;            // 0x88 square or -1
    this.halfmove = 0;
    this.fullmove = 1;
    this.kingSq = [-1, -1];
    this.h1 = 0;
    this.h2 = 0;
    this.hist = [];          // undo stack
  }

  function computeHashes(pos) {
    var h1 = 0, h2 = 0;
    for (var s = 0; s < 128; s++) {
      if ((s & 0x88) || pos.board[s] === EMPTY) continue;
      h1 ^= Z1.pieces[pos.board[s]][s];
      h2 ^= Z2.pieces[pos.board[s]][s];
    }
    if (pos.side === BLACK) { h1 ^= Z1.side; h2 ^= Z2.side; }
    h1 ^= Z1.castle[pos.castling]; h2 ^= Z2.castle[pos.castling];
    if (pos.ep >= 0) { h1 ^= Z1.epFile[fileOf(pos.ep)]; h2 ^= Z2.epFile[fileOf(pos.ep)]; }
    pos.h1 = h1 >>> 0;
    pos.h2 = h2 >>> 0;
  }

  // Only keep an ep square when an enemy pawn stands ready to capture —
  // keeps repetition hashing honest and matches move generation.
  function epRelevant(pos, epSq) {
    if (epSq < 0) return false;
    var mover = pos.side; // the side that could capture next
    var pawn = makePiece(PAWN, mover);
    var back = mover === WHITE ? -16 : 16;
    var a = epSq + back - 1, b = epSq + back + 1;
    return (onBoard(a) && pos.board[a] === pawn) || (onBoard(b) && pos.board[b] === pawn);
  }

  function fromFen(fen) {
    var pos = new Position();
    var parts = fen.trim().split(/\s+/);
    if (parts.length < 2) throw new Error("bad FEN: need placement and side");
    var rows = parts[0].split("/");
    if (rows.length !== 8) throw new Error("bad FEN: need 8 ranks");
    var LETTERS = { p: PAWN, n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN, k: KING };
    for (var r = 0; r < 8; r++) {
      var rank = 7 - r, file = 0;
      for (var i = 0; i < rows[r].length; i++) {
        var ch = rows[r][i];
        if (ch >= "1" && ch <= "8") { file += ch.charCodeAt(0) - 48; continue; }
        var lower = ch.toLowerCase();
        if (!(lower in LETTERS) || file > 7) throw new Error("bad FEN: placement");
        var color = ch === lower ? BLACK : WHITE;
        var piece = makePiece(LETTERS[lower], color);
        var s = sq(file, rank);
        pos.board[s] = piece;
        if (LETTERS[lower] === KING) pos.kingSq[color] = s;
        file++;
      }
      if (file !== 8) throw new Error("bad FEN: rank width");
    }
    if (pos.kingSq[WHITE] < 0 || pos.kingSq[BLACK] < 0) throw new Error("bad FEN: missing king");
    pos.side = parts[1] === "b" ? BLACK : WHITE;
    pos.castling = 0;
    var cast = parts[2] || "-";
    if (cast.indexOf("K") >= 0) pos.castling |= CR_WK;
    if (cast.indexOf("Q") >= 0) pos.castling |= CR_WQ;
    if (cast.indexOf("k") >= 0) pos.castling |= CR_BK;
    if (cast.indexOf("q") >= 0) pos.castling |= CR_BQ;
    // sanity: rights only where king/rook actually sit
    if (pos.board[sq(4, 0)] !== makePiece(KING, WHITE)) pos.castling &= ~(CR_WK | CR_WQ);
    if (pos.board[sq(7, 0)] !== makePiece(ROOK, WHITE)) pos.castling &= ~CR_WK;
    if (pos.board[sq(0, 0)] !== makePiece(ROOK, WHITE)) pos.castling &= ~CR_WQ;
    if (pos.board[sq(4, 7)] !== makePiece(KING, BLACK)) pos.castling &= ~(CR_BK | CR_BQ);
    if (pos.board[sq(7, 7)] !== makePiece(ROOK, BLACK)) pos.castling &= ~CR_BK;
    if (pos.board[sq(0, 7)] !== makePiece(ROOK, BLACK)) pos.castling &= ~CR_BQ;
    var ep = parts[3] && parts[3] !== "-" ? parseSquare(parts[3]) : -1;
    pos.ep = epRelevant(pos, ep) ? ep : -1;
    pos.halfmove = parts[4] ? (parseInt(parts[4], 10) || 0) : 0;
    pos.fullmove = parts[5] ? (parseInt(parts[5], 10) || 1) : 1;
    computeHashes(pos);
    return pos;
  }

  function toFen(pos) {
    var out = [];
    var LETTERS = " pnbrqk";
    for (var rank = 7; rank >= 0; rank--) {
      var row = "", run = 0;
      for (var file = 0; file < 8; file++) {
        var p = pos.board[sq(file, rank)];
        if (p === EMPTY) { run++; continue; }
        if (run) { row += run; run = 0; }
        var ch = LETTERS[typeOf(p)];
        row += colorOf(p) === WHITE ? ch.toUpperCase() : ch;
      }
      if (run) row += run;
      out.push(row);
    }
    var cast = "";
    if (pos.castling & CR_WK) cast += "K";
    if (pos.castling & CR_WQ) cast += "Q";
    if (pos.castling & CR_BK) cast += "k";
    if (pos.castling & CR_BQ) cast += "q";
    return out.join("/") + " " + (pos.side === WHITE ? "w" : "b") + " " +
      (cast || "-") + " " + (pos.ep >= 0 ? algebraic(pos.ep) : "-") + " " +
      pos.halfmove + " " + pos.fullmove;
  }

  // ---- attack detection --------------------------------------------------
  function isSquareAttacked(pos, target, by) {
    var b = pos.board, i, s;
    // pawns
    if (by === WHITE) {
      s = target - 15; if (onBoard(s) && b[s] === makePiece(PAWN, WHITE)) return true;
      s = target - 17; if (onBoard(s) && b[s] === makePiece(PAWN, WHITE)) return true;
    } else {
      s = target + 15; if (onBoard(s) && b[s] === makePiece(PAWN, BLACK)) return true;
      s = target + 17; if (onBoard(s) && b[s] === makePiece(PAWN, BLACK)) return true;
    }
    // knights
    var kn = makePiece(KNIGHT, by);
    for (i = 0; i < 8; i++) {
      s = target + KNIGHT_OFFS[i];
      if (onBoard(s) && b[s] === kn) return true;
    }
    // king
    var kg = makePiece(KING, by);
    for (i = 0; i < 8; i++) {
      s = target + KING_OFFS[i];
      if (onBoard(s) && b[s] === kg) return true;
    }
    // diagonal sliders
    var bi = makePiece(BISHOP, by), qu = makePiece(QUEEN, by);
    for (i = 0; i < 4; i++) {
      s = target + BISHOP_OFFS[i];
      while (onBoard(s)) {
        var p = b[s];
        if (p !== EMPTY) { if (p === bi || p === qu) return true; break; }
        s += BISHOP_OFFS[i];
      }
    }
    // orthogonal sliders
    var ro = makePiece(ROOK, by);
    for (i = 0; i < 4; i++) {
      s = target + ROOK_OFFS[i];
      while (onBoard(s)) {
        var p2 = b[s];
        if (p2 !== EMPTY) { if (p2 === ro || p2 === qu) return true; break; }
        s += ROOK_OFFS[i];
      }
    }
    return false;
  }

  function inCheck(pos) {
    return isSquareAttacked(pos, pos.kingSq[pos.side], pos.side ^ 1);
  }

  // ---- move generation (pseudo-legal) --------------------------------------
  function pushPawnMoves(pos, from, to, captured, flags, out) {
    var color = pos.side;
    var promoRank = color === WHITE ? 7 : 0;
    if (rankOf(to) === promoRank) {
      out.push(encodeMove(from, to, QUEEN, captured, flags));
      out.push(encodeMove(from, to, ROOK, captured, flags));
      out.push(encodeMove(from, to, BISHOP, captured, flags));
      out.push(encodeMove(from, to, KNIGHT, captured, flags));
    } else {
      out.push(encodeMove(from, to, 0, captured, flags));
    }
  }

  function generateMoves(pos, capturesOnly) {
    var out = [];
    var b = pos.board, side = pos.side, enemy = side ^ 1;
    var fwd = side === WHITE ? 16 : -16;
    var startRank = side === WHITE ? 1 : 6;
    for (var from = 0; from < 128; from++) {
      if (from & 0x88) continue;
      var p = b[from];
      if (p === EMPTY || colorOf(p) !== side) continue;
      var t = typeOf(p), i, to, tp;
      if (t === PAWN) {
        // captures (and promotions-by-capture)
        for (i = -1; i <= 1; i += 2) {
          to = from + fwd + i;
          if (!onBoard(to)) continue;
          tp = b[to];
          if (tp !== EMPTY && colorOf(tp) === enemy) {
            pushPawnMoves(pos, from, to, typeOf(tp), 0, out);
          } else if (to === pos.ep) {
            out.push(encodeMove(from, to, 0, PAWN, F_EP));
          }
        }
        // pushes
        to = from + fwd;
        if (onBoard(to) && b[to] === EMPTY) {
          var promoRank = side === WHITE ? 7 : 0;
          if (!capturesOnly || rankOf(to) === promoRank) {
            pushPawnMoves(pos, from, to, 0, 0, out);
          }
          if (!capturesOnly && rankOf(from) === startRank && b[to + fwd] === EMPTY) {
            out.push(encodeMove(from, to + fwd, 0, 0, F_DOUBLE));
          }
        }
        continue;
      }
      var offs, sliding;
      if (t === KNIGHT) { offs = KNIGHT_OFFS; sliding = false; }
      else if (t === BISHOP) { offs = BISHOP_OFFS; sliding = true; }
      else if (t === ROOK) { offs = ROOK_OFFS; sliding = true; }
      else { offs = KING_OFFS; sliding = t === QUEEN; } // queen + king
      for (i = 0; i < offs.length; i++) {
        to = from + offs[i];
        while (onBoard(to)) {
          tp = b[to];
          if (tp === EMPTY) {
            if (!capturesOnly) out.push(encodeMove(from, to, 0, 0, 0));
          } else {
            if (colorOf(tp) === enemy) out.push(encodeMove(from, to, 0, typeOf(tp), 0));
            break;
          }
          if (!sliding) break;
          to += offs[i];
        }
      }
    }
    // castling — king may not castle out of, through, or into check;
    // squares between king and rook must be empty.
    if (!capturesOnly) {
      var home = side === WHITE ? 0 : 7;
      var e = sq(4, home);
      var kBit = side === WHITE ? CR_WK : CR_BK;
      var qBit = side === WHITE ? CR_WQ : CR_BQ;
      if ((pos.castling & kBit) &&
          b[e + 1] === EMPTY && b[e + 2] === EMPTY &&
          !isSquareAttacked(pos, e, enemy) &&
          !isSquareAttacked(pos, e + 1, enemy) &&
          !isSquareAttacked(pos, e + 2, enemy)) {
        out.push(encodeMove(e, e + 2, 0, 0, F_CASTLE));
      }
      if ((pos.castling & qBit) &&
          b[e - 1] === EMPTY && b[e - 2] === EMPTY && b[e - 3] === EMPTY &&
          !isSquareAttacked(pos, e, enemy) &&
          !isSquareAttacked(pos, e - 1, enemy) &&
          !isSquareAttacked(pos, e - 2, enemy)) {
        out.push(encodeMove(e, e - 2, 0, 0, F_CASTLE));
      }
    }
    return out;
  }

  function generateCaptures(pos) { return generateMoves(pos, true); }

  // ---- make / unmake ---------------------------------------------------------
  function makeMove(pos, m) {
    var b = pos.board;
    var from = moveFrom(m), to = moveTo(m);
    var piece = b[from];
    var color = colorOf(piece);
    var promo = movePromo(m);
    var h1 = pos.h1, h2 = pos.h2;

    var undo = {
      m: m,
      castling: pos.castling,
      ep: pos.ep,
      halfmove: pos.halfmove,
      h1: h1, h2: h2,
      captured: EMPTY,
      capturedSq: -1
    };

    // hash out old castling + ep
    h1 ^= Z1.castle[pos.castling]; h2 ^= Z2.castle[pos.castling];
    if (pos.ep >= 0) { h1 ^= Z1.epFile[fileOf(pos.ep)]; h2 ^= Z2.epFile[fileOf(pos.ep)]; }

    // remove captured piece
    if (isEP(m)) {
      var capSq = to + (color === WHITE ? -16 : 16);
      undo.captured = b[capSq];
      undo.capturedSq = capSq;
      h1 ^= Z1.pieces[b[capSq]][capSq]; h2 ^= Z2.pieces[b[capSq]][capSq];
      b[capSq] = EMPTY;
    } else if (b[to] !== EMPTY) {
      undo.captured = b[to];
      undo.capturedSq = to;
      h1 ^= Z1.pieces[b[to]][to]; h2 ^= Z2.pieces[b[to]][to];
    }

    // move the piece (promote if needed)
    var placed = promo ? makePiece(promo, color) : piece;
    h1 ^= Z1.pieces[piece][from] ^ Z1.pieces[placed][to];
    h2 ^= Z2.pieces[piece][from] ^ Z2.pieces[placed][to];
    b[from] = EMPTY;
    b[to] = placed;

    // castling: move the rook too
    if (isCastle(m)) {
      var rook = makePiece(ROOK, color);
      var rFrom, rTo;
      if (to > from) { rFrom = to + 1; rTo = to - 1; }   // kingside
      else { rFrom = to - 2; rTo = to + 1; }             // queenside
      b[rFrom] = EMPTY;
      b[rTo] = rook;
      h1 ^= Z1.pieces[rook][rFrom] ^ Z1.pieces[rook][rTo];
      h2 ^= Z2.pieces[rook][rFrom] ^ Z2.pieces[rook][rTo];
    }

    if (typeOf(piece) === KING) pos.kingSq[color] = to;

    // castling rights
    pos.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];

    // en-passant square: only on double push with an enemy pawn poised to take
    pos.ep = -1;
    if (isDouble(m)) {
      var epSq = from + (color === WHITE ? 16 : -16);
      pos.side ^= 1; // epRelevant looks from the capturer's perspective
      if (epRelevant(pos, epSq)) pos.ep = epSq;
      pos.side ^= 1;
    }

    // clocks
    if (typeOf(piece) === PAWN || undo.captured !== EMPTY) pos.halfmove = 0;
    else pos.halfmove++;
    if (color === BLACK) pos.fullmove++;

    pos.side ^= 1;

    // hash in new castling + ep + side flip
    h1 ^= Z1.castle[pos.castling]; h2 ^= Z2.castle[pos.castling];
    if (pos.ep >= 0) { h1 ^= Z1.epFile[fileOf(pos.ep)]; h2 ^= Z2.epFile[fileOf(pos.ep)]; }
    h1 ^= Z1.side; h2 ^= Z2.side;
    pos.h1 = h1 >>> 0;
    pos.h2 = h2 >>> 0;

    pos.hist.push(undo);
  }

  function unmakeMove(pos) {
    var undo = pos.hist.pop();
    if (!undo) return null;
    var b = pos.board;
    var m = undo.m;
    var from = moveFrom(m), to = moveTo(m);
    pos.side ^= 1;
    var color = pos.side;
    var placed = b[to];
    var piece = movePromo(m) ? makePiece(PAWN, color) : placed;

    b[from] = piece;
    b[to] = EMPTY;
    if (undo.captured !== EMPTY) b[undo.capturedSq] = undo.captured;

    if (isCastle(m)) {
      var rook = makePiece(ROOK, color);
      if (to > from) { b[to + 1] = rook; b[to - 1] = EMPTY; }
      else { b[to - 2] = rook; b[to + 1] = EMPTY; }
    }

    if (typeOf(piece) === KING) pos.kingSq[color] = from;

    pos.castling = undo.castling;
    pos.ep = undo.ep;
    pos.halfmove = undo.halfmove;
    if (color === BLACK) pos.fullmove--;
    pos.h1 = undo.h1;
    pos.h2 = undo.h2;
    return m;
  }

  // did the side that just moved leave its own king attacked?
  function leftInCheck(pos) {
    var justMoved = pos.side ^ 1;
    return isSquareAttacked(pos, pos.kingSq[justMoved], pos.side);
  }

  function legalMoves(pos) {
    var pseudo = generateMoves(pos, false);
    var out = [];
    for (var i = 0; i < pseudo.length; i++) {
      makeMove(pos, pseudo[i]);
      if (!leftInCheck(pos)) out.push(pseudo[i]);
      unmakeMove(pos);
    }
    return out;
  }

  // ---- perft --------------------------------------------------------------
  function perft(pos, depth) {
    if (depth === 0) return 1;
    var moves = generateMoves(pos, false);
    var nodes = 0;
    for (var i = 0; i < moves.length; i++) {
      makeMove(pos, moves[i]);
      if (!leftInCheck(pos)) nodes += perft(pos, depth - 1);
      unmakeMove(pos);
    }
    return nodes;
  }

  // ---- game status / draw detection ----------------------------------------
  function repetitionCount(pos) {
    var count = 1;
    // hist entries store the hashes of every earlier state of this game
    for (var i = pos.hist.length - 1; i >= 0; i--) {
      var u = pos.hist[i];
      if (u.h1 === pos.h1 && u.h2 === pos.h2) count++;
    }
    return count;
  }

  function insufficientMaterial(pos) {
    var bishopsColor = -1, minorCount = 0, bishopCount = 0;
    for (var s = 0; s < 128; s++) {
      if (s & 0x88) continue;
      var t = typeOf(pos.board[s]);
      if (t === EMPTY || t === KING) continue;
      if (t === PAWN || t === ROOK || t === QUEEN) return false;
      minorCount++;
      if (t === BISHOP) {
        bishopCount++;
        var sqColor = (fileOf(s) + rankOf(s)) & 1;
        if (bishopsColor === -1) bishopsColor = sqColor;
        else if (bishopsColor !== sqColor) return false; // opposite-colored bishops
      }
    }
    if (minorCount <= 1) return true;                       // K vs K, K+B/N vs K
    return minorCount === bishopCount;                      // only same-color bishops
  }

  // Returns {over, result, reason, check}. result: "1-0" | "0-1" | "1/2-1/2" | null
  function gameStatus(pos) {
    var check = inCheck(pos);
    var moves = legalMoves(pos);
    if (moves.length === 0) {
      if (check) {
        return { over: true, result: pos.side === WHITE ? "0-1" : "1-0", reason: "checkmate", check: true };
      }
      return { over: true, result: "1/2-1/2", reason: "stalemate", check: false };
    }
    if (pos.halfmove >= 100) return { over: true, result: "1/2-1/2", reason: "50-move rule", check: check };
    if (repetitionCount(pos) >= 3) return { over: true, result: "1/2-1/2", reason: "threefold repetition", check: check };
    if (insufficientMaterial(pos)) return { over: true, result: "1/2-1/2", reason: "insufficient material", check: check };
    return { over: false, result: null, reason: null, check: check };
  }

  // ---- SAN ------------------------------------------------------------------
  var SAN_LETTER = ["", "", "N", "B", "R", "Q", "K"];

  // san(pos, move) — call BEFORE making the move.
  function san(pos, m) {
    var from = moveFrom(m), to = moveTo(m);
    var piece = pos.board[from];
    var t = typeOf(piece);
    var str;
    if (isCastle(m)) {
      str = to > from ? "O-O" : "O-O-O";
    } else if (t === PAWN) {
      str = "";
      if (isCapture(m)) str += "abcdefgh"[fileOf(from)] + "x";
      str += algebraic(to);
      if (movePromo(m)) str += "=" + SAN_LETTER[movePromo(m)];
    } else {
      str = SAN_LETTER[t];
      // disambiguation among legal moves of the same piece type to the same square
      var others = legalMoves(pos).filter(function (o) {
        return o !== m && moveTo(o) === to && moveFrom(o) !== from &&
          typeOf(pos.board[moveFrom(o)]) === t;
      });
      if (others.length) {
        var sameFile = others.some(function (o) { return fileOf(moveFrom(o)) === fileOf(from); });
        var sameRank = others.some(function (o) { return rankOf(moveFrom(o)) === rankOf(from); });
        if (!sameFile) str += "abcdefgh"[fileOf(from)];
        else if (!sameRank) str += "" + (rankOf(from) + 1);
        else str += algebraic(from);
      }
      if (isCapture(m)) str += "x";
      str += algebraic(to);
    }
    // check / mate suffix
    makeMove(pos, m);
    var opCheck = inCheck(pos);
    if (opCheck) str += legalMoves(pos).length === 0 ? "#" : "+";
    unmakeMove(pos);
    return str;
  }

  // find the legal move matching from/to (+promo type), or 0
  function findMove(pos, from, to, promo) {
    var moves = legalMoves(pos);
    for (var i = 0; i < moves.length; i++) {
      if (moveFrom(moves[i]) === from && moveTo(moves[i]) === to &&
          (!movePromo(moves[i]) || movePromo(moves[i]) === (promo || QUEEN))) {
        return moves[i];
      }
    }
    return 0;
  }

  var ChessEngine = {
    EMPTY: EMPTY, PAWN: PAWN, KNIGHT: KNIGHT, BISHOP: BISHOP,
    ROOK: ROOK, QUEEN: QUEEN, KING: KING,
    WHITE: WHITE, BLACK: BLACK,
    CR_WK: CR_WK, CR_WQ: CR_WQ, CR_BK: CR_BK, CR_BQ: CR_BQ,
    START_FEN: START_FEN,
    makePiece: makePiece, typeOf: typeOf, colorOf: colorOf,
    sq: sq, fileOf: fileOf, rankOf: rankOf, onBoard: onBoard,
    algebraic: algebraic, parseSquare: parseSquare,
    encodeMove: encodeMove, moveFrom: moveFrom, moveTo: moveTo,
    movePromo: movePromo, moveCaptured: moveCaptured,
    isEP: isEP, isDouble: isDouble, isCastle: isCastle, isCapture: isCapture,
    Position: Position, fromFen: fromFen, toFen: toFen,
    computeHashes: computeHashes,
    isSquareAttacked: isSquareAttacked, inCheck: inCheck, leftInCheck: leftInCheck,
    generateMoves: generateMoves, generateCaptures: generateCaptures,
    makeMove: makeMove, unmakeMove: unmakeMove,
    legalMoves: legalMoves, perft: perft,
    repetitionCount: repetitionCount, insufficientMaterial: insufficientMaterial,
    gameStatus: gameStatus, san: san, findMove: findMove
  };

  global.ChessEngine = ChessEngine;
  if (typeof module !== "undefined" && module.exports) module.exports = ChessEngine;
})(typeof self !== "undefined" ? self : globalThis);

// Reversi — main game script: state, turn flow, canvas rendering, input.
"use strict";
(function () {
  var E = window.ReversiEngine;
  var BLACK = E.BLACK, WHITE = E.WHITE, EMPTY = E.EMPTY;

  // ---------------------------------------------------------------- DOM ---
  function $(id) { return document.getElementById(id); }
  var canvas = $("board");
  var ctx = canvas.getContext("2d");
  var statusEl = $("status");
  var countBlackEl = $("count-black");
  var countWhiteEl = $("count-white");
  var chipBlackEl = $("chip-black");
  var chipWhiteEl = $("chip-white");
  var labelBlackEl = $("label-black");
  var labelWhiteEl = $("label-white");
  var toastEl = $("toast");
  var setupEl = $("setup");
  var gameoverEl = $("gameover");
  var goTitleEl = $("go-title");
  var goScoreEl = $("go-score");
  var goStatsEl = $("go-stats");
  var btnUndo = $("btn-undo");
  var btnHints = $("btn-hints");
  var btnSound = $("btn-sound");

  // ---------------------------------------------------------- constants ---
  var CELL = 66, PAD = 30, SIZE = CELL * 8 + PAD * 2;
  var DISC_R = 25;
  var DPR = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = SIZE * DPR;
  canvas.height = SIZE * DPR;

  var FLIP_DELAY0 = 60;   // ms before the first ripple wave
  var FLIP_STAGGER = 85;  // ms per Chebyshev-distance ring
  var FLIP_DUR = 230;     // ms for one disc to flip
  var PASS_PAUSE = 1150;  // ms the pass banner holds the game
  var AI_MIN_DELAY = 420; // ms minimum "thinking" so instant moves read well

  var ACCENT = "#7ee787";
  var MARKER = "#f2b23e";
  var LEVEL_NAMES = { 1: "Greedy", 2: "Positional", 3: "Deep" };

  // ----------------------------------------------------------- settings ---
  var LS_SETTINGS = "arcade.reversi.settings";
  var LS_STATS = "arcade.reversi.stats";

  function loadJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) { return fallback; }
  }
  function saveJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (err) { /* ignore */ }
  }

  var settings = Object.assign(
    { mode: "ai", humanColor: BLACK, level: 2, hints: true, sound: true },
    loadJSON(LS_SETTINGS, {})
  );
  var pending = { mode: settings.mode, humanColor: settings.humanColor, level: settings.level };

  Sound.setEnabled(settings.sound);

  // -------------------------------------------------------------- state ---
  var S = {
    board: new Int8Array(64),
    current: BLACK,
    over: false,
    busy: false,      // flip animation or pass banner in progress
    thinking: false,  // AI computing
    lastMove: -1,
    history: [],      // snapshots taken before each real move
    legal: [],        // legal moves for the side to move
    legalSet: new Set(),
    hoverIdx: -1,
    seq: 0,           // cancellation token: bumping invalidates timers/AI
    started: false,
  };
  var anims = new Map(); // idx -> {type:'flip'|'place', start, dur, from}
  var shownB = -1, shownW = -1;

  // setTimeout guarded by the cancellation token.
  function later(ms, fn) {
    var tok = S.seq;
    setTimeout(function () { if (tok === S.seq) fn(); }, ms);
  }

  function colorName(p) { return p === BLACK ? "Black" : "White"; }
  function isAiTurn() {
    return settings.mode === "ai" && !S.over && S.current !== settings.humanColor;
  }
  function humanCanAct() {
    return !S.over && !S.busy && !S.thinking &&
      (settings.mode === "2p" || S.current === settings.humanColor);
  }

  // ---------------------------------------------------------- turn flow ---
  function refreshLegal() {
    S.legal = S.over ? [] : E.legalMoves(S.board, S.current);
    S.legalSet = new Set(S.legal.map(function (m) { return m.idx; }));
  }

  function updateStatus() {
    refreshLegal();
    var txt;
    if (S.over) {
      txt = goTitleEl.textContent;
    } else if (S.thinking) {
      txt = LEVEL_NAMES[settings.level] + " is thinking";
      statusEl.classList.add("thinking");
    } else {
      var who = colorName(S.current);
      if (settings.mode === "ai" && S.current === settings.humanColor) who += " (you)";
      txt = who + " to move";
    }
    if (!S.thinking) statusEl.classList.remove("thinking");
    statusEl.textContent = txt;
    chipBlackEl.classList.toggle("active", !S.over && S.current === BLACK);
    chipWhiteEl.classList.toggle("active", !S.over && S.current === WHITE);
    btnUndo.disabled = !canUndo();
  }

  function playMove(idx, player) {
    var flips = E.computeFlips(S.board, idx, player);
    if (!flips) return false;
    S.history.push({ board: S.board.slice(), player: player, lastMove: S.lastMove });

    var now = performance.now();
    anims.set(idx, { type: "place", start: now, dur: 170 });
    var maxD = 0;
    var r0 = idx >> 3, c0 = idx & 7;
    for (var i = 0; i < flips.length; i++) {
      var f = flips[i];
      var d = Math.max(Math.abs((f >> 3) - r0), Math.abs((f & 7) - c0));
      if (d > maxD) maxD = d;
      // Ripple outward from the placed disc, staggered by distance.
      anims.set(f, {
        type: "flip",
        start: now + FLIP_DELAY0 + d * FLIP_STAGGER,
        dur: FLIP_DUR,
        from: 3 - player,
      });
    }

    E.applyMove(S.board, idx, player, flips);
    S.lastMove = idx;
    S.current = 3 - player;
    S.busy = true;
    Sound.place();
    var mkFlipSound = function (w) { return function () { Sound.flip(w); }; };
    for (var w = 1; w <= maxD; w++) later(FLIP_DELAY0 + w * FLIP_STAGGER, mkFlipSound(w));
    later(FLIP_DELAY0 + maxD * FLIP_STAGGER + FLIP_DUR + 50, function () {
      anims.clear();
      S.busy = false;
      resolveTurn();
    });
    updateStatus();
    return true;
  }

  function resolveTurn() {
    if (S.over) return;
    if (E.hasMove(S.board, S.current)) {
      updateStatus();
      if (isAiTurn()) aiMove();
      return;
    }
    if (!E.hasMove(S.board, 3 - S.current)) { gameOver(); return; }
    // Forced pass: announce it, then hand the turn over.
    var passer = S.current;
    showToast(colorName(passer) + " has no legal move — pass");
    Sound.pass();
    S.current = 3 - passer;
    S.busy = true;
    updateStatus();
    later(PASS_PAUSE, function () {
      S.busy = false;
      updateStatus();
      if (isAiTurn()) aiMove();
    });
  }

  function gameOver() {
    S.over = true;
    S.thinking = false;
    var c = E.counts(S.board);
    var winner = c.black > c.white ? BLACK : c.white > c.black ? WHITE : 0;
    var title = winner === 0
      ? "Draw"
      : colorName(winner) + " wins";
    goTitleEl.textContent = title;
    goScoreEl.innerHTML =
      '<span class="score-side"><span class="disc black"></span>' + c.black + "</span>" +
      '<span class="score-dash">—</span>' +
      '<span class="score-side"><span class="disc white"></span>' + c.white + "</span>";

    if (settings.mode === "ai") {
      var stats = loadJSON(LS_STATS, {});
      var key = String(settings.level);
      var st = stats[key] || { w: 0, l: 0, d: 0 };
      var humanWon = winner === settings.humanColor;
      if (winner === 0) st.d++;
      else if (humanWon) st.w++;
      else st.l++;
      stats[key] = st;
      saveJSON(LS_STATS, stats);
      goStatsEl.textContent =
        "vs " + LEVEL_NAMES[settings.level] + " — you: " +
        st.w + "W · " + st.d + "D · " + st.l + "L";
      if (winner === 0) Sound.draw();
      else if (humanWon) Sound.win();
      else Sound.lose();
    } else {
      goStatsEl.textContent = "";
      if (winner === 0) Sound.draw(); else Sound.win();
    }
    updateStatus();
    later(600, function () { gameoverEl.classList.remove("hidden"); });
  }

  function newGame() {
    S.seq++;
    S.board.fill(EMPTY);
    // Standard start: four discs crossed in the centre; black moves first.
    S.board[27] = WHITE; S.board[28] = BLACK;
    S.board[35] = BLACK; S.board[36] = WHITE;
    S.current = BLACK;
    S.over = false;
    S.busy = false;
    S.thinking = false;
    S.lastMove = -1;
    S.hoverIdx = -1;
    S.history.length = 0;
    S.started = true;
    anims.clear();
    hideToast();
    gameoverEl.classList.add("hidden");
    setupEl.classList.add("hidden");
    updateStatus();
    if (isAiTurn()) later(450, aiMove);
  }

  // ----------------------------------------------------------------- AI ---
  var worker = null, workerBroken = false;
  var workerJobs = new Map(); // token -> callback

  function ensureWorker() {
    if (worker || workerBroken) return;
    // Workers created from file:// are blocked by Chrome's origin rules, and
    // some browsers report that asynchronously instead of throwing — detect
    // the protocol up front so the main-thread fallback engages immediately.
    if (typeof Worker === "undefined" || location.protocol === "file:") {
      workerBroken = true;
      return;
    }
    try {
      worker = new Worker("src/ai-worker.js");
      worker.onmessage = function (e) {
        var cb = workerJobs.get(e.data.token);
        if (cb) { workerJobs.delete(e.data.token); cb(e.data.idx); }
      };
      worker.onerror = function () {
        workerBroken = true;
        try { worker.terminate(); } catch (err) { /* ignore */ }
        worker = null;
        // Re-run anything in flight on the main-thread fallback.
        workerJobs.forEach(function (cb, token) { cb(null); });
        workerJobs.clear();
      };
    } catch (err) {
      workerBroken = true;
      worker = null;
    }
  }

  // Main-thread fallback for the deep search: evaluates one root move per
  // setTimeout slice so the UI (animations, thinking indicator, buttons)
  // stays responsive when no worker is available (e.g. opened via file://).
  // Same move ordering and pruning as E.searchDeep, so it picks the same move.
  function searchDeepChunked(board, player, opts, cb) {
    var tok = S.seq;
    var moves = E.legalMoves(board, player);
    if (!moves.length) { setTimeout(function () { cb(-1); }, 0); return; }
    if (moves.length === 1) { setTimeout(function () { cb(moves[0].idx); }, 0); return; }
    var exact = E.counts(board).empty <= opts.exactAt;
    moves.sort(function (a, b) { return E.WEIGHTS[b.idx] - E.WEIGHTS[a.idx]; });
    var bestIdx = moves[0].idx, alpha = -Infinity, i = 0;
    function step() {
      if (tok !== S.seq) return; // undo/new-game cancelled this search
      var m = moves[i];
      E.applyMove(board, m.idx, player, m.flips);
      var v = exact
        ? -E.solveExact(board, 3 - player, -Infinity, -alpha, false)
        : -E.negamax(board, 3 - player, opts.depth - 1, -Infinity, -alpha, false);
      E.undoMove(board, m.idx, player, m.flips);
      if (v > alpha) { alpha = v; bestIdx = m.idx; }
      i++;
      if (i < moves.length) setTimeout(step, 0);
      else cb(bestIdx);
    }
    // First slice waits a beat so the thinking indicator paints.
    setTimeout(step, 30);
  }

  function deepMove(board, player, token, cb) {
    ensureWorker();
    if (worker && !workerBroken) {
      workerJobs.set(token, function (idx) {
        if (idx == null) {
          // Worker died mid-search: re-run on the main-thread fallback.
          searchDeepChunked(board.slice(), player, { depth: 4, exactAt: 10 }, cb);
        } else cb(idx);
      });
      worker.postMessage({
        token: token,
        board: Array.prototype.slice.call(board),
        player: player,
        depth: 5,
        exactAt: 12,
      });
    } else {
      // No worker available (e.g. opened via file://).
      searchDeepChunked(board.slice(), player, { depth: 4, exactAt: 10 }, cb);
    }
  }

  function aiMove() {
    if (S.over || !isAiTurn()) return;
    var player = S.current;
    var token = S.seq;
    S.thinking = true;
    updateStatus();
    var t0 = performance.now();
    var deliver = function (idx) {
      if (token !== S.seq || S.over) return;
      var wait = Math.max(0, AI_MIN_DELAY - (performance.now() - t0));
      setTimeout(function () {
        if (token !== S.seq || S.over) return;
        S.thinking = false;
        if (idx >= 0 && E.isLegal(S.board, idx, player)) playMove(idx, player);
        else { updateStatus(); resolveTurn(); }
      }, wait);
    };
    if (settings.level === 1) {
      setTimeout(function () { deliver(E.bestMoveGreedy(S.board, player)); }, 10);
    } else if (settings.level === 2) {
      setTimeout(function () { deliver(E.bestMovePositional(S.board, player)); }, 10);
    } else {
      deepMove(S.board, player, token, deliver);
    }
  }

  // ---------------------------------------------------------------- undo ---
  function canUndo() {
    if (!S.started || S.busy) return false;
    if (settings.mode === "2p") return S.history.length > 0;
    for (var i = S.history.length - 1; i >= 0; i--) {
      if (S.history[i].player === settings.humanColor) return true;
    }
    return false;
  }

  function undo() {
    if (!canUndo()) return;
    var entry = null;
    if (settings.mode === "2p") {
      entry = S.history.pop();
    } else {
      // vs AI: rewind to just before the human's last move (undoes the pair).
      for (var i = S.history.length - 1; i >= 0; i--) {
        if (S.history[i].player === settings.humanColor) {
          entry = S.history[i];
          S.history.length = i;
          break;
        }
      }
      if (!entry) return;
    }
    S.seq++; // cancel pending animations, toasts and AI replies
    S.board.set(entry.board);
    S.current = entry.player;
    S.lastMove = entry.lastMove;
    S.over = false;
    S.busy = false;
    S.thinking = false;
    anims.clear();
    hideToast();
    gameoverEl.classList.add("hidden");
    Sound.ui();
    updateStatus();
  }

  // --------------------------------------------------------------- toast ---
  var toastTimer = 0;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove("hidden");
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, PASS_PAUSE - 100);
  }
  function hideToast() {
    clearTimeout(toastTimer);
    toastEl.classList.remove("show");
    toastEl.classList.add("hidden");
  }

  // ------------------------------------------------------------ rendering ---
  function cellCenter(idx) {
    return {
      x: PAD + (idx & 7) * CELL + CELL / 2,
      y: PAD + (idx >> 3) * CELL + CELL / 2,
    };
  }

  function drawDisc(x, y, color, scaleX, lift, scale) {
    var R = DISC_R * (scale == null ? 1 : scale);
    var sx = Math.max(0.02, scaleX == null ? 1 : scaleX);
    // shadow
    ctx.save();
    ctx.translate(x, y + 4);
    ctx.scale(sx, 1);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(0, 0, R, R * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // disc
    ctx.save();
    ctx.translate(x, y - (lift || 0));
    ctx.scale(sx, 1);
    var g = ctx.createRadialGradient(-R * 0.4, -R * 0.45, R * 0.15, 0, 0, R * 1.05);
    if (color === BLACK) {
      g.addColorStop(0, "#4a5058");
      g.addColorStop(0.7, "#22262c");
      g.addColorStop(1, "#101317");
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
    } else {
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.7, "#ddd9c9");
      g.addColorStop(1, "#b3af9e");
      ctx.strokeStyle = "#7d7968";
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function render(now) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);

    // frame
    roundRect(3, 3, SIZE - 6, SIZE - 6, 12);
    ctx.fillStyle = "#111d16";
    ctx.fill();
    ctx.strokeStyle = "rgba(126,231,135,0.22)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // cells
    var r, c;
    for (r = 0; r < 8; r++) {
      for (c = 0; c < 8; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? "#17372a" : "#153325";
        ctx.fillRect(PAD + c * CELL, PAD + r * CELL, CELL, CELL);
      }
    }
    // grid lines
    ctx.strokeStyle = "rgba(5,15,9,0.9)";
    ctx.lineWidth = 1;
    for (var i = 0; i <= 8; i++) {
      ctx.beginPath();
      ctx.moveTo(PAD + i * CELL + 0.5, PAD);
      ctx.lineTo(PAD + i * CELL + 0.5, PAD + 8 * CELL);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(PAD, PAD + i * CELL + 0.5);
      ctx.lineTo(PAD + 8 * CELL, PAD + i * CELL + 0.5);
      ctx.stroke();
    }
    // star points
    ctx.fillStyle = "rgba(5,15,9,0.95)";
    [[2, 2], [2, 6], [6, 2], [6, 6]].forEach(function (p) {
      ctx.beginPath();
      ctx.arc(PAD + p[1] * CELL, PAD + p[0] * CELL, 3.2, 0, Math.PI * 2);
      ctx.fill();
    });
    // coordinate labels
    ctx.fillStyle = "rgba(232,234,237,0.28)";
    ctx.font = "11px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (i = 0; i < 8; i++) {
      ctx.fillText(String.fromCharCode(97 + i), PAD + i * CELL + CELL / 2, SIZE - PAD / 2 + 1);
      ctx.fillText(String(i + 1), PAD / 2, PAD + i * CELL + CELL / 2);
    }

    var showDots = settings.hints && S.started && humanCanAct();
    var pulse = 0.38 + 0.22 * Math.sin(now / 260);

    // discs (tallying the colours actually shown, so counts ripple live)
    var shownBlack = 0, shownWhite = 0;
    function tally(col) { if (col === BLACK) shownBlack++; else if (col === WHITE) shownWhite++; }

    for (i = 0; i < 64; i++) {
      var v = S.board[i];
      var a = anims.get(i);
      var p0 = cellCenter(i);
      if (a && a.type === "flip") {
        if (now < a.start) {
          drawDisc(p0.x, p0.y, a.from, 1, 0);
          tally(a.from);
        } else {
          var p = Math.min(1, (now - a.start) / a.dur);
          var lift = Math.sin(p * Math.PI) * 5;
          if (p < 0.5) {
            drawDisc(p0.x, p0.y, a.from, 1 - p * 2, lift);
            tally(a.from);
          } else {
            drawDisc(p0.x, p0.y, v, p * 2 - 1, lift);
            tally(v);
          }
          if (p >= 1) anims.delete(i);
        }
      } else if (a && a.type === "place") {
        var pp = Math.min(1, (now - a.start) / a.dur);
        var s = 0.45 + 0.55 * (1 - (1 - pp) * (1 - pp)); // ease-out
        drawDisc(p0.x, p0.y, v, 1, (1 - pp) * 4, s);
        tally(v);
        if (pp >= 1) anims.delete(i);
      } else if (v !== EMPTY) {
        drawDisc(p0.x, p0.y, v, 1, 0);
        tally(v);
      } else if (showDots && S.legalSet.has(i)) {
        // legal-move dot for the side to move
        ctx.beginPath();
        ctx.arc(p0.x, p0.y, 7, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(126,231,135," + pulse.toFixed(3) + ")";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // hover ghost
    if (showDots && S.hoverIdx >= 0 && S.legalSet.has(S.hoverIdx)) {
      var hc = cellCenter(S.hoverIdx);
      ctx.globalAlpha = 0.4;
      drawDisc(hc.x, hc.y, S.current, 1, 0, 0.92);
      ctx.globalAlpha = 1;
    }

    // last-move marker
    if (S.lastMove >= 0 && !anims.has(S.lastMove)) {
      var lm = cellCenter(S.lastMove);
      ctx.beginPath();
      ctx.arc(lm.x, lm.y, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = MARKER;
      ctx.fill();
    }

    if (shownBlack !== shownB) { shownB = shownBlack; countBlackEl.textContent = String(shownBlack); }
    if (shownWhite !== shownW) { shownW = shownWhite; countWhiteEl.textContent = String(shownWhite); }
  }

  function frame(now) {
    render(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------------------------------------------------------------- input ---
  function pickCell(e) {
    var rect = canvas.getBoundingClientRect();
    var x = (e.clientX - rect.left) * (SIZE / rect.width);
    var y = (e.clientY - rect.top) * (SIZE / rect.height);
    var col = Math.floor((x - PAD) / CELL);
    var row = Math.floor((y - PAD) / CELL);
    if (col < 0 || col > 7 || row < 0 || row > 7) return -1;
    return row * 8 + col;
  }

  canvas.addEventListener("pointerdown", function (e) {
    Sound.unlock();
    if (!setupEl.classList.contains("hidden")) return;
    if (S.over) return;
    if (!humanCanAct()) return;
    var idx = pickCell(e);
    if (idx < 0) return;
    if (S.legalSet.has(idx)) playMove(idx, S.current);
    else Sound.illegal();
  });

  canvas.addEventListener("pointermove", function (e) {
    S.hoverIdx = pickCell(e);
  });
  canvas.addEventListener("pointerleave", function () { S.hoverIdx = -1; });

  document.addEventListener("keydown", function (e) {
    Sound.unlock();
    var key = e.key;
    if (!gameoverEl.classList.contains("hidden")) {
      if (key === "Enter" || key === " " || key === "r" || key === "R") {
        e.preventDefault();
        newGame(); // instant rematch, same settings
        return;
      }
    }
    if (key === "Escape") {
      if (!setupEl.classList.contains("hidden")) {
        if (S.started) closeSetup();
      } else openSetup();
      return;
    }
    if (!setupEl.classList.contains("hidden")) {
      if (key === "Enter") { e.preventDefault(); startFromSetup(); }
      return;
    }
    if (key === "n" || key === "N") openSetup();
    else if (key === "u" || key === "U") undo();
    else if (key === "h" || key === "H") toggleHints();
    else if (key === "m" || key === "M") toggleSound();
  });

  // --------------------------------------------------------------- setup ---
  function bindSeg(el, get, set) {
    var buttons = el.querySelectorAll("button");
    function refresh() {
      buttons.forEach(function (b) {
        b.classList.toggle("on", b.dataset.v === String(get()));
      });
    }
    buttons.forEach(function (b) {
      b.addEventListener("click", function () {
        Sound.unlock();
        set(b.dataset.v);
        Sound.ui();
        refresh();
        refreshSetupVisibility();
      });
    });
    refresh();
    return refresh;
  }

  function refreshSetupVisibility() {
    var vsAi = pending.mode === "ai";
    $("opt-side").classList.toggle("hidden", !vsAi);
    $("opt-level").classList.toggle("hidden", !vsAi);
  }

  bindSeg($("seg-mode"),
    function () { return pending.mode; },
    function (v) { pending.mode = v; });
  bindSeg($("seg-side"),
    function () { return pending.humanColor; },
    function (v) { pending.humanColor = parseInt(v, 10); });
  bindSeg($("seg-level"),
    function () { return pending.level; },
    function (v) { pending.level = parseInt(v, 10); });
  refreshSetupVisibility();

  function openSetup() {
    setupEl.classList.remove("hidden");
    $("setup-cancel").classList.toggle("hidden", !S.started);
  }
  function closeSetup() {
    setupEl.classList.add("hidden");
  }
  function startFromSetup() {
    settings.mode = pending.mode;
    settings.humanColor = pending.humanColor;
    settings.level = pending.level;
    saveJSON(LS_SETTINGS, settings);
    refreshSideLabels();
    Sound.ui();
    newGame();
  }

  function refreshSideLabels() {
    if (settings.mode === "ai") {
      var ai = LEVEL_NAMES[settings.level];
      labelBlackEl.textContent = settings.humanColor === BLACK ? "Black · you" : "Black · " + ai;
      labelWhiteEl.textContent = settings.humanColor === WHITE ? "White · you" : "White · " + ai;
    } else {
      labelBlackEl.textContent = "Black";
      labelWhiteEl.textContent = "White";
    }
  }

  $("setup-start").addEventListener("click", function () { Sound.unlock(); startFromSetup(); });
  $("setup-cancel").addEventListener("click", function () { Sound.ui(); closeSetup(); });
  $("go-rematch").addEventListener("click", function () { Sound.ui(); newGame(); });
  $("go-setup").addEventListener("click", function () {
    Sound.ui();
    gameoverEl.classList.add("hidden");
    openSetup();
  });
  $("btn-new").addEventListener("click", function () { Sound.unlock(); Sound.ui(); openSetup(); });
  btnUndo.addEventListener("click", function () { Sound.unlock(); undo(); });

  function toggleHints() {
    settings.hints = !settings.hints;
    saveJSON(LS_SETTINGS, settings);
    btnHints.textContent = "Hints: " + (settings.hints ? "on" : "off");
    Sound.ui();
  }
  function toggleSound() {
    settings.sound = !settings.sound;
    saveJSON(LS_SETTINGS, settings);
    Sound.setEnabled(settings.sound);
    btnSound.textContent = "Sound: " + (settings.sound ? "on" : "off");
    Sound.ui();
  }
  btnHints.addEventListener("click", function () { Sound.unlock(); toggleHints(); });
  btnSound.addEventListener("click", function () { Sound.unlock(); toggleSound(); });
  btnHints.textContent = "Hints: " + (settings.hints ? "on" : "off");
  btnSound.textContent = "Sound: " + (settings.sound ? "on" : "off");

  // Minimal debug/testing hook (read-mostly; used by automated checks).
  window.__reversi = {
    state: S,
    engine: E,
    settings: settings,
    play: function (idx) { return humanCanAct() && S.legalSet.has(idx) ? playMove(idx, S.current) : false; },
    // Load an arbitrary position (used by the automated feature tests to
    // reach pass/end-game situations quickly). Keeps current mode settings.
    setPosition: function (arr, current) {
      S.seq++;
      S.board.fill(EMPTY);
      for (var i = 0; i < 64 && i < arr.length; i++) S.board[i] = arr[i];
      S.current = current;
      S.over = false;
      S.busy = false;
      S.thinking = false;
      S.lastMove = -1;
      S.hoverIdx = -1;
      S.history.length = 0;
      S.started = true;
      anims.clear();
      hideToast();
      gameoverEl.classList.add("hidden");
      setupEl.classList.add("hidden");
      updateStatus();
      if (isAiTurn()) later(50, aiMove);
    },
    workerStatus: function () { return { active: !!worker, broken: workerBroken }; },
    getWorker: function () { return worker; },
  };

  // ----------------------------------------------------------------- boot ---
  // Show the initial position behind the setup panel.
  S.board[27] = WHITE; S.board[28] = BLACK;
  S.board[35] = BLACK; S.board[36] = WHITE;
  refreshSideLabels();
  refreshLegal();
  openSetup();
  updateStatus();
  statusEl.textContent = "Set up a game";
})();

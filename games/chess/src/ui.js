/*
 * ui.js — board rendering, input (click + drag), overlays, move list,
 * FEN panel, and the worker-driven AI opponent.
 */
(function () {
  "use strict";
  var E = window.ChessEngine;
  var Pieces = window.ChessPieces;
  var Sound = window.ChessSound;

  var LS_KEY = "arcade.chess.settings";

  // ---- DOM ------------------------------------------------------------------
  var $ = function (id) { return document.getElementById(id); };
  var canvas = $("board");
  var ctx = canvas.getContext("2d");
  var boardWrap = $("board-wrap");
  var statusEl = $("status");
  var thinkingEl = $("thinking");
  var thinkingText = $("thinking-text");
  var movelistEl = $("movelist");
  var setupEl = $("setup");
  var gameoverEl = $("gameover");
  var promoEl = $("promo");
  var promoChoices = $("promo-choices");
  var fenPanel = $("fen-panel");
  var fenInput = $("fen-input");
  var fenMsg = $("fen-msg");

  // ---- colors -----------------------------------------------------------------
  var COL_LIGHT = "#8d9aa9";
  var COL_DARK = "#3d4855";
  var COL_COORD_ON_LIGHT = "#3d4855";
  var COL_COORD_ON_DARK = "#8d9aa9";
  var COL_LAST = "rgba(226, 178, 88, 0.30)";
  var COL_SELECT = "rgba(226, 178, 88, 0.50)";
  var COL_DOT = "rgba(16, 20, 26, 0.38)";

  // ---- game state -----------------------------------------------------------
  var pos = null;
  var records = [];              // {move, san}
  var startSide = E.WHITE, startFullmove = 1;
  var baseCounts = null;         // piece counts at game start (for captured row)
  var mode = "ai";               // "ai" | "2p"
  var sidePref = "w";            // "w" | "b" | "r"
  var humanColor = E.WHITE;
  var level = 2;
  var flipped = false;
  var gameOver = null;           // gameStatus() result when over
  var lastStatus = null;

  var selected = -1;
  var legalTargets = [];
  var pendingPromo = null;       // {from, to, moves:[m,...]}
  var dragging = false, dragX = 0, dragY = 0, downSq = -1, wasSelectedOnDown = false;

  var worker = null, searchId = 0, thinking = false;

  // ---- settings --------------------------------------------------------------
  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
      if (typeof s.sound === "boolean") Sound.enabled = s.sound;
      if (s.level >= 1 && s.level <= 3) level = s.level | 0;
      if (s.mode === "ai" || s.mode === "2p") mode = s.mode;
      if (s.side === "w" || s.side === "b" || s.side === "r") sidePref = s.side;
    } catch (e) { /* ignore corrupt settings */ }
  }
  function saveSettings() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        sound: Sound.enabled, level: level, mode: mode, side: sidePref
      }));
    } catch (e) { /* storage may be unavailable */ }
  }

  // ---- worker ------------------------------------------------------------------
  function createWorker() {
    worker = new Worker("src/worker.js");
    worker.onmessage = function (e) {
      var msg = e.data;
      if (!msg || msg.id !== searchId) return; // stale search
      if (msg.type === "info") {
        thinkingText.textContent = "thinking d" + msg.depth;
        return;
      }
      if (msg.type === "result") {
        thinking = false;
        thinkingEl.classList.add("hidden");
        if (msg.from < 0) return;
        var m = E.findMove(pos, msg.from, msg.to, msg.promo || 0);
        if (m) commitMove(m);
        return;
      }
      if (msg.type === "error") {
        thinking = false;
        thinkingEl.classList.add("hidden");
      }
    };
  }
  function cancelSearch() {
    searchId++;
    if (thinking) {
      worker.terminate();
      createWorker();
      thinking = false;
      thinkingEl.classList.add("hidden");
    }
  }
  function maybeStartAi() {
    if (mode !== "ai" || gameOver || !pos || pos.side === humanColor) return;
    thinking = true;
    searchId++;
    thinkingText.textContent = "thinking";
    thinkingEl.classList.remove("hidden");
    var hashes = pos.hist.map(function (u) { return u.h1 + ":" + u.h2; });
    hashes.push(pos.h1 + ":" + pos.h2);
    worker.postMessage({
      type: "search", id: searchId,
      fen: E.toFen(pos), gameHashes: hashes, level: level
    });
  }

  // ---- board geometry ------------------------------------------------------------
  function squarePx() { return canvas.width / 8; }
  function squareToXY(s) {
    var f = E.fileOf(s), r = E.rankOf(s);
    var col = flipped ? 7 - f : f;
    var row = flipped ? r : 7 - r;
    var px = squarePx();
    return { x: col * px, y: row * px };
  }
  function pointToSquare(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    var scale = canvas.width / rect.width;
    var x = (clientX - rect.left) * scale;
    var y = (clientY - rect.top) * scale;
    var px = squarePx();
    var col = Math.floor(x / px), row = Math.floor(y / px);
    if (col < 0 || col > 7 || row < 0 || row > 7) return -1;
    var f = flipped ? 7 - col : col;
    var r = flipped ? row : 7 - row;
    return E.sq(f, r);
  }

  function resizeCanvas() {
    var w = boardWrap.clientWidth;
    var dpr = window.devicePixelRatio || 1;
    var size = Math.max(160, Math.round(w * dpr));
    size -= size % 8;
    if (canvas.width !== size) {
      canvas.width = size;
      canvas.height = size;
    }
    render();
  }

  // ---- rendering ---------------------------------------------------------------
  function render() {
    if (!pos) return;
    var px = squarePx();
    var lastMove = records.length ? records[records.length - 1].move : 0;
    var checkSq = lastStatus && lastStatus.check ? pos.kingSq[pos.side] : -1;

    for (var r = 0; r < 8; r++) {
      for (var f = 0; f < 8; f++) {
        var s = E.sq(f, r);
        var xy = squareToXY(s);
        var isLight = ((f + r) & 1) === 1;
        ctx.fillStyle = isLight ? COL_LIGHT : COL_DARK;
        ctx.fillRect(xy.x, xy.y, px, px);

        if (lastMove && (E.moveFrom(lastMove) === s || E.moveTo(lastMove) === s)) {
          ctx.fillStyle = COL_LAST;
          ctx.fillRect(xy.x, xy.y, px, px);
        }
        if (s === selected) {
          ctx.fillStyle = COL_SELECT;
          ctx.fillRect(xy.x, xy.y, px, px);
        }
        if (s === checkSq) {
          var g = ctx.createRadialGradient(
            xy.x + px / 2, xy.y + px / 2, px * 0.1,
            xy.x + px / 2, xy.y + px / 2, px * 0.65);
          g.addColorStop(0, "rgba(217, 83, 79, 0.85)");
          g.addColorStop(1, "rgba(217, 83, 79, 0)");
          ctx.fillStyle = g;
          ctx.fillRect(xy.x, xy.y, px, px);
        }
      }
    }

    // coordinates
    ctx.font = Math.round(px * 0.18) + "px ui-monospace, monospace";
    ctx.textBaseline = "top";
    for (var i = 0; i < 8; i++) {
      // rank numbers along the left column
      var rr = flipped ? i : 7 - i;
      var lightRank = ((flipped ? 7 : 0) + rr) & 1;
      ctx.fillStyle = lightRank === 1 ? COL_COORD_ON_LIGHT : COL_COORD_ON_DARK;
      ctx.textAlign = "left";
      ctx.fillText(String(rr + 1), 3, i * px + 3);
      // file letters along the bottom row
      var ff = flipped ? 7 - i : i;
      var lightFile = (ff + (flipped ? 7 : 0)) & 1;
      ctx.fillStyle = lightFile === 1 ? COL_COORD_ON_LIGHT : COL_COORD_ON_DARK;
      ctx.textAlign = "right";
      ctx.textBaseline = "alphabetic";
      ctx.fillText("abcdefgh"[ff], (i + 1) * px - 4, 8 * px - 5);
      ctx.textBaseline = "top";
    }

    // legal target markers
    for (var t = 0; t < legalTargets.length; t++) {
      var ts = legalTargets[t];
      var txy = squareToXY(ts);
      ctx.fillStyle = COL_DOT;
      ctx.strokeStyle = COL_DOT;
      if (pos.board[ts] !== E.EMPTY) {
        ctx.lineWidth = Math.max(2, px * 0.07);
        ctx.beginPath();
        ctx.arc(txy.x + px / 2, txy.y + px / 2, px * 0.44, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(txy.x + px / 2, txy.y + px / 2, px * 0.15, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // pieces
    var spritePx = Math.round(px);
    for (var s2 = 0; s2 < 128; s2++) {
      if (s2 & 0x88) continue;
      var p = pos.board[s2];
      if (p === E.EMPTY) continue;
      if (dragging && s2 === selected) continue;
      var pxy = squareToXY(s2);
      ctx.drawImage(Pieces.sprite(p, spritePx), pxy.x, pxy.y, px, px);
    }

    // dragged piece on top, slightly larger
    if (dragging && selected >= 0 && pos.board[selected] !== E.EMPTY) {
      var dp = pos.board[selected];
      var dsz = px * 1.08;
      ctx.drawImage(Pieces.sprite(dp, spritePx), dragX - dsz / 2, dragY - dsz / 2, dsz, dsz);
    }
  }

  // ---- status / panels ---------------------------------------------------------
  function updateStatus() {
    if (!pos) return;
    if (gameOver) {
      var msg;
      if (gameOver.reason === "checkmate") {
        var winner = gameOver.result === "1-0" ? E.WHITE : E.BLACK;
        msg = "Checkmate — " + (winner === E.WHITE ? "White" : "Black") + " wins";
        if (mode === "ai") msg = winner === humanColor ? "Checkmate — you win!" : "Checkmate — the computer wins";
      } else {
        msg = "Draw — " + gameOver.reason;
      }
      statusEl.innerHTML = "";
      statusEl.textContent = msg;
      return;
    }
    var base;
    if (mode === "ai") {
      base = pos.side === humanColor
        ? "Your move (" + (humanColor === E.WHITE ? "White" : "Black") + ")"
        : "Computer is moving…";
    } else {
      base = (pos.side === E.WHITE ? "White" : "Black") + " to move";
    }
    statusEl.innerHTML = "";
    statusEl.appendChild(document.createTextNode(base));
    if (lastStatus && lastStatus.check) {
      var chk = document.createElement("span");
      chk.className = "check";
      chk.textContent = " — check!";
      statusEl.appendChild(chk);
    }
  }

  function updateMoveList() {
    movelistEl.innerHTML = "";
    var num = startFullmove;
    var i = 0;
    var li;
    if (records.length && startSide === E.BLACK) {
      li = document.createElement("li");
      appendCell(li, num + ".", "num");
      appendCell(li, "…", "mv");
      appendCell(li, records[0].san, "mv" + (records.length === 1 ? " last" : ""));
      movelistEl.appendChild(li);
      num++;
      i = 1;
    }
    for (; i < records.length; i += 2) {
      li = document.createElement("li");
      appendCell(li, num + ".", "num");
      appendCell(li, records[i].san, "mv" + (i === records.length - 1 ? " last" : ""));
      if (i + 1 < records.length) {
        appendCell(li, records[i + 1].san, "mv" + (i + 1 === records.length - 1 ? " last" : ""));
      }
      movelistEl.appendChild(li);
      num++;
    }
    movelistEl.scrollTop = movelistEl.scrollHeight;
  }
  function appendCell(li, text, cls) {
    var span = document.createElement("span");
    span.className = cls;
    span.textContent = text;
    li.appendChild(span);
  }

  function countPieces() {
    var counts = {};
    for (var s = 0; s < 128; s++) {
      if (s & 0x88) continue;
      var p = pos.board[s];
      if (p !== E.EMPTY) counts[p] = (counts[p] || 0) + 1;
    }
    return counts;
  }
  function updateCaptured() {
    var now = countPieces();
    var rows = { 0: $("captured-white"), 1: $("captured-black") };
    rows[0].innerHTML = "";
    rows[1].innerHTML = "";
    var order = [E.QUEEN, E.ROOK, E.BISHOP, E.KNIGHT, E.PAWN];
    for (var c = 0; c < 2; c++) {
      for (var oi = 0; oi < order.length; oi++) {
        var piece = E.makePiece(order[oi], c);
        var missing = (baseCounts[piece] || 0) - (now[piece] || 0);
        for (var k = 0; k < missing; k++) {
          var img = document.createElement("canvas");
          img.width = 40; img.height = 40;
          img.getContext("2d").drawImage(Pieces.sprite(piece, 40), 0, 0);
          rows[c].appendChild(img);
        }
      }
    }
  }

  function refreshFenBox() {
    if (!fenPanel.classList.contains("hidden") && pos) fenInput.value = E.toFen(pos);
  }

  function refreshAll() {
    lastStatus = gameOver || E.gameStatus(pos);
    updateStatus();
    updateMoveList();
    updateCaptured();
    refreshFenBox();
    render();
  }

  // ---- game flow -----------------------------------------------------------------
  function newGameFrom(fen) {
    cancelSearch();
    pos = E.fromFen(fen);
    records = [];
    startSide = pos.side;
    startFullmove = pos.fullmove;
    baseCounts = countPieces();
    gameOver = null;
    selected = -1;
    legalTargets = [];
    pendingPromo = null;
    promoEl.classList.add("hidden");
    gameoverEl.classList.add("hidden");
    var st = E.gameStatus(pos);
    if (st.over) { gameOver = st; showGameOver(); }
    lastStatus = st;
    refreshAll();
    maybeStartAi();
  }

  function startFromSetup() {
    Sound.unlock();
    Sound.ui();
    if (mode === "ai") {
      humanColor = sidePref === "r" ? (Math.random() < 0.5 ? E.WHITE : E.BLACK)
        : (sidePref === "b" ? E.BLACK : E.WHITE);
      flipped = humanColor === E.BLACK;
    } else {
      flipped = false;
    }
    saveSettings();
    setupEl.classList.add("hidden");
    newGameFrom(E.START_FEN);
  }

  function showGameOver() {
    var title, reason = gameOver.reason;
    if (reason === "checkmate") {
      var winner = gameOver.result === "1-0" ? E.WHITE : E.BLACK;
      title = (winner === E.WHITE ? "White" : "Black") + " wins";
      if (mode === "ai") title = winner === humanColor ? "You win!" : "Computer wins";
      if (Sound.enabled) {
        if (mode === "ai") { if (winner === humanColor) Sound.win(); else Sound.lose(); }
        else Sound.win();
      }
    } else {
      title = "Draw";
      Sound.draw();
    }
    $("go-title").textContent = title;
    $("go-reason").textContent = reason === "checkmate" ? "by checkmate" : "by " + reason;
    gameoverEl.classList.remove("hidden");
  }

  function commitMove(m) {
    var sanStr = E.san(pos, m);
    var wasCapture = E.isCapture(m);
    var wasCastle = E.isCastle(m);
    var wasPromo = E.movePromo(m) !== 0;
    E.makeMove(pos, m);
    records.push({ move: m, san: sanStr });
    selected = -1;
    legalTargets = [];

    var st = E.gameStatus(pos);
    lastStatus = st;
    if (wasPromo) Sound.promote();
    else if (wasCastle) Sound.castle();
    else if (wasCapture) Sound.capture();
    else Sound.move();
    if (!st.over && st.check) Sound.check();

    if (st.over) {
      gameOver = st;
      showGameOver();
    }
    updateStatus();
    updateMoveList();
    updateCaptured();
    refreshFenBox();
    render();
    if (!st.over) maybeStartAi();
  }

  function tryMove(from, to) {
    var moves = E.legalMoves(pos).filter(function (m) {
      return E.moveFrom(m) === from && E.moveTo(m) === to;
    });
    if (moves.length === 0) return false;
    if (moves.length > 1) {
      // promotion — every variant differs only in promo piece
      pendingPromo = { from: from, to: to, moves: moves };
      openPromoPicker();
      render();
      return true;
    }
    commitMove(moves[0]);
    return true;
  }

  function openPromoPicker() {
    promoChoices.innerHTML = "";
    var color = pos.side;
    var order = [E.QUEEN, E.ROOK, E.BISHOP, E.KNIGHT];
    order.forEach(function (t) {
      var btn = document.createElement("button");
      var cv = document.createElement("canvas");
      cv.width = 80; cv.height = 80;
      cv.getContext("2d").drawImage(Pieces.sprite(E.makePiece(t, color), 80), 0, 0);
      btn.appendChild(cv);
      btn.addEventListener("click", function () {
        var pick = pendingPromo.moves.find(function (m) { return E.movePromo(m) === t; });
        pendingPromo = null;
        promoEl.classList.add("hidden");
        if (pick) commitMove(pick);
      });
      promoChoices.appendChild(btn);
    });
    promoEl.classList.remove("hidden");
  }
  function cancelPromo() {
    if (!pendingPromo) return;
    pendingPromo = null;
    promoEl.classList.add("hidden");
    selected = -1;
    legalTargets = [];
    render();
  }

  function undo() {
    if (!pos || records.length === 0) return;
    var wasThinking = thinking;
    cancelSearch();
    E.unmakeMove(pos);
    records.pop();
    // vs AI: undo the AI reply + the human move together so it's your turn again
    if (mode === "ai" && !wasThinking && pos.side !== humanColor && records.length) {
      E.unmakeMove(pos);
      records.pop();
    }
    gameOver = null;
    gameoverEl.classList.add("hidden");
    cancelPromo();
    selected = -1;
    legalTargets = [];
    Sound.ui();
    refreshAll();
    maybeStartAi();
  }

  // ---- input -----------------------------------------------------------------------
  function canInteract() {
    return pos && !gameOver && !pendingPromo &&
      setupEl.classList.contains("hidden") &&
      gameoverEl.classList.contains("hidden") &&
      (mode === "2p" || (pos.side === humanColor && !thinking));
  }

  function selectSquare(s) {
    var p = pos.board[s];
    if (p !== E.EMPTY && E.colorOf(p) === pos.side) {
      selected = s;
      legalTargets = E.legalMoves(pos)
        .filter(function (m) { return E.moveFrom(m) === s; })
        .map(function (m) { return E.moveTo(m); })
        .filter(function (v, i, arr) { return arr.indexOf(v) === i; });
      return true;
    }
    return false;
  }

  canvas.addEventListener("pointerdown", function (ev) {
    Sound.unlock();
    if (!canInteract()) return;
    var s = pointToSquare(ev.clientX, ev.clientY);
    if (s < 0) return;
    canvas.setPointerCapture(ev.pointerId);
    var rect = canvas.getBoundingClientRect();
    var scale = canvas.width / rect.width;
    dragX = (ev.clientX - rect.left) * scale;
    dragY = (ev.clientY - rect.top) * scale;
    downSq = s;
    wasSelectedOnDown = s === selected;

    if (selected >= 0 && legalTargets.indexOf(s) >= 0) {
      tryMove(selected, s);
      downSq = -1;
      return;
    }
    if (!selectSquare(s)) {
      selected = -1;
      legalTargets = [];
    }
    render();
  });

  canvas.addEventListener("pointermove", function (ev) {
    if (downSq < 0 || selected < 0) return;
    var rect = canvas.getBoundingClientRect();
    var scale = canvas.width / rect.width;
    var x = (ev.clientX - rect.left) * scale;
    var y = (ev.clientY - rect.top) * scale;
    if (!dragging) {
      var dist = Math.hypot(x - dragX, y - dragY);
      if (dist > squarePx() * 0.12) dragging = true;
    }
    if (dragging) {
      dragX = x; dragY = y;
      render();
    }
  });

  function endDrag(ev) {
    if (downSq < 0) return;
    var s = pointToSquare(ev.clientX, ev.clientY);
    if (dragging) {
      dragging = false;
      if (s >= 0 && selected >= 0 && legalTargets.indexOf(s) >= 0) {
        tryMove(selected, s);
      } else {
        if (s !== selected) Sound.illegal();
        render();
      }
    } else if (s >= 0 && s === downSq && wasSelectedOnDown) {
      // second click on the same piece deselects it
      selected = -1;
      legalTargets = [];
      render();
    }
    downSq = -1;
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", function () {
    dragging = false;
    downSq = -1;
    render();
  });

  // ---- toolbar / panels -----------------------------------------------------------
  function bindSeg(segId, get, set) {
    var seg = $(segId);
    var btns = seg.querySelectorAll("button");
    function paint() {
      btns.forEach(function (b) { b.classList.toggle("on", b.dataset.v === String(get())); });
    }
    btns.forEach(function (b) {
      b.addEventListener("click", function () {
        set(b.dataset.v);
        Sound.unlock();
        Sound.ui();
        paint();
        if (segId === "seg-mode") {
          $("opt-side").classList.toggle("hidden", mode !== "ai");
          $("opt-level").classList.toggle("hidden", mode !== "ai");
        }
      });
    });
    paint();
  }

  bindSeg("seg-mode", function () { return mode; }, function (v) { mode = v; });
  bindSeg("seg-side", function () { return sidePref; }, function (v) { sidePref = v; });
  bindSeg("seg-level", function () { return String(level); }, function (v) { level = parseInt(v, 10); });

  $("btn-start").addEventListener("click", startFromSetup);
  $("go-rematch").addEventListener("click", function () { startFromSetup(); });
  $("go-setup").addEventListener("click", function () {
    gameoverEl.classList.add("hidden");
    setupEl.classList.remove("hidden");
  });

  $("btn-new").addEventListener("click", function () {
    Sound.unlock(); Sound.ui();
    cancelSearch();
    gameoverEl.classList.add("hidden");
    setupEl.classList.remove("hidden");
  });
  $("btn-undo").addEventListener("click", undo);
  $("btn-flip").addEventListener("click", function () {
    flipped = !flipped;
    Sound.ui();
    render();
  });
  $("btn-fen").addEventListener("click", function () {
    fenPanel.classList.toggle("hidden");
    fenMsg.textContent = "";
    refreshFenBox();
  });
  var soundBtn = $("btn-sound");
  function paintSound() { soundBtn.textContent = "Sound: " + (Sound.enabled ? "on" : "off"); }
  soundBtn.addEventListener("click", function () {
    Sound.enabled = !Sound.enabled;
    Sound.unlock();
    saveSettings();
    paintSound();
    if (Sound.enabled) Sound.ui();
  });

  $("fen-copy").addEventListener("click", function () {
    fenInput.value = E.toFen(pos);
    fenInput.select();
    try {
      navigator.clipboard.writeText(fenInput.value);
      fenMsg.textContent = "copied";
      fenMsg.className = "ok";
    } catch (e) {
      fenMsg.textContent = "select + copy manually";
      fenMsg.className = "";
    }
  });
  $("fen-load").addEventListener("click", function () {
    try {
      var fen = fenInput.value.trim();
      E.fromFen(fen); // validate first
      setupEl.classList.add("hidden");
      newGameFrom(fen);
      fenMsg.textContent = "position loaded";
      fenMsg.className = "ok";
    } catch (err) {
      fenMsg.textContent = String(err.message || err);
      fenMsg.className = "err";
      Sound.illegal();
    }
  });

  // ---- keyboard -----------------------------------------------------------------
  document.addEventListener("keydown", function (ev) {
    if (ev.target === fenInput) {
      if (ev.key === "Enter") $("fen-load").click();
      if (ev.key === "Escape") fenPanel.classList.add("hidden");
      return;
    }
    switch (ev.key) {
      case "Enter":
        if (gameOver && !gameoverEl.classList.contains("hidden")) startFromSetup();
        else if (!setupEl.classList.contains("hidden")) startFromSetup();
        break;
      case "u": case "U": undo(); break;
      case "f": case "F": flipped = !flipped; render(); break;
      case "n": case "N": $("btn-new").click(); break;
      case "s": case "S": soundBtn.click(); break;
      case "Escape": cancelPromo(); fenPanel.classList.add("hidden"); break;
    }
  });

  // ---- boot ------------------------------------------------------------------------
  loadSettings();
  paintSound();
  $("opt-side").classList.toggle("hidden", mode !== "ai");
  $("opt-level").classList.toggle("hidden", mode !== "ai");
  // repaint segs to reflect loaded settings
  document.querySelectorAll("#seg-mode button").forEach(function (b) { b.classList.toggle("on", b.dataset.v === mode); });
  document.querySelectorAll("#seg-side button").forEach(function (b) { b.classList.toggle("on", b.dataset.v === sidePref); });
  document.querySelectorAll("#seg-level button").forEach(function (b) { b.classList.toggle("on", b.dataset.v === String(level)); });

  createWorker();
  pos = E.fromFen(E.START_FEN);
  baseCounts = countPieces();
  lastStatus = E.gameStatus(pos);
  resizeCanvas();
  if (window.ResizeObserver) {
    new ResizeObserver(function () { resizeCanvas(); }).observe(boardWrap);
  } else {
    window.addEventListener("resize", resizeCanvas);
  }
})();

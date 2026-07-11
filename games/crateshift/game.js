/* Crateshift — push-the-crates puzzle for the Claude Arcade.
 *
 * Logic is instant (a keypress mutates the grid state immediately); rendering
 * tweens each entity toward its logical cell over STEP_MS. There is no
 * tick-rate-dependent physics — held-key repeat and animation both run off
 * wall-clock timestamps, so behavior is frame-rate independent.
 */
"use strict";

(() => {
  // ---------- constants ----------
  const STEP_MS = 110;      // tween length of one step
  const HOLD_DELAY = 200;   // hold-to-repeat: initial delay...
  const REPEAT_MS = 110;    // ...then one step per interval
  const WIN_DELAY = 260;    // let the last push finish before the overlay
  const NS = "arcade.crateshift.";

  const DIR = {
    up:    { dx: 0, dy: -1 },
    down:  { dx: 0, dy: 1 },
    left:  { dx: -1, dy: 0 },
    right: { dx: 1, dy: 0 },
  };
  const KEY_DIRS = {
    ArrowUp: "up", KeyW: "up",
    ArrowDown: "down", KeyS: "down",
    ArrowLeft: "left", KeyA: "left",
    ArrowRight: "right", KeyD: "right",
  };

  // ---------- storage ----------
  const store = {
    get(k, fallback) {
      try {
        const v = localStorage.getItem(NS + k);
        return v === null ? fallback : JSON.parse(v);
      } catch { return fallback; }
    },
    set(k, v) {
      try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch { /* private mode */ }
    },
  };
  const bestOf = (i) => store.get("best." + i, null);
  const isUnlocked = (i) => i === 0 || bestOf(i - 1) !== null;
  const starsFor = (lv, moves) =>
    moves <= lv.par ? 3 : moves <= Math.ceil(lv.par * 1.6) ? 2 : 1;

  // ---------- audio (all synthesized, created after a user gesture) ----------
  let audioOn = store.get("audio", true);
  let actx = null;
  let master = null;

  function ensureAudio() {
    if (!audioOn) return null;
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
      master = actx.createGain();
      master.gain.value = 0.5;
      master.connect(actx.destination);
    }
    if (actx.state === "suspended") actx.resume();
    return actx;
  }

  function blip(freq, dur, { type = "square", gain = 0.14, at = 0, slide = 0 } = {}) {
    if (!ensureAudio()) return;
    const t0 = actx.currentTime + at;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function thud(dur = 0.09, { gain = 0.3, cutoff = 420, at = 0 } = {}) {
    if (!ensureAudio()) return;
    const t0 = actx.currentTime + at;
    const n = Math.floor(actx.sampleRate * dur);
    const buf = actx.createBuffer(1, n, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = actx.createBufferSource();
    src.buffer = buf;
    const f = actx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = cutoff;
    const g = actx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t0);
  }

  const sfx = {
    step()     { blip(190, 0.045, { type: "triangle", gain: 0.08 }); },
    bump()     { thud(0.035, { gain: 0.07, cutoff: 300 }); },
    push()     { thud(0.09, { gain: 0.26 }); blip(85, 0.09, { type: "sine", gain: 0.18 }); },
    goal()     { blip(660, 0.09, { gain: 0.12 }); blip(880, 0.12, { gain: 0.12, at: 0.07 }); },
    ungoal()   { blip(340, 0.07, { type: "triangle", gain: 0.07 }); },
    deadlock() { blip(120, 0.18, { type: "sawtooth", gain: 0.1, slide: -40 }); },
    undo()     { blip(320, 0.08, { type: "triangle", gain: 0.1, slide: -140 }); },
    ui()       { blip(420, 0.035, { type: "triangle", gain: 0.06 }); },
    win() {
      [523, 659, 784, 1046].forEach((f, i) =>
        blip(f, 0.16, { type: "triangle", gain: 0.13, at: i * 0.09 }));
    },
  };

  function setAudio(on) {
    audioOn = on;
    store.set("audio", on);
    audioBtn.textContent = "sound: " + (on ? "on" : "off");
  }

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const selectView = $("select");
  const playView = $("play");
  const levelGrid = $("level-grid");
  const totalStarsEl = $("total-stars");
  const audioBtn = $("audio-toggle");
  const canvas = $("game");
  const ctx = canvas.getContext("2d");
  const overlay = $("overlay");
  const hud = {
    level: $("hud-level"), moves: $("hud-moves"), pushes: $("hud-pushes"),
    par: $("hud-par"), best: $("hud-best"),
  };
  const ov = { title: $("overlay-title"), stars: $("overlay-stars"),
               stats: $("overlay-stats"), sub: $("overlay-sub") };

  // ---------- level model ----------
  let view = "select";       // "select" | "play"
  let cursor = store.get("level", 0); // level-select cursor / current level
  let L = null;              // active level state

  function parseLevel(i) {
    const def = LEVELS[i];
    const rows = def.map;
    const h = rows.length;
    const w = Math.max(...rows.map((r) => r.length));
    const wall = new Set();
    const targets = new Set();
    const crates = [];
    let player = null;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = x < rows[y].length ? rows[y][x] : " ";
        const k = x + "," + y;
        if (c === "#") wall.add(k);
        if (c === "." || c === "*" || c === "+") targets.add(k);
        if (c === "$" || c === "*") crates.push({ x, y, ax: x, ay: y, fx: x, fy: y, t0: 0 });
        if (c === "@" || c === "+") player = { x, y, ax: x, ay: y, fx: x, fy: y, t0: 0, face: "down" };
      }
    }
    // interior floor: flood fill from the worker
    const floor = new Set();
    const stack = [player.x + "," + player.y];
    while (stack.length) {
      const k = stack.pop();
      if (floor.has(k) || wall.has(k)) continue;
      floor.add(k);
      const [x, y] = k.split(",").map(Number);
      for (const d of Object.values(DIR)) {
        const nx = x + d.dx, ny = y + d.dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) stack.push(nx + "," + ny);
      }
    }
    // static corner cells (non-target floor boxed on two perpendicular sides)
    const corners = new Set();
    for (const k of floor) {
      if (targets.has(k)) continue;
      const [x, y] = k.split(",").map(Number);
      const solid = (xx, yy) => wall.has(xx + "," + yy) || !floor.has(xx + "," + yy);
      const vert = solid(x, y - 1) || solid(x, y + 1);
      const horz = solid(x - 1, y) || solid(x + 1, y);
      if (vert && horz) corners.add(k);
    }
    return {
      index: i, def, w, h, wall, targets, floor, crates, player, corners,
      history: [], solved: false, winAt: 0,
    };
  }

  const crateAt = (x, y) => L.crates.find((c) => c.x === x && c.y === y) || null;
  const isWall = (x, y) => L.wall.has(x + "," + y) || !L.floor.has(x + "," + y);
  const onTarget = (c) => L.targets.has(c.x + "," + c.y);
  const inCorner = (c) => L.corners.has(c.x + "," + c.y);
  const movesCount = () => L.history.length;
  const pushesCount = () => L.history.reduce((n, e) => n + (e.crate ? 1 : 0), 0);

  // ---------- movement ----------
  function beginTween(e, fromX, fromY) {
    e.fx = fromX; e.fy = fromY; e.t0 = performance.now();
  }

  function tryMove(dirName) {
    if (!L || L.solved) return;
    const d = DIR[dirName];
    L.player.face = dirName;
    const nx = L.player.x + d.dx, ny = L.player.y + d.dy;
    if (isWall(nx, ny)) { sfx.bump(); return; }
    const crate = crateAt(nx, ny);
    const entry = { px: L.player.x, py: L.player.y, crate: null };
    if (crate) {
      // push exactly one crate, only if the cell beyond it is free
      const bx = nx + d.dx, by = ny + d.dy;
      if (isWall(bx, by) || crateAt(bx, by)) { sfx.bump(); return; }
      const wasOn = onTarget(crate);
      entry.crate = { ref: crate, fx: crate.x, fy: crate.y, tx: bx, ty: by };
      beginTween(crate, crate.x, crate.y);
      crate.x = bx; crate.y = by;
      sfx.push();
      if (onTarget(crate) && !wasOn) sfx.goal();
      else if (!onTarget(crate) && wasOn) sfx.ungoal();
      else if (inCorner(crate)) sfx.deadlock();
    } else {
      sfx.step();
    }
    beginTween(L.player, L.player.x, L.player.y);
    L.player.x = nx; L.player.y = ny;
    L.history.push(entry);
    updateHud();
    checkWin();
  }

  function undo() {
    if (!L || L.solved || !L.history.length) return;
    const e = L.history.pop();
    beginTween(L.player, L.player.x, L.player.y);
    L.player.x = e.px; L.player.y = e.py;
    if (e.crate) {
      const c = e.crate.ref;
      beginTween(c, c.x, c.y);
      c.x = e.crate.fx; c.y = e.crate.fy;
    }
    sfx.undo();
    updateHud();
  }

  function checkWin() {
    if (!L.crates.every(onTarget)) return;
    L.solved = true;
    L.winAt = performance.now();
    held.length = 0;
    const moves = movesCount(), pushes = pushesCount();
    const stars = starsFor(L.def, moves);
    const prev = bestOf(L.index);
    if (!prev || moves < prev.m) store.set("best." + L.index, { m: moves, p: pushes, s: stars });
    store.set("level", Math.min(L.index + 1, LEVELS.length - 1));
    sfx.win();
    setTimeout(showWinOverlay, WIN_DELAY);
  }

  function showWinOverlay() {
    if (!L || !L.solved) return;
    const moves = movesCount(), pushes = pushesCount();
    const stars = starsFor(L.def, moves);
    const best = bestOf(L.index);
    ov.title.textContent = "SHIFT CLEAR";
    ov.stars.innerHTML =
      "★".repeat(stars) + '<span class="off">' + "★".repeat(3 - stars) + "</span>";
    ov.stats.textContent =
      `${moves} moves · ${pushes} pushes · par ${L.def.par}` +
      (best ? `\nbest ${best.m} moves` : "");
    ov.sub.textContent = L.index < LEVELS.length - 1
      ? "N next · R replay · Esc shifts"
      : "R replay · Esc shifts — all shifts done!";
    overlay.classList.remove("hidden");
  }

  // ---------- level flow ----------
  function loadLevel(i) {
    cursor = i;
    L = parseLevel(i);
    store.set("level", i);
    overlay.classList.add("hidden");
    held.length = 0;
    sizeCanvas();
    updateHud();
  }

  function gotoLevel(i) {
    if (i < 0 || i >= LEVELS.length || !isUnlocked(i)) { sfx.bump(); return; }
    sfx.ui();
    loadLevel(i);
  }

  function updateHud() {
    hud.level.textContent = (L.index + 1) + " · " + L.def.name;
    hud.moves.textContent = movesCount();
    hud.pushes.textContent = pushesCount();
    hud.par.textContent = L.def.par;
    const b = bestOf(L.index);
    hud.best.textContent = b ? b.m + " " + "★".repeat(b.s) : "—";
  }

  function showSelect() {
    view = "select";
    playView.classList.add("hidden");
    selectView.classList.remove("hidden");
    renderSelect();
  }

  function showPlay(i) {
    view = "play";
    selectView.classList.add("hidden");
    playView.classList.remove("hidden");
    loadLevel(i);
  }

  // ---------- level select ----------
  function renderSelect() {
    let total = 0;
    levelGrid.innerHTML = "";
    LEVELS.forEach((lv, i) => {
      const best = bestOf(i);
      if (best) total += best.s;
      const unlocked = isUnlocked(i);
      const card = document.createElement("button");
      card.type = "button";
      card.className = "level-card" + (unlocked ? "" : " locked") + (i === cursor ? " cursor" : "");
      const stars = best
        ? "★".repeat(best.s) + '<span class="off">' + "★".repeat(3 - best.s) + "</span>"
        : '<span class="off">★★★</span>';
      card.innerHTML =
        `<span class="row1"><span>#${String(i + 1).padStart(2, "0")}</span>` +
        `<span class="stars">${stars}</span></span>` +
        `<span class="name">${unlocked ? lv.name : "locked"}</span>` +
        `<span class="row3"><span>par ${lv.par}</span>` +
        `<span>${best ? 'best <span class="best-val">' + best.m + "</span>" : "—"}</span></span>`;
      if (unlocked) card.addEventListener("click", () => showPlay(i));
      levelGrid.appendChild(card);
    });
    totalStarsEl.textContent = "★ " + total + "/" + LEVELS.length * 3;
    const cur = levelGrid.children[cursor];
    if (cur) cur.scrollIntoView({ block: "nearest" });
  }

  function moveCursor(delta) {
    const cols = getComputedStyle(levelGrid).gridTemplateColumns.split(" ").length;
    let next = cursor + (delta === "left" ? -1 : delta === "right" ? 1 :
                         delta === "up" ? -cols : cols);
    next = Math.max(0, Math.min(LEVELS.length - 1, next));
    if (next !== cursor) { cursor = next; sfx.ui(); renderSelect(); }
  }

  // ---------- input ----------
  const held = []; // stack of held direction names, most recent last
  let holdStart = 0;
  let lastRepeat = 0;

  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    ensureAudio(); // user gesture: safe to (lazily) start audio

    if (e.code === "KeyM") { setAudio(!audioOn); e.preventDefault(); return; }

    if (view === "select") {
      const dir = KEY_DIRS[e.code];
      if (dir && !e.repeat) { moveCursor(dir); e.preventDefault(); }
      else if (e.code === "Enter" || e.code === "Space") {
        if (isUnlocked(cursor)) showPlay(cursor); else sfx.bump();
        e.preventDefault();
      }
      return;
    }

    // ---- play view ----
    if (e.code === "Escape") { showSelect(); e.preventDefault(); return; }
    if (e.code === "KeyR") { sfx.ui(); loadLevel(L.index); e.preventDefault(); return; }
    if (e.code === "KeyN" || (L.solved && e.code === "Enter")) {
      gotoLevel(L.index + 1); e.preventDefault(); return;
    }
    if (e.code === "KeyP") { gotoLevel(L.index - 1); e.preventDefault(); return; }
    if (e.code === "KeyU" || e.code === "KeyZ") { undo(); e.preventDefault(); return; }

    const dir = KEY_DIRS[e.code];
    if (dir) {
      e.preventDefault();
      if (e.repeat) return; // our own repeat timing, not the OS's
      const idx = held.indexOf(dir);
      if (idx !== -1) held.splice(idx, 1);
      held.push(dir);
      holdStart = performance.now();
      lastRepeat = holdStart;
      tryMove(dir);
    }
  });

  window.addEventListener("keyup", (e) => {
    const dir = KEY_DIRS[e.code];
    if (dir) {
      const idx = held.indexOf(dir);
      if (idx !== -1) held.splice(idx, 1);
      if (held.length) holdStart = performance.now(); // re-arm delay for the survivor
    }
  });

  // real-time-ish input: drop held keys when the page loses focus
  window.addEventListener("blur", () => { held.length = 0; });

  audioBtn.addEventListener("click", () => { ensureAudio(); setAudio(!audioOn); });

  // ---------- rendering ----------
  let tile = 40;
  let dpr = 1;

  function sizeCanvas() {
    if (!L) return;
    dpr = window.devicePixelRatio || 1;
    const availW = Math.min(window.innerWidth - 32, 920);
    const availH = Math.max(window.innerHeight - 230, 240);
    tile = Math.max(18, Math.min(52, Math.floor(Math.min(availW / L.w, availH / L.h))));
    canvas.style.width = L.w * tile + "px";
    canvas.style.height = L.h * tile + "px";
    canvas.width = Math.round(L.w * tile * dpr);
    canvas.height = Math.round(L.h * tile * dpr);
  }
  window.addEventListener("resize", sizeCanvas);

  const hash = (x, y) => {
    let n = (x * 374761393 + y * 668265263) ^ 88339;
    n = (n ^ (n >> 13)) * 1274126177;
    return ((n ^ (n >> 16)) >>> 0) / 4294967296;
  };

  const ease = (t) => t * (2 - t); // ease-out quad

  function animPos(e, now) {
    const t = Math.min(1, Math.max(0, (now - e.t0) / STEP_MS));
    const k = ease(t);
    e.ax = e.fx + (e.x - e.fx) * k;
    e.ay = e.fy + (e.y - e.fy) * k;
    return e;
  }

  function drawFloor(x, y) {
    const px = x * tile, py = y * tile;
    const v = hash(x, y);
    const l = 8 + v * 3.5;
    ctx.fillStyle = `hsl(220, 14%, ${l}%)`;
    ctx.fillRect(px, py, tile, tile);
    // plank seams
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, py + 0.5);
    ctx.lineTo(px + tile, py + 0.5);
    ctx.stroke();
    const seam = px + tile * (0.25 + ((x * 7 + y * 13) % 5) * 0.125);
    ctx.strokeStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath();
    ctx.moveTo(seam + 0.5, py + 2);
    ctx.lineTo(seam + 0.5, py + tile - 2);
    ctx.stroke();
  }

  function drawTarget(x, y, now) {
    const px = x * tile, py = y * tile;
    const inset = tile * 0.18;
    const s = tile - inset * 2;
    const pulse = 0.55 + 0.2 * Math.sin(now / 480 + (x + y));
    ctx.save();
    ctx.strokeStyle = `rgba(240, 179, 94, ${pulse})`;
    ctx.lineWidth = Math.max(1.5, tile * 0.045);
    ctx.setLineDash([tile * 0.14, tile * 0.1]);
    ctx.strokeRect(px + inset, py + inset, s, s);
    ctx.setLineDash([]);
    // center diamond
    const cx = px + tile / 2, cy = py + tile / 2, r = tile * 0.08;
    ctx.fillStyle = `rgba(240, 179, 94, ${pulse * 0.8})`;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawWall(x, y) {
    const px = x * tile, py = y * tile;
    const v = hash(x * 3 + 1, y * 5 + 2);
    const base = 16 + v * 4;
    ctx.fillStyle = `hsl(219, 18%, ${base}%)`;
    ctx.fillRect(px, py, tile, tile);
    // bevel
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fillRect(px, py, tile, Math.max(2, tile * 0.09));
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(px, py + tile - Math.max(2, tile * 0.11), tile, Math.max(2, tile * 0.11));
    // mortar
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, tile - 1, tile - 1);
    const off = (y % 2) ? tile * 0.5 : tile * 0.28;
    ctx.beginPath();
    ctx.moveTo(px + off + 0.5, py + tile * 0.5);
    ctx.lineTo(px + off + 0.5, py + tile);
    ctx.stroke();
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

  function drawCrate(c, now) {
    animPos(c, now);
    const goal = onTarget(c);
    const dead = !goal && inCorner(c);
    const px = c.ax * tile, py = c.ay * tile;
    const inset = tile * 0.08;
    const s = tile - inset * 2;
    ctx.save();
    if (goal) {
      const pulse = 0.5 + 0.25 * Math.sin(now / 300);
      ctx.shadowColor = `rgba(240, 179, 94, ${pulse})`;
      ctx.shadowBlur = tile * 0.45;
    }
    // body
    const wood = goal ? "#a97a3d" : dead ? "#6e3a34" : "#8a5f31";
    const woodDark = goal ? "#7d5527" : dead ? "#4c2622" : "#5f3f1e";
    const grad = ctx.createLinearGradient(px, py + inset, px, py + inset + s);
    grad.addColorStop(0, wood);
    grad.addColorStop(1, woodDark);
    ctx.fillStyle = grad;
    roundRect(px + inset, py + inset, s, s, tile * 0.08);
    ctx.fill();
    ctx.shadowBlur = 0;
    // frame + cross braces
    ctx.strokeStyle = dead ? "rgba(255, 93, 93, 0.9)"
      : goal ? "rgba(240, 179, 94, 0.95)" : "rgba(0,0,0,0.55)";
    ctx.lineWidth = Math.max(1.5, tile * 0.055);
    roundRect(px + inset, py + inset, s, s, tile * 0.08);
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = Math.max(1, tile * 0.04);
    const m = inset + tile * 0.06;
    ctx.beginPath();
    ctx.moveTo(px + m, py + m); ctx.lineTo(px + tile - m, py + tile - m);
    ctx.moveTo(px + tile - m, py + m); ctx.lineTo(px + m, py + tile - m);
    ctx.stroke();
    // bolts
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    const b = tile * 0.05;
    for (const [ox, oy] of [[m, m], [tile - m, m], [m, tile - m], [tile - m, tile - m]]) {
      ctx.beginPath();
      ctx.arc(px + ox, py + oy, b, 0, Math.PI * 2);
      ctx.fill();
    }
    if (dead) {
      ctx.fillStyle = "rgba(255, 93, 93, 0.14)";
      roundRect(px + inset, py + inset, s, s, tile * 0.08);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPlayer(now) {
    const p = animPos(L.player, now);
    const px = p.ax * tile, py = p.ay * tile;
    const cx = px + tile / 2, cy = py + tile / 2;
    const d = DIR[p.face];
    ctx.save();
    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(cx, py + tile * 0.82, tile * 0.26, tile * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    // body (coveralls)
    ctx.fillStyle = "#3d8fb0";
    roundRect(cx - tile * 0.21, cy - tile * 0.1, tile * 0.42, tile * 0.42, tile * 0.12);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1;
    ctx.stroke();
    // head
    ctx.fillStyle = "#d9b48a";
    ctx.beginPath();
    ctx.arc(cx, cy - tile * 0.18, tile * 0.17, 0, Math.PI * 2);
    ctx.fill();
    // hard hat
    ctx.fillStyle = "#f0b35e";
    ctx.beginPath();
    ctx.arc(cx, cy - tile * 0.2, tile * 0.18, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(cx - tile * 0.2, cy - tile * 0.22, tile * 0.4, tile * 0.045);
    // eyes toward facing
    ctx.fillStyle = "#1c1f26";
    const ex = d.dx * tile * 0.05, ey = Math.max(0, d.dy) * tile * 0.03;
    ctx.beginPath();
    ctx.arc(cx - tile * 0.06 + ex, cy - tile * 0.16 + ey, tile * 0.025, 0, Math.PI * 2);
    ctx.arc(cx + tile * 0.06 + ex, cy - tile * 0.16 + ey, tile * 0.025, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function draw(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, L.w * tile, L.h * tile);
    for (let y = 0; y < L.h; y++) {
      for (let x = 0; x < L.w; x++) {
        const k = x + "," + y;
        if (L.floor.has(k)) {
          drawFloor(x, y);
          if (L.targets.has(k)) drawTarget(x, y, now);
        } else if (L.wall.has(k)) {
          // only draw walls that border the interior (cleaner silhouette)
          let borders = false;
          for (let oy = -1; oy <= 1 && !borders; oy++)
            for (let ox = -1; ox <= 1 && !borders; ox++)
              if (L.floor.has((x + ox) + "," + (y + oy))) borders = true;
          if (borders) drawWall(x, y);
        }
      }
    }
    for (const c of L.crates) drawCrate(c, now);
    drawPlayer(now);
  }

  // ---------- main loop (rendering + timestamp-based input repeat) ----------
  function frame(now) {
    if (view === "play" && L) {
      if (held.length && !L.solved &&
          now - holdStart >= HOLD_DELAY && now - lastRepeat >= REPEAT_MS) {
        lastRepeat = now;
        tryMove(held[held.length - 1]);
      }
      draw(now);
    }
    requestAnimationFrame(frame);
  }

  // ---------- boot ----------
  setAudio(audioOn);
  cursor = Math.max(0, Math.min(LEVELS.length - 1, cursor | 0));
  while (cursor > 0 && !isUnlocked(cursor)) cursor--;
  showSelect();
  requestAnimationFrame(frame);
})();

// Dowser — a hidden-hazard grid puzzle. Dig every safe plot; don't break a hollow.
import { Synth } from "./audio.js";

// ---------------------------------------------------------------- constants

const PRESETS = {
  seedplot:  { cols: 9,  rows: 9,  hollows: 10, label: "Seedplot" },
  meadow:    { cols: 16, rows: 16, hollows: 40, label: "Meadow" },
  longfield: { cols: 30, rows: 16, hollows: 99, label: "Longfield" },
};
const PRESET_KEYS = Object.keys(PRESETS);

const LS = {
  preset: "arcade.dowser.preset",
  sound: "arcade.dowser.sound",
  best: (p) => `arcade.dowser.best.${p}`,
};

const NUMBER_COLORS = [
  null,
  "#7aa2f7", // 1 blue
  "#9ece6a", // 2 green
  "#f7768e", // 3 red
  "#bb9af7", // 4 purple
  "#e0af68", // 5 amber
  "#73daca", // 6 teal
  "#f2d9a4", // 7 pale gold
  "#a9b1d6", // 8 gray-violet
];

const TICK = 1 / 30; // fixed logic timestep (seconds)
const LONG_PRESS_MS = 380;

// ---------------------------------------------------------------- dom

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const hollowCountEl = document.getElementById("hollow-count");
const timerEl = document.getElementById("timer");
const bestEl = document.getElementById("best");
const bannerEl = document.getElementById("banner");
const bannerText = document.getElementById("banner-text");
const bannerSub = document.getElementById("banner-sub");
const newfieldBtn = document.getElementById("newfield");
const soundBtn = document.getElementById("sound-toggle");
const introEl = document.getElementById("intro");
const presetBtns = [...document.querySelectorAll(".preset")];

const synth = new Synth(LS.sound);

// ---------------------------------------------------------------- state

const game = {
  presetKey: PRESETS[localStorage.getItem(LS.preset)] ? localStorage.getItem(LS.preset) : "seedplot",
  cols: 0,
  rows: 0,
  hollows: 0,
  hazard: null,    // Uint8Array — 1 = hollow underneath
  count: null,     // Uint8Array — adjacent hollow count
  revealed: null,  // Uint8Array
  flagged: null,   // Uint8Array
  state: "idle",   // idle | playing | won | lost
  seeded: false,   // hazards placed yet?
  revealedCount: 0,
  flagCount: 0,
  burstAt: -1,     // index of the hollow that ended the run
  time: 0,         // seconds, fixed-step accumulated
  paused: false,   // window blur pause
  hover: -1,       // hovered cell index (mouse only)
  newBest: false,
};

let cellPx = 30;

// ---------------------------------------------------------------- board core

const idx = (r, c) => r * game.cols + c;
const inBounds = (r, c) => r >= 0 && r < game.rows && c >= 0 && c < game.cols;

function* neighbors(r, c) {
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (inBounds(nr, nc)) yield [nr, nc];
    }
  }
}

function newGame(presetKey = game.presetKey) {
  const p = PRESETS[presetKey];
  game.presetKey = presetKey;
  localStorage.setItem(LS.preset, presetKey);
  game.cols = p.cols;
  game.rows = p.rows;
  game.hollows = p.hollows;
  const n = p.cols * p.rows;
  game.hazard = new Uint8Array(n);
  game.count = new Uint8Array(n);
  game.revealed = new Uint8Array(n);
  game.flagged = new Uint8Array(n);
  game.state = "idle";
  game.seeded = false;
  game.revealedCount = 0;
  game.flagCount = 0;
  game.burstAt = -1;
  game.time = 0;
  game.hover = -1;
  game.newBest = false;
  hideBanner();
  syncPresetButtons();
  updateBest();
  updateHud();
  fitCanvas();
  draw();
}

// Hazards are placed only after the first dig: the first-clicked cell and all
// of its 8 neighbors are guaranteed clear.
function seedHazards(safeR, safeC) {
  const n = game.cols * game.rows;
  const excluded = new Set([idx(safeR, safeC)]);
  for (const [nr, nc] of neighbors(safeR, safeC)) excluded.add(idx(nr, nc));

  const pool = [];
  for (let i = 0; i < n; i++) if (!excluded.has(i)) pool.push(i);
  // Fisher–Yates, take the first `hollows` entries.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const placed = Math.min(game.hollows, pool.length);
  for (let k = 0; k < placed; k++) game.hazard[pool[k]] = 1;

  for (let r = 0; r < game.rows; r++) {
    for (let c = 0; c < game.cols; c++) {
      if (game.hazard[idx(r, c)]) continue;
      let count = 0;
      for (const [nr, nc] of neighbors(r, c)) count += game.hazard[idx(nr, nc)];
      game.count[idx(r, c)] = count;
    }
  }
  game.seeded = true;
}

// Reveal a cell. Zero-count cells flood-fill outward (BFS); numbered cells
// stop the fill. Returns the number of cells revealed (0 if nothing happened,
// -1 if a hollow burst).
function reveal(r, c) {
  const i = idx(r, c);
  if (game.revealed[i] || game.flagged[i]) return 0;
  if (game.hazard[i]) {
    game.burstAt = i;
    lose();
    return -1;
  }
  let opened = 0;
  const queue = [[r, c]];
  game.revealed[i] = 1;
  opened++;
  while (queue.length) {
    const [qr, qc] = queue.shift();
    if (game.count[idx(qr, qc)] !== 0) continue; // numbers stop the fill
    for (const [nr, nc] of neighbors(qr, qc)) {
      const ni = idx(nr, nc);
      if (game.revealed[ni] || game.flagged[ni] || game.hazard[ni]) continue;
      game.revealed[ni] = 1;
      opened++;
      queue.push([nr, nc]);
    }
  }
  game.revealedCount += opened;
  return opened;
}

// Chord: on a revealed number whose adjacent flags equal its value, reveal
// all remaining hidden, unflagged neighbors. Mis-flagged chords can burst.
function chord(r, c) {
  const i = idx(r, c);
  const need = game.count[i];
  if (!game.revealed[i] || need === 0) return 0;
  let flags = 0;
  for (const [nr, nc] of neighbors(r, c)) flags += game.flagged[idx(nr, nc)];
  if (flags !== need) return 0;
  let opened = 0;
  for (const [nr, nc] of neighbors(r, c)) {
    const ni = idx(nr, nc);
    if (game.revealed[ni] || game.flagged[ni]) continue;
    const res = reveal(nr, nc);
    if (res === -1) return -1;
    opened += res;
  }
  return opened;
}

function toggleFlag(r, c) {
  const i = idx(r, c);
  if (game.revealed[i]) return false;
  game.flagged[i] = game.flagged[i] ? 0 : 1;
  game.flagCount += game.flagged[i] ? 1 : -1;
  return true;
}

// Win: every non-hazard cell revealed. Flags are irrelevant.
function checkWin() {
  if (game.revealedCount === game.cols * game.rows - game.hollows) {
    game.state = "won";
    const secs = Math.floor(game.time);
    const prev = Number(localStorage.getItem(LS.best(game.presetKey)));
    if (!Number.isFinite(prev) || prev <= 0 || secs < prev) {
      localStorage.setItem(LS.best(game.presetKey), String(secs));
      game.newBest = true;
    }
    updateBest();
    showBanner("won", "THE FIELD IS CLEAR", game.newBest
      ? `new best: ${fmtTime(secs)} — R for a new field`
      : `${fmtTime(secs)} — R for a new field`);
    synth.win();
  }
}

function lose() {
  game.state = "lost";
  showBanner("lost", "A HOLLOW BURST", "the ground gave way — R for a new field");
  synth.boom();
}

// ---------------------------------------------------------------- input

function actOnCell(r, c, action) {
  // action: "dig" (left click / tap) or "flag" (right click / long press)
  if (game.state === "won" || game.state === "lost") {
    newGame();
    return;
  }
  const i = idx(r, c);

  if (action === "flag") {
    if (toggleFlag(r, c)) {
      game.flagged[i] ? synth.flag() : synth.unflag();
      updateHud();
      draw();
    }
    return;
  }

  // dig
  if (game.flagged[i]) { synth.thud(); return; }

  if (game.revealed[i]) {
    if (game.state !== "playing") return;
    const res = chord(r, c);
    if (res === -1) { draw(); updateHud(); return; }
    if (res > 0) {
      res > 3 ? synth.cascade(res) : synth.dig();
      checkWin();
      updateHud();
      draw();
    }
    return;
  }

  // first dig seeds the field and starts the clock
  if (game.state === "idle") {
    seedHazards(r, c);
    game.state = "playing";
    game.time = 0;
  }
  const res = reveal(r, c);
  if (res === -1) { draw(); updateHud(); return; }
  if (res > 0) {
    res > 3 ? synth.cascade(res) : synth.dig();
    checkWin();
    updateHud();
    draw();
  }
}

function cellFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const c = Math.floor(x / cellPx);
  const r = Math.floor(y / cellPx);
  return inBounds(r, c) ? [r, c] : null;
}

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener("mousedown", (e) => {
  synth.unlock();
  const cell = cellFromEvent(e);
  if (!cell) return;
  if (e.button === 2) {
    if (game.state === "won" || game.state === "lost") return;
    actOnCell(cell[0], cell[1], "flag");
  }
});

canvas.addEventListener("click", (e) => {
  synth.unlock();
  const cell = cellFromEvent(e);
  if (!cell) return;
  actOnCell(cell[0], cell[1], "dig");
});

canvas.addEventListener("mousemove", (e) => {
  const cell = cellFromEvent(e);
  const h = cell ? idx(cell[0], cell[1]) : -1;
  if (h !== game.hover) { game.hover = h; draw(); }
});
canvas.addEventListener("mouseleave", () => {
  if (game.hover !== -1) { game.hover = -1; draw(); }
});

// --- touch: tap digs, long-press plants a marker ---

let touchTimer = null;
let touchCell = null;
let touchStart = null;
let longPressFired = false;

canvas.addEventListener("touchstart", (e) => {
  synth.unlock();
  if (e.touches.length !== 1) { clearTimeout(touchTimer); touchTimer = null; return; }
  const t = e.touches[0];
  touchCell = cellFromEvent(t);
  touchStart = [t.clientX, t.clientY];
  longPressFired = false;
  if (!touchCell) return;
  clearTimeout(touchTimer);
  touchTimer = setTimeout(() => {
    longPressFired = true;
    touchTimer = null;
    if (game.state === "won" || game.state === "lost") return;
    actOnCell(touchCell[0], touchCell[1], "flag");
    if (navigator.vibrate) navigator.vibrate(30);
  }, LONG_PRESS_MS);
}, { passive: true });

canvas.addEventListener("touchmove", (e) => {
  if (!touchStart) return;
  const t = e.touches[0];
  if (Math.hypot(t.clientX - touchStart[0], t.clientY - touchStart[1]) > 12) {
    clearTimeout(touchTimer);
    touchTimer = null;
    touchCell = null;
  }
}, { passive: true });

canvas.addEventListener("touchend", (e) => {
  clearTimeout(touchTimer);
  touchTimer = null;
  if (longPressFired) { e.preventDefault(); return; } // don't also fire a click
  if (touchCell) {
    e.preventDefault(); // suppress the emulated mouse click
    actOnCell(touchCell[0], touchCell[1], "dig");
  }
  touchCell = null;
  touchStart = null;
});

canvas.addEventListener("touchcancel", () => {
  clearTimeout(touchTimer);
  touchTimer = null;
  touchCell = null;
  touchStart = null;
});

// --- keyboard ---

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === "r") { synth.unlock(); newGame(); }
  else if (k === "enter" || k === " ") {
    if (game.state === "won" || game.state === "lost") { synth.unlock(); newGame(); e.preventDefault(); }
  }
  else if (k === "1") newGame("seedplot");
  else if (k === "2") newGame("meadow");
  else if (k === "3") newGame("longfield");
  else if (k === "m" || k === "s") setSound(synth.toggle());
});

// --- buttons ---

newfieldBtn.addEventListener("click", () => { synth.unlock(); newGame(); });
soundBtn.addEventListener("click", () => setSound(synth.toggle()));
presetBtns.forEach((b) => b.addEventListener("click", () => {
  synth.unlock();
  newGame(b.dataset.preset);
}));

document.getElementById("begin").addEventListener("click", () => {
  synth.unlock();
  introEl.classList.add("hidden");
});

// --- pause on blur (the clock is real-time) ---

window.addEventListener("blur", () => {
  if (game.state === "playing") {
    game.paused = true;
    showBanner("paused", "PAUSED", "click back in to keep dowsing");
  }
});
window.addEventListener("focus", () => {
  if (game.paused) {
    game.paused = false;
    if (game.state === "playing") hideBanner();
  }
});

window.addEventListener("resize", () => { fitCanvas(); draw(); });

// ---------------------------------------------------------------- hud

function fmtTime(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function updateHud() {
  const left = game.hollows - game.flagCount;
  hollowCountEl.textContent = String(left).padStart(2, "0");
  hollowCountEl.style.color = left < 0 ? "#f7768e" : "";
}

function updateBest() {
  const v = Number(localStorage.getItem(LS.best(game.presetKey)));
  bestEl.textContent = Number.isFinite(v) && v > 0 ? `best: ${fmtTime(v)}` : "best: —";
  bestEl.classList.toggle("fresh", game.newBest);
}

function syncPresetButtons() {
  presetBtns.forEach((b) => b.classList.toggle("active", b.dataset.preset === game.presetKey));
}

function setSound(on) {
  soundBtn.textContent = `sound: ${on ? "on" : "off"}`;
}

function showBanner(cls, text, sub) {
  bannerEl.className = cls;
  bannerText.textContent = text;
  bannerSub.textContent = sub;
}

function hideBanner() {
  bannerEl.className = "hidden";
}

// ---------------------------------------------------------------- rendering

function fitCanvas() {
  const pad = 28;
  const maxW = Math.min(document.getElementById("stage").clientWidth - pad, 1140);
  const maxH = Math.max(240, window.innerHeight - 280);
  cellPx = Math.max(16, Math.min(38, Math.floor(maxW / game.cols), Math.floor(maxH / game.rows)));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = game.cols * cellPx * dpr;
  canvas.height = game.rows * cellPx * dpr;
  canvas.style.width = `${game.cols * cellPx}px`;
  canvas.style.height = `${game.rows * cellPx}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// deterministic per-cell pseudo-random (for turf speckles)
function cellNoise(i, salt) {
  let h = (i * 2654435761 + salt * 40503) >>> 0;
  h ^= h >> 13; h = (h * 2246822519) >>> 0; h ^= h >> 11;
  return (h & 0xffff) / 0x10000;
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const over = game.state === "lost";
  for (let r = 0; r < game.rows; r++) {
    for (let c = 0; c < game.cols; c++) {
      drawCell(r, c, over);
    }
  }
}

function drawCell(r, c, over) {
  const i = idx(r, c);
  const x = c * cellPx, y = r * cellPx, s = cellPx;
  const revealed = !!game.revealed[i];
  const flagged = !!game.flagged[i];
  const hazard = !!game.hazard[i];

  if (revealed || (over && hazard && !flagged)) {
    // dug earth
    ctx.fillStyle = game.burstAt === i ? "#3d1620" : "#1a1d22";
    ctx.fillRect(x, y, s, s);
    ctx.strokeStyle = "#242930";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);

    if (hazard) {
      drawHollow(x, y, s, game.burstAt === i);
    } else {
      const n = game.count[i];
      if (n > 0) {
        ctx.fillStyle = NUMBER_COLORS[n];
        ctx.font = `bold ${Math.floor(s * 0.55)}px ui-monospace, Menlo, Consolas, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(n), x + s / 2, y + s / 2 + 1);
      }
    }
  } else {
    // undisturbed turf: a raised sod tile
    const hovered = game.hover === i && game.state !== "won" && game.state !== "lost";
    ctx.fillStyle = hovered ? "#39422f" : "#2c3327";
    ctx.fillRect(x, y, s, s);
    // bevel
    ctx.fillStyle = hovered ? "#4c5840" : "#3e4936";
    ctx.fillRect(x, y, s, 2);
    ctx.fillRect(x, y, 2, s);
    ctx.fillStyle = "#1b201a";
    ctx.fillRect(x, y + s - 2, s, 2);
    ctx.fillRect(x + s - 2, y, 2, s);
    // turf speckles
    ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
    for (let k = 0; k < 3; k++) {
      const nx = x + 3 + cellNoise(i, k * 2) * (s - 7);
      const ny = y + 3 + cellNoise(i, k * 2 + 1) * (s - 7);
      ctx.fillRect(nx, ny, 2, 2);
    }

    if (flagged) {
      const wrong = over && !hazard;
      drawMarker(x, y, s, wrong);
    }
  }
}

// A hollow: a dark pit with a faint ring and cracks.
function drawHollow(x, y, s, burst) {
  const cx = x + s / 2, cy = y + s / 2;
  const rad = s * 0.3;
  const grad = ctx.createRadialGradient(cx, cy, rad * 0.15, cx, cy, rad);
  grad.addColorStop(0, "#000");
  grad.addColorStop(1, burst ? "#5a1a28" : "#101215");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = burst ? "#f7768e" : "#4a525e";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // cracks radiating out
  ctx.strokeStyle = burst ? "rgba(247, 118, 142, 0.7)" : "rgba(74, 82, 94, 0.6)";
  ctx.lineWidth = 1;
  for (let a = 0; a < 5; a++) {
    const ang = a * (Math.PI * 2 / 5) + 0.5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
    ctx.lineTo(cx + Math.cos(ang) * rad * 1.55, cy + Math.sin(ang) * rad * 1.55);
    ctx.stroke();
  }
}

// A dowsing marker: a stake with a pennant. Wrong flags get struck through.
function drawMarker(x, y, s, wrong) {
  const px = x + s * 0.38, top = y + s * 0.18, bot = y + s * 0.82;
  ctx.strokeStyle = "#c9a06a";
  ctx.lineWidth = Math.max(1.5, s * 0.07);
  ctx.beginPath();
  ctx.moveTo(px, top);
  ctx.lineTo(px, bot);
  ctx.stroke();
  // mound at the base
  ctx.fillStyle = "#1b201a";
  ctx.beginPath();
  ctx.ellipse(px, bot, s * 0.16, s * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  // pennant
  ctx.fillStyle = wrong ? "#7c8592" : "#e0b35c";
  ctx.beginPath();
  ctx.moveTo(px, top);
  ctx.lineTo(px + s * 0.34, top + s * 0.14);
  ctx.lineTo(px, top + s * 0.3);
  ctx.closePath();
  ctx.fill();

  if (wrong) {
    ctx.strokeStyle = "#f7768e";
    ctx.lineWidth = Math.max(1.5, s * 0.08);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.2, y + s * 0.2);
    ctx.lineTo(x + s * 0.8, y + s * 0.8);
    ctx.moveTo(x + s * 0.8, y + s * 0.2);
    ctx.lineTo(x + s * 0.2, y + s * 0.8);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------- main loop
// Fixed-timestep accumulator: the clock advances in TICK steps regardless of
// frame rate; rendering just reads the current state.

let last = performance.now();
let acc = 0;
let shownTime = -1;

function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  acc += dt;
  while (acc >= TICK) {
    acc -= TICK;
    if (game.state === "playing" && !game.paused) game.time += TICK;
  }
  const t = Math.floor(game.time);
  if (t !== shownTime) {
    shownTime = t;
    timerEl.textContent = fmtTime(t);
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- boot

setSound(synth.enabled);
newGame(game.presetKey);
requestAnimationFrame(frame);

// debug / test hook
window.__dowser = { game, newGame, actOnCell, idx };

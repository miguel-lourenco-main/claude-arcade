// main.js — layout, input, rendering, fixed-timestep animation, win cascade.
// Classic script: reads its dependencies from window.Patience (file:// friendly).

(function () {
'use strict';

const { Game, CardArt, drawSuit, Sfx } = window.Patience;

const SET_KEY = 'arcade.patience.settings';
const STAT_KEY = 'arcade.patience.stats';
const STEP = 1 / 60;
const ACCENT = '#7ee0b0';

// ---------- persistence ----------

function loadJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v && typeof v === 'object' ? Object.assign({}, fallback, v) : { ...fallback };
  } catch (e) {
    return { ...fallback };
  }
}
function saveJSON(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* private mode */ }
}

const settings = loadJSON(SET_KEY, { sound: true, draw3: true });
const stats = loadJSON(STAT_KEY, { played: 0, wins: 0, streak: 0, bestTime: null, bestMoves: null });

// ---------- DOM ----------

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const stage = document.getElementById('stage');
const clockEl = document.getElementById('clock');
const movesEl = document.getElementById('movecount');
const pausedTag = document.getElementById('paused-tag');
const seedInput = document.getElementById('seed-input');
const btnDeal = document.getElementById('btn-deal');
const btnNew = document.getElementById('btn-new');
const btnRestart = document.getElementById('btn-restart');
const btnUndo = document.getElementById('btn-undo');
const btnMode = document.getElementById('btn-mode');
const btnSound = document.getElementById('btn-sound');
const btnAuto = document.getElementById('btn-auto');
const winbox = document.getElementById('winbox');
const winStatsEl = document.getElementById('win-stats');
const statsLine = document.getElementById('stats-line');

// ---------- state ----------

const art = new CardArt();
const sfx = new Sfx(settings.sound);

let game = null;
let drag = null;        // {src, cards, x, y, dx, dy, homeX, homeY, targets}
let pressed = null;     // pointerdown candidate before drag threshold
let flights = [];       // {cards, x0,y0,x1,y1, t, dur, dstKey, n, snd}
let autoplay = false;
let autoT = 0;
let winState = null;    // {queue, remain, parts, spawnT, age}
let elapsed = 0;
let started = false;
let counted = false;
let gameWon = false;
let paused = false;
let animT = 0;
let lastDown = { t: 0, key: '' };

let W = 0, H = 0, DPR = 1;
let L = null;           // layout metrics
let bgCanvas = null;
let trailCanvas = null, trailCtx = null;

// ---------- layout ----------

function computeLayout() {
  const gap = Math.max(8, Math.round(W * 0.014));
  const CW = Math.max(38, Math.min(120, Math.floor((W - gap * 8) / 7)));
  const CH = Math.round(CW * 1.45);
  const ox = Math.round((W - (7 * CW + 6 * gap)) / 2);
  const topY = Math.max(10, Math.round(gap * 0.9));
  const tabY = topY + CH + Math.round(CH * 0.16);
  L = {
    gap, CW, CH, ox, topY, tabY,
    dyUp: Math.round(CH * 0.27),
    dyDown: Math.round(CH * 0.115),
    wasteDx: Math.round(CW * 0.38),
  };
  art.size(CW, CH, DPR);
}

function colX(i) { return L.ox + i * (L.CW + L.gap); }
function stockRect() { return { x: colX(0), y: L.topY, w: L.CW, h: L.CH }; }
function foundRect(i) { return { x: colX(3 + i), y: L.topY, w: L.CW, h: L.CH }; }

function wasteFanN(avail) { return Math.min(game.draw3 ? 3 : 1, avail); }
function wasteTopRect() {
  const n = wasteFanN(game.waste.length);
  return { x: colX(1) + Math.max(0, n - 1) * L.wasteDx, y: L.topY, w: L.CW, h: L.CH };
}

function pilePositions(i) {
  const pile = game.tab[i];
  const ys = [];
  if (!pile.length) return ys;
  let total = 0;
  for (let j = 0; j < pile.length - 1; j++) total += pile[j].up ? L.dyUp : L.dyDown;
  const avail = H - L.tabY - 8 - L.CH;
  const scale = total > avail && total > 0 ? Math.max(0.28, avail / total) : 1;
  let y = L.tabY;
  for (let j = 0; j < pile.length; j++) {
    ys.push(Math.round(y));
    y += (pile[j].up ? L.dyUp : L.dyDown) * scale;
  }
  return ys;
}

function inRect(x, y, r) { return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h; }

function resize() {
  const r = stage.getBoundingClientRect();
  W = Math.max(320, Math.round(r.width));
  H = Math.max(320, Math.round(r.height));
  DPR = Math.min(2.5, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  computeLayout();
  finishFlights();
  renderBg();
  if (trailCanvas) {
    trailCanvas.width = canvas.width;
    trailCanvas.height = canvas.height;
    trailCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
}

function renderBg() {
  bgCanvas = document.createElement('canvas');
  bgCanvas.width = canvas.width;
  bgCanvas.height = canvas.height;
  const b = bgCanvas.getContext('2d');
  b.setTransform(DPR, 0, 0, DPR, 0, 0);
  const g = b.createRadialGradient(W / 2, H * 0.25, 60, W / 2, H * 0.6, Math.max(W, H));
  g.addColorStop(0, '#131a1a');
  g.addColorStop(0.55, '#0e1214');
  g.addColorStop(1, '#0a0c0e');
  b.fillStyle = g;
  b.fillRect(0, 0, W, H);
  // faint felt weave
  b.globalAlpha = 0.05;
  b.strokeStyle = '#3a5548';
  b.lineWidth = 1;
  b.beginPath();
  for (let x = 0; x < W + H; x += 26) {
    b.moveTo(x, 0); b.lineTo(x - H, H);
  }
  b.stroke();
  b.globalAlpha = 1;
}

// ---------- game lifecycle ----------

function randomSeed() { return (Math.floor(Math.random() * 900000000) + 1) >>> 0; }

function newDeal(seed) {
  if (game && counted && !gameWon) {
    stats.streak = 0;
    saveJSON(STAT_KEY, stats);
  }
  game = new Game(seed, settings.draw3);
  drag = null; pressed = null; flights = [];
  autoplay = false; winState = null;
  elapsed = 0; started = false; counted = false; gameWon = false;
  winbox.classList.add('hidden');
  seedInput.value = String(game.seed);
  sfx.shuffle();
  refreshChrome();
}

function markPlayed() {
  started = true;
  if (!counted) {
    counted = true;
    stats.played++;
    saveJSON(STAT_KEY, stats);
    refreshChrome();
  }
}

function doDraw() {
  if (gameWon || autoplay) return;
  const res = game.draw();
  if (!res) return;
  markPlayed();
  if (res.t === 'recycle') sfx.shuffle();
  else sfx.drawTick();
  afterAction();
}

function doUndo() {
  if (gameWon || autoplay || !game.hist.length) return;
  cancelDrag();
  finishFlights();
  game.undo();
  sfx.undo();
  afterAction();
}

function afterAction() {
  if (!gameWon && game.isWon()) startWin();
  refreshChrome();
}

function refreshChrome() {
  btnUndo.disabled = !game || !game.hist.length || gameWon || autoplay;
  const showAuto = game && game.canAutoComplete() && !autoplay && !gameWon;
  btnAuto.classList.toggle('hidden', !showAuto);
  btnMode.textContent = settings.draw3 ? 'Draw 3' : 'Draw 1';
  btnSound.textContent = settings.sound ? '♪ on' : '♪ off';
  btnSound.classList.toggle('on', settings.sound);
  const best = stats.bestTime != null ? fmtTime(stats.bestTime) : '—';
  const fewest = stats.bestMoves != null ? String(stats.bestMoves) : '—';
  statsLine.textContent =
    `wins ${stats.wins}/${stats.played} · streak ${stats.streak} · best ${best} · fewest ${fewest}`;
}

function fmtTime(sec) {
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------- flights (cosmetic card moves; state is already applied) ----------

function pileKey(ref) { return ref.k + (ref.i ?? 0); }

function addFlight(cards, x0, y0, dst, snd) {
  const p = destSlotPos(dst, cards.length);
  flights.push({ cards, x0, y0, x1: p.x, y1: p.y, t: 0, dur: 0.18, dstKey: pileKey(dst), n: cards.length, snd });
}

// where the top-left of a just-landed stack sits
function destSlotPos(dst, n) {
  if (dst.k === 'found') { const r = foundRect(dst.i); return { x: r.x, y: r.y }; }
  const pile = game.tab[dst.i];
  const ys = pilePositions(dst.i);
  const idx = pile.length - n;
  return { x: colX(dst.i), y: idx >= 0 && idx < ys.length ? ys[idx] : L.tabY };
}

function finishFlights() {
  for (const f of flights) if (f.snd) f.snd();
  flights = [];
}

function hiddenCounts() {
  const m = new Map();
  for (const f of flights) m.set(f.dstKey, (m.get(f.dstKey) || 0) + f.n);
  return m;
}

// ---------- auto to foundation (double-click) ----------

function sendToFoundation(src) {
  const from = game.pileOf(src);
  if (!from.length) return false;
  if (src.k === 'tab' && src.idx !== from.length - 1) return false; // top card only
  const card = from[from.length - 1];
  const dst = game.foundationTargetFor(card);
  if (!dst) return false;
  const home = homePos(src);
  if (!game.move(src, dst)) return false;
  markPlayed();
  addFlight([card], home.x, home.y, dst, () => sfx.foundation());
  afterAction();
  return true;
}

function homePos(src) {
  if (src.k === 'waste') { const r = wasteTopRect(); return { x: r.x, y: r.y }; }
  if (src.k === 'found') { const r = foundRect(src.i); return { x: r.x, y: r.y }; }
  const ys = pilePositions(src.i);
  return { x: colX(src.i), y: ys[src.idx] ?? L.tabY };
}

// ---------- auto-complete ----------

function startAutoplay() {
  if (!game.canAutoComplete() || autoplay || gameWon) return;
  autoplay = true;
  autoT = 0;
  markPlayed();
  refreshChrome();
}

function stepAutoplay() {
  const m = game.nextAutoMove();
  if (!m) { autoplay = false; afterAction(); return; }
  const home = homePos(m.src);
  if (game.move(m.src, m.dst)) {
    addFlight([m.card], home.x, home.y, m.dst, () => sfx.foundation());
  }
  if (game.isWon()) { autoplay = false; startWin(); }
  refreshChrome();
}

// ---------- win ----------

function startWin() {
  gameWon = true;
  autoplay = false;
  drag = null; pressed = null;
  finishFlights();

  stats.wins++;
  stats.streak++;
  if (stats.bestTime == null || elapsed < stats.bestTime) stats.bestTime = elapsed;
  if (stats.bestMoves == null || game.moves < stats.bestMoves) stats.bestMoves = game.moves;
  saveJSON(STAT_KEY, stats);

  if (!trailCanvas) {
    trailCanvas = document.createElement('canvas');
    trailCanvas.width = canvas.width;
    trailCanvas.height = canvas.height;
    trailCtx = trailCanvas.getContext('2d');
    trailCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
  } else {
    trailCtx.clearRect(0, 0, W, H);
  }

  const queue = [];
  for (let r = 13; r >= 1; r--) {
    for (let f = 0; f < 4; f++) queue.push({ card: game.found[f][r - 1], f });
  }
  winState = { queue, remain: [13, 13, 13, 13], parts: [], spawnT: 0, age: 0 };

  winStatsEl.textContent = `deal #${game.seed} · ${fmtTime(elapsed)} · ${game.moves} moves`;
  sfx.win();
  refreshChrome();
}

function winUpdate(dt) {
  const ws = winState;
  ws.age += dt;
  if (ws.age > 1.2) winbox.classList.remove('hidden');

  ws.spawnT -= dt;
  if (ws.queue.length && ws.spawnT <= 0 && ws.parts.length < 14) {
    ws.spawnT = 0.2;
    const { card, f } = ws.queue.shift();
    ws.remain[f]--;
    const r = foundRect(f);
    const dir = Math.random() < 0.5 ? -1 : 1;
    ws.parts.push({
      card,
      x: r.x, y: r.y,
      vx: dir * (90 + Math.random() * 260),
      vy: -(60 + Math.random() * 320),
      rot: 0,
      vr: dir * (0.6 + Math.random() * 2.4),
    });
  }

  const G = 1500;
  const floorY = H - L.CH - 2;
  for (let i = ws.parts.length - 1; i >= 0; i--) {
    const p = ws.parts[i];
    p.vy += G * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    if (p.y > floorY && p.vy > 0) {
      p.y = floorY;
      p.vy *= -0.78;
      p.vx *= 0.992;
      sfx.bounce(Math.abs(p.vy));
      if (Math.abs(p.vy) < 40) p.vy = -40; // keep skittering off-screen
    }
    // stamp a ghost onto the trail layer
    trailCtx.save();
    trailCtx.globalAlpha = 0.55;
    trailCtx.translate(p.x + L.CW / 2, p.y + L.CH / 2);
    trailCtx.rotate(p.rot);
    trailCtx.drawImage(art.face(p.card.r, p.card.s), -L.CW / 2, -L.CH / 2, L.CW, L.CH);
    trailCtx.restore();
    if (p.x < -L.CW * 2 || p.x > W + L.CW * 2) ws.parts.splice(i, 1);
  }

  // slow dissolve so trails linger, then fade
  trailCtx.globalCompositeOperation = 'destination-out';
  trailCtx.globalAlpha = 0.012;
  trailCtx.fillStyle = '#000';
  trailCtx.fillRect(0, 0, W, H);
  trailCtx.globalCompositeOperation = 'source-over';
  trailCtx.globalAlpha = 1;
}

// ---------- input ----------

function canvasPos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function hitTest(x, y) {
  if (inRect(x, y, stockRect())) return { type: 'stock' };
  if (game.waste.length) {
    const r = wasteTopRect();
    if (inRect(x, y, r)) {
      return { type: 'grab', src: { k: 'waste' }, home: r, card: game.waste[game.waste.length - 1] };
    }
  }
  for (let i = 0; i < 4; i++) {
    const f = game.found[i];
    if (f.length && inRect(x, y, foundRect(i))) {
      return { type: 'grab', src: { k: 'found', i }, home: foundRect(i), card: f[f.length - 1] };
    }
  }
  for (let i = 0; i < 7; i++) {
    const pile = game.tab[i];
    const ys = pilePositions(i);
    for (let j = pile.length - 1; j >= 0; j--) {
      const rect = { x: colX(i), y: ys[j], w: L.CW, h: L.CH };
      if (inRect(x, y, rect)) {
        if (!pile[j].up) return { type: 'dead' };
        return { type: 'grab', src: { k: 'tab', i, idx: j }, home: rect, card: pile[j] };
      }
    }
  }
  return null;
}

function cardKeyOf(hit) {
  return `${hit.card.r}.${hit.card.s}`;
}

function legalTargetsFor(src, cards) {
  const t = [];
  for (let i = 0; i < 4; i++) {
    if (!(src.k === 'found' && src.i === i) && game.canDrop(cards, { k: 'found', i })) t.push({ k: 'found', i });
  }
  for (let i = 0; i < 7; i++) {
    if (!(src.k === 'tab' && src.i === i) && game.canDrop(cards, { k: 'tab', i })) t.push({ k: 'tab', i });
  }
  return t;
}

function targetRect(t) {
  if (t.k === 'found') return foundRect(t.i);
  const pile = game.tab[t.i];
  if (!pile.length) return { x: colX(t.i), y: L.tabY, w: L.CW, h: L.CH };
  const ys = pilePositions(t.i);
  return { x: colX(t.i), y: ys[ys.length - 1] + L.dyUp, w: L.CW, h: L.CH };
}

function dropZone(t) {
  if (t.k === 'found') { const r = foundRect(t.i); return { x: r.x - 6, y: r.y - 6, w: r.w + 12, h: r.h + 12 }; }
  return { x: colX(t.i) - L.gap / 2, y: L.tabY - 10, w: L.CW + L.gap, h: H - L.tabY };
}

function cancelDrag() {
  drag = null;
  pressed = null;
  canvas.style.cursor = '';
}

canvas.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  if (paused || autoplay) return;
  if (winState) {
    if (winState.age > 1) newDeal(randomSeed());
    return;
  }
  const p = canvasPos(e);
  const hit = hitTest(p.x, p.y);
  if (!hit || hit.type === 'dead') return;
  e.preventDefault();
  // setPointerCapture throws NotFoundError for pointers the browser doesn't
  // consider active (synthetic PointerEvents, some odd touch edge cases).
  // Capture is a nicety, not a requirement — never let it kill the handler.
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* no active pointer */ }

  if (hit.type === 'stock') { doDraw(); return; }

  // double-click / double-tap: send to foundation
  const key = cardKeyOf(hit);
  const now = performance.now();
  if (now - lastDown.t < 400 && lastDown.key === key) {
    lastDown = { t: 0, key: '' };
    if (sendToFoundation(hit.src)) return;
  }
  lastDown = { t: now, key };

  const from = game.pileOf(hit.src);
  const idx = hit.src.k === 'tab' ? hit.src.idx : from.length - 1;
  pressed = {
    src: hit.src,
    cards: from.slice(idx),
    homeX: hit.home.x, homeY: hit.home.y,
    dx: p.x - hit.home.x, dy: p.y - hit.home.y,
    startX: p.x, startY: p.y,
  };
});

canvas.addEventListener('pointermove', (e) => {
  if (!pressed && !drag) return;
  const p = canvasPos(e);
  if (!drag) {
    if (Math.hypot(p.x - pressed.startX, p.y - pressed.startY) < 6) return;
    drag = pressed;
    drag.targets = legalTargetsFor(drag.src, drag.cards);
    canvas.style.cursor = 'grabbing';
    sfx.pick();
  }
  drag.x = p.x - drag.dx;
  drag.y = p.y - drag.dy;
});

canvas.addEventListener('pointerup', (e) => {
  if (!drag) { pressed = null; return; }
  const p = canvasPos(e);
  const cx = (drag.x ?? p.x - drag.dx) + L.CW / 2;
  const cy = (drag.y ?? p.y - drag.dy) + L.CH / 2;

  let dest = null;
  for (const t of drag.targets) {
    if (inRect(cx, cy, dropZone(t)) || inRect(p.x, p.y, dropZone(t))) { dest = t; break; }
  }

  if (dest && game.move(drag.src, dest)) {
    markPlayed();
    if (dest.k === 'found') sfx.foundation(); else sfx.place();
    afterAction();
  } else {
    // glide the run back home
    const overSomething =
      inRect(p.x, p.y, { x: 0, y: L.topY, w: W, h: L.CH }) ||
      p.y >= L.tabY;
    if (overSomething) sfx.error();
    flights.push({
      cards: drag.cards,
      x0: drag.x ?? drag.homeX, y0: drag.y ?? drag.homeY,
      x1: drag.homeX, y1: drag.homeY,
      t: 0, dur: 0.16,
      dstKey: pileKey(drag.src), n: drag.cards.length, snd: null,
    });
  }
  cancelDrag();
});

canvas.addEventListener('pointercancel', () => {
  if (drag) {
    flights.push({
      cards: drag.cards, x0: drag.x ?? drag.homeX, y0: drag.y ?? drag.homeY,
      x1: drag.homeX, y1: drag.homeY, t: 0, dur: 0.16,
      dstKey: pileKey(drag.src), n: drag.cards.length, snd: null,
    });
  }
  cancelDrag();
});

// ---------- keyboard ----------

document.addEventListener('keydown', (e) => {
  sfx.unlock();
  if (e.target === seedInput) {
    if (e.key === 'Enter') dealFromInput();
    return;
  }
  if (winState && winState.age > 1 && !e.metaKey && !e.ctrlKey && !e.altKey && e.key !== 'Shift') {
    newDeal(randomSeed());
    return;
  }
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); doDraw(); }
  else if (k === 'd') doDraw();
  else if (k === 'z' || k === 'u') doUndo();
  else if (k === 'n') newDeal(randomSeed());
  else if (k === 'r') newDeal(game.seed);
  else if (k === 'a') startAutoplay();
  else if (k === 'm') toggleSound();
});

// ---------- chrome buttons ----------

function dealFromInput() {
  const v = parseInt(seedInput.value.replace(/\D/g, ''), 10);
  if (Number.isFinite(v)) newDeal(v >>> 0);
  seedInput.blur();
}

function toggleSound() {
  settings.sound = !settings.sound;
  sfx.enabled = settings.sound;
  saveJSON(SET_KEY, settings);
  refreshChrome();
}

btnDeal.addEventListener('click', () => { sfx.unlock(); dealFromInput(); });
btnNew.addEventListener('click', () => { sfx.unlock(); newDeal(randomSeed()); });
btnRestart.addEventListener('click', () => { sfx.unlock(); newDeal(game.seed); });
btnUndo.addEventListener('click', () => { sfx.unlock(); doUndo(); });
btnAuto.addEventListener('click', () => { sfx.unlock(); startAutoplay(); });
btnSound.addEventListener('click', () => { sfx.unlock(); toggleSound(); });
btnMode.addEventListener('click', () => {
  sfx.unlock();
  settings.draw3 = !settings.draw3;
  game.draw3 = settings.draw3;
  saveJSON(SET_KEY, settings);
  refreshChrome();
});

// keep keyboard shortcuts working after a chrome button is clicked
for (const b of document.querySelectorAll('#topbar button, #btn-auto')) {
  b.addEventListener('click', () => b.blur());
}

window.addEventListener('blur', () => { paused = true; pausedTag.classList.remove('hidden'); });
window.addEventListener('focus', () => { paused = false; pausedTag.classList.add('hidden'); });
window.addEventListener('resize', resize);

// ---------- fixed-timestep update ----------

function update(dt) {
  animT += dt;
  if (started && !gameWon) elapsed += dt;

  for (let i = flights.length - 1; i >= 0; i--) {
    const f = flights[i];
    f.t += dt;
    if (f.t >= f.dur) {
      if (f.snd) f.snd();
      flights.splice(i, 1);
    }
  }

  if (autoplay) {
    autoT += dt;
    if (autoT >= 0.13) { autoT = 0; stepAutoplay(); }
  }

  if (winState) winUpdate(dt);
}

// ---------- render ----------

function roundOutline(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawSlot(r, ghostSuit) {
  roundOutline(r.x + 1, r.y + 1, r.w - 2, r.h - 2, r.w * 0.09);
  ctx.strokeStyle = 'rgba(126, 224, 176, 0.22)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  if (ghostSuit != null) {
    ctx.fillStyle = 'rgba(126, 224, 176, 0.16)';
    drawSuit(ctx, ghostSuit, r.x + r.w / 2, r.y + r.h * 0.52, r.w * 0.42);
  }
}

function drawCardImg(img, x, y) {
  ctx.drawImage(img, x, y, L.CW, L.CH);
}

function render() {
  ctx.drawImage(bgCanvas, 0, 0, W, H);

  if (winState) {
    // foundations drain as cards launch
    for (let i = 0; i < 4; i++) {
      const r = foundRect(i);
      drawSlot(r, i);
      const n = winState.remain[i];
      if (n > 0) {
        const c = game.found[i][n - 1];
        drawCardImg(art.face(c.r, c.s), r.x, r.y);
      }
    }
    ctx.drawImage(trailCanvas, 0, 0, W, H);
    for (const p of winState.parts) {
      ctx.save();
      ctx.translate(p.x + L.CW / 2, p.y + L.CH / 2);
      ctx.rotate(p.rot);
      ctx.drawImage(art.face(p.card.r, p.card.s), -L.CW / 2, -L.CH / 2, L.CW, L.CH);
      ctx.restore();
    }
    updateHud();
    return;
  }

  const hidden = hiddenCounts();

  // stock
  const sr = stockRect();
  if (game.stock.length) {
    if (game.stock.length > 1) drawCardImg(art.back(), sr.x + 2, sr.y + 2);
    drawCardImg(art.back(), sr.x, sr.y);
    ctx.fillStyle = 'rgba(200, 210, 216, 0.5)';
    ctx.font = `11px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(String(game.stock.length), sr.x + sr.w / 2, sr.y + sr.h + 5);
  } else {
    drawSlot(sr, null);
    if (game.waste.length) {
      // recycle glyph
      ctx.strokeStyle = 'rgba(126, 224, 176, 0.5)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(sr.x + sr.w / 2, sr.y + sr.h / 2, sr.w * 0.22, 0.4, Math.PI * 1.7);
      ctx.stroke();
      const ax = sr.x + sr.w / 2 + Math.cos(0.4) * sr.w * 0.22;
      const ay = sr.y + sr.h / 2 + Math.sin(0.4) * sr.w * 0.22;
      ctx.fillStyle = 'rgba(126, 224, 176, 0.5)';
      ctx.beginPath();
      ctx.moveTo(ax + 5, ay + 1);
      ctx.lineTo(ax - 6, ay - 4);
      ctx.lineTo(ax - 1, ay + 8);
      ctx.closePath();
      ctx.fill();
    }
  }

  // waste (fan of three in draw-3; only the top is grabbable)
  const wAvail = game.waste.length - (drag && drag.src.k === 'waste' ? 1 : 0);
  const fanN = wasteFanN(wAvail);
  if (wAvail === 0) drawSlot({ x: colX(1), y: L.topY, w: L.CW, h: L.CH }, null);
  for (let f = 0; f < fanN; f++) {
    const c = game.waste[wAvail - fanN + f];
    drawCardImg(art.face(c.r, c.s), colX(1) + f * L.wasteDx, L.topY);
  }

  // foundations
  for (let i = 0; i < 4; i++) {
    const r = foundRect(i);
    drawSlot(r, i);
    let n = game.found[i].length - (hidden.get('found' + i) || 0);
    if (drag && drag.src.k === 'found' && drag.src.i === i) n--;
    if (n > 0) {
      const c = game.found[i][n - 1];
      drawCardImg(art.face(c.r, c.s), r.x, r.y);
    }
  }

  // tableau
  for (let i = 0; i < 7; i++) {
    const pile = game.tab[i];
    const ys = pilePositions(i);
    let visible = pile.length - (hidden.get('tab' + i) || 0);
    const dragCut = drag && drag.src.k === 'tab' && drag.src.i === i ? drag.src.idx : Infinity;
    if (!pile.length || Math.min(visible, dragCut) <= 0) {
      drawSlot({ x: colX(i), y: L.tabY, w: L.CW, h: L.CH }, null);
    }
    for (let j = 0; j < Math.min(visible, dragCut); j++) {
      const c = pile[j];
      drawCardImg(c.up ? art.face(c.r, c.s) : art.back(), colX(i), ys[j]);
    }
  }

  // valid-target highlighting while dragging
  if (drag && drag.targets) {
    const pulse = 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(animT * 7));
    for (const t of drag.targets) {
      const r = targetRect(t);
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = ACCENT;
      ctx.shadowBlur = 12;
      roundOutline(r.x - 2, r.y - 2, r.w + 4, r.h + 4, r.w * 0.1);
      ctx.stroke();
      ctx.restore();
    }
  }

  // flights
  for (const f of flights) {
    const u = Math.min(1, f.t / f.dur);
    const p = 1 - Math.pow(1 - u, 3);
    const x = f.x0 + (f.x1 - f.x0) * p;
    const y = f.y0 + (f.y1 - f.y0) * p;
    for (let j = 0; j < f.cards.length; j++) {
      const c = f.cards[j];
      drawCardImg(art.face(c.r, c.s), x, y + j * L.dyUp);
    }
  }

  // dragged run on top, with a shadow
  if (drag && drag.x != null) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 6;
    for (let j = 0; j < drag.cards.length; j++) {
      const c = drag.cards[j];
      drawCardImg(art.face(c.r, c.s), drag.x, drag.y + j * L.dyUp);
    }
    ctx.restore();
  }

  updateHud();
}

let lastClock = '';
let lastMoves = -1;
function updateHud() {
  const t = fmtTime(elapsed);
  if (t !== lastClock) { lastClock = t; clockEl.textContent = t; }
  if (game.moves !== lastMoves) {
    lastMoves = game.moves;
    movesEl.textContent = `${game.moves} move${game.moves === 1 ? '' : 's'}`;
  }
}

// ---------- main loop ----------

let last = performance.now();
let acc = 0;
function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (!paused) {
    acc += dt;
    while (acc >= STEP) {
      update(STEP);
      acc -= STEP;
    }
  }
  render();
  requestAnimationFrame(frame);
}

// ---------- boot ----------

resize();
newDeal(randomSeed());
requestAnimationFrame(frame);

// tiny read-only handle for debugging / automated smoke tests
Object.defineProperty(window, '__patience', {
  get: () => ({ game, L, drag, flights, winState, colX, pilePositions, stockRect, wasteTopRect, foundRect }),
});
})();

'use strict';

/* ================================================================
   QUARRY — a pentomino falling-stone puzzler
   12 pentominoes, 12x24 pit, earthy stone palette.
   Fixed-timestep logic (accumulator), canvas rendering,
   Web Audio synthesized sound, localStorage persistence.
   ================================================================ */

/* ---------------- constants ---------------- */

const COLS = 12;
const VISIBLE = 24;
const HIDDEN = 4;                 // spawn rows above the visible pit
const ROWS = VISIBLE + HIDDEN;

const CELL = 26;
const PAD = 8;
const PANEL = 116;
const BOARD_W = COLS * CELL;      // 312
const BOARD_H = VISIBLE * CELL;   // 624
const BX = PAD + PANEL + PAD;     // board x offset in canvas (132)
const BY = PAD;                   // board y offset (8)

const LOGIC_DT = 1000 / 60;       // fixed logic tick (ms)

const LOCK_MS = 500;              // lock delay once resting
const LOCK_RESETS = 12;           // max move/rotate lock resets per stone
const DAS_MS = 170;               // initial horizontal auto-shift delay
const ARR_MS = 40;                // auto-repeat rate

// Original kick offsets — tried in order on every rotation.
const KICKS = [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1]];

// Superlinear seam (line) scoring; pentominoes can clear five at once.
const CLEAR_SCORE = [0, 100, 300, 700, 1600, 4000];
const CLEAR_NAME = ['', 'CHIP', 'CLEAVE', 'SHEAR', 'AVALANCHE', 'MOTHERLODE'];

const LS_HIGH = 'arcade.quarry.high';
const LS_AUDIO = 'arcade.quarry.audio';

/* ---------------- the twelve pentominoes ----------------
   Each is 5 cells in a 5x5 box; rotations computed, kicks are ours. */

const PIECE_DEFS = [
  { n: 'F', c: '#7d925c', rows: ['.....', '..##.', '.##..', '..#..', '.....'] }, // moss
  { n: 'I', c: '#5d7285', rows: ['.....', '.....', '#####', '.....', '.....'] }, // slate
  { n: 'L', c: '#c1913f', rows: ['.....', '..#..', '..#..', '..#..', '..##.'] }, // ochre
  { n: 'N', c: '#a05e42', rows: ['.....', '...#.', '...#.', '..##.', '..#..'] }, // clay
  { n: 'P', c: '#c9b280', rows: ['.....', '.##..', '.##..', '.#...', '.....'] }, // sandstone
  { n: 'T', c: '#6c7078', rows: ['.....', '.###.', '..#..', '..#..', '.....'] }, // basalt
  { n: 'U', c: '#5f8a7a', rows: ['.....', '.#.#.', '.###.', '.....', '.....'] }, // lichen
  { n: 'V', c: '#8a6742', rows: ['.....', '.#...', '.#...', '.###.', '.....'] }, // umber
  { n: 'W', c: '#928b7d', rows: ['.....', '.#...', '.##..', '..##.', '.....'] }, // granite
  { n: 'X', c: '#9c4f3f', rows: ['.....', '..#..', '.###.', '..#..', '.....'] }, // ironstone
  { n: 'Y', c: '#7a6a4f', rows: ['.....', '...#.', '..##.', '...#.', '...#.'] }, // peat
  { n: 'Z', c: '#94a178', rows: ['.....', '.##..', '..#..', '..##.', '.....'] }, // sage
];

// Precompute cells for the 4 orientations of every piece.
// Clockwise rotation in the 5x5 box: (x, y) -> (4 - y, x).
const PIECES = PIECE_DEFS.map(def => {
  let cells = [];
  def.rows.forEach((row, y) => {
    for (let x = 0; x < 5; x++) if (row[x] === '#') cells.push([x, y]);
  });
  const rots = [cells];
  for (let r = 1; r < 4; r++) {
    rots.push(rots[r - 1].map(([x, y]) => [4 - y, x]));
  }
  return { name: def.n, color: def.c, rots };
});

/* ---------------- color helpers ---------------- */

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}
function shade(hex, f) {
  const [r, g, b] = hexToRgb(hex);
  const m = v => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

// Small deterministic PRNG for per-cell stone texture.
function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- audio ---------------- */

const AudioSys = {
  ctx: null,
  master: null,
  on: localStorage.getItem(LS_AUDIO) !== 'off',

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },

  toggle() {
    this.on = !this.on;
    localStorage.setItem(LS_AUDIO, this.on ? 'on' : 'off');
    return this.on;
  },

  blip(freq, dur = 0.05, type = 'square', gain = 0.12, slideTo = 0) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },

  noise(dur, freq, gain, slideTo) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq, t);
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  },

  move()    { this.blip(190, 0.03, 'square', 0.05); },
  rotate()  { this.blip(300, 0.045, 'square', 0.08); },
  softTick(){ this.blip(150, 0.02, 'square', 0.03); },
  stash()   { this.blip(430, 0.06, 'triangle', 0.1); },
  lockClk() { this.noise(0.06, 900, 0.12); },
  thunk() { // hard drop: dull stone impact
    this.noise(0.14, 420, 0.3, 90);
    this.blip(110, 0.13, 'sine', 0.28, 45);
  },
  clear(n) { // seam collapse rumble; 4s and 5s get the full quarry blast
    if (n >= 4) {
      this.noise(0.85, 700, 0.42, 60);
      this.blip(70, 0.7, 'sine', 0.32, 32);
      const base = n === 5 ? 240 : 200;
      [0, 1, 2, 3].forEach(i =>
        setTimeout(() => this.blip(base * Math.pow(1.335, i), 0.13, 'triangle', 0.16), 90 * i));
      if (n === 5) setTimeout(() => this.blip(base * 4, 0.35, 'triangle', 0.2), 380);
    } else {
      this.noise(0.3 + 0.12 * n, 500 + 120 * n, 0.22 + 0.06 * n, 80);
      this.blip(150 + 60 * n, 0.12, 'triangle', 0.12);
    }
  },
  levelUp() {
    this.blip(330, 0.1, 'triangle', 0.14);
    setTimeout(() => this.blip(495, 0.16, 'triangle', 0.14), 100);
  },
  over() {
    [300, 240, 190, 120].forEach((f, i) =>
      setTimeout(() => this.blip(f, 0.22, 'sawtooth', 0.1), 140 * i));
  },
};

/* ---------------- game state ---------------- */

const G = {
  state: 'menu',          // menu | playing | clearing | paused | over
  board: [],              // ROWS x COLS of null | {p: pieceIdx, s: seed}
  piece: null,            // {idx, rot, x, y, seed}
  hold: null,             // pieceIdx or null
  holdUsed: false,
  bag: [],
  queue: [],              // upcoming piece indexes (>= 3 kept)
  score: 0,
  lines: 0,
  level: 1,
  high: parseInt(localStorage.getItem(LS_HIGH) || '0', 10) || 0,

  gravTimer: 0,
  lockTimer: 0,
  lockResets: 0,
  grounded: false,

  softDown: false,
  dasDir: 0,              // -1 | 0 | 1 — active auto-shift direction
  dasTimer: 0,
  dasRepeating: false,
  heldDirs: [],           // stack of held horizontal keys, last = active

  clearingRows: [],
  clearTimer: 0,
  clearDur: 0,
  clearCount: 0,

  shakeT: 0,
  shakeMag: 0,
  particles: [],
  popups: [],
  pausedByBlur: false,
  confirmPrev: null,      // state to return to if the restart dialog is cancelled
};

function gravityMs(level) {
  return Math.max(80, Math.round(800 * Math.pow(0.78, level - 1)));
}

/* ---------------- board / piece logic ---------------- */

function emptyBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
}

function pieceCells(p) {
  return PIECES[p.idx].rots[p.rot].map(([cx, cy]) => [p.x + cx, p.y + cy]);
}

function fits(idx, rot, x, y) {
  for (const [cx, cy] of PIECES[idx].rots[rot]) {
    const ax = x + cx, ay = y + cy;
    if (ax < 0 || ax >= COLS || ay >= ROWS) return false;
    if (ay >= 0 && G.board[ay][ax]) return false;
  }
  return true;
}

function refillBag() {
  const b = [];
  for (let i = 0; i < 12; i++) b.push(i);
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  G.bag = b;
}

function drawFromBag() {
  if (G.bag.length === 0) refillBag();
  return G.bag.pop();
}

function topUpQueue() {
  while (G.queue.length < 4) G.queue.push(drawFromBag());
}

function spawnPosition(idx) {
  // Center the 5x5 box; sit the stone's lowest cells on the last hidden row
  // so every stone starts just above the visible pit (forgiving top-out).
  const cells = PIECES[idx].rots[0];
  const maxRow = Math.max(...cells.map(c => c[1]));
  return { x: Math.floor((COLS - 5) / 2), y: HIDDEN - 1 - maxRow };
}

function spawnPiece(idx) {
  const { x, y } = spawnPosition(idx);
  const p = { idx, rot: 0, x, y, seed: (Math.random() * 0xffffffff) >>> 0 };
  if (!fits(idx, 0, x, y)) {
    if (fits(idx, 0, x, y - 1)) p.y = y - 1;   // one extra row of grace
    else return null;                           // pit is full — game over
  }
  G.piece = p;
  G.gravTimer = 0;
  G.lockTimer = 0;
  G.lockResets = 0;
  G.grounded = false;
  G.holdUsed = false;
  return p;
}

function nextPiece() {
  topUpQueue();
  const idx = G.queue.shift();
  topUpQueue();
  if (!spawnPiece(idx)) gameOver();
}

function tryMove(dx) {
  const p = G.piece;
  if (!p) return false;
  if (!fits(p.idx, p.rot, p.x + dx, p.y)) return false;
  p.x += dx;
  onSuccessfulShift();
  AudioSys.move();
  return true;
}

function tryRotate(dir) {
  const p = G.piece;
  if (!p) return false;
  const nr = (p.rot + dir + 4) % 4;
  for (const [kx, ky] of KICKS) {
    if (fits(p.idx, nr, p.x + kx, p.y + ky)) {
      p.rot = nr;
      p.x += kx;
      p.y += ky;
      onSuccessfulShift();
      AudioSys.rotate();
      return true;
    }
  }
  return false;
}

// A successful move/rotate while resting resets the lock timer —
// but only LOCK_RESETS times per stone.
function onSuccessfulShift() {
  const p = G.piece;
  const restingNow = !fits(p.idx, p.rot, p.x, p.y + 1);
  if ((G.grounded || restingNow) && G.lockResets < LOCK_RESETS) {
    G.lockTimer = 0;
    G.lockResets++;
  }
  G.grounded = restingNow;
}

function ghostY() {
  const p = G.piece;
  if (!p) return 0;
  let y = p.y;
  while (fits(p.idx, p.rot, p.x, y + 1)) y++;
  return y;
}

function hardDrop() {
  const p = G.piece;
  if (!p) return;
  const gy = ghostY();
  const dist = gy - p.y;
  p.y = gy;
  G.score += dist * 2;
  G.shakeT = 90; G.shakeMag = 3;
  AudioSys.thunk();
  lockPiece();
}

function stashPiece() {
  if (G.holdUsed || !G.piece) return;
  const cur = G.piece.idx;
  AudioSys.stash();
  if (G.hold === null) {
    G.hold = cur;
    nextPiece();
  } else {
    const swap = G.hold;
    G.hold = cur;
    if (!spawnPiece(swap)) { gameOver(); return; }
  }
  G.holdUsed = true;
}

function lockPiece() {
  const p = G.piece;
  if (!p) return;
  const rnd = mulberry(p.seed);
  for (const [ax, ay] of pieceCells(p)) {
    if (ay >= 0) G.board[ay][ax] = { p: p.idx, s: (rnd() * 0xffff) | 0 };
  }
  G.piece = null;

  const full = [];
  for (let y = 0; y < ROWS; y++) {
    if (G.board[y].every(c => c)) full.push(y);
  }

  if (full.length > 0) {
    startClear(full);
  } else {
    AudioSys.lockClk();
    nextPiece();
  }
}

/* ---------------- seam clearing ---------------- */

function startClear(rows) {
  G.state = 'clearing';
  G.clearingRows = rows;
  G.clearCount = rows.length;
  G.clearTimer = 0;
  G.clearDur = rows.length >= 4 ? 620 : 380;

  const n = rows.length;
  const gained = CLEAR_SCORE[n] * G.level;
  G.score += gained;
  G.lines += n;

  AudioSys.clear(n);
  if (n >= 4) { G.shakeT = 500; G.shakeMag = n === 5 ? 9 : 6; }
  else if (n === 3) { G.shakeT = 200; G.shakeMag = 3; }

  // stone-chip particles from the cleared seams
  for (const y of rows) {
    const py = BY + (y - HIDDEN) * CELL + CELL / 2;
    const count = n >= 4 ? 26 : 12;
    for (let i = 0; i < count; i++) {
      const cellObj = G.board[y][Math.floor(Math.random() * COLS)];
      G.particles.push({
        x: BX + Math.random() * BOARD_W,
        y: py + (Math.random() - 0.5) * CELL,
        vx: (Math.random() - 0.5) * 0.24,
        vy: -Math.random() * 0.28 - 0.04,
        life: 500 + Math.random() * 400,
        t: 0,
        size: 2 + Math.random() * 3,
        color: cellObj ? PIECES[cellObj.p].color : '#8d8a94',
      });
    }
  }

  const midRow = rows.reduce((a, b) => a + b, 0) / rows.length;
  G.popups.push({
    text: `${CLEAR_NAME[n]}  +${gained}`,
    x: BX + BOARD_W / 2,
    y: BY + (midRow - HIDDEN) * CELL,
    t: 0,
    life: n >= 4 ? 1600 : 1000,
    big: n >= 4,
  });

  const newLevel = Math.floor(G.lines / 10) + 1;
  if (newLevel > G.level) {
    G.level = newLevel;
    AudioSys.levelUp();
    G.popups.push({
      text: `DEPTH ${G.level}`,
      x: BX + BOARD_W / 2,
      y: BY + BOARD_H / 3,
      t: 0, life: 1200, big: false,
    });
  }
}

function finishClear() {
  const keep = [];
  for (let y = 0; y < ROWS; y++) {
    if (!G.clearingRows.includes(y)) keep.push(G.board[y]);
  }
  while (keep.length < ROWS) keep.unshift(new Array(COLS).fill(null));
  G.board = keep;
  G.clearingRows = [];
  G.state = 'playing';
  nextPiece();
}

/* ---------------- game flow ---------------- */

function resetGame() {
  G.board = emptyBoard();
  G.piece = null;
  G.hold = null;
  G.holdUsed = false;
  G.bag = [];
  G.queue = [];
  G.score = 0;
  G.lines = 0;
  G.level = 1;
  G.gravTimer = 0;
  G.lockTimer = 0;
  G.lockResets = 0;
  G.grounded = false;
  G.softDown = false;
  G.dasDir = 0;
  G.dasTimer = 0;
  G.dasRepeating = false;
  G.heldDirs = [];
  G.clearingRows = [];
  G.particles = [];
  G.popups = [];
  G.shakeT = 0;
  refillBag();
  topUpQueue();
}

function startGame() {
  resetGame();
  G.state = 'playing';
  nextPiece();
  hideOverlay();
}

function gameOver() {
  G.state = 'over';
  G.piece = null;
  AudioSys.over();
  if (G.score > G.high) {
    G.high = G.score;
    localStorage.setItem(LS_HIGH, String(G.high));
  }
  showOverlay('PIT FLOODED', `score <b>${G.score}</b> &middot; high <b>${G.high}</b>`,
    'press <b>any key</b> to dig again');
}

function pauseGame(byBlur) {
  if (G.state !== 'playing' && G.state !== 'clearing') return;
  G.pausedState = G.state;
  G.state = 'paused';
  G.pausedByBlur = !!byBlur;
  showOverlay('PAUSED', '', 'press <b>P</b> to resume');
}

function resumeGame() {
  if (G.state !== 'paused') return;
  G.state = G.pausedState || 'playing';
  hideOverlay();
}

/* ---------------- restart confirmation ----------------
   R during a live run opens a confirm dialog instead of instantly
   restarting, so a mis-press can't destroy the dig. While the dialog
   is open the state is 'confirm', which logicTick treats as frozen.
   After game over there is nothing to lose, so restart stays instant. */

function openRestartConfirm() {
  if (G.state !== 'playing' && G.state !== 'clearing') return;
  G.confirmPrev = G.state;
  G.state = 'confirm';
  // drop any held inputs so nothing sticks while the dialog is up
  G.softDown = false;
  G.dasDir = 0;
  G.dasTimer = 0;
  G.dasRepeating = false;
  G.heldDirs = [];
  showOverlay('RESTART?',
    'restart this run? the current dig will be lost',
    '<b>Enter</b> restart &middot; <b>Esc</b> keep digging', true);
}

function cancelRestartConfirm() {
  if (G.state !== 'confirm') return;
  G.state = G.confirmPrev || 'playing';
  G.confirmPrev = null;
  hideOverlay();
}

function confirmRestart() {
  if (G.state !== 'confirm') return;
  G.confirmPrev = null;
  startGame();
}

/* ---------------- fixed-timestep logic ---------------- */

function logicTick(dt) {
  // particles + popups tick in every active state
  for (const pt of G.particles) {
    pt.t += dt;
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.vy += 0.0011 * dt;
  }
  G.particles = G.particles.filter(pt => pt.t < pt.life);
  for (const pp of G.popups) pp.t += dt;
  G.popups = G.popups.filter(pp => pp.t < pp.life);
  if (G.shakeT > 0) G.shakeT -= dt;

  if (G.state === 'clearing') {
    G.clearTimer += dt;
    if (G.clearTimer >= G.clearDur) finishClear();
    return;
  }
  if (G.state !== 'playing' || !G.piece) return;

  // DAS horizontal auto-shift
  if (G.dasDir !== 0) {
    G.dasTimer += dt;
    if (!G.dasRepeating) {
      if (G.dasTimer >= DAS_MS) {
        G.dasRepeating = true;
        G.dasTimer = 0;
        tryMove(G.dasDir);
      }
    } else {
      while (G.dasTimer >= ARR_MS) {
        G.dasTimer -= ARR_MS;
        if (!tryMove(G.dasDir)) { G.dasTimer = 0; break; }
      }
    }
  }

  // gravity / lock delay
  const p = G.piece;
  G.grounded = !fits(p.idx, p.rot, p.x, p.y + 1);

  if (G.grounded) {
    G.gravTimer = 0;
    G.lockTimer += dt;
    if (G.lockTimer >= LOCK_MS) lockPiece();
  } else {
    const base = gravityMs(G.level);
    const interval = G.softDown ? Math.max(base / 10, 15) : base;
    G.gravTimer += dt;
    while (G.gravTimer >= interval && G.piece) {
      G.gravTimer -= interval;
      if (fits(p.idx, p.rot, p.x, p.y + 1)) {
        p.y++;
        if (G.softDown) { G.score += 1; AudioSys.softTick(); }
        G.lockTimer = 0;
      } else {
        G.grounded = true;
        break;
      }
    }
  }
}

/* ---------------- rendering ---------------- */

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function drawStoneCell(x, y, size, pieceIdx, seed, alpha) {
  const base = PIECES[pieceIdx].color;
  const bevel = Math.max(2, Math.round(size * 0.14));
  if (alpha !== undefined) ctx.globalAlpha = alpha;

  // face
  ctx.fillStyle = base;
  ctx.fillRect(x, y, size, size);
  // chiseled bevels
  ctx.fillStyle = shade(base, 1.32);
  ctx.fillRect(x, y, size, bevel);                        // top
  ctx.fillRect(x, y, bevel, size);                        // left
  ctx.fillStyle = shade(base, 0.62);
  ctx.fillRect(x, y + size - bevel, size, bevel);         // bottom
  ctx.fillRect(x + size - bevel, y, bevel, size);         // right
  // inner face, tone varied per stone
  const rnd = mulberry(seed + pieceIdx * 7919);
  const tone = 0.9 + rnd() * 0.18;
  ctx.fillStyle = shade(base, tone);
  ctx.fillRect(x + bevel, y + bevel, size - 2 * bevel, size - 2 * bevel);

  // speckle + hairline crack texture
  const inner = size - 2 * bevel;
  for (let i = 0; i < 4; i++) {
    const sx = x + bevel + rnd() * inner;
    const sy = y + bevel + rnd() * inner;
    ctx.fillStyle = rnd() < 0.5 ? shade(base, 0.7) : shade(base, 1.2);
    ctx.fillRect(sx, sy, Math.max(1, size * 0.06), Math.max(1, size * 0.06));
  }
  if (rnd() < 0.6) {
    ctx.strokeStyle = shade(base, 0.72);
    ctx.lineWidth = 1;
    ctx.beginPath();
    const cx = x + bevel + rnd() * inner;
    const cy = y + bevel + rnd() * inner;
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + (rnd() - 0.5) * inner * 0.8, cy + (rnd() - 0.5) * inner * 0.8);
    ctx.stroke();
  }
  if (alpha !== undefined) ctx.globalAlpha = 1;
}

function drawGhostCell(x, y, size, pieceIdx) {
  const base = PIECES[pieceIdx].color;
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = base;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 2, y + 2, size - 4, size - 4);
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = base;
  ctx.fillRect(x + 2, y + 2, size - 4, size - 4);
  ctx.globalAlpha = 1;
}

function drawMini(pieceIdx, cx, cy, size, dim) {
  // draw a piece centered at (cx, cy) with small cells
  const cells = PIECES[pieceIdx].rots[0];
  const xs = cells.map(c => c[0]), ys = cells.map(c => c[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = (maxX - minX + 1) * size, h = (maxY - minY + 1) * size;
  const ox = cx - w / 2, oy = cy - h / 2;
  for (const [px, py] of cells) {
    drawStoneCell(ox + (px - minX) * size, oy + (py - minY) * size,
      size, pieceIdx, px * 31 + py * 17, dim ? 0.35 : undefined);
  }
}

function panelBox(x, y, w, h, label) {
  ctx.fillStyle = '#101318';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#2a2f38';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = '#7c8592';
  ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(label, x + w / 2, y + 16);
}

function render() {
  ctx.fillStyle = '#0a0c0f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  if (G.shakeT > 0) {
    const m = G.shakeMag * (G.shakeT / 500);
    ctx.translate((Math.random() - 0.5) * 2 * m, (Math.random() - 0.5) * 2 * m);
  }

  /* --- side panels --- */
  panelBox(PAD, BY, PANEL, 110, 'STASH');
  if (G.hold !== null) drawMini(G.hold, PAD + PANEL / 2, BY + 66, 16, G.holdUsed);

  const nx = BX + BOARD_W + PAD;
  panelBox(nx, BY, PANEL, 300, 'NEXT');
  for (let i = 0; i < 3; i++) {
    if (G.queue[i] !== undefined) {
      drawMini(G.queue[i], nx + PANEL / 2, BY + 70 + i * 92, 16);
    }
  }

  // depth meter under next panel
  ctx.fillStyle = '#7c8592';
  ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('DEPTH', nx + PANEL / 2, BY + 330);
  ctx.fillStyle = '#c8a24f';
  ctx.font = 'bold 26px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillText(String(G.level), nx + PANEL / 2, BY + 358);
  ctx.fillStyle = '#7c8592';
  ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillText('SEAMS', nx + PANEL / 2, BY + 390);
  ctx.fillStyle = '#c8a24f';
  ctx.font = 'bold 20px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillText(String(G.lines), nx + PANEL / 2, BY + 414);

  /* --- pit --- */
  ctx.fillStyle = '#0e1115';
  ctx.fillRect(BX, BY, BOARD_W, BOARD_H);
  // faint grid
  ctx.strokeStyle = 'rgba(255,255,255,0.028)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 1; x < COLS; x++) {
    ctx.moveTo(BX + x * CELL + 0.5, BY);
    ctx.lineTo(BX + x * CELL + 0.5, BY + BOARD_H);
  }
  for (let y = 1; y < VISIBLE; y++) {
    ctx.moveTo(BX, BY + y * CELL + 0.5);
    ctx.lineTo(BX + BOARD_W, BY + y * CELL + 0.5);
  }
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.rect(BX, BY, BOARD_W, BOARD_H);
  ctx.clip();

  // locked stones
  for (let y = HIDDEN; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const c = G.board[y][x];
      if (c) drawStoneCell(BX + x * CELL, BY + (y - HIDDEN) * CELL, CELL, c.p, c.s);
    }
  }

  // clearing flash
  if (G.state === 'clearing') {
    const big = G.clearCount >= 4;
    const pulse = 0.35 + 0.45 * Math.abs(Math.sin(G.clearTimer / (big ? 55 : 45)));
    for (const y of G.clearingRows) {
      ctx.globalAlpha = pulse;
      ctx.fillStyle = big ? '#ffd98a' : '#e8eaed';
      ctx.fillRect(BX, BY + (y - HIDDEN) * CELL, BOARD_W, CELL);
    }
    ctx.globalAlpha = 1;
  }

  // ghost + falling stone
  if (G.piece && G.state === 'playing') {
    const gy = ghostY();
    if (gy !== G.piece.y) {
      for (const [cx, cy] of PIECES[G.piece.idx].rots[G.piece.rot]) {
        const ax = G.piece.x + cx, ay = gy + cy;
        if (ay >= HIDDEN) {
          drawGhostCell(BX + ax * CELL, BY + (ay - HIDDEN) * CELL, CELL, G.piece.idx);
        }
      }
    }
    const cells = PIECES[G.piece.idx].rots[G.piece.rot];
    for (let i = 0; i < cells.length; i++) {
      const ax = G.piece.x + cells[i][0], ay = G.piece.y + cells[i][1];
      if (ay >= HIDDEN - 1) { // let stones peek from the spawn rows
        drawStoneCell(BX + ax * CELL, BY + (ay - HIDDEN) * CELL, CELL,
          G.piece.idx, G.piece.seed + i * 101);
      }
    }
  }

  // particles
  for (const pt of G.particles) {
    ctx.globalAlpha = Math.max(0, 1 - pt.t / pt.life);
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x, pt.y, pt.size, pt.size);
  }
  ctx.globalAlpha = 1;

  ctx.restore(); // unclip

  // pit rim
  ctx.strokeStyle = '#2a2f38';
  ctx.strokeRect(BX - 0.5, BY - 0.5, BOARD_W + 1, BOARD_H + 1);

  // popups (drawn over everything)
  for (const pp of G.popups) {
    const k = pp.t / pp.life;
    ctx.globalAlpha = k < 0.15 ? k / 0.15 : Math.max(0, 1 - (k - 0.15) / 0.85);
    ctx.fillStyle = pp.big ? '#ffd98a' : '#e8eaed';
    ctx.font = `${pp.big ? 'bold 26px' : '15px'} ui-monospace, Menlo, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(pp.text, pp.x, pp.y - k * 34);
  }
  ctx.globalAlpha = 1;

  ctx.restore(); // unshake
}

/* ---------------- HUD / overlay ---------------- */

const $score = document.getElementById('hud-score');
const $high = document.getElementById('hud-high');
const $lines = document.getElementById('hud-lines');
const $level = document.getElementById('hud-level');
const $overlay = document.getElementById('overlay');
const $oTitle = document.getElementById('overlay-title');
const $oSub = document.getElementById('overlay-sub');
const $oAction = document.getElementById('overlay-action');
const $audioBtn = document.getElementById('audio-toggle');
const $confirmBtns = document.getElementById('confirm-buttons');
const $confirmYes = document.getElementById('confirm-yes');
const $confirmNo = document.getElementById('confirm-no');

function syncHud() {
  $score.textContent = G.score;
  $high.textContent = Math.max(G.high, G.score);
  $lines.textContent = G.lines;
  $level.textContent = G.level;
}

function showOverlay(title, sub, action, withConfirm) {
  $oTitle.textContent = title;
  $oSub.innerHTML = sub || '';
  $oAction.innerHTML = action || '';
  $confirmBtns.classList.toggle('hidden', !withConfirm);
  $overlay.classList.remove('hidden');
}
function hideOverlay() {
  $overlay.classList.add('hidden');
}

function syncAudioBtn() {
  $audioBtn.textContent = AudioSys.on ? 'SND ON' : 'SND OFF';
  $audioBtn.classList.toggle('off', !AudioSys.on);
}
syncAudioBtn();

/* ---------------- input ---------------- */

const GAME_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' ',
  'a', 'd', 's', 'w', 'x', 'z', 'c', 'p', 'm', 'r',
  'A', 'D', 'S', 'W', 'X', 'Z', 'C', 'P', 'M', 'R', 'Shift',
]);

function startShift(dir) {
  if (!G.heldDirs.includes(dir)) G.heldDirs.push(dir);
  G.dasDir = dir;
  G.dasTimer = 0;
  G.dasRepeating = false;
  tryMove(dir); // immediate single step
}

function stopShift(dir) {
  G.heldDirs = G.heldDirs.filter(d => d !== dir);
  if (G.dasDir === dir) {
    const other = G.heldDirs[G.heldDirs.length - 1] || 0;
    G.dasDir = other;
    G.dasTimer = 0;
    G.dasRepeating = false;
  }
}

document.addEventListener('keydown', e => {
  if (GAME_KEYS.has(e.key)) e.preventDefault();
  AudioSys.ensure();

  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  // sound toggle works everywhere
  if (k === 'm') { AudioSys.toggle(); syncAudioBtn(); return; }

  // restart confirmation dialog: Enter confirms, Esc cancels
  if (G.state === 'confirm') {
    if (e.key === 'Enter') { e.preventDefault(); confirmRestart(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelRestartConfirm(); }
    return;
  }

  if (G.state === 'menu') { startGame(); return; }
  if (G.state === 'over') { startGame(); return; }

  if (k === 'p') {
    if (G.state === 'paused') resumeGame();
    else pauseGame(false);
    return;
  }
  if (G.state === 'paused') return;

  if (k === 'r' && !e.repeat) { openRestartConfirm(); return; }

  if (G.state !== 'playing') return;

  switch (k) {
    case 'ArrowLeft': case 'a':
      if (!e.repeat) startShift(-1);
      break;
    case 'ArrowRight': case 'd':
      if (!e.repeat) startShift(1);
      break;
    case 'ArrowDown': case 's':
      G.softDown = true;
      break;
    case 'ArrowUp': case 'w': case 'x':
      if (!e.repeat) tryRotate(1);
      break;
    case 'z':
      if (!e.repeat) tryRotate(-1);
      break;
    case ' ':
      if (!e.repeat) hardDrop();
      break;
    case 'c': case 'Shift':
      if (!e.repeat) stashPiece();
      break;
  }
});

document.addEventListener('keyup', e => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  switch (k) {
    case 'ArrowLeft': case 'a': stopShift(-1); break;
    case 'ArrowRight': case 'd': stopShift(1); break;
    case 'ArrowDown': case 's': G.softDown = false; break;
  }
});

$audioBtn.addEventListener('click', () => {
  AudioSys.ensure();
  AudioSys.toggle();
  syncAudioBtn();
  $audioBtn.blur();
});

$confirmYes.addEventListener('click', e => {
  e.stopPropagation();
  $confirmYes.blur();
  confirmRestart();
});
$confirmNo.addEventListener('click', e => {
  e.stopPropagation();
  $confirmNo.blur();
  cancelRestartConfirm();
});

$overlay.addEventListener('click', () => {
  AudioSys.ensure();
  if (G.state === 'menu' || G.state === 'over') startGame();
  else if (G.state === 'paused' && !G.pausedByBlur) resumeGame();
});

window.addEventListener('blur', () => pauseGame(true));

/* ---------------- main loop (accumulator) ---------------- */

let lastTime = performance.now();
let acc = 0;

function frame(now) {
  let elapsed = now - lastTime;
  lastTime = now;
  if (elapsed > 250) elapsed = 250; // tab-back clamp
  acc += elapsed;
  while (acc >= LOGIC_DT) {
    logicTick(LOGIC_DT);
    acc -= LOGIC_DT;
  }
  syncHud();
  render();
  requestAnimationFrame(frame);
}

resetGame();
syncHud();
requestAnimationFrame(frame);

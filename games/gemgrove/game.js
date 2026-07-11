'use strict';
/*
 * Gemgrove — a swap-adjacent match-3, built from scratch.
 *
 * Fixed-timestep logic (accumulator), interpolated rendering.
 * All graphics canvas-drawn, all audio Web Audio-synthesized.
 */
(() => {

// ---------------------------------------------------------------- constants

const COLS = 8, ROWS = 8, NTYPES = 6;
const SIZE = 480, CELL = SIZE / COLS;
const DT = 1 / 60;                 // fixed logic tick
const SWAP_T = 0.16;               // swap animation seconds
const CLEAR_T = 0.24;              // clear (shrink) animation seconds
const SHUFFLE_T = 0.28;            // each half of the reshuffle fade
const GRAV = 42;                   // fall acceleration, cells / s^2
const MAXV = 26;                   // terminal fall speed, cells / s
const HINT_DELAY = 5;              // seconds idle before pulsing a hint
const BASE_GEM_SCORE = 10;
const LS = 'arcade.gemgrove.';

// 6 gem kinds: distinct shape AND colour (colourblind-friendly)
const GEMS = [
  { shape: 'diamond',  color: '#ff5064', dark: '#8f1f30', hi: '#ffc2ca' },
  { shape: 'hex',      color: '#ffab38', dark: '#965910', hi: '#ffe3b3' },
  { shape: 'triangle', color: '#54d96e', dark: '#1d7031', hi: '#c8f7d2' },
  { shape: 'circle',   color: '#3ec8f0', dark: '#155f7d', hi: '#c8efff' },
  { shape: 'square',   color: '#8f80ff', dark: '#3d3390', hi: '#d9d3ff' },
  { shape: 'star',     color: '#f56cc8', dark: '#8a2a6b', hi: '#ffd3f0' },
];

// ---------------------------------------------------------------- dom

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);
const el = {
  level: $('level'), moves: $('moves'), score: $('score'), best: $('best'),
  goalFill: $('goal-fill'), goalText: $('goal-text'),
  overlay: $('overlay'), oTitle: $('overlay-title'), oSub: $('overlay-sub'),
  oDetail: $('overlay-detail'), toast: $('toast'), audio: $('audio-toggle'),
};

const dpr = Math.min(window.devicePixelRatio || 1, 2);
canvas.width = SIZE * dpr;
canvas.height = SIZE * dpr;

// ---------------------------------------------------------------- storage

function lsGet(k, d) {
  try { const v = localStorage.getItem(LS + k); return v === null ? d : v; }
  catch (e) { return d; }
}
function lsSet(k, v) {
  try { localStorage.setItem(LS + k, String(v)); } catch (e) { /* private mode */ }
}

// ---------------------------------------------------------------- audio

const Sound = {
  on: lsGet('audio', '1') === '1',
  ctx: null,
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { this.ctx = null; }
  },
  tone(f0, f1, dur, type, peak, delay) {
    if (!this.on || !this.ctx) return;
    const c = this.ctx, t0 = c.currentTime + (delay || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(Math.max(20, f0), t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak || 0.12, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.03);
  },
  noise(dur, freq, peak, delay) {
    if (!this.on || !this.ctx) return;
    const c = this.ctx, t0 = c.currentTime + (delay || 0);
    const n = Math.max(1, (dur * c.sampleRate) | 0);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.9;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak || 0.1, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start(t0); src.stop(t0 + dur + 0.03);
  },
  // -- game voices ----------------------------------------------------------
  select()  { this.tone(540, 540, 0.05, 'square', 0.045); },
  swap()    { this.noise(0.09, 1100, 0.1); },
  deny()    { this.tone(210, 130, 0.16, 'sawtooth', 0.07); },
  // clear chime — pitch rises with cascade chain depth
  clear(chain) {
    const step = Math.min(chain - 1, 9);
    const f = 440 * Math.pow(2, (step * 2) / 12);
    this.tone(f, f, 0.14, 'triangle', 0.11);
    this.tone(f * 1.498, f * 1.498, 0.16, 'triangle', 0.08, 0.055);
  },
  drop()    { this.tone(150, 65, 0.07, 'sine', 0.11); this.noise(0.03, 2400, 0.04); },
  cross()   { this.tone(280, 1400, 0.28, 'sawtooth', 0.09); },
  burst()   { this.noise(0.34, 320, 0.18); this.tone(95, 45, 0.3, 'sine', 0.14); },
  shuffle() { this.noise(0.3, 620, 0.07); this.tone(500, 900, 0.25, 'sine', 0.05); },
  win() {
    [523, 659, 784, 1046].forEach((f, i) =>
      this.tone(f, f, 0.16, 'triangle', 0.1, i * 0.09));
  },
  lose() {
    this.tone(330, 300, 0.24, 'triangle', 0.1);
    this.tone(220, 170, 0.38, 'triangle', 0.1, 0.22);
  },
};

function setAudioLabel() {
  el.audio.textContent = 'sound: ' + (Sound.on ? 'on' : 'off');
}
function toggleAudio() {
  Sound.on = !Sound.on;
  lsSet('audio', Sound.on ? '1' : '0');
  setAudioLabel();
  if (Sound.on) { Sound.init(); Sound.select(); }
}
setAudioLabel();

// ---------------------------------------------------------------- state

let grid = [];              // grid[r][c] -> cell object (never null when stable)
let mode = 'start';         // start | play | levelend | gameover
let paused = false;
let phase = 'awaiting';     // awaiting | swapping | clearing | falling | shuffling
let level = parseInt(lsGet('level', '1'), 10) || 1;
let levelStartScore = parseInt(lsGet('score', '0'), 10) || 0;
let best = parseInt(lsGet('best', '0'), 10) || 0;
let score = levelStartScore;
let target = 0, moves = 0;
let targetToastShown = false;

let chain = 0;              // cascade depth: x1, x2, x3 ...
let swapAnim = null;        // {a,b,tm,kind:'try'|'revert'}
let swapSites = null;       // where the player swapped (special spawn priority)
let pendingClear = null;    // {clearSet:Set<key>, spawns:Map<key,{t,s}>}
let clearT = 0;
let shuffleStage = 0, shuffleT = 0;

let sel = null;             // {r,c} selected gem
let drag = null;            // pointer drag origin
let idleT = 0, hintMove = null;
let validMoves = [];
let particles = [];
let comboFlash = null;      // {text, t}
let animTime = 0;
let landSoundCd = 0;
let toastTimer = null;

const key = (r, c) => r * COLS + c;
const kr = (k) => (k / COLS) | 0;
const kc = (k) => k % COLS;
const randType = () => (Math.random() * NTYPES) | 0;

function makeCell(t) {
  return {
    t, s: null,               // s: null | 'cross' | 'burst'
    ox: 0, oy: 0, vy: 0,      // visual offset (cell units) + fall velocity
    scale: 1, clearing: false,
    spawnGlow: 0,
    pox: 0, poy: 0, pscale: 1, // previous tick (render interpolation)
  };
}

// ---------------------------------------------------------------- board

function levelTarget(n) { return 1000 + (n - 1) * 850; }
function levelMoves(n)  { return 20 + Math.floor((n - 1) / 3); }

// generation: no pre-existing matches AND at least one valid move
function buildBoard() {
  let guard = 0;
  do {
    grid = [];
    for (let r = 0; r < ROWS; r++) {
      const row = [];
      for (let c = 0; c < COLS; c++) {
        let t;
        do { t = randType(); }
        while ((c >= 2 && row[c - 1].t === t && row[c - 2].t === t) ||
               (r >= 2 && grid[r - 1][c].t === t && grid[r - 2][c].t === t));
        row.push(makeCell(t));
      }
      grid.push(row);
    }
  } while (computeValidMoves().length === 0 && ++guard < 200);

  // deal-in: whole columns drop from above the frame, staggered per column
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cl = grid[r][c];
      cl.oy = -(ROWS + 1) - c * 0.35;
      cl.poy = cl.oy;
    }
  }
}

// horizontal + vertical runs of 3+; intersections merge naturally in beginClear
function findRuns() {
  const runs = [];
  for (let r = 0; r < ROWS; r++) {
    let c = 0;
    while (c < COLS) {
      const t = grid[r][c].t;
      let e = c + 1;
      while (e < COLS && grid[r][e].t === t) e++;
      if (e - c >= 3) {
        const cells = [];
        for (let i = c; i < e; i++) cells.push({ r, c: i });
        runs.push({ cells, t, dir: 'row' });
      }
      c = e;
    }
  }
  for (let c = 0; c < COLS; c++) {
    let r = 0;
    while (r < ROWS) {
      const t = grid[r][c].t;
      let e = r + 1;
      while (e < ROWS && grid[e][c].t === t) e++;
      if (e - r >= 3) {
        const cells = [];
        for (let i = r; i < e; i++) cells.push({ r: i, c });
        runs.push({ cells, t, dir: 'col' });
      }
      r = e;
    }
  }
  return runs;
}

function matchAt(r, c) {
  const t = grid[r][c].t;
  let n = 1;
  for (let i = c - 1; i >= 0 && grid[r][i].t === t; i--) n++;
  for (let i = c + 1; i < COLS && grid[r][i].t === t; i++) n++;
  if (n >= 3) return true;
  n = 1;
  for (let i = r - 1; i >= 0 && grid[i][c].t === t; i--) n++;
  for (let i = r + 1; i < ROWS && grid[i][c].t === t; i++) n++;
  return n >= 3;
}

function computeValidMoves() {
  const out = [];
  const test = (r1, c1, r2, c2) => {
    const a = grid[r1][c1], b = grid[r2][c2];
    grid[r1][c1] = b; grid[r2][c2] = a;
    const ok = matchAt(r1, c1) || matchAt(r2, c2);
    grid[r1][c1] = a; grid[r2][c2] = b;
    return ok;
  };
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS && test(r, c, r, c + 1))
        out.push({ a: { r, c }, b: { r, c: c + 1 } });
      if (r + 1 < ROWS && test(r, c, r + 1, c))
        out.push({ a: { r, c }, b: { r: r + 1, c } });
    }
  }
  return out;
}

// ---------------------------------------------------------------- resolution

function beginClear(runs) {
  const clearSet = new Set();
  const runCount = new Map(); // key -> number of runs touching (intersections)
  for (const run of runs) {
    for (const cl of run.cells) {
      const k = key(cl.r, cl.c);
      clearSet.add(k);
      runCount.set(k, (runCount.get(k) || 0) + 1);
    }
  }

  // special gems caught in the clear trigger their effect (and can chain)
  let crossFired = false, burstFired = false;
  const queue = [...clearSet];
  const processed = new Set();
  const enqueue = (k) => {
    if (!clearSet.has(k)) { clearSet.add(k); queue.push(k); }
  };
  while (queue.length) {
    const k = queue.pop();
    if (processed.has(k)) continue;
    processed.add(k);
    const cl = grid[kr(k)][kc(k)];
    if (!cl || !cl.s) continue;
    if (cl.s === 'cross') {
      crossFired = true;
      for (let i = 0; i < COLS; i++) enqueue(key(kr(k), i));
      for (let i = 0; i < ROWS; i++) enqueue(key(i, kc(k)));
    } else if (cl.s === 'burst') {
      burstFired = true;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = kr(k) + dr, nc = kc(k) + dc;
          if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) enqueue(key(nr, nc));
        }
      }
    }
  }

  // new specials: 5+ run -> burst, 4 run -> cross, run intersection -> burst.
  // spawn at the swap site when the player's swap made the run.
  const spawns = new Map();
  for (const [k, n] of runCount) {
    if (n >= 2 && !spawns.has(k)) {
      spawns.set(k, { t: grid[kr(k)][kc(k)].t, s: 'burst' });
    }
  }
  for (const run of runs) {
    if (run.cells.length < 4) continue;
    const s = run.cells.length >= 5 ? 'burst' : 'cross';
    let pos = null;
    if (chain === 1 && swapSites) {
      pos = run.cells.find((cl) =>
        swapSites.some((ss) => ss.r === cl.r && ss.c === cl.c));
    }
    if (!pos) pos = run.cells[run.cells.length >> 1];
    let k = key(pos.r, pos.c);
    if (spawns.has(k)) {
      pos = run.cells.find((cl) => !spawns.has(key(cl.r, cl.c)));
      if (!pos) continue;
      k = key(pos.r, pos.c);
    }
    spawns.set(k, { t: run.t, s });
  }

  // scoring: cascade multiplier is the chain depth (x1, x2, x3, ...)
  score += clearSet.size * BASE_GEM_SCORE * chain;
  if (score > best) { best = score; lsSet('best', best); }
  if (!targetToastShown && score - levelStartScore >= target) {
    targetToastShown = true;
    showToast('target reached — bank the rest!');
  }
  if (chain >= 2) comboFlash = { text: 'chain x' + chain, t: 0 };

  for (const k of clearSet) {
    const cl = grid[kr(k)][kc(k)];
    cl.clearing = true;
    spawnParticles(kc(k) + 0.5, kr(k) + 0.5, GEMS[cl.t].color);
  }

  Sound.clear(chain);
  if (crossFired) Sound.cross();
  if (burstFired) Sound.burst();

  pendingClear = { clearSet, spawns };
  clearT = 0;
  phase = 'clearing';
  updateHUD();
}

function applyClear() {
  const { clearSet, spawns } = pendingClear;
  for (const k of clearSet) grid[kr(k)][kc(k)] = null;
  for (const [k, sp] of spawns) {
    const cl = makeCell(sp.t);
    cl.s = sp.s;
    cl.scale = 1.4; cl.pscale = 1.4;
    cl.spawnGlow = 1;
    grid[kr(k)][kc(k)] = cl;
  }
  pendingClear = null;
  compactAndRefill();
  phase = 'falling';
}

// gravity-drop columns, then refill from the top
function compactAndRefill() {
  for (let c = 0; c < COLS; c++) {
    let write = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      const cl = grid[r][c];
      if (cl) {
        if (write !== r) {
          grid[write][c] = cl;
          grid[r][c] = null;
          cl.oy += r - write;   // negative: renders at old spot, falls to 0
          cl.poy = cl.oy;
        }
        write--;
      }
    }
    const holes = write + 1;
    for (let r = write; r >= 0; r--) {
      const cl = makeCell(randType());
      cl.oy = -holes;           // stacked just above the frame
      cl.poy = cl.oy;
      grid[r][c] = cl;
    }
  }
}

// board is stable again: cascade? shuffle? level over?
function postResolve() {
  const runs = findRuns();
  if (runs.length) {
    chain++;
    beginClear(runs);
    return;
  }
  chain = 0;
  swapSites = null;
  if (moves <= 0) { endLevel(); return; }
  validMoves = computeValidMoves();
  if (validMoves.length === 0) { startShuffle(); return; }
  phase = 'awaiting';
  idleT = 0;
  hintMove = null;
}

function endLevel() {
  updateHUD();
  if (score - levelStartScore >= target) {
    mode = 'levelend';
    lsSet('level', level + 1);
    lsSet('score', score);
    lsSet('best', best);
    Sound.win();
    showOverlay('LEVEL ' + level + ' CLEAR',
      'scored ' + (score - levelStartScore) + ' / ' + target,
      'click or press a key for level ' + (level + 1));
  } else {
    mode = 'gameover';
    Sound.lose();
    showOverlay('OUT OF MOVES',
      (score - levelStartScore) + ' / ' + target + ' — the grove dims',
      'click or press R to retry level ' + level);
  }
}

// ---------------------------------------------------------------- reshuffle

function startShuffle() {
  phase = 'shuffling';
  shuffleStage = 0;
  shuffleT = 0;
  sel = null;
  hintMove = null;
  showToast('no moves left — reshuffling the grove');
  Sound.shuffle();
}

// rearrange the existing gems (score + specials preserved) until the board
// has no ready-made matches and at least one valid move
function applyShuffle() {
  const items = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      items.push({ t: grid[r][c].t, s: grid[r][c].s });

  const place = () => {
    let i = 0;
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        grid[r][c].t = items[i].t;
        grid[r][c].s = items[i].s;
        i++;
      }
  };

  let ok = false;
  for (let tries = 0; tries < 400 && !ok; tries++) {
    for (let i = items.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const tmp = items[i]; items[i] = items[j]; items[j] = tmp;
    }
    place();
    ok = findRuns().length === 0 && computeValidMoves().length > 0;
  }
  if (!ok) {
    // pathological multiset: refill with constrained random types,
    // then drop the surviving specials back on random cells
    const specials = items.filter((it) => it.s).map((it) => it.s);
    let guard = 0;
    do {
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          let t;
          do { t = randType(); }
          while ((c >= 2 && grid[r][c - 1].t === t && grid[r][c - 2].t === t) ||
                 (r >= 2 && grid[r - 1][c].t === t && grid[r - 2][c].t === t));
          grid[r][c].t = t;
          grid[r][c].s = null;
        }
    } while (computeValidMoves().length === 0 && ++guard < 200);
    for (const s of specials) {
      const r = (Math.random() * ROWS) | 0, c = (Math.random() * COLS) | 0;
      if (!grid[r][c].s) grid[r][c].s = s;
    }
  }
}

// ---------------------------------------------------------------- swapping

function isAdjacent(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
}

function doSwap(a, b) {
  if (phase !== 'awaiting' || mode !== 'play' || paused) return;
  sel = null;
  hintMove = null;
  idleT = 0;
  const tmp = grid[a.r][a.c];
  grid[a.r][a.c] = grid[b.r][b.c];
  grid[b.r][b.c] = tmp;
  swapAnim = { a, b, tm: 0, kind: 'try' };
  phase = 'swapping';
  Sound.swap();
}

const easeInOut = (p) => p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;

function tickSwap(dt) {
  swapAnim.tm += dt;
  const p = Math.min(1, swapAnim.tm / SWAP_T);
  const e = 1 - easeInOut(p);
  const { a, b } = swapAnim;
  const ca = grid[a.r][a.c], cb = grid[b.r][b.c];
  ca.ox = (b.c - a.c) * e; ca.oy = (b.r - a.r) * e;
  cb.ox = (a.c - b.c) * e; cb.oy = (a.r - b.r) * e;
  if (p < 1) return;
  ca.ox = ca.oy = cb.ox = cb.oy = 0;
  if (swapAnim.kind === 'try') {
    const runs = findRuns();
    if (runs.length) {
      moves--;
      chain = 1;
      swapSites = [{ r: a.r, c: a.c }, { r: b.r, c: b.c }];
      swapAnim = null;
      beginClear(runs);
    } else {
      // no match: animate the swap back and revert
      const tmp = grid[a.r][a.c];
      grid[a.r][a.c] = grid[b.r][b.c];
      grid[b.r][b.c] = tmp;
      swapAnim = { a, b, tm: 0, kind: 'revert' };
      Sound.deny();
    }
  } else {
    swapAnim = null;
    phase = 'awaiting';
    idleT = 0;
  }
}

// ---------------------------------------------------------------- particles

function spawnParticles(x, y, color) {
  for (let i = 0; i < 6; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 1.5 + Math.random() * 3.5;
    particles.push({
      x, y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - 1.5,
      life: 0, max: 0.45 + Math.random() * 0.3,
      size: 2 + Math.random() * 3,
      color,
    });
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += dt;
    if (p.life >= p.max) { particles.splice(i, 1); continue; }
    p.vy += 7 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}

// ---------------------------------------------------------------- update

function savePrev() {
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const cl = grid[r][c];
      if (!cl) continue;
      cl.pox = cl.ox; cl.poy = cl.oy; cl.pscale = cl.scale;
    }
}

function update(dt) {
  animTime += dt;
  if (mode !== 'play' || paused) return;

  updateParticles(dt);
  if (comboFlash && (comboFlash.t += dt) > 1.1) comboFlash = null;
  landSoundCd = Math.max(0, landSoundCd - dt);

  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const cl = grid[r][c];
      if (!cl) continue;
      if (cl.scale > 1) cl.scale = Math.max(1, cl.scale - 2.6 * dt);
      if (cl.spawnGlow > 0) cl.spawnGlow = Math.max(0, cl.spawnGlow - 1.1 * dt);
    }

  switch (phase) {
    case 'awaiting': {
      idleT += dt;
      if (idleT >= HINT_DELAY && !hintMove && validMoves.length) {
        hintMove = validMoves[(Math.random() * validMoves.length) | 0];
      }
      break;
    }
    case 'swapping':
      tickSwap(dt);
      break;
    case 'clearing': {
      clearT += dt;
      const p = Math.min(1, clearT / CLEAR_T);
      for (const k of pendingClear.clearSet) {
        const cl = grid[kr(k)][kc(k)];
        if (cl) cl.scale = 1 - p;
      }
      if (p >= 1) applyClear();
      break;
    }
    case 'falling': {
      let anyFalling = false, landed = false;
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          const cl = grid[r][c];
          if (!cl || cl.oy >= 0) continue;
          cl.vy = Math.min(MAXV, cl.vy + GRAV * dt);
          cl.oy += cl.vy * dt;
          if (cl.oy >= 0) { cl.oy = 0; cl.vy = 0; landed = true; }
          else anyFalling = true;
        }
      if (landed && landSoundCd <= 0) { Sound.drop(); landSoundCd = 0.06; }
      if (!anyFalling) postResolve();
      break;
    }
    case 'shuffling': {
      shuffleT += dt;
      const p = Math.min(1, shuffleT / SHUFFLE_T);
      const s = shuffleStage === 0 ? 1 - p : p;
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) grid[r][c].scale = Math.max(0.02, s);
      if (p >= 1) {
        if (shuffleStage === 0) {
          applyShuffle();
          shuffleStage = 1;
          shuffleT = 0;
        } else {
          for (let r = 0; r < ROWS; r++)
            for (let c = 0; c < COLS; c++) grid[r][c].scale = 1;
          validMoves = computeValidMoves();
          phase = 'awaiting';
          idleT = 0;
        }
      }
      break;
    }
  }
}

// ---------------------------------------------------------------- render

function roundRect(x, y, w, h, rad) {
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function gemPath(shape, cx, cy, rr) {
  ctx.beginPath();
  switch (shape) {
    case 'diamond':
      ctx.moveTo(cx, cy - rr);
      ctx.lineTo(cx + rr * 0.82, cy);
      ctx.lineTo(cx, cy + rr);
      ctx.lineTo(cx - rr * 0.82, cy);
      break;
    case 'hex':
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 3;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      break;
    case 'triangle':
      ctx.moveTo(cx, cy - rr);
      ctx.lineTo(cx + rr * 0.95, cy + rr * 0.72);
      ctx.lineTo(cx - rr * 0.95, cy + rr * 0.72);
      break;
    case 'circle':
      ctx.arc(cx, cy, rr * 0.92, 0, Math.PI * 2);
      break;
    case 'square': {
      const s = rr * 0.82;
      ctx.moveTo(cx - s + 4, cy - s);
      ctx.arcTo(cx + s, cy - s, cx + s, cy + s, 5);
      ctx.arcTo(cx + s, cy + s, cx - s, cy + s, 5);
      ctx.arcTo(cx - s, cy + s, cx - s, cy - s, 5);
      ctx.arcTo(cx - s, cy - s, cx + s, cy - s, 5);
      break;
    }
    case 'star':
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 === 0 ? rr : rr * 0.46;
        const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      break;
  }
  ctx.closePath();
}

function drawGem(cx, cy, type, special, scale, glow) {
  if (scale <= 0.02) return;
  const g = GEMS[type];
  const rr = CELL * 0.36 * scale;

  if (special || glow > 0) {
    ctx.save();
    const pulse = special ? 0.55 + 0.35 * Math.sin(animTime * 5) : 0;
    ctx.shadowColor = special === 'burst' ? '#ffffff' : g.color;
    ctx.shadowBlur = 10 + 10 * Math.max(pulse, glow);
  }

  const grad = ctx.createRadialGradient(
    cx - rr * 0.35, cy - rr * 0.4, rr * 0.1,
    cx, cy, rr * 1.25);
  grad.addColorStop(0, g.hi);
  grad.addColorStop(0.45, g.color);
  grad.addColorStop(1, g.dark);
  gemPath(g.shape, cx, cy, rr);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.stroke();

  if (special || glow > 0) ctx.restore();

  // shine dot
  ctx.beginPath();
  ctx.arc(cx - rr * 0.3, cy - rr * 0.35, rr * 0.14, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fill();

  if (special === 'cross') {
    // row+column clearer: a bright four-point spark
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 2.2;
    const a = rr * 0.62;
    ctx.beginPath();
    ctx.moveTo(cx - a, cy); ctx.lineTo(cx + a, cy);
    ctx.moveTo(cx, cy - a); ctx.lineTo(cx, cy + a);
    ctx.stroke();
    ctx.restore();
  } else if (special === 'burst') {
    // 3x3 burster: radiant white core with a ring
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, rr * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, rr * 0.55, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  }
}

const lerp = (a, b, t) => a + (b - a) * t;

function render(alpha) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, SIZE, SIZE);

  // checkered ground
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#12161f' : '#0f1218';
      ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
    }

  // selection highlight
  if (sel) {
    ctx.save();
    roundRect(sel.c * CELL + 2, sel.r * CELL + 2, CELL - 4, CELL - 4, 8);
    ctx.fillStyle = 'rgba(180,140,255,0.14)';
    ctx.fill();
    ctx.strokeStyle = '#b48cff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  // idle hint: pulse one valid move
  if (hintMove && phase === 'awaiting') {
    const a = 0.35 + 0.3 * Math.sin(animTime * 6);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,215,110,' + a.toFixed(3) + ')';
    ctx.lineWidth = 2.5;
    for (const p of [hintMove.a, hintMove.b]) {
      roundRect(p.c * CELL + 3, p.r * CELL + 3, CELL - 6, CELL - 6, 8);
      ctx.stroke();
    }
    ctx.restore();
  }

  // gems (interpolated)
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const cl = grid[r][c];
      if (!cl) continue;
      const ox = lerp(cl.pox, cl.ox, alpha);
      const oy = lerp(cl.poy, cl.oy, alpha);
      const sc = lerp(cl.pscale, cl.scale, alpha);
      drawGem((c + ox + 0.5) * CELL, (r + oy + 0.5) * CELL,
        cl.t, cl.s, sc, cl.spawnGlow);
    }

  // particles
  for (const p of particles) {
    const a = 1 - p.life / p.max;
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x * CELL - p.size / 2, p.y * CELL - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  // cascade chain flash
  if (comboFlash) {
    const a = comboFlash.t < 0.2 ? comboFlash.t / 0.2
      : Math.max(0, 1 - (comboFlash.t - 0.5) / 0.6);
    ctx.save();
    ctx.globalAlpha = Math.min(1, a);
    ctx.font = 'bold 34px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd76e';
    ctx.shadowColor = '#ffd76e';
    ctx.shadowBlur = 18;
    ctx.fillText(comboFlash.text, SIZE / 2, SIZE / 2 - comboFlash.t * 24);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- hud / ui

function updateHUD() {
  el.level.textContent = level;
  el.moves.textContent = moves;
  el.score.textContent = score;
  el.best.textContent = best;
  const got = score - levelStartScore;
  const pct = target > 0 ? Math.min(100, (got / target) * 100) : 0;
  el.goalFill.style.width = pct + '%';
  el.goalFill.classList.toggle('met', got >= target && target > 0);
  el.goalText.textContent = got + ' / ' + target;
}

function showOverlay(title, sub, detail) {
  el.oTitle.textContent = title;
  el.oSub.textContent = sub || '';
  el.oDetail.textContent = detail || '';
  el.overlay.classList.add('show');
}
function hideOverlay() { el.overlay.classList.remove('show'); }

function showToast(text, dur) {
  el.toast.textContent = text;
  el.toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), dur || 2000);
}

// ---------------------------------------------------------------- flow

function startLevel(n) {
  level = n;
  score = levelStartScore;
  target = levelTarget(n);
  moves = levelMoves(n);
  targetToastShown = false;
  chain = 0;
  sel = null; drag = null; swapAnim = null; pendingClear = null;
  hintMove = null; idleT = 0;
  particles = []; comboFlash = null;
  buildBoard();
  mode = 'play';
  paused = false;
  phase = 'falling';
  hideOverlay();
  updateHUD();
}

function retryLevel() {
  score = levelStartScore;
  startLevel(level);
}

function nextLevel() {
  levelStartScore = score;
  lsSet('score', levelStartScore);
  startLevel(level + 1);
}

function resumeGame() {
  paused = false;
  hideOverlay();
}

function pauseGame() {
  if (mode !== 'play' || paused) return;
  paused = true;
  showOverlay('PAUSED', 'click or press P to resume');
}

// what a click / keypress on an overlay means right now
function overlayAction() {
  Sound.init();
  if (mode === 'start') startLevel(level);
  else if (mode === 'levelend') nextLevel();
  else if (mode === 'gameover') retryLevel();
  else if (paused) resumeGame();
}

// ---------------------------------------------------------------- input

function cellFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  const c = Math.floor(((e.clientX - rect.left) / rect.width) * COLS);
  const r = Math.floor(((e.clientY - rect.top) / rect.height) * ROWS);
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
  return { r, c };
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  Sound.init();
  idleT = 0;
  hintMove = null;
  if (mode !== 'play' || paused || phase !== 'awaiting') return;
  const pos = cellFromEvent(e);
  if (!pos) return;
  if (sel && sel.r === pos.r && sel.c === pos.c) { sel = null; return; }
  if (sel && isAdjacent(sel, pos)) { doSwap(sel, pos); drag = null; return; }
  sel = pos;
  drag = { r: pos.r, c: pos.c, x: e.clientX, y: e.clientY };
  Sound.select();
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag || mode !== 'play' || paused || phase !== 'awaiting') return;
  const rect = canvas.getBoundingClientRect();
  const cellPx = rect.width / COLS;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < cellPx * 0.4) return;
  const horiz = Math.abs(dx) >= Math.abs(dy);
  const nr = drag.r + (horiz ? 0 : (dy > 0 ? 1 : -1));
  const nc = drag.c + (horiz ? (dx > 0 ? 1 : -1) : 0);
  const from = { r: drag.r, c: drag.c };
  drag = null;
  if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) doSwap(from, { r: nr, c: nc });
});

window.addEventListener('pointerup', () => { drag = null; });

el.overlay.addEventListener('click', overlayAction);
el.audio.addEventListener('click', (e) => { e.stopPropagation(); Sound.init(); toggleAudio(); });

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  Sound.init();
  const k = e.key.toLowerCase();
  if (k === 'm') { toggleAudio(); return; }
  if (mode === 'start' || mode === 'levelend') { overlayAction(); return; }
  if (mode === 'gameover') { if (k === 'r' || k === ' ' || k === 'enter') retryLevel(); return; }
  if (k === 'p') { paused ? resumeGame() : pauseGame(); return; }
  if (paused) { resumeGame(); return; }
  if (k === 'r') retryLevel();
  idleT = 0;
});

// pause when the tab loses focus (real-time animations halt)
window.addEventListener('blur', () => pauseGame());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseGame();
});

// ---------------------------------------------------------------- main loop

let last = performance.now();
let acc = 0;

function frame(now) {
  acc += Math.min((now - last) / 1000, 0.25);
  last = now;
  while (acc >= DT) {
    savePrev();
    update(DT);
    acc -= DT;
  }
  render(acc / DT);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- test hook

// headless-test access; inert unless a harness sets the flag before load
if (window.__GEMGROVE_TEST__) {
  window.__gemgrove = {
    get grid() { return grid; },
    get phase() { return phase; },
    get mode() { return mode; },
    get score() { return score; },
    get moves() { return moves; },
    get chain() { return chain; },
    get level() { return level; },
    get validMoves() { return validMoves; },
    get hintMove() { return hintMove; },
    findRuns, computeValidMoves, buildBoard, applyShuffle,
    doSwap, overlayAction, startLevel,
  };
}

// ---------------------------------------------------------------- boot

buildBoard();               // something pretty behind the start overlay
for (let r = 0; r < ROWS; r++)   // no deal-in before play: pin it in place
  for (let c = 0; c < COLS; c++) {
    grid[r][c].oy = 0; grid[r][c].poy = 0;
  }
updateHUD();
target = levelTarget(level);
el.goalText.textContent = '0 / ' + target;
showOverlay('GEMGROVE',
  level > 1 ? 'resume at level ' + level : 'match 3+ gems before the moves run out',
  'level ' + level + ' — target ' + levelTarget(level) + ' in ' + levelMoves(level) + ' moves — click to play');
requestAnimationFrame(frame);

})();

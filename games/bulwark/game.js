'use strict';
/*
 * BULWARK — a from-scratch fixed shooter against descending ranks.
 *
 * Faithful mechanics notes:
 *  - The fleet is emulated the way the 1978 hardware did it: exactly ONE
 *    invader is advanced per 60 Hz logic tick. A full "pass" over the alive
 *    invaders equals one discrete fleet step, so the step interval is
 *    directly proportional to the alive count — the last few sprint — and
 *    the march ripples visibly through the ranks as each creature toggles
 *    its animation frame the moment it moves.
 *  - Edge check happens at the start of a pass: if the fleet would cross a
 *    margin, that whole pass becomes a drop (one row down) and the
 *    direction reverses.
 *  - Shields erode per-pixel via bitmasks mirrored onto offscreen canvases.
 *  - Player is limited to one bullet on screen. Invader bombs (max 3) fire
 *    from the bottom-most invader of a random occupied column.
 */
(() => {

// ---------------------------------------------------------------- constants

const W = 448, H = 512;
const TICK = 1 / 60;

const COLS = 11, ROWS = 5, TOTAL = COLS * ROWS;
const CELL_W = 32, CELL_H = 32;
const STEP_X = 8;          // horizontal fleet step (px per pass)
const DROP_Y = 16;         // one row of descent
const MARGIN_L = 8, MARGIN_R = W - 8;

const PLAYER_Y = 456;      // top of the cannon
const PLAYER_W = 26, PLAYER_H = 16;
const PLAYER_SPEED = 2.6;  // px per tick
const BULLET_SPEED = 8;    // px per tick, upward
const BULLET_TOP = 26;

const SHIELD_W = 44, SHIELD_H = 32, SHIELD_Y = 400;
const SHIELD_XS = [34, 146, 258, 370];

const SAUCER_Y = 34, SAUCER_W = 32, SAUCER_H = 14;
const SAUCER_SCORES = [50, 100, 150, 300];

const MAX_BOMBS = 3;
const EXTRA_LIFE_AT = 1500;

const KEY_HI = 'arcade.bulwark.hiscore';
const KEY_AUDIO = 'arcade.bulwark.audio';

// ------------------------------------------------------------------ helpers

const rnd = (a, b) => a + Math.random() * (b - a);
const irnd = (a, b) => Math.floor(rnd(a, b + 1));

// --------------------------------------------------------------------- DOM

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const elScore = document.getElementById('score');
const elBest = document.getElementById('best');
const elWave = document.getElementById('wave');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const overlayScore = document.getElementById('overlay-score');
const audioBtn = document.getElementById('audio-toggle');

// -------------------------------------------------------------------- audio

let audioOn = localStorage.getItem(KEY_AUDIO) !== 'off';
let actx = null;
let master = null;

function ensureAudio() {
  if (actx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  actx = new AC();
  master = actx.createGain();
  master.gain.value = 0.32;
  master.connect(actx.destination);
}

function audioReady() {
  return audioOn && actx && actx.state === 'running';
}

function setAudio(on) {
  audioOn = on;
  localStorage.setItem(KEY_AUDIO, on ? 'on' : 'off');
  audioBtn.textContent = 'sound: ' + (on ? 'on' : 'off');
  if (!on) stopSaucerHum();
}
setAudio(audioOn);

function blip(freq, dur, type, vol, slide) {
  if (!audioReady()) return;
  const t = actx.currentTime;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = type || 'square';
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
  g.gain.setValueAtTime(vol || 0.2, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

function noiseBurst(dur, vol, fromHz, toHz) {
  if (!audioReady()) return;
  const t = actx.currentTime;
  const n = Math.floor(actx.sampleRate * dur);
  const buf = actx.createBuffer(1, n, actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = actx.createBufferSource();
  src.buffer = buf;
  const f = actx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(fromHz, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(40, toHz), t + dur);
  const g = actx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur + 0.02);
}

const sfx = {
  fire: () => blip(760, 0.09, 'square', 0.13, 180),
  invaderDie: () => { noiseBurst(0.09, 0.3, 2400, 300); blip(210, 0.06, 'square', 0.1, 90); },
  playerDie: () => { noiseBurst(0.55, 0.4, 1400, 80); blip(140, 0.5, 'sawtooth', 0.12, 30); },
  saucerDie: () => { blip(880, 0.1, 'square', 0.14, 440); blip(1320, 0.16, 'square', 0.1, 660); },
  topPop: () => noiseBurst(0.05, 0.12, 3000, 800),
  shieldChip: () => noiseBurst(0.04, 0.1, 1200, 400),
  extraLife: () => { blip(660, 0.1, 'square', 0.12); blip(990, 0.14, 'square', 0.12); },
};

// the 4-note descending bass loop, one note per fleet pass
const BASS_NOTES = [110, 104, 98, 92];
let bassIdx = 0;
let lastBassAt = 0;
function bassThump() {
  if (!audioReady()) return;
  const now = actx.currentTime;
  if (now - lastBassAt < 0.085) return; // don't machine-gun at 1 invader
  lastBassAt = now;
  const t = now;
  const o = actx.createOscillator();
  const g = actx.createGain();
  const f = actx.createBiquadFilter();
  o.type = 'triangle';
  o.frequency.setValueAtTime(BASS_NOTES[bassIdx], t);
  f.type = 'lowpass';
  f.frequency.value = 320;
  g.gain.setValueAtTime(0.5, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
  o.connect(f); f.connect(g); g.connect(master);
  o.start(t); o.stop(t + 0.13);
  bassIdx = (bassIdx + 1) % BASS_NOTES.length;
}

// continuous saucer warble
let saucerOsc = null, saucerLfo = null, saucerGain = null;
function startSaucerHum() {
  if (!audioReady() || saucerOsc) return;
  saucerOsc = actx.createOscillator();
  saucerLfo = actx.createOscillator();
  const lfoGain = actx.createGain();
  saucerGain = actx.createGain();
  saucerOsc.type = 'square';
  saucerOsc.frequency.value = 340;
  saucerLfo.type = 'sine';
  saucerLfo.frequency.value = 9;
  lfoGain.gain.value = 90;
  saucerLfo.connect(lfoGain); lfoGain.connect(saucerOsc.frequency);
  saucerGain.gain.value = 0.05;
  saucerOsc.connect(saucerGain); saucerGain.connect(master);
  saucerOsc.start(); saucerLfo.start();
}
function stopSaucerHum() {
  if (!saucerOsc) return;
  try { saucerOsc.stop(); saucerLfo.stop(); } catch (e) { /* already stopped */ }
  saucerOsc = saucerLfo = saucerGain = null;
}

// ------------------------------------------------------------------ sprites

// Original procedural pixel-creatures, 2 march frames each.
// '#' = lit pixel. Drawn at 2x, so a 12-wide map is a 24px sprite.

const SPRITES = {
  // "spry" — small darting thing with feelers (top rank, 30 pts)
  spry: [[
    '#......#',
    '.#....#.',
    '..####..',
    '.##..##.',
    '########',
    '#.####.#',
    '#......#',
    '.#....#.',
  ], [
    '#......#',
    '.#....#.',
    '..####..',
    '.##..##.',
    '########',
    '.##..##.',
    '..#..#..',
    '.#....#.',
  ]],
  // "drifter" — a dome rider trailing stingers (middle ranks, 20 pts)
  drifter: [[
    '...#####...',
    '..#######..',
    '.##.###.##.',
    '###########',
    '.#########.',
    '..#.#.#.#..',
    '.#.#...#.#.',
    '#.........#',
  ], [
    '...#####...',
    '..#######..',
    '.##.###.##.',
    '###########',
    '.#########.',
    '..#.#.#.#..',
    '...#.#.#...',
    '..#..#..#..',
  ]],
  // "burrower" — wide armored crawler with mandibles (bottom ranks, 10 pts)
  burrower: [[
    '....####....',
    '.##########.',
    '##..####..##',
    '############',
    '##.######.##',
    '.#.##..##.#.',
    '.##......##.',
    '#..#....#..#',
  ], [
    '....####....',
    '.##########.',
    '##..####..##',
    '############',
    '##.######.##',
    '.#.##..##.#.',
    '..##....##..',
    '.#..#..#..#.',
  ]],
  saucer: [[
    '.....######.....',
    '...##########...',
    '..############..',
    '.##.##.##.##.##.',
    '################',
    '...###....###...',
    '....#......#....',
  ]],
  cannon: [[
    '......#......',
    '.....###.....',
    '.....###.....',
    '#############',
    '#############',
    '#############',
    '#############',
    '#############',
  ]],
};

const PX = 2; // sprite pixel scale

function bakeSprite(map, color) {
  const w = map[0].length, h = map.length;
  const c = document.createElement('canvas');
  c.width = w * PX; c.height = h * PX;
  const g = c.getContext('2d');
  g.fillStyle = color;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (map[y][x] === '#') g.fillRect(x * PX, y * PX, PX, PX);
  return c;
}

// rank types by row: 0 = top
const RANK_TYPES = ['spry', 'drifter', 'drifter', 'burrower', 'burrower'];
const RANK_COLORS = { spry: '#ff6bd6', drifter: '#6ee7ff', burrower: '#a8ff6b' };
const RANK_POINTS = { spry: 30, drifter: 20, burrower: 10 };

const baked = {};
for (const name of ['spry', 'drifter', 'burrower']) {
  baked[name] = SPRITES[name].map(m => bakeSprite(m, RANK_COLORS[name]));
}
const saucerSprite = bakeSprite(SPRITES.saucer[0], '#ff6b6b');
const cannonSprite = bakeSprite(SPRITES.cannon[0], '#6ee7ff');
const cannonDim = bakeSprite(SPRITES.cannon[0], '#2f8ba3');

function spriteSize(name) {
  const m = SPRITES[name][0];
  return { w: m[0].length * PX, h: m.length * PX };
}

// ------------------------------------------------------------------ shields

// Each shield: an alpha bitmask (for per-pixel collision) mirrored onto an
// offscreen canvas (for rendering). Erosion updates both.

function makeShield(x) {
  const mask = new Uint8Array(SHIELD_W * SHIELD_H);
  mask.fill(1);
  // sloped top corners
  for (let y = 0; y < 8; y++) {
    for (let px = 0; px < 8 - y; px++) {
      mask[y * SHIELD_W + px] = 0;
      mask[y * SHIELD_W + (SHIELD_W - 1 - px)] = 0;
    }
  }
  // bottom arch notch
  for (let y = 22; y < SHIELD_H; y++) {
    const half = 4 + Math.min(y - 22, 3);
    for (let px = 22 - half; px < 22 + half; px++)
      mask[y * SHIELD_W + px] = 0;
  }
  const c = document.createElement('canvas');
  c.width = SHIELD_W; c.height = SHIELD_H;
  const shield = { x, y: SHIELD_Y, mask, canvas: c };
  repaintShield(shield);
  return shield;
}

function repaintShield(s) {
  const g = s.canvas.getContext('2d');
  g.clearRect(0, 0, SHIELD_W, SHIELD_H);
  g.fillStyle = '#5ad45a';
  for (let y = 0; y < SHIELD_H; y++)
    for (let x = 0; x < SHIELD_W; x++)
      if (s.mask[y * SHIELD_W + x]) g.fillRect(x, y, 1, 1);
}

// blast a rough circle (with speckled fringe) out of a shield, local coords
function erodeCircle(s, cx, cy, r) {
  const g = s.canvas.getContext('2d');
  g.save();
  g.globalCompositeOperation = 'destination-out';
  for (let y = Math.floor(cy - r - 2); y <= cy + r + 2; y++) {
    if (y < 0 || y >= SHIELD_H) continue;
    for (let x = Math.floor(cx - r - 2); x <= cx + r + 2; x++) {
      if (x < 0 || x >= SHIELD_W) continue;
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      let kill = d2 <= r * r;
      if (!kill && d2 <= (r + 2) * (r + 2)) kill = Math.random() < 0.4; // fringe
      if (kill && s.mask[y * SHIELD_W + x]) {
        s.mask[y * SHIELD_W + x] = 0;
        g.fillRect(x, y, 1, 1);
      }
    }
  }
  g.restore();
}

// clear a rect (invader contact chewing through), local coords
function erodeRect(s, x0, y0, w, h) {
  const g = s.canvas.getContext('2d');
  g.save();
  g.globalCompositeOperation = 'destination-out';
  let any = false;
  for (let y = Math.max(0, y0); y < Math.min(SHIELD_H, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(SHIELD_W, x0 + w); x++) {
      if (s.mask[y * SHIELD_W + x]) {
        s.mask[y * SHIELD_W + x] = 0;
        g.fillRect(x, y, 1, 1);
        any = true;
      }
    }
  }
  g.restore();
  return any;
}

// per-pixel test of a world point against every shield
function shieldPixelAt(wx, wy) {
  for (const s of shields) {
    const lx = Math.floor(wx - s.x), ly = Math.floor(wy - s.y);
    if (lx >= 0 && lx < SHIELD_W && ly >= 0 && ly < SHIELD_H && s.mask[ly * SHIELD_W + lx])
      return { s, lx, ly };
  }
  return null;
}

// -------------------------------------------------------------------- state

let state = 'attract'; // attract | playing | playerdown | wavepause | over
let paused = false;

let score = 0;
let hiscore = parseInt(localStorage.getItem(KEY_HI) || '0', 10) || 0;
let wave = 1;
let lives = 3;
let extraLifeGiven = false;

let invaders = [];      // row-major, row 0 = top; cursor order = bottom-up
let cursorOrder = [];   // indices, bottom row first (march ripples upward)
let cursor = 0;
let fleetDir = 1;
let dropPass = false;
let invaded = false;

let playerX = 40;
let bullet = null;      // {x, y}
let bombs = [];         // {x, y, type, phase, speed}
let bombTimer = 60;

let saucer = null;      // {x, dir}
let saucerTimer = 0;
let saucerDir = 1;

let shields = [];
let particles = [];     // {x, y, vx, vy, life, color}
let popups = [];        // {x, y, text, life, color}
let stateTimer = 0;
let restartGuard = 0;

function invRect(inv) {
  const { w, h } = spriteSize(inv.type);
  return { x: inv.x + (CELL_W - w) / 2, y: inv.y, w, h };
}

function buildFleet() {
  invaders = [];
  const startX = 48;
  const startY = Math.min(96 + (wave - 1) * DROP_Y, 208);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      invaders.push({
        col: c, row: r,
        type: RANK_TYPES[r],
        x: startX + c * CELL_W,
        y: startY + r * CELL_H,
        alive: true,
        frame: (r + c) & 1, // staggered start frames: visible ripple texture
      });
    }
  }
  cursorOrder = [];
  for (let r = ROWS - 1; r >= 0; r--)
    for (let c = 0; c < COLS; c++)
      cursorOrder.push(r * COLS + c);
  cursor = 0;
  fleetDir = 1;
  dropPass = false;
}

function startWave() {
  buildFleet();
  shields = SHIELD_XS.map(makeShield);
  bombs = [];
  bullet = null;
  saucer = null;
  stopSaucerHum();
  saucerTimer = irnd(900, 1500);
  bombTimer = 90;
  bassIdx = 0;
}

function startGame() {
  score = 0;
  wave = 1;
  lives = 3;
  extraLifeGiven = false;
  invaded = false;
  playerX = 40;
  particles = [];
  popups = [];
  startWave();
  state = 'playing';
  paused = false;
  hideOverlay();
  syncHud();
}

function aliveCount() {
  let n = 0;
  for (const inv of invaders) if (inv.alive) n++;
  return n;
}

function syncHud() {
  elScore.textContent = score;
  elBest.textContent = hiscore;
  elWave.textContent = wave;
}

function addScore(n) {
  score += n;
  if (!extraLifeGiven && score >= EXTRA_LIFE_AT) {
    extraLifeGiven = true;
    lives++;
    sfx.extraLife();
    popups.push({ x: W / 2, y: PLAYER_Y - 20, text: 'EXTRA CANNON', life: 90, color: '#6ee7ff' });
  }
  if (score > hiscore) {
    hiscore = score;
    localStorage.setItem(KEY_HI, String(hiscore));
  }
  syncHud();
}

// ------------------------------------------------------------------ overlay

function showOverlay(title, sub, scoreText, dead) {
  overlayTitle.textContent = title;
  overlaySub.textContent = sub;
  overlayScore.textContent = scoreText || '';
  overlay.classList.add('show');
  overlay.classList.toggle('dead', !!dead);
}
function hideOverlay() {
  overlay.classList.remove('show', 'dead');
}

// -------------------------------------------------------------------- input

const keys = {};

addEventListener('keydown', (e) => {
  if (['ArrowLeft', 'ArrowRight', ' ', 'ArrowUp', 'ArrowDown'].includes(e.key)) e.preventDefault();
  ensureAudio();
  if (actx && actx.state === 'suspended') actx.resume();
  keys[e.key.toLowerCase()] = true;

  if (e.key.toLowerCase() === 'm') { setAudio(!audioOn); return; }

  if (state === 'attract') {
    if (e.key === ' ' || e.key === 'Enter') startGame();
    return;
  }
  if (state === 'over') {
    if (restartGuard <= 0) startGame();
    return;
  }
  if (e.key.toLowerCase() === 'p') {
    paused = !paused;
    if (paused) showOverlay('PAUSED', 'press P to resume', '', false);
    else hideOverlay();
    return;
  }
  if (paused) return;
  if ((e.key === ' ' || e.key === 'ArrowUp') && state === 'playing' && !bullet) {
    bullet = { x: playerX + PLAYER_W / 2 - 1, y: PLAYER_Y - 8 };
    sfx.fire();
  }
});

addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

addEventListener('blur', () => {
  if ((state === 'playing' || state === 'playerdown' || state === 'wavepause') && !paused) {
    paused = true;
    showOverlay('PAUSED', 'press P to resume', '', false);
  }
});

audioBtn.addEventListener('click', () => { ensureAudio(); if (actx && actx.state === 'suspended') actx.resume(); setAudio(!audioOn); });

// ------------------------------------------------------------------- update

function spawnExplosion(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const a = rnd(0, Math.PI * 2), sp = rnd(0.4, 2.4);
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.4, life: irnd(14, 32), color });
  }
}

function fleetTick() {
  // advance exactly one alive invader per 60 Hz tick (the original's trick):
  // pass duration = alive count, so a thinning fleet accelerates on its own.
  while (cursor < cursorOrder.length) {
    const inv = invaders[cursorOrder[cursor++]];
    if (!inv.alive) continue;
    if (dropPass) inv.y += DROP_Y;
    else inv.x += fleetDir * STEP_X;
    inv.frame ^= 1; // per-invader frame flip as it moves -> ripple march

    // chew through any shield the creature overlaps
    const r = invRect(inv);
    for (const s of shields) {
      if (r.x < s.x + SHIELD_W && r.x + r.w > s.x && r.y < s.y + SHIELD_H && r.y + r.h > s.y) {
        erodeRect(s, Math.floor(r.x - s.x), Math.floor(r.y - s.y), r.w, r.h + 4);
      }
    }
    if (r.y + r.h >= PLAYER_Y) invaded = true;
    break;
  }

  // if no alive invader remains ahead of the cursor, the pass is complete —
  // finish it on this same tick so a pass costs exactly `alive` ticks
  let more = false;
  for (let i = cursor; i < cursorOrder.length; i++) {
    if (invaders[cursorOrder[i]].alive) { more = true; break; }
  }
  if (more) return;

  // pass complete: one full fleet step has happened
  bassThump();
  cursor = 0;

  // decide what the next pass does
  if (dropPass) {
    dropPass = false; // direction already reversed when the drop was queued
  } else {
    let minX = Infinity, maxX = -Infinity;
    for (const inv of invaders) {
      if (!inv.alive) continue;
      const r = invRect(inv);
      if (r.x < minX) minX = r.x;
      if (r.x + r.w > maxX) maxX = r.x + r.w;
    }
    if ((fleetDir > 0 && maxX + STEP_X > MARGIN_R) ||
        (fleetDir < 0 && minX - STEP_X < MARGIN_L)) {
      dropPass = true;
      fleetDir = -fleetDir;
    }
  }
}

function pickBomberColumn() {
  const cols = [];
  for (let c = 0; c < COLS; c++) {
    for (let r = ROWS - 1; r >= 0; r--) {
      if (invaders[r * COLS + c].alive) { cols.push(c); break; }
    }
  }
  if (!cols.length) return null;
  const c = cols[irnd(0, cols.length - 1)];
  for (let r = ROWS - 1; r >= 0; r--) {
    const inv = invaders[r * COLS + c];
    if (inv.alive) return inv;
  }
  return null;
}

function updateBombs() {
  bombTimer--;
  if (bombTimer <= 0 && bombs.length < MAX_BOMBS) {
    const inv = pickBomberColumn();
    if (inv) {
      const r = invRect(inv);
      bombs.push({
        x: r.x + r.w / 2,
        y: r.y + r.h,
        type: Math.random() < 0.5 ? 0 : 1, // 0 = straight bolt, 1 = wiggler
        phase: 0,
        speed: Math.min(2.0 + wave * 0.25, 3.6),
      });
    }
    bombTimer = Math.max(24, irnd(40, 96) - wave * 4);
  }

  for (let i = bombs.length - 1; i >= 0; i--) {
    const b = bombs[i];
    b.phase++;
    b.y += b.type === 1 ? b.speed * 0.8 : b.speed;
    if (b.type === 1 && b.phase % 8 === 0) b.x += (Math.floor(b.phase / 8) & 1) ? 4 : -4;

    // shields (per-pixel at the tip)
    const hit = shieldPixelAt(b.x, b.y + 6) || shieldPixelAt(b.x + 1, b.y + 6);
    if (hit) {
      erodeCircle(hit.s, hit.lx, hit.ly + 2, 4);
      sfx.shieldChip();
      spawnExplosion(b.x, b.y + 4, '#5ad45a', 4);
      bombs.splice(i, 1);
      continue;
    }
    // player
    if (state === 'playing' &&
        b.x >= playerX && b.x <= playerX + PLAYER_W &&
        b.y + 8 >= PLAYER_Y && b.y <= PLAYER_Y + PLAYER_H) {
      bombs.splice(i, 1);
      killPlayer();
      continue;
    }
    // ground
    if (b.y > 474) {
      spawnExplosion(b.x, 474, '#c9d1d9', 5);
      bombs.splice(i, 1);
    }
  }
}

function updateBullet() {
  if (!bullet) return;
  // sub-step so a fast bullet can't tunnel through a 1px shield sliver
  for (let s = 0; s < BULLET_SPEED; s += 2) {
    bullet.y -= 2;

    const hit = shieldPixelAt(bullet.x + 1, bullet.y) || shieldPixelAt(bullet.x, bullet.y);
    if (hit) {
      erodeCircle(hit.s, hit.lx, hit.ly - 1, 4);
      sfx.shieldChip();
      spawnExplosion(bullet.x, bullet.y, '#5ad45a', 4);
      bullet = null;
      return;
    }

    for (const inv of invaders) {
      if (!inv.alive) continue;
      const r = invRect(inv);
      if (bullet.x + 2 > r.x && bullet.x < r.x + r.w && bullet.y < r.y + r.h && bullet.y + 8 > r.y) {
        inv.alive = false;
        addScore(RANK_POINTS[inv.type]);
        sfx.invaderDie();
        spawnExplosion(r.x + r.w / 2, r.y + r.h / 2, RANK_COLORS[inv.type], 14);
        bullet = null;
        if (aliveCount() === 0) {
          state = 'wavepause';
          stateTimer = 100;
          stopSaucerHum();
        }
        return;
      }
    }

    if (saucer &&
        bullet.x + 2 > saucer.x && bullet.x < saucer.x + SAUCER_W &&
        bullet.y < SAUCER_Y + SAUCER_H && bullet.y + 8 > SAUCER_Y) {
      const bonus = SAUCER_SCORES[irnd(0, SAUCER_SCORES.length - 1)];
      addScore(bonus);
      popups.push({ x: saucer.x + SAUCER_W / 2, y: SAUCER_Y + 4, text: String(bonus), life: 70, color: '#ff6b6b' });
      spawnExplosion(saucer.x + SAUCER_W / 2, SAUCER_Y + SAUCER_H / 2, '#ff6b6b', 18);
      saucer = null;
      stopSaucerHum();
      sfx.saucerDie();
      bullet = null;
      return;
    }

    if (bullet.y <= BULLET_TOP) {
      spawnExplosion(bullet.x + 1, BULLET_TOP, '#ff6b6b', 6);
      sfx.topPop();
      bullet = null;
      return;
    }
  }
}

function updateSaucer() {
  if (saucer) {
    saucer.x += saucer.dir * 1.4;
    if (saucer.x < -SAUCER_W - 4 || saucer.x > W + 4) {
      saucer = null;
      stopSaucerHum();
    }
    return;
  }
  saucerTimer--;
  if (saucerTimer <= 0) {
    if (aliveCount() >= 8) {
      saucerDir = -saucerDir;
      saucer = { x: saucerDir > 0 ? -SAUCER_W : W, dir: saucerDir };
      startSaucerHum();
    }
    saucerTimer = irnd(1100, 1700);
  }
}

function killPlayer() {
  lives--;
  sfx.playerDie();
  spawnExplosion(playerX + PLAYER_W / 2, PLAYER_Y + PLAYER_H / 2, '#6ee7ff', 26);
  state = 'playerdown';
  stateTimer = 80;
  bullet = null;
}

function gameOver(reason) {
  state = 'over';
  restartGuard = 30;
  stopSaucerHum();
  showOverlay('GAME OVER', 'press any key to fight again',
    reason + '\nscore ' + score + '   best ' + hiscore, true);
}

function updateEffects() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy; p.vy += 0.06;
    if (--p.life <= 0) particles.splice(i, 1);
  }
  for (let i = popups.length - 1; i >= 0; i--) {
    if (--popups[i].life <= 0) popups.splice(i, 1);
  }
}

function update() {
  if (restartGuard > 0) restartGuard--;
  if (state === 'attract' || state === 'over') { updateEffects(); return; }
  if (paused) return;

  updateEffects();

  if (state === 'playerdown') {
    if (--stateTimer <= 0) {
      if (lives <= 0) { gameOver('the bulwark has fallen'); return; }
      playerX = 40;
      state = 'playing';
    }
    return; // world freezes during the death flash
  }

  if (state === 'wavepause') {
    if (--stateTimer <= 0) {
      wave++;
      syncHud();
      startWave();
      state = 'playing';
    }
    return;
  }

  // --- playing ---
  if (keys['arrowleft'] || keys['a']) playerX -= PLAYER_SPEED;
  if (keys['arrowright'] || keys['d']) playerX += PLAYER_SPEED;
  playerX = Math.max(8, Math.min(W - 8 - PLAYER_W, playerX));

  fleetTick();
  if (invaded) { lives = 0; gameOver('the ranks broke through'); return; }
  updateBullet();
  updateBombs();
  updateSaucer();
}

// ------------------------------------------------------------------- render

function drawBomb(b) {
  ctx.fillStyle = '#ffd25e';
  if (b.type === 0) {
    // straight bolt with a bright tip
    ctx.fillRect(b.x, b.y, 2, 8);
    ctx.fillStyle = '#fff2c0';
    ctx.fillRect(b.x, b.y + 6, 2, 2);
  } else {
    // wiggly bolt: little zigzag that flickers as it falls
    const k = Math.floor(b.phase / 4) & 1;
    for (let i = 0; i < 4; i++) {
      const off = ((i + k) & 1) ? 2 : -2;
      ctx.fillRect(b.x + off, b.y + i * 2, 2, 2);
    }
    ctx.fillStyle = '#fff2c0';
    ctx.fillRect(b.x + ((k) ? -2 : 2), b.y + 6, 2, 2);
  }
}

function render() {
  ctx.clearRect(0, 0, W, H);

  // faint starfield backdrop (deterministic)
  ctx.fillStyle = 'rgba(201, 209, 217, 0.08)';
  for (let i = 0; i < 40; i++) {
    const sx = (i * 97 + 31) % W;
    const sy = (i * 173 + 59) % 380;
    ctx.fillRect(sx, sy, 1, 1);
  }

  // ground line
  ctx.fillStyle = '#2f8ba3';
  ctx.fillRect(8, 478, W - 16, 2);

  // shields
  for (const s of shields) ctx.drawImage(s.canvas, s.x, s.y);

  // invaders
  for (const inv of invaders) {
    if (!inv.alive) continue;
    const r = invRect(inv);
    ctx.drawImage(baked[inv.type][inv.frame], r.x, r.y);
  }

  // saucer
  if (saucer) ctx.drawImage(saucerSprite, Math.round(saucer.x), SAUCER_Y);

  // player
  if (state !== 'playerdown' || (stateTimer & 4)) {
    if (state !== 'over' || lives > 0) ctx.drawImage(cannonSprite, Math.round(playerX), PLAYER_Y);
  }

  // bullet
  if (bullet) {
    ctx.fillStyle = '#e8f6ff';
    ctx.fillRect(Math.round(bullet.x), Math.round(bullet.y), 2, 8);
  }

  // bombs
  for (const b of bombs) drawBomb(b);

  // particles
  for (const p of particles) {
    ctx.fillStyle = p.color;
    ctx.globalAlpha = Math.min(1, p.life / 12);
    ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
  }
  ctx.globalAlpha = 1;

  // popups (saucer bonus, extra life)
  ctx.font = 'bold 11px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  for (const p of popups) {
    ctx.fillStyle = p.color;
    ctx.globalAlpha = Math.min(1, p.life / 20);
    ctx.fillText(p.text, p.x, p.y);
  }
  ctx.globalAlpha = 1;

  // reserve lives strip
  ctx.fillStyle = '#6b7480';
  ctx.textAlign = 'left';
  ctx.fillText(String(Math.max(0, lives)), 12, 500);
  for (let i = 0; i < Math.max(0, lives - 1); i++) {
    ctx.drawImage(cannonDim, 28 + i * 32, 488, 26, 12);
  }
  ctx.fillStyle = '#6b7480';
  ctx.textAlign = 'right';
  ctx.fillText('wave ' + wave, W - 12, 500);
}

// --------------------------------------------------------------------- loop

let last = performance.now();
let acc = 0;

function frame(now) {
  acc += Math.min(now - last, 250); // clamp long tab-away gaps
  last = now;
  while (acc >= TICK * 1000) {
    update();
    acc -= TICK * 1000;
  }
  render();
  requestAnimationFrame(frame);
}

syncHud();
startWave(); // dress the attract screen with a waiting fleet
showOverlay('BULWARK', 'press SPACE to defend', 'best ' + hiscore, false);
requestAnimationFrame(frame);

// inert unless a test harness sets window.__BULWARK_TEST before loading
if (window.__BULWARK_TEST) {
  window.__bulwark = {
    snap: () => ({ state, wave, lives, score, fleetDir, playerX, paused,
                   bullet, bombs, saucer, invaders, shields }),
    setPlayerX: (x) => { playerX = x; },
  };
}

})();

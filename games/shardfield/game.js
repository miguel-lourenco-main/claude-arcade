'use strict';
/*
 * SHARDFIELD — an inertial vector space shooter.
 * Fixed-timestep simulation (accumulator), interpolated rendering,
 * procedural vector graphics, Web Audio synthesized sound.
 */
(() => {

// ---------------------------------------------------------------- constants

const W = 960, H = 720;
const DT = 1 / 60;                       // fixed simulation step, seconds
const STORE = 'arcade.shardfield.';

const SHIP = {
  rot: 4.1,          // rad/s
  thrust: 315,       // px/s^2 along the nose
  maxSpeed: 460,     // px/s velocity cap
  r: 11,             // collision radius
};

const MUZZLE = 560;                            // bullet speed added to ship velocity
const BULLET_LIFE = 0.92 * W / MUZZLE;         // just under one screen-crossing
const MAX_BULLETS = 4;

// shard sizes: 3 large -> 2 medium -> 1 small -> gone
const SIZES = {
  3: { R: 44, vmin: 42,  vmax: 95,  pts: 20,  weight: 4 },
  2: { R: 25, vmin: 88,  vmax: 165, pts: 50,  weight: 2 },
  1: { R: 13, vmin: 145, vmax: 240, pts: 100, weight: 1 },
};

const SAUCER = {
  big:   { r: 17, pts: 200,  fireEvery: 1.05, speed: 95,  shotSpeed: 350 },
  small: { r: 10, pts: 1000, fireEvery: 0.95, speed: 128, shotSpeed: 405 },
};
const SAUCER_SHOT_LIFE = 1.35;

const SAFE_RADIUS = 150;       // spawn-safe zone around center
const EXTRA_LIFE_EVERY = 10000;
const START_LIVES = 3;

// ------------------------------------------------------------------ helpers

const rand = (a, b) => a + Math.random() * (b - a);
const irand = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const dist2 = (ax, ay, bx, by) => {
  // toroidal shortest distance squared
  let dx = Math.abs(ax - bx); if (dx > W / 2) dx = W - dx;
  let dy = Math.abs(ay - by); if (dy > H / 2) dy = H - dy;
  return dx * dx + dy * dy;
};

// --------------------------------------------------------------------- DOM

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const dpr = Math.min(window.devicePixelRatio || 1, 2);
canvas.width = W * dpr;
canvas.height = H * dpr;
ctx.scale(dpr, dpr);

const ui = {
  score: document.getElementById('score'),
  best: document.getElementById('best'),
  wave: document.getElementById('wave'),
  lives: document.getElementById('lives'),
  overlay: document.getElementById('overlay'),
  title: document.getElementById('overlay-title'),
  sub: document.getElementById('overlay-sub'),
  msg: document.getElementById('overlay-msg'),
  audio: document.getElementById('audio-toggle'),
};

// ------------------------------------------------------------------- audio

const AC = {
  ctx: null,
  master: null,
  noise: null,
  on: localStorage.getItem(STORE + 'sound') !== 'off',
  thrustNodes: null,
  saucerNodes: null,
  saucerKind: null,
  warbleT: 0,
  warbleHi: false,

  ensure() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.on ? 0.5 : 0;
      this.master.connect(this.ctx.destination);
      const n = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, n, n);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },

  toggle() {
    this.on = !this.on;
    localStorage.setItem(STORE + 'sound', this.on ? 'on' : 'off');
    if (this.master) this.master.gain.value = this.on ? 0.5 : 0;
    ui.audio.textContent = 'sound: ' + (this.on ? 'on' : 'off');
    if (!this.on) { this.setThrust(false); this.setSaucer(null); }
  },

  tone(f0, f1, dur, type, vol, when = 0) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  },

  burst(dur, cutoff, vol, rate = 1) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rate;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, cutoff * 0.2), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  },

  fire() { this.tone(950, 160, 0.1, 'square', 0.15); },
  saucerFire() { this.tone(520, 90, 0.14, 'sawtooth', 0.13); },

  boom(size) {
    // size 1..3 shards, 4 = ship / saucer
    const cfg = {
      1: [0.28, 2400, 0.28, 1.4],
      2: [0.42, 1300, 0.34, 1.0],
      3: [0.6, 750, 0.4, 0.7],
      4: [0.9, 520, 0.5, 0.55],
    }[size];
    this.burst(cfg[0], cfg[1], cfg[2], cfg[3]);
  },

  beat(hi) {
    this.tone(hi ? 108 : 74, hi ? 82 : 56, 0.11, 'triangle', 0.4);
  },

  extraLife() {
    this.tone(520, 520, 0.09, 'square', 0.14, 0);
    this.tone(660, 660, 0.09, 'square', 0.14, 0.1);
    this.tone(880, 880, 0.14, 'square', 0.16, 0.2);
  },

  setThrust(onFlag) {
    if (!this.ctx || !this.on) onFlag = false;
    if (onFlag && !this.thrustNodes) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = 0.55;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 380;
      const g = this.ctx.createGain();
      g.gain.value = 0.0001;
      g.gain.setTargetAtTime(0.22, this.ctx.currentTime, 0.04);
      src.connect(f).connect(g).connect(this.master);
      src.start();
      this.thrustNodes = { src, g };
    } else if (!onFlag && this.thrustNodes) {
      const { src, g } = this.thrustNodes;
      g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.05);
      src.stop(this.ctx.currentTime + 0.3);
      this.thrustNodes = null;
    }
  },

  setSaucer(kind) {
    if (!this.ctx || !this.on) kind = null;
    if (kind === this.saucerKind) return;
    if (this.saucerNodes) {
      const { o, g } = this.saucerNodes;
      g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.04);
      o.stop(this.ctx.currentTime + 0.25);
      this.saucerNodes = null;
    }
    this.saucerKind = kind;
    if (kind) {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = kind === 'small' ? 620 : 180;
      const g = this.ctx.createGain();
      g.gain.value = 0.0001;
      g.gain.setTargetAtTime(0.055, this.ctx.currentTime, 0.05);
      o.connect(g).connect(this.master);
      o.start();
      this.saucerNodes = { o, g };
      this.warbleT = 0;
    }
  },

  updateWarble(dt) {
    if (!this.saucerNodes) return;
    const small = this.saucerKind === 'small';
    const period = small ? 0.09 : 0.17;
    this.warbleT += dt;
    if (this.warbleT >= period) {
      this.warbleT -= period;
      this.warbleHi = !this.warbleHi;
      const f = small ? (this.warbleHi ? 840 : 620) : (this.warbleHi ? 255 : 180);
      this.saucerNodes.o.frequency.setValueAtTime(f, this.ctx.currentTime);
    }
  },
};

ui.audio.textContent = 'sound: ' + (AC.on ? 'on' : 'off');
ui.audio.addEventListener('click', () => { AC.ensure(); AC.toggle(); });

// -------------------------------------------------------------- game state

let state = 'attract';           // attract | play | over
let paused = false;
let ship = null;
let shards = [];
let bullets = [];                // player bullets
let ebullets = [];               // saucer bullets
let debris = [];                 // ship line segments drifting apart
let sparks = [];                 // point particles
let saucer = null;

let score = 0;
let best = parseInt(localStorage.getItem(STORE + 'best') || '0', 10) || 0;
let lives = 0;
let wave = 0;
let nextLifeAt = EXTRA_LIFE_EVERY;

let respawnTimer = 0;
let waveTimer = -1;
let overTimer = -1;
let saucerTimer = 0;
let waveWeight = 1;
let waveTime = 0;
let beatTimer = 0.6;
let beatHi = false;
let flash = null;                // { text, t, dur }

let fireQueued = false;
const keys = { left: false, right: false, up: false };

// stars backdrop
const stars = [];
for (let i = 0; i < 90; i++) {
  stars.push({ x: Math.random() * W, y: Math.random() * H, b: rand(0.08, 0.4) });
}

// ---------------------------------------------------------------- entities

function newShip() {
  return {
    x: W / 2, y: H / 2, px: W / 2, py: H / 2,
    vx: 0, vy: 0,
    a: -Math.PI / 2, pa: -Math.PI / 2,
    thrusting: false,
    flame: 0,
  };
}

// ship geometry as line segments (local coords, nose = +x)
const SHIP_SEGS = [
  [[15, 0], [-11, 9]],
  [[15, 0], [-11, -9]],
  [[-7.2, 6.1], [-7.2, -6.1]],
];
const FLAME_SEGS = [
  [[-7.2, 4], [-15, 0]],
  [[-7.2, -4], [-15, 0]],
];

function makeShard(x, y, size, parentSpeedBoost = 0) {
  const cfg = SIZES[size];
  const ang = rand(0, Math.PI * 2);
  const spd = rand(cfg.vmin, cfg.vmax) + parentSpeedBoost;
  const n = irand(9, 12);
  const verts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const r = cfg.R * rand(0.62, 1.12);
    verts.push([Math.cos(t) * r, Math.sin(t) * r]);
  }
  const a0 = rand(0, Math.PI * 2);
  return {
    x, y, px: x, py: y,
    vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
    a: a0, pa: a0,
    spin: rand(-1.3, 1.3),
    size, verts,
    cr: cfg.R * 0.82,          // collision radius
  };
}

function makeSaucer() {
  const pSmall = score < 3000 ? 0.12 : Math.min(0.9, 0.2 + score / 25000);
  const kind = Math.random() < pSmall ? 'small' : 'big';
  const cfg = SAUCER[kind];
  const fromLeft = Math.random() < 0.5;
  const x0 = fromLeft ? -cfg.r : W + cfg.r;
  const y0 = rand(H * 0.15, H * 0.85);
  return {
    kind, cfg,
    x: x0, y: y0,
    px: x0, py: y0,
    vx: (fromLeft ? 1 : -1) * cfg.speed,
    vy: 0,
    zigTimer: rand(0.8, 2.0),
    fireTimer: cfg.fireEvery * rand(0.8, 1.4),
  };
}

function spawnSparks(x, y, n, spd, life, color) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2);
    const s = rand(spd * 0.3, spd);
    sparks.push({
      x, y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      t: rand(life * 0.5, life), max: life,
      color,
    });
  }
}

function shipDebris(sh) {
  for (const seg of SHIP_SEGS) {
    const cos = Math.cos(sh.a), sin = Math.sin(sh.a);
    const p1 = [sh.x + seg[0][0] * cos - seg[0][1] * sin, sh.y + seg[0][0] * sin + seg[0][1] * cos];
    const p2 = [sh.x + seg[1][0] * cos - seg[1][1] * sin, sh.y + seg[1][0] * sin + seg[1][1] * cos];
    const mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2;
    const a = rand(0, Math.PI * 2);
    debris.push({
      x: mx, y: my, px: mx, py: my,
      dx1: p1[0] - mx, dy1: p1[1] - my,
      dx2: p2[0] - mx, dy2: p2[1] - my,
      vx: sh.vx * 0.35 + Math.cos(a) * rand(24, 62),
      vy: sh.vy * 0.35 + Math.sin(a) * rand(24, 62),
      rot: 0, prot: 0, spin: rand(-2.4, 2.4),
      t: 2.4, max: 2.4,
    });
  }
}

// ------------------------------------------------------------ game control

function addScore(n) {
  score += n;
  if (score >= nextLifeAt) {
    lives++;
    nextLifeAt += EXTRA_LIFE_EVERY;
    AC.extraLife();
    setFlash('EXTRA SHIP', 1.6);
  }
  syncHud();
}

function setFlash(text, dur) {
  flash = { text, t: dur, dur };
}

function currentWeight() {
  let w = 0;
  for (const s of shards) w += SIZES[s.size].weight;
  return w;
}

function spawnWave() {
  wave++;
  const n = Math.min(4 + (wave - 1) * 2, 12);
  const ax = ship ? ship.x : W / 2;
  const ay = ship ? ship.y : H / 2;
  for (let i = 0; i < n; i++) {
    let x, y, tries = 0;
    do {
      x = Math.random() * W;
      y = Math.random() * H;
      tries++;
    } while (dist2(x, y, ax, ay) < 220 * 220 && tries < 60);
    shards.push(makeShard(x, y, 3));
  }
  waveWeight = n * SIZES[3].weight;
  waveTime = 0;
  waveTimer = -1;
  beatTimer = 0.8;
  setFlash('WAVE ' + wave, 1.8);
  syncHud();
}

function splitShard(s, award) {
  s.dead = true;
  if (award) addScore(SIZES[s.size].pts);
  AC.boom(s.size);
  spawnSparks(s.x, s.y, 5 + s.size * 3, 90 + s.size * 25, 0.7, 'rgba(159,184,200,');
  if (s.size > 1) {
    for (let i = 0; i < 2; i++) {
      shards.push(makeShard(s.x, s.y, s.size - 1, rand(0, 30)));
    }
  }
}

function killSaucer(award) {
  if (!saucer) return;
  if (award) addScore(saucer.cfg.pts);
  AC.boom(4);
  spawnSparks(saucer.x, saucer.y, 16, 150, 0.9, 'rgba(255,157,192,');
  saucer = null;
  saucerTimer = rand(9, 16);
}

function killShip() {
  if (!ship) return;
  shipDebris(ship);
  spawnSparks(ship.x, ship.y, 20, 130, 1.1, 'rgba(234,249,255,');
  AC.boom(4);
  AC.setThrust(false);
  ship = null;
  fireQueued = false;
  lives--;
  syncHud();
  if (lives > 0) {
    respawnTimer = 1.6;
  } else {
    overTimer = 2.2;
  }
}

function centerSafe() {
  for (const s of shards) {
    if (dist2(s.x, s.y, W / 2, H / 2) < (SAFE_RADIUS + s.cr) ** 2) return false;
  }
  if (saucer && dist2(saucer.x, saucer.y, W / 2, H / 2) < (SAFE_RADIUS + 60) ** 2) return false;
  for (const b of ebullets) {
    if (dist2(b.x, b.y, W / 2, H / 2) < (SAFE_RADIUS * 0.85) ** 2) return false;
  }
  return true;
}

function startGame() {
  shards = [];
  bullets = [];
  ebullets = [];
  debris = [];
  sparks = [];
  saucer = null;
  score = 0;
  lives = START_LIVES;
  wave = 0;
  nextLifeAt = EXTRA_LIFE_EVERY;
  respawnTimer = 0;
  overTimer = -1;
  saucerTimer = rand(10, 17);
  ship = newShip();
  state = 'play';
  paused = false;
  spawnWave();
  hideOverlay();
  syncHud();
}

function gameOver() {
  state = 'over';
  if (score > best) {
    best = score;
    localStorage.setItem(STORE + 'best', String(best));
  }
  syncHud();
  showOverlay('FIELD LOST', 'score ' + score + '  ·  best ' + best,
    'press ENTER to fly again');
}

function seedAttract() {
  shards = [];
  for (let i = 0; i < 6; i++) {
    shards.push(makeShard(Math.random() * W, Math.random() * H, irand(2, 3)));
  }
}

// ----------------------------------------------------------------- overlay

function showOverlay(title, sub, msg) {
  ui.title.textContent = title;
  ui.sub.textContent = sub;
  ui.msg.textContent = msg;
  ui.overlay.classList.add('show');
}
function hideOverlay() { ui.overlay.classList.remove('show'); }

function syncHud() {
  ui.score.textContent = score;
  ui.best.textContent = Math.max(best, score);
  ui.wave.textContent = state === 'attract' ? '—' : wave;
  ui.lives.textContent = state === 'attract' ? '—' : (lives > 0 ? '▲'.repeat(Math.min(lives, 8)) : '·');
}

// ------------------------------------------------------------------- input

window.addEventListener('keydown', (e) => {
  if (e.repeat && e.code !== 'ArrowLeft' && e.code !== 'ArrowRight' && e.code !== 'ArrowUp') {
    if (['Space', 'ArrowDown'].includes(e.code)) e.preventDefault();
    return;
  }
  AC.ensure();
  switch (e.code) {
    case 'ArrowLeft': case 'KeyA': keys.left = true; e.preventDefault(); break;
    case 'ArrowRight': case 'KeyD': keys.right = true; e.preventDefault(); break;
    case 'ArrowUp': case 'KeyW': keys.up = true; e.preventDefault(); break;
    case 'Space':
      e.preventDefault();
      if (state === 'play' && !paused) fireQueued = true;
      else if (state !== 'play') startGame();
      break;
    case 'Enter':
      if (state !== 'play') startGame();
      else if (paused) togglePause();
      break;
    case 'KeyP':
      if (state === 'play') togglePause();
      break;
    case 'KeyM':
      AC.toggle();
      break;
    case 'KeyR':
      if (state === 'over') startGame();
      break;
  }
});

window.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'ArrowLeft': case 'KeyA': keys.left = false; break;
    case 'ArrowRight': case 'KeyD': keys.right = false; break;
    case 'ArrowUp': case 'KeyW': keys.up = false; break;
  }
});

function togglePause() {
  paused = !paused;
  if (paused) {
    AC.setThrust(false);
    AC.setSaucer(null);
    showOverlay('PAUSED', 'the shards wait for no one', 'press P to resume');
  } else {
    hideOverlay();
  }
}

window.addEventListener('blur', () => {
  if (state === 'play' && !paused) togglePause();
  keys.left = keys.right = keys.up = false;
});

// -------------------------------------------------------------- simulation

function wrapEntity(e) {
  if (e.x < 0) { e.x += W; e.px += W; }
  else if (e.x >= W) { e.x -= W; e.px -= W; }
  if (e.y < 0) { e.y += H; e.py += H; }
  else if (e.y >= H) { e.y -= H; e.py -= H; }
}

function savePrev() {
  if (ship) { ship.px = ship.x; ship.py = ship.y; ship.pa = ship.a; }
  for (const s of shards) { s.px = s.x; s.py = s.y; s.pa = s.a; }
  for (const b of bullets) { b.px = b.x; b.py = b.y; }
  for (const b of ebullets) { b.px = b.x; b.py = b.y; }
  for (const d of debris) { d.px = d.x; d.py = d.y; d.prot = d.rot; }
  if (saucer) { saucer.px = saucer.x; saucer.py = saucer.y; }
}

function tickShip() {
  const sh = ship;
  // rotation never touches the velocity vector — only the heading
  if (keys.left) sh.a -= SHIP.rot * DT;
  if (keys.right) sh.a += SHIP.rot * DT;

  sh.thrusting = keys.up;
  if (sh.thrusting) {
    // thrust adds acceleration along the nose to the persistent velocity
    sh.vx += Math.cos(sh.a) * SHIP.thrust * DT;
    sh.vy += Math.sin(sh.a) * SHIP.thrust * DT;
    const sp = Math.hypot(sh.vx, sh.vy);
    if (sp > SHIP.maxSpeed) {
      sh.vx *= SHIP.maxSpeed / sp;
      sh.vy *= SHIP.maxSpeed / sp;
    }
    sh.flame += DT;
  }
  // no damping while coasting: velocity persists untouched

  sh.x += sh.vx * DT;
  sh.y += sh.vy * DT;
  wrapEntity(sh);

  if (fireQueued) {
    fireQueued = false;
    if (bullets.length < MAX_BULLETS) {
      const cos = Math.cos(sh.a), sin = Math.sin(sh.a);
      bullets.push({
        x: sh.x + cos * 16, y: sh.y + sin * 16,
        px: sh.x + cos * 16, py: sh.y + sin * 16,
        // bullets inherit ship velocity plus fixed muzzle speed
        vx: sh.vx + cos * MUZZLE,
        vy: sh.vy + sin * MUZZLE,
        t: BULLET_LIFE,
      });
      AC.fire();
    }
  }
}

function tickSaucer() {
  if (!saucer) {
    if (state === 'play') {
      saucerTimer -= DT;
      if (saucerTimer <= 0) saucer = makeSaucer();
    }
    return;
  }
  const sc = saucer;
  sc.zigTimer -= DT;
  if (sc.zigTimer <= 0) {
    sc.zigTimer = rand(1.0, 2.4);
    sc.vy = [-0.55, 0, 0.55][irand(0, 2)] * sc.cfg.speed;
  }
  sc.x += sc.vx * DT;
  sc.y += sc.vy * DT;
  // wraps vertically, crosses horizontally then leaves
  if (sc.y < 0) { sc.y += H; sc.py += H; }
  else if (sc.y >= H) { sc.y -= H; sc.py -= H; }
  if ((sc.vx > 0 && sc.x > W + sc.cfg.r + 4) || (sc.vx < 0 && sc.x < -sc.cfg.r - 4)) {
    saucer = null;
    saucerTimer = rand(8, 15);
    return;
  }

  sc.fireTimer -= DT;
  if (sc.fireTimer <= 0 && sc.x > -10 && sc.x < W + 10) {
    sc.fireTimer = sc.cfg.fireEvery * rand(0.85, 1.25);
    let ang;
    if (sc.kind === 'big' || !ship) {
      // the large saucer fires in random directions
      ang = rand(0, Math.PI * 2);
    } else {
      // the small saucer aims at the ship; its aim error shrinks as score rises
      const err = Math.max(0.05, 0.55 - 0.5 * Math.min(1, score / 35000));
      // aim across the torus: shortest wrapped delta
      let dx = ship.x - sc.x; if (dx > W / 2) dx -= W; else if (dx < -W / 2) dx += W;
      let dy = ship.y - sc.y; if (dy > H / 2) dy -= H; else if (dy < -H / 2) dy += H;
      ang = Math.atan2(dy, dx) + rand(-err, err);
    }
    ebullets.push({
      x: sc.x, y: sc.y, px: sc.x, py: sc.y,
      vx: Math.cos(ang) * sc.cfg.shotSpeed,
      vy: Math.sin(ang) * sc.cfg.shotSpeed,
      t: SAUCER_SHOT_LIFE,
    });
    AC.saucerFire();
  }
}

function tickCollisions() {
  // player bullets vs shards / saucer
  for (const b of bullets) {
    if (b.dead) continue;
    for (const s of shards) {
      if (s.dead) continue;
      if (dist2(b.x, b.y, s.x, s.y) < s.cr * s.cr) {
        b.dead = true;
        splitShard(s, true);
        break;
      }
    }
    if (!b.dead && saucer && dist2(b.x, b.y, saucer.x, saucer.y) < (saucer.cfg.r + 3) ** 2) {
      b.dead = true;
      killSaucer(true);
    }
  }

  // saucer bullets destroy shards too (no points), and the ship
  for (const b of ebullets) {
    if (b.dead) continue;
    for (const s of shards) {
      if (s.dead) continue;
      if (dist2(b.x, b.y, s.x, s.y) < s.cr * s.cr) {
        b.dead = true;
        splitShard(s, false);
        break;
      }
    }
    if (!b.dead && ship && dist2(b.x, b.y, ship.x, ship.y) < (SHIP.r + 3) ** 2) {
      b.dead = true;
      killShip();
    }
  }

  // ship vs shards (ramming splits the shard and scores, but costs the ship)
  if (ship) {
    for (const s of shards) {
      if (s.dead) continue;
      if (dist2(ship.x, ship.y, s.x, s.y) < (s.cr + SHIP.r * 0.85) ** 2) {
        splitShard(s, true);
        killShip();
        break;
      }
    }
  }

  // ship vs saucer
  if (ship && saucer && dist2(ship.x, ship.y, saucer.x, saucer.y) < (saucer.cfg.r + SHIP.r) ** 2) {
    killSaucer(true);
    killShip();
  }

  // saucer vs shards — rocks don't care whose side you're on
  if (saucer) {
    for (const s of shards) {
      if (s.dead) continue;
      if (dist2(saucer.x, saucer.y, s.x, s.y) < (s.cr + saucer.cfg.r) ** 2) {
        splitShard(s, false);
        killSaucer(false);
        break;
      }
    }
  }

  shards = shards.filter((s) => !s.dead);
  bullets = bullets.filter((b) => !b.dead);
  ebullets = ebullets.filter((b) => !b.dead);
}

function tick() {
  savePrev();

  // shards drift and spin in every state
  for (const s of shards) {
    s.x += s.vx * DT;
    s.y += s.vy * DT;
    s.a += s.spin * DT;
    wrapEntity(s);
  }

  // particles + debris in every state
  for (const d of debris) {
    d.x += d.vx * DT;
    d.y += d.vy * DT;
    d.rot += d.spin * DT;
    d.t -= DT;
    wrapEntity(d);
  }
  debris = debris.filter((d) => d.t > 0);

  for (const p of sparks) {
    p.x += p.vx * DT;
    p.y += p.vy * DT;
    p.vx *= 0.985;
    p.vy *= 0.985;
    p.t -= DT;
  }
  sparks = sparks.filter((p) => p.t > 0);

  if (flash) {
    flash.t -= DT;
    if (flash.t <= 0) flash = null;
  }

  if (state !== 'play') {
    AC.setThrust(false);
    AC.setSaucer(null);
    return;
  }

  waveTime += DT;

  if (ship) tickShip();

  for (const b of bullets) {
    b.x += b.vx * DT;
    b.y += b.vy * DT;
    b.t -= DT;
    if (b.t <= 0) b.dead = true;
    wrapEntity(b);
  }
  for (const b of ebullets) {
    b.x += b.vx * DT;
    b.y += b.vy * DT;
    b.t -= DT;
    if (b.t <= 0) b.dead = true;
    wrapEntity(b);
  }

  tickSaucer();
  tickCollisions();

  // respawn only when the spawn-safe zone around center is clear
  if (!ship && lives > 0) {
    if (respawnTimer > 0) {
      respawnTimer -= DT;
    } else if (centerSafe()) {
      ship = newShip();
    }
  }

  // game over
  if (lives <= 0 && overTimer > 0) {
    overTimer -= DT;
    if (overTimer <= 0) gameOver();
  }

  // wave clear -> next wave gets +2 shards
  if (shards.length === 0 && lives > 0) {
    if (waveTimer < 0) waveTimer = 2.4;
    waveTimer -= DT;
    if (waveTimer <= 0) spawnWave();
  }

  // the two-tone heartbeat accelerates as the field thins
  if (shards.length > 0 && ship) {
    const frac = currentWeight() / waveWeight;
    let interval = 0.3 + 0.75 * clamp(frac, 0, 1);
    interval -= Math.min(0.12, waveTime * 0.004);
    interval = clamp(interval, 0.24, 1.05);
    beatTimer -= DT;
    if (beatTimer <= 0) {
      AC.beat(beatHi);
      beatHi = !beatHi;
      beatTimer = interval;
    }
  }

  // reconcile continuous sounds with world state
  AC.setThrust(!!(ship && ship.thrusting));
  AC.setSaucer(saucer ? saucer.kind : null);
  AC.updateWarble(DT);
}

// --------------------------------------------------------------- rendering

const ACCENT = '#7df9ff';
const GLOW_SHIP = 'rgba(125,249,255,0.6)';
const GLOW_ROCK = 'rgba(125,200,255,0.35)';
const GLOW_FOE = 'rgba(255,157,192,0.55)';

function ipos(e, alpha) {
  return [lerp(e.px, e.x, alpha), lerp(e.py, e.y, alpha)];
}

// draw fn at (x,y) plus toroidal duplicates when close to an edge
function drawWrapped(x, y, r, fn) {
  const xs = [0];
  const ys = [0];
  if (x < r) xs.push(W); else if (x > W - r) xs.push(-W);
  if (y < r) ys.push(H); else if (y > H - r) ys.push(-H);
  for (const ox of xs) for (const oy of ys) fn(x + ox, y + oy);
}

function strokeSegs(segs, x, y, ang) {
  const cos = Math.cos(ang), sin = Math.sin(ang);
  ctx.beginPath();
  for (const [[x1, y1], [x2, y2]] of segs) {
    ctx.moveTo(x + x1 * cos - y1 * sin, y + x1 * sin + y1 * cos);
    ctx.lineTo(x + x2 * cos - y2 * sin, y + x2 * sin + y2 * cos);
  }
  ctx.stroke();
}

function renderShip(alpha) {
  const sh = ship;
  const [x, y] = ipos(sh, alpha);
  const a = lerp(sh.pa, sh.a, alpha);
  ctx.strokeStyle = '#eaf9ff';
  ctx.lineWidth = 1.6;
  ctx.shadowColor = GLOW_SHIP;
  ctx.shadowBlur = 12;
  drawWrapped(x, y, 20, (dx, dy) => strokeSegs(SHIP_SEGS, dx, dy, a));
  if (sh.thrusting && Math.floor(sh.flame * 18) % 2 === 0) {
    ctx.strokeStyle = ACCENT;
    drawWrapped(x, y, 20, (dx, dy) => strokeSegs(FLAME_SEGS, dx, dy, a));
  }
}

function renderShard(s, alpha) {
  const [x, y] = ipos(s, alpha);
  const a = lerp(s.pa, s.a, alpha);
  const r = SIZES[s.size].R + 4;
  drawWrapped(x, y, r, (dx, dy) => {
    const cos = Math.cos(a), sin = Math.sin(a);
    ctx.beginPath();
    for (let i = 0; i < s.verts.length; i++) {
      const [vx, vy] = s.verts[i];
      const px = dx + vx * cos - vy * sin;
      const py = dy + vx * sin + vy * cos;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
  });
}

function renderSaucer(alpha) {
  const sc = saucer;
  const [x, y] = ipos(sc, alpha);
  const r = sc.cfg.r;
  ctx.strokeStyle = '#ffc4da';
  ctx.lineWidth = 1.6;
  ctx.shadowColor = GLOW_FOE;
  ctx.shadowBlur = 12;
  drawWrapped(x, y, r + 6, (dx, dy) => {
    ctx.beginPath();
    // hull: flat lens shape
    ctx.moveTo(dx - r, dy);
    ctx.lineTo(dx - r * 0.45, dy - r * 0.42);
    ctx.lineTo(dx + r * 0.45, dy - r * 0.42);
    ctx.lineTo(dx + r, dy);
    ctx.lineTo(dx + r * 0.45, dy + r * 0.45);
    ctx.lineTo(dx - r * 0.45, dy + r * 0.45);
    ctx.closePath();
    // canopy
    ctx.moveTo(dx - r * 0.3, dy - r * 0.42);
    ctx.lineTo(dx - r * 0.18, dy - r * 0.85);
    ctx.lineTo(dx + r * 0.18, dy - r * 0.85);
    ctx.lineTo(dx + r * 0.3, dy - r * 0.42);
    // belt line
    ctx.moveTo(dx - r, dy);
    ctx.lineTo(dx + r, dy);
    ctx.stroke();
  });
}

function render(alpha) {
  ctx.fillStyle = '#0d0f12';
  ctx.fillRect(0, 0, W, H);

  ctx.shadowBlur = 0;
  for (const st of stars) {
    ctx.fillStyle = 'rgba(201,209,217,' + st.b + ')';
    ctx.fillRect(st.x, st.y, 1.2, 1.2);
  }

  // shards
  ctx.strokeStyle = '#9fb8c8';
  ctx.lineWidth = 1.5;
  ctx.shadowColor = GLOW_ROCK;
  ctx.shadowBlur = 10;
  for (const s of shards) renderShard(s, alpha);

  if (saucer) renderSaucer(alpha);

  // player bullets
  ctx.fillStyle = ACCENT;
  ctx.shadowColor = GLOW_SHIP;
  ctx.shadowBlur = 10;
  for (const b of bullets) {
    const [x, y] = ipos(b, alpha);
    drawWrapped(x, y, 4, (dx, dy) => ctx.fillRect(dx - 1.6, dy - 1.6, 3.2, 3.2));
  }

  // saucer bullets
  ctx.fillStyle = '#ff9dc0';
  ctx.shadowColor = GLOW_FOE;
  for (const b of ebullets) {
    const [x, y] = ipos(b, alpha);
    drawWrapped(x, y, 4, (dx, dy) => ctx.fillRect(dx - 1.8, dy - 1.8, 3.6, 3.6));
  }

  // ship or drifting wreckage
  if (ship && state === 'play') renderShip(alpha);
  for (const d of debris) {
    const [x, y] = ipos(d, alpha);
    const rot = lerp(d.prot, d.rot, alpha);
    const fade = clamp(d.t / d.max, 0, 1);
    ctx.strokeStyle = 'rgba(234,249,255,' + (0.9 * fade) + ')';
    ctx.lineWidth = 1.6;
    ctx.shadowColor = GLOW_SHIP;
    ctx.shadowBlur = 10 * fade;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    ctx.beginPath();
    ctx.moveTo(x + d.dx1 * cos - d.dy1 * sin, y + d.dx1 * sin + d.dy1 * cos);
    ctx.lineTo(x + d.dx2 * cos - d.dy2 * sin, y + d.dx2 * sin + d.dy2 * cos);
    ctx.stroke();
  }

  // sparks
  ctx.shadowBlur = 0;
  for (const p of sparks) {
    const fade = clamp(p.t / p.max, 0, 1);
    ctx.fillStyle = p.color + (0.85 * fade) + ')';
    ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
  }

  // center flash text
  if (flash) {
    const fade = clamp(flash.t / flash.dur, 0, 1);
    ctx.font = '700 30px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(125,249,255,' + (0.85 * Math.min(1, fade * 2)) + ')';
    ctx.shadowColor = GLOW_SHIP;
    ctx.shadowBlur = 16;
    ctx.fillText(flash.text, W / 2, H / 2 - 60);
    ctx.shadowBlur = 0;
  }

  // waiting-to-respawn hint
  if (state === 'play' && !ship && lives > 0 && respawnTimer <= 0) {
    ctx.font = '13px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(107,116,128,0.9)';
    ctx.fillText('clearing a landing zone…', W / 2, H / 2 + 4);
  }
}

// --------------------------------------------------------------- main loop

let last = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let ft = (now - last) / 1000;
  last = now;
  if (ft > 0.25) ft = 0.25;             // clamp huge frame gaps
  if (paused) { render(1); return; }
  acc += ft;
  while (acc >= DT) {
    tick();
    acc -= DT;
  }
  render(acc / DT);
}

// ------------------------------------------------------------------- start

seedAttract();
syncHud();
showOverlay('SHARDFIELD', 'drift · split · survive', 'press ENTER to launch');
requestAnimationFrame(frame);

})();

"use strict";
/* Brickstorm — a from-scratch paddle-ball brick-breaker.
 * Fixed-timestep logic (120 Hz accumulator), interpolated rendering.
 * All graphics canvas-drawn, all audio Web Audio-synthesized.
 */

(() => {

// ---------------------------------------------------------------------------
// constants

const W = 480, H = 640;
const DT = 1 / 120;               // fixed logic step
const MAX_FRAME = 0.25;           // clamp huge frame gaps (tab switch)

const PADDLE_Y = H - 42;
const PADDLE_H = 12;
const PADDLE_W = 76;
const PADDLE_W_WIDE = 124;
const PADDLE_SPEED = 560;         // keyboard px/s

const BALL_R = 6;
const MAX_BOUNCE_ANGLE = Math.PI / 3;  // +/-60 deg from vertical off the paddle
const MIN_VY_FRAC = 0.28;              // minimum |vy|/speed — never near-horizontal

const BASE_SPEED = 285;           // level-1 serve speed, px/s
const SPEED_PER_LEVEL = 14;
const RAMP_THRESHOLDS = [4, 12, 24, 40];  // brick-hit counts that bump speed
const RAMP_STEP = 0.09;                    // each threshold adds +9%
const TOP_ROW_BOOST = 0.14;                // first touch of the top rows adds +14%
const SPEED_CAP = 640;

const COLS = 12, BRICK_W = 36, BRICK_H = 16, BRICK_TOP = 72;
const MAX_ROWS = 9;

const POWER_FALL = 130;           // capsule fall speed px/s
const POWER_W = 30, POWER_H = 13;
const WIDE_TIME = 12;             // seconds
const SLOW_TIME = 8;
const SLOW_SCALE = 0.62;
const MAX_BALLS = 6;

const START_LIVES = 3;
const LS_HISCORE = "arcade.brickstorm.hiscore";
const LS_AUDIO = "arcade.brickstorm.audio";

// row palette, top row first
const ROW_COLORS = ["#ff5a5a", "#ff8a3c", "#ffb454", "#ffe066",
                    "#a8e05f", "#7ee787", "#58d0ff", "#58b4ff", "#b78aff"];

// ---------------------------------------------------------------------------
// tiny synth

const audio = {
  ctx: null,
  on: localStorage.getItem(LS_AUDIO) !== "0",
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  },
  blip(freq, dur = 0.06, type = "square", vol = 0.16, slide = 0) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur = 0.12, vol = 0.14, cutoff = 2400) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = cutoff;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.ctx.destination);
    src.start(t);
  },
  arp(freqs, step = 0.07, type = "square", vol = 0.14) {
    if (!this.on || !this.ctx) return;
    freqs.forEach((f, i) => setTimeout(() => this.blip(f, step * 0.9, type, vol), i * step * 1000));
  },
};

const sfx = {
  paddle(off) { audio.blip(300 + Math.abs(off) * 180, 0.05, "square", 0.15); },
  wall() { audio.blip(190, 0.04, "square", 0.10); },
  brickHit(row) { audio.blip(520 + (MAX_ROWS - row) * 45, 0.05, "square", 0.13); },
  brickBreak(row) {
    audio.blip(660 + (MAX_ROWS - row) * 55, 0.06, "triangle", 0.15);
    audio.noise(0.10, 0.12, 3200);
  },
  power() { audio.arp([392, 523, 659, 784], 0.055, "triangle", 0.15); },
  serve() { audio.blip(440, 0.07, "triangle", 0.13, 220); },
  lose() { audio.arp([330, 262, 196, 147], 0.09, "sawtooth", 0.11); audio.noise(0.25, 0.10, 900); },
  clear() { audio.arp([523, 659, 784, 1047, 1319], 0.07, "triangle", 0.14); },
  over() { audio.arp([392, 330, 262, 196, 131], 0.13, "sawtooth", 0.12); },
};

// ---------------------------------------------------------------------------
// utils

const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// level patterns — each returns a MAX_ROWS x COLS grid of hp (0 = no brick)

const PATTERNS = [
  // solid band
  (r, c, rows) => (r < rows ? 1 : 0),
  // checkerboard
  (r, c, rows) => (r < rows && (r + c) % 2 === 0 ? 1 : 0),
  // pyramid
  (r, c, rows) => {
    if (r >= rows) return 0;
    const span = Math.min(COLS, 2 + r * 2);
    const lo = Math.floor((COLS - span) / 2);
    return c >= lo && c < lo + span ? 1 : 0;
  },
  // rain columns
  (r, c, rows) => (r < rows && c % 3 !== 2 ? 1 : 0),
  // diamond
  (r, c, rows) => {
    const cy = (rows - 1) / 2, cx = (COLS - 1) / 2;
    if (r >= rows) return 0;
    return Math.abs(r - cy) / (rows / 2) + Math.abs(c - cx) / (COLS / 2) <= 1.05 ? 1 : 0;
  },
  // twin fortresses
  (r, c, rows) => {
    if (r >= rows) return 0;
    const inLeft = c >= 1 && c <= 4, inRight = c >= COLS - 5 && c <= COLS - 2;
    return inLeft || inRight ? 1 : 0;
  },
];

function buildLevel(level) {
  const rng = mulberry32(level * 7919 + 12345);
  const pattern = PATTERNS[(level - 1) % PATTERNS.length];
  const rows = Math.min(MAX_ROWS, 5 + Math.floor((level - 1) / 2));
  const hardness = Math.floor((level - 1) / PATTERNS.length); // full pattern cycles done
  const bricks = [];
  for (let r = 0; r < MAX_ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!pattern(r, c, rows)) continue;
      // multi-hit: top rows are tougher, later levels tougher everywhere
      let hp = 1;
      if (r < 2) hp = 2;
      if (r < 2 && level >= 4) hp = 3;
      else if (r < 4 && level >= 3) hp = Math.max(hp, 2);
      hp = Math.min(3, hp + (rng() < 0.12 * hardness ? 1 : 0));
      bricks.push({
        x: (W - COLS * BRICK_W) / 2 + c * BRICK_W,
        y: BRICK_TOP + r * BRICK_H,
        w: BRICK_W, h: BRICK_H,
        row: r, hp, maxHp: hp,
        power: null,
        alive: true,
      });
    }
  }
  // mark ~11% of bricks with power-ups, at least 3 per level
  const kinds = ["wide", "multi", "slow"];
  const count = Math.max(3, Math.round(bricks.length * 0.11));
  const idx = bricks.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  for (let k = 0; k < count && k < idx.length; k++) {
    bricks[idx[k]].power = kinds[Math.floor(rng() * kinds.length)];
  }
  return bricks;
}

// ---------------------------------------------------------------------------
// game state

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const overlayEl = document.getElementById("overlay");
const titleEl = document.getElementById("overlay-title");
const subEl = document.getElementById("overlay-sub");
const actionEl = document.getElementById("overlay-action");
const hudScore = document.getElementById("hud-score");
const hudHiscore = document.getElementById("hud-hiscore");
const hudLevel = document.getElementById("hud-level");
const hudLives = document.getElementById("hud-lives");
const audioBtn = document.getElementById("audio-toggle");

const G = {
  state: "title",       // title | serve | play | clear | gameover
  paused: false,
  score: 0,
  hiscore: parseInt(localStorage.getItem(LS_HISCORE) || "0", 10) || 0,
  level: 1,
  lives: START_LIVES,
  bricks: [],
  balls: [],
  powers: [],
  particles: [],
  paddle: { x: W / 2, px: W / 2, w: PADDLE_W, targetW: PADDLE_W, wideTimer: 0 },
  slowTimer: 0,
  hitCount: 0,          // brick hits this life — drives the speed ramp
  rampLevel: 0,
  topRowsTouched: false,
  shake: 0,
  flash: 0,
  clearTimer: 0,
  time: 0,
};

const input = { left: false, right: false, mouseX: null };

// ---------------------------------------------------------------------------
// ball helpers

function targetSpeed() {
  let s = (BASE_SPEED + (G.level - 1) * SPEED_PER_LEVEL) * (1 + G.rampLevel * RAMP_STEP);
  if (G.topRowsTouched) s *= 1 + TOP_ROW_BOOST;
  s = Math.min(s, SPEED_CAP);
  if (G.slowTimer > 0) s *= SLOW_SCALE;
  return s;
}

function enforceMinVertical(b) {
  const sp = Math.hypot(b.vx, b.vy) || 1;
  const minVy = sp * MIN_VY_FRAC;
  if (Math.abs(b.vy) < minVy) {
    const sy = b.vy === 0 ? -1 : Math.sign(b.vy);
    b.vy = sy * minVy;
    const vx2 = sp * sp - b.vy * b.vy;
    b.vx = Math.sign(b.vx || 1) * Math.sqrt(Math.max(0, vx2));
  }
}

function normalizeSpeed(b) {
  const want = targetSpeed();
  const sp = Math.hypot(b.vx, b.vy) || 1;
  const k = want / sp;
  b.vx *= k; b.vy *= k;
}

function newBall(x, y, angle, stuck) {
  const sp = targetSpeed();
  return {
    x, y, px: x, py: y,
    vx: Math.sin(angle) * sp,
    vy: -Math.cos(angle) * sp,
    r: BALL_R,
    stuck: !!stuck,
    stuckOff: 0,
  };
}

function attachServeBall() {
  const b = newBall(G.paddle.x, PADDLE_Y - BALL_R - 1, 0, true);
  G.balls = [b];
  G.state = "serve";
}

function serve() {
  const b = G.balls.find(bl => bl.stuck);
  if (!b) return;
  // slight angle variance around vertical, biased by where it sits on the paddle
  const variance = (Math.random() * 2 - 1) * (Math.PI / 14);   // +/- ~13 deg
  const bias = clamp(b.stuckOff, -1, 1) * (Math.PI / 10);
  const angle = clamp(variance + bias, -MAX_BOUNCE_ANGLE, MAX_BOUNCE_ANGLE);
  const sp = targetSpeed();
  b.vx = Math.sin(angle) * sp;
  b.vy = -Math.cos(angle) * sp;
  enforceMinVertical(b);
  b.stuck = false;
  G.state = "play";
  sfx.serve();
}

// ---------------------------------------------------------------------------
// collisions

// circle vs rect: returns "x" | "y" | null, resolving the hit side by
// comparing penetration depths so edge hits bounce on the correct axis.
function circleRectSide(b, r) {
  const cx = clamp(b.x, r.x, r.x + r.w);
  const cy = clamp(b.y, r.y, r.y + r.h);
  const dx = b.x - cx, dy = b.y - cy;
  if (dx * dx + dy * dy > b.r * b.r) return null;
  const rcx = r.x + r.w / 2, rcy = r.y + r.h / 2;
  const penX = (b.r + r.w / 2) - Math.abs(b.x - rcx);
  const penY = (b.r + r.h / 2) - Math.abs(b.y - rcy);
  return penX < penY ? "x" : "y";
}

function bounceOffBrick(b, brick, side) {
  if (side === "x") {
    b.vx = Math.sign(b.x - (brick.x + brick.w / 2)) * Math.abs(b.vx) || -b.vx;
    b.x = b.x < brick.x + brick.w / 2 ? brick.x - b.r : brick.x + brick.w + b.r;
  } else {
    b.vy = Math.sign(b.y - (brick.y + brick.h / 2)) * Math.abs(b.vy) || -b.vy;
    b.y = b.y < brick.y + brick.h / 2 ? brick.y - b.r : brick.y + brick.h + b.r;
  }
  enforceMinVertical(b);
}

function hitBrick(brick) {
  brick.hp--;
  G.hitCount++;
  // ramp: hit-count thresholds bump every ball's speed
  while (G.rampLevel < RAMP_THRESHOLDS.length && G.hitCount >= RAMP_THRESHOLDS[G.rampLevel]) {
    G.rampLevel++;
  }
  // first contact with the top two brick rows: permanent (per-level) boost
  if (!G.topRowsTouched && brick.row < 2) {
    G.topRowsTouched = true;
    G.flash = 0.25;
  }
  if (brick.hp <= 0) {
    brick.alive = false;
    const rowsBonus = (MAX_ROWS - brick.row) * 5;
    G.score += 10 + 20 * (brick.maxHp - 1) + rowsBonus;
    spawnShatter(brick);
    G.shake = Math.min(G.shake + 3.5, 9);
    sfx.brickBreak(brick.row);
    if (brick.power) {
      G.powers.push({
        kind: brick.power,
        x: brick.x + brick.w / 2, y: brick.y + brick.h / 2,
        py: brick.y + brick.h / 2,
        vy: POWER_FALL,
      });
    }
  } else {
    G.score += 5;
    spawnChips(brick, 4);
    G.shake = Math.min(G.shake + 1.2, 9);
    sfx.brickHit(brick.row);
  }
  updateHud();
}

// ---------------------------------------------------------------------------
// particles

function brickColor(brick) {
  return ROW_COLORS[brick.row % ROW_COLORS.length];
}

function spawnChips(brick, n) {
  const col = brickColor(brick);
  for (let i = 0; i < n; i++) {
    G.particles.push({
      x: brick.x + Math.random() * brick.w,
      y: brick.y + Math.random() * brick.h,
      vx: (Math.random() - 0.5) * 160,
      vy: (Math.random() - 0.7) * 160,
      size: 2 + Math.random() * 2,
      life: 0.35 + Math.random() * 0.2,
      t: 0, col,
    });
  }
}

function spawnShatter(brick) {
  const col = brickColor(brick);
  for (let i = 0; i < 14; i++) {
    G.particles.push({
      x: brick.x + Math.random() * brick.w,
      y: brick.y + Math.random() * brick.h,
      vx: (Math.random() - 0.5) * 320,
      vy: (Math.random() - 0.6) * 300,
      size: 2 + Math.random() * 3.5,
      life: 0.5 + Math.random() * 0.35,
      t: 0, col,
    });
  }
}

// ---------------------------------------------------------------------------
// power-ups

function applyPower(kind) {
  G.score += 50;
  sfx.power();
  if (kind === "wide") {
    G.paddle.targetW = PADDLE_W_WIDE;
    G.paddle.wideTimer = WIDE_TIME;
  } else if (kind === "slow") {
    G.slowTimer = SLOW_TIME;
    for (const b of G.balls) normalizeSpeed(b);
  } else if (kind === "multi") {
    const src = G.balls.filter(b => !b.stuck);
    const base = src[0] || G.balls[0];
    if (!base) return;
    const baseAngle = Math.atan2(base.vx, -base.vy);
    for (const da of [-Math.PI / 6, Math.PI / 6]) {
      if (G.balls.length >= MAX_BALLS) break;
      const nb = newBall(base.x, base.y, clamp(baseAngle + da, -MAX_BOUNCE_ANGLE * 1.2, MAX_BOUNCE_ANGLE * 1.2), false);
      nb.vy = base.stuck ? -Math.abs(nb.vy) : Math.sign(base.vy || -1) * Math.abs(nb.vy);
      enforceMinVertical(nb);
      G.balls.push(nb);
    }
  }
  updateHud();
}

// ---------------------------------------------------------------------------
// simulation step (fixed dt)

function step(dt) {
  G.time += dt;
  const P = G.paddle;
  P.px = P.x;

  // timers
  if (P.wideTimer > 0) {
    P.wideTimer -= dt;
    if (P.wideTimer <= 0) P.targetW = PADDLE_W;
  }
  if (G.slowTimer > 0) {
    G.slowTimer -= dt;
    if (G.slowTimer <= 0) for (const b of G.balls) normalizeSpeed(b);
  }
  // paddle width eases toward target
  P.w += (P.targetW - P.w) * Math.min(1, dt * 10);

  // paddle movement
  if (input.mouseX !== null) {
    P.x = input.mouseX;
    input.mouseX = null;                 // mouse sets position once per event
  }
  if (input.left) P.x -= PADDLE_SPEED * dt;
  if (input.right) P.x += PADDLE_SPEED * dt;
  P.x = clamp(P.x, P.w / 2, W - P.w / 2);

  if (G.state === "clear") {
    G.clearTimer -= dt;
    if (G.clearTimer <= 0) {
      G.level++;
      startLevel();
    }
  }

  // balls
  const paddleRect = { x: P.x - P.w / 2, y: PADDLE_Y - PADDLE_H / 2, w: P.w, h: PADDLE_H };
  for (let bi = G.balls.length - 1; bi >= 0; bi--) {
    const b = G.balls[bi];
    b.px = b.x; b.py = b.y;

    if (b.stuck) {
      b.x = clamp(P.x + b.stuckOff * (P.w / 2), b.r, W - b.r);
      b.y = PADDLE_Y - PADDLE_H / 2 - b.r - 1;
      continue;
    }

    normalizeSpeed(b);

    // sub-step so a fast ball can't tunnel through a 16px brick
    const dist = Math.hypot(b.vx, b.vy) * dt;
    const steps = Math.max(1, Math.ceil(dist / (b.r * 0.6)));
    const sdt = dt / steps;

    for (let s = 0; s < steps; s++) {
      b.x += b.vx * sdt;
      b.y += b.vy * sdt;

      // walls
      if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx); sfx.wall(); }
      else if (b.x > W - b.r) { b.x = W - b.r; b.vx = -Math.abs(b.vx); sfx.wall(); }
      if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy); sfx.wall(); }

      // paddle — positional bounce, only while the ball descends
      if (b.vy > 0 && circleRectSide(b, paddleRect)) {
        const off = clamp((b.x - P.x) / (P.w / 2), -1, 1);
        // tiny jitter so a dead-center return can't lock into a vertical loop
        const jitter = (Math.random() * 2 - 1) * 0.026; // ~±1.5 deg
        const angle = clamp(off * MAX_BOUNCE_ANGLE + jitter, -MAX_BOUNCE_ANGLE, MAX_BOUNCE_ANGLE);
        const sp = targetSpeed();
        b.vx = Math.sin(angle) * sp;
        b.vy = -Math.cos(angle) * sp;
        enforceMinVertical(b);
        b.y = paddleRect.y - b.r - 0.5;
        sfx.paddle(off);
      }

      // bricks — nearest-first so a corner hit resolves against the right one
      let hit = null, hitSide = null, hitD = Infinity;
      for (const brick of G.bricks) {
        if (!brick.alive) continue;
        if (b.x + b.r < brick.x || b.x - b.r > brick.x + brick.w ||
            b.y + b.r < brick.y || b.y - b.r > brick.y + brick.h) continue;
        const side = circleRectSide(b, brick);
        if (!side) continue;
        const d = Math.hypot(b.x - (brick.x + brick.w / 2), b.y - (brick.y + brick.h / 2));
        if (d < hitD) { hitD = d; hit = brick; hitSide = side; }
      }
      if (hit) {
        bounceOffBrick(b, hit, hitSide);
        hitBrick(hit);
        normalizeSpeed(b);   // ramp may have just bumped the target
      }

      // floor
      if (b.y > H + b.r * 2) {
        G.balls.splice(bi, 1);
        break;
      }
    }
  }

  // all balls gone → lose a life
  if (G.state === "play" && G.balls.length === 0) {
    G.lives--;
    G.shake = 8;
    updateHud();
    if (G.lives <= 0) {
      gameOver();
    } else {
      sfx.lose();
      G.hitCount = 0;
      G.rampLevel = 0;
      G.slowTimer = 0;
      attachServeBall();
    }
  }

  // level cleared?
  if (G.state === "play" && !G.bricks.some(br => br.alive)) {
    G.state = "clear";
    G.clearTimer = 1.4;
    sfx.clear();
  }

  // falling power-ups
  for (let i = G.powers.length - 1; i >= 0; i--) {
    const p = G.powers[i];
    p.py = p.y;
    p.y += p.vy * dt;
    const caught =
      p.y + POWER_H / 2 >= paddleRect.y &&
      p.y - POWER_H / 2 <= paddleRect.y + paddleRect.h + 6 &&
      p.x + POWER_W / 2 >= paddleRect.x &&
      p.x - POWER_W / 2 <= paddleRect.x + paddleRect.w;
    if (caught) {
      applyPower(p.kind);
      G.powers.splice(i, 1);
    } else if (p.y > H + POWER_H) {
      G.powers.splice(i, 1);
    }
  }

  // particles
  for (let i = G.particles.length - 1; i >= 0; i--) {
    const p = G.particles[i];
    p.t += dt;
    if (p.t >= p.life) { G.particles.splice(i, 1); continue; }
    p.vy += 620 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }

  // decay juice
  G.shake = Math.max(0, G.shake - dt * 22);
  G.flash = Math.max(0, G.flash - dt);
}

// ---------------------------------------------------------------------------
// flow

function startLevel() {
  G.bricks = buildLevel(G.level);
  G.powers = [];
  G.hitCount = 0;
  G.rampLevel = 0;
  G.topRowsTouched = false;
  G.slowTimer = 0;
  G.paddle.targetW = PADDLE_W;
  G.paddle.wideTimer = 0;
  attachServeBall();
  updateHud();
}

function newGame() {
  G.score = 0;
  G.level = 1;
  G.lives = START_LIVES;
  G.particles = [];
  G.paddle.x = G.paddle.px = W / 2;
  G.paddle.w = PADDLE_W;
  startLevel();
  hideOverlay();
}

function gameOver() {
  G.state = "gameover";
  sfx.over();
  if (G.score > G.hiscore) {
    G.hiscore = G.score;
    localStorage.setItem(LS_HISCORE, String(G.hiscore));
  }
  updateHud();
  showOverlay("GAME OVER",
    `score ${G.score}` + (G.score >= G.hiscore && G.score > 0 ? " — new high score!" : ` · high ${G.hiscore}`),
    "click or press <b>Space</b> to play again");
}

function showOverlay(title, sub, action) {
  titleEl.textContent = title;
  subEl.textContent = sub;
  actionEl.innerHTML = action;
  overlayEl.classList.remove("hidden");
}
function hideOverlay() { overlayEl.classList.add("hidden"); }

function updateHud() {
  hudScore.textContent = G.score;
  hudHiscore.textContent = G.hiscore;
  hudLevel.textContent = G.level;
  hudLives.textContent = "●".repeat(Math.max(0, G.lives)) || "–";
}

function setPaused(p) {
  if (G.state !== "play" && G.state !== "serve" && G.state !== "clear") return;
  if (p === G.paused) return;
  G.paused = p;
  if (p) showOverlay("PAUSED", "the storm holds its breath", "press <b>P</b> or click to resume");
  else hideOverlay();
}

// ---------------------------------------------------------------------------
// input

function primaryAction() {
  audio.ensure();
  if (G.state === "title" || G.state === "gameover") { newGame(); return; }
  if (G.paused) { setPaused(false); return; }
  if (G.state === "serve") serve();
}

document.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  switch (e.code) {
    case "ArrowLeft": case "KeyA": input.left = true; break;
    case "ArrowRight": case "KeyD": input.right = true; break;
    case "Space": case "ArrowUp": case "KeyW":
      e.preventDefault();
      primaryAction();
      break;
    case "KeyP": case "Escape":
      audio.ensure();
      if (G.state === "play" || G.state === "serve" || G.state === "clear") setPaused(!G.paused);
      break;
    case "KeyM": toggleAudio(); break;
  }
});
document.addEventListener("keyup", (e) => {
  switch (e.code) {
    case "ArrowLeft": case "KeyA": input.left = false; break;
    case "ArrowRight": case "KeyD": input.right = false; break;
  }
});

canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  input.mouseX = ((e.clientX - rect.left) / rect.width) * W;
});
overlayEl.addEventListener("mousedown", primaryAction);
canvas.addEventListener("mousedown", primaryAction);

canvas.addEventListener("touchmove", (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  input.mouseX = ((e.touches[0].clientX - rect.left) / rect.width) * W;
}, { passive: false });
canvas.addEventListener("touchstart", (e) => { e.preventDefault(); primaryAction(); }, { passive: false });
overlayEl.addEventListener("touchstart", (e) => { e.preventDefault(); primaryAction(); }, { passive: false });

window.addEventListener("blur", () => setPaused(true));

function toggleAudio() {
  audio.on = !audio.on;
  localStorage.setItem(LS_AUDIO, audio.on ? "1" : "0");
  audioBtn.textContent = audio.on ? "SND ON" : "SND OFF";
  audioBtn.classList.toggle("off", !audio.on);
  if (audio.on) { audio.ensure(); audio.blip(660, 0.05, "triangle", 0.12); }
}
audioBtn.addEventListener("click", (e) => { e.stopPropagation(); audio.ensure(); toggleAudio(); });
audioBtn.textContent = audio.on ? "SND ON" : "SND OFF";
audioBtn.classList.toggle("off", !audio.on);

// ---------------------------------------------------------------------------
// rendering

const dpr = Math.min(2, window.devicePixelRatio || 1);
canvas.width = W * dpr;
canvas.height = H * dpr;

const POWER_STYLE = {
  wide: { col: "#58b4ff", label: "W" },
  multi: { col: "#ff7ab8", label: "M" },
  slow: { col: "#7ee787", label: "S" },
};

function drawBrick(brick) {
  const col = brickColor(brick);
  const x = brick.x + 1, y = brick.y + 1, w = brick.w - 2, h = brick.h - 2;
  ctx.fillStyle = col;
  ctx.globalAlpha = brick.hp >= brick.maxHp ? 1 : brick.hp === 2 ? 0.85 : 0.7;
  ctx.fillRect(x, y, w, h);
  // bevel
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, w, 2);
  ctx.fillStyle = "#000000";
  ctx.fillRect(x, y + h - 2, w, 2);
  ctx.globalAlpha = 1;
  // multi-hit cracks
  if (brick.maxHp > 1 && brick.hp < brick.maxHp) {
    ctx.strokeStyle = "rgba(10,12,15,0.75)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.25, y + 1);
    ctx.lineTo(x + w * 0.45, y + h * 0.55);
    ctx.lineTo(x + w * 0.3, y + h - 1);
    if (brick.hp === 1 && brick.maxHp === 3) {
      ctx.moveTo(x + w * 0.7, y + 1);
      ctx.lineTo(x + w * 0.6, y + h * 0.5);
      ctx.lineTo(x + w * 0.78, y + h - 1);
    }
    ctx.stroke();
  }
  // power-up mark: a small diamond
  if (brick.power) {
    const cx = brick.x + brick.w / 2, cy = brick.y + brick.h / 2;
    ctx.fillStyle = "rgba(13,15,18,0.85)";
    ctx.beginPath();
    ctx.moveTo(cx, cy - 4);
    ctx.lineTo(cx + 4, cy);
    ctx.lineTo(cx, cy + 4);
    ctx.lineTo(cx - 4, cy);
    ctx.closePath();
    ctx.fill();
  }
}

function render(alpha) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // background
  ctx.fillStyle = "#0a0c0f";
  ctx.fillRect(0, 0, W, H);

  // subtle scan bands
  ctx.fillStyle = "rgba(255,255,255,0.012)";
  for (let y = 0; y < H; y += 8) ctx.fillRect(0, y, W, 4);

  // screen shake
  if (G.shake > 0.1) {
    const a = G.time * 97;
    ctx.translate(Math.sin(a * 1.7) * G.shake, Math.cos(a * 2.3) * G.shake * 0.7);
  }

  // top-row-boost flash
  if (G.flash > 0) {
    ctx.fillStyle = `rgba(255,120,60,${G.flash * 0.5})`;
    ctx.fillRect(0, BRICK_TOP - 4, W, BRICK_H * 2 + 8);
  }

  // bricks
  for (const brick of G.bricks) if (brick.alive) drawBrick(brick);

  // particles
  for (const p of G.particles) {
    ctx.globalAlpha = 1 - p.t / p.life;
    ctx.fillStyle = p.col;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  // power-ups
  for (const p of G.powers) {
    const s = POWER_STYLE[p.kind];
    const y = p.py + (p.y - p.py) * alpha;
    ctx.fillStyle = s.col;
    ctx.beginPath();
    ctx.roundRect(p.x - POWER_W / 2, y - POWER_H / 2, POWER_W, POWER_H, 6);
    ctx.fill();
    ctx.fillStyle = "#0d0f12";
    ctx.font = "bold 10px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(s.label, p.x, y + 0.5);
  }

  // paddle
  const P = G.paddle;
  const px = P.px + (P.x - P.px) * alpha;
  const pw = P.w;
  const grad = ctx.createLinearGradient(px - pw / 2, 0, px + pw / 2, 0);
  grad.addColorStop(0, "#ff8a3c");
  grad.addColorStop(0.5, "#ffd27a");
  grad.addColorStop(1, "#ff8a3c");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(px - pw / 2, PADDLE_Y - PADDLE_H / 2, pw, PADDLE_H, 6);
  ctx.fill();
  if (P.wideTimer > 0 && P.wideTimer < 2 && Math.floor(G.time * 6) % 2 === 0) {
    ctx.strokeStyle = "rgba(88,180,255,0.9)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // balls
  for (const b of G.balls) {
    const bx = b.px + (b.x - b.px) * alpha;
    const by = b.py + (b.y - b.py) * alpha;
    ctx.fillStyle = G.slowTimer > 0 ? "#7ee787" : "#f5f7fa";
    ctx.beginPath();
    ctx.arc(bx, by, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.arc(bx - 2, by - 2, b.r * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }

  // serve hint
  if (G.state === "serve" && !G.paused) {
    ctx.fillStyle = `rgba(232,234,237,${0.5 + 0.4 * Math.sin(G.time * 5)})`;
    ctx.font = "13px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("click / space to serve", W / 2, H - 90);
  }

  // level-clear banner
  if (G.state === "clear") {
    ctx.fillStyle = "#7ee787";
    ctx.font = "bold 26px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(`LEVEL ${G.level} CLEAR`, W / 2, H / 2);
  }
}

// ---------------------------------------------------------------------------
// main loop — accumulator pattern

let last = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let elapsed = (now - last) / 1000;
  last = now;
  if (elapsed > MAX_FRAME) elapsed = MAX_FRAME;

  if (!G.paused && G.state !== "title" && G.state !== "gameover") {
    acc += elapsed;
    while (acc >= DT) {
      step(DT);
      acc -= DT;
    }
  }
  render(G.paused ? 1 : clamp(acc / DT, 0, 1));
}

updateHud();
requestAnimationFrame(frame);

// debug handle (used by the headless smoke test; harmless in the browser)
window.__brickstorm = G;

})();

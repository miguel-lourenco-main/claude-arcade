'use strict';
/*
 * SHARDFIELD — pure simulation logic and tuning constants.
 * Dual-environment: attaches to window.ShardfieldLogic in the browser,
 * module.exports in node (so the logic test suite can run headless).
 * No DOM, no canvas, no audio in this file.
 */
(function () {

// ---------------------------------------------------------------- constants

const W = 960, H = 720;                  // field size, px
const DT = 1 / 60;                       // fixed simulation step, seconds

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

// shortest wrapped delta from (ax,ay) to (bx,by) across the torus
function torusDelta(ax, ay, bx, by) {
  let dx = bx - ax; if (dx > W / 2) dx -= W; else if (dx < -W / 2) dx += W;
  let dy = by - ay; if (dy > H / 2) dy -= H; else if (dy < -H / 2) dy += H;
  return [dx, dy];
}

// wrap an entity around the field edges; previous-tick position is shifted
// by the same amount so render interpolation never streaks across the screen
function wrapEntity(e) {
  if (e.x < 0) { e.x += W; e.px += W; }
  else if (e.x >= W) { e.x -= W; e.px -= W; }
  if (e.y < 0) { e.y += H; e.py += H; }
  else if (e.y >= H) { e.y -= H; e.py -= H; }
}

// ---------------------------------------------------------------- factories

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

// bullets spawn at the nose and inherit ship velocity plus fixed muzzle speed
function makeBullet(sh) {
  const cos = Math.cos(sh.a), sin = Math.sin(sh.a);
  return {
    x: sh.x + cos * 16, y: sh.y + sin * 16,
    px: sh.x + cos * 16, py: sh.y + sin * 16,
    vx: sh.vx + cos * MUZZLE,
    vy: sh.vy + sin * MUZZLE,
    t: BULLET_LIFE,
  };
}

// ------------------------------------------------------------------- tuning

// chance the next saucer is the small aimed one, rising with score
function smallSaucerProb(score) {
  return score < 3000 ? 0.12 : Math.min(0.9, 0.2 + score / 25000);
}

// the small saucer's aim error cone (radians), tightening as score climbs
function smallSaucerAimError(score) {
  return Math.max(0.05, 0.55 - 0.5 * Math.min(1, score / 35000));
}

// large shards per wave: 4, 6, 8, ... capped at 12
function waveShardCount(wave) {
  return Math.min(4 + (wave - 1) * 2, 12);
}

// two-tone heartbeat period: accelerates as the field thins and time passes
function heartbeatInterval(weightFrac, waveTime) {
  let interval = 0.3 + 0.75 * clamp(weightFrac, 0, 1);
  interval -= Math.min(0.12, waveTime * 0.004);
  return clamp(interval, 0.24, 1.05);
}

// is the spawn-safe zone around the field center clear?
function isCenterSafe(shards, saucer, ebullets) {
  for (const s of shards) {
    if (dist2(s.x, s.y, W / 2, H / 2) < (SAFE_RADIUS + s.cr) ** 2) return false;
  }
  if (saucer && dist2(saucer.x, saucer.y, W / 2, H / 2) < (SAFE_RADIUS + 60) ** 2) return false;
  for (const b of ebullets) {
    if (dist2(b.x, b.y, W / 2, H / 2) < (SAFE_RADIUS * 0.85) ** 2) return false;
  }
  return true;
}

// ------------------------------------------------------------------ exports

const api = {
  W, H, DT,
  SHIP, MUZZLE, BULLET_LIFE, MAX_BULLETS,
  SIZES, SAUCER, SAUCER_SHOT_LIFE,
  SAFE_RADIUS, EXTRA_LIFE_EVERY, START_LIVES,
  rand, irand, clamp, lerp, dist2, torusDelta, wrapEntity,
  makeShard, makeBullet,
  smallSaucerProb, smallSaucerAimError, waveShardCount, heartbeatInterval,
  isCenterSafe,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.ShardfieldLogic = api;

})();

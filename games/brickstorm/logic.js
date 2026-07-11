"use strict";
/* Brickstorm pure logic — level generation, collision math, speed model.
 * Dual-environment: attaches to window.BrickstormLogic in the browser
 * (classic <script>, loaded before game.js), module.exports in node
 * (used by test/logic.test.js). No DOM, no side effects.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BrickstormLogic = api;
})(typeof self !== "undefined" ? self : this, function () {

  // -------------------------------------------------------------------------
  // constants

  const constants = {
    W: 480, H: 640,

    PADDLE_W: 76,
    PADDLE_W_WIDE: 124,

    MAX_BOUNCE_ANGLE: Math.PI / 3,   // +/-60 deg from vertical off the paddle
    MIN_VY_FRAC: 0.28,               // minimum |vy|/speed — never near-horizontal

    BASE_SPEED: 285,                 // level-1 serve speed, px/s
    SPEED_PER_LEVEL: 14,
    RAMP_THRESHOLDS: [4, 12, 24, 40],// brick-hit counts that bump speed
    RAMP_STEP: 0.09,                 // each threshold adds +9%
    TOP_ROW_BOOST: 0.14,             // first touch of the top rows adds +14%
    SPEED_CAP: 640,
    SLOW_SCALE: 0.62,

    COLS: 12, BRICK_W: 36, BRICK_H: 16, BRICK_TOP: 72,
    MAX_ROWS: 9,

    WIDE_TIME: 12,                   // seconds
    SLOW_TIME: 8,
    MAX_BALLS: 6,
    START_LIVES: 3,
  };

  const { W, COLS, BRICK_W, BRICK_H, BRICK_TOP, MAX_ROWS,
          BASE_SPEED, SPEED_PER_LEVEL, RAMP_THRESHOLDS, RAMP_STEP,
          TOP_ROW_BOOST, SPEED_CAP, SLOW_SCALE, MIN_VY_FRAC } = constants;

  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // level patterns — each returns hp presence (1/0) for a cell

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

  // -------------------------------------------------------------------------
  // speed model

  // pure form of the ball's target speed
  function ballSpeed(o) {
    let s = (BASE_SPEED + (o.level - 1) * SPEED_PER_LEVEL) * (1 + o.rampLevel * RAMP_STEP);
    if (o.topRowsTouched) s *= 1 + TOP_ROW_BOOST;
    s = Math.min(s, SPEED_CAP);
    if (o.slowed) s *= SLOW_SCALE;
    return s;
  }

  // how many speed-ramp thresholds a brick-hit count has crossed
  function computeRampLevel(hitCount) {
    let r = 0;
    while (r < RAMP_THRESHOLDS.length && hitCount >= RAMP_THRESHOLDS[r]) r++;
    return r;
  }

  // -------------------------------------------------------------------------
  // collision math

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

  return {
    constants, clamp, mulberry32, PATTERNS, buildLevel,
    ballSpeed, computeRampLevel,
    circleRectSide, enforceMinVertical, bounceOffBrick,
  };
});

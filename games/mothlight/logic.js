"use strict";
/* Mothlight pure logic — physics, gap placement, collision, scoring, tilt.
 * Dual-environment: attaches to window.MothlightLogic in the browser
 * (classic <script>, loaded before game.js), module.exports in node
 * (used by test/logic.test.js). No DOM, no side effects.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MothlightLogic = api;
})(typeof self !== "undefined" ? self : this, function () {

  const W = 480, H = 720;
  const GROUND_H = 46;                 // mossy strip along the bottom
  const SKY_H = H - GROUND_H;

  const constants = {
    W, H, GROUND_H, SKY_H,

    DT: 1 / 120,                       // fixed physics timestep (s)

    GRAVITY: 1750,                     // px/s^2
    FLAP_VY: -470,                     // flap SETS vy to this (not additive)
    TERMINAL_VY: 640,                  // max fall speed
    SCROLL: 156,                       // world scroll speed, px/s

    MOTH_X: W * 0.3,                   // moth's fixed screen x
    MOTH_R: 9,                         // collision radius (drawn moth ~3x wider)

    SPACING: 236,                      // fixed horizontal spacing between chains
    GAP_HALF: 84,                      // half-height of the safe gap
    GAP_MARGIN: 60,                    // keep gap centers inside a safe band
    GAP_MAX_STEP: 230,                 // max center shift between neighbours
                                       // (a full-effort climb covers ~215 px/s,
                                       //  chains are 1.51 s apart — keeps every
                                       //  random layout actually reachable)
    CHAIN_HALF_W: 15,                  // collision half-width of a lantern chain

    TILT_UP: -0.42,                    // rad, nose-up right after a flap
    TILT_DOWN: 1.25,                   // rad, nose-dive at terminal velocity

    CEILING_Y: 14,                     // ceiling clamps (no death)
    FLOOR_Y: SKY_H - 6,                // the moss — touching it kills
    RESTART_DELAY_MS: 350,             // input ignored right after game over
  };
  const C = constants;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  // one physics step of gravity, capped at terminal velocity
  function fall(vy, dt) {
    return Math.min(vy + C.GRAVITY * dt, C.TERMINAL_VY);
  }

  // new gap center: random inside the safe band, then clamped so it is
  // always reachable from the previous gap. r is a uniform random in [0,1).
  function chainGapY(prevGapY, r) {
    const lo = C.GAP_MARGIN + C.GAP_HALF;
    const hi = C.SKY_H - C.GAP_MARGIN - C.GAP_HALF;
    let gapY = lo + r * (hi - lo);
    if (prevGapY !== undefined)
      gapY = clamp(gapY, prevGapY - C.GAP_MAX_STEP, prevGapY + C.GAP_MAX_STEP);
    return clamp(gapY, lo, hi);
  }

  // is the moth's collision circle inside this chain's x collision band?
  function inChainBand(chainX, mothX) {
    return Math.abs(chainX - mothX) < C.CHAIN_HALF_W + C.MOTH_R;
  }

  // circle vs the two chain rectangles: does the moth poke out of the gap?
  function hitsChain(mothY, gapY) {
    return mothY - C.MOTH_R < gapY - C.GAP_HALF ||
           mothY + C.MOTH_R > gapY + C.GAP_HALF;
  }

  // a point is awarded the exact tick the chain crosses the moth's x
  function passedGap(chainX, mothX) {
    return chainX <= mothX;
  }

  // rotation target from vy: nose-up right after a flap, easing into a
  // nose-dive as vy approaches terminal velocity
  function tiltTarget(vy) {
    const t = clamp((vy - C.FLAP_VY) / (C.TERMINAL_VY - C.FLAP_VY), 0, 1);
    return lerp(C.TILT_UP, C.TILT_DOWN, t * t);
  }

  return { constants, clamp, lerp, fall, chainGapY,
           inChainBand, hitsChain, passedGap, tiltTarget };
});

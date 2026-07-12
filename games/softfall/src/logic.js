"use strict";
/* Softfall — pure game logic (no DOM, no audio, no rendering).
   Dual-environment: attaches to window.SoftfallLogic in the browser,
   module.exports in node so test/logic.test.js can drive it directly. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SoftfallLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {

  // ---------- constants ----------
  const W = 1200, H = 750;            // logical world size
  const GRAVITY = 24;                 // u/s^2, downward
  const THRUST = 62;                  // u/s^2 along the nose
  const ROT_SPEED = 2.35;             // rad/s, constant angular speed
  const MAX_FUEL = 100;
  const BURN_RATE = 9;                // fuel/s while thrusting
  const SAFE_VX = 14;                 // |horizontal| limit
  const SAFE_VY = 26;                 // downward limit
  const SAFE_ANG = 8 * Math.PI / 180; // ~8 degrees of upright
  const FOOT_X = 12, FOOT_Y = 12;     // leg feet in ship-local coords (y down)

  // ship outline points used for terrain contact (local coords, y down)
  const CONTACT_FEET = [[-FOOT_X, FOOT_Y], [FOOT_X, FOOT_Y]];
  const CONTACT_HULL = [[0, -13], [-8, 5], [8, 5]];

  const SEGS = 128;                   // power of two; SEGS+1 height samples
  const DX = W / SEGS;

  // ---------- helpers ----------
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const wrapX = (x) => ((x % W) + W) % W;
  const normAng = (a) => {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  };
  const rand = (a, b, rng) => a + (rng || Math.random)() * (b - a);

  // ---------- terrain ----------
  /** Midpoint-displacement heightline + flat multiplier pads.
      `rng` is a 0..1 random source (Math.random by default) so tests can seed it.
      Returns { heights: Float64Array(SEGS+1), pads: [{x0,x1,y,mult}] }. */
  function genTerrain(rng) {
    rng = rng || Math.random;
    const heights = new Float64Array(SEGS + 1);

    // wrap-consistent (last == first) so the horizontal world wrap never
    // teleports the ship into a cliff face
    heights[0] = heights[SEGS] = rand(H * 0.6, H * 0.82, rng);
    let step = SEGS, amp = H * 0.26;
    while (step > 1) {
      const half = step / 2;
      for (let i = half; i < SEGS; i += step) {
        heights[i] = (heights[i - half] + heights[i + half]) / 2 + rand(-amp, amp, rng);
      }
      step = half;
      amp *= 0.55;
    }
    for (let i = 0; i <= SEGS; i++) heights[i] = clamp(heights[i], H * 0.34, H * 0.94);

    // pads: widths in cells; smaller pad => bigger multiplier
    const pool = [
      { mult: 1, cells: 14 },
      { mult: 2, cells: 10 },
      { mult: 2, cells: 10 },
      { mult: 3, cells: 7 },
      { mult: 3, cells: 7 },
      { mult: 4, cells: 5 },
      { mult: 5, cells: 4 },
    ];
    // guaranteed easy pad + 3 random harder picks
    const picks = [pool[rng() < 0.5 ? 0 : 1]];
    const hard = pool.slice(2);
    for (let n = 0; n < 3; n++) picks.push(hard[Math.floor(rng() * hard.length)]);

    const pads = [];
    const used = []; // occupied [start,end] cell ranges
    for (const p of picks) {
      for (let attempt = 0; attempt < 60; attempt++) {
        const i0 = 2 + Math.floor(rng() * (SEGS - p.cells - 4));
        const i1 = i0 + p.cells;
        if (used.some(([a, b]) => i0 < b + 5 && i1 > a - 5)) continue;
        let sum = 0;
        for (let i = i0; i <= i1; i++) sum += heights[i];
        const y = clamp(sum / (p.cells + 1), H * 0.42, H * 0.92);
        for (let i = i0; i <= i1; i++) heights[i] = y;
        used.push([i0, i1]);
        pads.push({ x0: i0 * DX, x1: i1 * DX, y, mult: p.mult });
        break;
      }
    }
    pads.sort((a, b) => a.x0 - b.x0);
    return { heights, pads };
  }

  function terrainY(heights, x) {
    x = wrapX(x);
    const f = x / DX;
    const i = Math.floor(f);
    const t = f - i;
    return heights[i] + (heights[Math.min(i + 1, SEGS)] - heights[i]) * t;
  }

  function padAt(pads, x) {
    x = wrapX(x);
    for (const p of pads) if (x >= p.x0 && x <= p.x1) return p;
    return null;
  }

  // ---------- ship physics ----------
  /** One fixed-timestep integration of the ship: rotation, gravity, thrust
      (burning fuel), position update with horizontal wrap and the soft
      ceiling. Mutates `ship`; returns whether the engine fired this tick. */
  function stepShip(ship, keys, dt) {
    // rotation: constant angular speed
    const rot = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    ship.angle += ROT_SPEED * rot * dt;

    // gravity every tick
    ship.vy += GRAVITY * dt;

    // thrust: acceleration along the ship's nose while fuel burns
    const thrusting = !!keys.thrust && ship.fuel > 0;
    if (thrusting) {
      ship.vx += Math.sin(ship.angle) * THRUST * dt;
      ship.vy -= Math.cos(ship.angle) * THRUST * dt;
      ship.fuel = Math.max(0, ship.fuel - BURN_RATE * dt);
    }

    ship.x = wrapX(ship.x + ship.vx * dt);
    ship.y += ship.vy * dt;
    if (ship.y < -160) ship.y = -160; // soft ceiling far above the screen

    return thrusting;
  }

  // ---------- contact & landing ----------
  /** Ship-local contact points transformed by the ship's rotation. */
  function contactPoints(ship) {
    const s = Math.sin(ship.angle), c = Math.cos(ship.angle);
    const tf = ([lx, ly]) => [ship.x + lx * c - ly * s, ship.y + lx * s + ly * c];
    return { feet: CONTACT_FEET.map(tf), hull: CONTACT_HULL.map(tf) };
  }

  /** Classify the ship against the terrain this tick:
      { type: "none" } | { type: "crash", cause } | { type: "land", pad }. */
  function evaluateLanding(ship, heights, pads) {
    const { feet, hull } = contactPoints(ship);

    // any hull point in the ground is always a crash
    for (const [px, py] of hull) {
      if (py >= terrainY(heights, px)) return { type: "crash", cause: "hull impact" };
    }

    const touching = feet.filter(([px, py]) => py >= terrainY(heights, px));
    if (touching.length === 0) return { type: "none" };

    const ang = normAng(ship.angle);
    const padL = padAt(pads, feet[0][0]);
    const padR = padAt(pads, feet[1][0]);

    if (!padL || padL !== padR) return { type: "crash", cause: "rough ground" };
    if (Math.abs(ang) > SAFE_ANG) return { type: "crash", cause: "came in tilted" };
    if (Math.abs(ship.vx) > SAFE_VX) return { type: "crash", cause: "too fast sideways" };
    if (ship.vy > SAFE_VY) return { type: "crash", cause: "came down too hard" };
    if (ship.vy < 0) return { type: "none" }; // moving up while grazing: not a landing

    return { type: "land", pad: padL };
  }

  // ---------- scoring ----------
  const landingPoints = (mult, fuel) => mult * (100 + Math.round(fuel));
  const refuelAmount = (landings) =>
    Math.max(10, Math.round(65 * Math.pow(0.72, landings - 1)));

  return {
    W, H, GRAVITY, THRUST, ROT_SPEED, MAX_FUEL, BURN_RATE,
    SAFE_VX, SAFE_VY, SAFE_ANG, FOOT_X, FOOT_Y,
    CONTACT_FEET, CONTACT_HULL, SEGS, DX,
    clamp, lerp, wrapX, normAng, rand,
    genTerrain, terrainY, padAt,
    stepShip, contactPoints, evaluateLanding,
    landingPoints, refuelAmount,
  };
});

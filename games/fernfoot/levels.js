"use strict";

/* ================= Fernfoot — the six levels =================
 * Handcrafted layouts, expressed through a tiny grid builder so the
 * geometry is hand-placed but typo-proof. Dual-environment module.
 *
 * Legend: # solid  = one-way  % cracked  $ cracked(sparks)  & cracked(seed)
 *         ^ spikes  * spark  E emberseed  G gustfruit  C checkpoint
 *         W waystone  P start  p plodder  l lunger  s spinner  t spitter
 */
(function (root, factory) {
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = factory();
  } else {
    root.FernfootLevels = factory();
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  const H = 18;

  function mk(w) {
    return Array.from({ length: H }, () => Array(w).fill("."));
  }
  function put(g, x, y, ch) { g[y][x] = ch; }
  function fill(g, x0, y0, x1, y1, ch) {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) g[y][x] = ch;
  }
  function hline(g, x0, x1, y, ch) { fill(g, x0, y, x1, y, ch); }
  function sparks(g, pts) { for (const [x, y] of pts) put(g, x, y, "*"); }
  function rows(g) { return g.map((r) => r.join("")); }

  // ---- 1 · First Steps (glade) — movement, jumping, stomping -------------------
  function level1() {
    const W = 100, g = mk(W);
    fill(g, 0, 14, W - 1, 17, "#");          // ground
    fill(g, 30, 14, 32, 17, ".");            // walk-jump pit
    fill(g, 56, 14, 60, 17, ".");            // running-jump pit
    hline(g, 18, 20, 13, "#");               // low step
    fill(g, 36, 12, 38, 13, "#");            // taller step
    hline(g, 44, 47, 10, "#");               // floating ledge
    fill(g, 70, 11, 71, 13, "#");            // 3-high wall: full jump
    // secret: a canopy shelf reached by jumping left off the low step
    hline(g, 13, 16, 9, "#");
    sparks(g, [[13, 8], [14, 8], [15, 8], [16, 8]]);
    // spark trails
    sparks(g, [[6, 13], [7, 13], [8, 13], [10, 13], [11, 13]]);
    sparks(g, [[30, 11], [31, 10], [32, 11]]);
    sparks(g, [[44, 9], [45, 9], [46, 9], [47, 9]]);
    sparks(g, [[56, 11], [57, 10], [58, 10], [59, 10], [60, 11]]);
    sparks(g, [[74, 13], [75, 13], [76, 13], [77, 13]]);
    sparks(g, [[86, 13], [88, 13], [90, 13]]);
    put(g, 24, 13, "p");
    put(g, 50, 13, "p");
    put(g, 80, 13, "p");
    put(g, 2, 13, "P");
    put(g, 96, 13, "W");
    return { name: "First Steps", theme: "glade", rows: rows(g), movers: [] };
  }

  // ---- 2 · Canopy Rise (glade) — one-ways, drop-through, checkpoints ------------
  function level2() {
    const W = 110, g = mk(W);
    fill(g, 0, 14, W - 1, 17, "#");
    fill(g, 40, 14, 44, 17, ".");            // pit bridged by a one-way
    fill(g, 78, 14, 83, 17, ".");            // wide pit with a one-way step
    // climbing one-ways at the start
    hline(g, 12, 16, 11, "=");
    hline(g, 18, 22, 8, "=");
    hline(g, 10, 14, 5, "=");
    sparks(g, [[10, 4], [11, 4], [12, 4], [13, 4], [14, 4]]);
    sparks(g, [[18, 7], [20, 7], [22, 7]]);
    // teach drop-through: sparks tucked under a one-way shelf
    hline(g, 26, 32, 11, "=");
    sparks(g, [[27, 13], [29, 13], [31, 13]]);
    sparks(g, [[27, 10], [29, 10], [31, 10]]);
    // one-way bridge over the first pit
    hline(g, 39, 45, 12, "=");
    sparks(g, [[41, 11], [42, 11], [43, 11]]);
    put(g, 50, 13, "C");
    // secret: high one-way route to a spark cache
    hline(g, 56, 59, 7, "=");
    hline(g, 63, 66, 5, "=");
    sparks(g, [[63, 4], [64, 4], [65, 4], [66, 4], [68, 4], [69, 4]]);
    hline(g, 68, 70, 5, "=");
    // ground stretch with a spinner overhead
    put(g, 60, 10, "s");
    sparks(g, [[58, 13], [60, 13], [62, 13]]);
    // one-way step across the wide pit
    hline(g, 79, 82, 10, "=");
    sparks(g, [[80, 9], [81, 9]]);
    put(g, 88, 13, "C");
    sparks(g, [[92, 13], [94, 13], [96, 13], [98, 13]]);
    put(g, 35, 13, "p");
    put(g, 70, 13, "p");
    put(g, 93, 13, "p");
    put(g, 2, 13, "P");
    put(g, 106, 13, "W");
    return { name: "Canopy Rise", theme: "glade", rows: rows(g), movers: [] };
  }

  // ---- 3 · Ruin Gate (caverns) — emberseed, cracked blocks, lungers --------------
  function level3() {
    const W = 110, g = mk(W);
    fill(g, 0, 14, W - 1, 17, "#");
    put(g, 14, 12, "E");                     // the emberseed, plain sight
    sparks(g, [[6, 13], [8, 13], [10, 13]]);
    put(g, 20, 13, "p");
    // cracked-cache ceiling corridor
    hline(g, 28, 42, 10, "#");
    put(g, 30, 10, "$");
    put(g, 34, 10, "$");
    put(g, 38, 10, "$");
    put(g, 36, 10, "&");                     // hidden spare seed
    sparks(g, [[29, 13], [33, 13], [37, 13], [41, 13]]);
    put(g, 34, 13, "l");
    // the gate: low corridor whose cracked ceiling is the way up and over
    hline(g, 44, 58, 10, "#");
    fill(g, 52, 10, 54, 10, "%");
    fill(g, 58, 11, 58, 13, "#");            // dead-end wall
    sparks(g, [[46, 13], [48, 13], [50, 13]]);
    // roof road on top of the corridor
    hline(g, 59, 70, 10, "#");
    put(g, 62, 9, "C");
    sparks(g, [[64, 9], [66, 9], [68, 9]]);
    // spike hop after dropping back down
    hline(g, 74, 76, 13, "^");
    fill(g, 75, 11, 75, 11, "#");
    sparks(g, [[75, 10]]);
    put(g, 66, 13, "l");
    // secret: high vault over the corridor
    hline(g, 30, 33, 6, "#");
    sparks(g, [[30, 5], [31, 5], [32, 5], [33, 5]]);
    // final stretch
    put(g, 84, 13, "l");
    sparks(g, [[88, 13], [90, 13], [92, 13], [94, 13]]);
    hline(g, 96, 98, 13, "^");
    hline(g, 96, 98, 12, "=");
    put(g, 2, 13, "P");
    put(g, 106, 13, "W");
    return { name: "Ruin Gate", theme: "ruin", rows: rows(g), movers: [] };
  }

  // ---- 4 · Gust Hollow (caverns) — gustfruit double jump, spitters ----------------
  function level4() {
    const W = 110, g = mk(W);
    fill(g, 0, 14, W - 1, 17, "#");
    put(g, 12, 12, "G");                     // the gustfruit
    sparks(g, [[5, 13], [7, 13], [9, 13]]);
    fill(g, 20, 9, 21, 13, "#");             // 5-high wall: double jump
    sparks(g, [[20, 8], [21, 8]]);
    fill(g, 30, 14, 38, 17, ".");            // 9-wide pit: run + double
    sparks(g, [[32, 10], [34, 9], [36, 10]]);
    put(g, 44, 13, "p");
    put(g, 48, 13, "t");                     // first spitter
    put(g, 52, 13, "C");
    // spike run with a one-way refuge
    hline(g, 60, 64, 13, "^");
    hline(g, 59, 66, 10, "=");
    sparks(g, [[61, 9], [63, 9]]);
    put(g, 58, 8, "s");
    put(g, 72, 13, "t");
    put(g, 80, 12, "G");                     // spare fruit
    // secret: drop-through cellar
    hline(g, 92, 93, 14, "=");               // trapdoor in the ground
    fill(g, 90, 15, 96, 16, ".");            // carved cellar
    sparks(g, [[91, 16], [92, 16], [93, 16], [94, 16], [95, 16]]);
    sparks(g, [[86, 13], [88, 13]]);
    put(g, 98, 13, "C");
    put(g, 2, 13, "P");
    put(g, 106, 13, "W");
    return { name: "Gust Hollow", theme: "ruin", rows: rows(g), movers: [] };
  }

  // ---- 5 · Fern Deep (glade) — movers, everything so far ---------------------------
  function level5() {
    const W = 130, g = mk(W);
    fill(g, 0, 14, W - 1, 17, "#");
    sparks(g, [[6, 13], [8, 13], [10, 13]]);
    // secret left tower
    fill(g, 12, 11, 13, 13, "#");
    hline(g, 8, 10, 9, "#");
    hline(g, 4, 6, 7, "#");
    sparks(g, [[4, 6], [5, 6], [6, 6]]);
    put(g, 18, 13, "p");
    // spinner gauntlet over one-ways
    hline(g, 24, 28, 11, "=");
    hline(g, 32, 36, 9, "=");
    put(g, 30, 9, "s");
    sparks(g, [[25, 10], [27, 10], [33, 8], [35, 8]]);
    put(g, 40, 12, "E");
    // cracked cache ceiling
    hline(g, 43, 48, 9, "#");
    put(g, 44, 9, "$");
    put(g, 47, 9, "$");
    put(g, 50, 13, "C");
    // the mover crossing
    fill(g, 56, 14, 70, 17, ".");
    sparks(g, [[60, 10], [63, 10], [66, 10]]);
    put(g, 74, 13, "p");
    // lunger hall under a low ceiling
    hline(g, 80, 92, 10, "#");
    put(g, 84, 13, "l");
    sparks(g, [[82, 13], [86, 13], [90, 13]]);
    put(g, 90, 13, "C");
    // spike-and-spinner finale
    hline(g, 96, 99, 13, "^");
    hline(g, 95, 100, 10, "=");
    put(g, 100, 8, "s");
    put(g, 108, 13, "t");
    sparks(g, [[103, 13], [105, 13], [113, 13], [115, 13]]);
    put(g, 118, 13, "p");
    put(g, 2, 13, "P");
    put(g, 126, 13, "W");
    return {
      name: "Fern Deep", theme: "glade", rows: rows(g),
      movers: [
        { x: 57, y: 12, w: 3, axis: "x", range: 2.5, speed: 1.6, phase: 0 },
        { x: 65, y: 12, w: 3, axis: "x", range: 2.5, speed: 1.6, phase: 2 },
      ],
    };
  }

  // ---- 6 · Sunken Keep (caverns) — the full gauntlet ---------------------------------
  function level6() {
    const W = 140, g = mk(W);
    fill(g, 0, 14, W - 1, 17, "#");
    sparks(g, [[5, 13], [7, 13], [9, 13]]);
    put(g, 14, 13, "p");
    put(g, 20, 12, "E");
    // vertical mover over a spike floor
    hline(g, 26, 36, 13, "^");
    sparks(g, [[30, 8], [32, 8]]);
    put(g, 40, 13, "C");
    // low corridor with lunger
    hline(g, 44, 56, 10, "#");
    put(g, 46, 10, "$");
    put(g, 52, 10, "$");
    put(g, 50, 13, "l");
    sparks(g, [[45, 13], [49, 13], [55, 13]]);
    put(g, 60, 13, "t");
    put(g, 70, 12, "G");
    // double-jump wall
    fill(g, 76, 9, 77, 13, "#");
    sparks(g, [[76, 8], [77, 8]]);
    put(g, 82, 8, "s");
    // secret vault through a cracked ceiling
    hline(g, 84, 90, 10, "#");
    fill(g, 86, 10, 87, 10, "%");
    hline(g, 84, 90, 5, "#");
    sparks(g, [[85, 9], [86, 9], [87, 9], [88, 9], [89, 9]]);
    put(g, 88, 10, "$");
    put(g, 88, 13, "l");
    put(g, 95, 13, "C");
    // the long mover pit with a spinner escort
    fill(g, 100, 14, 116, 17, ".");
    put(g, 108, 8, "s");
    sparks(g, [[104, 10], [108, 10], [112, 10]]);
    put(g, 120, 13, "t");
    hline(g, 124, 126, 13, "^");
    hline(g, 123, 127, 11, "=");
    sparks(g, [[125, 10]]);
    put(g, 130, 13, "p");
    put(g, 2, 13, "P");
    put(g, 136, 13, "W");
    return {
      name: "Sunken Keep", theme: "ruin", rows: rows(g),
      movers: [
        { x: 30, y: 11, w: 3, axis: "y", range: 1.8, speed: 1.9, phase: 0 },
        { x: 103, y: 12, w: 3, axis: "x", range: 3, speed: 1.7, phase: 0 },
        { x: 111, y: 12, w: 3, axis: "x", range: 3, speed: 1.7, phase: 2.2 },
      ],
    };
  }

  return { defs: [level1(), level2(), level3(), level4(), level5(), level6()], H };
});

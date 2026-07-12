'use strict';
/*
 * Gemgrove pure logic — board generation, run detection, valid-move search,
 * clear resolution (specials + spawns), gravity compaction, and reshuffle.
 *
 * Dual-environment: attaches to window.GemgroveLogic in the browser and to
 * module.exports under node, so the exact code the game runs is unit-testable.
 */
(function (root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  if (root) root.GemgroveLogic = lib;
})(typeof window !== 'undefined' ? window : null, function () {

const COLS = 8, ROWS = 8, NTYPES = 6;

const key = (r, c) => r * COLS + c;
const kr = (k) => (k / COLS) | 0;
const kc = (k) => k % COLS;
const randType = () => (Math.random() * NTYPES) | 0;

// minimal cell for node tests; the game passes its own richer factory
function defaultCell(t) {
  return {
    t, s: null,
    ox: 0, oy: 0, vy: 0,
    scale: 1, clearing: false,
    spawnGlow: 0,
    pox: 0, poy: 0, pscale: 1,
  };
}

function levelTarget(n) { return 1000 + (n - 1) * 850; }
function levelMoves(n)  { return 20 + Math.floor((n - 1) / 3); }

function isAdjacent(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
}

// horizontal + vertical runs of 3+; intersections merge in resolveClear
function findRuns(grid) {
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

function matchAt(grid, r, c) {
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

function computeValidMoves(grid) {
  const out = [];
  const test = (r1, c1, r2, c2) => {
    const a = grid[r1][c1], b = grid[r2][c2];
    grid[r1][c1] = b; grid[r2][c2] = a;
    const ok = matchAt(grid, r1, c1) || matchAt(grid, r2, c2);
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

// generation: no pre-existing matches AND at least one valid move
function generateBoard(makeCell) {
  makeCell = makeCell || defaultCell;
  let grid, guard = 0;
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
  } while (computeValidMoves(grid).length === 0 && ++guard < 200);
  return grid;
}

// resolve one clear pass: expand the clear set through matched specials
// (crosses add row+column, bursts add 3x3, chaining), then decide where new
// specials forge: 5+ run -> burst, 4 run -> cross, run intersection -> burst.
// Spawns land on the swap site when the player's swap (chain 1) made the run.
function resolveClear(grid, runs, chain, swapSites) {
  const clearSet = new Set();
  const runCount = new Map(); // key -> number of runs touching (intersections)
  for (const run of runs) {
    for (const cl of run.cells) {
      const k = key(cl.r, cl.c);
      clearSet.add(k);
      runCount.set(k, (runCount.get(k) || 0) + 1);
    }
  }

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

  return { clearSet, spawns, crossFired, burstFired };
}

// gravity-drop columns (nulls are holes), then refill from the top.
// Moved/new cells get a negative oy so the game can animate the drop.
function compactAndRefill(grid, makeCell) {
  makeCell = makeCell || defaultCell;
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

// rearrange the existing gems in place (types + specials preserved) until the
// board has no ready-made matches and at least one valid move
function applyShuffle(grid) {
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
    ok = findRuns(grid).length === 0 && computeValidMoves(grid).length > 0;
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
    } while (computeValidMoves(grid).length === 0 && ++guard < 200);
    for (const s of specials) {
      const r = (Math.random() * ROWS) | 0, c = (Math.random() * COLS) | 0;
      if (!grid[r][c].s) grid[r][c].s = s;
    }
  }
}

return {
  COLS, ROWS, NTYPES,
  key, kr, kc, randType, defaultCell,
  levelTarget, levelMoves, isAdjacent,
  findRuns, matchAt, computeValidMoves,
  generateBoard, resolveClear, compactAndRefill, applyShuffle,
};

});

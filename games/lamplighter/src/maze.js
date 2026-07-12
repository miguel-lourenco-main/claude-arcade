/* Lamplighter — procedural maze generation.
   Left-right symmetric corridor mazes with wide loops, almost no dead ends,
   a den chamber in the center, wrapping side tunnels, and validated lantern
   placement. Exposes a single global: MAZE. */

const MAZE = (() => {
  "use strict";

  const WALL = 0, PATH = 1, DEN = 2, DOOR = 3;
  const COLS = 21, ROWS = 23;
  const TUNNEL_ROW = 11;

  const DIRS = [
    { dx: 0, dy: -1 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: 0 },
  ];

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* Breadth-first distance field over PATH tiles, wrap-aware on the
     tunnel row. Returns Int16Array of COLS*ROWS, -1 = unreachable. */
  function bfsField(g, sx, sy) {
    const dist = new Int16Array(COLS * ROWS).fill(-1);
    const q = [[sx, sy]];
    dist[sy * COLS + sx] = 0;
    while (q.length) {
      const [x, y] = q.shift();
      const d = dist[y * COLS + x];
      for (const dir of DIRS) {
        let nx = x + dir.dx;
        const ny = y + dir.dy;
        if (ny < 0 || ny >= ROWS) continue;
        if (nx < 0) nx = COLS - 1;
        if (nx >= COLS) nx = 0;
        if (g[ny][nx] !== PATH) continue;
        const i = ny * COLS + nx;
        if (dist[i] !== -1) continue;
        dist[i] = d + 1;
        q.push([nx, ny]);
      }
    }
    return dist;
  }

  /* Corridor tiles within path-distance 2 of a lamp — the pool of light. */
  function glowTiles(g, sx, sy) {
    const out = [{ x: sx, y: sy, d: 0 }];
    const seen = new Set([sy * COLS + sx]);
    let frontier = [[sx, sy]];
    for (let d = 1; d <= 2; d++) {
      const next = [];
      for (const [x, y] of frontier) {
        for (const dir of DIRS) {
          let nx = x + dir.dx;
          const ny = y + dir.dy;
          if (ny < 0 || ny >= ROWS) continue;
          if (nx < 0) nx = COLS - 1;
          if (nx >= COLS) nx = 0;
          if (g[ny][nx] !== PATH) continue;
          const i = ny * COLS + nx;
          if (seen.has(i)) continue;
          seen.add(i);
          out.push({ x: nx, y: ny, d });
          next.push([nx, ny]);
        }
      }
      frontier = next;
    }
    return out;
  }

  function tryGenerate(rng) {
    const g = Array.from({ length: ROWS }, () => new Array(COLS).fill(WALL));

    /* 1 — growing-tree carve on the left-half lattice (odd cells). */
    const key = (x, y) => y * COLS + x;
    const visited = new Set();
    const startX = 1 + 2 * Math.floor(rng() * 5);
    const startY = 1 + 2 * Math.floor(rng() * 11);
    g[startY][startX] = PATH;
    visited.add(key(startX, startY));
    const active = [{ x: startX, y: startY }];
    while (active.length) {
      const idx = rng() < 0.7 ? active.length - 1 : Math.floor(rng() * active.length);
      const c = active[idx];
      const opts = [];
      for (const d of DIRS) {
        const nx = c.x + d.dx * 2, ny = c.y + d.dy * 2;
        if (nx < 1 || nx > 9 || ny < 1 || ny > ROWS - 2) continue;
        if (!visited.has(key(nx, ny))) opts.push({ d, nx, ny });
      }
      if (!opts.length) { active.splice(idx, 1); continue; }
      const o = opts[Math.floor(rng() * opts.length)];
      g[c.y + o.d.dy][c.x + o.d.dx] = PATH;
      g[o.ny][o.nx] = PATH;
      visited.add(key(o.nx, o.ny));
      active.push({ x: o.nx, y: o.ny });
    }

    /* 2 — a few center-column connectors so the two halves join. */
    const candYs = [];
    for (let y = 1; y <= ROWS - 2; y += 2) if (y !== TUNNEL_ROW) candYs.push(y);
    shuffle(candYs, rng);
    for (let i = 0; i < 3; i++) g[candYs[i]][10] = PATH;

    /* 3 — mirror the left half onto the right. */
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x <= 9; x++) g[y][COLS - 1 - x] = g[y][x];

    /* 4 — den ring (a wide loop around the center chamber). */
    for (let x = 7; x <= 13; x++) { g[9][x] = PATH; g[13][x] = PATH; }
    for (let y = 9; y <= 13; y++) { g[y][7] = PATH; g[y][13] = PATH; }
    /* den chamber inside the ring */
    for (let y = 10; y <= 12; y++)
      for (let x = 8; x <= 12; x++) g[y][x] = WALL;
    for (let x = 9; x <= 11; x++) g[11][x] = DEN;
    g[10][10] = DOOR;
    /* guaranteed connectors from the ring out into the maze */
    g[9][6] = PATH; g[9][14] = PATH;
    g[13][6] = PATH; g[13][14] = PATH;

    /* 5 — wrapping side tunnels feeding the den ring. */
    for (let x = 0; x <= 6; x++) {
      g[TUNNEL_ROW][x] = PATH;
      g[TUNNEL_ROW][COLS - 1 - x] = PATH;
    }

    /* 6 — spawn corridor below the den. */
    g[17][10] = PATH;

    /* 7 — dead-end removal: knock symmetric walls until corridors loop. */
    for (let pass = 0; pass < 6; pass++) {
      let fixed = 0;
      for (let y = 1; y < ROWS - 1; y++) {
        for (let x = 1; x <= 10; x++) {
          if (g[y][x] !== PATH) continue;
          if (y === TUNNEL_ROW && x <= 2) continue; /* tunnel mouth */
          let open = 0;
          for (const d of DIRS) {
            const t = g[y + d.dy] && g[y + d.dy][x + d.dx];
            if (t === PATH || t === DOOR) open++;
          }
          if (open !== 1) continue;
          const cands = DIRS.filter((d) => {
            const wx = x + d.dx, wy = y + d.dy;
            const px = x + d.dx * 2, py = y + d.dy * 2;
            return px >= 1 && px < COLS - 1 && py >= 1 && py < ROWS - 1 &&
              g[wy][wx] === WALL && g[py][px] === PATH;
          });
          if (!cands.length) continue;
          const d = cands[Math.floor(rng() * cands.length)];
          g[y + d.dy][x + d.dx] = PATH;
          g[y + d.dy][COLS - 1 - (x + d.dx)] = PATH; /* keep symmetry */
          fixed++;
        }
      }
      if (!fixed) break;
    }

    /* 8 — braziers near the four corners. */
    const braziers = [
      { x: 1, y: 1 }, { x: 19, y: 1 },
      { x: 1, y: 21 }, { x: 19, y: 21 },
    ];
    for (const b of braziers) if (g[b.y][b.x] !== PATH) return null;

    const spawn = { x: 10, y: 17 };

    /* 9 — validate: every corridor tile reachable from spawn. */
    const reach = bfsField(g, spawn.x, spawn.y);
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++)
        if (g[y][x] === PATH && reach[y * COLS + x] === -1) return null;

    /* 10 — lantern placement: intersections first, then fill, spaced
       at least 2 apart (Chebyshev). */
    const lanterns = [];
    const isBrazier = (x, y) => braziers.some((b) => b.x === x && b.y === y);
    const okTile = (x, y) =>
      g[y][x] === PATH && !isBrazier(x, y) &&
      !(x === spawn.x && y === spawn.y) &&
      !(y === TUNNEL_ROW && (x < 3 || x > COLS - 4));
    const farEnough = (x, y) =>
      lanterns.every((l) => Math.max(Math.abs(l.x - x), Math.abs(l.y - y)) >= 2);
    const degree = (x, y) => {
      let n = 0;
      for (const d of DIRS) {
        const t = g[y + d.dy] && g[y + d.dy][x + d.dx];
        if (t === PATH) n++;
      }
      return n;
    };
    for (let y = 1; y < ROWS - 1; y++)
      for (let x = 1; x < COLS - 1; x++)
        if (okTile(x, y) && degree(x, y) >= 3 && farEnough(x, y))
          lanterns.push({ x, y });
    for (let y = 1; y < ROWS - 1; y++)
      for (let x = 1; x < COLS - 1; x++)
        if (okTile(x, y) && farEnough(x, y)) lanterns.push({ x, y });
    if (lanterns.length < 28) return null;

    /* 11 — every lantern must be reachable (it is, by step 9, but keep
       the explicit check so future edits stay honest). */
    for (const l of lanterns)
      if (reach[l.y * COLS + l.x] === -1) return null;

    for (const l of lanterns) l.glow = glowTiles(g, l.x, l.y);
    for (const b of braziers) b.glow = glowTiles(g, b.x, b.y);

    /* distance-to-door field for banished gloams drifting home */
    const doorField = bfsField(g, 10, 9);

    return {
      grid: g,
      lanterns,
      braziers,
      spawn,
      doorTop: { x: 10, y: 9 },
      denCenter: { x: 10, y: 11 },
      doorField,
      corners: [
        { x: 19, y: 1 },  /* chaser scatters top-right */
        { x: 1, y: 1 },   /* interceptor top-left */
        { x: 1, y: 21 },  /* flanker bottom-left */
        { x: 19, y: 21 }, /* wanderer bottom-right */
      ],
    };
  }

  function generateMaze(rng) {
    for (let i = 0; i < 80; i++) {
      const m = tryGenerate(rng);
      if (m) return m;
    }
    /* practically unreachable; keep trying with fresh entropy */
    let m = null;
    while (!m) m = tryGenerate(mulberry32((Math.random() * 0xffffffff) >>> 0));
    return m;
  }

  return { WALL, PATH, DEN, DOOR, COLS, ROWS, TUNNEL_ROW, DIRS, mulberry32, generateMaze, bfsField };
})();

/* dual environment: classic script in the browser, module in node tests */
if (typeof module !== "undefined" && module.exports) module.exports = MAZE;

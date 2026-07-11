// Palisade — map definitions and path geometry.
// A path is a list of axis-aligned waypoints in CELL coordinates; creeps store only
// their distance s along the path and derive x/y by segment interpolation.

export const CELL = 32;
export const COLS = 20;
export const ROWS = 14;
export const W = COLS * CELL;
export const H = ROWS * CELL;

const RAW_MAPS = [
  {
    name: 'Riverbend',
    tagline: 'a lazy S-curve with a pond',
    paths: [
      [[-1, 2], [16, 2], [16, 7], [3, 7], [3, 11], [20, 11]],
    ],
    water: [[8, 4], [9, 4], [10, 4], [8, 5], [9, 5], [10, 5], [9, 3]],
  },
  {
    name: 'The Coil',
    tagline: 'a spiral that swallows its own tail',
    paths: [
      [[-1, 1], [18, 1], [18, 12], [1, 12], [1, 4], [15, 4], [15, 9], [4, 9], [4, 6], [11, 6]],
    ],
    water: [[7, 2], [8, 2], [7, 3], [8, 3]],
  },
  {
    name: 'Pincer',
    tagline: 'two mouths, one throat',
    paths: [
      [[-1, 2], [9, 2], [9, 6], [15, 6], [15, 10], [20, 10]],
      [[-1, 11], [9, 11], [9, 6], [15, 6], [15, 10], [20, 10]],
    ],
    water: [[3, 6], [4, 6], [3, 7], [4, 7], [2, 6]],
  },
];

function cellCenter([c, r]) {
  return { x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 };
}

// Rasterize an axis-aligned segment into cell keys.
function markSegment(set, a, b) {
  const [ac, ar] = a; const [bc, br] = b;
  if (ar === br) {
    const lo = Math.min(ac, bc), hi = Math.max(ac, bc);
    for (let c = lo; c <= hi; c++) if (c >= 0 && c < COLS) set.add(c + ',' + ar);
  } else {
    const lo = Math.min(ar, br), hi = Math.max(ar, br);
    for (let r = lo; r <= hi; r++) if (r >= 0 && r < ROWS) set.add(ac + ',' + r);
  }
}

function buildPath(waypoints) {
  const pts = waypoints.map(cellCenter);
  const segs = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    segs.push({ a, b, start: total, len });
    total += len;
  }
  return { pts, segs, total };
}

function buildMap(raw) {
  const pathCells = new Set();
  for (const wp of raw.paths) {
    for (let i = 0; i < wp.length - 1; i++) markSegment(pathCells, wp[i], wp[i + 1]);
  }
  const waterCells = new Set(raw.water.map(([c, r]) => c + ',' + r));
  return {
    name: raw.name,
    tagline: raw.tagline,
    paths: raw.paths.map(buildPath),
    pathCells,
    waterCells,
  };
}

export const MAPS = RAW_MAPS.map(buildMap);

// Derive x/y (and facing direction) from distance s along path.
export function posAt(path, s) {
  if (s <= 0) {
    const g = path.segs[0];
    return { x: g.a.x, y: g.a.y, dx: (g.b.x - g.a.x) / g.len, dy: (g.b.y - g.a.y) / g.len };
  }
  for (const seg of path.segs) {
    if (s <= seg.start + seg.len) {
      const t = (s - seg.start) / seg.len;
      return {
        x: seg.a.x + (seg.b.x - seg.a.x) * t,
        y: seg.a.y + (seg.b.y - seg.a.y) * t,
        dx: (seg.b.x - seg.a.x) / seg.len,
        dy: (seg.b.y - seg.a.y) / seg.len,
      };
    }
  }
  const last = path.segs[path.segs.length - 1];
  return { x: last.b.x, y: last.b.y, dx: (last.b.x - last.a.x) / last.len, dy: (last.b.y - last.a.y) / last.len };
}

export function cellKey(c, r) { return c + ',' + r; }

export function inBounds(c, r) { return c >= 0 && c < COLS && r >= 0 && r < ROWS; }

// Buildable = on the grid, not path, not water. (Towers can never block the path
// by construction — the path is fixed cells, so there is no pathfinding at all.)
export function isBuildableCell(map, c, r) {
  if (!inBounds(c, r)) return false;
  const k = cellKey(c, r);
  return !map.pathCells.has(k) && !map.waterCells.has(k);
}

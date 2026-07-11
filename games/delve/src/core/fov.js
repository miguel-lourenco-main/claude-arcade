// Field of view via recursive shadowcasting over 8 octants, plus a Bresenham
// line-of-sight check used by monster senses. Pure functions, no game state.

// Octant transforms: [xx, xy, yx, yy]
const OCTANTS = [
  [1, 0, 0, 1], [0, 1, 1, 0], [0, -1, 1, 0], [-1, 0, 0, 1],
  [-1, 0, 0, -1], [0, -1, -1, 0], [0, 1, -1, 0], [1, 0, 0, -1],
];

/**
 * Compute FOV from (ox, oy) out to `radius`.
 * @param {(x:number,y:number)=>boolean} isOpaque
 * @param {(x:number,y:number)=>void} reveal called for every visible tile
 */
export function computeFOV(ox, oy, radius, isOpaque, reveal) {
  reveal(ox, oy);
  for (const [xx, xy, yx, yy] of OCTANTS) {
    castOctant(ox, oy, 1, 1.0, 0.0, radius, xx, xy, yx, yy, isOpaque, reveal);
  }
}

function castOctant(cx, cy, row, start, end, radius, xx, xy, yx, yy, isOpaque, reveal) {
  if (start < end) return;
  const r2 = radius * radius;
  let newStart = start;
  for (let i = row; i <= radius; i++) {
    const dy = -i;
    let blocked = false;
    for (let dx = -i; dx <= 0; dx++) {
      const X = cx + dx * xx + dy * xy;
      const Y = cy + dx * yx + dy * yy;
      const lSlope = (dx - 0.5) / (dy + 0.5);
      const rSlope = (dx + 0.5) / (dy - 0.5);
      if (start < rSlope) continue;
      if (end > lSlope) break;
      if (dx * dx + dy * dy <= r2) reveal(X, Y);
      if (blocked) {
        if (isOpaque(X, Y)) {
          newStart = rSlope;
        } else {
          blocked = false;
          start = newStart;
        }
      } else if (isOpaque(X, Y) && i < radius) {
        blocked = true;
        castOctant(cx, cy, i + 1, start, lSlope, radius, xx, xy, yx, yy, isOpaque, reveal);
        newStart = rSlope;
      }
    }
    if (blocked) break;
  }
}

/**
 * Straight-line visibility between two tiles (endpoints excluded from the
 * opacity test). Used for monster sight and ranged attacks.
 */
export function hasLOS(x0, y0, x1, y1, isOpaque) {
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0, y = y0;
  while (!(x === x1 && y === y1)) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
    if (x === x1 && y === y1) break;
    if (isOpaque(x, y)) return false;
  }
  return true;
}

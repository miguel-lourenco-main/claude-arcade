// The Waybar web: auto-shaping and track geometry. A placed waybar is always
// written as the canonical RAIL id; this module reshapes it (and every rail
// within one cell of any edit) to the straight, corner, or slope its
// neighbors suggest — the shape lives in the block id, like the stairs.
// carts.js asks railInfo() for the geometry a Trundle rolls on.

import {
  BLOCKS, isRail,
  RAIL, RAIL_EW, RAIL_NE, RAIL_NW, RAIL_SE, RAIL_SW,
  RAIL_UP_N, RAIL_UP_E, RAIL_UP_S, RAIL_UP_W,
} from "./blocks.js";

// N, E, S, W — the facing order every shaped block speaks
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const UP_IDS = [RAIL_UP_N, RAIL_UP_E, RAIL_UP_S, RAIL_UP_W];

// the track geometry a cart needs, by id (see blocks.js defRail):
//   straight: { kind, axis }         axis "x" | "z"
//   corner:   { kind, exits }        exits: two [dx, dz] edge directions
//   slope:    { kind, axis, up }     up: [dx, dz] toward the high end
export function railInfo(id) {
  return BLOCKS[id].rail;
}

// does a rail link from (x, y, z) toward direction i? Links reach the same
// level, one block up (a slope's high end), and one block down (the low
// cell a slope descends into).
function link(world, x, y, z, i) {
  const [dx, dz] = DIRS[i];
  if (isRail(world.getBlock(x + dx, y, z + dz))) return { up: false };
  if (isRail(world.getBlock(x + dx, y + 1, z + dz))) return { up: true };
  if (isRail(world.getBlock(x + dx, y - 1, z + dz))) return { up: false };
  return null;
}

// the shape this rail cell wants, from its neighbors alone (presence, not
// their shapes — so one reshaping pass over an edit's neighborhood settles)
export function railShape(world, x, y, z) {
  const links = [0, 1, 2, 3].map((i) => link(world, x, y, z, i));
  const has = (i) => links[i] !== null;
  // through-lines first: straight along the axis, sloping when either far
  // end sits a block up (a cell only ever climbs one way — north/east win)
  if (has(0) && has(2)) {
    if (links[0].up) return RAIL_UP_N;
    if (links[2].up) return RAIL_UP_S;
    return RAIL;
  }
  if (has(1) && has(3)) {
    if (links[1].up) return RAIL_UP_E;
    if (links[3].up) return RAIL_UP_W;
    return RAIL_EW;
  }
  // two adjacent links: a bend (bends never climb)
  if (has(0) && has(1)) return RAIL_NE;
  if (has(0) && has(3)) return RAIL_NW;
  if (has(2) && has(1)) return RAIL_SE;
  if (has(2) && has(3)) return RAIL_SW;
  // a single link: straight toward it, sloping if it sits a block up
  for (let i = 0; i < 4; i++) {
    if (!has(i)) continue;
    if (links[i].up) return UP_IDS[i];
    return i % 2 === 0 ? RAIL : RAIL_EW;
  }
  return RAIL; // a lone waybar defaults north-south
}

// reshape every rail within one cell (horizontally, ±1 vertically) of an
// edit — including the edited cell itself, so a freshly placed canonical
// RAIL immediately takes its true shape. Returns the affected chunks.
export function reshapeRails(world, x, y, z) {
  const cells = [[x, y, z]];
  for (const [dx, dz] of DIRS) {
    for (const dy of [-1, 0, 1]) cells.push([x + dx, y + dy, z + dz]);
  }
  const affected = new Set();
  for (const [cx, cy, cz] of cells) {
    const id = world.getBlock(cx, cy, cz);
    if (!isRail(id)) continue;
    const want = railShape(world, cx, cy, cz);
    if (want === id) continue;
    for (const c of world.setBlock(cx, cy, cz, want)) affected.add(c);
  }
  return [...affected];
}

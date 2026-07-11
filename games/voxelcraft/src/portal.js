// The Cinder Door (see LORE.md): frame detection, ignition fill, collapse,
// and the far-side arrival. A door is a standing rectangular ring of
// Cinderglass in either vertical plane — interior 2–4 wide and 3–4 tall,
// corners optional — filled with PORTAL_FILM when a full Ember Pail gives
// it its fire back. Everything here is a pure function over a `world`
// parameter (rails.js is the template): interact.js asks detectFrame on the
// ignite click, main.js asks collapseOrphanFilm after every edit, and the
// crossing asks findArrival for a spot under the other sky.

import {
  CINDERGLASS, PORTAL_FILM, AIR, SNOW_LAYER,
  isPlant, isFluid, isSolid,
} from "./blocks.js";
import { HEIGHT } from "./world.js";

const MIN_W = 2, MAX_W = 4; // interior columns
const MIN_H = 3, MAX_H = 4; // interior rows

// an interior cell: air, or film already standing (so a half-collapsed door
// re-ignites, and a film cell can seed its own re-validation)
const open = (id) => id === AIR || id === PORTAL_FILM;

// scan one vertical plane for a complete ring around an open seed cell.
// (ux, uz) is the plane's horizontal unit — (1, 0) for the XY plane,
// (0, 1) for the ZY plane. Returns { cells, ring } or null.
function scanFromSeed(world, sx, sy, sz, ux, uz) {
  const at = (i, y) => world.getBlock(sx + ux * i, y, sz + uz * i);

  // drop to the interior floor row: at most the interior height down, and
  // the cell under the floor must be frame (the bottom bar)
  let y0 = sy, drop = 0;
  while (open(at(0, y0 - 1)) && drop < MAX_H) { y0--; drop++; }
  if (at(0, y0 - 1) !== CINDERGLASS) return null;

  // extend the floor row sideways to the side bars
  let lo = 0, hi = 0;
  while (open(at(lo - 1, y0)) && hi - lo < MAX_W) lo--;
  while (open(at(hi + 1, y0)) && hi - lo < MAX_W) hi++;
  const width = hi - lo + 1;
  if (width < MIN_W || width > MAX_W) return null;
  if (at(lo - 1, y0) !== CINDERGLASS || at(hi + 1, y0) !== CINDERGLASS) return null;
  // the whole bottom bar, not just under the seed column
  for (let i = lo; i <= hi; i++) if (at(i, y0 - 1) !== CINDERGLASS) return null;

  // grow upward: every interior row is fully open with frame side bars,
  // until the lintel row (all frame) closes the ring
  let rows = 1;
  let yTop = y0;
  for (;;) {
    const y = y0 + rows;
    let lintel = true;
    for (let i = lo; i <= hi; i++) if (at(i, y) !== CINDERGLASS) { lintel = false; break; }
    if (lintel) { yTop = y; break; }
    if (rows >= MAX_H) return null; // too tall before a lintel closed it
    for (let i = lo; i <= hi; i++) if (!open(at(i, y))) return null;
    if (at(lo - 1, y) !== CINDERGLASS || at(hi + 1, y) !== CINDERGLASS) return null;
    rows++;
  }
  if (rows < MIN_H) return null;

  const cell = (i, y) => [sx + ux * i, y, sz + uz * i];
  const cells = [];
  for (let y = y0; y < yTop; y++) for (let i = lo; i <= hi; i++) cells.push(cell(i, y));
  const ring = [];
  for (let i = lo; i <= hi; i++) { ring.push(cell(i, y0 - 1)); ring.push(cell(i, yTop)); }
  for (let y = y0; y < yTop; y++) { ring.push(cell(lo - 1, y)); ring.push(cell(hi + 1, y)); }
  return { cells, ring };
}

// the ignite entry: from a clicked CINDERGLASS cell, try both planes,
// seeding the scan from each open in-plane neighbor. The clicked cell must
// turn out to be part of the ring it closes — clicking a shed wall three
// blocks from somebody's door must not open it.
export function detectFrame(world, x, y, z) {
  if (world.getBlock(x, y, z) !== CINDERGLASS) return null;
  for (const [ux, uz] of [[1, 0], [0, 1]]) {
    const seeds = [
      [x + ux, y, z + uz], [x - ux, y, z - uz], [x, y + 1, z], [x, y - 1, z],
    ];
    for (const [nx, ny, nz] of seeds) {
      if (!open(world.getBlock(nx, ny, nz))) continue;
      const frame = scanFromSeed(world, nx, ny, nz, ux, uz);
      if (!frame) continue;
      if (!frame.ring.some(([rx, ry, rz]) => rx === x && ry === y && rz === z)) continue;
      return { axis: ux ? "x" : "z", ...frame };
    }
  }
  return null;
}

// a film cell is valid while SOME complete ring still holds it as interior
function filmStillFramed(world, x, y, z) {
  for (const [ux, uz] of [[1, 0], [0, 1]]) {
    const frame = scanFromSeed(world, x, y, z, ux, uz);
    if (frame && frame.cells.some(([cx, cy, cz]) => cx === x && cy === y && cz === z)) return true;
  }
  return false;
}

// called after every edit, beside reshapeRails: any film touching the edited
// cell re-proves its ring, and a film that lost its frame folds — the whole
// connected sheet goes at once (a door is one thing, not a grid of cells).
// Returns { chunks, collapsed } so main.js can remesh (film is an emitter —
// the collapse is always a light-touching edit) and play the fold cue.
export function collapseOrphanFilm(world, x, y, z) {
  const affected = new Set();
  let collapsed = false;
  const probes = [
    [x, y, z],
    [x + 1, y, z], [x - 1, y, z], [x, y + 1, z], [x, y - 1, z],
    [x, y, z + 1], [x, y, z - 1],
  ];
  for (const [px, py, pz] of probes) {
    if (world.getBlock(px, py, pz) !== PORTAL_FILM) continue;
    if (filmStillFramed(world, px, py, pz)) continue;
    // flood the connected sheet (6-connected, bounded well past a 4x4 door)
    const sheet = [[px, py, pz]];
    const seen = new Set([px + "," + py + "," + pz]);
    while (sheet.length && seen.size <= 32) {
      const [fx, fy, fz] = sheet.pop();
      for (const c of world.setBlock(fx, fy, fz, AIR)) affected.add(c);
      collapsed = true;
      for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
        const nx = fx + dx, ny = fy + dy, nz = fz + dz;
        const k = nx + "," + ny + "," + nz;
        if (seen.has(k) || world.getBlock(nx, ny, nz) !== PORTAL_FILM) continue;
        seen.add(k);
        sheet.push([nx, ny, nz]);
      }
    }
  }
  return { chunks: [...affected], collapsed };
}

// a return-frame cell may politely displace loose stuff, never real work
const replaceable = (id) =>
  id === AIR || isPlant(id) || id === SNOW_LAYER || isFluid(id);

// the far side of a crossing: the player's coordinates map 1:1, then we
// look for a door already standing near the mapped point, and raise one if
// the far country never got its half built. ensureChunk first — the
// resolveRespawn trick: generation re-applies the edit overlay, so getBlock
// actually sees (or misses) a previously built door.
export function findArrival(world, terrain, px, py, pz) {
  const bx = Math.floor(px), bz = Math.floor(pz);
  const ccx = bx >> 4, ccz = bz >> 4;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) world.ensureChunk(ccx + dx, ccz + dz);
  }
  // nearest standing film cell with its feet on the door's own bottom bar
  let best = null, bestD = Infinity;
  for (let x = bx - 8; x <= bx + 8; x++) {
    for (let z = bz - 8; z <= bz + 8; z++) {
      for (let y = 1; y < HEIGHT - 1; y++) {
        if (world.getBlock(x, y, z) !== PORTAL_FILM) continue;
        if (!isSolid(world.getBlock(x, y - 1, z))) continue; // want the floor row
        const d = (x - px) ** 2 + (z - pz) ** 2 + 0.25 * (y - py) ** 2;
        if (d < bestD) { bestD = d; best = { x: x + 0.5, y, z: z + 0.5 }; }
      }
    }
  }
  if (best) return { pos: best, chunks: [] };
  return buildReturnFrame(world, terrain, px, pz);
}

// raise the return door: probe nearby columns for ground that takes a
// 4-wide × 5-tall frame without displacing anything that matters; if the
// whole neighborhood refuses, build at the mapped column anyway — the
// Upturn never strands a Wanderling. Writes through world.setBlock, so the
// door persists in the edit overlay like anything player-made.
export function buildReturnFrame(world, terrain, px, pz) {
  const probes = [
    [0, 0], [3, 0], [-3, 0], [0, 3], [0, -3],
    [5, 2], [-5, -2], [2, 5], [-2, -5], [6, 0], [0, 6], [-6, 0],
  ];
  const bx0 = Math.floor(px), bz0 = Math.floor(pz);
  let spot = null;
  for (const [dx, dz] of probes) {
    const bx = bx0 + dx, bz = bz0 + dz;
    const h = terrain.heightAt(bx, bz);
    if (h + 6 >= HEIGHT) continue;
    let ok = true;
    for (let i = 0; i < 4 && ok; i++) {
      // the frame plane must be loose stuff only, on solid ground
      for (let y = h + 1; y <= h + 5 && ok; y++) {
        if (!replaceable(world.getBlock(bx + i, y, bz))) ok = false;
      }
      if (!isSolid(world.getBlock(bx + i, h, bz))) ok = false;
    }
    if (ok) { spot = [bx, bz, h]; break; }
  }
  if (!spot) {
    // force-build at the mapped column: carve what's there
    const h = Math.min(HEIGHT - 7, terrain.heightAt(bx0, bz0));
    spot = [bx0, bz0, h];
  }
  const [bx, bz, h] = spot;
  const affected = new Set();
  const put = (x, y, z, id) => { for (const c of world.setBlock(x, y, z, id)) affected.add(c); };
  // an X-axis door: bottom bar + lintel across the 2 interior columns,
  // side bars up the 3 interior rows, film filling the ring
  for (const i of [1, 2]) { put(bx + i, h + 1, bz, CINDERGLASS); put(bx + i, h + 5, bz, CINDERGLASS); }
  for (let y = h + 2; y <= h + 4; y++) { put(bx, y, bz, CINDERGLASS); put(bx + 3, y, bz, CINDERGLASS); }
  for (const i of [1, 2]) for (let y = h + 2; y <= h + 4; y++) put(bx + i, y, bz, PORTAL_FILM);
  // breathing room on both faces of the film so stepping out never wedges
  for (const dz of [-1, 1]) {
    for (const i of [1, 2]) {
      for (let y = h + 2; y <= h + 3; y++) {
        if (world.getBlock(bx + i, y, bz + dz) !== AIR) put(bx + i, y, bz + dz, AIR);
      }
    }
  }
  return { pos: { x: bx + 1.5, y: h + 2, z: bz + 0.5 }, chunks: [...affected] };
}

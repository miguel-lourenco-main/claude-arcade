// Ore veins: explicit clusters on top of the noise seams (terrain.js oreAt).
//
// The noise seams are what the deep has always looked like: wherever two
// fBm fields agree, a run of ore. Veins add what the seams can't express —
// a COUNT. The stone is cut into VEIN_CELL³ cells; a cell may hold one vein
// (a seeded roll per cell), and a vein is a blob of N blocks grown by a
// seeded walk from a centre kept inside the cell, so a vein never needs a
// neighbour's cell to resolve (chunk generation stays order-independent).
//
// N is drawn per vein from 1..veinMax(ore), and veinMax falls off
// EXPONENTIALLY with the ore's rarity (rarity.js): coal veins run to ~9,
// sky-iron ~7, gloamgold ~5. The per-ore cell chances are tuned so the veins
// add about +10% of each ore on top of the seams (test/veins.test.mjs
// measures it over real generated chunks). A vein only ever replaces plain
// stone, and keeps to its ore's depth band.

import { hash2, mulberry32 } from "./noise.js";
import { COAL_ORE, IRON_ORE, GLOAM_ORE } from "./blocks.js";
import { rarityOf } from "./rarity.js";

export const VEIN_CELL = 8;      // cell edge (blocks); centres sit 2..5 in, so radius-2 blobs fit
export const VEIN_MAX0 = 24;     // the cap a rarity-0 ore would have
export const VEIN_DECAY = 3;     // cap = VEIN_MAX0 * e^(-VEIN_DECAY * rarity)

// per-ore: the chance a cell holds one of its veins, and its depth band
// (blocks with y >= maxY never take the ore — the seams' own bands)
export const VEIN_ORES = [
  { id: COAL_ORE, chance: 0.025, maxY: Infinity },
  { id: IRON_ORE, chance: 0.0118, maxY: 28 },
  { id: GLOAM_ORE, chance: 0.0044, maxY: 14 },
];

// the most blocks one vein of `id` can hold
export function veinMax(id) {
  return Math.max(1, Math.round(VEIN_MAX0 * Math.exp(-VEIN_DECAY * rarityOf(id))));
}

const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// the vein in cell (ix, iy, iz), or null: { id, n, cells: Set of local
// indices lx + VEIN_CELL * (ly + VEIN_CELL * lz) }. Pure in (seed, cell).
export function veinInCell(seed, ix, iy, iz) {
  // one roll picks at most one ore for the cell (cumulative chances)
  const u = hash2(ix * 73 + iy * 977, iz * 131 - iy * 389, seed ^ 0x5ea3);
  let acc = 0, ore = null;
  for (const o of VEIN_ORES) {
    acc += o.chance;
    if (u < acc) { ore = o; break; }
  }
  if (!ore) return null;
  // a band-gated ore whose whole cell sits above its band can't hold a vein
  if (iy * VEIN_CELL >= ore.maxY) return null;
  const rand = mulberry32((seed ^ Math.imul(ix, 0x27d4eb2f) ^ Math.imul(iy, 0x165667b1) ^
    Math.imul(iz, 0x9e3779b1)) >>> 0);
  const max = veinMax(ore.id);
  // sizes lean small: n = 1 + floor(u^1.5 * max), capped at max
  const n = Math.min(max, 1 + Math.floor(rand() ** 1.5 * max));
  const c = () => 2 + Math.floor(rand() * 4); // centre 2..5 inside the cell
  const blob = [[c(), c(), c()]];
  const cells = new Set([idx(...blob[0])]);
  for (let tries = 0; cells.size < n && tries < n * 8; tries++) {
    const [x, y, z] = blob[Math.floor(rand() * blob.length)];
    const [dx, dy, dz] = DIRS[Math.floor(rand() * 6)];
    const nx = x + dx, ny = y + dy, nz = z + dz;
    if (nx < 0 || ny < 0 || nz < 0 || nx >= VEIN_CELL || ny >= VEIN_CELL || nz >= VEIN_CELL) continue;
    const k = idx(nx, ny, nz);
    if (cells.has(k)) continue;
    cells.add(k);
    blob.push([nx, ny, nz]);
  }
  return { id: ore.id, n: cells.size, maxY: ore.maxY, cells };
}

function idx(x, y, z) { return x + VEIN_CELL * (y + VEIN_CELL * z); }

// A cached lookup for the generator: the vein ore at world (x, y, z), or 0.
export class Veins {
  constructor(seed) {
    this.seed = seed;
    this._cache = new Map();
    this._lastKey = NaN; // the generator walks columns, so the last cell
    this._last = null;   // answers most calls without a Map lookup
  }

  oreAt(x, y, z) {
    const ix = Math.floor(x / VEIN_CELL), iy = Math.floor(y / VEIN_CELL), iz = Math.floor(z / VEIN_CELL);
    // exact numeric key (|ix|, |iz| < 2^20 and 0 <= iy < 64 at any reachable
    // coordinate, well inside a double's integer range)
    const key = ((ix + 0x100000) * 0x200000 + (iz + 0x100000)) * 64 + iy;
    let v;
    if (key === this._lastKey) v = this._last;
    else {
      v = this._cache.get(key);
      if (v === undefined) {
        if (this._cache.size > 50000) this._cache.clear();
        v = veinInCell(this.seed, ix, iy, iz);
        this._cache.set(key, v);
      }
      this._lastKey = key; this._last = v;
    }
    if (!v || y >= v.maxY) return 0;
    const lx = x - ix * VEIN_CELL, ly = y - iy * VEIN_CELL, lz = z - iz * VEIN_CELL;
    return v.cells.has(idx(lx, ly, lz)) ? v.id : 0;
  }
}

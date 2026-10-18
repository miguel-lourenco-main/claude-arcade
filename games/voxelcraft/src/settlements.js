// Settlements: where the Living Steads stand, and how big they grow.
//
// The world is cut into SETTLEMENT_CELL x SETTLEMENT_CELL chunk cells. Each
// cell holds at most one settlement, at a seeded spot kept a chunk in from
// the cell's edge, so two settlements are always at least two chunks apart.
// That is the spacing; it replaces the old independent per-chunk roll.
//
// Whether a cell settles, and how big, follows a slow SETTLEMENT DENSITY
// field (low-frequency fBm over the seed). Where it's high the cells fill,
// and the biggest settlements stand among smaller ones. Where it's low the
// cells stay empty. So villages cluster near larger ones and thin out in
// remote country without any cross-cell coordination.
//
// Tiers grow by footprint and cottages:
//   hamlet        1x1 chunks, 2-3 cottages, 1 patch  (the original stead)
//   village       2x2 chunks, 4-6 cottages, 2 patches
//   dense village 3x3 chunks, 7-10 cottages, 3 patches
//   city          RESERVED: see cityForCell. Waits on the narrative arc
//                 (#13, the C1 writing gate), which decides what makes a city
//                 seed-consistent.
// A footprint stays inside its cell. Each chunk it covers stamps only its
// own part (steads.js stampStead clips), so generation stays chunk-order
// independent. A footprint that would touch a ruin or a delving bows out.
//
// Everything is a pure function of (seed, cell), cached per terrain.

import { Perlin, hash2, mulberry32 } from "./noise.js";
import { CHUNK, HEIGHT, SEA_LEVEL } from "./world.js";
import { ruinForChunk } from "./ruins.js";
import { delveForChunk } from "./delvings.js";

export const JOBS = ["grower", "wright", "keeper"];

export const SETTLEMENT_CELL = 6;      // chunks per cell edge (96 blocks)
const DENSITY_SCALE = 1 / 640;         // blocks -> density-noise units
// density thresholds (the field's own [0,1] scale — see settlementDensity)
export const DENSITY_REMOTE = 0.45;    // below: the cell stays empty
const DENSITY_FULL = 0.62;             // at/above: the cell is near-certain to settle
const SETTLE_MAX = 0.85;               // the chance at full density
export const TIER_VILLAGE = 0.585;     // density for a village
export const TIER_DENSE = 0.65;        // density for a dense village
const TIER_JITTER = 0.04;              // seeded wobble so tiers don't band too cleanly

export const TIERS = {
  hamlet: { id: "hamlet", name: "Hamlet", span: 1, cottages: [2, 3], patches: 1, leash: 24 },
  village: { id: "village", name: "Village", span: 2, cottages: [4, 6], patches: 2, leash: 36 },
  dense: { id: "dense", name: "Dense village", span: 3, cottages: [7, 10], patches: 3, leash: 48 },
  // the city hook: a sufficiently dense village IS conceptually a city, but
  // cities are partly hand-authored and story-linked, so they are not
  // generated until C1 settles their anchors. cityForCell is where they plug in.
  city: { id: "city", name: "City", reserved: true },
};

// --- the density field -------------------------------------------------------

// settlement density at world (x, z), in roughly [0, 1] (fBm remapped). The
// field is slow: it changes over many cells, so neighbouring cells agree.
export function settlementDensity(terrain, x, z) {
  const p = terrain._settlePerlin || (terrain._settlePerlin = new Perlin(terrain.seed ^ 0x5e771e));
  return (p.fbm2(x * DENSITY_SCALE, z * DENSITY_SCALE, 3) + 1) / 2;
}

// the chance a cell at this density settles at all
export function settleChance(d) {
  if (d < DENSITY_REMOTE) return 0;
  return SETTLE_MAX * Math.min(1, (d - DENSITY_REMOTE) / (DENSITY_FULL - DENSITY_REMOTE));
}

export function tierForDensity(d) {
  if (d >= TIER_DENSE) return TIERS.dense;
  if (d >= TIER_VILLAGE) return TIERS.village;
  return TIERS.hamlet;
}

// --- the city hook (reserved) -----------------------------------------------------

// RESERVED for C2's city half, gated on C1 (the Upturn arc, #13). Contract:
// return null (no city in this cell) or a city plan in the same shape as a
// settlement plan (tier TIERS.city), built from SEED-CONSISTENT anchors: the
// arc decides which aspects are fixed for a seed (location, name, landmark,
// the story beat it hosts). settlementForCell asks this first, so a city
// claims its cell before any village roll. Always null until then.
export function cityForCell(/* terrain, gx, gz */) {
  return null;
}

// --- placement ------------------------------------------------------------------

const cellKey = (gx, gz) => `${gx},${gz}`;
const floorDiv = (a, b) => Math.floor(a / b);

export function cellOfChunk(cx, cz) {
  return [floorDiv(cx, SETTLEMENT_CELL), floorDiv(cz, SETTLEMENT_CELL)];
}

// the settlement plan for cell (gx, gz), or null. Cached per terrain.
export function settlementForCell(terrain, gx, gz) {
  const cache = terrain._settleCache || (terrain._settleCache = new Map());
  const k = cellKey(gx, gz);
  if (cache.has(k)) return cache.get(k);
  if (cache.size > 4096) cache.clear();
  const plan = cityForCell(terrain, gx, gz) || buildSettlement(terrain, gx, gz);
  cache.set(k, plan);
  return plan;
}

function buildSettlement(terrain, gx, gz) {
  const seed = terrain.seed;
  // the cell's candidate spot: its density decides if and how big
  const midX = (gx * SETTLEMENT_CELL + SETTLEMENT_CELL / 2) * CHUNK;
  const midZ = (gz * SETTLEMENT_CELL + SETTLEMENT_CELL / 2) * CHUNK;
  const d = settlementDensity(terrain, midX, midZ);
  if (hash2(gx, gz, seed ^ 0x5e7701) >= settleChance(d)) return null;
  const wobble = (hash2(gx, gz, seed ^ 0x5e7702) - 0.5) * 2 * TIER_JITTER;
  let tier = tierForDensity(d + wobble);

  // the anchor chunk: seeded inside the cell with a one-chunk margin
  const room = SETTLEMENT_CELL - tier.span - 2; // free offsets beyond the margin
  const ox = 1 + Math.floor(hash2(gx, gz, seed ^ 0x5e7703) * (room + 1));
  const oz = 1 + Math.floor(hash2(gx, gz, seed ^ 0x5e7704) * (room + 1));
  const cx = gx * SETTLEMENT_CELL + ox, cz = gz * SETTLEMENT_CELL + oz;

  // honest exclusion: no footprint chunk may hold a ruin or a delving
  for (let dz = 0; dz < tier.span; dz++) for (let dx = 0; dx < tier.span; dx++) {
    if (ruinForChunk(terrain, cx + dx, cz + dz) || delveForChunk(terrain, cx + dx, cz + dz)) return null;
  }
  return layoutSettlement(terrain, cx, cz, tier);
}

// Lay a settlement out on its footprint: a central well on a plaza, cottages
// on the lots nearest it (8-block lots, doors facing the well), patches on
// the next lots out. Lots whose ground sits too far from the plaza's
// terrace are skipped. Returns the plan, or null if the ground can't hold
// even a hamlet.
export function layoutSettlement(terrain, cx, cz, tier) {
  const seed = terrain.seed;
  const size = tier.span * CHUNK;
  const ox = cx * CHUNK, oz = cz * CHUNK;
  const wellX = ox + size / 2, wellZ = oz + size / 2;
  const h = terrain.heightAt(wellX, wellZ);
  if (h <= SEA_LEVEL + 1 || h >= HEIGHT - 18) return null;

  const rand = mulberry32((seed ^ Math.imul(cx, 0x27d4eb2f) ^ Math.imul(cz, 0x165667b1)) >>> 0);
  // candidate lot centres, nearest the plaza first (seeded jitter breaks ties)
  const plaza = tier.span === 1 ? 5 : 6;
  const lots = [];
  for (let lz = 4; lz < size; lz += 8) for (let lx = 4; lx < size; lx += 8) {
    const x = ox + lx, z = oz + lz;
    const dist = Math.hypot(x - wellX, z - wellZ);
    if (dist < plaza) continue;
    const lh = terrain.heightAt(x, z);
    if (lh <= SEA_LEVEL || Math.abs(lh - h) > 6) continue; // drowned or a cliff away
    lots.push({ x, z, key: dist + rand() * 3 });
  }
  lots.sort((a, b) => a.key - b.key);

  const [lo, hi] = tier.cottages;
  const want = lo + Math.floor(rand() * (hi - lo + 1));
  const cottages = Math.min(want, lots.length);
  if (cottages < 2) return null;

  const buildings = [];
  for (let i = 0; i < cottages; i++) {
    const { x: bx, z: bz } = lots[i];
    const dx = wellX - bx, dz = wellZ - bz;
    let nx = 0, nz = 0;
    if (Math.abs(dx) > Math.abs(dz)) nx = Math.sign(dx) || 1;
    else nz = Math.sign(dz) || 1;
    const door = { x: bx + nx * 2, z: bz + nz * 2, nx, nz };
    const torch = { x: bx - nx, y: h + 1, z: bz - nz }; // interior, back wall
    buildings.push({
      cx: bx, cz: bz, x0: bx - 2, x1: bx + 2, z0: bz - 2, z1: bz + 2,
      floorY: h, roofY: h + 4, door, torch,
    });
  }
  const gardens = [];
  for (let i = cottages; i < lots.length && gardens.length < tier.patches; i++) {
    const { x: gxc, z: gzc } = lots[i];
    const dx = wellX - gxc, dz = wellZ - gzc;
    // the gate on the side facing the well
    const gate = Math.abs(dx) > Math.abs(dz)
      ? { x: gxc + 2 * (Math.sign(dx) || 1), z: gzc }
      : { x: gxc, z: gzc + 2 * (Math.sign(dz) || 1) };
    gardens.push({ x0: gxc - 2, x1: gxc + 2, z0: gzc - 2, z1: gzc + 2, floorY: h, gate });
  }

  // jobs: a seeded deal of the three, cycled for bigger settlements
  const jobs = JOBS.slice();
  for (let i = jobs.length - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    [jobs[i], jobs[j]] = [jobs[j], jobs[i]];
  }
  const residents = buildings.map((_, i) => ({
    job: jobs[i % jobs.length], homeIdx: i,
    seed: (seed ^ Math.imul(cx, 0x9e3779b1) ^ Math.imul(cz, 0x85ebca77) ^ (i * 0x1000193)) >>> 0,
  }));
  // the tier as built (lots can fall short of the roll)
  const built = cottages >= TIERS.dense.cottages[0] ? TIERS.dense
    : cottages >= TIERS.village.cottages[0] ? TIERS.village : TIERS.hamlet;

  const chunks = [];
  for (let dz = 0; dz < tier.span; dz++) for (let dx = 0; dx < tier.span; dx++) chunks.push([cx + dx, cz + dz]);
  return {
    cx, cz, x: wellX, z: wellZ, h, seed, key: `${cx},${cz}`,
    tier: built.id, span: tier.span, chunks,
    x0: ox, z0: oz, x1: ox + size - 1, z1: oz + size - 1,
    well: { x: wellX, y: h, z: wellZ }, leash: tier.leash,
    residentCount: residents.length, buildings, residents,
    gardens, garden: gardens[0] || null,
  };
}

// does this plan's footprint cover chunk (cx, cz)?
export function planCoversChunk(plan, cx, cz) {
  return cx >= plan.cx && cx < plan.cx + plan.span && cz >= plan.cz && cz < plan.cz + plan.span;
}

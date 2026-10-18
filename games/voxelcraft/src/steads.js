// The Living Stead — an inhabited settlement (see LORE.md). Where the
// Steads-Before (ruins.js) are the homesteads the flip folded down to their
// footings, a Living Stead is one that came through WHOLE and stayed lived-in:
// two or three small buildings with doors and torches, a fenced meal-root
// patch, a well, and two or three Steadfolk who wander it by day, head indoors
// at dusk, and keep a job table to barter from.
//
// Placement follows the Steads-Before contract: a pure function of the world
// seed + chunk coords, the whole footprint stamped strictly inside its own
// chunk. A stead is RARER than a ruin (~1 in 90) and MUTUALLY EXCLUSIVE with
// one — steadForChunk asks ruinForChunk (and delveForChunk) honestly and
// bows out of any chunk they claim, so a chunk is never both.

import * as THREE from "three";
import { hash2, mulberry32 } from "./noise.js";
import { CHUNK, HEIGHT, SEA_LEVEL } from "./world.js";
import { ruinForChunk } from "./ruins.js";
import { delveForChunk } from "./delvings.js";
import { bandOf, standingOf } from "./standing.js";
import {
  AIR, DIRT, GRASS, COBBLE, PLANKS, LOG, GLASS, TORCH, WATER, PLANK_SLAB,
  DOOR_OPEN, DOOR_TOP_OPEN, FENCE, GATE, FARMLAND, CROP_RIPE, BLOCKS, ICE,
  // job-table goods
  MEAL_ROOT, BERRIES, ROOT_SEED, POTTAGE, BOGBEAN, GRAVEL, STONE_PICK,
  IRON_INGOT, RAIL, DOOR, PLANK_STAIRS, COAL_ORE, SILVERFIN,
  EMBER_BROTH, SUNWISP_BROTH, ROAST_LOIN, SAND, BAKED_ROOT, LADDER, CHEST,
  IRON_ORE, SEARED_SILVERFIN, SNUFFET_LOIN, POPPY, DANDELION, BOGBEAN_POD,
  WISPCAP, SAPLING, IRON_PICK, COMPASS, CART, TIDE_BROTH, KELP_CRISP, STARGLASS,
} from "./blocks.js";
import { dealBoard, dispositionOf } from "./trade.js";
import {
  JOBS, settlementForCell, cellOfChunk, planCoversChunk, TIERS,
} from "./settlements.js";

const STEAD_RATE = 1 / 55;  // before the ruin/delve exclusion + terrain vetoes
                            // (~half the hits are lost to those), which lands
                            // the net rate near the ~1-in-90 the lore wants
const LEASH = 24;           // how far a steadfolk strays from the well
const STEADFOLK_HP = 10;
const ACTIVATE_DIST = 72;   // residents come alive within this of the well
const DEACTIVATE_DIST = 104;// ...and fold back to a saved record past this

// the trades a steadfolk works: what each JOB sells, what it will take in
// return, and (for a cherished customer) the rarer goods it keeps back. Any
// sell can pair with any want; trade.js prices the pairing by fair value
// (rarity.js) at the resident's disposition and the stead's standing.
export { JOBS };
export const JOB_GOODS = {
  // the grower keeps the meal-root patch and the brambles; takes rubble,
  // grit and the odd tool for the digging
  grower: {
    sells: [MEAL_ROOT, BERRIES, ROOT_SEED, BOGBEAN, POTTAGE, BAKED_ROOT],
    wants: [COBBLE, GRAVEL, SAND, COAL_ORE, STONE_PICK, LOG],
    rare: [BOGBEAN_POD, WISPCAP, SAPLING],
  },
  // the wright works the timber and the sky-iron
  wright: {
    sells: [PLANKS, RAIL, DOOR, PLANK_STAIRS, FENCE, LADDER, CHEST],
    wants: [IRON_INGOT, IRON_ORE, LOG, COAL_ORE, COBBLE],
    rare: [IRON_PICK, COMPASS, CART],
  },
  // the keeper minds the hearth and the pot
  keeper: {
    sells: [TORCH, EMBER_BROTH, SUNWISP_BROTH, ROAST_LOIN, SEARED_SILVERFIN],
    wants: [COAL_ORE, SILVERFIN, SNUFFET_LOIN, POPPY, DANDELION, LOG],
    rare: [TIDE_BROTH, KELP_CRISP, STARGLASS],
  },
};

export const OFFERS_PER_DAY = 3;

// a resident's disposition: fixed at its "birth" (the stead's seed + its
// place in the stead), so the same steadfolk is always the same bargainer
export function residentDisposition(steadSeed, resIdx) {
  return dispositionOf((steadSeed ^ Math.imul(resIdx + 1, 0x9e3779b9)) >>> 0);
}

// a steadfolk's offers for the day, deterministic in (seed, resident, day):
// value-fair pairings from its job's goods (trade.js dealBoard), at
// ratio = disposition x the stead's standing band price (standing.js — the
// old per-day warmth lives at its positive end). A friendly stead deals a
// fourth line; a cherished one deals it from the job's rare goods.
export function steadOffers(steadSeed, resIdx, job, day, standing = 0) {
  const band = bandOf(standing);
  const goods = JOB_GOODS[job] || JOB_GOODS.grower;
  const rand = mulberry32(
    (steadSeed ^ Math.imul(resIdx + 1, 0x9e3779b9) ^ Math.imul(day + 1, 0x85ebca77)) >>> 0);
  const ratio = residentDisposition(steadSeed, resIdx) * band.priceMul;
  const board = dealBoard(rand, goods.sells, goods.wants, OFFERS_PER_DAY, ratio);
  if (band.extraOffer) {
    const pool = band.id === "cherished"
      ? goods.rare : goods.sells.filter((id) => !board.some((o) => o.get[0] === id));
    board.push(...dealBoard(rand, pool, goods.wants, 1, ratio));
  }
  for (const o of board) o.warmed = band.priceMul < 1; // the board shows a friendly price
  return board;
}

// is this resident's stead friendly enough to deal its good prices?
// (the old two-trades-a-day warmth, folded into standing)
export function isWarmed(steadRec) {
  return bandOf(standingOf(steadRec)).priceMul < 1;
}

// register a completed trade against a resident's record (the per-day
// trade count is kept for the save and for errands; standing does the rest)
export function recordTrade(record, day) {
  if (record.tradeDay !== day) { record.tradeDay = day; record.trades = 0; }
  record.trades++;
}

// --- placement (pure function of seed + chunk) --------------------------------

// Which placement a world uses (terrain.settlementMode, set by makeGenerator):
//   "cells"  — settlements.js: spaced cells, a density field, size tiers
//              (every world created from this version on)
//   "legacy" — the original one-chunk stead on an independent per-chunk roll,
//              kept for worlds saved before it, so their steads (and every
//              standing record keyed to them) stay exactly where they were
const modeOf = (terrain) => terrain.settlementMode || "cells";

// the stead ANCHORED at chunk (cx, cz) — its key chunk — or null. In cells
// mode a multi-chunk settlement answers only at its anchor (use steadsInChunk
// for "what covers this chunk").
export function steadForChunk(terrain, cx, cz) {
  if (modeOf(terrain) === "legacy") return legacySteadForChunk(terrain, cx, cz);
  const [gx, gz] = cellOfChunk(cx, cz);
  const plan = settlementForCell(terrain, gx, gz);
  return plan && plan.cx === cx && plan.cz === cz ? plan : null;
}

// every stead whose footprint covers chunk (cx, cz) — what the generator
// stamps there (at most one: footprints keep inside their cell)
export function steadsInChunk(terrain, cx, cz) {
  if (modeOf(terrain) === "legacy") {
    const p = legacySteadForChunk(terrain, cx, cz);
    return p ? [p] : [];
  }
  const [gx, gz] = cellOfChunk(cx, cz);
  const plan = settlementForCell(terrain, gx, gz);
  return plan && planCoversChunk(plan, cx, cz) ? [plan] : [];
}

// Does this chunk carry a Living Stead, and its full build plan? Null on any
// chunk a ruin or a delving already claims (honest mutual exclusion), on the
// hash miss, or where the terrain won't hold it (drowned / against the
// ceiling). Everything downstream — stamp, residents, the pause-menu finder —
// derives from this one seeded plan.
function legacySteadForChunk(terrain, cx, cz) {
  const cache = terrain._legacyStead || (terrain._legacyStead = new Map());
  const k = `${cx},${cz}`;
  if (cache.has(k)) return cache.get(k);
  if (cache.size > 4096) cache.clear();
  const plan = legacyPlan(terrain, cx, cz);
  cache.set(k, plan);
  return plan;
}

function legacyPlan(terrain, cx, cz) {
  const seed = terrain.seed;
  // mutual exclusion: a stead never shares a chunk with a Steads-Before ruin
  // or a Delvings-Under head-frame (asked honestly, not re-rolled)
  if (ruinForChunk(terrain, cx, cz)) return null;
  if (delveForChunk(terrain, cx, cz)) return null;
  if (hash2(cx, cz, seed ^ 0x57ead1) >= STEAD_RATE) return null;

  // small uniform jitter (0..1) shifts the whole homestead without letting any
  // footprint (max local 14) cross a chunk edge — no cross-chunk coordination
  const jx = hash2(cx, cz, seed ^ 0x57ead2) < 0.5 ? 0 : 1;
  const jz = hash2(cx, cz, seed ^ 0x57ead3) < 0.5 ? 0 : 1;
  const ox = (cx << 4) + jx, oz = (cz << 4) + jz;
  const wellX = ox + 8, wellZ = oz + 8;
  const h = terrain.heightAt(wellX, wellZ);
  if (h <= SEA_LEVEL + 1 || h >= HEIGHT - 18) return null;

  const residentCount = 2 + (hash2(cx, cz, seed ^ 0x57ead4) < 0.5 ? 0 : 1); // 2..3

  // seeded distinct job assignment
  const jobs = JOBS.slice();
  const jr = mulberry32((seed ^ Math.imul(cx, 0x27d4eb2f) ^ Math.imul(cz, 0x165667b1)) >>> 0);
  for (let i = jobs.length - 1; i > 0; i--) {
    const j = (jr() * (i + 1)) | 0;
    [jobs[i], jobs[j]] = [jobs[j], jobs[i]];
  }

  // building centres (local), doors faced toward the well/courtyard
  const centers = [[ox + 4, oz + 4], [ox + 12, oz + 4], [ox + 4, oz + 12]];
  const buildings = [];
  for (let i = 0; i < residentCount; i++) {
    const [bx, bz] = centers[i];
    // door on the wall nearest the well; ties fall to the z wall
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

  const residents = [];
  for (let i = 0; i < residentCount; i++) {
    residents.push({
      job: jobs[i % jobs.length], homeIdx: i,
      seed: (seed ^ Math.imul(cx, 0x9e3779b1) ^ Math.imul(cz, 0x85ebca77) ^ (i * 0x1000193)) >>> 0,
    });
  }

  const garden = { x0: ox + 10, x1: ox + 14, z0: oz + 10, z1: oz + 14, floorY: h,
    gate: { x: ox + 12, z: oz + 10 } };
  return {
    cx, cz, x: wellX, z: wellZ, h, seed, key: `${cx},${cz}`,
    tier: TIERS.hamlet.id, span: 1, chunks: [[cx, cz]],
    x0: cx << 4, z0: cz << 4, x1: (cx << 4) + 15, z1: (cz << 4) + 15,
    well: { x: wellX, y: h, z: wellZ }, leash: LEASH,
    residentCount, buildings, residents, garden, gardens: [garden],
  };
}

// --- stamping (intact, chunk-local) ------------------------------------------

export function stampStead(chunk, plan) {
  const x0c = chunk.cx << 4, z0c = chunk.cz << 4;
  const put = (wx, y, wz, id) => {
    const lx = wx - x0c, lz = wz - z0c;
    if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || y < 1 || y >= HEIGHT) return;
    chunk.set(lx, y, lz, id);
  };
  const get = (wx, y, wz) => chunk.get(wx - x0c, y, wz - z0c);
  const { h } = plan;

  // flatten a pad to the stead's single terrace height: clear headroom, floor
  // the footprint, pack the sunken columns below so it sits ON the land
  const pad = (xa, xb, za, zb, clearTo) => {
    for (let wz = za; wz <= zb; wz++) for (let wx = xa; wx <= xb; wx++) {
      for (let y = h + 1; y <= clearTo; y++) put(wx, y, wz, AIR);
      put(wx, h, wz, GRASS);
      for (let y = h - 1; y > Math.max(1, h - 12); y--) {
        const cur = get(wx, y, wz);
        if (cur !== AIR && cur !== WATER && cur !== ICE) break;
        put(wx, y, wz, DIRT);
      }
    }
  };

  // --- the buildings: intact 5x5 cabins ---------------------------------------
  for (const b of plan.buildings) {
    const { x0, x1, z0, z1, floorY, roofY, door, torch } = b;
    pad(x0, x1, z0, z1, roofY + 2);
    // plank floor
    for (let wz = z0; wz <= z1; wz++) for (let wx = x0; wx <= x1; wx++) {
      put(wx, floorY, wz, PLANKS);
    }
    // walls: knotwood corner posts, cobble base course, planks above
    for (let wz = z0; wz <= z1; wz++) for (let wx = x0; wx <= x1; wx++) {
      const edge = wx === x0 || wx === x1 || wz === z0 || wz === z1;
      if (!edge) continue;
      const corner = (wx === x0 || wx === x1) && (wz === z0 || wz === z1);
      // leave the doorway open (a two-tall gap on the door wall)
      const isDoor = wx === door.x && wz === door.z;
      if (isDoor) {
        put(wx, floorY + 1, wz, DOOR_OPEN);
        put(wx, floorY + 2, wz, DOOR_TOP_OPEN);
        put(wx, floorY + 3, wz, PLANKS); // lintel over the door
        continue;
      }
      if (corner) {
        for (let y = floorY + 1; y <= roofY; y++) put(wx, y, wz, LOG);
        continue;
      }
      put(wx, floorY + 1, wz, COBBLE);
      put(wx, floorY + 2, wz, PLANKS);
      put(wx, floorY + 3, wz, PLANKS);
    }
    // a glass window on each side wall (mid course, wall centre)
    for (const [gx, gz] of [[b.cx, z0], [b.cx, z1], [x0, b.cz], [x1, b.cz]]) {
      if (gx === door.x && gz === door.z) continue;
      if (BLOCKS[get(gx, floorY + 2, gz)] && get(gx, floorY + 2, gz) === PLANKS) {
        put(gx, floorY + 2, gz, GLASS);
      }
    }
    // roof: a whole plank lid, with a torch on a corner for the lit wall
    for (let wz = z0; wz <= z1; wz++) for (let wx = x0; wx <= x1; wx++) {
      put(wx, roofY, wz, PLANKS);
    }
    put(x0 + 1, roofY + 1, z0 + 1, TORCH);
    // the hearth torch inside, on the floor by the back wall
    put(torch.x, torch.y, torch.z, TORCH);
  }

  // --- the well: a cobble curb around a water column, two posts, a slab cap --
  const { x: wx, z: wz } = plan.well;
  pad(wx - 1, wx + 1, wz - 1, wz + 1, h + 4);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    if (dx === 0 && dz === 0) continue;
    put(wx + dx, h, wz + dz, COBBLE);       // floor ring
    put(wx + dx, h + 1, wz + dz, COBBLE);   // raised curb
  }
  for (let y = h; y > h - 3; y--) put(wx, y, wz, WATER); // the shaft of water
  put(wx, h - 3, wz, COBBLE);
  put(wx - 1, h + 2, wz - 1, LOG); put(wx + 1, h + 2, wz + 1, LOG); // posts
  put(wx - 1, h + 3, wz - 1, LOG); put(wx + 1, h + 3, wz + 1, LOG);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    put(wx + dx, h + 4, wz + dz, PLANK_SLAB); // the little roof
  }

  // --- the fenced meal-root patches (a hamlet keeps one, a village more) -----
  for (const g of plan.gardens || [plan.garden]) {
    if (!g) continue;
    pad(g.x0, g.x1, g.z0, g.z1, h + 3);
    for (let wzz = g.z0; wzz <= g.z1; wzz++) for (let wxx = g.x0; wxx <= g.x1; wxx++) {
      const edge = wxx === g.x0 || wxx === g.x1 || wzz === g.z0 || wzz === g.z1;
      if (edge) {
        if (wxx === g.gate.x && wzz === g.gate.z) put(wxx, h + 1, wzz, GATE);
        else put(wxx, h + 1, wzz, FENCE);
      } else {
        put(wxx, h, wzz, FARMLAND);
        put(wxx, h + 1, wzz, CROP_RIPE);
      }
    }
  }
}

// --- what part of a stead is this? (standing: wreck / steal) -----------------

// the stead's own built pieces: breaking one of these inside the footprint
// is taking the stead apart (the turf pad, dirt and stone under it are just
// ground, and don't count)
const STRUCTURE_IDS = new Set([
  PLANKS, LOG, COBBLE, GLASS, TORCH, DOOR, DOOR_OPEN, DOOR_TOP_OPEN, FENCE, GATE,
  PLANK_SLAB, FARMLAND,
]);
const CROP_IDS = new Set([CROP_RIPE]);

// is world cell (x, y, z) — which held `brokenId` — part of a Living Stead?
// Returns { plan, kind: "steal" | "wreck" } or null. Pure (seed + coords).
export function steadPartAt(terrain, x, y, z, brokenId) {
  const plan = steadsInChunk(terrain, x >> 4, z >> 4)[0];
  if (!plan) return null;
  const inBox = (x0, x1, z0, z1, y0, y1) =>
    x >= x0 && x <= x1 && z >= z0 && z <= z1 && y >= y0 && y <= y1;
  const gardens = (plan.gardens || [plan.garden]).filter(Boolean);
  const inPatch = gardens.some((g) => inBox(g.x0, g.x1, g.z0, g.z1, plan.h, plan.h + 1));
  if (CROP_IDS.has(brokenId) && inPatch) return { plan, kind: "steal" };
  if (!STRUCTURE_IDS.has(brokenId) && !(brokenId >= DOOR && brokenId <= DOOR + 3)) return null;
  const w = plan.well;
  const inStead =
    plan.buildings.some((b) => inBox(b.x0, b.x1, b.z0, b.z1, b.floorY, b.roofY + 1)) ||
    inBox(w.x - 1, w.x + 1, w.z - 1, w.z + 1, plan.h - 3, plan.h + 4) ||
    inPatch;
  return inStead ? { plan, kind: "wreck" } : null;
}

// --- persistent resident records (additive save field) -----------------------

// seed the stead's resident records exactly once per world (keyed on the
// stead, like the ruins' chest loot). A regenerated chunk re-stamps its
// BLOCKS but never re-deals its residents — a killed steadfolk stays gone, a
// warmed one keeps its warmth until dawn.
export function seedSteadState(world, plan) {
  if (world.steads.has(plan.key)) return;
  world.steads.set(plan.key, {
    standing: 0, gainDay: -1, gainToday: 0, // standing.js
    residents: plan.residents.map((r) => ({
      job: r.job, homeIdx: r.homeIdx, hp: STEADFOLK_HP,
      trades: 0, tradeDay: -1, dead: false,
      stock: {}, // stock.js ledger — empty = a full shelf
    })),
  });
}

// Nearest stead to a point: the expanding chunk-ring scan the ruin/delve
// finders share (cheap — pure hash prediction, no generation).
export function findNearestStead(terrain, fromX, fromZ, maxRings = 64) {
  const pcx = Math.floor(fromX / CHUNK), pcz = Math.floor(fromZ / CHUNK);
  for (let r = 0; r <= maxRings; r++) {
    let best = null, bestD = Infinity;
    const tryChunk = (cx, cz) => {
      const stead = steadForChunk(terrain, cx, cz);
      if (!stead) return;
      const d = (stead.x - fromX) ** 2 + (stead.z - fromZ) ** 2;
      if (d < bestD) { bestD = d; best = stead; }
    };
    if (r === 0) {
      tryChunk(pcx, pcz);
    } else {
      for (let i = -r; i <= r; i++) {
        tryChunk(pcx + i, pcz - r);
        tryChunk(pcx + i, pcz + r);
        if (i > -r && i < r) {
          tryChunk(pcx - r, pcz + i);
          tryChunk(pcx + r, pcz + i);
        }
      }
    }
    if (best) return best;
  }
  return null;
}

// --- the resident manager: spawn/despawn + life touches ----------------------

// Instantiates a stead's Steadfolk as live mobs when the player is near and
// their chunk is loaded; folds them back into their saved records (hp, warmth)
// when the player leaves — the honest "persist" (like a chest's contents, the
// residents are only LIVE entities while you're there to see them). Also drives
// the cheap life touches: a thin smoke column off one roof.
export class Steads {
  constructor(terrain, mobs, particles) {
    this.terrain = terrain;
    this.mobs = mobs;
    this.particles = particles;
    this.active = new Map(); // key -> { plan, entries: [{resIdx, mob}] }
    this._smokeT = 0;
  }

  update(dt, world, player) {
    const pcx = Math.floor(player.pos.x / CHUNK), pcz = Math.floor(player.pos.z / CHUNK);
    // a footprint must be wholly generated before its folk wake (a resident
    // standing over an unloaded chunk would hang there)
    const ready = (plan) => (plan.chunks || [[plan.cx, plan.cz]])
      .every(([cx, cz]) => world.isGenerated(cx, cz));
    // 1. which steads WANT to be live this frame? (anchors within reach: a
    // dense village's anchor sits up to ~1.5 chunks off its well)
    const want = new Map();
    const R = this.terrain.settlementMode === "legacy" ? 3 : 6;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const cx = pcx + dx, cz = pcz + dz;
      const plan = steadForChunk(this.terrain, cx, cz);
      if (!plan || !ready(plan)) continue;
      const d = Math.hypot(plan.x - player.pos.x, plan.z - player.pos.z);
      if (d <= ACTIVATE_DIST) want.set(plan.key, plan);
    }

    // 2. deactivate steads that drifted out of range (write hp back, remove)
    for (const [key, act] of this.active) {
      const plan = act.plan;
      const d = Math.hypot(plan.x - player.pos.x, plan.z - player.pos.z);
      const gone = d > DEACTIVATE_DIST || !ready(plan);
      if (want.has(key) && !gone) continue;
      const rec = world.steads.get(key);
      for (const e of act.entries) {
        if (rec && rec.residents[e.resIdx] && this.mobs.mobs.includes(e.mob)) {
          rec.residents[e.resIdx].hp = e.mob.hp;
        }
        this.mobs.removeMob(e.mob);
      }
      this.active.delete(key);
    }

    // 3. activate the newly-near steads (spawn their living residents)
    for (const [key, plan] of want) {
      if (this.active.has(key)) continue;
      seedSteadState(world, plan);
      const rec = world.steads.get(key);
      const entries = [];
      for (let i = 0; i < plan.residents.length; i++) {
        const r = rec && rec.residents[i] ? rec.residents[i] : null;
        if (r && r.dead) continue;
        const res = plan.residents[i];
        const home = plan.buildings[res.homeIdx];
        // stand them in the courtyard just outside their door
        const sx = home.door.x + home.door.nx + 0.5;
        const sz = home.door.z + home.door.nz + 0.5;
        const mob = this.mobs.spawnAt(sx, plan.h + 1.01, sz, "steadfolk", {
          variant: res.seed % 4, job: res.job,
        });
        if (!mob) continue;
        mob.stead = { wx: plan.x, wy: plan.h, wz: plan.z, leash: plan.leash };
        mob.buildings = plan.buildings;
        mob.homeIdx = res.homeIdx;
        mob.job = res.job;
        mob.steadKey = key;
        mob.resIdx = i;
        mob.record = r;
        mob.steadSeed = plan.seed;
        if (r && Number.isFinite(r.hp)) mob.hp = Math.max(1, Math.min(STEADFOLK_HP, r.hp));
        entries.push({ resIdx: i, mob });
      }
      this.active.set(key, { plan, entries });
    }

    // 4. manner: a wary or hostile stead's folk step away from the player
    // (standing.js fleeDist) — the generic flee state, re-armed while close
    for (const [key, act] of this.active) {
      const rec = world.steads.get(key);
      const flee = bandOf(standingOf(rec)).fleeDist;
      if (!flee) continue;
      for (const e of act.entries) {
        const m = e.mob;
        const d = Math.hypot(m.x - player.pos.x, m.z - player.pos.z);
        if (d < flee && m.state !== "flee") {
          m.state = "flee";
          m.stateT = 2.5;
          m.yaw = Math.atan2(m.x - player.pos.x, m.z - player.pos.z);
        }
      }
    }

    // 5. life touch: a thin smoke column off the nearest active stead's roof
    this._smokeT -= dt;
    if (this._smokeT <= 0 && this.particles) {
      this._smokeT = 0.5;
      let near = null, nd = 48;
      for (const [, act] of this.active) {
        const d = Math.hypot(act.plan.x - player.pos.x, act.plan.z - player.pos.z);
        if (d < nd) { nd = d; near = act.plan; }
      }
      if (near) {
        const b = near.buildings[0];
        // a couple of faint grey puffs drifting up off the chimney corner
        this.particles.burst(b.x0 + 0.6, b.roofY + 1.2, b.z0 + 0.6, [0.62, 0.6, 0.58], 3);
      }
    }
  }

  // dawn: zero every resident's per-day trade count (the day's tally that
  // errands read). Standing itself is not a daily thing — it persists.
  resetWarmth(world) {
    for (const [, rec] of world.steads) {
      for (const r of rec.residents) { r.trades = 0; r.tradeDay = -1; }
    }
  }

  // fold EVERY live resident back into its stead record at once — the
  // deactivate branch of update, applied unconditionally. A Cinder Door
  // crossing calls this before the world swaps out from under the manager:
  // steadfolk keep to their patch of the Upturn, they don't cross skies.
  foldAll(world) {
    for (const [key, act] of this.active) {
      const rec = world.steads.get(key);
      for (const e of act.entries) {
        if (rec && rec.residents[e.resIdx] && this.mobs.mobs.includes(e.mob)) {
          rec.residents[e.resIdx].hp = e.mob.hp;
        }
        this.mobs.removeMob(e.mob);
      }
      this.active.delete(key);
    }
  }
}

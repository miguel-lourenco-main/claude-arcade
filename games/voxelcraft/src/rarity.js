// Rarity -> value: the one shared worth of every item in the Upturn.
//
// Every economic system (fair trades, trader stock, ore veins, loot) reads
// the same two numbers from here, so they can never disagree about what a
// thing is worth:
//
//   rarityOf(id) in [0, 1]  — 0 is underfoot everywhere, 1 is one-of-a-kind
//   valueOf(id)  = f(rarity) — a positive "worth" on a log scale
//
// Items enter the world three ways, and the resolver seeds each from how:
//   1. NATURAL: found, mined, harvested, fished or dropped by a creature.
//      Each source carries a CHANCE (relative to a dirt block = 1: how often
//      a Wanderling comes across one unit for ordinary effort). Block drops
//      (`drops`, `randomDrop`) and creature drops inherit their source's
//      chance scaled by the drop odds.
//   2. MADE: workbench/field recipes, kiln smelts and Loomstone weaves. The
//      output's value is what its inputs cost, plus a small making premium,
//      per unit made. The recipe graph has cycles (ingot <-> block), so the
//      resolver relaxes to the CHEAPEST source of every item (a fixpoint, like
//      shortest paths) rather than walking a topological order.
//   3. GEAR: tools and armor are floored at their tier's band, so a cheap
//      recipe can't make a sky-iron Cracker read as ordinary.
//   Anything with no source (internal states, unobtainables) falls back to
//   DEFAULT_RARITY, and a hidden facing/state variant takes its base item's.
//
// An explicit `rarity:` on a def() always wins over the computed seed. It may
// be a number in [0, 1] or a display-tier id ("deepkept" -> that band's mid).
//
// The tiers below are a DISPLAY layer only (the Satchel's hover names); every
// system computes with the continuous number.

import { BLOCKS, AIR } from "./blocks.js";
import * as B from "./blocks.js";
import { RECIPES } from "./craft.js";
import { SMELTS, FUEL_SECONDS, SMELT_SECONDS } from "./kiln.js";
import { WEAVES } from "./loom.js";
import { SPECIES } from "./mobs.js";

// --- the value curve ------------------------------------------------------------
// value = VALUE_AT_ZERO * 10^(RARITY_DECADES * rarity): five decades of worth,
// 0.1 at rarity 0 up to 10000 at rarity 1. A dirt block (chance 1) lands at
// rarity 0.2 / value 1, the unit everything else is priced against.
export const RARITY_DECADES = 5;
export const VALUE_AT_ZERO = 0.1;
export const DEFAULT_RARITY = 0.25;
const MAKE_PREMIUM = 1.15;   // a made thing is worth 15% over its inputs
const GLEAM_JAR_VALUE = 12;  // one whole jar of gleam, for the Loomstone's weaves
const FUEL_ID = B.COAL_ORE;  // smelts are costed in coal (the cheapest full burn)

export function valueOfRarity(r) {
  return VALUE_AT_ZERO * 10 ** (RARITY_DECADES * clamp01(r));
}

export function rarityOfValue(v) {
  if (!(v > 0)) return 0;
  return clamp01(Math.log10(v / VALUE_AT_ZERO) / RARITY_DECADES);
}

// chance (relative to dirt = 1) -> rarity: one decade rarer = 1/5 rarer
export function rarityOfChance(c) {
  return rarityOfValue(1 / Math.max(1e-9, c));
}

// --- natural sources --------------------------------------------------------------
// Relative odds of coming across one unit (dirt = 1). These are tuning
// estimates of how the terrain/spawn code actually deals things out, not
// measured rates; adjust here, never in the consumers.
export const NATURAL_CHANCE = {
  [B.DIRT]: 1, [B.COBBLE]: 1, [B.SAND]: 1, [B.GRAVEL]: 0.8, [B.LOG]: 0.8,
  [B.MUD]: 0.7, [B.SANDSTONE]: 0.6, [B.CACTUS]: 0.4, [B.POPPY]: 0.3,
  [B.DANDELION]: 0.3, [B.TALLGRASS]: 1, [B.LEAVES]: 1, [B.LEAVES_COLD]: 0.6,
  [B.BERRY_BUSH]: 0.3, [B.REEDS]: 0.4, [B.MOSS_CLUMP]: 0.2,
  // random drops off near-free breaks: a tree sheds dozens of leaves and a
  // meadow is all tall grass, so 1/chance would overprice what falls out of
  // them — these state the per-unit odds directly (max with the derived one)
  [B.SAPLING]: 0.4, [B.ROOT_SEED]: 0.6, [B.BOGBEAN_POD]: 0.3,
  // the deep: coal everywhere, sky-iron below y28, gloamgold under the
  // Emberwash line, and starstone only where a pearl landed or the deep
  // cave skin keeps one
  [B.COAL_ORE]: 0.25, [B.IRON_ORE]: 0.08, [B.GLOAM_ORE]: 0.02,
  [B.STARSTONE]: 0.004, [B.WISPCAP]: 0.1, [B.GLEAM_MOSS]: 0.1,
  // farming and fishing (renewable, but each wants time)
  [B.MEAL_ROOT]: 0.5, [B.BOGBEAN]: 0.4, [B.SILVERFIN]: 0.3,
  [B.CINDERGLASS]: 0.1, // slaked from a pail of the Emberwash
  // the far country: a Cinder Door away, so a step rarer than its near twin
  [B.PEARLSAND]: 0.3, [B.STARKELP]: 0.15,
};

// how often a Wanderling meets (and fells) one of each creature — scaled by
// each species' drop counts to give its drops a chance
export const SPECIES_CHANCE = {
  snuffet: 0.3, murkling: 0.25, stalkid: 0.15, mirewalker: 0.04,
  shellback: 0.03, unshaken: 0.001, undertow: 0.0007,
};

// --- gear bands -------------------------------------------------------------------
const TOOL_TIER_BAND = { 1: 0.15, 2: 0.3, 3: 0.45, 4: 0.6 };
const ARMOR_TIER_BAND = { bark: 0.2, iron: 0.45, gloam: 0.6, wing: 0.6, nacre: 0.7 };

// --- display tiers (UI only) -------------------------------------------------------
// Provisional folk-register names (see LORE.md's naming contract); the owner
// may rename them freely — ids are what overrides and code refer to.
export const RARITY_TIERS = [
  { id: "underfoot", name: "Underfoot", min: 0 },
  { id: "everyday", name: "Everyday", min: 0.25 },
  { id: "seamwise", name: "Seamwise", min: 0.4 },
  { id: "deepkept", name: "Deepkept", min: 0.55 },
  { id: "pearlrare", name: "Pearl-rare", min: 0.7 },
];

export function tierForRarity(r) {
  let t = RARITY_TIERS[0];
  for (const tier of RARITY_TIERS) if (r >= tier.min) t = tier;
  return t;
}

// an override written as a tier id lands mid-band
function overrideRarity(o) {
  if (typeof o === "number" && Number.isFinite(o)) return clamp01(o);
  if (typeof o === "string") {
    const i = RARITY_TIERS.findIndex((t) => t.id === o);
    if (i >= 0) {
      const lo = RARITY_TIERS[i].min;
      const hi = i + 1 < RARITY_TIERS.length ? RARITY_TIERS[i + 1].min : 1;
      return (lo + hi) / 2;
    }
  }
  return null;
}

// --- the resolver -------------------------------------------------------------------

let cache = null; // Float64Array of rarities, indexed by block id

// Resolve every item's rarity (once; cached). `force` re-runs it — tests use
// that after poking a def's override.
export function resolveRarity({ force = false } = {}) {
  if (cache && !force) return cache;
  const n = BLOCKS.length;
  const value = new Array(n).fill(Infinity);
  const offer = (id, v) => { if (id > 0 && id < n && v < value[id]) { value[id] = v; return true; } return false; };

  // 1. natural seeds, plus what natural blocks drop when broken
  const chance = new Array(n).fill(0);
  const addChance = (id, c) => { if (id > 0 && id < n) chance[id] = Math.max(chance[id], c); };
  for (const [idStr, c] of Object.entries(NATURAL_CHANCE)) {
    const id = Number(idStr);
    addChance(id, c);
    const b = BLOCKS[id];
    if (!b) continue;
    // per-source yield: the plain drop and a random bonus of the same id add up
    const yieldOf = {};
    const d = b.drops === undefined ? id : b.drops;
    if (d != null && d !== id) yieldOf[d] = (yieldOf[d] || 0) + 1;
    if (b.randomDrop) yieldOf[b.randomDrop.id] = (yieldOf[b.randomDrop.id] || 0) + b.randomDrop.chance;
    for (const [dropId, k] of Object.entries(yieldOf)) addChance(Number(dropId), c * k);
  }
  for (const [species, c] of Object.entries(SPECIES_CHANCE)) {
    const spec = SPECIES[species];
    if (!spec || !spec.drops) continue;
    for (const [id, k] of spec.drops) addChance(id, c * k);
  }
  for (let id = 1; id < n; id++) if (chance[id] > 0) offer(id, 1 / chance[id]);

  // 2. made things: relax to the cheapest source until nothing improves
  const coalPerSmelt = SMELT_SECONDS / (FUEL_SECONDS[FUEL_ID] || 80);
  const sources = [];
  for (const r of RECIPES) sources.push({ out: r.out[0], k: r.out[1], ins: r.in, extra: 0 });
  for (const w of Object.values(WEAVES)) {
    sources.push({ out: w.out, k: 1, ins: w.mats, extra: w.levels * GLEAM_JAR_VALUE });
  }
  for (const [inStr, out] of Object.entries(SMELTS)) {
    sources.push({ out, k: 1, ins: [[Number(inStr), 1], [FUEL_ID, coalPerSmelt]], extra: 0 });
  }
  // the pail scoops the world's own fluids for free: a full pail is its tub
  if (B.PAIL) {
    sources.push({ out: B.WATER_PAIL, k: 1, ins: [[B.PAIL, 1]], extra: 0 });
    sources.push({ out: B.EMBER_PAIL, k: 1, ins: [[B.PAIL, 1]], extra: 0 });
  }
  for (let pass = 0; pass < 64; pass++) {
    let changed = false;
    for (const s of sources) {
      let cost = s.extra;
      for (const [id, k] of s.ins) cost += value[id] * k;
      if (Number.isFinite(cost) && offer(s.out, (cost * MAKE_PREMIUM) / s.k)) changed = true;
    }
    if (!changed) break;
  }

  // 3. value -> rarity, gear floors, variants, fallback, overrides
  const out = new Float64Array(n);
  for (let id = 0; id < n; id++) {
    const b = BLOCKS[id];
    if (!b || id === AIR) { out[id] = 0; continue; }
    let r = Number.isFinite(value[id]) ? rarityOfValue(value[id]) : null;
    if (b.tool && TOOL_TIER_BAND[b.tool.tier] != null) r = Math.max(r ?? 0, TOOL_TIER_BAND[b.tool.tier]);
    if (b.armor && ARMOR_TIER_BAND[b.armor.tier] != null) r = Math.max(r ?? 0, ARMOR_TIER_BAND[b.armor.tier]);
    out[id] = r ?? NaN;
  }
  for (let id = 1; id < n; id++) {
    const b = BLOCKS[id];
    if (!b || !Number.isNaN(out[id])) continue;
    // a facing/state variant (stairs east, an open gate, a sprouting crop)
    // is worth what breaking it gives back
    const base = b.drops != null ? b.drops : b.base;
    out[id] = base != null && base !== id && !Number.isNaN(out[base]) ? out[base] : DEFAULT_RARITY;
  }
  for (let id = 1; id < n; id++) {
    const o = BLOCKS[id] ? overrideRarity(BLOCKS[id].rarity) : null;
    if (o != null) out[id] = o;
  }
  cache = out;
  return cache;
}

export function rarityOf(id) {
  const r = resolveRarity();
  return id > 0 && id < r.length ? r[id] : 0;
}

export function valueOf(id) {
  return valueOfRarity(rarityOf(id));
}

// the worth of n units of an item (trades, loot, stock all price stacks)
export function stackValue(id, n = 1) {
  return valueOf(id) * n;
}

// the display tier of an item ({id, name, min})
export function rarityTier(id) {
  return tierForRarity(rarityOf(id));
}

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

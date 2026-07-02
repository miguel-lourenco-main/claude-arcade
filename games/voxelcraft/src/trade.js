// The Peddler's ledger: a small table of barters, three of which are chalked
// up each day. The day's picks are deterministic from world seed + day
// number, so every Wanderling in the same world sees the same board — and
// tomorrow it rotates. Trades are conveniences, never shortcuts: everything
// here can be gotten some slower, muddier way.

import {
  BERRIES, IRON_ORE, COBBLE, TORCH, MEAL_ROOT, SLING_STONE, PLANKS, BOAT,
  COAL_ORE, GLASS, GRAVEL, MOSS_CLUMP, ROOT_SEED, SILVERFIN, ROAST_LOIN,
  STONE_PICK,
} from "./blocks.js";
import { mulberry32 } from "./noise.js";

// {give: [[id, n], ...], get: [id, n]} — give is what the player hands over
export const OFFERS = [
  // forage for ore: the peddler knows a seam you don't
  { give: [[BERRIES, 8]], get: [IRON_ORE, 2] },
  // rubble for light: he dips the pitch himself
  { give: [[COBBLE, 12]], get: [TORCH, 6] },
  // lunch for ammunition: knapped on the walk between villages
  { give: [[MEAL_ROOT, 3]], get: [SLING_STONE, 10] },
  // lumber for a hull: pricier than a workbench, but he lashes it right here
  { give: [[PLANKS, 10]], get: [BOAT, 1] },
  // coal for glass: he carries panes wrapped in moss, somehow unbroken
  { give: [[COAL_ORE, 2]], get: [GLASS, 4] },
  // gravel for coal: he sieves out what the river hid
  { give: [[GRAVEL, 12]], get: [COAL_ORE, 3] },
  // moss for pips: bedding for his pack beasts, seeds from his pockets
  { give: [[MOSS_CLUMP, 3]], get: [ROOT_SEED, 4] },
  // cold fish for a hot roast: he cooked this morning and regrets nothing
  { give: [[SILVERFIN, 2]], get: [ROAST_LOIN, 1] },
  // coal for a spare Cracker: he knaps one fresh on the walk between villages
  { give: [[COAL_ORE, 4]], get: [STONE_PICK, 1] },
];

export const OFFERS_PER_DAY = 3;

// the day's three offers, deterministic in (seed, day) — a seeded partial
// Fisher-Yates over the table indices
export function dailyOffers(seed, day) {
  const rand = mulberry32((seed ^ Math.imul(day + 1, 0x9e3779b9)) >>> 0);
  const idx = OFFERS.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, OFFERS_PER_DAY).map((i) => OFFERS[i]);
}

export function canAfford(offer, inventory) {
  return offer.give.every(([id, n]) => inventory.count(id) >= n);
}

// hand over the goods: consumes the give side from anywhere in the inventory
// and adds the get side. Returns the count of the payout that did NOT fit
// (caller spills it as a ground drop), or -1 if the player couldn't pay.
export function executeTrade(offer, inventory) {
  if (!canAfford(offer, inventory)) return -1;
  for (const [id, n] of offer.give) inventory.removeCount(id, n);
  return inventory.add(offer.get[0], offer.get[1]);
}

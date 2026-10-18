// Trader stock and what traders carry (see LORE.md: Standing). Two halves
// of the same fork — friend or raider:
//
//   FRIEND: a trader's goods are finite. Each good it sells holds a few
//   trades' worth (its CAP) and restocks one trade at a time on a timer
//   (its REFILL). Common goods hold more and come back fast; rare goods
//   hold one and come back over days. A sold-out line stays on the board,
//   greyed, until it restocks. Both numbers come from rarity.js, so the
//   stock rules agree with the prices and the loot.
//
//   RAIDER: a trader felled by the player drops what it carries (a job's
//   pocket goods) plus a share of its unsold stock. The stead remembers
//   (standing.js: a killing is -40), and the dead stay dead (steads.js),
//   so that resident's board is gone for good.
//
// Time here is WORLD seconds: (sky.day + sky.time) * DAY_LENGTH.

import { rarityOf, valueOf } from "./rarity.js";
import { maxStackFor } from "./inventory.js";
import {
  MEAL_ROOT, ROOT_SEED, BERRIES, PLANKS, IRON_INGOT, LOG, COAL_ORE, TORCH,
  SILVERFIN,
} from "./blocks.js";
import { BUNDLE_VALUE } from "./trade.js";

export const STOCK_CAP_MAX = 6;   // trades held by the commonest good
export const REFILL_BASE = 60;    // world seconds to restock one trade of a rarity-0 good
export const LOOT_SHARE = 0.5;    // share of unsold stock a felled trader drops

// how many trades of `id` a trader holds when fully stocked: 6 at rarity 0,
// falling linearly to 1 for the rarest
export function stockCap(id) {
  return Math.max(1, Math.round(STOCK_CAP_MAX * (1 - rarityOf(id))));
}

// world seconds to restock ONE trade of `id`: a minute at rarity 0, a day
// (600 s) around rarity 0.5, days for the rare goods (10^(2r) growth)
export function refillSeconds(id) {
  return REFILL_BASE * 10 ** (2 * rarityOf(id));
}

// --- the stock ledger: { [id]: [units, t] } -----------------------------------
// `units` is how many trades are on hand as of world time `t`. An absent
// entry is a full shelf. Restocking is lazy: reading the ledger credits
// whole refills since t (and keeps the remainder of a partial one).

export function stockLeft(ledger, id, now) {
  const cap = stockCap(id);
  const e = ledger && ledger[id];
  if (!e) return cap;
  const [units, t] = e;
  if (units >= cap) return cap;
  const per = refillSeconds(id);
  const credit = Math.floor(Math.max(0, now - t) / per);
  return Math.min(cap, units + credit);
}

// spend one trade of `id`; false (nothing spent) if sold out
export function takeStock(ledger, id, now) {
  const cap = stockCap(id);
  const per = refillSeconds(id);
  const e = ledger[id];
  let units, t;
  if (!e) { units = cap; t = now; } else {
    [units, t] = e;
    if (units >= cap) { units = cap; t = now; } else {
      const credit = Math.floor(Math.max(0, now - t) / per);
      units = Math.min(cap, units + credit);
      // keep the partial refill's progress (unless the shelf just filled)
      t = units >= cap ? now : t + credit * per;
    }
  }
  if (units <= 0) { ledger[id] = [0, t]; return false; }
  ledger[id] = [units - 1, t];
  return true;
}

// the units a ledger's shelf holds for each id in `ids` (for the board / loot)
export function shelf(ledger, ids, now) {
  return ids.map((id) => [id, stockLeft(ledger, id, now)]);
}

// --- save shape -----------------------------------------------------------------
// [[id, units, t], ...] — only the entries that differ from a full shelf

export function ledgerToSave(ledger) {
  if (!ledger) return [];
  return Object.entries(ledger).map(([id, [u, t]]) => [Number(id), u | 0, Math.round(t)]);
}

export function ledgerFromSave(arr) {
  const ledger = {};
  if (!Array.isArray(arr)) return ledger;
  for (const e of arr) {
    if (!Array.isArray(e) || e.length < 3) continue;
    const [id, u, t] = e;
    if (!Number.isInteger(id) || id <= 0 || !Number.isFinite(u) || !Number.isFinite(t)) continue;
    ledger[id] = [Math.max(0, u | 0), t];
  }
  return ledger;
}

// --- loot (the raider path) -------------------------------------------------------

// what each job keeps in its pockets: [id, min, max]
export const JOB_CARRY = {
  grower: [[MEAL_ROOT, 2, 4], [ROOT_SEED, 1, 3], [BERRIES, 1, 3]],
  wright: [[PLANKS, 4, 8], [LOG, 1, 2], [IRON_INGOT, 0, 2]],
  keeper: [[COAL_ORE, 1, 3], [TORCH, 2, 4], [SILVERFIN, 0, 2]],
  peddler: [[COAL_ORE, 0, 2], [BERRIES, 1, 3]],
};

// the bundle size a trader deals `id` in (the same sizing trade.js uses)
function bundleOf(id) {
  return Math.max(1, Math.min(16, maxStackFor(id), Math.round(BUNDLE_VALUE / valueOf(id))));
}

// everything a felled trader drops: its job's pocket goods (seeded counts)
// plus LOOT_SHARE of its unsold stock in its own bundle sizes. `sells` is
// the trader's goods, `ledger` its stock, `rand` a seeded [0,1) source.
// Returns [[id, n], ...] with n > 0, merged per id.
export function traderLoot(job, sells, ledger, now, rand = Math.random) {
  const out = new Map();
  const add = (id, n) => { if (n > 0) out.set(id, (out.get(id) || 0) + n); };
  for (const [id, lo, hi] of JOB_CARRY[job] || []) add(id, lo + Math.floor(rand() * (hi - lo + 1)));
  for (const id of sells) {
    const units = stockLeft(ledger, id, now);
    add(id, Math.floor(units * LOOT_SHARE) * bundleOf(id));
  }
  return [...out];
}

// the total worth of a drop list (tests / tuning)
export function lootValue(loot) {
  return loot.reduce((a, [id, n]) => a + valueOf(id) * n, 0);
}

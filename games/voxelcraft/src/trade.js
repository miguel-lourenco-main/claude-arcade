// The Peddler's ledger: a small table of barters, three of which are chalked
// up each day. The day's picks are deterministic from world seed + day
// number, so every Wanderling in the same world sees the same board — and
// tomorrow it rotates. Trades are conveniences, never shortcuts: everything
// here can be gotten some slower, muddier way.

import {
  BERRIES, IRON_ORE, COBBLE, TORCH, MEAL_ROOT, SLING_STONE, PLANKS, BOAT,
  COAL_ORE, GLASS, GRAVEL, MOSS_CLUMP, ROOT_SEED, SILVERFIN, ROAST_LOIN,
  STONE_PICK, COMPASS, BARK_JERKIN, IRON_TREADS, IRON_INGOT, STARSTONE, RAIL,
  KELPSALVE, QUILL, PAIL, ROCKET_SUN, ROCKET_EMBER, ROCKET_GLEAM,
} from "./blocks.js";
import { mulberry32, hash2 } from "./noise.js";
import { valueOf } from "./rarity.js";
import { maxStackFor } from "./inventory.js";

// --- fair value (rarity.js) ---------------------------------------------------
// Every barter is priced so what you hand over is worth what you get, by the
// shared value table, times a RATIO: 1 is dead fair, above 1 the trader comes
// out ahead. The ratio is the trader's disposition (set once, at "birth") x
// the standing band's price (standing.js) x a small daily jitter inside the
// fair band. Counts are whole units, so rounding is the only other slack.
export const FAIR_BAND = 0.1;         // daily jitter: ±10% around the ratio
export const DISPOSITION_MIN = 0.85;  // the kindest-born trader
export const DISPOSITION_MAX = 1.2;   // the sharpest
export const BUNDLE_VALUE = 12;       // what a typical offer's get side is worth
const MAX_GET = 16;                   // never more than this many of a thing
const MAX_GIVE = 64;                  // or ask for more than a stack

// a trader's disposition, fixed at birth from a seed (a resident's seed, the
// Peddler's world): uniform in [DISPOSITION_MIN, DISPOSITION_MAX]
export function dispositionOf(seed) {
  const u = hash2(seed | 0, 0x7ade, 0x5eed);
  return DISPOSITION_MIN + u * (DISPOSITION_MAX - DISPOSITION_MIN);
}

// price one pairing: how many `giveId` for getN of `getId` at `ratio`. If
// getN is omitted it is sized to BUNDLE_VALUE. Returns an offer
// {give: [[giveId, n]], get: [getId, n], ratio} or null when no whole-unit
// price fits (a pairing too lopsided to deal in a single stack).
export function priceOffer(getId, giveId, ratio = 1, getN) {
  const vGet = valueOf(getId), vGive = valueOf(giveId);
  if (!(vGet > 0 && vGive > 0) || getId === giveId) return null;
  const cap = Math.min(MAX_GET, maxStackFor(getId));
  let n = getN ?? Math.max(1, Math.min(cap, Math.round(BUNDLE_VALUE / vGet)));
  // a cheap good against a dear coin: bundle more of the good until the
  // price reaches one whole coin
  while (n < cap && (vGet * n * ratio) / vGive < 0.5) n++;
  // still under half a coin at the most we'd sell: no fair price exists
  if ((vGet * n * ratio) / vGive < 0.5) return null;
  let give = Math.max(1, Math.round((vGet * n * ratio) / vGive));
  // a dear good against a cheap coin: sell fewer until it fits in a stack
  while (give > MAX_GIVE && n > 1) {
    n--;
    give = Math.max(1, Math.round((vGet * n * ratio) / vGive));
  }
  if (give > MAX_GIVE) return null;
  return { give: [[giveId, give]], get: [getId, n], ratio };
}

// how fair an offer actually came out: what's handed over / what's got
export function offerRatio(offer) {
  const giveV = offer.give.reduce((a, [id, n]) => a + valueOf(id) * n, 0);
  return giveV / (valueOf(offer.get[0]) * offer.get[1]);
}

// deal n offers from a trader's pools: each picks the next of the shuffled
// `sells`, pairs it with a seeded pick from `wants`, and prices it at
// ratio x jitter. Deterministic in `rand`.
export function dealBoard(rand, sells, wants, n, ratio) {
  const idx = sells.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const out = [];
  for (const i of idx) {
    if (out.length >= n) break;
    const getId = sells[i];
    const jitter = 1 + (rand() * 2 - 1) * FAIR_BAND;
    // try the wants in a seeded rotation until one prices
    const start = (rand() * wants.length) | 0;
    for (let k = 0; k < wants.length; k++) {
      const offer = priceOffer(getId, wants[(start + k) % wants.length], ratio * jitter);
      if (offer) { out.push(offer); break; }
    }
  }
  return out;
}

// {give: [[id, n], ...], get: [id, n]} — give is what the player hands over.
// These are the Peddler's PAIRINGS and his get counts; the give counts here
// are the original hand-set prices, kept for reference — dailyOffers reprices
// every line by fair value (priceOffer) at his disposition.
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
  // ore for a Homeward Needle: he smelts and cases one on the road — knowing
  // the way home is his stock-in-trade
  { give: [[IRON_ORE, 6]], get: [COMPASS, 1] },
  // lumber for a bark jerkin: he boils the bark in his supper pot, allegedly
  // after the supper
  { give: [[PLANKS, 12]], get: [BARK_JERKIN, 1] },
  // ore for sky-iron treads: hammered flat on a River Rubble anvil — his own
  // hand-feet have walked in worse
  { give: [[IRON_ORE, 8]], get: [IRON_TREADS, 1] },
  // a fortune for a fallen pearl: he swears he marked where it came down,
  // and the price says he means it (the Pearlfall's starstone, meteors.js)
  { give: [[IRON_INGOT, 8]], get: [STARSTONE, 1] },
  // ore for waybars: he smelts and pegs them on the walk — a peddler knows
  // the worth of a road that carries the pack for you
  { give: [[IRON_ORE, 6]], get: [RAIL, 8] },
  // berries for Kelpsalve: he renders the glands himself and won't say how
  // he gets them ("politely")
  { give: [[BERRIES, 6]], get: [KELPSALVE, 1] },
  // lumber for quills: he whittles as he walks — it keeps the hands honest
  { give: [[PLANKS, 2]], get: [QUILL, 8] },
  // ore for a riveted Pail: he hammers and rivets one watertight on the road —
  // a peddler who fords as many streams as he does swears by a full tub
  { give: [[IRON_ORE, 4]], get: [PAIL, 1] },
];

export const OFFERS_PER_DAY = 3;

// Fairday: every seventh day the Wanderlings send light back up to thank the
// old sky for its pearls, and the Peddler turns up with an armful of Festival
// Rockets. One rocket offer takes the top of the board on those days — a
// festival price the flower-picker's recipe undercuts, but he saves the walk.
export const FAIR_OFFERS = [
  { give: [[BERRIES, 4]], get: [ROCKET_SUN, 6], fair: true },
  { give: [[BERRIES, 4]], get: [ROCKET_EMBER, 6], fair: true },
  { give: [[BERRIES, 4]], get: [ROCKET_GLEAM, 6], fair: true },
];

// is `day` a Fairday? Day 0 is a Wanderling's first waking — the festival
// lands on days 7, 14, 21, ...
export function isFairday(day) { return day > 0 && day % 7 === 0; }

// the day's three offers, deterministic in (seed, day) — a seeded partial
// Fisher-Yates over the table indices
export function dailyOffers(seed, day) {
  const rand = mulberry32((seed ^ Math.imul(day + 1, 0x9e3779b9)) >>> 0);
  const idx = OFFERS.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  // reprice each pairing by value: the Peddler's disposition is his world's
  // (one wanderer per world), with the day's jitter inside the fair band
  const disp = dispositionOf(seed ^ 0x9edd1e);
  const picks = idx.slice(0, OFFERS_PER_DAY).map((i) => {
    const o = OFFERS[i];
    const jitter = 1 + (rand() * 2 - 1) * FAIR_BAND;
    return priceOffer(o.get[0], o.give[0][0], disp * jitter, o.get[1]) || o;
  });
  // Fairday: the day's rocket takes the top slot (which variant rotates with
  // the same seeded stream, so the whole world sees the same festival board)
  if (isFairday(day)) {
    picks[0] = FAIR_OFFERS[(rand() * FAIR_OFFERS.length) | 0];
  }
  return picks;
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

// Standing: what a Living Stead thinks of you (see LORE.md). One signed
// number per stead, -100..+100, starting at 0, persisted on the stead's
// record (world.steads, additive save field). It is the shared axis two
// systems read:
//   - the trades (trade value, which offers appear, the discount), and
//   - the residents' manner (wary folk step away, hostile folk won't deal).
//
// It rises with good turns: a trade, a liked gift, a finished errand. It
// falls with bad ones: a kick, a killing, crops pulled from the stead's
// own patch, the stead's walls taken apart. The old per-day "warmth" (two
// trades and the third came cheaper) is folded into the positive end of
// this axis: a friendly stead discounts every barter, and remembers.
//
// Good turns are capped per stead per day so a patient Wanderling can't
// farm a stead's love by trading one pebble forty times; bad turns are not
// capped (the Upturn is polite, not forgetful).

import { valueOf } from "./rarity.js";
import {
  POPPY, DANDELION, BOGBEAN_POD, ROOT_SEED, IRON_INGOT, GLOAM_INGOT, LOG,
  STARGLASS, SILVERFIN, COAL_ORE, POTTAGE, ROAST_LOIN, NACRE,
} from "./blocks.js";

export const STANDING_MIN = -100;
export const STANDING_MAX = 100;

// the bands, low to high. `min` is inclusive. Effects are what the consumers
// read: priceMul scales what a resident asks for (the give side), extraOffer
// adds a fourth line to the board, refuseTrade closes the window, fleeDist is
// how close you may come before a resident steps away (0 = never).
export const BANDS = [
  { id: "hostile", name: "Hostile", min: STANDING_MIN,
    priceMul: 1.5, refuseTrade: true, fleeDist: 10, extraOffer: false },
  { id: "wary", name: "Wary", min: -60,
    priceMul: 1.25, refuseTrade: false, fleeDist: 3, extraOffer: false },
  { id: "neutral", name: "Neutral", min: -20,
    priceMul: 1, refuseTrade: false, fleeDist: 0, extraOffer: false },
  { id: "friendly", name: "Friendly", min: 20,
    priceMul: 0.9, refuseTrade: false, fleeDist: 0, extraOffer: true },
  { id: "cherished", name: "Cherished", min: 60,
    priceMul: 0.8, refuseTrade: false, fleeDist: 0, extraOffer: true },
];

// how far each kind of turn moves a stead's standing
export const EVENTS = {
  trade: 2,     // a barter completed
  quest: 8,     // an errand finished for a resident (quests.js)
  hit: -10,     // a resident kicked or struck by the player
  kill: -40,    // a resident killed by the player
  steal: -4,    // a ripe crop pulled from the stead's own patch
  wreck: -2,    // one block of the stead's own building taken apart
};
// `gift` is computed per item: see giftStanding
export const DAILY_GAIN_CAP = 12; // good turns (trade/gift) per stead per day

// what each job is glad to be given (the rest is merely polite)
export const LIKES = {
  grower: [POPPY, DANDELION, BOGBEAN_POD, ROOT_SEED],
  wright: [IRON_INGOT, GLOAM_INGOT, LOG, STARGLASS],
  keeper: [SILVERFIN, COAL_ORE, POTTAGE, ROAST_LOIN, NACRE],
};

export function clampStanding(s) {
  return Math.max(STANDING_MIN, Math.min(STANDING_MAX, Number.isFinite(s) ? s : 0));
}

export function bandOf(standing) {
  const s = clampStanding(standing);
  let band = BANDS[0];
  for (const b of BANDS) if (s >= b.min) band = b;
  return band;
}

export function bandIndex(id) {
  return BANDS.findIndex((b) => b.id === id);
}

// a stead record's standing, defaulting the field in place for older saves
export function standingOf(rec) {
  if (!rec) return 0;
  if (!Number.isFinite(rec.standing)) rec.standing = 0;
  return rec.standing;
}

// the standing a gift earns: scaled by what the item is worth (rarity.js),
// doubled for something the resident's job likes. One unit per gift.
export function giftStanding(job, id) {
  const v = valueOf(id);
  const base = Math.max(0.5, Math.min(5, Math.log10(Math.max(1, v)) * 2 + 1));
  const liked = (LIKES[job] || []).includes(id);
  return Math.round((liked ? base * 2 : base) * 2) / 2; // half-point steps
}

// apply one turn to a stead record. `amount` overrides the event's table
// value (gifts). Good turns respect the per-day cap. Returns
// { before, after, delta, band, bandChanged }.
export function applyStanding(rec, event, day, amount) {
  const before = standingOf(rec);
  let delta = Number.isFinite(amount) ? amount : (EVENTS[event] || 0);
  if (delta > 0 && (event === "trade" || event === "gift")) {
    if (rec.gainDay !== day) { rec.gainDay = day; rec.gainToday = 0; }
    delta = Math.max(0, Math.min(delta, DAILY_GAIN_CAP - (rec.gainToday || 0)));
    rec.gainToday = (rec.gainToday || 0) + delta;
  }
  rec.standing = clampStanding(before + delta);
  const was = bandOf(before), now = bandOf(rec.standing);
  return { before, after: rec.standing, delta: rec.standing - before, band: now, bandChanged: was !== now };
}

// the light global aggregate: the mean standing over every stead the world
// has met (0 before the first). Read by the pause menu / quests; word does
// not yet travel between steads (phase 2).
export function globalStanding(steads) {
  let sum = 0, n = 0;
  for (const [, rec] of steads || []) { sum += standingOf(rec); n++; }
  return n ? sum / n : 0;
}

// --- save shape ------------------------------------------------------------------
// rides each stead's save entry as an optional third element:
// [standing, gainDay, gainToday]
export function standingToSave(rec) {
  return [Math.round(standingOf(rec) * 2) / 2, rec.gainDay | 0, rec.gainToday || 0];
}

export function standingFromSave(rec, arr) {
  if (!Array.isArray(arr)) { rec.standing = 0; return; }
  const [s, gainDay, gainToday] = arr;
  rec.standing = clampStanding(s);
  rec.gainDay = Number.isFinite(gainDay) ? gainDay | 0 : -1;
  rec.gainToday = Number.isFinite(gainToday) ? Math.max(0, gainToday) : 0;
}

// Fair-value trades (trade.js pricing + the boards that use it). Run with:
// node test/trade.test.mjs
import "./_hooks.cjs";
import { check, section, done } from "./_assert.cjs";

const B = await import("../src/blocks.js");
const T = await import("../src/trade.js");
const ST = await import("../src/steads.js");
const { valueOf } = await import("../src/rarity.js");
const { mulberry32 } = await import("../src/noise.js");

section("priceOffer: whole-unit prices that match value");
{
  const tradeable = B.BLOCKS.map((b, id) => id).filter((id) => id > 0 && !B.BLOCKS[id].hidden);
  const rand = mulberry32(7);
  let tried = 0, priced = 0, worst = 0, bigOk = true;
  const errs = [];
  for (let k = 0; k < 4000; k++) {
    const g = tradeable[(rand() * tradeable.length) | 0];
    const c = tradeable[(rand() * tradeable.length) | 0];
    const ratio = 0.8 + rand() * 0.6;
    const o = T.priceOffer(g, c, ratio);
    tried++;
    if (!o) continue;
    priced++;
    const err = Math.abs(T.offerRatio(o) / ratio - 1);
    errs.push(err);
    // rounding one coin is the only slack: bounded by half a coin's worth
    const bound = (0.5 * valueOf(c)) / (valueOf(g) * o.get[1] * ratio) + 1e-9;
    if (err > bound) bigOk = false;
    if (o.give[0][1] >= 4) worst = Math.max(worst, err * (o.give[0][1] - 0.5) / 0.5); // normalized: <= 1
    if (o.give[0][1] > 64 || o.get[1] > 16 || o.get[1] < 1 || o.give[0][1] < 1) bigOk = false;
  }
  errs.sort((a, b) => a - b);
  check(priced > tried * 0.6, `most random pairings price (${priced}/${tried})`);
  check(bigOk, "every price is within half a coin of fair, in one stack, 1..16 of the good");
  check(worst <= 1 + 1e-9, `with four+ coins, never off by more than half a coin (worst ${worst.toFixed(3)} of the bound)`);
  check(errs[errs.length >> 1] < 0.1, `the median offer is within 10% of the ratio (${errs[errs.length >> 1].toFixed(3)})`);
  check(T.priceOffer(B.DIRT, B.DIRT) === null, "an item never trades for itself");
  const tool = T.priceOffer(B.IRON_PICK, B.IRON_INGOT, 1);
  check(tool && tool.get[1] === 1, "a tool sells one at a time (its stack ceiling)");
}

section("disposition: fixed at birth, inside its band");
{
  let inBand = true;
  const seen = new Set();
  for (let s = 0; s < 500; s++) {
    const d = T.dispositionOf(s);
    if (d < T.DISPOSITION_MIN || d > T.DISPOSITION_MAX) inBand = false;
    seen.add(d.toFixed(6));
  }
  check(inBand, "dispositions stay in [0.85, 1.2]");
  check(seen.size > 300, "and vary from trader to trader");
  check(T.dispositionOf(1234) === T.dispositionOf(1234), "the same seed is the same bargainer");
  const a = ST.residentDisposition(99, 0), b = ST.residentDisposition(99, 1);
  check(a !== b && a === ST.residentDisposition(99, 0), "each resident of a stead is born its own bargainer");
}

section("the Peddler's board: authored pairings, fair-value prices");
{
  let fair = true, deterministic = true, rockets = 0;
  for (let day = 0; day < 120; day++) {
    const board = T.dailyOffers(4242, day);
    const again = T.dailyOffers(4242, day);
    if (JSON.stringify(board) !== JSON.stringify(again)) deterministic = false;
    for (const o of board) {
      if (o.fair) { rockets++; continue; } // the Fairday rocket is a festival bargain
      const r = T.offerRatio(o);
      const slack = (0.5 * valueOf(o.give[0][0])) / (valueOf(o.get[0]) * o.get[1]);
      if (r < T.DISPOSITION_MIN * (1 - T.FAIR_BAND) - slack || r > T.DISPOSITION_MAX * (1 + T.FAIR_BAND) + slack) fair = false;
      if (!T.OFFERS.some((p) => p.get[0] === o.get[0] && p.give[0][0] === o.give[0][0])) fair = false;
    }
  }
  check(deterministic, "the board is a pure function of (seed, day)");
  check(fair, "every line is an authored pairing, priced within disposition x the fair band");
  check(rockets >= 15, `Fairday still tops the board with a rocket (${rockets} in 120 days)`);
}

section("a steadfolk's board: value-fair pairings from its job's goods");
{
  let fromJob = true, fair = true, three = true, rareOk = true;
  for (let day = 0; day < 40; day++) for (const job of ST.JOBS) {
    const goods = ST.JOB_GOODS[job];
    const board = ST.steadOffers(555, 2, job, day, 0);
    if (board.length !== 3) three = false;
    const disp = ST.residentDisposition(555, 2);
    for (const o of board) {
      if (!goods.sells.includes(o.get[0]) || !goods.wants.includes(o.give[0][0])) fromJob = false;
      const slack = (0.5 * valueOf(o.give[0][0])) / (valueOf(o.get[0]) * o.get[1]);
      const r = T.offerRatio(o);
      if (r < disp * (1 - T.FAIR_BAND) - slack - 1e-9 || r > disp * (1 + T.FAIR_BAND) + slack + 1e-9) fair = false;
    }
    const cherished = ST.steadOffers(555, 2, job, day, 90);
    if (cherished.length !== 4 || !goods.rare.includes(cherished[3].get[0])) rareOk = false;
  }
  check(three, "a neutral stead deals three lines");
  check(fromJob, "every line sells the job's goods for something the job wants");
  check(fair, "...priced within the resident's disposition x the fair band (+ rounding)");
  check(rareOk, "a cherished customer is offered one of the job's rare goods");
}

done();

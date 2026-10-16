// Standing / reputation (standing.js + its stead wiring). Run with:
// node test/standing.test.mjs
import "./_hooks.cjs";
import { check, section, done, near } from "./_assert.cjs";

const B = await import("../src/blocks.js");
const S = await import("../src/standing.js");
const ST = await import("../src/steads.js");
const { World } = await import("../src/world.js");
const { makeGenerator } = await import("../src/terrain.js");

section("bands");
{
  check(S.bandOf(0).id === "neutral", "a new stead is neutral");
  check(S.bandOf(-100).id === "hostile" && S.bandOf(100).id === "cherished", "the ends");
  check(S.bandOf(20).id === "friendly" && S.bandOf(19.5).id === "neutral", "friendly starts at +20");
  check(S.bandOf(-20).id === "neutral" && S.bandOf(-20.5).id === "wary", "wary starts below -20");
  check(S.bandOf(-60).id === "wary" && S.bandOf(-60.5).id === "hostile", "hostile starts below -60");
  check(S.bandOf(999).id === "cherished" && S.bandOf(NaN).id === "neutral", "out-of-range clamps; NaN reads 0");
  let mono = true;
  for (let i = 1; i < S.BANDS.length; i++) if (!(S.BANDS[i].priceMul < S.BANDS[i - 1].priceMul)) mono = false;
  check(mono, "prices fall as standing rises");
  check(S.BANDS.find((b) => b.id === "hostile").refuseTrade, "a hostile stead refuses to trade");
  check(S.BANDS.find((b) => b.id === "wary").fleeDist > 0, "wary folk step away");
  check(S.BANDS.find((b) => b.id === "friendly").extraOffer, "a friendly stead deals an extra offer");
}

section("turns: good ones capped per day, bad ones not");
{
  const rec = {};
  check(S.standingOf(rec) === 0 && rec.standing === 0, "an old record defaults to 0 in place");
  let r = S.applyStanding(rec, "trade", 5);
  check(r.after === 2 && r.delta === 2, "a trade is +2");
  for (let i = 0; i < 20; i++) S.applyStanding(rec, "trade", 5);
  check(rec.standing === S.DAILY_GAIN_CAP, `good turns stop at the daily cap (${rec.standing})`);
  r = S.applyStanding(rec, "trade", 6);
  check(rec.standing === S.DAILY_GAIN_CAP + 2, "a new day lifts the cap");
  S.applyStanding(rec, "quest", 6);
  check(rec.standing === S.DAILY_GAIN_CAP + 10, "an errand is +8 and isn't held to the trade cap");
  r = S.applyStanding(rec, "kill", 6);
  check(r.after === S.DAILY_GAIN_CAP + 10 - 40 && r.bandChanged, "a killing is -40, and moves the band");
  for (let i = 0; i < 20; i++) S.applyStanding(rec, "hit", 6);
  check(rec.standing === S.STANDING_MIN, "bad turns are uncapped but clamp at -100");
  check(S.applyStanding({}, "steal", 1).after === -4 && S.applyStanding({}, "wreck", 1).after === -2,
    "stealing a crop is -4, a wrecked block -2");
}

section("gifts");
{
  const plain = S.giftStanding("wright", B.DIRT);
  const liked = S.giftStanding("wright", B.IRON_INGOT);
  const sameNotLiked = S.giftStanding("grower", B.IRON_INGOT);
  check(plain >= 0.5 && plain <= 2, `a handful of dirt is a token kindness (${plain})`);
  near(liked, sameNotLiked * 2, 0.51, `a liked gift counts double (${liked} vs ${sameNotLiked})`);
  check(S.giftStanding("keeper", B.NACRE) > S.giftStanding("keeper", B.COAL_ORE), "a rarer liked gift counts more");
  const rec = {};
  S.applyStanding(rec, "gift", 1, 9);
  S.applyStanding(rec, "gift", 1, 9);
  check(rec.standing === S.DAILY_GAIN_CAP, "gifts share the daily cap with trades");
}

section("the global aggregate");
{
  check(S.globalStanding(new Map()) === 0, "no steads met: 0");
  const m = new Map([["0,0", { standing: 40 }], ["1,1", { standing: -20 }], ["2,2", {}]]);
  near(S.globalStanding(m), (40 - 20 + 0) / 3, 1e-12, "the mean over every stead met");
}

section("save: standing rides each stead entry (additive)");
{
  const w = new World(1234);
  w.steads.set("3,-4", { standing: 37.5, gainDay: 9, gainToday: 6,
    residents: [{ job: "wright", homeIdx: 0, hp: 10, trades: 2, tradeDay: 9, dead: false }] });
  const saved = JSON.parse(JSON.stringify(w.serializeSteads()));
  const w2 = new World(1234);
  w2.loadSteads(saved);
  const rec = w2.steads.get("3,-4");
  check(rec && rec.standing === 37.5 && rec.gainDay === 9 && rec.gainToday === 6, "round-trips standing + its daily tally");
  check(rec.residents[0].job === "wright" && rec.residents[0].trades === 2, "residents still round-trip");
  // an older save: [key, residents] with no third element
  const w3 = new World(1234);
  w3.loadSteads([["3,-4", [["grower", 0, 10, 0, -1, 0]]]]);
  check(w3.steads.get("3,-4").standing === 0, "an older save's stead loads neutral");
  const w4 = new World(1234);
  w4.loadSteads([["3,-4", [["grower", 0, 10, 0, -1, 0]], ["junk", null]]]);
  check(w4.steads.get("3,-4").standing === 0, "a garbage standing entry falls back to 0");
}

section("the stead's board reads standing (warmth folded in)");
{
  const neutral = ST.steadOffers(77, 0, "grower", 3, 0);
  const friendly = ST.steadOffers(77, 0, "grower", 3, 30);
  const cherished = ST.steadOffers(77, 0, "grower", 3, 80);
  const wary = ST.steadOffers(77, 0, "grower", 3, -40);
  check(neutral.length === 3 && friendly.length === 4, "neutral deals three, friendly a fourth");
  const giveOf = (o) => o.give.reduce((a, [, n]) => a + n, 0);
  let cheaper = true, dearer = true;
  for (let i = 0; i < 3; i++) {
    if (!(giveOf(cherished[i]) <= giveOf(friendly[i]) && giveOf(friendly[i]) <= giveOf(neutral[i]))) cheaper = false;
    if (!(giveOf(wary[i]) >= giveOf(neutral[i]))) dearer = false;
    if (neutral[i].get[0] !== friendly[i].get[0]) cheaper = false; // same day, same goods
  }
  check(cheaper, "friendlier means cheaper, same goods");
  check(dearer, "a wary stead asks more");
  check(ST.isWarmed({ standing: 25 }) && !ST.isWarmed({ standing: 5 }), "isWarmed is now 'friendly or better'");
}

section("what part of a stead is a broken block? (wreck / steal)");
{
  const { terrain } = makeGenerator(42);
  const plan = ST.findNearestStead(terrain, 0, 0, 80);
  check(!!plan, "a stead exists near the origin of seed 42");
  if (plan) {
    const b = plan.buildings[0];
    const wall = ST.steadPartAt(terrain, b.x0, b.floorY + 2, b.z0 + 1, B.PLANKS);
    check(wall && wall.kind === "wreck" && wall.plan.key === plan.key, "a cottage wall plank is wrecking");
    const g = plan.garden;
    const crop = ST.steadPartAt(terrain, g.x0 + 1, plan.h + 1, g.z0 + 1, B.CROP_RIPE);
    check(crop && crop.kind === "steal", "a ripe crop from the patch is stealing");
    check(ST.steadPartAt(terrain, b.x0, b.floorY + 2, b.z0 + 1, B.DIRT) === null, "plain ground inside isn't the stead's");
    check(ST.steadPartAt(terrain, plan.x + 200, plan.h, plan.z, B.PLANKS) === null, "far away isn't the stead's");
    const door = ST.steadPartAt(terrain, b.door.x, b.floorY + 1, b.door.z, B.DOOR_OPEN);
    check(door && door.kind === "wreck", "the stead's door is part of it");
  }
}

done();

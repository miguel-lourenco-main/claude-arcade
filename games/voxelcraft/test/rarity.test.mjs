// Rarity -> value (rarity.js). Run with: node test/rarity.test.mjs
import "./_hooks.cjs";
import { check, section, done, near } from "./_assert.cjs";

const B = await import("../src/blocks.js");
const R = await import("../src/rarity.js");
const { BLOCKS } = B;

section("every item resolves to a finite rarity in [0, 1]");
{
  let bad = [];
  for (let id = 1; id < BLOCKS.length; id++) {
    if (!BLOCKS[id]) continue;
    const r = R.rarityOf(id);
    if (!(Number.isFinite(r) && r >= 0 && r <= 1)) bad.push(`${BLOCKS[id].name}=${r}`);
  }
  check(bad.length === 0, `all ${BLOCKS.length - 1} items in range${bad.length ? ": " + bad.join(", ") : ""}`);
  check(R.rarityOf(B.AIR) === 0, "air is worth nothing");
}

section("the value curve");
{
  near(R.valueOfRarity(0), R.VALUE_AT_ZERO, 1e-12, "rarity 0 -> VALUE_AT_ZERO");
  near(R.valueOfRarity(1), R.VALUE_AT_ZERO * 10 ** R.RARITY_DECADES, 1e-6, "rarity 1 -> the top of the curve");
  for (const v of [0.3, 1, 7, 140, 5000]) {
    near(R.valueOfRarity(R.rarityOfValue(v)), v, v * 1e-9, `value ${v} round-trips through rarity`);
  }
  check(R.rarityOfValue(0) === 0 && R.rarityOfValue(1e12) === 1, "rarityOfValue clamps to [0, 1]");
  near(R.valueOf(B.DIRT), 1, 1e-9, "a dirt block is the unit of value");
  let mono = true;
  for (let r = 0; r < 1; r += 0.01) if (R.valueOfRarity(r + 0.01) <= R.valueOfRarity(r)) mono = false;
  check(mono, "value is strictly increasing in rarity");
}

section("natural seeds follow how rarely things turn up");
{
  const ladder = [B.DIRT, B.COAL_ORE, B.IRON_ORE, B.GLOAM_ORE, B.STARSTONE, B.DUSK_PEARL];
  let ok = true;
  for (let i = 1; i < ladder.length; i++) if (!(R.rarityOf(ladder[i]) > R.rarityOf(ladder[i - 1]))) ok = false;
  check(ok, "dirt < coal < sky-iron ore < gloamgold ore < starstone < dusk pearl");
  near(R.rarityOf(B.COAL_ORE), R.rarityOfChance(R.NATURAL_CHANCE[B.COAL_ORE]), 1e-12,
    "a natural block's rarity is its chance's rarity");
  // the bramble yields its berries + a 50% bonus: 1.5 per bush
  near(R.valueOf(B.BERRIES), 1 / (R.NATURAL_CHANCE[B.BERRY_BUSH] * 1.5), 1e-9,
    "block drops inherit the source's chance times the yield");
  check(R.rarityOf(B.TIDEHEART) > R.rarityOf(B.NACRE), "a boss drop outranks the trash mob's");
}

section("made things cost their inputs plus a premium, at the cheapest source");
{
  check(R.valueOf(B.IRON_INGOT) > R.valueOf(B.IRON_ORE), "the ingot is worth more than its ore");
  // four ingots fold into a block: block = 4 ingots x premium
  near(R.valueOf(B.IRON_BLOCK), 4 * R.valueOf(B.IRON_INGOT) * 1.15, 1e-6, "a block is four ingots plus the premium");
  // ...and the block unfolds back to four ingots, but that cycle must never
  // CHEAPEN the ingot below its ore-smelting price
  check(R.valueOf(B.IRON_INGOT) <= (R.valueOf(B.IRON_BLOCK) * 1.15) / 4, "the ingot<->block cycle settles on the cheapest source");
  near(R.valueOf(B.PLANKS), (R.valueOf(B.LOG) * 1.15) / 4, 1e-9, "one log makes four planks' worth");
  // the torch is dropped by mirewalkers too, but the recipe is cheaper
  check(R.valueOf(B.TORCH) < 1 / (R.SPECIES_CHANCE.mirewalker * 4), "the cheapest source wins (torch: recipe over drop)");
  check(R.valueOf(B.STARGLASS) > R.valueOf(B.STARSTONE), "the kiln adds worth (starstone -> starglass)");
  check(R.valueOf(B.WANDERWING) > R.valueOf(B.MOSS_CLUMP) * 6, "a Loomstone weave counts its gleam jars");
}

section("gear is floored at its tier band");
{
  check(R.rarityOf(B.PLANK_PICK) >= 0.15, "a plank Cracker is at least tier-1 band");
  check(R.rarityOf(B.IRON_PICK) >= 0.45, "a sky-iron Cracker is at least tier-3 band");
  check(R.rarityOf(B.GLOAM_PICK) > R.rarityOf(B.IRON_PICK), "gloamgold outranks sky-iron");
  check(R.rarityOf(B.STAR_BLADE) > R.rarityOf(B.IRON_BLADE), "the Star-Edge's starstone lifts it above its band");
  check(R.rarityOf(B.GLOAM_JERKIN) > R.rarityOf(B.BARK_JERKIN), "armor tiers order");
}

section("variants and fallbacks");
{
  check(R.rarityOf(B.PLANK_STAIRS_E) === R.rarityOf(B.PLANK_STAIRS), "a facing variant is worth its base item");
  check(R.rarityOf(B.CROP_RIPE) === R.rarityOf(B.MEAL_ROOT), "a ripe crop is worth what it drops");
  check(R.rarityOf(B.PORTAL_FILM) === R.DEFAULT_RARITY, "a sourceless internal id falls back to the default");
}

section("an explicit override always wins");
{
  const keep = BLOCKS[B.COAL_ORE].rarity;
  BLOCKS[B.COAL_ORE].rarity = 0.9;
  R.resolveRarity({ force: true });
  near(R.rarityOf(B.COAL_ORE), 0.9, 1e-12, "a numeric override replaces the seed");
  BLOCKS[B.COAL_ORE].rarity = "deepkept";
  R.resolveRarity({ force: true });
  near(R.rarityOf(B.COAL_ORE), (0.55 + 0.7) / 2, 1e-12, "a tier-id override lands mid-band");
  check(R.rarityTier(B.COAL_ORE).id === "deepkept", "...and displays as that tier");
  BLOCKS[B.COAL_ORE].rarity = "nonsense";
  R.resolveRarity({ force: true });
  near(R.rarityOf(B.COAL_ORE), R.rarityOfChance(R.NATURAL_CHANCE[B.COAL_ORE]), 1e-12, "an unknown override is ignored");
  BLOCKS[B.COAL_ORE].rarity = keep;
  R.resolveRarity({ force: true });
}

section("display tiers");
{
  check(R.tierForRarity(0).id === "underfoot" && R.tierForRarity(1).id === "pearlrare", "the ends map to the first and last tiers");
  let ordered = true;
  for (let i = 1; i < R.RARITY_TIERS.length; i++) if (!(R.RARITY_TIERS[i].min > R.RARITY_TIERS[i - 1].min)) ordered = false;
  check(ordered, "tier thresholds ascend");
  check(R.tierForRarity(0.55).id === "deepkept" && R.tierForRarity(0.5499).id === "seamwise", "a threshold belongs to the tier above it");
  check(R.resolveRarity() === R.resolveRarity(), "the table is resolved once and cached");
}

done();

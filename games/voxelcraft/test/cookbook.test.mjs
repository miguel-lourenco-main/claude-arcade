// The ingredient-filter cookbook (cookbook.js). Run with:
// node test/cookbook.test.mjs
import "./_hooks.cjs";
import { check, section, done } from "./_assert.cjs";

const B = await import("../src/blocks.js");
const { RECIPES, BASIC_RECIPES } = await import("../src/craft.js");
const C = await import("../src/cookbook.js");

const outs = (rs) => rs.map((r) => r.out[0]);

section("the reverse index");
{
  const idx = C.ingredientIndex(RECIPES);
  let complete = true, exact = true;
  for (const r of RECIPES) for (const [id] of r.in) if (!idx.get(id).includes(r)) complete = false;
  for (const [id, list] of idx) for (const r of list) if (!r.in.some(([i]) => i === id)) exact = false;
  check(complete, "every recipe is listed under each of its ingredients");
  check(exact, "and under nothing it doesn't use");
  check(C.ingredientIndex(RECIPES) === idx, "built once per recipe list");
}

section("pins AND-narrow down to the exact recipe");
{
  const ingot = C.recipesUsingAll(RECIPES, [B.IRON_INGOT]);
  const ingotPlanks = C.recipesUsingAll(RECIPES, [B.IRON_INGOT, B.PLANKS]);
  const needle = C.recipesUsingAll(RECIPES, [B.IRON_INGOT, B.SLING_STONE]);
  check(ingot.length > 10, `sky-iron ingots go into many things (${ingot.length})`);
  check(ingotPlanks.length < ingot.length && ingotPlanks.every((r) => ingot.includes(r)), `a second pin narrows (${ingotPlanks.length})`);
  check(needle.length === 1 && needle[0].out[0] === B.COMPASS, "ingot + sling stone: exactly the Homeward Needle");
  check(C.recipesUsingAll(RECIPES, [B.DIRT]).length === 0, "an ingredient of nothing: an empty list");
  check(C.recipesUsingAll(RECIPES, []).length === 0, "no pins: nothing from this path");
}

section("'only these': made from nothing but the pins");
{
  const only = C.recipesFromOnly(RECIPES, [B.PLANKS]);
  check(only.length > 5 && only.every((r) => r.in.every(([i]) => i === B.PLANKS)), `planks alone make ${only.length} things`);
  check(!outs(only).includes(B.STONE_PICK), "a recipe needing anything else is out");
  const both = C.recipesFromOnly(RECIPES, [B.PLANKS, B.COBBLE]);
  check(outs(both).includes(B.STONE_PICK) && both.length > only.length, "pinning cobble too brings the stone tools in");
}

section("the query: pins beat hover beat tabs; search on top");
{
  const base = { pins: [], hover: null, onlyThese: false, search: "", category: "ready" };
  const nothing = () => false, everything = () => true;
  let q = C.cookbookQuery(RECIPES, base, nothing);
  check(q.mode === "tab" && q.recipes.length === 0, "the default tab is compact: only what you can make now");
  q = C.cookbookQuery(RECIPES, base, everything);
  check(q.recipes.length === RECIPES.length, "...which is everything when everything is craftable");
  q = C.cookbookQuery(RECIPES, { ...base, category: "all" }, nothing);
  check(q.recipes.length === RECIPES.length, "All shows every recipe");
  q = C.cookbookQuery(RECIPES, { ...base, category: "tools" }, nothing);
  check(q.recipes.length > 10 && q.recipes.every((r) => B.BLOCKS[r.out[0]].tool), "the Tools tab is all tools");
  q = C.cookbookQuery(RECIPES, { ...base, category: "wear" }, nothing);
  check(q.recipes.every((r) => B.BLOCKS[r.out[0]].armor), "the Wear tab is all armor");
  q = C.cookbookQuery(RECIPES, { ...base, hover: B.LOG }, nothing);
  check(q.mode === "hover" && outs(q.recipes).includes(B.PLANKS), "hovering a log previews what it makes");
  q = C.cookbookQuery(RECIPES, { ...base, pins: [B.IRON_INGOT], hover: B.SLING_STONE }, nothing);
  check(q.mode === "pins" && q.recipes.length === 1, "hover with pins previews pins + the hovered item");
  q = C.cookbookQuery(RECIPES, { ...base, pins: [B.IRON_INGOT], search: "crown" }, nothing);
  check(q.recipes.length >= 1 && q.recipes.every((r) => /crown/i.test(B.BLOCKS[r.out[0]].name)), "search narrows the pinned list");
  q = C.cookbookQuery(RECIPES, { ...base, category: "all", search: "knotwood planks" }, nothing);
  check(q.recipes.length > 10, "search matches ingredient names too");
  q = C.cookbookQuery(BASIC_RECIPES, { ...base, pins: [B.PLANKS], onlyThese: true }, nothing);
  check(q.recipes.every((r) => r.basic), "the field list only ever filters field recipes");
}

section("pinning");
{
  let pins = C.togglePin([], B.LOG);
  pins = C.togglePin(pins, B.COAL_ORE);
  check(pins.length === 2 && pins[0] === B.LOG, "a double-click pins");
  pins = C.togglePin(pins, B.LOG);
  check(pins.length === 1 && pins[0] === B.COAL_ORE, "a second double-click unpins");
}

done();

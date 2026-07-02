// Survival crafting: flat recipe list (no crafting-table grid — no tools or
// intermediate items exist, so shapes would add ceremony without depth).
// Heat conversions (sand -> glass, cobblestone -> stone, ores, cooking) are
// NOT recipes — they belong to the Kiln (see kiln.js).

import {
  LOG, PLANKS, SAND, COBBLE, STONE, BRICKS, SANDSTONE, COAL_ORE,
  TORCH, CHEST, WORKBENCH, KILN, MOSS_CLUMP, BED,
} from "./blocks.js";

// in: [[blockId, count], ...]  out: [blockId, count]
// basic recipes ("field recipes") craft anywhere; the rest need a workbench.
export const RECIPES = [
  { in: [[LOG, 1]], out: [PLANKS, 4], basic: true },
  { in: [[PLANKS, 4]], out: [WORKBENCH, 1], basic: true }, // the bootstrap path
  { in: [[COAL_ORE, 1], [PLANKS, 1]], out: [TORCH, 4], basic: true },
  { in: [[PLANKS, 8]], out: [CHEST, 1] },
  { in: [[COBBLE, 8]], out: [KILN, 1] },
  { in: [[PLANKS, 3], [MOSS_CLUMP, 2]], out: [BED, 1] },
  { in: [[SAND, 4]], out: [SANDSTONE, 1] },
  { in: [[STONE, 4]], out: [BRICKS, 4] },
];

export const BASIC_RECIPES = RECIPES.filter((r) => r.basic);

export function canCraft(recipe, inventory) {
  return recipe.in.every(([id, n]) => inventory.count(id) >= n);
}

// consumes inputs from anywhere in the inventory; returns the count of the
// output that did NOT fit (caller spills it as a ground drop), or -1 if the
// craft failed for missing inputs
export function craft(recipe, inventory) {
  if (!canCraft(recipe, inventory)) return -1;
  for (const [id, n] of recipe.in) inventory.removeCount(id, n);
  return inventory.add(recipe.out[0], recipe.out[1]);
}

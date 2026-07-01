// Survival crafting: flat recipe list (no crafting-table grid — no tools or
// intermediate items exist, so shapes would add ceremony without depth).
// Smelting-style conversions are folded in as recipes for the same reason.

import {
  LOG, PLANKS, SAND, GLASS, COBBLE, STONE, BRICKS, SANDSTONE, COAL_ORE,
  TORCH, CHEST,
} from "./blocks.js";

// in: [[blockId, count], ...]  out: [blockId, count]
export const RECIPES = [
  { in: [[LOG, 1]], out: [PLANKS, 4] },
  { in: [[PLANKS, 8]], out: [CHEST, 1] },
  { in: [[COAL_ORE, 1], [PLANKS, 1]], out: [TORCH, 4] },
  { in: [[SAND, 1]], out: [GLASS, 1] },
  { in: [[SAND, 4]], out: [SANDSTONE, 1] },
  { in: [[COBBLE, 1]], out: [STONE, 1] },
  { in: [[STONE, 4]], out: [BRICKS, 4] },
];

export function canCraft(recipe, inventory) {
  return recipe.in.every(([id, n]) => inventory.count(id) >= n);
}

export function craft(recipe, inventory) {
  if (!canCraft(recipe, inventory)) return false;
  for (const [id, n] of recipe.in) inventory.take(id, n);
  inventory.add(recipe.out[0], recipe.out[1]);
  return true;
}

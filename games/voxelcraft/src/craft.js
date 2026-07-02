// Survival crafting: flat recipe list (no crafting-table grid — no tools or
// intermediate items exist, so shapes would add ceremony without depth).
// Heat conversions (sand -> glass, cobblestone -> stone, ores, cooking) are
// NOT recipes — they belong to the Kiln (see kiln.js).

import {
  LOG, PLANKS, SAND, COBBLE, STONE, BRICKS, SANDSTONE, COAL_ORE,
  TORCH, CHEST, WORKBENCH, KILN, MOSS_CLUMP, BED, LADDER, DOOR, BLAST_KEG,
  PLANK_SLAB, STONE_SLAB, COBBLE_SLAB, PLANK_STAIRS, STONE_STAIRS, COBBLE_STAIRS,
  FENCE, GATE,
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
  { in: [[PLANKS, 2]], out: [LADDER, 3] },
  { in: [[PLANKS, 6]], out: [DOOR, 1] },
  { in: [[COAL_ORE, 4], [SAND, 5]], out: [BLAST_KEG, 1] },
  { in: [[SAND, 4]], out: [SANDSTONE, 1] },
  { in: [[STONE, 4]], out: [BRICKS, 4] },
  // shaped blocks: 3 blocks -> 6 slabs, 6 blocks -> 4 stairs (workbench)
  { in: [[PLANKS, 3]], out: [PLANK_SLAB, 6] },
  { in: [[STONE, 3]], out: [STONE_SLAB, 6] },
  { in: [[COBBLE, 3]], out: [COBBLE_SLAB, 6] },
  { in: [[PLANKS, 6]], out: [PLANK_STAIRS, 4] },
  { in: [[STONE, 6]], out: [STONE_STAIRS, 4] },
  { in: [[COBBLE, 6]], out: [COBBLE_STAIRS, 4] },
  // wattle-work: woven field fencing and its swinging gate (workbench)
  { in: [[PLANKS, 4]], out: [FENCE, 3] },
  { in: [[PLANKS, 4]], out: [GATE, 1] },
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

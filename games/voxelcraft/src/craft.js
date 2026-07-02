// Survival crafting: flat recipe list (no crafting-table grid — shapes would
// add ceremony without depth). Heat conversions (sand -> glass, cobblestone
// -> stone, ores, cooking) are NOT recipes — they belong to the Kiln
// (see kiln.js).

import {
  LOG, PLANKS, SAND, COBBLE, STONE, BRICKS, SANDSTONE, COAL_ORE,
  TORCH, CHEST, WORKBENCH, KILN, MOSS_CLUMP, BED, LADDER, DOOR, BLAST_KEG,
  PLANK_SLAB, STONE_SLAB, COBBLE_SLAB, PLANK_STAIRS, STONE_STAIRS, COBBLE_STAIRS,
  FENCE, GATE, SLING_STONE, BOAT, FISHING_POLE, SIGN,
  PLANK_PICK, STONE_PICK, IRON_PICK, PLANK_AXE, STONE_AXE, IRON_AXE,
  PLANK_SHOVEL, STONE_SHOVEL, IRON_SHOVEL, PLANK_BLADE, STONE_BLADE, IRON_BLADE,
  IRON_INGOT, IRON_BLOCK, COMPASS, CLOCK, CHART,
} from "./blocks.js";

// in: [[blockId, count], ...]  out: [blockId, count]  note: extra recipe copy
// basic recipes ("field recipes") craft anywhere; the rest need a workbench.
export const RECIPES = [
  { in: [[LOG, 1]], out: [PLANKS, 4], basic: true },
  { in: [[PLANKS, 4]], out: [WORKBENCH, 1], basic: true }, // the bootstrap path
  { in: [[COAL_ORE, 1], [PLANKS, 1]], out: [TORCH, 4], basic: true },
  // field ammunition: kick a cobble into four throwable pieces anywhere
  { in: [[COBBLE, 1]], out: [SLING_STONE, 4], basic: true },
  // the Dib-Pole: three planks whittled and lashed into a springy rod —
  // shoreline gear is field gear, so it crafts anywhere
  { in: [[PLANKS, 3]], out: [FISHING_POLE, 1], basic: true },
  // the Notice Post: a post and a planed board — Wanderlings journal in the
  // field, so notices are field gear too and craft anywhere
  { in: [[PLANKS, 3]], out: [SIGN, 2], basic: true },
  { in: [[PLANKS, 8]], out: [CHEST, 1] },
  { in: [[COBBLE, 8]], out: [KILN, 1] },
  { in: [[PLANKS, 3], [MOSS_CLUMP, 2]], out: [BED, 1] },
  { in: [[PLANKS, 2]], out: [LADDER, 3] },
  { in: [[PLANKS, 6]], out: [DOOR, 1] },
  // the Reed Skiff: five planks lashed into a shallow hull (workbench)
  { in: [[PLANKS, 5]], out: [BOAT, 1] },
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
  // --- tools (workbench). No stick item exists in the Upturn: every tool is
  // hafted on two PLANKS, with the head material on top of that — picks and
  // hewers take 3 head pieces, scoops 1, shivs 2. Iron-tier heads are
  // Sky-Iron Ingots (the kiln renders them from iron ore).
  { in: [[PLANKS, 5]], out: [PLANK_PICK, 1], note: "3 head the arc, 2 haft it" },
  { in: [[PLANKS, 5]], out: [PLANK_AXE, 1], note: "3 head the bit, 2 haft it" },
  { in: [[PLANKS, 3]], out: [PLANK_SHOVEL, 1], note: "1 heads the pan, 2 haft it" },
  { in: [[PLANKS, 4]], out: [PLANK_BLADE, 1], note: "2 whittle the sliver, 2 haft it" },
  { in: [[COBBLE, 3], [PLANKS, 2]], out: [STONE_PICK, 1], note: "the planks are the haft" },
  { in: [[COBBLE, 3], [PLANKS, 2]], out: [STONE_AXE, 1], note: "the planks are the haft" },
  { in: [[COBBLE, 1], [PLANKS, 2]], out: [STONE_SHOVEL, 1], note: "the planks are the haft" },
  { in: [[COBBLE, 2], [PLANKS, 2]], out: [STONE_BLADE, 1], note: "the planks are the haft" },
  { in: [[IRON_INGOT, 3], [PLANKS, 2]], out: [IRON_PICK, 1], note: "the planks are the haft" },
  { in: [[IRON_INGOT, 3], [PLANKS, 2]], out: [IRON_AXE, 1], note: "the planks are the haft" },
  { in: [[IRON_INGOT, 1], [PLANKS, 2]], out: [IRON_SHOVEL, 1], note: "the planks are the haft" },
  { in: [[IRON_INGOT, 2], [PLANKS, 2]], out: [IRON_BLADE, 1], note: "the planks are the haft" },
  // sky-iron, folded and unfolded: four ingots to the block and back
  { in: [[IRON_INGOT, 4]], out: [IRON_BLOCK, 1] },
  { in: [[IRON_BLOCK, 1]], out: [IRON_INGOT, 4] },
  // --- the wayfinding kit (workbench). Sky-iron instruments: four ingots
  // case each; a swinging sling stone points the Needle, soot marks the
  // Dial's hours, and eight planks board a Chart around the Needle that
  // walks its edges.
  { in: [[IRON_INGOT, 4], [SLING_STONE, 1]], out: [COMPASS, 1], note: "the stone swings, the iron leans home" },
  { in: [[IRON_INGOT, 4], [COAL_ORE, 1]], out: [CLOCK, 1], note: "soot marks the hours" },
  { in: [[PLANKS, 8], [COMPASS, 1]], out: [CHART, 1], note: "the needle walks the edges" },
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

// Survival crafting: flat recipe list (no crafting-table grid — shapes would
// add ceremony without depth). Heat conversions (sand -> glass, river rubble
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
  BARK_CROWN, BARK_JERKIN, BARK_LEGGINGS, BARK_TREADS,
  IRON_CROWN, IRON_JERKIN, IRON_LEGGINGS, IRON_TREADS,
  STARSTONE, STAR_BLADE, RAIL, CART,
  GLOAM_INGOT, GLOAM_BLOCK, GLOAM_PICK, GLOAM_AXE, GLOAM_SHOVEL, GLOAM_BLADE,
  GLOAM_CROWN, GLOAM_JERKIN, GLOAM_LEGGINGS, GLOAM_TREADS,
  PLANK_HOE, STONE_HOE, IRON_HOE, MEAL_ROOT, BOGBEAN, POTTAGE, LOOMSTONE,
  QUILL, SPRINGSTAVE, STARGLASS, MURK_LANTERN,
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
  // quills: whittled darts, fletched with leaf-scrap — field ammunition
  { in: [[PLANKS, 1]], out: [QUILL, 4], basic: true },
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
  // the Springstave: bent green, corded with moss-twine (workbench)
  { in: [[PLANKS, 3], [MOSS_CLUMP, 1]], out: [SPRINGSTAVE, 1], note: "bent green, corded with moss-twine" },
  { in: [[COAL_ORE, 4], [SAND, 5]], out: [BLAST_KEG, 1] },
  // Wanderer's Pottage: the mire and the meadow, in one pot (workbench)
  { in: [[MEAL_ROOT, 1], [BOGBEAN, 2]], out: [POTTAGE, 1], note: "the mire and the meadow, in one pot" },
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
  // the Furrower: the row-turning tine, one per tier that farms
  { in: [[PLANKS, 4]], out: [PLANK_HOE, 1], note: "2 tine the row, 2 haft it" },
  { in: [[COBBLE, 2], [PLANKS, 2]], out: [STONE_HOE, 1], note: "the planks are the haft" },
  { in: [[IRON_INGOT, 2], [PLANKS, 2]], out: [IRON_HOE, 1], note: "the planks are the haft" },
  { in: [[IRON_INGOT, 3], [PLANKS, 2]], out: [IRON_PICK, 1], note: "the planks are the haft" },
  { in: [[IRON_INGOT, 3], [PLANKS, 2]], out: [IRON_AXE, 1], note: "the planks are the haft" },
  { in: [[IRON_INGOT, 1], [PLANKS, 2]], out: [IRON_SHOVEL, 1], note: "the planks are the haft" },
  { in: [[IRON_INGOT, 2], [PLANKS, 2]], out: [IRON_BLADE, 1], note: "the planks are the haft" },
  // the Star-Edge Shiv: a landed pearl of the old sky (the Pearlfall
  // delivers them — see meteors.js), honed onto a finished sky-iron blade
  { in: [[STARSTONE, 1], [IRON_BLADE, 1]], out: [STAR_BLADE, 1], note: "a pearl's edge on a sky-iron spine" },
  // the Loomstone: a pearl bedded in stone; the light pools (see loom.js)
  { in: [[STARSTONE, 1], [STONE, 6]], out: [LOOMSTONE, 1], note: "a pearl bedded in stone; the light pools" },
  // the Murk Lantern: a starglass pane painted out with soot — a lantern
  // that sheds dark. Raise The Unshaken with it, at night, at your peril.
  { in: [[STARGLASS, 1], [COAL_ORE, 4], [IRON_INGOT, 2]], out: [MURK_LANTERN, 1], note: "a lantern that sheds dark" },
  // gloamgold tools: the deep metal, hafted on knotwood like all the rest
  { in: [[GLOAM_INGOT, 3], [PLANKS, 2]], out: [GLOAM_PICK, 1], note: "the planks are the haft" },
  { in: [[GLOAM_INGOT, 3], [PLANKS, 2]], out: [GLOAM_AXE, 1], note: "the planks are the haft" },
  { in: [[GLOAM_INGOT, 1], [PLANKS, 2]], out: [GLOAM_SHOVEL, 1], note: "the planks are the haft" },
  { in: [[GLOAM_INGOT, 2], [PLANKS, 2]], out: [GLOAM_BLADE, 1], note: "the planks are the haft" },
  // --- armor (workbench). Classic piece shapes: crown 5, jerkin 8,
  // leggings 7, treads 4 of the material. The bark set is planks boiled and
  // beaten back into stiff bark plate (cheap, modest); the sky-iron set is
  // hammered from ingots (strong). Wear them in the Satchel's wear column.
  { in: [[PLANKS, 5]], out: [BARK_CROWN, 1], note: "boiled bark, bent to the brow" },
  { in: [[PLANKS, 8]], out: [BARK_JERKIN, 1], note: "bark plate, lashed at the seam" },
  { in: [[PLANKS, 7]], out: [BARK_LEGGINGS, 1], note: "bark greaves for the walking legs" },
  { in: [[PLANKS, 4]], out: [BARK_TREADS, 1], note: "stiff wraps for the hand-feet" },
  { in: [[IRON_INGOT, 5]], out: [IRON_CROWN, 1], note: "the fallen sky, bent to the brow" },
  { in: [[IRON_INGOT, 8]], out: [IRON_JERKIN, 1], note: "hammered plate, lashed at the seam" },
  { in: [[IRON_INGOT, 7]], out: [IRON_LEGGINGS, 1], note: "iron greaves for the walking legs" },
  { in: [[IRON_INGOT, 4]], out: [IRON_TREADS, 1], note: "iron wraps for the hand-feet" },
  { in: [[GLOAM_INGOT, 5]], out: [GLOAM_CROWN, 1], note: "the sunken metal, bent to the brow" },
  { in: [[GLOAM_INGOT, 8]], out: [GLOAM_JERKIN, 1], note: "dusk-gold plate, lashed at the seam" },
  { in: [[GLOAM_INGOT, 7]], out: [GLOAM_LEGGINGS, 1], note: "gloam greaves for the walking legs" },
  { in: [[GLOAM_INGOT, 4]], out: [GLOAM_TREADS, 1], note: "gloam wraps for the hand-feet" },
  // --- the Waybar & the Trundle (workbench). Block-guided transport: sky-iron
  // bars pegged over split knotwood ties, and the riveted tub that rolls them.
  { in: [[IRON_INGOT, 6], [PLANKS, 3]], out: [RAIL, 8], note: "bars pegged over split ties" },
  { in: [[IRON_INGOT, 5]], out: [CART, 1], note: "a riveted tub on four wheels" },
  // sky-iron, folded and unfolded: four ingots to the block and back
  { in: [[IRON_INGOT, 4]], out: [IRON_BLOCK, 1] },
  { in: [[IRON_BLOCK, 1]], out: [IRON_INGOT, 4] },
  // gloamgold, the same fold
  { in: [[GLOAM_INGOT, 4]], out: [GLOAM_BLOCK, 1] },
  { in: [[GLOAM_BLOCK, 1]], out: [GLOAM_INGOT, 4] },
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

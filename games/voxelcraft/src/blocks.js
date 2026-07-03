// Block registry. Tiles reference the procedural atlas in textures.js.

import { TILE } from "./textures.js";

export const AIR = 0;
export const GRASS = 1;
export const DIRT = 2;
export const STONE = 3;
export const COBBLE = 4;
export const SAND = 5;
export const GRAVEL = 6;
export const LOG = 7;
export const LEAVES = 8;
export const PLANKS = 9;
export const GLASS = 10;
export const WATER = 11;
export const BEDROCK = 12;
export const SNOWY_GRASS = 13;
export const TALLGRASS = 14;
export const POPPY = 15;
export const DANDELION = 16;
export const CACTUS = 17;
export const BRICKS = 18;
export const SANDSTONE = 19;
export const LEAVES_COLD = 20;
export const COAL_ORE = 21;
export const IRON_ORE = 22;
export const TORCH = 23;
export const CHEST = 24;
export const SAPLING = 25;
export const WORKBENCH = 26;
export const BERRIES = 27;
export const SNUFFET_LOIN = 28;
export const ROAST_LOIN = 29;
export const BERRY_BUSH = 30;
export const KILN = 31;
export const IRON_BLOCK = 32;
export const MOSS_CLUMP = 33;
export const BED = 34;
export const LADDER = 35;
// the door is FOUR block ids: LOWER/UPPER × CLOSED/OPEN. DOOR (lower closed)
// is the user-visible item; the other three are internal world states.
export const DOOR = 36;
export const DOOR_TOP = 37;
export const DOOR_OPEN = 38;
export const DOOR_TOP_OPEN = 39;
export const BLAST_KEG = 40;
// shaped builder blocks (the Upturn rose in terraces — Wanderlings copy it).
// Slabs are one id; stairs are FOUR ids (one per facing), with the
// north-facing one as the only user-visible/craftable/droppable id.
export const PLANK_SLAB = 41;
export const STONE_SLAB = 42;
export const COBBLE_SLAB = 43;
export const PLANK_STAIRS = 44;   // north — the canonical stair id
export const PLANK_STAIRS_E = 45;
export const PLANK_STAIRS_S = 46;
export const PLANK_STAIRS_W = 47;
export const STONE_STAIRS = 48;
export const STONE_STAIRS_E = 49;
export const STONE_STAIRS_S = 50;
export const STONE_STAIRS_W = 51;
export const COBBLE_STAIRS = 52;
export const COBBLE_STAIRS_E = 53;
export const COBBLE_STAIRS_S = 54;
export const COBBLE_STAIRS_W = 55;
// wattle-work: waist-high woven fencing with neighbor-aware arms (mesher).
// The gate is TWO ids — closed (solid, 1.5-block collision like the fence:
// too tall to jump or hop) and open (pass-through, leaf swung aside). GATE
// is the one user-visible id; GATE_OPEN is an internal world state.
export const FENCE = 56;
export const GATE = 57;
export const GATE_OPEN = 58;
// meal-root farming: ROOT_SEED is the user-visible item (a pouch of pips);
// planting it on worked soil writes CROP_SPROUT, which grows through
// CROP_HALF to CROP_RIPE on a timer in main.js. The stages are internal
// world states; MEAL_ROOT/BAKED_ROOT are foods (the kiln bakes one into
// the other).
export const ROOT_SEED = 59;
export const CROP_SPROUT = 60;
export const CROP_HALF = 61;
export const CROP_RIPE = 62;
export const MEAL_ROOT = 63;
export const BAKED_ROOT = 64;
// the Sling Stone: knapped throwing ammunition — an item, never a world
// block. Right-click with one selected THROWS it (see interact.js routing
// and projectiles.js for its short ballistic career).
export const SLING_STONE = 65;
// the Reed Skiff: a little lashed-plank hull, carried on the satchel and
// never placed as a block — right-clicking WATER with it selected launches
// a boat ENTITY there (see interact.js routing and boats.js for its life
// afloat: buoyancy, boarding, paddling, and its two-kick demise).
export const BOAT = 66;
// fishing: the Dib-Pole is a carried tool (never placed, never consumed) —
// right-clicking with it selected casts a dib-float; see interact.js routing
// and fishing.js for the patient part. SILVERFIN is what the water repays,
// and the kiln sears it into SEARED_SILVERFIN.
export const FISHING_POLE = 67;
export const SILVERFIN = 68;
export const SEARED_SILVERFIN = 69;
// the Notice Post: a writable standing sign — FOUR ids, one per yaw-baked
// board facing (like stairs), with the north one as the only user-visible/
// craftable/droppable id. The written text lives in world.signs (world.js);
// the text boards themselves are runtime meshes (signs.js).
export const SIGN = 70;      // north — the canonical sign id
export const SIGN_E = 71;
export const SIGN_S = 72;
export const SIGN_W = 73;
// tools: 4 kinds × 3 tiers, carried items that never stack (maxStack 1) and
// never place. The Cracker cracks stone loose, the Hewer hews wood, the
// Scoop scoops soil, the Shiv settles arguments. Tiers: plank, stone, and
// sky-iron (smelted from the ore the old sky left behind — see IRON_INGOT).
export const PLANK_PICK = 74;
export const STONE_PICK = 75;
export const IRON_PICK = 76;
export const PLANK_AXE = 77;
export const STONE_AXE = 78;
export const IRON_AXE = 79;
export const PLANK_SHOVEL = 80;
export const STONE_SHOVEL = 81;
export const IRON_SHOVEL = 82;
export const PLANK_BLADE = 83;
export const STONE_BLADE = 84;
export const IRON_BLADE = 85;
// the Sky-Iron Ingot: what the kiln renders iron ore down to — the sky that
// fell, folded into a bar. The head material of the iron tool tier.
export const IRON_INGOT = 86;
// the wayfinding kit: three carried instruments, one per question a walker
// asks — where is home (the Homeward Needle), what hour is it (the Sky
// Dial), and where am I (the Field Chart). Never placed; the HUD widgets
// and the chart window live in wayfinding.js.
export const COMPASS = 87;
export const CLOCK = 88;
export const CHART = 89;
// armor: 2 tiers × 4 wear slots, carried items that never stack and never
// place. Bark ware is boiled knotwood-bark plate (cheap, modest); sky-iron
// ware is hammered from ingots (strong). Worn in the Satchel's wear column;
// player.js applies the protection and the wear-per-hit.
export const BARK_CROWN = 90;
export const BARK_JERKIN = 91;
export const BARK_LEGGINGS = 92;
export const BARK_TREADS = 93;
export const IRON_CROWN = 94;
export const IRON_JERKIN = 95;
export const IRON_LEGGINGS = 96;
export const IRON_TREADS = 97;
// the Pearlfall's gifts (see meteors.js): STARSTONE is the landed pearl of
// the old sky — a glowing block delivered by meteor landings, never found in
// terrain. The kiln runs it molten into STARGLASS (a pane that keeps the
// glow), and the workbench hones one onto a sky-iron blade as the
// STAR_BLADE, the tier-4 Star-Edge Shiv.
export const STARSTONE = 98;
export const STARGLASS = 99;
export const STAR_BLADE = 100;
// the Rimelands' weather-made blocks (see LORE.md): SNOW_LAYER is a Snowdrift,
// a thin settled fall of snow that stands on flat block tops (shape "layer",
// walkable, breaks in a kick, keeps nothing). ICE is River Glass, the frozen
// lid the cold country pulls over its water — glass-family mesh rules,
// slippery underfoot (player.js), and it breaks to nothing but the water it
// was hiding.
export const SNOW_LAYER = 101;
export const ICE = 102;
// the Emberwash: what the flip couldn't cool. Molten pools in the deepest
// caverns — a static fluid like water (sink, paddle, place into), but it
// glows (emitter 13), it burns (player.js ticks contact damage), and no
// tool ever collects it. Terrain floods deep cave cells with it; creative
// can paint more.
export const LAVA = 103;
// the Wispcap: a pale deep-cave mushroom holding a scrap of the buried old
// daylight (cousin of the Sunwisp). Grows on the floors of the old-sky
// caves; kicks loose in one hit and replants anywhere solid — a dim,
// farmable light for delve camps (emit 8: a mushroom, not a campfire).
export const WISPCAP = 104;
// Gloamgold: the fourth-tier metal. Sky-iron FELL into the Upturn;
// gloamgold SANK — it only shows below the Emberwash line (terrain.js
// oreAt, y < 14), where the pools stand guard over the seams. Iron-pick
// gated; the kiln renders the ore down to ingots.
export const GLOAM_ORE = 105;
export const GLOAM_INGOT = 106;
export const GLOAM_BLOCK = 107;
export const GLOAM_PICK = 108;
export const GLOAM_AXE = 109;
export const GLOAM_SHOVEL = 110;
export const GLOAM_BLADE = 111;
export const GLOAM_CROWN = 112;
export const GLOAM_JERKIN = 113;
export const GLOAM_LEGGINGS = 114;
export const GLOAM_TREADS = 115;
// the Mirelands (see LORE.md): the bog country. MUD is Mire Sod — wet
// ground that drags the stride; REEDS are Marsh Reeds, which rarely hand
// over BOGBEAN_POD (the bog's seed pouch — planting arrives with the
// bogbean farming wave, so for now it's a curiosity worth keeping).
export const MUD = 116;
export const REEDS = 117;
export const BOGBEAN_POD = 118;
// tilling: FARMLAND is Turned Earth, written by right-clicking soil with a
// Furrower (the hoe — the fifth tool kind). Root pips and bogbean pods only
// plant in it; interact.js owns the tilling routing.
export const FARMLAND = 119;
export const PLANK_HOE = 120;
export const STONE_HOE = 121;
export const IRON_HOE = 122;
// bogbean farming: the second crop. Pods plant in Turned Earth as
// BOGBEAN_SPROUT and grow through the same three-stage clock as meal
// roots (main.js updateCrops speaks cropStagesFor now). BOGBEAN is the
// food; POTTAGE is meal root + bogbeans simmered into the real dish.
export const BOGBEAN_SPROUT = 123;
export const BOGBEAN_HALF = 124;
export const BOGBEAN_RIPE = 125;
export const BOGBEAN = 126;
export const POTTAGE = 127;
// the Whims' broths (see LORE.md): kiln-simmered consumables that apply a
// timed effect (def.food.effect = [id, seconds] — player.js EFFECTS). The
// Kelp Gland is the Mirewalker's drop, the Kelpsalve its own cure.
export const EMBER_BROTH = 128;
export const SUNWISP_BROTH = 129;
export const KELP_GLAND = 130;
export const KELPSALVE = 131;

// kind: 'cube' | 'cross'
// bucket: 'opaque' | 'cutout' | 'water' (which mesh/material a face lands in)
// opaque: hides the touching face of a cube neighbor
// solid:  collides with the player
// cullSame: hide faces between two blocks of the same id (glass, water)
const def = (name, opts) => ({
  name,
  kind: "cube",
  bucket: "opaque",
  solid: true,
  opaque: true,
  cullSame: false,
  sound: "stone",
  lightEmit: 0,      // 0..14 block-light level this block radiates
  hardness: 1,       // survival mining time in seconds (Infinity = unbreakable)
  drops: undefined,  // survival drop: undefined = itself, null = nothing, id = that block
  tiles: null,       // {top, side, bottom}
  placeable: true,   // false = an item that can never be placed in the world
  food: null,        // {restore: N} — edible; N hunger points on eating
  sturdy: false,     // cross-kind that is NOT a plant: never replaced in place,
                     // never popped when the block under it breaks (ladder, door)
  hidden: false,     // internal id: kept out of the creative palette
  shape: null,       // null (full cube/cross) | "slab" | "stairs" | "fence" | "gate"
  open: false,       // gate only: leaf swung aside (mesher) + non-solid
  facing: 0,         // stairs: 0 north(-z) | 1 east(+x) | 2 south(+z) | 3 west(-x)
  facings: null,     // stairs: [northId, eastId, southId, westId] of this material
  base: null,        // facing variants: the canonical id (pick-block routes here)
  colHeight: 1,      // collision height within the cell (slab 0.5); solid only
  extraDrops: null,  // () => [ids] — bonus survival drops beyond drops/randomDrop
  maxStack: 0,       // 0 = the global 64-stack; 1 = never stacks (tools)
  tool: null,        // {kind, tier, speed, damage, maxDur} — a carried tool
  armor: null,       // {kind, prot, maxDur} — a wearable piece; kind is one
                     // of WEAR_KINDS, prot its damage-reduction share
  toolKind: null,    // which tool kind mines this block fast ('pick'|'axe'|'shovel')
  needsPick: 0,      // survival: drops NOTHING unless mined with a pick of
                     // at least this tier (0 = drops for anyone, bare feet too)
  gleam: 0,          // motes of Gleam a successful survival mine awards
  ...opts,
});

const cube = (t) => (typeof t === "number" ? { top: t, side: t, bottom: t } : t);

export const BLOCKS = [];
BLOCKS[AIR] = def("Air", { solid: false, opaque: false, bucket: null });
BLOCKS[GRASS] = def("Turf", { hardness: 0.6, drops: DIRT, toolKind: "shovel",
  tiles: cube({ top: TILE.GRASS_TOP, side: TILE.GRASS_SIDE, bottom: TILE.DIRT }),
  sound: "dirt",
});
BLOCKS[DIRT] = def("Dirt", { hardness: 0.5, tiles: cube(TILE.DIRT), sound: "dirt", toolKind: "shovel" });
BLOCKS[STONE] = def("Stone", { hardness: 1.9, drops: COBBLE, tiles: cube(TILE.STONE),
  toolKind: "pick", needsPick: 1 });
BLOCKS[COBBLE] = def("River Rubble", { hardness: 2.0, tiles: cube(TILE.COBBLE),
  toolKind: "pick", needsPick: 1 });
BLOCKS[SAND] = def("Sand", { hardness: 0.5, tiles: cube(TILE.SAND), sound: "sand", toolKind: "shovel" });
BLOCKS[GRAVEL] = def("Gravel", { hardness: 0.6, tiles: cube(TILE.GRAVEL), sound: "sand", toolKind: "shovel" });
BLOCKS[LOG] = def("Knotwood Log", { hardness: 1.4, toolKind: "axe",
  tiles: cube({ top: TILE.LOG_TOP, side: TILE.LOG_SIDE, bottom: TILE.LOG_TOP }),
  sound: "wood",
});
BLOCKS[LEAVES] = def("Knotwood Leaves", { hardness: 0.3, drops: null,
  randomDrop: { id: SAPLING, chance: 0.1 },
  tiles: cube(TILE.LEAVES), sound: "plant" });
BLOCKS[PLANKS] = def("Knotwood Planks", { hardness: 1.4, tiles: cube(TILE.PLANKS), sound: "wood", toolKind: "axe" });
BLOCKS[GLASS] = def("Glass", { hardness: 0.4, drops: null,
  tiles: cube(TILE.GLASS),
  opaque: false,
  bucket: "cutout",
  cullSame: true,
  sound: "glass",
});
BLOCKS[WATER] = def("Water", {
  tiles: cube(TILE.WATER),
  solid: false,
  opaque: false,
  bucket: "water",
  cullSame: true,
  sound: "plant",
});
BLOCKS[BEDROCK] = def("World's Back", { hardness: Infinity, drops: null, tiles: cube(TILE.BEDROCK) });
BLOCKS[SNOWY_GRASS] = def("Snowy Turf", { hardness: 0.6, drops: DIRT, toolKind: "shovel",
  tiles: cube({ top: TILE.SNOW_TOP, side: TILE.SNOW_SIDE, bottom: TILE.DIRT }),
  sound: "dirt",
});
BLOCKS[TALLGRASS] = def("Tall Grass", { hardness: 0.05, drops: null,
  randomDrop: { id: ROOT_SEED, chance: 0.25 }, // a snuffled-over pouch of pips
  tiles: cube(TILE.TALLGRASS),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  sound: "plant",
});
BLOCKS[POPPY] = def("Emberbell", { hardness: 0.05,
  tiles: cube(TILE.FLOWER_RED),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  sound: "plant",
});
BLOCKS[DANDELION] = def("Sunwisp", { hardness: 0.05,
  tiles: cube(TILE.FLOWER_YELLOW),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  sound: "plant",
});
BLOCKS[CACTUS] = def("Cactus", { hardness: 0.4,
  tiles: cube({ top: TILE.CACTUS_TOP, side: TILE.CACTUS_SIDE, bottom: TILE.CACTUS_TOP }),
  sound: "plant",
});
BLOCKS[BRICKS] = def("Bricks", { hardness: 2.0, tiles: cube(TILE.BRICKS),
  toolKind: "pick", needsPick: 1 });
BLOCKS[SANDSTONE] = def("Sandstone", { hardness: 1.2, toolKind: "pick", needsPick: 1,
  tiles: cube({ top: TILE.SANDSTONE_TOP, side: TILE.SANDSTONE_SIDE, bottom: TILE.SANDSTONE_TOP }),
});
BLOCKS[LEAVES_COLD] = def("Rimewood Leaves", { hardness: 0.3, drops: null,
  randomDrop: { id: SAPLING, chance: 0.1 },
  tiles: cube(TILE.LEAVES_COLD), sound: "plant" });
BLOCKS[COAL_ORE] = def("Coal Ore", { hardness: 2.8, tiles: cube(TILE.COAL_ORE),
  toolKind: "pick", needsPick: 1, gleam: 1 });
BLOCKS[IRON_ORE] = def("Sky-Iron Ore", { hardness: 3.2, tiles: cube(TILE.IRON_ORE),
  toolKind: "pick", needsPick: 2, gleam: 2 }); // sky-iron asks for a stone pick at least
BLOCKS[TORCH] = def("Torch", { hardness: 0.05,
  tiles: cube(TILE.TORCH),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  sound: "wood",
  lightEmit: 14,
});
BLOCKS[CHEST] = def("Chest", { hardness: 1.2, toolKind: "axe",
  tiles: cube({ top: TILE.CHEST_TOP, side: TILE.CHEST_SIDE, bottom: TILE.CHEST_TOP }),
  sound: "wood",
});
BLOCKS[SAPLING] = def("Knotwood Sapling", { hardness: 0.05,
  tiles: cube(TILE.SAPLING),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  sound: "plant",
});
BLOCKS[WORKBENCH] = def("Workbench", { hardness: 1.4, toolKind: "axe",
  tiles: cube({ top: TILE.WORKBENCH_TOP, side: TILE.WORKBENCH_SIDE, bottom: TILE.PLANKS }),
  sound: "wood",
});
// --- food items: carried and eaten, never placed ---
BLOCKS[BERRIES] = def("Bog Berries", { hardness: 0.05,
  tiles: cube(TILE.BERRIES),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  sound: "plant",
  placeable: false,
  food: { restore: 2 },
});
BLOCKS[SNUFFET_LOIN] = def("Snuffet Loin", { hardness: 0.05,
  tiles: cube(TILE.SNUFFET_LOIN),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  sound: "plant",
  placeable: false,
  food: { restore: 3 },
});
BLOCKS[ROAST_LOIN] = def("Roast Loin", { hardness: 0.05,
  tiles: cube(TILE.ROAST_LOIN),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  sound: "plant",
  placeable: false,
  food: { restore: 8 },
});
// the bramble never drops itself — it hands over its berries instead
BLOCKS[BERRY_BUSH] = def("Bog Bramble", { hardness: 0.15, drops: BERRIES,
  randomDrop: { id: BERRIES, chance: 0.5 }, // 1-2 berries per bush
  tiles: cube(TILE.BERRY_BUSH),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  sound: "plant",
});

// the Kiln: a stone-bellied smelter — right-click a placed one to feed it
// (see kiln.js for the smelting model)
BLOCKS[KILN] = def("Kiln", { hardness: 2.0, toolKind: "pick", needsPick: 1,
  tiles: cube({ top: TILE.KILN_TOP, side: TILE.KILN_SIDE, bottom: TILE.STONE }),
});
BLOCKS[IRON_BLOCK] = def("Sky-Iron Block", { hardness: 3.0, tiles: cube(TILE.IRON_BLOCK),
  toolKind: "pick", needsPick: 2 });

// snuffet back-moss: a soft deco block, and the stuffing of the Moss Cot
BLOCKS[MOSS_CLUMP] = def("Moss Clump", { hardness: 0.3, toolKind: "shovel",
  tiles: cube(TILE.MOSS_CLUMP), sound: "plant",
});
// the Moss Cot: right-click it at night to sleep to dawn and anchor your
// respawn there (see the sleep routing in interact.js/main.js)
BLOCKS[BED] = def("Moss Cot", { hardness: 0.8, toolKind: "axe",
  tiles: cube({ top: TILE.COT_TOP, side: TILE.COT_SIDE, bottom: TILE.PLANKS }),
  sound: "plant",
});

// the Rung Ladder: cross-kind and non-solid, but wall-mounted — placement
// wants a solid horizontal neighbor, and player.js suspends gravity on it
BLOCKS[LADDER] = def("Rung Ladder", { hardness: 0.4, toolKind: "axe",
  tiles: cube(TILE.LADDER),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  sturdy: true,
  sound: "wood",
});

// the Plank Door: two blocks tall. Closed halves are solid cutout cubes;
// open halves are cross-kind sprites (the leaf folded aside). All routing
// (paired place/break/toggle) lives in interact.js.
BLOCKS[DOOR] = def("Plank Door", { hardness: 1.6, toolKind: "axe",
  tiles: cube(TILE.DOOR_LOWER),
  bucket: "cutout",
  opaque: false,
  drops: null, // the paired-break handler drops the one door item
  sound: "wood",
});
BLOCKS[DOOR_TOP] = def("Plank Door (top)", { hardness: 1.6, toolKind: "axe",
  tiles: cube(TILE.DOOR_UPPER),
  bucket: "cutout",
  opaque: false,
  drops: null,
  sound: "wood",
  placeable: false,
  hidden: true,
});
BLOCKS[DOOR_OPEN] = def("Plank Door (open)", { hardness: 1.6, toolKind: "axe",
  tiles: cube(TILE.DOOR_LOWER),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  sturdy: true,
  drops: null,
  sound: "wood",
  placeable: false,
  hidden: true,
});
BLOCKS[DOOR_TOP_OPEN] = def("Plank Door (open top)", { hardness: 1.6, toolKind: "axe",
  tiles: cube(TILE.DOOR_UPPER),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  sturdy: true,
  drops: null,
  sound: "wood",
  placeable: false,
  hidden: true,
});

// the Blast Keg: a squat rope-bound powder barrel — coal-dust and sand-crust
// packed tight. Right-click a placed one to prime it; explosives.js handles
// the rest of its short, loud life. Danger is real but polite: it ticks.
BLOCKS[BLAST_KEG] = def("Blast Keg", { hardness: 0.6, toolKind: "axe",
  tiles: cube({ top: TILE.KEG_TOP, side: TILE.KEG_SIDE, bottom: TILE.KEG_SIDE }),
  sound: "wood",
});

// --- shaped blocks: slabs + stairs ------------------------------------------
// Shaped blocks are solid but NOT opaque: they never cull a neighbor's face
// and the skylight column treats their cell as passable (light spills over
// a slab instead of pretending it's a full roof).

const defSlab = (id, name, tiles, opts) => {
  BLOCKS[id] = def(name, {
    tiles: cube(tiles),
    shape: "slab",
    opaque: false,
    colHeight: 0.5,
    ...opts,
  });
};

// four ids per stair material; the north one is canonical, the rest are
// internal placement states that drop/pick as the canonical id
const FACING_SUFFIX = ["", " (east)", " (south)", " (west)"];
const defStairs = (ids, name, tiles, opts) => {
  ids.forEach((id, f) => {
    BLOCKS[id] = def(name + FACING_SUFFIX[f], {
      tiles: cube(tiles),
      shape: "stairs",
      facing: f,
      facings: ids,
      base: ids[0],
      opaque: false,
      ...opts,
      ...(f === 0 ? {} : { hidden: true, placeable: false, drops: ids[0] }),
    });
  });
};

defSlab(PLANK_SLAB, "Plank Slab", TILE.PLANKS, { hardness: 1.4, sound: "wood", toolKind: "axe" });
defSlab(STONE_SLAB, "Stone Slab", TILE.STONE, { hardness: 1.9, toolKind: "pick", needsPick: 1 });
defSlab(COBBLE_SLAB, "Rubble Slab", TILE.COBBLE, { hardness: 2.0, toolKind: "pick", needsPick: 1 });
defStairs([PLANK_STAIRS, PLANK_STAIRS_E, PLANK_STAIRS_S, PLANK_STAIRS_W],
  "Plank Stairs", TILE.PLANKS, { hardness: 1.4, sound: "wood", toolKind: "axe" });
defStairs([STONE_STAIRS, STONE_STAIRS_E, STONE_STAIRS_S, STONE_STAIRS_W],
  "Stone Stairs", TILE.STONE, { hardness: 1.9, toolKind: "pick", needsPick: 1 });
defStairs([COBBLE_STAIRS, COBBLE_STAIRS_E, COBBLE_STAIRS_S, COBBLE_STAIRS_W],
  "Rubble Stairs", TILE.COBBLE, { hardness: 2.0, toolKind: "pick", needsPick: 1 });

// --- wattle fence + gate ------------------------------------------------------
// Both are shaped blocks whose mesh depends on their neighbors (the mesher
// grows arms toward adjacent fence/gate/solid-cube cells). colHeight 1.5 makes
// them un-jumpable by the player (1.25-block jump) and un-hoppable by mobs.
BLOCKS[FENCE] = def("Wattle Fence", { hardness: 1.2, toolKind: "axe",
  tiles: cube(TILE.WATTLE),
  shape: "fence",
  opaque: false,
  colHeight: 1.5,
  sound: "wood",
});
BLOCKS[GATE] = def("Wattle Gate", { hardness: 1.2, toolKind: "axe",
  tiles: cube(TILE.WATTLE),
  shape: "gate",
  opaque: false,
  colHeight: 1.5,
  sound: "wood",
});
BLOCKS[GATE_OPEN] = def("Wattle Gate (open)", { hardness: 1.2, toolKind: "axe",
  tiles: cube(TILE.WATTLE),
  shape: "gate",
  open: true,
  solid: false,
  opaque: false,
  drops: GATE,
  base: GATE,
  sound: "wood",
  placeable: false,
  hidden: true,
});

export function isGate(id) { return id === GATE || id === GATE_OPEN; }

// --- the Notice Post ----------------------------------------------------------
// A slim post with a framed board on top, standing on solid ground only.
// Non-solid (a Wanderling brushes past a notice, never bonks it) and shaped:
// the mesher builds post + board boxes from the facing. `facing` here is the
// direction the BOARD FACES (its readable front), yaw-baked at placement so
// the writing greets the placer. Right-click opens the write window
// (interact.js routing); the text itself lives in world.signs.
const SIGN_IDS = [SIGN, SIGN_E, SIGN_S, SIGN_W];
SIGN_IDS.forEach((id, f) => {
  BLOCKS[id] = def("Notice Post" + FACING_SUFFIX[f], {
    tiles: cube(TILE.SIGN_BOARD),
    shape: "sign",
    facing: f,
    facings: SIGN_IDS,
    base: SIGN,
    solid: false,
    opaque: false,
    hardness: 0.7,
    sound: "wood",
    ...(f === 0 ? {} : { hidden: true, placeable: false, drops: SIGN }),
  });
});

export function isSign(id) {
  const b = BLOCKS[id];
  return b !== undefined && b.shape === "sign";
}

// --- meal-root farming --------------------------------------------------------
// The crop-cross template: non-solid cutout plants that pop off broken soil.
const cropCross = (opts) => ({
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  sound: "plant",
  hardness: 0.05,
  ...opts,
});

// the pouch of pips — user-visible, "placeable" only onto worked soil
// (interact.js checks DIRT/GRASS below and writes CROP_SPROUT instead)
BLOCKS[ROOT_SEED] = def("Root Pips", cropCross({
  tiles: cube(TILE.ROOT_PIPS),
}));
// the three growth stages: internal world states, all handing back pips —
// only a ripe root repays the digging
BLOCKS[CROP_SPROUT] = def("Meal Root Sprouts", cropCross({
  tiles: cube(TILE.CROP_SPROUT),
  drops: ROOT_SEED,
  base: ROOT_SEED, // pick-block hands back the pips
  placeable: false,
  hidden: true,
}));
BLOCKS[CROP_HALF] = def("Meal Root Greens", cropCross({
  tiles: cube(TILE.CROP_HALF),
  drops: ROOT_SEED,
  base: ROOT_SEED,
  placeable: false,
  hidden: true,
}));
BLOCKS[CROP_RIPE] = def("Ripe Meal Root", cropCross({
  tiles: cube(TILE.CROP_RIPE),
  drops: MEAL_ROOT, // guaranteed root, then the bonus roll below
  base: ROOT_SEED,
  // 1-2 roots + 1-2 pips per harvest — the patch always comes out ahead
  extraDrops: () => {
    const out = [ROOT_SEED];
    if (Math.random() < 0.5) out.push(ROOT_SEED);
    if (Math.random() < 0.5) out.push(MEAL_ROOT);
    return out;
  },
  placeable: false,
  hidden: true,
}));
// the foods: carried and eaten, never placed. Raw is a snack; the kiln
// bakes it into a proper meal (see SMELTS in kiln.js)
BLOCKS[MEAL_ROOT] = def("Meal Root", cropCross({
  tiles: cube(TILE.MEAL_ROOT),
  placeable: false,
  food: { restore: 3 },
}));
BLOCKS[BAKED_ROOT] = def("Baked Meal Root", cropCross({
  tiles: cube(TILE.BAKED_ROOT),
  placeable: false,
  food: { restore: 7 },
}));

// the Sling Stone: a knapped pebble, carried and thrown, never placed.
// Kicking a cobble apart yields four (see craft.js) — it's considered
// good manners to throw the pieces politely.
BLOCKS[SLING_STONE] = def("Sling Stone", {
  tiles: cube(TILE.SLING_STONE),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  hardness: 0.05,
  placeable: false,
  sound: "stone",
});

// the Reed Skiff item: an entity-in-waiting, never a world block
BLOCKS[BOAT] = def("Reed Skiff", {
  tiles: cube(TILE.SKIFF),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  hardness: 0.05,
  placeable: false,
  sound: "wood",
});

// the Dib-Pole: three planks whittled into a springy rod with a line and a
// little cork dib-float. A tool: never placed, never consumed by use.
BLOCKS[FISHING_POLE] = def("Dib-Pole", {
  tiles: cube(TILE.DIB_POLE),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  hardness: 0.05,
  placeable: false,
  sound: "wood",
});

// the Silverfin: raw it's a thin, cold snack; the kiln sears it into a
// proper shoreline meal (see SMELTS in kiln.js)
BLOCKS[SILVERFIN] = def("Silverfin", {
  tiles: cube(TILE.SILVERFIN),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  hardness: 0.05,
  placeable: false,
  sound: "plant",
  food: { restore: 2 },
});
BLOCKS[SEARED_SILVERFIN] = def("Seared Silverfin", {
  tiles: cube(TILE.SEARED_SILVERFIN),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  hardness: 0.05,
  placeable: false,
  sound: "plant",
  food: { restore: 6 },
});

// --- bogbean farming: the second crop on the same three-stage clock -----------
BLOCKS[BOGBEAN_SPROUT] = def("Bogbean Sprouts", cropCross({
  tiles: cube(TILE.BOGBEAN_SPROUT),
  drops: BOGBEAN_POD,
  base: BOGBEAN_POD, // pick-block hands back the pods
  placeable: false,
  hidden: true,
}));
BLOCKS[BOGBEAN_HALF] = def("Bogbean Vines", cropCross({
  tiles: cube(TILE.BOGBEAN_HALF),
  drops: BOGBEAN_POD,
  base: BOGBEAN_POD,
  placeable: false,
  hidden: true,
}));
BLOCKS[BOGBEAN_RIPE] = def("Ripe Bogbeans", cropCross({
  tiles: cube(TILE.BOGBEAN_RIPE),
  drops: BOGBEAN, // guaranteed beans, then the bonus roll below
  base: BOGBEAN_POD,
  // 1-2 beans + 1-2 pods per harvest — the patch always comes out ahead
  extraDrops: () => {
    const out = [BOGBEAN_POD];
    if (Math.random() < 0.5) out.push(BOGBEAN_POD);
    if (Math.random() < 0.5) out.push(BOGBEAN);
    return out;
  },
  placeable: false,
  hidden: true,
}));
BLOCKS[BOGBEAN] = def("Bogbean", cropCross({
  tiles: cube(TILE.BOGBEAN),
  placeable: false,
  food: { restore: 2 },
}));
// the dish every satchel dreams about: the mire and the meadow, one pot
BLOCKS[POTTAGE] = def("Wanderer's Pottage", cropCross({
  tiles: cube(TILE.POTTAGE),
  placeable: false,
  food: { restore: 10 },
}));

// --- the Whims' broths ---------------------------------------------------------
// Effect-bearing consumables: restore is a token 1 (the effect is the meal),
// and interact.js lets them drink at a full satchel for exactly that reason.
BLOCKS[EMBER_BROTH] = def("Emberbell Broth", cropCross({
  tiles: cube(TILE.EMBER_BROTH),
  placeable: false,
  food: { restore: 1, effect: ["emberglow", 20] },
}));
BLOCKS[SUNWISP_BROTH] = def("Sunwisp Broth", cropCross({
  tiles: cube(TILE.SUNWISP_BROTH),
  placeable: false,
  food: { restore: 1, effect: ["fleetfoot", 45] },
}));
// the gland itself is no meal — it's what the kiln renders into the salve
BLOCKS[KELP_GLAND] = def("Kelp Gland", cropCross({
  tiles: cube(TILE.KELP_GLAND),
  placeable: false,
}));
BLOCKS[KELPSALVE] = def("Kelpsalve", cropCross({
  tiles: cube(TILE.KELPSALVE),
  placeable: false,
  food: { restore: 1, effect: ["kelpguard", 30] },
}));

export const CROP_STAGES = [CROP_SPROUT, CROP_HALF, CROP_RIPE];
export const BOGBEAN_STAGES = [BOGBEAN_SPROUT, BOGBEAN_HALF, BOGBEAN_RIPE];
// the stage ladder a growing block belongs to, or null. New crops add their
// trio here and the shared clock in main.js updateCrops just works.
export function cropStagesFor(id) {
  if (id === CROP_SPROUT || id === CROP_HALF || id === CROP_RIPE) return CROP_STAGES;
  if (id === BOGBEAN_SPROUT || id === BOGBEAN_HALF || id === BOGBEAN_RIPE) return BOGBEAN_STAGES;
  return null;
}
export function isCrop(id) {
  return cropStagesFor(id) !== null;
}
// the seed item -> the sprout it plants (interact.js placement routing)
export const SEED_TO_SPROUT = {
  [ROOT_SEED]: CROP_SPROUT,
  [BOGBEAN_POD]: BOGBEAN_SPROUT,
};

// yaw -> cardinal facing index (0 N(-z), 1 E(+x), 2 S(+z), 3 W(-x)).
// Stairs place with their tall back in the look direction, so the steps
// face the placer.
export function yawToFacing(yaw) {
  const a = ((-yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return Math.round(a / (Math.PI / 2)) % 4;
}

// door-family helpers: which ids are door halves, which half is the lower,
// and the open/closed swap for each half
const DOOR_IDS = new Set([DOOR, DOOR_TOP, DOOR_OPEN, DOOR_TOP_OPEN]);
export function isDoor(id) { return DOOR_IDS.has(id); }
export function isDoorLower(id) { return id === DOOR || id === DOOR_OPEN; }
export const DOOR_TOGGLE = {
  [DOOR]: DOOR_OPEN, [DOOR_OPEN]: DOOR,
  [DOOR_TOP]: DOOR_TOP_OPEN, [DOOR_TOP_OPEN]: DOOR_TOP,
};

// --- tools: 4 kinds × 3 tiers -------------------------------------------------
// A tool is a carried item that never stacks and never places. `tool.kind`
// matched against a block's `toolKind` divides its mining time by
// `tool.speed`; `tool.tier` gates stone-family drops (needsPick); blades
// carry `damage` instead of digging talent. Durability lives per-instance on
// the STACK ({id, count: 1, dur}) — absent dur means factory-fresh.
//
// tier 1 plank: 2× speed, 64 uses; tier 2 stone: 4×, 128; tier 3 sky-iron:
// 6×, 256; tier 4 gloamgold: 8×, 384 — the field-journal stamp counts (×64)
// go up the tiers. The Star-Edge Shiv (damage 7) stays the apex BLADE;
// gloamgold wins everywhere else.
const TOOL_TIERS = [
  { adj: "Plank", tier: 1, speed: 2, damage: 3, maxDur: 64 },
  { adj: "Stone", tier: 2, speed: 4, damage: 4, maxDur: 128 },
  { adj: "Sky-Iron", tier: 3, speed: 6, damage: 5, maxDur: 256 },
  { adj: "Gloamgold", tier: 4, speed: 8, damage: 6, maxDur: 384 },
];
const defTool = (id, kindName, kind, t, tile) => {
  BLOCKS[id] = def(`${t.adj} ${kindName}`, {
    tiles: cube(tile),
    kind: "cross",
    bucket: "cutout",
    solid: false,
    opaque: false,
    hardness: 0.05,
    placeable: false,
    sound: kind === "blade" ? "wood" : "stone",
    maxStack: 1,
    tool: { kind, tier: t.tier, speed: t.speed, damage: t.damage, maxDur: t.maxDur },
  });
};
// the Cracker: kicks stone loose along the grain (the pick)
defTool(PLANK_PICK, "Cracker", "pick", TOOL_TIERS[0], TILE.PICK_PLANK);
defTool(STONE_PICK, "Cracker", "pick", TOOL_TIERS[1], TILE.PICK_STONE);
defTool(IRON_PICK, "Cracker", "pick", TOOL_TIERS[2], TILE.PICK_IRON);
// the Hewer: bites through logs and plankwork (the axe)
defTool(PLANK_AXE, "Hewer", "axe", TOOL_TIERS[0], TILE.AXE_PLANK);
defTool(STONE_AXE, "Hewer", "axe", TOOL_TIERS[1], TILE.AXE_STONE);
defTool(IRON_AXE, "Hewer", "axe", TOOL_TIERS[2], TILE.AXE_IRON);
// the Scoop: soil, sand, and gravel move aside politely (the shovel)
defTool(PLANK_SHOVEL, "Scoop", "shovel", TOOL_TIERS[0], TILE.SHOVEL_PLANK);
defTool(STONE_SHOVEL, "Scoop", "shovel", TOOL_TIERS[1], TILE.SHOVEL_STONE);
defTool(IRON_SHOVEL, "Scoop", "shovel", TOOL_TIERS[2], TILE.SHOVEL_IRON);
// the Shiv: a whittled fighting sliver — danger, politely answered (the sword)
defTool(PLANK_BLADE, "Shiv", "blade", TOOL_TIERS[0], TILE.BLADE_PLANK);
defTool(STONE_BLADE, "Shiv", "blade", TOOL_TIERS[1], TILE.BLADE_STONE);
defTool(IRON_BLADE, "Shiv", "blade", TOOL_TIERS[2], TILE.BLADE_IRON);
// the gloamgold set: tier 4 — mined out from under the Emberwash
defTool(GLOAM_PICK, "Cracker", "pick", TOOL_TIERS[3], TILE.PICK_GLOAM);
defTool(GLOAM_AXE, "Hewer", "axe", TOOL_TIERS[3], TILE.AXE_GLOAM);
defTool(GLOAM_SHOVEL, "Scoop", "shovel", TOOL_TIERS[3], TILE.SHOVEL_GLOAM);
defTool(GLOAM_BLADE, "Shiv", "blade", TOOL_TIERS[3], TILE.BLADE_GLOAM);
// the Furrower: asks the ground politely to be a garden (the hoe — a fifth
// kind; "hoe" matches no block's toolKind, so it mines at the bare rate and
// its real work is the tilling routing in interact.js). No gloam Furrower —
// tier 4 is for the mines.
defTool(PLANK_HOE, "Furrower", "hoe", TOOL_TIERS[0], TILE.HOE_PLANK);
defTool(STONE_HOE, "Furrower", "hoe", TOOL_TIERS[1], TILE.HOE_STONE);
defTool(IRON_HOE, "Furrower", "hoe", TOOL_TIERS[2], TILE.HOE_IRON);

// the Sky-Iron Ingot: a carried bar, never placed (the kiln makes it from
// sky-iron ore; four fold back into a Sky-Iron Block at the workbench)
BLOCKS[IRON_INGOT] = def("Sky-Iron Ingot", {
  tiles: cube(TILE.IRON_INGOT),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  hardness: 0.05,
  placeable: false,
  sound: "stone",
});

// --- the wayfinding kit -------------------------------------------------------
// Carried instruments, never stacked (a satchel holds one of each and that's
// plenty), never placed. The Needle leans toward the spawn anchor and the
// Dial rides sky.time whenever either sits in ANY hotbar slot; the Chart
// paints the walked world while actually held (see wayfinding.js).
const instrument = (name, tile, sound) => def(name, {
  tiles: cube(tile),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  hardness: 0.05,
  placeable: false,
  sound,
  maxStack: 1,
});
BLOCKS[COMPASS] = instrument("Homeward Needle", TILE.COMPASS, "stone");
BLOCKS[CLOCK] = instrument("Sky Dial", TILE.SKY_DIAL, "stone");
BLOCKS[CHART] = instrument("Field Chart", TILE.FIELD_CHART, "wood");

// --- armor: 2 tiers × 4 wear slots ---------------------------------------------
// The Satchel window carries a wear column with one slot per kind, in this
// order (top to bottom, head to hand-feet). Save data indexes it the same way.
export const WEAR_KINDS = ["crown", "jerkin", "leggings", "treads"];

// per-piece damage-reduction shares. A full bark set totals 0.25, a full
// sky-iron set 0.60, a full gloamgold set 0.70 — the jerkin carries the
// most plate, the treads the least. ARMOR_CAP (0.75) is the hard ceiling
// in armorProtection, leaving a little headroom above full gloamgold for
// whatever enhancement the Loomstone weaves later.
//   bark:      crown .05  jerkin .08  leggings .07  treads .05   (Σ .25)
//   sky-iron:  crown .12  jerkin .20  leggings .16  treads .12   (Σ .60)
//   gloamgold: crown .14  jerkin .24  leggings .19  treads .13   (Σ .70)
export const ARMOR_CAP = 0.75;
const ARMOR_TIERS = {
  bark: { adj: "Bark", maxDur: 64, sound: "wood",
    prot: { crown: 0.05, jerkin: 0.08, leggings: 0.07, treads: 0.05 } },
  iron: { adj: "Sky-Iron", maxDur: 256, sound: "stone",
    prot: { crown: 0.12, jerkin: 0.2, leggings: 0.16, treads: 0.12 } },
  gloam: { adj: "Gloamgold", maxDur: 384, sound: "stone",
    prot: { crown: 0.14, jerkin: 0.24, leggings: 0.19, treads: 0.13 } },
};
const defArmor = (id, kindName, kind, tierKey, tile) => {
  const t = ARMOR_TIERS[tierKey];
  BLOCKS[id] = def(`${t.adj} ${kindName}`, {
    tiles: cube(tile),
    kind: "cross",
    bucket: "cutout",
    solid: false,
    opaque: false,
    hardness: 0.05,
    placeable: false,
    sound: t.sound,
    maxStack: 1,
    armor: { kind, tier: tierKey, prot: t.prot[kind], maxDur: t.maxDur },
  });
};
defArmor(BARK_CROWN, "Crown", "crown", "bark", TILE.CROWN_BARK);
defArmor(BARK_JERKIN, "Jerkin", "jerkin", "bark", TILE.JERKIN_BARK);
defArmor(BARK_LEGGINGS, "Leggings", "leggings", "bark", TILE.LEGGINGS_BARK);
defArmor(BARK_TREADS, "Treads", "treads", "bark", TILE.TREADS_BARK);
defArmor(IRON_CROWN, "Crown", "crown", "iron", TILE.CROWN_IRON);
defArmor(IRON_JERKIN, "Jerkin", "jerkin", "iron", TILE.JERKIN_IRON);
defArmor(IRON_LEGGINGS, "Leggings", "leggings", "iron", TILE.LEGGINGS_IRON);
defArmor(IRON_TREADS, "Treads", "treads", "iron", TILE.TREADS_IRON);
defArmor(GLOAM_CROWN, "Crown", "crown", "gloam", TILE.CROWN_GLOAM);
defArmor(GLOAM_JERKIN, "Jerkin", "jerkin", "gloam", TILE.JERKIN_GLOAM);
defArmor(GLOAM_LEGGINGS, "Leggings", "leggings", "gloam", TILE.LEGGINGS_GLOAM);
defArmor(GLOAM_TREADS, "Treads", "treads", "gloam", TILE.TREADS_GLOAM);

// --- the Pearlfall's gifts ------------------------------------------------------
// Starstone: a landed pearl of the old sky, dense and still glowing. It only
// ever enters the world through a meteor landing (meteors.js writes it via
// setBlock, so it persists in the edit overlay like anything player-placed).
// Pick-gated at stone tier — prying a pearl wants proper ironmongery.
BLOCKS[STARSTONE] = def("Starstone", {
  tiles: cube(TILE.STARSTONE),
  hardness: 4.5,
  toolKind: "pick",
  needsPick: 2,
  lightEmit: 13,
  gleam: 5, // prying loose a drowned star sheds a proper pinch of it
});
// Starglass: starstone run molten in the kiln — a glowing pane, glass-like
// (cutout + cullSame, exactly the common-glass mesh rules) but too precious
// to shatter into nothing: it drops itself.
BLOCKS[STARGLASS] = def("Starglass", {
  tiles: cube(TILE.STARGLASS),
  hardness: 0.5,
  opaque: false,
  bucket: "cutout",
  cullSame: true,
  sound: "glass",
  lightEmit: 11,
});
// the Star-Edge Shiv: a starstone edge honed onto a sky-iron blade — the
// tier above sky-iron (damage 7), and it holds that edge twice as long
BLOCKS[STAR_BLADE] = def("Star-Edge Shiv", {
  tiles: cube(TILE.BLADE_STAR),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  hardness: 0.05,
  placeable: false,
  sound: "wood",
  maxStack: 1,
  tool: { kind: "blade", tier: 4, speed: 6, damage: 7, maxDur: 512 },
});

// --- the Rimelands' weather-made blocks ---------------------------------------
// the Snowdrift: a thin fresh fall, shape "layer" (a 0.12-high box — see
// shapeBoxes in mesher.js). Solid so a Wanderling stands ON it (colHeight),
// but a kick disperses it instantly and it keeps nothing. Not opaque: a drift
// never blocks skylight, and its cell reads as passable to the light column.
BLOCKS[SNOW_LAYER] = def("Snowdrift", {
  tiles: cube(TILE.SNOW_TOP),
  shape: "layer",
  opaque: false,
  colHeight: 0.12,
  hardness: 0.05,
  drops: null,
  toolKind: "shovel",
  sound: "sand",
});
// River Glass: the cold country's frozen lid. Glass-family mesh rules
// (cutout + cullSame, not opaque so skylight reaches the water beneath);
// breaks to nothing and reveals the old water it was politely holding down.
// player.js halves ground traction on it — the slide is the point.
BLOCKS[ICE] = def("River Glass", {
  tiles: cube(TILE.ICE),
  hardness: 0.6,
  drops: null,
  opaque: false,
  bucket: "cutout",
  cullSame: true,
  toolKind: "pick",
  sound: "glass",
});

// the Emberwash: opaque-bucket render (its own crust texture, no water swell)
// but non-opaque mesh rules like River Glass — internal lava-lava faces cull,
// and the BFS block light escapes the pool instead of dying at its skin
BLOCKS[LAVA] = def("Emberwash", {
  tiles: cube(TILE.LAVA),
  hardness: Infinity,
  drops: null,
  solid: false,
  opaque: false,
  cullSame: true,
  lightEmit: 13,
  sound: "stone",
});

// a fluid cell: the player swims in it, and building into it is allowed
// (placement replaces the fluid the way it replaces water)
export function isFluid(id) { return id === WATER || id === LAVA; }

BLOCKS[WISPCAP] = def("Wispcap", { hardness: 0.05,
  tiles: cube(TILE.WISPCAP),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  sound: "plant",
  lightEmit: 8,
});

// --- the Mirelands ---------------------------------------------------------------
BLOCKS[MUD] = def("Mire Sod", { hardness: 0.6, toolKind: "shovel",
  tiles: cube(TILE.MUD), sound: "dirt",
});
BLOCKS[REEDS] = def("Marsh Reed", { hardness: 0.05, drops: null,
  randomDrop: { id: BOGBEAN_POD, chance: 0.3 },
  tiles: cube(TILE.REEDS),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  sound: "plant",
});
// the pod "places" only into Turned Earth — interact.js routes it to a
// BOGBEAN_SPROUT exactly like Root Pips; the pod never exists as a block
BLOCKS[BOGBEAN_POD] = def("Bogbean Pods", { hardness: 0.05,
  tiles: cube(TILE.BOGBEAN_POD),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  sound: "plant",
});

// Turned Earth: worked soil, combed into rows. Stays turned (no reversion
// busywork); digs back up as plain dirt.
BLOCKS[FARMLAND] = def("Turned Earth", { hardness: 0.5, drops: DIRT,
  toolKind: "shovel",
  tiles: { top: TILE.FARMLAND_TOP, side: TILE.DIRT, bottom: TILE.DIRT },
  sound: "dirt",
});

// --- Gloamgold: the fourth tier -------------------------------------------------
// the ore asks for a sky-iron Cracker (needsPick 3) — the gate ladder's
// last rung before the metal itself takes over
BLOCKS[GLOAM_ORE] = def("Gloamgold Ore", { hardness: 4.0,
  tiles: cube(TILE.GLOAM_ORE),
  toolKind: "pick", needsPick: 3, gleam: 3,
});
// the Gloamgold Ingot: a carried bar, never placed (the kiln raises it
// from the ore; four fold into a Gloamgold Block at the workbench)
BLOCKS[GLOAM_INGOT] = def("Gloamgold Ingot", {
  tiles: cube(TILE.GLOAM_INGOT),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  hardness: 0.05,
  placeable: false,
  sound: "stone",
});
BLOCKS[GLOAM_BLOCK] = def("Gloamgold Block", { hardness: 3.4,
  tiles: cube(TILE.GLOAM_BLOCK),
  toolKind: "pick", needsPick: 3,
});

// total damage-reduction fraction of a wear-slot array (entries are stacks or
// null), capped at ARMOR_CAP. Falls are a special case: armor helps a fall at
// only 25% of its value — EXCEPT the treads, which count in full (it's the
// hand-feet that take the landing). Full sky-iron: 0.60 vs hits, 0.24 vs
// falls; full gloamgold: 0.70 vs hits, 0.28 vs falls; full bark: 0.25 / 0.10.
export function armorProtection(slots, fall = false) {
  let total = 0;
  for (const s of slots || []) {
    const a = s && BLOCKS[s.id] ? BLOCKS[s.id].armor : null;
    if (!a) continue;
    total += fall ? a.prot * (a.kind === "treads" ? 1 : 0.25) : a.prot;
  }
  return Math.min(ARMOR_CAP, total);
}

// a cross block that pops off / is replaced in place when built over (plants;
// NOT ladders or open door halves)
export function isPlant(id) {
  const b = BLOCKS[id];
  return b !== undefined && b.kind === "cross" && !b.sturdy;
}

// Blocks offered in the hotbar picker (everything but air and the internal
// door-half states).
export const PLACEABLE = BLOCKS.map((b, id) => id)
  .filter((id) => id !== AIR && !BLOCKS[id].hidden);

export const DEFAULT_HOTBAR = [GRASS, DIRT, STONE, COBBLE, PLANKS, LOG, LEAVES, GLASS, TORCH];

export function isSolid(id) { return BLOCKS[id] !== undefined && BLOCKS[id].solid; }
export function isOpaque(id) { return BLOCKS[id] !== undefined && BLOCKS[id].opaque; }

// What a block yields when mined in survival (null = nothing).
export function dropFor(id) {
  const d = BLOCKS[id].drops;
  return d === undefined ? id : d;
}

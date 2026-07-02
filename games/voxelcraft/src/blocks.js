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
  ...opts,
});

const cube = (t) => (typeof t === "number" ? { top: t, side: t, bottom: t } : t);

export const BLOCKS = [];
BLOCKS[AIR] = def("Air", { solid: false, opaque: false, bucket: null });
BLOCKS[GRASS] = def("Grass Block", { hardness: 0.6, drops: DIRT,
  tiles: cube({ top: TILE.GRASS_TOP, side: TILE.GRASS_SIDE, bottom: TILE.DIRT }),
  sound: "dirt",
});
BLOCKS[DIRT] = def("Dirt", { hardness: 0.5, tiles: cube(TILE.DIRT), sound: "dirt" });
BLOCKS[STONE] = def("Stone", { hardness: 1.9, drops: COBBLE, tiles: cube(TILE.STONE) });
BLOCKS[COBBLE] = def("Cobblestone", { hardness: 2.0, tiles: cube(TILE.COBBLE) });
BLOCKS[SAND] = def("Sand", { hardness: 0.5, tiles: cube(TILE.SAND), sound: "sand" });
BLOCKS[GRAVEL] = def("Gravel", { hardness: 0.6, tiles: cube(TILE.GRAVEL), sound: "sand" });
BLOCKS[LOG] = def("Oak Log", { hardness: 1.4,
  tiles: cube({ top: TILE.LOG_TOP, side: TILE.LOG_SIDE, bottom: TILE.LOG_TOP }),
  sound: "wood",
});
BLOCKS[LEAVES] = def("Oak Leaves", { hardness: 0.3, drops: null,
  randomDrop: { id: SAPLING, chance: 0.1 },
  tiles: cube(TILE.LEAVES), sound: "plant" });
BLOCKS[PLANKS] = def("Oak Planks", { hardness: 1.4, tiles: cube(TILE.PLANKS), sound: "wood" });
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
BLOCKS[BEDROCK] = def("Bedrock", { hardness: Infinity, drops: null, tiles: cube(TILE.BEDROCK) });
BLOCKS[SNOWY_GRASS] = def("Snowy Grass", { hardness: 0.6, drops: DIRT,
  tiles: cube({ top: TILE.SNOW_TOP, side: TILE.SNOW_SIDE, bottom: TILE.DIRT }),
  sound: "dirt",
});
BLOCKS[TALLGRASS] = def("Tall Grass", { hardness: 0.05, drops: null,
  tiles: cube(TILE.TALLGRASS),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  sound: "plant",
});
BLOCKS[POPPY] = def("Poppy", { hardness: 0.05,
  tiles: cube(TILE.FLOWER_RED),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  sound: "plant",
});
BLOCKS[DANDELION] = def("Dandelion", { hardness: 0.05,
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
BLOCKS[BRICKS] = def("Bricks", { hardness: 2.0, tiles: cube(TILE.BRICKS) });
BLOCKS[SANDSTONE] = def("Sandstone", { hardness: 1.2,
  tiles: cube({ top: TILE.SANDSTONE_TOP, side: TILE.SANDSTONE_SIDE, bottom: TILE.SANDSTONE_TOP }),
});
BLOCKS[LEAVES_COLD] = def("Spruce Leaves", { hardness: 0.3, drops: null,
  randomDrop: { id: SAPLING, chance: 0.1 },
  tiles: cube(TILE.LEAVES_COLD), sound: "plant" });
BLOCKS[COAL_ORE] = def("Coal Ore", { hardness: 2.8, tiles: cube(TILE.COAL_ORE) });
BLOCKS[IRON_ORE] = def("Iron Ore", { hardness: 3.2, tiles: cube(TILE.IRON_ORE) });
BLOCKS[TORCH] = def("Torch", { hardness: 0.05,
  tiles: cube(TILE.TORCH),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  sound: "wood",
  lightEmit: 14,
});
BLOCKS[CHEST] = def("Chest", { hardness: 1.2,
  tiles: cube({ top: TILE.CHEST_TOP, side: TILE.CHEST_SIDE, bottom: TILE.CHEST_TOP }),
  sound: "wood",
});
BLOCKS[SAPLING] = def("Oak Sapling", { hardness: 0.05,
  tiles: cube(TILE.SAPLING),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  sound: "plant",
});
BLOCKS[WORKBENCH] = def("Workbench", { hardness: 1.4,
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
BLOCKS[KILN] = def("Kiln", { hardness: 2.0,
  tiles: cube({ top: TILE.KILN_TOP, side: TILE.KILN_SIDE, bottom: TILE.STONE }),
});
BLOCKS[IRON_BLOCK] = def("Iron Block", { hardness: 3.0, tiles: cube(TILE.IRON_BLOCK) });

// snuffet back-moss: a soft deco block, and the stuffing of the Moss Cot
BLOCKS[MOSS_CLUMP] = def("Moss Clump", { hardness: 0.3,
  tiles: cube(TILE.MOSS_CLUMP), sound: "plant",
});
// the Moss Cot: right-click it at night to sleep to dawn and anchor your
// respawn there (see the sleep routing in interact.js/main.js)
BLOCKS[BED] = def("Moss Cot", { hardness: 0.8,
  tiles: cube({ top: TILE.COT_TOP, side: TILE.COT_SIDE, bottom: TILE.PLANKS }),
  sound: "plant",
});

// the Rung Ladder: cross-kind and non-solid, but wall-mounted — placement
// wants a solid horizontal neighbor, and player.js suspends gravity on it
BLOCKS[LADDER] = def("Rung Ladder", { hardness: 0.4,
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
BLOCKS[DOOR] = def("Plank Door", { hardness: 1.6,
  tiles: cube(TILE.DOOR_LOWER),
  bucket: "cutout",
  opaque: false,
  drops: null, // the paired-break handler drops the one door item
  sound: "wood",
});
BLOCKS[DOOR_TOP] = def("Plank Door (top)", { hardness: 1.6,
  tiles: cube(TILE.DOOR_UPPER),
  bucket: "cutout",
  opaque: false,
  drops: null,
  sound: "wood",
  placeable: false,
  hidden: true,
});
BLOCKS[DOOR_OPEN] = def("Plank Door (open)", { hardness: 1.6,
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
BLOCKS[DOOR_TOP_OPEN] = def("Plank Door (open top)", { hardness: 1.6,
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

// door-family helpers: which ids are door halves, which half is the lower,
// and the open/closed swap for each half
const DOOR_IDS = new Set([DOOR, DOOR_TOP, DOOR_OPEN, DOOR_TOP_OPEN]);
export function isDoor(id) { return DOOR_IDS.has(id); }
export function isDoorLower(id) { return id === DOOR || id === DOOR_OPEN; }
export const DOOR_TOGGLE = {
  [DOOR]: DOOR_OPEN, [DOOR_OPEN]: DOOR,
  [DOOR_TOP]: DOOR_TOP_OPEN, [DOOR_TOP_OPEN]: DOOR_TOP,
};

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

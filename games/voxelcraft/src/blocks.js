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
  tiles: null, // {top, side, bottom}
  ...opts,
});

const cube = (t) => (typeof t === "number" ? { top: t, side: t, bottom: t } : t);

export const BLOCKS = [];
BLOCKS[AIR] = def("Air", { solid: false, opaque: false, bucket: null });
BLOCKS[GRASS] = def("Grass Block", {
  tiles: cube({ top: TILE.GRASS_TOP, side: TILE.GRASS_SIDE, bottom: TILE.DIRT }),
  sound: "dirt",
});
BLOCKS[DIRT] = def("Dirt", { tiles: cube(TILE.DIRT), sound: "dirt" });
BLOCKS[STONE] = def("Stone", { tiles: cube(TILE.STONE) });
BLOCKS[COBBLE] = def("Cobblestone", { tiles: cube(TILE.COBBLE) });
BLOCKS[SAND] = def("Sand", { tiles: cube(TILE.SAND), sound: "sand" });
BLOCKS[GRAVEL] = def("Gravel", { tiles: cube(TILE.GRAVEL), sound: "sand" });
BLOCKS[LOG] = def("Oak Log", {
  tiles: cube({ top: TILE.LOG_TOP, side: TILE.LOG_SIDE, bottom: TILE.LOG_TOP }),
  sound: "wood",
});
BLOCKS[LEAVES] = def("Oak Leaves", { tiles: cube(TILE.LEAVES), sound: "plant" });
BLOCKS[PLANKS] = def("Oak Planks", { tiles: cube(TILE.PLANKS), sound: "wood" });
BLOCKS[GLASS] = def("Glass", {
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
BLOCKS[BEDROCK] = def("Bedrock", { tiles: cube(TILE.BEDROCK) });
BLOCKS[SNOWY_GRASS] = def("Snowy Grass", {
  tiles: cube({ top: TILE.SNOW_TOP, side: TILE.SNOW_SIDE, bottom: TILE.DIRT }),
  sound: "dirt",
});
BLOCKS[TALLGRASS] = def("Tall Grass", {
  tiles: cube(TILE.TALLGRASS),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  sound: "plant",
});
BLOCKS[POPPY] = def("Poppy", {
  tiles: cube(TILE.FLOWER_RED),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  sound: "plant",
});
BLOCKS[DANDELION] = def("Dandelion", {
  tiles: cube(TILE.FLOWER_YELLOW),
  kind: "cross",
  bucket: "cutout",
  solid: false,
  opaque: false,
  sound: "plant",
});
BLOCKS[CACTUS] = def("Cactus", {
  tiles: cube({ top: TILE.CACTUS_TOP, side: TILE.CACTUS_SIDE, bottom: TILE.CACTUS_TOP }),
  sound: "plant",
});
BLOCKS[BRICKS] = def("Bricks", { tiles: cube(TILE.BRICKS) });
BLOCKS[SANDSTONE] = def("Sandstone", {
  tiles: cube({ top: TILE.SANDSTONE_TOP, side: TILE.SANDSTONE_SIDE, bottom: TILE.SANDSTONE_TOP }),
});
BLOCKS[LEAVES_COLD] = def("Spruce Leaves", { tiles: cube(TILE.LEAVES_COLD), sound: "plant" });

// Blocks offered in the hotbar picker (everything but air).
export const PLACEABLE = BLOCKS.map((b, id) => id).filter((id) => id !== AIR);

export const DEFAULT_HOTBAR = [GRASS, DIRT, STONE, COBBLE, PLANKS, LOG, LEAVES, GLASS, SAND];

export function isSolid(id) { return BLOCKS[id] !== undefined && BLOCKS[id].solid; }
export function isOpaque(id) { return BLOCKS[id] !== undefined && BLOCKS[id].opaque; }

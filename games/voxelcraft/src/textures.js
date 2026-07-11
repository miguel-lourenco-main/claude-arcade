// Procedural 16px texture atlas. Every texture is painted pixel-by-pixel with a
// seeded RNG — no external assets. Atlas is a 16x16 grid of 16px tiles (256x256).

import * as THREE from "three";
import { mulberry32 } from "./noise.js";

export const ATLAS_TILES = 16; // tiles per row/column
export const TILE_PX = 16;

export const TILE = {
  GRASS_TOP: 0,
  GRASS_SIDE: 1,
  DIRT: 2,
  STONE: 3,
  COBBLE: 4,
  SAND: 5,
  GRAVEL: 6,
  LOG_SIDE: 7,
  LOG_TOP: 8,
  LEAVES: 9,
  PLANKS: 10,
  GLASS: 11,
  WATER: 12,
  BEDROCK: 13,
  SNOW_TOP: 14,
  SNOW_SIDE: 15,
  TALLGRASS: 16,
  FLOWER_RED: 17,
  FLOWER_YELLOW: 18,
  CACTUS_SIDE: 19,
  CACTUS_TOP: 20,
  BRICKS: 21,
  SANDSTONE_SIDE: 22,
  SANDSTONE_TOP: 23,
  LEAVES_COLD: 24,
  COAL_ORE: 25,
  IRON_ORE: 26,
  TORCH: 27,
  CHEST_SIDE: 28,
  CHEST_TOP: 29,
  SAPLING: 30,
  WORKBENCH_SIDE: 31,
  WORKBENCH_TOP: 32,
  BERRIES: 33,
  SNUFFET_LOIN: 34,
  ROAST_LOIN: 35,
  BERRY_BUSH: 36,
  KILN_SIDE: 37,
  KILN_TOP: 38,
  IRON_BLOCK: 39,
  MOSS_CLUMP: 40,
  COT_TOP: 41,
  COT_SIDE: 42,
  LADDER: 43,
  DOOR_LOWER: 44,
  DOOR_UPPER: 45,
  KEG_SIDE: 46,
  KEG_TOP: 47,
  WATTLE: 48,
  ROOT_PIPS: 49,
  CROP_SPROUT: 50,
  CROP_HALF: 51,
  CROP_RIPE: 52,
  MEAL_ROOT: 53,
  BAKED_ROOT: 54,
  SLING_STONE: 55,
  SKIFF: 56,
  DIB_POLE: 57,
  SILVERFIN: 58,
  SEARED_SILVERFIN: 59,
  SIGN_BOARD: 60,
  // tools: one side-view silhouette tile per kind × tier (icons + drops)
  PICK_PLANK: 61,
  PICK_STONE: 62,
  PICK_IRON: 63,
  AXE_PLANK: 64,
  AXE_STONE: 65,
  AXE_IRON: 66,
  SHOVEL_PLANK: 67,
  SHOVEL_STONE: 68,
  SHOVEL_IRON: 69,
  BLADE_PLANK: 70,
  BLADE_STONE: 71,
  BLADE_IRON: 72,
  IRON_INGOT: 73,
  // the wayfinding kit: three carried instruments (icons + drops)
  COMPASS: 74,
  SKY_DIAL: 75,
  FIELD_CHART: 76,
  // armor: one front-view silhouette tile per piece × tier (icons + drops)
  CROWN_BARK: 77,
  JERKIN_BARK: 78,
  LEGGINGS_BARK: 79,
  TREADS_BARK: 80,
  CROWN_IRON: 81,
  JERKIN_IRON: 82,
  LEGGINGS_IRON: 83,
  TREADS_IRON: 84,
  // the Pearlfall's gifts (see meteors.js): the landed pearl-block, its
  // kiln-molten pane, and the icon of the blade it edges
  STARSTONE: 85,
  STARGLASS: 86,
  BLADE_STAR: 87,
  // River Glass: the Rimelands' frozen lid over water (ICE block)
  ICE: 88,
  // the Emberwash: molten pools of the deep (LAVA block)
  LAVA: 89,
  // the Wispcap: pale glowing deep-cave mushroom (cross sprite)
  WISPCAP: 90,
  // Gloamgold: the fourth tier — the metal that sank when sky-iron fell.
  // Ore, ingot, block, four tool silhouettes, four armor silhouettes.
  GLOAM_ORE: 91,
  GLOAM_INGOT: 92,
  GLOAM_BLOCK: 93,
  PICK_GLOAM: 94,
  AXE_GLOAM: 95,
  SHOVEL_GLOAM: 96,
  BLADE_GLOAM: 97,
  CROWN_GLOAM: 98,
  JERKIN_GLOAM: 99,
  LEGGINGS_GLOAM: 100,
  TREADS_GLOAM: 101,
  // the Mirelands: bog-country ground and growth
  MUD: 102,
  REEDS: 103,
  BOGBEAN_POD: 104,
  // tilling: Turned Earth's furrowed top + the Furrower silhouettes
  FARMLAND_TOP: 105,
  HOE_PLANK: 106,
  HOE_STONE: 107,
  HOE_IRON: 108,
  // bogbean farming: the second crop's three stages, the bean, the pottage
  BOGBEAN_SPROUT: 109,
  BOGBEAN_HALF: 110,
  BOGBEAN_RIPE: 111,
  BOGBEAN: 112,
  POTTAGE: 113,
  // the Whims' broths: two bottles, the gland, the salve pot
  EMBER_BROTH: 114,
  SUNWISP_BROTH: 115,
  KELP_GLAND: 116,
  KELPSALVE: 117,
  // the Loomstone: the basin top and the pearl-seamed sides
  LOOMSTONE_TOP: 118,
  LOOMSTONE_SIDE: 119,
  // the Springstave and its Quills
  QUILL: 120,
  SPRINGSTAVE: 121,
  // the Murk Lantern and the Dusk Pearl (The Unshaken's summons + drop)
  MURK_LANTERN: 122,
  DUSK_PEARL: 123,
  // --- wave 7 (renumbered above the Deep Wave's last slot) ---
  // Gleam Moss: the old-sky caves' own faint lamp (see LORE.md)
  GLEAM_MOSS: 124,
  // the Waybar (rail): split-knotwood ties + a sky-iron bar surface. Two
  // tiles because the shape framework's per-box tile override (mesher.js)
  // dresses tie boxes in wood and bar boxes in metal.
  RAIL_TIE: 125,
  RAIL_BAR: 126,
  // the Trundle: the cart item's side-view silhouette (icon + drop)
  TRUNDLE: 127,
  // the Sky-Iron Pail (see LORE.md): a riveted carry-tub for fluids. Three
  // icons — empty, brimful of old water, and holding a scoop of the Emberwash
  // (the ember tub is painted with a warm inner glow: the "glows faintly held"
  // reads off the icon, since a carried item casts no world light).
  PAIL: 128,
  PAIL_WATER: 129,
  PAIL_EMBER: 130,
  // Cinderglass: what the Emberwash becomes when its fire is finally slaked —
  // a dense black volcanic glass — the Cinder Door's frame stock.
  CINDERGLASS: 131,
  // the Wanderwing (see LORE.md): a folded patchwork wing-cape icon — leaf-
  // green membrane panels stitched over quill ribs, a mustard collar lashing.
  WANDERWING: 132,
  // the Festival Rockets (see LORE.md): a thin paper tube capped with a
  // pointed nose and trailing a fuse, its wound color-band tinted by the
  // burst agent — gold Sunwisp, red Emberbell, nacre-green Gleam.
  ROCKET_SUN: 133,
  ROCKET_EMBER: 134,
  ROCKET_GLEAM: 135,
  // the Cinder Door's film (see LORE.md): the fire a Cinderglass ring
  // remembers, standing open — an ember-to-plum sheet with bright seams.
  CINDER_FILM: 136,
  // the Undersky's country (see LORE.md): the pale dune skin of the
  // drowned floor, and the petrified kelp still holding its bead of light.
  PEARLSAND: 137,
  STARKELP: 138,
  // what the Shellback sheds, and what the near country makes of it
  NACRE: 139,
  CROWN_NACRE: 140,
};

function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }

class TilePainter {
  constructor(ctx, tileIndex, rand) {
    this.ctx = ctx;
    this.ox = (tileIndex % ATLAS_TILES) * TILE_PX;
    this.oy = Math.floor(tileIndex / ATLAS_TILES) * TILE_PX;
    this.rand = rand;
  }
  px(x, y, r, g, b, a = 255) {
    this.ctx.fillStyle = `rgba(${clamp255(r)},${clamp255(g)},${clamp255(b)},${a / 255})`;
    this.ctx.fillRect(this.ox + x, this.oy + y, 1, 1);
  }
  // Fill the tile with base color, each pixel jittered by ±variation.
  noiseFill(base, variation, alpha = 255) {
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const d = (this.rand() * 2 - 1) * variation;
        this.px(x, y, base[0] + d, base[1] + d, base[2] + d, alpha);
      }
    }
  }
  speckle(count, color, variation = 12) {
    for (let i = 0; i < count; i++) {
      const x = (this.rand() * TILE_PX) | 0, y = (this.rand() * TILE_PX) | 0;
      const d = (this.rand() * 2 - 1) * variation;
      this.px(x, y, color[0] + d, color[1] + d, color[2] + d);
    }
  }
  clear() {
    this.ctx.clearRect(this.ox, this.oy, TILE_PX, TILE_PX);
  }
}

const painters = {
  [TILE.GRASS_TOP](p) {
    p.noiseFill([106, 170, 64], 14);
    p.speckle(30, [88, 152, 52]);
  },
  [TILE.GRASS_SIDE](p) {
    p.noiseFill([134, 96, 67], 12);
    p.speckle(20, [110, 78, 52]);
    // green turf strip with a jagged bottom edge
    for (let x = 0; x < TILE_PX; x++) {
      const depth = 2 + ((p.rand() * 3) | 0);
      for (let y = 0; y < depth; y++) {
        const d = (p.rand() * 2 - 1) * 14;
        p.px(x, y, 106 + d, 170 + d, 64 + d);
      }
    }
  },
  [TILE.DIRT](p) {
    p.noiseFill([134, 96, 67], 13);
    p.speckle(24, [104, 74, 50]);
    p.speckle(10, [155, 118, 83]);
  },
  [TILE.STONE](p) {
    p.noiseFill([127, 127, 127], 9);
    p.speckle(18, [104, 104, 104], 6);
  },
  [TILE.COBBLE](p) {
    p.noiseFill([120, 120, 120], 10);
    // rounded stones separated by dark grout
    const stones = [[2, 2, 4], [9, 1, 4], [3, 8, 4], [10, 8, 4], [6, 12, 3], [13, 12, 3], [0, 12, 3]];
    for (const [sx, sy, r] of stones) {
      for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
        if (x * x + y * y > r * r) continue;
        const tx = sx + x, ty = sy + y;
        if (tx < 0 || ty < 0 || tx >= TILE_PX || ty >= TILE_PX) continue;
        const edge = x * x + y * y > (r - 1) * (r - 1);
        const base = edge ? 88 : 132 + p.rand() * 14;
        p.px(tx, ty, base, base, base);
      }
    }
  },
  [TILE.SAND](p) {
    p.noiseFill([219, 207, 163], 10);
    p.speckle(16, [196, 183, 140]);
  },
  [TILE.GRAVEL](p) {
    p.noiseFill([131, 127, 126], 16);
    p.speckle(26, [96, 92, 90], 10);
    p.speckle(14, [160, 155, 152], 10);
  },
  [TILE.LOG_SIDE](p) {
    for (let x = 0; x < TILE_PX; x++) {
      const stripe = (x % 4 === 0 || x % 7 === 0) ? -22 : 0;
      for (let y = 0; y < TILE_PX; y++) {
        const d = (p.rand() * 2 - 1) * 8 + stripe;
        p.px(x, y, 109 + d, 84 + d, 50 + d);
      }
    }
  },
  [TILE.LOG_TOP](p) {
    p.noiseFill([109, 84, 50], 6);
    // growth rings
    for (let ring = 6; ring >= 0; ring -= 2) {
      const c = ring % 4 === 0 ? [178, 142, 90] : [130, 100, 62];
      for (let y = 7 - ring; y <= 8 + ring; y++) for (let x = 7 - ring; x <= 8 + ring; x++) {
        if (x === 7 - ring || x === 8 + ring || y === 7 - ring || y === 8 + ring) {
          const d = (p.rand() * 2 - 1) * 6;
          p.px(x, y, c[0] + d, c[1] + d, c[2] + d);
        }
      }
    }
  },
  [TILE.LEAVES](p) {
    p.noiseFill([58, 122, 40], 16);
    p.speckle(40, [42, 96, 30], 10);
    p.speckle(18, [82, 148, 56], 10);
  },
  [TILE.LEAVES_COLD](p) {
    p.noiseFill([64, 106, 74], 14);
    p.speckle(36, [48, 84, 58], 10);
    p.speckle(20, [214, 222, 228], 6); // snow dusting
  },
  [TILE.PLANKS](p) {
    for (let y = 0; y < TILE_PX; y++) {
      const seam = y % 4 === 3;
      for (let x = 0; x < TILE_PX; x++) {
        const d = (p.rand() * 2 - 1) * 8;
        const board = seam ? -30 : 0;
        // stagger vertical joins between boards
        const join = !seam && ((x + (y >> 2) * 5) % 8 === 0) ? -20 : 0;
        p.px(x, y, 176 + d + board + join, 142 + d + board + join, 88 + d + board + join);
      }
    }
  },
  [TILE.GLASS](p) {
    p.clear();
    for (let i = 0; i < TILE_PX; i++) {
      p.px(i, 0, 210, 235, 240); p.px(i, 15, 210, 235, 240);
      p.px(0, i, 210, 235, 240); p.px(15, i, 210, 235, 240);
    }
    // diagonal glint
    for (let i = 3; i < 8; i++) p.px(i, 11 - i + 3, 235, 250, 252, 200);
    for (let i = 9; i < 12; i++) p.px(i, 17 - i + 3, 235, 250, 252, 160);
  },
  [TILE.WATER](p) {
    p.noiseFill([53, 105, 200], 10);
    p.speckle(14, [70, 130, 220], 8);
  },
  [TILE.BEDROCK](p) {
    p.noiseFill([70, 70, 70], 28);
    p.speckle(24, [30, 30, 30], 12);
  },
  [TILE.SNOW_TOP](p) {
    p.noiseFill([238, 244, 248], 6);
    p.speckle(10, [220, 230, 240]);
  },
  [TILE.SNOW_SIDE](p) {
    p.noiseFill([134, 96, 67], 12);
    for (let x = 0; x < TILE_PX; x++) {
      const depth = 3 + ((p.rand() * 2) | 0);
      for (let y = 0; y < depth; y++) {
        const d = (p.rand() * 2 - 1) * 6;
        p.px(x, y, 238 + d, 244 + d, 248 + d);
      }
    }
  },
  [TILE.TALLGRASS](p) {
    p.clear();
    for (let b = 0; b < 7; b++) {
      const x = 2 + ((p.rand() * 12) | 0);
      const h = 6 + ((p.rand() * 8) | 0);
      const lean = p.rand() < 0.5 ? -1 : 1;
      for (let i = 0; i < h; i++) {
        const d = (p.rand() * 2 - 1) * 16;
        p.px(x + (i > h - 3 ? lean : 0), 15 - i, 96 + d, 158 + d, 56 + d);
      }
    }
  },
  [TILE.FLOWER_RED](p) {
    p.clear();
    for (let i = 0; i < 9; i++) p.px(7, 15 - i, 62, 122, 44); // stem
    p.px(6, 9, 62, 122, 44); p.px(8, 8, 62, 122, 44); // leaves
    const bloom = [[7, 4], [6, 4], [8, 4], [7, 3], [7, 5], [6, 3], [8, 3], [6, 5], [8, 5]];
    for (const [x, y] of bloom) p.px(x, y, 200 + p.rand() * 40, 30, 36);
    p.px(7, 4, 40, 34, 30); // dark center
  },
  [TILE.FLOWER_YELLOW](p) {
    p.clear();
    for (let i = 0; i < 8; i++) p.px(8, 15 - i, 62, 122, 44);
    p.px(7, 10, 62, 122, 44);
    const bloom = [[8, 5], [7, 5], [9, 5], [8, 4], [8, 6], [7, 4], [9, 6]];
    for (const [x, y] of bloom) p.px(x, y, 230, 208 + p.rand() * 30, 40);
  },
  [TILE.CACTUS_SIDE](p) {
    for (let x = 0; x < TILE_PX; x++) {
      const ridge = x % 4 === 1 ? -24 : x % 4 === 3 ? 14 : 0;
      for (let y = 0; y < TILE_PX; y++) {
        const d = (p.rand() * 2 - 1) * 8;
        p.px(x, y, 58 + d + ridge * 0.4, 130 + d + ridge, 42 + d + ridge * 0.4);
      }
    }
    p.speckle(8, [220, 228, 200], 10); // spines
  },
  [TILE.CACTUS_TOP](p) {
    p.noiseFill([70, 145, 52], 8);
    for (let i = 4; i < 12; i++) { p.px(i, 4, 96, 175, 70); p.px(i, 11, 96, 175, 70); p.px(4, i, 96, 175, 70); p.px(11, i, 96, 175, 70); }
  },
  [TILE.BRICKS](p) {
    for (let y = 0; y < TILE_PX; y++) {
      const row = y >> 2;
      const mortarRow = y % 4 === 3;
      for (let x = 0; x < TILE_PX; x++) {
        const shift = (row % 2) * 4;
        const mortarCol = (x + shift) % 8 === 7;
        const d = (p.rand() * 2 - 1) * 9;
        if (mortarRow || mortarCol) p.px(x, y, 168 + d, 160 + d, 152 + d);
        else p.px(x, y, 150 + d, 74 + d, 60 + d);
      }
    }
  },
  [TILE.SANDSTONE_SIDE](p) {
    for (let y = 0; y < TILE_PX; y++) {
      const band = y % 5 === 0 ? -14 : 0;
      for (let x = 0; x < TILE_PX; x++) {
        const d = (p.rand() * 2 - 1) * 6;
        p.px(x, y, 216 + d + band, 202 + d + band, 156 + d + band);
      }
    }
  },
  [TILE.SANDSTONE_TOP](p) {
    p.noiseFill([222, 208, 162], 6);
  },
  [TILE.COAL_ORE](p) {
    p.noiseFill([127, 127, 127], 9);
    for (const [bx, by] of [[3, 3], [10, 5], [5, 10], [12, 12], [8, 8]]) {
      for (let i = 0; i < 4; i++) {
        const d = p.rand() * 14;
        p.px(bx + ((p.rand() * 2) | 0), by + ((p.rand() * 2) | 0), 28 + d, 28 + d, 30 + d);
      }
    }
  },
  [TILE.IRON_ORE](p) {
    p.noiseFill([127, 127, 127], 9);
    for (const [bx, by] of [[4, 4], [11, 3], [3, 11], [10, 10], [7, 7]]) {
      for (let i = 0; i < 4; i++) {
        const d = (p.rand() * 2 - 1) * 12;
        p.px(bx + ((p.rand() * 2) | 0), by + ((p.rand() * 2) | 0), 216 + d, 172 + d, 140 + d);
      }
    }
  },
  [TILE.TORCH](p) {
    p.clear();
    for (let y = 6; y < 16; y++) {
      const d = (p.rand() * 2 - 1) * 8;
      p.px(7, y, 122 + d, 92 + d, 54 + d);
      p.px(8, y, 106 + d, 78 + d, 44 + d);
    }
    // glowing tip
    p.px(7, 5, 255, 190, 80); p.px(8, 5, 255, 190, 80);
    p.px(7, 4, 255, 232, 150); p.px(8, 4, 255, 232, 150);
    p.px(7, 3, 255, 250, 220); p.px(8, 3, 255, 250, 220);
  },
  [TILE.CHEST_SIDE](p) {
    // wooden panel, dark rim, brass latch
    for (let y = 0; y < TILE_PX; y++) for (let x = 0; x < TILE_PX; x++) {
      const rim = x === 0 || x === 15 || y === 0 || y === 15 || y === 7;
      const d = (p.rand() * 2 - 1) * 8;
      if (rim) p.px(x, y, 96 + d, 70 + d, 40 + d);
      else p.px(x, y, 158 + d, 116 + d, 66 + d);
    }
    for (const [x, y] of [[7, 6], [8, 6], [7, 7], [8, 7], [7, 8], [8, 8]]) p.px(x, y, 200, 190, 120);
  },
  [TILE.CHEST_TOP](p) {
    for (let y = 0; y < TILE_PX; y++) for (let x = 0; x < TILE_PX; x++) {
      const rim = x === 0 || x === 15 || y === 0 || y === 15;
      const d = (p.rand() * 2 - 1) * 8;
      if (rim) p.px(x, y, 96 + d, 70 + d, 40 + d);
      else p.px(x, y, 150 + d, 110 + d, 62 + d);
    }
  },
  [TILE.WORKBENCH_SIDE](p) {
    // planks base with a tool rack: a hanging mallet and a chisel silhouette
    for (let y = 0; y < TILE_PX; y++) for (let x = 0; x < TILE_PX; x++) {
      const d = (p.rand() * 2 - 1) * 8;
      const seam = y % 8 === 7 ? -26 : 0;
      p.px(x, y, 176 + d + seam, 142 + d + seam, 88 + d + seam);
    }
    // mallet: head + handle
    for (let x = 2; x <= 6; x++) p.px(x, 4, 90, 66, 40);
    for (let x = 2; x <= 6; x++) p.px(x, 5, 90, 66, 40);
    for (let y = 6; y <= 11; y++) p.px(4, y, 120, 92, 56);
    // chisel
    for (let y = 4; y <= 10; y++) p.px(11, y, 168, 168, 176);
    p.px(11, 11, 210, 210, 216);
  },
  [TILE.WORKBENCH_TOP](p) {
    // scarred worktop: planks with a cutting-grid of knife marks
    for (let y = 0; y < TILE_PX; y++) for (let x = 0; x < TILE_PX; x++) {
      const d = (p.rand() * 2 - 1) * 8;
      p.px(x, y, 166 + d, 132 + d, 80 + d);
    }
    for (let i = 0; i < 16; i += 5) {
      for (let t = 0; t < TILE_PX; t++) {
        if (p.rand() < 0.7) p.px(t, i, 120, 94, 56);
        if (p.rand() < 0.7) p.px(i, t, 120, 94, 56);
      }
    }
    // corner brackets
    for (const [cx, cy] of [[0, 0], [14, 0], [0, 14], [14, 14]]) {
      p.px(cx, cy, 96, 96, 104); p.px(cx + 1, cy, 96, 96, 104); p.px(cx, cy + 1, 96, 96, 104);
    }
  },
  [TILE.BERRIES](p) {
    // a Wanderling handful of bog berries: three plump deep-red orbs with a
    // marsh-green sprig, stamped like a field-journal specimen
    p.clear();
    const orbs = [[5, 9], [10, 9], [7, 12]];
    for (const [cx, cy] of orbs) {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (dx * dx + dy * dy > 5) continue;
        const d = (p.rand() * 2 - 1) * 12;
        p.px(cx + dx, cy + dy, 148 + d, 30 + d * 0.4, 52 + d * 0.5);
      }
      p.px(cx - 1, cy - 1, 214, 108, 128); // wet glint
    }
    // sprig
    p.px(7, 6, 74, 112, 62); p.px(8, 5, 74, 112, 62); p.px(9, 4, 88, 128, 70);
    p.px(8, 6, 60, 96, 52);
  },
  [TILE.SNUFFET_LOIN](p) {
    // raw snuffet loin: rosy slab, pale fat marbling along the grain
    p.clear();
    for (let y = 4; y <= 12; y++) {
      const w = y <= 5 || y >= 11 ? 1 : 0; // rounded ends
      for (let x = 2 + w; x <= 13 - w; x++) {
        const d = (p.rand() * 2 - 1) * 10;
        const edge = y === 4 || y === 12 || x === 2 + w || x === 13 - w;
        if (edge) p.px(x, y, 142 + d, 52 + d * 0.5, 58 + d * 0.5);
        else p.px(x, y, 196 + d, 84 + d * 0.6, 92 + d * 0.6);
      }
    }
    // marbling streaks
    for (let x = 4; x <= 11; x += 3) {
      for (let y = 6; y <= 10; y++) {
        if (p.rand() < 0.7) p.px(x + ((y % 2) | 0), y, 236, 210, 200);
      }
    }
  },
  [TILE.ROAST_LOIN](p) {
    // roast loin: the same slab, seared amber-brown with a dark crust
    p.clear();
    for (let y = 4; y <= 12; y++) {
      const w = y <= 5 || y >= 11 ? 1 : 0;
      for (let x = 2 + w; x <= 13 - w; x++) {
        const d = (p.rand() * 2 - 1) * 10;
        const edge = y === 4 || y === 12 || x === 2 + w || x === 13 - w;
        if (edge) p.px(x, y, 88 + d * 0.5, 52 + d * 0.4, 26 + d * 0.3);
        else p.px(x, y, 158 + d, 100 + d * 0.7, 46 + d * 0.5);
      }
    }
    // sear lines across the grain
    for (let x = 4; x <= 11; x += 3) {
      for (let y = 6; y <= 10; y++) {
        if (p.rand() < 0.75) p.px(x, y, 96, 58, 28);
      }
    }
    // a curl of steam — it's still warm
    p.px(6, 2, 226, 222, 214, 150); p.px(7, 1, 226, 222, 214, 120);
    p.px(10, 2, 226, 222, 214, 150);
  },
  [TILE.BERRY_BUSH](p) {
    // bog bramble: a squat dark marsh shrub speckled with ripe red berries
    p.clear();
    // woody stems
    for (let i = 0; i < 5; i++) p.px(7 + (i > 2 ? 1 : 0), 15 - i, 82, 62, 40);
    p.px(5, 12, 82, 62, 40); p.px(10, 12, 82, 62, 40);
    // dense dark foliage blob
    for (let y = 3; y <= 12; y++) {
      const half = y <= 5 ? y - 1 : y >= 11 ? 13 - y : 5;
      for (let x = 8 - half; x <= 8 + half - 1; x++) {
        if (p.rand() < 0.14) continue; // ragged silhouette
        const d = (p.rand() * 2 - 1) * 12;
        p.px(x, y, 34 + d * 0.5, 74 + d, 44 + d * 0.5);
      }
    }
    // ripe berries dotted through the dark leaves
    const dots = [[5, 6], [9, 4], [11, 8], [6, 10], [8, 8], [12, 5], [4, 9]];
    for (const [x, y] of dots) {
      p.px(x, y, 176, 36, 58);
      if (p.rand() < 0.5) p.px(x + 1, y, 140, 26, 46);
    }
  },
  [TILE.KILN_SIDE](p) {
    // the Kiln's stone belly: rounded field stones packed in dark grout, with
    // a warm ember mouth glowing low on every face
    p.noiseFill([96, 92, 90], 8);
    const stones = [[2, 2, 3], [8, 1, 3], [14, 2, 3], [1, 7, 3], [14, 8, 3], [2, 13, 3], [13, 13, 3]];
    for (const [sx, sy, r] of stones) {
      for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
        if (x * x + y * y > r * r) continue;
        const tx = sx + x, ty = sy + y;
        if (tx < 0 || ty < 0 || tx >= TILE_PX || ty >= TILE_PX) continue;
        const edge = x * x + y * y > (r - 1) * (r - 1);
        const base = edge ? 78 : 118 + p.rand() * 14;
        p.px(tx, ty, base + 6, base + 2, base);
      }
    }
    // the mouth: an arched opening, sooty at the top
    for (let y = 7; y <= 13; y++) {
      const half = y === 7 ? 2 : y === 8 ? 3 : 4;
      for (let x = 8 - half; x <= 7 + half; x++) {
        const soot = (p.rand() * 2 - 1) * 6;
        p.px(x, y, 24 + soot, 18 + soot, 16 + soot);
      }
    }
    // banked embers along the mouth floor, breathing heat up the arch
    for (let x = 4; x <= 11; x++) {
      if (p.rand() < 0.8) p.px(x, 13, 216 + p.rand() * 39, 90 + p.rand() * 40, 22);
      if (p.rand() < 0.45) p.px(x, 12, 255, 150 + p.rand() * 50, 44);
    }
    p.px(7, 11, 255, 196, 84); p.px(8, 12, 255, 214, 110);
    // warm rim light where firelight licks the stones around the opening
    for (const [x, y] of [[5, 6], [6, 6], [7, 6], [8, 6], [9, 6], [10, 6], [3, 9], [12, 9], [3, 11], [12, 11]]) {
      p.px(x, y, 150 + p.rand() * 20, 108 + p.rand() * 14, 78);
    }
  },
  [TILE.KILN_TOP](p) {
    // stone cap with a round draft-hole venting a faint glow
    p.noiseFill([112, 108, 105], 8);
    p.speckle(14, [92, 90, 88], 8);
    for (let i = 0; i < TILE_PX; i++) {
      const d = (p.rand() * 2 - 1) * 6;
      p.px(i, 0, 84 + d, 80 + d, 78 + d); p.px(i, 15, 84 + d, 80 + d, 78 + d);
      p.px(0, i, 84 + d, 80 + d, 78 + d); p.px(15, i, 84 + d, 80 + d, 78 + d);
    }
    for (let y = 6; y <= 9; y++) for (let x = 6; x <= 9; x++) {
      const corner = (x === 6 || x === 9) && (y === 6 || y === 9);
      if (corner) continue;
      p.px(x, y, 26, 20, 18);
    }
    p.px(7, 8, 208, 96, 30); p.px(8, 8, 174, 74, 26); // embers deep below
  },
  [TILE.IRON_BLOCK](p) {
    // dense riveted plate: brushed pale iron, seamed edges, corner rivets
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const d = (p.rand() * 2 - 1) * 4;
        const brush = y % 3 === 1 ? 6 : 0; // faint horizontal brushing
        p.px(x, y, 186 + d + brush, 190 + d + brush, 198 + d + brush);
      }
    }
    // seam frame one texel in from the edge
    for (let i = 1; i < 15; i++) {
      p.px(i, 1, 142, 146, 156); p.px(i, 14, 128, 132, 142);
      p.px(1, i, 142, 146, 156); p.px(14, i, 128, 132, 142);
    }
    // rivets: a bright cap pixel with a shadow below
    for (const [rx, ry] of [[3, 3], [12, 3], [3, 12], [12, 12], [7, 7], [8, 8]]) {
      p.px(rx, ry, 226, 230, 238);
      p.px(rx, ry + 1, 120, 124, 134);
    }
  },
  [TILE.MOSS_CLUMP](p) {
    // a snuffet's back-moss, pried loose whole: springy green tufts packed
    // over a damp dark core — the Upturn's softest building material
    p.noiseFill([84, 126, 64], 12);
    // tuft strands: bright tips with a shaded pixel underneath
    for (let i = 0; i < 24; i++) {
      const x = (p.rand() * TILE_PX) | 0, y = (p.rand() * (TILE_PX - 1)) | 0;
      const g = 150 + p.rand() * 28;
      p.px(x, y, 98, g, 76);
      p.px(x, y + 1, 62, 100 + p.rand() * 14, 52);
    }
    p.speckle(10, [52, 86, 44], 8);   // damp pockets between tufts
    p.speckle(6, [152, 188, 112], 8); // sun-bleached ends
  },
  [TILE.COT_TOP](p) {
    // the Moss Cot from above: a quilted moss mattress pinched into tufted
    // squares, with a paler bog-mint pillow pad tucked across one end
    for (let y = 0; y < TILE_PX; y++) for (let x = 0; x < TILE_PX; x++) {
      const d = (p.rand() * 2 - 1) * 10;
      if (x === 0 || x === 15 || y === 0 || y === 15) {
        p.px(x, y, 104 + d, 78 + d, 46 + d); // plank frame rim
        continue;
      }
      const seam = x % 5 === 2 || y % 5 === 2; // the quilting stitches
      if (seam) p.px(x, y, 54 + d, 90 + d, 48 + d);
      else p.px(x, y, 92 + d, 140 + d, 72 + d);
    }
    // the pillow: softer, paler, and firmly opinionated about naps
    for (let y = 2; y <= 5; y++) for (let x = 3; x <= 12; x++) {
      const d = (p.rand() * 2 - 1) * 8;
      const edge = y === 2 || y === 5 || x === 3 || x === 12;
      if (edge) p.px(x, y, 152 + d, 170 + d, 132 + d);
      else p.px(x, y, 186 + d, 202 + d, 158 + d);
    }
  },
  [TILE.COT_SIDE](p) {
    // side-on: moss bedding drooping unevenly over a low plank frame that
    // stands on stub legs, dark shadow beneath
    for (let y = 0; y < TILE_PX; y++) for (let x = 0; x < TILE_PX; x++) {
      const d = (p.rand() * 2 - 1) * 8;
      const seam = y === 10 ? -24 : 0; // the frame's bottom rail
      p.px(x, y, 158 + d + seam, 124 + d + seam, 76 + d + seam);
    }
    for (let y = 11; y < TILE_PX; y++) for (let x = 0; x < TILE_PX; x++) {
      const leg = x <= 1 || x >= 14;
      const d = (p.rand() * 2 - 1) * 8;
      if (leg) p.px(x, y, 112 + d, 84 + d, 50 + d);
      else p.px(x, y, 44 + d, 38 + d, 30 + d); // under-cot gloom
    }
    // the mattress: a ragged green overhang spilling past the rail
    for (let x = 0; x < TILE_PX; x++) {
      const depth = 4 + ((p.rand() * 3) | 0);
      for (let y = 0; y < depth; y++) {
        const d = (p.rand() * 2 - 1) * 12;
        p.px(x, y, 88 + d, 134 + d, 70 + d);
      }
    }
    for (let i = 0; i < 8; i++) { // bright tuft tips along the top
      p.px((p.rand() * TILE_PX) | 0, (p.rand() * 4) | 0,
        140, 178 + p.rand() * 20, 104);
    }
  },
  [TILE.LADDER](p) {
    // a Wanderling rung-ladder: two lashed rails and stout rungs — built for
    // four-fingered hand-feet, so the rungs are thick and closely spaced
    p.clear();
    for (let y = 0; y < TILE_PX; y++) {
      for (const x of [2, 3, 12, 13]) {
        const d = (p.rand() * 2 - 1) * 8;
        const inner = x === 3 || x === 12 ? -14 : 0; // shaded inner edge
        p.px(x, y, 138 + d + inner, 104 + d + inner, 62 + d + inner);
      }
    }
    for (let y = 2; y <= 14; y += 4) {
      for (let x = 3; x <= 12; x++) {
        const d = (p.rand() * 2 - 1) * 8;
        p.px(x, y, 160 + d, 124 + d, 74 + d);
        p.px(x, y + 1, 118 + d, 88 + d, 52 + d); // underside shadow
      }
      // lashing knots where the rung meets each rail
      p.px(2, y, 96, 70, 40); p.px(13, y, 96, 70, 40);
    }
  },
  [TILE.DOOR_LOWER](p) {
    // plank door, lower leaf: upright boards in a darker jamb, with a worn
    // brass thumb-latch on the closing side
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const d = (p.rand() * 2 - 1) * 7;
        const seam = x % 4 === 3 ? -24 : 0; // upright board joins
        p.px(x, y, 170 + d + seam, 136 + d + seam, 84 + d + seam);
      }
    }
    for (let i = 0; i < TILE_PX; i++) { // jamb: left/right rails + bottom sill
      const d = (p.rand() * 2 - 1) * 6;
      p.px(0, i, 116 + d, 86 + d, 50 + d); p.px(15, i, 116 + d, 86 + d, 50 + d);
      p.px(i, 15, 104 + d, 78 + d, 46 + d); p.px(i, 14, 122 + d, 92 + d, 54 + d);
    }
    // the latch
    p.px(12, 7, 210, 190, 120); p.px(13, 7, 228, 208, 134);
    p.px(12, 8, 176, 156, 96); p.px(13, 8, 210, 190, 120);
  },
  [TILE.DOOR_UPPER](p) {
    // plank door, upper leaf: same boards, a top rail, and a small pale
    // window pane so a Wanderling can check who's knocking
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const d = (p.rand() * 2 - 1) * 7;
        const seam = x % 4 === 3 ? -24 : 0;
        p.px(x, y, 170 + d + seam, 136 + d + seam, 84 + d + seam);
      }
    }
    for (let i = 0; i < TILE_PX; i++) { // jamb: left/right rails + top rail
      const d = (p.rand() * 2 - 1) * 6;
      p.px(0, i, 116 + d, 86 + d, 50 + d); p.px(15, i, 116 + d, 86 + d, 50 + d);
      p.px(i, 0, 104 + d, 78 + d, 46 + d); p.px(i, 1, 122 + d, 92 + d, 54 + d);
    }
    // the pane: dark sash frame around pale marsh-light glass
    for (let y = 5; y <= 10; y++) {
      for (let x = 5; x <= 10; x++) {
        const rim = y === 5 || y === 10 || x === 5 || x === 10;
        if (rim) { p.px(x, y, 98, 72, 42); continue; }
        const d = (p.rand() * 2 - 1) * 8;
        p.px(x, y, 212 + d, 230 + d, 234 + d);
      }
    }
    p.px(7, 7, 238, 248, 250); p.px(8, 6, 238, 248, 250); // glint
  },
  [TILE.KEG_SIDE](p) {
    // the Blast Keg's staves: scorched charcoal-dark wood packed with
    // coal-dust, cinched by two pale woven rope bands
    for (let x = 0; x < TILE_PX; x++) {
      const seam = x % 3 === 2 ? -16 : 0;              // stave joins
      const bulge = x === 0 || x === 15 ? -14 : 0;     // rounded barrel edge
      for (let y = 0; y < TILE_PX; y++) {
        const d = (p.rand() * 2 - 1) * 7;
        p.px(x, y, 68 + d + seam + bulge, 54 + d + seam + bulge, 40 + d + seam + bulge);
      }
    }
    // rope bands: alternating strand shading reads as a braid
    for (const ry of [3, 11]) {
      for (let x = 0; x < TILE_PX; x++) {
        const strand = (x + ry) % 2 === 0 ? 12 : -10;
        const d = (p.rand() * 2 - 1) * 6;
        p.px(x, ry, 172 + d + strand, 148 + d + strand, 104 + d + strand);
        p.px(x, ry + 1, 148 + d - strand, 126 + d - strand, 88 + d - strand);
      }
    }
    // coal dust leaking between the staves
    p.speckle(8, [30, 28, 26], 6);
  },
  [TILE.KEG_TOP](p) {
    // keg lid: dark boards, a rope rim, and a bold ember-orange warning
    // cross — the Wanderling field-sign for "politely, elsewhere"
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const d = (p.rand() * 2 - 1) * 7;
        const seam = y % 4 === 1 ? -14 : 0; // lid boards
        p.px(x, y, 76 + d + seam, 60 + d + seam, 44 + d + seam);
      }
    }
    for (let i = 0; i < TILE_PX; i++) { // rope rim
      const strand = i % 2 === 0 ? 10 : -8;
      p.px(i, 0, 164 + strand, 142 + strand, 100 + strand);
      p.px(i, 15, 164 - strand, 142 - strand, 100 - strand);
      p.px(0, i, 164 + strand, 142 + strand, 100 + strand);
      p.px(15, i, 164 - strand, 142 - strand, 100 - strand);
    }
    // the ember cross: two thick corner-to-corner strokes, hot in the middle
    for (let i = 2; i <= 13; i++) {
      for (const [x, y] of [[i, i], [i, 15 - i]]) {
        const d = p.rand() * 30;
        p.px(x, y, 222 + d, 108 + d * 0.6, 24);
        if (x + 1 <= 13) p.px(x + 1, y, 176 + d, 84 + d * 0.5, 20); // shoulder
      }
    }
    p.px(7, 7, 255, 210, 120); p.px(8, 8, 255, 210, 120);
  },
  [TILE.WATTLE](p) {
    // wattle-work: springy marsh withies woven over upright hazel stakes —
    // the Wanderling field fence, lashed by hand-feet in an afternoon
    for (let y = 0; y < TILE_PX; y++) {
      // horizontal withies in 2px courses, alternate courses shaded as the
      // weave dips behind the stakes
      const course = (y >> 1) % 2 === 0;
      for (let x = 0; x < TILE_PX; x++) {
        const d = (p.rand() * 2 - 1) * 9;
        const dip = course ? 0 : -16;
        p.px(x, y, 150 + d + dip, 116 + d + dip, 68 + d + dip);
      }
    }
    // upright stakes: the weave passes over them on alternating courses
    for (const sx of [2, 7, 12]) {
      for (let y = 0; y < TILE_PX; y++) {
        const over = ((y >> 1) + (sx >> 2)) % 2 === 0; // weave alternation
        if (over) continue; // a withy crosses in front of the stake here
        const d = (p.rand() * 2 - 1) * 8;
        p.px(sx, y, 118 + d, 88 + d, 50 + d);
        p.px(sx + 1, y, 102 + d, 76 + d, 44 + d); // shaded stake edge
      }
    }
    // frayed withy ends and peeled-bark highlights
    p.speckle(10, [180, 148, 92], 10);
    p.speckle(8, [88, 64, 38], 8);
  },
  [TILE.ROOT_PIPS](p) {
    // a Wanderling seed pouch: mustard-cloth, cinched with cord, a few pale
    // meal-root pips spilled beside it — stamped like a field-journal specimen
    p.clear();
    // the pouch: a squat sack, widest at the bottom, gathered at the neck
    for (let y = 6; y <= 13; y++) {
      const half = y <= 7 ? 2 : y <= 9 ? 3 : 4;
      for (let x = 7 - half; x <= 7 + half; x++) {
        const d = (p.rand() * 2 - 1) * 10;
        const edge = x === 7 - half || x === 7 + half || y === 13;
        if (edge) p.px(x, y, 146 + d, 108 + d, 40 + d);
        else p.px(x, y, 190 + d, 150 + d, 58 + d);
      }
    }
    // cinch cord + gathered neck
    p.px(6, 6, 96, 66, 34); p.px(7, 6, 112, 78, 38); p.px(8, 6, 96, 66, 34);
    p.px(7, 5, 150, 112, 46); p.px(7, 4, 122, 90, 40);
    // a weave seam across the belly
    for (let x = 5; x <= 9; x++) if (p.rand() < 0.7) p.px(x, 10, 158, 120, 44);
    // spilled pips: plump pale-cream teardrops with a dark eye
    for (const [x, y] of [[12, 12], [13, 14], [11, 14], [3, 13]]) {
      p.px(x, y, 226, 206, 158); p.px(x, y + 1, 198, 176, 128);
      p.px(x + 1, y + 1, 92, 74, 48);
    }
  },
  [TILE.CROP_SPROUT](p) {
    // meal-root, first showing: a few shy green pips split and reaching up
    p.clear();
    for (const [x, lean] of [[4, -1], [8, 0], [12, 1]]) {
      const h = 3 + ((p.rand() * 2) | 0);
      for (let i = 0; i < h; i++) {
        const d = (p.rand() * 2 - 1) * 12;
        p.px(x + (i >= h - 1 ? lean : 0), 15 - i, 96 + d, 160 + d, 62 + d);
      }
      // seed leaf pair at the tip
      p.px(x - 1, 15 - h, 118, 178, 74); p.px(x + 1, 15 - h, 118, 178, 74);
    }
  },
  [TILE.CROP_HALF](p) {
    // half-grown: leafy rosettes knee-high, the root shoulder just breaking
    // the soil — pale amber peeking through
    p.clear();
    for (const cx of [4, 11]) {
      // stem
      for (let i = 0; i < 6; i++) {
        const d = (p.rand() * 2 - 1) * 10;
        p.px(cx, 15 - i, 74 + d, 132 + d, 52 + d);
      }
      // a loose whorl of leaves
      for (const [dx, dy] of [[-1, 5], [1, 5], [-2, 6], [2, 6], [0, 7], [-1, 7], [1, 8], [-2, 8], [2, 7]]) {
        const d = (p.rand() * 2 - 1) * 14;
        p.px(cx + dx, 15 - dy, 92 + d, 158 + d, 60 + d);
      }
      // the root shoulder at the soil line
      p.px(cx - 1, 15, 196, 148, 84); p.px(cx, 15, 210, 160, 92); p.px(cx + 1, 15, 182, 136, 76);
    }
  },
  [TILE.CROP_RIPE](p) {
    // ripe: frilly tops gone bushy, fat amber root shoulders heaved up out of
    // the ground — the Upturn pushes back what it's done growing
    p.clear();
    for (const cx of [4, 11]) {
      // bushy top: a dense frill blob
      for (let dy = 5; dy <= 10; dy++) {
        const half = dy <= 6 ? 1 : dy <= 9 ? 2 : 1;
        for (let dx = -half; dx <= half; dx++) {
          if (p.rand() < 0.18) continue; // ragged frill
          const d = (p.rand() * 2 - 1) * 16;
          p.px(cx + dx, 15 - dy, 84 + d, 150 + d, 56 + d);
        }
      }
      p.px(cx, 15 - 11, 110, 172, 70); // topmost frond
      // stems down to the shoulder
      for (let i = 3; i < 5; i++) {
        const d = (p.rand() * 2 - 1) * 8;
        p.px(cx, 15 - i, 68 + d, 122 + d, 48 + d);
      }
      // the heaved-up root: a plump amber dome, two rows proud of the soil
      for (let dy = 0; dy <= 2; dy++) {
        const half = dy === 2 ? 1 : 2;
        for (let dx = -half; dx <= half; dx++) {
          const d = (p.rand() * 2 - 1) * 10;
          const edge = dx === -half || dx === half;
          if (edge) p.px(cx + dx, 15 - dy, 172 + d, 122 + d, 62 + d);
          else p.px(cx + dx, 15 - dy, 214 + d, 162 + d, 90 + d);
        }
      }
      p.px(cx - 1, 13, 234, 190, 120); // proud highlight
    }
  },
  [TILE.MEAL_ROOT](p) {
    // the meal root itself: a stout tapered tuber, russet-skinned and mealy,
    // whiskered with fine roots — a Wanderling staple, pried up by hand-foot
    p.clear();
    for (let y = 3; y <= 13; y++) {
      // widest at the shoulder (top), tapering to the tail
      const half = y <= 5 ? 3 : y <= 8 ? 4 : y <= 10 ? 3 : y <= 12 ? 2 : 1;
      for (let x = 7 - half; x <= 7 + half; x++) {
        const d = (p.rand() * 2 - 1) * 10;
        const edge = x === 7 - half || x === 7 + half || y === 3 || y === 13;
        if (edge) p.px(x, y, 148 + d, 96 + d * 0.7, 48 + d * 0.5);
        else p.px(x, y, 202 + d, 146 + d * 0.7, 82 + d * 0.5);
      }
    }
    // growth girdles across the skin
    for (const gy of [6, 9]) {
      for (let x = 5; x <= 10; x++) if (p.rand() < 0.7) p.px(x, gy, 164, 112, 56);
    }
    // whisker roots off the tail and flanks
    p.px(7, 14, 150, 118, 76); p.px(8, 15, 132, 104, 68);
    p.px(3, 7, 150, 118, 76); p.px(2, 8, 132, 104, 68);
    p.px(12, 10, 150, 118, 76);
    // the leaf-scar tuft up top
    p.px(6, 2, 96, 142, 62); p.px(8, 2, 96, 142, 62); p.px(7, 1, 110, 156, 70);
  },
  [TILE.BAKED_ROOT](p) {
    // baked meal root: the same tuber out of the kiln — skin gone deep amber,
    // split down the middle to show the pale mealy inside, still steaming
    p.clear();
    for (let y = 4; y <= 13; y++) {
      const half = y <= 6 ? 3 : y <= 9 ? 4 : y <= 11 ? 3 : 2;
      for (let x = 7 - half; x <= 7 + half; x++) {
        const d = (p.rand() * 2 - 1) * 10;
        const edge = x === 7 - half || x === 7 + half || y === 4 || y === 13;
        if (edge) p.px(x, y, 112 + d * 0.6, 66 + d * 0.4, 30 + d * 0.3);
        else p.px(x, y, 176 + d, 112 + d * 0.7, 50 + d * 0.5);
      }
    }
    // the split: a pale fluffy seam bursting down the middle
    for (let y = 6; y <= 11; y++) {
      const d = (p.rand() * 2 - 1) * 8;
      p.px(7, y, 236 + d, 214 + d, 168 + d);
      if (p.rand() < 0.5) p.px(8, y, 222 + d, 198 + d, 152 + d);
    }
    p.px(7, 7, 248, 232, 192); // the hottest, fluffiest bite
    // char kisses where it sat on the kiln floor
    for (const [x, y] of [[5, 12], [10, 11], [4, 8], [11, 7], [6, 13]]) {
      const d = (p.rand() * 2 - 1) * 8;
      p.px(x, y, 70 + d, 46 + d, 26 + d);
    }
    // a curl of steam — it's still warm
    p.px(6, 2, 226, 222, 214, 150); p.px(7, 1, 226, 222, 214, 120);
    p.px(9, 2, 226, 222, 214, 150);
  },
  [TILE.SLING_STONE](p) {
    // a knapped sling stone: a palm-of-the-foot-sized river pebble chipped
    // to a blunt point, flake scars stepping down one flank — Wanderling
    // field ammunition, stamped like a journal specimen
    p.clear();
    // the pebble: rounded at the crown, knapped narrower toward the tail
    for (let y = 4; y <= 12; y++) {
      const half = y <= 5 ? 2 : y <= 8 ? 4 : y <= 10 ? 3 : y === 11 ? 2 : 1;
      for (let x = 7 - half; x <= 7 + half; x++) {
        const d = (p.rand() * 2 - 1) * 8;
        const edge = x === 7 - half || x === 7 + half || y === 4 || y === 12;
        if (edge) p.px(x, y, 92 + d, 94 + d, 100 + d);
        else p.px(x, y, 136 + d, 138 + d, 146 + d);
      }
    }
    // flake scars: pale stepped crescents where chips were struck off
    for (const [sx, sy] of [[5, 7], [9, 6], [6, 10], [9, 9]]) {
      p.px(sx, sy, 172, 174, 182);
      p.px(sx + 1, sy, 160, 162, 170);
      p.px(sx, sy + 1, 108, 110, 118); // the scar's shadowed step
    }
    // one bright striking-edge glint at the point
    p.px(7, 12, 190, 192, 198);
    // knapping chips scattered beside it
    p.px(3, 13, 118, 120, 126); p.px(12, 12, 118, 120, 126);
    p.px(11, 14, 100, 102, 108);
  },
  [TILE.SKIFF](p) {
    // the Reed Skiff, side-on: a shallow lashed-plank hull with upswept
    // horns at bow and stern and a mustard gunwale rail — carried rolled on
    // the satchel, stamped like a field-journal specimen
    p.clear();
    // hull: widest amidships, curving up into the ends
    for (let y = 8; y <= 12; y++) {
      const inset = y <= 9 ? 0 : y === 10 ? 1 : y === 11 ? 3 : 5;
      for (let x = 1 + inset; x <= 14 - inset; x++) {
        const d = (p.rand() * 2 - 1) * 9;
        const edge = y === 12 || x === 1 + inset || x === 14 - inset;
        if (edge) p.px(x, y, 116 + d, 90 + d, 52 + d);
        else p.px(x, y, 170 + d, 138 + d, 82 + d);
      }
    }
    // reed lashings cinched around the hull
    for (const lx of [4, 8, 12]) {
      p.px(lx, 9, 132, 104, 58); p.px(lx, 10, 124, 98, 54);
    }
    // gunwale rail: mustard trim the length of the sheer line
    for (let x = 1; x <= 14; x++) {
      const d = (p.rand() * 2 - 1) * 8;
      p.px(x, 7, 198 + d, 160 + d, 64 + d);
    }
    // upswept horns at bow and stern
    p.px(0, 7, 190, 152, 60); p.px(15, 7, 190, 152, 60);
    p.px(0, 6, 172, 136, 54); p.px(15, 6, 172, 136, 54);
    p.px(0, 5, 140, 108, 46); p.px(15, 5, 140, 108, 46);
    // a paddle leaned across the beam, blade up
    for (let i = 0; i < 4; i++) p.px(5 + i, 6 - i, 138, 106, 58);
    p.px(9, 2, 160, 126, 66); p.px(10, 2, 160, 126, 66);
    p.px(9, 1, 172, 138, 72); p.px(10, 1, 172, 138, 72);
  },
  [TILE.DIB_POLE](p) {
    // the Dib-Pole: a whittled plank rod, thick at the butt and tapering to
    // a springy tip, with mustard grip-wraps (Wanderling trim) and a pale
    // line dropping to a little rust-capped dib-float — stamped like a
    // field-journal specimen
    p.clear();
    // the rod: butt at bottom-left, tip at top-right
    for (let i = 0; i < 12; i++) {
      const x = 2 + i, y = 13 - i;
      const d = (p.rand() * 2 - 1) * 8;
      p.px(x, y, 148 + d, 112 + d, 62 + d);
      if (i < 5) p.px(x, y + 1, 116 + d, 88 + d, 50 + d); // the thick butt half
    }
    // mustard grip-wraps near the butt
    p.px(3, 13, 198, 160, 64); p.px(4, 12, 198, 160, 64);
    p.px(6, 10, 176, 140, 56);
    // the line, hanging off the tip
    for (let y = 2; y <= 10; y++) p.px(14, y, 216, 220, 226, 170);
    // the dib-float: a rust-orange cap over a pale cork belly
    p.px(13, 11, 178, 74, 38); p.px(14, 11, 196, 84, 42);
    p.px(13, 12, 206, 192, 162); p.px(14, 12, 226, 214, 186);
  },
  [TILE.SILVERFIN](p) {
    // the Silverfin, side-on: slate-blue back over a bright silver flank,
    // forked tail, one wary eye — what patience over water repays
    p.clear();
    for (let x = 3; x <= 12; x++) {
      const half = x <= 4 ? 1 : x <= 10 ? 2 : 1; // lens body, head right
      for (let dy = -half; dy <= half; dy++) {
        const d = (p.rand() * 2 - 1) * 8;
        if (dy < 0) p.px(x, 8 + dy, 92 + d, 112 + d, 138 + d); // the back
        else p.px(x, 8 + dy, 198 + d, 206 + d, 216 + d);       // the flank
      }
    }
    // forked tail off the left
    p.px(2, 6, 92, 112, 138); p.px(1, 5, 84, 102, 126);
    p.px(2, 10, 92, 112, 138); p.px(1, 11, 84, 102, 126);
    p.px(2, 8, 132, 148, 170);
    // dorsal spine + a belly fin
    p.px(7, 5, 110, 130, 156); p.px(8, 5, 110, 130, 156);
    p.px(8, 11, 170, 180, 194);
    // the head: eye, gill line, a wet glint along the flank
    p.px(11, 7, 32, 36, 44);
    p.px(10, 8, 162, 172, 186); p.px(10, 9, 162, 172, 186);
    p.px(6, 7, 230, 236, 244);
  },
  [TILE.SEARED_SILVERFIN](p) {
    // the same fish out of the kiln: skin gone amber, sear lines across the
    // flank, still steaming — a proper shoreline meal
    p.clear();
    for (let x = 3; x <= 12; x++) {
      const half = x <= 4 ? 1 : x <= 10 ? 2 : 1;
      for (let dy = -half; dy <= half; dy++) {
        const d = (p.rand() * 2 - 1) * 9;
        if (dy < 0) p.px(x, 8 + dy, 118 + d, 76 + d, 34 + d);  // seared back
        else p.px(x, 8 + dy, 186 + d, 132 + d, 62 + d);        // amber flank
      }
    }
    p.px(2, 6, 104, 66, 30); p.px(1, 5, 92, 58, 26); // crisped tail
    p.px(2, 10, 104, 66, 30); p.px(1, 11, 92, 58, 26);
    p.px(2, 8, 140, 96, 44);
    // sear lines across the grain
    for (const sx of [5, 8, 11]) {
      if (p.rand() < 0.9) p.px(sx, 7, 88, 54, 26);
      p.px(sx, 8, 82, 50, 24);
      if (p.rand() < 0.9) p.px(sx, 9, 88, 54, 26);
    }
    p.px(11, 7, 44, 32, 22); // the eye, gone cloudy
    // a curl of steam — it's still warm
    p.px(6, 3, 226, 222, 214, 150); p.px(7, 2, 226, 222, 214, 120);
    p.px(9, 3, 226, 222, 214, 150);
  },
  [TILE.SIGN_BOARD](p) {
    // the Notice Post's board: pale planed wood scraped smooth for ink, with
    // a mustard-trim frame (Wanderling field-journal livery) and peg dots —
    // the writing itself is painted per-sign at runtime (see signs.js)
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const d = (p.rand() * 2 - 1) * 6;
        const grain = y % 6 === 4 ? -10 : 0; // faint planed-board seams
        p.px(x, y, 208 + d + grain, 180 + d + grain, 128 + d + grain);
      }
    }
    // mustard frame all round — trim is how a Wanderling says "official"
    for (let i = 0; i < TILE_PX; i++) {
      const d = (p.rand() * 2 - 1) * 8;
      p.px(i, 0, 190 + d, 152 + d, 60 + d); p.px(i, 15, 168 + d, 134 + d, 52 + d);
      p.px(0, i, 190 + d, 152 + d, 60 + d); p.px(15, i, 168 + d, 134 + d, 52 + d);
    }
    // corner pegs holding the board to its post
    for (const [cx, cy] of [[2, 2], [13, 2], [2, 13], [13, 13]]) {
      p.px(cx, cy, 118, 88, 50);
      p.px(cx, cy + 1, 96, 70, 40); // peg shadow
    }
  },
  [TILE.SAPLING](p) {
    p.clear();
    for (let i = 0; i < 6; i++) p.px(7 + (i > 3 ? 1 : 0), 15 - i, 96, 70, 40); // stem
    const leaves = [[7, 7], [6, 7], [8, 7], [7, 6], [6, 6], [8, 6], [7, 5], [5, 7], [9, 7], [7, 8], [6, 5], [8, 5]];
    for (const [x, y] of leaves) {
      const d = (p.rand() * 2 - 1) * 14;
      p.px(x, y, 58 + d, 122 + d, 40 + d);
    }
  },
};

// --- tool tiles -----------------------------------------------------------------
// Side-view tool silhouettes on transparent tiles, generated per kind × tier:
// a plank haft running bottom-left to top-right with a tier-colored head at
// the tip. Tiers read as material — plank wood, knapped gray stone, and the
// pale blue-white of sky-iron (see LORE.md: the sky that fell).
const TOOL_PALETTES = {
  plank: { hi: [206, 170, 110], mid: [176, 142, 88], lo: [126, 98, 58] },
  stone: { hi: [178, 180, 188], mid: [138, 140, 148], lo: [92, 94, 102] },
  iron: { hi: [234, 240, 250], mid: [196, 204, 218], lo: [138, 146, 164] },
  // gloamgold: dusk-gold — a warm bright face falling into violet shadow
  // (the gloam it was mined out of never quite lets go of it)
  gloam: { hi: [248, 214, 118], mid: [198, 156, 82], lo: [118, 86, 92] },
};
const HAFT_WOOD = { hi: [174, 138, 86], mid: [148, 112, 62], lo: [110, 82, 46] };

function toolPainter(kind, pal) {
  return (p) => {
    p.clear();
    // jittered pixel in a palette shade
    const dot = (x, y, c, j = 7) => {
      if (x < 0 || y < 0 || x >= TILE_PX || y >= TILE_PX) return;
      const d = (p.rand() * 2 - 1) * j;
      p.px(x, y, c[0] + d, c[1] + d, c[2] + d);
    };
    // the haft: a whittled plank rod, bottom-left toward the tip, with a
    // shaded underside (blades swap it for a short grip below the guard)
    const haftLen = kind === "blade" ? 3 : kind === "shovel" ? 9 : 8;
    for (let i = 0; i < haftLen; i++) {
      dot(2 + i, 14 - i, HAFT_WOOD.mid);
      dot(3 + i, 14 - i, HAFT_WOOD.lo);
    }
    if (kind === "pick") {
      // the Cracker: an arc perched across the tip, horns down both flanks
      const arc = [
        [5, 5], [5, 4], [6, 3], [7, 3], [8, 2], [9, 2], [10, 2],
        [11, 3], [12, 3], [13, 4], [14, 5], [14, 6], [14, 7], [14, 8],
      ];
      for (const [x, y] of arc) dot(x, y, pal.mid);
      for (const [x, y] of [[8, 1], [9, 1], [10, 1], [11, 2]]) dot(x, y, pal.hi);
      for (const [x, y] of [[7, 4], [8, 3], [9, 3], [10, 3], [11, 4], [12, 4], [13, 5], [13, 6]]) {
        dot(x, y, pal.lo);
      }
    } else if (kind === "axe") {
      // the Hewer: a heavy bit atop the haft, edge sweeping down-left
      for (const [x0, x1, y] of [[9, 12, 1], [8, 13, 2], [7, 13, 3], [7, 10, 4], [6, 8, 5]]) {
        for (let x = x0; x <= x1; x++) dot(x, y, pal.mid);
      }
      for (const [x, y] of [[9, 1], [10, 1], [8, 2], [7, 3]]) dot(x, y, pal.hi);
      for (const [x, y] of [[6, 5], [7, 5], [6, 6]]) dot(x, y, pal.hi); // the edge
      for (const [x, y] of [[12, 2], [13, 2], [13, 3], [12, 3], [9, 4], [10, 4], [8, 5]]) {
        dot(x, y, pal.lo);
      }
    } else if (kind === "shovel") {
      // the Scoop: a rounded pan at the tip, dished toward the work
      for (const [x0, x1, y] of [[10, 12, 2], [9, 13, 3], [9, 14, 4], [10, 14, 5], [11, 13, 6]]) {
        for (let x = x0; x <= x1; x++) dot(x, y, pal.mid);
      }
      for (const [x, y] of [[10, 2], [11, 2], [9, 3], [9, 4]]) dot(x, y, pal.hi);
      for (const [x, y] of [[13, 4], [14, 4], [13, 5], [14, 5], [12, 6], [13, 6]]) dot(x, y, pal.lo);
    } else if (kind === "hoe") {
      // the Furrower: a swan-neck blade folding down off the tip — asks the
      // ground politely to be a garden
      for (const [x, y] of [[9, 2], [10, 2], [11, 2], [12, 3], [12, 4], [12, 5]]) {
        dot(x, y, pal.mid);
      }
      for (const [x, y] of [[9, 1], [10, 1], [11, 2]]) dot(x, y, pal.hi);
      for (const [x, y] of [[13, 4], [13, 5], [13, 6], [12, 6]]) dot(x, y, pal.lo);
      dot(12, 6, pal.hi); // the tine's honed tip
    } else {
      // the Shiv: grip, a short cross-guard, and a long whittled sliver
      dot(1, 15, HAFT_WOOD.lo); // pommel knot
      dot(3, 11, HAFT_WOOD.lo); dot(5, 13, HAFT_WOOD.lo); // the guard
      dot(4, 12, HAFT_WOOD.mid);
      for (let i = 0; i < 8; i++) {
        dot(5 + i, 11 - i, pal.mid);       // the flat
        dot(5 + i, 10 - i, pal.hi);        // the honed edge
        if (i < 7) dot(6 + i, 11 - i, pal.lo); // the spine shadow
      }
      dot(13, 3, pal.hi); dot(13, 2, pal.hi); // the point
    }
  };
}

painters[TILE.PICK_PLANK] = toolPainter("pick", TOOL_PALETTES.plank);
painters[TILE.PICK_STONE] = toolPainter("pick", TOOL_PALETTES.stone);
painters[TILE.PICK_IRON] = toolPainter("pick", TOOL_PALETTES.iron);
painters[TILE.AXE_PLANK] = toolPainter("axe", TOOL_PALETTES.plank);
painters[TILE.AXE_STONE] = toolPainter("axe", TOOL_PALETTES.stone);
painters[TILE.AXE_IRON] = toolPainter("axe", TOOL_PALETTES.iron);
painters[TILE.SHOVEL_PLANK] = toolPainter("shovel", TOOL_PALETTES.plank);
painters[TILE.SHOVEL_STONE] = toolPainter("shovel", TOOL_PALETTES.stone);
painters[TILE.SHOVEL_IRON] = toolPainter("shovel", TOOL_PALETTES.iron);
painters[TILE.BLADE_PLANK] = toolPainter("blade", TOOL_PALETTES.plank);
painters[TILE.BLADE_STONE] = toolPainter("blade", TOOL_PALETTES.stone);
painters[TILE.BLADE_IRON] = toolPainter("blade", TOOL_PALETTES.iron);
painters[TILE.PICK_GLOAM] = toolPainter("pick", TOOL_PALETTES.gloam);
painters[TILE.AXE_GLOAM] = toolPainter("axe", TOOL_PALETTES.gloam);
painters[TILE.SHOVEL_GLOAM] = toolPainter("shovel", TOOL_PALETTES.gloam);
painters[TILE.BLADE_GLOAM] = toolPainter("blade", TOOL_PALETTES.gloam);
painters[TILE.HOE_PLANK] = toolPainter("hoe", TOOL_PALETTES.plank);
painters[TILE.HOE_STONE] = toolPainter("hoe", TOOL_PALETTES.stone);
painters[TILE.HOE_IRON] = toolPainter("hoe", TOOL_PALETTES.iron);

painters[TILE.BOGBEAN_SPROUT] = (p) => {
  // bogbean, first showing: two shy twining threads finding their feet
  p.clear();
  for (const [x, lean] of [[5, 1], [10, -1]]) {
    const h = 3 + ((p.rand() * 2) | 0);
    for (let i = 0; i < h; i++) {
      const d = (p.rand() * 2 - 1) * 12;
      p.px(x + (i >= h - 1 ? lean : 0), 15 - i, 88 + d, 148 + d, 70 + d);
    }
    p.px(x + lean, 15 - h - 1, 110, 168, 84); // the curling tip
  }
};
painters[TILE.BOGBEAN_HALF] = (p) => {
  // half-grown: proper vines now, twining up imagined stakes, first pods
  p.clear();
  for (const cx of [4, 11]) {
    for (let dy = 0; dy <= 9; dy++) {
      const d = (p.rand() * 2 - 1) * 14;
      const wob = dy % 3 === 1 ? 1 : dy % 3 === 2 ? -1 : 0;
      p.px(cx + wob, 15 - dy, 84 + d, 142 + d, 64 + d);
      if (p.rand() < 0.35) p.px(cx + wob + 1, 15 - dy, 96 + d, 150 + d, 72 + d);
    }
    p.px(cx + 1, 9, 140, 152, 96); // a first green pod
  }
};
painters[TILE.BOGBEAN_RIPE] = (p) => {
  // ripe: heavy vines strung with fat speckled pods, leaves going amber
  p.clear();
  for (const cx of [4, 11]) {
    for (let dy = 0; dy <= 11; dy++) {
      const d = (p.rand() * 2 - 1) * 14;
      const wob = dy % 3 === 1 ? 1 : dy % 3 === 2 ? -1 : 0;
      p.px(cx + wob, 15 - dy, 96 + d, 138 + d, 58 + d);
      if (p.rand() < 0.3) p.px(cx + wob - 1, 15 - dy, 148 + d, 142 + d, 70 + d);
    }
    // the pods: plump speckled drops hung off the vine
    for (const [dx, dy] of [[1, 5], [-1, 8], [1, 10]]) {
      p.px(cx + dx, 15 - dy, 168, 178, 120);
      p.px(cx + dx, 15 - dy + 1, 148, 160, 104);
      if (p.rand() < 0.6) p.px(cx + dx + (dx > 0 ? 1 : -1), 15 - dy, 120, 134, 84);
    }
  }
};
painters[TILE.BOGBEAN] = (p) => {
  // the bogbean: a fat speckled bean, kidney-bent
  p.clear();
  for (let y = 6; y <= 10; y++) {
    const half = y === 6 || y === 10 ? 2 : 3;
    for (let x = 8 - half; x <= 8 + half; x++) {
      if (y >= 8 && x <= 6) continue; // the kidney notch
      const d = (p.rand() * 2 - 1) * 10;
      const edge = x === 8 - half || x === 8 + half || y === 6 || y === 10;
      p.px(x, y, (edge ? 118 : 158) + d, (edge ? 134 : 172) + d, (edge ? 80 : 110) + d);
    }
  }
  p.px(7, 7, 96, 110, 66); p.px(9, 9, 96, 110, 66); // the speckles
  p.px(8, 6, 196, 206, 150); // the shine
};
painters[TILE.POTTAGE] = (p) => {
  // Wanderer's Pottage: a stout bowl, thick amber stew, a curl of steam
  p.clear();
  // the bowl
  for (let y = 9; y <= 13; y++) {
    const half = y === 9 ? 5 : y <= 11 ? 5 : y === 12 ? 4 : 3;
    for (let x = 8 - half; x <= 8 + half; x++) {
      const d = (p.rand() * 2 - 1) * 8;
      const edge = x === 8 - half || x === 8 + half || y === 13;
      p.px(x, y, (edge ? 96 : 128) + d, (edge ? 66 : 88) + d, (edge ? 42 : 56) + d);
    }
  }
  // the stew surface: amber with root-and-bean lumps
  for (let x = 4; x <= 12; x++) {
    const d = (p.rand() * 2 - 1) * 12;
    p.px(x, 9, 198 + d, 140 + d, 62 + d);
  }
  p.px(6, 9, 158, 170, 108); p.px(10, 9, 202, 146, 82); // a bean, a root lump
  // steam: two shy curls
  p.px(6, 7, 226, 228, 232, 150); p.px(7, 6, 226, 228, 232, 120);
  p.px(10, 7, 226, 228, 232, 150); p.px(9, 5, 226, 228, 232, 110);
};

// a stoppered field bottle: shared silhouette, per-broth liquid color
const brothPainter = (liquid, glint) => (p) => {
  p.clear();
  // cork + neck
  p.px(7, 3, 150, 118, 74); p.px(8, 3, 150, 118, 74);
  p.px(7, 4, 122, 94, 58); p.px(8, 4, 122, 94, 58);
  for (let y = 5; y <= 6; y++) { p.px(7, y, 210, 222, 228, 200); p.px(8, y, 210, 222, 228, 200); }
  // body: glass walls holding the simmer
  for (let y = 7; y <= 12; y++) {
    const half = y === 7 || y === 12 ? 2 : 3;
    for (let x = 8 - half; x <= 7 + half; x++) {
      const edge = x === 8 - half || x === 7 + half || y === 12;
      if (edge) p.px(x, y, 208, 220, 226, 210);
      else {
        const d = (p.rand() * 2 - 1) * 12;
        p.px(x, y, liquid[0] + d, liquid[1] + d, liquid[2] + d);
      }
    }
  }
  p.px(6, 8, glint[0], glint[1], glint[2]); // the warm spark in the broth
};
painters[TILE.EMBER_BROTH] = brothPainter([196, 88, 44], [255, 190, 90]);
painters[TILE.SUNWISP_BROTH] = brothPainter([214, 178, 62], [255, 244, 160]);

painters[TILE.KELP_GLAND] = (p) => {
  // the Mirewalker's kelp gland: a slick dark-green sac with a pale vein
  p.clear();
  for (let y = 5; y <= 12; y++) {
    const half = y <= 6 ? 1 : y <= 10 ? 3 : 2;
    for (let x = 8 - half; x <= 7 + half; x++) {
      const d = (p.rand() * 2 - 1) * 10;
      const edge = x === 8 - half || x === 7 + half || y === 5 || y === 12;
      p.px(x, y, (edge ? 30 : 52) + d, (edge ? 62 : 96) + d, (edge ? 48 : 70) + d);
    }
  }
  for (let y = 6; y <= 11; y++) p.px(7, y, 122, 168, 132); // the vein
  p.px(6, 7, 150, 196, 158); // the slick shine
};
painters[TILE.KELPSALVE] = (p) => {
  // Kelpsalve: a squat clay pot of cool green salve, wiped at the rim
  p.clear();
  for (let y = 7; y <= 13; y++) {
    const half = y === 7 || y === 13 ? 3 : 4;
    for (let x = 8 - half; x <= 7 + half; x++) {
      const d = (p.rand() * 2 - 1) * 8;
      const edge = x === 8 - half || x === 7 + half || y === 13;
      p.px(x, y, (edge ? 118 : 152) + d, (edge ? 84 : 108) + d, (edge ? 58 : 74) + d);
    }
  }
  for (let x = 5; x <= 10; x++) {
    const d = (p.rand() * 2 - 1) * 10;
    p.px(x, 7, 108 + d, 176 + d, 132 + d); // the salve surface
  }
  p.px(6, 7, 168, 220, 184); // the finger-wipe shine
};

painters[TILE.LOOMSTONE_TOP] = (p) => {
  // the basin: worked stone rim around a pooled-light hollow, with four
  // thread-guide notches — where the gleam gets woven through
  p.noiseFill([124, 126, 134], 8);
  for (let y = 3; y <= 12; y++) {
    for (let x = 3; x <= 12; x++) {
      const rim = x === 3 || x === 12 || y === 3 || y === 12;
      const d = (p.rand() * 2 - 1) * 10;
      if (rim) p.px(x, y, 96 + d, 98 + d, 110 + d);
      else {
        // the pooled gleam: pale nacre-green, brighter at the center
        const cd = Math.abs(x - 7.5) + Math.abs(y - 7.5);
        const b = 46 - cd * 6;
        p.px(x, y, 176 + b + d, 214 + b + d, 168 + b + d);
      }
    }
  }
  // thread-guide notches at the cardinal rim points
  p.px(7, 2, 210, 200, 232); p.px(8, 2, 210, 200, 232);
  p.px(7, 13, 210, 200, 232); p.px(8, 13, 210, 200, 232);
  p.px(2, 7, 210, 200, 232); p.px(2, 8, 210, 200, 232);
  p.px(13, 7, 210, 200, 232); p.px(13, 8, 210, 200, 232);
};
painters[TILE.LOOMSTONE_SIDE] = (p) => {
  // worked stone with a pearl seam glowing through the mortar line
  p.noiseFill([116, 118, 128], 9);
  for (let x = 0; x < TILE_PX; x++) {
    const d = (p.rand() * 2 - 1) * 12;
    p.px(x, 5, 196 + d, 192 + d, 226 + d); // the nacre seam
    if (p.rand() < 0.4) p.px(x, 6, 156, 154, 186);
  }
  p.speckle(8, [88, 90, 102], 8);
  p.px(4, 5, 240, 238, 255); p.px(11, 5, 240, 238, 255); // seam glints
};

painters[TILE.QUILL] = (p) => {
  // a whittled dart on the diagonal: pale shaft, iron-dark tip, leaf fletch
  p.clear();
  for (let i = 0; i < 9; i++) {
    const d = (p.rand() * 2 - 1) * 8;
    p.px(3 + i, 12 - i, 206 + d, 178 + d, 128 + d); // the shaft
  }
  p.px(12, 3, 120, 126, 140); p.px(13, 2, 96, 102, 116); // the tip
  // leaf-scrap fletching at the tail
  p.px(2, 13, 96, 150, 70); p.px(3, 14, 84, 138, 62);
  p.px(2, 14, 108, 160, 78); p.px(4, 13, 90, 144, 66);
};
painters[TILE.SPRINGSTAVE] = (p) => {
  // the bent stave: a knotwood arc with a taut moss-twine cord
  p.clear();
  const arc = [[4, 2], [3, 3], [2, 4], [2, 6], [2, 8], [2, 10], [3, 12], [4, 13], [5, 14]];
  for (const [x, y] of arc) {
    const d = (p.rand() * 2 - 1) * 10;
    p.px(x, y, 156 + d, 118 + d, 66 + d);
    p.px(x + 1, y, 128 + d, 96 + d, 54 + d); // the shaded belly
  }
  // the grip wrap mid-arc
  p.px(2, 7, 106, 78, 44); p.px(3, 7, 106, 78, 44);
  // the cord: taut from horn to horn
  for (let i = 0; i < 12; i++) {
    const x = 5 + Math.round(i * 0.55), y = 2 + i;
    p.px(Math.min(12, x), y, 148, 170, 132, 220);
  }
};

painters[TILE.MURK_LANTERN] = (p) => {
  // a starglass pane painted out with soot, cased and ring-handled: a
  // lantern that sheds dark — the pane swallows instead of glows
  p.clear();
  // the carry ring
  p.px(7, 1, 120, 126, 138); p.px(8, 1, 120, 126, 138);
  p.px(6, 2, 120, 126, 138); p.px(9, 2, 120, 126, 138);
  // the case
  for (let y = 3; y <= 13; y++) {
    for (let x = 4; x <= 11; x++) {
      const frame = x === 4 || x === 11 || y === 3 || y === 13;
      if (frame) {
        const d = (p.rand() * 2 - 1) * 8;
        p.px(x, y, 128 + d, 134 + d, 148 + d);
      } else {
        // the sooted pane: near-black with a violet breath at the center
        const cd = Math.abs(x - 7.5) + Math.abs(y - 8);
        const b = Math.max(0, 26 - cd * 5);
        p.px(x, y, 16 + b, 12 + b, 26 + b * 1.6);
      }
    }
  }
  p.px(5, 4, 60, 54, 80); // one smudged corner the soot missed
};
painters[TILE.DUSK_PEARL] = (p) => {
  // the Dusk Pearl: nacre in negative — a dark orb with an oil-sheen rim
  p.clear();
  for (let y = 4; y <= 12; y++) {
    const half = y === 4 || y === 12 ? 2 : y === 5 || y === 11 ? 3 : 4;
    for (let x = 8 - half; x <= 7 + half; x++) {
      const edge = x === 8 - half || x === 7 + half || y === 4 || y === 12;
      const d = (p.rand() * 2 - 1) * 8;
      if (edge) p.px(x, y, 74 + d, 58 + d, 104 + d); // the oil-sheen rim
      else p.px(x, y, 26 + d * 0.5, 20 + d * 0.5, 40 + d * 0.5);
    }
  }
  p.px(6, 6, 148, 130, 190); // the one reluctant glint
  p.px(9, 10, 96, 82, 132);
};

painters[TILE.FARMLAND_TOP] = (p) => {
  // Turned Earth: dark worked soil combed into furrow rows
  p.noiseFill([88, 64, 42], 10);
  for (const y of [2, 6, 10, 14]) {
    for (let x = 0; x < TILE_PX; x++) {
      const d = (p.rand() * 2 - 1) * 6;
      p.px(x, y, 58 + d, 42 + d, 28 + d);        // the furrow shadow
      if (p.rand() < 0.5) p.px(x, y - 1, 112 + d, 84 + d, 54 + d); // the turned crest
    }
  }
  p.speckle(6, [124, 96, 60], 8); // fresh crumbs
};

// --- Gloamgold ----------------------------------------------------------------
// The fourth-tier metal: sky-iron FELL into the Upturn; gloamgold SANK. It
// only shows below the Emberwash line, gold veins in violet-shadowed stone.
painters[TILE.GLOAM_ORE] = (p) => {
  p.noiseFill([104, 100, 112], 9); // deep stone, cooler than the common gray
  for (const [bx, by] of [[4, 3], [10, 5], [3, 10], [11, 11], [7, 8]]) {
    for (let i = 0; i < 4; i++) {
      const d = (p.rand() * 2 - 1) * 14;
      p.px(bx + ((p.rand() * 2) | 0), by + ((p.rand() * 2) | 0), 236 + d, 196 + d, 96 + d);
    }
    // each nugget trails a violet shadow pixel — the gloam holding on
    p.px(bx + 1, by + 2, 96, 72, 104);
  }
};
painters[TILE.GLOAM_BLOCK] = (p) => {
  // poured plate: warm brushed gold with dusk-violet seams
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const d = (p.rand() * 2 - 1) * 5;
      const brush = y % 3 === 1 ? 7 : 0;
      p.px(x, y, 210 + d + brush, 168 + d + brush, 88 + d);
    }
  }
  for (const y of [0, 15]) for (let x = 0; x < TILE_PX; x++) p.px(x, y, 128, 96, 96);
  for (const x of [0, 15]) for (let y = 0; y < TILE_PX; y++) p.px(x, y, 128, 96, 96);
  p.px(2, 2, 252, 226, 140); p.px(13, 13, 252, 226, 140); // cast gleams
};

// --- the Pearlfall's gifts ----------------------------------------------------
// Starstone reads as nacre over slate — a fallen pearl of the old sky, still
// glowing (the block emits light; see meteors.js for how it arrives). The
// shimmer is painted, not shaded: bright star-flecks with four-point
// twinkles over a faintly veined pearl base.
const STAR_PALETTE = { hi: [238, 238, 255], mid: [202, 198, 240], lo: [140, 136, 194] };

painters[TILE.STARSTONE] = (p) => {
  p.noiseFill([198, 200, 218], 10);
  // slate veins wandering down the face — the old seabed showing through
  for (let v = 0; v < 3; v++) {
    let x = (p.rand() * TILE_PX) | 0;
    for (let y = 0; y < TILE_PX; y++) {
      const d = (p.rand() * 2 - 1) * 8;
      p.px(x, y, 152 + d, 154 + d, 180 + d);
      if (p.rand() < 0.45) x = Math.max(0, Math.min(15, x + (p.rand() < 0.5 ? -1 : 1)));
    }
  }
  // star-flecks: white-hot cores with a four-point twinkle
  for (const [fx, fy] of [[3, 4], [11, 3], [6, 10], [13, 12], [9, 7]]) {
    p.px(fx, fy, 255, 255, 250);
    p.px(fx + 1, fy, 226, 234, 255); p.px(fx - 1, fy, 226, 234, 255);
    p.px(fx, fy + 1, 226, 234, 255); p.px(fx, fy - 1, 226, 234, 255);
  }
  p.speckle(12, [226, 230, 246], 8); // nacre glimmer between the flecks
};

painters[TILE.STARGLASS] = (p) => {
  // starglass: starstone run molten in the kiln — a pane that keeps the
  // glow. Mostly clear like common glass, but rimmed pale and crossed by
  // drifting nacre wisps with a few star-flecks caught mid-swirl
  p.clear();
  for (let i = 0; i < TILE_PX; i++) {
    p.px(i, 0, 228, 232, 250); p.px(i, 15, 228, 232, 250);
    p.px(0, i, 228, 232, 250); p.px(15, i, 228, 232, 250);
  }
  for (let i = 2; i < 9; i++) p.px(i, 14 - i, 236, 240, 255, 190);
  for (let i = 8; i < 13; i++) p.px(i, 20 - i, 216, 224, 252, 150);
  p.px(4, 4, 255, 255, 252, 220); p.px(11, 9, 255, 255, 252, 220);
  p.px(7, 13, 238, 242, 255, 180);
};

// the Star-Edge Shiv's icon: the blade silhouette in pearl-lavender, with a
// pair of star-flecks the honing couldn't rub off
const starBladeBase = toolPainter("blade", STAR_PALETTE);
painters[TILE.BLADE_STAR] = (p) => {
  starBladeBase(p);
  p.px(8, 7, 255, 255, 255);
  p.px(11, 4, 255, 255, 255);
};

// --- armor tiles ------------------------------------------------------------
// Front-view piece silhouettes on transparent tiles, per kind × tier. Bark
// ware reads as boiled knotwood-bark plate (warm brown, striated); sky-iron
// ware borrows the pale tool palette. Every piece carries one mustard lashing
// pixel — Wanderling trim is how gear says "finished".
const ARMOR_PALETTES = {
  bark: { hi: [150, 116, 72], mid: [118, 90, 54], lo: [82, 62, 38] },
  iron: TOOL_PALETTES.iron,
  gloam: TOOL_PALETTES.gloam,
  // shell-ware: the Nacre Crown's pearly plate (one-off — crown only)
  nacre: { hi: [232, 236, 244], mid: [204, 206, 222], lo: [160, 164, 186] },
};
const TRIM_MUSTARD = [214, 176, 74];

function armorPainter(kind, pal) {
  return (p) => {
    p.clear();
    const dot = (x, y, c, j = 7) => {
      if (x < 0 || y < 0 || x >= TILE_PX || y >= TILE_PX) return;
      const d = (p.rand() * 2 - 1) * j;
      p.px(x, y, c[0] + d, c[1] + d, c[2] + d);
    };
    if (kind === "crown") {
      // a low dome with a brow band — sits over the ears, not the eyes
      for (let y = 3; y <= 8; y++) {
        const half = y === 3 ? 2 : y === 4 ? 3 : 4;
        for (let x = 8 - half; x <= 7 + half; x++) {
          const edge = x === 8 - half || x === 7 + half || y === 3;
          dot(x, y, edge ? pal.lo : pal.mid);
        }
      }
      for (let x = 3; x <= 12; x++) dot(x, 9, pal.lo);       // the brow band
      for (let x = 6; x <= 9; x++) dot(x, 4, pal.hi);        // crest shine
      dot(7, 9, TRIM_MUSTARD); dot(8, 9, TRIM_MUSTARD);      // band lashing
    } else if (kind === "jerkin") {
      // shoulders, an open neck, and a plated torso
      for (let x = 3; x <= 12; x++) {
        if (x >= 6 && x <= 9) continue; // the neck hole
        dot(x, 3, pal.mid); dot(x, 4, pal.mid);
      }
      dot(3, 3, pal.lo); dot(12, 3, pal.lo);                 // shoulder caps
      for (let y = 5; y <= 12; y++) {
        for (let x = 4; x <= 11; x++) {
          const edge = x === 4 || x === 11 || y === 12;
          dot(x, y, edge ? pal.lo : pal.mid);
        }
      }
      for (let y = 5; y <= 11; y++) dot(7, y, pal.hi);       // the center seam
      dot(7, 6, TRIM_MUSTARD); dot(7, 9, TRIM_MUSTARD);      // seam lashings
    } else if (kind === "leggings") {
      // a waistband splitting into two plated legs
      for (let x = 4; x <= 11; x++) { dot(x, 3, pal.lo); dot(x, 4, pal.mid); }
      for (let y = 5; y <= 13; y++) {
        for (const x0 of [4, 9]) {
          for (let x = x0; x <= x0 + 2; x++) {
            const edge = x === x0 || x === x0 + 2 || y === 13;
            dot(x, y, edge ? pal.lo : pal.mid);
          }
        }
      }
      dot(5, 6, pal.hi); dot(10, 6, pal.hi);                 // thigh shine
      dot(7, 3, TRIM_MUSTARD); dot(8, 3, TRIM_MUSTARD);      // belt lashing
    } else {
      // treads: two stout wraps for the hand-feet, toes forward, deep soles
      for (const x0 of [2, 9]) {
        for (let y = 8; y <= 11; y++) {
          for (let x = x0; x <= x0 + 4; x++) {
            const edge = x === x0 || x === x0 + 4 || y === 8;
            dot(x, y, edge ? pal.lo : pal.mid);
          }
        }
        for (let x = x0; x <= x0 + 4; x++) dot(x, 12, pal.lo); // the sole
        dot(x0 + 1, 9, pal.hi);                                // toe shine
        dot(x0 + 2, 8, TRIM_MUSTARD);                          // ankle lashing
      }
    }
  };
}

painters[TILE.CROWN_BARK] = armorPainter("crown", ARMOR_PALETTES.bark);
painters[TILE.JERKIN_BARK] = armorPainter("jerkin", ARMOR_PALETTES.bark);
painters[TILE.LEGGINGS_BARK] = armorPainter("leggings", ARMOR_PALETTES.bark);
painters[TILE.TREADS_BARK] = armorPainter("treads", ARMOR_PALETTES.bark);
painters[TILE.CROWN_IRON] = armorPainter("crown", ARMOR_PALETTES.iron);
painters[TILE.JERKIN_IRON] = armorPainter("jerkin", ARMOR_PALETTES.iron);
painters[TILE.LEGGINGS_IRON] = armorPainter("leggings", ARMOR_PALETTES.iron);
painters[TILE.TREADS_IRON] = armorPainter("treads", ARMOR_PALETTES.iron);
painters[TILE.CROWN_GLOAM] = armorPainter("crown", ARMOR_PALETTES.gloam);
painters[TILE.CROWN_NACRE] = armorPainter("crown", ARMOR_PALETTES.nacre);
painters[TILE.JERKIN_GLOAM] = armorPainter("jerkin", ARMOR_PALETTES.gloam);
painters[TILE.LEGGINGS_GLOAM] = armorPainter("leggings", ARMOR_PALETTES.gloam);
painters[TILE.TREADS_GLOAM] = armorPainter("treads", ARMOR_PALETTES.gloam);

// --- the wayfinding kit -----------------------------------------------------
painters[TILE.COMPASS] = (p) => {
  // the Homeward Needle: a sky-iron field compass — pale case, slate face,
  // a rust needle leaning home over a mustard pivot pin
  p.clear();
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const d2 = (x - 7.5) ** 2 + (y - 7.5) ** 2;
      if (d2 > 47) continue;
      const d = (p.rand() * 2 - 1) * 7;
      if (d2 > 31) p.px(x, y, 196 + d, 204 + d, 218 + d);          // the case
      else p.px(x, y, 46 + d * 0.5, 50 + d * 0.5, 60 + d * 0.5);   // slate face
    }
  }
  // cardinal ticks scribed into the face (the top pair reads brightest)
  p.px(7, 3, 168, 176, 192); p.px(8, 3, 168, 176, 192);
  p.px(7, 12, 118, 124, 138); p.px(8, 12, 118, 124, 138);
  p.px(3, 7, 118, 124, 138); p.px(3, 8, 118, 124, 138);
  p.px(12, 7, 118, 124, 138); p.px(12, 8, 118, 124, 138);
  // the needle: rust end leaning home (up-left), pale iron tail trailing
  for (const [x, y] of [[5, 5], [6, 6], [5, 6], [6, 5]]) p.px(x, y, 197, 106, 43);
  p.px(4, 4, 224, 128, 56); // the hot tip
  for (const [x, y] of [[9, 9], [10, 10], [9, 10]]) p.px(x, y, 214, 220, 230);
  // the mustard pin at the pivot
  p.px(7, 7, 214, 176, 74); p.px(8, 7, 214, 176, 74);
  p.px(7, 8, 190, 152, 60); p.px(8, 8, 190, 152, 60);
};

painters[TILE.SKY_DIAL] = (p) => {
  // the Sky Dial: an iron-cased day-dial — marsh-light day half over a
  // pearl-specked night half, a mustard sun riding high, the moon below
  p.clear();
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const d2 = (x - 7.5) ** 2 + (y - 7.5) ** 2;
      if (d2 > 47) continue;
      const d = (p.rand() * 2 - 1) * 7;
      if (d2 > 31) { p.px(x, y, 196 + d, 204 + d, 218 + d); continue; }
      if (y <= 7) p.px(x, y, 96 + d, 142 + d, 190 + d);            // the day
      else p.px(x, y, 22 + d * 0.4, 28 + d * 0.4, 48 + d * 0.4);   // the night
    }
  }
  // the horizon seam
  for (let x = 3; x <= 12; x++) p.px(x, 8, 150, 158, 174);
  // the sun, riding high
  p.px(7, 4, 255, 214, 128); p.px(8, 4, 255, 214, 128);
  p.px(7, 5, 232, 168, 70); p.px(8, 5, 232, 168, 70);
  p.px(6, 4, 232, 168, 70); p.px(9, 4, 232, 168, 70);
  // the moon under the seam, and the old pearls around it
  p.px(7, 11, 221, 228, 240); p.px(8, 11, 200, 208, 224);
  p.px(7, 12, 200, 208, 224);
  p.px(4, 10, 159, 176, 216); p.px(11, 12, 159, 176, 216); p.px(10, 10, 159, 176, 216);
};

painters[TILE.FIELD_CHART] = (p) => {
  // the Field Chart: a journal leaf scraped pale, mustard-trimmed like all
  // official Wanderling paper, inked with terraces, a river, and an X
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const d = (p.rand() * 2 - 1) * 6;
      p.px(x, y, 208 + d, 186 + d, 138 + d);
    }
  }
  // mustard trim frame — trim is how a Wanderling says "official"
  for (let i = 0; i < TILE_PX; i++) {
    const d = (p.rand() * 2 - 1) * 8;
    p.px(i, 0, 190 + d, 152 + d, 60 + d); p.px(i, 15, 168 + d, 134 + d, 52 + d);
    p.px(0, i, 190 + d, 152 + d, 60 + d); p.px(15, i, 168 + d, 134 + d, 52 + d);
  }
  // a fold crease down the middle
  for (let y = 1; y < 15; y++) if (p.rand() < 0.7) p.px(7, y, 188, 164, 118);
  // a river inked across the leaf
  const river = [[1, 10], [2, 10], [3, 9], [4, 9], [5, 8], [6, 8], [7, 9],
    [8, 9], [9, 10], [10, 10], [11, 11], [12, 11], [13, 12], [14, 12]];
  for (const [x, y] of river) p.px(x, y, 74, 112, 168);
  // terrace contours, the field-journal way
  for (const [x, y] of [[3, 3], [4, 3], [5, 3], [4, 4], [9, 3], [10, 3],
    [11, 4], [10, 4], [12, 5], [3, 6], [4, 6]]) {
    p.px(x, y, 122, 102, 62);
  }
  // the X: somewhere worth walking to
  p.px(11, 12, 176, 58, 40); p.px(13, 12, 176, 58, 40);
  p.px(12, 13, 176, 58, 40);
  p.px(11, 14, 150, 48, 34); p.px(13, 14, 150, 48, 34);
};

// a squat cast bar, bright-topped, stamped like a field-journal specimen —
// one painter per metal (pal picks the material, stamp its foundry mark)
const ingotPainter = (pal, stamp) => (p) => {
  p.clear();
  const dot = (x, y, c, j = 6) => {
    const d = (p.rand() * 2 - 1) * j;
    p.px(x, y, c[0] + d, c[1] + d, c[2] + d);
  };
  for (let x = 4; x <= 11; x++) dot(x, 6, pal.hi);      // the bright top face
  for (let y = 7; y <= 9; y++) {
    for (let x = 3; x <= 12; x++) {
      dot(x, y, x === 3 || x === 12 ? pal.lo : pal.mid); // body + rounded ends
    }
  }
  for (let x = 4; x <= 11; x++) dot(x, 10, pal.lo);     // the shaded underside
  // the foundry stamp: a two-pip mark, counted like everything else
  p.px(7, 8, ...stamp); p.px(9, 8, ...stamp);
};
// the Sky-Iron Ingot: the sky that fell, folded and poured
painters[TILE.IRON_INGOT] = ingotPainter(TOOL_PALETTES.iron, [96, 104, 122]);
// the Gloamgold Ingot: the metal that sank, raised and poured
painters[TILE.GLOAM_INGOT] = ingotPainter(TOOL_PALETTES.gloam, [110, 78, 96]);

painters[TILE.ICE] = (p) => {
  // River Glass: milky pale blue with darker old-water depths leaning
  // through, hairline pressure cracks, and a few pinprick melt-holes (fully
  // transparent, so the cutout pane reads as ice rather than painted stone)
  p.noiseFill([176, 208, 232], 7);
  // depth veins: short dark meanders where the water shows through the lid
  for (let v = 0; v < 4; v++) {
    let x = (p.rand() * TILE_PX) | 0, y = (p.rand() * TILE_PX) | 0;
    const len = 4 + ((p.rand() * 5) | 0);
    for (let i = 0; i < len; i++) {
      const d = (p.rand() * 2 - 1) * 8;
      p.px(x, y, 118 + d, 158 + d, 198 + d);
      x = Math.max(0, Math.min(TILE_PX - 1, x + ((p.rand() * 3) | 0) - 1));
      y = Math.max(0, Math.min(TILE_PX - 1, y + ((p.rand() * 3) | 0) - 1));
    }
  }
  // two long pressure cracks, bright as a held breath
  for (const [sx, sy, dx, dy] of [[1, 12, 1, -1], [4, 1, 1, 1]]) {
    let x = sx, y = sy;
    while (x >= 0 && x < TILE_PX && y >= 0 && y < TILE_PX) {
      p.px(x, y, 228, 240, 250);
      if (p.rand() < 0.5) p.px(x + 1, y, 205, 224, 240);
      x += dx + (p.rand() < 0.3 ? dx : 0);
      y += p.rand() < 0.6 ? dy : 0;
    }
  }
  // melt pinholes: the only see-through pixels (alpha 0 -> cutout discard).
  // px() paints source-over, so punching a hole needs a real clearRect.
  for (let i = 0; i < 4; i++) {
    p.ctx.clearRect(p.ox + ((p.rand() * TILE_PX) | 0),
      p.oy + ((p.rand() * TILE_PX) | 0), 1, 1);
  }
  // a frosted glint near one corner
  p.px(3, 3, 240, 248, 254); p.px(4, 3, 240, 248, 254); p.px(3, 4, 226, 238, 248);
};

painters[TILE.GLEAM_MOSS] = (p) => {
  // Gleam Moss: low tufts of cave moss that learned to make their own light
  // down where sunlight was never reintroduced. Dim marsh-teal strands rise
  // from the bottom AND hang from the top (it takes floors and ceilings
  // alike; the cross mesh shows whichever way it grew), dusted with pale
  // nacre motes — the same drowned-star light the starstone keeps.
  p.clear();
  for (let t = 0; t < 7; t++) {
    const x = 1 + ((p.rand() * 14) | 0);
    const hgt = 3 + ((p.rand() * 4) | 0);
    const fromTop = t % 2 === 1;
    const lean = p.rand() < 0.5 ? -1 : 1;
    for (let i = 0; i < hgt; i++) {
      const d = (p.rand() * 2 - 1) * 10;
      const y = fromTop ? i : 15 - i;
      p.px(x + (i > hgt - 2 ? lean : 0), y, 58 + d, 116 + d, 92 + d);
    }
  }
  // the gleam: nacre motes caught in the strands
  for (let i = 0; i < 5; i++) {
    const x = 1 + ((p.rand() * 14) | 0), y = 2 + ((p.rand() * 12) | 0);
    p.px(x, y, 186, 234, 212);
    if (p.rand() < 0.6) p.px(x, y + 1, 146, 204, 182, 180);
  }
  // two bright cores — the pinches worth journaling
  p.px(4, 13, 224, 255, 236); p.px(11, 3, 224, 255, 236);
};

painters[TILE.RAIL_TIE] = (p) => {
  // Waybar ties: split knotwood, weather-grayed, laid crosswise — the grain
  // runs along x (across the track) with a few checked splits and the dark
  // peg-holes where the bars are spiked down
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const d = (p.rand() * 2 - 1) * 9;
      const grain = y % 5 === 2 ? -16 : 0; // long grain lines across
      p.px(x, y, 118 + d + grain, 96 + d + grain, 64 + d + grain);
    }
  }
  // checked splits: short dark cracks with the grain
  for (let s = 0; s < 3; s++) {
    const y = (p.rand() * TILE_PX) | 0;
    const x0 = (p.rand() * 10) | 0;
    const len = 3 + ((p.rand() * 4) | 0);
    for (let i = 0; i < len; i++) p.px(x0 + i, y, 78, 62, 40);
  }
  // spike heads at the bar lines (u 2-4 and 11-13 — where the bars sit)
  for (const x of [3, 12]) {
    for (const y of [2, 8, 13]) p.px(x, y, 88, 92, 104);
  }
};

painters[TILE.RAIL_BAR] = (p) => {
  // Waybar bars: sky-iron rolled flat, the running surface worn bright down
  // the middle (u), rust-bloom freckles at the edges
  p.noiseFill([142, 148, 162], 8);
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 5; x <= 10; x++) { // the wheel-polished stripe
      const d = (p.rand() * 2 - 1) * 6;
      p.px(x, y, 190 + d, 197 + d, 212 + d);
    }
  }
  p.speckle(10, [104, 96, 96], 8);  // rust freckle
  p.speckle(8, [166, 172, 188], 6);
};

painters[TILE.TRUNDLE] = (p) => {
  // the Trundle item: side view of a riveted sky-iron tub on two visible
  // wheels — rust-orange trim board along the rim (Wanderling colors)
  p.clear();
  const dot = (x, y, c, j = 7) => {
    const d = (p.rand() * 2 - 1) * j;
    p.px(x, y, c[0] + d, c[1] + d, c[2] + d);
  };
  const iron = [140, 147, 162], dark = [102, 108, 122], trim = [197, 106, 43];
  for (let x = 2; x <= 13; x++) dot(x, 4, trim, 10); // the rim board
  for (let y = 5; y <= 10; y++) {
    for (let x = 2; x <= 13; x++) {
      dot(x, y, x === 2 || x === 13 || y === 10 ? dark : iron);
    }
  }
  // rivet studs down the side
  p.px(4, 7, 190, 197, 212); p.px(8, 7, 190, 197, 212); p.px(11, 7, 190, 197, 212);
  // two wheels, hub-bright
  for (const cx of [4, 11]) {
    for (let y = 11; y <= 13; y++) for (let x = cx - 1; x <= cx + 1; x++) {
      if ((x === cx - 1 || x === cx + 1) && (y === 11 || y === 13)) continue;
      dot(x, y, [58, 60, 70], 6);
    }
    p.px(cx, 12, 150, 156, 170);
  }
};

painters[TILE.MUD] = (p) => {
  // Mire Sod: wet dark earth with a sheen — puddle glints and rot flecks
  p.noiseFill([74, 60, 44], 10);
  p.speckle(14, [52, 42, 30], 8);   // sodden clods
  p.speckle(8, [104, 92, 70], 6);   // drier crumbs
  p.speckle(5, [96, 104, 96], 4);   // the wet sheen catching light
};

painters[TILE.REEDS] = (p) => {
  // Marsh Reed: tall thin stalks with seed-heads nodding off the tops
  p.clear();
  for (const [sx, sway] of [[4, 0], [8, 1], [12, -1]]) {
    for (let y = 3; y < 16; y++) {
      const x = sx + (y < 8 ? sway : 0);
      const d = (p.rand() * 2 - 1) * 10;
      p.px(x, y, 96 + d, 134 + d, 74 + d);
    }
    // the seed-head: a fat brown tip
    const hx = sx + sway;
    p.px(hx, 2, 122, 92, 58); p.px(hx, 3, 134, 100, 62); p.px(hx, 4, 122, 92, 58);
  }
};

painters[TILE.BOGBEAN_POD] = (p) => {
  // Bogbean Pods: a little burlap twist of fat speckled beans
  p.clear();
  for (let y = 8; y <= 12; y++) {
    for (let x = 5; x <= 10; x++) {
      const edge = x === 5 || x === 10 || y === 12;
      const d = (p.rand() * 2 - 1) * 8;
      p.px(x, y, (edge ? 118 : 150) + d, (edge ? 96 : 124) + d, (edge ? 62 : 82) + d);
    }
  }
  p.px(7, 7, 150, 124, 82); p.px(8, 7, 150, 124, 82); // the tied twist
  p.px(7, 6, 96, 76, 50); p.px(8, 6, 96, 76, 50);
  // beans peeking out of the mouth
  p.px(6, 9, 168, 178, 120); p.px(9, 10, 158, 170, 112); p.px(7, 11, 148, 160, 104);
  p.px(6, 10, 120, 134, 84);
};

painters[TILE.WISPCAP] = (p) => {
  // a squat pale mushroom holding a scrap of the buried old daylight:
  // moon-white cap with a faint green-gold rim glow, slim stem
  p.clear();
  // stem
  for (let y = 10; y < 16; y++) {
    const d = (p.rand() * 2 - 1) * 6;
    p.px(7, y, 214 + d, 218 + d, 198 + d);
    p.px(8, y, 196 + d, 200 + d, 180 + d);
  }
  // cap: a dome from y6..y9, widest at the base
  const rows = [[7, 8], [6, 9], [5, 10], [4, 11]];
  rows.forEach(([x0, x1], i) => {
    const y = 6 + i;
    for (let x = x0; x <= x1; x++) {
      const d = (p.rand() * 2 - 1) * 8;
      p.px(x, y, 232 + d, 238 + d, 212 + d);
    }
  });
  // the wisp in the cap: a warm glowing heart + rim motes
  p.px(7, 7, 255, 246, 190); p.px(8, 7, 255, 246, 190);
  p.px(7, 8, 250, 240, 170); p.px(8, 8, 244, 236, 168);
  p.px(4, 9, 210, 232, 170); p.px(11, 9, 210, 232, 170);
  // gills: a darker underline where cap meets stem
  for (let x = 5; x <= 10; x++) p.px(x, 10, 168, 176, 150);
  // a spore mote drifting off the cap
  p.px(11, 5, 226, 240, 190); p.px(3, 6, 218, 234, 184);
};

painters[TILE.LAVA] = (p) => {
  // the Emberwash: a dark crust webbed with molten seams. The shader lights
  // it by its own emitter, so the brights here read as glow without any
  // animation — deep chars for the crust, saturated oranges for the melt.
  p.noiseFill([96, 34, 12], 14);
  // molten seams: bright meanders that fork across the crust
  for (let v = 0; v < 5; v++) {
    let x = (p.rand() * TILE_PX) | 0, y = (p.rand() * TILE_PX) | 0;
    const len = 5 + ((p.rand() * 6) | 0);
    for (let i = 0; i < len; i++) {
      const d = (p.rand() * 2 - 1) * 20;
      p.px(x, y, 244 + d * 0.2, 140 + d, 30 + d * 0.4);
      if (p.rand() < 0.4) p.px(x + 1, y, 210, 96, 20);
      x = Math.max(0, Math.min(TILE_PX - 1, x + ((p.rand() * 3) | 0) - 1));
      y = Math.max(0, Math.min(TILE_PX - 1, y + ((p.rand() * 3) | 0) - 1));
    }
  }
  // white-hot pinpricks where the crust has just given way
  p.speckle(6, [252, 208, 96], 20);
  // cooled slag flecks
  p.speckle(10, [58, 22, 10], 8);
};

// the Sky-Iron Pail: a riveted tub, drawn side-on like the Trundle. A shared
// body painter (the sky-iron staves, the hoop bands, the two big rivets and
// the arched bail handle), then each fill paints its own contents into the
// mouth. Sky-iron reads bright-cool, per the tool palette.
const pailBody = (p, fill) => {
  p.clear();
  const iron = TOOL_PALETTES.iron;
  const band = (x, y, c, j = 8) => {
    const d = (p.rand() * 2 - 1) * j;
    p.px(x, y, c[0] + d, c[1] + d, c[2] + d);
  };
  // the bail handle: an arch of thin iron over the mouth
  for (const [hx, hy] of [[4, 2], [5, 1], [6, 1], [7, 1], [8, 1], [9, 1], [10, 1], [11, 2]]) {
    band(hx, hy, iron.lo, 4);
  }
  // the tub body: a slightly tapered bucket, mouth at y=3, base at y=13
  for (let y = 3; y <= 13; y++) {
    const inset = y >= 12 ? 1 : 0;          // the base draws in a touch
    const x0 = 3 + inset, x1 = 12 - inset;
    for (let x = x0; x <= x1; x++) {
      const rim = y === 3;                  // the bright lip catches the light
      const wall = x === x0 || x === x1;
      const hoop = y === 5 || y === 10;     // two reinforcing hoop bands
      if (rim) band(x, y, iron.hi, 6);
      else if (fill && y >= 4 && y <= 6 && x > x0 && x < x1) fill(p, x, y); // contents
      else if (hoop) band(x, y, iron.lo, 5);
      else band(x, y, wall ? iron.lo : iron.mid, 7);
    }
  }
  // two riveted studs on the near stave
  p.px(6, 8, iron.hi[0], iron.hi[1], iron.hi[2]);
  p.px(9, 8, iron.hi[0], iron.hi[1], iron.hi[2]);
};
painters[TILE.PAIL] = (p) => {
  // empty: the mouth shows the dark inner wall of the tub
  pailBody(p, (pp, x, y) => {
    const d = (pp.rand() * 2 - 1) * 5;
    pp.px(x, y, 70 + d, 76 + d, 88 + d);
  });
};
painters[TILE.PAIL_WATER] = (p) => {
  // brimful of the old water: a cool blue surface with a bright glint
  pailBody(p, (pp, x, y) => {
    const d = (pp.rand() * 2 - 1) * 10;
    pp.px(x, y, 60 + d, 118 + d, 176 + d);
    if (y === 4 && pp.rand() < 0.4) pp.px(x, y, 150, 198, 232); // surface glint
  });
};
painters[TILE.PAIL_EMBER] = (p) => {
  // a scoop of the Emberwash: a dark crust broken by bright molten seams —
  // and it glows in the tub, a warm light the icon carries in the hand
  pailBody(p, (pp, x, y) => {
    const hot = pp.rand() < 0.45;
    const d = (pp.rand() * 2 - 1) * 18;
    if (hot) pp.px(x, y, 244 + d * 0.2, 150 + d, 44 + d * 0.5); // molten seam
    else pp.px(x, y, 60 + d * 0.3, 26 + d * 0.3, 16 + d * 0.3); // dark crust
  });
  // a warm bloom leaking over the near rim — the faint held glow
  p.px(5, 3, 255, 196, 96); p.px(10, 3, 255, 196, 96);
  p.px(7, 2, 255, 214, 128, 200);
};

// Cinderglass: the Emberwash slaked. A near-black volcanic glass with a faint
// warm/violet sheen still trapped in it — dense, glassy, and very hard. Opaque
// cube (unlike River Glass, this keeps no light through), pick-gated iron+.
painters[TILE.CINDERGLASS] = (p) => {
  p.noiseFill([26, 22, 30], 6);
  // conchoidal glass fractures: short pale-violet arcs catching the light
  for (let f = 0; f < 4; f++) {
    let x = 2 + ((p.rand() * 12) | 0), y = 2 + ((p.rand() * 12) | 0);
    const len = 3 + ((p.rand() * 4) | 0);
    for (let i = 0; i < len; i++) {
      const d = (p.rand() * 2 - 1) * 10;
      p.px(x, y, 68 + d, 58 + d, 84 + d);
      x = Math.max(0, Math.min(TILE_PX - 1, x + ((p.rand() * 3) | 0) - 1));
      y = Math.max(0, Math.min(TILE_PX - 1, y + 1));
    }
  }
  // a couple of trapped ember glints the quench never fully cooled
  p.px(4, 11, 128, 74, 46); p.px(12, 5, 110, 66, 42);
  // glassy highlights
  p.speckle(10, [58, 52, 72], 8);
  p.px(3, 3, 96, 86, 116); p.px(11, 12, 88, 78, 108);
};

painters[TILE.WANDERWING] = (p) => {
  // a folded patchwork wing-cape: a green membrane trapezoid stitched from
  // panels over pale quill ribs, gathered at a mustard collar and hanging to
  // a split hem. Seed jitter reads as the patchwork; the world model tints it.
  p.clear();
  const MID = [96, 138, 78], LO = [72, 108, 60], HI = [116, 156, 96];
  const RIB = [206, 198, 168], COLLAR = [214, 176, 74];
  const dot = (x, y, c, j = 8) => {
    if (x < 0 || y < 0 || x >= TILE_PX || y >= TILE_PX) return;
    const d = (p.rand() * 2 - 1) * j;
    p.px(x, y, c[0] + d, c[1] + d, c[2] + d);
  };
  for (let y = 2; y <= 14; y++) {
    // the cape narrows from collar to hem
    const half = Math.max(3, Math.round(6 - (y - 2) * 0.22));
    for (let x = 8 - half; x <= 7 + half; x++) {
      // patchwork: 3×3 panels shaded from a small hash of their cell
      const panel = ((x / 3) | 0) + ((y / 3) | 0);
      const edge = x === 8 - half || x === 7 + half || y === 14;
      dot(x, y, edge ? LO : (panel & 1 ? HI : MID));
    }
    // the two quill ribs run the length of each half
    if (y >= 3) { dot(5, y, RIB, 5); dot(10, y, RIB, 5); }
    // the fold seam down the middle, and the split at the hem
    dot(7, y, y >= 11 ? [0, 0, 0] : LO, 4);
  }
  // the hem parts into two furled points
  for (let x = 6; x <= 9; x++) if (x !== 7 && x !== 8) dot(x, 14, MID);
  // the collar lashing gathers the top
  for (let x = 3; x <= 12; x++) dot(x, 2, COLLAR, 5);
  dot(6, 2, [64, 52, 30], 3); dot(9, 2, [64, 52, 30], 3); // lashing knots
  // a few stitch-cross patches
  p.px(4, 6, RIB[0], RIB[1], RIB[2]); p.px(11, 8, RIB[0], RIB[1], RIB[2]);
  p.px(6, 10, RIB[0], RIB[1], RIB[2]);
};

// a Festival Rocket icon: an upright paper tube with a pointed nose-cone, a
// wound color-band that tells the burst apart, and a little fuse curling off
// the base. `band` is the agent's [r,g,b]; the tube/nose stay neutral paper.
const rocketPainter = (band) => (p) => {
  p.clear();
  const PAPER = [206, 198, 180], PAPER_HI = [230, 224, 210], PAPER_LO = [150, 142, 126];
  const NOSE = [176, 120, 96];
  const dot = (x, y, c, j = 6) => {
    if (x < 0 || y < 0 || x >= TILE_PX || y >= TILE_PX) return;
    const d = (p.rand() * 2 - 1) * j;
    p.px(x, y, c[0] + d, c[1] + d, c[2] + d);
  };
  // the body tube runs x 6..9, y 5..13; a highlight column on the left edge
  for (let y = 5; y <= 13; y++) {
    for (let x = 6; x <= 9; x++) {
      const band0 = y >= 8 && y <= 10; // the wound color-band around the middle
      const c = band0 ? band : (x === 6 ? PAPER_HI : x === 9 ? PAPER_LO : PAPER);
      dot(x, y, c, band0 ? 10 : 6);
    }
  }
  // the pointed nose-cone tapering to a tip at y 2
  dot(7, 4, NOSE); dot(8, 4, NOSE);
  dot(7, 3, NOSE); dot(8, 3, NOSE);
  dot(7, 2, [210, 196, 150], 4); // a bright cap on the point
  // a bright fleck of the burst color peeking from the nose (the charge)
  p.px(8, 5, band[0], band[1], band[2]);
  // the fuse curling off the base, and a glowing spark at its tip
  dot(9, 14, [70, 60, 48], 3);
  dot(10, 15, [70, 60, 48], 3);
  p.px(11, 15, 255, 220, 150);
  p.px(11, 14, 255, 244, 200);
};
painters[TILE.ROCKET_SUN] = rocketPainter([236, 190, 66]);
painters[TILE.ROCKET_EMBER] = rocketPainter([214, 74, 56]);
painters[TILE.ROCKET_GLEAM] = rocketPainter([120, 214, 174]);

painters[TILE.CINDER_FILM] = (p) => {
  // the Cinder Door's film: the Emberwash's fire given back to the glass.
  // An ember-orange heart cooling to deep plum at the rim, crossed by the
  // same bright seams the molten pools wear, with a few nacre sparks — the
  // old sky showing through the open door. Dithered dark pixels keep it
  // reading as a sheet of light, not a wall.
  p.noiseFill([44, 22, 52], 8);
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      // radial heat: bright at the center, plum toward the rim
      const dx = x - 7.5, dy = y - 7.5;
      const heat = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / 9);
      if (p.rand() < 0.28) continue; // the dither — dark cells stay plum
      const d = (p.rand() * 2 - 1) * 12;
      p.px(x, y,
        60 + heat * 150 + d,
        26 + heat * 74 + d * 0.6,
        58 + heat * 8 + d * 0.4);
    }
  }
  // bright seams wandering the sheet, like the Emberwash's crust cracks
  for (let s = 0; s < 3; s++) {
    let x = 2 + ((p.rand() * 12) | 0);
    for (let y = 1; y < 15; y++) {
      p.px(x, y, 236, 148, 84);
      if (p.rand() < 0.5) x = Math.max(1, Math.min(14, x + (p.rand() < 0.5 ? -1 : 1)));
    }
  }
  // nacre sparks — the drowned stars on the far side
  p.px(4, 3, 226, 230, 246); p.px(12, 6, 238, 240, 252); p.px(6, 12, 226, 230, 246);
};

painters[TILE.PEARLSAND] = (p) => {
  // pearlsand: the sand recipe gone nacre — a pale violet-grey bed with the
  // faint two-tone shimmer of the inside of a shell (a few pink and green
  // glints where the drowned light still catches)
  p.noiseFill([196, 188, 198], 10);
  p.speckle(14, [176, 166, 182], 8);
  p.speckle(8, [214, 208, 218], 6);
  p.px(3, 5, 210, 186, 196); p.px(12, 9, 208, 190, 184);   // pink glints
  p.px(7, 12, 186, 204, 194); p.px(13, 3, 190, 206, 198);  // green glints
};

painters[TILE.STARKELP] = (p) => {
  // starkelp: a petrified kelp stalk, dark sea-slate with a gentle sway
  // baked into its silhouette, carrying three lit beads — the drowned
  // light that never quite went out
  p.clear();
  const STALK = [46, 66, 64], EDGE = [34, 50, 50], FROND = [58, 84, 76];
  let x = 8;
  for (let y = 15; y >= 2; y--) {
    const d = (p.rand() * 2 - 1) * 8;
    p.px(x, y, STALK[0] + d, STALK[1] + d, STALK[2] + d);
    p.px(x - 1, y, EDGE[0] + d, EDGE[1] + d, EDGE[2] + d);
    if (y % 4 === 1) { // short fronds trailing off the sway
      p.px(x + 1, y, FROND[0], FROND[1], FROND[2]);
      p.px(x - 2, y - 1, FROND[0] - 8, FROND[1] - 8, FROND[2] - 8);
    }
    if (p.rand() < 0.4 && y > 3) x = Math.max(5, Math.min(11, x + (p.rand() < 0.5 ? -1 : 1)));
  }
  // the beads: nacre-bright cores with a green-white halo pixel each
  for (const [bx, by] of [[8, 12], [7, 7], [9, 4]]) {
    p.px(bx, by, 224, 240, 226);
    p.px(bx, by - 1, 168, 204, 182);
  }
};

painters[TILE.NACRE] = (p) => {
  // a curved shard of shell: pearly layers banded across the chip, with
  // the two-tone shimmer pearlsand borrows — pink one way, green the other
  p.clear();
  for (let y = 4; y <= 12; y++) {
    const half = Math.round(5 - Math.abs(y - 8) * 0.55); // a lens shape
    for (let x = 8 - half; x <= 7 + half; x++) {
      const band = (y - 4) % 3;
      const c = band === 0 ? [226, 228, 238] : band === 1 ? [204, 206, 222] : [186, 190, 210];
      const d = (p.rand() * 2 - 1) * 6;
      p.px(x, y, c[0] + d, c[1] + d, c[2] + d);
    }
  }
  p.px(6, 6, 232, 206, 214); p.px(10, 10, 208, 228, 216); // the shimmer
  p.px(5, 9, 244, 246, 250); // one bright catch of light
};

export function buildAtlas(seed = 1337) {
  const size = ATLAS_TILES * TILE_PX;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  for (const [tileIndex, paint] of Object.entries(painters)) {
    const rand = mulberry32(seed + Number(tileIndex) * 7919);
    paint(new TilePainter(ctx, Number(tileIndex), rand));
  }

  // average color per tile (used for particles and icon fallbacks)
  const avg = {};
  for (const tileIndex of Object.keys(painters)) {
    const i = Number(tileIndex);
    const ox = (i % ATLAS_TILES) * TILE_PX, oy = Math.floor(i / ATLAS_TILES) * TILE_PX;
    const data = ctx.getImageData(ox, oy, TILE_PX, TILE_PX).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let k = 0; k < data.length; k += 4) {
      if (data[k + 3] < 32) continue;
      r += data[k]; g += data[k + 1]; b += data[k + 2]; n++;
    }
    n = Math.max(n, 1);
    avg[i] = [r / n / 255, g / n / 255, b / n / 255];
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;

  return { canvas, texture, avgColor: avg };
}

// Mining crack overlay: 4 stages of increasingly dense fracture lines on a
// transparent tile, used on a slightly inflated box over the mined block.
export function buildCrackTextures(seed = 1337) {
  const stages = [];
  for (let stage = 0; stage < 4; stage++) {
    const canvas = document.createElement("canvas");
    canvas.width = TILE_PX;
    canvas.height = TILE_PX;
    const ctx = canvas.getContext("2d");
    const rand = mulberry32(seed ^ (0xc4ac + stage * 131));
    ctx.clearRect(0, 0, TILE_PX, TILE_PX);
    const cracks = 2 + stage * 2;
    for (let c = 0; c < cracks; c++) {
      let x = (rand() * TILE_PX) | 0;
      let y = (rand() * TILE_PX) | 0;
      const steps = 4 + ((rand() * 6) | 0) + stage * 2;
      for (let s = 0; s < steps; s++) {
        const shade = 20 + rand() * 30;
        ctx.fillStyle = `rgba(${shade},${shade},${shade},0.85)`;
        ctx.fillRect(x, y, 1, 1);
        x = Math.max(0, Math.min(TILE_PX - 1, x + ((rand() * 3) | 0) - 1));
        y = Math.max(0, Math.min(TILE_PX - 1, y + ((rand() * 3) | 0) - 1));
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    stages.push(tex);
  }
  return stages;
}

// Standalone repeating water texture (separate from the atlas so its UV
// offset can be animated without dragging every other tile along).
export function buildWaterTexture(seed = 1337) {
  const canvas = document.createElement("canvas");
  canvas.width = TILE_PX;
  canvas.height = TILE_PX;
  const ctx = canvas.getContext("2d");
  const rand = mulberry32(seed ^ 0xaa77a);
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const d = (rand() * 2 - 1) * 10;
      // faint horizontal banding reads as ripples once it scrolls
      const band = (y + ((x * 0.5) | 0)) % 4 === 0 ? 12 : 0;
      ctx.fillStyle = `rgb(${53 + d + band},${105 + d + band},${200 + d + band})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// UV rect for a tile, inset by half a texel to avoid atlas bleeding.
export function tileUV(tileIndex) {
  const inset = 0.5 / (ATLAS_TILES * TILE_PX);
  const col = tileIndex % ATLAS_TILES;
  const row = Math.floor(tileIndex / ATLAS_TILES);
  const s = 1 / ATLAS_TILES;
  return {
    u0: col * s + inset,
    u1: (col + 1) * s - inset,
    v0: 1 - (row + 1) * s + inset, // bottom
    v1: 1 - row * s - inset,       // top
  };
}

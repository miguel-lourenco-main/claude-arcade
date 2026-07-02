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

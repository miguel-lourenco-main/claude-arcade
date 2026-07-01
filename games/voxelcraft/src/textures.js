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

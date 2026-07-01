// Procedural terrain: heightmap + biomes + caves + water + deterministic
// decoration (trees, cacti, plants). Everything is a pure function of world
// coordinates and the seed, so features spanning chunk borders stay coherent.

import {
  GRASS, DIRT, STONE, SAND, GRAVEL, LOG, LEAVES, LEAVES_COLD, WATER, BEDROCK,
  SNOWY_GRASS, TALLGRASS, POPPY, DANDELION, CACTUS, SANDSTONE, AIR,
} from "./blocks.js";
import { CHUNK, HEIGHT, SEA_LEVEL } from "./world.js";
import { Perlin, hash2 } from "./noise.js";

const TREE_MARGIN = 3; // canopy radius 2 + 1 safety

function smoothstep(a, b, t) {
  t = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export class Terrain {
  constructor(seed) {
    this.seed = seed;
    this.continent = new Perlin(seed ^ 0x1a2b3c);
    this.hills = new Perlin(seed ^ 0x4d5e6f);
    this.mountainMask = new Perlin(seed ^ 0x70819a);
    this.temperature = new Perlin(seed ^ 0xbcadde);
    this.moisture = new Perlin(seed ^ 0xef0123);
    this.cave1 = new Perlin(seed ^ 0x456789);
    this.cave2 = new Perlin(seed ^ 0x9abcde);
  }

  heightAt(x, z) {
    const continent = this.continent.fbm2(x * 0.0016, z * 0.0016, 4);
    const mask = smoothstep(0.05, 0.6, this.mountainMask.fbm2(x * 0.0022 + 500, z * 0.0022 - 500, 3));
    const hills = this.hills.fbm2(x * 0.009, z * 0.009, 4);
    const base = SEA_LEVEL + 3 + continent * 14;
    const relief = hills * (5 + mask * mask * 34);
    const h = Math.round(base + relief);
    return Math.min(HEIGHT - 12, Math.max(3, h));
  }

  // temperature/moisture in [0,1]; temperature drops with altitude
  climateAt(x, z, h) {
    let temp = 0.5 + 0.5 * this.temperature.fbm2(x * 0.0021 + 3000, z * 0.0021, 3);
    temp -= Math.max(0, h - 44) * 0.012;
    const moist = 0.5 + 0.5 * this.moisture.fbm2(x * 0.0024 - 3000, z * 0.0024 + 1500, 3);
    return { temp, moist };
  }

  biomeAt(x, z, h) {
    const { temp, moist } = this.climateAt(x, z, h);
    if (temp < 0.32) return "snow";
    if (temp > 0.62 && moist < 0.42) return "desert";
    if (moist > 0.55) return "forest";
    return "plains";
  }

  isCave(x, y, z) {
    // spaghetti tunnels: near-zero surfaces of two independent noises
    const n1 = this.cave1.fbm3(x * 0.02, y * 0.028, z * 0.02, 2);
    const n2 = this.cave2.fbm3(x * 0.02 + 400, y * 0.028 - 400, z * 0.02 + 800, 2);
    if (n1 * n1 + n2 * n2 < 0.008) return true;
    // occasional larger caverns deeper down
    if (y < 26 && this.cave1.fbm3(x * 0.045, y * 0.05, z * 0.045, 3) > 0.56) return true;
    return false;
  }

  treeAt(x, z, biome, h) {
    if (h <= SEA_LEVEL + 1 || h >= HEIGHT - 12) return null;
    const density = biome === "forest" ? 0.022 : biome === "plains" ? 0.004 : biome === "snow" ? 0.008 : 0;
    if (density === 0) return null;
    if (hash2(x, z, this.seed ^ 0x7ee7) >= density) return null;
    // avoid trees hugging each other: dominant tree per 3x3 neighborhood
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      if (dx === 0 && dz === 0) continue;
      const other = hash2(x + dx, z + dz, this.seed ^ 0x7ee7);
      const otherBiome = density; // same order of magnitude; cheap comparison below
      if (other < otherBiome && other < hash2(x, z, this.seed ^ 0x7ee7)) return null;
    }
    const trunk = 4 + Math.floor(hash2(x, z, this.seed ^ 0x1e00) * 3); // 4..6
    return { trunk, leaves: biome === "snow" ? LEAVES_COLD : LEAVES };
  }

  cactusAt(x, z, biome, h) {
    if (biome !== "desert" || h <= SEA_LEVEL) return 0;
    if (hash2(x, z, this.seed ^ 0xcac7) >= 0.0035) return 0;
    return 1 + Math.floor(hash2(x, z, this.seed ^ 0xcac8) * 3); // 1..3
  }
}

export function makeGenerator(seed) {
  const t = new Terrain(seed);

  const generate = (world, chunk) => {
    const x0 = chunk.cx * CHUNK, z0 = chunk.cz * CHUNK;

    // pass 1: columns
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = x0 + lx, z = z0 + lz;
        const h = t.heightAt(x, z);
        const biome = t.biomeAt(x, z, h);
        const beach = h >= SEA_LEVEL - 2 && h <= SEA_LEVEL + 1;

        for (let y = 0; y <= h; y++) {
          let id;
          if (y === 0 || (y <= 2 && hash2(x * 3 + y, z * 3, seed ^ 0xbed) < 0.6)) {
            id = BEDROCK;
          } else if (y > 3 && y < h - 2 && t.isCave(x, y, z)) {
            id = AIR;
          } else if (biome === "desert") {
            if (y > h - 4) id = SAND;
            else if (y > h - 9) id = SANDSTONE;
            else id = STONE;
          } else if (y === h) {
            if (beach) id = h >= SEA_LEVEL ? SAND : GRAVEL;
            else if (h < SEA_LEVEL - 1) id = GRAVEL; // lake/ocean floor
            else if (biome === "snow") id = SNOWY_GRASS;
            else id = GRASS;
          } else if (y > h - 4) {
            id = beach || h < SEA_LEVEL ? SAND : DIRT;
          } else {
            id = STONE;
          }
          if (id !== AIR) chunk.set(lx, y, lz, id);
        }

        // surface water
        if (h < SEA_LEVEL) {
          for (let y = h + 1; y <= SEA_LEVEL; y++) chunk.set(lx, y, lz, WATER);
        }
      }
    }

    // pass 2: decoration, scanning a margin so trees from neighbor columns
    // spill into this chunk deterministically
    for (let dz = -TREE_MARGIN; dz < CHUNK + TREE_MARGIN; dz++) {
      for (let dx = -TREE_MARGIN; dx < CHUNK + TREE_MARGIN; dx++) {
        const x = x0 + dx, z = z0 + dz;
        const h = t.heightAt(x, z);
        const biome = t.biomeAt(x, z, h);
        const inChunk = dx >= 0 && dx < CHUNK && dz >= 0 && dz < CHUNK;

        // skip columns whose surface was carved away by a cave opening
        const surfaceCarved = h > 3 && t.isCave(x, h, z);

        const tree = surfaceCarved ? null : t.treeAt(x, z, biome, h);
        if (tree) {
          stampTree(chunk, x - x0, z - z0, h, tree);
          continue;
        }

        if (!inChunk || surfaceCarved) continue;

        const cactus = t.cactusAt(x, z, biome, h);
        if (cactus > 0) {
          for (let i = 1; i <= cactus; i++) {
            if (h + i < HEIGHT) chunk.set(dx, h + i, dz, CACTUS);
          }
          continue;
        }

        // plants on grass
        if ((biome === "plains" || biome === "forest") && h > SEA_LEVEL + 1 && h + 1 < HEIGHT) {
          const r = hash2(x, z, seed ^ 0xf10a);
          if (chunk.get(dx, h, dz) === GRASS) {
            if (r < 0.06) chunk.set(dx, h + 1, dz, TALLGRASS);
            else if (r < 0.068) chunk.set(dx, h + 1, dz, POPPY);
            else if (r < 0.076) chunk.set(dx, h + 1, dz, DANDELION);
          }
        }
      }
    }
  };

  const stampTree = (chunk, lx, lz, h, tree) => {
    const top = h + tree.trunk;
    const put = (dx, y, dz, id, onlyAir = true) => {
      const tx = lx + dx, tz = lz + dz;
      if (tx < 0 || tx >= CHUNK || tz < 0 || tz >= CHUNK || y < 0 || y >= HEIGHT) return;
      if (onlyAir && chunk.get(tx, y, tz) !== AIR) return;
      chunk.set(tx, y, tz, id);
    };
    // canopy: two wide layers, then a narrow cap
    for (let y = top - 2; y <= top - 1; y++) {
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2 && hash2(lx * 31 + dx + y, lz * 31 + dz, 99) < 0.5) continue;
        put(dx, y, dz, tree.leaves);
      }
    }
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (Math.abs(dx) === 1 && Math.abs(dz) === 1) continue;
      put(dx, top, dz, tree.leaves);
      if (dx === 0 && dz === 0) put(0, top + 1, 0, tree.leaves);
    }
    // trunk overwrites leaves
    for (let y = h + 1; y < top; y++) put(0, y, 0, LOG, false);
  };

  generate.terrain = t;
  return generate;
}

// Find a dry-land spawn column near the origin (expanding ring search).
export function findSpawn(terrain) {
  for (let r = 0; r < 64; r += 4) {
    for (let a = 0; a < 16; a++) {
      const x = Math.round(Math.cos((a / 16) * Math.PI * 2) * r);
      const z = Math.round(Math.sin((a / 16) * Math.PI * 2) * r);
      const h = terrain.heightAt(x, z);
      if (h > SEA_LEVEL + 1 && h < HEIGHT - 20) {
        return { x: x + 0.5, y: h + 2.5, z: z + 0.5 };
      }
    }
  }
  return { x: 0.5, y: HEIGHT - 20, z: 0.5 };
}

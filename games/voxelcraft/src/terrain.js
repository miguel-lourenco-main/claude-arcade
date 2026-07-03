// Procedural terrain: heightmap + biomes + caves + ores + water and
// deterministic decoration (trees, cacti, plants). Everything is a pure
// function of world coordinates and the seed, so features spanning chunk
// borders stay coherent.

import {
  GRASS, DIRT, STONE, SAND, GRAVEL, LOG, LEAVES, LEAVES_COLD, WATER, BEDROCK,
  SNOWY_GRASS, TALLGRASS, POPPY, DANDELION, CACTUS, SANDSTONE, COAL_ORE,
  IRON_ORE, BERRY_BUSH, SNOW_LAYER, ICE, AIR, LAVA,
} from "./blocks.js";
import { CHUNK, HEIGHT, SEA_LEVEL } from "./world.js";
import { Perlin, hash2 } from "./noise.js";
import { ruinForChunk, stampRuin, seedRuinState } from "./ruins.js";

const TREE_CELL = 5;   // one tree candidate per 5x5-column cell (grid jitter)
const TREE_MARGIN = 3; // canopy radius 2 + 1 safety
// the Emberwash line: cave cells carved at or below this height flood with
// molten rock instead of air — a flat "sea level" for the deep, safely above
// the bedrock band (y <= 2) and well under the cavern belt (y < 26)
const LAVA_LEVEL = 11;

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

  oreAt(x, y, z, h) {
    if (y >= h - 3) return 0;
    if (this.cave1.fbm3(x * 0.13 + 911, y * 0.13, z * 0.13 - 911, 2) > 0.58) return COAL_ORE;
    if (y < 28 && this.cave2.fbm3(x * 0.15 - 911, y * 0.15, z * 0.15 + 911, 2) > 0.62) return IRON_ORE;
    return 0;
  }

  // One tree candidate per TREE_CELL x TREE_CELL cell, at a jittered position.
  // Grid placement guarantees spacing without any neighbor-dominance scan.
  treeCellAt(cx5, cz5) {
    const roll = hash2(cx5, cz5, this.seed ^ 0x7ee7);
    const jx = cx5 * TREE_CELL + Math.floor(hash2(cx5, cz5, this.seed ^ 0x11aa) * TREE_CELL);
    const jz = cz5 * TREE_CELL + Math.floor(hash2(cx5, cz5, this.seed ^ 0x22bb) * TREE_CELL);
    const h = this.heightAt(jx, jz);
    if (h <= SEA_LEVEL + 1 || h >= HEIGHT - 12) return null;
    const biome = this.biomeAt(jx, jz, h);
    const density = biome === "forest" ? 0.55 : biome === "plains" ? 0.1 : biome === "snow" ? 0.2 : 0;
    if (roll >= density) return null;
    const trunk = 4 + Math.floor(hash2(jx, jz, this.seed ^ 0x1e00) * 3); // 4..6
    return { x: jx, z: jz, h, trunk, leaves: biome === "snow" ? LEAVES_COLD : LEAVES };
  }

  treeNear(x, z, radius = 1) {
    const c0x = Math.floor((x - radius) / TREE_CELL), c1x = Math.floor((x + radius) / TREE_CELL);
    const c0z = Math.floor((z - radius) / TREE_CELL), c1z = Math.floor((z + radius) / TREE_CELL);
    for (let cz5 = c0z; cz5 <= c1z; cz5++) for (let cx5 = c0x; cx5 <= c1x; cx5++) {
      const t = this.treeCellAt(cx5, cz5);
      if (t && Math.abs(t.x - x) <= radius && Math.abs(t.z - z) <= radius) return true;
    }
    return false;
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

    // cached column data: heights for chunk + 1-cell border (for the cave
    // water guard), biomes for in-chunk columns
    const H = new Int16Array((CHUNK + 2) * (CHUNK + 2));
    const hAt = (dx, dz) => H[(dx + 1) + (CHUNK + 2) * (dz + 1)];
    for (let dz = -1; dz <= CHUNK; dz++) {
      for (let dx = -1; dx <= CHUNK; dx++) {
        H[(dx + 1) + (CHUNK + 2) * (dz + 1)] = t.heightAt(x0 + dx, z0 + dz);
      }
    }
    const biomes = new Array(CHUNK * CHUNK);

    // pass 1: columns
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = x0 + lx, z = z0 + lz;
        const h = hAt(lx, lz);
        const biome = t.biomeAt(x, z, h);
        biomes[lx + CHUNK * lz] = biome;
        const beach = h >= SEA_LEVEL - 2 && h <= SEA_LEVEL + 1;
        // lowest neighboring column floor: a cave cell at or below a
        // neighbor's water line would open a hole into static water
        const minNbH = Math.min(hAt(lx - 1, lz), hAt(lx + 1, lz), hAt(lx, lz - 1), hAt(lx, lz + 1));

        for (let y = 0; y <= h; y++) {
          let id;
          if (y === 0 || (y <= 2 && hash2(x * 3 + y, z * 3, seed ^ 0xbed) < 0.6)) {
            id = BEDROCK;
          } else if (y > 3 && y < h - 2 && (y > SEA_LEVEL || minNbH >= y) && t.isCave(x, y, z)) {
            // the deepest carvings hold the Emberwash — pools with a flat,
            // chunk-coherent surface (pure function of y, like the carve)
            id = y <= LAVA_LEVEL ? LAVA : AIR;
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
          if (id === STONE) id = t.oreAt(x, y, z, h) || STONE;
          if (id !== AIR) chunk.set(lx, y, lz, id);
        }

        // surface water — the Rimelands pull a River Glass lid over theirs
        // (only the topmost cell freezes; the old water waits underneath)
        if (h < SEA_LEVEL) {
          for (let y = h + 1; y <= SEA_LEVEL; y++) chunk.set(lx, y, lz, WATER);
          if (biome === "snow") chunk.set(lx, SEA_LEVEL, lz, ICE);
        }
      }
    }

    // pass 2a: trees from grid cells overlapping the chunk + canopy margin
    const c0x = Math.floor((x0 - TREE_MARGIN) / TREE_CELL);
    const c1x = Math.floor((x0 + CHUNK - 1 + TREE_MARGIN) / TREE_CELL);
    const c0z = Math.floor((z0 - TREE_MARGIN) / TREE_CELL);
    const c1z = Math.floor((z0 + CHUNK - 1 + TREE_MARGIN) / TREE_CELL);
    for (let cz5 = c0z; cz5 <= c1z; cz5++) {
      for (let cx5 = c0x; cx5 <= c1x; cx5++) {
        const tree = t.treeCellAt(cx5, cz5);
        if (tree) stampTree(chunk, tree.x - x0, tree.z - z0, tree.h, tree);
      }
    }

    // pass 2b: cacti and plants (single-column features, no margin needed)
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = x0 + lx, z = z0 + lz;
        const h = hAt(lx, lz);
        const biome = biomes[lx + CHUNK * lz];

        const cactus = t.cactusAt(x, z, biome, h);
        if (cactus > 0 && chunk.get(lx, h, lz) === SAND) {
          for (let i = 1; i <= cactus; i++) {
            if (h + i < HEIGHT && chunk.get(lx, h + i, lz) === AIR) chunk.set(lx, h + i, lz, CACTUS);
          }
          continue;
        }

        // the Rimelands: scattered Snowdrifts on open snowy turf (skipping
        // columns a rimewood trunk/canopy already claimed). Deterministic
        // from the seed like every other decoration.
        if (biome === "snow" && h > SEA_LEVEL && h + 1 < HEIGHT) {
          const rs = hash2(x, z, seed ^ 0x5d01f);
          if (rs < 0.3 && chunk.get(lx, h, lz) === SNOWY_GRASS &&
              chunk.get(lx, h + 1, lz) === AIR) {
            chunk.set(lx, h + 1, lz, SNOW_LAYER);
          }
          continue;
        }

        if ((biome === "plains" || biome === "forest") && h > SEA_LEVEL + 1 && h + 1 < HEIGHT) {
          // bog brambles: ~0.8% of grass columns carry a berry shrub
          const rb = hash2(x, z, seed ^ 0xbe221);
          if (rb < 0.008 && chunk.get(lx, h, lz) === GRASS && chunk.get(lx, h + 1, lz) === AIR) {
            chunk.set(lx, h + 1, lz, BERRY_BUSH);
            continue;
          }
          const r = hash2(x, z, seed ^ 0xf10a);
          if (r < 0.076 && chunk.get(lx, h, lz) === GRASS && chunk.get(lx, h + 1, lz) === AIR) {
            if (r < 0.06) chunk.set(lx, h + 1, lz, TALLGRASS);
            else if (r < 0.068) chunk.set(lx, h + 1, lz, POPPY);
            else chunk.set(lx, h + 1, lz, DANDELION);
          }
        }
      }
    }

    // pass 3: the Steads-Before — ~1 chunk in 40 carries a homestead ruin
    // (see ruins.js). Stamped last so it clears any tree/plant that wandered
    // into its footprint; strictly chunk-local, so every other chunk
    // generates exactly as it always did.
    const ruin = ruinForChunk(t, chunk.cx, chunk.cz);
    if (ruin) {
      stampRuin(chunk, ruin);
      seedRuinState(world, ruin);
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

// A column the player can safely stand on: dry land, not inside a tree or
// cactus, not up against the world ceiling.
function safeColumn(terrain, x, z) {
  const h = terrain.heightAt(x, z);
  if (h <= SEA_LEVEL + 1 || h >= HEIGHT - 20) return null;
  if (terrain.treeNear(x, z, 2)) return null; // canopies span 2 blocks from the trunk
  if (terrain.cactusAt(x, z, terrain.biomeAt(x, z, h), h) > 0) return null;
  return { x: x + 0.5, y: h + 2.5, z: z + 0.5 };
}

// Expanding ring search for a biome/feature, coarse first, then refined to a
// safe standing column. Returns null when nothing matches within maxRadius.
export function findBiomeLocation(terrain, kind, fromX = 0, fromZ = 0, maxRadius = 3000) {
  const matches = (x, z, h) => {
    switch (kind) {
      case "forest": case "plains": case "desert": case "snow":
        return h > SEA_LEVEL + 1 && h < HEIGHT - 20 && terrain.biomeAt(x, z, h) === kind;
      case "mountain": return h >= 50; // realistic peak range tops out mid-50s
      case "ocean": return h < SEA_LEVEL - 6;
      default: return false;
    }
  };
  const fx = Math.round(fromX), fz = Math.round(fromZ);

  for (let r = 0; r <= maxRadius; r += 24) {
    const samples = r === 0 ? 1 : Math.max(8, Math.floor((2 * Math.PI * r) / 24));
    for (let a = 0; a < samples; a++) {
      const x = fx + Math.round(Math.cos((a / samples) * Math.PI * 2) * r);
      const z = fz + Math.round(Math.sin((a / samples) * Math.PI * 2) * r);
      const h = terrain.heightAt(x, z);
      if (!matches(x, z, h)) continue;

      if (kind === "ocean") return { x: x + 0.5, y: SEA_LEVEL + 2.5, z: z + 0.5 };

      // refine: find a safe column nearby that still matches
      for (let dz = 0; dz <= 6; dz += 2) for (let dx = 0; dx <= 6; dx += 2) {
        const sx = x + dx, sz = z + dz;
        if (!matches(sx, sz, terrain.heightAt(sx, sz))) continue;
        const spot = safeColumn(terrain, sx, sz);
        if (spot) return spot;
      }
    }
  }
  return null;
}

// Spawn in a forest when one exists near the origin; fall back to any safe
// land column, then to floating over the origin.
export function findSpawn(terrain) {
  const forest = findBiomeLocation(terrain, "forest", 0, 0, 1500);
  if (forest) return forest;
  for (let r = 0; r < 200; r += 4) {
    const samples = Math.max(8, r);
    for (let a = 0; a < samples; a++) {
      const x = Math.round(Math.cos((a / samples) * Math.PI * 2) * r);
      const z = Math.round(Math.sin((a / samples) * Math.PI * 2) * r);
      const spot = safeColumn(terrain, x, z);
      if (spot) return spot;
    }
  }
  const h0 = terrain.heightAt(0, 0);
  return { x: 0.5, y: Math.max(h0, SEA_LEVEL) + 2.5, z: 0.5 };
}

// Procedural terrain: heightmap + biomes + caves + ores + water and
// deterministic decoration (trees, cacti, plants). Everything is a pure
// function of world coordinates and the seed, so features spanning chunk
// borders stay coherent.

import {
  GRASS, DIRT, STONE, SAND, GRAVEL, LOG, LEAVES, LEAVES_COLD, WATER, BEDROCK,
  SNOWY_GRASS, TALLGRASS, POPPY, DANDELION, CACTUS, SANDSTONE, COAL_ORE,
  IRON_ORE, GLOAM_ORE, BERRY_BUSH, SNOW_LAYER, ICE, AIR, LAVA, WISPCAP,
  MUD, REEDS, STARSTONE, GLEAM_MOSS, isSolid, BLOCKS,
} from "./blocks.js";
import { CHUNK, HEIGHT, SEA_LEVEL } from "./world.js";
import { Perlin, hash2 } from "./noise.js";
import { ruinForChunk, stampRuin, seedRuinState } from "./ruins.js";
import { delveForChunk, stampDelve, seedDelveState } from "./delvings.js";
import { steadForChunk, stampStead, seedSteadState } from "./steads.js";

const TREE_CELL = 5;   // one tree candidate per 5x5-column cell (grid jitter)
const TREE_MARGIN = 3; // canopy radius 2 + 1 safety
// the Emberwash line: cave cells carved at or below this height flood with
// molten rock instead of air — a flat "sea level" for the deep, safely above
// the bedrock band (y <= 2) and well under the cavern belt (y < 26)
const LAVA_LEVEL = 11;
// Wispcaps grow on cave floors below this height (the old-sky caves proper)
const WISPCAP_CEILING = 24;
const WISPCAP_CHANCE = 0.03;

// cave mouths: one candidate per MOUTH_CELL x MOUTH_CELL columns; a ramp's
// horizontal reach (len + r, at most ~23) stays under one cell, so a 3x3
// cell scan around any column sees every mouth that could touch it
const MOUTH_CELL = 48;
const CAVE_TOP_ROOF = 6;  // caves keep this much roof below the surface...
const CAVE_FLOOR = 6;     // ...and never sink below this (World's Back safety)

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
    this._mouthCache = new Map(); // "cmx,cmz" -> mouth descriptor | null
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
    // the Mirelands: the wettest band of what used to be deep forest —
    // existing saves' unedited terrain re-decorates there on regeneration
    // (player edits ride the overlay), the same trade the Rimelands made
    if (moist > 0.72) return "bog";
    if (moist > 0.55) return "forest";
    return "plains";
  }

  // the carve field at a cell: 0 solid stone, 1 shell (the stone skin right
  // around a cave — walls, floors, ceilings — where the Upturn concentrates
  // its riches; see oreAt), 2 cave air
  caveAt(x, y, z) {
    // spaghetti tunnels: near-zero surfaces of two independent noises
    const n1 = this.cave1.fbm3(x * 0.02, y * 0.028, z * 0.02, 2);
    const n2 = this.cave2.fbm3(x * 0.02 + 400, y * 0.028 - 400, z * 0.02 + 800, 2);
    const q = n1 * n1 + n2 * n2;
    if (q < 0.008) return 2;
    let shell = q < 0.02;
    // occasional larger chambers deeper down
    if (y < 26) {
      const c = this.cave1.fbm3(x * 0.045, y * 0.05, z * 0.045, 3);
      if (c > 0.56) return 2;
      if (c > 0.49) shell = true;
    }
    return shell ? 1 : 0;
  }

  isCave(x, y, z) { return this.caveAt(x, y, z) === 2; }

  // A cave mouth candidate for one MOUTH_CELL grid cell: a straight sloped
  // tube that breaches the surface on dry land and ramps down into the cave
  // band, so caves are discoverable on foot. Deterministic from the seed and
  // memoized (heightAt is the expensive part).
  mouthAt(cmx, cmz) {
    const key = cmx + "," + cmz;
    const cached = this._mouthCache.get(key);
    if (cached !== undefined) return cached;
    let m = null;
    if (hash2(cmx, cmz, this.seed ^ 0xca4e) < 0.45) {
      // jitter keeps the whole ramp inside this cell's 3x3 neighborhood
      const mx = cmx * MOUTH_CELL + 8 +
        Math.floor(hash2(cmx, cmz, this.seed ^ 0x33cc) * (MOUTH_CELL - 16));
      const mz = cmz * MOUTH_CELL + 8 +
        Math.floor(hash2(cmx, cmz, this.seed ^ 0x44dd) * (MOUTH_CELL - 16));
      const h = this.heightAt(mx, mz);
      // dry land only — a mouth must never open under (or into) the water
      if (h > SEA_LEVEL + 3 && h < HEIGHT - 14) {
        const ang = hash2(cmx, cmz, this.seed ^ 0x55ee) * Math.PI * 2;
        const slope = 0.55 + hash2(cmx, cmz, this.seed ^ 0x66ff) * 0.25;
        // long enough to always ramp past the cave roof band
        const len = Math.max(12 + hash2(cmx, cmz, this.seed ^ 0x7710) * 8,
          (CAVE_TOP_ROOF + 4) / slope);
        const r = 1.7 + hash2(cmx, cmz, this.seed ^ 0x8821) * 0.7;
        m = { mx, mz, ux: Math.cos(ang), uz: Math.sin(ang), slope, len, r, h };
      }
    }
    this._mouthCache.set(key, m);
    return m;
  }

  // the y-interval (inclusive [lo, hi]) a cave mouth carves out of this
  // column, or null. Also the "is a mouth here" test for spawn/tree safety.
  mouthCarveAt(x, z) {
    const cmx = Math.floor(x / MOUTH_CELL), cmz = Math.floor(z / MOUTH_CELL);
    let lo = Infinity, hi = -Infinity;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const m = this.mouthAt(cmx + dx, cmz + dz);
        if (!m) continue;
        const px = x - m.mx, pz = z - m.mz;
        const t = px * m.ux + pz * m.uz;    // distance along the ramp
        if (t < -m.r || t > m.len + m.r) continue;
        const tc = Math.min(m.len, Math.max(0, t));
        const qx = px - m.ux * tc, qz = pz - m.uz * tc;
        const perp2 = qx * qx + qz * qz;
        if (perp2 >= m.r * m.r) continue;
        // rounded tube: full headroom on the centerline, tapering sides
        const bulge = Math.sqrt(1 - perp2 / (m.r * m.r));
        const cy = m.h + 0.6 - m.slope * tc;
        lo = Math.min(lo, Math.round(cy - 1.1 * bulge));
        hi = Math.max(hi, Math.round(cy + 0.9 + 1.5 * bulge));
      }
    }
    return hi >= lo ? [lo, hi] : null;
  }

  // nearCave: shell cells (cave walls/ceilings/floors) carry a strong ore
  // bonus, so delving a cave beats strip-mining blind stone
  oreAt(x, y, z, h, nearCave = false) {
    if (y >= h - 3) return 0;
    // gloamgold: rarer and deeper than sky-iron, seamed right through the
    // Emberwash band — the pools ARE the ore's guard. Checked first so the
    // deep cells prefer the deep metal; the cave shell concentrates it a
    // little, like every other seam.
    if (y < 14 && this.cave1.fbm3(x * 0.16 + 577, y * 0.17, z * 0.16 - 577, 2) >
        (nearCave ? 0.55 : 0.63)) return GLOAM_ORE;
    if (this.cave1.fbm3(x * 0.13 + 911, y * 0.13, z * 0.13 - 911, 2) >
        (nearCave ? 0.44 : 0.58)) return COAL_ORE;
    if (y < 28 && this.cave2.fbm3(x * 0.15 - 911, y * 0.15, z * 0.15 + 911, 2) >
        (nearCave ? 0.48 : 0.62)) return IRON_ORE;
    // a very rare starstone singleton in the deep cave skin — a pearl the
    // flip buried, the patient delver's alternative to a Pearlfall night
    if (nearCave && y < 14 &&
        hash2(x * 13 + y * 7, z * 13 - y * 5, this.seed ^ 0x57a2) < 0.0006) {
      return STARSTONE;
    }
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
    if (this.mouthCarveAt(jx, jz)) return null; // no trunk over a cave mouth
    const biome = this.biomeAt(jx, jz, h);
    const density = biome === "forest" ? 0.55 : biome === "plains" ? 0.1
      : biome === "snow" ? 0.2 : biome === "bog" ? 0.06 : 0;
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
        // the cave-mouth ramp interval through this column, if any (mouths
        // exist on dry land only — mouthAt guarantees the center; the column
        // guard below keeps a ramp's tail from nicking a shoreline)
        const mouth = h > SEA_LEVEL + 2 ? t.mouthCarveAt(x, z) : null;

        let prev = BEDROCK; // what the cell below this one got (per column)
        for (let y = 0; y <= h; y++) {
          let id;
          if (y === 0 || (y <= 2 && hash2(x * 3 + y, z * 3, seed ^ 0xbed) < 0.6)) {
            id = BEDROCK;
          } else {
            // the carve field, sampled a touch past the carve band so the
            // walls/floors/ceilings still read as ore-rich shell
            const cv = y >= CAVE_FLOOR - 1 && y <= h - CAVE_TOP_ROOF + 2
              ? t.caveAt(x, y, z) : 0;
            const dry = y > SEA_LEVEL || minNbH >= y; // static-water guard
            const carved = dry && y >= CAVE_FLOOR &&
              ((cv === 2 && y <= h - CAVE_TOP_ROOF) ||
               (mouth !== null && y >= mouth[0] && y <= mouth[1]));
            if (carved) {
              // the deepest carvings hold the Emberwash — pools with a flat,
              // chunk-coherent surface (pure function of y, like the carve).
              // The dry guard above keeps a pool from ever opening into
              // static water, the same promise the cave air makes.
              id = y <= LAVA_LEVEL ? LAVA : AIR;
              // Wispcaps sprout where a deep carve meets a solid floor —
              // scattered scraps of the buried old daylight
              if (id === AIR && y < WISPCAP_CEILING && isSolid(prev) &&
                  hash2(x * 7 + y, z * 7, seed ^ 0x815c) < WISPCAP_CHANCE) {
                id = WISPCAP;
              }
            } else if (biome === "desert") {
              if (y > h - 4) id = SAND;
              else if (y > h - 9) id = SANDSTONE;
              else id = STONE;
            } else if (y === h) {
              if (biome === "bog" && h >= SEA_LEVEL - 1 && h <= SEA_LEVEL + 3) {
                // the bog's low ground: sodden Mire Sod patches through the
                // turf, and its shorelines are mud, never sand
                id = beach || hash2(x, z, seed ^ 0xb06) < 0.35 ? MUD : GRASS;
              } else if (beach) id = h >= SEA_LEVEL ? SAND : GRAVEL;
              else if (h < SEA_LEVEL - 1) id = GRAVEL; // lake/ocean floor
              else if (biome === "snow") id = SNOWY_GRASS;
              else id = GRASS;
            } else if (y > h - 4) {
              id = beach || h < SEA_LEVEL ? (biome === "bog" ? DIRT : SAND) : DIRT;
            } else {
              id = STONE;
            }
            if (id === STONE) id = t.oreAt(x, y, z, h, cv > 0) || STONE;
          }
          if (id !== AIR) chunk.set(lx, y, lz, id);
          prev = id;
        }

        // surface water — the Rimelands pull a River Glass lid over theirs
        // (only the topmost cell freezes; the old water waits underneath)
        if (h < SEA_LEVEL) {
          for (let y = h + 1; y <= SEA_LEVEL; y++) chunk.set(lx, y, lz, WATER);
          if (biome === "snow") chunk.set(lx, SEA_LEVEL, lz, ICE);
        }

        // gleam moss: sparse glowing tufts on the floors and ceilings of
        // the old-sky caves — faint original waypoints for delvers (see
        // LORE.md). Support must be SOLID rock: the deep carve now also
        // holds Emberwash pools and Wispcaps, and moss must never squat on
        // a molten surface or hang off a mushroom cap.
        for (let y = CAVE_FLOOR + 1; y <= h - 5; y++) {
          if (chunk.get(lx, y, lz) !== AIR) continue;
          const floor = isSolid(chunk.get(lx, y - 1, lz));
          const ceiling = isSolid(chunk.get(lx, y + 1, lz));
          if (!floor && !ceiling) continue;
          if (hash2(x * 3 + y * 61, z * 3 - y * 17, seed ^ 0x91ee) < 0.02) {
            chunk.set(lx, y, lz, GLEAM_MOSS); // Chunk.set registers the glow
          }
        }
      }
    }

    // pass 1b: Emberwash emitter pruning. Chunk.set registered every lava
    // cell as a level-13 emitter, but an interior pool cell (lava on every
    // in-chunk exposure) adds a BFS seed without adding any visible light —
    // its glow is carried by the exposed cells around it. Keep emitters only
    // where the pool actually meets something light can travel through.
    // Cells on the chunk border keep theirs (cross-chunk exposure unknown).
    for (const [idx] of chunk.emitters) {
      const lx = idx % CHUNK, lz = ((idx / CHUNK) | 0) % CHUNK, y = (idx / (CHUNK * CHUNK)) | 0;
      if (chunk.get(lx, y, lz) !== LAVA) continue;
      if (lx === 0 || lx === CHUNK - 1 || lz === 0 || lz === CHUNK - 1) continue;
      const exposed = (id) => id !== LAVA && !BLOCKS[id].opaque;
      if (exposed(chunk.get(lx, y + 1, lz)) ||
          exposed(chunk.get(lx + 1, y, lz)) || exposed(chunk.get(lx - 1, y, lz)) ||
          exposed(chunk.get(lx, y, lz + 1)) || exposed(chunk.get(lx, y, lz - 1))) continue;
      chunk.emitters.delete(idx);
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

        // the Mirelands' growth: reeds crowd the low wet ground, brambles
        // come three times as thick as a forest's, tall grass fills between
        if (biome === "bog" && h > SEA_LEVEL && h + 1 < HEIGHT) {
          const surf = chunk.get(lx, h, lz);
          if ((surf === GRASS || surf === MUD) && chunk.get(lx, h + 1, lz) === AIR) {
            const rr = hash2(x, z, seed ^ 0xb0663);
            if (h <= SEA_LEVEL + 3 && rr < 0.06) chunk.set(lx, h + 1, lz, REEDS);
            else if (rr >= 0.06 && rr < 0.084) chunk.set(lx, h + 1, lz, BERRY_BUSH);
            else if (rr >= 0.084 && rr < 0.15 && surf === GRASS) chunk.set(lx, h + 1, lz, TALLGRASS);
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

    // pass 3: buried and surface structures, both strictly chunk-local.
    // The Delvings-Under stamp first, the Steads-Before second — on the
    // rare chunk that draws both, the stead wins the surface (the delve
    // keeps its gallery; only the head-frame risks a trim).
    const delve = delveForChunk(t, chunk.cx, chunk.cz);
    if (delve) {
      stampDelve(chunk, delve);
      seedDelveState(world, delve);
    }
    const ruin = ruinForChunk(t, chunk.cx, chunk.cz);
    if (ruin) {
      stampRuin(chunk, ruin);
      seedRuinState(world, ruin);
    }
    // the Living Stead stamps last: an intact homestead. steadForChunk is
    // mutually exclusive with a ruin/delve chunk, so this never contends for
    // the surface — it only fires on a chunk the other two declined.
    const stead = steadForChunk(t, chunk.cx, chunk.cz);
    if (stead) {
      stampStead(chunk, stead);
      seedSteadState(world, stead);
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
  if (terrain.mouthCarveAt(x, z)) return null; // never spawn over a cave mouth
  if (terrain.treeNear(x, z, 2)) return null; // canopies span 2 blocks from the trunk
  if (terrain.cactusAt(x, z, terrain.biomeAt(x, z, h), h) > 0) return null;
  return { x: x + 0.5, y: h + 2.5, z: z + 0.5 };
}

// Expanding ring search for a biome/feature, coarse first, then refined to a
// safe standing column. Returns null when nothing matches within maxRadius.
export function findBiomeLocation(terrain, kind, fromX = 0, fromZ = 0, maxRadius = 3000) {
  const matches = (x, z, h) => {
    switch (kind) {
      case "forest": case "plains": case "desert": case "snow": case "bog":
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

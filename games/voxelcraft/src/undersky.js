// The Undersky (see LORE.md): the other side of the flip's fold, reached
// only through a Cinder Door. Pearl-pale dunes over the old slate, sunk
// through with the PEARL-BEDS — wide shallow basins where the drowned
// light pooled: starstone seams surface there, and the Starkelp grows
// thick. Same contract as terrain.js's makeGenerator: everything is a
// pure function of world coordinates and the seed, one closure per world
// with a minimal `.terrain` bolted on.

import { STONE, BEDROCK, STARSTONE, PEARLSAND, STARKELP } from "./blocks.js";
import { CHUNK, HEIGHT } from "./world.js";
import { Perlin, hash2 } from "./noise.js";
import { sunkenForChunk, stampSunken, seedSunkenState } from "./sunken.js";

function smoothstep(a, b, t) {
  t = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function makeUnderskyGenerator(seed) {
  // its own noise instances, salted apart from every overworld field
  const dunes = new Perlin(seed ^ 0x01d5cb);
  const beds = new Perlin(seed ^ 0x6bed05);

  // 0..1: how deep into a pearl-bed this column sits. The beds are wide,
  // sparse basins — most of the country is 0.
  // saturation at 0.4 keeps proper (fully-sunk) beds reachable from any
  // arrival: the fbm only grazes higher peaks in some regions, and a far
  // country whose treasure never quite surfaces reads as a bug, not a hunt
  const pearlBedAt = (x, z) =>
    smoothstep(0.2, 0.4, beds.fbm2(x * 0.004 + 900, z * 0.004 - 900, 3));

  // gentle dune swells ~18..28, pressed down up to 5 into a bed's basin.
  // No sea, no mountains — the old floor never had weather ambitious
  // enough to carve it.
  const heightAt = (x, z) => {
    const swell = dunes.fbm2(x * 0.006, z * 0.006, 4); // -1..1-ish
    const h = Math.round(22 + swell * 6 - pearlBedAt(x, z) * 5);
    return Math.min(HEIGHT - 12, Math.max(15, h));
  };

  const generate = (world, chunk) => {
    const x0 = chunk.cx * CHUNK, z0 = chunk.cz * CHUNK;
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = x0 + lx, z = z0 + lz;
        const h = heightAt(x, z);
        const bed = pearlBedAt(x, z);
        for (let y = 0; y <= h; y++) {
          let id;
          if (y === 0 || (y <= 2 && hash2(x * 3 + y, z * 3, seed ^ 0xf1d) < 0.6)) {
            id = BEDROCK;
          } else if (y <= 3 && hash2(x * 7 + y, z * 7, seed ^ 0x5ea) < 0.01) {
            // starstone flecks seamed through the old floor everywhere —
            // the drowned stars' light pooled where it fell (Chunk.set
            // registers the glow, so the deep reads by scattered lamps)
            id = STARSTONE;
          } else if (y >= h - 1 && bed > 0.4 &&
                     hash2(x * 11 + y, z * 11, seed ^ 0xbead) < bed * 0.06) {
            // the pearl-beds proper: in a basin the seams SURFACE — lit
            // starstone studding the top two cells of the floor. This is
            // the far country's treasure, and (next commit) what its
            // keeper is keeping.
            id = STARSTONE;
          } else if (y > h - 3) {
            id = PEARLSAND; // the pale dune skin
          } else {
            id = STONE;
          }
          chunk.set(lx, y, lz, id);
        }
        // Starkelp: sparse strays on the open dunes, thickets in the beds
        // (a bead of light each — company, not protection). Deterministic
        // per column, strictly inside the chunk, standing on the surface.
        const kelpChance = 0.004 + bed * 0.09;
        if (h + 1 < HEIGHT - 1 &&
            hash2(x * 13, z * 13, seed ^ 0x6e19) < kelpChance) {
          chunk.set(lx, h + 1, lz, STARKELP); // Chunk.set registers the glow
        }
        // no water, no caves, no ores — the far sky's other furniture is
        // its wrecks (below) and its keeper (mobs.js)
      }
    }
    // pass 2: the Sunken Steads — the pre-flip world's own sea-floor
    // leavings, stamped last (over dune skin and kelp alike), loot dealt
    // exactly once per world through this World's own seeded markers
    const wreck = sunkenForChunk(generate.terrain, chunk.cx, chunk.cz);
    if (wreck) {
      seedSunkenState(world, wreck);
      stampSunken(chunk, wreck);
    }
  };

  // the minimal terrain surface main.js's per-frame consumers actually read
  // (biome sampling, the debug line, snow/spawn gates that must simply never
  // match here), plus pearlBedAt for whatever hunts the beds. Overworld-only
  // lookups — ruins, delvings, steads, biome teleports — are gated by
  // dimension in main.js and never reach this.
  generate.terrain = {
    seed,
    heightAt,
    pearlBedAt,
    biomeAt: () => "undersky",
  };
  return generate;
}

// where the void net drops a fallen Wanderling — arrival is otherwise always
// portal-driven, so this never needs to hunt for a "good" spot
export function underskySpawn(terrain) {
  return { x: 0.5, y: terrain.heightAt(0, 0) + 2.5, z: 0.5 };
}

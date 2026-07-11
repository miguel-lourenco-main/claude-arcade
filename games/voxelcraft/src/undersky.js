// The Undersky (see LORE.md): the other side of the flip's fold, reached
// only through a Cinder Door. This wave ships the SHELL — pearl-pale dunes
// under a permanent dusk, the old floor flecked with drowned starlight —
// and a later wave furnishes it (native flora, the pearl-beds, what guards
// them). Same contract as terrain.js's makeGenerator: everything is a pure
// function of world coordinates and the seed, one closure per world with a
// minimal `.terrain` bolted on.

import { STONE, SAND, BEDROCK, STARSTONE } from "./blocks.js";
import { CHUNK, HEIGHT } from "./world.js";
import { Perlin, hash2 } from "./noise.js";

export function makeUnderskyGenerator(seed) {
  // its own noise instance, salted apart from every overworld field
  const dunes = new Perlin(seed ^ 0x01d5cb);

  // gentle dune swells: ~18..28, no sea, no mountains — the old floor
  // never had weather ambitious enough to carve it
  const heightAt = (x, z) => {
    const swell = dunes.fbm2(x * 0.006, z * 0.006, 4); // -1..1-ish
    const h = Math.round(22 + swell * 6);
    return Math.min(HEIGHT - 12, Math.max(16, h));
  };

  const generate = (world, chunk) => {
    const x0 = chunk.cx * CHUNK, z0 = chunk.cz * CHUNK;
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = x0 + lx, z = z0 + lz;
        const h = heightAt(x, z);
        for (let y = 0; y <= h; y++) {
          let id;
          if (y === 0 || (y <= 2 && hash2(x * 3 + y, z * 3, seed ^ 0xf1d) < 0.6)) {
            id = BEDROCK;
          } else if (y <= 3 && hash2(x * 7 + y, z * 7, seed ^ 0x5ea) < 0.01) {
            // starstone flecks seamed through the old floor — the drowned
            // stars' light pooled where it fell (Chunk.set registers the
            // glow, so the deep reads by its own scattered lamps)
            id = STARSTONE;
          } else if (y > h - 3) {
            id = SAND; // the pearl-pale dune skin
          } else {
            id = STONE;
          }
          chunk.set(lx, y, lz, id);
        }
        // no water, no caves, no ores, no flora, no structures — the shell.
        // The Undersky proper arrives with the next wave.
      }
    }
  };

  // the minimal terrain surface main.js's per-frame consumers actually read
  // (biome sampling, the debug line, snow/spawn gates that must simply never
  // match here). Overworld-only lookups — ruins, delvings, steads, biome
  // teleports — are gated by dimension in main.js and never reach this.
  generate.terrain = {
    seed,
    heightAt,
    biomeAt: () => "undersky",
  };
  return generate;
}

// where the void net drops a fallen Wanderling — arrival is otherwise always
// portal-driven, so this never needs to hunt for a "good" spot
export function underskySpawn(terrain) {
  return { x: 0.5, y: terrain.heightAt(0, 0) + 2.5, z: 0.5 };
}

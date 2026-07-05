// The Steads-Before — pre-Upturn homestead ruins (see LORE.md). Roughly one
// chunk in forty carries one: a collapsed cottage, a leaning watch post, or a
// root cellar, assembled from ordinary blocks during chunk generation and
// decayed by seeded hashes so no two read identical. Everything here is a
// pure function of the world seed and the chunk coordinates — placement,
// variant, decay, the chest loot, the notice-board fragment — so a chunk
// regenerates its ruin identically every time. The chest CONTENTS and the
// board's writing, though, are seeded exactly once per world
// (world.ruinsSeeded, persisted): looting a stead sticks across chunk
// unloads, saves, and reloads, and never refills.

import { hash2, mulberry32 } from "./noise.js";
import { CHUNK, HEIGHT, SEA_LEVEL, clampSignText } from "./world.js";
import {
  AIR, DIRT, COBBLE, PLANKS, LOG, CHEST, LADDER, MOSS_CLUMP, PLANK_SLAB,
  SIGN_S, WATER, ICE, BLOCKS, TORCH, COAL_ORE, SLING_STONE, BERRIES,
  ROOT_SEED, IRON_INGOT, IRON_PICK, STARSTONE, GLOAM_INGOT,
  BARK_CROWN, BARK_JERKIN, BARK_LEGGINGS, BARK_TREADS,
} from "./blocks.js";

const RUIN_RATE = 1 / 40; // chunks that carry a stead (before terrain vetoes)

// what's left to read on a stead's Notice Post: weathered homestead notes
// from the years around the turn. 4 lines x 16 columns, like any board.
export const RUIN_FRAGMENTS = [
  "gone up the hill\nto watch the sky\nfall. back by\nsupper",
  "the ground kept\nour roof. we\nkept walking",
  "third winter\nsince the turn.\nthe well looks\nup at us now",
  "do not dig past\nthe cellar. it\nremembers being\nsky",
  "left the kiln\nwarm for whoever\ncomes after",
  "the stars knock\nsome nights.\nwe stopped\nanswering",
  "took the child\nand the needle.\nfollow the\nriver rubble",
  "if the door is\nshut, the hill\nshut it. let it\nbe",
];

// Does this chunk carry a stead, and which one? Pure function of the seed +
// chunk coords (heightAt is seed-pure too), so the pause-menu ruin finder can
// predict placement without generating anything. Returns null or a full
// build plan: anchor column, variant, and where the chest/sign will stand.
export function ruinForChunk(terrain, cx, cz) {
  const seed = terrain.seed;
  if (hash2(cx, cz, seed ^ 0x57ead) >= RUIN_RATE) return null;
  // jittered anchor, kept 4 cells off every chunk edge so the whole
  // footprint stamps inside this one chunk (no cross-chunk coordination)
  const x = (cx << 4) + 4 + Math.floor(hash2(cx, cz, seed ^ 0x57ea1) * 8);
  const z = (cz << 4) + 4 + Math.floor(hash2(cx, cz, seed ^ 0x57ea2) * 8);
  const h = terrain.heightAt(x, z);
  // no drowned steads (ocean/beach depth) and none against the world ceiling
  if (h <= SEA_LEVEL + 1 || h >= HEIGHT - 16) return null;
  const variant = Math.floor(hash2(cx, cz, seed ^ 0x57ea3) * 3);
  const ruin = { cx, cz, x, z, h, variant, seed };
  if (variant === 0) {
    // collapsed cottage: chest inside against the north-west wall; some
    // doorways still carry the household's Notice Post
    ruin.chest = { x: x - 2, y: h + 1, z: z - 1 };
    if (hash2(cx, cz, seed ^ 0x57ea4) < 0.55) {
      const text = RUIN_FRAGMENTS[
        Math.floor(hash2(cx, cz, seed ^ 0x57ea5) * RUIN_FRAGMENTS.length)];
      ruin.sign = { x, y: h + 1, z: z + 3, text: clampSignText(text) };
    }
  } else if (variant === 1) {
    // leaning watch post: the chest perches on the leaned tower top
    ruin.top = h + 6 + Math.floor(hash2(cx, cz, seed ^ 0x57ea6) * 2); // h+6..h+7
    ruin.lean = hash2(cx, cz, seed ^ 0x57ea7) < 0.5 ? -1 : 1;
    ruin.chest = { x: x + ruin.lean, y: ruin.top + 1, z };
  } else {
    // root cellar: the chest keeps best of all, four blocks under the turf
    ruin.roomY = h - 4;
    ruin.chest = { x: x - 1, y: ruin.roomY, z: z - 1 };
  }
  return ruin;
}

// Seeded chest loot: modest homestead salvage, different per stead (the rng
// is keyed on the chunk), scattered across the 27 slots.
export function ruinLoot(ruin) {
  const rng = mulberry32(
    (ruin.seed ^ Math.imul(ruin.cx, 0x9e3779b1) ^ Math.imul(ruin.cz, 0x85ebca77)) >>> 0);
  const slots = new Array(27).fill(null);
  const put = (id, count) => {
    for (let t = 0; t < 8; t++) {
      const i = Math.floor(rng() * 27);
      if (!slots[i]) { slots[i] = { id, count }; return; }
    }
    const i = slots.findIndex((s) => !s);
    if (i >= 0) slots[i] = { id, count };
  };
  const roll = (chance, id, min, max) => {
    if (rng() < chance) put(id, min + Math.floor(rng() * (max - min + 1)));
  };
  roll(0.85, TORCH, 3, 9);
  roll(0.75, PLANKS, 5, 14);
  roll(0.6, COAL_ORE, 2, 6);
  roll(0.55, SLING_STONE, 4, 10);
  roll(0.5, BERRIES, 3, 7);
  roll(0.4, ROOT_SEED, 2, 5);
  roll(0.18, IRON_INGOT, 1, 2);
  // a whisper of the tier below the Emberwash, long before anyone can mine it
  roll(0.06, GLOAM_INGOT, 1, 1);
  if (rng() < 0.12) {
    put([BARK_CROWN, BARK_JERKIN, BARK_LEGGINGS, BARK_TREADS][Math.floor(rng() * 4)], 1);
  }
  if (rng() < 0.1) put(IRON_PICK, 1);
  if (rng() < 0.015) put(STARSTONE, 1); // a pearl someone carried home once
  if (!slots.some((s) => s)) { put(TORCH, 4); put(PLANKS, 6); } // never bare
  return slots;
}

// One-time state seeding: chest contents into world.chests, the board's
// fragment into world.signs — both through the normal stores, so opening,
// looting, rewriting, and saving all just work. The ruinsSeeded set (a
// persisted save field) makes this once-per-world: a regenerated chunk
// re-stamps its BLOCKS but never re-deals its loot.
export function seedRuinState(world, ruin) {
  const rkey = `${ruin.cx},${ruin.cz}`;
  if (world.ruinsSeeded.has(rkey)) return;
  world.ruinsSeeded.add(rkey);
  world.chests.set(`${ruin.chest.x},${ruin.chest.y},${ruin.chest.z}`, ruinLoot(ruin));
  if (ruin.sign && ruin.sign.text) {
    world.signs.set(`${ruin.sign.x},${ruin.sign.y},${ruin.sign.z}`, ruin.sign.text);
  }
}

// Stamp the ruin's blocks into a freshly generated chunk. Runs as the last
// generation pass, so it clears any tree/plant that wandered into the
// footprint. Strictly local: every write lands inside this chunk, so ruins
// never perturb neighboring chunks' generation.
export function stampRuin(chunk, ruin) {
  const x0 = chunk.cx << 4, z0 = chunk.cz << 4;
  const seed = ruin.seed;
  const put = (wx, y, wz, id) => {
    const lx = wx - x0, lz = wz - z0;
    if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || y < 1 || y >= HEIGHT) return;
    chunk.set(lx, y, lz, id);
  };
  const get = (wx, y, wz) => chunk.get(wx - x0, y, wz - z0);
  // per-cell decay hash — position-derived, so the same wall crumbles the
  // same way on every regeneration
  const decay = (wx, y, wz, salt) =>
    hash2(wx * 3 + y * 131, wz * 3 - y * 17, seed ^ salt);

  const { x, z, h } = ruin;

  // flatten a pad: clear headroom, floor the footprint, and fill sunken
  // columns with packed dirt/rubble so the stead sits ON the land
  const pad = (xa, xb, za, zb, clearTo) => {
    for (let wz = za; wz <= zb; wz++) for (let wx = xa; wx <= xb; wx++) {
      for (let y = h + 1; y <= clearTo; y++) put(wx, y, wz, AIR);
      put(wx, h, wz, decay(wx, 0, wz, 0x0f1) < 0.15 ? DIRT : COBBLE);
      for (let y = h - 1; y > Math.max(1, h - 10); y--) {
        const cur = get(wx, y, wz);
        if (cur !== AIR && cur !== WATER && cur !== ICE) break;
        put(wx, y, wz, decay(wx, y, wz, 0x0f2) < 0.4 ? COBBLE : DIRT);
      }
    }
  };

  if (ruin.variant === 0) {
    // --- the collapsed cottage: rubble footing, broken plank walls, a
    // doorway, half a roof, and moss finishing the job -----------------
    pad(x - 3, x + 3, z - 2, z + 3, h + 7);
    for (let wz = z - 2; wz <= z + 3; wz++) for (let wx = x - 3; wx <= x + 3; wx++) {
      const edge = wx === x - 3 || wx === x + 3 || wz === z - 2 || wz === z + 3;
      if (!edge) continue;
      if (wx === x && wz === z + 3) continue; // the doorway, facing south
      const corner = (wx === x - 3 || wx === x + 3) && (wz === z - 2 || wz === z + 3);
      if (corner) {
        // knotwood corner posts, snapped at seeded heights
        const ph = 2 + Math.floor(decay(wx, 1, wz, 0xc07) * 3); // 2..4
        for (let i = 1; i <= ph; i++) put(wx, h + i, wz, LOG);
        continue;
      }
      if (decay(wx, 1, wz, 0xc08) < 0.12) continue; // a toppled stretch
      put(wx, h + 1, wz, COBBLE); // river-rubble footing course
      const wh = 1 + Math.floor(decay(wx, 2, wz, 0xc09) * 3); // 1..3 courses
      for (let i = 0; i < wh; i++) {
        if (decay(wx, 3 + i, wz, 0xc0a) < 0.22) continue; // weathered out
        put(wx, h + 2 + i, wz, PLANKS);
      }
    }
    // half the roof gone: slab remnants survive mostly over the north half
    for (let wz = z - 2; wz <= z; wz++) for (let wx = x - 3; wx <= x + 3; wx++) {
      if (get(wx, h + 4, wz) !== AIR) continue;
      if (decay(wx, 9, wz, 0xc0b) < 0.6) put(wx, h + 4, wz, PLANK_SLAB);
    }
    // moss claiming the floor
    for (let wz = z - 1; wz <= z + 2; wz++) for (let wx = x - 2; wx <= x + 2; wx++) {
      if (decay(wx, 5, wz, 0xc0c) < 0.08 && get(wx, h + 1, wz) === AIR) {
        put(wx, h + 1, wz, MOSS_CLUMP);
      }
    }
    put(ruin.chest.x, ruin.chest.y, ruin.chest.z, CHEST);
    if (ruin.sign) put(ruin.sign.x, ruin.sign.y, ruin.sign.z, SIGN_S);
  } else if (ruin.variant === 1) {
    // --- the leaning watch post: a narrow rubble+plank tower with rung
    // ladders up the south face; the top two courses sag sideways ------
    const { top, lean } = ruin;
    pad(x - 2, x + 2, z - 2, z + 2, top + 2);
    for (let y = h + 1; y <= top; y++) {
      const offx = y >= top - 1 ? lean : 0;
      for (const [bx, bz] of [[x - 1, z - 1], [x, z - 1], [x - 1, z], [x, z]]) {
        // the ladder-mount column stays whole — the rungs need their wall,
        // and the chest up top needs something to perch on
        const keep = bx === x && bz === z;
        if (!keep && decay(bx + offx, y, bz, 0x707) < 0.14) continue;
        put(bx + offx, y, bz, y <= h + 2 ? COBBLE : PLANKS);
      }
      put(x + offx, y, z + 1, LADDER); // the rung line follows the lean
    }
    put(ruin.chest.x, ruin.chest.y, ruin.chest.z, CHEST);
  } else {
    // --- the root cellar: a buried rubble room, reached down a rung
    // shaft; a rubble collar marks the mouth at the surface ------------
    const { roomY } = ruin;
    for (let wz = z - 2; wz <= z + 2; wz++) for (let wx = x - 2; wx <= x + 2; wx++) {
      const edge = wx === x - 2 || wx === x + 2 || wz === z - 2 || wz === z + 2;
      put(wx, roomY - 1, wz, COBBLE);
      for (let y = roomY; y <= roomY + 1; y++) {
        put(wx, y, wz, edge
          ? (decay(wx, y, wz, 0xce1) < 0.25 ? DIRT : COBBLE)
          : AIR);
      }
      put(wx, roomY + 2, wz, decay(wx, 3, wz, 0xce2) < 0.2 ? DIRT : COBBLE);
    }
    // the shaft: rungs from the cellar floor up through the turf
    for (let y = roomY; y <= h; y++) put(x + 1, y, z + 1, LADDER);
    put(x + 1, h + 1, z + 1, AIR); // the open mouth (pops any plant/drift)
    for (const [nx, nz] of [[x + 2, z + 1], [x, z + 1], [x + 1, z + 2], [x + 1, z]]) {
      // tumbled collar rubble — only on this column's own solid ground
      if (decay(nx, 9, nz, 0xce3) < 0.6 && BLOCKS[get(nx, h, nz)].solid) {
        put(nx, h + 1, nz, COBBLE);
      }
    }
    put(ruin.chest.x, ruin.chest.y, ruin.chest.z, CHEST);
  }
}

// Nearest stead to a point: expanding chunk-ring scan over the placement
// hash (cheap — no generation involved, heightAt only runs on hash hits).
export function findNearestRuin(terrain, fromX, fromZ, maxRings = 64) {
  const pcx = Math.floor(fromX / CHUNK), pcz = Math.floor(fromZ / CHUNK);
  for (let r = 0; r <= maxRings; r++) {
    let best = null, bestD = Infinity;
    const tryChunk = (cx, cz) => {
      const ruin = ruinForChunk(terrain, cx, cz);
      if (!ruin) return;
      const d = (ruin.x - fromX) ** 2 + (ruin.z - fromZ) ** 2;
      if (d < bestD) { bestD = d; best = ruin; }
    };
    if (r === 0) {
      tryChunk(pcx, pcz);
    } else {
      for (let i = -r; i <= r; i++) {
        tryChunk(pcx + i, pcz - r);
        tryChunk(pcx + i, pcz + r);
        if (i > -r && i < r) {
          tryChunk(pcx - r, pcz + i);
          tryChunk(pcx + r, pcz + i);
        }
      }
    }
    if (best) return best;
  }
  return null;
}

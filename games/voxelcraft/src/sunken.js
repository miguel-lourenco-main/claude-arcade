// The Sunken Steads (see LORE.md) — what the pre-flip world left on its own
// sea floor. When the water became the night sky, everything that stood in
// it was left standing in air: drowned cottages sunk to their sills in
// pearlsand, and the stump-lines of old jetties marching across the dunes.
// Same contract as ruins.js: placement, variant, decay, loot, and the
// board's writing are pure functions of the world seed and chunk coords, so
// a chunk regenerates its wreck identically — while the chest CONTENTS and
// the writing are seeded exactly once per world through the Undersky's OWN
// World instance (uWorld.ruinsSeeded, persisted as the additive `ruinsU`).

import { hash2, mulberry32 } from "./noise.js";
import { CHUNK, HEIGHT, clampSignText } from "./world.js";
import {
  AIR, COBBLE, STONE, PLANKS, LOG, CHEST, SIGN_S, PEARLSAND, BLOCKS,
  TORCH, COAL_ORE, SLING_STONE, IRON_INGOT, STARSTONE, NACRE, PAIL,
} from "./blocks.js";

const SUNKEN_RATE = 1 / 55; // before the pearl-bed veto thins it further

// what's still legible on a drowned Notice Post: sea-facing notes from the
// years before the water left. 4 lines x 16 columns, like any board.
export const SUNKEN_FRAGMENTS = [
  "the tide went up\nand did not\ncome back down.\nwe waited",
  "nets are dry.\nfish are stars.\nfather says row\nanyway",
  "sold the boat.\nbought a ladder.\neveryone laughed\nonce",
  "the light comes\nfrom the floor\nnow. mother says\ndon't touch it",
  "high water mark\nis overhead\nforever. mind\nyour hat",
  "if you find the\nblue door, the\nkey is under the\nthird shell",
  "the pier points\nhome. home\npoints up",
];

// Does this chunk carry a wreck, and which one? Pure fn of seed + chunk.
// The pearl-beds are the Shellback's country — wrecks keep to the open
// dunes (the bed veto also keeps a chest from undercutting the bed hunt).
export function sunkenForChunk(terrain, cx, cz) {
  const seed = terrain.seed;
  if (hash2(cx, cz, seed ^ 0xd07e4) >= SUNKEN_RATE) return null;
  const x = (cx << 4) + 4 + Math.floor(hash2(cx, cz, seed ^ 0xd07e5) * 8);
  const z = (cz << 4) + 4 + Math.floor(hash2(cx, cz, seed ^ 0xd07e6) * 8);
  if (terrain.pearlBedAt(x, z) > 0.2) return null;
  const h = terrain.heightAt(x, z);
  if (h >= HEIGHT - 16) return null;
  const variant = hash2(cx, cz, seed ^ 0xd07e7) < 0.6 ? 0 : 1;
  const plan = { cx, cz, x, z, h, variant, seed };
  if (variant === 0) {
    // the drowned cottage: chest inside, against the north wall; some
    // doorways still carry the household's board
    plan.chest = { x: x - 1, y: h + 1, z: z - 1 };
    if (hash2(cx, cz, seed ^ 0xd07e8) < 0.6) {
      const text = SUNKEN_FRAGMENTS[
        Math.floor(hash2(cx, cz, seed ^ 0xd07e9) * SUNKEN_FRAGMENTS.length)];
      plan.sign = { x, y: h + 1, z: z + 3, text: clampSignText(text) };
    }
  } else {
    // the old jetty: a stump-line marching with the hash's chosen heading;
    // the chest lies half-buried at the shore end (whichever end that was)
    plan.axis = hash2(cx, cz, seed ^ 0xd07ea) < 0.5 ? "x" : "z";
    plan.chest = { x: plan.axis === "x" ? x - 4 : x, y: h + 1, z: plan.axis === "x" ? z : z - 4 };
  }
  return plan;
}

// Seeded chest loot: what the sea kept. Keyed on the chunk, scattered
// across the 27 slots, never bare.
export function sunkenLoot(plan) {
  const rng = mulberry32(
    (plan.seed ^ Math.imul(plan.cx, 0x9e3779b1) ^ Math.imul(plan.cz, 0x85ebca77)) >>> 0);
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
  roll(0.8, PLANKS, 4, 10);   // old timber, still good
  roll(0.6, COAL_ORE, 2, 5);
  roll(0.55, TORCH, 2, 6);
  roll(0.5, SLING_STONE, 3, 8);
  roll(0.35, NACRE, 1, 2);    // the sea's own coin
  roll(0.2, STARSTONE, 1, 1); // a drowned star someone netted
  roll(0.15, IRON_INGOT, 1, 2);
  if (rng() < 0.1) put(PAIL, 1); // an old tub, sound as the day it sank
  if (!slots.some((s) => s)) { put(PLANKS, 6); put(TORCH, 3); }
  return slots;
}

// One-time state seeding through the Undersky World's own stores — opening,
// looting, rewriting, and saving all just work, and a regenerated chunk
// re-stamps its BLOCKS but never re-deals its loot.
export function seedSunkenState(world, plan) {
  const key = `${plan.cx},${plan.cz}`;
  if (world.ruinsSeeded.has(key)) return;
  world.ruinsSeeded.add(key);
  world.chests.set(`${plan.chest.x},${plan.chest.y},${plan.chest.z}`, sunkenLoot(plan));
  if (plan.sign && plan.sign.text) {
    world.signs.set(`${plan.sign.x},${plan.sign.y},${plan.sign.z}`, plan.sign.text);
  }
}

// Stamp the wreck into a freshly generated chunk — the last generation
// pass, strictly local, every write inside this chunk.
export function stampSunken(chunk, plan) {
  const x0 = chunk.cx << 4, z0 = chunk.cz << 4;
  const seed = plan.seed;
  const put = (wx, y, wz, id) => {
    const lx = wx - x0, lz = wz - z0;
    if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || y < 1 || y >= HEIGHT) return;
    chunk.set(lx, y, lz, id);
  };
  const get = (wx, y, wz) => chunk.get(wx - x0, y, wz - z0);
  const decay = (wx, y, wz, salt) =>
    hash2(wx * 3 + y * 131, wz * 3 - y * 17, seed ^ salt);

  const { x, z, h } = plan;

  if (plan.variant === 0) {
    // --- the drowned cottage: a stone shell sunk to its sills, walls
    // eaten to seeded heights, the floor drifted with pearlsand ---------
    for (let wz = z - 2; wz <= z + 3; wz++) for (let wx = x - 2; wx <= x + 2; wx++) {
      // clear the interior headroom of dune skin the columns laid down
      for (let y = h + 1; y <= h + 4; y++) put(wx, y, wz, AIR);
      const edge = wx === x - 2 || wx === x + 2 || wz === z - 2 || wz === z + 3;
      if (!edge) {
        // interior: a stone floor with pearlsand drifted over half of it
        put(wx, h, wz, decay(wx, 0, wz, 0x5c1) < 0.5 ? PEARLSAND : STONE);
        continue;
      }
      if (wx === x && wz === z + 3) continue; // the doorway, facing south
      // the shell: a stone footing course, cobble above, eaten downward —
      // the water had longer to chew than the weather ever gets
      put(wx, h + 1, wz, STONE);
      const wh = Math.floor(decay(wx, 2, wz, 0x5c2) * 3); // 0..2 courses
      for (let i = 0; i < wh; i++) {
        if (decay(wx, 3 + i, wz, 0x5c3) < 0.3) continue;
        put(wx, h + 2 + i, wz, COBBLE);
      }
    }
    put(plan.chest.x, plan.chest.y, plan.chest.z, CHEST);
    if (plan.sign) put(plan.sign.x, plan.sign.y, plan.sign.z, SIGN_S);
  } else {
    // --- the old jetty: a stump-line of rotted knotwood posts, every
    // stump snapped at its own seeded height, the chest at the shore end
    const ux = plan.axis === "x" ? 1 : 0, uz = plan.axis === "x" ? 0 : 1;
    for (let i = -4; i <= 4; i += 2) {
      const wx = x + ux * i, wz = z + uz * i;
      if (decay(wx, 1, wz, 0x5c4) < 0.15) continue; // a stump the sea took whole
      const ph = 1 + Math.floor(decay(wx, 2, wz, 0x5c5) * 3); // 1..3 tall
      for (let j = 1; j <= ph; j++) put(wx, h + j, wz, LOG);
    }
    // the chest lies half-buried beside the line's end, pearlsand banked
    // against its flank the way sand treats everything that stops moving
    put(plan.chest.x, plan.chest.y, plan.chest.z, CHEST);
    for (const [nx, nz] of [[plan.chest.x + uz, plan.chest.z + ux],
                            [plan.chest.x - uz, plan.chest.z - ux]]) {
      if (decay(nx, 3, nz, 0x5c6) < 0.6 && BLOCKS[get(nx, h, nz)]?.solid) {
        put(nx, h + 1, nz, PEARLSAND);
      }
    }
  }
}

// Nearest wreck to a point: the expanding chunk-ring scan over the
// placement hash, exactly the ruins finder's shape (a test oracle — the
// pause menu deliberately has no far-sky teleports).
export function findNearestSunken(terrain, fromX, fromZ, maxRings = 64) {
  const pcx = Math.floor(fromX / CHUNK), pcz = Math.floor(fromZ / CHUNK);
  for (let r = 0; r <= maxRings; r++) {
    let best = null, bestD = Infinity;
    const tryChunk = (cx, cz) => {
      const plan = sunkenForChunk(terrain, cx, cz);
      if (!plan) return;
      const d = (plan.x - fromX) ** 2 + (plan.z - fromZ) ** 2;
      if (d < bestD) { bestD = d; best = plan; }
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

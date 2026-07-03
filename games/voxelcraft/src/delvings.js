// The Delvings-Under — buried timber galleries (see LORE.md). The
// Steads-Before didn't just farm: they dug, chasing sky-iron down galleries
// timbered with knotwood, and left mid-swing when the ground got opinionated.
// Roughly one chunk in forty-five hides one: a straight gallery at delve
// depth, a rung shaft up to a collapsed head-frame at the surface, a store
// chest, and sometimes a notice nobody came back for.
//
// Everything follows the Steads-Before contract (ruins.js): placement,
// layout, and decay are pure functions of the world seed + chunk coords, the
// whole footprint stamps strictly inside its own chunk (anchor jittered 4
// cells off every edge), and the chest/sign STATE seeds exactly once per
// world through world.delvesSeeded.

import { hash2, mulberry32 } from "./noise.js";
import { CHUNK, HEIGHT, SEA_LEVEL, clampSignText } from "./world.js";
import {
  AIR, DIRT, COBBLE, PLANKS, LOG, CHEST, LADDER, PLANK_SLAB, SIGN_S, BLOCKS,
  TORCH, COAL_ORE, SLING_STONE, IRON_INGOT, IRON_PICK, GLOAM_INGOT, GLOAM_ORE,
  WISPCAP, STARSTONE,
} from "./blocks.js";

const DELVE_RATE = 1 / 45; // chunks that hide a delving (before terrain vetoes)

// what's left to read at a delve mouth: miners' notes from before the quiet
export const DELVE_FRAGMENTS = [
  "the seam sings\npast the third\npost. we stopped\nlistening",
  "down is only up\nthat hasn't\nhappened yet",
  "left the rungs\nsound. the dark\nkeeps the rest",
  "gold in the\ngloam. bring a\nbetter lamp",
  "do not bail the\nember. it bails\nback",
  "day 40. the\npick knows the\nway home now.\nwe follow it",
];

// Does this chunk hide a delving, and where? Pure function of seed + chunk
// coords, like ruinForChunk. Returns null or a full build plan.
export function delveForChunk(terrain, cx, cz) {
  const seed = terrain.seed;
  if (hash2(cx, cz, seed ^ 0xde1e) >= DELVE_RATE) return null;
  // jittered anchor, 4 cells off every edge: the gallery spans ±3, so the
  // whole footprint stays inside this chunk (the ruins' proven rule)
  const x = (cx << 4) + 4 + Math.floor(hash2(cx, cz, seed ^ 0xde11) * 8);
  const z = (cz << 4) + 4 + Math.floor(hash2(cx, cz, seed ^ 0xde12) * 8);
  const h = terrain.heightAt(x, z);
  // no shaft mouths underwater, none against the world ceiling
  if (h <= SEA_LEVEL + 1 || h >= HEIGHT - 16) return null;
  // gallery floor: delve depth — mostly above the Emberwash line (11), but
  // the deepest galleries kiss it (the hazard is the point)
  const roomY = 9 + Math.floor(hash2(cx, cz, seed ^ 0xde13) * 7); // 9..15
  const alongX = hash2(cx, cz, seed ^ 0xde14) < 0.5; // gallery axis
  const delve = { cx, cz, x, z, h, roomY, alongX, seed };
  // the store chest waits at the gallery's far end (away from the shaft)
  delve.chest = alongX
    ? { x: x + 3, y: roomY, z }
    : { x, y: roomY, z: z + 3 };
  // some mouths still carry the crew's notice, planted by the head-frame
  if (hash2(cx, cz, seed ^ 0xde15) < 0.5) {
    const text = DELVE_FRAGMENTS[
      Math.floor(hash2(cx, cz, seed ^ 0xde16) * DELVE_FRAGMENTS.length)];
    delve.sign = { x: x + 1, y: h + 1, z: z + 1, text: clampSignText(text) };
  }
  return delve;
}

// Seeded chest loot: a mining crew's store — light, fuel, spare heads, and
// now and then the good metal they were down there for.
export function delveLoot(delve) {
  const rng = mulberry32(
    (delve.seed ^ Math.imul(delve.cx, 0xc2b2ae35) ^ Math.imul(delve.cz, 0x27d4eb2f)) >>> 0);
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
  roll(0.9, TORCH, 6, 12);
  roll(0.7, COAL_ORE, 4, 9);
  roll(0.6, PLANKS, 6, 12);
  roll(0.5, SLING_STONE, 4, 8);
  roll(0.5, WISPCAP, 2, 4);
  roll(0.4, IRON_INGOT, 1, 3);
  roll(0.25, GLOAM_INGOT, 1, 2);
  if (rng() < 0.12) put(IRON_PICK, 1);
  if (rng() < 0.04) put(STARSTONE, 1); // someone caught a falling one, once
  if (!slots.some((s) => s)) { put(TORCH, 6); put(COAL_ORE, 4); } // never bare
  return slots;
}

// One-time state seeding, exactly like seedRuinState but against its own
// persisted marker set — a regenerated chunk re-stamps its BLOCKS but never
// re-deals its loot.
export function seedDelveState(world, delve) {
  const dkey = `${delve.cx},${delve.cz}`;
  if (world.delvesSeeded.has(dkey)) return;
  world.delvesSeeded.add(dkey);
  world.chests.set(`${delve.chest.x},${delve.chest.y},${delve.chest.z}`, delveLoot(delve));
  if (delve.sign && delve.sign.text) {
    world.signs.set(`${delve.sign.x},${delve.sign.y},${delve.sign.z}`, delve.sign.text);
  }
}

// Stamp the delving's blocks into a freshly generated chunk. Strictly
// chunk-local, like stampRuin. Runs BEFORE the ruin pass (both are
// chunk-local; on the rare shared chunk the stead wins the surface).
export function stampDelve(chunk, delve) {
  const x0 = chunk.cx << 4, z0 = chunk.cz << 4;
  const seed = delve.seed;
  const put = (wx, y, wz, id) => {
    const lx = wx - x0, lz = wz - z0;
    if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || y < 1 || y >= HEIGHT) return;
    chunk.set(lx, y, lz, id);
  };
  const get = (wx, y, wz) => chunk.get(wx - x0, y, wz - z0);
  const decay = (wx, y, wz, salt) =>
    hash2(wx * 3 + y * 131, wz * 3 - y * 17, seed ^ salt);

  const { x, z, h, roomY, alongX } = delve;
  // gallery cell helper: a = along the axis (-3..3), b = across it (-1..1)
  const cell = (a, b) => (alongX ? [x + a, z + b] : [x + b, z + a]);

  // --- the gallery: 7 long, 3 wide, 3 tall, floored and timbered ---------
  for (let a = -3; a <= 3; a++) {
    for (let b = -1; b <= 1; b++) {
      const [wx, wz] = cell(a, b);
      // a sound floor under the whole span — the crew floored over anything,
      // including the Emberwash (a chest never stands in the melt)
      put(wx, roomY - 1, wz, decay(wx, roomY - 1, wz, 0xd01) < 0.3 ? DIRT : COBBLE);
      for (let y = roomY; y <= roomY + 2; y++) put(wx, y, wz, AIR);
    }
    // timber bays every second cell: knotwood posts up both flanks with a
    // plank lintel across the roofline, seeded decay leaving some snapped
    if (a % 2 !== 0) continue;
    for (const b of [-1, 1]) {
      const [wx, wz] = cell(a, b);
      if (decay(wx, 1, wz, 0xd02) < 0.18) continue; // a lost post
      put(wx, roomY, wz, LOG);
      put(wx, roomY + 1, wz, LOG);
    }
    const [lx1, lz1] = cell(a, -1);
    const [lx2, lz2] = cell(a, 0);
    const [lx3, lz3] = cell(a, 1);
    if (decay(lx2, 2, lz2, 0xd03) >= 0.25) {
      put(lx1, roomY + 2, lz1, PLANKS);
      put(lx2, roomY + 2, lz2, PLANKS);
      put(lx3, roomY + 2, lz3, PLANKS);
    }
  }
  // what the crew was chasing: a few ore cells left in the gallery walls
  for (let a = -3; a <= 3; a++) {
    for (const b of [-2, 2]) {
      const [wx, wz] = cell(a, b);
      const r = decay(wx, roomY, wz, 0xd04);
      if (r < 0.1) put(wx, roomY, wz, COAL_ORE);
      else if (r < 0.16 && roomY <= 12) put(wx, roomY, wz, GLOAM_ORE);
    }
  }
  // wispcaps the dark moved in with
  for (const a of [-2, 1, 3]) {
    const [wx, wz] = cell(a, a % 2 === 0 ? 1 : -1);
    if (decay(wx, 5, wz, 0xd05) < 0.55 && get(wx, roomY, wz) === AIR) {
      put(wx, roomY, wz, WISPCAP);
    }
  }

  // --- the shaft: rungs from the gallery up through the turf -------------
  for (let y = roomY; y <= h; y++) put(x, y, z, LADDER);
  put(x, h + 1, z, AIR); // the open mouth (pops any plant/drift)

  // --- the head-frame at the surface: two posts and a sagging slab roof,
  // collar rubble where the ground still holds it ---------------------------
  const [px1, pz1] = alongX ? [x - 1, z] : [x, z - 1];
  const [px2, pz2] = alongX ? [x + 1, z] : [x, z + 1];
  if (BLOCKS[get(px1, h, pz1)].solid) {
    put(px1, h + 1, pz1, LOG);
    if (decay(px1, 2, pz1, 0xd06) < 0.7) put(px1, h + 2, pz1, LOG);
  }
  if (BLOCKS[get(px2, h, pz2)].solid) {
    put(px2, h + 1, pz2, LOG);
    if (decay(px2, 2, pz2, 0xd07) < 0.7) put(px2, h + 2, pz2, LOG);
  }
  if (decay(x, 3, z, 0xd08) < 0.6) put(x, h + 3, z, PLANK_SLAB);
  for (const [nx, nz] of [[x - 1, z - 1], [x + 1, z + 1], [x - 1, z + 1], [x + 1, z - 1]]) {
    if (decay(nx, 9, nz, 0xd09) < 0.4 && BLOCKS[get(nx, h, nz)].solid &&
        get(nx, h + 1, nz) === AIR) {
      put(nx, h + 1, nz, COBBLE);
    }
  }

  // the store chest at the far end, on its own guaranteed floor
  put(delve.chest.x, delve.chest.y - 1, delve.chest.z, COBBLE);
  put(delve.chest.x, delve.chest.y, delve.chest.z, CHEST);
  if (delve.sign && BLOCKS[get(delve.sign.x, h, delve.sign.z)].solid) {
    put(delve.sign.x, delve.sign.y, delve.sign.z, SIGN_S);
  }
}

// Nearest delving to a point — the expanding chunk-ring scan, for tests and
// any future wayfinding hook (cheap: pure hash prediction, no generation).
export function findNearestDelve(terrain, fromX, fromZ, maxRings = 64) {
  const pcx = Math.floor(fromX / CHUNK), pcz = Math.floor(fromZ / CHUNK);
  for (let r = 0; r <= maxRings; r++) {
    let best = null, bestD = Infinity;
    const tryChunk = (cx, cz) => {
      const delve = delveForChunk(terrain, cx, cz);
      if (!delve) return;
      const d = (delve.x - fromX) ** 2 + (delve.z - fromZ) ** 2;
      if (d < bestD) { bestD = d; best = delve; }
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

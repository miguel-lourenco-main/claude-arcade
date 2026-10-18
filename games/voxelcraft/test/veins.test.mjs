// Ore veins (veins.js + terrain.js oreAt). Run with: node test/veins.test.mjs
import "./_hooks.cjs";
import { check, section, done } from "./_assert.cjs";

const B = await import("../src/blocks.js");
const V = await import("../src/veins.js");
const { rarityOf } = await import("../src/rarity.js");
const { World, Chunk, HEIGHT } = await import("../src/world.js");
const { makeGenerator } = await import("../src/terrain.js");

section("the per-vein cap falls exponentially with rarity");
{
  const ids = [B.COAL_ORE, B.IRON_ORE, B.GLOAM_ORE];
  check(V.veinMax(ids[0]) > V.veinMax(ids[1]) && V.veinMax(ids[1]) > V.veinMax(ids[2]),
    `coal ${V.veinMax(ids[0])} > sky-iron ${V.veinMax(ids[1])} > gloamgold ${V.veinMax(ids[2])}`);
  for (const id of ids) {
    const want = V.VEIN_MAX0 * Math.exp(-V.VEIN_DECAY * rarityOf(id));
    check(Math.abs(V.veinMax(id) - want) <= 0.5, `${B.BLOCKS[id].name}: cap is VEIN_MAX0·e^(-k·rarity) (${want.toFixed(2)})`);
  }
}

section("a vein is a connected blob inside its own cell, sized 1..cap");
{
  let found = 0, inCell = true, connected = true, sized = true, deterministic = true;
  const sizes = new Map();
  for (let ix = -40; ix < 40 && found < 400; ix++) for (let iz = -40; iz < 40; iz++) for (let iy = 0; iy < 4; iy++) {
    const v = V.veinInCell(99, ix, iy, iz);
    if (!v) continue;
    found++;
    const again = V.veinInCell(99, ix, iy, iz);
    if (JSON.stringify([...again.cells]) !== JSON.stringify([...v.cells]) || again.id !== v.id) deterministic = false;
    if (v.n < 1 || v.n > V.veinMax(v.id) || v.n !== v.cells.size) sized = false;
    const N = V.VEIN_CELL;
    const pts = [...v.cells].map((k) => [k % N, Math.floor(k / N) % N, Math.floor(k / (N * N))]);
    if (pts.some((p) => p.some((c) => c < 0 || c >= N))) inCell = false;
    // flood from the first block over 6-neighbours: must reach every block
    const seen = new Set([v.cells.values().next().value]);
    const stack = [pts[0]];
    while (stack.length) {
      const [x, y, z] = stack.pop();
      for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
        const k = (x + dx) + N * ((y + dy) + N * (z + dz));
        if (x + dx < 0 || y + dy < 0 || z + dz < 0 || x + dx >= N || y + dy >= N || z + dz >= N) continue;
        if (v.cells.has(k) && !seen.has(k)) { seen.add(k); stack.push([x + dx, y + dy, z + dz]); }
      }
    }
    if (seen.size !== v.cells.size) connected = false;
    sizes.set(v.id, (sizes.get(v.id) || new Set()).add(v.n));
  }
  check(found > 100, `veins turn up (${found} in the sample)`);
  check(deterministic, "a cell's vein is a pure function of (seed, cell)");
  check(sized, "every vein holds 1..its cap blocks");
  check(inCell, "every vein keeps inside its own cell (no neighbour needed)");
  check(connected, "every vein is one connected blob");
  check((sizes.get(B.COAL_ORE) || new Set()).size >= 4, "vein sizes vary");
}

section("veins add about +10% of each ore, in its depth band");
{
  const count = (seeds, withVeins) => {
    const c = { [B.COAL_ORE]: 0, [B.IRON_ORE]: 0, [B.GLOAM_ORE]: 0 };
    let ironHigh = 0, gloamHigh = 0;
    for (const seed of seeds) {
      const gen = makeGenerator(seed);
      if (!withVeins) gen.terrain.veins = { oreAt: () => 0 };
      const w = new World(seed);
      for (let cx = -4; cx < 4; cx++) for (let cz = -4; cz < 4; cz++) {
        const ch = new Chunk(cx, cz);
        gen(w, ch);
        for (let i = 0; i < ch.data.length; i++) {
          const id = ch.data[i];
          if (id in c) c[id]++;
        }
        for (let y = 28; y < HEIGHT; y++) for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
          if (ch.get(lx, y, lz) === B.IRON_ORE) ironHigh++;
          if (y >= 14 && ch.get(lx, y, lz) === B.GLOAM_ORE) gloamHigh++;
        }
        for (let y = 14; y < 28; y++) for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
          if (ch.get(lx, y, lz) === B.GLOAM_ORE) gloamHigh++;
        }
      }
    }
    return { c, ironHigh, gloamHigh };
  };
  const seeds = [21, 22, 23];
  const base = count(seeds, false), withV = count(seeds, true);
  for (const [id, lo, hi] of [[B.COAL_ORE, 0.06, 0.15], [B.IRON_ORE, 0.06, 0.15], [B.GLOAM_ORE, 0.03, 0.2]]) {
    const gain = withV.c[id] / base.c[id] - 1;
    console.log(`  ${B.BLOCKS[id].name}: ${base.c[id]} -> ${withV.c[id]} (+${(gain * 100).toFixed(1)}%)`);
    check(gain >= lo && gain <= hi, `${B.BLOCKS[id].name}: +${(gain * 100).toFixed(1)}% (${base.c[id]} -> ${withV.c[id]})`);
  }
  check(withV.ironHigh === 0 && withV.gloamHigh === 0, "no sky-iron at or above y28, no gloamgold at or above y14");
}

done();

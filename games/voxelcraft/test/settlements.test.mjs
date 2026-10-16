// Settlement tiers + spacing (settlements.js, steads.js placement).
// Run with: node test/settlements.test.mjs
import "./_hooks.cjs";
import { check, section, done } from "./_assert.cjs";

const B = await import("../src/blocks.js");
const S = await import("../src/settlements.js");
const ST = await import("../src/steads.js");
const { World, Chunk } = await import("../src/world.js");
const { makeGenerator } = await import("../src/terrain.js");
const { ruinForChunk } = await import("../src/ruins.js");
const { delveForChunk } = await import("../src/delvings.js");

const seeds = [1, 2, 3];
const all = [];
for (const seed of seeds) {
  const t = makeGenerator(seed).terrain;
  for (let gx = -10; gx < 10; gx++) for (let gz = -10; gz < 10; gz++) {
    const p = S.settlementForCell(t, gx, gz);
    const d = S.settlementDensity(t, (gx * 6 + 3) * 16, (gz * 6 + 3) * 16);
    all.push({ seed, t, gx, gz, p, d });
  }
}
const settled = all.filter((c) => c.p);

section("placement is pure and spaced");
{
  const again = makeGenerator(1).terrain;
  check(settled.filter((c) => c.seed === 1).every((c) => {
    const q = S.settlementForCell(again, c.gx, c.gz);
    return q && q.key === c.p.key && q.buildings.length === c.p.buildings.length;
  }), "a fresh terrain of the same seed lays out the same settlements");
  let inCell = true, margin = true;
  for (const { gx, gz, p } of settled) {
    for (const [cx, cz] of p.chunks) {
      const [hx, hz] = S.cellOfChunk(cx, cz);
      if (hx !== gx || hz !== gz) inCell = false;
      const lx = cx - gx * S.SETTLEMENT_CELL, lz = cz - gz * S.SETTLEMENT_CELL;
      if (lx < 1 || lz < 1 || lx > S.SETTLEMENT_CELL - 2 || lz > S.SETTLEMENT_CELL - 2) margin = false;
    }
  }
  check(inCell, "every footprint keeps inside its own cell");
  check(margin, "...a chunk in from every cell edge, so settlements stand at least two chunks apart");
  check(settled.every(({ t, p }) => p.chunks.every(([cx, cz]) => !ruinForChunk(t, cx, cz) && !delveForChunk(t, cx, cz))),
    "no footprint covers a ruin or a delving");
}

section("tiers follow the density field");
{
  const by = (id) => settled.filter((c) => c.p.tier === id);
  const mean = (xs) => xs.reduce((a, c) => a + c.d, 0) / Math.max(1, xs.length);
  const [h, v, dn] = [by("hamlet"), by("village"), by("dense")];
  check(h.length && v.length && dn.length, `all three tiers occur (${h.length} hamlets, ${v.length} villages, ${dn.length} dense)`);
  check(h.length > v.length && v.length > dn.length, "smaller settlements are commoner");
  check(mean(dn) > mean(v) && mean(v) > mean(h), `denser ground, bigger settlements (${mean(h).toFixed(3)} < ${mean(v).toFixed(3)} < ${mean(dn).toFixed(3)})`);
  check(all.filter((c) => c.d < S.DENSITY_REMOTE).every((c) => !c.p), "remote country (below the threshold) stays empty");
  const sizes = (xs) => xs.map((c) => c.p.buildings.length);
  check(sizes(h).every((n) => n >= 2 && n <= 3) && sizes(v).every((n) => n >= 4 && n <= 6) &&
    sizes(dn).every((n) => n >= 7 && n <= 10), "each tier's cottage count is in its band");
  check(dn.every((c) => c.p.span === 3) && h.every((c) => c.p.span <= 3), "a dense village spans 3x3 chunks");
}

section("villages cluster near larger ones");
{
  const at = new Map(all.map((c) => [`${c.seed}:${c.gx},${c.gz}`, c]));
  let near = 0, nearSettled = 0;
  for (const c of settled.filter((x) => x.p.tier === "dense")) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const n = at.get(`${c.seed}:${c.gx + dx},${c.gz + dz}`);
      if (!n) continue;
      near++;
      if (n.p) nearSettled++;
    }
  }
  const overall = settled.length / all.length;
  check(nearSettled / near > overall * 1.5,
    `cells beside a dense village settle far more often (${(nearSettled / near * 100).toFixed(0)}% vs ${(overall * 100).toFixed(0)}% overall)`);
}

section("a settlement's layout");
{
  let ok = true, doors = true, leash = true, jobs = true, inside = true;
  for (const { p } of settled) {
    const boxes = [...p.buildings.map((b) => [b.x0, b.x1, b.z0, b.z1]),
      ...p.gardens.map((g) => [g.x0, g.x1, g.z0, g.z1]), [p.well.x - 1, p.well.x + 1, p.well.z - 1, p.well.z + 1]];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      if (a[0] <= b[1] && b[0] <= a[1] && a[2] <= b[3] && b[2] <= a[3]) ok = false;
    }
    if (boxes.some(([x0, x1, z0, z1]) => x0 < p.x0 || x1 > p.x1 || z0 < p.z0 || z1 > p.z1)) inside = false;
    for (const b of p.buildings) {
      const dDoor = Math.hypot(b.door.x - p.well.x, b.door.z - p.well.z);
      const dBack = Math.hypot(2 * b.cx - b.door.x - p.well.x, 2 * b.cz - b.door.z - p.well.z);
      if (!(dDoor < dBack)) doors = false;
      if (dDoor > p.leash - 2) leash = false;
    }
    if (p.residents.length !== p.buildings.length) jobs = false;
    const js = new Set(p.residents.map((r) => r.job));
    if (p.residents.length >= 3 && js.size !== 3) jobs = false;
  }
  check(ok, "cottages, patches and the well never overlap");
  check(inside, "...and all sit inside the footprint");
  check(doors, "every door faces the well");
  check(leash, "every home is within the residents' leash of the well");
  check(jobs, "one resident per cottage; three or more cover all three jobs");
}

section("chunk queries: the anchor, and every chunk a footprint covers");
{
  const big = settled.find((c) => c.p.span === 3);
  const t = big.t, p = big.p;
  check(ST.steadForChunk(t, p.cx, p.cz) === p, "steadForChunk answers at the anchor");
  check(p.chunks.slice(1).every(([cx, cz]) => ST.steadForChunk(t, cx, cz) === null), "...and only there");
  check(p.chunks.every(([cx, cz]) => ST.steadsInChunk(t, cx, cz)[0] === p), "steadsInChunk finds it from any covered chunk");
  const [gx, gz] = [big.gx, big.gz];
  let stray = false;
  for (let dx = 0; dx < S.SETTLEMENT_CELL; dx++) for (let dz = 0; dz < S.SETTLEMENT_CELL; dz++) {
    const cx = gx * S.SETTLEMENT_CELL + dx, cz = gz * S.SETTLEMENT_CELL + dz;
    if (!S.planCoversChunk(p, cx, cz) && ST.steadsInChunk(t, cx, cz).length) stray = true;
  }
  check(!stray, "uncovered chunks of the cell carry nothing");
  const b = p.buildings[p.buildings.length - 1];
  const part = ST.steadPartAt(t, b.x0, b.floorY + 2, b.z0 + 1, B.PLANKS);
  check(part && part.plan === p && part.kind === "wreck", "steadPartAt sees a far cottage of a big village");
  const g = p.gardens[p.gardens.length - 1];
  const crop = ST.steadPartAt(t, g.x0 + 1, p.h + 1, g.z0 + 1, B.CROP_RIPE);
  check(crop && crop.kind === "steal", "...and its outer patch");
  const near = ST.findNearestStead(t, p.x + 5, p.z + 5, 4);
  check(near && near.key === p.key, "findNearestStead finds a village by its well");
}

section("a multi-chunk village stamps the same in any chunk order");
{
  const big = settled.find((c) => c.p.span >= 2);
  const p = big.p;
  const stamp = (order) => {
    const gen = makeGenerator(big.seed);
    const w = new World(big.seed);
    const out = new Map();
    for (const [cx, cz] of order) { const c = new Chunk(cx, cz); gen(w, c); out.set(`${cx},${cz}`, c); }
    return { out, w };
  };
  const a = stamp(p.chunks), b = stamp(p.chunks.slice().reverse());
  const same = p.chunks.every(([cx, cz]) => {
    const x = a.out.get(`${cx},${cz}`).data, y = b.out.get(`${cx},${cz}`).data;
    return x.length === y.length && x.every((v, i) => v === y[i]);
  });
  check(same, "every covered chunk is byte-identical either way");
  let doorsOpen = 0, crops = 0;
  for (const c of a.out.values()) for (const id of c.data) { if (id === B.DOOR_OPEN) doorsOpen++; if (id === B.CROP_RIPE) crops++; }
  check(doorsOpen === p.buildings.length, `one open door per cottage got stamped (${doorsOpen}/${p.buildings.length})`);
  check(crops === p.gardens.length * 9, `every patch is planted (${crops} ripe crops)`);
  check(a.w.steads.has(p.key) && a.w.steads.get(p.key).residents.length === p.buildings.length,
    "its resident records are seeded once, under the anchor key");
}

section("the city hook is reserved, not built");
{
  check(S.TIERS.city.reserved === true, "the city tier is marked reserved");
  check(S.cityForCell(all[0].t, 0, 0) === null, "cityForCell returns nothing until C1 defines city anchors");
  check(!settled.some((c) => c.p.tier === "city"), "no cities generate");
}

section("legacy worlds keep their steads exactly");
{
  // captured from the pre-tier code (seed 42): key, well x/z, height, jobs
  const fixture = [
    ["-30,-22", -471, -344, 34, "keeper/grower/wright"],
    ["-29,-19", -456, -295, 32, "grower/wright"],
    ["-28,-3", -440, -39, 34, "keeper/grower"],
  ];
  const t = makeGenerator(42, { settlements: "legacy" }).terrain;
  const ok = fixture.every(([key, x, z, h, jobs]) => {
    const [cx, cz] = key.split(",").map(Number);
    const p = ST.steadForChunk(t, cx, cz);
    return p && p.x === x && p.z === z && p.h === h && p.residents.map((r) => r.job).join("/") === jobs;
  });
  check(ok, "legacy mode reproduces the original steads (fixture from the old code)");
  const tc = makeGenerator(42).terrain;
  check(tc.settlementMode === "cells" && t.settlementMode === "legacy", "new worlds default to cells; the option selects legacy");
}

done();

"use strict";
/* Node-runnable pure-logic tests for Rootguard.
 *   node games/rootguard/test/logic.test.js
 * Plain asserts against the exact logic module the game ships. Exits 0 on pass.
 */
const assert = require("assert");
const L = require("../logic.js");

let n = 0;
function ok(cond, msg) {
  n++;
  assert.ok(cond, msg);
  console.log("ok - " + msg);
}

const DT = 1 / 60;
function ff(state, seconds) {
  const ticks = Math.round(seconds / DT);
  for (let i = 0; i < ticks; i++) L.tick(state, DT);
}
function fresh(levelIndex, seed) {
  return L.createGame(levelIndex === undefined ? 0 : levelIndex, L.makeRng(seed || 42));
}
// a sandboxed game: no scripted spawns, no accidental win
function sandbox(levelIndex) {
  const s = fresh(levelIndex);
  s.spawnQueue = [];
  s.totalSpawns = 99; // win needs spawnedCount >= totalSpawns, so never here
  s.finalAt = 0;
  return s;
}

// ---- definitions ------------------------------------------------------------
ok(L.PLANT_ORDER.length === 6, "six plant types in the kit");
ok(Object.keys(L.BLIGHTS).length === 5, "five blight types in the kit");
ok(L.PLANTS.dewblossom.cost === 50 && L.PLANTS.dewblossom.produceEvery === 24,
  "dewblossom costs 50 and produces every 24s");
ok(L.PLANTS.thornshot.fireEvery === 1.4 && L.PLANTS.thornshot.damage === 20,
  "thornshot fires a 20-dmg shot every 1.4s");
ok(L.PLANTS.frostfern.shot === "frost" && L.SLOW_FACTOR === 0.6 && L.SLOW_DURATION === 3,
  "frostfern chills 40% for 3s");
ok(L.PLANTS.bulwarkroot.hp === 10 * L.PLANTS.thornshot.hp,
  "bulwarkroot is a 10x HP wall");
ok(L.PLANTS.burstcap.bomb && L.PLANTS.sporelobber.shot === "lob" && L.PLANTS.sporelobber.splash === 1,
  "burstcap is a bomb; sporelobber lobs with 1-cell splash");
for (const t of L.PLANT_ORDER) {
  assert.ok(L.PLANTS[t].cost > 0 && L.PLANTS[t].cooldown > 0, t + " has cost+cooldown");
}
ok(true, "every plant card has a cost and a cooldown");

const base = L.BLIGHTS.shambler;
ok(L.BLIGHTS.helmed.hp === 2.5 * base.hp && L.BLIGHTS.helmed.speed === base.speed,
  "helmed shambler has 2.5x HP at base speed");
ok(L.BLIGHTS.sprinter.speed === 2 * base.speed && L.BLIGHTS.sprinter.hp === 0.6 * base.hp,
  "sprinter is 2x speed, 0.6x HP");
ok(L.BLIGHTS.hulk.hp === 4 * base.hp && L.BLIGHTS.hulk.speed === 0.6 * base.speed &&
  L.BLIGHTS.hulk.wallMult === 3,
  "hulk is 4x HP, 0.6x speed, and crushes walls at 3x");
ok(L.BLIGHTS.skitterer.hp === 0.5 * base.hp && L.BLIGHTS.skitterer.size < base.size,
  "skitterer is small and half HP");

// ---- level scripts -------------------------------------------------------------
ok(L.LEVELS.length === 5, "five scripted levels");
ok(L.LEVELS[0].plants.length === 3, "level 1 unlocks only 3 plant types (tutorial)");
for (let i = 1; i < 5; i++) {
  for (const p of L.LEVELS[i - 1].plants) {
    assert.ok(L.LEVELS[i].plants.indexOf(p) >= 0, "level " + (i + 1) + " keeps " + p);
  }
  assert.ok(L.LEVELS[i].plants.length >= L.LEVELS[i - 1].plants.length,
    "plant unlocks never shrink");
}
ok(L.LEVELS[4].plants.length === 6, "plant unlocks ramp up to the full kit");

const INTRO = [
  ["shambler"],
  ["shambler", "helmed"],
  ["shambler", "helmed", "sprinter"],
  ["shambler", "helmed", "sprinter", "hulk"],
  ["shambler", "helmed", "sprinter", "hulk", "skitterer"],
];
L.LEVELS.forEach((lv, i) => {
  const seen = new Set();
  for (const w of lv.waves) for (const s of w.spawns) seen.add(s.type);
  for (const t of seen) {
    assert.ok(INTRO[i].indexOf(t) >= 0,
      "level " + (i + 1) + " only fields introduced types (got " + t + ")");
  }
  assert.ok(seen.has(INTRO[i][INTRO[i].length - 1]),
    "level " + (i + 1) + " actually fields its new type");
});
ok(true, "blight types are introduced one per level, in order");

L.LEVELS.forEach((lv, i) => {
  const finals = lv.waves.filter((w) => w.final);
  assert.strictEqual(finals.length, 1, "level " + (i + 1) + " has exactly one final wave");
  assert.strictEqual(lv.waves[lv.waves.length - 1].final, true,
    "level " + (i + 1) + " final wave is the last wave");
  assert.ok(finals[0].spawns.length >= 4,
    "level " + (i + 1) + " final wave is a mass surge");
});
ok(true, "each level ends in a single final mass wave");

const count = (i) => L.buildQueue(L.LEVELS[i]).q.length;
ok(count(4) > count(0), "level 5 fields far more blights than level 1 (" +
  count(4) + " vs " + count(0) + ")");

// skitterer packs in level 5
let packFound = false;
for (const w of L.LEVELS[4].waves) {
  const sk = w.spawns.filter((s) => s.type === "skitterer");
  const byLane = {};
  for (const s of sk) (byLane[s.lane] = byLane[s.lane] || []).push(s);
  for (const lane in byLane) {
    if (byLane[lane].length >= 3 &&
        Math.max(...byLane[lane].map((s) => s.delay)) -
        Math.min(...byLane[lane].map((s) => s.delay)) <= 2) packFound = true;
  }
}
ok(packFound, "level 5 sends skitterers in tight same-lane packs of 3-4");

// ---- game creation --------------------------------------------------------------
{
  const s = fresh(0);
  ok(s.dew === 50, "starting dew is 50");
  ok(s.surges.every(Boolean) && s.surges.length === 5, "all 5 root surges start armed");
  ok(s.status === "playing" && s.blights.length === 0 && s.plants.length === 0,
    "level starts playing on an empty field");
  ok(s.finalAt === 110 && s.totalSpawns === 14, "level 1 spawn queue is built and timed");
}

// ---- planting rules ---------------------------------------------------------------
{
  const s = sandbox(0);
  ok(L.plantAt(s, "dewblossom", 2, 1) === null, "planting an affordable card succeeds");
  ok(s.dew === 0 && s.plants.length === 1, "planting deducts the full dew cost");
  ok(s.cooldowns.dewblossom === L.PLANTS.dewblossom.cooldown,
    "planting starts the card's cooldown");
  s.dew = 500;
  ok(L.plantAt(s, "dewblossom", 2, 2) === "cooldown", "a cooling card cannot plant");
  s.cooldowns.dewblossom = 0;
  ok(L.plantAt(s, "dewblossom", 2, 1) === "occupied", "one plant per grid cell");
  ok(L.plantAt(s, "thornshot", 9, 1) === "bounds" && L.plantAt(s, "thornshot", 1, 9) === "bounds",
    "planting outside the 5x9 grid is rejected");
  ok(L.plantAt(s, "frostfern", 1, 1) === "locked",
    "level 1 rejects plants that are not yet unlocked");
  s.dew = 10;
  ok(L.plantAt(s, "thornshot", 1, 1) === "dew", "planting without enough dew is rejected");
  // cooldown ticks down over time
  s.dew = 500;
  ff(s, L.PLANTS.dewblossom.cooldown + 0.1);
  ok((s.cooldowns.dewblossom || 0) === 0 && L.plantAt(s, "dewblossom", 3, 1) === null,
    "the card is ready again after its cooldown elapses");
}

// ---- shovel ---------------------------------------------------------------------------
{
  const s = sandbox(0);
  L.plantAt(s, "dewblossom", 1, 1);
  const dewAfterPlant = s.dew;
  ok(L.shovelAt(s, 1, 1) === true && s.plants.length === 0,
    "the shovel removes a planted defender");
  ok(s.dew === dewAfterPlant, "shoveling gives no refund");
  ok(L.shovelAt(s, 1, 1) === false, "shoveling an empty cell does nothing");
}

// ---- dew economy: sky motes, production, collection, fading ---------------------------
{
  const s = sandbox(0);
  const every = L.LEVELS[0].skyMoteEvery;
  ff(s, every + 0.2);
  ok(s.motes.length === 1, "a sky mote falls on the level's mote timer");
  const skyMote = s.motes[0];
  ok(!skyMote.landed || skyMote.y === skyMote.targetY, "sky motes fall from above");
  ff(s, 4); // lands well within this
  ok(skyMote.landed, "the sky mote lands on the field");
  const dew0 = s.dew;
  ok(L.collectMote(s, skyMote.id) === true && s.dew === dew0 + L.MOTE_VALUE,
    "clicking a mote collects " + L.MOTE_VALUE + " dew");
  ok(L.collectMote(s, skyMote.id) === false, "a mote can only be collected once");

  // fading
  const m = L.addMote(s, 4, 2, false);
  ff(s, L.MOTE_TTL + 0.2);
  ok(s.motes.indexOf(m) < 0, "an uncollected mote fades after ~" + L.MOTE_TTL + "s");
  ok(L.collectMote(s, m.id) === false, "a faded mote cannot be collected");
}
{
  const s = sandbox(0);
  L.plantAt(s, "dewblossom", 2, 1);
  s.motes.length = 0;
  const first = L.PLANTS.dewblossom.firstProduce;
  ff(s, first - 0.5);
  const nonSky = () => s.motes.filter((m) => Math.abs(m.x - 1.5) < 0.5 && Math.abs(m.targetY - 2.5) < 0.5);
  ok(nonSky().length === 0, "the dewblossom has not produced yet before its timer");
  ff(s, 1);
  ok(nonSky().length === 1, "the dewblossom grows a mote next to itself");
  ff(s, L.PLANTS.dewblossom.produceEvery);
  ok(nonSky().length >= 1, "the dewblossom keeps producing every " +
    L.PLANTS.dewblossom.produceEvery + "s (earlier motes fade)");
}

// ---- lane-scan shooting gate ------------------------------------------------------------
{
  const s = sandbox(0);
  s.dew = 1000;
  L.plantAt(s, "thornshot", 1, 2);
  ff(s, 3);
  ok(s.shots.length === 0, "a shooter with no blight in its lane holds fire");
  L.spawnBlight(s, "shambler", 3, 6); // other lane
  ff(s, 1);
  ok(s.shots.length === 0, "a blight in ANOTHER lane does not trip the gate");
  s.blights.length = 0;
  L.spawnBlight(s, "shambler", 1, 1.0); // same lane but BEHIND the plant (col 2)
  ff(s, 0.5);
  ok(s.shots.length === 0, "a blight behind the shooter does not trip the gate");
  s.blights.length = 0;
  const b = L.spawnBlight(s, "shambler", 1, 7);
  ff(s, 1.2);
  ok(b.hp < b.maxHp, "a blight ahead in-lane gets shot (gate opens, shot connects)");
}

// ---- projectiles hit the FIRST blight they touch --------------------------------------------
{
  const s = sandbox(0);
  s.dew = 1000;
  L.plantAt(s, "thornshot", 0, 0);
  const near = L.spawnBlight(s, "shambler", 0, 4);
  const far = L.spawnBlight(s, "shambler", 0, 6.5);
  ff(s, 1.0); // one shot fired at ~0.4s, reaches x=4 at ~0.8s
  ok(near.hp === near.maxHp - 20, "the nearest blight takes the hit");
  ok(far.hp === far.maxHp, "the blight behind it is untouched");
}

// ---- frostfern chill: 40% slow, 3s, never stacks ----------------------------------------------
{
  const s = sandbox(1); // frostfern unlocks in level 2
  s.dew = 1000;
  L.plantAt(s, "frostfern", 2, 0);
  const b = L.spawnBlight(s, "shambler", 2, 6);
  ff(s, 1.4);
  ok(b.slowT > 0 && b.slowT <= L.SLOW_DURATION + 1e-9,
    "a frost hit chills the blight for at most " + L.SLOW_DURATION + "s");
  // measure slowed speed over one second with no further decay confusion
  const x0 = b.x;
  b.slowT = 3; // freshly chilled
  s.plants.length = 0; // stop further shots
  s.shots.length = 0;
  ff(s, 1);
  const moved = x0 - b.x;
  const expect = L.BLIGHTS.shambler.speed * L.SLOW_FACTOR;
  ok(Math.abs(moved - expect) < 0.01,
    "a chilled shambler moves at 60% speed (" + moved.toFixed(3) + " cells/s)");
  // no stacking: many hits never push slowT beyond the duration
  b.slowT = 2.9;
  s.dew = 1000;
  s.cooldowns = {};
  L.plantAt(s, "frostfern", 2, 0);
  ff(s, 2);
  ok(b.slowT <= L.SLOW_DURATION + 1e-9, "repeated frost hits refresh, never stack");
}

// ---- chomping: blights stop to eat plants ---------------------------------------------------------
{
  const s = sandbox(0);
  s.dew = 1000;
  L.plantAt(s, "bulwarkroot", 3, 4);
  const wall = s.plants[0];
  const b = L.spawnBlight(s, "shambler", 3, 5.6);
  ff(s, 2); // walks ~0.25 cells to contact, then latches
  ok(b.eating === wall.id, "the blight stops and latches onto the plant in its path");
  const xLatched = b.x;
  const hp0 = wall.hp;
  ff(s, 1);
  ok(b.x === xLatched, "an eating blight does not advance");
  ok(wall.hp === hp0 - 2 * L.BLIGHTS.shambler.chompDmg,
    "chomps land every " + L.BLIGHTS.shambler.chompEvery + "s for " +
    L.BLIGHTS.shambler.chompDmg + " damage");
  // the walk resumes once the plant dies
  wall.hp = 1;
  ff(s, 0.6);
  ok(s.plants.length === 0, "the plant is destroyed at 0 HP");
  const xAfter = b.x;
  ff(s, 0.5);
  ok(b.x < xAfter, "the blight shambles on after finishing its meal");
}

// ---- hulk crushes bulwarkroots faster ---------------------------------------------------------------
{
  const s = sandbox(3);
  s.dew = 1000;
  L.plantAt(s, "bulwarkroot", 1, 4);
  L.plantAt(s, "thornshot", 2, 4);
  const wall = s.plants[0], shooter = s.plants[1];
  L.spawnBlight(s, "hulk", 1, 4.9);
  L.spawnBlight(s, "hulk", 2, 4.9);
  ff(s, 3);
  const wallLost = wall.maxHp - wall.hp;
  const shooterLost = shooter.maxHp - shooter.hp;
  ok(wallLost > 0 && shooterLost > 0 && wallLost === 3 * shooterLost,
    "a hulk deals 3x chomp damage to bulwarkroots (" + wallLost + " vs " + shooterLost + ")");
}

// ---- burstcap: single-use 3x3 explosion on contact -----------------------------------------------------
{
  const s = sandbox(2); // burstcap unlocks in level 3
  s.dew = 1000;
  L.plantAt(s, "burstcap", 2, 3);
  const onTop = L.spawnBlight(s, "shambler", 2, 4.45);   // about to step on it
  const nextLane = L.spawnBlight(s, "hulk", 1, 3.5);      // inside the 3x3
  const outsideLane = L.spawnBlight(s, "shambler", 4, 3.5); // 2 lanes away
  const outsideCol = L.spawnBlight(s, "shambler", 2, 7);  // too far right
  ff(s, 1.2);
  ok(s.plants.length === 0, "the burstcap is spent on first contact (single use)");
  ok(s.blights.indexOf(onTop) < 0, "the biter dies in the blast");
  ok(s.blights.indexOf(nextLane) < 0, "the 900-dmg blast kills even a hulk one lane over");
  ok(outsideLane.hp === outsideLane.maxHp && s.blights.indexOf(outsideLane) >= 0,
    "a blight two lanes away is untouched");
  ok(outsideCol.hp === outsideCol.maxHp, "a blight outside the 3x3 columns is untouched");
}

// ---- sporelobber: arcs over walls, splashes 1 cell -------------------------------------------------------
{
  const s = sandbox(3); // sporelobber unlocks in level 4
  s.dew = 1000;
  L.plantAt(s, "sporelobber", 4, 0);
  L.plantAt(s, "bulwarkroot", 4, 2); // the obstacle to lob over
  const wall = s.plants[1];
  const tgt = L.spawnBlight(s, "shambler", 4, 6);
  const near = L.spawnBlight(s, "shambler", 4, 6.6);
  const farOff = L.spawnBlight(s, "shambler", 4, 8.4);
  ff(s, 0.5);
  ok(s.lobs.length === 1, "the lobber arcs a spore at the first blight in lane");
  ff(s, 1.2);
  ok(tgt.hp < tgt.maxHp, "the lob comes down on the lead blight");
  ok(near.hp < near.maxHp, "a blight within 1 cell of impact takes splash damage");
  ok(farOff.hp === farOff.maxHp, "a blight beyond the splash is untouched");
  ok(wall.hp === wall.maxHp, "the lob sails clean over the bulwarkroot");
}

// ---- helmet stages ------------------------------------------------------------------------------------------
{
  const s = sandbox(1);
  const b = L.spawnBlight(s, "helmed", 0, 6);
  ok(L.helmetStage(b) === 2, "a fresh helmed shambler wears an intact helmet");
  b.hp = b.maxHp * 0.5;
  ok(L.helmetStage(b) === 1, "below 2/3 HP the helmet cracks");
  b.hp = b.maxHp * 0.2;
  ok(L.helmetStage(b) === 0, "below 1/3 HP the helmet is gone");
  // clink event on stage transitions
  b.hp = b.maxHp;
  s.events.length = 0;
  L.damageBlight(s, b, b.maxHp * 0.4);
  ok(s.events.some((e) => e.t === "clink"), "crossing a threshold emits a helmet-break event");
}

// ---- root surges: first breach clears the lane, second loses ---------------------------------------------------
{
  const s = sandbox(0);
  const runner = L.spawnBlight(s, "shambler", 2, 0.2);
  const behind = L.spawnBlight(s, "shambler", 2, 3);
  const other = L.spawnBlight(s, "shambler", 0, 3);
  ff(s, 2.5);
  ok(s.surges[2] === false, "a breach fires that lane's root surge (spent)");
  ok(s.surges[0] === true && s.surges[1] === true, "other lanes keep their surges armed");
  ok(s.blights.indexOf(runner) < 0 && s.blights.indexOf(behind) < 0,
    "the surge clears every blight in the lane");
  ok(s.blights.indexOf(other) >= 0, "blights in other lanes survive the surge");
  ok(s.status === "playing", "one breach does not lose the level");
  L.spawnBlight(s, "shambler", 2, 0.2);
  ff(s, 2.5);
  ok(s.status === "lost", "a second breach in the same lane loses the level");
}

// ---- win condition -----------------------------------------------------------------------------------------------
{
  const s = fresh(0);
  s.dew = 100000;
  // a murderous wall of thornshots
  for (let lane = 0; lane < 5; lane++) {
    for (let col = 0; col < 4; col++) {
      s.cooldowns = {};
      L.plantAt(s, "thornshot", lane, col);
    }
  }
  ff(s, s.duration + 90); // whole script plus mop-up time
  ok(s.spawnedCount === s.totalSpawns, "every scripted blight spawned");
  ok(s.status === "won", "level 1 is won when the last blight falls");
}
{
  const s = fresh(0);
  ff(s, 30);
  ok(s.status === "playing" && s.blights.length > 0,
    "an undefended field is NOT a win even while empty of plants");
}

// ---- final surge banner -----------------------------------------------------------------------------------------
{
  const s = sandbox(0);
  s.finalAt = 110;
  s.time = 105.5;
  s.events.length = 0;
  ff(s, 1);
  ok(s.events.some((e) => e.t === "banner"),
    "the FINAL SURGE banner event fires shortly before the last wave");
  s.events.length = 0;
  ff(s, 1);
  ok(!s.events.some((e) => e.t === "banner"), "the banner only fires once");
}

// ---- per-pixel movement ------------------------------------------------------------------------------------------
{
  const s = sandbox(0);
  const b = L.spawnBlight(s, "shambler", 1, 8);
  const x0 = b.x;
  L.tick(s, DT);
  const step1 = x0 - b.x;
  ok(step1 > 0 && step1 < 0.01, "blights move smoothly per-tick, not tile-hops");
  ff(s, 1);
  ok(Math.abs((x0 - b.x) - L.BLIGHTS.shambler.speed * (1 + DT)) < 0.005,
    "shambler covers its stated cells/second");
}

console.log("\nlogic.test.js: " + n + " checks passed");

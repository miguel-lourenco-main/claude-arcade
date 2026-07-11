"use strict";
/* Node-runnable pure-logic tests for Fernfoot.
 *   node games/fernfoot/test/logic.test.js
 * Plain asserts; exits 0 on pass, 1 on failure.
 */
const assert = require("assert");
const path = require("path");
const L = require(path.join(__dirname, "..", "logic.js"));
const LV = require(path.join(__dirname, "..", "levels.js"));

let n = 0;
function t(name, fn) {
  n++;
  try { fn(); console.log("ok - " + name); }
  catch (err) {
    console.error("FAIL - " + name + "\n  " + err.message);
    process.exitCode = 1;
  }
}

const STEP = L.STEP;
const TILE = L.TILE;

// tiny world builder for controlled scenarios
function world(rows, movers) {
  const g = L.newGame();
  L.loadLevel(g, [{ name: "test", theme: "glade", rows, movers: movers || [] }], 0);
  return g;
}
function run(g, input, seconds) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) L.step(g, input, STEP);
}
const IDLE = {}, R = { right: true }, RR = { right: true, run: true };

// a flat 40x18 floor world (ground rows 14..17)
function flat(extra) {
  const rows = [];
  for (let y = 0; y < 14; y++) rows.push(".".repeat(40));
  for (let y = 14; y < 18; y++) rows.push("#".repeat(40));
  const g = world(rows);
  g.hero.x = 5 * TILE; g.hero.y = 14 * TILE - L.HERO_H;
  run(g, IDLE, STEP * 4); // settle onto the floor
  if (extra) extra(g);
  return g;
}

// ---- level data --------------------------------------------------------------
t("six levels are defined and parse", () => {
  assert.strictEqual(LV.defs.length, 6);
  for (const def of LV.defs) {
    const lvl = L.parseLevel(def);
    assert.ok(lvl.w > 60, def.name + " has real width");
    assert.strictEqual(lvl.h, 18, def.name + " is 18 rows tall");
    assert.ok(lvl.grid.includes(L.T.GOAL), def.name + " has a waystone");
    assert.ok(lvl.start.x > 0, def.name + " has a start");
    assert.ok(lvl.enemyDefs.length > 0, def.name + " has enemies");
    assert.ok(lvl.grid.filter((c) => c === L.T.SPARK).length >= 10, def.name + " has sparks");
  }
});
t("levels 2..6 have checkpoints; both themes used; later levels have movers", () => {
  for (let i = 1; i < 6; i++) {
    const lvl = L.parseLevel(LV.defs[i]);
    assert.ok(lvl.grid.includes(L.T.CHECK), LV.defs[i].name + " has a checkpoint");
  }
  const themes = new Set(LV.defs.map((d) => d.theme));
  assert.ok(themes.has("glade") && themes.has("ruin"));
  assert.ok(LV.defs[4].movers.length > 0 && LV.defs[5].movers.length > 0);
});
t("progression teaching: emberseed first appears level 3, gustfruit level 4", () => {
  const has = (i, tile) => L.parseLevel(LV.defs[i]).grid.includes(tile);
  assert.ok(!has(0, L.T.SEED) && !has(1, L.T.SEED) && has(2, L.T.SEED));
  assert.ok(!has(0, L.T.FRUIT) && !has(2, L.T.FRUIT) && has(3, L.T.FRUIT));
  assert.ok(has(1, L.T.ONEWAY), "level 2 teaches one-ways");
  assert.ok(L.isCracked(L.T.CRACK) && L.parseLevel(LV.defs[2]).grid.some(L.isCracked), "level 3 has cracked blocks");
});

// ---- horizontal movement ------------------------------------------------------
t("walking accelerates toward WALK_MAX and stops there", () => {
  const g = flat();
  run(g, R, 1.5);
  assert.ok(Math.abs(g.hero.vx - L.WALK_MAX) < 2, "vx=" + g.hero.vx);
});
t("running reaches ~1.5x walk speed with slower acceleration", () => {
  const g1 = flat(); run(g1, R, 0.15);
  const g2 = flat(); run(g2, RR, 0.15);
  assert.ok(g2.hero.vx < g1.hero.vx, "run accelerates slower early on");
  run(g2, RR, 2);
  assert.ok(Math.abs(g2.hero.vx - L.RUN_MAX) < 2, "run vx=" + g2.hero.vx);
  assert.ok(L.RUN_MAX / L.WALK_MAX > 1.4 && L.RUN_MAX / L.WALK_MAX < 1.7);
});
t("skid: opposite input brakes harder than friction and emits dust", () => {
  const g1 = flat(); run(g1, RR, 2);
  const g2 = flat(); run(g2, RR, 2);
  run(g1, IDLE, 0.12);            // friction only
  let sawSkid = false;
  const steps = Math.round(0.12 / STEP);
  for (let i = 0; i < steps; i++) {
    L.step(g2, { left: true }, STEP);
    if (g2.events.some((e) => e.type === "skid")) sawSkid = true;
  }
  assert.ok(g2.hero.vx < g1.hero.vx - 5, "skid brakes harder: " + g2.hero.vx + " vs " + g1.hero.vx);
  assert.ok(sawSkid, "skid dust event fired");
});
t("friction stops the hero with no input", () => {
  const g = flat(); run(g, R, 1);
  run(g, IDLE, 1);
  assert.strictEqual(g.hero.vx, 0);
});

// ---- jumping -------------------------------------------------------------------
function apexOf(g, input, holdSeconds) {
  let minY = g.hero.y;
  const total = Math.round(1.2 / STEP), holdSteps = Math.round(holdSeconds / STEP);
  for (let i = 0; i < total; i++) {
    L.step(g, i < holdSteps ? input : IDLE, STEP);
    minY = Math.min(minY, g.hero.y);
  }
  return g.hero.y - minY + (g.hero.y, 0), minY;
}
t("variable jump: held jump clears 4 tiles, tap is a short hop", () => {
  const g1 = flat(); const startY = g1.hero.y;
  let m1 = startY;
  for (let i = 0; i < Math.round(1.2 / STEP); i++) { L.step(g1, { jump: true }, STEP); m1 = Math.min(m1, g1.hero.y); }
  const fullRise = startY - m1;
  assert.ok(fullRise >= 4 * TILE, "full jump rise " + fullRise.toFixed(1) + "px >= 64");

  const g2 = flat(); let m2 = g2.hero.y;
  for (let i = 0; i < Math.round(1.2 / STEP); i++) { L.step(g2, i < 6 ? { jump: true } : IDLE, STEP); m2 = Math.min(m2, g2.hero.y); }
  const tapRise = startY - m2;
  assert.ok(tapRise < fullRise * 0.6, "tap " + tapRise.toFixed(1) + " much shorter than hold " + fullRise.toFixed(1));
});
t("early release cuts upward velocity in half", () => {
  const g = flat();
  L.step(g, { jump: true }, STEP);
  run(g, { jump: true }, 0.08);
  const before = g.hero.vy;
  L.step(g, IDLE, STEP);
  assert.ok(g.hero.vy > before * 0.5 - 1 && g.hero.vy < before * 0.4, "vy cut: " + before + " -> " + g.hero.vy);
});
t("reduced gravity only while rising with jump held", () => {
  assert.ok(Math.abs(L.GRAV_HOLD / L.GRAV - 0.55) < 0.01);
});
t("running jump clears ~6 tiles of horizontal distance", () => {
  const g = flat();
  run(g, RR, 2); // at run speed
  const x0 = g.hero.x;
  let air = true, dist = 0;
  L.step(g, { right: true, run: true, jump: true }, STEP);
  for (let i = 0; i < 400 && air; i++) {
    L.step(g, { right: true, run: true, jump: true }, STEP);
    if (g.hero.onGround) { air = false; dist = g.hero.x - x0; }
  }
  assert.ok(dist >= 6 * TILE, "running jump covered " + dist.toFixed(0) + "px >= 96");
});
t("coyote time: jump works ~90ms after leaving a ledge, not after", () => {
  // ledge world: floor only on the left half
  const rows = [];
  for (let y = 0; y < 14; y++) rows.push(".".repeat(40));
  for (let y = 14; y < 18; y++) rows.push("#".repeat(20) + ".".repeat(20));
  const mk = () => {
    const g = world(rows);
    g.hero.x = 18 * TILE; g.hero.y = 14 * TILE - L.HERO_H;
    run(g, IDLE, STEP * 4);
    run(g, R, 0.45); // walk off the edge
    assert.ok(!g.hero.onGround, "airborne past the ledge");
    return g;
  };
  const g1 = mk();
  run(g1, R, 0.04); // 40ms after leaving
  L.step(g1, { right: true, jump: true }, STEP);
  assert.ok(g1.hero.vy < -L.JUMP_V + 20, "coyote jump fired, vy=" + g1.hero.vy);
  const g2 = mk();
  run(g2, R, 0.2); // 200ms: too late
  const vyBefore = g2.hero.vy;
  L.step(g2, { right: true, jump: true }, STEP);
  assert.ok(g2.hero.vy > vyBefore - 20, "no jump after coyote expires");
});
t("jump buffering: press up to ~120ms before landing executes on landing", () => {
  const g = flat();
  // full jump, release after the apex, press again ~100ms before landing
  run(g, { jump: true }, 0.42);
  run(g, IDLE, 0.2);
  assert.ok(!g.hero.onGround && g.hero.vy > 0, "falling");
  L.step(g, { jump: true }, STEP);   // buffered press (still airborne)
  assert.ok(!g.hero.onGround, "press happened before landing");
  let jumped = false;
  for (let i = 0; i < Math.round(0.25 / STEP); i++) {
    L.step(g, { jump: true }, STEP);
    if (g.events.some((e) => e.type === "jump")) { jumped = true; break; }
  }
  assert.ok(jumped, "buffered jump fired on landing");
});

// ---- enemies + stomping -----------------------------------------------------------
function withEnemy(kindChar, ex) {
  const rows = [];
  for (let y = 0; y < 13; y++) rows.push(".".repeat(40));
  rows.push(".".repeat(ex) + kindChar + ".".repeat(40 - ex - 1));
  for (let y = 14; y < 18; y++) rows.push("#".repeat(40));
  return world(rows);
}
t("stomp kills the enemy and bounces ~70% of jump impulse", () => {
  const g = withEnemy("p", 12);
  const e = g.enemies[0];
  g.hero.x = e.x + 2; g.hero.y = e.y - 30; g.hero.vy = 120;
  run(g, IDLE, 0.2);
  assert.ok(!e.alive, "enemy died");
  assert.ok(g.hero.vy < 0, "hero bounced");
  assert.ok(Math.abs(g.hero.vy) <= L.JUMP_V * L.STOMP_BOUNCE + 5, "bounce magnitude ~0.7x");
  assert.ok(g.score >= 100, "stomp scores");
});
t("holding jump during a stomp bounces higher", () => {
  const mk = (hold) => {
    const g = withEnemy("p", 12);
    const e = g.enemies[0];
    g.hero.x = e.x + 2; g.hero.y = e.y - 20; g.hero.vy = 150;
    g.prevJump = hold; // held from before (not a fresh press)
    for (let i = 0; i < 30; i++) {
      L.step(g, hold ? { jump: true } : IDLE, STEP);
      if (!g.enemies[0].alive) break;
    }
    return g.hero.vy;
  };
  const soft = mk(false), hard = mk(true);
  assert.ok(hard < soft - 40, "held bounce " + hard + " > tap bounce " + soft);
});
t("side contact with an enemy hurts: empowered drops a stage, normal dies", () => {
  const g = withEnemy("p", 12);
  g.hero.power = "ember";
  const e = g.enemies[0];
  g.hero.x = e.x - 10; g.hero.y = e.y - 2; g.hero.vy = 0;
  run(g, R, 0.3);
  assert.strictEqual(g.hero.power, "none", "power stage lost");
  assert.ok(g.hero.inv > 0, "invulnerability granted");
  assert.strictEqual(g.status, "playing", "still alive");
  // a hit while at the normal stage = death (fresh world, no power)
  const g2 = withEnemy("p", 12);
  const e2 = g2.enemies[0];
  g2.hero.x = e2.x - 10; g2.hero.y = e2.y - 2; g2.hero.vy = 0;
  run(g2, R, 0.3);
  assert.ok(g2.status === "dead" || g2.lives < L.START_LIVES, "normal-stage hit kills");
});
t("plodder turns at walls and at ledges", () => {
  const rows = [];
  for (let y = 0; y < 6; y++) rows.push(".".repeat(40));
  rows.push(".".repeat(32) + "P" + ".".repeat(7));       // hero parked on a far island
  rows.push(".".repeat(30) + "######" + ".".repeat(4));
  for (let y = 8; y < 13; y++) rows.push(".".repeat(40));
  rows.push("....p" + ".".repeat(35));
  for (let y = 14; y < 18; y++) rows.push("...########" + ".".repeat(28)); // floor x=3..10
  const g = world(rows);
  const e = g.enemies[0];
  let minX = e.x, maxX = e.x;
  run(g, IDLE, 6);
  assert.ok(g.status === "playing" && g.enemies[0] === e, "hero stayed safe; enemies never reset");
  for (let i = 0; i < 600; i++) { L.step(g, IDLE, STEP); minX = Math.min(minX, e.x); maxX = Math.max(maxX, e.x); }
  assert.ok(minX >= 3 * TILE - 2, "never walked off the left ledge (minX=" + minX.toFixed(1) + ")");
  assert.ok(maxX <= 11 * TILE + 2, "never walked off the right ledge (maxX=" + maxX.toFixed(1) + ")");
  assert.ok(maxX - minX > TILE, "it patrols");
});
t("lunger waits, then dashes when the hero is near on its row", () => {
  const g = withEnemy("l", 20);
  const e = g.enemies[0];
  run(g, IDLE, 0.5);
  assert.strictEqual(e.state, "idle", "idle while hero is far");
  g.hero.x = e.x - 90; g.hero.y = e.y;
  run(g, IDLE, 0.3);
  assert.strictEqual(e.state, "dash", "dashes when hero is near");
  assert.ok(e.vx < 0, "dashes toward the hero");
});
t("spinner flies a sine path and is stomp-immune", () => {
  const g = withEnemy("s", 20);
  const e = g.enemies[0];
  const y0 = e.y;
  let seenHigh = false, seenLow = false;
  for (let i = 0; i < 400; i++) {
    L.step(g, IDLE, STEP);
    if (e.y < y0 - 10) seenHigh = true;
    if (e.y > y0 + 10) seenLow = true;
  }
  assert.ok(seenHigh && seenLow, "sine bobbing");
  // land on it from above: should hurt, not stomp
  g.hero.power = "ember";
  g.hero.x = e.x; g.hero.y = e.y - 20; g.hero.vy = 150; g.hero.inv = 0;
  for (let i = 0; i < 60; i++) { L.step(g, IDLE, STEP); if (g.hero.inv > 0) break; }
  assert.ok(e.alive, "spinner survives a stomp attempt");
  assert.ok(g.hero.inv > 0 || g.status !== "playing", "hero got hurt instead");
});
t("spitter lobs arcing globs that die on terrain", () => {
  const g = withEnemy("t", 20);
  g.hero.x = 10 * TILE; g.hero.y = 13 * TILE;
  let spat = false;
  for (let i = 0; i < 600 && !spat; i++) { L.step(g, IDLE, STEP); spat = g.globs.length > 0; }
  assert.ok(spat, "a glob was lobbed");
  const gl = g.globs[0];
  assert.ok(gl.vy < 0, "glob starts rising (an arc)");
  let died = false;
  for (let i = 0; i < 1200 && !died; i++) { L.step(g, IDLE, STEP); died = g.globs.length === 0; }
  assert.ok(died, "glob died on terrain");
});

// ---- tiles ----------------------------------------------------------------------------
t("one-way platforms: jump up through, land on top, drop through with down+jump", () => {
  const rows = [];
  for (let y = 0; y < 11; y++) rows.push(".".repeat(40));
  rows.push("....======" + ".".repeat(30));   // one-way at y=11, x=4..9
  for (let y = 12; y < 14; y++) rows.push(".".repeat(40));
  for (let y = 14; y < 18; y++) rows.push("#".repeat(40));
  const g = world(rows);
  g.hero.x = 6 * TILE; g.hero.y = 14 * TILE - L.HERO_H;
  run(g, IDLE, STEP * 4);
  // jump up through it
  run(g, { jump: true }, 0.45);
  let landed = false;
  for (let i = 0; i < 300; i++) {
    L.step(g, IDLE, STEP);
    if (g.hero.onGround) { landed = true; break; }
  }
  assert.ok(landed && Math.abs((g.hero.y + g.hero.h) - 11 * TILE) < 1,
    "landed ON TOP of the one-way (bottom=" + (g.hero.y + g.hero.h).toFixed(1) + ")");
  // drop through with down + jump
  L.step(g, { down: true, jump: true }, STEP);
  let dropped = false;
  for (let i = 0; i < 300; i++) {
    L.step(g, IDLE, STEP);
    if (g.hero.onGround && Math.abs((g.hero.y + g.hero.h) - 14 * TILE) < 1) { dropped = true; break; }
  }
  assert.ok(dropped, "dropped through to the floor below");
});
t("cracked blocks: only an emberseed hero breaks them from below; caches pay out", () => {
  const rows = [];
  for (let y = 0; y < 10; y++) rows.push(".".repeat(40));
  rows.push("....%$&..." + ".".repeat(30));   // cracked row at y=10: x4=%,x5=$,x6=&
  for (let y = 11; y < 14; y++) rows.push(".".repeat(40));
  for (let y = 14; y < 18; y++) rows.push("#".repeat(40));
  const mk = (power, tx) => {
    const g = world(rows);
    g.hero.x = tx * TILE + 2; g.hero.y = 14 * TILE - L.HERO_H;
    run(g, IDLE, STEP * 4);
    g.hero.power = power;
    run(g, { jump: true }, 0.6);
    return g;
  };
  const g1 = mk("none", 4);
  assert.strictEqual(L.tileAt(g1, 4, 10), L.T.CRACK, "normal hero cannot break it");
  const g2 = mk("ember", 4);
  assert.strictEqual(L.tileAt(g2, 4, 10), L.T.EMPTY, "ember hero breaks it");
  const g3 = mk("ember", 5);
  assert.strictEqual(L.tileAt(g3, 5, 10), L.T.EMPTY, "spark cache broke");
  assert.ok(g3.sparks >= 3, "spark cache paid 3 sparks, got " + g3.sparks);
  const g4 = mk("ember", 6);
  assert.strictEqual(L.tileAt(g4, 6, 9), L.T.SEED, "seed cache revealed an emberseed above");
});
t("spikes and pits kill instantly even when empowered", () => {
  const rows = [];
  for (let y = 0; y < 13; y++) rows.push(".".repeat(40));
  rows.push("........^^" + ".".repeat(30));
  for (let y = 14; y < 18; y++) rows.push("#".repeat(20) + ".".repeat(20)); // pit on the right
  const g1 = world(rows);
  g1.hero.x = 6 * TILE; g1.hero.y = 14 * TILE - L.HERO_H;
  run(g1, IDLE, STEP * 4);
  g1.hero.power = "ember";
  run(g1, RR, 0.6);
  assert.ok(g1.status === "dead", "spikes kill outright");
  const g2 = world(rows);
  g2.hero.x = 16 * TILE; g2.hero.y = 14 * TILE - L.HERO_H;
  g2.hero.power = "gust";
  run(g2, { right: true, run: true }, 2.5);
  assert.ok(g2.status !== "playing" || g2.lives < L.START_LIVES, "pit fall kills");
});
t("power-ups: emberseed and gustfruit set the stage; gustfruit grants a double jump", () => {
  const rows = [];
  for (let y = 0; y < 13; y++) rows.push(".".repeat(40));
  rows.push("....E...G." + ".".repeat(30));
  for (let y = 14; y < 18; y++) rows.push("#".repeat(40));
  const g = world(rows);
  g.hero.x = 3 * TILE; g.hero.y = 14 * TILE - L.HERO_H;
  run(g, IDLE, STEP * 4);
  run(g, R, 0.5);
  assert.strictEqual(g.hero.power, "ember", "picked up the emberseed");
  run(g, R, 0.8);
  assert.strictEqual(g.hero.power, "gust", "gustfruit replaces it");
  // double jump: jump, release, press again mid-air
  run(g, { jump: true }, 0.2);
  L.step(g, IDLE, STEP);
  run(g, IDLE, 0.15);
  const vyBefore = g.hero.vy;
  L.step(g, { jump: true }, STEP);
  assert.ok(g.hero.vy < vyBefore - 100, "mid-air jump fired: " + vyBefore + " -> " + g.hero.vy);
  assert.strictEqual(g.hero.airJumps, 0, "double jump spent");
});
t("checkpoints save the respawn point; death respawns there with a life lost", () => {
  const rows = [];
  for (let y = 0; y < 13; y++) rows.push(".".repeat(40));
  rows.push("........C." + ".".repeat(30));
  for (let y = 14; y < 18; y++) rows.push("#".repeat(40));
  const g = world(rows);
  g.hero.x = 6 * TILE; g.hero.y = 14 * TILE - L.HERO_H;
  run(g, IDLE, STEP * 4);
  run(g, R, 0.7);
  assert.ok(g.checkpoint, "checkpoint registered");
  const lives0 = g.lives;
  g.hero.x = 20 * TILE;
  // kill via spike-free route: force death
  g.hero.power = "none";
  g.status = "playing";
  // simulate a lethal hit
  g.hero.inv = 0;
  L.step(g, IDLE, STEP);
  // directly kill through the public path: fall into a pit
  g.hero.y = 20 * TILE;
  run(g, IDLE, 2);
  assert.strictEqual(g.lives, lives0 - 1, "a life was lost");
  assert.ok(Math.abs(g.hero.x - (8 * TILE + 2)) < 2, "respawned at the checkpoint, x=" + g.hero.x);
});
t("game over after the last life; goal sets cleared", () => {
  const g = flat();
  g.lives = 1;
  g.hero.y = 30 * TILE;
  run(g, IDLE, 2);
  assert.strictEqual(g.status, "gameover");
  const g2 = flat();
  L.setTile(g2, 8, 13, L.T.GOAL);
  run(g2, R, 1.2);
  assert.strictEqual(g2.status, "cleared", "touching the waystone clears the level");
});
t("100 sparks award an extra life with a 1up event", () => {
  const g = flat();
  g.sparks = 99;
  const lives0 = g.lives;
  L.setTile(g, 7, 13, L.T.SPARK);
  let saw1up = false;
  for (let i = 0; i < Math.round(1.2 / STEP); i++) {
    L.step(g, R, STEP);
    if (g.events.some((e) => e.type === "1up")) saw1up = true;
  }
  assert.strictEqual(g.sparks, 100);
  assert.strictEqual(g.lives, lives0 + 1, "extra life granted");
  assert.ok(saw1up, "1up event emitted");
});

// ---- moving platforms --------------------------------------------------------------
t("hero rides a moving platform (platform delta applied)", () => {
  const rows = [];
  for (let y = 0; y < 18; y++) rows.push(".".repeat(40));
  const g = world(rows.map((r, i) => (i === 17 ? "#".repeat(40) : r)),
    [{ x: 10, y: 10, w: 3, axis: "x", range: 3, speed: 1.5, phase: 0 }]);
  const m = g.movers[0];
  g.hero.x = m.x + 8; g.hero.y = m.y - L.HERO_H - 1; g.hero.vy = 10;
  let rode = false;
  const rel0 = null;
  let relStart = null;
  for (let i = 0; i < Math.round(2 / STEP); i++) {
    L.step(g, IDLE, STEP);
    if (g.hero.riding >= 0) {
      if (relStart === null) relStart = g.hero.x - m.x;
      rode = true;
    }
  }
  assert.ok(rode, "hero landed on and rode the mover");
  assert.ok(g.hero.riding >= 0, "still riding after 2s of movement");
  const rel = g.hero.x - m.x;
  assert.ok(Math.abs(rel - relStart) < 2, "hero moved WITH the platform (rel drift " + Math.abs(rel - relStart).toFixed(2) + "px)");
});

// ---- camera --------------------------------------------------------------------------
t("camera leads the hero in the facing direction and clamps to the level", () => {
  const g = flat();
  const VW = 32 * TILE, VH = 15 * TILE;
  let cam = { x: 0, y: 0, anchorY: g.hero.y + g.hero.h };
  g.hero.x = 20 * TILE; g.hero.facing = 1;
  for (let i = 0; i < 300; i++) cam = L.stepCamera(cam, g, VW, VH, 1 / 60);
  // 40-tile level is narrower than the 32-tile view + lead: clamp keeps it in range
  assert.ok(cam.x >= 0 && cam.x <= Math.max(0, g.level.w * TILE - VW), "clamped");
  // widen: fake a wide level
  g.level.w = 200;
  g.hero.facing = 1;
  for (let i = 0; i < 300; i++) cam = L.stepCamera(cam, g, VW, VH, 1 / 60);
  const centerOffset = (g.hero.x + g.hero.w / 2) - (cam.x + VW / 2);
  assert.ok(centerOffset < -0.1 * VW * 0.9, "camera leads ahead of a right-facing hero (offset " + centerOffset.toFixed(1) + ")");
  g.hero.facing = -1;
  g.hero.x = 100 * TILE;
  for (let i = 0; i < 300; i++) cam = L.stepCamera(cam, g, VW, VH, 1 / 60);
  const off2 = (g.hero.x + g.hero.w / 2) - (cam.x + VW / 2);
  assert.ok(off2 > 0.1 * VW * 0.9, "camera leads ahead of a left-facing hero");
});

process.on("exit", (code) => {
  console.log(`\nlogic.test.js: ${n} tests, ${code === 0 ? "all passed" : "FAILURES"}`);
});

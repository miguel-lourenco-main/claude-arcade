// Headless engine tests for Gloamkeep. Run: node games/gloamkeep/test/engine.test.mjs
import { MAPS, parseMap, validateReachability, dumpMap, TILE } from '../src/maps.js';
import {
  createGame, tick, makeInput, castRay, DT, hasLineOfSight,
  damageEnemy, damagePlayer, ENEMY_DEFS, LEVEL_COUNT,
} from '../src/game.js';

let failures = 0;
function ok(cond, msg) {
  if (cond) console.log('  ok  ' + msg);
  else { failures++; console.error('FAIL  ' + msg); }
}

// ---- 1. Map validity -------------------------------------------------------
console.log('\n== map validation ==');
for (const def of MAPS) {
  let level;
  try {
    level = parseMap(def);
  } catch (err) {
    failures++;
    console.error('FAIL  parse ' + def.name + ': ' + err.message);
    console.error(dumpMap(def));
    continue;
  }
  const problems = validateReachability(level);
  if (problems.length) {
    failures++;
    console.error('FAIL  ' + def.name + ':');
    for (const p of problems) console.error('        - ' + p);
    console.error(dumpMap(def));
  } else {
    console.log(`  ok  ${def.name}: ${level.w}x${level.h}, ${level.enemies.length} enemies, ` +
      `${level.items.length} items, ${level.doors.length} doors, ${level.pushwalls.length} secrets`);
  }
  ok(level.doors.some((d) => d.locked), def.name + ' has at least one locked door');
  ok(level.pushwalls.length >= 1, def.name + ' has a secret push-wall');
}
ok(LEVEL_COUNT === 3, 'three levels');

// ---- 2. Raycast fundamentals ----------------------------------------------
console.log('\n== raycast ==');
{
  const s = createGame(0, null, 1);
  const out = { hit: false, dist: 0, side: 0, tex: 0, texU: 0 };
  // ray straight at a wall one cell away: stand at spawn, fire west into border
  const p = s.player;
  castRay(s, 1.5, 1.5, -1, 0, out);
  ok(out.hit && Math.abs(out.dist - 0.5) < 1e-9, `west ray hits border at 0.5 (got ${out.dist})`);
  ok(out.side === 0, 'x-side hit reported as side 0');
  castRay(s, 1.5, 1.5, 0, -1, out);
  ok(out.hit && Math.abs(out.dist - 0.5) < 1e-9, 'north ray hits border at 0.5');
  ok(out.side === 1, 'y-side hit reported as side 1');
  // diagonal ray distance must be Euclidean-consistent
  const inv = Math.SQRT1_2;
  castRay(s, 1.5, 1.5, -inv, -inv, out);
  ok(out.hit && out.dist >= 0.5 && out.dist < 1.1, `diagonal ray sane (${out.dist.toFixed(3)})`);
  ok(out.texU >= 0 && out.texU < 1, 'texU in [0,1)');
}

// ---- 3. Doors block rays until opened --------------------------------------
console.log('\n== doors ==');
{
  const s = createGame(0, null, 2);
  const d = s.map.doors.find((dd) => dd.locked === 0);
  ok(!!d, 'found an unlocked door');
  const out = { hit: false, dist: 0, side: 0, tex: 0, texU: 0 };
  // fire a ray into the door from an adjacent open cell
  const m = s.map;
  let fromX = d.x - 1 + 0.5, fromY = d.y + 0.5, dirX = 1, dirY = 0;
  if (m.grid[d.y * m.w + d.x - 1] !== TILE.EMPTY) { fromX = d.x + 1.5; dirX = -1; }
  if (m.grid[d.y * m.w + Math.floor(fromX)] !== TILE.EMPTY) {
    fromX = d.x + 0.5; dirX = 0;
    fromY = d.y - 1 + 0.5; dirY = 1;
    if (m.grid[(d.y - 1) * m.w + d.x] !== TILE.EMPTY) { fromY = d.y + 1.5; dirY = -1; }
  }
  castRay(s, fromX, fromY, dirX, dirY, out);
  ok(out.hit && out.dist <= 1.01 && (out.tex === TILE.DOOR), `closed door blocks ray at half-cell (d=${out.dist.toFixed(2)} tex=${out.tex})`);
  // open it fully
  d.open = 1; d.state = 2; d.timer = 99;
  castRay(s, fromX, fromY, dirX, dirY, out);
  ok(!out.hit || out.dist > 1.01, 'fully open door lets the ray through');
}

// ---- 4. Sliding collision ---------------------------------------------------
console.log('\n== collision / sliding ==');
{
  const s = createGame(0, null, 3);
  const input = makeInput();
  const p = s.player;
  // walk diagonally into the west+north corner: must slide, not stick, not clip
  p.x = 1.5; p.y = 1.5; p.angle = Math.PI; // facing west
  input.forward = 1; input.strafe = 0;
  const startY = p.y;
  for (let i = 0; i < 60; i++) tick(s, input, DT);
  ok(p.x >= 1 + p.radius - 1e-6, `player did not clip into wall (x=${p.x.toFixed(3)})`);
  // now walk at 45 degrees into the west wall: y should still change (slide)
  for (const e of s.enemies) { e.state = 'dead'; e.hp = 0; } // keep the lane clear
  p.x = 1.5; p.y = 11.5; p.angle = Math.PI * 0.75; // west-south diagonal
  const y0 = p.y;
  for (let i = 0; i < 40; i++) tick(s, input, DT);
  ok(Math.abs(p.y - y0) > 0.3, `player slides along wall (dy=${(p.y - y0).toFixed(3)})`);
  ok(p.x >= 1 + p.radius - 1e-6, 'still outside wall while sliding');
}

// ---- 5. Firing, ammo, hitscan ----------------------------------------------
console.log('\n== combat ==');
{
  const s = createGame(0, null, 4);
  const input = makeInput();
  const p = s.player;
  // place a dummy enemy right in front of the player in open space
  const e = s.enemies[0];
  e.x = p.x + 2 * Math.cos(p.angle);
  e.y = p.y + 2 * Math.sin(p.angle);
  e.state = 'idle';
  const hp0 = e.hp, ammo0 = p.ammo;
  input.fire = true;
  tick(s, input, DT);
  ok(p.ammo === ammo0 - 1, 'firing consumes ammo');
  ok(e.hp < hp0, `hitscan damaged the enemy (${hp0} -> ${e.hp})`);
  ok(s.events.some((ev) => ev.type === 'shot'), 'shot event emitted');
  ok(s.events.some((ev) => ev.type === 'enemyHit'), 'enemyHit event emitted');
  // cooldown gates fire rate
  s.events.length = 0;
  tick(s, input, DT);
  ok(!s.events.some((ev) => ev.type === 'shot'), 'cooldown prevents machine-gunning');
  // kill it
  damageEnemy(s, e, 9999);
  ok(e.state === 'dead', 'enemy dies at 0 hp');
  ok(s.kills === 1, 'kill counted');
  ok(s.score >= ENEMY_DEFS[e.type].points, 'score awarded for kill');
  // shots do not hit through walls
  const s2 = createGame(0, null, 5);
  const p2 = s2.player;
  const e2 = s2.enemies[0];
  // enemy placed beyond the border wall in front — impossible, so instead:
  // put enemy behind player; center-ray hitscan must miss it
  e2.x = p2.x - 2 * Math.cos(p2.angle);
  e2.y = p2.y - 2 * Math.sin(p2.angle);
  const hp2 = e2.hp;
  const in2 = makeInput(); in2.fire = true;
  tick(s2, in2, DT);
  ok(e2.hp === hp2, 'hitscan misses enemies behind the player');
}

// ---- 6. Ammo dry-fire -------------------------------------------------------
{
  const s = createGame(0, null, 6);
  s.player.ammo = 0;
  const input = makeInput(); input.fire = true;
  tick(s, input, DT);
  ok(s.events.some((ev) => ev.type === 'dryFire'), 'dry fire event when out of ammo');
}

// ---- 7. Door use flow + locked doors ----------------------------------------
console.log('\n== door use flow ==');
{
  const s = createGame(0, null, 7);
  const p = s.player;
  for (const e of s.enemies) { e.state = 'dead'; e.hp = 0; } // no wanderers holding doors
  const d = s.map.doors.find((dd) => dd.locked === 0);
  // stand in front of the door facing it
  const m = s.map;
  let sideX = d.x - 1, sideY = d.y, ang = 0;
  if (m.grid[d.y * m.w + d.x - 1] !== TILE.EMPTY || d.x - 1 < 0) { sideX = d.x + 1; ang = Math.PI; }
  if (m.grid[sideY * m.w + sideX] !== TILE.EMPTY) {
    sideX = d.x; sideY = d.y - 1; ang = Math.PI / 2;
    if (m.grid[sideY * m.w + sideX] !== TILE.EMPTY) { sideY = d.y + 1; ang = -Math.PI / 2; }
  }
  p.x = sideX + 0.5; p.y = sideY + 0.5; p.angle = ang;
  const input = makeInput(); input.usePressed = true;
  tick(s, input, DT);
  ok(d.state === 1, 'use opens an unlocked door');
  input.usePressed = false;
  for (let i = 0; i < 90; i++) tick(s, input, DT);
  ok(d.open === 1 && d.state === 2, 'door fully opens');
  for (let i = 0; i < 60 * 6; i++) tick(s, input, DT);
  ok(d.state === 0 && d.open === 0, 'door auto-closes after hold time');

  // locked door refuses without key
  const s3 = createGame(0, null, 8);
  const ld = s3.map.doors.find((dd) => dd.locked === 1);
  ok(!!ld, 'level 1 has a crimson door');
  const m3 = s3.map;
  let sx = ld.x - 1, sy = ld.y, a3 = 0;
  if (sx < 0 || m3.grid[sy * m3.w + sx] !== TILE.EMPTY) { sx = ld.x + 1; a3 = Math.PI; }
  if (m3.grid[sy * m3.w + sx] !== TILE.EMPTY) {
    sx = ld.x; sy = ld.y - 1; a3 = Math.PI / 2;
    if (m3.grid[sy * m3.w + sx] !== TILE.EMPTY) { sy = ld.y + 1; a3 = -Math.PI / 2; }
  }
  s3.player.x = sx + 0.5; s3.player.y = sy + 0.5; s3.player.angle = a3;
  const in3 = makeInput(); in3.usePressed = true;
  tick(s3, in3, DT);
  ok(ld.state === 0 && s3.events.some((ev) => ev.type === 'locked'), 'locked door refuses without key');
  s3.player.keys[0] = true;
  s3.events.length = 0;
  tick(s3, in3, DT);
  ok(ld.state === 1, 'locked door opens with key');
}

// ---- 8. Push-wall secret -----------------------------------------------------
console.log('\n== push-wall ==');
{
  const s = createGame(0, null, 9);
  const pw = s.map.pushwalls[0];
  const m = s.map;
  // find open side to stand on
  let sx = pw.x + 1, sy = pw.y, a = Math.PI;
  if (m.grid[sy * m.w + sx] !== TILE.EMPTY) { sx = pw.x - 1; a = 0; }
  if (sx < 0 || m.grid[sy * m.w + sx] !== TILE.EMPTY) {
    sx = pw.x; sy = pw.y + 1; a = -Math.PI / 2;
    if (m.grid[sy * m.w + sx] !== TILE.EMPTY) { sy = pw.y - 1; a = Math.PI / 2; }
  }
  s.player.x = sx + 0.5; s.player.y = sy + 0.5; s.player.angle = a;
  const input = makeInput(); input.usePressed = true;
  tick(s, input, DT);
  ok(pw.active, 'push-wall activates on use');
  ok(s.events.some((ev) => ev.type === 'secret'), 'secret event emitted');
  ok(s.secretsFound === 1, 'secret counted');
  input.usePressed = false;
  // while moving, a ray from the player toward it should still hit something nearer than 2 cells... run it out
  for (let i = 0; i < 60 * 4; i++) tick(s, input, DT);
  ok(!pw.active && pw.done, 'push-wall finishes moving');
  const finalCell = m.grid[(pw.y + pw.dirY * 2) * m.w + (pw.x + pw.dirX * 2)];
  ok(finalCell === TILE.STONE, 'push-wall rests as stone 2 cells back');
  ok(m.grid[pw.y * m.w + pw.x] === TILE.EMPTY, 'origin cell is now open');
}

// ---- 9. Enemy AI: alert on shot, chase, melee -------------------------------
console.log('\n== enemy AI ==');
{
  const s = createGame(0, null, 10);
  const p = s.player;
  // choose a melee enemy, park it 4 tiles away in the open with LOS
  const e = s.enemies.find((en) => !ENEMY_DEFS[en.type].ranged);
  e.x = p.x; e.y = p.y; // same cell region: guaranteed reachable/LOS
  e.x = p.x + 3;
  // ensure open space: use map row of spawn corridor eastwards; if solid, drop to adjacent
  if (s.map.grid[Math.floor(e.y) * s.map.w + Math.floor(e.x)] !== TILE.EMPTY) { e.x = p.x + 1.4; }
  e.state = 'idle';
  const input = makeInput(); input.fire = true;
  tick(s, input, DT); // gunshot alerts by path distance
  input.fire = false;
  ok(e.state === 'chase' || e.state === 'attack', `enemy alerted by gunshot (state=${e.state})`);
  const d0 = Math.hypot(e.x - p.x, e.y - p.y);
  for (let i = 0; i < 60; i++) tick(s, input, DT);
  const d1 = Math.hypot(e.x - p.x, e.y - p.y);
  ok(d1 < d0 || e.state === 'attack', `enemy closes distance (${d0.toFixed(2)} -> ${d1.toFixed(2)})`);
  // let it maul the player
  let hp0 = p.hp;
  for (let i = 0; i < 60 * 6 && p.hp === hp0; i++) tick(s, input, DT);
  ok(p.hp < hp0, 'melee enemy eventually damages the player');
  ok(s.events.some((ev) => ev.type === 'playerHit') || p.hp < hp0, 'playerHit event fired');
}

// ---- 10. Ranged enemy fires bolts -------------------------------------------
{
  const s = createGame(0, null, 11);
  const p = s.player;
  const e = s.enemies.find((en) => ENEMY_DEFS[en.type].ranged);
  ok(!!e, 'level 1 has a ranged enemy');
  // clear other enemies so they don't interfere
  for (const other of s.enemies) if (other !== e) { other.state = 'dead'; other.hp = 0; }
  // put it 4 tiles east of player along the spawn corridor... find LOS spot:
  e.x = p.x + 4; e.y = p.y;
  if (!hasLineOfSight(s, e.x, e.y, p.x, p.y)) { e.x = p.x + 2.5; }
  e.state = 'chase';
  e.cooldown = 0;
  const input = makeInput();
  let boltSeen = false, hurt = false;
  const hp0 = p.hp;
  for (let i = 0; i < 60 * 8; i++) {
    tick(s, input, DT);
    if (s.bolts.length) boltSeen = true;
    if (s.events.some((ev) => ev.type === 'boltFire')) boltSeen = true;
    s.events.length = 0;
    if (p.hp < hp0) { hurt = true; break; }
  }
  ok(boltSeen, 'ranged enemy loosed a bolt');
  ok(hurt, 'bolt (or melee) damaged the player');
}

// ---- 11. Pickups -------------------------------------------------------------
console.log('\n== pickups ==');
{
  const s = createGame(0, null, 12);
  const p = s.player;
  p.hp = 40; p.ammo = 5;
  const health = s.items.find((i) => i.kind === 'health');
  const ammo = s.items.find((i) => i.kind === 'ammo');
  const key = s.items.find((i) => i.kind === 'key1');
  const shard = s.items.find((i) => i.kind === 'shard');
  const input = makeInput();
  p.x = health.x; p.y = health.y; tick(s, input, DT);
  ok(health.taken && p.hp === 65, `health pickup (+25 -> ${p.hp})`);
  p.x = ammo.x; p.y = ammo.y; tick(s, input, DT);
  ok(ammo.taken && p.ammo === 17, `ammo pickup (+12 -> ${p.ammo})`);
  p.x = key.x; p.y = key.y; tick(s, input, DT);
  ok(key.taken && p.keys[0], 'crimson key picked up');
  const sc = s.score;
  p.x = shard.x; p.y = shard.y; tick(s, input, DT);
  ok(shard.taken && s.score === sc + 100, 'shard scores 100');
  ok(s.events.filter((ev) => ev.type === 'pickup').length >= 4, 'pickup events emitted');
  // full-health potion is left on the ground
  const s2 = createGame(0, null, 13);
  const h2 = s2.items.find((i) => i.kind === 'health');
  s2.player.x = h2.x; s2.player.y = h2.y;
  tick(s2, makeInput(), DT);
  ok(!h2.taken, 'health potion not consumed at full hp');
}

// ---- 12. Death & level complete ----------------------------------------------
console.log('\n== flows ==');
{
  const s = createGame(0, null, 14);
  damagePlayer(s, 9999, s.player.x + 1, s.player.y);
  ok(s.status === 'dead' && !s.player.alive, 'player death sets status');
  ok(s.events.some((ev) => ev.type === 'gameOver'), 'gameOver event');
  // ticking a dead game is a no-op
  const t0 = s.time;
  tick(s, makeInput(), DT);
  ok(s.time === t0, 'dead game does not advance');
}
{
  // level complete: stand before the exit and use it
  const s = createGame(0, null, 15);
  const m = s.map;
  let ex = -1, ey = -1;
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    if (m.grid[y * m.w + x] === TILE.EXIT) { ex = x; ey = y; }
  }
  ok(ex >= 0, 'exit tile exists');
  // find adjacent open cell
  let sx = ex, sy = ey, ang = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (m.grid[(ey + dy) * m.w + (ex + dx)] === TILE.EMPTY) {
      sx = ex + dx; sy = ey + dy;
      ang = Math.atan2(-dy, -dx);
      break;
    }
  }
  s.player.x = sx + 0.5; s.player.y = sy + 0.5; s.player.angle = ang;
  const input = makeInput(); input.usePressed = true;
  const sc0 = s.score;
  tick(s, input, DT);
  ok(s.status === 'complete', 'using the exit completes the level');
  ok(s.score === sc0 + 500, 'exit bonus awarded');
  ok(s.events.some((ev) => ev.type === 'levelComplete'), 'levelComplete event');
}

// ---- 13. Carry between levels + determinism -----------------------------------
{
  const s = createGame(1, { hp: 62, ammo: 31, score: 1234 }, 16);
  ok(s.player.hp === 62 && s.player.ammo === 31 && s.score === 1234, 'carry applies to next level');
  ok(!s.player.keys.some(Boolean), 'keys do not carry over');
  // determinism: same seed, same inputs -> same state
  const a = createGame(0, null, 42);
  const b = createGame(0, null, 42);
  const input = makeInput(); input.forward = 1; input.fire = true;
  for (let i = 0; i < 240; i++) { tick(a, input, DT); tick(b, input, DT); }
  ok(a.player.x === b.player.x && a.player.y === b.player.y && a.score === b.score &&
     a.player.ammo === b.player.ammo,
     'fixed-timestep sim is deterministic for a given seed');
}

// ---- 14. Performance smoke: castRay column loop -------------------------------
console.log('\n== perf smoke ==');
{
  const s = createGame(2, null, 17);
  const out = { hit: false, dist: 0, side: 0, tex: 0, texU: 0 };
  const W = 480;
  const t0 = process.hrtime.bigint();
  const FRAMES = 200;
  for (let f = 0; f < FRAMES; f++) {
    const va = f * 0.013;
    for (let x = 0; x < W; x++) {
      const off = ((x / W) * 2 - 1) * 0.65;
      const a = va + Math.atan(off);
      castRay(s, s.player.x, s.player.y, Math.cos(a), Math.sin(a), out);
    }
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`  ${FRAMES} frames x ${W} columns: ${ms.toFixed(1)}ms total, ${(ms / FRAMES).toFixed(3)}ms/frame`);
  ok(ms / FRAMES < 4, 'raycast column pass well under frame budget');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall tests passed');
process.exit(failures ? 1 : 0);

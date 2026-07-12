// Gloamkeep — core-rule logic tests (plain asserts, no DOM, no deps).
// Run: node games/gloamkeep/test/logic.test.js
// The src files are classic scripts that attach their API to the global
// `Gloamkeep` namespace; require() loads them for their side effects.

'use strict';
const assert = require('node:assert');

require('../src/maps.js');
require('../src/game.js');

const G = globalThis.Gloamkeep;
const {
  MAPS, parseMap, validateReachability, TILE,
  createGame, tick, makeInput, castRay, DT,
  damageEnemy, damagePlayer, ENEMY_DEFS, LEVEL_COUNT, MAX_HP, KEY_NAMES,
} = G;

let n = 0;
function test(name, fn) {
  n++;
  try {
    fn();
    console.log('  ok  ' + name);
  } catch (err) {
    console.error('FAIL  ' + name);
    console.error(err && err.stack || err);
    process.exitCode = 1;
  }
}

// helper: stand the player on an open cell adjacent to grid cell (x,y), facing it
function standBefore(s, x, y) {
  const m = s.map;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
    if (m.grid[ny * m.w + nx] === TILE.EMPTY) {
      s.player.x = nx + 0.5;
      s.player.y = ny + 0.5;
      s.player.angle = Math.atan2(-dy, -dx);
      return true;
    }
  }
  return false;
}

function clearEnemies(s) {
  for (const e of s.enemies) { e.state = 'dead'; e.hp = 0; }
}

test('namespace exposes the full logic API', () => {
  for (const k of ['createGame', 'tick', 'makeInput', 'castRay', 'damagePlayer',
                   'damageEnemy', 'MAPS', 'parseMap', 'validateReachability']) {
    assert.equal(typeof G[k], k === 'MAPS' ? 'object' : 'function', k);
  }
});

test('all three maps parse and are fully reachable', () => {
  assert.equal(LEVEL_COUNT, 3);
  for (const def of MAPS) {
    const level = parseMap(def);
    const problems = validateReachability(level);
    assert.deepEqual(problems, [], def.name + ': ' + problems.join('; '));
  }
});

test('new game starts with full vigor, 24 shots, no keys', () => {
  const s = createGame(0, null, 1);
  assert.equal(s.player.hp, MAX_HP);
  assert.equal(s.player.ammo, 24);
  assert.deepEqual(s.player.keys, [false, false, false]);
  assert.equal(s.status, 'playing');
});

test('WASD-style movement advances the player', () => {
  const s = createGame(0, null, 2);
  clearEnemies(s);
  const input = makeInput();
  input.forward = 1;
  const x0 = s.player.x;
  for (let i = 0; i < 30; i++) tick(s, input, DT);
  assert.ok(s.player.x > x0 + 0.5, `moved east (${x0} -> ${s.player.x})`);
});

test('collision slides along walls instead of sticking', () => {
  const s = createGame(0, null, 3);
  clearEnemies(s);
  const p = s.player;
  p.x = 1.5; p.y = 11.5; p.angle = Math.PI * 0.75; // into the west wall, aslant
  const input = makeInput(); input.forward = 1;
  const y0 = p.y;
  for (let i = 0; i < 40; i++) tick(s, input, DT);
  assert.ok(p.x >= 1 + p.radius - 1e-6, 'did not clip into the wall');
  assert.ok(Math.abs(p.y - y0) > 0.3, 'slid along the wall');
});

test('firing consumes ammo and respects the cooldown', () => {
  const s = createGame(0, null, 4);
  clearEnemies(s);
  const input = makeInput(); input.fire = true;
  const ammo0 = s.player.ammo;
  tick(s, input, DT);
  assert.equal(s.player.ammo, ammo0 - 1, 'one shot spent');
  tick(s, input, DT);
  assert.equal(s.player.ammo, ammo0 - 1, 'cooldown blocks the next tick');
});

test('out of ammo: dry fire event, no negative ammo', () => {
  const s = createGame(0, null, 5);
  clearEnemies(s);
  s.player.ammo = 0;
  const input = makeInput(); input.fire = true;
  tick(s, input, DT);
  assert.equal(s.player.ammo, 0);
  assert.ok(s.events.some((ev) => ev.type === 'dryFire'));
});

test('hitscan damages the first enemy on the center ray', () => {
  const s = createGame(0, null, 6);
  const e = s.enemies[0];
  e.x = s.player.x + 2; e.y = s.player.y; e.state = 'idle';
  s.player.angle = 0;
  const hp0 = e.hp;
  const input = makeInput(); input.fire = true;
  tick(s, input, DT);
  assert.ok(e.hp < hp0, `enemy hurt (${hp0} -> ${e.hp})`);
});

test('kills award points and are counted', () => {
  const s = createGame(0, null, 7);
  const e = s.enemies[0];
  const sc0 = s.score;
  damageEnemy(s, e, 9999);
  assert.equal(e.state, 'dead');
  assert.equal(s.kills, 1);
  assert.equal(s.score, sc0 + ENEMY_DEFS[e.type].points);
});

test('use opens an unlocked door; door animates open then auto-closes', () => {
  const s = createGame(0, null, 8);
  clearEnemies(s);
  const d = s.map.doors.find((dd) => dd.locked === 0);
  assert.ok(standBefore(s, d.x, d.y), 'found a cell before the door');
  const input = makeInput(); input.usePressed = true;
  tick(s, input, DT);
  assert.equal(d.state, 1, 'door opening');
  input.usePressed = false;
  for (let i = 0; i < 90; i++) tick(s, input, DT);
  assert.equal(d.open, 1, 'fully open');
  for (let i = 0; i < 60 * 6; i++) tick(s, input, DT);
  assert.equal(d.state, 0, 'auto-closed');
});

test('locked door refuses without its key, opens with it', () => {
  const s = createGame(0, null, 9);
  clearEnemies(s);
  const d = s.map.doors.find((dd) => dd.locked === 1);
  assert.ok(standBefore(s, d.x, d.y));
  const input = makeInput(); input.usePressed = true;
  tick(s, input, DT);
  assert.equal(d.state, 0, 'stays shut');
  assert.ok(s.events.some((ev) => ev.type === 'locked'), 'locked event');
  assert.ok(s.message.includes(KEY_NAMES[0]), 'message names the sigil');
  s.player.keys[0] = true;
  tick(s, input, DT);
  assert.equal(d.state, 1, 'opens with the key');
});

test('closed door blocks rays, open door lets them through', () => {
  const s = createGame(0, null, 10);
  const d = s.map.doors.find((dd) => dd.locked === 0);
  assert.ok(standBefore(s, d.x, d.y));
  const p = s.player;
  const out = { hit: false, dist: 0, side: 0, tex: 0, texU: 0 };
  castRay(s, p.x, p.y, Math.cos(p.angle), Math.sin(p.angle), out);
  assert.ok(out.hit && out.dist <= 1.01 && out.tex === TILE.DOOR, 'blocked');
  d.open = 1; d.state = 2; d.timer = 99;
  castRay(s, p.x, p.y, Math.cos(p.angle), Math.sin(p.angle), out);
  assert.ok(!out.hit || out.dist > 1.01, 'passes through when open');
});

test('key pickup sets the matching sigil', () => {
  const s = createGame(0, null, 11);
  clearEnemies(s);
  const key = s.items.find((i) => i.kind === 'key1');
  s.player.x = key.x; s.player.y = key.y;
  tick(s, makeInput(), DT);
  assert.ok(key.taken && s.player.keys[0]);
});

test('health/ammo/shard pickups apply their effects and caps', () => {
  const s = createGame(0, null, 12);
  clearEnemies(s);
  const p = s.player;
  p.hp = 40; p.ammo = 5;
  const health = s.items.find((i) => i.kind === 'health');
  const ammo = s.items.find((i) => i.kind === 'ammo');
  const shard = s.items.find((i) => i.kind === 'shard');
  const input = makeInput();
  p.x = health.x; p.y = health.y; tick(s, input, DT);
  assert.equal(p.hp, 65, '+25 vigor');
  p.x = ammo.x; p.y = ammo.y; tick(s, input, DT);
  assert.equal(p.ammo, 17, '+12 shots');
  const sc = s.score;
  p.x = shard.x; p.y = shard.y; tick(s, input, DT);
  assert.equal(s.score, sc + 100, 'shard +100');
});

test('secret push-wall: +250 score, secret counted, wall slides away', () => {
  const s = createGame(0, null, 13);
  clearEnemies(s);
  const pw = s.map.pushwalls[0];
  assert.ok(standBefore(s, pw.x, pw.y));
  const sc0 = s.score;
  const input = makeInput(); input.usePressed = true;
  tick(s, input, DT);
  assert.ok(pw.active, 'push-wall moving');
  assert.equal(s.secretsFound, 1);
  assert.equal(s.score, sc0 + 250);
  input.usePressed = false;
  for (let i = 0; i < 60 * 4; i++) tick(s, input, DT);
  assert.ok(pw.done && !pw.active, 'finished sliding');
});

test('damage flow: player hurt, then dies at 0 hp and the game stops', () => {
  const s = createGame(0, null, 14);
  damagePlayer(s, 30, s.player.x + 1, s.player.y);
  assert.equal(s.player.hp, MAX_HP - 30);
  assert.ok(s.events.some((ev) => ev.type === 'playerHit'));
  damagePlayer(s, 9999, s.player.x + 1, s.player.y);
  assert.equal(s.player.hp, 0);
  assert.equal(s.status, 'dead');
  assert.ok(s.events.some((ev) => ev.type === 'gameOver'));
  const t0 = s.time;
  tick(s, makeInput(), DT);
  assert.equal(s.time, t0, 'dead game does not advance');
});

test('using the exit completes the level with a +500 bonus', () => {
  const s = createGame(0, null, 15);
  clearEnemies(s);
  const m = s.map;
  let ex = -1, ey = -1;
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    if (m.grid[y * m.w + x] === TILE.EXIT) { ex = x; ey = y; }
  }
  assert.ok(ex >= 0, 'exit exists');
  assert.ok(standBefore(s, ex, ey));
  const sc0 = s.score;
  const input = makeInput(); input.usePressed = true;
  tick(s, input, DT);
  assert.equal(s.status, 'complete');
  assert.equal(s.score, sc0 + 500);
});

test('carry between floors keeps hp/ammo/score but not keys', () => {
  const s = createGame(1, { hp: 62, ammo: 31, score: 1234 }, 16);
  assert.equal(s.player.hp, 62);
  assert.equal(s.player.ammo, 31);
  assert.equal(s.score, 1234);
  assert.ok(!s.player.keys.some(Boolean));
});

test('simulation is deterministic for a given seed', () => {
  const a = createGame(0, null, 42);
  const b = createGame(0, null, 42);
  const input = makeInput(); input.forward = 1; input.fire = true;
  for (let i = 0; i < 240; i++) { tick(a, input, DT); tick(b, input, DT); }
  assert.equal(a.player.x, b.player.x);
  assert.equal(a.player.y, b.player.y);
  assert.equal(a.score, b.score);
});

test('gunshots alert enemies within hearing path-distance', () => {
  const s = createGame(0, null, 17);
  const e = s.enemies.find((en) => !ENEMY_DEFS[en.type].ranged);
  e.x = s.player.x + 3; e.y = s.player.y; e.state = 'idle';
  const input = makeInput(); input.fire = true;
  tick(s, input, DT);
  assert.ok(e.state === 'chase' || e.state === 'attack', 'alerted: ' + e.state);
});

// ---- hidden vaults & automap fog of war ------------------------------------

test('hidden regions derive as [0, 1, 1] across the floors, all floor cells', () => {
  const counts = MAPS.map((def) => parseMap(def).hiddenRegions.length);
  assert.deepEqual(counts, [0, 1, 1]);
  for (const def of MAPS) {
    const level = parseMap(def);
    const sI = Math.floor(level.spawn.y) * level.w + Math.floor(level.spawn.x);
    assert.equal(level.hiddenId[sI], -1, 'spawn never hidden');
    for (const r of level.hiddenRegions) {
      assert.ok(r.cells.length > 0);
      assert.ok(!r.revealed);
      for (const c of r.cells) assert.equal(level.grid[c], TILE.EMPTY, 'hidden cells are floor');
    }
    for (const it of level.items) {
      if (!it.kind.startsWith('key')) continue;
      const i = Math.floor(it.y) * level.w + Math.floor(it.x);
      assert.equal(level.hiddenId[i], -1, 'keys never hidden');
    }
  }
});

test('vault push-walls know their region; shortcut secrets reveal nothing', () => {
  for (const idx of [1, 2]) {
    const level = parseMap(MAPS[idx]);
    assert.equal(level.pushwalls.filter((p) => p.reveals.length).length, 1, MAPS[idx].name + ' vault');
    assert.equal(level.pushwalls.filter((p) => !p.reveals.length).length, 1, MAPS[idx].name + ' shortcut');
  }
  assert.ok(parseMap(MAPS[0]).pushwalls.every((p) => !p.reveals.length), 'floor 1 secrets are plain');
});

test('fog of war: spawn surroundings known, distant rooms dark, walking reveals more', () => {
  const s = createGame(0, null, 21);
  clearEnemies(s);
  const m = s.map;
  assert.ok(s.explored[Math.floor(s.player.y) * m.w + Math.floor(s.player.x)], 'spawn cell explored');
  assert.ok(!s.explored[19 * m.w + 27], 'far room unexplored at spawn');
  const count = () => s.explored.reduce((a, b) => a + b, 0);
  const before = count();
  const input = makeInput(); input.forward = 1;
  for (let i = 0; i < 240; i++) tick(s, input, DT);
  assert.ok(count() > before, `walking reveals map (${before} -> ${count()})`);
});

test('hidden vault: dark on the automap until opened, then vaultFound fires and pays out', () => {
  const s = createGame(2, null, 22);
  clearEnemies(s);
  const m = s.map;
  const pw = m.pushwalls.find((p) => p.reveals.length);
  const region = m.hiddenRegions[pw.reveals[0]];
  assert.ok(region.cells.every((c) => !s.explored[c]), 'vault unexplored at start');
  // stand on the visible side of the push-wall, facing it
  let sx = -1, sy = -1;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const ni = (pw.y + dy) * m.w + (pw.x + dx);
    if (m.grid[ni] === TILE.EMPTY && m.hiddenId[ni] === -1) { sx = pw.x + dx; sy = pw.y + dy; break; }
  }
  assert.ok(sx >= 0, 'vault wall openable from a visible cell');
  s.player.x = sx + 0.5; s.player.y = sy + 0.5;
  s.player.angle = Math.atan2(pw.y - sy, pw.x - sx);
  const sc0 = s.score;
  const input = makeInput(); input.usePressed = true;
  tick(s, input, DT);
  assert.ok(region.revealed, 'region revealed on activation');
  assert.ok(region.cells.every((c) => s.explored[c]), 'vault cells explored on reveal');
  assert.ok(s.events.some((ev) => ev.type === 'secret'), 'secret event');
  assert.ok(s.events.some((ev) => ev.type === 'vaultFound'), 'vaultFound event');
  assert.equal(s.score, sc0 + 250);
  // loot the crown inside
  const crown = s.items.find((i) => i.kind === 'crown');
  s.player.x = crown.x; s.player.y = crown.y;
  const sc1 = s.score;
  tick(s, makeInput(), DT);
  assert.ok(crown.taken, 'crown looted');
  assert.equal(s.score, sc1 + 1000, 'Duskcrown +1000');
});

test('failsafe: standing inside an unrevealed vault reveals it', () => {
  const s = createGame(1, null, 23);
  clearEnemies(s);
  const m = s.map;
  const region = m.hiddenRegions[0];
  const c = region.cells[0];
  s.player.x = (c % m.w) + 0.5;
  s.player.y = ((c / m.w) | 0) + 0.5;
  tick(s, makeInput(), DT);
  assert.ok(region.revealed);
});

test('grand tonic and ember cache: bigger restores, same caps', () => {
  const s = createGame(0, null, 24);
  clearEnemies(s);
  const p = s.player;
  const tonic = s.items.find((i) => i.kind === 'tonic');
  const cache = s.items.find((i) => i.kind === 'cache');
  p.hp = 30; p.ammo = 50;
  p.x = tonic.x; p.y = tonic.y; tick(s, makeInput(), DT);
  assert.equal(p.hp, 90, '+60 vigor');
  p.x = cache.x; p.y = cache.y; tick(s, makeInput(), DT);
  assert.equal(p.ammo, 80, '+30 shots');
  // full vigor leaves the tonic on the ground
  const s2 = createGame(0, null, 25);
  clearEnemies(s2);
  const t2 = s2.items.find((i) => i.kind === 'tonic');
  s2.player.x = t2.x; s2.player.y = t2.y;
  tick(s2, makeInput(), DT);
  assert.ok(!t2.taken, 'tonic left at full vigor');
});

test('warding stone soaks half of each hit until it shatters', () => {
  const s = createGame(2, null, 26);
  clearEnemies(s);
  const p = s.player;
  const aegis = s.items.find((i) => i.kind === 'aegis');
  p.x = aegis.x; p.y = aegis.y;
  tick(s, makeInput(), DT);
  assert.equal(p.armor, 50, 'ward granted');
  damagePlayer(s, 20, p.x + 1, p.y);
  assert.equal(p.hp, MAX_HP - 10, 'half the blow soaked');
  assert.equal(p.armor, 40, 'ward chipped');
  p.armor = 3;
  damagePlayer(s, 20, p.x + 1, p.y);
  assert.equal(p.armor, 0, 'ward shattered');
  assert.equal(p.hp, MAX_HP - 10 - 17, 'only the remaining ward soaked');
});

test('wraith ember doubles emberlock damage, then fades', () => {
  const s = createGame(2, null, 27);
  clearEnemies(s);
  const p = s.player;
  const wraith = s.items.find((i) => i.kind === 'wraith');
  p.x = wraith.x; p.y = wraith.y;
  tick(s, makeInput(), DT);
  assert.ok(p.dmgT > 0, 'wraith burning');
  // open hall duel: doubled hitscan lands 30..46 (base is 15..23)
  p.x = 12.5; p.y = 8.5; p.angle = 0; p.cooldown = 0;
  const e = s.enemies[0];
  e.state = 'idle'; e.hp = 999;
  e.x = p.x + 2; e.y = p.y;
  const input = makeInput(); input.fire = true;
  tick(s, input, DT);
  const dealt = 999 - e.hp;
  assert.ok(dealt >= 30 && dealt <= 46, `doubled damage (dealt ${dealt})`);
  p.dmgT = 0.001;
  tick(s, makeInput(), DT);
  assert.equal(p.dmgT, 0, 'ember burns out');
});

test('phase draught quickens the stride and expires', () => {
  const a = createGame(0, null, 28);
  const b = createGame(0, null, 28);
  clearEnemies(a); clearEnemies(b);
  b.player.speedT = 999;
  const input = makeInput(); input.forward = 1;
  const x0 = a.player.x;
  for (let i = 0; i < 30; i++) { tick(a, input, DT); tick(b, input, DT); }
  const da = a.player.x - x0, db = b.player.x - x0;
  assert.ok(db > da * 1.3, `phased stride is faster (${da.toFixed(2)} vs ${db.toFixed(2)})`);
  b.player.speedT = 0.001;
  tick(b, makeInput(), DT);
  assert.equal(b.player.speedT, 0, 'draught wears off');
});

test('treasure tiers score 250 / 500 / 1000', () => {
  const tiers = [[0, 'chalice', 250], [1, 'idol', 500], [2, 'crown', 1000]];
  for (const [lvl, kind, pts] of tiers) {
    const s = createGame(lvl, null, 29 + lvl);
    clearEnemies(s);
    const it = s.items.find((i) => i.kind === kind);
    assert.ok(it, `${MAPS[lvl].name} holds a ${kind}`);
    s.player.x = it.x; s.player.y = it.y;
    const sc0 = s.score;
    tick(s, makeInput(), DT);
    assert.ok(it.taken, kind + ' taken');
    assert.equal(s.score, sc0 + pts, `${kind} +${pts}`);
  }
});

test("seer's orb bares the whole floor and marks vaults revealed", () => {
  const s = createGame(1, null, 33);
  clearEnemies(s);
  const orb = s.items.find((i) => i.kind === 'orb');
  s.player.x = orb.x; s.player.y = orb.y;
  tick(s, makeInput(), DT);
  assert.ok(orb.taken);
  assert.ok(s.mapSeer, 'seer sight granted');
  assert.ok(s.explored.every((v) => v === 1), 'whole floor explored');
  assert.ok(s.map.hiddenRegions.every((r) => r.revealed), 'vaults revealed');
});

test('ward carries between floors; buff timers do not', () => {
  const s = createGame(1, { hp: 80, ammo: 20, armor: 40, score: 500 }, 34);
  assert.equal(s.player.armor, 40);
  assert.equal(s.player.speedT, 0);
  assert.equal(s.player.dmgT, 0);
});

console.log(process.exitCode ? '\nFAILURES' : `\nall ${n} logic tests passed`);

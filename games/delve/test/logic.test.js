// Headless tests for the Delve core. Run with: node test/logic.test.js
// No DOM, no dependencies — loads the classic scripts (which attach to
// globalThis.Delve) and drives the core directly.
require('../src/core/rng.js');
require('../src/core/dungeon.js');
require('../src/core/fov.js');
require('../src/core/path.js');
require('../src/core/data.js');
require('../src/core/game.js');

const {
  RNG,
  T, MAP_W, MAP_H, idx, generateFloor, bfs,
  computeFOV, hasLOS,
  astar, greedyStep,
  DEPTH_MAX, monsterPool,
  Game, FOV_RADIUS,
} = globalThis.Delve;

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; console.error('  FAIL:', name); }
}
function section(name) { console.log(`\n== ${name}`); }

const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

// ---------------------------------------------------------------- dungeon gen

section('dungeon generation (100 seeds, all depth configs)');
{
  let allConnected = true, allFar = true, allStairs = true, allEntryOk = true;
  for (let seed = 1; seed <= 100; seed++) {
    const rng = new RNG(seed * 7919);
    for (const cfg of [{ hasUp: false, hasDown: true }, { hasUp: true, hasDown: true }, { hasUp: true, hasDown: false }]) {
      const f = generateFloor(rng, cfg);
      // full connectivity: every non-wall tile reachable from entry
      const dist = bfs(f.tiles, f.entry);
      for (let i = 0; i < f.tiles.length; i++) {
        if (f.tiles[i] !== T.WALL && dist[i] < 0) allConnected = false;
      }
      if (f.tiles[idx(f.entry.x, f.entry.y)] === T.WALL) allEntryOk = false;
      if (cfg.hasDown) {
        if (f.tiles[idx(f.down.x, f.down.y)] !== T.DOWN) allStairs = false;
        if (dist[idx(f.down.x, f.down.y)] < Math.floor((MAP_W + MAP_H) / 4)) allFar = false;
      }
      if (cfg.hasUp && f.tiles[idx(f.up.x, f.up.y)] !== T.UP) allStairs = false;
    }
  }
  ok(allConnected, 'every floor tile reachable from entry (flood fill)');
  ok(allStairs, 'stairs tiles placed correctly');
  ok(allFar, 'down stairs far from entry (walk distance >= 22)');
  ok(allEntryOk, 'entry is walkable');
}

// --------------------------------------------------------------------- FOV

section('recursive shadowcasting');
{
  // 21x21 open arena with a single pillar; origin at center
  const S = 21, c = 10;
  const opaqueAt = new Set();
  const isOpaque = (x, y) => x < 0 || y < 0 || x >= S || y >= S || opaqueAt.has(`${x},${y}`);
  opaqueAt.add('12,10'); // pillar two tiles east of origin

  const lit = new Set();
  computeFOV(c, c, 8, isOpaque, (x, y) => lit.add(`${x},${y}`));

  ok(lit.has('10,10'), 'origin visible');
  ok(lit.has('12,10'), 'the pillar itself is visible');
  ok(!lit.has('13,10'), 'tile directly behind pillar is shadowed');
  ok(!lit.has('14,10'), 'shadow extends behind the pillar');
  ok(lit.has('12,7'), 'tiles off the shadow line stay visible');
  ok(lit.has('10,2'), 'radius-8 tile visible in the open');
  ok(!lit.has('10,1'), 'radius limit respected');

  // a solid wall fully blocks the far side
  const wallLit = new Set();
  const wallOpaque = (x, y) => x < 0 || y < 0 || x >= S || y >= S || x === 13;
  computeFOV(c, c, 8, wallOpaque, (x, y) => wallLit.add(`${x},${y}`));
  let leaked = false;
  for (const k of wallLit) { if (Number(k.split(',')[0]) > 13) leaked = true; }
  ok(!leaked, 'nothing visible beyond a solid wall');

  ok(hasLOS(2, 2, 8, 2, (x) => x === 5) === false, 'LOS blocked by intervening wall');
  ok(hasLOS(2, 2, 8, 2, () => false) === true, 'LOS clear in the open');
}

// --------------------------------------------------------------------- A*

section('pathfinding');
{
  // corridor with a detour around a wall
  const W = 12, H = 7;
  const wall = (x, y) => x === 6 && y !== 5; // gap at y=5
  const passable = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !wall(x, y);
  const path = astar(1, 1, 10, 1, passable, W, H);
  ok(path !== null && path.length > 0, 'A* finds a path through the gap');
  ok(path[path.length - 1].x === 10 && path[path.length - 1].y === 1, 'path ends at the goal');
  let contiguous = true, prev = { x: 1, y: 1 };
  for (const s of path) {
    if (cheb(prev.x, prev.y, s.x, s.y) !== 1 || !passable(s.x, s.y)) contiguous = false;
    prev = s;
  }
  ok(contiguous, 'path steps are adjacent and walkable');
  ok(astar(1, 1, 10, 1, (x, y) => passable(x, y) && x !== 6, W, H) === null, 'A* returns null when sealed off');
  const g = greedyStep(1, 1, 10, 1, passable);
  ok(g && g.x === 2, 'greedy fallback steps toward the target');
}

// -------------------------------------------------------- arena test harness

/** Rebuild floor 1 as an open box (border walls), empty of monsters/items. */
function makeArena(g, wallColumn = -1) {
  const f = g.curFloor;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const border = x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1;
      f.tiles[idx(x, y)] = border || x === wallColumn ? T.WALL : T.FLOOR;
    }
  }
  f.monsters.length = 0;
  f.items.length = 0;
  g.player.x = 10; g.player.y = 15;
  g.refreshFOV();
  return f;
}

// ----------------------------------------------------------- energy scheduler

section('energy/speed scheduling');
{
  const g = new Game(42);
  // wall at x=30 splits the arena; player left, monsters right (no LOS, no path).
  // agi 0 pins the player at exactly speed 100 so monster ratios are exact.
  g.player.agi = 0;
  const f = makeArena(g, 30);
  const fast = g.spawnMonster('skitterlimb', 1, 45, 15);  // speed 150
  const slow = g.spawnMonster('stalkid', 2, 45, 10);      // speed 75
  const norm = g.spawnMonster('murkling', 1, 45, 20);     // speed 90 (retuned)
  const even = g.spawnMonster('barrowight', 5, 45, 25);   // speed 100
  fast.energy = 0; slow.energy = 0; norm.energy = 0; even.energy = 0;
  f.monsters.push(fast, slow, norm, even);
  const acts = new Map();
  g.onMonsterAct = (m) => acts.set(m.id, (acts.get(m.id) || 0) + 1);
  for (let i = 0; i < 100; i++) g.act({ type: 'wait' });
  ok(acts.get(fast.id) === 150, `speed-150 monster acted 150x per 100 player turns (got ${acts.get(fast.id)})`);
  ok(acts.get(slow.id) === 75, `speed-75 monster acted 75x per 100 player turns (got ${acts.get(slow.id)})`);
  ok(acts.get(norm.id) === 90, `speed-90 murkling acted 90x per 100 player turns (got ${acts.get(norm.id)})`);
  ok(acts.get(even.id) === 100, `speed-100 monster acted 100x per 100 player turns (got ${acts.get(even.id)})`);

  // haste: the agi-0 player runs at 150 and gets 3 actions per 2 ticks
  acts.clear();
  g.player.haste = 1000;
  for (let i = 0; i < 90; i++) g.act({ type: 'wait' });
  ok(acts.get(even.id) === 60, `hasted player: 90 player turns in 60 monster turns (got ${acts.get(even.id)})`);
}

section('agility: player speed scales with agi');
{
  const g = new Game(909);
  const f = makeArena(g, 30);
  ok(g.playerSpeed() === 105, `base agi 1 gives player speed 105 (got ${g.playerSpeed()})`);
  g.player.agi = 3;
  ok(g.playerSpeed() === 115, `agi 3 gives player speed 115 (got ${g.playerSpeed()})`);
  g.player.haste = 1;
  ok(g.playerSpeed() === 173, `hasted agi 3 rounds to 173 (got ${g.playerSpeed()})`);
  g.player.haste = 0;
  const wight = g.spawnMonster('barrowight', 5, 45, 10); // speed 100
  const murk = g.spawnMonster('murkling', 1, 45, 20);    // speed 90
  wight.energy = 0; murk.energy = 0;
  f.monsters.push(wight, murk);
  const acts = new Map();
  g.onMonsterAct = (m) => acts.set(m.id, (acts.get(m.id) || 0) + 1);
  for (let i = 0; i < 115; i++) g.act({ type: 'wait' });
  ok(acts.get(wight.id) === 100, `agi-3 player: 115 player turns to 100 speed-100 acts (got ${acts.get(wight.id)})`);
  ok(acts.get(murk.id) === 90, `agi-3 player: 115 player turns to 90 murkling acts (got ${acts.get(murk.id)})`);
}

// ------------------------------------------------------------------- combat/XP

section('bump combat, XP and level-ups');
{
  const g = new Game(1337);
  const f = makeArena(g);
  g.player.hp = 999; g.player.maxhp = 999;
  const m = g.spawnMonster('murkling', 1, 11, 15);
  f.monsters.push(m);
  let guard = 0;
  while (f.monsters.length && guard++ < 300) g.act({ type: 'move', dx: 1, dy: 0 });
  ok(f.monsters.length === 0, 'bump-attacking kills the adjacent monster');
  ok(g.kills === 1, 'kill counted');
  ok(g.player.xp > 0 || g.player.level > 1, 'XP awarded');

  const before = {
    level: g.player.level, maxhp: g.player.maxhp, pending: g.player.pendingStat,
    acc: g.player.acc, eva: g.player.eva, dmgBonus: g.player.dmgBonus,
  };
  g.player.xp = g.xpNext(g.player.level) - 1;
  g.gainXP(1);
  ok(g.player.level === before.level + 1, 'level-up triggers at threshold');
  ok(g.player.maxhp === before.maxhp + 5, 'level-up grants +5 max HP');
  ok(g.player.pendingStat === before.pending + 1, 'level-up banks a stat point to spend');
  ok(g.player.acc === before.acc && g.player.eva === before.eva && g.player.dmgBonus === before.dmgBonus,
    'no automatic acc/eva/dmg gains — the player chooses');
}

section('level-up stat choice: applyStat');
{
  const g = new Game(1111);
  const p = g.player;
  ok(g.applyStat('vigor') === false, 'applyStat refuses with no pending point');
  p.pendingStat = 5;
  ok(g.applyStat('bogus') === false && p.pendingStat === 5, 'unknown stat name rejected, point kept');
  let b = { maxhp: p.maxhp, hp: p.hp };
  ok(g.applyStat('vigor') && p.maxhp === b.maxhp + 6 && p.hp === b.hp + 6, 'vigor: +6 max HP and +6 HP');
  b = { dmg: p.dmgBonus };
  ok(g.applyStat('might') && p.dmgBonus === b.dmg + 1, 'might: +1 damage bonus');
  b = { agi: p.agi, speed: g.playerSpeed() };
  ok(g.applyStat('agility') && p.agi === b.agi + 1 && g.playerSpeed() === b.speed + 5,
    'agility: +1 agi and +5 player speed');
  b = { acc: p.acc };
  ok(g.applyStat('focus') && p.acc === b.acc + 1, 'focus: +1 accuracy');
  ok(p.pendingStat === 1, 'each pick spends exactly one point');
}

section('floor-scaled monster stats');
{
  const g = new Game(5);
  const shallow = g.spawnMonster('murkling', 1, 2, 2);
  const deep = g.spawnMonster('murkling', 4, 3, 3);
  ok(deep.maxhp > shallow.maxhp, 'deeper spawn has more HP');
  ok(deep.xp > shallow.xp, 'deeper spawn worth more XP');
}

// ------------------------------------------------------------------ monster AI

section('AI: craven flees below 25% HP');
{
  const g = new Game(777);
  const f = makeArena(g);
  g.player.hp = 999; g.player.maxhp = 999;
  const m = g.spawnMonster('craven', 2, 12, 15); // dist 2 from player at (10,15)
  m.hp = 2; // below ceil(25%) of maxhp 11
  m.state = 'hunt'; m.tx = g.player.x; m.ty = g.player.y;
  m.energy = 0;
  f.monsters.push(m);
  const d0 = cheb(m.x, m.y, g.player.x, g.player.y);
  g.act({ type: 'wait' });
  const d1 = cheb(m.x, m.y, g.player.x, g.player.y);
  ok(d1 > d0, `wounded craven whelp increases distance (${d0} -> ${d1})`);
}

section('AI: gallspitter keeps distance and attacks at range');
{
  const g = new Game(888);
  const f = makeArena(g);
  g.player.hp = 5000; g.player.maxhp = 5000;
  const m = g.spawnMonster('gallspitter', 3, 14, 15); // dist 4, clear LOS
  m.energy = 0;
  f.monsters.push(m);
  let everAdjacent = false;
  for (let i = 0; i < 15; i++) {
    g.act({ type: 'wait' });
    if (f.monsters.includes(m) && cheb(m.x, m.y, g.player.x, g.player.y) <= 1) everAdjacent = true;
  }
  ok(g.player.hp < 5000, 'player took ranged damage without contact');
  ok(!everAdjacent, 'gallspitter never closed to melee range');
}

section('AI: idle until seen or heard');
{
  const g = new Game(999);
  const f = makeArena(g, 30); // wall between player and monster
  const m = g.spawnMonster('murkling', 1, 45, 15);
  m.energy = 0;
  f.monsters.push(m);
  for (let i = 0; i < 10; i++) g.act({ type: 'wait' });
  ok(m.state === 'idle', 'monster behind a wall stays idle');
  g.makeNoise(44, 15, 8);
  ok(m.state === 'hunt' && m.tx === 44 && m.ty === 15, 'noise wakes it toward the noise source');
}

section('AI: sleep state and wake rules');
{
  // sleeping in plain sight: skips every turn, never notices the player
  const g = new Game(2024);
  const f = makeArena(g);
  g.player.hp = 999; g.player.maxhp = 999;
  const m = g.spawnMonster('murkling', 1, 18, 15); // dist 8, clear LOS
  m.state = 'sleep'; m.energy = 0;
  f.monsters.push(m);
  for (let i = 0; i < 10; i++) g.act({ type: 'wait' });
  ok(m.state === 'sleep' && m.x === 18 && m.y === 15,
    'sleeping monster in plain sight neither moves nor wakes');

  // noise wakes it toward the sound
  g.makeNoise(15, 15, 8);
  ok(m.state === 'hunt' && m.tx === 15 && m.ty === 15, 'noise wakes the sleeper toward the sound');

  // adjacency wakes it — and the wake costs its turn (no free attack)
  const m2 = g.spawnMonster('murkling', 1, 11, 15); // adjacent to player at (10,15)
  m2.state = 'sleep'; m2.energy = 99; m2.acc = 99;
  f.monsters.push(m2);
  const hpBefore = g.player.hp;
  g.act({ type: 'wait' });
  ok(m2.state === 'hunt' && m2.tx === g.player.x && m2.ty === g.player.y,
    'player standing adjacent wakes the sleeper');
  ok(g.player.hp === hpBefore, 'waking costs the monster its turn (no attack that tick)');

  // damage wakes: a direct attack alerts even without noise
  const m3 = g.spawnMonster('stalkid', 2, 11, 16);
  m3.state = 'sleep'; m3.hp = 50; m3.maxhp = 50;
  f.monsters.push(m3);
  g.attack(g.player, m3); // hit or miss, the target is alerted
  ok(m3.state === 'hunt', 'attacking a sleeper wakes it');
}

section('AI: hunt patience decays into search, then idle');
{
  const g = new Game(3030);
  const f = makeArena(g, 30); // wall column: the monster never has LOS to the player
  const m = g.spawnMonster('murkling', 1, 40, 15); // patience = sight 7 + 6 = 13
  m.state = 'hunt'; m.tx = 55; m.ty = 15; m.energy = 0; // phantom LKP 15 tiles off
  f.monsters.push(m);
  ok(m.patience === 13, `patience initialized to sight+6 (got ${m.patience})`);
  let sawSearch = false, guard = 0;
  while (m.state !== 'idle' && guard++ < 80) {
    g.act({ type: 'wait' });
    if (m.state === 'search') sawSearch = true;
  }
  ok(sawSearch, 'patience ran out: hunt decayed into a search around the LKP');
  ok(m.state === 'idle', 'search gives up into idle');

  // while the monster SEES the player, patience is pinned at full
  const g2 = new Game(3031);
  const f2 = makeArena(g2);
  g2.player.hp = 999; g2.player.maxhp = 999;
  const m2 = g2.spawnMonster('murkling', 1, 14, 15); // dist 4, clear LOS
  m2.energy = 0;
  f2.monsters.push(m2);
  for (let i = 0; i < 6; i++) g2.act({ type: 'wait' });
  ok(m2.state === 'hunt' && m2.patience === 13, 'line of sight refreshes patience every turn');
}

section('veil: monster sight capped at 2 while veiled');
{
  const g = new Game(505);
  const f = makeArena(g);
  g.player.veil = 30;
  const m = g.spawnMonster('murkling', 1, 18, 15); // dist 8, clear LOS, sight 7
  m.energy = 0;
  f.monsters.push(m);
  for (let i = 0; i < 3; i++) g.act({ type: 'wait' });
  ok(m.state === 'idle', 'veiled player at distance goes unnoticed');
  ok(g.player.veil === 27, 'veil ticks down each turn');
  // inside the cap the veil does not help
  m.x = 12; m.y = 15; m.state = 'idle'; m.energy = 99;
  g.refreshFOV();
  g.act({ type: 'wait' });
  ok(m.state === 'hunt', 'a veiled player within 2 tiles is still seen');
  // expiry announces itself
  g.player.veil = 1;
  g.act({ type: 'wait' });
  ok(g.player.veil === 0 && g.log.some((e) => e.t.includes('dimness lifts')),
    'veil expiry is reported');
}

section('pebble: thrown lure — flight, noise, hunter retarget');
{
  const g = new Game(808);
  const f = makeArena(g, 30);
  g.player.inventory = ['pebble', 'pebble'];
  const idle = g.spawnMonster('murkling', 1, 20, 18); // will hear the pebble land
  idle.energy = 0;
  const hunter = g.spawnMonster('stalkid', 2, 25, 10); // hunting, no LOS to player (dist 15 > sight)
  hunter.state = 'hunt'; hunter.tx = 25; hunter.ty = 25; hunter.energy = 0;
  f.monsters.push(idle, hunter);
  const took = g.act({ type: 'throw', dx: 1, dy: 0 }); // flies 7 east from (10,15) -> (17,15)
  ok(took === true, 'throwing a pebble consumes a turn');
  ok(g.player.inventory.length === 1, 'the thrown pebble is consumed');
  ok(idle.state === 'hunt' && idle.tx === 17 && idle.ty === 15,
    'idle monster investigates where the pebble landed');
  ok(hunter.tx === 17 && hunter.ty === 15,
    'a hunter that cannot see the player retargets to the pebble noise');

  // flight stops before the first wall
  g.player.x = 25; g.player.y = 15; g.refreshFOV();
  g.act({ type: 'throw', dx: 1, dy: 0 }); // wall at x=30: stops at (29,15), not (32,15)
  const ev = g.events.find((e) => e.type === 'throw');
  ok(ev && ev.tx === 29 && ev.ty === 15, `pebble stops before the wall (landed ${ev && ev.tx},${ev && ev.ty})`);
  ok(g.player.inventory.length === 0, 'second pebble consumed');
  ok(g.act({ type: 'throw', dx: 1, dy: 0 }) === false, 'throwing with no pebble costs no turn');
}

// ------------------------------------------------------------------ healing kit

section('out-of-combat regen: 1 HP / 6 turns, blocked by visible monsters');
{
  const g = new Game(606);
  makeArena(g); // empty: nothing in sight
  g.player.hp = 10;
  for (let i = 0; i < 12; i++) g.act({ type: 'wait' }); // turns 1..12: regen at 6 and 12
  ok(g.player.hp === 12, `+2 HP over 12 quiet turns (got ${g.player.hp - 10 + 10} -> ${g.player.hp})`);

  const g2 = new Game(607);
  const f2 = makeArena(g2);
  const watcher = g2.spawnMonster('murkling', 1, 14, 15); // visible…
  watcher.state = 'sleep'; watcher.energy = 0;            // …but harmless
  f2.monsters.push(watcher);
  g2.player.hp = 10;
  for (let i = 0; i < 12; i++) g2.act({ type: 'wait' });
  ok(g2.player.hp === 10, 'a monster in sight blocks regen entirely');

  const g3 = new Game(608);
  makeArena(g3);
  g3.player.trinket = 't_mosskeeper';
  ok(g3.regenInterval() === 3, 'mosskeeper charm halves the regen interval to 3');
  g3.player.hp = 10;
  for (let i = 0; i < 12; i++) g3.act({ type: 'wait' }); // regen at 3, 6, 9, 12
  ok(g3.player.hp === 14, `mosskeeper: +4 HP over 12 quiet turns (got ${g3.player.hp})`);
}

section('elderbark salve: +2/turn for 6 turns, spoiled by damage');
{
  const g = new Game(707);
  makeArena(g);
  g.player.hp = 10;
  g.player.inventory = ['salve'];
  g.act({ type: 'use', index: 0 });
  ok(g.player.salve === 5 && g.player.hp === 12, 'salve starts ticking on the turn it is applied');
  for (let i = 0; i < 5; i++) g.act({ type: 'wait' });
  ok(g.player.salve === 0 && g.player.hp >= 22, `full salve heals 12 total (hp ${g.player.hp})`);

  const g2 = new Game(708);
  const f2 = makeArena(g2);
  g2.player.hp = 10;
  g2.player.inventory = ['salve'];
  g2.act({ type: 'use', index: 0 });
  const m = g2.spawnMonster('murkling', 1, 11, 15);
  m.state = 'hunt'; m.tx = 10; m.ty = 15; m.energy = 99; m.acc = 99; // guaranteed hit
  f2.monsters.push(m);
  let guard = 0;
  while (g2.player.salve > 0 && guard++ < 10) g2.act({ type: 'wait' });
  ok(g2.player.salve === 0 && guard < 10, 'taking damage cancels the salve');
  ok(g2.log.some((e) => e.t.includes('salve is spoiled')), 'the spoiled salve is reported');
}

section('pearl-dew elixir and scroll of dimming');
{
  const g = new Game(909);
  makeArena(g);
  g.player.hp = 1;
  g.player.inventory = ['potion_elixir', 'scroll_veil'];
  g.act({ type: 'use', index: 0 });
  ok(g.player.hp === g.player.maxhp, 'elixir heals to full');
  g.act({ type: 'use', index: 0 });
  ok(g.player.veil === 11, 'veil scroll grants 12 turns (first ticks on the cast turn)');
}

// -------------------------------------------------------------------- trinkets

section('trinkets: slot, swap, and every effect');
{
  const g = new Game(1212);
  makeArena(g);
  const p = g.player;
  p.inventory = ['t_keeneye'];
  g.act({ type: 'use', index: 0 });
  ok(p.trinket === 't_keeneye' && p.inventory.length === 0, 'trinket equips into its own slot');
  ok(g.playerAcc() === p.acc + 1, 'keen-eye charm: +1 effective accuracy');

  p.inventory.push('t_stride');
  const evaBefore = g.playerEva();
  g.act({ type: 'use', index: 0 });
  ok(p.trinket === 't_stride' && p.inventory.includes('t_keeneye'), 'equipping swaps the old trinket back to the satchel');
  ok(g.playerAgi() === p.agi + 1, "strider's anklet: +1 effective agility");
  ok(g.playerSpeed() === 100 + 5 * (p.agi + 1), 'anklet agility feeds player speed');
  ok(g.playerEva() === p.eva + Math.floor((p.agi + 1) / 2) && g.playerEva() >= evaBefore,
    'evasion scales with floor(agi/2)');

  p.inventory = ['t_barrowhide'];
  g.act({ type: 'use', index: 0 });
  ok(g.armorOf(p) === (p.armor ? 1 : 0) + 1, 'barrow-hide wrap: +1 armor folded into armorOf');

  p.inventory = ['t_vigorstone'];
  const hpB = { hp: p.hp, maxhp: p.maxhp };
  g.act({ type: 'use', index: 0 });
  ok(p.maxhp === hpB.maxhp + 10 && p.hp === hpB.hp + 10, 'vigorstone: +10 max HP and +10 HP on equip');
  p.hp = p.maxhp; // full — so the unequip clamp is observable
  p.inventory = ['t_keeneye'];
  g.act({ type: 'use', index: 0 });
  ok(p.maxhp === hpB.maxhp && p.hp === p.maxhp, 'unequipping the vigorstone removes its HP and clamps');
}

// ---------------------------------------------------- spawn budget & sleepers

section('spawn budget and sleep fraction (100 seeds)');
{
  let total = 0, sleepers = 0, countOk = true;
  for (let seed = 1; seed <= 100; seed++) {
    const g = new Game(seed * 31 + 7);
    const ms = g.floors[1].monsters;
    if (ms.length < 4 || ms.length > 5) countOk = false;
    total += ms.length;
    sleepers += ms.filter((m) => m.state === 'sleep').length;
  }
  ok(countOk, 'floor-1 budget is 4-5 monsters on every seed (3 + depth + rng.int(2))');
  const frac = sleepers / total;
  ok(frac > 0.3 && frac < 0.5, `~40% of spawns start asleep (got ${(frac * 100).toFixed(1)}%)`);

  // the two artifact wardens are never asleep
  let wardensAwake = true, wardensSeen = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const g = new Game(seed * 101 + 3);
    const f9 = g.makeFloor(9);
    const tail = f9.monsters.slice(-2).filter((m) => m.type === 'oldskyhorror' &&
      Math.max(Math.abs(m.x - f9.farPoint.x), Math.abs(m.y - f9.farPoint.y)) <= 5);
    wardensSeen += tail.length;
    if (tail.some((m) => m.state === 'sleep')) wardensAwake = false;
  }
  ok(wardensSeen === 40 && wardensAwake, `both artifact wardens spawn awake on every seed (${wardensSeen}/40)`);
}

// --------------------------------------------------------------- three FOV states

section('map memory: unseen / remembered / visible');
{
  const g = new Game(31415);
  const f = g.curFloor;
  // walk a few random-but-legal steps to build up memory
  for (let i = 0; i < 40; i++) {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const d = dirs[i % 4];
    g.act({ type: 'move', dx: d[0], dy: d[1] });
  }
  let unseen = 0, remembered = 0, visible = 0;
  for (let i = 0; i < f.tiles.length; i++) {
    if (f.visible[i]) visible++;
    else if (f.seen[i]) remembered++;
    else unseen++;
  }
  ok(visible > 0, 'some tiles visible');
  ok(remembered > 0, 'some tiles remembered but not visible');
  ok(unseen > 0, 'some tiles still unseen');
  // everything visible is within FOV radius
  let inRadius = true;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (f.visible[idx(x, y)] && Math.hypot(x - g.player.x, y - g.player.y) > FOV_RADIUS + 0.01) inRadius = false;
    }
  }
  ok(inRadius, 'visible set bounded by FOV radius');
}

// ------------------------------------------------------------------- save/load

section('serialization: exact resume');
{
  const g1 = new Game(2718);
  // scripted mixed actions
  const seq = [
    { type: 'move', dx: 1, dy: 0 }, { type: 'move', dx: 0, dy: 1 }, { type: 'wait' },
    { type: 'move', dx: -1, dy: 0 }, { type: 'move', dx: 1, dy: 1 }, { type: 'wait' },
    { type: 'use', index: 0 }, // quaff the starting potion (full hp -> heals 0, still a turn)
  ];
  for (const a of seq) g1.act(a);
  const s1 = g1.serialize();
  const g2 = Game.fromJSON(s1);
  ok(g2 !== null, 'save deserializes');
  ok(g2.serialize() === s1, 'serialize -> load -> serialize is identical');

  // identical futures: same RNG state means the same dice from here on
  for (let i = 0; i < 25; i++) {
    const a = { type: 'wait' };
    g1.act(a); g2.act(a);
  }
  ok(g1.serialize() === g2.serialize(), 'resumed game plays out identically');
}

section('serialization: v2 fields round-trip, v1 rejected, gaps defaulted');
{
  const g1 = new Game(5150);
  const f = makeArena(g1);
  const sleeper = g1.spawnMonster('murkling', 1, 40, 15);
  sleeper.state = 'sleep';
  const searcher = g1.spawnMonster('stalkid', 2, 45, 20);
  searcher.state = 'search'; searcher.searchTurns = 3; searcher.patience = 0;
  f.monsters.push(sleeper, searcher);
  const p1 = g1.player;
  p1.agi = 2; p1.veil = 4; p1.salve = 3; p1.pendingStat = 2; p1.trinket = 't_stride';
  const s = g1.serialize();
  const g2 = Game.fromJSON(s);
  ok(g2 !== null && g2.serialize() === s, 'v2 save with every new field round-trips byte-identically');
  const p2 = g2.player;
  ok(p2.agi === 2 && p2.veil === 4 && p2.salve === 3 && p2.pendingStat === 2 && p2.trinket === 't_stride',
    'agi/veil/salve/pendingStat/trinket survive the round-trip');
  const ms2 = g2.floors[1].monsters;
  ok(ms2.some((m) => m.state === 'sleep') &&
     ms2.some((m) => m.state === 'search' && m.searchTurns === 3 && m.patience === 0),
    'monster sleep/search/patience state survives the round-trip');

  const v1 = JSON.parse(s);
  v1.v = 1;
  ok(Game.fromJSON(JSON.stringify(v1)) === null, 'v1 saves are rejected (SAVE_VERSION bumped to 2)');

  const doc = JSON.parse(s);
  delete doc.player.agi; delete doc.player.veil; delete doc.player.salve;
  delete doc.player.pendingStat; delete doc.player.trinket;
  for (const fl of Object.values(doc.floors)) {
    for (const m of fl.monsters) { delete m.patience; delete m.searchTurns; }
  }
  const g3 = Game.fromJSON(JSON.stringify(doc));
  ok(g3 !== null &&
     g3.player.agi === 1 && g3.player.veil === 0 && g3.player.salve === 0 &&
     g3.player.pendingStat === 0 && g3.player.trinket === null,
    'missing player fields are defaulted defensively');
  ok(g3.floors[1].monsters.every((m) => typeof m.patience === 'number' && m.searchTurns === 0),
    'missing monster patience/searchTurns are defaulted');
}

// ------------------------------------------------- persistent levels on revisit

section('persistent floors on ascend/descend');
{
  const g = new Game(1618);
  g.player.hp = 99999; g.player.maxhp = 99999; g.player.dmgBonus = 80;
  botToTile(g, () => g.curFloor.down, { type: 'descend' });
  ok(g.depth === 2, 'reached floor 2');
  const f1 = g.floors[1];
  const seenCount = f1.seen.reduce((a, b) => a + b, 0);
  const monsterIds = f1.monsters.map((m) => m.id).join(',');
  const itemSig = f1.items.map((it) => `${it.id}@${it.x},${it.y}`).join('|');
  // go back up
  const took = g.act({ type: 'ascend' });
  ok(took && g.depth === 1, 'ascended back to floor 1');
  ok(g.floors[1] === f1, 'floor object persists');
  ok(f1.seen.reduce((a, b) => a + b, 0) >= seenCount, 'map memory kept on revisit');
  ok(f1.monsters.map((m) => m.id).join(',') === monsterIds, 'monster state kept on revisit');
  ok(f1.items.map((it) => `${it.id}@${it.x},${it.y}`).join('|') === itemSig, 'items kept on revisit');
  ok(g.player.x === f1.down.x && g.player.y === f1.down.y, 'arrived on the down stairs');
}

// ------------------------------------------------------------- full run to the win

/** Walk the player to a target tile (bump-killing anything in the way), then act. */
const BOT_STATS = ['vigor', 'might', 'agility', 'focus'];
let botStatIdx = 0;
function botToTile(g, getTarget, finalAction) {
  let guard = 0;
  while (!g.over && guard++ < 6000) {
    // level-ups now bank a choice: the bot picks round-robin
    while (g.player.pendingStat > 0) g.applyStat(BOT_STATS[botStatIdx++ % BOT_STATS.length]);
    g.player.hp = g.player.maxhp;
    const t = getTarget();
    if (!t) return false;
    if (g.player.x === t.x && g.player.y === t.y) {
      return g.act(finalAction);
    }
    const passable = (x, y) => g.walkable(x, y);
    const path = astar(g.player.x, g.player.y, t.x, t.y, passable, MAP_W, MAP_H, 20000);
    if (!path || !path.length) return false;
    const n = path[0];
    g.act({ type: 'move', dx: n.x - g.player.x, dy: n.y - g.player.y });
  }
  return false;
}

section('full playthrough: descend 9 floors, take the artifact, win');
{
  const g = new Game(123456);
  g.player.hp = 99999; g.player.maxhp = 99999; g.player.dmgBonus = 80; // god-mode bot
  let sawDescendEvent = false;
  let artifactOnDeepest = false;
  let guard = 0;
  while (!g.won && guard++ < 40) {
    if (g.depth < DEPTH_MAX) {
      const okd = botToTile(g, () => g.curFloor.down, { type: 'descend' });
      if (okd && g.events.some((e) => e.type === 'descend')) sawDescendEvent = true;
      if (!okd) break;
    } else {
      const art = g.curFloor.items.find((it) => it.id === 'artifact');
      artifactOnDeepest = !!art;
      if (!art) break;
      botToTile(g, () => art, { type: 'pickup' });
      break;
    }
  }
  ok(sawDescendEvent, 'descend event emitted (drives save-on-descend)');
  ok(artifactOnDeepest, 'the artifact spawns on the deepest floor');
  ok(g.won && g.over, 'picking up the artifact wins the run');
  ok(g.deepest === DEPTH_MAX, 'deepest floor recorded');
  ok(g.player.level > 1 && g.player.pendingStat === 0, 'the bot spent every banked stat point on the way down');
  // budgets scale with depth
  ok(Object.keys(g.floors).length === DEPTH_MAX, 'all floors generated and retained');
  const items9 = 3 + Math.floor(9 / 2); // minimum budget at depth 9
  ok(g.floors[9].items.length + 1 >= items9, 'deep floors meet their item budget'); // +1: artifact was taken
}

section('death is fatal and reported');
{
  const g = new Game(4242);
  const f = makeArena(g);
  g.player.hp = 1; g.player.maxhp = 1;
  const m = g.spawnMonster('oldskyhorror', 9, 11, 15);
  m.state = 'hunt'; m.tx = g.player.x; m.ty = g.player.y; m.energy = 0; m.acc = 99;
  f.monsters.push(m);
  let guard = 0;
  while (!g.over && guard++ < 50) g.act({ type: 'wait' });
  ok(g.over && !g.won, 'player dies');
  ok(g.cause === 'old-sky horror', 'cause of death recorded');
  ok(g.act({ type: 'wait' }) === false, 'no actions after death');
}

section('monster pools respect depth gates');
{
  ok(!monsterPool(1).includes('oldskyhorror'), 'no horrors on floor 1');
  ok(monsterPool(9).includes('oldskyhorror'), 'horrors present on floor 9');
  for (let d = 1; d <= DEPTH_MAX; d++) ok(monsterPool(d).length >= 2, `depth ${d} has a pool`);
}

// ----------------------------------------------------------------------- done

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// Headless tests for the Delve core. Run with: node test/test.js
// No DOM, no dependencies — drives src/core/* directly.
import { RNG } from '../src/core/rng.js';
import { T, MAP_W, MAP_H, idx, generateFloor, bfs } from '../src/core/dungeon.js';
import { computeFOV, hasLOS } from '../src/core/fov.js';
import { astar, greedyStep } from '../src/core/path.js';
import { DEPTH_MAX, monsterPool } from '../src/core/data.js';
import { Game, FOV_RADIUS } from '../src/core/game.js';

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
  // wall at x=30 splits the arena; player left, monsters right (no LOS, no path)
  const f = makeArena(g, 30);
  const fast = g.spawnMonster('skitterlimb', 1, 45, 15); // speed 150
  const slow = g.spawnMonster('stalkid', 2, 45, 10);     // speed 75
  const norm = g.spawnMonster('murkling', 1, 45, 20);    // speed 100
  fast.energy = 0; slow.energy = 0; norm.energy = 0;
  f.monsters.push(fast, slow, norm);
  const acts = new Map();
  g.onMonsterAct = (m) => acts.set(m.id, (acts.get(m.id) || 0) + 1);
  for (let i = 0; i < 100; i++) g.act({ type: 'wait' });
  ok(acts.get(fast.id) === 150, `speed-150 monster acted 150x per 100 player turns (got ${acts.get(fast.id)})`);
  ok(acts.get(slow.id) === 75, `speed-75 monster acted 75x per 100 player turns (got ${acts.get(slow.id)})`);
  ok(acts.get(norm.id) === 100, `speed-100 monster acted 100x per 100 player turns (got ${acts.get(norm.id)})`);

  // haste: the player runs at 150 and gets 3 actions per 2 ticks
  acts.clear();
  g.player.haste = 1000;
  for (let i = 0; i < 90; i++) g.act({ type: 'wait' });
  ok(acts.get(norm.id) === 60, `hasted player: 90 player turns in 60 monster turns (got ${acts.get(norm.id)})`);
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

  const before = { level: g.player.level, maxhp: g.player.maxhp };
  g.player.xp = g.xpNext(g.player.level) - 1;
  g.gainXP(1);
  ok(g.player.level === before.level + 1, 'level-up triggers at threshold');
  ok(g.player.maxhp === before.maxhp + 5, 'level-up grants +5 max HP');
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
function botToTile(g, getTarget, finalAction) {
  let guard = 0;
  while (!g.over && guard++ < 6000) {
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

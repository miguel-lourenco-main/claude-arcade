// The whole roguelike, DOM-free: floors, FOV, the energy scheduler, monster
// AI, combat, items, XP, permadeath serialization. Drive it with
// game.act({type: ...}) and read state + game.events back out.
import { RNG } from './rng.js';
import { T, MAP_W, MAP_H, idx, inBounds, generateFloor } from './dungeon.js';
import { computeFOV, hasLOS } from './fov.js';
import { astar, greedyStep } from './path.js';
import { MONSTERS, ITEMS, DEPTH_MAX, DEPTH_FLAVOR, monsterPool, itemPool, pickWeighted } from './data.js';

export const FOV_RADIUS = 8;
export const INV_MAX = 10;
export const SAVE_VERSION = 1;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export class Game {
  constructor(seed = ((Date.now() & 0xfffff) * 2654435761 ^ (Math.random() * 0xffffffff)) >>> 0) {
    this.seed = seed >>> 0;
    this.rng = new RNG(this.seed);
    this.depth = 1;
    this.deepest = 1;
    this.turn = 0;
    this.kills = 0;
    this.itemsFound = 0;
    this.itemsUsed = 0;
    this.nextId = 1;
    this.floors = {};
    this.log = [];
    this.events = [];
    this.over = false;
    this.won = false;
    this.cause = null;
    this.player = {
      x: 0, y: 0, hp: 24, maxhp: 24,
      level: 1, xp: 0,
      acc: 3, eva: 2, dmgBonus: 0,
      energy: 100, haste: 0,
      inventory: ['potion_heal'],
      weapon: 'w_pick', armor: null,
    };
    this.makeFloor(1);
    const f = this.floors[1];
    this.player.x = f.entry.x;
    this.player.y = f.entry.y;
    this.msg('You slip down through the cave-mouth. It seals behind you.', 'note');
    this.msg(`Somewhere on floor ${DEPTH_MAX} sleeps the First Pearl.`, 'magic');
    this.refreshFOV();
  }

  get curFloor() { return this.floors[this.depth]; }

  // ---- messages & helpers -------------------------------------------------

  // The in-memory log is unbounded (a run's worth of short strings is tiny);
  // serialize() persists only the tail and the DOM layer trims what it shows.
  msg(t, c = 'note') {
    this.log.push({ t, c });
  }

  tileAt(x, y) { return this.curFloor.tiles[idx(x, y)]; }
  walkable(x, y) { return inBounds(x, y) && this.curFloor.tiles[idx(x, y)] !== T.WALL; }
  isVisible(x, y) { return inBounds(x, y) && this.curFloor.visible[idx(x, y)] === 1; }
  inBounds(x, y) { return inBounds(x, y); }

  monsterAt(x, y) { return this.monsterAtF(this.curFloor, x, y); }
  monsterAtF(f, x, y) { return f.monsters.find((m) => m.x === x && m.y === y) || null; }

  opaqueFn(f) {
    return (x, y) => !inBounds(x, y) || f.tiles[idx(x, y)] === T.WALL;
  }

  // ---- floor creation & population ---------------------------------------

  makeFloor(depth) {
    const f = generateFloor(this.rng, { hasUp: depth > 1, hasDown: depth < DEPTH_MAX });
    f.seen = new Uint8Array(MAP_W * MAP_H);
    f.visible = new Uint8Array(MAP_W * MAP_H);
    f.monsters = [];
    f.items = [];
    this.floors[depth] = f;
    this.populate(f, depth);
    return f;
  }

  populate(f, depth) {
    // budgets scale with depth
    const nMon = 4 + depth + this.rng.int(3);
    const pool = monsterPool(depth);
    for (let i = 0; i < nMon; i++) {
      const type = this.rng.pick(pool);
      const spot = this.freeSpot(f, (x, y) => cheb(x, y, f.entry.x, f.entry.y) > 9);
      if (!spot) break;
      f.monsters.push(this.spawnMonster(type, depth, spot.x, spot.y));
    }
    const nItem = 3 + Math.floor(depth / 2) + this.rng.int(2);
    const table = itemPool(depth);
    for (let i = 0; i < nItem; i++) {
      const spot = this.freeSpot(f);
      if (!spot) break;
      f.items.push({ x: spot.x, y: spot.y, id: pickWeighted(this.rng, table) });
    }
    if (depth === DEPTH_MAX) {
      // the artifact rests at the farthest point, with wardens close by
      f.items.push({ x: f.farPoint.x, y: f.farPoint.y, id: 'artifact' });
      for (let i = 0; i < 2; i++) {
        const spot = this.freeSpot(f, (x, y) => {
          const d = cheb(x, y, f.farPoint.x, f.farPoint.y);
          return d >= 2 && d <= 5;
        });
        if (spot) f.monsters.push(this.spawnMonster('oldskyhorror', depth, spot.x, spot.y));
      }
    }
  }

  spawnMonster(type, depth, x, y) {
    const d = MONSTERS[type];
    const sc = Math.max(0, depth - d.depths[0]); // floor-scaled stats
    return {
      id: this.nextId++,
      type, x, y,
      maxhp: d.hp + 2 * sc, hp: d.hp + 2 * sc,
      dmg: [d.dmg[0], d.dmg[1] + (sc >> 1)],
      acc: d.acc + (sc >> 1), eva: d.eva,
      speed: d.speed, xp: d.xp + 2 * sc,
      energy: this.rng.int(100),
      state: 'idle', tx: -1, ty: -1, fleeing: false,
    };
  }

  freeSpot(f, pred = null, tries = 400) {
    for (let i = 0; i < tries; i++) {
      const x = this.rng.range(1, MAP_W - 2);
      const y = this.rng.range(1, MAP_H - 2);
      if (f.tiles[idx(x, y)] !== T.FLOOR) continue; // plain floor only, never stairs
      if (this.monsterAtF(f, x, y)) continue;
      if (pred && !pred(x, y)) continue;
      return { x, y };
    }
    return null;
  }

  // ---- FOV ----------------------------------------------------------------

  refreshFOV() {
    const f = this.curFloor;
    f.visible.fill(0);
    computeFOV(this.player.x, this.player.y, FOV_RADIUS, this.opaqueFn(f), (x, y) => {
      if (!inBounds(x, y)) return;
      const i = idx(x, y);
      f.visible[i] = 1;
      f.seen[i] = 1; // map memory persists per floor
    });
  }

  // ---- the player's turn ---------------------------------------------------

  /** Apply a player action. Returns true if it consumed a turn. */
  act(action) {
    if (this.over) return false;
    this.events.length = 0;
    const took = this.applyAction(action);
    this.refreshFOV();
    if (!took) return false;
    const p = this.player;
    p.energy -= 100;
    if (p.haste > 0) p.haste--;
    this.turn++;
    this.runScheduler();
    this.refreshFOV();
    return true;
  }

  applyAction(a) {
    switch (a.type) {
      case 'wait': return true;
      case 'move': return this.tryMove(a.dx, a.dy);
      case 'pickup': return this.pickup();
      case 'descend': return this.descend();
      case 'ascend': return this.ascend();
      case 'use': return this.useItem(a.index);
      case 'drop': return this.dropItem(a.index);
      default: return false;
    }
  }

  tryMove(dx, dy) {
    if (!dx && !dy) return false;
    const p = this.player;
    const nx = p.x + clamp(dx, -1, 1);
    const ny = p.y + clamp(dy, -1, 1);
    if (!inBounds(nx, ny)) return false;
    const m = this.monsterAt(nx, ny);
    if (m) { // bump to attack
      this.attack(p, m);
      this.makeNoise(p.x, p.y, 8);
      return true;
    }
    if (!this.walkable(nx, ny)) return false;
    p.x = nx; p.y = ny;
    for (const it of this.curFloor.items) {
      if (it.x === nx && it.y === ny) {
        const d = ITEMS[it.id];
        const name = d.art ? `${d.art} ${d.name}` : d.name;
        this.msg(`You see ${name} here. (g to take)`, 'note');
      }
    }
    const t = this.tileAt(nx, ny);
    if (t === T.DOWN) this.msg('A stair winds down into the dark. (> to descend)', 'note');
    if (t === T.UP) this.msg('A stair climbs back up. (< to ascend)', 'note');
    return true;
  }

  pickup() {
    const p = this.player;
    const f = this.curFloor;
    const i = f.items.findIndex((it) => it.x === p.x && it.y === p.y);
    if (i < 0) { this.msg('There is nothing here to take.', 'note'); return false; }
    const it = f.items[i];
    if (it.id === 'artifact') {
      f.items.splice(i, 1);
      this.itemsFound++;
      this.win();
      return true;
    }
    if (p.inventory.length >= INV_MAX) { this.msg('Your satchel is full.', 'note'); return false; }
    f.items.splice(i, 1);
    p.inventory.push(it.id);
    this.itemsFound++;
    this.msg(`You take the ${ITEMS[it.id].name}.`, 'good');
    this.events.push({ type: 'pickup' });
    return true;
  }

  descend() {
    const p = this.player;
    if (this.tileAt(p.x, p.y) !== T.DOWN) { this.msg('There is no way down here.', 'note'); return false; }
    this.depth++;
    const isNew = !this.floors[this.depth];
    if (isNew) this.makeFloor(this.depth);
    const f = this.curFloor;
    this.shooMonster(f, f.entry.x, f.entry.y);
    p.x = f.entry.x; p.y = f.entry.y;
    this.deepest = Math.max(this.deepest, this.depth);
    this.msg(`You descend to floor ${this.depth}.`, 'big');
    if (isNew && DEPTH_FLAVOR[this.depth]) this.msg(DEPTH_FLAVOR[this.depth], 'magic');
    this.events.push({ type: 'descend', depth: this.depth });
    return true;
  }

  ascend() {
    const p = this.player;
    if (this.tileAt(p.x, p.y) !== T.UP) { this.msg('There is no way up here.', 'note'); return false; }
    this.depth--;
    const f = this.curFloor; // persistent: exactly as it was left
    this.shooMonster(f, f.down.x, f.down.y);
    p.x = f.down.x; p.y = f.down.y;
    this.msg(`You climb back up to floor ${this.depth}.`, 'big');
    this.events.push({ type: 'ascend', depth: this.depth });
    return true;
  }

  /** If a monster sits on an arrival tile, push it to a nearby free tile. */
  shooMonster(f, x, y) {
    const m = this.monsterAtF(f, x, y);
    if (!m) return;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (inBounds(nx, ny) && f.tiles[idx(nx, ny)] !== T.WALL && !this.monsterAtF(f, nx, ny)) {
        m.x = nx; m.y = ny;
        return;
      }
    }
    f.monsters.splice(f.monsters.indexOf(m), 1); // truly boxed in: it scurries away
  }

  useItem(i) {
    const p = this.player;
    const id = p.inventory[i];
    if (!id) return false;
    const d = ITEMS[id];
    if (d.kind === 'potion') {
      p.inventory.splice(i, 1);
      this.itemsUsed++;
      if (d.effect === 'heal') {
        const n = this.rng.range(d.power[0], d.power[1]);
        const healed = Math.min(p.maxhp, p.hp + n) - p.hp;
        p.hp += healed;
        this.msg(`You drink the ${d.name}. It mends ${healed} HP.`, 'good');
      } else if (d.effect === 'haste') {
        p.haste += this.rng.range(d.power[0], d.power[1]);
        this.msg('You drink the philtre. The world slows around you.', 'magic');
      }
      this.events.push({ type: 'potion' });
      return true;
    }
    if (d.kind === 'scroll') {
      p.inventory.splice(i, 1);
      this.itemsUsed++;
      if (d.effect === 'teleport') {
        const spot = this.freeSpot(this.curFloor);
        if (spot) { p.x = spot.x; p.y = spot.y; }
        this.msg('The world folds. You are somewhere else.', 'magic');
        this.events.push({ type: 'teleport' });
      } else if (d.effect === 'map') {
        this.revealMap();
        this.msg('Lines of the delving etch themselves into your mind.', 'magic');
        this.events.push({ type: 'scroll' });
      }
      return true;
    }
    if (d.kind === 'weapon') {
      const old = p.weapon;
      p.weapon = id;
      p.inventory.splice(i, 1);
      if (old) p.inventory.push(old);
      this.msg(`You wield the ${d.name}.`, 'good');
      this.events.push({ type: 'equip' });
      return true;
    }
    if (d.kind === 'armor') {
      const old = p.armor;
      p.armor = id;
      p.inventory.splice(i, 1);
      if (old) p.inventory.push(old);
      this.msg(`You strap on the ${d.name}.`, 'good');
      this.events.push({ type: 'equip' });
      return true;
    }
    return false;
  }

  dropItem(i) {
    const p = this.player;
    const id = p.inventory[i];
    if (!id) return false;
    p.inventory.splice(i, 1);
    this.curFloor.items.push({ x: p.x, y: p.y, id });
    this.msg(`You set down the ${ITEMS[id].name}.`, 'note');
    return true;
  }

  revealMap() {
    const f = this.curFloor;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (f.tiles[idx(x, y)] === T.WALL) continue;
        f.seen[idx(x, y)] = 1;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (inBounds(x + dx, y + dy)) f.seen[idx(x + dx, y + dy)] = 1;
          }
        }
      }
    }
  }

  // ---- energy scheduler ----------------------------------------------------
  // Every tick each actor gains its speed in energy; anyone at or above 100
  // spends 100 and acts. The player at speed 100 acts once per tick; a
  // skitterlimb at 150 gets three actions to the player's two; a stalkid at
  // 75 gets three to the player's four. Hasted players run at 150.

  runScheduler() {
    const p = this.player;
    let guard = 0;
    while (!this.over && guard++ < 500) {
      if (p.energy >= 100) return; // player's turn: wait for input
      p.energy += p.haste > 0 ? 150 : 100;
      const roster = this.curFloor.monsters.slice();
      for (const m of roster) {
        if (m.hp <= 0) continue;
        m.energy += m.speed;
        while (m.energy >= 100 && !this.over && m.hp > 0) {
          m.energy -= 100;
          this.monsterAct(m);
        }
      }
    }
  }

  // ---- monster AI -----------------------------------------------------------

  monsterAct(m) {
    if (this.onMonsterAct) this.onMonsterAct(m); // test hook
    const p = this.player;
    const f = this.curFloor;
    const d = MONSTERS[m.type];
    const dist = cheb(m.x, m.y, p.x, p.y);
    const opaque = this.opaqueFn(f);
    const sees = dist <= d.sight && hasLOS(m.x, m.y, p.x, p.y, opaque);

    if (sees) {
      if (m.state === 'idle' && this.isVisible(m.x, m.y)) {
        this.msg(`The ${d.name} notices you.`, 'note');
      }
      m.state = 'hunt';
      m.tx = p.x; m.ty = p.y; // last known position
    }

    if (m.state === 'idle') {
      // wander lazily until the player is seen or heard
      if (this.rng.chance(0.35)) {
        const dx = this.rng.int(3) - 1, dy = this.rng.int(3) - 1;
        this.stepMonster(m, m.x + dx, m.y + dy);
      }
      return;
    }

    // craven: flee below ~25% HP
    if (d.ai === 'craven' && m.hp <= Math.ceil(m.maxhp * 0.25)) {
      if (!m.fleeing && this.isVisible(m.x, m.y)) this.msg(`The ${d.name} turns tail!`, 'note');
      m.fleeing = true;
      if (this.fleeStep(m)) return;
      if (dist === 1) this.attack(m, p); // cornered
      return;
    }

    // ranged: keep distance and spit
    if (d.ai === 'ranged' && sees && dist <= d.range) {
      if (dist <= 2 && this.rng.chance(0.65) && this.fleeStep(m)) return;
      if (dist === 1) { this.attack(m, p); return; }
      this.rangedAttack(m);
      return;
    }

    if (dist === 1) { this.attack(m, p); return; }

    // chase toward last known position: A* with a greedy fallback
    const passable = (x, y) =>
      this.walkable(x, y) &&
      ((x === m.tx && y === m.ty) || (!this.monsterAt(x, y) && !(x === p.x && y === p.y)));
    const path = astar(m.x, m.y, m.tx, m.ty, passable, MAP_W, MAP_H, 1500);
    if (path && path.length) {
      this.stepMonster(m, path[0].x, path[0].y);
    } else {
      const s = greedyStep(m.x, m.y, m.tx, m.ty, passable);
      if (s) this.stepMonster(m, s.x, s.y);
    }
    if (m.x === m.tx && m.y === m.ty && !sees) {
      m.state = 'idle'; // reached the last known spot and found nothing
    }
  }

  stepMonster(m, nx, ny) {
    if (!this.walkable(nx, ny)) return false;
    if (this.monsterAt(nx, ny)) return false;
    if (nx === this.player.x && ny === this.player.y) return false;
    m.x = nx; m.y = ny;
    return true;
  }

  fleeStep(m) {
    const p = this.player;
    const cur = cheb(m.x, m.y, p.x, p.y);
    let best = null, bestD = cur;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = m.x + dx, ny = m.y + dy;
      if (!this.walkable(nx, ny) || this.monsterAt(nx, ny)) continue;
      if (nx === p.x && ny === p.y) continue;
      const d2 = cheb(nx, ny, p.x, p.y);
      if (d2 > bestD) { bestD = d2; best = { x: nx, y: ny }; }
    }
    if (!best) return false;
    m.x = best.x; m.y = best.y;
    return true;
  }

  makeNoise(x, y, r) {
    for (const m of this.curFloor.monsters) {
      if (m.state === 'idle' && cheb(m.x, m.y, x, y) <= r) {
        m.state = 'hunt';
        m.tx = x; m.ty = y;
      }
    }
  }

  // ---- combat ----------------------------------------------------------------

  playerDmg() {
    const p = this.player;
    return p.weapon ? ITEMS[p.weapon].dmg : [1, 2];
  }

  armorOf(who) {
    if (who !== this.player) return 0;
    return who.armor ? ITEMS[who.armor].def : 0;
  }

  attack(att, def) {
    const attIsPlayer = att === this.player;
    const defIsPlayer = def === this.player;
    const attName = attIsPlayer ? 'you' : `the ${MONSTERS[att.type].name}`;
    const defName = defIsPlayer ? 'you' : `the ${MONSTERS[def.type].name}`;
    const visible = attIsPlayer || defIsPlayer || this.isVisible(att.x, att.y);

    const hitP = clamp(0.72 + 0.06 * (att.acc - def.eva), 0.2, 0.95);
    if (!this.rng.chance(hitP)) {
      if (visible) {
        this.msg(attIsPlayer ? `You miss ${defName}.` : `${cap(attName)} misses ${defIsPlayer ? 'you' : defName}.`, 'note');
      }
      this.events.push({ type: 'miss' });
      if (!defIsPlayer) this.alertMonster(def);
      return;
    }

    const [d0, d1] = attIsPlayer ? this.playerDmg() : att.dmg;
    let dmg = this.rng.range(d0, d1) + (attIsPlayer ? att.dmgBonus : 0);
    dmg = Math.max(0, dmg - this.armorOf(def));
    if (dmg === 0) {
      if (visible) this.msg(`${cap(attName)} hits, but it glances off your armor.`, 'note');
      this.events.push({ type: 'miss' });
      return;
    }

    def.hp -= dmg;
    if (visible) {
      if (attIsPlayer) this.msg(`You hit ${defName} for ${dmg}.`, 'combat');
      else this.msg(`${cap(attName)} hits you for ${dmg}.`, 'bad');
    }
    this.events.push({ type: defIsPlayer ? 'hurt' : 'hit', x: def.x, y: def.y });

    if (def.hp <= 0) {
      if (defIsPlayer) this.die(MONSTERS[att.type].name);
      else this.killMonster(def);
    } else if (!defIsPlayer) {
      this.alertMonster(def);
    }
  }

  rangedAttack(m) {
    const p = this.player;
    const d = MONSTERS[m.type];
    this.events.push({ type: 'spit', fx: m.x, fy: m.y, tx: p.x, ty: p.y });
    this.makeNoise(m.x, m.y, 6);
    const hitP = clamp(0.65 + 0.06 * (m.acc - p.eva), 0.2, 0.9);
    if (!this.rng.chance(hitP)) {
      this.msg(`The ${d.name} spits at you and misses.`, 'note');
      this.events.push({ type: 'miss' });
      return;
    }
    const dmg = Math.max(0, this.rng.range(m.dmg[0], m.dmg[1]) - this.armorOf(p));
    if (dmg === 0) {
      this.msg('Burning gall spatters off your armor.', 'note');
      return;
    }
    p.hp -= dmg;
    this.msg(`The ${d.name} spits burning gall at you for ${dmg}.`, 'bad');
    this.events.push({ type: 'hurt', x: p.x, y: p.y });
    if (p.hp <= 0) this.die(d.name);
  }

  alertMonster(m) {
    m.state = 'hunt';
    m.tx = this.player.x;
    m.ty = this.player.y;
  }

  killMonster(m) {
    const f = this.curFloor;
    const i = f.monsters.indexOf(m);
    if (i >= 0) f.monsters.splice(i, 1);
    this.kills++;
    if (this.isVisible(m.x, m.y)) this.msg(`The ${MONSTERS[m.type].name} dies.`, 'good');
    this.events.push({ type: 'kill', x: m.x, y: m.y });
    this.gainXP(m.xp);
  }

  xpNext(level) { return 12 * level; }

  gainXP(n) {
    const p = this.player;
    p.xp += n;
    while (p.xp >= this.xpNext(p.level)) {
      p.xp -= this.xpNext(p.level);
      p.level++;
      p.maxhp += 5;
      p.hp = Math.min(p.maxhp, p.hp + 5);
      if (p.level % 2 === 0) p.dmgBonus++;
      else p.acc++;
      if (p.level % 3 === 0) p.eva++;
      this.msg(`You feel tougher. Welcome to level ${p.level}.`, 'big');
      this.events.push({ type: 'levelup' });
    }
  }

  die(cause) {
    this.player.hp = 0;
    this.over = true;
    this.won = false;
    this.cause = cause;
    this.msg(`The ${cause} kills you. The delving keeps what it takes.`, 'bad');
    this.events.push({ type: 'death' });
  }

  win() {
    this.over = true;
    this.won = true;
    this.msg('You lift the First Pearl from its socket of old sky.', 'big');
    this.msg('Far above, something like dawn happens.', 'magic');
    this.events.push({ type: 'win' });
  }

  // ---- permadeath save/load ---------------------------------------------------

  serialize() {
    const floors = {};
    for (const [k, f] of Object.entries(this.floors)) {
      floors[k] = {
        tiles: Array.from(f.tiles),
        seen: Array.from(f.seen),
        entry: f.entry, up: f.up, down: f.down, farPoint: f.farPoint,
        monsters: f.monsters,
        items: f.items,
      };
    }
    return JSON.stringify({
      v: SAVE_VERSION,
      seed: this.seed,
      rng: this.rng.state,
      depth: this.depth,
      deepest: this.deepest,
      turn: this.turn,
      kills: this.kills,
      itemsFound: this.itemsFound,
      itemsUsed: this.itemsUsed,
      nextId: this.nextId,
      over: this.over,
      won: this.won,
      cause: this.cause,
      player: this.player,
      log: this.log.slice(-80),
      floors,
    });
  }

  static fromJSON(json) {
    const d = JSON.parse(json);
    if (d.v !== SAVE_VERSION) return null;
    const g = Object.create(Game.prototype);
    g.seed = d.seed;
    g.rng = new RNG(1);
    g.rng.state = d.rng;
    g.depth = d.depth;
    g.deepest = d.deepest;
    g.turn = d.turn;
    g.kills = d.kills;
    g.itemsFound = d.itemsFound;
    g.itemsUsed = d.itemsUsed;
    g.nextId = d.nextId;
    g.over = d.over;
    g.won = d.won;
    g.cause = d.cause;
    g.player = d.player;
    g.log = d.log;
    g.events = [];
    g.floors = {};
    for (const [k, f] of Object.entries(d.floors)) {
      g.floors[k] = {
        tiles: Uint8Array.from(f.tiles),
        seen: Uint8Array.from(f.seen),
        visible: new Uint8Array(MAP_W * MAP_H),
        entry: f.entry, up: f.up, down: f.down, farPoint: f.farPoint,
        monsters: f.monsters,
        items: f.items,
      };
    }
    g.refreshFOV();
    return g;
  }
}

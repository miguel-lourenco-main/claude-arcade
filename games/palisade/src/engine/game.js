// Palisade — core game engine. Pure logic, no DOM: drivable headlessly from node.
// Fixed timestep: call tick(state) once per TICK seconds of simulated time.
// Every tick pushes renderable/audible happenings onto state.events; the caller drains them.

// Classic script (file:// safe): reads deps from and attaches to the Palisade namespace.
// Load order: data.js, maps.js, then this file.
(function () {
'use strict';
const NS = globalThis.Palisade = globalThis.Palisade || {};
const {
  TOWERS, CREEPS, WAVES, TARGET_MODES,
  SLOW_FACTOR, SLOW_CAP, POISON_TICK, SELL_REFUND, RETARGET_RADIUS,
  START_GOLD, START_LIVES, FIRST_INTERMISSION, INTERMISSION, EARLY_GOLD_PER_SEC,
  GROUP_GAP, hpScale, speedScale, bountyScale, waveClearBonus,
} = NS.data;
const { MAPS, posAt, cellKey, isBuildableCell } = NS.maps;

const TICK = 1 / 60;

function createGame(mapIdx) {
  return {
    mapIdx,
    map: MAPS[mapIdx],
    gold: START_GOLD,
    lives: START_LIVES,
    score: 0,
    waveIdx: 0,                    // next wave to launch (0-based)
    totalWaves: WAVES.length,
    phase: 'build',                // 'build' | 'wave' | 'won' | 'lost'
    intermission: FIRST_INTERMISSION,
    time: 0,
    waveClock: 0,
    spawnQueue: [],                // [{type, t, pathIdx}] sorted by t
    spawnCounter: 0,
    creeps: [],
    towers: [],
    projectiles: [],
    occupied: new Map(),           // "c,r" -> tower id
    events: [],
    nextId: 1,
  };
}

function emit(state, ev) { state.events.push(ev); }

function drainEvents(state) {
  const evs = state.events;
  state.events = [];
  return evs;
}

// ---------------------------------------------------------------- placement

function canPlace(state, c, r) {
  return isBuildableCell(state.map, c, r) && !state.occupied.has(cellKey(c, r));
}

function placeTower(state, c, r, type) {
  const def = TOWERS[type];
  if (!def || state.phase === 'won' || state.phase === 'lost') return null;
  if (!canPlace(state, c, r) || state.gold < def.cost) return null;
  state.gold -= def.cost;
  const tower = {
    id: state.nextId++,
    type, c, r,
    x: c * 32 + 16, y: r * 32 + 16,
    level: 0,
    cd: 0,
    mode: 'first',
    invested: def.cost,
    aim: 0,
    kills: 0,
  };
  state.towers.push(tower);
  state.occupied.set(cellKey(c, r), tower.id);
  emit(state, { t: 'place', x: tower.x, y: tower.y, type });
  return tower;
}

function upgradeCost(tower) {
  const def = TOWERS[tower.type];
  return tower.level < 2 ? def.upgrades[tower.level] : null;
}

function upgradeTower(state, id) {
  const tower = state.towers.find(t => t.id === id);
  if (!tower || tower.level >= 2) return false;
  const cost = upgradeCost(tower);
  if (state.gold < cost) return false;
  state.gold -= cost;
  tower.level++;
  tower.invested += cost;
  emit(state, { t: 'upgrade', x: tower.x, y: tower.y, level: tower.level });
  return true;
}

function sellValue(tower) { return Math.floor(tower.invested * SELL_REFUND); }

function sellTower(state, id) {
  const i = state.towers.findIndex(t => t.id === id);
  if (i < 0) return false;
  const tower = state.towers[i];
  const refund = sellValue(tower);
  state.gold += refund;
  state.occupied.delete(cellKey(tower.c, tower.r));
  state.towers.splice(i, 1);
  emit(state, { t: 'sell', x: tower.x, y: tower.y, refund });
  return true;
}

function cycleTargetMode(state, id) {
  const tower = state.towers.find(t => t.id === id);
  if (!tower) return null;
  const i = TARGET_MODES.indexOf(tower.mode);
  tower.mode = TARGET_MODES[(i + 1) % TARGET_MODES.length];
  return tower.mode;
}

function towerStats(tower) {
  return TOWERS[tower.type].levels[tower.level];
}

// ---------------------------------------------------------------- waves

function wavePreview(state) {
  if (state.waveIdx >= state.totalWaves) return null;
  return WAVES[state.waveIdx];
}

function startNextWave(state) {
  if (state.phase !== 'build' || state.waveIdx >= state.totalWaves) return false;
  // Early-call bonus: gold for every second left on the intermission timer.
  const early = Math.max(0, Math.ceil(state.intermission * EARLY_GOLD_PER_SEC));
  if (early > 0 && state.intermission > 0.05) {
    state.gold += early;
    state.score += early;
    emit(state, { t: 'earlyBonus', gold: early });
  }
  launchWave(state);
  return true;
}

function launchWave(state) {
  const w = state.waveIdx;
  const groups = WAVES[w];
  const queue = [];
  let t = 0.4;
  for (const g of groups) {
    const def = CREEPS[g.type];
    for (let i = 0; i < g.n; i++) {
      queue.push({ type: g.type, t, pathIdx: state.spawnCounter % state.map.paths.length });
      state.spawnCounter++;
      t += def.gap;
    }
    t += GROUP_GAP;
  }
  state.spawnQueue = queue;
  state.phase = 'wave';
  state.waveClock = 0;
  state.intermission = 0;
  emit(state, { t: 'waveStart', wave: w });
}

function spawnCreep(state, type, pathIdx) {
  const def = CREEPS[type];
  const w = state.waveIdx;
  const hp = Math.round(def.hp * hpScale(w));
  const creep = {
    id: state.nextId++,
    type,
    pathIdx,
    s: 0,
    prevS: 0,
    hp, maxHp: hp,
    speed: def.speed * speedScale(w),
    bounty: Math.max(1, Math.round(def.bounty * bountyScale(w))),
    lives: def.lives,
    radius: def.radius,
    regen: def.regen || 0,
    slowUntil: 0,
    poisonUntil: 0,
    poisonDps: 0,
    nextPoisonTick: 0,
    dead: false,
  };
  state.creeps.push(creep);
  return creep;
}

// ---------------------------------------------------------------- combat

function creepPos(state, creep) {
  return posAt(state.map.paths[creep.pathIdx], creep.s);
}

function damageCreep(state, creep, dmg, kind) {
  if (creep.dead) return;
  creep.hp -= dmg;
  if (creep.hp <= 0) {
    creep.dead = true;
    state.gold += creep.bounty;
    state.score += creep.bounty;
    const p = creepPos(state, creep);
    emit(state, { t: 'death', x: p.x, y: p.y, bounty: creep.bounty, ctype: creep.type, kind });
  }
}

function applySlow(state, creep, dur) {
  // Stacking DURATION, not multiplier: a fresh hit starts the clock; hits on an
  // already-chilled creep EXTEND the remaining slow (capped), speed factor constant.
  if (creep.slowUntil > state.time) {
    creep.slowUntil = Math.min(creep.slowUntil + dur * 0.5, state.time + SLOW_CAP);
  } else {
    creep.slowUntil = state.time + dur;
  }
}

function applyPoison(state, creep, dps, dur) {
  creep.poisonDps = Math.max(creep.poisonDps > 0 && creep.poisonUntil > state.time ? creep.poisonDps : 0, dps);
  creep.poisonUntil = state.time + dur;
  if (creep.nextPoisonTick < state.time) creep.nextPoisonTick = state.time + POISON_TICK;
}

function acquireTarget(state, tower, range) {
  let best = null, bestVal = 0;
  for (const c of state.creeps) {
    if (c.dead) continue;
    const p = creepPos(state, c);
    const d = Math.hypot(p.x - tower.x, p.y - tower.y);
    if (d > range + c.radius) continue;
    let val;
    switch (tower.mode) {
      case 'first': val = c.s; break;             // greatest distance along path
      case 'last': val = -c.s; break;             // least distance along path
      case 'nearest': val = -d; break;            // smallest euclidean distance
      case 'strongest': val = c.hp; break;        // most current HP
      default: val = c.s;
    }
    if (best === null || val > bestVal) { best = c; bestVal = val; }
  }
  return best;
}

function fireTower(state, tower, target) {
  const def = TOWERS[tower.type];
  const stats = def.levels[tower.level];
  const tp = creepPos(state, target);
  tower.aim = Math.atan2(tp.y - tower.y, tp.x - tower.x);

  if (tower.type === 'frost') {
    // Instant-hit chill: no projectile, guaranteed application.
    damageCreep(state, target, stats.dmg, 'frost');
    if (!target.dead) applySlow(state, target, stats.slowDur);
    emit(state, { t: 'frostHit', x1: tower.x, y1: tower.y, x2: tp.x, y2: tp.y });
    return;
  }

  state.projectiles.push({
    id: state.nextId++,
    kind: tower.type,               // 'arrow' | 'splash' | 'poison'
    x: tower.x, y: tower.y - 8,
    prevX: tower.x, prevY: tower.y - 8,
    x0: tower.x, y0: tower.y - 8,
    targetId: target.id,
    tx: tp.x, ty: tp.y,             // last known target position
    speed: def.projSpeed,
    dmg: stats.dmg,
    blast: stats.blast || 0,
    dot: stats.dot || 0,
    dotDur: stats.dotDur || 0,
    towerId: tower.id,
    dead: false,
  });
  emit(state, { t: 'shot', x: tower.x, y: tower.y, type: tower.type });
}

function explode(state, proj, x, y) {
  emit(state, { t: 'explosion', x, y, r: proj.blast });
  for (const c of state.creeps) {
    if (c.dead) continue;
    const p = creepPos(state, c);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= proj.blast + c.radius) {
      // Radius falloff: 100% at the center down to 35% at the rim.
      const f = 1 - 0.65 * Math.min(1, d / proj.blast);
      damageCreep(state, c, proj.dmg * f, 'splash');
      creditKill(state, proj, c);
    }
  }
}

function creditKill(state, proj, creep) {
  if (!creep.dead) return;
  const tower = state.towers.find(t => t.id === proj.towerId);
  if (tower) tower.kills++;
}

// ---------------------------------------------------------------- tick

function tick(state) {
  const dt = TICK;
  if (state.phase === 'won' || state.phase === 'lost') return;
  state.time += dt;

  // Intermission countdown → auto-launch next wave.
  if (state.phase === 'build') {
    state.intermission -= dt;
    if (state.intermission <= 0 && state.waveIdx < state.totalWaves) launchWave(state);
  }

  // Spawning.
  if (state.phase === 'wave') {
    state.waveClock += dt;
    while (state.spawnQueue.length && state.spawnQueue[0].t <= state.waveClock) {
      const sp = state.spawnQueue.shift();
      spawnCreep(state, sp.type, sp.pathIdx);
    }
  }

  // Creeps: status effects, movement, leaking.
  for (const c of state.creeps) {
    if (c.dead) continue;
    c.prevS = c.s;

    // Poison ticks after the hit.
    if (c.poisonUntil > state.time && c.poisonDps > 0) {
      while (c.nextPoisonTick <= state.time && !c.dead) {
        damageCreep(state, c, c.poisonDps * POISON_TICK, 'poison');
        c.nextPoisonTick += POISON_TICK;
      }
      if (c.dead) continue;
    }

    // Regeneration (only when hurt).
    if (c.regen > 0 && c.hp < c.maxHp) {
      c.hp = Math.min(c.maxHp, c.hp + c.regen * dt);
    }

    const slowed = c.slowUntil > state.time;
    c.s += c.speed * (slowed ? SLOW_FACTOR : 1) * dt;

    const path = state.map.paths[c.pathIdx];
    if (c.s >= path.total) {
      c.dead = true;
      c.leaked = true;
      state.lives -= c.lives;
      const end = posAt(path, path.total);
      emit(state, { t: 'leak', x: end.x, y: end.y, lives: c.lives, ctype: c.type });
      if (state.lives <= 0) {
        state.lives = 0;
        state.phase = 'lost';
        emit(state, { t: 'lose' });
        return;
      }
    }
  }

  // Towers: cool down and fire.
  for (const tw of state.towers) {
    tw.cd -= dt;
    const stats = towerStats(tw);
    // Track aim toward current target for rendering, even between shots.
    if (tw.cd > 0) {
      const tgt = acquireTarget(state, tw, stats.range);
      if (tgt) {
        const p = creepPos(state, tgt);
        tw.aim = Math.atan2(p.y - tw.y, p.x - tw.x);
      }
      continue;
    }
    const target = acquireTarget(state, tw, stats.range);
    if (target) {
      tw.cd = 1 / stats.rate;
      fireTower(state, tw, target);
    } else {
      tw.cd = 0;
    }
  }

  // Projectiles: home on target, retarget or fizzle if it died.
  for (const pr of state.projectiles) {
    if (pr.dead) continue;
    pr.prevX = pr.x; pr.prevY = pr.y;
    const target = state.creeps.find(c => c.id === pr.targetId && !c.dead);
    if (target) {
      const p = creepPos(state, target);
      pr.tx = p.x; pr.ty = p.y;
    } else if (pr.kind !== 'splash') {
      // Retarget the nearest living creep within a small radius of the projectile.
      let best = null, bestD = RETARGET_RADIUS;
      for (const c of state.creeps) {
        if (c.dead) continue;
        const p = creepPos(state, c);
        const d = Math.hypot(p.x - pr.x, p.y - pr.y);
        if (d < bestD) { best = c; bestD = d; }
      }
      if (best) {
        pr.targetId = best.id;
        const p = creepPos(state, best);
        pr.tx = p.x; pr.ty = p.y;
      } else {
        pr.dead = true; // fizzle
        emit(state, { t: 'fizzle', x: pr.x, y: pr.y });
        continue;
      }
    }
    // Mortar shells keep flying to the last known position and detonate there.

    const dx = pr.tx - pr.x, dy = pr.ty - pr.y;
    const dist = Math.hypot(dx, dy);
    const step = pr.speed * dt;
    if (dist <= Math.max(step, 5)) {
      pr.x = pr.tx; pr.y = pr.ty;
      pr.dead = true;
      if (pr.kind === 'splash') {
        explode(state, pr, pr.tx, pr.ty);
      } else {
        const victim = state.creeps.find(c => c.id === pr.targetId && !c.dead);
        if (victim) {
          damageCreep(state, victim, pr.dmg, pr.kind);
          if (!victim.dead && pr.kind === 'poison') applyPoison(state, victim, pr.dot, pr.dotDur);
          creditKill(state, pr, victim);
          emit(state, { t: 'hit', x: pr.tx, y: pr.ty, kind: pr.kind });
        } else {
          emit(state, { t: 'fizzle', x: pr.x, y: pr.y });
        }
      }
    } else {
      pr.x += (dx / dist) * step;
      pr.y += (dy / dist) * step;
    }
  }

  // Sweep the dead.
  state.creeps = state.creeps.filter(c => !c.dead);
  state.projectiles = state.projectiles.filter(p => !p.dead);

  // Wave cleared?
  if (state.phase === 'wave' && state.spawnQueue.length === 0 && state.creeps.length === 0) {
    const cleared = state.waveIdx;
    const bonus = waveClearBonus(cleared);
    state.gold += bonus;
    state.score += bonus;
    state.waveIdx++;
    if (state.waveIdx >= state.totalWaves) {
      state.phase = 'won';
      const livesBonus = state.lives * 50;
      state.score += livesBonus;
      emit(state, { t: 'win', bonus, livesBonus });
    } else {
      state.phase = 'build';
      state.intermission = INTERMISSION;
      emit(state, { t: 'waveClear', wave: cleared, bonus });
    }
  }
}

NS.game = {
  TICK, createGame, drainEvents, canPlace, placeTower, upgradeCost, upgradeTower,
  sellValue, sellTower, cycleTargetMode, towerStats, wavePreview, startNextWave,
  creepPos, tick,
};
})();

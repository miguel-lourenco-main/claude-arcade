// Gloamkeep — pure game logic. No DOM, no audio: drivable headlessly from node.
// Fixed-timestep: call tick(state, input, DT) with DT = 1/60.
// Classic script on the `Gloamkeep` namespace; load after maps.js.

(function () {
'use strict';
const G = globalThis.Gloamkeep = globalThis.Gloamkeep || {};
const { TILE, MAPS, parseMap } = G;

const DT = 1 / 60;
const PLAYER_RADIUS = 0.3;
const MAX_HP = 100;
const MAX_AMMO = 99;
const FIRE_COOLDOWN = 0.34;
const WEAPON_RANGE = 24;
const DOOR_SPEED = 1 / 0.8;   // full open in 0.8s
const DOOR_HOLD = 4;          // seconds before auto-close
const PUSH_SPEED = 0.9;       // tiles/s
const KEY_NAMES = ['crimson', 'viridian', 'gold'];

const ENEMY_DEFS = {
  gloam:   { hp: 30,  speed: 1.7,  melee: [7, 13],  ranged: false, points: 100, radius: 0.30, sightR: 12, attackRange: 1.05, meleeCd: 1.15, windup: 0.32, patrol: true,  scale: 0.85 },
  stalker: { hp: 18,  speed: 2.7,  melee: [5, 9],   ranged: false, points: 150, radius: 0.26, sightR: 13, attackRange: 0.95, meleeCd: 0.85, windup: 0.24, patrol: true,  scale: 0.72 },
  husk:    { hp: 42,  speed: 1.15, melee: [4, 7],   ranged: true,  boltDmg: [9, 15],  boltCd: 1.9, boltRange: 10, points: 200, radius: 0.32, sightR: 14, attackRange: 1.0, meleeCd: 1.3, windup: 0.42, patrol: false, scale: 0.95 },
  warden:  { hp: 150, speed: 1.15, melee: [16, 24], ranged: true,  boltDmg: [12, 18], boltCd: 2.3, boltRange: 8.5, points: 500, radius: 0.38, sightR: 16, attackRange: 1.2, meleeCd: 1.45, windup: 0.36, patrol: false, scale: 1.05 },
};

// deterministic RNG (mulberry32)
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createGame(levelIndex, carry, seed) {
  const level = parseMap(MAPS[levelIndex]);
  const rng = makeRng(seed === undefined ? 0x610a317 : seed);
  const state = {
    levelIndex,
    levelName: level.name,
    lastLevel: levelIndex === MAPS.length - 1,
    map: level,
    player: {
      x: level.spawn.x,
      y: level.spawn.y,
      angle: level.spawn.angle,
      hp: carry && carry.hp !== undefined ? carry.hp : MAX_HP,
      ammo: carry && carry.ammo !== undefined ? carry.ammo : 24,
      keys: [false, false, false],
      radius: PLAYER_RADIUS,
      cooldown: 0,
      bobPhase: 0,
      moving: 0,       // 0..1, how much the player moved this tick (for bob)
      muzzle: 0,       // muzzle flash timer
      alive: true,
    },
    enemies: level.enemies.map((e) => {
      const def = ENEMY_DEFS[e.type];
      return {
        type: e.type,
        x: e.x, y: e.y,
        hp: def.hp,
        radius: def.radius,
        state: def.patrol ? 'patrol' : 'idle',
        moveAngle: 0,
        cooldown: 0,
        windup: 0,
        painTimer: 0,
        hitFlash: 0,
        animTime: 0,
        sightTimer: rng() * 0.2,
        growlTimer: 1 + rng() * 3,
        wanderTimer: 0,
        deadTime: 0,
      };
    }),
    items: level.items.map((it) => ({ ...it, taken: false, bobT: rng() * 6 })),
    torches: level.torches,
    bolts: [],
    score: carry && carry.score !== undefined ? carry.score : 0,
    scoreAtStart: 0,
    kills: 0,
    totalEnemies: level.enemies.length,
    shards: 0,
    totalShards: level.items.filter((i) => i.kind === 'shard').length,
    secretsFound: 0,
    totalSecrets: level.pushwalls.length,
    time: 0,
    status: 'playing',   // playing | complete | dead
    message: '',
    messageTimer: 0,
    events: [],
    rng,
    // enemy pathing: distance-to-player field, refreshed periodically
    distField: new Int16Array(level.w * level.h),
    distQueue: new Int32Array(level.w * level.h),
    distTimer: 0,
  };
  state.scoreAtStart = state.score;
  state.distField.fill(-1);
  computeDistField(state);
  return state;
}

function emit(state, type, data) {
  state.events.push(data ? { type, ...data } : { type });
}

function say(state, text, t) {
  state.message = text;
  state.messageTimer = t || 2.6;
}

// ---------------------------------------------------------------------------
// Solidity / collision
// ---------------------------------------------------------------------------

function cellSolid(state, cx, cy) {
  const m = state.map;
  if (cx < 0 || cy < 0 || cx >= m.w || cy >= m.h) return true;
  const t = m.grid[cy * m.w + cx];
  if (t === TILE.EMPTY) return false;
  if (t >= TILE.DOOR && t <= TILE.DOOR_Y) {
    const d = m.doors[m.doorIdx[cy * m.w + cx]];
    return d.open < 0.85;
  }
  return true; // walls, exit, idle push-walls
}

function circleBoxOverlap(x, y, r, bx, by) {
  const cx = Math.max(bx, Math.min(x, bx + 1));
  const cy = Math.max(by, Math.min(y, by + 1));
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy < r * r;
}

function circleBlocked(state, x, y, r) {
  const minX = Math.floor(x - r), maxX = Math.floor(x + r);
  const minY = Math.floor(y - r), maxY = Math.floor(y + r);
  for (let cy = minY; cy <= maxY; cy++) {
    for (let cx = minX; cx <= maxX; cx++) {
      if (cellSolid(state, cx, cy) && circleBoxOverlap(x, y, r, cx, cy)) return true;
    }
  }
  // active push-walls: fractional box
  for (const p of state.map.pushwalls) {
    if (!p.active) continue;
    const bx = p.x + p.dirX * p.progress;
    const by = p.y + p.dirY * p.progress;
    if (x + r > bx && x - r < bx + 1 && y + r > by && y - r < by + 1) return true;
  }
  return false;
}

// Per-axis move so the mover slides along walls.
function moveWithCollision(state, ent, dx, dy) {
  const r = ent.radius;
  if (dx !== 0 && !circleBlocked(state, ent.x + dx, ent.y, r)) ent.x += dx;
  if (dy !== 0 && !circleBlocked(state, ent.x, ent.y + dy, r)) ent.y += dy;
}

// ---------------------------------------------------------------------------
// Raycasting (DDA) — shared by renderer, hitscan, line-of-sight, "use".
// dirX/dirY must be normalized. Fills `out`, allocation-free.
// ---------------------------------------------------------------------------

function castRay(state, ox, oy, dirX, dirY, out, maxDist) {
  const m = state.map;
  const MAXD = maxDist || 40;
  let mapX = Math.floor(ox), mapY = Math.floor(oy);
  const deltaX = dirX === 0 ? 1e30 : Math.abs(1 / dirX);
  const deltaY = dirY === 0 ? 1e30 : Math.abs(1 / dirY);
  let stepX, sideDistX, stepY, sideDistY;
  if (dirX < 0) { stepX = -1; sideDistX = (ox - mapX) * deltaX; }
  else { stepX = 1; sideDistX = (mapX + 1 - ox) * deltaX; }
  if (dirY < 0) { stepY = -1; sideDistY = (oy - mapY) * deltaY; }
  else { stepY = 1; sideDistY = (mapY + 1 - oy) * deltaY; }

  out.hit = false;
  out.dist = MAXD;
  out.side = 0;
  out.tex = TILE.STONE;
  out.texU = 0;

  let side = 0;
  for (let iter = 0; iter < 256; iter++) {
    if (sideDistX < sideDistY) { sideDistX += deltaX; mapX += stepX; side = 0; }
    else { sideDistY += deltaY; mapY += stepY; side = 1; }
    const entryDist = side === 0 ? sideDistX - deltaX : sideDistY - deltaY;
    if (entryDist > MAXD) break;
    if (mapX < 0 || mapY < 0 || mapX >= m.w || mapY >= m.h) break;
    const cell = m.grid[mapY * m.w + mapX];
    if (cell === TILE.EMPTY) continue;

    if (cell >= TILE.DOOR && cell <= TILE.DOOR_Y) {
      // door: recessed half a cell; slides sideways as it opens
      const d = m.doors[m.doorIdx[mapY * m.w + mapX]];
      const tHalf = (side === 0 ? sideDistX - deltaX * 0.5 : sideDistY - deltaY * 0.5);
      // still inside this cell at the half-plane?
      const hx = ox + dirX * tHalf;
      const hy = oy + dirY * tHalf;
      if (Math.floor(hx) !== mapX && side === 1) continue;
      if (Math.floor(hy) !== mapY && side === 0) continue;
      const u = side === 0 ? hy - mapY : hx - mapX;
      if (u < d.open) continue; // ray passes through the open gap
      out.hit = true;
      out.dist = tHalf;
      out.side = side;
      out.tex = cell;
      out.texU = Math.min(0.9999, Math.max(0, u - d.open));
      break;
    }

    // solid wall (stone / moss / banner / exit / idle push-wall)
    if (cell === TILE.PUSH) {
      const p = pushwallAt(state, mapX, mapY);
      if (p && p.active) continue; // moving: cell already vacated; box test below
    }
    const dist = side === 0 ? sideDistX - deltaX : sideDistY - deltaY;
    out.hit = true;
    out.dist = dist;
    out.side = side;
    out.tex = cell === TILE.PUSH ? TILE.STONE : cell;
    if (side === 0) {
      let u = oy + dirY * dist; u -= Math.floor(u);
      out.texU = dirX > 0 ? u : 1 - u;
    } else {
      let u = ox + dirX * dist; u -= Math.floor(u);
      out.texU = dirY < 0 ? u : 1 - u;
    }
    out.texU = Math.min(0.9999, Math.max(0, out.texU));
    break;
  }

  // moving push-walls: analytic ray-vs-box, keep the nearer hit
  for (const p of state.map.pushwalls) {
    if (!p.active) continue;
    const bx = p.x + p.dirX * p.progress;
    const by = p.y + p.dirY * p.progress;
    boxHit(ox, oy, dirX, dirY, bx, by, boxOut);
    if (boxOut.hit && boxOut.dist < out.dist && boxOut.dist > 0) {
      out.hit = true;
      out.dist = boxOut.dist;
      out.side = boxOut.side;
      out.tex = TILE.STONE;
      out.texU = boxOut.u;
    }
  }
  return out;
}

const boxOut = { hit: false, dist: 0, side: 0, u: 0 };
function boxHit(ox, oy, dx, dy, bx, by, out) {
  out.hit = false;
  const invX = dx === 0 ? 1e30 : 1 / dx;
  const invY = dy === 0 ? 1e30 : 1 / dy;
  let tx1 = (bx - ox) * invX, tx2 = (bx + 1 - ox) * invX;
  let ty1 = (by - oy) * invY, ty2 = (by + 1 - oy) * invY;
  const tminX = Math.min(tx1, tx2), tmaxX = Math.max(tx1, tx2);
  const tminY = Math.min(ty1, ty2), tmaxY = Math.max(ty1, ty2);
  const tmin = Math.max(tminX, tminY);
  const tmax = Math.min(tmaxX, tmaxY);
  if (tmax < 0 || tmin > tmax) return;
  out.hit = true;
  out.dist = tmin;
  if (tminX > tminY) {
    out.side = 0;
    let u = oy + dy * tmin - by;
    out.u = Math.min(0.9999, Math.max(0, dx > 0 ? u : 1 - u));
  } else {
    out.side = 1;
    let u = ox + dx * tmin - bx;
    out.u = Math.min(0.9999, Math.max(0, dy < 0 ? u : 1 - u));
  }
}

function pushwallAt(state, x, y) {
  for (const p of state.map.pushwalls) if (p.x === x && p.y === y) return p;
  return null;
}

const losOut = { hit: false, dist: 0, side: 0, tex: 0, texU: 0 };
function hasLineOfSight(state, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.001) return true;
  castRay(state, x0, y0, dx / dist, dy / dist, losOut, dist + 1);
  return !losOut.hit || losOut.dist > dist - 0.05;
}

// ---------------------------------------------------------------------------
// Doors & push-walls
// ---------------------------------------------------------------------------

function tryOpenDoor(state, door, byPlayer) {
  if (door.state === 1 || door.state === 2) return true;
  if (door.locked) {
    if (!byPlayer) return false;
    if (!state.player.keys[door.locked - 1]) {
      say(state, `Sealed by the ${KEY_NAMES[door.locked - 1]} sigil.`);
      emit(state, 'locked');
      return false;
    }
    say(state, `The ${KEY_NAMES[door.locked - 1]} seal yields.`);
  }
  door.state = 1;
  emit(state, 'doorOpen', { x: door.x, y: door.y });
  return true;
}

function entityInDoorCell(state, door) {
  const p = state.player;
  if (circleBoxOverlap(p.x, p.y, p.radius + 0.1, door.x, door.y)) return true;
  for (const e of state.enemies) {
    if (e.state !== 'dead' && circleBoxOverlap(e.x, e.y, e.radius + 0.1, door.x, door.y)) return true;
  }
  return false;
}

function updateDoors(state, dt) {
  for (const d of state.map.doors) {
    if (d.state === 1) {
      d.open += DOOR_SPEED * dt;
      if (d.open >= 1) { d.open = 1; d.state = 2; d.timer = DOOR_HOLD; }
    } else if (d.state === 2) {
      d.timer -= dt;
      if (d.timer <= 0) {
        if (entityInDoorCell(state, d)) d.timer = 0.5;
        else { d.state = 3; emit(state, 'doorClose', { x: d.x, y: d.y }); }
      }
    } else if (d.state === 3) {
      d.open -= DOOR_SPEED * dt;
      if (entityInDoorCell(state, d)) { d.state = 1; } // reopen rather than crush
      else if (d.open <= 0) { d.open = 0; d.state = 0; }
    }
  }
}

function activatePushwall(state, p) {
  // push away from the player along the dominant axis, falling back to any
  // direction with two free cells
  const px = state.player.x, py = state.player.y;
  const ax = p.x + 0.5 - px, ay = p.y + 0.5 - py;
  const prefer = Math.abs(ax) > Math.abs(ay)
    ? [[Math.sign(ax) || 1, 0], [0, Math.sign(ay) || 1], [0, -(Math.sign(ay) || 1)], [-(Math.sign(ax) || 1), 0]]
    : [[0, Math.sign(ay) || 1], [Math.sign(ax) || 1, 0], [-(Math.sign(ax) || 1), 0], [0, -(Math.sign(ay) || 1)]];
  const m = state.map;
  for (const [dx, dy] of prefer) {
    const c1 = m.grid[(p.y + dy) * m.w + (p.x + dx)];
    const c2 = m.grid[(p.y + 2 * dy) * m.w + (p.x + 2 * dx)];
    if (c1 === TILE.EMPTY && c2 === TILE.EMPTY) {
      p.active = true;
      p.dirX = dx; p.dirY = dy;
      m.grid[p.y * m.w + p.x] = TILE.EMPTY; // vacate origin; box handles solidity
      state.secretsFound++;
      state.score += 250;
      say(state, 'A hidden passage grinds open...', 3);
      emit(state, 'secret');
      return true;
    }
  }
  return false;
}

function updatePushwalls(state, dt) {
  const m = state.map;
  for (const p of m.pushwalls) {
    if (!p.active) continue;
    p.progress += PUSH_SPEED * dt;
    if (p.progress >= p.cells) {
      p.progress = p.cells;
      p.active = false;
      p.done = true;
      const fx = p.x + p.dirX * p.cells, fy = p.y + p.dirY * p.cells;
      m.grid[fy * m.w + fx] = TILE.STONE;
      continue;
    }
    // shove the player out if the moving slab catches them
    const bx = p.x + p.dirX * p.progress, by = p.y + p.dirY * p.progress;
    const pl = state.player;
    if (pl.x + pl.radius > bx && pl.x - pl.radius < bx + 1 &&
        pl.y + pl.radius > by && pl.y - pl.radius < by + 1) {
      moveWithCollision(state, pl, p.dirX * PUSH_SPEED * dt * 1.5, p.dirY * PUSH_SPEED * dt * 1.5);
    }
  }
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

const useOut = { hit: false, dist: 0, side: 0, tex: 0, texU: 0 };

function playerUse(state) {
  const p = state.player;
  const dx = Math.cos(p.angle), dy = Math.sin(p.angle);
  castRay(state, p.x, p.y, dx, dy, useOut, 2);
  if (!useOut.hit || useOut.dist > 1.4) return;
  // what cell did we hit?
  const hx = Math.floor(p.x + dx * (useOut.dist + 0.05));
  const hy = Math.floor(p.y + dy * (useOut.dist + 0.05));
  const m = state.map;
  if (hx < 0 || hy < 0 || hx >= m.w || hy >= m.h) return;
  const cell = m.grid[hy * m.w + hx];
  if (cell >= TILE.DOOR && cell <= TILE.DOOR_Y) {
    const d = m.doors[m.doorIdx[hy * m.w + hx]];
    if (d.state === 0) tryOpenDoor(state, d, true);
    else if (d.state === 2) { d.state = 3; emit(state, 'doorClose', { x: d.x, y: d.y }); }
    return;
  }
  if (cell === TILE.EXIT) {
    state.status = 'complete';
    state.score += 500;
    emit(state, 'levelComplete');
    return;
  }
  if (cell === TILE.PUSH) {
    const pw = pushwallAt(state, hx, hy);
    if (pw && !pw.active && !pw.done) activatePushwall(state, pw);
    return;
  }
  // bare wall: soft thud feedback
  emit(state, 'useThud');
}

const fireOut = { hit: false, dist: 0, side: 0, tex: 0, texU: 0 };

function playerFire(state) {
  const p = state.player;
  if (p.ammo <= 0) {
    p.cooldown = 0.3;
    emit(state, 'dryFire');
    say(state, 'The emberlock is spent.', 1.2);
    return;
  }
  p.ammo--;
  p.cooldown = FIRE_COOLDOWN;
  p.muzzle = 0.09;
  emit(state, 'shot');

  const dx = Math.cos(p.angle), dy = Math.sin(p.angle);
  castRay(state, p.x, p.y, dx, dy, fireOut, WEAPON_RANGE);
  const wallDist = fireOut.hit ? fireOut.dist : WEAPON_RANGE;

  // nearest enemy intersecting the center ray, in front of the wall
  let best = null, bestT = Infinity;
  for (const e of state.enemies) {
    if (e.state === 'dead') continue;
    const ex = e.x - p.x, ey = e.y - p.y;
    const t = ex * dx + ey * dy;           // distance along the ray
    if (t < 0.2 || t > wallDist + e.radius) continue;
    const perp = Math.abs(ex * dy - ey * dx); // distance from ray line
    if (perp > e.radius + 0.08) continue;
    if (t < bestT) { bestT = t; best = e; }
  }
  if (best) {
    const dmg = 15 + Math.floor(state.rng() * 9);
    damageEnemy(state, best, dmg);
  } else {
    emit(state, 'wallSpark', { dist: wallDist });
  }
  // shots are loud: alert enemies whose path-distance to the player is short
  alertNearby(state, 11);
}

function alertNearby(state, pathRadius) {
  const m = state.map;
  for (const e of state.enemies) {
    if (e.state === 'dead' || e.state === 'chase' || e.state === 'attack') continue;
    const ci = Math.floor(e.y) * m.w + Math.floor(e.x);
    const d = state.distField[ci];
    if (d >= 0 && d <= pathRadius) setAlert(state, e);
  }
}

function setAlert(state, e) {
  if (e.state === 'idle' || e.state === 'patrol') {
    e.state = 'chase';
    const dist = Math.hypot(e.x - state.player.x, e.y - state.player.y);
    emit(state, 'growl', { dist, kind: e.type });
  }
}

function updatePlayer(state, input, dt) {
  const p = state.player;
  if (!p.alive) return;

  p.angle += input.lookDelta + input.turnDir * 2.4 * dt;
  // keep angle bounded
  if (p.angle > Math.PI * 4 || p.angle < -Math.PI * 4) p.angle %= Math.PI * 2;

  // facing = (cos, sin); with y-down screen turn, "right" of facing = (-sin, cos)
  const ca = Math.cos(p.angle), sa = Math.sin(p.angle);
  let mx = ca * input.forward + -sa * input.strafe;
  let my = sa * input.forward + ca * input.strafe;
  const mlen = Math.hypot(mx, my);
  if (mlen > 0.001) {
    mx /= mlen; my /= mlen;
    const SPEED = 3.3;
    moveWithCollision(state, p, mx * SPEED * dt, my * SPEED * dt);
    p.bobPhase += dt * 9.5;
    p.moving = Math.min(1, p.moving + dt * 6);
  } else {
    p.moving = Math.max(0, p.moving - dt * 6);
  }

  p.cooldown = Math.max(0, p.cooldown - dt);
  p.muzzle = Math.max(0, p.muzzle - dt);
  if (input.fire && p.cooldown <= 0) playerFire(state);
  if (input.usePressed) playerUse(state);

  // pickups
  for (const it of state.items) {
    if (it.taken) continue;
    const dx = it.x - p.x, dy = it.y - p.y;
    if (dx * dx + dy * dy > 0.42 * 0.42) continue;
    switch (it.kind) {
      case 'health':
        if (p.hp >= MAX_HP) continue;
        p.hp = Math.min(MAX_HP, p.hp + 25);
        say(state, 'Pale tonic. +25 vigor.', 1.6);
        break;
      case 'ammo':
        if (p.ammo >= MAX_AMMO) continue;
        p.ammo = Math.min(MAX_AMMO, p.ammo + 12);
        say(state, 'Ember vials. +12 shots.', 1.6);
        break;
      case 'key1': case 'key2': case 'key3': {
        const n = +it.kind[3];
        p.keys[n - 1] = true;
        say(state, `The ${KEY_NAMES[n - 1]} sigil-key is yours.`, 2.4);
        break;
      }
      case 'shard':
        state.score += 100;
        state.shards++;
        say(state, 'An ember shard. +100.', 1.4);
        break;
    }
    it.taken = true;
    emit(state, 'pickup', { kind: it.kind });
  }
}

function damagePlayer(state, dmg, srcX, srcY) {
  const p = state.player;
  if (!p.alive || state.status !== 'playing') return;
  p.hp -= dmg;
  // direction hint relative to view: -1 left, +1 right, 0 front/back
  const ang = Math.atan2(srcY - p.y, srcX - p.x);
  let rel = ang - p.angle;
  while (rel > Math.PI) rel -= Math.PI * 2;
  while (rel < -Math.PI) rel += Math.PI * 2;
  let dir = 0;
  if (Math.sin(rel) > 0.45) dir = 1;
  else if (Math.sin(rel) < -0.45) dir = -1;
  emit(state, 'playerHit', { dmg, dir, behind: Math.cos(rel) < -0.3 });
  if (p.hp <= 0) {
    p.hp = 0;
    p.alive = false;
    state.status = 'dead';
    emit(state, 'gameOver');
  }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function damageEnemy(state, e, dmg) {
  if (e.state === 'dead') return;
  e.hp -= dmg;
  e.hitFlash = 0.12;
  emit(state, 'enemyHit', { kind: e.type });
  if (e.hp <= 0) {
    e.state = 'dead';
    e.deadTime = 0;
    state.kills++;
    state.score += ENEMY_DEFS[e.type].points;
    emit(state, 'enemyDie', { kind: e.type, dist: Math.hypot(e.x - state.player.x, e.y - state.player.y) });
  } else {
    e.painTimer = 0.24;
    if (e.state !== 'attack') e.state = 'chase';
    setAlertQuiet(e);
  }
}

function setAlertQuiet(e) {
  if (e.state === 'idle' || e.state === 'patrol') e.state = 'chase';
}

function computeDistField(state) {
  const m = state.map;
  const field = state.distField;
  const queue = state.distQueue;
  field.fill(-1);
  let head = 0, tail = 0;
  const px = Math.floor(state.player.x), py = Math.floor(state.player.y);
  const start = py * m.w + px;
  field[start] = 0;
  queue[tail++] = start;
  while (head < tail) {
    const i = queue[head++];
    const d = field[i];
    const x = i % m.w, y = (i / m.w) | 0;
    // 4-neighbors
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
      const ni = ny * m.w + nx;
      if (field[ni] !== -1) continue;
      const t = m.grid[ni];
      let pass = t === TILE.EMPTY;
      if (t >= TILE.DOOR && t <= TILE.DOOR_Y) {
        const dr = m.doors[m.doorIdx[ni]];
        pass = dr.locked === 0 || dr.open > 0.1; // enemies open unlocked doors
      }
      if (!pass) continue;
      field[ni] = d + 1;
      queue[tail++] = ni;
    }
  }
}

function enemyStepToward(state, e, tx, ty, def, dt) {
  const dx = tx - e.x, dy = ty - e.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return;
  const sp = def.speed * (e.painTimer > 0 ? 0.25 : 1);
  const ox = e.x, oy = e.y;
  moveWithCollision(state, e, (dx / len) * sp * dt, (dy / len) * sp * dt);
  e.moveAngle = Math.atan2(dy, dx);
  e.animTime += Math.hypot(e.x - ox, e.y - oy) * 2.2;

  // open unlocked doors in the way
  const m = state.map;
  const fx = Math.floor(e.x + (dx / len) * 0.6), fy = Math.floor(e.y + (dy / len) * 0.6);
  if (fx >= 0 && fy >= 0 && fx < m.w && fy < m.h) {
    const t = m.grid[fy * m.w + fx];
    if (t >= TILE.DOOR && t <= TILE.DOOR_Y) {
      const d = m.doors[m.doorIdx[fy * m.w + fx]];
      if (d.locked === 0 && d.state === 0) tryOpenDoor(state, d, false);
    }
  }
}

function updateEnemies(state, dt) {
  const p = state.player;
  const m = state.map;
  for (const e of state.enemies) {
    const def = ENEMY_DEFS[e.type];
    if (e.state === 'dead') { e.deadTime += dt; continue; }

    e.hitFlash = Math.max(0, e.hitFlash - dt);
    e.painTimer = Math.max(0, e.painTimer - dt);
    e.cooldown = Math.max(0, e.cooldown - dt);
    const distToPlayer = Math.hypot(p.x - e.x, p.y - e.y);

    // periodic sight checks (staggered so LOS rays don't all fire same tick)
    e.sightTimer -= dt;
    if (e.sightTimer <= 0) {
      e.sightTimer = 0.18;
      if ((e.state === 'idle' || e.state === 'patrol') &&
          distToPlayer < def.sightR && p.alive &&
          hasLineOfSight(state, e.x, e.y, p.x, p.y)) {
        setAlert(state, e);
      }
    }

    switch (e.state) {
      case 'idle':
        e.animTime += dt * 0.6;
        break;

      case 'patrol': {
        e.wanderTimer -= dt;
        if (e.wanderTimer <= 0) {
          e.wanderTimer = 1.5 + state.rng() * 2.5;
          const dirs = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
          e.moveAngle = dirs[(state.rng() * 4) | 0];
        }
        const ox = e.x, oy = e.y;
        moveWithCollision(
          state, e,
          Math.cos(e.moveAngle) * def.speed * 0.45 * dt,
          Math.sin(e.moveAngle) * def.speed * 0.45 * dt
        );
        if (Math.hypot(e.x - ox, e.y - oy) < def.speed * 0.1 * dt) e.wanderTimer = 0; // bumped a wall
        e.animTime += dt * 2.2;
        break;
      }

      case 'chase': {
        if (!p.alive) { e.state = def.patrol ? 'patrol' : 'idle'; break; }
        // occasional growls while hunting
        e.growlTimer -= dt;
        if (e.growlTimer <= 0) {
          e.growlTimer = 2.5 + state.rng() * 3.5;
          emit(state, 'growl', { dist: distToPlayer, kind: e.type });
        }
        // attack decisions
        if (distToPlayer < def.attackRange && e.cooldown <= 0) {
          e.state = 'attack';
          e.windup = def.windup;
          e.attackKind = 'melee';
          break;
        }
        if (def.ranged && e.cooldown <= 0 && distToPlayer < def.boltRange && distToPlayer > 1.6 &&
            hasLineOfSight(state, e.x, e.y, p.x, p.y)) {
          e.state = 'attack';
          e.windup = def.windup + 0.1;
          e.attackKind = 'bolt';
          break;
        }
        // path toward the player via the distance field
        const cx = Math.floor(e.x), cy = Math.floor(e.y);
        const here = state.distField[cy * m.w + cx];
        let tx = p.x, ty = p.y;
        if (here > 1) {
          let bd = here, bx = cx, by = cy;
          for (let k = 0; k < 4; k++) {
            const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0);
            const ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
            if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
            const d = state.distField[ny * m.w + nx];
            if (d >= 0 && d < bd) { bd = d; bx = nx; by = ny; }
          }
          tx = bx + 0.5; ty = by + 0.5;
        } else if (here === -1 && !hasLineOfSight(state, e.x, e.y, p.x, p.y)) {
          // unreachable and unseen: give up
          e.state = def.patrol ? 'patrol' : 'idle';
          break;
        }
        enemyStepToward(state, e, tx, ty, def, dt);
        break;
      }

      case 'attack': {
        e.windup -= dt;
        e.animTime += dt;
        if (e.windup <= 0) {
          if (e.attackKind === 'melee') {
            if (distToPlayer < def.attackRange + 0.4 && p.alive) {
              const [lo, hi] = def.melee;
              damagePlayer(state, lo + Math.floor(state.rng() * (hi - lo + 1)), e.x, e.y);
            }
            e.cooldown = def.meleeCd;
          } else {
            // loose a shadow bolt at the player's current position
            const dx = p.x - e.x, dy = p.y - e.y;
            const len = Math.hypot(dx, dy) || 1;
            state.bolts.push({
              x: e.x + (dx / len) * 0.4,
              y: e.y + (dy / len) * 0.4,
              vx: (dx / len) * 5.2,
              vy: (dy / len) * 5.2,
              ttl: 4,
              dmg: def.boltDmg,
            });
            emit(state, 'boltFire', { dist: distToPlayer });
            e.cooldown = def.boltCd;
          }
          e.state = 'chase';
        }
        break;
      }
    }
  }

  // gentle separation so enemies don't stack inside each other (or the player)
  for (let i = 0; i < state.enemies.length; i++) {
    const a = state.enemies[i];
    if (a.state === 'dead') continue;
    {
      const dx = a.x - p.x, dy = a.y - p.y;
      const d2 = dx * dx + dy * dy;
      const min = a.radius + p.radius;
      if (d2 > 0.0001 && d2 < min * min) {
        const d = Math.sqrt(d2);
        const push = (min - d) / d;
        moveWithCollision(state, a, dx * push, dy * push);
      }
    }
    for (let j = i + 1; j < state.enemies.length; j++) {
      const b = state.enemies[j];
      if (b.state === 'dead') continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      const min = a.radius + b.radius;
      if (d2 > 0.0001 && d2 < min * min) {
        const d = Math.sqrt(d2);
        const push = ((min - d) / d) * 0.5;
        moveWithCollision(state, a, -dx * push, -dy * push);
        moveWithCollision(state, b, dx * push, dy * push);
      }
    }
  }
}

function updateBolts(state, dt) {
  const p = state.player;
  for (let i = state.bolts.length - 1; i >= 0; i--) {
    const b = state.bolts[i];
    b.ttl -= dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    const cx = Math.floor(b.x), cy = Math.floor(b.y);
    let dead = b.ttl <= 0;
    if (!dead && cellSolid(state, cx, cy)) {
      dead = true;
      emit(state, 'boltHit', { dist: Math.hypot(b.x - p.x, b.y - p.y) });
    }
    if (!dead && p.alive) {
      const dx = p.x - b.x, dy = p.y - b.y;
      if (dx * dx + dy * dy < 0.45 * 0.45) {
        const [lo, hi] = b.dmg;
        damagePlayer(state, lo + Math.floor(state.rng() * (hi - lo + 1)), b.x - b.vx, b.y - b.vy);
        dead = true;
      }
    }
    if (dead) {
      state.bolts[i] = state.bolts[state.bolts.length - 1];
      state.bolts.pop();
    }
  }
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

function tick(state, input, dt) {
  if (state.status !== 'playing') return;
  state.time += dt;
  if (state.messageTimer > 0) {
    state.messageTimer -= dt;
    if (state.messageTimer <= 0) state.message = '';
  }
  state.distTimer -= dt;
  if (state.distTimer <= 0) {
    state.distTimer = 0.25;
    computeDistField(state);
  }
  updateDoors(state, dt);
  updatePushwalls(state, dt);
  updatePlayer(state, input, dt);
  updateEnemies(state, dt);
  updateBolts(state, dt);
  for (const it of state.items) it.bobT += dt;
}

function makeInput() {
  return { forward: 0, strafe: 0, turnDir: 0, lookDelta: 0, fire: false, usePressed: false };
}

const LEVEL_COUNT = MAPS.length;

Object.assign(G, {
  DT, PLAYER_RADIUS, MAX_HP, MAX_AMMO, FIRE_COOLDOWN, WEAPON_RANGE,
  DOOR_SPEED, DOOR_HOLD, PUSH_SPEED, KEY_NAMES, ENEMY_DEFS, LEVEL_COUNT,
  makeRng, createGame, say, cellSolid, circleBlocked, moveWithCollision,
  castRay, hasLineOfSight, tryOpenDoor, damagePlayer, damageEnemy,
  tick, makeInput,
});
})();

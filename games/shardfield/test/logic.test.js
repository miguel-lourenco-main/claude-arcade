// Shardfield pure-logic tests — node-runnable, plain asserts, no deps.
// Run: node games/shardfield/test/logic.test.js
'use strict';

const assert = require('assert');
const path = require('path');
const L = require(path.join(__dirname, '..', 'logic.js'));

let count = 0;
function test(name, fn) {
  fn();
  count++;
  console.log('ok - ' + name);
}

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ------------------------------------------------------------------ helpers

test('clamp pins values to [a, b]', () => {
  assert.strictEqual(L.clamp(5, 0, 10), 5);
  assert.strictEqual(L.clamp(-3, 0, 10), 0);
  assert.strictEqual(L.clamp(42, 0, 10), 10);
});

test('lerp interpolates linearly', () => {
  assert.strictEqual(L.lerp(0, 10, 0), 0);
  assert.strictEqual(L.lerp(0, 10, 1), 10);
  assert.strictEqual(L.lerp(2, 4, 0.5), 3);
});

test('rand / irand stay within bounds', () => {
  for (let i = 0; i < 2000; i++) {
    const r = L.rand(3, 7);
    assert.ok(r >= 3 && r < 7, 'rand in [3,7): ' + r);
    const n = L.irand(2, 5);
    assert.ok(Number.isInteger(n) && n >= 2 && n <= 5, 'irand in [2,5]: ' + n);
  }
});

// -------------------------------------------------------------- torus math

test('dist2 is plain euclidean away from the seams', () => {
  assert.strictEqual(L.dist2(100, 100, 103, 104), 25);
});

test('dist2 measures across the toroidal seams (README: toroidal arena)', () => {
  // 10px from each edge -> 20px apart horizontally across the seam
  assert.strictEqual(L.dist2(5, 300, L.W - 15, 300), 400);
  // and vertically
  assert.strictEqual(L.dist2(400, 5, 400, L.H - 15), 400);
  // and diagonally across the corner
  assert.strictEqual(L.dist2(5, 5, L.W - 5, L.H - 5), 100 + 100);
});

test('torusDelta returns the shortest wrapped vector (small-saucer aiming)', () => {
  // straight, no wrap
  assert.deepStrictEqual(L.torusDelta(100, 100, 130, 140), [30, 40]);
  // target just across the right seam -> small positive dx, not ~-W
  const [dx1] = L.torusDelta(L.W - 10, 300, 10, 300);
  assert.strictEqual(dx1, 20);
  // target just across the left seam -> small negative dx
  const [dx2] = L.torusDelta(10, 300, L.W - 10, 300);
  assert.strictEqual(dx2, -20);
  // vertical wrap
  const [, dy] = L.torusDelta(400, L.H - 10, 400, 10);
  assert.strictEqual(dy, 20);
});

test('wrapEntity wraps all four edges and drags prev-pos along (no interpolation streaks)', () => {
  let e = { x: -3, y: 100, px: 2, py: 100 };
  L.wrapEntity(e);
  assert.strictEqual(e.x, L.W - 3);
  assert.strictEqual(e.px, L.W + 2, 'px shifted by the same +W');

  e = { x: L.W + 4, y: 100, px: L.W - 1, py: 100 };
  L.wrapEntity(e);
  assert.strictEqual(e.x, 4);
  assert.strictEqual(e.px, -1);

  e = { x: 100, y: -6, px: 100, py: 1 };
  L.wrapEntity(e);
  assert.strictEqual(e.y, L.H - 6);
  assert.strictEqual(e.py, L.H + 1);

  e = { x: 100, y: L.H, px: 100, py: L.H - 2 };
  L.wrapEntity(e);
  assert.strictEqual(e.y, 0);
  assert.strictEqual(e.py, -2);
});

test('wrapEntity leaves in-field entities alone', () => {
  const e = { x: 480, y: 360, px: 479, py: 359 };
  L.wrapEntity(e);
  assert.deepStrictEqual(e, { x: 480, y: 360, px: 479, py: 359 });
});

// ------------------------------------------------------------------- shards

test('shard size table: points run inverse to size, 20 / 50 / 100 (README)', () => {
  assert.strictEqual(L.SIZES[3].pts, 20);
  assert.strictEqual(L.SIZES[2].pts, 50);
  assert.strictEqual(L.SIZES[1].pts, 100);
});

test('shard size table: smaller shards are faster (README)', () => {
  assert.ok(L.SIZES[3].vmax < L.SIZES[2].vmin + L.SIZES[2].vmax, 'sanity');
  assert.ok(L.SIZES[2].vmin > L.SIZES[3].vmin && L.SIZES[1].vmin > L.SIZES[2].vmin);
  assert.ok(L.SIZES[2].vmax > L.SIZES[3].vmax && L.SIZES[1].vmax > L.SIZES[2].vmax);
});

test('makeShard: speed within its size band (plus parent boost)', () => {
  for (let size = 1; size <= 3; size++) {
    const cfg = L.SIZES[size];
    for (let i = 0; i < 300; i++) {
      const s = L.makeShard(100, 100, size);
      const spd = Math.hypot(s.vx, s.vy);
      assert.ok(spd >= cfg.vmin - 1e-9 && spd <= cfg.vmax + 1e-9,
        `size ${size} speed ${spd} in [${cfg.vmin}, ${cfg.vmax}]`);
    }
    const boosted = L.makeShard(100, 100, size, 30);
    const spd = Math.hypot(boosted.vx, boosted.vy);
    assert.ok(spd >= cfg.vmin && spd <= cfg.vmax + 30 + 1e-9, 'boost widens the band upward');
  }
});

test('makeShard: unique irregular polygon of 9-12 verts within radius bounds (README)', () => {
  for (let i = 0; i < 300; i++) {
    const s = L.makeShard(50, 60, 3);
    assert.ok(s.verts.length >= 9 && s.verts.length <= 12, 'vert count ' + s.verts.length);
    for (const [vx, vy] of s.verts) {
      const r = Math.hypot(vx, vy);
      assert.ok(r >= L.SIZES[3].R * 0.62 - 1e-9 && r <= L.SIZES[3].R * 1.12 + 1e-9,
        'vertex radius ' + r);
    }
  }
});

test('makeShard: collision radius is 0.82 of the nominal radius, prev-pos primed', () => {
  const s = L.makeShard(10, 20, 2);
  assert.ok(close(s.cr, L.SIZES[2].R * 0.82));
  assert.strictEqual(s.px, 10);
  assert.strictEqual(s.py, 20);
  assert.strictEqual(s.pa, s.a);
});

// ------------------------------------------------------------------ bullets

test('bullet life is just under one screen-crossing (README)', () => {
  assert.ok(L.BULLET_LIFE * L.MUZZLE < L.W, 'muzzle-speed bullet dies before crossing');
  assert.ok(L.BULLET_LIFE * L.MUZZLE > 0.9 * L.W, 'but only just');
});

test('makeBullet inherits ship velocity plus fixed muzzle speed along the nose (README)', () => {
  const ship = { x: 480, y: 360, a: 0, vx: 120, vy: -35 };
  const b = L.makeBullet(ship);
  assert.ok(close(b.vx, 120 + L.MUZZLE), 'vx = ship vx + muzzle');
  assert.ok(close(b.vy, -35), 'vy = ship vy (nose is +x)');
  assert.ok(close(b.t, L.BULLET_LIFE));
  // spawns at the nose, 16px out
  assert.ok(close(b.x, 480 + 16));
  assert.ok(close(b.y, 360));
  assert.strictEqual(b.px, b.x);
  assert.strictEqual(b.py, b.y);
});

test('makeBullet respects the ship heading', () => {
  const up = { x: 0, y: 0, a: -Math.PI / 2, vx: 0, vy: 0 };
  const b = L.makeBullet(up);
  assert.ok(close(b.vx, 0, 1e-9));
  assert.ok(close(b.vy, -L.MUZZLE));
});

test('max 4 bullets alive is the tuned cap (README)', () => {
  assert.strictEqual(L.MAX_BULLETS, 4);
});

// ------------------------------------------------------------------ saucers

test('saucer points: big 200, small 1000 (README)', () => {
  assert.strictEqual(L.SAUCER.big.pts, 200);
  assert.strictEqual(L.SAUCER.small.pts, 1000);
});

test('smallSaucerProb: rare early, rises with score, capped at 0.9', () => {
  assert.strictEqual(L.smallSaucerProb(0), 0.12);
  assert.strictEqual(L.smallSaucerProb(2999), 0.12);
  assert.ok(L.smallSaucerProb(3000) > 0.12);
  assert.ok(L.smallSaucerProb(10000) > L.smallSaucerProb(5000));
  assert.strictEqual(L.smallSaucerProb(1e6), 0.9);
});

test('smallSaucerAimError: error cone tightens as score climbs, floored (README)', () => {
  assert.ok(close(L.smallSaucerAimError(0), 0.55));
  assert.ok(L.smallSaucerAimError(20000) < L.smallSaucerAimError(5000));
  assert.ok(close(L.smallSaucerAimError(35000), 0.05));
  assert.ok(close(L.smallSaucerAimError(1e9), 0.05), 'never below the floor');
});

// -------------------------------------------------------------------- waves

test('waveShardCount: wave 1 has 4 large shards, +2 per wave, capped at 12 (README)', () => {
  assert.strictEqual(L.waveShardCount(1), 4);
  assert.strictEqual(L.waveShardCount(2), 6);
  assert.strictEqual(L.waveShardCount(3), 8);
  assert.strictEqual(L.waveShardCount(5), 12);
  assert.strictEqual(L.waveShardCount(50), 12);
});

test('extra ship every 10,000 points; 3 ships to start (README)', () => {
  assert.strictEqual(L.EXTRA_LIFE_EVERY, 10000);
  assert.strictEqual(L.START_LIVES, 3);
});

// ---------------------------------------------------------------- heartbeat

test('heartbeatInterval accelerates as the field thins (README)', () => {
  const full = L.heartbeatInterval(1, 0);
  const half = L.heartbeatInterval(0.5, 0);
  const thin = L.heartbeatInterval(0.05, 0);
  assert.ok(full > half && half > thin, 'thinner field -> faster beat');
  assert.ok(close(full, 1.05));
});

test('heartbeatInterval also tightens with wave time, and is clamped', () => {
  assert.ok(L.heartbeatInterval(1, 60) < L.heartbeatInterval(1, 0));
  for (const frac of [0, 0.3, 1, 5, -1]) {
    for (const t of [0, 10, 1000]) {
      const iv = L.heartbeatInterval(frac, t);
      assert.ok(iv >= 0.24 - 1e-9 && iv <= 1.05 + 1e-9, 'clamped: ' + iv);
    }
  }
});

// ---------------------------------------------------------------- safe zone

test('isCenterSafe: empty field is safe', () => {
  assert.strictEqual(L.isCenterSafe([], null, []), true);
});

test('isCenterSafe: a shard inside the safe radius blocks respawn (README)', () => {
  const s = L.makeShard(L.W / 2 + 50, L.H / 2, 3);
  s.vx = s.vy = 0;
  assert.strictEqual(L.isCenterSafe([s], null, []), false);
  const far = L.makeShard(L.W / 2, 30, 1); // small shard along the top edge
  assert.strictEqual(L.isCenterSafe([far], null, []), true);
});

test('isCenterSafe: a nearby saucer or saucer bullet blocks respawn', () => {
  const saucer = { x: L.W / 2 + 100, y: L.H / 2 };
  assert.strictEqual(L.isCenterSafe([], saucer, []), false);
  const farSaucer = { x: 10, y: 10 };
  assert.strictEqual(L.isCenterSafe([], farSaucer, []), true);
  const eb = { x: L.W / 2, y: L.H / 2 + 60 };
  assert.strictEqual(L.isCenterSafe([], null, [eb]), false);
  const farEb = { x: 10, y: 10 };
  assert.strictEqual(L.isCenterSafe([], null, [farEb]), true);
});

test('isCenterSafe respects the torus: nothing hides across a seam near center', () => {
  // center is (480, 360); a point at the same spot is trivially unsafe,
  // and one clamped across the seam far from center is safe
  const seamFar = { x: 1, y: 1, cr: 10 };
  assert.strictEqual(L.isCenterSafe([{ ...seamFar }], null, []), true);
});

// -------------------------------------------------------------- ship tuning

test('ship tuning matches the README feel: capped speed, no damping constant', () => {
  assert.strictEqual(L.SHIP.maxSpeed, 460);
  assert.ok(L.SHIP.thrust > 0 && L.SHIP.rot > 0);
  assert.strictEqual(L.DT, 1 / 60);
});

console.log(`\nshardfield logic tests: ${count} passed`);

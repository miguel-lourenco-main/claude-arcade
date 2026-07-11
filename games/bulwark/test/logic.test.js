'use strict';
// Mechanics tests for Bulwark. Runs the real game.js in a stubbed DOM (see
// harness.js) and drives the 60 Hz update loop deterministically.
//   node games/bulwark/test/logic.test.js

const assert = require('assert');
const { load } = require('./harness.js');

const PLAYER_Y = 456;
const SAUCER_SCORES = [50, 100, 150, 300];

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log('ok - ' + name);
  } catch (e) {
    failures++;
    console.error('FAIL - ' + name);
    console.error('       ' + (e && e.message));
  }
}

// tick in small chunks, clearing invader bombs so random shots can't kill the
// player mid-test (bombs get their own dedicated tests)
function tickSafe(env, n) {
  let left = n;
  while (left > 0) {
    const step = Math.min(20, left);
    env.bw.tick(step);
    env.bw.snap().bombs.length = 0;
    left -= step;
  }
}

function maskSum(shield) {
  let n = 0;
  for (let i = 0; i < shield.mask.length; i++) n += shield.mask[i];
  return n;
}

function killPlayerOnce(env) {
  const s = env.bw.snap();
  s.bombs.length = 0;
  s.bombs.push({ x: s.playerX + 13, y: PLAYER_Y - 4, type: 0, phase: 0, speed: 3 });
  env.bw.tick(2);   // bomb lands
  env.bw.tick(85);  // death flash plays out
}

// ---------------------------------------------------------------- fresh game

test('fresh game starts with score 0, 3 lives, wave 1, 55 invaders', () => {
  const env = load();
  assert.strictEqual(env.bw.snap().state, 'attract');
  env.key(' '); // SPACE starts from attract
  const s = env.bw.snap();
  assert.strictEqual(s.state, 'playing');
  assert.strictEqual(s.score, 0);
  assert.strictEqual(s.lives, 3);
  assert.strictEqual(s.wave, 1);
  assert.strictEqual(s.alive, 55);
  assert.ok(!env.el('overlay').classList.contains('show'), 'overlay hidden in play');
});

// -------------------------------------------------------------- fleet motion

test('fleet march: one full pass (55 ticks) steps every invader 8px', () => {
  const env = load();
  env.key(' ');
  const s = env.bw.snap();
  const xs = s.invaders.map(i => i.x);
  const frames = s.invaders.map(i => i.frame);
  env.bw.tick(55);
  s.invaders.forEach((inv, i) => {
    assert.strictEqual(inv.x, xs[i] + 8, 'invader ' + i + ' stepped right');
    assert.strictEqual(inv.frame, frames[i] ^ 1, 'invader ' + i + ' flipped its march frame');
  });
});

test('fleet drops one row and reverses at the right margin', () => {
  const env = load();
  env.key(' ');
  const first = env.bw.snap().invaders[0];
  const y0 = first.y;
  assert.strictEqual(env.bw.snap().fleetDir, 1);
  let ticks = 0;
  while (env.bw.snap().fleetDir === 1 && ticks < 600) { tickSafe(env, 5); ticks += 5; }
  assert.strictEqual(env.bw.snap().fleetDir, -1, 'direction reversed within 600 ticks');
  tickSafe(env, 60); // let the queued drop pass complete
  assert.strictEqual(first.y, y0 + 16, 'fleet descended exactly one row');
});

test('speedup: pass length equals the alive count (thin fleet sprints)', () => {
  const env = load();
  env.key(' ');
  const s = env.bw.snap();
  // full fleet: a given invader moves once every 55 ticks
  const inv0 = s.invaders[44]; // bottom-left, first in cursor order
  const xA = inv0.x;
  env.bw.tick(1);
  assert.strictEqual(inv0.x, xA + 8, 'bottom-left moves on tick 1');
  env.bw.tick(54);
  assert.strictEqual(inv0.x, xA + 8, 'no second move before the pass ends');
  env.bw.tick(1);
  assert.strictEqual(inv0.x, xA + 16, 'second move exactly 55 ticks after the first');
  // thin the ranks to 5: same invader now moves every 5 ticks
  s.invaders.forEach((inv, i) => { if (i < 44 || i > 48) inv.alive = false; });
  const xB = inv0.x;
  let t = 0;
  while (inv0.x === xB && t < 10) { env.bw.tick(1); t++; }
  assert.ok(t <= 5, 'thin fleet: moved within one short pass (' + t + ' ticks)');
  const xC = inv0.x;
  env.bw.tick(4);
  assert.strictEqual(inv0.x, xC, 'thin fleet: still waiting for its next pass');
  env.bw.tick(1);
  assert.strictEqual(inv0.x, xC + 8, 'thin fleet: moves again exactly 5 ticks later');
});

// ------------------------------------------------------------------- firing

test('one bullet on screen: second SPACE while a bolt flies does nothing', () => {
  const env = load();
  env.key(' ');           // start
  env.key(' ');           // fire
  let s = env.bw.snap();
  assert.ok(s.bullet, 'bullet exists after firing');
  assert.strictEqual(s.bullet.y, PLAYER_Y - 8);
  env.bw.tick(2);
  assert.strictEqual(env.bw.snap().bullet.y, PLAYER_Y - 8 - 16, 'bullet climbed');
  env.key(' ');           // try to double-fire
  assert.strictEqual(env.bw.snap().bullet.y, PLAYER_Y - 8 - 16, 'no new bullet spawned');
});

test('bullet kills an invader and scores by rank (burrower 10, spry 30)', () => {
  const env = load();
  env.key(' ');
  const s = env.bw.snap();
  // note: the fleet marches (+8px max) before bullets update inside a tick,
  // so aim at the sprite's centre to cover both positions
  const bottom = s.invaders[44]; // burrower
  env.bw.setBullet({ x: bottom.x + 20, y: bottom.y + 14 });
  env.bw.tick(1);
  let s2 = env.bw.snap();
  assert.strictEqual(bottom.alive, false, 'burrower destroyed');
  assert.strictEqual(s2.score, 10, 'burrower pays 10');
  assert.strictEqual(s2.bullet, null, 'bullet consumed');
  const top = s2.invaders[0]; // spry (16px wide, centered in a 32px cell)
  env.bw.setBullet({ x: top.x + 18, y: top.y + 14 });
  env.bw.tick(1);
  s2 = env.bw.snap();
  assert.strictEqual(top.alive, false, 'spry destroyed');
  assert.strictEqual(s2.score, 40, 'spry pays 30 more');
});

// ------------------------------------------------------------------ shields

test('player bullet chews pixels out of a shield', () => {
  const env = load();
  env.key(' ');
  const shield = env.bw.snap().shields[0]; // x = 34
  const before = maskSum(shield);
  env.bw.setPlayerX(32); // bullet x = 44 -> shield-local column 10 (solid)
  env.key(' ');
  env.bw.tick(15);
  const s = env.bw.snap();
  assert.strictEqual(s.bullet, null, 'bullet absorbed by the shield');
  assert.ok(maskSum(shield) < before - 20, 'shield lost a real chunk of pixels');
});

test('invader bomb chews pixels out of a shield', () => {
  const env = load();
  env.key(' ');
  const shield = env.bw.snap().shields[1]; // x = 146
  const before = maskSum(shield);
  env.bw.snap().bombs.push({ x: 168, y: 392, type: 0, phase: 0, speed: 3 });
  env.bw.tick(3);
  const s = env.bw.snap();
  assert.ok(maskSum(shield) < before - 20, 'shield lost pixels to the bomb');
  assert.ok(!s.bombs.some(b => b.x === 168 && b.y < 410), 'bomb consumed on impact');
});

// -------------------------------------------------------------------- bombs

test('invaders shoot: bombs spawn on their own and fall', () => {
  const env = load();
  env.key(' ');
  env.bw.setPlayerX(8); // park far left; early bombs are cleared before they land
  let guard = 0;
  while (env.bw.snap().bombs.length === 0 && guard < 200) { env.bw.tick(5); guard += 5; }
  const s = env.bw.snap();
  assert.ok(s.bombs.length > 0, 'a bomb spawned within 200 ticks');
  const y0 = s.bombs[0].y;
  env.bw.tick(3);
  assert.ok(s.bombs.length === 0 || s.bombs[0].y > y0, 'bomb falls downward');
});

test('a bomb hit costs a life, then the cannon respawns', () => {
  const env = load();
  env.key(' ');
  killPlayerOnce(env);
  const s = env.bw.snap();
  assert.strictEqual(s.lives, 2, 'one life lost');
  assert.strictEqual(s.state, 'playing', 'respawned after the death flash');
});

// ------------------------------------------------------------ lives / defeat

test('three deaths end the game; any key restarts after the guard', () => {
  const env = load();
  env.key(' ');
  killPlayerOnce(env);
  killPlayerOnce(env);
  killPlayerOnce(env);
  let s = env.bw.snap();
  assert.strictEqual(s.state, 'over', 'game over at 0 lives');
  assert.ok(env.el('overlay').classList.contains('show'), 'overlay shown');
  assert.ok(env.el('overlay').classList.contains('dead'), 'overlay in dead style');
  assert.strictEqual(env.el('overlay-title').textContent, 'GAME OVER');
  env.key('x'); // guard still up: ignored
  assert.strictEqual(env.bw.snap().state, 'over', 'restart guard swallows instant keys');
  env.bw.tick(31);
  env.key('x');
  s = env.bw.snap();
  assert.strictEqual(s.state, 'playing', 'any key restarts after the guard');
  assert.strictEqual(s.score, 0);
  assert.strictEqual(s.lives, 3);
});

test('invasion: ranks reaching the cannon row is game over', () => {
  const env = load();
  env.key(' ');
  env.bw.snap().invaders[44].y = PLAYER_Y - 16; // bottom-left, first to move
  env.bw.tick(1);
  const s = env.bw.snap();
  assert.strictEqual(s.state, 'over', 'invasion ends the game');
  assert.strictEqual(s.lives, 0);
});

// ------------------------------------------------------------------- saucer

test('saucer crosses the top and pays a bonus when clipped', () => {
  const env = load();
  env.key(' ');
  env.bw.rushSaucer();
  env.bw.tick(2);
  let s = env.bw.snap();
  assert.ok(s.saucer, 'saucer spawned');
  tickSafe(env, 40); // let it come on screen
  s = env.bw.snap();
  assert.ok(s.saucer, 'saucer still crossing');
  const before = s.score;
  env.bw.setBullet({ x: s.saucer.x + 10, y: 44 });
  env.bw.tick(1);
  s = env.bw.snap();
  const bonus = s.score - before;
  assert.ok(SAUCER_SCORES.includes(bonus), 'bonus ' + bonus + ' is one of ' + SAUCER_SCORES);
  assert.strictEqual(s.saucer, null, 'saucer destroyed');
  assert.ok(s.popups.some(p => p.text === String(bonus)), 'bonus popup shown at the hit spot');
});

// -------------------------------------------------------------- wave advance

test('clearing the fleet advances the wave; next fleet starts one row lower', () => {
  const env = load();
  env.key(' ');
  const s = env.bw.snap();
  const y0 = s.invaders[0].y;
  s.invaders.forEach((inv, i) => { if (i !== 0) inv.alive = false; });
  // the lone survivor marches before the bullet updates: lead the shot
  env.bw.setBullet({ x: s.invaders[0].x + 20, y: s.invaders[0].y + 14 });
  env.bw.tick(1);
  assert.strictEqual(env.bw.snap().state, 'wavepause', 'brief pause between waves');
  env.bw.tick(110);
  const s2 = env.bw.snap();
  assert.strictEqual(s2.wave, 2, 'wave counter advanced');
  assert.strictEqual(s2.state, 'playing');
  assert.strictEqual(s2.alive, 55, 'fresh full fleet');
  assert.strictEqual(s2.invaders[0].y, y0 + 16, 'wave 2 fleet starts one row lower');
  assert.strictEqual(env.el('wave').textContent, 2, 'HUD wave updated');
});

// -------------------------------------------------------- extra life / score

test('extra cannon awarded at 1500 points, once', () => {
  const env = load();
  env.key(' ');
  env.bw.addScore(1500);
  assert.strictEqual(env.bw.snap().lives, 4, 'extra cannon granted');
  env.bw.addScore(1500);
  assert.strictEqual(env.bw.snap().lives, 4, 'only granted once');
});

test('high score persists to localStorage under the arcade namespace', () => {
  const env = load();
  env.key(' ');
  env.bw.addScore(240);
  assert.strictEqual(env.bw.snap().hiscore, 240);
  assert.strictEqual(env.store.get('arcade.bulwark.hiscore'), '240');
  assert.strictEqual(env.el('best').textContent, 240, 'HUD best updated');
});

// -------------------------------------------------------------------- reset

test('reset button mid-game: fresh score/lives/wave, best untouched', () => {
  const env = load();
  env.key(' ');
  env.bw.addScore(300);
  killPlayerOnce(env); // lives down to 2
  assert.strictEqual(env.bw.snap().lives, 2);
  env.click('reset-btn');
  const s = env.bw.snap();
  assert.strictEqual(s.state, 'playing', 'game restarts immediately');
  assert.strictEqual(s.score, 0, 'score reset');
  assert.strictEqual(s.lives, 3, 'lives reset');
  assert.strictEqual(s.wave, 1, 'wave reset');
  assert.strictEqual(s.alive, 55, 'fresh fleet');
  assert.strictEqual(s.hiscore, 300, 'high score untouched');
  assert.strictEqual(env.store.get('arcade.bulwark.hiscore'), '300');
});

test('reset button works on the game-over screen', () => {
  const env = load();
  env.key(' ');
  env.bw.addScore(50);
  killPlayerOnce(env);
  killPlayerOnce(env);
  killPlayerOnce(env);
  assert.strictEqual(env.bw.snap().state, 'over');
  env.click('reset-btn');
  const s = env.bw.snap();
  assert.strictEqual(s.state, 'playing');
  assert.strictEqual(s.score, 0);
  assert.strictEqual(s.hiscore, 50, 'best kept');
});

test('R key resets mid-game (and even while paused)', () => {
  const env = load();
  env.key(' ');
  env.bw.addScore(120);
  env.key('p'); // pause first — reset must still work
  assert.strictEqual(env.bw.snap().paused, true);
  env.key('r');
  const s = env.bw.snap();
  assert.strictEqual(s.state, 'playing');
  assert.strictEqual(s.paused, false, 'reset clears pause');
  assert.strictEqual(s.score, 0);
  assert.strictEqual(s.hiscore, 120, 'best kept');
});

test('reset is a no-op on the attract screen', () => {
  const env = load();
  env.click('reset-btn');
  assert.strictEqual(env.bw.snap().state, 'attract', 'still attract');
  assert.ok(env.el('overlay').classList.contains('show'), 'attract overlay untouched');
});

// ------------------------------------------------------------- pause / audio

test('P pauses and resumes; losing window focus auto-pauses', () => {
  const env = load();
  env.key(' ');
  env.key('p');
  let s = env.bw.snap();
  assert.strictEqual(s.paused, true);
  assert.strictEqual(env.el('overlay-title').textContent, 'PAUSED');
  const x0 = s.playerX;
  env.key('ArrowRight');
  env.bw.tick(10);
  assert.strictEqual(env.bw.snap().playerX, x0, 'world frozen while paused');
  env.keyUp('ArrowRight');
  env.key('p');
  assert.strictEqual(env.bw.snap().paused, false, 'P resumes');
  env.blurWindow();
  assert.strictEqual(env.bw.snap().paused, true, 'blur auto-pauses');
});

test('audio toggles via M and the header button, persisted', () => {
  const env = load();
  assert.strictEqual(env.bw.snap().audioOn, true, 'sound defaults on');
  env.key('m');
  assert.strictEqual(env.bw.snap().audioOn, false);
  assert.strictEqual(env.store.get('arcade.bulwark.audio'), 'off');
  assert.strictEqual(env.el('audio-toggle').textContent, 'sound: off');
  env.click('audio-toggle');
  assert.strictEqual(env.bw.snap().audioOn, true);
  assert.strictEqual(env.store.get('arcade.bulwark.audio'), 'on');
  assert.strictEqual(env.el('audio-toggle').textContent, 'sound: on');
});

// --------------------------------------------------------------------- done

if (failures) {
  console.error('\n' + failures + ' test(s) FAILED');
  process.exit(1);
}
console.log('\nall logic tests passed');

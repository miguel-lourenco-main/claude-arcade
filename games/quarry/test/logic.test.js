'use strict';

/* Core-rules tests for Quarry, run against the real game.js via the
   DOM-stub harness. Usage: node games/quarry/test/logic.test.js */

const assert = require('assert');
const { load } = require('./harness.js');

let passed = 0;
function test(name, fn) {
  const q = load(); // fresh game instance per test
  try {
    fn(q);
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    console.error(err && err.stack || err);
    process.exitCode = 1;
    process.exit(1);
  }
}

/* helpers */
function freshRun(q) {
  q.startGame();
  assert.strictEqual(q.G.state, 'playing');
  assert.ok(q.G.piece, 'a piece spawned');
}
function fillRow(q, y, except) {
  for (let x = 0; x < q.COLS; x++) {
    q.G.board[y][x] = (except && except.includes(x)) ? null : { p: 0, s: 1 };
  }
}
function boardCellCount(q) {
  let n = 0;
  for (const row of q.G.board) for (const c of row) if (c) n++;
  return n;
}

/* ---------------- piece data ---------------- */

test('twelve pentominoes, five cells each, in every orientation', q => {
  assert.strictEqual(q.PIECES.length, 12);
  const names = new Set(q.PIECES.map(p => p.name));
  assert.strictEqual(names.size, 12);
  for (const p of q.PIECES) {
    assert.strictEqual(p.rots.length, 4);
    for (const rot of p.rots) {
      assert.strictEqual(rot.length, 5, `${p.name} keeps 5 cells per rotation`);
      const uniq = new Set(rot.map(([x, y]) => `${x},${y}`));
      assert.strictEqual(uniq.size, 5, `${p.name} rotation has no overlapping cells`);
    }
  }
});

/* ---------------- bag randomizer ---------------- */

test('bag randomizer deals every pentomino exactly once per bag', q => {
  for (let round = 0; round < 5; round++) {
    q.G.bag = [];
    const drawn = [];
    for (let i = 0; i < 12; i++) drawn.push(q.drawFromBag());
    assert.strictEqual(new Set(drawn).size, 12, 'all 12 pieces in one bag');
    assert.strictEqual(q.G.bag.length, 0, 'bag exactly emptied');
  }
});

test('queue preview keeps at least 3 upcoming stones', q => {
  freshRun(q);
  assert.ok(q.G.queue.length >= 3);
  for (const idx of q.G.queue) assert.ok(idx >= 0 && idx < 12);
});

/* ---------------- gravity / fall / lock delay ---------------- */

test('gravity curve: 800ms at depth 1, faster each depth, 80ms floor', q => {
  assert.strictEqual(q.gravityMs(1), 800);
  for (let l = 2; l <= 9; l++) assert.ok(q.gravityMs(l) < q.gravityMs(l - 1));
  assert.strictEqual(q.gravityMs(60), 80);
});

test('piece falls one row per gravity interval', q => {
  freshRun(q);
  const y0 = q.G.piece.y;
  q.tick(790);
  assert.strictEqual(q.G.piece.y, y0, 'no fall before the 800ms interval');
  q.tick(20);
  assert.strictEqual(q.G.piece.y, y0 + 1, 'fell exactly one row after 800ms');
});

test('lock delay: resting stone locks after 500ms, not before', q => {
  freshRun(q);
  q.G.piece.y = q.ghostY(); // rest it on the floor
  q.tick(480);
  assert.ok(q.G.piece, 'still active before LOCK_MS');
  assert.strictEqual(boardCellCount(q), 0);
  q.tick(50);
  assert.strictEqual(boardCellCount(q), 5, 'stone locked into the pit');
});

test('successful move while resting resets the lock timer, max 12 times', q => {
  freshRun(q);
  q.G.piece.y = q.ghostY();
  q.tick(400);
  assert.ok(q.G.lockTimer > 0);
  const moved = q.tryMove(q.G.piece.x > 3 ? -1 : 1);
  assert.ok(moved);
  assert.strictEqual(q.G.lockTimer, 0, 'lock timer reset by the shift');
  assert.strictEqual(q.G.lockResets, 1);
  q.G.lockResets = q.LOCK_RESETS; // resets exhausted
  q.tick(400);
  const t = q.G.lockTimer;
  q.tryMove(q.G.piece.x > 3 ? -1 : 1);
  assert.strictEqual(q.G.lockTimer, t, 'no reset after LOCK_RESETS uses');
});

test('soft drop is faster and scores +1 per cell', q => {
  freshRun(q);
  const y0 = q.G.piece.y, s0 = q.G.score;
  q.G.softDown = true;
  q.tick(90); // 800/10 = 80ms per row when easing down
  assert.strictEqual(q.G.piece.y, y0 + 1);
  assert.strictEqual(q.G.score, s0 + 1);
});

/* ---------------- rotation + kicks ---------------- */

test('rotation cycles through 4 orientations', q => {
  freshRun(q);
  q.G.piece = { idx: 5, rot: 0, x: 3, y: 6, seed: 1 }; // T stone mid-air
  assert.ok(q.tryRotate(1));
  assert.strictEqual(q.G.piece.rot, 1);
  assert.ok(q.tryRotate(-1));
  assert.strictEqual(q.G.piece.rot, 0);
  assert.ok(q.tryRotate(-1));
  assert.strictEqual(q.G.piece.rot, 3);
});

test('wall kick: blocked rotation shifts the stone to a fitting offset', q => {
  freshRun(q);
  // vertical I against the left wall: cells sit in column x+2, so x = -2.
  q.G.piece = { idx: 1, rot: 1, x: -2, y: 10, seed: 1 };
  assert.ok(q.fits(1, 1, -2, 10), 'setup: vertical I hugs the wall');
  assert.ok(!q.fits(1, 0, -2, 10), 'setup: horizontal would poke through the wall');
  assert.ok(q.tryRotate(1), 'rotation succeeds via kick');
  assert.strictEqual(q.G.piece.rot, 2);
  assert.strictEqual(q.G.piece.x, 0, 'kicked +2 off the wall (KICKS order)');
});

test('rotation fails (no state change) when no kick fits', q => {
  freshRun(q);
  // box the X stone in on all sides so no kick offset can fit a rotation
  q.G.piece = { idx: 1, rot: 1, x: -2, y: q.ROWS - 5, seed: 1 }; // vertical I in col 0
  for (let y = 0; y < q.ROWS; y++) fillRow(q, y, [0]); // only column 0 open
  const before = JSON.stringify(q.G.piece);
  assert.ok(!q.tryRotate(1), 'rotation rejected');
  assert.strictEqual(JSON.stringify(q.G.piece), before);
});

/* ---------------- ghost + hard drop ---------------- */

test('ghost piece marks the exact landing row', q => {
  freshRun(q);
  q.G.piece = { idx: 5, rot: 0, x: 3, y: 2, seed: 1 };
  const gy = q.ghostY();
  assert.ok(gy > q.G.piece.y, 'ghost is below the stone');
  assert.ok(q.fits(5, 0, 3, gy), 'ghost position fits');
  assert.ok(!q.fits(5, 0, 3, gy + 1), 'one row lower would collide');
});

test('hard drop locks instantly and scores +2 per cell dropped', q => {
  freshRun(q);
  q.G.piece = { idx: 5, rot: 0, x: 3, y: 2, seed: 1 };
  const dist = q.ghostY() - 2;
  const s0 = q.G.score;
  q.hardDrop();
  assert.strictEqual(q.G.score, s0 + dist * 2);
  assert.strictEqual(boardCellCount(q), 5, 'stone locked immediately');
  assert.ok(q.G.piece, 'next stone spawned');
});

/* ---------------- stash (hold) ---------------- */

test('stash stores the stone, swaps thereafter, once per drop', q => {
  freshRun(q);
  const first = q.G.piece.idx;
  q.stashPiece();
  assert.strictEqual(q.G.hold, first, 'first stash stored');
  assert.ok(q.G.holdUsed);
  const second = q.G.piece.idx;
  q.stashPiece(); // must be a no-op until the next drop
  assert.strictEqual(q.G.hold, first);
  assert.strictEqual(q.G.piece.idx, second);
  q.hardDrop(); // lock -> stash unlocks
  assert.strictEqual(q.G.holdUsed, false);
  const third = q.G.piece.idx;
  q.stashPiece();
  assert.strictEqual(q.G.hold, third, 'swap stored the new stone');
  assert.strictEqual(q.G.piece.idx, first, 'swap gave back the stashed stone');
});

/* ---------------- seam clears + scoring + depth ---------------- */

test('completing a row starts a clear, scores 100 x depth, then collapses', q => {
  freshRun(q);
  fillRow(q, q.ROWS - 1, [0, 1, 2, 3, 4]);
  q.G.piece = { idx: 1, rot: 0, x: 0, y: 10, seed: 1 }; // horizontal I over the gap
  const s0 = q.G.score;
  q.hardDrop();
  assert.strictEqual(q.G.state, 'clearing');
  assert.strictEqual(q.G.lines, 1);
  const dropPts = (q.ROWS - 1 - 2 - 10) * 2;
  assert.strictEqual(q.G.score, s0 + dropPts + 100 * 1);
  q.tick(q.G.clearDur + 20);
  assert.strictEqual(q.G.state, 'playing');
  assert.strictEqual(boardCellCount(q), 0, 'cleared seam collapsed away');
});

test('multi-seam scoring is superlinear and multiplied by depth', q => {
  for (const [n, base] of [[2, 300], [3, 700], [4, 1600], [5, 4000]]) {
    const w = load();
    w.startGame();
    w.G.level = 3;
    const rows = [];
    for (let i = 0; i < n; i++) rows.push(w.ROWS - 1 - i);
    const s0 = w.G.score;
    w.startClear(rows);
    assert.strictEqual(w.G.score, s0 + base * 3, `${n} seams pay ${base} x depth`);
    assert.strictEqual(w.CLEAR_NAME[n].length > 0, true);
  }
});

test('depth increases every 10 seams and gravity tightens', q => {
  freshRun(q);
  q.G.lines = 9;
  q.startClear([q.ROWS - 1]);
  assert.strictEqual(q.G.lines, 10);
  assert.strictEqual(q.G.level, 2, 'depth 2 at 10 seams');
  assert.ok(q.gravityMs(q.G.level) < q.gravityMs(1));
});

/* ---------------- DAS auto-shift ---------------- */

test('DAS: held direction repeats after ~170ms, then every ~40ms', q => {
  freshRun(q);
  q.G.piece = { idx: 9, rot: 0, x: 3, y: 8, seed: 1 }; // X stone, plenty of room
  q.keydown('ArrowRight');
  const x0 = q.G.piece.x;
  q.tick(150);
  assert.strictEqual(q.G.piece.x, x0, 'no repeat before DAS delay');
  q.tick(34); // past 170ms
  assert.strictEqual(q.G.piece.x, x0 + 1, 'first auto-shift after DAS_MS');
  q.tick(84); // two ARR periods
  assert.strictEqual(q.G.piece.x, x0 + 3, 'repeats every ARR_MS');
  q.keyup('ArrowRight');
  q.tick(200);
  assert.strictEqual(q.G.piece.x, x0 + 3, 'release stops the repeat');
});

/* ---------------- pause ---------------- */

test('pause freezes gravity and resume restores it', q => {
  freshRun(q);
  const y0 = q.G.piece.y;
  q.keydown('p');
  assert.strictEqual(q.G.state, 'paused');
  q.tick(2000);
  assert.strictEqual(q.G.piece.y, y0, 'frozen while paused');
  q.keydown('p');
  assert.strictEqual(q.G.state, 'playing');
});

/* ---------------- restart confirmation ---------------- */

test('R during a run opens the confirm dialog instead of restarting', q => {
  freshRun(q);
  q.G.score = 555;
  q.keydown('r');
  assert.strictEqual(q.G.state, 'confirm');
  assert.strictEqual(q.G.score, 555, 'run NOT restarted');
  assert.ok(!q.el('overlay').classList.contains('hidden'), 'dialog overlay shown');
  assert.ok(!q.el('confirm-buttons').classList.contains('hidden'), 'confirm buttons shown');
  assert.ok(/restart/i.test(q.el('overlay-title').textContent));
  assert.ok(/restart this run\?/i.test(q.el('overlay-sub').innerHTML), 'asks "Restart this run?"');
});

test('confirm dialog freezes the game while open', q => {
  freshRun(q);
  const y0 = q.G.piece.y;
  q.keydown('r');
  q.tick(3000);
  assert.strictEqual(q.G.piece.y, y0, 'no gravity while dialog is open');
});

test('Esc (and the KEEP DIGGING button) cancels and resumes the same run', q => {
  freshRun(q);
  q.G.score = 777;
  const piece = JSON.stringify(q.G.piece);
  q.keydown('r');
  q.keydown('Escape');
  assert.strictEqual(q.G.state, 'playing');
  assert.strictEqual(q.G.score, 777, 'score untouched');
  assert.strictEqual(JSON.stringify(q.G.piece), piece, 'same stone still falling');
  assert.ok(q.el('overlay').classList.contains('hidden'), 'dialog closed');
  // cancel via the button too
  q.keydown('r');
  assert.strictEqual(q.G.state, 'confirm');
  q.el('confirm-no').click();
  assert.strictEqual(q.G.state, 'playing');
  assert.strictEqual(q.G.score, 777);
});

test('Enter (and the RESTART button) confirms and starts a fresh run', q => {
  freshRun(q);
  q.G.score = 999;
  q.keydown('r');
  q.keydown('Enter');
  assert.strictEqual(q.G.state, 'playing');
  assert.strictEqual(q.G.score, 0, 'fresh run');
  assert.strictEqual(boardCellCount(q), 0);
  // now via the button
  q.G.score = 42;
  q.keydown('r');
  q.el('confirm-yes').click();
  assert.strictEqual(q.G.score, 0);
  assert.strictEqual(q.G.state, 'playing');
});

test('held inputs are dropped when the dialog opens', q => {
  freshRun(q);
  q.keydown('ArrowLeft');
  q.G.softDown = true;
  q.keydown('r');
  assert.strictEqual(q.G.dasDir, 0);
  assert.strictEqual(q.G.heldDirs.length, 0);
  assert.strictEqual(q.G.softDown, false);
});

test('other keys neither confirm nor cancel the dialog', q => {
  freshRun(q);
  q.keydown('r');
  for (const k of [' ', 'x', 'ArrowLeft', 'r', 'p', 'c']) q.keydown(k);
  assert.strictEqual(q.G.state, 'confirm', 'dialog still open');
});

test('game-over restart stays instant (no dialog)', q => {
  freshRun(q);
  q.G.score = 10;
  q.gameOver();
  assert.strictEqual(q.G.state, 'over');
  q.keydown('r');
  assert.strictEqual(q.G.state, 'playing', 'restarted immediately');
  assert.strictEqual(q.G.score, 0);
});

/* ---------------- top-out + high score + audio ---------------- */

test('game over only when a new stone cannot be placed at all', q => {
  freshRun(q);
  for (let y = 0; y < q.ROWS; y++) fillRow(q, y);
  q.nextPiece();
  assert.strictEqual(q.G.state, 'over');
});

test('high score persists to localStorage arcade.quarry.high', q => {
  freshRun(q);
  q.G.score = 4321;
  q.gameOver();
  assert.strictEqual(q.G.high, 4321);
  assert.strictEqual(q.localStorage.getItem('arcade.quarry.high'), '4321');
  q.G.score = 100; // lower score must not overwrite
  q.startGame();
  q.gameOver();
  assert.strictEqual(q.localStorage.getItem('arcade.quarry.high'), '4321');
});

test('audio toggle flips and persists arcade.quarry.audio; M key works everywhere', q => {
  assert.strictEqual(q.AudioSys.on, true);
  q.keydown('m');
  assert.strictEqual(q.AudioSys.on, false);
  assert.strictEqual(q.localStorage.getItem('arcade.quarry.audio'), 'off');
  assert.strictEqual(q.el('audio-toggle').textContent, 'SND OFF');
  q.startGame();
  q.keydown('r'); // even with the confirm dialog open
  q.keydown('m');
  assert.strictEqual(q.AudioSys.on, true);
  assert.strictEqual(q.localStorage.getItem('arcade.quarry.audio'), 'on');
  assert.strictEqual(q.G.state, 'confirm', 'M did not disturb the dialog');
});

console.log(`\n${passed} logic tests passed`);

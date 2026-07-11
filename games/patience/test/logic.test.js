// logic.test.js — node-runnable tests for the pure Klondike rules in src/game.js
// (plus the seeded deck in src/cards.js). Run: node games/patience/test/logic.test.js
// Plain asserts; exits 0 on pass, 1 on the first failure.

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// The game files are classic scripts that attach to window.Patience.
globalThis.window = globalThis;
const SRC = path.join(__dirname, '..', 'src');
vm.runInThisContext(fs.readFileSync(path.join(SRC, 'cards.js'), 'utf8'), { filename: 'cards.js' });
vm.runInThisContext(fs.readFileSync(path.join(SRC, 'game.js'), 'utf8'), { filename: 'game.js' });

const { Game, isRed, shuffledDeck, mulberry32, RANKS } = window.Patience;

let passed = 0;
function ok(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  passed++;
}
function eq(a, b, msg) {
  ok(Object.is(a, b), `${msg} (expected ${b}, got ${a})`);
}

function snapshot(g) {
  const c = (x) => `${x.r}.${x.s}.${x.up ? 1 : 0}`;
  return JSON.stringify({
    tab: g.tab.map((p) => p.map(c)),
    stock: g.stock.map(c),
    waste: g.waste.map(c),
    found: g.found.map((p) => p.map(c)),
  });
}

// ---------- deck & PRNG ----------

{
  const r1 = mulberry32(123), r2 = mulberry32(123);
  const a = [r1(), r1(), r1()], b = [r2(), r2(), r2()];
  ok(a.every((v, i) => v === b[i]), 'mulberry32 is deterministic for a given seed');
  ok(a.every((v) => v >= 0 && v < 1), 'mulberry32 emits values in [0,1)');
}

{
  const d = shuffledDeck(7);
  eq(d.length, 52, 'shuffledDeck deals 52 cards');
  const keys = new Set(d.map((c) => `${c.r}.${c.s}`));
  eq(keys.size, 52, 'shuffledDeck deals 52 UNIQUE cards');
  ok(d.every((c) => c.r >= 1 && c.r <= 13 && c.s >= 0 && c.s <= 3), 'ranks 1..13, suits 0..3');
  ok(d.every((c) => c.up === false), 'all cards start face-down');
  eq(RANKS.length, 13, 'thirteen rank labels');
}

// ---------- deal shape ----------

{
  const g = new Game(42, true);
  for (let i = 0; i < 7; i++) {
    eq(g.tab[i].length, i + 1, `tableau pile ${i} has ${i + 1} cards`);
    for (let j = 0; j < g.tab[i].length; j++) {
      eq(g.tab[i][j].up, j === g.tab[i].length - 1, `pile ${i} card ${j}: only the top is face-up`);
    }
  }
  eq(g.stock.length, 24, 'stock holds the remaining 24 cards');
  eq(g.waste.length, 0, 'waste starts empty');
  ok(g.found.every((f) => f.length === 0), 'foundations start empty');
  eq(g.moves, 0, 'move counter starts at 0');
  const all = new Set();
  for (const p of [...g.tab, g.stock]) for (const c of p) all.add(`${c.r}.${c.s}`);
  eq(all.size, 52, 'deal uses all 52 unique cards');
}

// ---------- seeded reproducibility ----------

{
  const a = new Game(12345, true);
  const b = new Game(12345, true);
  eq(snapshot(a), snapshot(b), 'same seed produces the identical deal');
  const c = new Game(12346, true);
  ok(snapshot(a) !== snapshot(c), 'different seed produces a different deal');
}

// ---------- draw-1 / draw-3 / recycle ----------

{
  const g = new Game(9, false); // draw 1
  const top = g.stock[g.stock.length - 1];
  const res = g.draw();
  eq(res.t, 'draw', 'draw-1 reports a draw');
  eq(res.n, 1, 'draw-1 moves exactly one card');
  eq(g.waste.length, 1, 'draw-1 leaves one card on the waste');
  ok(g.waste[0] === top && top.up === true, 'the drawn card is the old stock top, now face-up');
  eq(g.moves, 1, 'a draw counts as a move');
}

{
  const g = new Game(9, true); // draw 3
  const res = g.draw();
  eq(res.n, 3, 'draw-3 moves three cards');
  eq(g.waste.length, 3, 'waste holds three after a draw-3');
  while (g.stock.length >= 3) g.draw();
  const rem = g.stock.length;
  if (rem > 0) {
    const r2 = g.draw();
    eq(r2.n, rem, 'a short stock draws only what remains');
  }
  eq(g.stock.length, 0, 'stock fully drained');
  eq(g.waste.length, 24, 'all 24 stock cards ended on the waste');

  const wasteOrder = g.waste.map((c) => `${c.r}.${c.s}`);
  const rec = g.draw();
  eq(rec.t, 'recycle', 'drawing on an empty stock recycles the waste');
  eq(g.stock.length, 24, 'recycle returns every waste card to the stock');
  eq(g.waste.length, 0, 'waste is empty after a recycle');
  ok(g.stock.every((c) => !c.up), 'recycled cards are face-down again');
  // recycle must preserve deal order: drawing again yields the same first card
  g.draw();
  eq(`${g.waste[0].r}.${g.waste[0].s}`, wasteOrder[0], 'recycle preserves the original draw order');
}

{
  const g = new Game(9, true);
  eq(g.draw() && true, true, 'sanity draw');
  g.stock.length = 0;
  g.waste.length = 0;
  eq(g.draw(), null, 'draw with empty stock AND empty waste is a no-op (null)');
}

// ---------- move legality (canDrop) ----------

{
  const g = new Game(1, true);
  const red7 = { r: 7, s: 2, up: true };   // 7 diamonds
  const blk6 = { r: 6, s: 0, up: true };   // 6 spades
  const red6 = { r: 6, s: 1, up: true };   // 6 hearts
  const king = { r: 13, s: 3, up: true };
  const queenR = { r: 12, s: 1, up: true };

  g.tab[0] = [red7];
  ok(g.canDrop([blk6], { k: 'tab', i: 0 }), 'tableau accepts descending alternate color');
  ok(!g.canDrop([red6], { k: 'tab', i: 0 }), 'tableau rejects same color');
  ok(!g.canDrop([{ r: 5, s: 0, up: true }], { k: 'tab', i: 0 }), 'tableau rejects rank gaps');
  g.tab[1] = [];
  ok(g.canDrop([king], { k: 'tab', i: 1 }), 'empty column accepts a King');
  ok(g.canDrop([king, queenR], { k: 'tab', i: 1 }), 'empty column accepts a King-led run');
  ok(!g.canDrop([queenR], { k: 'tab', i: 1 }), 'empty column rejects non-Kings');
  g.tab[2] = [{ r: 9, s: 0, up: false }];
  ok(!g.canDrop([{ r: 8, s: 1, up: true }], { k: 'tab', i: 2 }), 'cannot stack on a face-down card');

  ok(g.canDrop([{ r: 1, s: 2, up: true }], { k: 'found', i: 2 }), 'empty foundation accepts its ace');
  ok(!g.canDrop([{ r: 1, s: 2, up: true }], { k: 'found', i: 1 }), 'foundation rejects the wrong suit');
  ok(!g.canDrop([{ r: 2, s: 2, up: true }], { k: 'found', i: 2 }), 'foundation rejects out-of-sequence rank');
  g.found[3] = [{ r: 1, s: 3, up: true }];
  ok(g.canDrop([{ r: 2, s: 3, up: true }], { k: 'found', i: 3 }), 'foundation accepts the next rank in suit');
  ok(!g.canDrop([{ r: 2, s: 3, up: true }, { r: 3, s: 3, up: true }], { k: 'found', i: 3 }),
    'foundations only take single cards, never runs');
  ok(!g.canDrop([], { k: 'tab', i: 0 }), 'empty selection is never droppable');
}

// ---------- move + auto-flip + run moves ----------

{
  // seed 1 (verified layout): pile 3 = (3♦)(K♣)(6♥) 4♣ ; pile 6 top = 5♦
  const g = new Game(1, true);
  const four = g.tab[3][3];
  const under = g.tab[3][2];
  eq(under.up, false, 'card under the moved top starts face-down');
  ok(g.move({ k: 'tab', i: 3, idx: 3 }, { k: 'tab', i: 6 }), 'legal tableau move succeeds');
  eq(g.tab[3].length, 3, 'source pile shrank');
  eq(g.tab[6].length, 8, 'destination pile grew');
  ok(g.tab[6][7] === four, 'the moved card sits on top of the destination');
  eq(under.up, true, 'newly exposed card auto-flipped face-up');
  eq(g.moves, 1, 'the move was counted');
  ok(!g.move({ k: 'tab', i: 0, idx: 0 }, { k: 'tab', i: 6 }), 'illegal move is rejected');
  eq(g.moves, 1, 'rejected moves are not counted');
}

{
  // seed 3 (verified layout): 10♥ -> J♣, then the run (J♣ 10♥) -> Q♦, flipping J♦.
  const g = new Game(3, true);
  ok(g.move({ k: 'tab', i: 1, idx: 1 }, { k: 'tab', i: 2 }), '10 moves onto the Jack');
  const jd = g.tab[2][1];
  eq(jd.up, false, 'J-diamonds still face-down under the run');
  ok(g.move({ k: 'tab', i: 2, idx: 2 }, { k: 'tab', i: 0 }), 'a two-card face-up run moves as a unit');
  eq(g.tab[0].length, 3, 'run landed: Q, J, 10');
  eq(g.tab[0][1].r, 11, 'run kept its order (Jack in the middle)');
  eq(g.tab[0][2].r, 10, 'run kept its order (10 on top)');
  eq(jd.up, true, 'auto-flip after the run left');
}

// ---------- undo: moves (with flip), draws, recycles ----------

{
  const g = new Game(1, true);
  const before = snapshot(g);
  g.move({ k: 'tab', i: 3, idx: 3 }, { k: 'tab', i: 6 }); // flips the 6♥
  ok(snapshot(g) !== before, 'move changed the state');
  g.undo();
  eq(snapshot(g), before, 'undo restores a tableau move, including the auto-flip');
  eq(g.moves, 0, 'undo decrements the move counter');
  eq(g.undo(), null, 'undo with no history is a no-op (null)');
}

{
  const g = new Game(9, true);
  const before = snapshot(g);
  g.draw();
  g.undo();
  eq(snapshot(g), before, 'undo restores a draw exactly');

  while (g.stock.length) g.draw();
  const drained = snapshot(g);
  g.draw(); // recycle
  g.undo();
  eq(snapshot(g), drained, 'undo restores a recycle exactly');
}

{
  // full-history unwind: interleave draws and a move, then undo everything
  const g = new Game(1, true);
  const start = snapshot(g);
  g.draw();
  g.move({ k: 'tab', i: 3, idx: 3 }, { k: 'tab', i: 6 });
  g.draw();
  g.draw();
  while (g.hist.length) g.undo();
  eq(snapshot(g), start, 'undoing the whole history returns to the initial deal');
  eq(g.moves, 0, 'move counter back to 0 after a full unwind');
}

// ---------- foundations: targeting, sending, win, auto-complete ----------

{
  const g = new Game(1, true);
  // seed 1: pile 1 top is A♦ (suit 2), pile 2 top is A♥ (suit 1)
  const dst = g.foundationTargetFor(g.tab[1][1]);
  ok(dst && dst.k === 'found' && dst.i === 2, 'ace targets its empty foundation');
  eq(g.foundationTargetFor({ r: 5, s: 0 }), null, 'non-playable card has no foundation target');
  ok(g.move({ k: 'tab', i: 1, idx: 1 }, dst), 'ace moves to the foundation');
  eq(g.found[2].length, 1, 'foundation holds the ace');
  ok(g.tab[1][0].up, 'card under the ace auto-flipped');
  const dst2 = g.foundationTargetFor({ r: 2, s: 2, up: true });
  ok(dst2 && dst2.i === 2, 'the 2 of the same suit is now playable');
}

{
  // construct an auto-completable endgame and run it to the win
  const g = new Game(1, true);
  const all = [];
  for (const p of [...g.tab, g.stock, g.waste, ...g.found]) all.push(...p);
  eq(all.length, 52, 'collected all 52 cards');
  g.stock = [];
  g.waste = [];
  g.found = [[], [], [], []];
  for (const c of all) { c.up = true; if (c.r <= 9) g.found[c.s].push(c); }
  for (const f of g.found) f.sort((a, b) => a.r - b.r);
  g.tab = [[], [], [], [], [], [], []];
  // 10..K of each suit spread face-up, descending within a pile so tops go up first
  for (let s = 0; s < 4; s++) {
    for (let r = 13; r >= 10; r--) g.tab[s].push(all.find((c) => c.s === s && c.r === r));
  }
  ok(!g.isWon(), 'not won yet');
  ok(g.canAutoComplete(), 'auto-complete offered: empty stock/waste, all tableau face-up');

  let steps = 0;
  for (;;) {
    const m = g.nextAutoMove();
    if (!m) break;
    ok(m.card.r === Math.min(...g.tab.filter((p) => p.length).map((p) => p[p.length - 1].r)),
      'auto-complete always plays the lowest available rank');
    ok(g.move(m.src, m.dst), 'auto-complete move is legal');
    steps++;
    if (steps > 16) break;
  }
  eq(steps, 16, 'auto-complete played the remaining 16 cards');
  ok(g.isWon(), 'all four foundations complete: the game is won');
  ok(!g.canAutoComplete(), 'auto-complete is not offered once won');

  // and the whole synthetic endgame is still undoable
  while (g.hist.length) g.undo();
  ok(!g.isWon(), 'undo unwinds the auto-completed win');
}

{
  const g = new Game(5, true);
  ok(!g.canAutoComplete(), 'auto-complete withheld while the stock is full');
  ok(!g.isWon(), 'fresh deal is not a win');
}

console.log(`logic.test.js: all ${passed} assertions passed`);

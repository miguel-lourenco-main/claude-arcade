// game.js — Klondike rules, state, and full undo history.
// Classic script: attaches its API to window.Patience (file:// friendly).

(function () {
'use strict';

const { shuffledDeck, isRed } = window.Patience;

class Game {
  constructor(seed, draw3) {
    this.seed = seed >>> 0;
    this.draw3 = !!draw3;
    this.moves = 0;
    this.hist = [];

    const deck = shuffledDeck(this.seed);
    this.tab = [];
    for (let i = 0; i < 7; i++) {
      const pile = [];
      for (let j = 0; j <= i; j++) pile.push(deck.pop());
      pile[pile.length - 1].up = true;
      this.tab.push(pile);
    }
    this.stock = deck;          // end of array = top
    this.waste = [];
    this.found = [[], [], [], []]; // index = suit
  }

  pileOf(ref) {
    if (ref.k === 'tab') return this.tab[ref.i];
    if (ref.k === 'found') return this.found[ref.i];
    if (ref.k === 'waste') return this.waste;
    return this.stock;
  }

  // draw from stock, or recycle the waste when the stock is empty.
  // returns {t:'draw', n} | {t:'recycle'} | null
  draw() {
    if (this.stock.length === 0) {
      if (this.waste.length === 0) return null;
      while (this.waste.length) {
        const c = this.waste.pop();
        c.up = false;
        this.stock.push(c);
      }
      this.hist.push({ t: 'recycle' });
      this.moves++;
      return { t: 'recycle' };
    }
    const n = Math.min(this.draw3 ? 3 : 1, this.stock.length);
    for (let i = 0; i < n; i++) {
      const c = this.stock.pop();
      c.up = true;
      this.waste.push(c);
    }
    this.hist.push({ t: 'draw', n });
    this.moves++;
    return { t: 'draw', n };
  }

  canDrop(cards, dst) {
    if (!cards.length) return false;
    const c = cards[0];
    if (dst.k === 'found') {
      if (cards.length !== 1) return false;
      return c.s === dst.i && c.r === this.found[dst.i].length + 1;
    }
    if (dst.k === 'tab') {
      const pile = this.tab[dst.i];
      if (pile.length === 0) return c.r === 13; // Kings (or King-led runs) only
      const top = pile[pile.length - 1];
      return top.up && top.r === c.r + 1 && isRed(top.s) !== isRed(c.s);
    }
    return false;
  }

  // src: {k:'tab',i,idx} | {k:'waste'} | {k:'found',i}   dst: {k:'tab',i} | {k:'found',i}
  move(src, dst) {
    if (src.k === dst.k && src.i === dst.i) return false;
    const from = this.pileOf(src);
    const idx = src.k === 'tab' ? src.idx : from.length - 1;
    if (idx < 0 || idx >= from.length) return false;
    const cards = from.slice(idx);
    if (src.k !== 'tab' && cards.length !== 1) return false;
    if (!this.canDrop(cards, dst)) return false;

    from.length = idx;
    let flip = false;
    if (src.k === 'tab' && from.length && !from[from.length - 1].up) {
      from[from.length - 1].up = true; // auto-flip the newly exposed card
      flip = true;
    }
    this.pileOf(dst).push(...cards);
    this.hist.push({ t: 'move', src: { k: src.k, i: src.i }, dst: { k: dst.k, i: dst.i }, n: cards.length, flip });
    this.moves++;
    return true;
  }

  undo() {
    const h = this.hist.pop();
    if (!h) return null;
    if (h.t === 'draw') {
      for (let i = 0; i < h.n; i++) {
        const c = this.waste.pop();
        c.up = false;
        this.stock.push(c);
      }
    } else if (h.t === 'recycle') {
      while (this.stock.length) {
        const c = this.stock.pop();
        c.up = true;
        this.waste.push(c);
      }
    } else {
      const to = this.pileOf(h.dst);
      const cards = to.splice(to.length - h.n, h.n);
      const from = this.pileOf(h.src);
      if (h.flip && from.length) from[from.length - 1].up = false;
      from.push(...cards);
    }
    this.moves = Math.max(0, this.moves - 1);
    return h;
  }

  // legal foundation destination for a single card, or null
  foundationTargetFor(card) {
    if (this.found[card.s].length + 1 === card.r) return { k: 'found', i: card.s };
    return null;
  }

  isWon() {
    return this.found.every((f) => f.length === 13);
  }

  canAutoComplete() {
    if (this.isWon()) return false;
    if (this.stock.length || this.waste.length) return false;
    return this.tab.every((p) => p.every((c) => c.up));
  }

  // during auto-complete: the lowest-ranked tableau top that can go up
  nextAutoMove() {
    let best = null;
    for (let i = 0; i < 7; i++) {
      const p = this.tab[i];
      if (!p.length) continue;
      const c = p[p.length - 1];
      const dst = this.foundationTargetFor(c);
      if (dst && (!best || c.r < best.card.r)) {
        best = { src: { k: 'tab', i, idx: p.length - 1 }, dst, card: c };
      }
    }
    return best;
  }
}

window.Patience.Game = Game;
})();

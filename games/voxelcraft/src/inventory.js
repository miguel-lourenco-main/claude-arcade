// Counted survival inventory: block id -> count. Creative mode ignores it.

import { BLOCKS, AIR } from "./blocks.js";

const MAX_STACK_TOTAL = 9999;

export class Inventory {
  constructor() {
    this.counts = new Map();
  }

  add(id, n = 1) {
    this.counts.set(id, Math.min(MAX_STACK_TOTAL, (this.counts.get(id) || 0) + n));
  }

  count(id) {
    return this.counts.get(id) || 0;
  }

  take(id, n = 1) {
    const c = this.count(id);
    if (c < n) return false;
    if (c === n) this.counts.delete(id);
    else this.counts.set(id, c - n);
    return true;
  }

  ownedIds() {
    return [...this.counts.keys()];
  }

  serialize() {
    return [...this.counts.entries()];
  }

  load(entries) {
    this.counts.clear();
    if (!Array.isArray(entries)) return;
    for (const pair of entries) {
      if (!Array.isArray(pair)) continue;
      const [id, n] = pair;
      if (!Number.isInteger(id) || id === AIR || !BLOCKS[id]) continue;
      if (!Number.isInteger(n) || n <= 0) continue;
      this.counts.set(id, Math.min(MAX_STACK_TOTAL, n));
    }
  }
}

// Slot-based survival inventory: 36 slots (0-8 hotbar, 9-35 main), stacks of
// up to 64. Slots are the single source of truth — there is no separate
// hotbar id list, and an empty slot is simply empty.

import { BLOCKS, AIR } from "./blocks.js";

export const MAX_STACK = 64;
export const HOTBAR_SIZE = 9;
export const INV_SIZE = 36;

function validStack(s) {
  return s && Number.isInteger(s.id) && s.id !== AIR && !!BLOCKS[s.id] &&
    Number.isInteger(s.count) && s.count > 0;
}

export class Inventory {
  constructor() {
    this.slots = new Array(INV_SIZE).fill(null);
  }

  get(i) { return this.slots[i] || null; }

  set(i, stack) {
    this.slots[i] = validStack(stack) ? { id: stack.id, count: Math.min(MAX_STACK, stack.count) } : null;
  }

  // Add n of id: merge into existing stacks first, then fill empty slots
  // (hotbar first, then main). Returns the count that did NOT fit.
  add(id, n) {
    if (!BLOCKS[id] || id === AIR || n <= 0) return 0;
    let left = n;
    for (let i = 0; i < INV_SIZE && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < MAX_STACK) {
        const take = Math.min(MAX_STACK - s.count, left);
        s.count += take;
        left -= take;
      }
    }
    for (let i = 0; i < INV_SIZE && left > 0; i++) {
      if (!this.slots[i]) {
        const take = Math.min(MAX_STACK, left);
        this.slots[i] = { id, count: take };
        left -= take;
      }
    }
    return left;
  }

  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  // Crafting consumption: only commits when the full amount exists. Drains
  // the main slots (9-35) before touching the hotbar.
  removeCount(id, n) {
    if (this.count(id) < n) return false;
    let left = n;
    const order = [];
    for (let i = HOTBAR_SIZE; i < INV_SIZE; i++) order.push(i);
    for (let i = 0; i < HOTBAR_SIZE; i++) order.push(i);
    for (const i of order) {
      if (left <= 0) break;
      const s = this.slots[i];
      if (!s || s.id !== id) continue;
      const take = Math.min(s.count, left);
      s.count -= take;
      left -= take;
      if (s.count === 0) this.slots[i] = null;
    }
    return true;
  }

  takeFromSlot(i, n = 1) {
    const s = this.slots[i];
    if (!s || s.count < n) return false;
    s.count -= n;
    if (s.count === 0) this.slots[i] = null;
    return true;
  }

  isEmpty() { return this.slots.every((s) => !s); }

  ownedIds() {
    const ids = new Set();
    for (const s of this.slots) if (s) ids.add(s.id);
    return [...ids];
  }

  serialize() {
    return this.slots.map((s) => (s ? [s.id, s.count] : 0));
  }

  load(arr) {
    this.slots.fill(null);
    if (!Array.isArray(arr)) return;
    for (let i = 0; i < Math.min(arr.length, INV_SIZE); i++) {
      const e = arr[i];
      if (!Array.isArray(e)) continue;
      const stack = { id: e[0], count: e[1] };
      if (validStack(stack)) this.slots[i] = { id: stack.id, count: Math.min(MAX_STACK, stack.count) };
    }
  }

  // Migrate a v1 save (inventory as [id,count] pairs with unbounded counts +
  // a 9-entry hotbar of block ids). Returns overflow stacks that didn't fit —
  // the caller spills them as ground drops. Creative saves get their old
  // hotbar seeded with full stacks (creative items are free).
  static migrateV1(pairs, hotbarIds, gameMode) {
    const inv = new Inventory();
    const pool = new Map();
    if (Array.isArray(pairs)) {
      for (const p of pairs) {
        if (!Array.isArray(p)) continue;
        const [id, n] = p;
        if (!Number.isInteger(id) || id === AIR || !BLOCKS[id]) continue;
        if (!Number.isInteger(n) || n <= 0) continue;
        pool.set(id, (pool.get(id) || 0) + n);
      }
    }
    const hotbar = Array.isArray(hotbarIds) ? hotbarIds : [];

    if (gameMode !== "survival") {
      // creative: preserve the layout with free full stacks
      for (let i = 0; i < HOTBAR_SIZE; i++) {
        const id = hotbar[i];
        if (Number.isInteger(id) && id !== AIR && BLOCKS[id]) {
          inv.slots[i] = { id, count: MAX_STACK };
        }
      }
      return { inv, overflow: [] };
    }

    // survival: keep the player's hotbar layout wherever real items exist
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const id = hotbar[i];
      if (!Number.isInteger(id) || !BLOCKS[id] || !pool.get(id)) continue;
      const take = Math.min(MAX_STACK, pool.get(id));
      inv.slots[i] = { id, count: take };
      const rest = pool.get(id) - take;
      if (rest > 0) pool.set(id, rest); else pool.delete(id);
    }
    const overflow = [];
    for (const [id, total] of pool) {
      let left = total;
      while (left > 0) {
        const take = Math.min(MAX_STACK, left);
        left -= take;
        const rejected = inv.add(id, take); // returns what did NOT fit
        if (rejected > 0) overflow.push({ id, count: rejected });
      }
    }
    return { inv, overflow };
  }
}

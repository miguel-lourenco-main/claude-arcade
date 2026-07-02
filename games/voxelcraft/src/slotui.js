// Slot-grid + cursor-stack UI engine: one instance powers the inventory,
// chest, workbench, and creative windows. Regions are declared per window;
// the engine renders 9-column grids, tracks the stack held on the cursor,
// and implements classic container-click semantics (pick/place/merge/swap,
// right-click half/one, shift-click quick-move).
//
// Stacks may carry a per-instance `dur` field (tool wear) — every copy made
// here goes through makeStack/copyStack so dur is never dropped. Tools have
// a per-id stack ceiling of 1 (maxStackFor), so two tools never merge: a
// left-click of one tool onto another of the same id swaps them instead.

import { maxStackFor, makeStack } from "./inventory.js";

const copyStack = (s, count = s.count) => makeStack(s.id, count, s.dur);

// region: { name, size, get(i), set(i, stack|null), palette?, takeOnly? }
export function invRegion(name, inventory, offset, length) {
  return {
    name,
    size: length,
    get: (i) => inventory.get(offset + i),
    set: (i, s) => inventory.set(offset + i, s),
  };
}

export function arrayRegion(name, slots) {
  return {
    name,
    size: slots.length,
    get: (i) => slots[i] || null,
    set: (i, s) => { slots[i] = s ? copyStack(s) : null; },
  };
}

// a 1-slot window onto slots[index] (kiln input/fuel/output). opts can add
// takeOnly: clicks may only ever REMOVE items (see _clickTakeOnly)
export function slotRegion(name, slots, index, opts = {}) {
  return {
    name,
    size: 1,
    ...opts,
    get: () => slots[index] || null,
    set: (_, s) => { slots[index] = s ? copyStack(s) : null; },
  };
}

// creative palette: infinite source; placing a cursor stack here deletes it.
// Tools conjure as singles (their ceiling), everything else as full stacks.
export function paletteRegion(name, ids) {
  return {
    name,
    size: ids.length,
    palette: true,
    get: (i) => ({ id: ids[i], count: maxStackFor(ids[i]) }),
    set: () => {},
  };
}

export class SlotUI {
  constructor({ drawIcon, onChange, onSpill }) {
    this.drawIcon = drawIcon;   // (canvasCtx, stack) => void
    this.onChange = onChange;   // () => refresh hotbar/hud after any mutation
    this.onSpill = onSpill;     // (stack) => drop it at the player
    this.cursor = null;         // null | {id, count, dur?}

    this.el = document.getElementById("cursor-stack");
    this.elCanvas = this.el.querySelector("canvas");
    this.elCount = this.el.querySelector(".n");
    // track the pointer unconditionally: a stack picked up before any drag
    // must appear AT the pointer, not wherever the element last sat
    this._mouse = null;
    document.addEventListener("mousemove", (e) => {
      this._mouse = { x: e.clientX, y: e.clientY };
      if (!this.cursor) return;
      this.el.style.left = `${e.clientX + 4}px`;
      this.el.style.top = `${e.clientY + 4}px`;
    });

    this._views = []; // active window's grids: {region, cells, gridEl}
    this._quickMove = {}; // regionName -> [targetRegion, ...]
  }

  // ---- window lifecycle ----

  // views: [{region, gridEl}], quickMove: {regionName: [region, ...]}
  open(views, quickMove) {
    this._views = views.map((v) => ({ ...v, cells: [] }));
    this._quickMove = quickMove || {};
    for (const view of this._views) this._buildGrid(view);
    this.renderAll();
  }

  close() {
    this.spill();
    for (const view of this._views) view.gridEl.innerHTML = "";
    this._views = [];
  }

  spill() {
    if (this.cursor) {
      this.onSpill(this.cursor);
      this.cursor = null;
    }
    this._renderCursor();
  }

  // ---- rendering ----

  _buildGrid(view) {
    const { region, gridEl } = view;
    gridEl.innerHTML = "";
    view.cells = [];
    for (let i = 0; i < region.size; i++) {
      const cell = document.createElement("div");
      cell.className = "inv-slot";
      const canvas = document.createElement("canvas");
      canvas.width = 40; canvas.height = 40;
      cell.appendChild(canvas);
      const n = document.createElement("span");
      n.className = "n";
      cell.appendChild(n);
      cell.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.click(region, i, e.button, e.shiftKey);
      });
      cell.addEventListener("contextmenu", (e) => e.preventDefault());
      gridEl.appendChild(cell);
      view.cells.push({ cell, canvas, n });
    }
  }

  renderAll() {
    for (const view of this._views) {
      for (let i = 0; i < view.region.size; i++) this._renderCell(view, i);
    }
    this._renderCursor();
  }

  _renderCell(view, i) {
    const { canvas, n } = view.cells[i];
    const s = view.region.get(i);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, 40, 40);
    if (s) this.drawIcon(ctx, s);
    n.textContent = s && !view.region.palette && s.count > 1 ? String(s.count) : "";
  }

  _renderCursor() {
    if (this.cursor) {
      if (this._mouse) {
        this.el.style.left = `${this._mouse.x + 4}px`;
        this.el.style.top = `${this._mouse.y + 4}px`;
      }
      const ctx = this.elCanvas.getContext("2d");
      ctx.clearRect(0, 0, 40, 40);
      this.drawIcon(ctx, this.cursor);
      this.elCount.textContent = this.cursor.count > 1 ? String(this.cursor.count) : "";
      this.el.classList.remove("hidden");
    } else {
      this.el.classList.add("hidden");
    }
  }

  // ---- click semantics ----

  click(region, i, button, shift) {
    // shift beats palette: the quick-move table declares where a palette
    // stack goes (e.g. straight to the belt), and a held cursor stack must
    // never be voided by a shift-click that only meant to quick-move
    if (shift) this._quickMoveFrom(region, i);
    else if (region.palette) this._clickPalette(region, i);
    else if (region.takeOnly) this._clickTakeOnly(region, i, button);
    else if (button === 2) this._rightClick(region, i);
    else this._leftClick(region, i);
    this.renderAll();
    this.onChange();
  }

  // take-only slot (kiln output): clicks only ever remove items. Placing is a
  // handled no-op here — NOT an ignoring set() — because the normal click
  // paths null the cursor after set(), which would destroy the held stack.
  _clickTakeOnly(region, i, button) {
    const s = region.get(i);
    if (!s) return;
    const max = maxStackFor(s.id);
    if (!this.cursor) {
      const take = button === 2 ? Math.ceil(s.count / 2) : s.count;
      this.cursor = copyStack(s, take);
      region.set(i, s.count - take > 0 ? copyStack(s, s.count - take) : null);
    } else if (this.cursor.id === s.id && this.cursor.count < max) {
      const move = Math.min(max - this.cursor.count, s.count);
      this.cursor.count += move;
      region.set(i, s.count - move > 0 ? copyStack(s, s.count - move) : null);
    }
  }

  _clickPalette(region, i) {
    // empty cursor: take a full stack; held cursor: the void takes it
    this.cursor = this.cursor ? null : copyStack(region.get(i));
  }

  _leftClick(region, i) {
    const s = region.get(i);
    if (!this.cursor) {
      if (!s) return;
      this.cursor = { ...s };
      region.set(i, null);
    } else if (!s) {
      region.set(i, this.cursor);
      this.cursor = null;
    } else if (s.id === this.cursor.id && maxStackFor(s.id) > 1) {
      const room = maxStackFor(s.id) - s.count;
      const move = Math.min(room, this.cursor.count);
      region.set(i, copyStack(s, s.count + move));
      this.cursor.count -= move;
      if (this.cursor.count === 0) this.cursor = null;
    } else {
      // different ids — or two same-id TOOLS, which never merge: swap
      region.set(i, this.cursor);
      this.cursor = { ...s };
    }
  }

  _rightClick(region, i) {
    const s = region.get(i);
    const max = s ? maxStackFor(s.id) : 0;
    if (!this.cursor) {
      if (!s) return;
      const take = Math.ceil(s.count / 2);
      this.cursor = copyStack(s, take);
      region.set(i, s.count - take > 0 ? copyStack(s, s.count - take) : null);
    } else if (!s) {
      region.set(i, copyStack(this.cursor, 1));
      this.cursor.count -= 1;
      if (this.cursor.count === 0) this.cursor = null;
    } else if (s.id === this.cursor.id && s.count < max) {
      region.set(i, copyStack(s, s.count + 1));
      this.cursor.count -= 1;
      if (this.cursor.count === 0) this.cursor = null;
    } else if (s.id !== this.cursor.id) {
      region.set(i, this.cursor);
      this.cursor = { ...s };
    }
  }

  _quickMoveFrom(region, i) {
    const s = region.get(i);
    if (!s) return;
    const max = maxStackFor(s.id);
    // a quickMove entry may be a function of the stack — the kiln routes
    // smeltables to its input and fuels to its fuel slot by id
    let targets = this._quickMove[region.name] || [];
    if (typeof targets === "function") targets = targets(s) || [];
    let left = s.count;
    // merge pass, then empty-fill pass, across targets in order (tools have
    // a ceiling of 1, so they only ever land in empty slots, dur intact)
    for (const pass of ["merge", "fill"]) {
      for (const target of targets) {
        for (let t = 0; t < target.size && left > 0; t++) {
          const ts = target.get(t);
          if (pass === "merge" && ts && ts.id === s.id && ts.count < max) {
            const move = Math.min(max - ts.count, left);
            target.set(t, copyStack(ts, ts.count + move));
            left -= move;
          } else if (pass === "fill" && !ts) {
            const move = Math.min(max, left);
            target.set(t, copyStack(s, move));
            left -= move;
          }
        }
      }
    }
    // a palette stack is conjured, not stored — nothing to write back
    if (!region.palette) region.set(i, left > 0 ? copyStack(s, left) : null);
  }
}

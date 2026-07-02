// DOM HUD: hotbar with fake-isometric block icons, block picker, debug
// overlay, pause overlay, underwater tint.

import { BLOCKS, PLACEABLE, DEFAULT_HOTBAR } from "./blocks.js";
import { ATLAS_TILES, TILE_PX } from "./textures.js";
import { RECIPES, canCraft } from "./craft.js";

const ICON = 40;

// Draw a fake-iso cube (top + two sides) from atlas tiles onto a 2D canvas.
function drawBlockIcon(ctx, atlas, blockId) {
  ctx.clearRect(0, 0, ICON, ICON);
  ctx.imageSmoothingEnabled = false;
  const def = BLOCKS[blockId];
  const src = (tile) => ({
    sx: (tile % ATLAS_TILES) * TILE_PX,
    sy: Math.floor(tile / ATLAS_TILES) * TILE_PX,
  });

  if (def.kind === "cross") {
    const { sx, sy } = src(def.tiles.side);
    ctx.drawImage(atlas, sx, sy, TILE_PX, TILE_PX, 4, 4, ICON - 8, ICON - 8);
    return;
  }

  const w = 17, h = 10; // iso half-width / cap height
  const cx = ICON / 2, cy = ICON / 2 + 2;

  // top face (rhombus)
  let t = src(def.tiles.top);
  ctx.save();
  ctx.setTransform(1, 0.5, -1, 0.5, cx, cy - h);
  ctx.drawImage(atlas, t.sx, t.sy, TILE_PX, TILE_PX, -w / 2, -w / 2, w, w);
  ctx.restore();

  // left face
  t = src(def.tiles.side);
  ctx.save();
  ctx.setTransform(1, 0.5, 0, 1, cx - w / 1.98, cy - h + w / 3.95);
  ctx.drawImage(atlas, t.sx, t.sy, TILE_PX, TILE_PX, 0, 0, w / 2, w * 0.62);
  ctx.restore();
  ctx.save();
  ctx.setTransform(1, 0.5, 0, 1, cx - w / 1.98, cy - h + w / 3.95);
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fillRect(0, 0, w / 2, w * 0.62);
  ctx.restore();

  // right face
  ctx.save();
  ctx.setTransform(1, -0.5, 0, 1, cx, cy - h + w / 2);
  ctx.drawImage(atlas, t.sx, t.sy, TILE_PX, TILE_PX, 0, 0, w / 2, w * 0.62);
  ctx.restore();
  ctx.save();
  ctx.setTransform(1, -0.5, 0, 1, cx, cy - h + w / 2);
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(0, 0, w / 2, w * 0.62);
  ctx.restore();
}

const TELEPORTS = ["spawn", "forest", "plains", "desert", "snow", "mountain", "ocean"];

// tiny pixel-art status icons, drawn once and reused as data URLs
function pixelIcon(rows, colorFor) {
  const canvas = document.createElement("canvas");
  canvas.width = rows[0].length;
  canvas.height = rows.length;
  const ctx = canvas.getContext("2d");
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const c = colorFor(ch, x, y);
      if (!c) return;
      ctx.fillStyle = c;
      ctx.fillRect(x, y, 1, 1);
    });
  });
  return canvas.toDataURL();
}

const HEART_ROWS = [".XX.XX.", "XXXXXXX", "XXXXXXX", ".XXXXX.", "..XXX..", "...X..."];
const BUBBLE_ROWS = [".XXX.", "XXXXX", "XoXXX", "XXXXX", ".XXX."];

const ICONS = {
  heartFull: pixelIcon(HEART_ROWS, (ch) => (ch === "X" ? "#d4342a" : null)),
  heartHalf: pixelIcon(HEART_ROWS, (ch, x) => (ch === "X" ? (x <= 3 ? "#d4342a" : "#3a3a44") : null)),
  heartEmpty: pixelIcon(HEART_ROWS, (ch) => (ch === "X" ? "#3a3a44" : null)),
  bubble: pixelIcon(BUBBLE_ROWS, (ch) => (ch === "X" ? "#7fb4ff" : ch === "o" ? "#e8f4ff" : null)),
};

export class Hud {
  constructor(atlasCanvas, opts) {
    this.atlas = atlasCanvas;
    this.onResume = opts.onResume;
    this.onReset = opts.onReset;
    this.onTeleport = opts.onTeleport;             // (kind) => {ok, message}
    this.onToggleMovement = opts.onToggleMovement; // () => new mode string
    this.onSensitivity = opts.onSensitivity;       // (multiplier) => void
    this.onToggleMode = opts.onToggleMode;         // () => new game mode string
    this.onRespawn = opts.onRespawn;               // () => void
    this.onCraft = opts.onCraft;                   // (recipe) => void
    this.inventory = opts.inventory;               // survival Inventory
    this.playerViewer = opts.playerViewer;         // spinnable Wanderling
    this.bindTarget = 0;                           // ribbon slot cards bind to
    this.slots = [...DEFAULT_HOTBAR];
    this.selected = 0;
    this.pickerOpen = false;
    this.paused = true; // the boot overlay is showing
    this.gameMode = "creative";
    this._lastHealth = -1;
    this._lastBubbles = -1;

    this._buildHotbar();
    this._buildPicker();
    this.debugEl = document.getElementById("debug");
    this.overlayEl = document.getElementById("overlay");
    this.waterTintEl = document.getElementById("water-tint");
    this.blockNameEl = document.getElementById("block-name");
    this._nameTimeout = 0;

    document.getElementById("resume").addEventListener("click", () => this.onResume());
    document.getElementById("reset").addEventListener("click", () => {
      if (confirm("Delete this world and generate a new one?")) this.onReset();
    });

    this.movementBtn = document.getElementById("movement-toggle");
    this.movementBtn.addEventListener("click", () => {
      this.setMovementLabel(this.onToggleMovement());
    });

    this.sensEl = document.getElementById("sensitivity");
    this.sensValEl = document.getElementById("sens-val");
    this.sensEl.addEventListener("input", () => {
      const v = parseFloat(this.sensEl.value);
      this.sensValEl.textContent = v.toFixed(2) + "×";
      this.onSensitivity(v);
    });

    this.modeBtn = document.getElementById("mode-toggle");
    this.modeBtn.addEventListener("click", () => this.setMode(this.onToggleMode()));

    this._buildTeleports();
    this._buildStatus();

    this.deathEl = document.getElementById("death");
    this.flashEl = document.getElementById("damage-flash");
    document.getElementById("respawn").addEventListener("click", () => this.onRespawn());
  }

  _buildStatus() {
    this.statusEl = document.getElementById("status");
    const hearts = document.getElementById("hearts");
    const bubbles = document.getElementById("bubbles");
    this.heartEls = [];
    this.bubbleEls = [];
    for (let i = 0; i < 10; i++) {
      const h = document.createElement("div");
      h.className = "icon";
      hearts.appendChild(h);
      this.heartEls.push(h);
      const b = document.createElement("div");
      b.className = "icon";
      b.style.backgroundImage = `url(${ICONS.bubble})`;
      bubbles.appendChild(b);
      this.bubbleEls.push(b);
    }
  }

  setMode(mode) {
    this.gameMode = mode;
    this.modeBtn.textContent = mode === "survival" ? "Mode: Survival" : "Mode: Creative";
    this.statusEl.classList.toggle("hidden", mode !== "survival");
    this._lastHealth = -1;
    this._lastBubbles = -1;
    this.refreshCounts();
  }

  setHealth(hp) {
    // ceil: any nonzero health shows at least half a heart
    const half = Math.ceil(hp - 1e-9);
    if (half === this._lastHealth) return;
    this._lastHealth = half;
    for (let i = 0; i < 10; i++) {
      const state = half >= (i + 1) * 2 ? "Full" : half === i * 2 + 1 ? "Half" : "Empty";
      this.heartEls[i].style.backgroundImage = `url(${ICONS["heart" + state]})`;
    }
  }

  setAir(air, maxAir, underwater) {
    const bubbles = air >= maxAir ? 10 : Math.ceil((air / maxAir) * 10);
    // show the meter the moment the head goes under, not only once air dips
    const state = bubbles + (underwater ? 100 : 0);
    if (state === this._lastBubbles) return;
    this._lastBubbles = state;
    for (let i = 0; i < 10; i++) {
      this.bubbleEls[i].style.visibility = i < bubbles ? "visible" : "hidden";
    }
    document.getElementById("bubbles").style.opacity =
      underwater || air < maxAir - 0.01 ? "1" : "0";
  }

  flashDamage() {
    this.flashEl.classList.add("active");
    clearTimeout(this._flashTimeout);
    this._flashTimeout = setTimeout(() => this.flashEl.classList.remove("active"), 320);
  }

  showDeath(cause) {
    document.getElementById("death-cause").textContent =
      cause ? `Killed by ${cause}.` : "";
    this.deathEl.classList.remove("hidden");
  }

  hideDeath() { this.deathEl.classList.add("hidden"); }
  get deathOpen() { return !this.deathEl.classList.contains("hidden"); }

  // hotbar count badges (survival only); empty slots hide their icon entirely
  refreshCounts() {
    const survival = this.gameMode === "survival";
    for (let i = 0; i < 9; i++) {
      const { slot, count } = this.slotEls[i];
      const n = survival ? this.inventory.count(this.slots[i]) : 0;
      count.textContent = survival && n > 0 ? String(n) : "";
      slot.classList.toggle("empty", survival && n === 0);
    }
  }

  setMovementLabel(mode) {
    this.movementBtn.textContent =
      mode === "static" ? "Movement: World-static" : "Movement: Camera-relative";
  }

  setSensitivity(v) {
    this.sensEl.value = String(v);
    this.sensValEl.textContent = v.toFixed(2) + "×";
  }

  _buildTeleports() {
    const row = document.getElementById("tp-buttons");
    const status = document.getElementById("tp-status");
    for (const kind of TELEPORTS) {
      const btn = document.createElement("button");
      btn.className = "tp-btn";
      btn.textContent = kind[0].toUpperCase() + kind.slice(1);
      btn.addEventListener("click", () => {
        status.textContent = `Searching for ${kind}…`;
        btn.disabled = true;
        // yield a frame so the status paints before the synchronous search
        requestAnimationFrame(() => setTimeout(() => {
          const res = this.onTeleport(kind);
          status.textContent = res.message;
          btn.disabled = false;
        }, 20));
      });
      row.appendChild(btn);
    }
  }

  selectedId() { return this.slots[this.selected]; }

  select(i) {
    this.selected = ((i % 9) + 9) % 9;
    this._refreshHotbar();
    const id = this.selectedId();
    const empty = this.gameMode === "survival" && this.inventory.count(id) === 0;
    this._announce(empty ? "Bare foot" : BLOCKS[id].name);
  }

  scroll(delta) { this.select(this.selected + (delta > 0 ? 1 : -1)); }

  setSlot(blockId, i = this.selected) {
    this.slots[i] = blockId;
    this._refreshHotbar();
    this.refreshCounts();
    this._announce(BLOCKS[blockId].name);
  }

  _announce(name) {
    this.blockNameEl.textContent = name;
    this.blockNameEl.style.opacity = "1";
    clearTimeout(this._nameTimeout);
    this._nameTimeout = setTimeout(() => { this.blockNameEl.style.opacity = "0"; }, 1200);
  }

  _buildHotbar() {
    const bar = document.getElementById("hotbar");
    this.slotEls = [];
    for (let i = 0; i < 9; i++) {
      const slot = document.createElement("div");
      slot.className = "slot";
      const canvas = document.createElement("canvas");
      canvas.width = ICON; canvas.height = ICON;
      slot.appendChild(canvas);
      const key = document.createElement("span");
      key.className = "key";
      key.textContent = i + 1;
      slot.appendChild(key);
      const count = document.createElement("span");
      count.className = "count";
      slot.appendChild(count);
      bar.appendChild(slot);
      this.slotEls.push({ slot, canvas, count });
    }
    this._refreshHotbar();
  }

  _refreshHotbar() {
    for (let i = 0; i < 9; i++) {
      const { slot, canvas } = this.slotEls[i];
      slot.classList.toggle("selected", i === this.selected);
      drawBlockIcon(canvas.getContext("2d"), this.atlas, this.slots[i]);
    }
  }

  _buildPicker() {
    this.pickerEl = document.getElementById("picker");
    // hotbar ribbon: 9 mini slots; the armed one receives card clicks
    const ribbon = document.getElementById("inv-ribbon");
    this.ribbonEls = [];
    for (let i = 0; i < 9; i++) {
      const slot = document.createElement("div");
      slot.className = "ribbon-slot";
      const canvas = document.createElement("canvas");
      canvas.width = ICON; canvas.height = ICON;
      slot.appendChild(canvas);
      const n = document.createElement("span");
      n.className = "n";
      slot.appendChild(n);
      slot.addEventListener("click", () => {
        this.bindTarget = i;
        this._renderRibbon();
      });
      ribbon.appendChild(slot);
      this.ribbonEls.push({ slot, canvas, n });
    }
  }

  _renderRibbon() {
    const survival = this.gameMode === "survival";
    for (let i = 0; i < 9; i++) {
      const { slot, canvas, n } = this.ribbonEls[i];
      slot.classList.toggle("armed", i === this.bindTarget);
      const count = survival ? this.inventory.count(this.slots[i]) : 0;
      const show = !survival || count > 0;
      canvas.style.visibility = show ? "visible" : "hidden";
      if (show) drawBlockIcon(canvas.getContext("2d"), this.atlas, this.slots[i]);
      n.textContent = survival && count > 0 ? String(count) : "";
    }
  }

  // creative: every block; survival: only what the inventory holds, with counts
  _renderPicker() {
    const grid = document.getElementById("picker-grid");
    grid.innerHTML = "";
    const survival = this.gameMode === "survival";
    const ids = survival ? this.inventory.ownedIds() : PLACEABLE;

    if (survival) this._renderCrafting();
    else document.getElementById("craft-list").innerHTML = "";

    if (survival && ids.length === 0) {
      const hint = document.createElement("p");
      hint.className = "picker-hint";
      hint.textContent = "Nothing yet — mine some blocks!";
      grid.appendChild(hint);
      return;
    }

    for (const id of ids) {
      const cell = document.createElement("div");
      cell.className = "picker-cell";
      cell.title = BLOCKS[id].name;
      const canvas = document.createElement("canvas");
      canvas.width = ICON; canvas.height = ICON;
      drawBlockIcon(canvas.getContext("2d"), this.atlas, id);
      cell.appendChild(canvas);
      const label = document.createElement("span");
      label.textContent = BLOCKS[id].name;
      cell.appendChild(label);
      if (survival) {
        const stamp = document.createElement("span");
        stamp.className = "stamp";
        stamp.textContent = `×${this.inventory.count(id)}`;
        cell.appendChild(stamp);
      }
      // bind to the armed ribbon slot, then auto-advance so the whole hotbar
      // can be outfitted in one visit; the window stays open
      cell.addEventListener("click", () => {
        this.setSlot(id, this.bindTarget);
        this.bindTarget = (this.bindTarget + 1) % 9;
        this._renderRibbon();
      });
      grid.appendChild(cell);
    }
  }

  // craft list: one row per recipe, craftable rows first. The order is
  // frozen per Satchel visit — re-sorting after a craft would slide a
  // different recipe under the cursor mid-double-click.
  _renderCrafting() {
    const list = document.getElementById("craft-list");
    list.innerHTML = "";
    if (!this.pickerOpen || !this._craftOrder) {
      this._craftOrder = [...RECIPES].sort(
        (a, b) => Number(canCraft(b, this.inventory)) - Number(canCraft(a, this.inventory)));
    }
    for (const recipe of this._craftOrder) {
      const ok = canCraft(recipe, this.inventory);
      const row = document.createElement("div");
      row.className = "craft-row" + (ok ? "" : " uncraftable");

      const outIcon = document.createElement("canvas");
      outIcon.width = ICON; outIcon.height = ICON;
      drawBlockIcon(outIcon.getContext("2d"), this.atlas, recipe.out[0]);
      row.appendChild(outIcon);

      const label = document.createElement("span");
      const ins = recipe.in
        .map(([id, n]) => `${n}× ${BLOCKS[id].name}`)
        .join(" + ");
      label.innerHTML =
        `<b>${recipe.out[1]}× ${BLOCKS[recipe.out[0]].name}</b><small>${ins}</small>`;
      row.appendChild(label);

      if (ok) {
        row.addEventListener("click", () => {
          this.onCraft(recipe);
          this._renderPicker(); // counts changed everywhere
          this._renderRibbon();
          this.refreshCounts();
        });
      }
      list.appendChild(row);
    }
  }

  openPicker() {
    this.bindTarget = this.selected;
    this._craftOrder = null; // re-sort once per visit
    this._renderPicker();
    this._renderRibbon();
    this.pickerOpen = true;
    this.pickerEl.classList.remove("hidden");
    if (this.playerViewer) this.playerViewer.start();
    document.exitPointerLock();
  }

  closePicker() {
    this.pickerOpen = false;
    this.pickerEl.classList.add("hidden");
    if (this.playerViewer) this.playerViewer.stop();
  }

  // ---- chest UI: two panels, click a stack to move it wholesale ----

  openChest(store, onChange) {
    this.chestOpen = true;
    this._chestStore = store;
    this._chestChanged = onChange;
    this._renderChest();
    document.getElementById("chest-ui").classList.remove("hidden");
    document.exitPointerLock();
  }

  closeChest() {
    this.chestOpen = false;
    this._chestStore = null;
    document.getElementById("chest-ui").classList.add("hidden");
  }

  _renderChest() {
    const store = this._chestStore;
    const fill = (gridId, entries, onClickStack, emptyText) => {
      const grid = document.getElementById(gridId);
      grid.innerHTML = "";
      if (entries.length === 0) {
        const p = document.createElement("p");
        p.className = "mini-empty";
        p.textContent = emptyText;
        grid.appendChild(p);
        return;
      }
      for (const [id, n] of entries) {
        const cell = document.createElement("div");
        cell.className = "mini-cell";
        cell.title = BLOCKS[id].name;
        const canvas = document.createElement("canvas");
        canvas.width = ICON; canvas.height = ICON;
        drawBlockIcon(canvas.getContext("2d"), this.atlas, id);
        cell.appendChild(canvas);
        const count = document.createElement("span");
        count.className = "n";
        count.textContent = n;
        cell.appendChild(count);
        cell.addEventListener("click", () => {
          onClickStack(id, n);
          this._renderChest();
          this.refreshCounts();
          this._chestChanged();
        });
        grid.appendChild(cell);
      }
    };

    // both directions move only what fits under the 9999 cap and leave the
    // remainder behind — the old delete-then-clamp destroyed the overflow
    const CAP = 9999;
    fill("chest-grid", [...store.entries()], (id, n) => {
      const moved = Math.min(CAP - this.inventory.count(id), n);
      if (moved <= 0) return;
      this.inventory.add(id, moved);
      if (moved === n) store.delete(id);
      else store.set(id, n - moved);
    }, "Empty");
    fill("chest-inv-grid", [...this.inventory.counts.entries()], (id, n) => {
      const moved = Math.min(CAP - (store.get(id) || 0), n);
      if (moved <= 0) return;
      this.inventory.take(id, moved);
      store.set(id, (store.get(id) || 0) + moved);
    }, "Nothing to store");
  }

  showPause(firstTime = false) {
    this.paused = true;
    this.overlayEl.classList.remove("hidden");
    document.getElementById("overlay-title").textContent = firstTime ? "VOXELCRAFT" : "Paused";
  }
  hidePause() { this.paused = false; this.overlayEl.classList.add("hidden"); }

  setUnderwater(on) { this.waterTintEl.classList.toggle("hidden", !on); }

  updateDebug(lines, visible) {
    this.debugEl.classList.toggle("hidden", !visible);
    if (visible) this.debugEl.textContent = lines.join("\n");
  }
}

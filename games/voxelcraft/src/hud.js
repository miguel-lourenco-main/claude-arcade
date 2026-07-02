// DOM HUD: hotbar with fake-isometric block icons, block picker, debug
// overlay, pause overlay, underwater tint.

import { BLOCKS, PLACEABLE, AIR } from "./blocks.js";
import { clampSignText, SIGN_LINES, SIGN_COLS } from "./world.js";
import { shapeBoxes } from "./mesher.js";
import { ATLAS_TILES, TILE_PX } from "./textures.js";
import { RECIPES, BASIC_RECIPES, canCraft } from "./craft.js";
import { SMELTS, FUEL_SECONDS, SMELT_SECONDS } from "./kiln.js";
import { SlotUI, invRegion, arrayRegion, paletteRegion, slotRegion } from "./slotui.js";

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

  // shaped blocks (slabs, stairs) draw their real silhouette
  if (def.shape) {
    drawShapedIcon(ctx, atlas, def, src);
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

// A small consistent iso projector for shaped blocks: each collision/mesh box
// is drawn back-to-front as top + left(+z) + right(+x) faces, with texture
// crops matching the box extents. P(x,y,z) = [(x-z)K, (x+z)K/2 + (1-y)H].
function drawShapedIcon(ctx, atlas, def, src) {
  const boxes = shapeBoxes(def);
  if (boxes.length === 0) return;
  const K = 15, H = 10;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, (b.x0 - b.z1) * K);
    maxX = Math.max(maxX, (b.x1 - b.z0) * K);
    minY = Math.min(minY, (b.x0 + b.z0) * K * 0.5 + (1 - b.y1) * H);
    maxY = Math.max(maxY, (b.x1 + b.z1) * K * 0.5 + (1 - b.y0) * H);
  }
  const ox = ICON / 2 - (minX + maxX) / 2;
  const oy = ICON / 2 - (minY + maxY) / 2;
  const P = (x, y, z) => [ox + (x - z) * K, oy + (x + z) * K * 0.5 + (1 - y) * H];

  const face = (tile, origin, uAxis, vAxis, crop, shade) => {
    const { sx, sy } = src(tile);
    ctx.save();
    ctx.setTransform(uAxis[0], uAxis[1], vAxis[0], vAxis[1], origin[0], origin[1]);
    ctx.drawImage(atlas, sx + crop[0] * TILE_PX, sy + crop[1] * TILE_PX,
      crop[2] * TILE_PX, crop[3] * TILE_PX, 0, 0, 1, 1);
    if (shade > 0) {
      ctx.fillStyle = `rgba(0,0,0,${shade})`;
      ctx.fillRect(0, 0, 1, 1);
    }
    ctx.restore();
  };

  for (const b of boxes) {
    const dx = b.x1 - b.x0, dy = b.y1 - b.y0, dz = b.z1 - b.z0;
    // top face (y = y1)
    face(def.tiles.top, P(b.x0, b.y1, b.z0),
      [dx * K, dx * K * 0.5], [-dz * K, dz * K * 0.5],
      [b.x0, b.z0, dx, dz], 0);
    // left face (z = z1)
    face(def.tiles.side, P(b.x0, b.y1, b.z1),
      [dx * K, dx * K * 0.5], [0, dy * H],
      [b.x0, 1 - b.y1, dx, dy], 0.22);
    // right face (x = x1)
    face(def.tiles.side, P(b.x1, b.y1, b.z1),
      [dz * K, -dz * K * 0.5], [0, dy * H],
      [b.z0, 1 - b.y1, dz, dy], 0.4);
  }
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
// hunger: a Wanderling field bowl with a morsel (m) peeking over the rim —
// rust-orange crockery, mustard morsel (the tunic colors, see LORE.md)
const BOWL_ROWS = ["..mm...", ".mmmm..", "XXXXXXX", "XXXXXXX", ".XXXXX.", "..XXX.."];
const BOWL_COLORS = { X: "#c56a2b", m: "#d9a441" };

const ICONS = {
  heartFull: pixelIcon(HEART_ROWS, (ch) => (ch === "X" ? "#d4342a" : null)),
  heartHalf: pixelIcon(HEART_ROWS, (ch, x) => (ch === "X" ? (x <= 3 ? "#d4342a" : "#3a3a44") : null)),
  heartEmpty: pixelIcon(HEART_ROWS, (ch) => (ch === "X" ? "#3a3a44" : null)),
  bubble: pixelIcon(BUBBLE_ROWS, (ch) => (ch === "X" ? "#7fb4ff" : ch === "o" ? "#e8f4ff" : null)),
  bowlFull: pixelIcon(BOWL_ROWS, (ch) => BOWL_COLORS[ch] || null),
  // the row is mirrored (fills right-to-left), so the half bowl keeps its
  // colored half toward the full end: the RIGHT side of the icon
  bowlHalf: pixelIcon(BOWL_ROWS, (ch, x) => (BOWL_COLORS[ch] ? (x >= 3 ? BOWL_COLORS[ch] : "#3a3a44") : null)),
  bowlEmpty: pixelIcon(BOWL_ROWS, (ch) => (BOWL_COLORS[ch] ? "#3a3a44" : null)),
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
    this.onCraft = opts.onCraft;                   // (recipe, max) => void
    this.onSpillCursor = opts.onSpillCursor;       // (stack) => ground drop
    this.onSlotsChanged = opts.onSlotsChanged;     // any slot mutation (sfx)
    this.inventory = opts.inventory;               // slot Inventory
    this.playerViewer = opts.playerViewer;         // spinnable Wanderling
    this.selected = 0;
    this.pickerOpen = false;
    this.chestOpen = false;
    this.benchOpen = false;
    this.kilnOpen = false;
    this._kiln = null; // live kiln state while the window is open
    this.signOpen = false;
    this._signCommit = null; // (text) => void while the write window is open
    this.paused = true; // the boot overlay is showing
    this.gameMode = "creative";
    this._lastHealth = -1;
    this._lastBubbles = -1;
    this._lastHunger = -1;

    // one cursor-stack engine powers the inventory/chest/workbench windows
    this.slotUI = new SlotUI({
      drawIcon: (ctx, id) => drawBlockIcon(ctx, this.atlas, id),
      onChange: () => {
        this.refreshHotbarRow();
        // craftability depends on slot counts (a stack on the cursor doesn't
        // count) — keep the lists live, with their per-visit order frozen
        if (this.pickerOpen) this._renderFieldRecipes();
        if (this.benchOpen) {
          this._renderCraftList(document.getElementById("craft-list"), this._benchOrder);
        }
        if (this.onSlotsChanged) this.onSlotsChanged();
        if (this._chestChanged) this._chestChanged();
      },
      onSpill: (stack) => this.onSpillCursor && this.onSpillCursor(stack),
    });

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

    // the Notice Post write window: Done commits, Cancel discards, and both
    // hand the pointer back to the game
    this.signTextEl = document.getElementById("sign-text");
    this.signTextEl.addEventListener("input", () => this._clampSignInput());
    document.getElementById("sign-done").addEventListener("click", () => {
      this.closeSign(true);
      this.onResume();
    });
    document.getElementById("sign-cancel").addEventListener("click", () => {
      this.closeSign(false);
      this.onResume();
    });
  }

  // hold the textarea to the board's 4x16: trim overflow as it's typed,
  // keeping the caret where the writer left it
  _clampSignInput() {
    const el = this.signTextEl;
    const clamped = el.value
      .split("\n").slice(0, SIGN_LINES)
      .map((line) => line.slice(0, SIGN_COLS))
      .join("\n");
    if (clamped !== el.value) {
      const caret = Math.min(el.selectionStart, clamped.length);
      el.value = clamped;
      el.setSelectionRange(caret, caret);
    }
  }

  // the Notice Post window: pause input (anyWindowOpen), edit, Done/Cancel.
  // onCommit receives the clamped text ("" = wipe the board clean).
  openSign(text, onCommit) {
    this.signOpen = true;
    this._signCommit = onCommit;
    this.signTextEl.value = text;
    document.getElementById("sign-ui").classList.remove("hidden");
    document.exitPointerLock();
    // defer: the right-click that opened us hasn't finished dispatching, and
    // its default action would steal the focus right back off the textarea
    setTimeout(() => { if (this.signOpen) this.signTextEl.focus(); }, 0);
  }

  closeSign(commit = true) {
    if (!this.signOpen) return;
    this.signOpen = false;
    const done = this._signCommit;
    this._signCommit = null;
    document.getElementById("sign-ui").classList.add("hidden");
    if (commit && done) done(clampSignText(this.signTextEl.value));
  }

  _buildStatus() {
    this.statusEl = document.getElementById("status");
    const hearts = document.getElementById("hearts");
    const bubbles = document.getElementById("bubbles");
    const hunger = document.getElementById("hunger");
    this.heartEls = [];
    this.bubbleEls = [];
    this.hungerEls = [];
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
      const f = document.createElement("div");
      f.className = "icon";
      hunger.appendChild(f);
      this.hungerEls.push(f);
    }
  }

  setMode(mode) {
    this.gameMode = mode;
    this.modeBtn.textContent = mode === "survival" ? "Mode: Survival" : "Mode: Creative";
    this.statusEl.classList.toggle("hidden", mode !== "survival");
    this._lastHealth = -1;
    this._lastBubbles = -1;
    this._lastHunger = -1;
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

  setHunger(hunger) {
    // ceil, like hearts: any nonzero hunger shows at least half a bowl
    const half = Math.ceil(hunger - 1e-9);
    if (half === this._lastHunger) return;
    this._lastHunger = half;
    for (let i = 0; i < 10; i++) {
      const state = half >= (i + 1) * 2 ? "Full" : half === i * 2 + 1 ? "Half" : "Empty";
      this.hungerEls[i].style.backgroundImage = `url(${ICONS["bowl" + state]})`;
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

  selectedId() {
    const s = this.inventory.get(this.selected);
    return s ? s.id : AIR;
  }

  select(i) {
    this.selected = ((i % 9) + 9) % 9;
    this.refreshHotbarRow();
    const s = this.inventory.get(this.selected);
    this._announce(s ? BLOCKS[s.id].name : "Bare foot");
  }

  scroll(delta) { this.select(this.selected + (delta > 0 ? 1 : -1)); }

  // middle-click pick-block: select it if it's on the belt, otherwise swap it
  // in from the satchel; creative conjures a full stack
  pickBlock(id) {
    if (this.gameMode !== "survival") {
      this.inventory.set(this.selected, { id, count: 64 });
      this.refreshHotbarRow();
      this._announce(BLOCKS[id].name);
      return;
    }
    for (let i = 0; i < 9; i++) {
      const s = this.inventory.get(i);
      if (s && s.id === id) { this.select(i); return; }
    }
    for (let i = 9; i < 36; i++) {
      const s = this.inventory.get(i);
      if (s && s.id === id) {
        const cur = this.inventory.get(this.selected);
        this.inventory.set(i, cur);
        this.inventory.set(this.selected, s);
        this.refreshHotbarRow();
        this._announce(BLOCKS[id].name);
        return;
      }
    }
  }

  // transient center-screen caption: hotbar names, the Moss Cot's commentary
  announce(text, ms = 1200) {
    this.blockNameEl.textContent = text;
    this.blockNameEl.style.opacity = "1";
    clearTimeout(this._nameTimeout);
    this._nameTimeout = setTimeout(() => { this.blockNameEl.style.opacity = "0"; }, ms);
  }
  _announce(name) { this.announce(name); }

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
    this.refreshHotbarRow();
  }

  // the footer hotbar is a direct view of inventory slots 0-8
  refreshHotbarRow() {
    for (let i = 0; i < 9; i++) {
      const { slot, canvas, count } = this.slotEls[i];
      slot.classList.toggle("selected", i === this.selected);
      const s = this.inventory.get(i);
      slot.classList.toggle("empty", !s);
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (s) drawBlockIcon(ctx, this.atlas, s.id);
      count.textContent = s && s.count > 1 ? String(s.count) : "";
    }
  }

  // legacy name used by a few call sites
  refreshCounts() { this.refreshHotbarRow(); }

  _buildPicker() {
    this.pickerEl = document.getElementById("picker");
  }

  // the compact "field recipes" list shown in the inventory window (survival)
  _renderFieldRecipes() {
    const el = document.getElementById("field-recipes");
    if (this.gameMode !== "survival") { el.innerHTML = ""; return; }
    this._renderCraftList(el, this._fieldOrder);
  }

  // craft list: one row per recipe, from a pre-sorted order that is FROZEN
  // per window visit — re-sorting after a craft would slide a different
  // recipe under the cursor mid-double-click.
  _renderCraftList(list, order) {
    list.innerHTML = "";
    for (const recipe of order) {
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
        row.addEventListener("mousedown", (e) => {
          e.preventDefault();
          this.onCraft(recipe, e.shiftKey); // shift-click crafts max
          this._renderCraftList(list, order);
          this.slotUI.renderAll();
          this.refreshHotbarRow();
        });
      }
      list.appendChild(row);
    }
  }

  _sortedRecipes(recipes) {
    return [...recipes].sort(
      (a, b) => Number(canCraft(b, this.inventory)) - Number(canCraft(a, this.inventory)));
  }

  _invRegions() {
    return {
      hotbar: invRegion("hotbar", this.inventory, 0, 9),
      main: invRegion("main", this.inventory, 9, 27),
    };
  }

  // inventory window: survival = satchel grid + belt (+ field recipes);
  // creative = full palette + belt
  openPicker() {
    const survival = this.gameMode === "survival";
    document.getElementById("palette-grid").classList.toggle("hidden", survival);
    document.getElementById("main-grid").classList.toggle("hidden", !survival);
    document.getElementById("inv-main-label").textContent = survival ? "Satchel" : "All blocks";
    const { hotbar, main } = this._invRegions();
    let views, quick;
    if (survival) {
      views = [
        { region: main, gridEl: document.getElementById("main-grid") },
        { region: hotbar, gridEl: document.getElementById("hotbar-grid") },
      ];
      quick = { main: [hotbar], hotbar: [main] };
    } else {
      const palette = paletteRegion("palette", PLACEABLE);
      views = [
        { region: palette, gridEl: document.getElementById("palette-grid") },
        { region: hotbar, gridEl: document.getElementById("hotbar-grid") },
      ];
      quick = { palette: [hotbar], hotbar: [] };
    }
    this.slotUI.open(views, quick);
    this._fieldOrder = this._sortedRecipes(BASIC_RECIPES);
    this._renderFieldRecipes();
    this.pickerOpen = true;
    this.pickerEl.classList.remove("hidden");
    if (this.playerViewer) this.playerViewer.start();
    document.exitPointerLock();
  }

  closePicker() {
    if (!this.pickerOpen) return;
    this.pickerOpen = false;
    this.slotUI.close(); // spills any held cursor stack
    this.pickerEl.classList.add("hidden");
    if (this.playerViewer) this.playerViewer.stop();
  }

  // chest window: container grid + satchel + belt on the same engine
  openChest(slots, onChange) {
    this.chestOpen = true;
    this._chestChanged = onChange;
    const chest = arrayRegion("chest", slots);
    const { hotbar, main } = this._invRegions();
    this.slotUI.open([
      { region: chest, gridEl: document.getElementById("chest-grid") },
      { region: main, gridEl: document.getElementById("chest-main-grid") },
      { region: hotbar, gridEl: document.getElementById("chest-hotbar-grid") },
    ], { chest: [main, hotbar], main: [chest], hotbar: [chest] });
    document.getElementById("chest-ui").classList.remove("hidden");
    document.exitPointerLock();
  }

  closeChest() {
    if (!this.chestOpen) return;
    this.chestOpen = false;
    this.slotUI.close();
    document.getElementById("chest-ui").classList.add("hidden");
    this._chestChanged = null;
  }

  // workbench window: the full cookbook + satchel + belt
  openBench() {
    this.benchOpen = true;
    const { hotbar, main } = this._invRegions();
    this.slotUI.open([
      { region: main, gridEl: document.getElementById("bench-main-grid") },
      { region: hotbar, gridEl: document.getElementById("bench-hotbar-grid") },
    ], { main: [hotbar], hotbar: [main] });
    this._benchOrder = this._sortedRecipes(RECIPES);
    this._renderCraftList(document.getElementById("craft-list"), this._benchOrder);
    document.getElementById("bench-ui").classList.remove("hidden");
    document.exitPointerLock();
  }

  closeBench() {
    if (!this.benchOpen) return;
    this.benchOpen = false;
    this.slotUI.close();
    document.getElementById("bench-ui").classList.add("hidden");
  }

  // kiln window: input over fuel, smelt-progress arrow, take-only output,
  // plus the usual satchel + belt. `kiln` is the live per-block state object
  // (world.kilns entry) — the tick in main.js mutates it while we're open.
  openKiln(kiln) {
    this.kilnOpen = true;
    this._kiln = kiln;
    const input = slotRegion("input", kiln.slots, 0);
    const fuel = slotRegion("fuel", kiln.slots, 1);
    const output = slotRegion("output", kiln.slots, 2, { takeOnly: true });
    const { hotbar, main } = this._invRegions();
    // shift-click routing: kiln slots drain to the inventory; inventory
    // stacks route by id — smeltables to the input, fuels to the fire,
    // anything else hops between satchel and belt
    const routeById = (fallback) => (s) =>
      SMELTS[s.id] !== undefined ? [input]
        : FUEL_SECONDS[s.id] ? [fuel]
        : [fallback];
    this.slotUI.open([
      { region: input, gridEl: document.getElementById("kiln-in-grid") },
      { region: fuel, gridEl: document.getElementById("kiln-fuel-grid") },
      { region: output, gridEl: document.getElementById("kiln-out-grid") },
      { region: main, gridEl: document.getElementById("kiln-main-grid") },
      { region: hotbar, gridEl: document.getElementById("kiln-hotbar-grid") },
    ], {
      input: [main, hotbar],
      fuel: [main, hotbar],
      output: [main, hotbar],
      main: routeById(hotbar),
      hotbar: routeById(main),
    });
    this.updateKilnView();
    document.getElementById("kiln-ui").classList.remove("hidden");
    document.exitPointerLock();
  }

  closeKiln() {
    if (!this.kilnOpen) return;
    this.kilnOpen = false;
    this._kiln = null;
    this.slotUI.close();
    document.getElementById("kiln-ui").classList.add("hidden");
  }

  // driven every frame from the game loop while the window is open
  updateKilnView() {
    if (!this.kilnOpen) return;
    const k = this._kiln;
    document.getElementById("kiln-progress").style.width =
      `${Math.min(100, (k.progress / SMELT_SECONDS) * 100)}%`;
    document.getElementById("kiln-ember").classList.toggle("lit", k.burnLeft > 0);
  }

  anyWindowOpen() {
    return this.pickerOpen || this.chestOpen || this.benchOpen ||
      this.kilnOpen || this.signOpen;
  }

  closeAllWindows() {
    this.closePicker();
    this.closeChest();
    this.closeBench();
    this.closeKiln();
    this.closeSign(); // commits — a defensive close never eats the writing
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

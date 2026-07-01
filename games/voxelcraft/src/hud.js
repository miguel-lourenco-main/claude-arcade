// DOM HUD: hotbar with fake-isometric block icons, block picker, debug
// overlay, pause overlay, underwater tint.

import { BLOCKS, PLACEABLE, DEFAULT_HOTBAR } from "./blocks.js";
import { ATLAS_TILES, TILE_PX } from "./textures.js";

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

export class Hud {
  constructor(atlasCanvas, opts) {
    this.atlas = atlasCanvas;
    this.onResume = opts.onResume;
    this.onReset = opts.onReset;
    this.onTeleport = opts.onTeleport;             // (kind) => {ok, message}
    this.onToggleMovement = opts.onToggleMovement; // () => new mode string
    this.slots = [...DEFAULT_HOTBAR];
    this.selected = 0;
    this.pickerOpen = false;
    this.paused = true; // the boot overlay is showing

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

    this._buildTeleports();
  }

  setMovementLabel(mode) {
    this.movementBtn.textContent =
      mode === "static" ? "Movement: World-static" : "Movement: Camera-relative";
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
    this._announce(BLOCKS[this.selectedId()].name);
  }

  scroll(delta) { this.select(this.selected + (delta > 0 ? 1 : -1)); }

  setSlot(blockId) {
    this.slots[this.selected] = blockId;
    this._refreshHotbar();
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
      bar.appendChild(slot);
      this.slotEls.push({ slot, canvas });
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
    const grid = document.getElementById("picker-grid");
    for (const id of PLACEABLE) {
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
      cell.addEventListener("click", () => {
        this.setSlot(id);
        this.closePicker();
        this.onResume();
      });
      grid.appendChild(cell);
    }
  }

  openPicker() {
    this.pickerOpen = true;
    this.pickerEl.classList.remove("hidden");
    document.exitPointerLock();
  }

  closePicker() {
    this.pickerOpen = false;
    this.pickerEl.classList.add("hidden");
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

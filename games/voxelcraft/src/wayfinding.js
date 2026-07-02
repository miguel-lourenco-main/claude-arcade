// The wayfinding kit's living parts (the items themselves live in blocks.js):
// - the Homeward Needle's HUD widget: a slim dark dial whose rust needle
//   leans toward the spawn anchor (the slept-in Moss Cot, else world spawn),
//   yaw-relative and live, shown while a Needle rides ANY hotbar slot;
// - the Sky Dial's widget: sun and moon pips riding sky.time around a tiny
//   horizon, on the same hotbar-presence rule;
// - the Field Chart: while HELD, a parchment canvas in the lower right that
//   paints top-down terrain the player has actually walked — 1px = 1 block,
//   north-up, scrolling with the walker, bounded to one 256×256-block leaf
//   anchored where the chart was first unrolled. Revealed pixels persist per
//   world as an additive save field (the leaf canvas as a PNG data URL).

import { BLOCKS, AIR, WATER, COMPASS, CLOCK, CHART } from "./blocks.js";
import { HEIGHT } from "./world.js";

export const CHART_SIZE = 256; // world blocks per leaf side, 1px = 1 block
const REVEAL_RADIUS = 40;      // blocks inked around the walker per pass
const REVEAL_INTERVAL = 0.8;   // seconds between reveal passes while held
const W = 56, C = W / 2;       // needle/dial widget canvas size + center

const TAU = Math.PI * 2;
export function normAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

// the yaw a player at (px,pz) would have facing (tx,tz) — yaw 0 looks to -z
export function bearingYaw(px, pz, tx, tz) {
  return Math.atan2(-(tx - px), -(tz - pz));
}

// the shared dark case both widgets sit in (our HUD's dark UI idiom)
function drawCase(ctx) {
  ctx.beginPath();
  ctx.arc(C, C, C - 3, 0, TAU);
  ctx.fillStyle = "rgba(10, 12, 16, 0.72)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#3a414c";
  ctx.stroke();
}

export class Wayfinder {
  constructor(avgColor, getSpawnTarget) {
    this.avgColor = avgColor;
    this.getSpawnTarget = getSpawnTarget; // () => {x, y, z} the needle leans to
    this.needleEl = document.getElementById("needle-widget");
    this.dialEl = document.getElementById("dial-widget");
    this.chartEl = document.getElementById("chart-widget");
    this.needleCtx = this.needleEl.getContext("2d");
    this.dialCtx = this.dialEl.getContext("2d");
    this.chartCtx = this.chartEl.getContext("2d");

    this.needleAngle = 0; // screen radians: 0 = anchor dead ahead, + clockwise
    this.dialTime = 0;    // the sky.time last drawn

    // the chart leaf: an offscreen canvas of revealed pixels in leaf space
    this.anchor = null;   // {x, z} block coords of the leaf center
    this.painted = 0;     // revealed pixel count (tests + curiosity)
    this.off = document.createElement("canvas");
    this.off.width = this.off.height = CHART_SIZE;
    this.offCtx = this.off.getContext("2d", { willReadFrequently: true });
    this._revealT = 0;
    this._dirty = false;
    this._png = null;     // cached serialization of the leaf
  }

  // driven once per frame from the game loop
  update(dt, { inventory, hud, player, sky, world, playing }) {
    // hotbar presence is the whole contract: any belt slot will do
    let hasNeedle = false, hasDial = false;
    for (let i = 0; i < 9; i++) {
      const s = inventory.get(i);
      if (!s) continue;
      if (s.id === COMPASS) hasNeedle = true;
      else if (s.id === CLOCK) hasDial = true;
    }
    this.needleEl.classList.toggle("hidden", !hasNeedle);
    this.dialEl.classList.toggle("hidden", !hasDial);
    if (hasNeedle) this._drawNeedle(player);
    if (hasDial) this._drawDial(sky.time);

    // the chart wants to be HELD, not just carried
    const held = hud.selectedId() === CHART;
    this.chartEl.classList.toggle("hidden", !held);
    if (!held) { this._revealT = 0; return; } // next hold reveals immediately
    this._revealT -= dt;
    if (playing && this._revealT <= 0) {
      this._revealT = REVEAL_INTERVAL;
      this.reveal(world, player);
    }
    this._drawChart(player);
  }

  _drawNeedle(player) {
    const t = this.getSpawnTarget();
    const dx = t.x - player.pos.x, dz = t.z - player.pos.z;
    // standing on the anchor the bearing is noise — let the needle rest
    if (dx * dx + dz * dz > 0.5) {
      this.needleAngle =
        normAngle(player.yaw - bearingYaw(player.pos.x, player.pos.z, t.x, t.z));
    }
    const ctx = this.needleCtx;
    ctx.clearRect(0, 0, W, W);
    drawCase(ctx);
    // heading ticks: the bold one is the way you're facing
    ctx.fillStyle = "#7c8592";
    ctx.fillRect(C - 1, 4, 2, 6);
    ctx.fillStyle = "#3f4650";
    ctx.fillRect(C - 1, W - 9, 2, 4);
    ctx.fillRect(5, C - 1, 4, 2);
    ctx.fillRect(W - 9, C - 1, 4, 2);
    // the needle: rust leans home, pale iron trails
    ctx.save();
    ctx.translate(C, C);
    ctx.rotate(this.needleAngle);
    ctx.fillStyle = "#c56a2b";
    ctx.beginPath();
    ctx.moveTo(0, -17); ctx.lineTo(3.6, 3); ctx.lineTo(-3.6, 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#d6dbe2";
    ctx.beginPath();
    ctx.moveTo(2.6, 3); ctx.lineTo(0, 13); ctx.lineTo(-2.6, 3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // the mustard pivot pin
    ctx.fillStyle = "#d6b04a";
    ctx.beginPath();
    ctx.arc(C, C, 2.4, 0, TAU);
    ctx.fill();
  }

  _drawDial(time) {
    this.dialTime = time;
    const ctx = this.dialCtx;
    ctx.clearRect(0, 0, W, W);
    drawCase(ctx);
    // the horizon, with the old pearls sleeping under it
    ctx.strokeStyle = "#3f4650";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(8, C + 0.5); ctx.lineTo(W - 8, C + 0.5);
    ctx.stroke();
    ctx.fillStyle = "#9fb0d8";
    ctx.fillRect(C - 9, C + 10, 1, 1);
    ctx.fillRect(C + 6, C + 13, 1, 1);
    ctx.fillRect(C + 12, C + 7, 1, 1);
    // sun and moon ride opposite ends of the day wheel (0.25 = noon, on top)
    const a = time * TAU, r = 17;
    const sx = C - Math.cos(a) * r, sy = C - Math.sin(a) * r;
    const mx = C + Math.cos(a) * r, my = C + Math.sin(a) * r;
    ctx.fillStyle = "#dde4f0";
    ctx.beginPath();
    ctx.arc(mx, my, 3.4, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#ffd27a";
    ctx.beginPath();
    ctx.arc(sx, sy, 4.4, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#c56a2b";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // ink every generated column within reach onto the leaf (and only within
  // the leaf's fixed 256×256 world window — a chart holds one leaf's worth)
  reveal(world, player) {
    const px = Math.floor(player.pos.x), pz = Math.floor(player.pos.z);
    // the leaf anchors itself where the chart is first unrolled
    if (!this.anchor) this.anchor = { x: px, z: pz };
    const x0 = this.anchor.x - CHART_SIZE / 2, z0 = this.anchor.z - CHART_SIZE / 2;
    const wx0 = Math.max(px - REVEAL_RADIUS, x0);
    const wx1 = Math.min(px + REVEAL_RADIUS, x0 + CHART_SIZE - 1);
    const wz0 = Math.max(pz - REVEAL_RADIUS, z0);
    const wz1 = Math.min(pz + REVEAL_RADIUS, z0 + CHART_SIZE - 1);
    if (wx1 < wx0 || wz1 < wz0) return; // walked clean off the leaf
    const w = wx1 - wx0 + 1, h = wz1 - wz0 + 1;
    const img = this.offCtx.getImageData(wx0 - x0, wz0 - z0, w, h);
    const data = img.data;
    const waterAvg = this.avgColor[BLOCKS[WATER].tiles.top];
    let touched = false;
    for (let z = wz0; z <= wz1; z++) {
      for (let x = wx0; x <= wx1; x++) {
        if (!world.isGenerated(x >> 4, z >> 4)) continue; // unwalked stays blank
        // the dominant surface block: topmost non-air cell, ignoring the
        // cross-kind decorations (grass tufts, flowers, crops, torches)
        let y = HEIGHT - 1, id = AIR;
        for (; y > 0; y--) {
          id = world.getBlock(x, y, z);
          if (id !== AIR && BLOCKS[id].kind !== "cross") break;
        }
        if (id === AIR) continue;
        const avg = (id === WATER ? waterAvg : this.avgColor[BLOCKS[id].tiles.top])
          || [0.5, 0.5, 0.5];
        // higher ground inks paler — a cheap relief read
        const shade = (0.66 + 0.55 * (y / HEIGHT)) * 255;
        const k = ((z - wz0) * w + (x - wx0)) * 4;
        if (data[k + 3] === 0) this.painted++;
        data[k] = Math.min(255, avg[0] * shade);
        data[k + 1] = Math.min(255, avg[1] * shade);
        data[k + 2] = Math.min(255, avg[2] * shade);
        data[k + 3] = 255;
        touched = true;
      }
    }
    if (!touched) return;
    this.offCtx.putImageData(img, wx0 - x0, wz0 - z0);
    this._dirty = true;
  }

  _drawChart(player) {
    const ctx = this.chartCtx;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#cfb27c"; // unwalked parchment
    ctx.fillRect(0, 0, CHART_SIZE, CHART_SIZE);
    if (this.anchor) {
      // the window scrolls with the walker; the leaf stays where it was inked
      const px = Math.floor(player.pos.x), pz = Math.floor(player.pos.z);
      ctx.drawImage(this.off, this.anchor.x - px, this.anchor.z - pz);
    }
    // the walker, north-up: a rust arrow turning with yaw at the center
    ctx.save();
    ctx.translate(CHART_SIZE / 2, CHART_SIZE / 2);
    ctx.rotate(-player.yaw);
    ctx.fillStyle = "#b03a2e";
    ctx.strokeStyle = "rgba(255, 244, 220, 0.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // -> {ax, az, png} for the save, or undefined for a never-unrolled chart
  serializeChart() {
    if (!this.anchor) return undefined;
    if (this._dirty || !this._png) {
      this._png = this.off.toDataURL("image/png");
      this._dirty = false;
    }
    return { ax: this.anchor.x, az: this.anchor.z, png: this._png };
  }

  // additive save field, validated: a bad leaf is simply a fresh chart
  loadChart(data) {
    if (!data || !Number.isInteger(data.ax) || !Number.isInteger(data.az)) return;
    if (typeof data.png !== "string" || !data.png.startsWith("data:image/")) return;
    this.anchor = { x: data.ax, z: data.az };
    this._png = data.png; // serialize hands back the original until a reveal
    const img = new Image();
    img.onload = () => {
      // UNDER any fresh ink: pixels revealed since boot beat the stale save
      this.offCtx.globalCompositeOperation = "destination-over";
      this.offCtx.drawImage(img, 0, 0);
      this.offCtx.globalCompositeOperation = "source-over";
      const d = this.offCtx.getImageData(0, 0, CHART_SIZE, CHART_SIZE).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
      this.painted = n;
    };
    img.src = data.png;
  }
}

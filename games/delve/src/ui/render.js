// Canvas glyph renderer. Three tile states: unseen (black), remembered (dim
// geometry only), visible (lit, with items and monsters). Adds a torchlight
// falloff, a soft flicker, and short-lived hit/projectile effects.
import { T, MAP_W, MAP_H, idx } from '../core/dungeon.js';
import { MONSTERS, ITEMS } from '../core/data.js';
import { FOV_RADIUS } from '../core/game.js';

export const CELL_W = 15;
export const CELL_H = 20;

const GLYPH = { [T.WALL]: '#', [T.FLOOR]: '·', [T.DOWN]: '>', [T.UP]: '<' };

const LIT = { [T.WALL]: '#a08b5f', [T.FLOOR]: '#6f6654', [T.DOWN]: '#ffd27a', [T.UP]: '#9ecbff' };
const DIM = { [T.WALL]: '#333944', [T.FLOOR]: '#20242b', [T.DOWN]: '#6b5c3a', [T.UP]: '#3d4d63' };

const shadeCache = new Map();
function shade(hex, b) {
  const q = Math.round(b * 20) / 20;
  const key = hex + q;
  let v = shadeCache.get(key);
  if (!v) {
    const r = Math.round(parseInt(hex.slice(1, 3), 16) * q);
    const g = Math.round(parseInt(hex.slice(3, 5), 16) * q);
    const bl = Math.round(parseInt(hex.slice(5, 7), 16) * q);
    v = `rgb(${r},${g},${bl})`;
    shadeCache.set(key, v);
  }
  return v;
}

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    canvas.width = MAP_W * CELL_W;
    canvas.height = MAP_H * CELL_H;
    this.effects = [];
  }

  addEffect(e) {
    this.effects.push({ ...e, t0: performance.now() });
  }

  cellCenter(x, y) {
    return [x * CELL_W + CELL_W / 2, y * CELL_H + CELL_H / 2 + 1];
  }

  draw(game, now = performance.now()) {
    const ctx = this.ctx;
    const f = game.curFloor;
    const p = game.player;
    ctx.fillStyle = '#0a0c0f';
    ctx.fillRect(0, 0, this.cv.width, this.cv.height);
    ctx.font = `15px ui-monospace, "Cascadia Code", Menlo, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const flicker = 1 + Math.sin(now / 87) * 0.02 + Math.sin(now / 231) * 0.015;

    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const i = idx(x, y);
        if (!f.seen[i]) continue; // unseen: pure black
        const t = f.tiles[i];
        const [cx, cy] = this.cellCenter(x, y);
        if (f.visible[i]) {
          const dd = Math.hypot(x - p.x, y - p.y);
          const b = Math.max(0.4, Math.min(1, 1.18 - dd / (FOV_RADIUS + 3))) * flicker;
          ctx.fillStyle = `rgba(232, 180, 90, ${(0.055 * b).toFixed(3)})`;
          ctx.fillRect(x * CELL_W, y * CELL_H, CELL_W, CELL_H);
          ctx.fillStyle = shade(LIT[t], b);
        } else {
          ctx.fillStyle = DIM[t]; // remembered: dim geometry, no entities
        }
        ctx.fillText(GLYPH[t], cx, cy);
      }
    }

    // items (visible tiles only)
    for (const it of f.items) {
      const i = idx(it.x, it.y);
      if (!f.visible[i]) continue;
      const d = ITEMS[it.id];
      const [cx, cy] = this.cellCenter(it.x, it.y);
      if (it.id === 'artifact') {
        const pulse = 6 + Math.sin(now / 220) * 4;
        ctx.save();
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = pulse;
        ctx.fillStyle = d.color;
        ctx.fillText(d.glyph, cx, cy);
        ctx.restore();
      } else {
        ctx.fillStyle = d.color;
        ctx.fillText(d.glyph, cx, cy);
      }
    }

    // monsters (visible tiles only)
    for (const m of f.monsters) {
      const i = idx(m.x, m.y);
      if (!f.visible[i]) continue;
      const d = MONSTERS[m.type];
      const [cx, cy] = this.cellCenter(m.x, m.y);
      ctx.fillStyle = d.color;
      ctx.fillText(d.glyph, cx, cy);
      if (m.hp < m.maxhp) {
        const frac = Math.max(0, m.hp / m.maxhp);
        const bw = CELL_W - 6;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(m.x * CELL_W + 3, m.y * CELL_H + 1, bw, 2);
        ctx.fillStyle = frac > 0.5 ? '#7ee787' : frac > 0.25 ? '#e8b45a' : '#ff7d6e';
        ctx.fillRect(m.x * CELL_W + 3, m.y * CELL_H + 1, bw * frac, 2);
      }
    }

    // the player
    {
      const [cx, cy] = this.cellCenter(p.x, p.y);
      ctx.save();
      ctx.shadowColor = '#e8b45a';
      ctx.shadowBlur = 7;
      ctx.fillStyle = '#f2ead8';
      ctx.fillText('@', cx, cy);
      ctx.restore();
    }

    // transient effects
    const keep = [];
    for (const e of this.effects) {
      const age = now - e.t0;
      const dur = e.kind === 'spit' ? 170 : 190;
      if (age > dur) continue;
      const a = 1 - age / dur;
      if (e.kind === 'flash') {
        ctx.fillStyle = e.color;
        ctx.globalAlpha = a * 0.45;
        ctx.fillRect(e.x * CELL_W, e.y * CELL_H, CELL_W, CELL_H);
        ctx.globalAlpha = 1;
      } else if (e.kind === 'spit') {
        const [x0, y0] = this.cellCenter(e.fx, e.fy);
        const [x1, y1] = this.cellCenter(e.tx, e.ty);
        ctx.strokeStyle = '#b4e050';
        ctx.globalAlpha = a * 0.8;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      keep.push(e);
    }
    this.effects = keep;
  }
}

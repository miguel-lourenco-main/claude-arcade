// cards.js — deck, seeded shuffle, and procedural card artwork.
// Suits: 0 = spades, 1 = hearts, 2 = diamonds, 3 = clubs.

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUIT_CHAR = ['♠', '♥', '♦', '♣'];
export const isRed = (s) => s === 1 || s === 2;

// --- seeded PRNG (mulberry32) + Fisher-Yates ---

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffledDeck(seed) {
  const rnd = mulberry32(seed);
  const deck = [];
  for (let s = 0; s < 4; s++) {
    for (let r = 1; r <= 13; r++) deck.push({ r, s, up: false });
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
  }
  return deck;
}

// --- palette ---

const PAPER = '#f2efe4';
const PAPER_EDGE = '#c9c4b2';
const INK_BLACK = '#22262c';
const INK_RED = '#c23b3b';
const GOLD = '#c9a02e';
const BACK_BG = '#152430';
const BACK_LINE = '#2c4d61';
const BACK_ACCENT = '#7ee0b0';

// --- suit glyph paths (drawn with current fillStyle) ---

export function drawSuit(ctx, s, cx, cy, size) {
  const k = size;
  ctx.beginPath();
  if (s === 2) { // diamond
    ctx.moveTo(cx, cy - k * 0.48);
    ctx.lineTo(cx + k * 0.36, cy);
    ctx.lineTo(cx, cy + k * 0.48);
    ctx.lineTo(cx - k * 0.36, cy);
    ctx.closePath();
  } else if (s === 1) { // heart
    ctx.moveTo(cx, cy + k * 0.40);
    ctx.bezierCurveTo(cx - k * 0.62, cy - k * 0.04, cx - k * 0.32, cy - k * 0.50, cx, cy - k * 0.16);
    ctx.bezierCurveTo(cx + k * 0.32, cy - k * 0.50, cx + k * 0.62, cy - k * 0.04, cx, cy + k * 0.40);
    ctx.closePath();
  } else if (s === 0) { // spade: inverted heart + stem
    ctx.moveTo(cx, cy - k * 0.44);
    ctx.bezierCurveTo(cx - k * 0.60, cy + k * 0.02, cx - k * 0.32, cy + k * 0.40, cx, cy + k * 0.10);
    ctx.bezierCurveTo(cx + k * 0.32, cy + k * 0.40, cx + k * 0.60, cy + k * 0.02, cx, cy - k * 0.44);
    ctx.closePath();
    ctx.moveTo(cx - k * 0.16, cy + k * 0.46);
    ctx.quadraticCurveTo(cx - k * 0.02, cy + k * 0.30, cx, cy + k * 0.06);
    ctx.quadraticCurveTo(cx + k * 0.02, cy + k * 0.30, cx + k * 0.16, cy + k * 0.46);
    ctx.closePath();
  } else { // club: three lobes + stem
    const r = k * 0.20;
    ctx.arc(cx, cy - k * 0.22, r, 0, Math.PI * 2);
    ctx.moveTo(cx - k * 0.20 + r, cy + k * 0.06);
    ctx.arc(cx - k * 0.20, cy + k * 0.06, r, 0, Math.PI * 2);
    ctx.moveTo(cx + k * 0.20 + r, cy + k * 0.06);
    ctx.arc(cx + k * 0.20, cy + k * 0.06, r, 0, Math.PI * 2);
    ctx.moveTo(cx - k * 0.15, cy + k * 0.46);
    ctx.quadraticCurveTo(cx - k * 0.02, cy + k * 0.28, cx, cy + k * 0.02);
    ctx.quadraticCurveTo(cx + k * 0.02, cy + k * 0.28, cx + k * 0.15, cy + k * 0.46);
    ctx.closePath();
  }
  ctx.fill();
}

// classic pip positions, normalized: x in [-1,1], y in [-1,1]
const PIPS = {
  2: [[0, -1], [0, 1]],
  3: [[0, -1], [0, 0], [0, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
  7: [[-1, -1], [1, -1], [0, -0.5], [-1, 0], [1, 0], [-1, 1], [1, 1]],
  8: [[-1, -1], [1, -1], [0, -0.5], [-1, 0], [1, 0], [0, 0.5], [-1, 1], [1, 1]],
  9: [[-1, -1], [1, -1], [-1, -0.33], [1, -0.33], [0, 0], [-1, 0.33], [1, 0.33], [-1, 1], [1, 1]],
  10: [[-1, -1], [1, -1], [0, -0.62], [-1, -0.33], [1, -0.33], [-1, 0.33], [1, 0.33], [0, 0.62], [-1, 1], [1, 1]],
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// --- original geometric court designs (no traditional card art) ---

function drawCourt(ctx, w, h, r, s, ink) {
  const cx = w / 2;
  const cy = h * 0.56;
  const fw = w * 0.56;
  const fh = h * 0.42;

  // frame
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(1, w * 0.016);
  ctx.strokeRect(cx - fw / 2, cy - fh / 2, fw, fh);
  ctx.strokeStyle = GOLD;
  ctx.strokeRect(cx - fw / 2 + w * 0.035, cy - fh / 2 + w * 0.035, fw - w * 0.07, fh - w * 0.07);

  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - fw / 2, cy - fh / 2, fw, fh);
  ctx.clip();

  if (r === 11) {
    // Jack — a diagonal sash with mirrored triangles
    ctx.fillStyle = GOLD;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(cx - fw / 2, cy + fh / 2);
    ctx.lineTo(cx + fw / 2, cy - fh / 2);
    ctx.lineTo(cx + fw / 2, cy - fh / 2 + fh * 0.28);
    ctx.lineTo(cx - fw / 2 + fw * 0.28, cy + fh / 2);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.moveTo(cx - fw * 0.36, cy - fh * 0.38);
    ctx.lineTo(cx - fw * 0.08, cy - fh * 0.38);
    ctx.lineTo(cx - fw * 0.36, cy - fh * 0.06);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + fw * 0.36, cy + fh * 0.38);
    ctx.lineTo(cx + fw * 0.08, cy + fh * 0.38);
    ctx.lineTo(cx + fw * 0.36, cy + fh * 0.06);
    ctx.closePath();
    ctx.fill();
  } else if (r === 12) {
    // Queen — concentric diamonds and a dot crown
    ctx.strokeStyle = ink;
    for (let i = 3; i >= 1; i--) {
      const dw = fw * 0.16 * i;
      const dh = fh * 0.26 * i;
      ctx.beginPath();
      ctx.moveTo(cx, cy - dh / 2);
      ctx.lineTo(cx + dw / 2, cy);
      ctx.lineTo(cx, cy + dh / 2);
      ctx.lineTo(cx - dw / 2, cy);
      ctx.closePath();
      if (i === 1) { ctx.fillStyle = GOLD; ctx.fill(); }
      ctx.stroke();
    }
    ctx.fillStyle = ink;
    for (const dx of [-0.3, 0, 0.3]) {
      ctx.beginPath();
      ctx.arc(cx + fw * dx, cy - fh * 0.36, w * 0.028, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // King — a five-point crown over pillars
    ctx.strokeStyle = ink;
    ctx.beginPath();
    for (const dx of [-0.32, -0.16, 0, 0.16, 0.32]) {
      ctx.moveTo(cx + fw * dx, cy + fh * 0.34);
      ctx.lineTo(cx + fw * dx, cy - fh * 0.34);
    }
    ctx.stroke();
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    ctx.moveTo(cx - fw * 0.40, cy + fh * 0.06);
    ctx.lineTo(cx - fw * 0.40, cy - fh * 0.20);
    ctx.lineTo(cx - fw * 0.20, cy - fh * 0.02);
    ctx.lineTo(cx, cy - fh * 0.30);
    ctx.lineTo(cx + fw * 0.20, cy - fh * 0.02);
    ctx.lineTo(cx + fw * 0.40, cy - fh * 0.20);
    ctx.lineTo(cx + fw * 0.40, cy + fh * 0.06);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.stroke();
  }
  ctx.restore();

  // suit badge below the frame
  ctx.fillStyle = ink;
  drawSuit(ctx, s, cx, cy + fh / 2 + h * 0.075, w * 0.16);
}

// --- card art cache ---

export class CardArt {
  constructor() {
    this.w = 0; this.h = 0; this.dpr = 1;
    this.faces = new Map();
    this.backCv = null;
  }

  size(w, h, dpr) {
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w; this.h = h; this.dpr = dpr;
    this.faces.clear();
    this.backCv = null;
  }

  _blank() {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(this.w * this.dpr));
    cv.height = Math.max(1, Math.round(this.h * this.dpr));
    const ctx = cv.getContext('2d');
    ctx.scale(this.dpr, this.dpr);
    return { cv, ctx };
  }

  face(r, s) {
    const key = r * 4 + s;
    let cv = this.faces.get(key);
    if (cv) return cv;
    const made = this._blank();
    this._renderFace(made.ctx, r, s);
    cv = made.cv;
    this.faces.set(key, cv);
    return cv;
  }

  back() {
    if (this.backCv) return this.backCv;
    const { cv, ctx } = this._blank();
    this._renderBack(ctx);
    this.backCv = cv;
    return cv;
  }

  _renderFace(ctx, r, s) {
    const w = this.w, h = this.h;
    const rad = w * 0.09;
    const ink = isRed(s) ? INK_RED : INK_BLACK;

    roundRect(ctx, 0.5, 0.5, w - 1, h - 1, rad);
    ctx.fillStyle = PAPER;
    ctx.fill();
    ctx.strokeStyle = PAPER_EDGE;
    ctx.lineWidth = 1;
    ctx.stroke();

    // big corner index (readability first)
    const rankTxt = RANKS[r - 1];
    const fs = w * (rankTxt === '10' ? 0.24 : 0.28);
    ctx.fillStyle = ink;
    ctx.font = `700 ${fs}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(rankTxt, w * 0.07, h * 0.045);
    drawSuit(ctx, s, w * 0.145, h * 0.045 + fs + w * 0.12, w * 0.19);

    // rotated index, bottom-right
    ctx.save();
    ctx.translate(w, h);
    ctx.rotate(Math.PI);
    ctx.fillStyle = ink;
    ctx.fillText(rankTxt, w * 0.07, h * 0.045);
    drawSuit(ctx, s, w * 0.145, h * 0.045 + fs + w * 0.12, w * 0.19);
    ctx.restore();

    // subtle big watermark suit behind the middle
    ctx.globalAlpha = 0.09;
    ctx.fillStyle = ink;
    drawSuit(ctx, s, w / 2, h * 0.56, w * 0.78);
    ctx.globalAlpha = 1;

    if (r === 1) {
      ctx.fillStyle = ink;
      drawSuit(ctx, s, w / 2, h * 0.56, w * 0.42);
    } else if (r >= 11) {
      drawCourt(ctx, w, h, r, s, ink);
    } else {
      const pips = PIPS[r];
      const px = w * 0.20;   // pip area half-width
      const py = h * 0.26;   // pip area half-height
      ctx.fillStyle = ink;
      for (const [nx, ny] of pips) {
        drawSuit(ctx, s, w / 2 + nx * px, h * 0.56 + ny * py, w * 0.155);
      }
    }
  }

  _renderBack(ctx) {
    const w = this.w, h = this.h;
    const rad = w * 0.09;
    roundRect(ctx, 0.5, 0.5, w - 1, h - 1, rad);
    ctx.fillStyle = BACK_BG;
    ctx.fill();
    ctx.strokeStyle = '#0a1117';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.save();
    roundRect(ctx, 2.5, 2.5, w - 5, h - 5, rad * 0.8);
    ctx.clip();
    ctx.strokeStyle = BACK_LINE;
    ctx.lineWidth = 1;
    const step = Math.max(6, w * 0.13);
    ctx.beginPath();
    for (let d = -h; d < w + h; d += step) {
      ctx.moveTo(d, 0); ctx.lineTo(d + h, h);
      ctx.moveTo(d, h); ctx.lineTo(d + h, 0);
    }
    ctx.stroke();
    ctx.restore();

    roundRect(ctx, 2.5, 2.5, w - 5, h - 5, rad * 0.8);
    ctx.strokeStyle = BACK_LINE;
    ctx.stroke();

    // small center diamond in the arcade accent
    ctx.fillStyle = BACK_ACCENT;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(w / 2, h / 2 - w * 0.10);
    ctx.lineTo(w / 2 + w * 0.075, h / 2);
    ctx.lineTo(w / 2, h / 2 + w * 0.10);
    ctx.lineTo(w / 2 - w * 0.075, h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

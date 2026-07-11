// Slipstream — procedural sprites. Everything is drawn onto small
// offscreen canvases at init; the renderer upscales them with
// image-smoothing off for the chunky arcade look.
// Classic script (file://-safe): attaches to the Slipstream namespace.

(function () {
'use strict';
const NS = typeof globalThis !== 'undefined' ? globalThis : window;
const Slipstream = NS.Slipstream = NS.Slipstream || {};

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return [c, g];
}

function px(g, x, y, w, h, color) {
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

// ---- flora / roadside ----

function pine() {
  const [c, g] = canvas(40, 64);
  px(g, 17, 50, 6, 14, '#5b3a24');
  const greens = ['#173d2a', '#1e5136', '#276644'];
  for (let t = 0; t < 3; t++) {
    const w = 34 - t * 9, y = 40 - t * 15;
    g.fillStyle = greens[t];
    g.beginPath();
    g.moveTo(20, y - 16);
    g.lineTo(20 - w / 2, y);
    g.lineTo(20 + w / 2, y);
    g.closePath();
    g.fill();
  }
  return { c, worldW: 1000 };
}

function tree() {
  const [c, g] = canvas(48, 56);
  px(g, 21, 40, 7, 16, '#5b3a24');
  g.fillStyle = '#1f4d2e';
  g.beginPath(); g.arc(24, 24, 20, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#2c6b40';
  g.beginPath(); g.arc(18, 18, 12, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#387f4d';
  g.beginPath(); g.arc(30, 15, 8, 0, Math.PI * 2); g.fill();
  return { c, worldW: 1100 };
}

function palm() {
  const [c, g] = canvas(48, 64);
  g.strokeStyle = '#7a5a38'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(20, 64); g.quadraticCurveTo(22, 34, 30, 16); g.stroke();
  g.strokeStyle = '#2c7a4a'; g.lineWidth = 4;
  for (let a = 0; a < 6; a++) {
    const ang = -Math.PI / 2 + (a - 2.5) * 0.5;
    g.beginPath();
    g.moveTo(30, 16);
    g.quadraticCurveTo(30 + Math.cos(ang) * 14, 16 + Math.sin(ang) * 10,
      30 + Math.cos(ang) * 20, 16 + Math.sin(ang) * 16 + 8);
    g.stroke();
  }
  return { c, worldW: 950 };
}

function cactus() {
  const [c, g] = canvas(32, 56);
  const col = '#3f7a45', hi = '#57995d';
  px(g, 13, 8, 8, 48, col);
  px(g, 3, 18, 6, 16, col); px(g, 3, 18, 6, 5, hi);
  px(g, 5, 16, 8, 6, col);
  px(g, 23, 26, 6, 12, col);
  px(g, 21, 24, 8, 6, col);
  px(g, 14, 8, 3, 44, hi);
  return { c, worldW: 520 };
}

function rock() {
  const [c, g] = canvas(44, 28);
  g.fillStyle = '#5c6068';
  g.beginPath();
  g.moveTo(2, 28); g.lineTo(8, 12); g.lineTo(20, 4); g.lineTo(34, 10);
  g.lineTo(42, 28); g.closePath(); g.fill();
  g.fillStyle = '#788089';
  g.beginPath();
  g.moveTo(10, 12); g.lineTo(20, 6); g.lineTo(26, 10); g.lineTo(14, 18);
  g.closePath(); g.fill();
  return { c, worldW: 750 };
}

function bush() {
  const [c, g] = canvas(36, 22);
  g.fillStyle = '#2a5c34';
  g.beginPath(); g.arc(10, 15, 8, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(22, 12, 10, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(30, 16, 6, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#3d7a49';
  g.beginPath(); g.arc(20, 10, 6, 0, Math.PI * 2); g.fill();
  return { c, worldW: 420 };
}

function pole() {
  const [c, g] = canvas(20, 72);
  px(g, 8, 6, 4, 66, '#3a3f47');
  px(g, 8, 6, 10, 3, '#3a3f47');
  px(g, 15, 8, 5, 4, '#ffd98a');
  return { c, worldW: 220 };
}

function tower() {
  const [c, g] = canvas(30, 80);
  g.strokeStyle = '#4a505a'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(6, 80); g.lineTo(15, 4); g.stroke();
  g.beginPath(); g.moveTo(24, 80); g.lineTo(15, 4); g.stroke();
  for (let y = 14; y < 76; y += 12) {
    const t = (y - 4) / 76;
    g.beginPath(); g.moveTo(15 - 9 * t, y); g.lineTo(15 + 9 * t, y); g.stroke();
  }
  px(g, 13, 0, 4, 4, '#ff4d4d');
  return { c, worldW: 420 };
}

function sign(dir) {
  const [c, g] = canvas(40, 46);
  px(g, 8, 30, 4, 16, '#3a3f47');
  px(g, 28, 30, 4, 16, '#3a3f47');
  px(g, 2, 2, 36, 28, '#101418');
  g.strokeStyle = '#20262e'; g.lineWidth = 2;
  g.strokeRect(3, 3, 34, 26);
  g.strokeStyle = '#39d5ff'; g.lineWidth = 4; g.lineJoin = 'miter';
  for (let k = 0; k < 3; k++) {
    const x = 8 + k * 10;
    g.beginPath();
    if (dir > 0) { g.moveTo(x, 8); g.lineTo(x + 6, 16); g.lineTo(x, 24); }
    else { g.moveTo(x + 6, 8); g.lineTo(x, 16); g.lineTo(x + 6, 24); }
    g.stroke();
  }
  return { c, worldW: 500 };
}

function gate(text, accent) {
  const [c, g] = canvas(240, 60);
  px(g, 4, 8, 10, 52, '#2a2f38');
  px(g, 226, 8, 10, 52, '#2a2f38');
  px(g, 0, 0, 240, 20, '#14181e');
  g.strokeStyle = accent; g.lineWidth = 2;
  g.strokeRect(1, 1, 238, 18);
  g.fillStyle = accent;
  g.font = 'bold 13px ui-monospace, monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 120, 11);
  return { c, worldW: 2600 };
}

// ---- cars (rear view) ----

function carSprite(body, dark, glass, brake = false) {
  const [c, g] = canvas(56, 38);
  // wheels
  px(g, 4, 26, 12, 12, '#0a0c0f');
  px(g, 40, 26, 12, 12, '#0a0c0f');
  // body
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(4, 32); g.lineTo(6, 16); g.lineTo(12, 12); g.lineTo(44, 12);
  g.lineTo(50, 16); g.lineTo(52, 32); g.closePath(); g.fill();
  // cabin + rear window
  px(g, 14, 2, 28, 12, dark);
  px(g, 17, 4, 22, 8, glass);
  // bumper
  px(g, 6, 30, 44, 5, dark);
  // tail lights
  const lit = brake ? '#ff5a3c' : '#c22f1e';
  px(g, 8, 17, 10, 5, lit);
  px(g, 38, 17, 10, 5, lit);
  if (brake) {
    g.fillStyle = 'rgba(255,90,60,0.35)';
    g.fillRect(5, 14, 16, 11); g.fillRect(35, 14, 16, 11);
  }
  // license plate
  px(g, 24, 24, 8, 5, '#d8dce2');
  return { c, worldW: 340 };
}

const TRAFFIC_LIVERY = [
  ['#8a4df0', '#241b3a', '#a9c4e0'],
  ['#e0b23c', '#3a2f14', '#a9c4e0'],
  ['#3ca4e0', '#122a3a', '#cfe4f2'],
  ['#c4432f', '#38120c', '#a9c4e0'],
  ['#6a7684', '#232830', '#cfe4f2'],
];

function makeSprites() {
  const s = {
    pine: pine(), tree: tree(), palm: palm(), cactus: cactus(),
    rock: rock(), bush: bush(), pole: pole(), tower: tower(),
    signL: sign(-1), signR: sign(1),
    gateStart: gate('SLIPSTREAM', '#39d5ff'),
    gateFinish: gate('FINISH', '#ffb03c'),
    player: carSprite('#ff7a3c', '#4a1e0c', '#bfe8ff'),
    playerBrake: carSprite('#ff7a3c', '#4a1e0c', '#bfe8ff', true),
    traffic: TRAFFIC_LIVERY.map(([b, d, gl]) => carSprite(b, d, gl)),
  };
  return s;
}

Object.assign(Slipstream, { makeSprites });
})();

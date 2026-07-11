// Dustkart — procedural sprites. Everything is drawn onto small offscreen
// canvases at init: the burrowfolk karts (5 poses x 6 liveries), roadside
// decor per circuit theme, item icons for the HUD and the world objects.
// The renderer upscales with image smoothing off for the chunky look.
// Classic script (file://-safe): attaches to the Dustkart namespace.

(function () {
'use strict';
const NS = typeof globalThis !== 'undefined' ? globalThis : window;
const DK = NS.Dustkart = NS.Dustkart || {};

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

// ---- the burrowfolk karts (rear view) ----
// Little round-eared burrow critters in open buggy karts. pose:
// -2 hard-left (drift) .. 0 straight .. +2 hard-right (drift).

const LIVERIES = [
  { body: '#e0762f', dark: '#5a2c0e', fur: '#a97848', ear: '#8a5c32', goggle: '#ffe9a8' }, // Pip (player)
  { body: '#4f8f3a', dark: '#1e3a14', fur: '#7d6a4c', ear: '#635238', goggle: '#c8f0ff' }, // Bramble
  { body: '#3f7fd2', dark: '#14273f', fur: '#9a9aa8', ear: '#7c7c8a', goggle: '#ffe9a8' }, // Nib
  { body: '#c2b53a', dark: '#4a4410', fur: '#b98f5e', ear: '#96703f', goggle: '#d8ffe0' }, // Tansy
  { body: '#8a55c8', dark: '#2e1a46', fur: '#6d5f6e', ear: '#544754', goggle: '#ffd8f0' }, // Moler
  { body: '#c8425a', dark: '#46101c', fur: '#8f7350', ear: '#6e5638', goggle: '#c8f0ff' }, // Fenwick
];

function kartSprite(liv, pose) {
  const [c, g] = canvas(64, 44);
  g.save();
  g.translate(32, 26);
  g.rotate(pose * 0.09);
  const nose = pose * 3;          // the nose swings into the turn

  // rear wheels (big, knobby)
  px(g, -28, 4, 13, 15, '#0b0d10');
  px(g, 15, 4, 13, 15, '#0b0d10');
  px(g, -26, 6, 3, 11, '#2c3138');
  px(g, 21, 6, 3, 11, '#2c3138');
  // front wheels peeking out, offset by the steer
  px(g, -20 + nose * 1.6, -6, 8, 8, '#101318');
  px(g, 12 + nose * 1.6, -6, 8, 8, '#101318');

  // body tub
  g.fillStyle = liv.body;
  g.beginPath();
  g.moveTo(-18, 12); g.lineTo(-15 + nose, -6); g.lineTo(-9 + nose, -10);
  g.lineTo(9 + nose, -10); g.lineTo(15 + nose, -6); g.lineTo(18, 12);
  g.closePath(); g.fill();
  // bumper + engine slab
  px(g, -15, 8, 30, 6, liv.dark);
  px(g, -8, 2, 16, 6, liv.dark);
  px(g, -5, 3, 10, 3, '#d8dce2');   // little number plate
  // exhaust stubs
  px(g, -12, 0, 4, 4, '#3a3f47');
  px(g, 8, 0, 4, 4, '#3a3f47');

  // driver: round furry head, two round ears, goggle band
  const hx = nose * 0.7;
  g.fillStyle = liv.ear;
  g.beginPath(); g.arc(hx - 7, -16, 4, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(hx + 7, -16, 4, 0, Math.PI * 2); g.fill();
  g.fillStyle = liv.fur;
  g.beginPath(); g.arc(hx, -13, 8, 0, Math.PI * 2); g.fill();
  px(g, hx - 8, -16, 16, 4, liv.dark);      // goggle strap
  px(g, hx - 5, -16, 4, 3, liv.goggle);     // goggle lenses
  px(g, hx + 1, -16, 4, 3, liv.goggle);
  // shoulders
  px(g, hx - 7, -7, 14, 4, liv.dark);

  g.restore();
  return { c, worldW: 380 };
}

// ---- roadside decor (original per-theme flora) ----

function boulder() {
  const [c, g] = canvas(44, 30);
  g.fillStyle = '#8a7458';
  g.beginPath();
  g.moveTo(2, 30); g.lineTo(7, 12); g.lineTo(20, 3); g.lineTo(35, 9);
  g.lineTo(42, 30); g.closePath(); g.fill();
  g.fillStyle = '#a89070';
  g.beginPath();
  g.moveTo(10, 12); g.lineTo(20, 5); g.lineTo(27, 9); g.lineTo(14, 18);
  g.closePath(); g.fill();
  return { c, worldW: 760 };
}

function shrub() {
  const [c, g] = canvas(36, 20);
  g.fillStyle = '#8f8a3e';
  g.beginPath(); g.arc(10, 14, 7, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(22, 11, 9, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(30, 15, 5, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#aba552';
  g.beginPath(); g.arc(20, 9, 5, 0, Math.PI * 2); g.fill();
  return { c, worldW: 420 };
}

function spire() {
  const [c, g] = canvas(30, 72);
  g.fillStyle = '#9c7448';
  g.beginPath();
  g.moveTo(6, 72); g.lineTo(11, 18); g.lineTo(15, 2); g.lineTo(20, 20); g.lineTo(25, 72);
  g.closePath(); g.fill();
  g.fillStyle = '#b98d5c';
  g.beginPath();
  g.moveTo(11, 72); g.lineTo(14, 16); g.lineTo(15, 6); g.lineTo(16, 20); g.lineTo(17, 72);
  g.closePath(); g.fill();
  return { c, worldW: 640 };
}

function bramble() {
  const [c, g] = canvas(52, 64);
  g.strokeStyle = '#4a3421'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(26, 64); g.quadraticCurveTo(22, 38, 26, 22); g.stroke();
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(26, 40); g.quadraticCurveTo(12, 34, 6, 24); g.stroke();
  g.beginPath(); g.moveTo(26, 32); g.quadraticCurveTo(40, 28, 46, 16); g.stroke();
  g.fillStyle = '#264a2c';
  g.beginPath(); g.arc(26, 16, 14, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(8, 20, 8, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(45, 13, 7, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#37653e';
  g.beginPath(); g.arc(22, 12, 8, 0, Math.PI * 2); g.fill();
  return { c, worldW: 1050 };
}

function fern() {
  const [c, g] = canvas(36, 30);
  g.strokeStyle = '#3f7a45'; g.lineWidth = 3;
  for (let a = 0; a < 5; a++) {
    const ang = -Math.PI / 2 + (a - 2) * 0.42;
    g.beginPath();
    g.moveTo(18, 30);
    g.quadraticCurveTo(18 + Math.cos(ang) * 10, 30 + Math.sin(ang) * 14,
      18 + Math.cos(ang) * 16, 30 + Math.sin(ang) * 24);
    g.stroke();
  }
  return { c, worldW: 440 };
}

function stump() {
  const [c, g] = canvas(32, 26);
  px(g, 6, 8, 20, 18, '#5b3a24');
  g.fillStyle = '#7a5438';
  g.beginPath(); g.ellipse(16, 8, 10, 4, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#5b3a24'; g.lineWidth = 1;
  g.beginPath(); g.ellipse(16, 8, 6, 2.2, 0, 0, Math.PI * 2); g.stroke();
  return { c, worldW: 480 };
}

function charspire() {
  const [c, g] = canvas(34, 70);
  g.fillStyle = '#2a2226';
  g.beginPath();
  g.moveTo(6, 70); g.lineTo(13, 16); g.lineTo(17, 2); g.lineTo(22, 18); g.lineTo(28, 70);
  g.closePath(); g.fill();
  g.fillStyle = '#c85a2e';
  px(g, 15, 20, 3, 5, '#c85a2e');
  px(g, 19, 34, 3, 4, '#a8481e');
  px(g, 12, 48, 3, 4, '#a8481e');
  return { c, worldW: 640 };
}

function cinderrock() {
  const [c, g] = canvas(44, 26);
  g.fillStyle = '#332b2f';
  g.beginPath();
  g.moveTo(2, 26); g.lineTo(9, 9); g.lineTo(22, 3); g.lineTo(36, 10); g.lineTo(42, 26);
  g.closePath(); g.fill();
  g.fillStyle = '#c85a2e';
  px(g, 16, 12, 4, 3, '#c85a2e');
  px(g, 27, 15, 3, 3, '#a8481e');
  return { c, worldW: 720 };
}

function lantern() {
  const [c, g] = canvas(20, 70);
  px(g, 8, 8, 4, 62, '#3a3339');
  px(g, 5, 2, 10, 10, '#4a4149');
  px(g, 7, 4, 6, 6, '#ffc46a');
  return { c, worldW: 230 };
}

function sign(dir) {
  const [c, g] = canvas(40, 46);
  px(g, 8, 30, 4, 16, '#3a3f47');
  px(g, 28, 30, 4, 16, '#3a3f47');
  px(g, 2, 2, 36, 28, '#101418');
  g.strokeStyle = '#20262e'; g.lineWidth = 2;
  g.strokeRect(3, 3, 34, 26);
  g.strokeStyle = '#ffb03c'; g.lineWidth = 4; g.lineJoin = 'miter';
  for (let k = 0; k < 3; k++) {
    const x = 8 + k * 10;
    g.beginPath();
    if (dir > 0) { g.moveTo(x, 8); g.lineTo(x + 6, 16); g.lineTo(x, 24); }
    else { g.moveTo(x + 6, 8); g.lineTo(x, 16); g.lineTo(x + 6, 24); }
    g.stroke();
  }
  return { c, worldW: 500 };
}

function gate() {
  const [c, g] = canvas(240, 60);
  px(g, 4, 8, 10, 52, '#2a2f38');
  px(g, 226, 8, 10, 52, '#2a2f38');
  px(g, 0, 0, 240, 20, '#14181e');
  g.strokeStyle = '#ffb03c'; g.lineWidth = 2;
  g.strokeRect(1, 1, 238, 18);
  g.fillStyle = '#ffb03c';
  g.font = 'bold 13px ui-monospace, monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('DUSTKART', 120, 11);
  return { c, worldW: 2600 };
}

// ---- world item objects ----

function slickSprite() {
  const [c, g] = canvas(48, 16);
  g.fillStyle = 'rgba(30,22,10,0.92)';
  g.beginPath(); g.ellipse(24, 10, 22, 6, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(96,74,28,0.8)';
  g.beginPath(); g.ellipse(19, 8, 9, 2.6, 0, 0, Math.PI * 2); g.fill();
  return { c, worldW: 520 };
}

function burrSprite() {
  const [c, g] = canvas(26, 26);
  g.strokeStyle = '#7a5a2a'; g.lineWidth = 2;
  for (let a = 0; a < 10; a++) {
    const ang = (a / 10) * Math.PI * 2;
    g.beginPath();
    g.moveTo(13, 13);
    g.lineTo(13 + Math.cos(ang) * 11, 13 + Math.sin(ang) * 11);
    g.stroke();
  }
  g.fillStyle = '#9a743a';
  g.beginPath(); g.arc(13, 13, 7, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#c49450';
  g.beginPath(); g.arc(11, 11, 3, 0, Math.PI * 2); g.fill();
  return { c, worldW: 260 };
}

// ---- HUD item icons (26x26) ----

function iconGust() {
  const [c, g] = canvas(26, 26);
  g.strokeStyle = '#7fdaff'; g.lineWidth = 3; g.lineCap = 'round';
  g.beginPath(); g.moveTo(3, 9); g.quadraticCurveTo(14, 4, 21, 9); g.stroke();
  g.beginPath(); g.moveTo(3, 15); g.quadraticCurveTo(15, 10, 23, 16); g.stroke();
  g.beginPath(); g.moveTo(5, 21); g.quadraticCurveTo(14, 17, 20, 22); g.stroke();
  return c;
}

function iconSlick() {
  const [c, g] = canvas(26, 26);
  g.fillStyle = '#6a4a14';
  g.beginPath(); g.ellipse(13, 16, 10, 5, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#9a743a';
  g.beginPath(); g.moveTo(13, 2); g.quadraticCurveTo(18, 9, 13, 13);
  g.quadraticCurveTo(8, 9, 13, 2); g.fill();
  return c;
}

function iconBurr() {
  const [c, g] = canvas(26, 26);
  g.strokeStyle = '#c49450'; g.lineWidth = 2;
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    g.beginPath(); g.moveTo(13, 13);
    g.lineTo(13 + Math.cos(ang) * 10, 13 + Math.sin(ang) * 10); g.stroke();
  }
  g.fillStyle = '#9a743a';
  g.beginPath(); g.arc(13, 13, 6, 0, Math.PI * 2); g.fill();
  return c;
}

function iconShield() {
  const [c, g] = canvas(26, 26);
  g.strokeStyle = '#8fce6a'; g.lineWidth = 3;
  g.beginPath(); g.arc(13, 13, 9, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = '#5b8f3e'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(13, 5); g.lineTo(13, 21); g.stroke();
  g.beginPath(); g.moveTo(6, 10); g.lineTo(20, 16); g.stroke();
  return c;
}

function iconTangle() {
  const [c, g] = canvas(26, 26);
  g.strokeStyle = '#4f8f3a'; g.lineWidth = 3; g.lineCap = 'round';
  g.beginPath(); g.moveTo(4, 22); g.quadraticCurveTo(8, 8, 14, 12);
  g.quadraticCurveTo(20, 16, 22, 4); g.stroke();
  g.strokeStyle = '#7fce5a'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(8, 24); g.quadraticCurveTo(14, 14, 22, 18); g.stroke();
  return c;
}

function makeSprites() {
  const karts = LIVERIES.map((liv) => {
    const poses = {};
    for (const p of [-2, -1, 0, 1, 2]) poses[p] = kartSprite(liv, p);
    return poses;
  });
  return {
    karts,
    boulder: boulder(), shrub: shrub(), spire: spire(),
    bramble: bramble(), fern: fern(), stump: stump(),
    charspire: charspire(), cinderrock: cinderrock(), lantern: lantern(),
    signL: sign(-1), signR: sign(1), gate: gate(),
    slick: slickSprite(), burr: burrSprite(),
    icons: {
      gust: iconGust(), slick: iconSlick(), burr: iconBurr(),
      barkshield: iconShield(), tangleroot: iconTangle(),
    },
  };
}

Object.assign(DK, { makeSprites, LIVERIES });
})();

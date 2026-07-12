// Gloamkeep — procedural texture + sprite generation (browser only).
// Everything is drawn once at boot into offscreen canvases, then extracted as
// Uint32Array pixel data (ABGR, little-endian) for the software renderer.

// Classic script on the `Gloamkeep` namespace; load after maps.js + game.js.

(function () {
'use strict';
const G = globalThis.Gloamkeep = globalThis.Gloamkeep || {};
const { TILE, makeRng } = G;

const TEX_SIZE = 64;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function extract(canvas) {
  const g = canvas.getContext('2d');
  const id = g.getImageData(0, 0, canvas.width, canvas.height);
  return { data: new Uint32Array(id.data.buffer), w: canvas.width, h: canvas.height };
}

function tex(draw, seed) {
  const c = makeCanvas(TEX_SIZE, TEX_SIZE);
  const g = c.getContext('2d');
  draw(g, makeRng(seed));
  return extract(c);
}

// --- wall textures -----------------------------------------------------------

function noise(g, rng, n, alpha, light) {
  for (let i = 0; i < n; i++) {
    const v = (rng() * 50) | 0;
    g.fillStyle = light
      ? `rgba(${170 + v},${170 + v},${180 + v},${alpha})`
      : `rgba(0,0,0,${alpha * (0.5 + rng())})`;
    g.fillRect((rng() * 64) | 0, (rng() * 64) | 0, 1 + (rng() * 2) | 0, 1);
  }
}

function drawStoneBase(g, rng, tint) {
  g.fillStyle = tint || '#41454e';
  g.fillRect(0, 0, 64, 64);
  // large block courses
  const rows = [0, 16, 32, 48];
  for (let r = 0; r < 4; r++) {
    const off = r % 2 ? 16 : 0;
    for (let cx = -1; cx < 3; cx++) {
      const x = cx * 32 + off;
      const v = (rng() * 22 - 11) | 0;
      g.fillStyle = `rgb(${63 + v},${67 + v},${76 + v})`;
      g.fillRect(x + 1, rows[r] + 1, 30, 14);
      // bevel highlight
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(x + 1, rows[r] + 1, 30, 2);
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(x + 1, rows[r] + 13, 30, 2);
    }
  }
  // mortar lines
  g.fillStyle = '#22242a';
  for (const y of rows) g.fillRect(0, y, 64, 1);
  for (let r = 0; r < 4; r++) {
    const off = r % 2 ? 16 : 0;
    for (let cx = -1; cx < 3; cx++) g.fillRect(cx * 32 + off, rows[r], 1, 16);
  }
  noise(g, rng, 240, 0.10);
  noise(g, rng, 60, 0.05, true);
}

function stoneTex() {
  return tex((g, rng) => drawStoneBase(g, rng), 101);
}

function mossTex() {
  return tex((g, rng) => {
    drawStoneBase(g, rng, '#3c4440');
    // creeping moss patches, heavier at the bottom
    for (let i = 0; i < 90; i++) {
      const y = 64 - Math.pow(rng(), 1.6) * 64;
      const x = rng() * 64;
      const r = 1 + rng() * 3;
      const v = (rng() * 40) | 0;
      g.fillStyle = `rgba(${52 + v * 0.4},${96 + v},${48},${0.5 + rng() * 0.4})`;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 26; i++) {
      g.fillStyle = 'rgba(150,200,90,0.5)';
      g.fillRect((rng() * 64) | 0, 40 + ((rng() * 24) | 0), 1, 1);
    }
  }, 202);
}

function bannerTex() {
  return tex((g, rng) => {
    drawStoneBase(g, rng);
    // hanging cloth
    g.fillStyle = '#3a2050';
    g.fillRect(14, 0, 36, 58);
    g.fillStyle = '#472a62';
    g.fillRect(16, 0, 32, 56);
    // ragged bottom edge
    g.fillStyle = '#3a2050';
    for (let x = 16; x < 48; x += 4) {
      g.fillRect(x, 52 + ((rng() * 6) | 0), 4, 8);
    }
    g.clearRect(0, 0, 0, 0);
    // trim
    g.fillStyle = '#c9a44a';
    g.fillRect(14, 2, 36, 2);
    g.fillRect(16, 6, 32, 1);
    // gloam sigil: a broken ring with a downward tear
    g.strokeStyle = '#d8b45e';
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(32, 28, 10, 0.4, Math.PI * 2 - 0.4);
    g.stroke();
    g.beginPath();
    g.moveTo(32, 20);
    g.lineTo(29, 40);
    g.lineTo(35, 34);
    g.stroke();
    // cloth shading
    for (let x = 16; x < 48; x += 8) {
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(x, 0, 3, 56);
    }
  }, 303);
}

function plankDoor(g, rng) {
  g.fillStyle = '#3a2c1e';
  g.fillRect(0, 0, 64, 64);
  for (let p = 0; p < 4; p++) {
    const x = p * 16;
    const v = (rng() * 16 - 8) | 0;
    g.fillStyle = `rgb(${64 + v},${46 + v * 0.7},${30 + v * 0.4})`;
    g.fillRect(x + 1, 0, 14, 64);
    // grain
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      const gx = x + 3 + rng() * 10;
      g.moveTo(gx, 0);
      g.bezierCurveTo(gx + 3, 20, gx - 3, 44, gx + 2, 64);
      g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(x, 0, 1, 64);
  }
  // iron bands
  for (const y of [8, 50]) {
    g.fillStyle = '#23252c';
    g.fillRect(0, y, 64, 6);
    g.fillStyle = '#3a3e49';
    g.fillRect(0, y + 1, 64, 2);
    for (let x = 4; x < 64; x += 12) {
      g.fillStyle = '#565b68';
      g.fillRect(x, y + 2, 2, 2);
    }
  }
}

function doorTex() {
  return tex((g, rng) => {
    plankDoor(g, rng);
    // ring handle
    g.strokeStyle = '#6a707e';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(50, 32, 5, 0, Math.PI * 2);
    g.stroke();
  }, 404);
}

function lockedDoorTex(color, glow, seed) {
  return tex((g, rng) => {
    plankDoor(g, rng);
    // sigil seal plate
    g.fillStyle = '#1c1e24';
    g.beginPath();
    g.moveTo(32, 16); g.lineTo(46, 32); g.lineTo(32, 48); g.lineTo(18, 32);
    g.closePath();
    g.fill();
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = glow;
    g.beginPath();
    g.moveTo(32, 24); g.lineTo(39, 32); g.lineTo(32, 40); g.lineTo(25, 32);
    g.closePath();
    g.fill();
    g.fillStyle = color;
    g.fillRect(31, 28, 2, 8);
  }, seed);
}

function exitTex() {
  return tex((g, rng) => {
    // dark ironbound slab with a glowing way-sigil
    g.fillStyle = '#191d26';
    g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 160; i++) {
      g.fillStyle = `rgba(255,255,255,${rng() * 0.05})`;
      g.fillRect((rng() * 64) | 0, (rng() * 64) | 0, 1, 1);
    }
    g.strokeStyle = '#2c3140';
    g.lineWidth = 2;
    g.strokeRect(3, 3, 58, 58);
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 26);
    grad.addColorStop(0, 'rgba(120,255,240,0.9)');
    grad.addColorStop(0.4, 'rgba(60,190,180,0.35)');
    grad.addColorStop(1, 'rgba(20,80,80,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#8ff2e2';
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(32, 32, 14, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(32, 12); g.lineTo(32, 52);
    g.moveTo(20, 40); g.lineTo(32, 12); g.lineTo(44, 40);
    g.stroke();
  }, 505);
}

// --- sprites -----------------------------------------------------------------
// All sprites drawn into 64x64 with transparency.

function sprite(draw, seed) {
  const c = makeCanvas(TEX_SIZE, TEX_SIZE);
  const g = c.getContext('2d');
  draw(g, makeRng(seed));
  return extract(c);
}

// wispy shadow-blob with glowing eyes
function drawGloam(g, rng, frame) {
  const sway = frame === 0 ? -2 : frame === 1 ? 2 : 0;
  if (frame === 3) { // death: a fading puddle
    const grad = g.createRadialGradient(32, 56, 2, 32, 56, 22);
    grad.addColorStop(0, 'rgba(24,16,40,0.95)');
    grad.addColorStop(1, 'rgba(10,8,20,0)');
    g.fillStyle = grad;
    g.beginPath(); g.ellipse(32, 56, 24, 8, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(90,220,220,0.35)';
    g.fillRect(27, 54, 2, 2); g.fillRect(35, 54, 2, 2);
    return;
  }
  const grad = g.createRadialGradient(32 + sway, 34, 4, 32 + sway, 36, 26);
  grad.addColorStop(0, '#241a3e');
  grad.addColorStop(0.7, '#160f28');
  grad.addColorStop(1, 'rgba(12,8,20,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(32 + sway, 36, 18, 24, 0, 0, Math.PI * 2);
  g.fill();
  // ragged tendrils along the bottom
  g.fillStyle = '#160f28';
  for (let i = 0; i < 6; i++) {
    const x = 16 + i * 6 + sway;
    const len = 6 + ((i * 7 + frame * 3) % 8);
    g.beginPath();
    g.moveTo(x, 52);
    g.quadraticCurveTo(x + 3 + sway, 56 + len / 2, x + (i % 2 ? 4 : -2), 52 + len);
    g.lineTo(x + 5, 52);
    g.fill();
  }
  // wisps
  g.strokeStyle = 'rgba(70,50,120,0.5)';
  g.lineWidth = 1.5;
  for (let i = 0; i < 3; i++) {
    g.beginPath();
    g.moveTo(20 + i * 10 + sway, 22);
    g.quadraticCurveTo(24 + i * 8 + sway * 2, 8 + i * 3, 30 + i * 6 + sway, 14);
    g.stroke();
  }
  // eyes
  const eyeY = frame === 2 ? 28 : 30;
  const eyeR = frame === 2 ? 3.4 : 2.4;
  for (const ex of [-6, 6]) {
    const gg = g.createRadialGradient(32 + ex + sway, eyeY, 0.5, 32 + ex + sway, eyeY, eyeR + 2);
    gg.addColorStop(0, '#c8fff6');
    gg.addColorStop(0.5, '#54e0d4');
    gg.addColorStop(1, 'rgba(40,150,150,0)');
    g.fillStyle = gg;
    g.beginPath(); g.arc(32 + ex + sway, eyeY, eyeR + 2, 0, Math.PI * 2); g.fill();
  }
  if (frame === 2) { // attack: open maw
    g.fillStyle = '#54e0d4';
    g.beginPath();
    g.ellipse(32 + sway, 42, 7, 4.5, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0c0818';
    g.beginPath();
    g.ellipse(32 + sway, 42, 5, 3, 0, 0, Math.PI * 2);
    g.fill();
  }
}

// thin fast creeper
function drawStalker(g, rng, frame) {
  if (frame === 3) {
    g.fillStyle = 'rgba(30,26,44,0.9)';
    g.beginPath(); g.ellipse(32, 58, 16, 5, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(120,110,160,0.6)';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(20, 58); g.lineTo(30, 52); g.moveTo(38, 54); g.lineTo(46, 58);
    g.stroke();
    g.fillStyle = 'rgba(200,120,255,0.3)';
    g.fillRect(30, 52, 2, 2);
    return;
  }
  const lean = frame === 2 ? 4 : 0;
  const legSpread = frame === 0 ? 5 : 9;
  g.strokeStyle = '#2c2840';
  g.lineWidth = 3.5;
  // legs
  g.beginPath();
  g.moveTo(32, 44); g.lineTo(32 - legSpread, 62);
  g.moveTo(32, 44); g.lineTo(32 + legSpread - (frame === 1 ? 3 : 0), 62);
  g.stroke();
  // body: hunched sliver
  g.fillStyle = '#332e4c';
  g.beginPath();
  g.ellipse(32 + lean, 32, 7, 16, lean * 0.06, 0, Math.PI * 2);
  g.fill();
  // head low and forward
  g.fillStyle = '#3c3658';
  g.beginPath();
  g.ellipse(32 + lean * 2, 18, 6, 5, 0, 0, Math.PI * 2);
  g.fill();
  // arms / claws
  g.strokeStyle = '#2c2840';
  g.lineWidth = 2.5;
  const armY = frame === 2 ? 14 : 26;
  g.beginPath();
  g.moveTo(28 + lean, 28); g.lineTo(16 + lean, armY);
  g.moveTo(36 + lean, 28); g.lineTo(48 + lean, armY);
  g.stroke();
  g.strokeStyle = '#8f86b8';
  g.lineWidth = 1.5;
  for (const s of [-1, 0, 1]) {
    g.beginPath();
    g.moveTo(16 + lean, armY); g.lineTo(13 + lean + s * 3, armY - 4);
    g.moveTo(48 + lean, armY); g.lineTo(51 + lean + s * 3, armY - 4);
    g.stroke();
  }
  // violet eyes
  for (const ex of [-3, 3]) {
    const gg = g.createRadialGradient(32 + ex + lean * 2, 17, 0.4, 32 + ex + lean * 2, 17, 3.4);
    gg.addColorStop(0, '#f2d8ff');
    gg.addColorStop(0.5, '#b45cf0');
    gg.addColorStop(1, 'rgba(120,40,180,0)');
    g.fillStyle = gg;
    g.beginPath(); g.arc(32 + ex + lean * 2, 17, 3.4, 0, Math.PI * 2); g.fill();
  }
}

// robed bolt-caster with an ember core
function drawHusk(g, rng, frame) {
  if (frame === 3) {
    g.fillStyle = '#241d18';
    g.beginPath(); g.ellipse(32, 57, 18, 6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#38302a';
    g.beginPath(); g.ellipse(28, 54, 9, 5, 0.3, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(240,140,50,0.35)';
    g.beginPath(); g.arc(34, 55, 3, 0, Math.PI * 2); g.fill();
    return;
  }
  const sway = frame === 1 ? 2 : 0;
  // robe cone
  g.fillStyle = '#2e2620';
  g.beginPath();
  g.moveTo(32 + sway, 8);
  g.quadraticCurveTo(48 + sway, 26, 50, 62);
  g.lineTo(14, 62);
  g.quadraticCurveTo(16 + sway, 26, 32 + sway, 8);
  g.fill();
  // ragged hem
  g.fillStyle = '#241d18';
  for (let x = 14; x < 50; x += 5) {
    g.fillRect(x, 58 + ((x * 7) % 4), 5, 6);
  }
  // hood hole
  g.fillStyle = '#0d0a08';
  g.beginPath();
  g.ellipse(32 + sway, 18, 6, 7, 0, 0, Math.PI * 2);
  g.fill();
  // ember core glow in the chest
  const coreR = frame === 2 ? 9 : 6;
  const gg = g.createRadialGradient(32 + sway, 36, 1, 32 + sway, 36, coreR + 4);
  gg.addColorStop(0, '#ffe9b0');
  gg.addColorStop(0.4, '#f09a3e');
  gg.addColorStop(1, 'rgba(160,70,20,0)');
  g.fillStyle = gg;
  g.beginPath(); g.arc(32 + sway, 36, coreR + 4, 0, Math.PI * 2); g.fill();
  // eyes: faint embers inside the hood
  g.fillStyle = '#f0b060';
  g.fillRect(29 + sway, 17, 2, 2);
  g.fillRect(34 + sway, 17, 2, 2);
  if (frame === 2) {
    // casting: arms spread with gathering bolt
    g.strokeStyle = '#241d18';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(24, 30); g.lineTo(10, 22);
    g.moveTo(40, 30); g.lineTo(54, 22);
    g.stroke();
    const bg = g.createRadialGradient(32, 36, 1, 32, 36, 13);
    bg.addColorStop(0, 'rgba(220,120,255,0.9)');
    bg.addColorStop(1, 'rgba(120,40,200,0)');
    g.fillStyle = bg;
    g.beginPath(); g.arc(32, 36, 13, 0, Math.PI * 2); g.fill();
  }
}

// the Warden: hulking horned mass with ember cracks
function drawWarden(g, rng, frame) {
  if (frame === 3) {
    g.fillStyle = '#26222c';
    g.beginPath(); g.ellipse(32, 55, 22, 8, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#332e3c';
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.arc(20 + i * 6, 52 + (i % 2) * 3, 4 + (i % 3), 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = 'rgba(240,120,60,0.4)';
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(20, 54); g.lineTo(30, 50); g.lineTo(40, 55); g.stroke();
    return;
  }
  const raise = frame === 2 ? -8 : 0;
  const sway = frame === 1 ? 2 : -2;
  // legs
  g.fillStyle = '#2a2632';
  g.fillRect(20, 48, 9, 14);
  g.fillRect(35, 48, 9, 14);
  // massive torso
  g.fillStyle = '#332e3c';
  g.beginPath();
  g.moveTo(32 + sway, 6);
  g.quadraticCurveTo(56, 14, 52, 44);
  g.quadraticCurveTo(46, 54, 32, 52);
  g.quadraticCurveTo(18, 54, 12, 44);
  g.quadraticCurveTo(8, 14, 32 + sway, 6);
  g.fill();
  // arms
  g.fillStyle = '#2a2632';
  g.beginPath();
  g.ellipse(10, 32 + raise, 6, 14, -0.3, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(54, 32 + raise, 6, 14, 0.3, 0, Math.PI * 2);
  g.fill();
  // horns
  g.fillStyle = '#4a4356';
  g.beginPath();
  g.moveTo(24 + sway, 10); g.quadraticCurveTo(14 + sway, 2, 12 + sway, 8);
  g.lineTo(22 + sway, 14); g.fill();
  g.beginPath();
  g.moveTo(40 + sway, 10); g.quadraticCurveTo(50 + sway, 2, 52 + sway, 8);
  g.lineTo(42 + sway, 14); g.fill();
  // ember cracks
  g.strokeStyle = frame === 2 ? '#ffb060' : '#e07830';
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(26, 20); g.lineTo(30, 30); g.lineTo(26, 40);
  g.moveTo(38, 18); g.lineTo(36, 28); g.lineTo(42, 38);
  g.moveTo(32, 30); g.lineTo(32, 44);
  g.stroke();
  // red eyes
  for (const ex of [-6, 6]) {
    const gg = g.createRadialGradient(32 + ex + sway, 14, 0.5, 32 + ex + sway, 14, 4);
    gg.addColorStop(0, '#ffd8c0');
    gg.addColorStop(0.5, '#f04830');
    gg.addColorStop(1, 'rgba(160,20,20,0)');
    g.fillStyle = gg;
    g.beginPath(); g.arc(32 + ex + sway, 14, 4, 0, Math.PI * 2); g.fill();
  }
}

function torchSprite(frame) {
  return sprite((g, rng) => {
    // bracket
    g.fillStyle = '#3a3026';
    g.fillRect(29, 34, 6, 22);
    g.fillStyle = '#23252c';
    g.fillRect(27, 52, 10, 5);
    // flame (frame-dependent lick)
    const lick = frame === 0 ? 0 : frame === 1 ? 2.5 : -2.5;
    const fg = g.createRadialGradient(32, 26, 1, 32, 28, 15);
    fg.addColorStop(0, 'rgba(255,240,180,0.95)');
    fg.addColorStop(0.4, 'rgba(250,160,60,0.8)');
    fg.addColorStop(1, 'rgba(200,80,20,0)');
    g.fillStyle = fg;
    g.beginPath(); g.arc(32, 27, 15, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffd98a';
    g.beginPath();
    g.moveTo(32 - 5, 34);
    g.quadraticCurveTo(32 - 6 + lick, 22, 32 + lick, 12 + Math.abs(lick));
    g.quadraticCurveTo(32 + 6 + lick, 22, 32 + 5, 34);
    g.fill();
    g.fillStyle = '#fff3c8';
    g.beginPath();
    g.moveTo(32 - 2.5, 34);
    g.quadraticCurveTo(32 + lick * 0.6, 24, 32 + lick * 0.5, 20);
    g.quadraticCurveTo(32 + 2.5 + lick * 0.4, 26, 32 + 2.5, 34);
    g.fill();
  }, 600 + frame);
}

function healthSprite() {
  return sprite((g) => {
    // pale tonic flask
    g.fillStyle = 'rgba(220,235,240,0.25)';
    g.beginPath(); g.arc(32, 46, 10, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#d84850';
    g.beginPath(); g.arc(32, 47, 8, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f0808a';
    g.beginPath(); g.arc(29, 44, 3, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(220,235,240,0.5)';
    g.fillRect(29, 32, 6, 8);
    g.fillStyle = '#8a6a42';
    g.fillRect(28, 29, 8, 4);
    g.strokeStyle = 'rgba(240,250,255,0.55)';
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(32, 47, 9, -0.8, 1.2); g.stroke();
  }, 701);
}

function ammoSprite() {
  return sprite((g) => {
    // bandolier of ember vials
    g.fillStyle = '#3a3026';
    g.fillRect(16, 42, 32, 14);
    g.fillStyle = '#23252c';
    g.fillRect(16, 42, 32, 3);
    for (let i = 0; i < 4; i++) {
      const x = 20 + i * 7;
      g.fillStyle = '#1c1e24';
      g.fillRect(x, 34, 4, 12);
      const gg = g.createRadialGradient(x + 2, 38, 0.5, x + 2, 38, 5);
      gg.addColorStop(0, '#ffd88a');
      gg.addColorStop(0.6, '#e8983a');
      gg.addColorStop(1, 'rgba(180,90,20,0)');
      g.fillStyle = gg;
      g.fillRect(x, 34, 4, 10);
    }
  }, 702);
}

function keySprite(color, glow) {
  return sprite((g) => {
    g.save();
    g.translate(32, 42);
    g.rotate(-0.5);
    const gg = g.createRadialGradient(0, 0, 2, 0, 0, 18);
    gg.addColorStop(0, glow);
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gg;
    g.fillRect(-20, -20, 40, 40);
    g.strokeStyle = color;
    g.lineWidth = 3;
    g.beginPath(); g.arc(-6, -6, 5, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(-2, -2); g.lineTo(10, 10); g.stroke();
    g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(6, 6); g.lineTo(10, 2); g.stroke();
    g.beginPath(); g.moveTo(9, 9); g.lineTo(13, 5); g.stroke();
    g.restore();
  }, 703);
}

function shardSprite() {
  return sprite((g) => {
    const gg = g.createRadialGradient(32, 44, 1, 32, 44, 16);
    gg.addColorStop(0, 'rgba(255,200,110,0.8)');
    gg.addColorStop(1, 'rgba(200,110,30,0)');
    g.fillStyle = gg;
    g.fillRect(12, 24, 40, 40);
    g.fillStyle = '#f0a848';
    g.beginPath();
    g.moveTo(32, 28); g.lineTo(39, 42); g.lineTo(32, 58); g.lineTo(25, 42);
    g.closePath(); g.fill();
    g.fillStyle = '#ffe0a0';
    g.beginPath();
    g.moveTo(32, 28); g.lineTo(35, 42); g.lineTo(32, 54); g.lineTo(30, 42);
    g.closePath(); g.fill();
  }, 704);
}

function boltSprite() {
  return sprite((g) => {
    const gg = g.createRadialGradient(32, 32, 1, 32, 32, 20);
    gg.addColorStop(0, '#f8e8ff');
    gg.addColorStop(0.3, '#c86cf2');
    gg.addColorStop(0.7, 'rgba(120,40,200,0.4)');
    gg.addColorStop(1, 'rgba(80,20,140,0)');
    g.fillStyle = gg;
    g.beginPath(); g.arc(32, 32, 20, 0, Math.PI * 2); g.fill();
  }, 705);
}

function tonicSprite() {
  return sprite((g) => {
    // tall crimson flask with a gold band
    g.fillStyle = 'rgba(240,140,150,0.22)';
    g.beginPath(); g.arc(32, 44, 13, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c03040';
    g.beginPath();
    g.moveTo(27, 34); g.lineTo(27, 42);
    g.quadraticCurveTo(22, 46, 24, 54);
    g.quadraticCurveTo(32, 60, 40, 54);
    g.quadraticCurveTo(42, 46, 37, 42); g.lineTo(37, 34);
    g.closePath(); g.fill();
    g.fillStyle = '#f0808a';
    g.beginPath(); g.arc(28, 46, 3.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e8c04a';
    g.fillRect(26, 33, 12, 4);
    g.fillStyle = 'rgba(220,235,240,0.5)';
    g.fillRect(28, 24, 8, 9);
    g.fillStyle = '#8a6a42';
    g.fillRect(27, 21, 10, 4);
    g.strokeStyle = 'rgba(255,240,245,0.5)';
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(32, 49, 8, -1.1, 0.9); g.stroke();
  }, 706);
}

function cacheSprite() {
  return sprite((g) => {
    // squat iron-banded chest, ember light bleeding through the slats
    g.fillStyle = '#3a3026';
    g.fillRect(16, 38, 32, 18);
    g.fillStyle = '#2a2620';
    g.fillRect(16, 33, 32, 7);
    // ember glow from the seam and slats
    const gg = g.createRadialGradient(32, 43, 1, 32, 43, 16);
    gg.addColorStop(0, 'rgba(255,190,90,0.9)');
    gg.addColorStop(1, 'rgba(200,100,20,0)');
    g.fillStyle = gg;
    g.fillRect(17, 39, 30, 3);
    for (const x of [22, 32, 42]) g.fillRect(x - 1, 42, 2, 12);
    // iron bands
    g.fillStyle = '#23252c';
    g.fillRect(16, 33, 32, 2);
    g.fillRect(16, 54, 32, 2);
    g.fillRect(19, 33, 3, 23);
    g.fillRect(42, 33, 3, 23);
    // clasp
    g.fillStyle = '#565b68';
    g.fillRect(30, 38, 4, 5);
  }, 707);
}

function aegisSprite() {
  return sprite((g) => {
    // hexagonal rune-carved warding stone
    g.save();
    g.translate(32, 45);
    const gg = g.createRadialGradient(0, 0, 2, 0, 0, 18);
    gg.addColorStop(0, 'rgba(90,220,210,0.5)');
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gg;
    g.fillRect(-20, -20, 40, 40);
    g.fillStyle = '#2c5c58';
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * 12, y = Math.sin(a) * 12;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath(); g.fill();
    g.strokeStyle = '#48a89c';
    g.lineWidth = 2;
    g.stroke();
    // rune glyph
    g.strokeStyle = '#8af0e4';
    g.lineWidth = 1.8;
    g.beginPath();
    g.moveTo(0, -7); g.lineTo(0, 7);
    g.moveTo(-5, -3); g.lineTo(5, 3);
    g.moveTo(5, -3); g.lineTo(-5, 3);
    g.stroke();
    g.restore();
  }, 708);
}

function wraithSprite() {
  return sprite((g) => {
    // violet-black flame with a pale core
    const gg = g.createRadialGradient(32, 44, 1, 32, 44, 18);
    gg.addColorStop(0, 'rgba(200,120,250,0.6)');
    gg.addColorStop(1, 'rgba(90,20,150,0)');
    g.fillStyle = gg;
    g.fillRect(12, 24, 40, 40);
    g.fillStyle = '#3a1454';
    g.beginPath();
    g.moveTo(26, 56);
    g.quadraticCurveTo(20, 44, 28, 36);
    g.quadraticCurveTo(26, 30, 32, 22);
    g.quadraticCurveTo(38, 30, 36, 36);
    g.quadraticCurveTo(44, 44, 38, 56);
    g.quadraticCurveTo(32, 60, 26, 56);
    g.fill();
    g.fillStyle = '#9c48e0';
    g.beginPath();
    g.moveTo(29, 54);
    g.quadraticCurveTo(26, 44, 32, 32);
    g.quadraticCurveTo(38, 44, 35, 54);
    g.quadraticCurveTo(32, 57, 29, 54);
    g.fill();
    g.fillStyle = '#f0e0ff';
    g.beginPath(); g.arc(32, 47, 4, 0, Math.PI * 2); g.fill();
  }, 709);
}

function phaseSprite() {
  return sprite((g) => {
    // slim pale-blue vial with a spiral wisp
    g.fillStyle = 'rgba(140,200,240,0.2)';
    g.beginPath(); g.arc(32, 44, 11, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(90,160,220,0.85)';
    g.beginPath();
    g.moveTo(29, 30); g.lineTo(29, 52);
    g.quadraticCurveTo(32, 57, 35, 52); g.lineTo(35, 30);
    g.closePath(); g.fill();
    g.strokeStyle = '#c8ecff';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(30, 50);
    g.quadraticCurveTo(36, 46, 30, 42);
    g.quadraticCurveTo(35, 38, 31, 34);
    g.stroke();
    g.fillStyle = '#8a6a42';
    g.fillRect(28, 26, 8, 4);
  }, 710);
}

function orbSprite() {
  return sprite((g) => {
    // milky seer's orb with a slit iris
    const gg = g.createRadialGradient(32, 44, 1, 32, 44, 18);
    gg.addColorStop(0, 'rgba(240,240,255,0.5)');
    gg.addColorStop(1, 'rgba(120,120,180,0)');
    g.fillStyle = gg;
    g.fillRect(12, 24, 40, 40);
    const og = g.createRadialGradient(28, 40, 2, 32, 44, 12);
    og.addColorStop(0, '#f4f2ff');
    og.addColorStop(0.7, '#b8b4d8');
    og.addColorStop(1, '#787498');
    g.fillStyle = og;
    g.beginPath(); g.arc(32, 44, 11, 0, Math.PI * 2); g.fill();
    // iris
    g.fillStyle = '#3c3454';
    g.beginPath(); g.ellipse(32, 44, 2.4, 7, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e8c04a';
    g.beginPath(); g.ellipse(32, 44, 1, 4.5, 0, 0, Math.PI * 2); g.fill();
    // radiating sight-lines
    g.strokeStyle = 'rgba(232,192,74,0.4)';
    g.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.26;
      g.beginPath();
      g.moveTo(32 + Math.cos(a) * 13, 44 + Math.sin(a) * 13);
      g.lineTo(32 + Math.cos(a) * 17, 44 + Math.sin(a) * 17);
      g.stroke();
    }
  }, 711);
}

function chaliceSprite() {
  return sprite((g) => {
    // gold goblet with a violet gem
    const gg = g.createRadialGradient(32, 42, 1, 32, 42, 16);
    gg.addColorStop(0, 'rgba(255,220,120,0.5)');
    gg.addColorStop(1, 'rgba(200,150,40,0)');
    g.fillStyle = gg;
    g.fillRect(14, 26, 36, 36);
    g.fillStyle = '#d8a838';
    g.beginPath();
    g.moveTo(23, 32); g.lineTo(41, 32);
    g.quadraticCurveTo(41, 42, 32, 45);
    g.quadraticCurveTo(23, 42, 23, 32);
    g.fill();
    g.fillRect(30, 44, 4, 8);
    g.beginPath(); g.ellipse(32, 54, 8, 3, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f8e0a0';
    g.fillRect(25, 33, 3, 6);
    g.fillStyle = '#9c48e0';
    g.beginPath(); g.arc(32, 37, 2.6, 0, Math.PI * 2); g.fill();
  }, 712);
}

function idolSprite() {
  return sprite((g) => {
    // squat golden figurine with ember eyes
    const gg = g.createRadialGradient(32, 44, 1, 32, 44, 17);
    gg.addColorStop(0, 'rgba(255,220,120,0.5)');
    gg.addColorStop(1, 'rgba(200,150,40,0)');
    g.fillStyle = gg;
    g.fillRect(14, 26, 36, 36);
    g.fillStyle = '#d8a838';
    // plinth, body, head
    g.fillRect(23, 52, 18, 5);
    g.beginPath();
    g.moveTo(26, 52);
    g.quadraticCurveTo(22, 40, 28, 36);
    g.lineTo(36, 36);
    g.quadraticCurveTo(42, 40, 38, 52);
    g.closePath(); g.fill();
    g.beginPath(); g.arc(32, 31, 6, 0, Math.PI * 2); g.fill();
    // folded arms
    g.strokeStyle = '#a87c20';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(26, 44); g.quadraticCurveTo(32, 48, 38, 44); g.stroke();
    g.fillStyle = '#f8e0a0';
    g.fillRect(27, 38, 2, 10);
    // ember eyes
    g.fillStyle = '#ff7830';
    g.fillRect(29, 29, 2, 2);
    g.fillRect(33, 29, 2, 2);
  }, 713);
}

function crownSprite() {
  return sprite((g) => {
    // the Duskcrown: three-point gold crown, violet gems
    const gg = g.createRadialGradient(32, 44, 1, 32, 44, 20);
    gg.addColorStop(0, 'rgba(255,225,130,0.65)');
    gg.addColorStop(1, 'rgba(200,150,40,0)');
    g.fillStyle = gg;
    g.fillRect(10, 22, 44, 42);
    g.fillStyle = '#e0b040';
    g.beginPath();
    g.moveTo(20, 52); g.lineTo(20, 36); g.lineTo(26, 44);
    g.lineTo(32, 32); g.lineTo(38, 44); g.lineTo(44, 36);
    g.lineTo(44, 52);
    g.closePath(); g.fill();
    g.fillStyle = '#f8e0a0';
    g.fillRect(21, 47, 3, 5);
    // band
    g.fillStyle = '#b8882c';
    g.fillRect(20, 49, 24, 4);
    // gems
    g.fillStyle = '#9c48e0';
    for (const [x, y] of [[32, 34], [21, 38], [43, 38]]) {
      g.beginPath(); g.arc(x, y, 2.2, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#7830c0';
    g.beginPath(); g.arc(32, 51, 2.6, 0, Math.PI * 2); g.fill();
  }, 714);
}

// --- first-person weapon (kept as canvases; composited in 2D) ----------------

function weaponCanvas(flash) {
  const c = makeCanvas(120, 100);
  const g = c.getContext('2d');
  // wooden grip
  g.fillStyle = '#4a3624';
  g.beginPath();
  g.moveTo(48, 100); g.lineTo(52, 62); g.lineTo(72, 62); g.lineTo(82, 100);
  g.closePath(); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(52, 70, 24, 3);
  g.fillRect(54, 82, 24, 3);
  // barrel: dark iron cannon seen from behind
  const grad = g.createLinearGradient(40, 0, 88, 0);
  grad.addColorStop(0, '#23252c');
  grad.addColorStop(0.5, '#454a58');
  grad.addColorStop(1, '#1c1e24');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(44, 66);
  g.lineTo(50, 18);
  g.lineTo(74, 18);
  g.lineTo(80, 66);
  g.closePath();
  g.fill();
  // muzzle rim
  g.fillStyle = '#12141a';
  g.beginPath(); g.ellipse(62, 18, 12.5, 5, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#565b68';
  g.lineWidth = 2;
  g.beginPath(); g.ellipse(62, 18, 12.5, 5, 0, 0, Math.PI * 2); g.stroke();
  // ember chamber glow
  const eg = g.createRadialGradient(62, 52, 1, 62, 52, 10);
  eg.addColorStop(0, flash ? '#fff2c0' : '#ffca70');
  eg.addColorStop(0.6, flash ? '#ffb050' : '#d07828');
  eg.addColorStop(1, 'rgba(160,70,20,0)');
  g.fillStyle = eg;
  g.beginPath(); g.arc(62, 52, 10, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#12141a';
  g.fillRect(50, 44, 24, 3);
  g.fillRect(50, 58, 24, 3);
  if (flash) {
    // muzzle burst
    const fg = g.createRadialGradient(62, 14, 1, 62, 14, 30);
    fg.addColorStop(0, 'rgba(255,245,200,0.95)');
    fg.addColorStop(0.4, 'rgba(255,170,70,0.8)');
    fg.addColorStop(1, 'rgba(255,120,30,0)');
    g.fillStyle = fg;
    g.beginPath(); g.arc(62, 14, 30, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,240,190,0.9)';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      g.beginPath();
      g.moveTo(62, 14);
      g.lineTo(62 + Math.cos(a) * 24, 14 + Math.sin(a) * 16);
      g.lineTo(62 + Math.cos(a + 0.25) * 10, 14 + Math.sin(a + 0.25) * 7);
      g.fill();
    }
  }
  return c;
}

// --- public ------------------------------------------------------------------

function makeAssets() {
  const walls = [];
  walls[TILE.STONE] = stoneTex();
  walls[TILE.MOSS] = mossTex();
  walls[TILE.BANNER] = bannerTex();
  walls[TILE.DOOR] = doorTex();
  walls[TILE.DOOR_R] = lockedDoorTex('#e04848', 'rgba(224,72,72,0.4)', 411);
  walls[TILE.DOOR_G] = lockedDoorTex('#48d078', 'rgba(72,208,120,0.4)', 412);
  walls[TILE.DOOR_Y] = lockedDoorTex('#e8c04a', 'rgba(232,192,74,0.4)', 413);
  walls[TILE.EXIT] = exitTex();
  walls[TILE.PUSH] = walls[TILE.STONE];

  const enemyFrames = (painter, base) =>
    [0, 1, 2, 3].map((f) => sprite((g, rng) => painter(g, rng, f), base + f));

  return {
    walls,
    enemies: {
      gloam: enemyFrames(drawGloam, 810),
      stalker: enemyFrames(drawStalker, 820),
      husk: enemyFrames(drawHusk, 830),
      warden: enemyFrames(drawWarden, 840),
    },
    torch: [torchSprite(0), torchSprite(1), torchSprite(2)],
    items: {
      health: healthSprite(),
      ammo: ammoSprite(),
      key1: keySprite('#e04848', 'rgba(224,72,72,0.35)'),
      key2: keySprite('#48d078', 'rgba(72,208,120,0.35)'),
      key3: keySprite('#e8c04a', 'rgba(232,192,74,0.35)'),
      shard: shardSprite(),
      tonic: tonicSprite(),
      cache: cacheSprite(),
      aegis: aegisSprite(),
      wraith: wraithSprite(),
      phase: phaseSprite(),
      orb: orbSprite(),
      chalice: chaliceSprite(),
      idol: idolSprite(),
      crown: crownSprite(),
    },
    bolt: boltSprite(),
    weapon: weaponCanvas(false),
    weaponFlash: weaponCanvas(true),
  };
}

Object.assign(G, { TEX_SIZE, makeAssets });
})();

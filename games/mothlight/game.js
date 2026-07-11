/* Mothlight — a one-button flight game.
   A moth weaves through gaps between hanging lantern-chains at night.
   Vanilla JS, canvas-drawn everything, Web Audio synth sounds.        */

(() => {
"use strict";

// ---------------------------------------------------------------- constants
// Numbers + pure rules live in logic.js (window.MothlightLogic), which is
// dual-environment so test/logic.test.js exercises the same code in node.

const L = window.MothlightLogic;
const {
  W, H, GROUND_H, SKY_H, DT, FLAP_VY, SCROLL, MOTH_X, SPACING, GAP_HALF,
  CEILING_Y, FLOOR_Y, RESTART_DELAY_MS,
} = L.constants;

const MAX_FRAME = 0.25;              // clamp long frames (tab hitches)

const LS_HIGH = "arcade.mothlight.high";
const LS_AUDIO = "arcade.mothlight.audio";

// ---------------------------------------------------------------- canvas

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// ---------------------------------------------------------------- helpers

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = L.clamp, lerp = L.lerp;

// ---------------------------------------------------------------- audio

let audioOn = localStorage.getItem(LS_AUDIO) !== "off";
let actx = null, master = null;

function ensureAudio() {              // only after a user gesture
  if (actx) { if (actx.state === "suspended") actx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  actx = new AC();
  master = actx.createGain();
  master.gain.value = 0.5;
  master.connect(actx.destination);
}

function blip(freq0, freq1, dur, type, vol) {
  if (!audioOn || !actx) return;
  const t = actx.currentTime;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(freq1, 1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

function noiseBurst(dur, vol, cutoff) {
  if (!audioOn || !actx) return;
  const t = actx.currentTime;
  const n = Math.floor(actx.sampleRate * dur);
  const buf = actx.createBuffer(1, n, actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = actx.createBufferSource();
  src.buffer = buf;
  const f = actx.createBiquadFilter();
  f.type = "lowpass"; f.frequency.value = cutoff;
  const g = actx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t);
}

const sfx = {
  flap()  { noiseBurst(0.09, 0.35, 900); blip(340, 520, 0.08, "sine", 0.12); },
  score() { blip(880, 880, 0.07, "sine", 0.18);
            setTimeout(() => blip(1320, 1320, 0.10, "sine", 0.16), 70); },
  die()   { noiseBurst(0.25, 0.5, 2400); blip(300, 60, 0.45, "sawtooth", 0.22); },
  thud()  { blip(120, 40, 0.18, "triangle", 0.25); },
};

const audioBtn = document.getElementById("audio-toggle");
function refreshAudioBtn() {
  audioBtn.textContent = "sound: " + (audioOn ? "on" : "off");
}
function toggleAudio() {
  audioOn = !audioOn;
  localStorage.setItem(LS_AUDIO, audioOn ? "on" : "off");
  refreshAudioBtn();
}
audioBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleAudio(); });
refreshAudioBtn();

// ---------------------------------------------------------------- state

const S_TITLE = 0, S_PLAY = 1, S_DYING = 2, S_OVER = 3;

let state = S_TITLE;
let paused = false;
let score = 0;
let high = parseInt(localStorage.getItem(LS_HIGH) || "0", 10) || 0;
let newHigh = false;
let overAt = 0;                      // timestamp when game-over began (input delay)
let flashT = 0;                      // death flash timer
let shakeT = 0;                      // screen shake timer
let elapsed = 0;                     // total sim time, drives ambient motion

const moth = {
  y: 0, py: 0, vy: 0,
  rot: 0, prot: 0,
  wing: 0,                           // wing-beat phase; kicks on flap
  flapAge: 9,                        // seconds since last flap
  spin: 0,                           // tumble speed while dying
};

let chains = [];                     // { x, px, gapY, scored }

// parallax layers -----------------------------------------------------------

const stars = [];
for (let i = 0; i < 90; i++) {
  stars.push({ x: Math.random() * W, y: Math.random() * SKY_H * 0.92,
               r: rand(0.4, 1.4), tw: rand(0, Math.PI * 2), sp: rand(1, 3) });
}

function makeFlies(count, depth) {
  const arr = [];
  for (let i = 0; i < count; i++) {
    arr.push({ x: Math.random() * (W + 80) - 40, y: rand(40, SKY_H - 30),
               ph: rand(0, Math.PI * 2), ph2: rand(0, Math.PI * 2),
               depth, r: depth * 2.2 });
  }
  return arr;
}
const fliesFar = makeFlies(14, 0.55);
const fliesNear = makeFlies(9, 1.0);

// distant treeline silhouette (two layers), procedural but stable per session
function makeRidge(base, amp, step) {
  const pts = [];
  let y = base;
  for (let x = -step; x <= W + step * 2; x += step) {
    y = clamp(y + rand(-amp, amp), base - amp * 2.2, base + amp * 1.4);
    pts.push({ x, y });
  }
  return pts;
}
const ridgeFar = makeRidge(SKY_H - 90, 26, 46);
const ridgeNear = makeRidge(SKY_H - 38, 34, 38);
let ridgeFarOff = 0, ridgeNearOff = 0;

// ---------------------------------------------------------------- game setup

function reset() {
  score = 0;
  newHigh = false;
  moth.y = moth.py = SKY_H * 0.42;
  moth.vy = 0;
  moth.rot = moth.prot = 0;
  moth.wing = 0;
  moth.flapAge = 9;
  moth.spin = 0;
  flashT = shakeT = 0;
  chains = [];
  let x = W + 200, prevGap;
  for (let i = 0; i < 4; i++) {
    const c = newChain(x, prevGap);
    chains.push(c);
    prevGap = c.gapY;
    x += SPACING;
  }
}

function newChain(x, prevGapY) {
  return {
    x, px: x,
    gapY: L.chainGapY(prevGapY, Math.random()),  // random, but always reachable
    scored: false,
    sway: rand(0, Math.PI * 2),      // gentle lantern sway phase
  };
}

// ---------------------------------------------------------------- input

function flap() {
  moth.vy = FLAP_VY;                 // SET, never add — the core feel
  moth.flapAge = 0;
  moth.wing = 0;
  sfx.flap();
}

function onAction() {
  ensureAudio();
  if (paused) { paused = false; return; }
  if (state === S_TITLE) { reset(); state = S_PLAY; flap(); return; }
  if (state === S_PLAY) { flap(); return; }
  if (state === S_OVER && performance.now() - overAt > RESTART_DELAY_MS) {
    reset(); state = S_PLAY; flap();
  }
  // S_DYING ignores input; the tumble plays out
}

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.code === "KeyM") { toggleAudio(); return; }
  if (e.code === "KeyP") {
    if (state === S_PLAY || paused) paused = !paused;
    return;
  }
  if (paused) { paused = false; return; }     // any key resumes
  if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
    e.preventDefault(); onAction();
  } else if (state === S_OVER && performance.now() - overAt > RESTART_DELAY_MS) {
    reset(); state = S_PLAY; ensureAudio(); flap();
  }
});
canvas.addEventListener("mousedown", (e) => { e.preventDefault(); onAction(); });
canvas.addEventListener("touchstart", (e) => { e.preventDefault(); onAction(); },
                        { passive: false });

window.addEventListener("blur", () => { if (state === S_PLAY) paused = true; });

// ---------------------------------------------------------------- physics

function die() {
  state = S_DYING;
  flashT = 0.14;
  shakeT = 0.3;
  moth.vy = -320;                    // bounce up, then tumble down
  moth.spin = rand(7, 11) * (Math.random() < 0.5 ? -1 : 1);
  if (score > high) { high = score; newHigh = true;
                      localStorage.setItem(LS_HIGH, String(high)); }
  sfx.die();
}

function step() {
  elapsed += DT;
  moth.py = moth.y;
  moth.prot = moth.rot;
  for (const c of chains) c.px = c.x;

  // ambient scroll (parallax keeps drifting on title/game-over too)
  const scrolling = (state === S_PLAY) ? 1 : (state === S_TITLE ? 0.4 : 0);
  ridgeFarOff = (ridgeFarOff + SCROLL * 0.12 * scrolling * DT) % (W + 46 * 2);
  ridgeNearOff = (ridgeNearOff + SCROLL * 0.25 * scrolling * DT) % (W + 38 * 2);
  for (const s of stars) {
    s.x -= SCROLL * 0.04 * scrolling * DT;
    if (s.x < -2) s.x += W + 4;
  }
  for (const f of fliesFar.concat(fliesNear)) {
    f.x -= SCROLL * 0.35 * f.depth * scrolling * DT;
    f.ph += DT * 1.3; f.ph2 += DT * 0.7;
    if (f.x < -50) { f.x = W + rand(10, 50); f.y = rand(40, SKY_H - 30); }
  }

  if (state === S_TITLE) {           // moth hovers on the title screen
    moth.y = SKY_H * 0.42 + Math.sin(elapsed * 2.1) * 12;
    moth.rot = Math.sin(elapsed * 2.1 + 1.2) * 0.12;
    moth.wing += DT;
    return;
  }

  if (state === S_OVER) return;

  // ---- moth physics (PLAY and DYING share gravity) ----
  moth.vy = L.fall(moth.vy, DT);
  moth.y += moth.vy * DT;
  moth.flapAge += DT;
  moth.wing += DT;

  if (state === S_DYING) {
    moth.rot += moth.spin * DT;      // tumble
    if (moth.y >= FLOOR_Y) {         // hit the moss — done
      moth.y = FLOOR_Y;
      state = S_OVER;
      overAt = performance.now();
      sfx.thud();
    }
    return;
  }

  if (testPinY !== null) { moth.y = testPinY; moth.vy = 0; }  // test handle

  // ceiling clamps (no death), floor kills
  if (moth.y < CEILING_Y) { moth.y = CEILING_Y; moth.vy = Math.max(moth.vy, 0); }
  if (moth.y >= FLOOR_Y) { moth.y = FLOOR_Y; die(); return; }

  // rotation follows vy: snap up on flap, ease into a nose-dive falling
  const target = L.tiltTarget(moth.vy);
  moth.rot = moth.flapAge < 0.12 ? target
                                 : lerp(moth.rot, target, 1 - Math.exp(-8 * DT));

  // ---- world scroll: chains move left, the moth's x never changes ----
  for (const c of chains) c.x -= SCROLL * DT;
  if (chains[0].x < -60) chains.shift();
  const last = chains[chains.length - 1];
  if (last.x < W + 60) chains.push(newChain(last.x + SPACING, last.gapY));

  for (const c of chains) {
    // score exactly when the moth passes the gap's center-line
    if (!c.scored && L.passedGap(c.x, MOTH_X)) {
      c.scored = true;
      score++;
      sfx.score();
    }
    // collision — circle (smaller than the drawn moth) vs chain rectangles
    if (L.inChainBand(c.x, MOTH_X) && L.hitsChain(moth.y, c.gapY)) {
      die();
      return;
    }
  }
}

// ---------------------------------------------------------------- drawing

function drawBackground() {
  // night sky gradient
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#070811");
  g.addColorStop(0.55, "#0c0e1c");
  g.addColorStop(1, "#11101c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // moon
  const mg = ctx.createRadialGradient(W - 92, 96, 4, W - 92, 96, 90);
  mg.addColorStop(0, "rgba(226, 232, 255, 0.85)");
  mg.addColorStop(0.16, "rgba(200, 210, 250, 0.28)");
  mg.addColorStop(1, "rgba(200, 210, 250, 0)");
  ctx.fillStyle = mg;
  ctx.fillRect(W - 190, 0, 190, 200);
  ctx.fillStyle = "#dfe5f7";
  ctx.beginPath(); ctx.arc(W - 92, 96, 17, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(150, 160, 200, 0.35)";
  ctx.beginPath(); ctx.arc(W - 97, 92, 4.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(W - 86, 101, 3, 0, Math.PI * 2); ctx.fill();

  // stars (twinkle)
  for (const s of stars) {
    const a = 0.35 + 0.35 * Math.sin(elapsed * s.sp + s.tw);
    ctx.fillStyle = `rgba(210, 220, 255, ${a.toFixed(3)})`;
    ctx.fillRect(s.x, s.y, s.r, s.r);
  }
}

function drawRidge(pts, off, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-off + pts[0].x, pts[0].y);
  for (const p of pts) ctx.lineTo(p.x - off, p.y);
  // second copy for seamless wrap
  const w = pts[pts.length - 1].x;
  for (const p of pts) ctx.lineTo(p.x - off + w, p.y);
  ctx.lineTo(W + 40, H); ctx.lineTo(-40, H);
  ctx.closePath();
  ctx.fill();
}

function drawFlies(arr, tint) {
  for (const f of arr) {
    const x = f.x + Math.sin(f.ph) * 9 * f.depth;
    const y = f.y + Math.sin(f.ph2 * 1.7) * 7 * f.depth;
    const pulse = 0.35 + 0.65 * Math.max(0, Math.sin(f.ph * 1.9 + f.ph2));
    const r = f.r * (1.6 + pulse);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
    g.addColorStop(0, `rgba(${tint}, ${(0.75 * pulse).toFixed(3)})`);
    g.addColorStop(1, `rgba(${tint}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r * 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(255, 255, 220, ${(0.5 + 0.5 * pulse).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(x, y, f.r * 0.55, 0, Math.PI * 2); ctx.fill();
  }
}

function drawGround() {
  ctx.fillStyle = "#151b16";
  ctx.fillRect(0, SKY_H, W, GROUND_H);
  ctx.fillStyle = "#1d2a1e";
  ctx.beginPath();
  for (let x = 0; x <= W; x += 8) {
    const h = 5 + 4 * Math.sin(x * 0.14 + 2) + 3 * Math.sin(x * 0.05);
    ctx.rect(x, SKY_H - h, 6, h + 4);
  }
  ctx.fill();
  ctx.fillStyle = "rgba(126, 231, 135, 0.10)";
  ctx.fillRect(0, SKY_H, W, 2);
}

function drawLantern(x, y, r, sway) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(sway) * 0.06);
  // halo
  const halo = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 3.4);
  halo.addColorStop(0, "rgba(255, 186, 80, 0.55)");
  halo.addColorStop(0.4, "rgba(255, 160, 60, 0.16)");
  halo.addColorStop(1, "rgba(255, 150, 50, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(0, 0, r * 3.4, 0, Math.PI * 2); ctx.fill();
  // paper body
  const body = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.2, 0, 0, r);
  body.addColorStop(0, "#ffd98f");
  body.addColorStop(0.6, "#f2a53c");
  body.addColorStop(1, "#a35c17");
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.ellipse(0, 0, r * 0.85, r, 0, 0, Math.PI * 2); ctx.fill();
  // ribs
  ctx.strokeStyle = "rgba(90, 45, 8, 0.5)";
  ctx.lineWidth = 1;
  for (const k of [-0.5, 0, 0.5]) {
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.85 * Math.abs(Math.cos(k)), r, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // caps
  ctx.fillStyle = "#3d2a12";
  ctx.fillRect(-r * 0.4, -r - 4, r * 0.8, 5);
  ctx.fillRect(-r * 0.3, r - 1, r * 0.6, 4);
  ctx.restore();
}

function drawChainLink(x, y) {
  ctx.strokeStyle = "#4c4436";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(x, y, 2.5, 4.5, 0, 0, Math.PI * 2); ctx.stroke();
}

function drawChain(c, alpha) {
  const x = lerp(c.px, c.x, alpha);
  const sway = elapsed * 1.4 + c.sway;
  const topEnd = c.gapY - GAP_HALF;      // bottom of the upper chain
  const botStart = c.gapY + GAP_HALF;    // top of the lower stack

  // upper: chain hanging from above, lanterns strung along it
  ctx.strokeStyle = "#3a342a";
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x, -4); ctx.lineTo(x, topEnd - 16); ctx.stroke();
  for (let y = 12; y < topEnd - 26; y += 22) drawChainLink(x, y);
  for (let y = topEnd - 60; y > 20; y -= 84) drawLantern(x, y, 11, sway + y);
  drawLantern(x, topEnd - 15, 15, sway);   // the big one at the chain's end

  // lower: a lantern-pole rising from the moss
  ctx.strokeStyle = "#3a342a";
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(x, SKY_H + 6); ctx.lineTo(x, botStart + 16); ctx.stroke();
  for (let y = SKY_H - 8; y > botStart + 28; y -= 22) drawChainLink(x, y);
  for (let y = botStart + 62; y < SKY_H - 30; y += 84) drawLantern(x, y, 11, sway + y);
  drawLantern(x, botStart + 15, 15, sway + 2);
}

function drawMoth(alpha) {
  const y = lerp(moth.py, moth.y, alpha);
  const rot = lerp(moth.prot, moth.rot, alpha);

  ctx.save();
  ctx.translate(MOTH_X, y);
  ctx.rotate(rot);

  // faint dust glow around the moth
  const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 30);
  glow.addColorStop(0, "rgba(230, 220, 255, 0.18)");
  glow.addColorStop(1, "rgba(230, 220, 255, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.fill();

  // wing beat: fast flutter right after a flap, lazy otherwise
  const rate = moth.flapAge < 0.25 ? 34 : 10;
  const beat = Math.sin(moth.wing * rate);
  const wingLift = state === S_DYING ? 0.9 : lerp(0.18, 0.85, (beat + 1) / 2);

  // wings (drawn WAY bigger than the 9px hitbox — forgiveness by design)
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(1, side);
    ctx.rotate(-wingLift * 0.9);
    // hindwing
    ctx.fillStyle = "#8f86a8";
    ctx.beginPath();
    ctx.moveTo(-2, 0);
    ctx.quadraticCurveTo(-22, 8, -18, 20);
    ctx.quadraticCurveTo(-8, 18, -1, 6);
    ctx.closePath(); ctx.fill();
    // forewing
    ctx.fillStyle = "#b9aed1";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(14, -20, 26, -14);
    ctx.quadraticCurveTo(24, -2, 4, 5);
    ctx.closePath(); ctx.fill();
    // eyespot
    ctx.fillStyle = "#5c5470";
    ctx.beginPath(); ctx.arc(15, -9, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#e8e2f5";
    ctx.beginPath(); ctx.arc(15, -9, 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // fuzzy body
  ctx.fillStyle = "#d8cfae";
  ctx.beginPath(); ctx.ellipse(0, 0, 9, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#bfb18b";
  ctx.beginPath(); ctx.ellipse(-4, 0, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
  // head + eye
  ctx.fillStyle = "#e6dcb8";
  ctx.beginPath(); ctx.arc(8, 0, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#211d2b";
  ctx.beginPath(); ctx.arc(9.4, -0.8, 1.3, 0, Math.PI * 2); ctx.fill();
  // antennae
  ctx.strokeStyle = "#e6dcb8";
  ctx.lineWidth = 1.2;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(9, side * -1);
    ctx.quadraticCurveTo(16, side * -7, 19, side * -5);
    ctx.stroke();
  }
  ctx.restore();
}

function text(str, x, y, size, color, align = "center") {
  ctx.font = `bold ${size}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.textAlign = align;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillText(str, x + 2, y + 2);
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

function drawUI() {
  if (state === S_PLAY || state === S_DYING) {
    text(String(score), W / 2, 78, 44, "#ffe8bf");
  }
  if (state === S_TITLE) {
    text("MOTHLIGHT", W / 2, 200, 42, "#ffc266");
    text("weave between the lantern-chains", W / 2, 236, 14, "#9aa3ad");
    if (Math.floor(elapsed * 1.6) % 2 === 0)
      text("tap / click / space to flap", W / 2, 420, 16, "#e8e2f5");
    text("best  " + high, W / 2, 460, 14, "#7ee787");
  }
  if (state === S_OVER) {
    ctx.fillStyle = "rgba(5, 5, 12, 0.55)";
    ctx.fillRect(0, 0, W, H);
    text("the light went out", W / 2, 260, 26, "#ffc266");
    text("score  " + score, W / 2, 320, 22, "#e8e2f5");
    text((newHigh ? "new best!  " : "best  ") + high, W / 2, 354, 16,
         newHigh ? "#7ee787" : "#9aa3ad");
    if (performance.now() - overAt > RESTART_DELAY_MS && Math.floor(elapsed * 1.6) % 2 === 0)
      text("press anything to fly again", W / 2, 430, 15, "#e8e2f5");
  }
  if (paused) {
    ctx.fillStyle = "rgba(5, 5, 12, 0.6)";
    ctx.fillRect(0, 0, W, H);
    text("paused", W / 2, H / 2 - 10, 28, "#ffc266");
    text("tap or press a key to resume", W / 2, H / 2 + 24, 14, "#9aa3ad");
  }
}

function render(alpha) {
  ctx.save();
  if (shakeT > 0) {
    const m = shakeT * 26;
    ctx.translate(rand(-m, m), rand(-m, m));
  }

  drawBackground();
  drawRidge(ridgeFar, ridgeFarOff, "#121527");
  drawFlies(fliesFar, "255, 240, 150");
  drawRidge(ridgeNear, ridgeNearOff, "#0e1120");

  for (const c of chains) drawChain(c, alpha);
  drawGround();
  drawFlies(fliesNear, "255, 250, 170");
  drawMoth(alpha);

  ctx.restore();

  if (flashT > 0) {                  // death flash
    ctx.fillStyle = `rgba(255, 225, 180, ${(flashT / 0.14 * 0.85).toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
  }

  drawUI();
}

// ---------------------------------------------------------------- test handle
// A small debug handle for test/browser.test.mjs: read-only views of live
// state plus a few scenario helpers. The game itself never calls these.

let testPinY = null;                 // while set, step() holds the moth here

window.__mothlight = {
  get state() { return state; },
  get paused() { return paused; },
  get score() { return score; },
  get high() { return high; },
  get newHigh() { return newHigh; },
  get audioOn() { return audioOn; },
  get overAt() { return overAt; },
  get moth() { return { y: moth.y, vy: moth.vy, rot: moth.rot }; },
  get chains() { return chains.map((c) => ({ x: c.x, gapY: c.gapY, scored: c.scored })); },
  pin(y) { testPinY = y; },
  unpin() { testPinY = null; },
  setMoth(y, vy) { moth.y = moth.py = y; moth.vy = vy; },
  setGaps(y) { for (const c of chains) c.gapY = y; },
  warp(dx) { for (const c of chains) { c.x -= dx; c.px = c.x; } },
};

// ---------------------------------------------------------------- main loop

let acc = 0, prev = performance.now();

function frame(now) {
  let ft = Math.min((now - prev) / 1000, MAX_FRAME);
  prev = now;

  if (!paused) {
    acc += ft;
    while (acc >= DT) { step(); acc -= DT; }
    if (flashT > 0) flashT -= ft;
    if (shakeT > 0) shakeT -= ft;
  }

  render(clamp(acc / DT, 0, 1));
  requestAnimationFrame(frame);
}

reset();
state = S_TITLE;
requestAnimationFrame(frame);

})();

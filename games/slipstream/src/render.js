// Slipstream — renderer. Classic segment-projection road:
// walk segments away from the interpolated camera, accumulate curve
// (dx += seg.curve; x += dx), project both edges with scale = camDepth/z,
// draw trapezoids back to front, then sprites/cars in painter's order.

import { SEG_LEN, ROAD_WIDTH, DRAW_DIST, segAt } from './track.js';
import { CAM_HEIGHT, CAM_DEPTH, PLAYER_Z, MAX_SPEED, GEARS, SPIN_TIME } from './sim.js';

export const W = 640;
export const H = 400;
const HW = W / 2;
const HH = H / 2;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function mix(a, b, t) {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];
}
const css = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

// One palette per stage theme (all colors original).
const THEMES = [
  { // 0 — Seabreak: coastal dawn
    skyTop: [24, 34, 74], skyBot: [255, 158, 92], sun: [255, 224, 168],
    ridgeFar: [64, 58, 100], ridgeNear: [42, 70, 76],
    groundL: [72, 124, 80], groundD: [62, 110, 70],
    roadL: [94, 98, 106], roadD: [87, 91, 99],
    rumA: [216, 220, 226], rumB: [198, 62, 50],
    lane: [228, 230, 234], fog: [238, 150, 106],
  },
  { // 1 — Pinegate: bright forest morning
    skyTop: [88, 158, 214], skyBot: [196, 228, 236], sun: [255, 246, 218],
    ridgeFar: [82, 118, 132], ridgeNear: [40, 88, 72],
    groundL: [58, 112, 64], groundD: [49, 97, 56],
    roadL: [98, 102, 110], roadD: [90, 94, 102],
    rumA: [220, 224, 230], rumB: [192, 58, 48],
    lane: [230, 232, 236], fog: [176, 208, 216],
  },
  { // 2 — Highridge: pale alpine pass
    skyTop: [118, 158, 198], skyBot: [214, 222, 230], sun: [255, 250, 235],
    ridgeFar: [126, 138, 152], ridgeNear: [96, 102, 100],
    groundL: [116, 110, 92], groundD: [104, 98, 82],
    roadL: [100, 104, 112], roadD: [92, 96, 104],
    rumA: [222, 226, 232], rumB: [188, 60, 50],
    lane: [232, 234, 238], fog: [204, 212, 222],
  },
  { // 3 — Sandreach: hot desert glare
    skyTop: [186, 96, 52], skyBot: [250, 208, 118], sun: [255, 238, 190],
    ridgeFar: [172, 112, 76], ridgeNear: [148, 108, 66],
    groundL: [192, 154, 92], groundD: [178, 142, 84],
    roadL: [104, 104, 108], roadD: [96, 96, 100],
    rumA: [228, 226, 218], rumB: [196, 70, 44],
    lane: [234, 232, 226], fog: [244, 190, 116],
  },
  { // 4 — Duskway: violet dusk
    skyTop: [16, 12, 42], skyBot: [128, 54, 116], sun: [232, 232, 255],
    ridgeFar: [52, 32, 78], ridgeNear: [30, 40, 46],
    groundL: [34, 48, 42], groundD: [28, 40, 36],
    roadL: [74, 78, 90], roadD: [66, 70, 82],
    rumA: [196, 200, 212], rumB: [176, 52, 60],
    lane: [206, 210, 220], fog: [78, 40, 88],
  },
];

const FOG_DENSITY = 5;
function fogAmount(n) {
  const t = n / DRAW_DIST;
  return 1 - Math.exp(-(t * t) * FOG_DENSITY * 2.2);
}

export class Renderer {
  constructor(canvas, sprites) {
    this.canvas = canvas;
    canvas.width = W; canvas.height = H;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.sprites = sprites;

    const D = DRAW_DIST;
    this.s1A = new Float32Array(D); this.x1A = new Float32Array(D);
    this.y1A = new Float32Array(D); this.w1A = new Float32Array(D);
    this.s2A = new Float32Array(D); this.x2A = new Float32Array(D);
    this.y2A = new Float32Array(D); this.w2A = new Float32Array(D);
    this.clipA = new Float32Array(D);
    this.fogA = new Float32Array(D);

    this.bgX = 0;
    this.sway = 0;
    this.horizonShift = 0;
    this.shakeKick = 0;
    this.particles = [];
    this.msgs = [];
    this.t = 0;
    this.frameDt = 1 / 60;
    this.carBuckets = new Map();
  }

  flash(text, color = '#ffd23c', dur = 1.8) {
    this.msgs.push({ text, color, t: 0, dur });
  }

  kick(mag = 8) { this.shakeKick = Math.max(this.shakeKick, mag); }

  spawnDust(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * 30, y: y + Math.random() * 4,
        vx: (Math.random() - 0.5) * 90, vy: -40 - Math.random() * 110,
        life: 0.35 + Math.random() * 0.3, age: 0,
        size: 2 + Math.random() * 3, color,
      });
    }
  }

  blendTheme(state, pSeg) {
    const stages = state.track.stages;
    const si = Math.min(pSeg.stage, stages.length - 1);
    const cur = THEMES[stages[si].theme];
    // ease into the next stage's palette over the last 80 segments
    if (si < stages.length - 1) {
      const st = stages[si];
      const left = st.to - pSeg.i;
      if (left < 80) {
        const nxt = THEMES[stages[si + 1].theme];
        const t = 1 - left / 80;
        const out = {};
        for (const k of Object.keys(cur)) out[k] = mix(cur[k], nxt[k], t);
        return out;
      }
    }
    return cur;
  }

  // ---------------------------------------------------------------- render
  render(state, alpha, fx) {
    const ctx = this.ctx;
    const s = state;
    const track = s.track;
    const segs = track.segments;
    const dt = this.frameDt;
    this.t += dt;

    // interpolated camera
    const pos = lerp(s.prev.position, s.position, alpha);
    const px = lerp(s.prev.playerX, s.playerX, alpha);
    const speed = lerp(s.prev.speed, s.speed, alpha);
    const ratio = speed / MAX_SPEED;

    const baseSeg = segAt(track, pos);
    const basePct = clamp((pos - baseSeg.i * SEG_LEN) / SEG_LEN, 0, 1);
    const pz = pos + PLAYER_Z;
    const pSeg = segAt(track, pz);
    const pPct = clamp((pz - pSeg.i * SEG_LEN) / SEG_LEN, 0, 1);
    const playerY = lerp(pSeg.y1, pSeg.y2, pPct);

    const theme = this.blendTheme(s, pSeg);

    // background scroll + camera sway on curves
    this.bgX += pSeg.curve * ratio * dt * 1.4;
    const swayTarget = pSeg.curve * ratio;
    this.sway += (swayTarget - this.sway) * Math.min(1, dt * 5);
    const slope = (pSeg.y2 - pSeg.y1) / SEG_LEN;
    this.horizonShift += (clamp(-slope * 90, -34, 34) - this.horizonShift) * Math.min(1, dt * 3);

    // screen shake: off-road rumble + crash kicks
    this.shakeKick = Math.max(0, this.shakeKick - dt * 24);
    let mag = this.shakeKick;
    if (fx.offRoad && ratio > 0.05) mag = Math.max(mag, Math.min(5, ratio * 8));
    const shx = (Math.random() - 0.5) * 2 * mag;
    const shy = (Math.random() - 0.5) * 2 * mag;

    ctx.save();
    ctx.translate(shx, shy);

    // ---- sky, sun, ridge parallax ----
    const horizon = H * 0.42 + this.horizonShift;
    this.drawSky(theme, horizon);

    // ---- road walk (curve accumulated during projection) ----
    const camX = px * ROAD_WIDTH + this.sway * 40;
    const camY = playerY + CAM_HEIGHT;

    const groundL = css(theme.groundL), groundD = css(theme.groundD);
    const roadL = css(theme.roadL), roadD = css(theme.roadD);
    const rumA = css(theme.rumA), rumB = css(theme.rumB);
    const laneC = css(theme.lane), fogC = css(theme.fog);

    let x = 0;
    let dx = -(baseSeg.curve * basePct);
    let maxy = H;
    const lastIdx = segs.length - 1;

    for (let n = 0; n < DRAW_DIST; n++) {
      const idx = Math.min(baseSeg.i + n, lastIdx);
      const seg = segs[idx];
      const z1 = idx * SEG_LEN - pos;
      const z2 = (idx + 1) * SEG_LEN - pos;

      const s1 = z1 > 0 ? CAM_DEPTH / z1 : 0;
      const x1 = HW + s1 * (x - camX) * HW;
      const y1 = HH - s1 * (seg.y1 - camY) * HH;
      const w1 = s1 * ROAD_WIDTH * HW;

      const s2 = z2 > 0 ? CAM_DEPTH / z2 : 0;
      const x2 = HW + s2 * (x + dx - camX) * HW;
      const y2 = HH - s2 * (seg.y2 - camY) * HH;
      const w2 = s2 * ROAD_WIDTH * HW;

      x += dx;
      dx += seg.curve;

      this.s1A[n] = s1; this.x1A[n] = x1; this.y1A[n] = y1; this.w1A[n] = w1;
      this.s2A[n] = s2; this.x2A[n] = x2; this.y2A[n] = y2; this.w2A[n] = w2;
      this.clipA[n] = maxy;
      const f = fogAmount(n);
      this.fogA[n] = f;

      if (z1 <= CAM_DEPTH || y2 >= maxy || y2 >= y1) continue; // behind us / hidden by a crest

      // grass band across the full width
      ctx.fillStyle = seg.stripe ? groundL : groundD;
      ctx.fillRect(0, y2, W, y1 - y2);

      // rumble strips at the road edge
      const r1 = w1 / 6, r2 = w2 / 6;
      ctx.fillStyle = seg.stripe ? rumA : rumB;
      poly(ctx, x1 - w1 - r1, y1, x1 - w1, y1, x2 - w2, y2, x2 - w2 - r2, y2);
      poly(ctx, x1 + w1 + r1, y1, x1 + w1, y1, x2 + w2, y2, x2 + w2 + r2, y2);

      // road surface
      ctx.fillStyle = seg.stripe ? roadL : roadD;
      poly(ctx, x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2);

      // lane separators (3 lanes) on the light bands
      if (seg.stripe) {
        const l1 = w1 / 32, l2 = w2 / 32;
        ctx.fillStyle = laneC;
        for (let lane = 1; lane < 3; lane++) {
          const lx1 = x1 - w1 + (2 * w1 * lane) / 3;
          const lx2 = x2 - w2 + (2 * w2 * lane) / 3;
          poly(ctx, lx1 - l1, y1, lx1 + l1, y1, lx2 + l2, y2, lx2 - l2, y2);
        }
      }

      // distance fog over the whole band
      if (f > 0.02) {
        ctx.globalAlpha = f;
        ctx.fillStyle = fogC;
        ctx.fillRect(0, y2, W, y1 - y2);
        ctx.globalAlpha = 1;
      }

      maxy = y2;
    }

    // ---- sprites & traffic, far to near (painter's order) ----
    this.carBuckets.clear();
    for (const car of s.cars) {
      const rel = Math.floor(car.z / SEG_LEN) - baseSeg.i;
      if (rel >= 0 && rel < DRAW_DIST) {
        let list = this.carBuckets.get(rel);
        if (!list) { list = []; this.carBuckets.set(rel, list); }
        list.push(car);
      }
    }

    for (let n = DRAW_DIST - 1; n >= 0; n--) {
      const idx = baseSeg.i + n;
      if (idx > lastIdx) continue;
      const seg = segs[idx];
      const s1 = this.s1A[n];
      if (s1 <= 0) continue;
      const clipY = this.clipA[n];
      const vis = 1 - this.fogA[n] * 0.96;
      if (vis <= 0.04) continue;

      for (const sp of seg.sprites) {
        const def = this.sprites[sp.kind];
        const sx = this.x1A[n] + s1 * sp.off * ROAD_WIDTH * HW;
        this.drawSprite(def, sx, this.y1A[n], s1, clipY, vis);
      }
      const cars = this.carBuckets.get(n);
      if (cars) {
        for (const car of cars) {
          const pct = (car.z % SEG_LEN) / SEG_LEN;
          const sc = lerp(s1, this.s2A[n], pct);
          const cx = lerp(this.x1A[n], this.x2A[n], pct) + sc * car.offset * ROAD_WIDTH * HW;
          const cy = lerp(this.y1A[n], this.y2A[n], pct);
          this.drawSprite(this.sprites.traffic[car.kind], cx, cy, sc, clipY, vis);
        }
      }
    }

    // ---- dust particles ----
    this.updateParticles(dt, s, fx, theme, ratio);

    // ---- player car ----
    this.drawPlayer(s, fx, ratio);

    ctx.restore();

    // ---- HUD (not shaken) ----
    this.drawHUD(s, speed, fx);
  }

  drawSprite(def, xCenter, yBase, scale, clipY, alpha) {
    if (!def) return;
    const c = def.c;
    const destW = scale * def.worldW * HW;
    if (destW < 1.2) return;
    const destH = destW * (c.height / c.width);
    const destX = xCenter - destW / 2;
    const destY = yBase - destH;
    if (destX > W + 8 || destX + destW < -8 || destY > H + 8) return; // fully offscreen
    const visible = clipY - destY;
    if (visible <= 0) return;
    const drawH = Math.min(destH, visible);
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.drawImage(c, 0, 0, c.width, c.height * (drawH / destH), destX, destY, destW, drawH);
    ctx.globalAlpha = 1;
  }

  drawSky(theme, horizon) {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, -10, 0, horizon);
    g.addColorStop(0, css(theme.skyTop));
    g.addColorStop(1, css(theme.skyBot));
    ctx.fillStyle = g;
    ctx.fillRect(-8, -8, W + 16, horizon + 8);

    // base ground fill under the horizon (road bands draw over it)
    ctx.fillStyle = css(theme.groundD);
    ctx.fillRect(-8, horizon, W + 16, H - horizon + 8);

    // sun / moon, drifting with the far parallax
    const span = W + 240;
    const sunX = ((W * 0.72 - this.bgX * 26) % span + span) % span - 120;
    const sunY = horizon - 66;
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = css(theme.sun);
    ctx.beginPath(); ctx.arc(sunX, sunY, 42, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(sunX, sunY, 24, 0, Math.PI * 2); ctx.fill();

    // two ridge layers
    this.drawRidge(theme.ridgeFar, horizon + 2, 30, this.bgX * 60, 0.013, 0.9);
    this.drawRidge(theme.ridgeNear, horizon + 3, 44, this.bgX * 130, 0.021, 1);

    // haze band hiding the fog cutoff at the horizon line
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = css(theme.fog);
    ctx.fillRect(-8, horizon - 2, W + 16, 7);
    ctx.globalAlpha = 1;
  }

  drawRidge(color, baseY, amp, off, freq, alpha) {
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = css(color);
    ctx.beginPath();
    ctx.moveTo(-8, baseY);
    for (let sx = -8; sx <= W + 8; sx += 8) {
      const t = (sx + off) * freq;
      const h = amp * (0.5 + 0.3 * Math.sin(t) + 0.2 * Math.sin(t * 2.7 + 1.7));
      ctx.lineTo(sx, baseY - Math.max(0, h));
    }
    ctx.lineTo(W + 8, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  updateParticles(dt, s, fx, theme, ratio) {
    const ctx = this.ctx;
    if (fx.offRoad && ratio > 0.04) {
      const dust = css(mix(theme.groundL, [190, 172, 130], 0.5));
      this.spawnDust(HW - 40, H - 16, 2, dust);
      this.spawnDust(HW + 40, H - 16, 2, dust);
    }
    if (s.spin > 0) {
      this.spawnDust(HW, H - 22, 2, 'rgb(150,150,155)');
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 60 * dt;
      ctx.globalAlpha = 1 - p.age / p.life;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  drawPlayer(s, fx, ratio) {
    const ctx = this.ctx;
    const def = fx.brake ? this.sprites.playerBrake : this.sprites.player;
    const c = def.c;
    const scale = 1 / CAM_HEIGHT; // CAM_DEPTH / PLAYER_Z
    const destW = scale * 400 * HW;
    const destH = destW * (c.height / c.width);
    const bounce = (Math.random() - 0.5) * 3 * ratio;
    const cx = HW - this.sway * 5;
    const cy = H - 10 - destH / 2 + bounce;

    let angle = 0;
    if (s.spin > 0) {
      angle = (1 - s.spin / SPIN_TIME) * Math.PI * 4;   // two full spins
    } else {
      angle = fx.steer * 0.055 + this.sway * 0.03;
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.drawImage(c, -destW / 2, -destH / 2, destW, destH);
    ctx.restore();
  }

  drawHUD(s, speed, fx) {
    const ctx = this.ctx;
    const stages = s.track.stages;
    const stage = stages[Math.min(s.stageIdx, stages.length - 1)];
    const mono = 'ui-monospace, Menlo, Consolas, monospace';

    // top bar
    ctx.fillStyle = 'rgba(6,8,10,0.55)';
    ctx.fillRect(0, 0, W, 38);

    // score
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8b94a2';
    ctx.font = `10px ${mono}`;
    ctx.fillText('SCORE', 12, 5);
    ctx.fillStyle = '#e8ecf2';
    ctx.font = `bold 16px ${mono}`;
    ctx.fillText(String(Math.floor(s.score)).padStart(6, '0'), 12, 17);

    // time
    const tLeft = Math.max(0, Math.ceil(s.timeLeft));
    const urgent = s.timeLeft < 10 && s.phase === 'racing';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#8b94a2';
    ctx.font = `10px ${mono}`;
    ctx.fillText('TIME', HW, 4);
    ctx.fillStyle = urgent && Math.floor(this.t * 4) % 2 ? '#ff4d4d' : '#ffd23c';
    ctx.font = `bold 22px ${mono}`;
    ctx.fillText(String(tLeft), HW, 13);

    // stage
    ctx.textAlign = 'right';
    ctx.fillStyle = '#8b94a2';
    ctx.font = `10px ${mono}`;
    ctx.fillText(`STAGE ${Math.min(s.stageIdx + 1, stages.length)}/${stages.length}`, W - 12, 5);
    ctx.fillStyle = '#39d5ff';
    ctx.font = `bold 12px ${mono}`;
    ctx.fillText(stage.name, W - 12, 18);

    // course progress strip with stage ticks
    const total = s.track.finishSeg * SEG_LEN;
    const prog = clamp((s.position + PLAYER_Z) / total, 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(12, 33, W - 24, 2);
    ctx.fillStyle = '#39d5ff';
    ctx.fillRect(12, 33, (W - 24) * prog, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (const st of stages) ctx.fillRect(12 + (W - 24) * (st.fromZ / total), 32, 1, 4);

    // speed block (bottom right)
    const kmh = Math.round((speed / MAX_SPEED) * 312);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#e8ecf2';
    ctx.font = `bold 30px ${mono}`;
    ctx.fillText(String(kmh), W - 46, H - 46);
    ctx.fillStyle = '#8b94a2';
    ctx.font = `10px ${mono}`;
    ctx.fillText('km/h', W - 14, H - 32);
    // gear pips
    for (let g = 0; g < GEARS.length; g++) {
      ctx.fillStyle = g <= s.gear && speed > 1 ? '#ff7a3c' : 'rgba(255,255,255,0.18)';
      ctx.fillRect(W - 14 - (GEARS.length - g) * 10, H - 26, 7, 10);
    }
    ctx.fillStyle = '#8b94a2';
    ctx.font = `10px ${mono}`;
    ctx.fillText(speed > 1 ? `G${s.gear + 1}` : 'N', W - 14, H - 46);

    // flash messages
    for (let i = this.msgs.length - 1; i >= 0; i--) {
      const m = this.msgs[i];
      m.t += this.frameDt;
      if (m.t >= m.dur) { this.msgs.splice(i, 1); continue; }
      const a = m.t < 0.15 ? m.t / 0.15 : m.t > m.dur - 0.5 ? (m.dur - m.t) / 0.5 : 1;
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.fillStyle = m.color;
      ctx.font = `bold 20px ${mono}`;
      ctx.fillText(m.text, HW, 92 + i * 24);
      ctx.globalAlpha = 1;
    }

    // countdown
    if (fx.countdown != null) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const n = Math.ceil(fx.countdown);
      const frac = fx.countdown - Math.floor(fx.countdown);
      ctx.fillStyle = n > 0 ? '#ffd23c' : '#5cff8a';
      ctx.font = `bold ${Math.round(64 + 26 * frac)}px ${mono}`;
      ctx.fillText(n > 0 ? String(n) : 'GO!', HW, H * 0.42);
      ctx.textBaseline = 'top';
    }
  }
}

function poly(ctx, x1, y1, x2, y2, x3, y3, x4, y4) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.lineTo(x4, y4);
  ctx.closePath();
  ctx.fill();
}

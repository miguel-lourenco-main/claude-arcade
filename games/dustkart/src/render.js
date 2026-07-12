// Dustkart — renderer. Classic segment-projection road adapted for a
// WRAPPING circuit: walk segments away from the camera modulo the loop,
// accumulate curve (dx += seg.curve; x += dx), project both edges with
// scale = camDepth/z, paint trapezoids back to front, then item pads,
// slicks, burrs and karts in painter's order. Plus HUD: big position,
// lap counter, lap timer + best, item box, minimap with kart dots.
// Classic script (file://-safe). Load after circuits.js and sim.js.

(function () {
'use strict';
const NS = typeof globalThis !== 'undefined' ? globalThis : window;
const DK = NS.Dustkart = NS.Dustkart || {};
const { SEG_LEN, ROAD_W, DRAW_DIST, LAPS, segAt,
        CAM_HEIGHT, CAM_DEPTH, PLAYER_Z, MAX_SPEED, BOOST_MAX, SPIN_TIME } = DK;

const W = 640;
const H = 400;
const HW = W / 2;
const HH = H / 2;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const mix = (a, b, t) => [
  Math.round(lerp(a[0], b[0], t)),
  Math.round(lerp(a[1], b[1], t)),
  Math.round(lerp(a[2], b[2], t)),
];
const css = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

// One palette per circuit theme (all original).
const THEMES = [
  { // 0 — Sunspur Flats: hot dust-country noon
    skyTop: [116, 150, 190], skyBot: [244, 204, 138], sun: [255, 240, 200],
    ridgeFar: [178, 130, 88], ridgeNear: [150, 112, 70],
    groundL: [188, 152, 96], groundD: [174, 140, 86],
    roadL: [122, 108, 92], roadD: [113, 100, 85],
    rumA: [228, 222, 208], rumB: [188, 84, 44],
    lane: [232, 226, 210], fog: [238, 196, 130],
  },
  { // 1 — Bramble Hollow: mossy woodland light
    skyTop: [70, 128, 130], skyBot: [176, 214, 168], sun: [252, 250, 220],
    ridgeFar: [70, 104, 84], ridgeNear: [40, 78, 54],
    groundL: [56, 100, 56], groundD: [47, 87, 48],
    roadL: [96, 88, 76], roadD: [88, 80, 69],
    rumA: [216, 220, 210], rumB: [170, 62, 46],
    lane: [224, 226, 216], fog: [150, 196, 152],
  },
  { // 2 — Emberdown Ridge: violet dusk over cinder fields
    skyTop: [20, 14, 44], skyBot: [172, 74, 60], sun: [255, 214, 150],
    ridgeFar: [66, 38, 70], ridgeNear: [44, 30, 40],
    groundL: [58, 44, 44], groundD: [50, 38, 38],
    roadL: [82, 76, 88], roadD: [74, 68, 80],
    rumA: [198, 200, 210], rumB: [188, 66, 48],
    lane: [212, 210, 220], fog: [120, 58, 66],
  },
];

const KART_COLORS = ['#e0762f', '#4f8f3a', '#3f7fd2', '#c2b53a', '#8a55c8', '#c8425a'];
const SPARK_COLORS = ['#e8e2d0', '#ffb03c', '#5adaff'];   // charge tier 0/1/2

const FOG_DENSITY = 5;
function fogAmount(n) {
  const t = n / DRAW_DIST;
  return 1 - Math.exp(-(t * t) * FOG_DENSITY * 2.2);
}

class Renderer {
  constructor(cnv, sprites) {
    this.canvas = cnv;
    cnv.width = W; cnv.height = H;
    this.ctx = cnv.getContext('2d');
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
    this.buckets = new Map();   // rel-segment -> [{kind, obj}]
  }

  flash(text, color = '#ffd23c', dur = 1.6) {
    this.msgs.push({ text, color, t: 0, dur });
  }

  kick(mag = 8) { this.shakeKick = Math.max(this.shakeKick, mag); }

  spawnSpark(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * 12, y: y + Math.random() * 4,
        vx: (Math.random() - 0.5) * 130, vy: -30 - Math.random() * 120,
        life: 0.25 + Math.random() * 0.28, age: 0,
        size: 2 + Math.random() * 2, color,
      });
    }
  }

  bucketAdd(rel, kind, obj) {
    let list = this.buckets.get(rel);
    if (!list) { list = []; this.buckets.set(rel, list); }
    list.push({ kind, obj });
  }

  // ---------------------------------------------------------------- render
  render(state, alpha, fx) {
    const ctx = this.ctx;
    const s = state;
    const circuit = s.circuit;
    const segs = circuit.segments;
    const N = circuit.N;
    const L = circuit.length;
    const dt = this.frameDt;
    this.t += dt;

    const player = s.karts[0];
    // interpolated camera behind the player (wrap-aware interpolation)
    let dz = player.z - player.prev.z;
    if (dz < -L / 2) dz += L;
    if (dz > L / 2) dz -= L;
    let camAnchor = player.prev.z + dz * alpha;
    if (camAnchor < 0) camAnchor += L;
    if (camAnchor >= L) camAnchor -= L;
    const px = lerp(player.prev.x, player.x, alpha);
    const speed = lerp(player.prev.speed, player.speed, alpha);
    const ratio = speed / MAX_SPEED;

    let pos = camAnchor - PLAYER_Z;   // camera z
    if (pos < 0) pos += L;
    if (pos >= L) pos -= L;

    const baseIdx = Math.floor(pos / SEG_LEN) % N;
    const baseSeg = segs[baseIdx];
    const fracZ = pos - baseIdx * SEG_LEN;
    const basePct = clamp(fracZ / SEG_LEN, 0, 1);

    const pSeg = segAt(circuit, camAnchor);
    const pPct = clamp((camAnchor - pSeg.i * SEG_LEN) / SEG_LEN, 0, 1);
    const playerY = lerp(pSeg.y1, pSeg.y2, pPct);

    const theme = THEMES[circuit.theme];

    // background scroll + camera sway on curves
    this.bgX += pSeg.curve * ratio * dt * 1.4;
    const swayTarget = pSeg.curve * ratio;
    this.sway += (swayTarget - this.sway) * Math.min(1, dt * 5);
    const slope = (pSeg.y2 - pSeg.y1) / SEG_LEN;
    this.horizonShift += (clamp(-slope * 90, -34, 34) - this.horizonShift) * Math.min(1, dt * 3);

    this.shakeKick = Math.max(0, this.shakeKick - dt * 24);
    let mag = this.shakeKick;
    if (player.offRoad && ratio > 0.05) mag = Math.max(mag, Math.min(4, ratio * 7));
    const shx = (Math.random() - 0.5) * 2 * mag;
    const shy = (Math.random() - 0.5) * 2 * mag;

    ctx.save();
    ctx.translate(shx, shy);

    const horizon = H * 0.42 + this.horizonShift;
    this.drawSky(theme, horizon);

    // ---- road walk ----
    const camX = px * ROAD_W + this.sway * 40;
    const camY = playerY + CAM_HEIGHT;

    const groundL = css(theme.groundL), groundD = css(theme.groundD);
    const roadL = css(theme.roadL), roadD = css(theme.roadD);
    const rumA = css(theme.rumA), rumB = css(theme.rumB);
    const laneC = css(theme.lane), fogC = css(theme.fog);

    let x = 0;
    let dxAcc = -(baseSeg.curve * basePct);
    let maxy = H;

    for (let n = 0; n < DRAW_DIST; n++) {
      const idx = (baseIdx + n) % N;
      const seg = segs[idx];
      const z1 = n * SEG_LEN - fracZ;
      const z2 = (n + 1) * SEG_LEN - fracZ;

      const s1 = z1 > 0 ? CAM_DEPTH / z1 : 0;
      const x1 = HW + s1 * (x - camX) * HW;
      const y1 = HH - s1 * (seg.y1 - camY) * HH;
      const w1 = s1 * ROAD_W * HW;

      const s2 = z2 > 0 ? CAM_DEPTH / z2 : 0;
      const x2 = HW + s2 * (x + dxAcc - camX) * HW;
      const y2 = HH - s2 * (seg.y2 - camY) * HH;
      const w2 = s2 * ROAD_W * HW;

      x += dxAcc;
      dxAcc += seg.curve;

      this.s1A[n] = s1; this.x1A[n] = x1; this.y1A[n] = y1; this.w1A[n] = w1;
      this.s2A[n] = s2; this.x2A[n] = x2; this.y2A[n] = y2; this.w2A[n] = w2;
      this.clipA[n] = maxy;
      const f = fogAmount(n);
      this.fogA[n] = f;

      if (z1 <= CAM_DEPTH || y2 >= maxy || y2 >= y1) continue;

      // grass band
      ctx.fillStyle = seg.stripe ? groundL : groundD;
      ctx.fillRect(0, y2, W, y1 - y2);

      // rumble strips
      const r1 = w1 / 6, r2 = w2 / 6;
      ctx.fillStyle = seg.stripe ? rumA : rumB;
      poly(ctx, x1 - w1 - r1, y1, x1 - w1, y1, x2 - w2, y2, x2 - w2 - r2, y2);
      poly(ctx, x1 + w1 + r1, y1, x1 + w1, y1, x2 + w2, y2, x2 + w2 + r2, y2);

      // road surface (start/finish gets a checker band)
      if (idx < 2) {
        this.checkerBand(ctx, x1, y1, w1, x2, y2, w2, idx);
      } else {
        ctx.fillStyle = seg.stripe ? roadL : roadD;
        poly(ctx, x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2);
      }

      // centre lane dashes on the light bands
      if (seg.stripe && idx >= 2) {
        const l1 = w1 / 32, l2 = w2 / 32;
        ctx.fillStyle = laneC;
        poly(ctx, x1 - l1, y1, x1 + l1, y1, x2 + l2, y2, x2 - l2, y2);
      }

      // item pads: glowing diamonds across the road
      if (seg.padOffs) this.drawPads(ctx, s, seg, x1, y1, w1, x2, y2, w2);

      if (f > 0.02) {
        ctx.globalAlpha = f;
        ctx.fillStyle = fogC;
        ctx.fillRect(0, y2, W, y1 - y2);
        ctx.globalAlpha = 1;
      }

      maxy = y2;
    }

    // ---- bucket world objects by relative segment ----
    this.buckets.clear();
    const relOf = (z) => {
      let r = Math.floor(z / SEG_LEN) - baseIdx;
      if (r < 0) r += N;
      return r;
    };
    for (let ki = 1; ki < s.karts.length; ki++) {
      const k = s.karts[ki];
      const kz = this.lerpWrap(k.prev.z, k.z, alpha, L);
      const rel = relOf(kz);
      if (rel >= 0 && rel < DRAW_DIST) this.bucketAdd(rel, 'kart', { k, kz });
    }
    for (const sl of s.slicks) {
      const rel = relOf(sl.z);
      if (rel >= 0 && rel < DRAW_DIST) this.bucketAdd(rel, 'slick', sl);
    }
    for (const b of s.burrs) {
      const rel = relOf(b.z);
      if (rel >= 0 && rel < DRAW_DIST) this.bucketAdd(rel, 'burr', b);
    }

    // ---- sprites & objects, far to near ----
    for (let n = DRAW_DIST - 1; n >= 0; n--) {
      const idx = (baseIdx + n) % N;
      const seg = segs[idx];
      const s1 = this.s1A[n];
      if (s1 <= 0) continue;
      const clipY = this.clipA[n];
      const vis = 1 - this.fogA[n] * 0.96;
      if (vis <= 0.04) continue;

      for (const sp of seg.sprites) {
        const def = this.sprites[sp.kind];
        const sx = this.x1A[n] + s1 * sp.off * ROAD_W * HW;
        this.drawSprite(def, sx, this.y1A[n], s1, clipY, vis);
      }

      const list = this.buckets.get(n);
      if (list) {
        for (const it of list) {
          if (it.kind === 'slick') {
            const pct = (it.obj.z % SEG_LEN) / SEG_LEN;
            const sc = lerp(s1, this.s2A[n], pct);
            const cx = lerp(this.x1A[n], this.x2A[n], pct) + sc * it.obj.x * ROAD_W * HW;
            const cy = lerp(this.y1A[n], this.y2A[n], pct);
            this.drawSprite(this.sprites.slick, cx, cy, sc, clipY, vis);
          } else if (it.kind === 'burr') {
            const pct = (it.obj.z % SEG_LEN) / SEG_LEN;
            const sc = lerp(s1, this.s2A[n], pct);
            const cx = lerp(this.x1A[n], this.x2A[n], pct) + sc * it.obj.x * ROAD_W * HW;
            const cy = lerp(this.y1A[n], this.y2A[n], pct) - sc * 120 * HH * 0.0016;
            this.drawSprite(this.sprites.burr, cx, cy, sc, clipY, vis);
          } else {
            this.drawKart(it.obj.k, it.obj.kz, n, alpha, clipY, vis);
          }
        }
      }
    }

    // ---- particles + player kart ----
    this.updateParticles(dt);
    this.drawPlayer(s, player, fx, ratio, alpha);

    ctx.restore();

    // ---- HUD (not shaken) ----
    this.drawHUD(s, player, speed, fx);
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

    // sun / dusk-glow disc drifting with the far parallax
    const span = W + 240;
    const sunX = ((W * 0.7 - this.bgX * 26) % span + span) % span - 120;
    const sunY = horizon - 62;
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = css(theme.sun);
    ctx.beginPath(); ctx.arc(sunX, sunY, 42, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(sunX, sunY, 22, 0, Math.PI * 2); ctx.fill();

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

  lerpWrap(a, b, t, L) {
    let d = b - a;
    if (d < -L / 2) d += L;
    if (d > L / 2) d -= L;
    let v = a + d * t;
    if (v < 0) v += L;
    if (v >= L) v -= L;
    return v;
  }

  checkerBand(ctx, x1, y1, w1, x2, y2, w2, idx) {
    const cells = 8;
    for (let cIdx = 0; cIdx < cells; cIdx++) {
      const a = cIdx / cells, b = (cIdx + 1) / cells;
      ctx.fillStyle = (cIdx + idx) % 2 ? '#20242a' : '#d8dce2';
      poly(ctx,
        x1 - w1 + 2 * w1 * a, y1, x1 - w1 + 2 * w1 * b, y1,
        x2 - w2 + 2 * w2 * b, y2, x2 - w2 + 2 * w2 * a, y2);
    }
  }

  drawPads(ctx, state, seg, x1, y1, w1, x2, y2, w2) {
    // find live cooldowns for this segment
    for (const off of seg.padOffs) {
      let active = true;
      for (const pad of state.pads) {
        if (pad.seg === seg.i && pad.x === off) { active = pad.cd <= 0; break; }
      }
      const cx1 = x1 + (off * w1);
      const cx2 = x2 + (off * w2);
      const pw1 = w1 * 0.13, pw2 = w2 * 0.13;
      const pulse = 0.55 + 0.45 * Math.sin(this.t * 6);
      ctx.globalAlpha = active ? 0.75 + 0.25 * pulse : 0.22;
      ctx.fillStyle = active ? '#3adcc0' : '#5a6068';
      const my = (y1 + y2) / 2;
      const mx1 = (cx1 + cx2) / 2;
      ctx.beginPath();
      ctx.moveTo(mx1, y2);
      ctx.lineTo(cx1 + pw1, my);
      ctx.lineTo(mx1, y1);
      ctx.lineTo(cx1 - pw1, my);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  drawSprite(def, xCenter, yBase, scale, clipY, alpha) {
    if (!def) return;
    const c = def.c;
    const destW = scale * def.worldW * HW;
    if (destW < 1.2) return;
    const destH = destW * (c.height / c.width);
    const destX = xCenter - destW / 2;
    const destY = yBase - destH;
    if (destX > W + 8 || destX + destW < -8 || destY > H + 8) return;
    const visible = clipY - destY;
    if (visible <= 0) return;
    const drawH = Math.min(destH, visible);
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.drawImage(c, 0, 0, c.width, c.height * (drawH / destH), destX, destY, destW, drawH);
    ctx.globalAlpha = 1;
  }

  drawKart(k, kz, n, alpha, clipY, vis) {
    const pct = (kz % SEG_LEN) / SEG_LEN;
    const sc = lerp(this.s1A[n], this.s2A[n], pct);
    if (sc <= 0) return;
    const kx = lerp(k.prev.x, k.x, alpha);
    const cx = lerp(this.x1A[n], this.x2A[n], pct) + sc * kx * ROAD_W * HW;
    const cy = lerp(this.y1A[n], this.y2A[n], pct);
    const def = this.sprites.karts[k.i][k.pose] || this.sprites.karts[k.i][0];
    const ctx = this.ctx;

    if (k.spinT > 0) {
      // rotate the whole billboard while spinning
      const destW = sc * def.worldW * HW;
      if (destW < 1.5) return;
      const destH = destW * (def.c.height / def.c.width);
      const ang = (1 - k.spinT / SPIN_TIME) * Math.PI * 4;
      ctx.save();
      ctx.globalAlpha = vis;
      ctx.translate(cx, cy - destH / 2);
      ctx.rotate(ang);
      ctx.drawImage(def.c, -destW / 2, -destH / 2, destW, destH);
      ctx.restore();
      ctx.globalAlpha = 1;
    } else {
      this.drawSprite(def, cx, cy, sc, clipY, vis);
    }
    if (k.shield) this.drawShieldRing(cx, cy, sc * def.worldW * HW);
    if (k.boostT > 0) {
      const destW = sc * def.worldW * HW;
      this.spawnSpark(cx, cy - 2, 1, '#7fdaff');
      void destW;
    }
  }

  drawShieldRing(cx, cyBase, w) {
    if (w < 3) return;
    const ctx = this.ctx;
    const h = w * 0.7;
    ctx.strokeStyle = 'rgba(143,206,106,0.85)';
    ctx.lineWidth = Math.max(1, w * 0.04);
    ctx.beginPath();
    ctx.ellipse(cx, cyBase - h * 0.45, w * 0.62, h * 0.62, 0, 0, Math.PI * 2);
    ctx.stroke();
    // orbiting mote
    const a = this.t * 5;
    ctx.fillStyle = '#c8f0a8';
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * w * 0.62, cyBase - h * 0.45 + Math.sin(a) * h * 0.62, Math.max(1.5, w * 0.05), 0, Math.PI * 2);
    ctx.fill();
  }

  updateParticles(dt) {
    const ctx = this.ctx;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 90 * dt;
      ctx.globalAlpha = 1 - p.age / p.life;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  drawPlayer(s, k, fx, ratio, alpha) {
    const ctx = this.ctx;
    const def = this.sprites.karts[0][k.pose] || this.sprites.karts[0][0];
    const c = def.c;
    const scale = 1 / CAM_HEIGHT;
    const destW = scale * 430 * HW;
    const destH = destW * (c.height / c.width);
    const bounce = (Math.random() - 0.5) * 3 * ratio;
    const cx = HW - this.sway * 5;
    const cy = H - 12 - destH / 2 + bounce;

    // drift sparks at the rear wheels, colored by charge tier
    if (k.drift.on && ratio > 0.2) {
      const col = SPARK_COLORS[k.drift.tier];
      this.spawnSpark(cx - destW * 0.34, cy + destH * 0.32, 2, col);
      this.spawnSpark(cx + destW * 0.34, cy + destH * 0.32, 2, col);
    }
    if (k.offRoad && ratio > 0.06) {
      this.spawnSpark(cx - destW * 0.3, cy + destH * 0.34, 1, 'rgba(190,168,120,0.9)');
      this.spawnSpark(cx + destW * 0.3, cy + destH * 0.34, 1, 'rgba(190,168,120,0.9)');
    }

    // boost flame
    const boosting = k.boostT > 0;
    if (boosting) {
      const fl = 10 + Math.random() * 14;
      ctx.fillStyle = 'rgba(122,214,255,0.85)';
      ctx.beginPath();
      ctx.moveTo(cx - destW * 0.16, cy + destH * 0.42);
      ctx.lineTo(cx, cy + destH * 0.42 + fl);
      ctx.lineTo(cx + destW * 0.16, cy + destH * 0.42);
      ctx.closePath();
      ctx.fill();
    }

    let angle = 0;
    if (k.spinT > 0) angle = (1 - k.spinT / SPIN_TIME) * Math.PI * 4;
    else if (k.drift.on) angle = k.drift.dir * 0.3 + this.sway * 0.03;
    else angle = fx.steer * 0.055 + this.sway * 0.03;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.drawImage(c, -destW / 2, -destH / 2, destW, destH);
    ctx.restore();

    if (k.shield) this.drawShieldRing(cx, cy + destH / 2, destW);
    void alpha; void s;
  }

  // -------------------------------------------------------------------- HUD
  drawHUD(s, player, speed, fx) {
    const ctx = this.ctx;
    const mono = 'ui-monospace, Menlo, Consolas, monospace';
    const fmt = (t) => {
      if (!t || t <= 0) return '--:--.-';
      const m = Math.floor(t / 60);
      const sec = t - m * 60;
      return `${m}:${sec.toFixed(1).padStart(4, '0')}`;
    };

    // top bar
    ctx.fillStyle = 'rgba(6,8,10,0.5)';
    ctx.fillRect(0, 0, W, 40);

    // lap
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8b94a2';
    ctx.font = `10px ${mono}`;
    ctx.fillText('LAP', 12, 5);
    ctx.fillStyle = '#e8ecf2';
    ctx.font = `bold 18px ${mono}`;
    const lapShown = Math.min(player.laps + 1, LAPS);
    ctx.fillText(`${lapShown}/${LAPS}`, 12, 16);

    // lap timer + best
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8b94a2';
    ctx.font = `10px ${mono}`;
    ctx.fillText('TIME', 92, 5);
    ctx.fillStyle = '#ffd23c';
    ctx.font = `bold 15px ${mono}`;
    const cur = s.phase === 'countdown' ? 0 : (player.finished ? player.lastLap : s.time - player.lapStartT);
    ctx.fillText(fmt(cur), 92, 17);
    ctx.fillStyle = '#8b94a2';
    ctx.font = `10px ${mono}`;
    ctx.fillText('BEST', 182, 5);
    ctx.fillStyle = '#5cff8a';
    ctx.font = `bold 15px ${mono}`;
    ctx.fillText(fmt(player.bestLap || fx.circuitBest || 0), 182, 17);

    // item box (top centre-right)
    const ibx = W - 176, iby = 4;
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(ibx, iby, 34, 34);
    ctx.strokeStyle = player.item ? '#ffb03c' : '#2a2f38';
    ctx.lineWidth = 2;
    ctx.strokeRect(ibx + 1, iby + 1, 32, 32);
    if (player.item) {
      ctx.drawImage(this.sprites.icons[player.item], ibx + 4, iby + 4, 26, 26);
    }
    ctx.fillStyle = '#8b94a2';
    ctx.font = `9px ${mono}`;
    ctx.textAlign = 'center';
    ctx.fillText('ITEM', ibx + 17, iby + 36 > 40 ? 30 : iby + 36);

    // minimap (top-right)
    this.drawMinimap(s, W - 106, 6, 96);

    // big position (bottom-left)
    const rank = player.rank;
    const suffix = ['st', 'nd', 'rd', 'th', 'th', 'th'][rank - 1];
    ctx.textAlign = 'left';
    ctx.fillStyle = rank === 1 ? '#ffd23c' : rank <= 3 ? '#e8ecf2' : '#8b94a2';
    ctx.font = `bold 46px ${mono}`;
    ctx.fillText(String(rank), 14, H - 62);
    ctx.font = `bold 18px ${mono}`;
    ctx.fillText(suffix, 44, H - 54);
    ctx.fillStyle = '#8b94a2';
    ctx.font = `10px ${mono}`;
    ctx.fillText('of 6', 14, H - 16);

    // speed (bottom-right)
    const kmh = Math.round((speed / MAX_SPEED) * 128);
    ctx.textAlign = 'right';
    ctx.fillStyle = player.boostT > 0 ? '#5adaff' : '#e8ecf2';
    ctx.font = `bold 26px ${mono}`;
    ctx.fillText(String(kmh), W - 44, H - 40);
    ctx.fillStyle = '#8b94a2';
    ctx.font = `10px ${mono}`;
    ctx.fillText('km/h', W - 12, H - 26);

    // drift charge pips
    if (player.drift.on) {
      const col = SPARK_COLORS[player.drift.tier];
      ctx.fillStyle = col;
      ctx.textAlign = 'center';
      ctx.font = `bold 12px ${mono}`;
      ctx.fillText(player.drift.tier === 2 ? 'DRIFT ••' : player.drift.tier === 1 ? 'DRIFT •' : 'DRIFT', HW, H - 34);
    }

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
      ctx.fillText(m.text, HW, 96 + i * 24);
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
      ctx.fillText(n > 0 ? String(n) : 'GO!', HW, H * 0.4);
      ctx.textBaseline = 'top';
    }
  }

  drawMinimap(s, mx, my, size) {
    const ctx = this.ctx;
    const pts = s.circuit.map;
    const N = s.circuit.N;
    ctx.fillStyle = 'rgba(6,8,10,0.45)';
    ctx.fillRect(mx - 4, my - 2, size + 8, size + 4);
    ctx.strokeStyle = 'rgba(232,236,242,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= N; i += 4) {
      const p = pts[i % N];
      const sx = mx + p.x * size;
      const sy = my + p.y * size;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.stroke();
    // start/finish notch
    ctx.fillStyle = '#ffd23c';
    ctx.fillRect(mx + pts[0].x * size - 2, my + pts[0].y * size - 2, 4, 4);
    // kart dots (player last, on top)
    for (let i = s.karts.length - 1; i >= 0; i--) {
      const k = s.karts[i];
      const idx = Math.floor(k.z / DK.SEG_LEN) % N;
      const p = pts[idx];
      ctx.fillStyle = KART_COLORS[k.i];
      ctx.beginPath();
      ctx.arc(mx + p.x * size, my + p.y * size, k.isPlayer ? 3.4 : 2.4, 0, Math.PI * 2);
      ctx.fill();
      if (k.isPlayer) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
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

Object.assign(DK, { Renderer, W, H, THEMES, KART_COLORS, SPARK_COLORS });
})();

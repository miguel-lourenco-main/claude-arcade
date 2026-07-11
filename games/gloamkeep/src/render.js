// Gloamkeep — software raycast renderer.
// Renders into a 480-wide framebuffer (Uint32, ABGR) and upscales with crisp
// pixels. The per-column wall loop and sprite loops are allocation-free.

// Classic script on the `Gloamkeep` namespace; load after maps.js + game.js.

(function () {
'use strict';
const G = globalThis.Gloamkeep = globalThis.Gloamkeep || {};
const { TILE, castRay, ENEMY_DEFS } = G;

const IW = 480;               // internal resolution
const IH = 300;
const FOV = (66 * Math.PI) / 180;
const TAN_HALF = Math.tan(FOV / 2);
const PROJ = (IW / 2) / TAN_HALF;    // projection plane distance in pixels

function createRenderer(displayCanvas, minimapCanvas, assets) {
  const inner = document.createElement('canvas');
  inner.width = IW; inner.height = IH;
  const ictx = inner.getContext('2d');
  const img = ictx.createImageData(IW, IH);
  const fb = new Uint32Array(img.data.buffer);
  const zbuf = new Float32Array(IW);
  const dctx = displayCanvas.getContext('2d');
  const mctx = minimapCanvas.getContext('2d');

  // per-column ray angle offsets + fisheye correction factors, computed once
  const colAng = new Float32Array(IW);
  const colCos = new Float32Array(IW);
  for (let x = 0; x < IW; x++) {
    const cam = ((x + 0.5) / IW) * 2 - 1;          // -1 .. 1 across the screen
    colAng[x] = Math.atan(cam * TAN_HALF);          // rayAngle - viewAngle
    colCos[x] = Math.cos(colAng[x]);                // perp = dist * cos(diff)
  }

  const rayOut = { hit: false, dist: 0, side: 0, tex: TILE.STONE, texU: 0 };
  const spriteList = [];

  // torch flicker: smoothed random walk around 1.0
  let flicker = 1, flickerTarget = 1, flickerTimer = 0;

  function updateFlicker(dt) {
    flickerTimer -= dt;
    if (flickerTimer <= 0) {
      flickerTimer = 0.05 + Math.random() * 0.09;
      flickerTarget = 0.88 + Math.random() * 0.18;
    }
    flicker += (flickerTarget - flicker) * Math.min(1, dt * 18);
  }

  function drawFloorCeiling(light) {
    const half = IH >> 1;
    for (let y = 0; y < half; y++) {
      // ceiling: brightest at the top edge (nearest), darkest at the horizon
      const t = 1 - y / half;                       // 1 at top, 0 at horizon
      const s = (0.16 + 0.72 * t * t) * light;
      const r = (34 * s) | 0, g = (37 * s) | 0, b = (48 * s) | 0;
      fb.fill(0xff000000 | (b << 16) | (g << 8) | r, y * IW, (y + 1) * IW);
    }
    for (let y = half; y < IH; y++) {
      const t = (y - half) / half;                  // 0 at horizon, 1 at bottom
      const s = (0.16 + 0.92 * t * t) * light;
      const r = (58 * s) | 0, g = (50 * s) | 0, b = (41 * s) | 0;
      fb.fill(0xff000000 | (b << 16) | (g << 8) | r, y * IW, (y + 1) * IW);
    }
  }

  function drawWalls(state, light) {
    const p = state.player;
    const walls = assets.walls;
    for (let x = 0; x < IW; x++) {
      const a = p.angle + colAng[x];
      castRay(state, p.x, p.y, Math.cos(a), Math.sin(a), rayOut);
      const perp = Math.max(0.02, rayOut.dist * colCos[x]); // fisheye fix
      zbuf[x] = perp;
      if (!rayOut.hit) continue;
      const tex = walls[rayOut.tex] || walls[TILE.STONE];
      const data = tex.data;
      const texX = (rayOut.texU * 64) | 0;
      const lineH = (PROJ / perp) | 0;
      let y0 = (IH - lineH) >> 1;
      let y1 = y0 + lineH;
      // distance darkening + N/S vs E/W face shading (the classic depth cue)
      let f = (1.5 / (1 + perp * perp * 0.045)) * light;
      if (rayOut.side === 1) f *= 0.72;
      if (rayOut.tex === TILE.EXIT) f = Math.min(1.15, f + 0.35); // sigil glows
      if (f > 1.25) f = 1.25;
      const fi = (f * 256) | 0;
      const step = 64 / lineH;
      let ty = y0 < 0 ? -y0 * step : 0;
      if (y0 < 0) y0 = 0;
      if (y1 > IH) y1 = IH;
      let idx = y0 * IW + x;
      for (let y = y0; y < y1; y++) {
        const c = data[((ty | 0) << 6) + texX];
        let r = ((c & 255) * fi) >> 8;
        let g = (((c >> 8) & 255) * fi) >> 8;
        let b = (((c >> 16) & 255) * fi) >> 8;
        if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;
        fb[idx] = 0xff000000 | (b << 16) | (g << 8) | r;
        idx += IW;
        ty += step;
      }
    }
  }

  // sprite scratch entries are reused between frames
  function getSlot(i) {
    if (!spriteList[i]) spriteList[i] = { x: 0, y: 0, tex: null, scale: 1, anchor: 0, flash: 0, glow: 0, d2: 0 };
    return spriteList[i];
  }

  function drawSprites(state, light) {
    const p = state.player;
    let n = 0;

    for (const e of state.enemies) {
      const def = ENEMY_DEFS[e.type];
      const frames = assets.enemies[e.type];
      let tex;
      if (e.state === 'dead') tex = frames[3];
      else if (e.state === 'attack') tex = frames[2];
      else tex = frames[(e.animTime * 2) & 1 ? 1 : 0];
      const s = getSlot(n++);
      s.x = e.x; s.y = e.y; s.tex = tex;
      s.scale = def.scale; s.anchor = 0;
      s.flash = e.hitFlash > 0 ? 1 : 0;
      s.glow = 0;
      s.d2 = (e.x - p.x) * (e.x - p.x) + (e.y - p.y) * (e.y - p.y);
    }
    for (const it of state.items) {
      if (it.taken) continue;
      const s = getSlot(n++);
      s.x = it.x; s.y = it.y; s.tex = assets.items[it.kind];
      s.scale = 0.55; s.anchor = 0; s.flash = 0;
      s.glow = it.kind.startsWith('key') || it.kind === 'shard' ? 1 : 0;
      s.d2 = (it.x - p.x) * (it.x - p.x) + (it.y - p.y) * (it.y - p.y);
    }
    const torchFrame = ((state.time * 9) | 0) % 3;
    for (const t of state.torches) {
      const s = getSlot(n++);
      s.x = t.x; s.y = t.y; s.tex = assets.torch[torchFrame];
      s.scale = 0.7; s.anchor = 1; s.flash = 0; s.glow = 1;
      s.d2 = (t.x - p.x) * (t.x - p.x) + (t.y - p.y) * (t.y - p.y);
    }
    for (const b of state.bolts) {
      const s = getSlot(n++);
      s.x = b.x; s.y = b.y; s.tex = assets.bolt;
      s.scale = 0.3; s.anchor = 2; s.flash = 0; s.glow = 1;
      s.d2 = (b.x - p.x) * (b.x - p.x) + (b.y - p.y) * (b.y - p.y);
    }

    spriteList.length = n;
    spriteList.sort((a, b) => b.d2 - a.d2); // far to near

    const dirX = Math.cos(p.angle), dirY = Math.sin(p.angle);
    const planeX = -dirY * TAN_HALF, planeY = dirX * TAN_HALF;
    const invDet = 1 / (planeX * dirY - dirX * planeY);

    for (let i = 0; i < n; i++) {
      const s = spriteList[i];
      const dx = s.x - p.x, dy = s.y - p.y;
      const trX = invDet * (dirY * dx - dirX * dy);
      const trY = invDet * (-planeY * dx + planeX * dy); // depth
      if (trY < 0.08) continue;
      const screenX = (IW / 2) * (1 + trX / trY);
      const hFull = PROJ / trY;                    // full wall height here
      const size = hFull * s.scale;
      if (size < 1) continue;
      const wallBottom = (IH + hFull) / 2;
      let top;
      if (s.anchor === 0) top = wallBottom - size;                 // on the floor
      else if (s.anchor === 1) top = (IH - hFull) / 2 + hFull * 0.12; // torch, high on the wall
      else top = (IH - size) / 2;                                   // centered (bolt)
      const data = s.tex.data;

      let f = (1.5 / (1 + trY * trY * 0.045)) * light;
      if (s.glow) f = Math.max(f, 0.9);
      if (f > 1.2) f = 1.2;
      const fi = (f * 256) | 0;
      const flash = s.flash;

      let x0 = (screenX - size / 2) | 0;
      let x1 = (screenX + size / 2) | 0;
      const stepX = 64 / size;
      let tx = x0 < 0 ? -x0 * stepX : 0;
      if (x0 < 0) x0 = 0;
      if (x1 > IW) x1 = IW;
      const stepY = 64 / size;
      let y0 = top | 0;
      let y1 = (top + size) | 0;
      const tyStart = y0 < 0 ? -y0 * stepY : 0;
      if (y0 < 0) y0 = 0;
      if (y1 > IH) y1 = IH;

      for (let x = x0; x < x1; x++, tx += stepX) {
        if (trY >= zbuf[x]) continue;              // clipped by a nearer wall
        const texCol = (tx | 0) << 0;
        let ty = tyStart;
        let idx = y0 * IW + x;
        for (let y = y0; y < y1; y++, idx += IW, ty += stepY) {
          const c = data[((ty | 0) << 6) + texCol];
          const alpha = c >>> 24;
          if (alpha < 24) continue;
          let r = ((c & 255) * fi) >> 8;
          let g = (((c >> 8) & 255) * fi) >> 8;
          let b = (((c >> 16) & 255) * fi) >> 8;
          if (flash) {
            r = r + ((255 - r) >> 1);
            g = g + ((255 - g) >> 1);
            b = b + ((255 - b) >> 1);
          }
          if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;
          if (alpha > 230) {
            fb[idx] = 0xff000000 | (b << 16) | (g << 8) | r;
          } else {
            // soft edge blend
            const dst = fb[idx];
            const ia = 256 - alpha;
            const rr = (r * alpha + (dst & 255) * ia) >> 8;
            const gg = (g * alpha + ((dst >> 8) & 255) * ia) >> 8;
            const bb = (b * alpha + ((dst >> 16) & 255) * ia) >> 8;
            fb[idx] = 0xff000000 | (bb << 16) | (gg << 8) | rr;
          }
        }
      }
    }
  }

  function drawWeapon(state, fx) {
    const p = state.player;
    const flash = p.muzzle > 0;
    const wc = flash ? assets.weaponFlash : assets.weapon;
    const bobA = p.moving;
    const bobX = Math.sin(p.bobPhase) * 9 * bobA;
    const bobY = Math.abs(Math.cos(p.bobPhase)) * 7 * bobA;
    const recoil = flash ? 8 : 0;
    const scale = 1.55;
    const wx = (IW - wc.width * scale) / 2 + bobX + 58;
    const wy = IH - wc.height * scale + 30 + bobY + recoil;
    ictx.imageSmoothingEnabled = false;
    ictx.drawImage(wc, wx, wy, wc.width * scale, wc.height * scale);
  }

  function drawOverlays(state, fx) {
    // muzzle light
    if (state.player.muzzle > 0) {
      ictx.fillStyle = 'rgba(255,180,80,0.08)';
      ictx.fillRect(0, 0, IW, IH);
    }
    // damage flash with directional hint
    if (fx.damage > 0.01) {
      const a = Math.min(0.55, fx.damage * 0.55);
      if (fx.damageDir === 0) {
        const g = ictx.createRadialGradient(IW / 2, IH / 2, IH * 0.3, IW / 2, IH / 2, IH * 0.75);
        g.addColorStop(0, 'rgba(200,20,20,0)');
        g.addColorStop(1, `rgba(200,20,20,${a})`);
        ictx.fillStyle = g;
        ictx.fillRect(0, 0, IW, IH);
      } else {
        const fromLeft = fx.damageDir < 0;
        const g = ictx.createLinearGradient(fromLeft ? 0 : IW, 0, fromLeft ? IW * 0.6 : IW * 0.4, 0);
        g.addColorStop(0, `rgba(210,25,25,${a})`);
        g.addColorStop(1, 'rgba(210,25,25,0)');
        ictx.fillStyle = g;
        ictx.fillRect(0, 0, IW, IH);
      }
    }
    // low-health heartbeat vignette
    if (state.player.hp <= 25 && state.player.alive) {
      const pulse = 0.10 + 0.06 * Math.sin(state.time * 6);
      const g = ictx.createRadialGradient(IW / 2, IH / 2, IH * 0.35, IW / 2, IH / 2, IH * 0.8);
      g.addColorStop(0, 'rgba(150,10,10,0)');
      g.addColorStop(1, `rgba(150,10,10,${pulse})`);
      ictx.fillStyle = g;
      ictx.fillRect(0, 0, IW, IH);
    }
    // crosshair
    ictx.fillStyle = 'rgba(230,235,240,0.8)';
    ictx.fillRect(IW / 2 - 1, IH / 2 - 5, 2, 3);
    ictx.fillRect(IW / 2 - 1, IH / 2 + 2, 2, 3);
    ictx.fillRect(IW / 2 - 5, IH / 2 - 1, 3, 2);
    ictx.fillRect(IW / 2 + 2, IH / 2 - 1, 3, 2);
  }

  function drawMinimap(state) {
    const m = state.map;
    const cell = 5;
    const mw = m.w * cell, mh = m.h * cell;
    if (minimapCanvas.width !== mw) minimapCanvas.width = mw;
    if (minimapCanvas.height !== mh) minimapCanvas.height = mh;
    mctx.clearRect(0, 0, mw, mh);
    mctx.fillStyle = 'rgba(10,12,16,0.82)';
    mctx.fillRect(0, 0, mw, mh);
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        const t = m.grid[y * m.w + x];
        if (t === TILE.EMPTY) continue;
        let c = '#3c414c';
        if (t === TILE.MOSS) c = '#39493c';
        else if (t === TILE.BANNER) c = '#4a3a5c';
        else if (t === TILE.DOOR) c = '#8a6a42';
        else if (t === TILE.DOOR_R) c = '#c04848';
        else if (t === TILE.DOOR_G) c = '#48a868';
        else if (t === TILE.DOOR_Y) c = '#c0a04a';
        else if (t === TILE.EXIT) c = '#5fd8c8';
        mctx.fillStyle = c;
        mctx.fillRect(x * cell, y * cell, cell - 0.5, cell - 0.5);
      }
    }
    // alive, alerted enemies show as faint motes
    mctx.fillStyle = 'rgba(224,90,90,0.9)';
    for (const e of state.enemies) {
      if (e.state === 'dead' || e.state === 'idle' || e.state === 'patrol') continue;
      mctx.fillRect(e.x * cell - 1.5, e.y * cell - 1.5, 3, 3);
    }
    // player arrow
    const p = state.player;
    mctx.save();
    mctx.translate(p.x * cell, p.y * cell);
    mctx.rotate(p.angle);
    mctx.fillStyle = '#e8983a';
    mctx.beginPath();
    mctx.moveTo(4.5, 0); mctx.lineTo(-3, -3); mctx.lineTo(-1.5, 0); mctx.lineTo(-3, 3);
    mctx.closePath();
    mctx.fill();
    mctx.restore();
  }

  function render(state, fx, dt) {
    updateFlicker(dt);
    let light = flicker;
    if (state.player.muzzle > 0) light = Math.min(1.15, light + 0.22);

    drawFloorCeiling(light);
    drawWalls(state, light);
    drawSprites(state, light);
    ictx.putImageData(img, 0, 0);
    drawWeapon(state, fx);
    drawOverlays(state, fx);

    // upscale, letterboxed, crisp
    const dw = displayCanvas.width, dh = displayCanvas.height;
    const scale = Math.min(dw / IW, dh / IH);
    const ow = Math.floor(IW * scale), oh = Math.floor(IH * scale);
    const ox = (dw - ow) >> 1, oy = (dh - oh) >> 1;
    dctx.imageSmoothingEnabled = false;
    dctx.fillStyle = '#07080a';
    dctx.fillRect(0, 0, dw, dh);
    dctx.drawImage(inner, 0, 0, IW, IH, ox, oy, ow, oh);

    drawMinimap(state);
  }

  return { render };
}

Object.assign(G, { IW, IH, createRenderer });
})();

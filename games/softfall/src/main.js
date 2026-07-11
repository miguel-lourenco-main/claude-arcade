"use strict";
/* Softfall — a thrust-and-gravity landing game.
   Fixed-timestep simulation (120 Hz accumulator), interpolated rendering,
   midpoint-displacement terrain with multiplier pads, Web Audio synth. */
(() => {

  // ---------- constants ----------
  const W = 1200, H = 750;            // logical world size
  const DT = 1 / 120;                 // simulation tick
  const GRAVITY = 24;                 // u/s^2, downward
  const THRUST = 62;                  // u/s^2 along the nose
  const ROT_SPEED = 2.35;             // rad/s, constant angular speed
  const MAX_FUEL = 100;
  const BURN_RATE = 9;                // fuel/s while thrusting
  const SAFE_VX = 14;                 // |horizontal| limit
  const SAFE_VY = 26;                 // downward limit
  const SAFE_ANG = 8 * Math.PI / 180; // ~8 degrees of upright
  const FOOT_X = 12, FOOT_Y = 12;     // leg feet in ship-local coords (y down)
  const LS = (k) => "arcade.softfall." + k;

  // ship outline points used for terrain contact (local coords, y down)
  const CONTACT_FEET = [[-FOOT_X, FOOT_Y], [FOOT_X, FOOT_Y]];
  const CONTACT_HULL = [[0, -13], [-8, 5], [8, 5]];

  // ---------- helpers ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const wrapX = (x) => ((x % W) + W) % W;
  const normAng = (a) => {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  };

  // ---------- canvas ----------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  let view = { scale: 1, ox: 0, oy: 0 };

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(innerWidth * dpr);
    canvas.height = Math.floor(innerHeight * dpr);
    const s = Math.min(canvas.width / W, canvas.height / H);
    view = {
      scale: s,
      ox: (canvas.width - W * s) / 2,
      oy: (canvas.height - H * s) / 2,
    };
  }
  addEventListener("resize", resize);
  resize();

  // ---------- audio (all synthesized) ----------
  const audio = {
    ctx: null, master: null, engineGain: null, engineFilter: null,
    enabled: localStorage.getItem(LS("audio")) !== "0",
    engineOn: false,

    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 1 : 0;
      this.master.connect(this.ctx.destination);

      // engine rumble: looping white noise -> lowpass -> gain(0)
      const len = this.ctx.sampleRate * 1.5;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = "lowpass";
      this.engineFilter.frequency.value = 190;
      this.engineFilter.Q.value = 1.1;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      src.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
      src.start();
    },

    resume() {
      if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    },

    setEngine(on) {
      if (!this.ctx || on === this.engineOn) return;
      this.engineOn = on;
      const t = this.ctx.currentTime;
      this.engineGain.gain.cancelScheduledValues(t);
      this.engineGain.gain.setTargetAtTime(on ? 0.5 : 0, t, on ? 0.03 : 0.08);
      this.engineFilter.frequency.cancelScheduledValues(t);
      this.engineFilter.frequency.setTargetAtTime(on ? 260 : 150, t, 0.1);
    },

    blip(freq, dur, when = 0, vol = 0.22, type = "sine") {
      if (!this.ctx) return;
      const t = this.ctx.currentTime + when;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + dur + 0.05);
    },

    land() {
      this.blip(620, 0.16, 0, 0.2, "triangle");
      this.blip(930, 0.24, 0.09, 0.2, "triangle");
      this.blip(1240, 0.3, 0.18, 0.14, "sine");
    },

    crash() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const dur = 0.9;
      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const f = this.ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(1600, t);
      f.frequency.exponentialRampToValueAtTime(70, t + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.65, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(f).connect(g).connect(this.master);
      src.start(t);
      this.blip(90, 0.5, 0, 0.3, "sawtooth");
    },

    toggle() {
      this.enabled = !this.enabled;
      localStorage.setItem(LS("audio"), this.enabled ? "1" : "0");
      if (this.master) this.master.gain.value = this.enabled ? 1 : 0;
      syncAudioButton();
    },
  };

  // ---------- terrain ----------
  const SEGS = 128;               // power of two; SEGS+1 height samples
  const DX = W / SEGS;
  let heights = new Float64Array(SEGS + 1);
  let pads = [];                  // {x0, x1, y, mult}

  function genTerrain() {
    // midpoint displacement, wrap-consistent (last == first) so the
    // horizontal world wrap never teleports the ship into a cliff face
    heights[0] = heights[SEGS] = rand(H * 0.6, H * 0.82);
    let step = SEGS, amp = H * 0.26;
    while (step > 1) {
      const half = step / 2;
      for (let i = half; i < SEGS; i += step) {
        heights[i] = (heights[i - half] + heights[i + half]) / 2 + rand(-amp, amp);
      }
      step = half;
      amp *= 0.55;
    }
    for (let i = 0; i <= SEGS; i++) heights[i] = clamp(heights[i], H * 0.34, H * 0.94);

    // pads: widths in cells; smaller pad => bigger multiplier
    const pool = [
      { mult: 1, cells: 14 },
      { mult: 2, cells: 10 },
      { mult: 2, cells: 10 },
      { mult: 3, cells: 7 },
      { mult: 3, cells: 7 },
      { mult: 4, cells: 5 },
      { mult: 5, cells: 4 },
    ];
    // guaranteed easy pad + 3 random harder picks
    const picks = [pool[Math.random() < 0.5 ? 0 : 1]];
    const hard = pool.slice(2);
    for (let n = 0; n < 3; n++) picks.push(hard[Math.floor(Math.random() * hard.length)]);

    pads = [];
    const used = []; // occupied [start,end] cell ranges
    for (const p of picks) {
      for (let attempt = 0; attempt < 60; attempt++) {
        const i0 = 2 + Math.floor(Math.random() * (SEGS - p.cells - 4));
        const i1 = i0 + p.cells;
        if (used.some(([a, b]) => i0 < b + 5 && i1 > a - 5)) continue;
        let sum = 0;
        for (let i = i0; i <= i1; i++) sum += heights[i];
        const y = clamp(sum / (p.cells + 1), H * 0.42, H * 0.92);
        for (let i = i0; i <= i1; i++) heights[i] = y;
        used.push([i0, i1]);
        pads.push({ x0: i0 * DX, x1: i1 * DX, y, mult: p.mult });
        break;
      }
    }
    pads.sort((a, b) => a.x0 - b.x0);
  }

  function terrainY(x) {
    x = wrapX(x);
    const f = x / DX;
    const i = Math.floor(f);
    const t = f - i;
    return heights[i] + (heights[Math.min(i + 1, SEGS)] - heights[i]) * t;
  }

  function padAt(x) {
    x = wrapX(x);
    for (const p of pads) if (x >= p.x0 && x <= p.x1) return p;
    return null;
  }

  // ---------- stars ----------
  let stars = [];
  function genStars() {
    stars = [];
    for (let i = 0; i < 110; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H * 0.75,
        r: rand(0.4, 1.5),
        ph: Math.random() * Math.PI * 2,
        sp: rand(0.4, 1.6),
      });
    }
  }

  // ---------- game state ----------
  const ship = {
    x: 0, y: 0, vx: 0, vy: 0, angle: 0, fuel: MAX_FUEL,
    px: 0, py: 0, pangle: 0, // previous tick, for render interpolation
  };
  let state = "menu";      // menu | playing | landed | crashed | gameover | paused
  let score = 0;
  let high = parseInt(localStorage.getItem(LS("high")) || "0", 10) || 0;
  let landings = 0;
  let stateTimer = 0;
  let landInfo = null;     // {points, mult, refuel, x, y}
  let crashCause = "";
  let thrustFlicker = 0;
  let simTime = 0;

  const keys = { left: false, right: false, thrust: false };

  const exhaust = [];   // {x,y,vx,vy,life,max}
  const debris = [];    // {x,y,vx,vy,a,va,len,life,max}

  function spawnShip() {
    ship.x = rand(W * 0.2, W * 0.8);
    ship.y = 70;
    ship.vx = rand(26, 44) * (Math.random() < 0.5 ? -1 : 1);
    ship.vy = 8;
    ship.angle = 0;
    ship.px = ship.x; ship.py = ship.y; ship.pangle = ship.angle;
  }

  function newRun() {
    score = 0;
    landings = 0;
    ship.fuel = MAX_FUEL;
    exhaust.length = 0;
    debris.length = 0;
    genTerrain();
    genStars();
    spawnShip();
    state = "playing";
  }

  function nextRound() {
    exhaust.length = 0;
    debris.length = 0;
    genTerrain();
    genStars();
    spawnShip();
    state = "playing";
  }

  // ---------- simulation ----------
  function contactPoints() {
    const s = Math.sin(ship.angle), c = Math.cos(ship.angle);
    const tf = ([lx, ly]) => [ship.x + lx * c - ly * s, ship.y + lx * s + ly * c];
    return { feet: CONTACT_FEET.map(tf), hull: CONTACT_HULL.map(tf) };
  }

  function crash(cause) {
    crashCause = cause;
    state = "crashed";
    stateTimer = 1.5;
    audio.crash();
    // debris: spinning line shards inheriting ship velocity
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(20, 130);
      debris.push({
        x: ship.x + rand(-8, 8),
        y: ship.y + rand(-8, 8),
        vx: ship.vx * 0.4 + Math.cos(a) * sp,
        vy: ship.vy * 0.25 + Math.sin(a) * sp - rand(10, 60),
        a: Math.random() * Math.PI * 2,
        va: rand(-9, 9),
        len: rand(3, 11),
        life: rand(1.2, 2.6),
        max: 2.6,
      });
    }
    if (score > high) {
      high = score;
      localStorage.setItem(LS("high"), String(high));
    }
  }

  function tryLand() {
    const { feet, hull } = contactPoints();

    // any hull point in the ground is always a crash
    for (const [px, py] of hull) {
      if (py >= terrainY(px)) return crash("hull impact");
    }

    const touching = feet.filter(([px, py]) => py >= terrainY(px));
    if (touching.length === 0) return;

    const ang = normAng(ship.angle);
    const padL = padAt(feet[0][0]);
    const padR = padAt(feet[1][0]);

    if (!padL || padL !== padR) return crash("rough ground");
    if (Math.abs(ang) > SAFE_ANG) return crash("came in tilted");
    if (Math.abs(ship.vx) > SAFE_VX) return crash("too fast sideways");
    if (ship.vy > SAFE_VY) return crash("came down too hard");
    if (ship.vy < 0) return; // moving up while grazing: not a landing

    // touchdown: snap upright onto the pad
    ship.angle = 0;
    ship.vx = 0; ship.vy = 0;
    ship.y = padL.y - FOOT_Y;
    ship.px = ship.x; ship.py = ship.y; ship.pangle = 0;

    landings++;
    const points = padL.mult * (100 + Math.round(ship.fuel));
    score += points;
    const refuel = Math.max(10, Math.round(65 * Math.pow(0.72, landings - 1)));
    ship.fuel = Math.min(MAX_FUEL, ship.fuel + refuel);
    landInfo = { points, mult: padL.mult, refuel, x: ship.x, y: padL.y };
    state = "landed";
    stateTimer = 2.4;
    audio.land();
    if (score > high) {
      high = score;
      localStorage.setItem(LS("high"), String(high));
    }
  }

  function tickParticles(dt) {
    for (let i = exhaust.length - 1; i >= 0; i--) {
      const p = exhaust[i];
      p.life -= dt;
      if (p.life <= 0) { exhaust.splice(i, 1); continue; }
      p.vy += GRAVITY * 0.35 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.y >= terrainY(p.x)) exhaust.splice(i, 1);
    }
    for (let i = debris.length - 1; i >= 0; i--) {
      const p = debris[i];
      p.life -= dt;
      if (p.life <= 0) { debris.splice(i, 1); continue; }
      p.vy += GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.a += p.va * dt;
      const ty = terrainY(p.x);
      if (p.y >= ty) { // bounce with damping
        p.y = ty;
        p.vy *= -0.42;
        p.vx *= 0.65;
        p.va *= 0.6;
      }
    }
  }

  function tick(dt) {
    if (state === "playing") {
      ship.px = ship.x; ship.py = ship.y; ship.pangle = ship.angle;

      // rotation: constant angular speed
      const rot = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      ship.angle += ROT_SPEED * rot * dt;

      // gravity every tick
      ship.vy += GRAVITY * dt;

      // thrust: acceleration along the ship's nose while fuel burns
      const thrusting = keys.thrust && ship.fuel > 0;
      if (thrusting) {
        ship.vx += Math.sin(ship.angle) * THRUST * dt;
        ship.vy -= Math.cos(ship.angle) * THRUST * dt;
        ship.fuel = Math.max(0, ship.fuel - BURN_RATE * dt);
        thrustFlicker = Math.random();
        // exhaust particles out of the tail
        const s = Math.sin(ship.angle), c = Math.cos(ship.angle);
        for (let n = 0; n < 3; n++) {
          const off = rand(-3.5, 3.5);
          const sp = rand(70, 150);
          exhaust.push({
            x: ship.x - 10 * s + off * c,
            y: ship.y + 10 * c + off * s,
            vx: ship.vx - (s + rand(-0.22, 0.22)) * sp,
            vy: ship.vy + (c + rand(-0.22, 0.22)) * sp,
            life: rand(0.3, 0.65),
            max: 0.65,
          });
        }
      }
      audio.setEngine(thrusting);

      ship.x = wrapX(ship.x + ship.vx * dt);
      ship.y += ship.vy * dt;
      if (ship.y < -160) ship.y = -160; // soft ceiling far above the screen

      tryLand();
    } else {
      audio.setEngine(false);
      if (state === "landed") {
        stateTimer -= dt;
        if (stateTimer <= 0) nextRound();
      } else if (state === "crashed") {
        stateTimer -= dt;
        if (stateTimer <= 0) state = "gameover";
      }
    }

    tickParticles(dt);
  }

  // ---------- rendering ----------
  const ACCENT = "#9fe8ff";
  const SAFE_COL = "#7ee787";
  const DANGER_COL = "#ff5d5d";
  const PAD_COL = "#ffd27e";

  function glowStroke(path, color, width, glow) {
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = width + glow;
    ctx.stroke(path);
    ctx.globalAlpha = 1;
    ctx.lineWidth = width;
    ctx.stroke(path);
  }

  function drawTerrain() {
    const path = new Path2D();
    path.moveTo(0, heights[0]);
    for (let i = 1; i <= SEGS; i++) path.lineTo(i * DX, heights[i]);
    ctx.lineJoin = "round";
    glowStroke(path, "#5a6b7c", 1.6, 5);

    // fill beneath, very faint
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = "#5a6b7c";
    const fill = new Path2D(path);
    fill.lineTo(W, H); fill.lineTo(0, H); fill.closePath();
    ctx.fill(fill);
    ctx.globalAlpha = 1;

    // pads: bright bars + multiplier labels
    ctx.font = "13px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const p of pads) {
      const path2 = new Path2D();
      path2.moveTo(p.x0, p.y);
      path2.lineTo(p.x1, p.y);
      glowStroke(path2, PAD_COL, 2.6, 7);
      // blinking edge ticks
      const blink = 0.55 + 0.45 * Math.sin(simTime * 4 + p.x0);
      ctx.globalAlpha = blink;
      ctx.fillStyle = PAD_COL;
      ctx.fillRect(p.x0 - 1, p.y - 5, 2, 5);
      ctx.fillRect(p.x1 - 1, p.y - 5, 2, 5);
      ctx.globalAlpha = 1;
      ctx.fillText("×" + p.mult, (p.x0 + p.x1) / 2, p.y + 8);
    }
  }

  function drawShip(rx, ry, ra) {
    ctx.save();
    ctx.translate(rx, ry);
    ctx.rotate(ra);

    // flame while thrusting
    if (keys.thrust && ship.fuel > 0 && state === "playing") {
      const len = 13 + thrustFlicker * 9;
      const flame = new Path2D();
      flame.moveTo(-4, 7);
      flame.lineTo(0, 7 + len);
      flame.lineTo(4, 7);
      glowStroke(flame, "#ffb35d", 1.5, 8);
    }

    // hull
    const hull = new Path2D();
    hull.moveTo(0, -13);
    hull.lineTo(7, -3);
    hull.lineTo(8, 6);
    hull.lineTo(-8, 6);
    hull.lineTo(-7, -3);
    hull.closePath();
    glowStroke(hull, ACCENT, 1.7, 6);

    // window
    const win = new Path2D();
    win.arc(0, -4, 2.6, 0, Math.PI * 2);
    glowStroke(win, ACCENT, 1.2, 4);

    // legs + feet
    const legs = new Path2D();
    legs.moveTo(-6, 5); legs.lineTo(-FOOT_X, FOOT_Y);
    legs.moveTo(6, 5); legs.lineTo(FOOT_X, FOOT_Y);
    legs.moveTo(-FOOT_X - 3, FOOT_Y); legs.lineTo(-FOOT_X + 3, FOOT_Y);
    legs.moveTo(FOOT_X - 3, FOOT_Y); legs.lineTo(FOOT_X + 3, FOOT_Y);
    glowStroke(legs, ACCENT, 1.5, 5);

    ctx.restore();
  }

  function drawParticles() {
    for (const p of exhaust) {
      const t = p.life / p.max;
      ctx.globalAlpha = t;
      ctx.fillStyle = t > 0.6 ? "#fff3d6" : t > 0.3 ? "#ffb35d" : "#ff6a3d";
      const r = 1 + (1 - t) * 1.6;
      ctx.fillRect(p.x - r / 2, p.y - r / 2, r, r);
    }
    ctx.globalAlpha = 1;
    for (const p of debris) {
      const t = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = t;
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.4;
      const dx = Math.cos(p.a) * p.len, dy = Math.sin(p.a) * p.len;
      ctx.beginPath();
      ctx.moveTo(p.x - dx, p.y - dy);
      ctx.lineTo(p.x + dx, p.y + dy);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawHUD() {
    const mono = "ui-monospace, Menlo, Consolas, monospace";
    ctx.textBaseline = "top";

    // left column: score
    ctx.textAlign = "left";
    ctx.font = "13px " + mono;
    ctx.fillStyle = "#8b97a3";
    ctx.fillText("SCORE", 20, 40);
    ctx.fillText("HIGH", 20, 78);
    ctx.font = "18px " + mono;
    ctx.fillStyle = ACCENT;
    ctx.fillText(String(score).padStart(5, "0"), 20, 55);
    ctx.fillStyle = PAD_COL;
    ctx.fillText(String(high).padStart(5, "0"), 20, 93);

    // right column: telemetry
    const rx = W - 20;
    ctx.textAlign = "right";
    const alt = Math.max(0, Math.round(terrainY(ship.x) - (ship.y + FOOT_Y)));
    const hv = ship.vx, vv = ship.vy;
    const hvSafe = Math.abs(hv) <= SAFE_VX;
    const vvSafe = vv <= SAFE_VY;
    const angSafe = Math.abs(normAng(ship.angle)) <= SAFE_ANG;

    const rows = [
      ["ALTITUDE", String(alt), "#c9d4de"],
      ["H-SPEED " + (hv < -0.5 ? "←" : hv > 0.5 ? "→" : " "),
        Math.abs(hv).toFixed(1), hvSafe ? SAFE_COL : DANGER_COL],
      ["V-SPEED " + (vv < -0.5 ? "↑" : "↓"),
        Math.abs(vv).toFixed(1), vvSafe ? SAFE_COL : DANGER_COL],
      ["TILT", Math.abs(normAng(ship.angle) * 180 / Math.PI).toFixed(0) + "°",
        angSafe ? SAFE_COL : DANGER_COL],
    ];
    let y = 40;
    for (const [label, val, col] of rows) {
      ctx.font = "12px " + mono;
      ctx.fillStyle = "#8b97a3";
      ctx.fillText(label, rx - 62, y + 2);
      ctx.font = "15px " + mono;
      ctx.fillStyle = col;
      ctx.fillText(val, rx, y);
      y += 24;
    }

    // fuel bar
    ctx.font = "12px " + mono;
    ctx.fillStyle = "#8b97a3";
    ctx.fillText("FUEL", rx - 150, y + 2);
    const bw = 140, bh = 9;
    const frac = ship.fuel / MAX_FUEL;
    ctx.strokeStyle = "#5a6b7c";
    ctx.lineWidth = 1;
    ctx.strokeRect(rx - bw, y, bw, bh);
    ctx.fillStyle = frac > 0.3 ? SAFE_COL : frac > 0.15 ? PAD_COL : DANGER_COL;
    ctx.fillRect(rx - bw + 1.5, y + 1.5, Math.max(0, (bw - 3) * frac), bh - 3);
    if (frac <= 0.15 && Math.sin(simTime * 8) > 0) {
      ctx.fillStyle = DANGER_COL;
      ctx.textAlign = "right";
      ctx.fillText("LOW FUEL", rx, y + 16);
    }
  }

  function centerText(lines, baseY) {
    const mono = "ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let y = baseY;
    for (const [text, size, col] of lines) {
      ctx.font = size + "px " + mono;
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.25;
      ctx.fillText(text, W / 2 + 1, y + 1);
      ctx.globalAlpha = 1;
      ctx.fillText(text, W / 2, y);
      y += size * 1.7;
    }
  }

  function render(alpha) {
    const dpr = view.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#0d0f12";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, view.ox, view.oy);

    // subtle world frame
    ctx.strokeStyle = "rgba(90,107,124,0.25)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

    // stars
    for (const s of stars) {
      const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(simTime * s.sp + s.ph));
      ctx.globalAlpha = tw;
      ctx.fillStyle = "#c9d4de";
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    drawTerrain();
    drawParticles();

    if (state !== "crashed" && state !== "gameover" && state !== "menu") {
      // interpolate ship between ticks (handle horizontal wrap)
      let px = ship.px;
      if (Math.abs(ship.x - px) > W / 2) px += ship.x > px ? W : -W;
      const rxp = wrapX(lerp(px, ship.x, alpha));
      const ryp = lerp(ship.py, ship.y, alpha);
      const rap = lerp(ship.pangle, ship.angle, alpha);
      drawShip(rxp, ryp, rap);
    }

    if (state !== "menu") drawHUD();

    if (state === "landed" && landInfo) {
      centerText([
        ["TOUCHDOWN", 30, SAFE_COL],
        ["×" + landInfo.mult + " pad   +" + landInfo.points + " pts   +" +
          landInfo.refuel + " fuel", 15, "#c9d4de"],
      ], H * 0.3);
    } else if (state === "gameover") {
      centerText([
        ["CRASHED", 34, DANGER_COL],
        [crashCause, 15, "#8b97a3"],
        ["score " + score + (score >= high && score > 0 ? "   ★ new best" : "   best " + high), 16, PAD_COL],
        ["press R to fly again", 14, "#c9d4de"],
      ], H * 0.3);
    } else if (state === "paused") {
      centerText([
        ["PAUSED", 30, ACCENT],
        ["press P to resume", 14, "#8b97a3"],
      ], H * 0.35);
    }
  }

  // ---------- main loop (fixed timestep + accumulator) ----------
  let last = performance.now();
  let acc = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    const ms = Math.min(now - last, 100); // clamp long tab-away frames
    last = now;
    simTime += ms / 1000; // visual-only clock (twinkle, blink) runs always
    if (state === "playing" || state === "landed" || state === "crashed") {
      acc += ms / 1000;
      while (acc >= DT) {
        tick(DT);
        acc -= DT;
      }
    }
    render(clamp(acc / DT, 0, 1));
  }
  requestAnimationFrame(frame);

  // ---------- input ----------
  const overlay = document.getElementById("overlay");
  const startBtn = document.getElementById("start");
  const audioBtn = document.getElementById("audio-toggle");
  const bestEl = document.getElementById("best");

  function syncAudioButton() {
    audioBtn.textContent = audio.enabled ? "Sound: on" : "Sound: off";
  }
  function syncBest() {
    bestEl.textContent = high > 0 ? "best " + String(high).padStart(5, "0") : "";
  }
  syncAudioButton();
  syncBest();

  function begin() {
    audio.init();
    audio.resume();
    overlay.classList.add("hidden");
    newRun();
    last = performance.now();
    acc = 0;
  }

  startBtn.addEventListener("click", begin);
  audioBtn.addEventListener("click", () => { audio.init(); audio.toggle(); });

  addEventListener("keydown", (e) => {
    if (e.repeat) {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "Space"].includes(e.code)) e.preventDefault();
      return;
    }
    audio.init();
    audio.resume();
    switch (e.code) {
      case "ArrowLeft": case "KeyA": keys.left = true; e.preventDefault(); break;
      case "ArrowRight": case "KeyD": keys.right = true; e.preventDefault(); break;
      case "ArrowUp": case "KeyW": case "Space":
        keys.thrust = true;
        e.preventDefault();
        if (state === "menu") begin();
        else if (state === "gameover") { newRun(); }
        else if (state === "landed" && stateTimer < 2.0) nextRound();
        break;
      case "KeyM": audio.toggle(); break;
      case "KeyR":
        if (state !== "menu") { overlay.classList.add("hidden"); newRun(); }
        break;
      case "KeyP": case "Escape":
        if (state === "playing") { state = "paused"; audio.setEngine(false); }
        else if (state === "paused") { state = "playing"; last = performance.now(); acc = 0; }
        break;
      case "Enter":
        if (state === "menu") begin();
        else if (state === "gameover") newRun();
        break;
    }
    if (state === "gameover") syncBest();
  });

  addEventListener("keyup", (e) => {
    switch (e.code) {
      case "ArrowLeft": case "KeyA": keys.left = false; break;
      case "ArrowRight": case "KeyD": keys.right = false; break;
      case "ArrowUp": case "KeyW": case "Space": keys.thrust = false; break;
    }
  });

  // pause when the window loses focus
  addEventListener("blur", () => {
    if (state === "playing") state = "paused";
    keys.left = keys.right = keys.thrust = false;
    audio.setEngine(false);
  });

  // initial backdrop so the menu isn't floating over black
  genTerrain();
  genStars();

  // tiny debug handle (used by the headless smoke test; harmless in the browser)
  window.__softfall = {
    get state() { return state; },
    get ship() { return ship; },
    get pads() { return pads; },
    get score() { return score; },
    get landings() { return landings; },
    get cause() { return crashCause; },
    keys,
    terrainY,
  };
})();

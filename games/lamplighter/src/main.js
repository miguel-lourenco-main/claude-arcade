/* Lamplighter — main game.
   Fixed-timestep logic (120 Hz accumulator), interpolated rendering.
   Depends on globals: MAZE (src/maze.js) and Sfx (src/audio.js). */

(() => {
  "use strict";

  const { WALL, PATH, DEN, DOOR, COLS, ROWS, TUNNEL_ROW, DIRS, mulberry32, generateMaze } = MAZE;

  /* ---------- constants ---------- */

  const TILE = 26;
  const W = COLS * TILE;   /* 546 */
  const H = ROWS * TILE;   /* 598 */
  const DT = 1 / 120;
  const CORNER_TOL = 0.35;      /* corner-cutting tolerance, in tiles */
  const PLAYER_BASE = 6.0;      /* tiles / second */
  const GLOAM_BASE = 5.4;
  const PURSUE_DUR = 20;
  const DEATH_DUR = 1.6;
  const COLLIDE_R2 = 0.55 * 0.55;

  const KEY_HIGH = "arcade.lamplighter.high";
  const KEY_AUDIO = "arcade.lamplighter.audio";

  const GLOAM_DEFS = [
    { name: "ashen",  rgb: [196, 74, 100] },  /* direct chaser */
    { name: "vesper", rgb: [130, 98, 208] },  /* interceptor: 4 ahead */
    { name: "murk",   rgb: [70, 152, 128] },  /* flanker: mirrored point */
    { name: "smolder",rgb: [180, 118, 58] },  /* wanderer: darkest quarter */
  ];
  const FLEE_RGB = [166, 186, 214];
  const FLEE_FLASH_RGB = [235, 242, 250];

  /* ---------- dom / canvas ---------- */

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";

  const el = {
    score: document.getElementById("score"),
    best: document.getElementById("best"),
    level: document.getElementById("level"),
    lamps: document.getElementById("lamps"),
    lives: document.getElementById("lives"),
    overlay: document.getElementById("overlay"),
    ovTitle: document.getElementById("overlay-title"),
    ovSub: document.getElementById("overlay-sub"),
    ovInfo: document.getElementById("overlay-info"),
    ovScore: document.getElementById("overlay-score"),
    audioBtn: document.getElementById("audio-toggle"),
  };

  const sfx = new Sfx(KEY_AUDIO);

  /* ---------- game state ---------- */

  let maze = null;
  let mazeLayer = null;
  let lanternAt = null;   /* tile index -> lantern object */
  let brazierAt = null;
  let litGlow = null;     /* Uint8Array: 0 dark, 1..3 warm */
  let litCount = 0;
  let totalLamps = 0;

  let state = "title";    /* title | ready | playing | dying | levelclear | gameover */
  let stateTimer = 0;
  let paused = false;
  let readyLabel = "";
  let time = 0;

  let level = 1;
  let score = 0;
  let high = 0;
  let lives = 3;

  let mode = "scatter";   /* pursue | scatter */
  let modeClock = 0;
  let fleeTimer = 0;
  let banishCombo = 0;
  let wanderClock = 0;

  let popups = [];

  try { high = parseInt(localStorage.getItem(KEY_HIGH), 10) || 0; } catch (e) { high = 0; }

  const player = {
    x: 0, y: 0, prevX: 0, prevY: 0,
    dir: null, buf: null,
    face: { dx: -1, dy: 0 },
    walkPhase: 0,
  };

  const gloams = GLOAM_DEFS.map((def, i) => ({
    kind: i,
    rgb: def.rgb,
    x: 0, y: 0, prevX: 0, prevY: 0,
    dir: null,
    state: "den",      /* den | leaving | normal | returning | descend */
    fleeing: false,
    reverseNext: false,
    release: 0,
    bob: 0,
    wtarget: null,
    corner: null,
  }));

  /* ---------- helpers ---------- */

  const idx = (x, y) => y * COLS + x;

  function tileAt(x, y) {
    if (y < 0 || y >= ROWS) return WALL;
    const xx = ((x % COLS) + COLS) % COLS;
    return maze.grid[y][xx];
  }

  const playerPassable = (x, y) => tileAt(x, y) === PATH;
  const gloamPassable = (x, y) => tileAt(x, y) === PATH;
  const isTunnel = (x, y) => y === TUNNEL_ROW && (x < 3 || x > COLS - 4);

  function wrapEntity(e) {
    if (e.x < 0) { e.x += COLS; e.prevX += COLS; }
    if (e.x >= COLS) { e.x -= COLS; e.prevX -= COLS; }
  }

  /* squared distance, wrap-aware horizontally */
  function wdist2(ax, ay, bx, by) {
    let dx = Math.abs(ax - bx);
    dx = Math.min(dx, COLS - dx);
    const dy = ay - by;
    return dx * dx + dy * dy;
  }

  const levelScale = () => Math.min(1.24, 1 + (level - 1) * 0.03);
  const scatterDur = () => Math.max(1.5, 6 - (level - 1) * 0.6);
  const fleeDur = () => Math.max(1.6, 6 - (level - 1) * 0.7);

  function saveHigh() {
    if (score > high) {
      high = score;
      try { localStorage.setItem(KEY_HIGH, String(high)); } catch (e) { /* ignore */ }
    }
  }

  /* ---------- movement core ----------
     Continuous motion along corridors; direction decisions happen only
     when an entity crosses a tile center. */

  function stepMover(e, dist, decide, passable) {
    let guard = 12;
    while (dist > 1e-9 && guard-- > 0) {
      if (!e.dir) break;
      const horiz = e.dir.dx !== 0;
      const s = horiz ? e.dir.dx : e.dir.dy;
      const axis = horiz ? "x" : "y";
      const pos = e[axis];
      const rel = pos - 0.5;
      const nextI = s > 0 ? Math.floor(rel + 1e-7) + 1 : Math.ceil(rel - 1e-7) - 1;
      const center = nextI + 0.5;
      const d = Math.abs(center - pos);
      if (d > dist) {
        e[axis] = pos + s * dist;
        dist = 0;
      } else {
        e[axis] = center;
        dist -= d;
        wrapEntity(e);
        const cx = Math.floor(e.x), cy = Math.floor(e.y);
        decide(e, cx, cy);
        if (e.dir && !passable(cx + e.dir.dx, cy + e.dir.dy)) e.dir = null;
      }
    }
    wrapEntity(e);
  }

  /* ---------- player ---------- */

  function playerDecide(e, cx, cy) {
    if (e.buf && playerPassable(cx + e.buf.dx, cy + e.buf.dy)) {
      e.dir = e.buf; e.face = e.buf; e.buf = null;
    }
  }

  function playerSpeed() {
    const cx = Math.floor(player.x), cy = Math.floor(player.y);
    let s = PLAYER_BASE * levelScale();
    if (litGlow[idx(((cx % COLS) + COLS) % COLS, cy)] > 0) s *= 1.08; /* lit streets carry you */
    return s;
  }

  function tickPlayer(dt) {
    const p = player;
    if (p.buf && p.dir && p.buf.dx === p.dir.dx && p.buf.dy === p.dir.dy) p.buf = null;
    /* reversals are free, any time */
    if (p.buf && p.dir && p.buf.dx === -p.dir.dx && p.buf.dy === -p.dir.dy) {
      p.dir = p.buf; p.face = p.buf; p.buf = null;
    }
    /* pre-buffered turn: taken at (or near) the tile center, with a
       corner-cutting tolerance either side */
    if (p.buf) {
      const cx = Math.floor(p.x), cy = Math.floor(p.y);
      if (playerPassable(cx + p.buf.dx, cy + p.buf.dy)) {
        if (!p.dir) {
          p.dir = p.buf; p.face = p.buf; p.buf = null;
        } else {
          const off = p.dir.dx !== 0 ? p.x - (cx + 0.5) : p.y - (cy + 0.5);
          if (Math.abs(off) <= CORNER_TOL) {
            p.x = cx + 0.5; p.y = cy + 0.5;
            p.dir = p.buf; p.face = p.buf; p.buf = null;
          }
        }
      }
    }
    if (p.dir) {
      const sp = playerSpeed();
      stepMover(p, sp * dt, playerDecide, playerPassable);
      p.walkPhase += sp * dt * 2.2;
    }
  }

  /* ---------- lighting ---------- */

  function applyGlow(lamp) {
    for (const t of lamp.glow) {
      const i = idx(t.x, t.y);
      const v = 3 - t.d;
      if (v > litGlow[i]) litGlow[i] = v;
    }
  }

  function lightCheck() {
    const cx = ((Math.floor(player.x) % COLS) + COLS) % COLS;
    const cy = Math.floor(player.y);
    const i = idx(cx, cy);
    const l = lanternAt[i];
    if (l && !l.lit) {
      l.lit = true;
      litCount++;
      score += 10;
      applyGlow(l);
      sfx.lantern(litCount);
      updateHud();
      checkClear();
    }
    const b = brazierAt[i];
    if (b && !b.lit) {
      b.lit = true;
      litCount++;
      score += 50;
      applyGlow(b);
      triggerFlee();
      sfx.brazier();
      updateHud();
      checkClear();
    }
  }

  function triggerFlee() {
    fleeTimer = fleeDur();
    banishCombo = 0;
    for (const g of gloams) {
      if (g.state === "normal") { g.fleeing = true; g.reverseNext = true; }
      else if (g.state === "den" || g.state === "leaving") g.fleeing = true;
    }
  }

  function checkClear() {
    if (litCount < totalLamps) return;
    const bonus = 500 + 100 * level;
    score += bonus;
    popups.push({ x: player.x, y: player.y, text: "+" + bonus, life: 2, max: 2 });
    state = "levelclear";
    stateTimer = 2.4;
    fleeTimer = 0;
    for (const g of gloams) g.fleeing = false;
    sfx.clear();
    saveHigh();
    updateHud();
  }

  /* ---------- gloams ---------- */

  function gloamTarget(g) {
    if (mode === "scatter") return g.corner;
    const tx = Math.floor(player.x), ty = Math.floor(player.y);
    switch (g.kind) {
      case 0: /* direct chaser */
        return { x: tx, y: ty };
      case 1: /* interceptor: 4 tiles ahead of the player's facing */
        return { x: tx + player.face.dx * 4, y: ty + player.face.dy * 4 };
      case 2: { /* flanker: chaser's tile mirrored across the player */
        const c = gloams[0];
        return { x: 2 * tx - Math.floor(c.x), y: 2 * ty - Math.floor(c.y) };
      }
      case 3: /* wanderer: biased toward the largest unlit region */
        return g.wtarget || g.corner;
    }
    return g.corner;
  }

  function gloamDecide(g, cx, cy) {
    const rev = g.dir ? { dx: -g.dir.dx, dy: -g.dir.dy } : null;
    const opts = [];
    for (const d of DIRS) {
      if (rev && d.dx === rev.dx && d.dy === rev.dy) continue; /* no reversing */
      if (gloamPassable(cx + d.dx, cy + d.dy)) opts.push(d);
    }
    if (!opts.length) {
      if (rev && gloamPassable(cx + rev.dx, cy + rev.dy)) opts.push(rev);
      else { g.dir = null; return; }
    }
    let best = opts[0];
    if (g.fleeing) {
      let bv = -Infinity;
      for (const d of opts) {
        const v = wdist2(cx + d.dx + 0.5, cy + d.dy + 0.5, player.x, player.y);
        if (v > bv) { bv = v; best = d; }
      }
    } else {
      const tgt = gloamTarget(g);
      let bv = Infinity;
      for (const d of opts) {
        const ddx = cx + d.dx - tgt.x, ddy = cy + d.dy - tgt.y;
        const v = ddx * ddx + ddy * ddy;
        if (v < bv) { bv = v; best = d; }
      }
    }
    g.dir = best;
  }

  function returnDecide(g, cx, cy) {
    const xx = ((cx % COLS) + COLS) % COLS;
    let best = null, bv = Infinity;
    for (const d of DIRS) {
      let nx = xx + d.dx;
      const ny = cy + d.dy;
      if (nx < 0) nx = COLS - 1;
      if (nx >= COLS) nx = 0;
      if (!gloamPassable(nx, ny)) continue;
      const f = maze.doorField[idx(nx, ny)];
      if (f === -1) continue;
      if (f < bv) { bv = f; best = d; }
    }
    if (best) g.dir = best;
  }

  function gloamSpeed(g) {
    const cx = ((Math.floor(g.x) % COLS) + COLS) % COLS;
    const cy = Math.floor(g.y);
    let s = GLOAM_BASE * levelScale();
    if (litGlow[idx(cx, cy)] === 0) s *= 1.1;  /* gloams thrive in the dark */
    if (g.fleeing) s *= 0.55;
    if (isTunnel(cx, cy)) s *= 0.5;            /* half speed in the tunnels */
    return s;
  }

  function tickGloam(g, dt) {
    switch (g.state) {
      case "den": {
        g.bob += dt;
        g.y = 11.5 + Math.sin(g.bob * 3) * 0.14;
        g.release -= dt;
        if (g.release <= 0) g.state = "leaving";
        break;
      }
      case "leaving": {
        const step = 2.6 * dt;
        if (Math.abs(g.x - 10.5) > 0.02) {
          g.x += Math.sign(10.5 - g.x) * Math.min(step, Math.abs(10.5 - g.x));
        } else {
          g.x = 10.5;
          g.y -= step;
          if (g.y <= 9.5) {
            g.y = 9.5;
            g.state = "normal";
            g.dir = null;
            gloamDecide(g, 10, 9);
          }
        }
        break;
      }
      case "returning": {
        stepMover(g, 8 * dt, returnDecide, gloamPassable);
        if (Math.abs(g.x - 10.5) < 0.08 && Math.abs(g.y - 9.5) < 0.08) {
          g.x = 10.5; g.y = 9.5;
          g.state = "descend";
          g.dir = null;
        }
        break;
      }
      case "descend": {
        g.y += 3.5 * dt;
        if (g.y >= 11.5) {
          g.y = 11.5;
          g.state = "den";
          g.release = 0.8;
          g.bob = 0;
          g.fleeing = false;
        }
        break;
      }
      case "normal": {
        if (g.reverseNext && g.dir) {
          g.dir = { dx: -g.dir.dx, dy: -g.dir.dy };
          g.reverseNext = false;
        }
        stepMover(g, gloamSpeed(g) * dt, gloamDecide, gloamPassable);
        if (!g.dir) gloamDecide(g, Math.floor(g.x), Math.floor(g.y));
        break;
      }
    }
  }

  function computeWanderTarget() {
    const g = gloams[3];
    const unlit = maze.lanterns.filter((l) => !l.lit);
    if (!unlit.length) { g.wtarget = null; return; }
    let best = unlit[0], bv = -1;
    for (const a of unlit) {
      let c = 0;
      for (const b of unlit)
        if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 5) c++;
      if (c > bv) { bv = c; best = a; }
    }
    g.wtarget = { x: best.x, y: best.y };
  }

  /* ---------- collisions / death ---------- */

  function banish(g) {
    const pts = 200 << banishCombo;
    banishCombo = Math.min(banishCombo + 1, 3);
    score += pts;
    popups.push({ x: g.x, y: g.y, text: String(pts), life: 1.1, max: 1.1 });
    g.state = "returning";
    g.fleeing = false;
    sfx.banish(banishCombo);
    saveHigh();
    updateHud();
  }

  function checkCollisions() {
    for (const g of gloams) {
      if (g.state !== "normal" && g.state !== "leaving") continue;
      if (wdist2(g.x, g.y, player.x, player.y) < COLLIDE_R2) {
        if (g.fleeing) banish(g);
        else { startDeath(); return; }
      }
    }
  }

  function startDeath() {
    state = "dying";
    stateTimer = DEATH_DUR;
    fleeTimer = 0;
    for (const g of gloams) g.fleeing = false;
    sfx.death();
  }

  function gameOver() {
    state = "gameover";
    saveHigh();
    updateHud();
    showOverlay(
      "THE STREET WENT DARK",
      "the gloams unlit what you lit",
      "press any key to relight",
      "score " + score + " &middot; best " + high
    );
  }

  /* ---------- level / positions ---------- */

  function resetPositions(fresh) {
    player.x = maze.spawn.x + 0.5;
    player.y = maze.spawn.y + 0.5;
    player.prevX = player.x; player.prevY = player.y;
    player.dir = null; player.buf = null;
    player.face = { dx: -1, dy: 0 };
    player.walkPhase = 0;

    const rel = fresh ? [0, 2.5, 5.5, 9] : [0, 1.2, 2.6, 4.2];
    const slots = [10.5, 9.5, 10.5, 11.5];
    for (let i = 0; i < 4; i++) {
      const g = gloams[i];
      g.corner = maze.corners[i];
      g.fleeing = false;
      g.reverseNext = false;
      g.wtarget = null;
      g.bob = i * 1.3;
      if (i === 0) {
        g.x = 10.5; g.y = 9.5;
        g.state = "normal";
        g.dir = { dx: -1, dy: 0 };
      } else {
        g.x = slots[i]; g.y = 11.5;
        g.state = "den";
        g.dir = null;
        g.release = rel[i];
      }
      g.prevX = g.x; g.prevY = g.y;
    }

    mode = "scatter";
    modeClock = 0;
    fleeTimer = 0;
    banishCombo = 0;
    wanderClock = 0;
    popups = [];
  }

  function startLevel() {
    const seed = (Date.now() ^ Math.imul(level, 2654435761) ^ ((Math.random() * 0xffffffff) >>> 0)) >>> 0;
    const rng = mulberry32(seed);
    maze = generateMaze(rng);

    lanternAt = new Array(COLS * ROWS).fill(null);
    brazierAt = new Array(COLS * ROWS).fill(null);
    for (const l of maze.lanterns) { l.lit = false; lanternAt[idx(l.x, l.y)] = l; }
    for (const b of maze.braziers) { b.lit = false; brazierAt[idx(b.x, b.y)] = b; }
    litGlow = new Uint8Array(COLS * ROWS);
    litCount = 0;
    totalLamps = maze.lanterns.length + maze.braziers.length;

    buildMazeLayer();
    resetPositions(true);
    readyLabel = "NIGHT " + level;
    state = "ready";
    stateTimer = 1.8;
    hideOverlay();
    updateHud();
    sfx.readyCue();
  }

  function newGame() {
    score = 0;
    lives = 3;
    level = 1;
    startLevel();
  }

  /* ---------- fixed-timestep loop ---------- */

  function tick(dt) {
    time += dt;
    player.prevX = player.x; player.prevY = player.y;
    for (const g of gloams) { g.prevX = g.x; g.prevY = g.y; }

    switch (state) {
      case "ready":
        stateTimer -= dt;
        if (stateTimer <= 0) state = "playing";
        break;
      case "playing":
        tickPlaying(dt);
        break;
      case "dying":
        stateTimer -= dt;
        if (stateTimer <= 0) {
          lives--;
          updateHud();
          if (lives <= 0) gameOver();
          else {
            resetPositions(false);
            readyLabel = "READY";
            state = "ready";
            stateTimer = 1.2;
            sfx.readyCue();
          }
        }
        break;
      case "levelclear":
        stateTimer -= dt;
        if (stateTimer <= 0) {
          level++;
          startLevel();
        }
        break;
    }

    for (const p of popups) p.life -= dt;
    popups = popups.filter((p) => p.life > 0);
  }

  function tickPlaying(dt) {
    /* global mode alternation; the clock holds its breath during a flee */
    if (fleeTimer > 0) {
      fleeTimer -= dt;
      if (fleeTimer <= 0) {
        fleeTimer = 0;
        for (const g of gloams) g.fleeing = false;
      }
    } else {
      modeClock += dt;
      const dur = mode === "pursue" ? PURSUE_DUR : scatterDur();
      if (modeClock >= dur) {
        modeClock = 0;
        mode = mode === "pursue" ? "scatter" : "pursue";
        for (const g of gloams)
          if (g.state === "normal") g.reverseNext = true; /* the one legal reversal */
      }
    }

    wanderClock -= dt;
    if (wanderClock <= 0) {
      wanderClock = 1.5;
      computeWanderTarget();
    }

    tickPlayer(dt);
    lightCheck();
    if (state !== "playing") return; /* the last lamp may have cleared the night */
    for (const g of gloams) tickGloam(g, dt);
    checkCollisions();
  }

  let last = performance.now();
  let acc = 0;
  function frame(now) {
    acc += Math.min(0.25, (now - last) / 1000);
    last = now;
    if (!paused) {
      while (acc >= DT) { tick(DT); acc -= DT; }
    } else {
      acc = 0;
    }
    render(acc / DT);
    requestAnimationFrame(frame);
  }

  /* ---------- rendering ---------- */

  let glowSprite = null;
  function buildGlowSprite() {
    glowSprite = document.createElement("canvas");
    glowSprite.width = 128; glowSprite.height = 128;
    const c = glowSprite.getContext("2d");
    const grad = c.createRadialGradient(64, 64, 2, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,196,120,0.85)");
    grad.addColorStop(0.35, "rgba(255,166,80,0.32)");
    grad.addColorStop(1, "rgba(255,140,60,0)");
    c.fillStyle = grad;
    c.fillRect(0, 0, 128, 128);
  }

  function drawGlow(px, py, r, alpha) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = alpha;
    ctx.drawImage(glowSprite, px - r, py - r, r * 2, r * 2);
    ctx.restore();
  }

  function buildMazeLayer() {
    mazeLayer = document.createElement("canvas");
    mazeLayer.width = W * dpr;
    mazeLayer.height = H * dpr;
    const c = mazeLayer.getContext("2d");
    c.scale(dpr, dpr);
    c.fillStyle = "#0d0f12";
    c.fillRect(0, 0, W, H);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const t = maze.grid[y][x];
        const px = x * TILE, py = y * TILE;
        if (t === PATH) {
          c.fillStyle = "#10131a";
          c.fillRect(px, py, TILE, TILE);
          /* faint cobble speckle */
          const h = (x * 73 + y * 151) % 97;
          c.fillStyle = "rgba(160,190,235,0.03)";
          c.fillRect(px + (h % 19) + 3, py + ((h * 7) % 19) + 3, 2, 2);
        } else if (t === DEN || t === DOOR) {
          c.fillStyle = "#131020";
          c.fillRect(px, py, TILE, TILE);
        } else {
          c.fillStyle = "#151b28";
          c.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
        }
      }
    }
    /* glowing seams where wall meets corridor */
    c.strokeStyle = "rgba(92,130,186,0.30)";
    c.lineWidth = 2;
    c.beginPath();
    const floorish = (x, y) => {
      if (y < 0 || y >= ROWS || x < 0 || x >= COLS) return false;
      return maze.grid[y][x] !== WALL;
    };
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (maze.grid[y][x] !== WALL) continue;
        const px = x * TILE, py = y * TILE;
        if (floorish(x - 1, y)) { c.moveTo(px + 1, py); c.lineTo(px + 1, py + TILE); }
        if (floorish(x + 1, y)) { c.moveTo(px + TILE - 1, py); c.lineTo(px + TILE - 1, py + TILE); }
        if (floorish(x, y - 1)) { c.moveTo(px, py + 1); c.lineTo(px + TILE, py + 1); }
        if (floorish(x, y + 1)) { c.moveTo(px, py + TILE - 1); c.lineTo(px + TILE, py + TILE - 1); }
      }
    }
    c.stroke();
    /* the den door: a pale bar of woven ward-light */
    const d = maze.doorTop;
    c.fillStyle = "rgba(150,128,214,0.55)";
    c.fillRect(d.x * TILE + 4, (d.y + 1) * TILE + TILE / 2 - 2, TILE - 8, 4);
  }

  function lerpPos(e, alpha, axis) {
    const cur = axis === "x" ? e.x : e.y;
    const prev = axis === "x" ? e.prevX : e.prevY;
    const d = cur - prev;
    if (Math.abs(d) > 0.6) return cur; /* wrapped this tick */
    return prev + d * alpha;
  }

  function drawLantern(l, t) {
    const px = (l.x + 0.5) * TILE, py = (l.y + 0.5) * TILE;
    if (!l.lit) {
      ctx.strokeStyle = "#28324a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, py + 7);
      ctx.lineTo(px, py - 3);
      ctx.stroke();
      ctx.fillStyle = "#1b2233";
      ctx.strokeStyle = "#33405c";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, py - 9);
      ctx.lineTo(px + 4, py - 5);
      ctx.lineTo(px, py - 1);
      ctx.lineTo(px - 4, py - 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      const fl = 0.88 + 0.12 * Math.sin(t * 5 + l.x * 3.1 + l.y * 1.7);
      drawGlow(px, py - 5, TILE * 1.8 * fl, 0.5);
      ctx.strokeStyle = "#4a3a28";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, py + 7);
      ctx.lineTo(px, py - 3);
      ctx.stroke();
      ctx.fillStyle = "#ffcf8e";
      ctx.strokeStyle = "#9c6a30";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, py - 9);
      ctx.lineTo(px + 4, py - 5);
      ctx.lineTo(px, py - 1);
      ctx.lineTo(px - 4, py - 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#fff3da";
      ctx.beginPath();
      ctx.arc(px, py - 5, 1.6 * fl, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBrazier(b, t) {
    const px = (b.x + 0.5) * TILE, py = (b.y + 0.5) * TILE;
    if (b.lit) {
      const fl = 0.85 + 0.15 * Math.sin(t * 7 + b.x * 2.3);
      drawGlow(px, py - 4, TILE * 2.4 * fl, 0.65);
    }
    /* bowl */
    ctx.fillStyle = b.lit ? "#3a2e20" : "#1d2536";
    ctx.strokeStyle = b.lit ? "#6b4a26" : "#31405c";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px, py + 1, 7, Math.PI, 0, true);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    /* legs */
    ctx.beginPath();
    ctx.moveTo(px - 5, py + 3); ctx.lineTo(px - 7, py + 9);
    ctx.moveTo(px + 5, py + 3); ctx.lineTo(px + 7, py + 9);
    ctx.stroke();
    if (b.lit) {
      const fl = 0.8 + 0.25 * Math.sin(t * 11 + b.y);
      const fl2 = 0.8 + 0.25 * Math.sin(t * 13.7 + b.x);
      ctx.fillStyle = "#ffb457";
      ctx.beginPath();
      ctx.moveTo(px - 5, py + 1);
      ctx.quadraticCurveTo(px - 4, py - 6 * fl, px, py - 11 * fl);
      ctx.quadraticCurveTo(px + 4, py - 6 * fl2, px + 5, py + 1);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ffe3a1";
      ctx.beginPath();
      ctx.moveTo(px - 2.5, py + 1);
      ctx.quadraticCurveTo(px - 1.5, py - 3 * fl2, px, py - 6 * fl);
      ctx.quadraticCurveTo(px + 1.5, py - 3 * fl, px + 2.5, py + 1);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = "#232031";
      ctx.beginPath();
      ctx.arc(px, py - 1, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawPlayer(alpha, t) {
    const p = player;
    const px = lerpPos(p, alpha, "x") * TILE;
    const py = lerpPos(p, alpha, "y") * TILE;

    let dieK = 0;
    if (state === "dying") dieK = 1 - stateTimer / DEATH_DUR;
    if (state === "gameover") dieK = 1;

    const flick = 0.92 + 0.06 * Math.sin(t * 7.3) + 0.03 * Math.sin(t * 23.1);
    const glowR = TILE * 2.6 * flick * (1 - dieK * 0.95);
    if (glowR > 2) drawGlow(px, py, glowR, 0.75 * (1 - dieK * 0.7));

    ctx.save();
    ctx.translate(px, py + dieK * 6);
    ctx.globalAlpha = 1 - dieK * 0.85;
    ctx.rotate(dieK * 1.8);
    ctx.scale(1 - dieK * 0.5, 1 - dieK * 0.5);

    const f = p.face;
    const bob = p.dir ? Math.sin(p.walkPhase * 2) * 0.9 : 0;

    /* staff + lamp held toward facing */
    const lx = f.dx * 7, ly = f.dy * 7 - 3;
    ctx.strokeStyle = "#5a4632";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.lineTo(lx, ly + 4);
    ctx.stroke();
    ctx.fillStyle = "#2e2620";
    ctx.fillRect(lx - 2.5, ly - 2, 5, 6);
    ctx.fillStyle = "#ffe1a2";
    ctx.beginPath();
    ctx.arc(lx, ly + 1, 1.8, 0, Math.PI * 2);
    ctx.fill();
    drawGlow(lx, ly + 1, 6, 0.5 * (1 - dieK));

    /* legs */
    if (p.dir) {
      const lp = Math.sin(p.walkPhase * 4) * 2.5;
      ctx.strokeStyle = "#1a212e";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-1.5, 5); ctx.lineTo(-1.5 + lp * f.dx * 0.4 - (f.dy !== 0 ? lp * 0.4 : 0), 9);
      ctx.moveTo(1.5, 5); ctx.lineTo(1.5 - lp * f.dx * 0.4 + (f.dy !== 0 ? lp * 0.4 : 0), 9);
      ctx.stroke();
    } else {
      ctx.strokeStyle = "#1a212e";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-1.5, 5); ctx.lineTo(-1.5, 9);
      ctx.moveTo(1.5, 5); ctx.lineTo(1.5, 9);
      ctx.stroke();
    }

    /* coat */
    ctx.fillStyle = "#232b3a";
    ctx.beginPath();
    ctx.moveTo(-4, -3 + bob * 0.3);
    ctx.lineTo(4, -3 + bob * 0.3);
    ctx.lineTo(5, 6);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    /* scarf accent */
    ctx.fillStyle = "#c96f3b";
    ctx.fillRect(-4, -4 + bob * 0.3, 8, 2);

    /* head + cap */
    ctx.fillStyle = "#e8c9a0";
    ctx.beginPath();
    ctx.arc(0, -7 + bob * 0.5, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2c3648";
    ctx.fillRect(-4.5, -10.5 + bob * 0.5, 9, 2.5);
    ctx.fillRect(-2.5, -13 + bob * 0.5, 5, 3);

    ctx.restore();
  }

  function rgba(c, a) {
    return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
  }

  function drawGloam(g, alpha, t) {
    const px = lerpPos(g, alpha, "x") * TILE;
    const py = lerpPos(g, alpha, "y") * TILE;

    let fade = 1;
    if (state === "dying") fade = Math.max(0, stateTimer / DEATH_DUR - 0.2);
    if (state === "gameover") fade = 0;
    if (fade <= 0.01) return;

    let col = g.rgb;
    if (g.fleeing) {
      const flashing = fleeTimer < 1.5 && Math.sin(t * 14) > 0;
      col = flashing ? FLEE_FLASH_RGB : FLEE_RGB;
    }
    const banished = g.state === "returning" || g.state === "descend";
    const s = t * 1.0 + g.kind * 13.7;
    const dirx = g.dir ? g.dir.dx : 0;
    const diry = g.dir ? g.dir.dy : 0;

    ctx.save();
    ctx.globalAlpha = fade;
    if (!banished) {
      /* drifting smoke: layered soft blobs trailing behind the motion */
      for (let j = 4; j >= 0; j--) {
        const ox = Math.sin(s * 1.7 + j * 2.1) * (2 + j * 0.9) - dirx * j * 2.4;
        const oy = Math.cos(s * 1.3 + j * 1.7) * (2 + j * 0.7) - diry * j * 2.4;
        const r = 9 - j * 1.2 + Math.sin(s * 2.3 + j) * 0.8;
        ctx.fillStyle = rgba(col, 0.30 - j * 0.045);
        ctx.beginPath();
        ctx.arc(px + ox, py + oy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    /* a single faint ember core (no eyes, nothing sheet-shaped) */
    const coreR = banished ? 2.2 : 3.2;
    const grad = ctx.createRadialGradient(px, py, 0.5, px, py, coreR * 2.4);
    grad.addColorStop(0, rgba(col.map((v) => Math.min(255, v + 90)), banished ? 0.7 : 0.9));
    grad.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, coreR * 2.4, 0, Math.PI * 2);
    ctx.fill();
    if (banished) {
      /* a wisp streaking home */
      ctx.strokeStyle = rgba(col, 0.35);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px - dirx * 3, py - diry * 3);
      ctx.lineTo(px - dirx * 12, py - diry * 12);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawDen(t) {
    const cx = (maze.denCenter.x + 0.5) * TILE;
    const cy = (maze.denCenter.y + 0.5) * TILE;
    ctx.save();
    for (let j = 0; j < 3; j++) {
      const ox = Math.sin(t * 0.7 + j * 2.4) * 8;
      const oy = Math.cos(t * 0.5 + j * 1.9) * 3;
      ctx.fillStyle = "rgba(122,100,182,0.05)";
      ctx.beginPath();
      ctx.arc(cx + ox, cy + oy, 16 + j * 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function render(alpha) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0d0f12";
    ctx.fillRect(0, 0, W, H);
    if (!maze) return;

    ctx.drawImage(mazeLayer, 0, 0, W, H);

    /* cool blue-black haze over everything unlit */
    ctx.fillStyle = "rgba(28,46,84,0.06)";
    ctx.fillRect(0, 0, W, H);

    /* warm light pooling along lit corridors */
    const pulse = state === "levelclear" ? 1 + 0.5 * Math.sin(time * 10) : 1;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const v = litGlow[idx(x, y)];
        if (!v) continue;
        ctx.fillStyle = "rgba(255,166,88," + (0.035 * v * pulse).toFixed(3) + ")";
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }

    drawDen(time);
    for (const l of maze.lanterns) drawLantern(l, time);
    for (const b of maze.braziers) drawBrazier(b, time);

    if (state !== "title") {
      for (const g of gloams) drawGloam(g, alpha, time);
      drawPlayer(alpha, time);
    }

    /* score popups */
    ctx.font = "bold 12px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "center";
    for (const p of popups) {
      const k = 1 - p.life / p.max;
      ctx.fillStyle = "rgba(255,210,140," + (1 - k).toFixed(2) + ")";
      ctx.fillText(p.text, p.x * TILE, p.y * TILE - 6 - k * 14);
    }

    /* vignette */
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.72);
    vg.addColorStop(0, "rgba(6,9,18,0)");
    vg.addColorStop(1, "rgba(6,9,18,0.42)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    /* state banners */
    if (state === "ready") {
      ctx.font = "bold 15px ui-monospace, Menlo, Consolas, monospace";
      ctx.fillStyle = "#ffb45e";
      ctx.fillText(readyLabel, W / 2, 15 * TILE + 8);
    } else if (state === "levelclear") {
      ctx.font = "bold 16px ui-monospace, Menlo, Consolas, monospace";
      ctx.fillStyle = "rgba(255,214,150," + (0.7 + 0.3 * Math.sin(time * 8)).toFixed(2) + ")";
      ctx.fillText("THE QUARTER IS LIT", W / 2, 15 * TILE + 8);
    }
  }

  /* ---------- hud / overlay ---------- */

  function updateHud() {
    el.score.textContent = String(score);
    el.best.textContent = String(Math.max(high, score));
    el.level.textContent = String(level);
    el.lamps.textContent = litCount + "/" + totalLamps;
    let dots = "";
    for (let i = 0; i < Math.max(0, lives); i++) dots += '<span class="life"></span>';
    el.lives.innerHTML = dots || '<span class="nolife">&mdash;</span>';
  }

  function showOverlay(title, sub, info, scoreText) {
    el.ovTitle.textContent = title;
    el.ovSub.innerHTML = sub;
    el.ovInfo.textContent = info;
    el.ovScore.innerHTML = scoreText || "";
    el.overlay.classList.add("show");
  }

  function hideOverlay() {
    el.overlay.classList.remove("show");
  }

  function showTitle() {
    showOverlay(
      "LAMPLIGHTER",
      "dusk has fallen &mdash; light every lantern in the quarter<br>" +
      "braziers turn the gloams pale: touch them while they flee",
      "press any key to begin",
      high ? "best " + high : ""
    );
  }

  function setPaused(v) {
    if (paused === v) return;
    paused = v;
    if (paused) {
      showOverlay("PAUSED", "the lamps hold their breath", "press P to continue", "");
    } else {
      hideOverlay();
      last = performance.now();
    }
  }

  function updateAudioBtn() {
    el.audioBtn.textContent = "sound: " + (sfx.enabled ? "on" : "off");
  }

  /* ---------- input ---------- */

  const KEYMAP = {
    ArrowUp: { dx: 0, dy: -1 }, KeyW: { dx: 0, dy: -1 },
    ArrowDown: { dx: 0, dy: 1 }, KeyS: { dx: 0, dy: 1 },
    ArrowLeft: { dx: -1, dy: 0 }, KeyA: { dx: -1, dy: 0 },
    ArrowRight: { dx: 1, dy: 0 }, KeyD: { dx: 1, dy: 0 },
  };

  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    sfx.unlock();

    if (e.code === "KeyM") {
      sfx.setEnabled(!sfx.enabled);
      updateAudioBtn();
      e.preventDefault();
      return;
    }
    if (e.code === "KeyP") {
      if (state !== "title" && state !== "gameover") setPaused(!paused);
      e.preventDefault();
      return;
    }

    if (state === "title" || state === "gameover") {
      newGame();
      e.preventDefault();
      return;
    }

    const d = KEYMAP[e.code];
    if (d) {
      if (!paused && (state === "playing" || state === "ready")) player.buf = d;
      e.preventDefault();
    }
  });

  el.audioBtn.addEventListener("click", () => {
    sfx.unlock();
    sfx.setEnabled(!sfx.enabled);
    updateAudioBtn();
  });

  canvas.addEventListener("pointerdown", () => {
    sfx.unlock();
    if (state === "title" || state === "gameover") newGame();
  });

  window.addEventListener("blur", () => {
    if (state !== "title" && state !== "gameover") setPaused(true);
  });

  /* ---------- guarded test handle ----------
     Inert unless the page set window.__LAMPLIGHTER_TEST__ before this
     script loaded (the committed test suite does that via CDP). */

  if (window.__LAMPLIGHTER_TEST__) {
    window.__lamplighter = {
      snapshot() {
        return {
          state, paused, score, high, lives, level, litCount, totalLamps,
          mode, modeClock, fleeTimer, banishCombo,
          player: { x: player.x, y: player.y, dir: player.dir, buf: player.buf, face: player.face },
          gloams: gloams.map((g) => ({ x: g.x, y: g.y, state: g.state, fleeing: g.fleeing })),
        };
      },
      mazeInfo() {
        return {
          spawn: maze.spawn,
          grid: maze.grid,
          lanterns: maze.lanterns.map((l) => ({ x: l.x, y: l.y, lit: !!l.lit })),
          braziers: maze.braziers.map((b) => ({ x: b.x, y: b.y, lit: !!b.lit })),
        };
      },
      setPlayer(x, y) {
        player.x = x; player.y = y;
        player.prevX = x; player.prevY = y;
        player.dir = null; player.buf = null;
      },
      setGloam(i, patch) {
        const g = gloams[i];
        for (const k of Object.keys(patch)) g[k] = patch[k];
        g.prevX = g.x; g.prevY = g.y;
      },
      setLives(n) { lives = n; updateHud(); },
      setMode(m) { mode = m; },
      glowAt(x, y) { return litGlow[idx(((x % COLS) + COLS) % COLS, y)]; },
      clearFlee() { fleeTimer = 0; for (const g of gloams) g.fleeing = false; },
      target(i) { return gloamTarget(gloams[i]); },
      playerSpeed() { return playerSpeed(); },
      gloamSpeed(i) { return gloamSpeed(gloams[i]); },
      lightAllButOne() {
        const all = maze.lanterns.concat(maze.braziers);
        const unlit = all.filter((o) => !o.lit);
        for (let i = 0; i < unlit.length - 1; i++) {
          unlit[i].lit = true; litCount++; applyGlow(unlit[i]);
        }
        updateHud();
        const lastOne = unlit[unlit.length - 1];
        return { x: lastOne.x, y: lastOne.y };
      },
    };
  }

  /* ---------- boot ---------- */

  buildGlowSprite();
  /* pre-generate a maze so the title screen has a backdrop */
  (function bootBackdrop() {
    const rng = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0);
    maze = generateMaze(rng);
    lanternAt = new Array(COLS * ROWS).fill(null);
    brazierAt = new Array(COLS * ROWS).fill(null);
    for (const l of maze.lanterns) { l.lit = false; lanternAt[idx(l.x, l.y)] = l; }
    for (const b of maze.braziers) { b.lit = false; brazierAt[idx(b.x, b.y)] = b; }
    litGlow = new Uint8Array(COLS * ROWS);
    litCount = 0;
    totalLamps = maze.lanterns.length + maze.braziers.length;
    buildMazeLayer();
    /* light a few lanterns for atmosphere */
    for (let i = 0; i < maze.lanterns.length; i += 7) {
      const l = maze.lanterns[i];
      l.lit = true;
      applyGlow(l);
    }
  })();

  updateHud();
  updateAudioBtn();
  showTitle();
  requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });
})();

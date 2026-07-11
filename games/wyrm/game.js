"use strict";

/* ================= Wyrm — grid snake =================
 * Discrete fixed-timestep logic ticks (accumulator pattern);
 * rendering interpolates between the last two grid states.
 */

(function () {
  // ---- constants ----------------------------------------------------------
  const COLS = 26;
  const ROWS = 22;
  const CELL = 26;                 // logical px per cell
  const BASE_TPS = 8;              // logic ticks per second at start
  const MAX_TPS = 15;
  const TPS_PER_FOOD = 0.28;       // speed ramp per food eaten (i.e. per length)
  const START_LEN = 4;
  const QUEUE_MAX = 2;             // buffered direction changes per tick window
  const LS = (k) => "arcade.wyrm." + k;

  const DIRS = {
    up:    { x: 0, y: -1 },
    down:  { x: 0, y: 1 },
    left:  { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };
  const KEYMAP = {
    ArrowUp: "up",    KeyW: "up",
    ArrowDown: "down", KeyS: "down",
    ArrowLeft: "left", KeyA: "left",
    ArrowRight: "right", KeyD: "right",
  };

  // ---- DOM ----------------------------------------------------------------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const elScore = document.getElementById("score");
  const elBest = document.getElementById("best");
  const elLength = document.getElementById("length");
  const elSpeed = document.getElementById("speed");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlaySub = document.getElementById("overlay-sub");
  const overlayScore = document.getElementById("overlay-score");
  const audioBtn = document.getElementById("audio-toggle");

  // crisp canvas at device pixel ratio
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = COLS * CELL * DPR;
  canvas.height = ROWS * CELL * DPR;
  canvas.style.width = COLS * CELL + "px";
  canvas.style.aspectRatio = COLS + " / " + ROWS;
  ctx.scale(DPR, DPR);

  // ---- tiny synth ---------------------------------------------------------
  let audioOn = localStorage.getItem(LS("audio")) !== "off";
  let actx = null;

  function ensureAudio() { // call only from user-gesture handlers
    if (!actx) {
      try { actx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (_) { actx = null; }
    }
    if (actx && actx.state === "suspended") actx.resume();
  }

  function blip(freq, dur, type, gain, slide) {
    if (!audioOn || !actx || actx.state !== "running") return;
    const t = actx.currentTime;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(gain || 0.08, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noiseBurst(dur, gain) {
    if (!audioOn || !actx || actx.state !== "running") return;
    const t = actx.currentTime;
    const n = Math.floor(actx.sampleRate * dur);
    const buf = actx.createBuffer(1, n, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = actx.createBufferSource();
    src.buffer = buf;
    const f = actx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(1600, t);
    f.frequency.exponentialRampToValueAtTime(120, t + dur);
    const g = actx.createGain();
    g.gain.setValueAtTime(gain || 0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(actx.destination);
    src.start(t);
  }

  function sfxEat(len) {
    const p = 340 + Math.min(len, 40) * 14; // pitch climbs as the wyrm grows
    blip(p, 0.09, "square", 0.07, p * 1.6);
    blip(p * 2, 0.06, "sine", 0.04);
  }
  function sfxDie() {
    noiseBurst(0.45, 0.2);
    blip(220, 0.5, "sawtooth", 0.06, 55);
  }
  function sfxStart() { blip(240, 0.1, "triangle", 0.06, 480); }

  function setAudioLabel() {
    audioBtn.textContent = "sound: " + (audioOn ? "on" : "off");
  }
  audioBtn.addEventListener("click", () => {
    audioOn = !audioOn;
    localStorage.setItem(LS("audio"), audioOn ? "on" : "off");
    if (audioOn) { ensureAudio(); blip(600, 0.06, "sine", 0.05); }
    setAudioLabel();
    audioBtn.blur();
  });
  setAudioLabel();

  // ---- game state ---------------------------------------------------------
  let state = "menu";        // menu | playing | paused | dying | over
  let snake = [];            // head first, {x,y}
  let prevSnake = [];        // per-segment previous cell, for interpolation
  let dir = DIRS.right;      // direction applied on the last tick
  let dirQueue = [];         // buffered direction names, max QUEUE_MAX
  let food = { x: 0, y: 0 };
  let foodEaten = 0;
  let score = 0;
  let best = parseInt(localStorage.getItem(LS("best")), 10) || 0;
  let accumulator = 0;
  let lastTime = 0;
  let dieTimer = 0;
  let shake = 0;
  let particles = [];
  let eatFlash = 0;          // brief glow boost after eating

  function tps() {
    return Math.min(MAX_TPS, BASE_TPS + foodEaten * TPS_PER_FOOD);
  }
  function tickMs() { return 1000 / tps(); }

  function updateHud() {
    elScore.textContent = score;
    elBest.textContent = best;
    elLength.textContent = snake.length;
    elSpeed.textContent = (tps() / BASE_TPS).toFixed(1) + "x";
  }

  function resetGame() {
    const cy = Math.floor(ROWS / 2);
    const cx = Math.floor(COLS / 2) - 2;
    snake = [];
    for (let i = 0; i < START_LEN; i++) snake.push({ x: cx - i, y: cy });
    prevSnake = snake.map((s) => ({ x: s.x, y: s.y }));
    dir = DIRS.right;
    dirQueue = [];
    foodEaten = 0;
    score = 0;
    accumulator = 0;
    particles = [];
    shake = 0;
    eatFlash = 0;
    spawnFood();
    updateHud();
  }

  // Food spawns uniformly over FREE cells only — never on the snake.
  function spawnFood() {
    const occupied = new Set(snake.map((s) => s.y * COLS + s.x));
    const free = [];
    for (let i = 0; i < COLS * ROWS; i++) if (!occupied.has(i)) free.push(i);
    if (free.length === 0) { win(); return; }
    const i = free[Math.floor(Math.random() * free.length)];
    food = { x: i % COLS, y: Math.floor(i / COLS) };
  }

  // ---- input --------------------------------------------------------------
  function queueDirection(name) {
    if (dirQueue.length >= QUEUE_MAX) return;
    // Reversal check is against the LAST QUEUED direction, not the current
    // one — otherwise two fast taps (e.g. up,left,down while moving right)
    // would slip a 180 past the guard and the wyrm would bite its own neck.
    const refName = dirQueue.length
      ? dirQueue[dirQueue.length - 1]
      : dirNameOf(dir);
    const ref = DIRS[refName];
    const next = DIRS[name];
    if (next.x === -ref.x && next.y === -ref.y) return; // 180° — rejected
    if (next.x === ref.x && next.y === ref.y) return;   // no-op
    dirQueue.push(name);
  }

  function dirNameOf(d) {
    for (const k in DIRS) if (DIRS[k].x === d.x && DIRS[k].y === d.y) return k;
    return "right";
  }

  window.addEventListener("keydown", (e) => {
    const dirName = KEYMAP[e.code];
    if (dirName) e.preventDefault();
    ensureAudio();

    if (state === "menu") {
      if (dirName) {
        resetGame();
        if (dirName !== "left") { dirQueue = [dirName]; } // start facing right
        startPlaying();
      } else if (e.code === "Space" || e.code === "Enter") {
        resetGame();
        startPlaying();
      }
      return;
    }

    if (state === "over") {
      // instant restart on any (non-modifier) key
      if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
      resetGame();
      if (dirName && dirName !== "left") dirQueue = [dirName];
      startPlaying();
      return;
    }

    if (e.code === "KeyM") {
      audioBtn.click();
      return;
    }

    if (e.code === "KeyP" || e.code === "Escape") {
      if (state === "playing") pauseGame();
      else if (state === "paused") resumeGame();
      return;
    }

    if (state === "paused") {
      resumeGame();
      if (dirName) queueDirection(dirName);
      return;
    }

    if (state === "playing" && dirName) queueDirection(dirName);
  });

  window.addEventListener("blur", () => {
    if (state === "playing") pauseGame();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state === "playing") pauseGame();
  });

  // ---- state transitions --------------------------------------------------
  function startPlaying() {
    state = "playing";
    overlay.className = "";
    sfxStart();
    updateHud();
  }

  function pauseGame() {
    state = "paused";
    overlay.className = "show";
    overlayTitle.textContent = "PAUSED";
    overlaySub.textContent = "press P to resume";
    overlayScore.textContent = "";
  }

  function resumeGame() {
    state = "playing";
    overlay.className = "";
    lastTime = performance.now(); // don't let paused time pile into the accumulator
  }

  function die() {
    state = "dying";
    dieTimer = 700;
    shake = 9;
    sfxDie();
    for (const s of snake) {
      spawnParticles(s.x, s.y, 2, "255, 107, 107");
    }
    if (score > best) {
      best = score;
      localStorage.setItem(LS("best"), String(best));
    }
    updateHud();
  }

  function gameOver(title) {
    state = "over";
    overlay.className = "show dead";
    overlayTitle.textContent = title || "DEVOURED";
    overlaySub.textContent = "press any key to slither again";
    overlayScore.textContent =
      "score " + score + (score >= best && score > 0 ? "  —  new best!" : "  ·  best " + best);
  }

  function win() {
    // The wyrm filled the entire board — no free cell for food.
    if (score > best) {
      best = score;
      localStorage.setItem(LS("best"), String(best));
    }
    state = "over";
    overlay.className = "show";
    overlayTitle.textContent = "ASCENDED";
    overlaySub.textContent = "the wyrm fills the world — press any key";
    overlayScore.textContent = "score " + score;
  }

  // ---- logic tick ---------------------------------------------------------
  function tick() {
    // one buffered turn is consumed per tick
    if (dirQueue.length) dir = DIRS[dirQueue.shift()];

    const head = snake[0];
    const nx = head.x + dir.x;
    const ny = head.y + dir.y;

    // wall collision
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) { die(); return; }

    const eating = nx === food.x && ny === food.y;

    // Self collision: movement is push-head + pop-tail in the SAME tick, so
    // when not growing the tail cell vacates this tick — stepping into it is
    // legal. We therefore exclude the tail segment from the check unless the
    // wyrm is growing (eating), in which case the tail stays put.
    const checkLen = eating ? snake.length : snake.length - 1;
    for (let i = 0; i < checkLen; i++) {
      if (snake[i].x === nx && snake[i].y === ny) { die(); return; }
    }

    // snapshot for render interpolation
    const old = snake.map((s) => ({ x: s.x, y: s.y }));

    // push head; pop tail unless growing
    snake.unshift({ x: nx, y: ny });
    if (eating) {
      // base points + a small bonus that scales with the speed at bite time
      const speedBonus = Math.round((tps() - BASE_TPS) * 3);
      score += 10 + speedBonus;
      foodEaten++;
      eatFlash = 1;
      sfxEat(snake.length);
      spawnParticles(food.x, food.y, 12, "255, 171, 94");
      spawnFood();
    } else {
      snake.pop();
    }

    // each drawn segment slides from where THAT index was last tick
    prevSnake = snake.map((s, i) => (old[i] ? old[i] : { x: s.x, y: s.y }));

    updateHud();
  }

  // ---- particles ----------------------------------------------------------
  function spawnParticles(cx, cy, n, rgb) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 30 + Math.random() * 90;
      particles.push({
        x: (cx + 0.5) * CELL,
        y: (cy + 0.5) * CELL,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 1,
        decay: 1.8 + Math.random() * 1.5,
        rgb,
      });
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
      p.life -= p.decay * dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  // ---- rendering ----------------------------------------------------------
  function lerp(a, b, t) { return a + (b - a) * t; }

  function render(alpha, now) {
    ctx.save();
    if (shake > 0.2) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    // board
    ctx.fillStyle = "#0d0f12";
    ctx.fillRect(-12, -12, COLS * CELL + 24, ROWS * CELL + 24);
    ctx.strokeStyle = "rgba(126, 231, 135, 0.045)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < COLS; x++) {
      ctx.moveTo(x * CELL + 0.5, 0);
      ctx.lineTo(x * CELL + 0.5, ROWS * CELL);
    }
    for (let y = 1; y < ROWS; y++) {
      ctx.moveTo(0, y * CELL + 0.5);
      ctx.lineTo(COLS * CELL, y * CELL + 0.5);
    }
    ctx.stroke();

    // food: pulsing ember
    if (state !== "over") {
      const pulse = 0.78 + 0.22 * Math.sin(now / 210);
      const fx = (food.x + 0.5) * CELL;
      const fy = (food.y + 0.5) * CELL;
      ctx.save();
      ctx.shadowColor = "rgba(255, 171, 94, 0.9)";
      ctx.shadowBlur = 16 * pulse;
      ctx.fillStyle = "#ffab5e";
      ctx.beginPath();
      ctx.arc(fx, fy, CELL * 0.3 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255, 236, 200, 0.95)";
      ctx.beginPath();
      ctx.arc(fx - CELL * 0.07, fy - CELL * 0.07, CELL * 0.09, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // snake — interpolated between prev and current grid cells
    const t = state === "playing" ? alpha : 1; // freeze mid-cell motion when not running
    const dying = state === "dying" || state === "over";
    const flicker = dying ? (Math.sin(now / 45) > 0 ? 1 : 0.35) : 1;
    const n = snake.length;

    for (let i = n - 1; i >= 0; i--) {
      const px = lerp(prevSnake[i].x, snake[i].x, t) * CELL;
      const py = lerp(prevSnake[i].y, snake[i].y, t) * CELL;
      const taper = 1 - (i / Math.max(n, 8)) * 0.35; // slimmer toward the tail
      const size = CELL * 0.82 * taper;
      const off = (CELL - size) / 2;
      const isHead = i === 0;

      const glowBase = isHead ? 14 : 7;
      ctx.shadowColor = dying
        ? "rgba(255, 107, 107, 0.8)"
        : "rgba(126, 231, 135, " + (0.5 + eatFlash * 0.5) + ")";
      ctx.shadowBlur = (glowBase + eatFlash * 10) * flicker;

      if (dying) {
        ctx.fillStyle = "rgba(255, 107, 107, " + (0.85 * flicker) + ")";
      } else if (isHead) {
        ctx.fillStyle = "#b8f5bd";
      } else {
        const fade = 1 - (i / n) * 0.55;
        ctx.fillStyle = "rgba(126, 231, 135, " + fade.toFixed(3) + ")";
      }

      roundRect(px + off, py + off, size, size, size * 0.3);
      ctx.fill();

      // eyes on the head, offset toward travel direction
      if (isHead && !dying) {
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#0d0f12";
        const ex = dir.x, ey = dir.y;
        const cx0 = px + CELL / 2, cy0 = py + CELL / 2;
        const fwd = CELL * 0.16, side = CELL * 0.16, r = CELL * 0.075;
        ctx.beginPath();
        ctx.arc(cx0 + ex * fwd - ey * side, cy0 + ey * fwd + ex * side, r, 0, Math.PI * 2);
        ctx.arc(cx0 + ex * fwd + ey * side, cy0 + ey * fwd - ex * side, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.shadowBlur = 0;

    // particles
    for (const p of particles) {
      ctx.fillStyle = "rgba(" + p.rgb + ", " + Math.max(p.life, 0).toFixed(3) + ")";
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }

    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---- main loop: fixed-timestep logic, interpolated render ---------------
  function frame(now) {
    if (!lastTime) lastTime = now;
    let dt = now - lastTime;
    lastTime = now;
    if (dt > 250) dt = 250; // clamp huge tab-away gaps

    if (state === "playing") {
      accumulator += dt;
      const step = tickMs(); // re-read each drain: speed ramps as the wyrm grows
      let safety = 8;
      while (accumulator >= step && state === "playing" && safety-- > 0) {
        accumulator -= step;
        tick();
      }
      if (safety <= 0) accumulator = 0;
    } else if (state === "dying") {
      dieTimer -= dt;
      if (dieTimer <= 0) gameOver();
    }

    shake = Math.max(0, shake - dt * 0.02);
    eatFlash = Math.max(0, eatFlash - dt * 0.004);
    updateParticles(dt / 1000);

    render(Math.min(accumulator / tickMs(), 1), now);
    requestAnimationFrame(frame);
  }

  // ---- boot ---------------------------------------------------------------
  resetGame();
  overlay.className = "show";
  overlayTitle.textContent = "WYRM";
  overlaySub.textContent = "press any direction to slither";
  overlayScore.textContent = best > 0 ? "best " + best : "";
  requestAnimationFrame(frame);
})();

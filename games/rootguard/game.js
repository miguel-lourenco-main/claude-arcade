"use strict";

/* ================= Rootguard — lane defense shell =================
 * All rules live in logic.js (window.RootguardLogic). This file owns the
 * DOM, canvas rendering, Web Audio synth, input, overlays and persistence.
 * Fixed-timestep simulation (60 ticks/s) via the accumulator pattern.
 */

(function () {
  const L = window.RootguardLogic;
  const LANES = L.LANES;
  const COLS = L.COLS;
  const LS = (k) => "arcade.rootguard." + k;

  // field geometry (logical px)
  const SURGE_W = 46;
  const CELL_W = 72;
  const CELL_H = 74;
  const RIGHT_M = 26;
  const W = SURGE_W + COLS * CELL_W + RIGHT_M;   // 720
  const H = LANES * CELL_H;                      // 370
  const DT = 1 / 60;

  // ---- DOM ------------------------------------------------------------------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const elDew = document.getElementById("dew");
  const elLevelName = document.getElementById("level-name");
  const waveBar = document.getElementById("wave-bar");
  const waveFill = document.getElementById("wave-fill");
  const seedbar = document.getElementById("seedbar");
  const banner = document.getElementById("banner");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlaySub = document.getElementById("overlay-sub");
  const overlayExtra = document.getElementById("overlay-extra");
  const audioBtn = document.getElementById("audio-toggle");

  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  canvas.style.width = W + "px";
  canvas.style.aspectRatio = W + " / " + H;
  ctx.scale(DPR, DPR);

  const fx = (cellX) => SURGE_W + cellX * CELL_W;       // cell-units -> px
  const fy = (laneY) => laneY * CELL_H;

  // ---- tiny synth -------------------------------------------------------------
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
    g.gain.setValueAtTime(gain || 0.07, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noiseBurst(dur, gain, from, to) {
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
    f.frequency.setValueAtTime(from || 1400, t);
    f.frequency.exponentialRampToValueAtTime(to || 130, t + dur);
    const g = actx.createGain();
    g.gain.setValueAtTime(gain || 0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(actx.destination);
    src.start(t);
  }

  const sfx = {
    plant()  { blip(150, 0.1, "triangle", 0.09, 90); noiseBurst(0.08, 0.06, 900, 200); },
    shovel() { noiseBurst(0.12, 0.1, 1200, 300); },
    thorn()  { blip(880, 0.05, "square", 0.035, 660); },
    frost()  { blip(1250, 0.07, "sine", 0.045, 1600); },
    lob()    { blip(300, 0.12, "sine", 0.05, 170); },
    splat()  { noiseBurst(0.1, 0.09, 800, 250); },
    chomp()  { noiseBurst(0.06, 0.09, 700, 300); blip(140, 0.07, "sawtooth", 0.04, 90); },
    clink()  { blip(2100, 0.05, "square", 0.045, 1500); },
    die()    { noiseBurst(0.16, 0.08, 500, 120); blip(190, 0.14, "sawtooth", 0.03, 80); },
    plantDie(){ noiseBurst(0.2, 0.1, 900, 150); },
    boom()   { noiseBurst(0.5, 0.24, 1600, 60); blip(90, 0.4, "sawtooth", 0.07, 40); },
    surge()  { noiseBurst(0.55, 0.2, 300, 2400); blip(220, 0.5, "sine", 0.07, 880); },
    mote()   { blip(1180, 0.08, "sine", 0.06, 1560); blip(1560, 0.1, "sine", 0.04); },
    produce(){ blip(920, 0.07, "sine", 0.035, 1180); },
    lose()   { blip(220, 0.5, "sawtooth", 0.07, 60); noiseBurst(0.6, 0.16, 800, 60); },
    win()    { blip(520, 0.12, "triangle", 0.06); setTimeout(() => blip(660, 0.12, "triangle", 0.06), 120);
               setTimeout(() => blip(880, 0.22, "triangle", 0.07), 240); },
    click()  { blip(600, 0.05, "sine", 0.04); },
  };

  function setAudioLabel() {
    audioBtn.textContent = "sound: " + (audioOn ? "on" : "off");
  }
  audioBtn.addEventListener("click", () => {
    audioOn = !audioOn;
    localStorage.setItem(LS("audio"), audioOn ? "on" : "off");
    if (audioOn) { ensureAudio(); sfx.click(); }
    setAudioLabel();
    audioBtn.blur();
  });
  setAudioLabel();

  // ---- persistence ---------------------------------------------------------------
  function getProgress() {
    const n = parseInt(localStorage.getItem(LS("progress")), 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(L.LEVELS.length, n)) : 0;
  }
  function setProgress(n) {
    localStorage.setItem(LS("progress"), String(n));
  }

  // ---- UI state ---------------------------------------------------------------------
  let mode = "menu";        // menu | playing | paused | won | lost
  let game = null;          // logic state from L.createGame
  let selected = null;      // plant type | "shovel" | null
  let hover = null;         // {lane, col} | null
  let accumulator = 0;
  let lastTime = 0;
  let shake = 0;
  let particles = [];
  let laneFlash = [0, 0, 0, 0, 0];
  let hitFlash = {};        // blight id -> flash timer
  let plantHit = {};        // "lane,col" -> flash timer
  let bannerTimer = null;
  let cardEls = {};         // type -> button element

  // ---- seed bar ------------------------------------------------------------------------
  function buildSeedbar() {
    seedbar.innerHTML = "";
    cardEls = {};
    const unlocked = L.LEVELS[game.levelIndex].plants;
    const types = L.PLANT_ORDER.filter((t) => unlocked.indexOf(t) >= 0);
    for (const type of types) {
      const def = L.PLANTS[type];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "seed-card";
      btn.dataset.type = type;
      btn.title = def.name + " — " + def.blurb;
      const icon = document.createElement("canvas");
      icon.className = "icon";
      icon.width = 46; icon.height = 30;
      const g = icon.getContext("2d");
      drawPlant(g, type, 23, 17, 30, 0, 1);
      const cost = document.createElement("span");
      cost.className = "cost";
      cost.textContent = def.cost;
      const nm = document.createElement("span");
      nm.className = "cname";
      nm.textContent = def.name.toLowerCase();
      const cd = document.createElement("div");
      cd.className = "cd-mask";
      btn.appendChild(icon); btn.appendChild(cost); btn.appendChild(nm); btn.appendChild(cd);
      btn.addEventListener("click", () => { ensureAudio(); selectCard(type); });
      seedbar.appendChild(btn);
      cardEls[type] = btn;
    }
    // the shovel
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "seed-card shovel";
    btn.dataset.type = "shovel";
    btn.title = "Shovel — dig up a defender (no refund)";
    const icon = document.createElement("canvas");
    icon.className = "icon";
    icon.width = 46; icon.height = 30;
    drawShovelIcon(icon.getContext("2d"));
    const cost = document.createElement("span");
    cost.className = "cost";
    cost.textContent = "dig";
    const nm = document.createElement("span");
    nm.className = "cname";
    nm.textContent = "shovel";
    btn.appendChild(icon); btn.appendChild(cost); btn.appendChild(nm);
    btn.addEventListener("click", () => { ensureAudio(); selectCard("shovel"); });
    seedbar.appendChild(btn);
    cardEls.shovel = btn;
  }

  function selectCard(type) {
    if (mode !== "playing") return;
    if (type !== "shovel") {
      const def = L.PLANTS[type];
      if (!def) return;
      if (game.dew < def.cost || (game.cooldowns[type] || 0) > 0) return;
    }
    selected = selected === type ? null : type;
    sfx.click();
    refreshCards();
  }

  function refreshCards() {
    for (const type in cardEls) {
      const btn = cardEls[type];
      if (type === "shovel") {
        btn.disabled = mode !== "playing";
        btn.classList.toggle("selected", selected === "shovel");
        continue;
      }
      const def = L.PLANTS[type];
      const cd = game ? (game.cooldowns[type] || 0) : 0;
      const poor = !game || game.dew < def.cost;
      btn.disabled = mode !== "playing" || poor || cd > 0;
      btn.classList.toggle("selected", selected === type);
      const mask = btn.querySelector(".cd-mask");
      mask.style.height = cd > 0 ? ((cd / def.cooldown) * 100).toFixed(1) + "%" : "0%";
    }
  }

  // ---- wave bar ------------------------------------------------------------------------
  let waveScale = 1;
  function buildWaveBar() {
    for (const m of waveBar.querySelectorAll(".wave-mark")) m.remove();
    const level = L.LEVELS[game.levelIndex];
    waveScale = game.duration + 8;
    for (const w of level.waves) {
      const m = document.createElement("div");
      m.className = "wave-mark" + (w.final ? " final" : "");
      m.style.left = ((w.at / waveScale) * 100).toFixed(2) + "%";
      waveBar.appendChild(m);
    }
  }

  // ---- overlays ---------------------------------------------------------------------------
  function clearExtra() { overlayExtra.innerHTML = ""; }

  function showMenu() {
    mode = "menu";
    game = null;
    selected = null;
    seedbar.innerHTML = "";
    elLevelName.textContent = "—";
    waveFill.style.width = "0%";
    for (const m of waveBar.querySelectorAll(".wave-mark")) m.remove();
    overlay.className = "show";
    overlayTitle.textContent = "ROOTGUARD";
    overlaySub.textContent = "defend the grove from the shambling blights";
    clearExtra();
    const progress = getProgress();
    L.LEVELS.forEach((lv, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "level-btn";
      btn.dataset.level = i;
      btn.disabled = i > progress;
      const name = document.createElement("span");
      name.textContent = (i + 1) + " · " + lv.name;
      const tag = document.createElement("span");
      tag.className = "tag" + (i < progress ? " cleared" : "");
      tag.textContent = i < progress ? "cleared" : (i > progress ? "locked" : "ready");
      btn.appendChild(name); btn.appendChild(tag);
      btn.addEventListener("click", () => { ensureAudio(); startLevel(i); });
      overlayExtra.appendChild(btn);
    });
  }

  function startLevel(i) {
    game = L.createGame(i, Math.random);
    mode = "playing";
    selected = null;
    hover = null;
    particles = [];
    laneFlash = [0, 0, 0, 0, 0];
    hitFlash = {};
    plantHit = {};
    accumulator = 0;
    lastTime = 0;
    shake = 0;
    banner.classList.remove("show");
    overlay.className = "";
    elLevelName.textContent = (i + 1) + " · " + L.LEVELS[i].name;
    buildSeedbar();
    buildWaveBar();
    refreshHud();
    refreshCards();
  }

  function pauseGame() {
    if (mode !== "playing") return;
    mode = "paused";
    overlay.className = "show";
    overlayTitle.textContent = "PAUSED";
    overlaySub.textContent = "press P to resume";
    clearExtra();
    refreshCards();
  }

  function resumeGame() {
    if (mode !== "paused") return;
    mode = "playing";
    overlay.className = "";
    lastTime = 0; // don't let paused time pile into the accumulator
    refreshCards();
  }

  function onLost() {
    mode = "lost";
    selected = null;
    shake = 10;
    sfx.lose();
    overlay.className = "show dead";
    overlayTitle.textContent = "OVERRUN";
    overlaySub.textContent = "the blights breached twice — press any key to replant";
    clearExtra();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "action-btn";
    btn.id = "btn-replay";
    btn.textContent = "replant this level";
    btn.addEventListener("click", () => { ensureAudio(); startLevel(game.levelIndex); });
    overlayExtra.appendChild(btn);
    refreshCards();
  }

  function onWon() {
    mode = "won";
    selected = null;
    sfx.win();
    const idx = game.levelIndex;
    if (idx + 1 > getProgress()) setProgress(idx + 1);
    overlay.className = "show";
    overlayTitle.textContent = "GROVE HELD";
    overlaySub.textContent = idx + 1 < L.LEVELS.length
      ? "the last blight has fallen"
      : "all five groves stand — the blight is broken";
    clearExtra();
    if (idx + 1 < L.LEVELS.length) {
      const next = document.createElement("button");
      next.type = "button";
      next.className = "action-btn";
      next.id = "btn-next";
      next.textContent = "next level: " + L.LEVELS[idx + 1].name;
      next.addEventListener("click", () => { ensureAudio(); startLevel(idx + 1); });
      overlayExtra.appendChild(next);
    }
    const replay = document.createElement("button");
    replay.type = "button";
    replay.className = "action-btn";
    replay.id = "btn-replay";
    replay.textContent = "replay level";
    replay.addEventListener("click", () => { ensureAudio(); startLevel(idx); });
    overlayExtra.appendChild(replay);
    const levels = document.createElement("button");
    levels.type = "button";
    levels.className = "action-btn";
    levels.id = "btn-levels";
    levels.textContent = "level select";
    levels.addEventListener("click", () => { ensureAudio(); showMenu(); });
    overlayExtra.appendChild(levels);
    refreshCards();
  }

  // ---- HUD --------------------------------------------------------------------------------
  function refreshHud() {
    if (!game) return;
    elDew.textContent = game.dew;
    waveFill.style.width = (Math.min(game.time / waveScale, 1) * 100).toFixed(2) + "%";
  }

  // ---- logic events -> sfx + particles ------------------------------------------------------
  function drainEvents(silent) {
    if (!game) return;
    for (const e of game.events) {
      if (silent) continue;
      switch (e.t) {
        case "plant": sfx.plant(); puff(fx(e.col + 0.5), fy(e.lane + 0.7), 8, "143, 227, 136"); break;
        case "shovel": sfx.shovel(); puff(fx(e.col + 0.5), fy(e.lane + 0.6), 8, "160, 130, 90"); break;
        case "shot": e.kind === "frost" ? sfx.frost() : e.kind === "lob" ? sfx.lob() : sfx.thorn(); break;
        case "hit": hitFlash[e.id] = 0.12; puff(fx(e.x), fy(e.lane + 0.45), 3, "200, 240, 190"); break;
        case "clink": sfx.clink(); puff(fx(e.x), fy(e.lane + 0.3), 6, "216, 210, 196"); break;
        case "chomp": sfx.chomp(); puff(fx(e.x - 0.3), fy(e.lane + 0.5), 3, "143, 227, 136"); break;
        case "die": sfx.die(); puff(fx(e.x), fy(e.lane + 0.5), 12, "177, 156, 217"); break;
        case "plantDie": sfx.plantDie(); puff(fx(e.col + 0.5), fy(e.lane + 0.5), 12, "110, 160, 100"); break;
        case "boom": sfx.boom(); shake = 12; puff(fx(e.col + 0.5), fy(e.lane + 0.5), 34, "255, 171, 94"); break;
        case "splat": sfx.splat(); puff(fx(e.x), fy(e.lane + 0.5), 10, "181, 140, 240"); break;
        case "surge": sfx.surge(); laneFlash[e.lane] = 1; shake = 8; break;
        case "breach": shake = 12; break;
        case "mote": sfx.mote(); puff(fx(e.x), fy(e.y), 8, "255, 217, 122"); break;
        case "produce": sfx.produce(); break;
        case "banner":
          banner.classList.add("show");
          if (bannerTimer) clearTimeout(bannerTimer);
          bannerTimer = setTimeout(() => banner.classList.remove("show"), 3200);
          break;
      }
    }
    game.events.length = 0;
  }

  function postLogic() {
    if (!game) return;
    if (mode !== "playing" && mode !== "paused") return;
    if (game.status === "lost") onLost();
    else if (game.status === "won") onWon();
  }

  // ---- particles ------------------------------------------------------------------------------
  function puff(px, py, n, rgb) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 25 + Math.random() * 95;
      particles.push({
        x: px, y: py,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 25,
        life: 1,
        decay: 1.6 + Math.random() * 1.6,
        rgb: rgb,
      });
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.9;
      p.vy = p.vy * 0.9 + 60 * dt;
      p.life -= p.decay * dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  // ---- input: canvas ----------------------------------------------------------------------------
  function canvasPoint(ev) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left) * (W / r.width),
      y: (ev.clientY - r.top) * (H / r.height),
    };
  }

  canvas.addEventListener("mousemove", (ev) => {
    const p = canvasPoint(ev);
    const col = Math.floor((p.x - SURGE_W) / CELL_W);
    const lane = Math.floor(p.y / CELL_H);
    hover = (col >= 0 && col < COLS && lane >= 0 && lane < LANES) ? { lane, col } : null;
  });
  canvas.addEventListener("mouseleave", () => { hover = null; });

  canvas.addEventListener("click", (ev) => {
    ensureAudio();
    if (mode !== "playing") return;
    const p = canvasPoint(ev);

    // 1) dew motes first — they hover above the field
    let hitMote = null;
    for (const m of game.motes) {
      const dx = p.x - fx(m.x);
      const dy = p.y - fy(m.y);
      if (dx * dx + dy * dy <= 26 * 26) {
        if (!hitMote || m.id > hitMote.id) hitMote = m;
      }
    }
    if (hitMote) {
      L.collectMote(game, hitMote.id);
      drainEvents(false);
      refreshHud();
      refreshCards();
      return;
    }

    // 2) grid actions
    const col = Math.floor((p.x - SURGE_W) / CELL_W);
    const lane = Math.floor(p.y / CELL_H);
    if (col < 0 || col >= COLS || lane < 0 || lane >= LANES) return;

    if (selected === "shovel") {
      if (L.shovelAt(game, lane, col)) {
        selected = null;
        drainEvents(false);
        refreshCards();
      }
      return;
    }
    if (selected) {
      const why = L.plantAt(game, selected, lane, col);
      if (!why) {
        selected = null;
        drainEvents(false);
        refreshHud();
        refreshCards();
      }
    }
  });

  canvas.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    selected = null;
    refreshCards();
  });

  // ---- input: keyboard -------------------------------------------------------------------------
  window.addEventListener("keydown", (e) => {
    ensureAudio();

    if (mode === "lost") {
      if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
      startLevel(game.levelIndex); // instant restart on any key
      return;
    }
    if (mode === "won") {
      if (e.code === "Enter" || e.code === "Space") {
        if (game.levelIndex + 1 < L.LEVELS.length) startLevel(game.levelIndex + 1);
        else showMenu();
      } else if (e.code === "KeyL" || e.code === "Escape") showMenu();
      return;
    }
    if (mode === "menu") {
      const n = e.code.startsWith("Digit") ? parseInt(e.code.slice(5), 10) : NaN;
      if (n >= 1 && n <= L.LEVELS.length && n - 1 <= getProgress()) startLevel(n - 1);
      else if (e.code === "Enter" || e.code === "Space") startLevel(Math.min(getProgress(), L.LEVELS.length - 1));
      return;
    }

    if (e.code === "KeyM") { audioBtn.click(); return; }

    if (mode === "paused") {
      if (e.code === "KeyP" || e.code === "Escape") resumeGame();
      else if (e.code === "KeyL") showMenu();
      else if (e.code === "KeyR") startLevel(game.levelIndex);
      return;
    }

    // playing
    if (e.code === "KeyP") { pauseGame(); return; }
    if (e.code === "Escape") {
      if (selected) { selected = null; refreshCards(); }
      else pauseGame();
      return;
    }
    if (e.code === "KeyR") { startLevel(game.levelIndex); return; }
    if (e.code === "KeyL") { showMenu(); return; }
    if (e.code === "KeyX") { selectCard("shovel"); return; }
    if (e.code.startsWith("Digit")) {
      const n = parseInt(e.code.slice(5), 10);
      const unlocked = L.LEVELS[game.levelIndex].plants;
      const types = L.PLANT_ORDER.filter((t) => unlocked.indexOf(t) >= 0);
      if (n >= 1 && n <= types.length) selectCard(types[n - 1]);
    }
  });

  window.addEventListener("blur", () => { if (mode === "playing") pauseGame(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && mode === "playing") pauseGame();
  });

  // ---- drawing: plants -----------------------------------------------------------------------------
  // g: context, cx/cy: center px, s: scale unit (~cell size), t: seconds, hpRatio 0..1
  function drawPlant(g, type, cx, cy, s, t, hpRatio) {
    const sway = Math.sin(t * 2.1 + cx * 0.13) * 0.035 * s;
    g.save();
    switch (type) {
      case "dewblossom": {
        g.strokeStyle = "#4a8f4f";
        g.lineWidth = s * 0.055;
        g.beginPath();
        g.moveTo(cx, cy + s * 0.32);
        g.quadraticCurveTo(cx - s * 0.05, cy + s * 0.1, cx + sway, cy - s * 0.02);
        g.stroke();
        const hx = cx + sway, hy = cy - s * 0.06;
        g.fillStyle = "#7fe3c9";
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + t * 0.4;
          g.beginPath();
          g.ellipse(hx + Math.cos(a) * s * 0.16, hy + Math.sin(a) * s * 0.16,
            s * 0.11, s * 0.065, a, 0, Math.PI * 2);
          g.fill();
        }
        g.shadowColor = "rgba(255, 217, 122, 0.9)";
        g.shadowBlur = s * 0.25;
        g.fillStyle = "#ffd97a";
        g.beginPath();
        g.arc(hx, hy, s * 0.1, 0, Math.PI * 2);
        g.fill();
        g.shadowBlur = 0;
        break;
      }
      case "thornshot": {
        g.strokeStyle = "#3f7a44";
        g.lineWidth = s * 0.06;
        g.beginPath();
        g.moveTo(cx - s * 0.05, cy + s * 0.32);
        g.quadraticCurveTo(cx - s * 0.1, cy + s * 0.08, cx - s * 0.04 + sway, cy - s * 0.04);
        g.stroke();
        const hx = cx - s * 0.04 + sway, hy = cy - s * 0.08;
        g.fillStyle = "#8fe388";
        g.beginPath();
        g.arc(hx, hy, s * 0.15, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#5cb862";
        g.fillRect(hx + s * 0.08, hy - s * 0.055, s * 0.2, s * 0.11);
        g.fillStyle = "#2f5c33";
        for (let i = 0; i < 3; i++) {
          const a = -Math.PI / 2 - 0.5 + i * 0.5;
          g.beginPath();
          g.moveTo(hx + Math.cos(a) * s * 0.13, hy + Math.sin(a) * s * 0.13);
          g.lineTo(hx + Math.cos(a) * s * 0.22, hy + Math.sin(a) * s * 0.22);
          g.lineTo(hx + Math.cos(a + 0.25) * s * 0.12, hy + Math.sin(a + 0.25) * s * 0.12);
          g.fill();
        }
        break;
      }
      case "frostfern": {
        g.strokeStyle = "#9fd8ff";
        g.lineWidth = s * 0.05;
        for (let i = -2; i <= 2; i++) {
          g.beginPath();
          g.moveTo(cx, cy + s * 0.32);
          g.quadraticCurveTo(
            cx + i * s * 0.12 + sway, cy + s * 0.02,
            cx + i * s * 0.2 + sway, cy - s * 0.22 + Math.abs(i) * s * 0.07);
          g.stroke();
        }
        g.shadowColor = "rgba(159, 216, 255, 0.9)";
        g.shadowBlur = s * 0.2;
        g.fillStyle = "#d8efff";
        g.beginPath();
        g.arc(cx + sway, cy - s * 0.05, s * 0.06, 0, Math.PI * 2);
        g.fill();
        g.shadowBlur = 0;
        break;
      }
      case "bulwarkroot": {
        g.fillStyle = "#6e4f2f";
        roundRect(g, cx - s * 0.26, cy - s * 0.3, s * 0.52, s * 0.62, s * 0.16);
        g.fill();
        g.fillStyle = "#a07648";
        roundRect(g, cx - s * 0.18, cy - s * 0.22, s * 0.36, s * 0.46, s * 0.12);
        g.fill();
        g.fillStyle = "#6e4f2f";
        g.beginPath();
        g.arc(cx - s * 0.05, cy - s * 0.05, s * 0.05, 0, Math.PI * 2);
        g.arc(cx + s * 0.08, cy + s * 0.12, s * 0.04, 0, Math.PI * 2);
        g.fill();
        if (hpRatio < 0.5) { // battle damage
          g.strokeStyle = "#33241a";
          g.lineWidth = s * 0.03;
          g.beginPath();
          g.moveTo(cx - s * 0.1, cy - s * 0.28);
          g.lineTo(cx + s * 0.02, cy - s * 0.02);
          g.lineTo(cx - s * 0.06, cy + s * 0.2);
          g.stroke();
        }
        break;
      }
      case "burstcap": {
        const pulse = 1 + Math.sin(t * 4) * 0.04;
        g.fillStyle = "#e8d9b8";
        roundRect(g, cx - s * 0.07, cy + s * 0.02, s * 0.14, s * 0.28, s * 0.05);
        g.fill();
        g.fillStyle = "#ff6b6b";
        g.beginPath();
        g.arc(cx, cy + s * 0.04, s * 0.26 * pulse, Math.PI, 0);
        g.closePath();
        g.fill();
        g.fillStyle = "#ffd9d9";
        g.beginPath();
        g.arc(cx - s * 0.12, cy - s * 0.08, s * 0.045, 0, Math.PI * 2);
        g.arc(cx + s * 0.05, cy - s * 0.13, s * 0.05, 0, Math.PI * 2);
        g.arc(cx + s * 0.15, cy - s * 0.03, s * 0.035, 0, Math.PI * 2);
        g.fill();
        break;
      }
      case "sporelobber": {
        g.fillStyle = "#8e63c7";
        g.beginPath();
        g.ellipse(cx - s * 0.04, cy + s * 0.14, s * 0.22, s * 0.18, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#b58cf0";
        g.beginPath();
        g.ellipse(cx + s * 0.08 + sway, cy - s * 0.12, s * 0.16, s * 0.12, -0.5, Math.PI * 0.9, Math.PI * 2.1);
        g.fill();
        g.shadowColor = "rgba(181, 140, 240, 0.9)";
        g.shadowBlur = s * 0.18;
        g.fillStyle = "#e3d1ff";
        g.beginPath();
        g.arc(cx + s * 0.1 + sway, cy - s * 0.16 + Math.sin(t * 3) * s * 0.03, s * 0.05, 0, Math.PI * 2);
        g.fill();
        g.shadowBlur = 0;
        break;
      }
    }
    g.restore();
  }

  function drawShovelIcon(g) {
    g.strokeStyle = "#a89478";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(14, 6);
    g.lineTo(28, 20);
    g.stroke();
    g.fillStyle = "#c9d1d9";
    g.beginPath();
    g.moveTo(28, 20);
    g.lineTo(36, 22);
    g.lineTo(30, 28);
    g.closePath();
    g.fill();
    g.strokeStyle = "#a89478";
    g.beginPath();
    g.moveTo(10, 3);
    g.lineTo(18, 9);
    g.stroke();
  }

  // ---- drawing: blights ---------------------------------------------------------------------------
  const BLIGHT_COLORS = {
    shambler:  { body: "#7c8a72", limb: "#5d6a54", eye: "#d6ffb0" },
    helmed:    { body: "#7c8a72", limb: "#5d6a54", eye: "#d6ffb0" },
    sprinter:  { body: "#c98a4b", limb: "#96632f", eye: "#ffe2b0" },
    hulk:      { body: "#55606e", limb: "#3c4550", eye: "#b7d4ff" },
    skitterer: { body: "#cbb7e8", limb: "#9c85c2", eye: "#f4ecff" },
  };

  function drawBlight(b, t) {
    const def = L.BLIGHTS[b.type];
    const col = BLIGHT_COLORS[b.type];
    const eating = b.eating != null;
    const phase = t * (eating ? 2 : def.speed * 22) + b.id * 1.7;
    const bob = Math.sin(phase) * (eating ? 1.2 : 2.6);
    const r = def.size * CELL_H;               // body radius-ish
    const px = fx(b.x);
    const py = fy(b.lane + 0.62) + bob;
    const lean = b.type === "sprinter" ? -r * 0.25 : 0;

    ctx.save();

    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(px, fy(b.lane + 0.88), r * 0.7, r * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();

    // legs
    ctx.strokeStyle = col.limb;
    ctx.lineWidth = Math.max(2, r * 0.16);
    const legN = b.type === "skitterer" ? 3 : 2;
    for (let i = 0; i < legN; i++) {
      const sw = Math.sin(phase + i * Math.PI) * r * 0.25;
      ctx.beginPath();
      ctx.moveTo(px + (i - (legN - 1) / 2) * r * 0.3, py + r * 0.35);
      ctx.lineTo(px + (i - (legN - 1) / 2) * r * 0.3 + sw, fy(b.lane + 0.88));
      ctx.stroke();
    }

    // body
    ctx.fillStyle = col.body;
    ctx.beginPath();
    ctx.ellipse(px + lean * 0.3, py, r * 0.52, r * 0.62, lean * 0.02, 0, Math.PI * 2);
    ctx.fill();
    // mottling
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.arc(px + r * 0.15, py + r * 0.1, r * 0.14, 0, Math.PI * 2);
    ctx.arc(px - r * 0.1, py + r * 0.3, r * 0.1, 0, Math.PI * 2);
    ctx.fill();

    // arms reaching left
    const armSw = eating ? Math.sin(t * 14) * r * 0.18 : Math.sin(phase + 1.2) * r * 0.12;
    ctx.strokeStyle = col.limb;
    ctx.lineWidth = Math.max(2, r * 0.14);
    ctx.beginPath();
    ctx.moveTo(px - r * 0.2 + lean, py - r * 0.15);
    ctx.lineTo(px - r * 0.75 + lean, py - r * 0.05 + armSw);
    ctx.moveTo(px - r * 0.2 + lean, py + r * 0.12);
    ctx.lineTo(px - r * 0.72 + lean, py + r * 0.25 - armSw);
    ctx.stroke();

    // head (facing left)
    const hx = px - r * 0.3 + lean;
    const hy = py - r * 0.55 + (eating ? Math.sin(t * 14) * 1.8 : 0);
    ctx.fillStyle = col.body;
    ctx.beginPath();
    ctx.arc(hx, hy, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
    // jaw when chomping
    if (eating) {
      ctx.fillStyle = col.limb;
      const jaw = (Math.sin(t * 14) + 1) * 0.5;
      ctx.beginPath();
      ctx.ellipse(hx - r * 0.2, hy + r * 0.18, r * 0.16, r * 0.08 + jaw * r * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // eye
    ctx.shadowColor = col.eye;
    ctx.shadowBlur = 6;
    ctx.fillStyle = col.eye;
    ctx.beginPath();
    ctx.arc(hx - r * 0.14, hy - r * 0.05, r * 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // helmet stages for the helmed shambler
    if (def.helmed) {
      const stage = L.helmetStage(b);
      if (stage > 0) {
        ctx.fillStyle = "#d8d2c4";
        ctx.beginPath();
        ctx.arc(hx, hy - r * 0.06, r * 0.36, Math.PI * 0.95, Math.PI * 2.05);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "#8f887a";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        if (stage === 1) { // cracked
          ctx.strokeStyle = "#4a463d";
          ctx.beginPath();
          ctx.moveTo(hx - r * 0.15, hy - r * 0.36);
          ctx.lineTo(hx - r * 0.02, hy - r * 0.16);
          ctx.lineTo(hx + r * 0.14, hy - r * 0.3);
          ctx.stroke();
        }
      }
    }

    // chill tint
    if (b.slowT > 0) {
      ctx.fillStyle = "rgba(159, 216, 255, 0.28)";
      ctx.beginPath();
      ctx.ellipse(px, py - r * 0.15, r * 0.62, r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // hit flash
    const hf = hitFlash[b.id] || 0;
    if (hf > 0) {
      ctx.fillStyle = "rgba(255, 255, 255, " + (hf * 5).toFixed(2) + ")";
      ctx.beginPath();
      ctx.ellipse(px, py - r * 0.1, r * 0.58, r * 0.75, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // ---- rendering ---------------------------------------------------------------------------------
  function render(now) {
    const t = now / 1000;
    ctx.save();
    if (shake > 0.2) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    // ground: subtly striped lanes
    for (let lane = 0; lane < LANES; lane++) {
      ctx.fillStyle = lane % 2 === 0 ? "#10160f" : "#0d120c";
      ctx.fillRect(0, fy(lane), W, CELL_H);
      // lane flash after a root surge
      if (laneFlash[lane] > 0) {
        ctx.fillStyle = "rgba(127, 227, 201, " + (laneFlash[lane] * 0.4).toFixed(3) + ")";
        ctx.fillRect(0, fy(lane), W, CELL_H);
      }
    }
    // column seams
    ctx.strokeStyle = "rgba(143, 227, 136, 0.05)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 0; c <= COLS; c++) {
      ctx.moveTo(fx(c) + 0.5, 0);
      ctx.lineTo(fx(c) + 0.5, H);
    }
    for (let lane = 1; lane < LANES; lane++) {
      ctx.moveTo(0, fy(lane) + 0.5);
      ctx.lineTo(W, fy(lane) + 0.5);
    }
    ctx.stroke();

    // blight ingress edge
    const grad = ctx.createLinearGradient(fx(COLS), 0, W, 0);
    grad.addColorStop(0, "rgba(90, 40, 70, 0)");
    grad.addColorStop(1, "rgba(90, 40, 70, 0.4)");
    ctx.fillStyle = grad;
    ctx.fillRect(fx(COLS), 0, W - fx(COLS), H);

    // surge gutter + runes
    ctx.fillStyle = "#0a0e0a";
    ctx.fillRect(0, 0, SURGE_W, H);
    ctx.strokeStyle = "rgba(127, 227, 201, 0.12)";
    ctx.beginPath();
    ctx.moveTo(SURGE_W - 0.5, 0);
    ctx.lineTo(SURGE_W - 0.5, H);
    ctx.stroke();
    for (let lane = 0; lane < LANES; lane++) {
      const cy = fy(lane + 0.5);
      const armed = game ? game.surges[lane] : true;
      const pulse = 0.75 + Math.sin(t * 2.4 + lane) * 0.25;
      ctx.save();
      if (armed) {
        ctx.shadowColor = "rgba(127, 227, 201, 0.9)";
        ctx.shadowBlur = 12 * pulse;
        ctx.fillStyle = "#7fe3c9";
      } else {
        ctx.fillStyle = "#3a423c";
      }
      ctx.beginPath();
      ctx.moveTo(SURGE_W / 2, cy - 13);
      ctx.lineTo(SURGE_W / 2 + 9, cy);
      ctx.lineTo(SURGE_W / 2, cy + 13);
      ctx.lineTo(SURGE_W / 2 - 9, cy);
      ctx.closePath();
      ctx.fill();
      if (!armed) { // spent: cracked
        ctx.strokeStyle = "#171c18";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(SURGE_W / 2 - 5, cy - 6);
        ctx.lineTo(SURGE_W / 2 + 2, cy + 1);
        ctx.lineTo(SURGE_W / 2 - 2, cy + 8);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (game) {
      // hover ghost
      if (mode === "playing" && hover && selected) {
        const gx = fx(hover.col), gy = fy(hover.lane);
        const bad = selected === "shovel"
          ? !L.plantAtCell(game, hover.lane, hover.col)
          : L.canPlant(game, selected, hover.lane, hover.col) !== null;
        ctx.fillStyle = bad ? "rgba(255, 107, 107, 0.12)" : "rgba(143, 227, 136, 0.12)";
        ctx.fillRect(gx + 1, gy + 1, CELL_W - 2, CELL_H - 2);
        if (selected !== "shovel" && !bad) {
          ctx.globalAlpha = 0.45;
          drawPlant(ctx, selected, gx + CELL_W / 2, gy + CELL_H / 2, CELL_H * 0.9, t, 1);
          ctx.globalAlpha = 1;
        }
      }

      // plants
      for (const p of game.plants) {
        const cx = fx(p.col + 0.5);
        const cy = fy(p.lane + 0.55);
        const key = p.lane + "," + p.col;
        drawPlant(ctx, p.type, cx, cy, CELL_H * 0.9, t, p.hp / p.maxHp);
        const pf = plantHit[key] || 0;
        if (pf > 0) {
          ctx.fillStyle = "rgba(255,255,255," + (pf * 3).toFixed(2) + ")";
          ctx.beginPath();
          ctx.arc(cx, cy, CELL_H * 0.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // shots
      for (const s of game.shots) {
        const sx = fx(s.x), sy = fy(s.lane + 0.5);
        ctx.save();
        if (s.frost) {
          ctx.shadowColor = "rgba(159, 216, 255, 0.9)";
          ctx.shadowBlur = 9;
          ctx.fillStyle = "#bfe4ff";
          ctx.beginPath();
          ctx.arc(sx, sy, 5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = "#8fe388";
          ctx.beginPath();
          ctx.ellipse(sx, sy, 7, 4, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#c9f5c4";
          ctx.beginPath();
          ctx.arc(sx + 3, sy - 1, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // lobs on their arcs
      for (const lob of game.lobs) {
        const u = Math.min(lob.t / lob.dur, 1);
        const lx = fx(lob.x0 + (lob.x1 - lob.x0) * u);
        const ly = fy(lob.lane + 0.5) - 58 * 4 * u * (1 - u); // parabolic arc, peak 58px
        ctx.save();
        ctx.shadowColor = "rgba(181, 140, 240, 0.9)";
        ctx.shadowBlur = 10;
        ctx.fillStyle = "#b58cf0";
        ctx.beginPath();
        ctx.arc(lx, ly, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // blights
      for (const b of game.blights) drawBlight(b, t);

      // dew motes on top
      for (const m of game.motes) {
        const mx = fx(m.x), my = fy(m.y);
        let alpha = 1;
        if (m.landed && m.age > L.MOTE_TTL - 2) alpha = Math.max(0, (L.MOTE_TTL - m.age) / 2);
        const pulse = 0.85 + Math.sin(t * 5 + m.id) * 0.15;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.shadowColor = "rgba(255, 217, 122, 0.95)";
        ctx.shadowBlur = 14 * pulse;
        ctx.fillStyle = "#ffd97a";
        ctx.beginPath();
        ctx.arc(mx, my, 9 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#fff3d0";
        ctx.beginPath();
        ctx.arc(mx - 2, my - 2, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // particles
    for (const p of particles) {
      ctx.fillStyle = "rgba(" + p.rgb + ", " + Math.max(p.life, 0).toFixed(3) + ")";
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }

    ctx.restore();
  }

  // ---- main loop ------------------------------------------------------------------------------------
  function stepLogic() {
    L.tick(game, DT);
    // track plant hit flashes off chomp events before draining
    for (const e of game.events) {
      if (e.t === "chomp") {
        const c = Math.floor(e.x - L.MOUTH);
        plantHit[e.lane + "," + c] = 0.1;
      }
    }
  }

  function frame(now) {
    if (!lastTime) lastTime = now;
    let dt = now - lastTime;
    lastTime = now;
    if (dt > 250) dt = 250;

    if (mode === "playing" && game) {
      accumulator += dt / 1000;
      let safety = 20;
      while (accumulator >= DT && mode === "playing" && safety-- > 0) {
        accumulator -= DT;
        stepLogic();
        drainEvents(false);
        postLogic();
      }
      if (safety <= 0) accumulator = 0;
      refreshHud();
      refreshCards();
    }

    shake = Math.max(0, shake - dt * 0.02);
    for (let i = 0; i < LANES; i++) laneFlash[i] = Math.max(0, laneFlash[i] - dt * 0.0012);
    for (const k in hitFlash) {
      hitFlash[k] -= dt / 1000;
      if (hitFlash[k] <= 0) delete hitFlash[k];
    }
    for (const k in plantHit) {
      plantHit[k] -= dt / 1000;
      if (plantHit[k] <= 0) delete plantHit[k];
    }
    updateParticles(dt / 1000);

    render(now);
    requestAnimationFrame(frame);
  }

  // ---- guarded test handle -----------------------------------------------------------------------------
  // Only exposed when the page is loaded with ?rgtest in the query string; the
  // committed browser suite uses it for deterministic setups. Not part of play.
  if (/[?&]rgtest/.test(window.location.search)) {
    window.__rootguard = {
      get mode() { return mode; },
      get game() { return game; },
      get selected() { return selected; },
      get progress() { return getProgress(); },
      startLevel: startLevel,
      showMenu: showMenu,
      setDew(n) { game.dew = n; refreshHud(); refreshCards(); },
      setTime(tm) { game.time = tm; },
      clearCooldowns() { for (const k in game.cooldowns) game.cooldowns[k] = 0; refreshCards(); },
      plant(type, lane, col) { const r = L.plantAt(game, type, lane, col); game.events.length = 0; refreshHud(); refreshCards(); return r; },
      spawn(type, lane, x) { return L.spawnBlight(game, type, lane, x); },
      addMote(x, y) { return L.addMote(game, x, y, false); },
      clearBlights() { game.blights.length = 0; },
      // sandbox: stop scripted waves without satisfying the win condition
      disableWaves() { game.queueIdx = game.spawnQueue.length; },
      // let the win condition fire once the field is clear
      finishWaves() { game.queueIdx = game.spawnQueue.length; game.spawnedCount = game.totalSpawns; },
      fastForward(sec) {
        // Runs the simulation even while paused, so tests get exact timing.
        const n = Math.round(sec / DT);
        for (let i = 0; i < n && game && game.status === "playing"; i++) {
          stepLogic();
          game.events.length = 0; // skip sfx/particles while time-warping
        }
        postLogic();
        refreshHud();
        refreshCards();
      },
      motePos(id) {
        const m = game.motes.find((mm) => mm.id === id);
        if (!m) return null;
        const r = canvas.getBoundingClientRect();
        return {
          x: r.left + fx(m.x) * (r.width / W),
          y: r.top + fy(m.y) * (r.height / H),
        };
      },
      cellPos(lane, col) {
        const r = canvas.getBoundingClientRect();
        return {
          x: r.left + fx(col + 0.5) * (r.width / W),
          y: r.top + fy(lane + 0.5) * (r.height / H),
        };
      },
    };
  }

  // ---- boot -------------------------------------------------------------------------------------------
  showMenu();
  requestAnimationFrame(frame);
})();

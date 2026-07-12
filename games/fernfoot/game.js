"use strict";

/* ================= Fernfoot — presentation layer =================
 * Canvas rendering, input, Web Audio synth SFX, HUD, screens, persistence.
 * All rules live in logic.js; all layouts in levels.js.
 */
(function () {
  const L = window.FernfootLogic;
  const LEVELS = window.FernfootLevels.defs;
  const TILE = L.TILE;

  const VIEW_W = 32 * TILE;   // 512
  const VIEW_H = 15 * TILE;   // 240

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  canvas.width = VIEW_W;
  canvas.height = VIEW_H;
  ctx.imageSmoothingEnabled = false;

  const $ = (id) => document.getElementById(id);
  const hud = {
    level: $("hud-level"), lives: $("hud-lives"), sparks: $("hud-sparks"),
    score: $("hud-score"), time: $("hud-time"), power: $("hud-power"),
  };
  const overlay = $("overlay");
  const ovTitle = $("overlay-title");
  const ovSub = $("overlay-sub");
  const ovBody = $("overlay-body");
  const audioBtn = $("audio-toggle");

  // ---- persistence -----------------------------------------------------------
  const store = {
    get(k, d) { try { const v = localStorage.getItem("arcade.fernfoot." + k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem("arcade.fernfoot." + k, String(v)); } catch {} },
  };

  // ---- audio -----------------------------------------------------------------
  let audioCtx = null;
  let audioOn = store.get("audio", "on") === "on";
  function setAudioLabel() { audioBtn.textContent = "sound: " + (audioOn ? "on" : "off"); }
  setAudioLabel();
  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  }
  function toggleAudio() {
    audioOn = !audioOn;
    store.set("audio", audioOn ? "on" : "off");
    setAudioLabel();
    if (audioOn) { ensureAudio(); blip(660, 0.05, "square", 0.04); }
  }
  audioBtn.addEventListener("click", () => { ensureAudio(); toggleAudio(); });

  function blip(freq, dur, type, gain, slideTo) {
    if (!audioOn || !audioCtx) return;
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
    g.gain.setValueAtTime(gain || 0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, gain, hz) {
    if (!audioOn || !audioCtx) return;
    const t = audioCtx.currentTime;
    const n = Math.floor(audioCtx.sampleRate * dur);
    const buf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const f = audioCtx.createBiquadFilter();
    f.type = "bandpass"; f.frequency.value = hz || 900;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(gain || 0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
    src.connect(f).connect(g).connect(audioCtx.destination);
    src.start(t);
  }
  function jingle(notes, step, type, gain) {
    if (!audioOn || !audioCtx) return;
    notes.forEach((f, i) => setTimeout(() => blip(f, step * 1.7, type || "triangle", gain || 0.05), i * step * 1000));
  }

  const SFX = {
    jump: () => blip(300, 0.14, "square", 0.045, 620),
    airjump: () => blip(420, 0.14, "square", 0.045, 780),
    land: () => noise(0.06, 0.03, 500),
    skid: () => noise(0.05, 0.02, 1600),
    stomp: () => { blip(180, 0.1, "square", 0.06, 60); noise(0.07, 0.05, 700); },
    spark: () => blip(1240 + Math.random() * 120, 0.07, "triangle", 0.04, 1650),
    powerup: () => jingle([520, 660, 780, 1040], 0.07, "triangle", 0.055),
    hurt: () => blip(240, 0.22, "sawtooth", 0.05, 90),
    death: () => jingle([330, 262, 196, 131], 0.12, "sawtooth", 0.05),
    break: () => noise(0.12, 0.06, 350),
    bump: () => blip(160, 0.06, "square", 0.035, 120),
    checkpoint: () => jingle([523, 784], 0.09, "triangle", 0.05),
    goal: () => jingle([392, 523, 659, 784, 1047, 784, 1047], 0.09, "triangle", 0.06),
    oneup: () => jingle([659, 784, 988, 1319], 0.08, "square", 0.05),
    lunge: () => blip(500, 0.08, "sawtooth", 0.03, 900),
    spit: () => blip(700, 0.09, "sine", 0.035, 300),
    drop: () => blip(220, 0.06, "square", 0.03, 150),
    gameover: () => jingle([262, 233, 196, 165, 131], 0.16, "sawtooth", 0.05),
    select: () => blip(880, 0.05, "square", 0.035),
  };

  // ---- game shell state --------------------------------------------------------
  let mode = "menu";            // menu | playing | paused | tally | gameover
  let game = L.newGame();
  let cam = { x: 0, y: 0, anchorY: 0 };
  let menuSel = 0;
  let particles = [];
  let flash = 0;                // HUD flash timer (1up)
  let shake = 0;
  let clearedInfo = null;

  function unlocked() { return Math.min(LEVELS.length - 1, parseInt(store.get("unlocked", "0"), 10) || 0); }
  function bestOf(i) { const v = parseFloat(store.get("best." + i, "NaN")); return isNaN(v) ? null : v; }

  // ---- input ---------------------------------------------------------------------
  const keys = {};
  const input = { left: false, right: false, down: false, run: false, jump: false };
  function syncInput() {
    input.left = !!(keys.ArrowLeft || keys.KeyA);
    input.right = !!(keys.ArrowRight || keys.KeyD);
    input.down = !!(keys.ArrowDown || keys.KeyS);
    input.run = !!(keys.ShiftLeft || keys.ShiftRight);
    input.jump = !!(keys.Space || keys.KeyZ || keys.ArrowUp || keys.KeyW);
  }

  document.addEventListener("keydown", (e) => {
    if (e.repeat) { if (e.code !== "F5") e.preventDefault(); return; }
    ensureAudio();
    if (e.code === "KeyM") { toggleAudio(); e.preventDefault(); return; }

    if (mode === "menu") {
      if (e.code === "ArrowLeft" || e.code === "KeyA" || e.code === "ArrowUp" || e.code === "KeyW") { menuSel = Math.max(0, menuSel - 1); SFX.select(); renderMenu(); }
      else if (e.code === "ArrowRight" || e.code === "KeyD" || e.code === "ArrowDown" || e.code === "KeyS") { menuSel = Math.min(unlocked(), menuSel + 1); SFX.select(); renderMenu(); }
      else if (e.code === "Enter" || e.code === "Space" || e.code === "KeyZ") startLevel(menuSel);
      e.preventDefault();
      return;
    }
    if (mode === "tally") {
      if (e.code === "Enter" || e.code === "Space" || e.code === "KeyZ") {
        const next = game.levelIndex + 1;
        if (next < LEVELS.length) startLevel(next); else toMenu();
      } else if (e.code === "Escape") toMenu();
      e.preventDefault();
      return;
    }
    if (mode === "gameover") {
      if (e.code === "Escape") toMenu();
      else restartRun();
      e.preventDefault();
      return;
    }
    if (mode === "playing" || mode === "paused") {
      if (e.code === "KeyP") { togglePause(); e.preventDefault(); return; }
      if (e.code === "Escape") { toMenu(); e.preventDefault(); return; }
      if (mode === "paused" && e.code !== "KeyP") { togglePause(); }
      keys[e.code] = true;
      syncInput();
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
    }
  });
  document.addEventListener("keyup", (e) => { keys[e.code] = false; syncInput(); });
  window.addEventListener("blur", () => { if (mode === "playing") togglePause(true); });

  overlay.addEventListener("click", (e) => {
    ensureAudio();
    const b = e.target.closest("[data-level]");
    if (b && mode === "menu") { startLevel(parseInt(b.dataset.level, 10)); return; }
    const act = e.target.closest("[data-act]");
    if (!act) return;
    if (act.dataset.act === "next") { const n = game.levelIndex + 1; if (n < LEVELS.length) startLevel(n); else toMenu(); }
    if (act.dataset.act === "menu") toMenu();
    if (act.dataset.act === "retry") restartRun();
  });

  // ---- screens ----------------------------------------------------------------------
  function showOverlay(title, sub, bodyHTML, cls) {
    ovTitle.textContent = title;
    ovSub.textContent = sub || "";
    ovBody.innerHTML = bodyHTML || "";
    overlay.className = "show " + (cls || "");
  }
  function hideOverlay() { overlay.className = ""; }

  function renderMenu() {
    const un = unlocked();
    menuSel = Math.min(menuSel, un);
    let html = '<div class="levels">';
    for (let i = 0; i < LEVELS.length; i++) {
      const locked = i > un;
      const best = bestOf(i);
      html += `<button type="button" class="level-card${locked ? " locked" : ""}${i === menuSel ? " sel" : ""}"` +
        (locked ? " disabled" : ` data-level="${i}"`) + ">" +
        `<span class="ln">${i + 1}</span><span class="lname">${locked ? "— locked —" : LEVELS[i].name}</span>` +
        `<span class="lbest">${best !== null ? "best " + best.toFixed(1) + "s" : (locked ? "" : "unplayed")}</span></button>`;
    }
    html += "</div>";
    showOverlay("FERNFOOT", "pick a glade · enter to set off", html, "menu");
  }

  function toMenu() {
    mode = "menu";
    renderMenu();
  }

  function startLevel(i) {
    game = L.newGame();
    L.loadLevel(game, LEVELS, i);
    cam = { x: 0, y: 0, anchorY: game.hero.y + game.hero.h };
    cam = L.stepCamera(cam, game, VIEW_W, VIEW_H, 1);
    particles = [];
    clearedInfo = null;
    mode = "playing";
    acc = 0;
    hideOverlay();
    SFX.select();
    updateHUD();
  }

  function restartRun() { startLevel(game.levelIndex); }

  function togglePause(silent) {
    if (mode === "playing") {
      mode = "paused";
      showOverlay("PAUSED", "P to resume · Esc for the glade list", "");
      if (!silent) SFX.select();
    } else if (mode === "paused") {
      mode = "playing";
      hideOverlay();
    }
  }

  function onCleared() {
    mode = "tally";
    const i = game.levelIndex;
    const t = game.time;
    const prev = bestOf(i);
    const isBest = prev === null || t < prev;
    if (isBest) store.set("best." + i, t.toFixed(2));
    if (i + 1 > unlocked() && i + 1 < LEVELS.length) store.set("unlocked", i + 1);
    else if (i === LEVELS.length - 1) store.set("unlocked", LEVELS.length - 1);
    clearedInfo = { time: t, best: isBest ? t : prev, isBest };
    const nextLabel = i + 1 < LEVELS.length ? "next glade" : "back to the list";
    showOverlay("WAYSTONE REACHED", LEVELS[i].name,
      `<div class="tally">` +
      `<div><span>sparks</span><b>${game.sparks}</b></div>` +
      `<div><span>time</span><b>${t.toFixed(1)}s</b></div>` +
      `<div><span>best</span><b>${clearedInfo.best.toFixed(1)}s${isBest ? " ★ new" : ""}</b></div>` +
      `<div><span>score</span><b>${game.score}</b></div>` +
      `</div><button type="button" data-act="next">${nextLabel} (enter)</button>`, "clear");
  }

  function onGameOver() {
    mode = "gameover";
    showOverlay("FALLEN", "any key to try again · Esc for the glade list",
      `<div class="tally"><div><span>score</span><b>${game.score}</b></div>` +
      `<div><span>sparks</span><b>${game.sparks}</b></div></div>`, "dead");
  }

  // ---- particles ------------------------------------------------------------------------
  function puff(x, y, n, col, spread, up) {
    for (let i = 0; i < n; i++) {
      particles.push({
        x, y, vx: (Math.random() - 0.5) * (spread || 40),
        vy: -(Math.random() * (up || 30)), life: 0.35 + Math.random() * 0.3,
        t: 0, col, r: 1 + Math.random() * 1.6,
      });
    }
  }
  function burst(x, y, n, col) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 30 + Math.random() * 60;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 30, life: 0.4 + Math.random() * 0.35, t: 0, col, r: 1 + Math.random() * 1.8 });
    }
  }
  function stepParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += dt;
      if (p.t > p.life) { particles.splice(i, 1); continue; }
      p.vy += 220 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  function handleEvents() {
    for (const ev of game.events) {
      switch (ev.type) {
        case "jump": SFX.jump(); puff(ev.x + 6, ev.y, 4, "#cdb98a", 30, 20); break;
        case "airjump": SFX.airjump(); puff(ev.x + 6, ev.y, 6, "#9fd8ff", 50, 10); break;
        case "land": SFX.land(); puff(ev.x, ev.y, 4, "#cdb98a", 44, 14); break;
        case "skid": SFX.skid(); puff(ev.x, ev.y, 2, "#cdb98a", 26, 24); break;
        case "stomp": SFX.stomp(); burst(ev.x, ev.y, 8, "#e8e3d0"); shake = 0.12; break;
        case "spark": SFX.spark(); burst(ev.x, ev.y, 5, "#ffd76a"); break;
        case "powerup": SFX.powerup(); burst(ev.x, ev.y, 12, ev.which === "gust" ? "#9fd8ff" : "#ff9a5e"); break;
        case "hurt": SFX.hurt(); burst(ev.x, ev.y, 8, "#ff8080"); shake = 0.2; break;
        case "death": SFX.death(); shake = 0.3; break;
        case "break": SFX.break(); burst(ev.x, ev.y, 10, "#8d99ab"); shake = 0.1; break;
        case "bump": SFX.bump(); break;
        case "checkpoint": SFX.checkpoint(); burst(ev.x, ev.y, 8, "#8fe388"); break;
        case "goal": SFX.goal(); burst(ev.x, ev.y, 20, "#c9b6ff"); break;
        case "1up": SFX.oneup(); flash = 1.2; break;
        case "lunge": SFX.lunge(); break;
        case "spit": SFX.spit(); break;
        case "drop": SFX.drop(); break;
        case "gameover": SFX.gameover(); break;
        case "globdie": puff(ev.x, ev.y, 3, "#a7c66a", 30, 20); break;
      }
    }
  }

  // ---- HUD ---------------------------------------------------------------------------------
  function updateHUD() {
    hud.level.textContent = (game.level ? (game.levelIndex + 1) + " · " + game.level.name : "—");
    hud.lives.textContent = String(Math.max(0, game.lives));
    hud.sparks.textContent = String(game.sparks);
    hud.score.textContent = String(game.score);
    hud.time.textContent = game.time.toFixed(1) + "s";
    hud.power.textContent = game.hero ? (game.hero.power === "ember" ? "emberseed" : game.hero.power === "gust" ? "gustfruit" : "—") : "—";
    hud.sparks.parentElement.classList.toggle("flash", flash > 0 && Math.floor(flash * 8) % 2 === 0);
  }

  // ---- rendering ---------------------------------------------------------------------------
  const THEMES = {
    glade: {
      sky0: "#0b1410", sky1: "#12271c", far: "#16352a", near: "#1d4636",
      solidTop: "#5da24e", solid: "#3b4a33", solidDark: "#2b3626",
      oneway: "#8a6f46", crack: "#5c6b57", spike: "#b9c4b0",
    },
    ruin: {
      sky0: "#0b0e18", sky1: "#161d33", far: "#1d2440", near: "#28325a",
      solidTop: "#7c88a8", solid: "#454d66", solidDark: "#323950",
      oneway: "#6b5f8a", crack: "#59607a", spike: "#c3c8de",
    },
  };

  function drawBackground(th, camx) {
    const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    grad.addColorStop(0, th.sky0);
    grad.addColorStop(1, th.sky1);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // far hills / arches (parallax 0.25)
    ctx.fillStyle = th.far;
    const o1 = -((camx * 0.25) % 160);
    for (let x = o1 - 160; x < VIEW_W + 160; x += 160) {
      ctx.beginPath();
      ctx.moveTo(x, VIEW_H);
      ctx.quadraticCurveTo(x + 80, VIEW_H - 110, x + 160, VIEW_H);
      ctx.fill();
    }
    // near silhouettes (parallax 0.5)
    ctx.fillStyle = th.near;
    const o2 = -((camx * 0.5) % 120);
    for (let x = o2 - 120; x < VIEW_W + 120; x += 120) {
      ctx.fillRect(x + 20, VIEW_H - 60, 14, 60);
      ctx.beginPath();
      ctx.arc(x + 27, VIEW_H - 64, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(x + 78, VIEW_H - 34, 10, 34);
    }
  }

  function drawTile(t, x, y, th, tx, ty) {
    const T = L.T;
    switch (t) {
      case T.SOLID: {
        ctx.fillStyle = th.solid;
        ctx.fillRect(x, y, TILE, TILE);
        // grass/flagstone top only when exposed
        if (!L.isSolid(L.tileAt(game, tx, ty - 1))) {
          ctx.fillStyle = th.solidTop;
          ctx.fillRect(x, y, TILE, 4);
        }
        ctx.fillStyle = th.solidDark;
        ctx.fillRect(x + ((tx * 7 + ty * 13) % 3) * 4 + 2, y + 8 + ((tx + ty) % 2) * 3, 4, 2);
        break;
      }
      case T.ONEWAY:
        ctx.fillStyle = th.oneway;
        ctx.fillRect(x, y, TILE, 5);
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.fillRect(x + 2, y + 3, TILE - 4, 2);
        break;
      case T.CRACK: case T.CRACK_SPARKS: case T.CRACK_SEED:
        ctx.fillStyle = th.crack;
        ctx.fillRect(x, y, TILE, TILE);
        ctx.strokeStyle = "rgba(0,0,0,0.45)";
        ctx.beginPath();
        ctx.moveTo(x + 3, y + 2); ctx.lineTo(x + 8, y + 8); ctx.lineTo(x + 5, y + 13);
        ctx.moveTo(x + 12, y + 3); ctx.lineTo(x + 9, y + 9);
        ctx.stroke();
        break;
      case T.SPIKE:
        ctx.fillStyle = th.spike;
        ctx.beginPath();
        ctx.moveTo(x, y + TILE); ctx.lineTo(x + 4, y + 4); ctx.lineTo(x + 8, y + TILE);
        ctx.lineTo(x + 8, y + TILE); ctx.lineTo(x + 12, y + 4); ctx.lineTo(x + 16, y + TILE);
        ctx.fill();
        break;
      case T.SPARK: {
        const tw = Math.sin(perfNow * 6 + tx * 1.7 + ty) * 1.5;
        ctx.fillStyle = "#ffd76a";
        ctx.beginPath();
        ctx.arc(x + 8, y + 8 + tw, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,215,106,0.35)";
        ctx.beginPath();
        ctx.arc(x + 8, y + 8 + tw, 4.6, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case T.SEED:
        ctx.fillStyle = "#ff9a5e";
        ctx.beginPath();
        ctx.ellipse(x + 8, y + 9, 5, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#7db95c";
        ctx.beginPath(); ctx.moveTo(x + 8, y + 3); ctx.quadraticCurveTo(x + 12, y - 1, x + 13, y + 2); ctx.stroke();
        break;
      case T.FRUIT:
        ctx.fillStyle = "#9fd8ff";
        ctx.beginPath();
        ctx.arc(x + 8, y + 9, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.beginPath();
        ctx.arc(x + 6, y + 7, 1.8, 0, Math.PI * 2);
        ctx.fill();
        break;
      case T.CHECK: {
        const active = game.checkpoint && game.checkpoint.tx === tx;
        ctx.fillStyle = "#5c5346";
        ctx.fillRect(x + 7, y + 2, 2, 14);
        ctx.fillStyle = active ? "#8fe388" : "#4a5a4a";
        ctx.beginPath();
        ctx.moveTo(x + 9, y + 3); ctx.lineTo(x + 15, y + 6); ctx.lineTo(x + 9, y + 9);
        ctx.fill();
        break;
      }
      case T.GOAL: {
        const glow = 0.5 + Math.sin(perfNow * 3) * 0.3;
        ctx.fillStyle = "#8d80b8";
        ctx.fillRect(x + 4, y - 10, 8, 26);
        ctx.fillStyle = `rgba(201,182,255,${glow})`;
        ctx.beginPath();
        ctx.arc(x + 8, y - 4, 3.4, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }
  }

  function drawHero(h) {
    if (mode === "playing" && h.inv > 0 && Math.floor(perfNow * 14) % 2 === 0 && game.status === "playing") return;
    const x = h.x - 1, y = h.y - 2;
    const body = h.power === "ember" ? "#ff9a5e" : h.power === "gust" ? "#9fd8ff" : "#8fd97a";
    ctx.save();
    ctx.translate(Math.round(x + 7), Math.round(y + 8));
    ctx.scale(h.facing, 1);
    // legs
    const runp = Math.abs(h.vx) > 8 && h.onGround ? Math.sin(perfNow * 18) * 2.5 : 0;
    ctx.strokeStyle = "#3c5232";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-2, 4); ctx.lineTo(-2 - runp, 8);
    ctx.moveTo(2, 4); ctx.lineTo(2 + runp, 8);
    ctx.stroke();
    // body
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(0, 0, 6, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // fern frond on the head
    ctx.strokeStyle = "#5da24e";
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.quadraticCurveTo(3, -11, 6, -9);
    ctx.stroke();
    // eye
    ctx.fillStyle = "#101a10";
    ctx.beginPath();
    ctx.arc(3, -1.5, 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawEnemy(e) {
    if (!e.alive) {
      if (e.dead < 0.5) {
        ctx.fillStyle = "rgba(200,200,200,0.5)";
        ctx.fillRect(e.x, e.y + e.h - 4, e.w, 4);
      }
      return;
    }
    const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    switch (e.kind) {
      case "plodder":
        ctx.fillStyle = "#b0683f";
        ctx.beginPath(); ctx.ellipse(cx, cy + 1, 7, 5.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#7d4326";
        ctx.fillRect(e.x + 1, e.y + e.h - 3, e.w - 2, 3);
        ctx.fillStyle = "#1a120a";
        ctx.fillRect(cx + (e.vx > 0 ? 3 : -5), cy - 2, 2, 2);
        break;
      case "lunger":
        ctx.fillStyle = e.state === "dash" ? "#e05c5c" : "#a84a5a";
        ctx.beginPath(); ctx.moveTo(cx - 7, e.y + e.h); ctx.lineTo(cx, e.y); ctx.lineTo(cx + 7, e.y + e.h); ctx.fill();
        ctx.fillStyle = "#1a0a0a";
        ctx.fillRect(cx - 3, cy, 2, 2); ctx.fillRect(cx + 1, cy, 2, 2);
        break;
      case "spinner": {
        ctx.strokeStyle = "#c9b6ff";
        ctx.fillStyle = "#6f5aa8";
        ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
        const a = perfNow * 12;
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const an = a + (i * Math.PI * 2) / 3;
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(an) * 8, cy + Math.sin(an) * 8);
        }
        ctx.stroke();
        break;
      }
      case "spitter":
        ctx.fillStyle = "#6a8c3f";
        ctx.beginPath(); ctx.ellipse(cx, cy + 2, 7, 6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#42592a";
        ctx.beginPath(); ctx.arc(cx, e.y + 2, 3.4, 0, Math.PI * 2); ctx.fill();
        break;
    }
  }

  let perfNow = 0;
  function render() {
    const th = THEMES[game.level ? game.level.theme : "glade"] || THEMES.glade;
    let sx = 0, sy = 0;
    if (shake > 0) { sx = (Math.random() - 0.5) * 4 * shake * 5; sy = (Math.random() - 0.5) * 4 * shake * 5; }
    drawBackground(th, cam.x);
    if (!game.level) return;
    ctx.save();
    ctx.translate(-Math.round(cam.x + sx), -Math.round(cam.y + sy));

    const x0 = Math.floor(cam.x / TILE) - 1, x1 = Math.floor((cam.x + VIEW_W) / TILE) + 1;
    const y0 = Math.floor(cam.y / TILE) - 1, y1 = Math.floor((cam.y + VIEW_H) / TILE) + 1;
    for (let ty = Math.max(0, y0); ty <= Math.min(game.level.h - 1, y1); ty++) {
      for (let tx = Math.max(0, x0); tx <= Math.min(game.level.w - 1, x1); tx++) {
        const t = game.grid[ty * game.level.w + tx];
        if (t !== L.T.EMPTY) drawTile(t, tx * TILE, ty * TILE, th, tx, ty);
      }
    }
    // movers
    for (const m of game.movers) {
      ctx.fillStyle = th.oneway;
      ctx.fillRect(m.x, m.y, m.w, 6);
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.fillRect(m.x, m.y, m.w, 2);
    }
    // globs
    ctx.fillStyle = "#a7c66a";
    for (const gl of game.globs) {
      ctx.beginPath();
      ctx.arc(gl.x + 3, gl.y + 3, 3.4, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const e of game.enemies) drawEnemy(e);
    if (game.status !== "gameover") drawHero(game.hero);
    // particles
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      ctx.fillStyle = p.col;
      ctx.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---- main loop -----------------------------------------------------------------------------
  let acc = 0, last = 0;
  function frame(ms) {
    requestAnimationFrame(frame);
    perfNow = ms / 1000;
    const dt = Math.min(0.1, (ms - last) / 1000 || 0);
    last = ms;
    flash = Math.max(0, flash - dt);
    shake = Math.max(0, shake - dt);

    if (mode === "playing") {
      acc += dt;
      while (acc >= L.STEP) {
        acc -= L.STEP;
        L.step(game, input, L.STEP);
        handleEvents();
        if (game.status === "cleared") { onCleared(); break; }
        if (game.status === "gameover") { onGameOver(); break; }
      }
      cam = L.stepCamera(cam, game, VIEW_W, VIEW_H, dt);
    }
    stepParticles(dt);
    render();
    updateHUD();
  }

  // ---- boot ------------------------------------------------------------------------------------
  toMenu();
  requestAnimationFrame(frame);

  // ---- guarded test handle ------------------------------------------------------------------------
  if (/(\?|&)fftest=1/.test(location.search)) {
    window.__fernfoot = {
      get mode() { return mode; },
      get game() { return game; },
      get cam() { return cam; },
      get input() { return input; },
      get menuSel() { return menuSel; },
      dbg() { return { acc, last, perfNow, mode }; },
      LEVELS,
      startLevel,
      toMenu,
      setHero(x, y) { game.hero.x = x; game.hero.y = y; game.hero.vx = 0; game.hero.vy = 0; },
      grant(p) { game.hero.power = p; if (p === "gust") game.hero.airJumps = 1; },
      setLives(n) { game.lives = n; },
      addSparks(n) { game.sparks += n; },
      step(inp, n) { for (let i = 0; i < (n || 1); i++) { L.step(game, inp || input, L.STEP); handleEvents(); if (game.status === "cleared") { onCleared(); break; } if (game.status === "gameover") { onGameOver(); break; } } },
    };
  }
})();

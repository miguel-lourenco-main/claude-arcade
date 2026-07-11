// Dustkart — shell: input, game modes, circuit select, fixed-timestep
// loop with render interpolation, overlays, persistence, audio wiring.
// Classic script (file://-safe): reads everything from the Dustkart
// namespace. Load last, after all the other src scripts.

(function () {
'use strict';
const NS = typeof globalThis !== 'undefined' ? globalThis : window;
const DK = NS.Dustkart = NS.Dustkart || {};
const {
  CIRCUIT_INFO, buildCircuit, LAPS,
  createRace, step, MAX_SPEED,
  Renderer, makeSprites, AudioSys,
} = DK;

const STEP = 1 / 60;
const LS_SOUND = 'arcade.dustkart.sound';
const LS_BEST = (key) => `arcade.dustkart.best.${key}`;

const canvas = document.getElementById('game');
const overlay = document.getElementById('overlay');
const ovTitle = document.getElementById('overlay-title');
const ovSub = document.getElementById('overlay-sub');
const ovDetail = document.getElementById('overlay-detail');
const audioBtn = document.getElementById('audio-toggle');

const sprites = makeSprites();
const renderer = new Renderer(canvas, sprites);
const audio = new AudioSys();

const circuits = [null, null, null];    // built lazily
function circuit(i) {
  if (!circuits[i]) circuits[i] = buildCircuit(i);
  return circuits[i];
}

let mode = 'menu';          // menu | countdown | race | finished | paused
let modeBefore = 'menu';
let sim = null;             // the live race
let demoSim = null;         // AI-only race behind the menu
let selected = 0;
let raceCircuit = 0;
let endTimer = 0;
let restartGuard = 0;
let itemFlash = '';

audio.enabled = (localStorage.getItem(LS_SOUND) || 'on') === 'on';
audioBtn.textContent = `sound: ${audio.enabled ? 'on' : 'off'}`;

const keys = Object.create(null);
let firePressed = false;    // edge-triggered item use
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'throttle', KeyW: 'throttle',
  ArrowDown: 'brake', KeyS: 'brake',
  ShiftLeft: 'drift', ShiftRight: 'drift',
};

function playerInput() {
  const inp = {
    left: !!keys.left, right: !!keys.right,
    throttle: !!keys.throttle, brake: !!keys.brake,
    drift: !!keys.drift,
    fire: firePressed,
  };
  firePressed = false;
  return inp;
}

const fmt = (t) => {
  if (!t || t <= 0) return '--:--.-';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};

function bestFor(idx) {
  const v = Number(localStorage.getItem(LS_BEST(CIRCUIT_INFO[idx].key)) || 0);
  return v > 0 ? v : 0;
}

function showOverlay(title, sub, detail = '') {
  ovTitle.textContent = title;
  ovSub.textContent = sub;
  ovDetail.innerHTML = detail;
  overlay.classList.add('show');
}
function hideOverlay() { overlay.classList.remove('show'); }

function menuDetail() {
  const rows = CIRCUIT_INFO.map((c, i) => {
    const best = bestFor(i);
    const sel = i === selected;
    return `<div class="circuit${sel ? ' sel' : ''}" data-idx="${i}">` +
      `<span class="cname">${sel ? '&#9656; ' : ''}${c.name}</span>` +
      `<span class="cbest">${best ? 'best lap ' + fmt(best) : 'no best lap yet'}</span>` +
      `<span class="cblurb">${c.blurb}</span></div>`;
  }).join('');
  return `<div id="circuit-list">${rows}</div>` +
    `<div class="hint">&uarr;&darr; choose circuit · ENTER race · 3 laps vs 5 burrowfolk</div>`;
}

function showMenu() {
  mode = 'menu';
  sim = null;
  if (!demoSim) demoSim = createRace(circuit(0), { demo: true });
  showOverlay('DUSTKART', 'pick a circuit', menuDetail());
  wireMenuClicks();
}

function wireMenuClicks() {
  for (const el of ovDetail.querySelectorAll('.circuit')) {
    el.addEventListener('click', () => {
      audio.ensure();
      selected = Number(el.dataset.idx);
      startRace(selected);
    });
  }
}

function startRace(idx) {
  raceCircuit = idx;
  sim = createRace(circuit(idx));
  demoSim = null;
  firePressed = false;
  mode = 'countdown';
  endTimer = 0;
  hideOverlay();
  audio.countdownBeep(false);
}

function resultsDetail() {
  const r = sim.results;
  const best = bestFor(raceCircuit);
  const rows = r.map((row) => `<tr class="${row.isPlayer ? 'me' : ''}">` +
    `<td>${row.pos}</td><td>${row.name}${row.isPlayer ? ' (you)' : ''}</td>` +
    `<td>${row.bestLap ? fmt(row.bestLap) : '—'}</td>` +
    `<td>${row.finished ? fmt(row.time) : 'running'}</td></tr>`).join('');
  return `<table id="results"><tr><th>pos</th><th>racer</th><th>best lap</th><th>total</th></tr>${rows}</table>` +
    `<div class="hint"><span class="accent">circuit best lap ${fmt(best)}</span><br>` +
    `ENTER race again · ESC circuit select</div>`;
}

function persistBest() {
  const player = sim.karts[0];
  if (player.bestLap > 0) {
    const key = LS_BEST(CIRCUIT_INFO[raceCircuit].key);
    const prev = Number(localStorage.getItem(key) || 0);
    if (prev === 0 || player.bestLap < prev) {
      localStorage.setItem(key, String(player.bestLap));
      return true;
    }
  }
  return false;
}

const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

function handleEvents(events) {
  const isRace = mode === 'race' || mode === 'countdown' || mode === 'finished';
  for (const ev of events) {
    switch (ev.type) {
      case 'beep': if (isRace) audio.countdownBeep(false); break;
      case 'go': if (isRace) audio.countdownBeep(true); break;
      case 'launch':
        audio.launch();
        renderer.flash('LAUNCH BOOST!', '#5adaff', 1.2);
        break;
      case 'bog':
        audio.bog();
        renderer.flash('TOO EARLY — BOGGED!', '#ff4d4d', 1.4);
        break;
      case 'driftTier':
        if (ev.kart.isPlayer && ev.tier > 0) audio.driftTier(ev.tier);
        break;
      case 'boost':
        if (ev.kart.isPlayer) {
          audio.boost(ev.tier);
          renderer.flash(ev.tier === 2 ? 'TURBO!' : 'BOOST!', '#5adaff', 0.9);
        }
        break;
      case 'item':
        if (ev.kart.isPlayer) {
          audio.itemGet();
          renderer.flash(itemName(ev.kind), '#3adcc0', 1.1);
        }
        break;
      case 'fire':
        if (ev.kart.isPlayer) audio.itemFire();
        break;
      case 'shieldHit':
        if (ev.kart.isPlayer) { audio.shieldPop(); renderer.flash('BARKSHIELD POPPED!', '#8fce6a', 1.1); }
        break;
      case 'spin':
        if (ev.kart.isPlayer) {
          audio.spin();
          renderer.kick(9);
          renderer.flash('SPIN OUT!', '#ff4d4d', 1.1);
        } else if (Math.abs(ev.kart.rank - sim.karts[0].rank) <= 2) {
          audio.bump();
        }
        break;
      case 'tangle':
        if (ev.kart.isPlayer) renderer.flash(`TANGLEROOT! ${ev.hit} snared`, '#7fce5a', 1.3);
        break;
      case 'bump':
        audio.bump();
        renderer.kick(4);
        break;
      case 'lap':
        if (ev.kart.isPlayer) {
          audio.lap();
          renderer.flash(`LAP ${Math.min(ev.laps + 1, LAPS)}/${LAPS} — ${fmt(ev.lapTime)}`, '#ffd23c', 1.6);
        }
        break;
      case 'finish':
        if (ev.kart.isPlayer) renderer.flash('FINISH!', '#ffd23c', 2);
        break;
      case 'raceOver': {
        mode = 'finished';
        endTimer = 2.2;
        restartGuard = 1;
        audio.fanfare(ev.playerPos === 1);
        renderer.flash(`${ORD[ev.playerPos - 1]} PLACE`, ev.playerPos === 1 ? '#ffd23c' : '#e8ecf2', 2.2);
        break;
      }
    }
  }
}

function itemName(kind) {
  return {
    gust: 'GUST VIAL — press SPACE!',
    slick: 'SAP SLICK — press SPACE!',
    burr: 'HOMING BURR — press SPACE!',
    barkshield: 'BARKSHIELD — press SPACE!',
    tangleroot: 'TANGLEROOT — press SPACE!',
  }[kind] || kind.toUpperCase();
}

function tick() {
  if (mode === 'menu') {
    if (demoSim) step(demoSim, {}, STEP);
    return;
  }
  if (!sim) return;
  const events = step(sim, playerInput(), STEP);
  if (mode === 'countdown' && sim.phase === 'racing') mode = 'race';
  handleEvents(events);

  if (mode === 'finished' && endTimer > 0) {
    endTimer -= STEP;
    if (endTimer <= 0) {
      const newBest = persistBest();
      const pos = sim.results.find((r) => r.isPlayer).pos;
      showOverlay(
        pos === 1 ? 'VICTORY!' : `${ORD[pos - 1]} PLACE`,
        'race complete',
        (newBest ? '<div class="accent" style="margin-bottom:8px">NEW CIRCUIT BEST LAP!</div>' : '') + resultsDetail());
    }
  }
  if (restartGuard > 0) restartGuard -= STEP;
}

// ---- fixed-timestep loop with render interpolation ----
let last = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;

  if (mode === 'paused') return;

  acc += dt;
  while (acc >= STEP) { tick(); acc -= STEP; }

  const s = sim || demoSim;
  if (!s) return;
  const player = s.karts[0];
  const fx = {
    steer: (keys.left ? -1 : 0) + (keys.right ? 1 : 0),
    countdown: (mode === 'countdown' || (mode === 'race' && s.time < 0.9))
      ? (s.phase === 'countdown' ? s.countT : 0) : null,
    circuitBest: mode === 'menu' ? 0 : bestFor(raceCircuit),
  };

  renderer.frameDt = dt;
  renderer.render(s, acc / STEP, fx);

  audio.update({
    ratio: player.speed / MAX_SPEED,
    driving: mode !== 'menu' && s.phase !== 'countdown',
    drifting: player.drift.on && player.speed > MAX_SPEED * 0.2,
    boosting: player.boostT > 0,
    offRoad: player.offRoad && player.speed > MAX_SPEED * 0.05,
    spinning: player.spinT > 0,
  });
}

// ---- input ----
window.addEventListener('keydown', (e) => {
  audio.ensure();
  const action = KEYMAP[e.code];
  if (action) { keys[action] = true; e.preventDefault(); }
  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) firePressed = true;
  }

  if (e.code === 'KeyM') { toggleSound(); return; }
  if (e.code === 'KeyP') {
    if (mode === 'race' || mode === 'countdown') {
      modeBefore = mode; mode = 'paused';
      showOverlay('PAUSED', 'press P to resume', '');
    } else if (mode === 'paused') {
      mode = modeBefore; acc = 0; hideOverlay();
    }
    return;
  }
  if (e.code === 'Escape') {
    if (mode !== 'menu') showMenu();
    return;
  }

  if (mode === 'menu') {
    if (e.code === 'ArrowUp' || e.code === 'KeyW') {
      selected = (selected + CIRCUIT_INFO.length - 1) % CIRCUIT_INFO.length;
      ovDetail.innerHTML = menuDetail(); wireMenuClicks();
    } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
      selected = (selected + 1) % CIRCUIT_INFO.length;
      ovDetail.innerHTML = menuDetail(); wireMenuClicks();
    } else if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
      selected = Number(e.code.slice(-1)) - 1;
      startRace(selected);
    } else if (e.code === 'Enter') {
      startRace(selected);
    }
  } else if (mode === 'finished' && restartGuard <= 0 && endTimer <= 0 && e.code === 'Enter') {
    startRace(raceCircuit);
  }
});

window.addEventListener('keyup', (e) => {
  const action = KEYMAP[e.code];
  if (action) { keys[action] = false; e.preventDefault(); }
});

window.addEventListener('blur', () => {
  if (mode === 'race' || mode === 'countdown') {
    modeBefore = mode; mode = 'paused';
    showOverlay('PAUSED', 'press P to resume', '');
  }
  for (const k of Object.keys(keys)) keys[k] = false;
});

function toggleSound() {
  audio.setEnabled(!audio.enabled);
  localStorage.setItem(LS_SOUND, audio.enabled ? 'on' : 'off');
  audioBtn.textContent = `sound: ${audio.enabled ? 'on' : 'off'}`;
}

audioBtn.addEventListener('click', () => { audio.ensure(); toggleSound(); });
canvas.addEventListener('pointerdown', () => audio.ensure());

// Read-mostly seam for the headless browser tests.
DK.debug = {
  get sim() { return sim; },
  get demoSim() { return demoSim; },
  get mode() { return mode; },
  get selected() { return selected; },
  get renderer() { return renderer; },
  get audio() { return audio; },
  startRace,
  showMenu,
};

void itemFlash;
showMenu();
requestAnimationFrame(frame);
})();

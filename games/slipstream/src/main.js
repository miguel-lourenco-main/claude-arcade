// Slipstream — shell: input, game modes, fixed-timestep loop,
// overlays, persistence, audio wiring.
// Classic script (file://-safe): reads everything from the Slipstream
// namespace. Load last, after all the other src scripts.

(function () {
'use strict';
const NS = typeof globalThis !== 'undefined' ? globalThis : window;
const Slipstream = NS.Slipstream = NS.Slipstream || {};
const {
  buildTrack,
  createState, step, autopilot, MAX_SPEED, SPIN_TIME,
  Renderer,
  makeSprites,
  AudioSys,
} = Slipstream;

const STEP = 1 / 60;
const LS_BEST = 'arcade.slipstream.best';
const LS_SOUND = 'arcade.slipstream.sound';

const canvas = document.getElementById('game');
const overlay = document.getElementById('overlay');
const ovTitle = document.getElementById('overlay-title');
const ovSub = document.getElementById('overlay-sub');
const ovDetail = document.getElementById('overlay-detail');
const audioBtn = document.getElementById('audio-toggle');

const track = buildTrack();
const sprites = makeSprites();
const renderer = new Renderer(canvas, sprites);
const audio = new AudioSys();

let best = Number(localStorage.getItem(LS_BEST) || 0);
let sim = null;
let mode = 'attract';        // attract | countdown | race | over | results | paused
let modeBefore = 'attract';  // restored on unpause
let countdown = 0;
let endTimer = 0;            // delay before the end overlay appears
let restartGuard = 0;        // ignore keys right after game over

audio.enabled = (localStorage.getItem(LS_SOUND) || 'on') === 'on';
audioBtn.textContent = `sound: ${audio.enabled ? 'on' : 'off'}`;

const keys = Object.create(null);
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'throttle', KeyW: 'throttle',
  ArrowDown: 'brake', KeyS: 'brake',
};

function playerInput() {
  return {
    left: !!keys.left, right: !!keys.right,
    throttle: !!keys.throttle, brake: !!keys.brake,
  };
}

function showOverlay(title, sub, detail = '') {
  ovTitle.textContent = title;
  ovSub.textContent = sub;
  ovDetail.innerHTML = detail;
  overlay.classList.add('show');
}
function hideOverlay() { overlay.classList.remove('show'); }

function startAttract() {
  sim = createState(track);
  sim.running = false;   // clock frozen; the demo drives forever
  mode = 'attract';
  showOverlay('SLIPSTREAM', 'press ENTER to race',
    `<span class="accent">best score ${String(Math.floor(best)).padStart(6, '0')}</span><br>` +
    'beat the clock through five stages — checkpoints add time');
}

function startRace() {
  sim = createState(track);
  mode = 'countdown';
  countdown = 3;
  endTimer = 0;
  hideOverlay();
  audio.countdownBeep(false);
}

function finishOverlays() {
  if (mode === 'over') {
    showOverlay('TIME UP', 'press any key to race again',
      `score ${Math.floor(sim.score)} &nbsp;·&nbsp; reached stage ${sim.stageIdx + 1}/${track.stages.length}<br>` +
      `<span class="accent">best ${String(Math.floor(best)).padStart(6, '0')}</span> · ESC for title`);
  } else if (mode === 'results') {
    const r = sim.results;
    const newBest = r.total > best;
    if (newBest) { best = r.total; localStorage.setItem(LS_BEST, String(best)); }
    showOverlay('COURSE CLEAR', 'press any key to race again',
      `race time ${r.raceTime.toFixed(1)}s · top speed ${Math.round((r.topSpeed / MAX_SPEED) * 312)} km/h<br>` +
      `time bonus ${r.timeBonus} · ${r.passes} passes +${r.passBonus} · speed +${r.speedBonus}<br>` +
      `<span class="accent">${newBest ? 'NEW BEST — ' : ''}score ${r.total}</span> · ESC for title`);
  }
}

function handleEvents(events) {
  for (const ev of events) {
    switch (ev.type) {
      case 'gear':
        if (mode === 'race' && ev.dir > 0) audio.gearShift();
        break;
      case 'whoosh':
        audio.whoosh();
        break;
      case 'crash':
        audio.crash();
        renderer.kick(10);
        if (mode === 'race') renderer.flash('CRASH!', '#ff4d4d', 1.1);
        break;
      case 'checkpoint':
        audio.checkpoint();
        if (mode === 'race') {
          renderer.flash(`CHECKPOINT  +${ev.add}s`, '#5cff8a', 2);
          renderer.flash(ev.name, '#39d5ff', 2);
        }
        break;
      case 'finish':
        if (mode === 'race') {
          audio.finish();
          mode = 'results';
          endTimer = 2.2;
          restartGuard = 1;
          const r = sim.results;
          renderer.flash('FINISH!', '#ffd23c', 2.2);
          renderer.flash(`+${r.timeBonus + r.passBonus + r.speedBonus} bonus`, '#5cff8a', 2.2);
        } else if (mode === 'attract') {
          startAttract(); // demo lap done — reset the demo
        }
        break;
      case 'timeup':
        if (mode === 'race') {
          audio.timeup();
          mode = 'over';
          endTimer = 2.4;
          restartGuard = 1;
          if (sim.score > best) { best = Math.floor(sim.score); localStorage.setItem(LS_BEST, String(best)); }
        } else if (mode === 'attract') {
          startAttract();
        }
        break;
    }
  }
}

function tick() {
  if (mode === 'countdown') {
    const before = Math.ceil(countdown);
    countdown -= STEP;
    const after = Math.ceil(countdown);
    if (after !== before) audio.countdownBeep(after <= 0);
    if (countdown <= 0 && !sim.running) {
      sim.running = true;
      mode = 'race';
    }
    step(sim, { left: false, right: false, throttle: false, brake: false }, STEP);
    return;
  }

  let input;
  if (mode === 'attract') input = autopilot(sim);
  else if (mode === 'race') input = playerInput();
  else input = { left: false, right: false, throttle: false, brake: false };

  const events = step(sim, input, STEP);
  handleEvents(events);

  if ((mode === 'over' || mode === 'results') && endTimer > 0) {
    endTimer -= STEP;
    if (endTimer <= 0) finishOverlays();
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

  const input = mode === 'race' ? playerInput() : mode === 'attract' ? autopilot(sim) : {};
  const fx = {
    steer: (input.left ? -1 : 0) + (input.right ? 1 : 0),
    brake: !!input.brake && sim.speed > 1,
    offRoad: sim.offRoad,
    onRumble: sim.onRumble,
    countdown: mode === 'countdown' || (mode === 'race' && sim.raceTime < 0.9) ? countdown : null,
  };

  renderer.frameDt = dt;
  renderer.render(sim, acc / STEP, fx);

  audio.update({
    ratio: sim.speed / MAX_SPEED,
    gear: sim.gear,
    driving: (mode === 'race' || mode === 'attract' || mode === 'countdown' ||
              ((mode === 'over' || mode === 'results') && sim.speed > 1)),
    offRoad: sim.offRoad && sim.speed > 1,
    onRumble: sim.onRumble,
    spinning: sim.spin > 0 && sim.spin < SPIN_TIME,
  });
}

// ---- input ----
window.addEventListener('keydown', (e) => {
  audio.ensure();
  const action = KEYMAP[e.code];
  if (action) { keys[action] = true; e.preventDefault(); }
  if (e.code === 'Space') e.preventDefault();

  if (e.code === 'KeyM') {
    toggleSound();
    return;
  }
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
    if (mode === 'race' || mode === 'countdown' || mode === 'over' || mode === 'results' || mode === 'paused') {
      startAttract();
    }
    return;
  }

  if (mode === 'attract' && (e.code === 'Enter' || e.code === 'Space')) {
    startRace();
  } else if ((mode === 'over' || mode === 'results') && restartGuard <= 0 && endTimer <= 0) {
    startRace();
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

// Read-mostly seam for the headless browser tests: exposes live game
// state so assertions can observe mode/sim without reaching into the IIFE.
Slipstream.debug = {
  get sim() { return sim; },
  get mode() { return mode; },
  get renderer() { return renderer; },
  get best() { return best; },
  get audio() { return audio; },
};

startAttract();
requestAnimationFrame(frame);
})();

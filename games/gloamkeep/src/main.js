// Gloamkeep — browser glue: input, fixed-timestep loop, HUD, overlays, saves.
// Classic script on the `Gloamkeep` namespace; load last.

(function () {
'use strict';
const G = globalThis.Gloamkeep = globalThis.Gloamkeep || {};
const { createGame, tick, makeInput, DT, LEVEL_COUNT, MAX_HP,
        makeAssets, createRenderer, createAudio } = G;

const LS_HIGH = 'arcade.gloamkeep.high';
const LS_SOUND = 'arcade.gloamkeep.sound';
const LS_SENS = 'arcade.gloamkeep.sensitivity';

// mouse-look sensitivity: a multiplier on the base turn-per-pixel. Persisted
// and adjustable from the start + pause screens (range 0.3–2.5, default 1).
const BASE_LOOK = 0.0021;
let sensitivity = clampSens(parseFloat(localStorage.getItem(LS_SENS)));
function clampSens(v) { return Number.isFinite(v) ? Math.min(2.5, Math.max(0.3, v)) : 1; }

const $ = (id) => document.getElementById(id);
const screen = $('screen');
const minimap = $('minimap');

const assets = makeAssets();
const renderer = createRenderer(screen, minimap, assets);
const audio = createAudio();

let phase = 'title'; // title | playing | paused | complete | dead | won
let game = null;
let carryAtLevelStart = null; // loadout snapshot for instant restart
let levelIndex = 0;
let high = parseInt(localStorage.getItem(LS_HIGH) || '0', 10) || 0;
let minimapOn = true;

audio.setEnabled(localStorage.getItem(LS_SOUND) !== 'off');

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

// Pointer lock is best-effort: from file:// (or headless) some Chrome configs
// refuse it — swallow the error and rely on the arrow-key turn fallback.
function lockPointer() {
  if (!screen.requestPointerLock) return;
  try {
    const r = screen.requestPointerLock();
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch (err) { /* pointer lock unavailable; keyboard look still works */ }
}

const keys = new Set();
let lookDelta = 0;
let usePressed = false;
let firing = false;

const input = makeInput();

function pollInput() {
  input.forward = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) +
                  (keys.has('KeyS') || keys.has('ArrowDown') ? -1 : 0);
  input.strafe = (keys.has('KeyD') ? 1 : 0) + (keys.has('KeyA') ? -1 : 0);
  input.turnDir = (keys.has('ArrowRight') ? 1 : 0) + (keys.has('ArrowLeft') ? -1 : 0);
  input.lookDelta = lookDelta;
  lookDelta = 0;
  input.fire = firing || keys.has('Space');
  input.usePressed = usePressed;
  usePressed = false;
}

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyE' && phase === 'playing') usePressed = true;
  if (e.code === 'KeyM') {
    minimapOn = !minimapOn;
    minimap.classList.toggle('hidden', !minimapOn);
  }
  if (e.code === 'KeyN') toggleSound();
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (phase === 'playing') pause();
  }
  if (phase === 'dead' && (e.code === 'KeyR' || e.code === 'Enter' || e.code === 'Space')) restartLevel();
  else if (phase === 'complete' && (e.code === 'Enter' || e.code === 'Space')) nextLevel();
  else if (phase === 'won' && (e.code === 'KeyR' || e.code === 'Enter' || e.code === 'Space')) toTitle();
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

screen.addEventListener('mousedown', (e) => {
  if (phase === 'playing') {
    if (document.pointerLockElement !== screen) {
      lockPointer();
    }
    if (e.button === 0) firing = true;
  }
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) firing = false; });
window.addEventListener('mousemove', (e) => {
  if (phase === 'playing' && document.pointerLockElement === screen) {
    lookDelta += e.movementX * BASE_LOOK * sensitivity;
  }
});
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== screen && phase === 'playing') pause();
});
window.addEventListener('blur', () => { if (phase === 'playing') pause(); });

// ---------------------------------------------------------------------------
// Phases / overlays
// ---------------------------------------------------------------------------

const overlays = ['overlay-start', 'overlay-pause', 'overlay-complete', 'overlay-dead', 'overlay-won'];
function showOverlay(id) {
  for (const o of overlays) $(o).classList.toggle('hidden', o !== id);
  $('vignette').classList.toggle('dimmed', id !== null && id !== undefined);
}
function hideOverlays() {
  for (const o of overlays) $(o).classList.add('hidden');
  $('vignette').classList.remove('dimmed');
}

function startLevel(idx, carry) {
  levelIndex = idx;
  carryAtLevelStart = carry ? { ...carry } : null;
  game = createGame(idx, carry, (Math.random() * 0xffffffff) >>> 0);
  fx.damage = 0;
  phase = 'playing';
  hideOverlays();
  updateHud(true);
  $('hud').classList.remove('hidden');
  minimap.classList.toggle('hidden', !minimapOn);
  lockPointer();
}

function startRun() {
  audio.unlock();
  startLevel(0, null);
}

function restartLevel() {
  audio.unlock();
  startLevel(levelIndex, carryAtLevelStart);
}

function nextLevel() {
  if (levelIndex + 1 >= LEVEL_COUNT) { win(); return; }
  startLevel(levelIndex + 1, {
    hp: game.player.hp,
    ammo: game.player.ammo,
    armor: game.player.armor,
    score: game.score,
  });
}

function pause() {
  if (phase !== 'playing') return;
  phase = 'paused';
  if (document.pointerLockElement === screen) document.exitPointerLock();
  showOverlay('overlay-pause');
}

function resume() {
  if (phase !== 'paused') return;
  phase = 'playing';
  hideOverlays();
  lockPointer();
}

function onLevelComplete() {
  phase = 'complete';
  if (document.pointerLockElement === screen) document.exitPointerLock();
  saveHigh();
  $('tally-kills').textContent = `${game.kills} / ${game.totalEnemies}`;
  $('tally-shards').textContent = `${game.shards} / ${game.totalShards}`;
  $('tally-secrets').textContent = `${game.secretsFound} / ${game.totalSecrets}`;
  $('tally-score').textContent = game.score;
  $('complete-name').textContent = game.levelName + ' — cleared';
  $('next-label').textContent = levelIndex + 1 >= LEVEL_COUNT ? 'finish the keep' : 'descend further';
  showOverlay('overlay-complete');
}

function onDead() {
  phase = 'dead';
  if (document.pointerLockElement === screen) document.exitPointerLock();
  saveHigh();
  $('dead-score').textContent = `score ${game.score}`;
  $('dead-high').textContent = `best ${high}`;
  showOverlay('overlay-dead');
}

function win() {
  phase = 'won';
  saveHigh();
  $('won-score').textContent = `final score ${game.score}`;
  $('won-high').textContent = `best ${high}`;
  showOverlay('overlay-won');
}

function toTitle() {
  phase = 'title';
  game = null;
  $('hud').classList.add('hidden');
  minimap.classList.add('hidden');
  showOverlay('overlay-start');
}

function saveHigh() {
  if (game && game.score > high) {
    high = game.score;
    localStorage.setItem(LS_HIGH, String(high));
  }
  $('start-high').textContent = high > 0 ? `best score ${high}` : '';
}

function toggleSound() {
  audio.setEnabled(!audio.enabled);
  localStorage.setItem(LS_SOUND, audio.enabled ? 'on' : 'off');
  for (const b of document.querySelectorAll('.sound-toggle')) {
    b.textContent = audio.enabled ? 'sound: on' : 'sound: off';
  }
}

$('btn-start').addEventListener('click', startRun);
$('btn-resume').addEventListener('click', () => { audio.unlock(); resume(); });
$('btn-next').addEventListener('click', nextLevel);
$('btn-retry').addEventListener('click', restartLevel);
$('btn-again').addEventListener('click', toTitle);
for (const b of document.querySelectorAll('.sound-toggle')) {
  b.textContent = audio.enabled ? 'sound: on' : 'sound: off';
  b.addEventListener('click', toggleSound);
}

// mouse-sensitivity sliders (start + pause screens stay in sync)
const sensSliders = [
  [$('sens-start'), $('sens-start-val')],
  [$('sens-pause'), $('sens-pause-val')],
].filter(([s]) => s);
function syncSens() {
  for (const [slider, label] of sensSliders) {
    slider.value = String(sensitivity);
    label.textContent = sensitivity.toFixed(2) + '×';
  }
}
for (const [slider] of sensSliders) {
  slider.addEventListener('input', () => {
    sensitivity = clampSens(parseFloat(slider.value));
    localStorage.setItem(LS_SENS, String(sensitivity));
    syncSens();
  });
}
syncSens();
saveHigh();

// ---------------------------------------------------------------------------
// Events -> audio + fx
// ---------------------------------------------------------------------------

const fx = { damage: 0, damageDir: 0 };

function handleEvents() {
  for (const ev of game.events) {
    switch (ev.type) {
      case 'shot': audio.shot(); break;
      case 'dryFire': audio.dryFire(); break;
      case 'wallSpark': audio.wallSpark(ev.dist); break;
      case 'enemyHit': audio.enemyHit(); break;
      case 'enemyDie': audio.enemyDie(ev.dist); break;
      case 'growl': audio.growl(ev.dist); break;
      case 'doorOpen': audio.doorOpen(); break;
      case 'doorClose': audio.doorClose(); break;
      case 'locked': audio.locked(); break;
      case 'useThud': audio.useThud(); break;
      case 'secret': audio.secret(); break;
      case 'vaultFound': audio.vault(); break;
      case 'pickup': audio.pickup(ev.kind); break;
      case 'boltFire': audio.boltFire(ev.dist); break;
      case 'boltHit': audio.boltHit(ev.dist); break;
      case 'playerHit':
        audio.playerHit();
        fx.damage = Math.min(1, 0.5 + ev.dmg / 40);
        fx.damageDir = ev.dir;
        break;
      case 'levelComplete': audio.levelComplete(); break;
      case 'gameOver': audio.gameOver(); break;
    }
  }
  game.events.length = 0;
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

let lastHp = -1, lastAmmo = -1, lastScore = -1, lastKeys = '', lastMsg = null;
let lastWard = -1, lastBuffs = null;

function updateHud(force) {
  const p = game.player;
  if (force || p.hp !== lastHp) {
    lastHp = p.hp;
    $('hud-hp-num').textContent = p.hp;
    $('hud-hp-fill').style.width = `${(p.hp / MAX_HP) * 100}%`;
    $('hud-hp-fill').classList.toggle('critical', p.hp <= 25);
  }
  if (force || p.armor !== lastWard) {
    lastWard = p.armor;
    $('hud-ward-group').classList.toggle('hidden', p.armor <= 0);
    $('hud-ward-num').textContent = p.armor;
  }
  const buffs = [];
  if (p.dmgT > 0) buffs.push(`wraith ${Math.ceil(p.dmgT)}s`);
  if (p.speedT > 0) buffs.push(`phase ${Math.ceil(p.speedT)}s`);
  const bstr = buffs.join(' · ');
  if (force || bstr !== lastBuffs) {
    lastBuffs = bstr;
    $('hud-buffs').textContent = bstr;
  }
  if (force || p.ammo !== lastAmmo) {
    lastAmmo = p.ammo;
    $('hud-ammo-num').textContent = p.ammo;
  }
  if (force || game.score !== lastScore) {
    lastScore = game.score;
    $('hud-score').textContent = game.score;
  }
  const kstr = p.keys.map((k) => (k ? '1' : '0')).join('');
  if (force || kstr !== lastKeys) {
    lastKeys = kstr;
    $('key-1').classList.toggle('held', p.keys[0]);
    $('key-2').classList.toggle('held', p.keys[1]);
    $('key-3').classList.toggle('held', p.keys[2]);
  }
  if (force || game.message !== lastMsg) {
    lastMsg = game.message;
    $('hud-message').textContent = game.message;
  }
  if (force) $('hud-level').textContent = game.levelName;
}

// ---------------------------------------------------------------------------
// Loop (fixed timestep with accumulator; rendering per animation frame)
// ---------------------------------------------------------------------------

function resize() {
  screen.width = window.innerWidth;
  screen.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// tiny debug/testing hook (read-only accessor; harmless in play)
window.__gloamkeep = { get game() { return game; }, get phase() { return phase; } };

let last = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let elapsed = (now - last) / 1000;
  last = now;
  if (elapsed > 0.1) elapsed = 0.1; // don't spiral after a hitch

  if (game && phase === 'playing') {
    acc += elapsed;
    while (acc >= DT) {
      pollInput();
      tick(game, input, DT);
      handleEvents();
      acc -= DT;
      if (game.status === 'complete') { onLevelComplete(); break; }
      if (game.status === 'dead') { onDead(); break; }
    }
    fx.damage = Math.max(0, fx.damage - elapsed * 1.8);
    updateHud(false);
  }

  if (game) renderer.render(game, fx, elapsed);
}
requestAnimationFrame(frame);
})();

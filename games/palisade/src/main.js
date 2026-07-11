// Palisade — browser glue: fixed-timestep loop, input, HUD, overlays, persistence.

import {
  createGame, tick, TICK, drainEvents,
  placeTower, upgradeTower, sellTower, cycleTargetMode, canPlace,
  startNextWave, upgradeCost, sellValue, towerStats, wavePreview,
} from './engine/game.js';
import { MAPS, CELL, W, H } from './engine/maps.js';
import { TOWERS, TOWER_ORDER, CREEPS, EARLY_GOLD_PER_SEC } from './engine/data.js';
import { Renderer, drawMapThumb } from './render.js';
import { Sfx } from './sfx.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const renderer = new Renderer(canvas);
const sfx = new Sfx();

const CREEP_DOTS = { normal: '#c9a86a', fast: '#e3d873', tank: '#b56d5e', regen: '#c987cf', swarm: '#d8cdb4' };
const MODE_LABEL = { first: 'first', last: 'last', nearest: 'near', strongest: 'strong' };

let game = null;
let running = false;
let paused = false;
let pausedByBlur = false;
let speedMul = 1;
let placingType = null;
let selectedId = null;
let hover = null;
let acc = 0;
let last = performance.now();

// ------------------------------------------------------------------ persistence

function bestKey(mapIdx) { return `arcade.palisade.best.${mapIdx}`; }
function getBest(mapIdx) { return parseInt(localStorage.getItem(bestKey(mapIdx)) || '0', 10); }
function saveBest(mapIdx, score) {
  if (score > getBest(mapIdx)) {
    localStorage.setItem(bestKey(mapIdx), String(score));
    return true;
  }
  return false;
}

// ------------------------------------------------------------------ start / restart

function startGame(mapIdx) {
  game = createGame(mapIdx);
  renderer.setMap(game.map);
  placingType = null;
  selectedId = null;
  speedMul = 1;
  acc = 0;
  running = true;
  paused = false;
  $('overlay').classList.add('hidden');
  $('map-label').textContent = game.map.name;
  updateSpeedBtn();
  buildShop();
  updateHud();
}

function showMapSelect() {
  running = false;
  game = null;
  const ov = $('overlay');
  ov.classList.remove('hidden');
  $('ov-start').classList.remove('hidden');
  $('ov-end').classList.add('hidden');
  $('ov-pause').classList.add('hidden');
  const wrap = $('map-cards');
  wrap.innerHTML = '';
  MAPS.forEach((map, i) => {
    const card = document.createElement('button');
    card.className = 'map-card';
    const cv = document.createElement('canvas');
    cv.width = 160; cv.height = 112;
    drawMapThumb(cv, map);
    const best = getBest(i);
    const label = document.createElement('div');
    label.innerHTML = `<b>${map.name}</b><span>${map.tagline}</span><em>${best ? 'best ' + best : 'unplayed'}</em>`;
    card.appendChild(cv);
    card.appendChild(label);
    card.addEventListener('click', () => { sfx.unlock(); sfx.place(); startGame(i); });
    wrap.appendChild(card);
  });
}

function endGame(won) {
  running = false;
  const isBest = saveBest(game.mapIdx, game.score);
  const ov = $('overlay');
  ov.classList.remove('hidden');
  $('ov-start').classList.add('hidden');
  $('ov-pause').classList.add('hidden');
  const end = $('ov-end');
  end.classList.remove('hidden');
  $('end-title').textContent = won ? 'THE PALISADE HELD' : 'THE PALISADE FELL';
  $('end-title').className = won ? 'win' : 'lose';
  $('end-detail').textContent = won
    ? `all ${game.totalWaves} waves repelled — ${game.lives} ${game.lives === 1 ? 'life' : 'lives'} to spare`
    : `overrun on wave ${game.waveIdx + 1} of ${game.totalWaves}`;
  $('end-score').innerHTML = `score <b>${game.score}</b> · best <b>${getBest(game.mapIdx)}</b>${isBest ? ' <span class="new-best">new best!</span>' : ''}`;
}

// ------------------------------------------------------------------ game loop

function frame(now) {
  const dtMs = Math.min(now - last, 250);
  last = now;
  if (running && game && !paused) {
    acc += (dtMs / 1000) * speedMul;
    let guard = 0;
    while (acc >= TICK && guard++ < 240) {
      tick(game);
      const evs = drainEvents(game);
      renderer.spawnFromEvents(evs);
      handleEvents(evs);
      if (!running) break;
      acc -= TICK;
    }
    if (guard >= 240) acc = 0; // spiral-of-death guard: drop time we can't simulate
    renderer.updateFx(dtMs / 1000);
  }
  if (game) {
    renderer.draw(game, Math.max(0, Math.min(1, acc / TICK)), {
      hover, placingType, selectedId,
      canPlace: hover ? canPlace(game, hover.c, hover.r) : false,
      affordable: placingType ? game.gold >= TOWERS[placingType].cost : false,
    });
    updateHud();
  }
  requestAnimationFrame(frame);
}

function handleEvents(evs) {
  for (const e of evs) {
    switch (e.t) {
      case 'shot':
        if (e.type === 'arrow') sfx.shotArrow();
        else if (e.type === 'splash') sfx.shotSplash();
        else sfx.shotPoison();
        break;
      case 'frostHit': sfx.frost(); break;
      case 'hit': sfx.hit(); break;
      case 'explosion': sfx.explosion(); break;
      case 'death': sfx.death(); sfx.coin(); break;
      case 'leak': sfx.leak(); flashLives(); break;
      case 'place': sfx.place(); break;
      case 'upgrade': sfx.upgrade(); break;
      case 'sell': sfx.sell(); break;
      case 'earlyBonus': sfx.coin(); break;
      case 'waveStart': sfx.waveStart(); break;
      case 'waveClear': sfx.waveClear(); break;
      case 'win': sfx.win(); endGame(true); break;
      case 'lose': sfx.lose(); endGame(false); break;
    }
  }
}

function flashLives() {
  const el = $('stat-lives');
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

// ------------------------------------------------------------------ HUD

let hudCache = '';
function updateHud() {
  if (!game) return;
  $('stat-gold').textContent = game.gold;
  $('stat-lives').textContent = game.lives;
  $('stat-score').textContent = game.score;
  $('stat-wave').textContent = `${Math.min(game.waveIdx + 1, game.totalWaves)}/${game.totalWaves}`;

  // wave panel
  const inBuild = game.phase === 'build';
  const btn = $('call-wave');
  btn.disabled = !inBuild;
  if (inBuild) {
    const secs = Math.max(0, game.intermission);
    const bonus = Math.max(0, Math.ceil(secs * EARLY_GOLD_PER_SEC));
    btn.textContent = `call wave ${game.waveIdx + 1} now  +${bonus}g`;
    $('wave-timer-fill').style.width = `${(secs / (game.waveIdx === 0 ? 15 : 12)) * 100}%`;
    $('wave-status').textContent = `next wave in ${secs.toFixed(1)}s`;
  } else if (game.phase === 'wave') {
    btn.textContent = 'wave in progress';
    $('wave-timer-fill').style.width = '0%';
    $('wave-status').textContent = `${game.creeps.length + game.spawnQueue.length} foes remain`;
  }

  // preview chips (only rebuild when it changes)
  const pv = wavePreview(game);
  const key = game.waveIdx + ':' + game.phase;
  if (key !== hudCache) {
    hudCache = key;
    const wrap = $('wave-preview');
    wrap.innerHTML = '';
    if (pv) {
      const title = document.createElement('span');
      title.className = 'pv-title';
      title.textContent = game.phase === 'wave' ? 'up next:' : 'incoming:';
      wrap.appendChild(title);
      for (const grp of pv) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.innerHTML = `<i style="background:${CREEP_DOTS[grp.type]}"></i>${CREEPS[grp.type].name} ×${grp.n}`;
        chip.title = creepTip(grp.type);
        wrap.appendChild(chip);
      }
    } else {
      wrap.innerHTML = '<span class="pv-title">final wave!</span>';
    }
  }

  updateShopAfford();
  updateInspector();
}

function creepTip(type) {
  const d = CREEPS[type];
  const extra = type === 'tank' ? ' · leaks 2 lives' : d.regen ? ' · regenerates' : '';
  return `${d.name}: ${d.hp}hp base, speed ${d.speed}${extra}`;
}

// ------------------------------------------------------------------ shop

function buildShop() {
  const wrap = $('shop');
  wrap.innerHTML = '';
  TOWER_ORDER.forEach((type, i) => {
    const def = TOWERS[type];
    const b = document.createElement('button');
    b.className = 'shop-btn';
    b.dataset.type = type;
    b.innerHTML = `<canvas width="34" height="34"></canvas><span class="sb-name">${def.name}</span><span class="sb-cost">${def.cost}g</span><kbd>${i + 1}</kbd>`;
    b.title = def.blurb + ` — dmg ${def.levels[0].dmg}, range ${def.levels[0].range}`;
    drawShopIcon(b.querySelector('canvas'), type);
    b.addEventListener('click', () => { sfx.unlock(); togglePlacing(type); });
    wrap.appendChild(b);
  });
}

function drawShopIcon(cv, type) {
  const g = cv.getContext('2d');
  const fake = { x: 17, y: 19, type, level: 0, aim: -Math.PI / 4, id: 0 };
  renderer.drawTower.call({ ctx: g, t: 0 }, g, fake);
}

function togglePlacing(type) {
  if (placingType === type) placingType = null;
  else { placingType = type; selectedId = null; }
  updateShopSel();
}

function updateShopSel() {
  document.querySelectorAll('.shop-btn').forEach(b => {
    b.classList.toggle('sel', b.dataset.type === placingType);
  });
}

function updateShopAfford() {
  document.querySelectorAll('.shop-btn').forEach(b => {
    b.classList.toggle('poor', game.gold < TOWERS[b.dataset.type].cost);
  });
}

// ------------------------------------------------------------------ inspector

let inspCache = '';
function updateInspector() {
  const panel = $('inspector');
  const tw = game.towers.find(t => t.id === selectedId);
  if (!tw) {
    if (inspCache !== 'none') { panel.classList.add('hidden'); inspCache = 'none'; }
    return;
  }
  const key = `${tw.id}:${tw.level}:${tw.mode}:${game.gold >= (upgradeCost(tw) || 1e9)}:${tw.kills}`;
  if (key === inspCache) return;
  inspCache = key;
  panel.classList.remove('hidden');
  const def = TOWERS[tw.type];
  const st = towerStats(tw);
  $('insp-name').textContent = `${def.name} ${'★'.repeat(tw.level + 1)}`;
  const bits = [`dmg ${st.dmg}`, `rate ${st.rate}/s`, `range ${st.range}`];
  if (st.blast) bits.push(`blast ${st.blast}`);
  if (st.slowDur) bits.push(`slow ${st.slowDur}s`);
  if (st.dot) bits.push(`+${st.dot}/s × ${st.dotDur}s`);
  bits.push(`kills ${tw.kills}`);
  $('insp-stats').textContent = bits.join(' · ');
  $('insp-target').textContent = `target: ${MODE_LABEL[tw.mode]} [T]`;
  const uc = upgradeCost(tw);
  const ub = $('insp-upgrade');
  if (uc === null) {
    ub.textContent = 'max level';
    ub.disabled = true;
  } else {
    const nxt = def.levels[tw.level + 1];
    ub.textContent = `upgrade ${uc}g → dmg ${nxt.dmg} [U]`;
    ub.disabled = game.gold < uc;
  }
  $('insp-sell').textContent = `sell +${sellValue(tw)}g [X]`;
}

// ------------------------------------------------------------------ input

function cellFromEvent(ev) {
  const rect = canvas.getBoundingClientRect();
  const x = (ev.clientX - rect.left) * (W / rect.width);
  const y = (ev.clientY - rect.top) * (H / rect.height);
  return { c: Math.floor(x / CELL), r: Math.floor(y / CELL) };
}

canvas.addEventListener('mousemove', (ev) => { hover = cellFromEvent(ev); });
canvas.addEventListener('mouseleave', () => { hover = null; });

canvas.addEventListener('click', (ev) => {
  if (!running || !game || paused) return;
  sfx.unlock();
  const { c, r } = cellFromEvent(ev);
  if (placingType) {
    const t = placeTower(game, c, r, placingType);
    if (!t) sfx.error();
    else if (game.gold < TOWERS[placingType].cost) { placingType = null; updateShopSel(); }
  } else {
    const tw = game.towers.find(t => t.c === c && t.r === r);
    selectedId = tw ? tw.id : null;
    inspCache = '';
  }
});

canvas.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  placingType = null;
  selectedId = null;
  updateShopSel();
});

document.addEventListener('keydown', (ev) => {
  if (ev.repeat) return;
  const k = ev.key.toLowerCase();

  if (!running) {
    if (k === 'r' && game) { sfx.unlock(); startGame(game.mapIdx); }
    return;
  }
  sfx.unlock();
  if (k === ' ') {
    ev.preventDefault();
    if (!startNextWave(game)) sfx.error();
  } else if (k === '1' || k === '2' || k === '3' || k === '4') {
    togglePlacing(TOWER_ORDER[parseInt(k, 10) - 1]);
  } else if (k === 'f') {
    speedMul = speedMul === 1 ? 2 : 1;
    updateSpeedBtn();
  } else if (k === 'p') {
    togglePause();
  } else if (k === 'm') {
    toggleAudio();
  } else if (k === 'escape') {
    placingType = null;
    selectedId = null;
    updateShopSel();
  } else if (k === 'u' && selectedId !== null) {
    if (!upgradeTower(game, selectedId)) sfx.error();
    inspCache = '';
  } else if (k === 'x' && selectedId !== null) {
    sellTower(game, selectedId);
    selectedId = null;
  } else if (k === 't' && selectedId !== null) {
    cycleTargetMode(game, selectedId);
    inspCache = '';
  } else if (k === 'r') {
    startGame(game.mapIdx);
  }
});

$('call-wave').addEventListener('click', () => { sfx.unlock(); if (!startNextWave(game)) sfx.error(); });
$('insp-upgrade').addEventListener('click', () => { sfx.unlock(); if (!upgradeTower(game, selectedId)) sfx.error(); inspCache = ''; });
$('insp-sell').addEventListener('click', () => { sfx.unlock(); sellTower(game, selectedId); selectedId = null; });
$('insp-target').addEventListener('click', () => { sfx.unlock(); cycleTargetMode(game, selectedId); inspCache = ''; });

$('btn-speed').addEventListener('click', () => { sfx.unlock(); speedMul = speedMul === 1 ? 2 : 1; updateSpeedBtn(); });
$('btn-pause').addEventListener('click', () => { sfx.unlock(); togglePause(); });
$('btn-audio').addEventListener('click', () => { sfx.unlock(); toggleAudio(); });
$('btn-menu').addEventListener('click', () => { showMapSelect(); });
$('end-restart').addEventListener('click', () => { sfx.unlock(); startGame(game.mapIdx); });
$('end-menu').addEventListener('click', () => { showMapSelect(); });
$('resume').addEventListener('click', () => { togglePause(); });

function updateSpeedBtn() { $('btn-speed').textContent = speedMul === 1 ? '▶ 1×' : '▶▶ 2×'; }

function updateAudioBtn() { $('btn-audio').textContent = sfx.enabled ? '♪ on' : '♪ off'; }

function toggleAudio() {
  sfx.setEnabled(!sfx.enabled);
  updateAudioBtn();
}

function togglePause(forced) {
  if (!running || !game) return;
  paused = forced === undefined ? !paused : forced;
  const ov = $('overlay');
  if (paused) {
    ov.classList.remove('hidden');
    $('ov-start').classList.add('hidden');
    $('ov-end').classList.add('hidden');
    $('ov-pause').classList.remove('hidden');
  } else {
    ov.classList.add('hidden');
    pausedByBlur = false;
    last = performance.now();
  }
  $('btn-pause').textContent = paused ? '▶ resume' : '❚❚ pause';
}

window.addEventListener('blur', () => {
  if (running && !paused) { pausedByBlur = true; togglePause(true); }
});
window.addEventListener('focus', () => {
  if (pausedByBlur) togglePause(false);
});

// ------------------------------------------------------------------ boot

updateAudioBtn();
showMapSelect();
requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });

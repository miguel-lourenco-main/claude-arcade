// Fuse — DOM animation layer + input + persistence.
// The logic grid lives in logic.js; this file only reflects it.
// Classic script (file:// safe): reads Game/Synth from window.FuseGame.
(function () {
  'use strict';

  const { Game, Synth } = window.FuseGame;

  const $ = (s) => document.querySelector(s);
  const KEY = (k) => `arcade.fuse.${k}`;

  const boardEl = $('#board');
  const cellsEl = $('#cells');
  const tilesEl = $('#tiles');
  const scoreEl = $('#score');
  const bestEl = $('#best');
  const floatEl = $('#score-float');
  const undoBtn = $('#undo');
  const newBtn = $('#new');
  const soundBtn = $('#sound');
  const overlayEl = $('#overlay');
  const overlayMsg = $('#overlay-msg');
  const keepBtn = $('#keep-going');
  const tryBtn = $('#try-again');

  const SLIDE_MS = 100; // spec: slides ~100ms; merges pop right after

  // ---------- setup ----------

  for (let i = 0; i < 16; i++) cellsEl.appendChild(document.createElement('div'));

  const synth = new Synth(localStorage.getItem(KEY('audio')) !== 'off');
  let best = parseInt(localStorage.getItem(KEY('best')), 10) || 0;

  const game = new Game();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY('state')));
    if (saved) game.load(saved);
  } catch {
    /* corrupted save — start fresh */
  }

  const els = new Map(); // tile id -> element
  let pending = null; // in-flight animation finisher { timer, fn }
  let overlayMode = null; // null | 'win' | 'lose'

  // ---------- rendering ----------

  function makeTileEl(t, cls) {
    const el = document.createElement('div');
    el.className = 'tile' + (cls ? ' ' + cls : '');
    const inner = document.createElement('div');
    inner.className = 'tile-inner';
    el.appendChild(inner);
    setValue(el, t.value);
    setPos(el, t);
    tilesEl.appendChild(el);
    els.set(t.id, el);
    return el;
  }

  function setPos(el, t) {
    el.style.setProperty('--r', t.r);
    el.style.setProperty('--c', t.c);
  }

  function setValue(el, value) {
    const inner = el.firstChild;
    inner.textContent = value;
    inner.dataset.value = value > 8192 ? 'max' : String(value);
    inner.dataset.digits = String(value).length;
  }

  function renderAll() {
    if (pending) {
      clearTimeout(pending.timer);
      pending = null;
    }
    tilesEl.textContent = '';
    els.clear();
    for (const t of game.tiles) makeTileEl(t);
    updateScore();
  }

  function updateScore() {
    scoreEl.textContent = game.score;
    if (game.score > best) {
      best = game.score;
      localStorage.setItem(KEY('best'), String(best));
    }
    bestEl.textContent = best;
    undoBtn.disabled = !game.prev;
  }

  function floatScore(gained) {
    floatEl.textContent = '+' + gained;
    floatEl.classList.remove('go');
    void floatEl.offsetWidth; // restart the animation
    floatEl.classList.add('go');
  }

  function save() {
    localStorage.setItem(KEY('state'), JSON.stringify({ cur: game.serialize(), prev: game.prev }));
  }

  // ---------- overlays ----------

  function showOverlay(mode, msg) {
    overlayMode = mode;
    overlayMsg.textContent = msg;
    keepBtn.classList.toggle('hidden', mode !== 'win');
    tryBtn.textContent = mode === 'win' ? 'New game' : 'Try again (Space)';
    overlayEl.classList.remove('hidden');
  }

  function hideOverlay() {
    overlayMode = null;
    overlayEl.classList.add('hidden');
  }

  // ---------- moves ----------

  // If a previous move's finish step is still queued, run it now so rapid
  // play never drops input.
  function flush() {
    if (!pending) return;
    clearTimeout(pending.timer);
    const fn = pending.fn;
    pending = null;
    fn();
  }

  function handleMove(dir) {
    if (overlayMode) return; // choose on the banner first
    flush();
    if (overlayMode) return; // the flushed move just ended the game
    const res = game.move(dir);
    if (!res.moved) {
      synth.deny();
      return;
    }

    // Phase 1 — slide every tile (CSS transition on transform, ~100ms).
    for (const t of game.tiles) {
      const el = els.get(t.id);
      if (el) setPos(el, t);
    }
    for (const t of res.absorbed) {
      const el = els.get(t.id);
      if (el) {
        el.classList.add('absorbed');
        setPos(el, t);
      }
    }
    synth.slide();

    // Phase 2 — after the slide: drop absorbed tiles, pop merges, spawn.
    const finish = () => {
      pending = null;
      for (const t of res.absorbed) {
        const el = els.get(t.id);
        if (el) el.remove();
        els.delete(t.id);
      }
      for (const t of res.merged) {
        const el = els.get(t.id);
        if (el) {
          setValue(el, t.value);
          el.firstChild.classList.remove('pop');
          void el.firstChild.offsetWidth;
          el.firstChild.classList.add('pop');
        }
      }
      if (res.spawned) makeTileEl(res.spawned, 'spawn');

      if (res.gained) {
        floatScore(res.gained);
        synth.merge(Math.max(...res.merged.map((t) => t.value)));
      } else {
        synth.spawnTick();
      }
      updateScore();
      save();

      if (res.justWon) {
        synth.win();
        showOverlay('win', '2048 — fully fused!');
      } else if (res.over) {
        synth.lose();
        showOverlay('lose', 'No moves left');
      }
    };
    pending = { timer: setTimeout(finish, SLIDE_MS + 10), fn: finish };
  }

  function doUndo() {
    flush();
    if (!game.undo()) return;
    hideOverlay();
    renderAll();
    save();
    synth.spawnTick();
  }

  function newGame() {
    flush();
    hideOverlay();
    game.newGame();
    renderAll();
    save();
    synth.slide();
  }

  // ---------- input ----------

  const DIRS = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    KeyA: 'left', KeyD: 'right', KeyW: 'up', KeyS: 'down',
  };

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    synth.unlock();
    const dir = DIRS[e.code];
    if (dir) {
      e.preventDefault();
      handleMove(dir);
    } else if (e.code === 'KeyZ' || e.code === 'KeyU') {
      doUndo();
    } else if (e.code === 'KeyR' || e.code === 'KeyN') {
      newGame();
    } else if (e.code === 'KeyM') {
      toggleSound();
    } else if (e.code === 'Space' || e.code === 'Enter') {
      if (overlayMode === 'lose') {
        e.preventDefault();
        newGame(); // instant restart on game over
      } else if (overlayMode === 'win') {
        e.preventDefault();
        keepGoing();
      }
    }
  });

  // Swipe input.
  let touchStart = null;
  boardEl.addEventListener(
    'touchstart',
    (e) => {
      synth.unlock();
      if (e.touches.length === 1) {
        touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    },
    { passive: true }
  );
  boardEl.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  boardEl.addEventListener('touchend', (e) => {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    touchStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    handleMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
  });

  function keepGoing() {
    game.keepPlaying = true;
    hideOverlay();
    save();
  }

  function toggleSound() {
    synth.enabled = !synth.enabled;
    localStorage.setItem(KEY('audio'), synth.enabled ? 'on' : 'off');
    if (synth.enabled) {
      synth.unlock();
      synth.spawnTick();
    }
    paintSoundBtn();
  }

  function paintSoundBtn() {
    soundBtn.textContent = synth.enabled ? '♪ on' : '♪ off';
    soundBtn.classList.toggle('muted', !synth.enabled);
  }

  undoBtn.addEventListener('click', () => {
    synth.unlock();
    doUndo();
  });
  newBtn.addEventListener('click', () => {
    synth.unlock();
    newGame();
  });
  soundBtn.addEventListener('click', () => {
    synth.unlock();
    toggleSound();
  });
  tryBtn.addEventListener('click', () => {
    synth.unlock();
    newGame();
  });
  keepBtn.addEventListener('click', () => {
    synth.unlock();
    keepGoing();
  });

  // ---------- boot ----------

  paintSoundBtn();
  renderAll();
  if (game.over) showOverlay('lose', 'No moves left');
  else if (game.won && !game.keepPlaying) showOverlay('win', '2048 — fully fused!');

  // Read-only-ish handle for the committed feature tests (test/browser.test.mjs).
  // Not used by the game itself.
  window.FuseGame._test = { game, render: renderAll, save, hideOverlay };
})();

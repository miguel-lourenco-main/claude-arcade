'use strict';

/* Loads the REAL game.js (unmodified) into a vm sandbox with just enough
   DOM/browser stubbed for it to boot, then exposes its internals for the
   logic tests. No game code is duplicated here — tests exercise the same
   functions the browser runs. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeClassList(initial) {
  const set = new Set(initial || []);
  return {
    add(c) { set.add(c); },
    remove(c) { set.delete(c); },
    toggle(c, force) {
      const want = force === undefined ? !set.has(c) : !!force;
      if (want) set.add(c); else set.delete(c);
      return want;
    },
    contains(c) { return set.has(c); },
  };
}

function makeCtx2d() {
  // canvas 2d context stub: any method is a no-op, any property is writable
  return new Proxy({}, {
    get(t, k) {
      if (!(k in t)) t[k] = function () {};
      return t[k];
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

function makeElement(id) {
  const listeners = {};
  return {
    id,
    textContent: '',
    innerHTML: '',
    classList: makeClassList(id === 'confirm-buttons' ? ['hidden'] : []),
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    dispatch(type, ev) { (listeners[type] || []).forEach(fn => fn(ev)); },
    blur() {},
    click() { this.dispatch('click', { stopPropagation() {}, preventDefault() {} }); },
    getContext() { return makeCtx2d(); },
    _listeners: listeners,
  };
}

function load() {
  const elements = {};
  const getEl = id => (elements[id] = elements[id] || makeElement(id));

  const docListeners = {};
  const store = {};
  const sandbox = {
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
      _store: store,
    },
    document: {
      getElementById: getEl,
      addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
    },
    window: { addEventListener() {} }, // no AudioContext -> audio engine stays inert
    performance: { now: () => Date.now() },
    requestAnimationFrame() { return 0; }, // never run the rAF loop; tests drive logicTick
    setTimeout, clearTimeout,
    console,
  };
  vm.createContext(sandbox);

  const gamePath = path.join(__dirname, '..', 'game.js');
  const code = fs.readFileSync(gamePath, 'utf8') + `
;globalThis.__q = {
  G, PIECES, KICKS, CLEAR_SCORE, CLEAR_NAME,
  COLS, ROWS, HIDDEN, VISIBLE, LOCK_MS, LOCK_RESETS, DAS_MS, ARR_MS,
  gravityMs, emptyBoard, pieceCells, fits, refillBag, drawFromBag, topUpQueue,
  spawnPosition, spawnPiece, nextPiece, tryMove, tryRotate, ghostY, hardDrop,
  stashPiece, lockPiece, startClear, finishClear, resetGame, startGame,
  gameOver, pauseGame, resumeGame, openRestartConfirm, cancelRestartConfirm,
  confirmRestart, logicTick, AudioSys,
};`;
  vm.runInContext(code, sandbox, { filename: gamePath });

  const q = sandbox.__q;
  q.localStorage = sandbox.localStorage;
  q.el = getEl;
  q.keydown = (key, extra) => {
    (docListeners.keydown || []).forEach(fn =>
      fn(Object.assign({ key, repeat: false, preventDefault() {} }, extra)));
  };
  q.keyup = key => {
    (docListeners.keyup || []).forEach(fn => fn({ key, preventDefault() {} }));
  };
  // advance the fixed-timestep logic by ms in 1/60s ticks (same as the game loop)
  q.tick = ms => {
    const DT = 1000 / 60;
    for (let t = 0; t < ms - 1e-9; t += DT) q.logicTick(DT);
  };
  return q;
}

module.exports = { load };

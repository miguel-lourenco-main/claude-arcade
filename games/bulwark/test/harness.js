'use strict';
// Loads the real game.js inside a stubbed DOM so the mechanics run in plain
// node. No game logic is duplicated here — only browser surface is faked.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GAME_JS = path.join(__dirname, '..', 'game.js');

function stubCtx() {
  // any method call is a no-op; any property set/get round-trips
  const store = {};
  return new Proxy(store, {
    get(t, p) {
      if (p in t) return t[p];
      return () => {};
    },
    set(t, p, v) { t[p] = v; return true; },
  });
}

function stubCanvas() {
  return { width: 0, height: 0, getContext: () => stubCtx() };
}

function stubElement(id) {
  const set = new Set();
  return {
    id,
    textContent: '',
    listeners: {},
    classList: {
      add(...c) { c.forEach(x => set.add(x)); },
      remove(...c) { c.forEach(x => set.delete(x)); },
      toggle(c, force) {
        const on = force === undefined ? !set.has(c) : !!force;
        if (on) set.add(c); else set.delete(c);
      },
      contains(c) { return set.has(c); },
    },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    click() { (this.listeners.click || []).forEach(fn => fn({})); },
    blur() {},
  };
}

function load() {
  const ids = ['score', 'best', 'wave', 'overlay', 'overlay-title',
               'overlay-sub', 'overlay-score', 'audio-toggle', 'reset-btn'];
  const elements = {};
  for (const id of ids) elements[id] = stubElement(id);
  elements['game'] = Object.assign(stubElement('game'), stubCanvas());

  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };

  const winListeners = {};
  const sandbox = {
    document: {
      getElementById: (id) => elements[id],
      createElement: (tag) => (tag === 'canvas' ? stubCanvas() : stubElement(tag)),
    },
    localStorage,
    addEventListener: (type, fn) => { (winListeners[type] = winListeners[type] || []).push(fn); },
    performance: { now: () => Date.now() },
    requestAnimationFrame: () => 0, // tests drive logic via __bulwark.tick
    console,
    __BULWARK_TEST: true,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(GAME_JS, 'utf8'), sandbox, { filename: 'game.js' });

  return {
    bw: sandbox.__bulwark,
    el: (id) => elements[id],
    store,
    key(k) { (winListeners.keydown || []).forEach(fn => fn({ key: k, preventDefault() {} })); },
    keyUp(k) { (winListeners.keyup || []).forEach(fn => fn({ key: k, preventDefault() {} })); },
    blurWindow() { (winListeners.blur || []).forEach(fn => fn()); },
    click(id) { elements[id].click(); },
  };
}

module.exports = { load };

// Deterministic, serializable PRNG (mulberry32). The whole game runs off one
// of these so a saved run resumes with the exact same dice.
// Classic script: attaches to the page-global Delve namespace (works from
// file:// where ES modules are blocked; also loadable via require() in node).
(function (global) {
  'use strict';
  const Delve = global.Delve = global.Delve || {};

  class RNG {
    constructor(seed = 1) {
      this.s = seed >>> 0;
    }

    get state() { return this.s; }
    set state(v) { this.s = v >>> 0; }

    next() {
      this.s = (this.s + 0x6d2b79f5) >>> 0;
      let t = this.s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /** Integer in [0, n) */
    int(n) { return Math.floor(this.next() * n); }

    /** Integer in [a, b] inclusive */
    range(a, b) { return a + this.int(b - a + 1); }

    pick(arr) { return arr[this.int(arr.length)]; }

    chance(p) { return this.next() < p; }
  }

  Delve.RNG = RNG;
})(globalThis);

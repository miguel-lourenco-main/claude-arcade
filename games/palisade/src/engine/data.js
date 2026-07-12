// Palisade — static game data: towers, creeps, waves, scaling curves.
// Pure data + pure functions; no DOM, no side effects.
// Classic script (file:// safe): attaches to the Palisade namespace.
(function () {
'use strict';
const NS = globalThis.Palisade = globalThis.Palisade || {};

const SLOW_FACTOR = 0.55;   // speed multiplier while slowed (constant; slows stack DURATION, never factor)
const SLOW_CAP = 6;         // max seconds of slow that can be banked on one creep
const POISON_TICK = 0.5;    // seconds between poison damage ticks
const SELL_REFUND = 0.7;    // fraction of invested gold refunded on sell
const RETARGET_RADIUS = 70; // px — homing projectiles retarget within this of themselves
const START_GOLD = 150;
const START_LIVES = 20;
const FIRST_INTERMISSION = 15; // s before wave 1 auto-starts
const INTERMISSION = 12;       // s between waves
const EARLY_GOLD_PER_SEC = 2;  // early-call bonus rate

const TARGET_MODES = ['first', 'last', 'nearest', 'strongest'];

const TOWERS = {
  arrow: {
    name: 'Arrow',
    blurb: 'Fast single-target bolts. Homing — never misses.',
    cost: 50,
    upgrades: [70, 120],
    projSpeed: 340,
    levels: [
      { dmg: 8, rate: 1.6, range: 110 },
      { dmg: 16, rate: 2.0, range: 125 },
      { dmg: 30, rate: 2.5, range: 140 },
    ],
  },
  splash: {
    name: 'Mortar',
    blurb: 'Slow lobbed shell. Area damage, falls off from the center.',
    cost: 75,
    upgrades: [95, 160],
    projSpeed: 190,
    levels: [
      { dmg: 15, rate: 0.6, range: 100, blast: 42 },
      { dmg: 28, rate: 0.68, range: 110, blast: 50 },
      { dmg: 50, rate: 0.78, range: 120, blast: 58 },
    ],
  },
  frost: {
    name: 'Frost',
    blurb: 'Instant chill. Slows to 55% speed; repeat hits extend the slow.',
    cost: 60,
    upgrades: [80, 130],
    levels: [
      { dmg: 3, rate: 1.0, range: 95, slowDur: 1.6 },
      { dmg: 6, rate: 1.15, range: 105, slowDur: 2.2 },
      { dmg: 10, rate: 1.3, range: 118, slowDur: 3.0 },
    ],
  },
  poison: {
    name: 'Thorn',
    blurb: 'Venomous dart. Damage keeps ticking after the hit.',
    cost: 65,
    upgrades: [85, 140],
    projSpeed: 260,
    levels: [
      { dmg: 4, rate: 0.9, range: 100, dot: 5, dotDur: 4.0 },
      { dmg: 8, rate: 1.0, range: 110, dot: 9, dotDur: 4.5 },
      { dmg: 14, rate: 1.1, range: 120, dot: 15, dotDur: 5.0 },
    ],
  },
};

const TOWER_ORDER = ['arrow', 'splash', 'frost', 'poison'];

const CREEPS = {
  normal: { name: 'Walker', hp: 38, speed: 60, bounty: 4, lives: 1, radius: 7, gap: 0.8 },
  fast: { name: 'Skitter', hp: 26, speed: 108, bounty: 4, lives: 1, radius: 6, gap: 0.55 },
  tank: { name: 'Hulk', hp: 175, speed: 40, bounty: 11, lives: 2, radius: 10, gap: 1.5 },
  regen: { name: 'Mender', hp: 75, speed: 55, bounty: 8, lives: 1, radius: 8, regen: 7, gap: 0.9 },
  swarm: { name: 'Mite', hp: 13, speed: 78, bounty: 1, lives: 1, radius: 4.5, gap: 0.22 },
};

// Scripted wave compositions. Groups spawn in order with a short pause between groups.
// Counts/HP/speed are further scaled by wave index (see hpScale/speedScale below).
const WAVES = [
  /*  1 */ [{ type: 'normal', n: 8 }],
  /*  2 */ [{ type: 'normal', n: 11 }],
  /*  3 */ [{ type: 'normal', n: 6 }, { type: 'fast', n: 5 }],
  /*  4 */ [{ type: 'swarm', n: 14 }],
  /*  5 */ [{ type: 'tank', n: 2 }, { type: 'normal', n: 6 }],
  /*  6 */ [{ type: 'fast', n: 10 }],
  /*  7 */ [{ type: 'normal', n: 8 }, { type: 'swarm', n: 8 }],
  /*  8 */ [{ type: 'regen', n: 4 }, { type: 'normal', n: 6 }],
  /*  9 */ [{ type: 'tank', n: 3 }, { type: 'fast', n: 8 }],
  /* 10 */ [{ type: 'swarm', n: 16 }, { type: 'tank', n: 2 }],
  /* 11 */ [{ type: 'regen', n: 10 }],
  /* 12 */ [{ type: 'fast', n: 12 }, { type: 'regen', n: 4 }],
  /* 13 */ [{ type: 'tank', n: 5 }, { type: 'swarm', n: 10 }],
  /* 14 */ [{ type: 'normal', n: 12 }, { type: 'fast', n: 6 }, { type: 'regen', n: 4 }],
  /* 15 */ [{ type: 'swarm', n: 22 }],
  /* 16 */ [{ type: 'tank', n: 6 }, { type: 'regen', n: 6 }],
  /* 17 */ [{ type: 'fast', n: 14 }, { type: 'tank', n: 4 }],
  /* 18 */ [{ type: 'regen', n: 10 }, { type: 'swarm', n: 12 }],
  /* 19 */ [{ type: 'tank', n: 8 }, { type: 'fast', n: 8 }],
  /* 20 */ [{ type: 'tank', n: 6 }, { type: 'regen', n: 10 }, { type: 'swarm', n: 14 }],
];

const GROUP_GAP = 1.2; // s pause between groups within a wave

// w is the 0-based wave index.
function hpScale(w) { return 1 + 0.18 * w + 0.012 * w * w; }
function speedScale(w) { return Math.min(1.35, 1 + 0.012 * w); }
function bountyScale(w) { return 1 + 0.07 * w; }
function waveClearBonus(w) { return 20 + 4 * w; }

NS.data = {
  SLOW_FACTOR, SLOW_CAP, POISON_TICK, SELL_REFUND, RETARGET_RADIUS,
  START_GOLD, START_LIVES, FIRST_INTERMISSION, INTERMISSION, EARLY_GOLD_PER_SEC,
  TARGET_MODES, TOWERS, TOWER_ORDER, CREEPS, WAVES, GROUP_GAP,
  hpScale, speedScale, bountyScale, waveClearBonus,
};
})();

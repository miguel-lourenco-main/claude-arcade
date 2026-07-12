"use strict";

/* ================= Rootguard — pure lane-defense rules =================
 * Dual-environment module: attaches to window.RootguardLogic in the browser
 * (classic <script>, no modules) and to module.exports under node so the
 * committed test suite exercises the exact same code the game runs.
 * No DOM, no canvas, no audio in here — just the field rules.
 *
 * The field is 5 lanes x 9 columns. Blights enter from the right at
 * x = SPAWN_X and shamble left per-pixel (x in fractional cell units).
 * Plants occupy whole cells. Each lane has a one-use root surge at the far
 * left: the first breach clears the lane, the second loses the level.
 */
(function (root, factory) {
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = factory();
  } else {
    root.RootguardLogic = factory();
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  const LANES = 5;
  const COLS = 9;
  const START_DEW = 50;
  const MOTE_VALUE = 25;
  const MOTE_TTL = 8;            // seconds a landed mote lives before fading
  const MOTE_FALL_SPEED = 1.4;   // lanes per second while a sky mote falls
  const SPAWN_X = COLS + 0.4;    // blights enter here
  const BREACH_X = -0.15;        // crossing this triggers the lane's root surge
  const SHOT_SPEED = 8;          // cells per second
  const SHOT_HIT = 0.4;          // hit window around a projectile
  const MOUTH = 0.35;            // blight mouth offset ahead of its center
  const SLOW_FACTOR = 0.6;       // frosted blights move at 60% (a 40% slow)
  const SLOW_DURATION = 3;       // seconds; refreshed, never stacked

  // ---- plant kit ------------------------------------------------------------
  const PLANTS = {
    dewblossom: {
      name: "Dewblossom", cost: 50, cooldown: 7, hp: 300,
      produceEvery: 24, firstProduce: 12,
      blurb: "grows a dew mote every 24s",
    },
    thornshot: {
      name: "Thornshot", cost: 100, cooldown: 7, hp: 300,
      fireEvery: 1.4, damage: 20, shot: "thorn",
      blurb: "fires a thorn every 1.4s",
    },
    frostfern: {
      name: "Frostfern", cost: 150, cooldown: 7, hp: 300,
      fireEvery: 1.4, damage: 20, shot: "frost",
      blurb: "thorns that chill 40% for 3s",
    },
    bulwarkroot: {
      name: "Bulwarkroot", cost: 50, cooldown: 20, hp: 3000, wall: true,
      blurb: "a stubborn 10x-tough wall",
    },
    burstcap: {
      name: "Burstcap", cost: 125, cooldown: 25, hp: 300,
      bomb: true, bombDamage: 900,
      blurb: "explodes 3x3 on contact — once",
    },
    sporelobber: {
      name: "Sporelobber", cost: 175, cooldown: 7, hp: 300,
      fireEvery: 2.8, damage: 45, shot: "lob", splash: 1,
      blurb: "lobs spores over walls, 1-cell splash",
    },
  };
  const PLANT_ORDER = [
    "dewblossom", "thornshot", "frostfern",
    "bulwarkroot", "burstcap", "sporelobber",
  ];

  // ---- blight kit -------------------------------------------------------------
  // shambler is the baseline; the rest are stated as multiples of it.
  const BLIGHTS = {
    shambler:  { name: "Shambler",        hp: 200, speed: 0.20, chompDmg: 25, chompEvery: 0.5, size: 0.42 },
    helmed:    { name: "Helmed Shambler", hp: 500, speed: 0.20, chompDmg: 25, chompEvery: 0.5, size: 0.44, helmed: true },
    sprinter:  { name: "Sprinter",        hp: 120, speed: 0.40, chompDmg: 25, chompEvery: 0.5, size: 0.38 },
    hulk:      { name: "Hulk",            hp: 800, speed: 0.12, chompDmg: 35, chompEvery: 0.5, size: 0.55, wallMult: 3 },
    skitterer: { name: "Skitterer",       hp: 100, speed: 0.27, chompDmg: 15, chompEvery: 0.4, size: 0.28 },
  };

  // ---- scripted levels ------------------------------------------------------------
  function sp(type, lane, delay) {
    return { type: type, lane: lane === undefined ? null : lane, delay: delay || 0 };
  }

  const LEVELS = [
    {
      name: "Seedling Watch",
      plants: ["dewblossom", "thornshot", "bulwarkroot"],
      skyMoteEvery: 9,
      waves: [
        { at: 18,  spawns: [sp("shambler", 2)] },
        { at: 40,  spawns: [sp("shambler")] },
        { at: 58,  spawns: [sp("shambler"), sp("shambler", null, 3)] },
        { at: 76,  spawns: [sp("shambler"), sp("shambler", null, 2.5)] },
        { at: 92,  spawns: [sp("shambler"), sp("shambler", null, 2), sp("shambler", null, 4)] },
        { at: 110, final: true, spawns: [
          sp("shambler", 0), sp("shambler", 1, 1.2), sp("shambler", 3, 2.4),
          sp("shambler", 4, 3.6), sp("shambler", 2, 5),
        ] },
      ],
    },
    {
      name: "Pale Helm Rising",
      plants: ["dewblossom", "thornshot", "frostfern", "bulwarkroot"],
      skyMoteEvery: 9,
      waves: [
        { at: 15,  spawns: [sp("shambler")] },
        { at: 32,  spawns: [sp("shambler"), sp("shambler", null, 2.5)] },
        { at: 50,  spawns: [sp("helmed", 2)] },
        { at: 66,  spawns: [sp("shambler"), sp("helmed", null, 3)] },
        { at: 84,  spawns: [sp("shambler"), sp("shambler", null, 2), sp("helmed", null, 4)] },
        { at: 102, spawns: [sp("helmed"), sp("shambler", null, 1.5), sp("helmed", null, 3.5)] },
        { at: 122, final: true, spawns: [
          sp("helmed", 1), sp("shambler", 0, 1), sp("shambler", 2, 2),
          sp("helmed", 3, 3), sp("shambler", 4, 4), sp("shambler", 2, 5.5),
        ] },
      ],
    },
    {
      name: "Quickblight Hollow",
      plants: ["dewblossom", "thornshot", "frostfern", "bulwarkroot", "burstcap"],
      skyMoteEvery: 10,
      waves: [
        { at: 14,  spawns: [sp("shambler")] },
        { at: 28,  spawns: [sp("sprinter", 2)] },
        { at: 44,  spawns: [sp("shambler"), sp("sprinter", null, 2)] },
        { at: 60,  spawns: [sp("helmed"), sp("sprinter", null, 1.5), sp("shambler", null, 3)] },
        { at: 78,  spawns: [sp("sprinter"), sp("sprinter", null, 1), sp("shambler", null, 3)] },
        { at: 96,  spawns: [sp("helmed"), sp("helmed", null, 2), sp("sprinter", null, 3.5)] },
        { at: 116, final: true, spawns: [
          sp("sprinter", 0), sp("sprinter", 4, 0.8), sp("shambler", 1, 1.6),
          sp("helmed", 2, 2.4), sp("shambler", 3, 3.2), sp("sprinter", 2, 4),
          sp("helmed", 1, 5), sp("shambler", 4, 6),
        ] },
      ],
    },
    {
      name: "The Shudderfall",
      plants: ["dewblossom", "thornshot", "frostfern", "bulwarkroot", "burstcap", "sporelobber"],
      skyMoteEvery: 10,
      waves: [
        { at: 14,  spawns: [sp("shambler"), sp("shambler", null, 2)] },
        { at: 30,  spawns: [sp("hulk", 2)] },
        { at: 48,  spawns: [sp("helmed"), sp("sprinter", null, 2)] },
        { at: 66,  spawns: [sp("hulk"), sp("shambler", null, 2), sp("shambler", null, 3.5)] },
        { at: 84,  spawns: [sp("sprinter"), sp("sprinter", null, 1), sp("helmed", null, 2.5)] },
        { at: 102, spawns: [sp("hulk", 1), sp("hulk", 3, 2.5), sp("shambler", null, 4)] },
        { at: 124, final: true, spawns: [
          sp("hulk", 2), sp("helmed", 0, 1), sp("helmed", 4, 2),
          sp("sprinter", 1, 3), sp("sprinter", 3, 4), sp("hulk", 2, 5),
          sp("shambler", 0, 6), sp("shambler", 4, 7),
        ] },
      ],
    },
    {
      name: "The Creeping Swarm",
      plants: ["dewblossom", "thornshot", "frostfern", "bulwarkroot", "burstcap", "sporelobber"],
      skyMoteEvery: 11,
      waves: [
        { at: 12,  spawns: [sp("shambler"), sp("shambler", null, 2)] },
        { at: 26,  spawns: [sp("skitterer", 1), sp("skitterer", 1, 0.5), sp("skitterer", 1, 1), sp("skitterer", 1, 1.5)] },
        { at: 42,  spawns: [sp("sprinter"), sp("helmed", null, 2)] },
        { at: 58,  spawns: [sp("skitterer", 3), sp("skitterer", 3, 0.5), sp("skitterer", 3, 1), sp("hulk", null, 2.5)] },
        { at: 76,  spawns: [sp("helmed"), sp("sprinter", null, 1.5), sp("sprinter", null, 3)] },
        { at: 94,  spawns: [
          sp("skitterer", 0), sp("skitterer", 0, 0.5), sp("skitterer", 0, 1),
          sp("skitterer", 4, 0.2), sp("skitterer", 4, 0.7), sp("skitterer", 4, 1.2),
          sp("shambler", 2, 3),
        ] },
        { at: 112, spawns: [sp("hulk", 1), sp("helmed", 3, 1.5), sp("hulk", 3, 3)] },
        { at: 134, final: true, spawns: [
          sp("skitterer", 2), sp("skitterer", 2, 0.4), sp("skitterer", 2, 0.8), sp("skitterer", 2, 1.2),
          sp("hulk", 0, 2), sp("hulk", 4, 3), sp("sprinter", 1, 4), sp("sprinter", 3, 4.6),
          sp("helmed", 2, 5.4), sp("helmed", 0, 6.2), sp("shambler", 4, 7),
          sp("shambler", 1, 8), sp("sprinter", 2, 9),
        ] },
      ],
    },
  ];

  // ---- utilities ----------------------------------------------------------------
  // Deterministic LCG for the test suites; the game passes Math.random.
  function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function buildQueue(level) {
    const q = [];
    let finalAt = 0;
    for (const w of level.waves) {
      if (w.final) finalAt = w.at;
      for (const s of w.spawns) {
        q.push({ at: w.at + (s.delay || 0), type: s.type, lane: s.lane });
      }
    }
    q.sort(function (a, b) { return a.at - b.at; });
    return { q: q, finalAt: finalAt };
  }

  // ---- game state -----------------------------------------------------------------
  function createGame(levelIndex, rng) {
    const level = LEVELS[levelIndex];
    const built = buildQueue(level);
    return {
      levelIndex: levelIndex,
      time: 0,
      dew: level.startDew != null ? level.startDew : START_DEW,
      status: "playing",          // playing | won | lost
      plants: [],
      blights: [],
      shots: [],
      lobs: [],
      motes: [],
      surges: [true, true, true, true, true],
      cooldowns: {},              // plant type -> seconds remaining
      nextSkyMote: level.skyMoteEvery,
      spawnQueue: built.q,
      queueIdx: 0,
      totalSpawns: built.q.length,
      spawnedCount: 0,
      killed: 0,
      finalAt: built.finalAt,
      duration: built.q.length ? built.q[built.q.length - 1].at : 0,
      bannerShown: false,
      events: [],                 // drained by the renderer for sfx/particles
      rng: rng || Math.random,
      nextId: 1,
    };
  }

  function plantAtCell(state, lane, col) {
    for (const p of state.plants) {
      if (p.lane === lane && p.col === col) return p;
    }
    return null;
  }

  // Returns null when plantable, or a reason string.
  function canPlant(state, type, lane, col) {
    const def = PLANTS[type];
    if (!def) return "unknown";
    if (LEVELS[state.levelIndex].plants.indexOf(type) < 0) return "locked";
    if (lane < 0 || lane >= LANES || col < 0 || col >= COLS) return "bounds";
    if (plantAtCell(state, lane, col)) return "occupied";
    if (state.dew < def.cost) return "dew";
    if ((state.cooldowns[type] || 0) > 0) return "cooldown";
    return null;
  }

  function plantAt(state, type, lane, col) {
    const why = canPlant(state, type, lane, col);
    if (why) return why;
    const def = PLANTS[type];
    state.plants.push({
      id: state.nextId++,
      type: type, lane: lane, col: col,
      hp: def.hp, maxHp: def.hp,
      fireT: def.fireEvery ? 0.4 : 0,
      produceT: def.produceEvery ? def.firstProduce : 0,
    });
    state.dew -= def.cost;
    state.cooldowns[type] = def.cooldown;
    state.events.push({ t: "plant", lane: lane, col: col, kind: type });
    return null;
  }

  // The shovel: dig up a planted defender. No refund.
  function shovelAt(state, lane, col) {
    const p = plantAtCell(state, lane, col);
    if (!p) return false;
    state.plants.splice(state.plants.indexOf(p), 1);
    state.events.push({ t: "shovel", lane: lane, col: col });
    return true;
  }

  function addMote(state, x, y, falling) {
    const m = {
      id: state.nextId++,
      x: x, y: falling ? -0.6 : y, targetY: y,
      age: 0, landed: !falling,
    };
    state.motes.push(m);
    return m;
  }

  function collectMote(state, id) {
    for (let i = 0; i < state.motes.length; i++) {
      if (state.motes[i].id === id) {
        const m = state.motes[i];
        state.motes.splice(i, 1);
        state.dew += MOTE_VALUE;
        state.events.push({ t: "mote", x: m.x, y: Math.max(m.y, 0) });
        return true;
      }
    }
    return false;
  }

  function spawnBlight(state, type, lane, x) {
    const def = BLIGHTS[type];
    const b = {
      id: state.nextId++,
      type: type, lane: lane,
      x: x === undefined ? SPAWN_X : x,
      hp: def.hp, maxHp: def.hp,
      slowT: 0, eating: null, chompT: 0, dead: false,
    };
    state.blights.push(b);
    return b;
  }

  // The lane-scan gate: a shooter in (lane, col) may fire only when a live
  // blight is in its lane, AHEAD of it, and on (or entering) the field.
  function laneHasTarget(state, lane, col) {
    for (const b of state.blights) {
      if (!b.dead && b.lane === lane && b.x > col + 0.4 && b.x < COLS + 0.5) return true;
    }
    return false;
  }

  function firstTarget(state, lane, col) {
    let best = null;
    for (const b of state.blights) {
      if (b.dead || b.lane !== lane) continue;
      if (b.x <= col + 0.4 || b.x >= COLS + 0.5) continue;
      if (!best || b.x < best.x) best = b;
    }
    return best;
  }

  // Helmet visual stage for helmed shamblers: 2 intact, 1 cracked, 0 gone.
  function helmetStage(b) {
    const r = b.hp / b.maxHp;
    return r > 2 / 3 ? 2 : r > 1 / 3 ? 1 : 0;
  }

  function damageBlight(state, b, dmg) {
    if (b.dead) return;
    const before = BLIGHTS[b.type].helmed ? helmetStage(b) : -1;
    b.hp -= dmg;
    state.events.push({ t: "hit", lane: b.lane, x: b.x, id: b.id });
    if (before >= 0 && helmetStage(b) < before && b.hp > 0) {
      state.events.push({ t: "clink", lane: b.lane, x: b.x });
    }
    if (b.hp <= 0) {
      b.dead = true;
      state.killed++;
      state.events.push({ t: "die", lane: b.lane, x: b.x, kind: b.type });
    }
  }

  // Burstcap: single-use 3x3 explosion centered on the cap's cell.
  function explodeCap(state, plant) {
    const idx = state.plants.indexOf(plant);
    if (idx < 0) return;
    state.plants.splice(idx, 1);
    state.events.push({ t: "boom", lane: plant.lane, col: plant.col });
    const dmg = PLANTS[plant.type].bombDamage;
    for (const b of state.blights) {
      if (b.dead) continue;
      if (Math.abs(b.lane - plant.lane) > 1) continue;
      if (b.x < plant.col - 1.2 || b.x > plant.col + 2.2) continue;
      damageBlight(state, b, dmg);
    }
  }

  // A blight crossed the left edge. First breach in a lane fires that lane's
  // one-use root surge and clears the lane; a second breach loses the level.
  function breach(state, b) {
    if (state.surges[b.lane]) {
      state.surges[b.lane] = false;
      state.events.push({ t: "surge", lane: b.lane });
      for (const o of state.blights) {
        if (!o.dead && o.lane === b.lane) {
          o.dead = true;
          state.killed++;
        }
      }
    } else {
      state.status = "lost";
      state.events.push({ t: "breach", lane: b.lane });
    }
  }

  // ---- the simulation tick (fixed dt, typically 1/60) --------------------------------
  function tick(state, dt) {
    if (state.status !== "playing") return;
    state.time += dt;
    const level = LEVELS[state.levelIndex];

    // seed card cooldowns
    for (const k in state.cooldowns) {
      if (state.cooldowns[k] > 0) state.cooldowns[k] = Math.max(0, state.cooldowns[k] - dt);
    }

    // FINAL SURGE banner fires once, shortly before the last mass wave
    if (!state.bannerShown && state.finalAt > 0 && state.time >= state.finalAt - 4) {
      state.bannerShown = true;
      state.events.push({ t: "banner" });
    }

    // scripted wave spawns
    while (state.queueIdx < state.spawnQueue.length &&
           state.spawnQueue[state.queueIdx].at <= state.time) {
      const s = state.spawnQueue[state.queueIdx++];
      const lane = s.lane == null ? Math.floor(state.rng() * LANES) : s.lane;
      spawnBlight(state, s.type, lane, SPAWN_X);
      state.spawnedCount++;
    }

    // sky motes drift down on a timer
    state.nextSkyMote -= dt;
    if (state.nextSkyMote <= 0) {
      state.nextSkyMote += level.skyMoteEvery;
      addMote(state,
        0.6 + state.rng() * (COLS - 1.2),
        0.35 + state.rng() * (LANES - 0.85),
        true);
    }

    // motes fall, land, then fade after MOTE_TTL
    for (let i = state.motes.length - 1; i >= 0; i--) {
      const m = state.motes[i];
      if (!m.landed) {
        m.y += MOTE_FALL_SPEED * dt;
        if (m.y >= m.targetY) { m.y = m.targetY; m.landed = true; }
      } else {
        m.age += dt;
        if (m.age >= MOTE_TTL) state.motes.splice(i, 1);
      }
    }

    // plants: dew production + gated shooting
    for (const p of state.plants) {
      const def = PLANTS[p.type];
      if (def.produceEvery) {
        p.produceT -= dt;
        if (p.produceT <= 0) {
          p.produceT += def.produceEvery;
          addMote(state,
            p.col + 0.5 + (state.rng() - 0.5) * 0.5,
            p.lane + 0.5 + (state.rng() - 0.5) * 0.4,
            false);
          state.events.push({ t: "produce", lane: p.lane, col: p.col });
        }
      }
      if (def.fireEvery) {
        p.fireT -= dt;
        if (p.fireT <= 0) {
          if (laneHasTarget(state, p.lane, p.col)) {
            p.fireT = def.fireEvery;
            if (def.shot === "lob") {
              const tgt = firstTarget(state, p.lane, p.col);
              const dist = tgt.x - p.col;
              const dur = 0.35 + dist * 0.06;
              const eff = BLIGHTS[tgt.type].speed * (tgt.slowT > 0 ? SLOW_FACTOR : 1);
              const ix = Math.max(0.3, tgt.x - eff * dur);
              state.lobs.push({
                id: state.nextId++, lane: p.lane,
                x0: p.col + 0.5, x1: ix, t: 0, dur: dur,
                damage: def.damage, splash: def.splash,
              });
            } else {
              state.shots.push({
                id: state.nextId++, lane: p.lane, x: p.col + 0.7,
                damage: def.damage, frost: def.shot === "frost",
              });
            }
            state.events.push({ t: "shot", kind: def.shot, lane: p.lane, col: p.col });
          } else {
            p.fireT = 0; // primed: fires the moment a target appears
          }
        }
      }
    }

    // straight shots travel right and strike the FIRST blight they touch
    for (let i = state.shots.length - 1; i >= 0; i--) {
      const s = state.shots[i];
      s.x += SHOT_SPEED * dt;
      if (s.x > COLS + 0.8) { state.shots.splice(i, 1); continue; }
      let hit = null;
      for (const b of state.blights) {
        if (b.dead || b.lane !== s.lane) continue;
        if (Math.abs(b.x - s.x) <= SHOT_HIT) {
          if (!hit || b.x < hit.x) hit = b; // nearest = first touched
        }
      }
      if (hit) {
        damageBlight(state, hit, s.damage);
        if (s.frost && !hit.dead) hit.slowT = SLOW_DURATION; // refresh, never stack
        state.shots.splice(i, 1);
      }
    }

    // lobbed spores arc over everything and splash where they land
    for (let i = state.lobs.length - 1; i >= 0; i--) {
      const lob = state.lobs[i];
      lob.t += dt;
      if (lob.t >= lob.dur) {
        for (const b of state.blights) {
          if (b.dead || b.lane !== lob.lane) continue;
          if (Math.abs(b.x - lob.x1) <= lob.splash + 0.001) {
            damageBlight(state, b, lob.damage);
          }
        }
        state.events.push({ t: "splat", lane: lob.lane, x: lob.x1 });
        state.lobs.splice(i, 1);
      }
    }

    // blights: chill decay, then either chomp the plant ahead or shamble on
    for (const b of state.blights) {
      if (b.dead) continue;
      if (b.slowT > 0) b.slowT = Math.max(0, b.slowT - dt);
      const def = BLIGHTS[b.type];
      const mx = b.x - MOUTH;
      let plant = null;
      const c = Math.floor(mx);
      if (mx > -0.05 && c >= 0 && c < COLS) plant = plantAtCell(state, b.lane, c);

      if (plant && PLANTS[plant.type].bomb) {
        explodeCap(state, plant); // stepping on / biting a burstcap sets it off
        continue;
      }

      if (plant) {
        if (b.eating !== plant.id) { b.eating = plant.id; b.chompT = 0.3; }
        b.chompT -= dt;
        if (b.chompT <= 0) {
          b.chompT += def.chompEvery;
          let dmg = def.chompDmg;
          if (PLANTS[plant.type].wall && def.wallMult) dmg *= def.wallMult;
          plant.hp -= dmg;
          state.events.push({ t: "chomp", lane: b.lane, x: b.x });
          if (plant.hp <= 0) {
            state.plants.splice(state.plants.indexOf(plant), 1);
            state.events.push({ t: "plantDie", lane: plant.lane, col: plant.col });
            b.eating = null;
          }
        }
      } else {
        b.eating = null;
        b.x -= def.speed * (b.slowT > 0 ? SLOW_FACTOR : 1) * dt;
        if (b.x <= BREACH_X) {
          breach(state, b);
          if (state.status !== "playing") break;
          b.dead = true; // consumed by the surge that just fired
        }
      }
    }

    // cull the fallen
    for (let i = state.blights.length - 1; i >= 0; i--) {
      if (state.blights[i].dead) state.blights.splice(i, 1);
    }

    // victory: every scripted blight has spawned and none remain standing
    if (state.status === "playing" &&
        state.queueIdx >= state.spawnQueue.length &&
        state.spawnedCount >= state.totalSpawns &&
        state.totalSpawns > 0 &&
        state.blights.length === 0) {
      state.status = "won";
      state.events.push({ t: "won" });
    }
  }

  return {
    LANES: LANES, COLS: COLS,
    START_DEW: START_DEW, MOTE_VALUE: MOTE_VALUE, MOTE_TTL: MOTE_TTL,
    MOTE_FALL_SPEED: MOTE_FALL_SPEED,
    SPAWN_X: SPAWN_X, BREACH_X: BREACH_X,
    SHOT_SPEED: SHOT_SPEED, SHOT_HIT: SHOT_HIT, MOUTH: MOUTH,
    SLOW_FACTOR: SLOW_FACTOR, SLOW_DURATION: SLOW_DURATION,
    PLANTS: PLANTS, PLANT_ORDER: PLANT_ORDER, BLIGHTS: BLIGHTS, LEVELS: LEVELS,
    makeRng: makeRng, buildQueue: buildQueue, createGame: createGame,
    plantAtCell: plantAtCell, canPlant: canPlant, plantAt: plantAt,
    shovelAt: shovelAt, addMote: addMote, collectMote: collectMote,
    spawnBlight: spawnBlight, laneHasTarget: laneHasTarget, firstTarget: firstTarget,
    helmetStage: helmetStage, damageBlight: damageBlight, tick: tick,
  };
});

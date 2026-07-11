"use strict";

/* ================= Fernfoot — pure rules =================
 * Dual-environment module: attaches to window.FernfootLogic in the browser
 * (classic <script>, no modules) and to module.exports under node so the
 * committed test suite exercises the exact same code the game runs.
 * No DOM, no canvas, no audio in here — just physics, tiles and critters.
 */
(function (root, factory) {
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = factory();
  } else {
    root.FernfootLogic = factory();
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  // ---- tuning ---------------------------------------------------------------
  const TILE = 16;
  const STEP = 1 / 120;            // fixed logic timestep (seconds)

  const WALK_MAX = 90;             // px/s
  const RUN_MAX = 140;             // ~1.5x walk
  const ACC_WALK = 620;
  const ACC_RUN = 420;             // running accelerates slower
  const SKID_DEC = 980;            // opposite-direction braking
  const FRICTION = 540;            // no input, grounded
  const AIR_ACC = 460;
  const AIR_DRAG = 90;

  const GRAV = 1500;
  const GRAV_HOLD = 825;           // ~55% while rising with jump held
  const MAX_FALL = 330;
  const JUMP_V = 340;              // clears 4 tiles held (70px apex)
  const RELEASE_CUT = 0.5;         // early release halves upward speed
  const COYOTE = 0.09;             // s
  const BUFFER = 0.12;             // s
  const STOMP_BOUNCE = 0.7;        // fraction of JUMP_V
  const STOMP_BOUNCE_HELD = 0.98;
  const INV_TIME = 1.6;            // post-hit invulnerability
  const DROP_TIME = 0.18;          // one-way drop-through window

  const HERO_W = 12, HERO_H = 14;
  const SPARKS_PER_LIFE = 100;
  const START_LIVES = 3;

  // ---- tiles ------------------------------------------------------------------
  // grid cell values
  const T = {
    EMPTY: 0, SOLID: 1, ONEWAY: 2, CRACK: 3, CRACK_SPARKS: 4, CRACK_SEED: 5,
    SPIKE: 6, SPARK: 7, SEED: 8, FRUIT: 9, CHECK: 10, GOAL: 11,
  };
  const CHAR2TILE = {
    ".": T.EMPTY, "#": T.SOLID, "=": T.ONEWAY, "%": T.CRACK, "$": T.CRACK_SPARKS,
    "&": T.CRACK_SEED, "^": T.SPIKE, "*": T.SPARK, "E": T.SEED, "G": T.FRUIT,
    "C": T.CHECK, "W": T.GOAL,
  };
  function isSolid(t) { return t === T.SOLID || t === T.CRACK || t === T.CRACK_SPARKS || t === T.CRACK_SEED; }
  function isCracked(t) { return t === T.CRACK || t === T.CRACK_SPARKS || t === T.CRACK_SEED; }

  // ---- level parsing --------------------------------------------------------------
  // def: { name, theme, rows: [".." ...], movers: [{x,y,w,axis,range,speed,phase}] }
  function parseLevel(def) {
    const rows = def.rows;
    const h = rows.length;
    let w = 0;
    for (const r of rows) w = Math.max(w, r.length);
    const grid = new Array(w * h).fill(T.EMPTY);
    let start = { x: TILE * 2, y: 0 };
    const enemies = [];
    for (let y = 0; y < h; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === "P") { start = { x: x * TILE + 2, y: y * TILE + (TILE - HERO_H) }; continue; }
        if (ch === "p") { enemies.push({ kind: "plodder", tx: x, ty: y }); continue; }
        if (ch === "l") { enemies.push({ kind: "lunger", tx: x, ty: y }); continue; }
        if (ch === "s") { enemies.push({ kind: "spinner", tx: x, ty: y }); continue; }
        if (ch === "t") { enemies.push({ kind: "spitter", tx: x, ty: y }); continue; }
        const t = CHAR2TILE[ch];
        if (t !== undefined) grid[y * w + x] = t;
      }
    }
    return {
      name: def.name, theme: def.theme || "glade",
      w, h, grid, start, enemyDefs: enemies,
      moverDefs: def.movers || [],
    };
  }

  // ---- world state ------------------------------------------------------------------
  function newGame() {
    return {
      levelIndex: 0, level: null,
      hero: null, enemies: [], globs: [], movers: [],
      grid: null,
      lives: START_LIVES, score: 0, sparks: 0,
      time: 0, events: [],
      checkpoint: null,     // {x,y}
      status: "playing",    // playing | dead | cleared | gameover
      deadTimer: 0,
      prevJump: false,
    };
  }

  function makeHero(x, y) {
    return {
      x, y, w: HERO_W, h: HERO_H, vx: 0, vy: 0,
      facing: 1, onGround: false, coyote: 0, jumpBuf: 0,
      jumping: false,          // rising from a jump with hold-gravity eligibility
      power: "none",           // none | ember | gust
      airJumps: 0,             // double-jump charges (gust)
      inv: 0, drop: 0,
      riding: -1,              // mover index under our feet
      skidding: false,
    };
  }

  function spawnEnemy(d) {
    const x = d.tx * TILE, y = d.ty * TILE;
    switch (d.kind) {
      case "plodder": return { kind: "plodder", x: x + 1, y: y + 4, w: 14, h: 12, vx: -30, vy: 0, dead: 0, alive: true };
      case "lunger": return { kind: "lunger", x: x + 1, y: y + 4, w: 14, h: 12, vx: 0, vy: 0, state: "idle", cool: 0, dir: -1, dead: 0, alive: true };
      case "spinner": return { kind: "spinner", x, y, w: 12, h: 12, baseY: y, t: 0, vx: 40, dead: 0, alive: true, x0: x - 3 * TILE, x1: x + 3 * TILE };
      case "spitter": return { kind: "spitter", x: x + 1, y: y + 2, w: 14, h: 14, timer: 1.2, dead: 0, alive: true };
    }
  }

  function loadLevel(g, defs, index) {
    g.levelIndex = index;
    g.level = parseLevel(defs[index]);
    g.grid = g.level.grid.slice();      // mutable copy (sparks vanish, blocks break)
    g.hero = makeHero(g.level.start.x, g.level.start.y);
    g.enemies = g.level.enemyDefs.map(spawnEnemy);
    g.globs = [];
    g.movers = g.level.moverDefs.map((m) => ({
      x: m.x * TILE, y: m.y * TILE, w: m.w * TILE, h: 8,
      baseX: m.x * TILE, baseY: m.y * TILE,
      axis: m.axis, range: m.range * TILE, speed: m.speed, phase: m.phase || 0,
      t: 0, dx: 0, dy: 0,
    }));
    g.time = 0;
    g.checkpoint = null;
    g.status = "playing";
    g.deadTimer = 0;
    g.events = [];
  }

  function respawn(g) {
    const cp = g.checkpoint;
    g.hero = makeHero(cp ? cp.x : g.level.start.x, cp ? cp.y : g.level.start.y);
    g.enemies = g.level.enemyDefs.map(spawnEnemy);
    g.globs = [];
    g.status = "playing";
    g.deadTimer = 0;
  }

  // ---- grid helpers -------------------------------------------------------------------
  function tileAt(g, tx, ty) {
    if (tx < 0 || tx >= g.level.w) return T.SOLID; // walls at level edges
    if (ty < 0) return T.EMPTY;
    if (ty >= g.level.h) return T.EMPTY;           // pit below
    return g.grid[ty * g.level.w + tx];
  }
  function setTile(g, tx, ty, v) {
    if (tx < 0 || tx >= g.level.w || ty < 0 || ty >= g.level.h) return;
    g.grid[ty * g.level.w + tx] = v;
  }

  function rectVsSolid(g, x, y, w, h) {
    const x0 = Math.floor(x / TILE), x1 = Math.floor((x + w - 0.01) / TILE);
    const y0 = Math.floor(y / TILE), y1 = Math.floor((y + h - 0.01) / TILE);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++)
        if (isSolid(tileAt(g, tx, ty))) return true;
    return false;
  }

  function overlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // ---- hero physics -----------------------------------------------------------------------
  function moveX(g, e, dx) {
    e.x += dx;
    if (rectVsSolid(g, e.x, e.y, e.w, e.h)) {
      if (dx > 0) e.x = Math.floor((e.x + e.w) / TILE) * TILE - e.w - 0.01;
      else e.x = (Math.floor(e.x / TILE) + 1) * TILE + 0.01;
      return true;
    }
    return false;
  }

  // returns "floor" | "ceil" | null ; honors one-ways + movers when descending
  function moveY(g, e, dy, opts) {
    const prevBottom = e.y + e.h;
    e.y += dy;
    if (rectVsSolid(g, e.x, e.y, e.w, e.h)) {
      if (dy > 0) { e.y = Math.floor((e.y + e.h) / TILE) * TILE - e.h - 0.01; return "floor"; }
      e.y = (Math.floor(e.y / TILE) + 1) * TILE + 0.01;
      return "ceil";
    }
    if (dy > 0 && opts && opts.oneWays && e.drop <= 0) {
      // one-way tiles: land only if we were fully above the tile top
      const y1 = Math.floor((e.y + e.h - 0.01) / TILE);
      const x0 = Math.floor(e.x / TILE), x1 = Math.floor((e.x + e.w - 0.01) / TILE);
      for (let tx = x0; tx <= x1; tx++) {
        if (tileAt(g, tx, y1) === T.ONEWAY) {
          const top = y1 * TILE;
          if (prevBottom <= top + 0.01) { e.y = top - e.h - 0.01; return "floor"; }
        }
      }
    }
    if (dy > 0 && opts && opts.movers) {
      for (const m of g.movers) {
        if (e.x + e.w > m.x && e.x < m.x + m.w) {
          const top = m.y;
          if (prevBottom <= top + Math.max(0.01, m.dy + 0.01) && e.y + e.h >= top) {
            e.y = top - e.h - 0.01;
            opts.hitMover = g.movers.indexOf(m);
            return "floor";
          }
        }
      }
    }
    return null;
  }

  function breakBlock(g, tx, ty) {
    const t = tileAt(g, tx, ty);
    setTile(g, tx, ty, T.EMPTY);
    const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
    g.events.push({ type: "break", x: cx, y: cy });
    if (t === T.CRACK_SPARKS) {
      collectSparks(g, 3, cx, cy);
    } else if (t === T.CRACK_SEED) {
      // pop an emberseed pickup one tile above
      setTile(g, tx, ty - 1, tileAt(g, tx, ty - 1) === T.EMPTY ? T.SEED : tileAt(g, tx, ty - 1));
      g.events.push({ type: "reveal", x: cx, y: cy - TILE });
    }
  }

  function collectSparks(g, n, x, y) {
    for (let i = 0; i < n; i++) {
      g.sparks++;
      g.score += 10;
      if (g.sparks % SPARKS_PER_LIFE === 0) {
        g.lives++;
        g.events.push({ type: "1up", x, y });
      }
    }
    g.events.push({ type: "spark", x, y });
  }

  function hurtHero(g, fromX) {
    const h = g.hero;
    if (h.inv > 0 || g.status !== "playing") return;
    if (h.power !== "none") {
      h.power = "none";
      h.airJumps = 0;
      h.inv = INV_TIME;
      h.vx = (h.x + h.w / 2 < fromX ? -1 : 1) * 80;
      h.vy = -120;
      g.events.push({ type: "hurt", x: h.x, y: h.y });
    } else {
      killHero(g);
    }
  }

  function killHero(g) {
    if (g.status !== "playing") return;
    g.status = "dead";
    g.deadTimer = 1.1;
    g.hero.power = "none";
    g.events.push({ type: "death", x: g.hero.x, y: g.hero.y });
  }

  // ---- enemies ------------------------------------------------------------------------------
  function groundAhead(g, e, dir) {
    const tx = Math.floor((dir > 0 ? e.x + e.w + 1 : e.x - 1) / TILE);
    const ty = Math.floor((e.y + e.h + 2) / TILE);
    const t = tileAt(g, tx, ty);
    return isSolid(t) || t === T.ONEWAY;
  }
  function wallAhead(g, e, dir) {
    const x = dir > 0 ? e.x + e.w + 1 : e.x - 2;
    return rectVsSolid(g, x, e.y + 1, 1, e.h - 2);
  }

  function stepEnemy(g, e, dt) {
    const h = g.hero;
    if (!e.alive) { e.dead += dt; return; }
    switch (e.kind) {
      case "plodder": {
        const dir = e.vx > 0 ? 1 : -1;
        if (wallAhead(g, e, dir) || !groundAhead(g, e, dir)) e.vx = -e.vx;
        e.x += e.vx * dt;
        // settle on ground
        e.vy = Math.min(MAX_FALL, e.vy + GRAV * dt);
        if (moveY(g, e, e.vy * dt, { oneWays: true }) === "floor") e.vy = 0;
        break;
      }
      case "lunger": {
        if (e.state === "idle") {
          const sameBand = Math.abs((h.y + h.h) - (e.y + e.h)) < 20;
          const dx = (h.x + h.w / 2) - (e.x + e.w / 2);
          if (g.status === "playing" && sameBand && Math.abs(dx) < 120 && e.cool <= 0) {
            e.state = "dash"; e.dir = dx > 0 ? 1 : -1; e.vx = 175 * e.dir;
            g.events.push({ type: "lunge", x: e.x, y: e.y });
          }
        } else if (e.state === "dash") {
          if (wallAhead(g, e, e.dir) || !groundAhead(g, e, e.dir)) {
            e.state = "idle"; e.vx = 0; e.cool = 1.1;
          } else {
            e.x += e.vx * dt;
          }
        }
        e.cool = Math.max(0, e.cool - dt);
        e.vy = Math.min(MAX_FALL, e.vy + GRAV * dt);
        if (moveY(g, e, e.vy * dt, { oneWays: true }) === "floor") e.vy = 0;
        break;
      }
      case "spinner": {
        e.t += dt;
        e.x += e.vx * dt;
        if (e.x < e.x0) { e.x = e.x0; e.vx = Math.abs(e.vx); }
        if (e.x > e.x1) { e.x = e.x1; e.vx = -Math.abs(e.vx); }
        e.y = e.baseY + Math.sin(e.t * 2.6) * 24;
        break;
      }
      case "spitter": {
        e.timer -= dt;
        if (e.timer <= 0 && g.status === "playing") {
          e.timer = 2.2;
          const toward = (h.x > e.x) ? 1 : -1;
          if (Math.abs(h.x - e.x) < 190) {
            g.globs.push({ x: e.x + e.w / 2 - 3, y: e.y - 2, w: 6, h: 6, vx: 62 * toward, vy: -190 });
            g.events.push({ type: "spit", x: e.x, y: e.y });
          }
        }
        break;
      }
    }
  }

  function stompableTop(e) { return e.kind !== "spinner"; }

  function heroVsEnemies(g, jumpHeld) {
    const h = g.hero;
    if (g.status !== "playing") return;
    for (const e of g.enemies) {
      if (!e.alive) continue;
      if (!overlap(h, e)) continue;
      const falling = h.vy > 40;
      const above = (h.y + h.h) - e.y < 8 + Math.max(0, h.vy) * STEP * 2;
      if (falling && above && stompableTop(e)) {
        e.alive = false; e.dead = 0;
        g.score += 100;
        h.vy = -JUMP_V * (jumpHeld ? STOMP_BOUNCE_HELD : STOMP_BOUNCE);
        h.jumping = jumpHeld;             // hold-gravity only if jump is held (no release-cut on a plain bounce)
        if (h.power === "gust") h.airJumps = 1;
        g.events.push({ type: "stomp", x: e.x + e.w / 2, y: e.y });
      } else {
        hurtHero(g, e.x + e.w / 2);
      }
      if (g.status !== "playing") return;
    }
    for (let i = g.globs.length - 1; i >= 0; i--) {
      if (overlap(h, g.globs[i])) {
        const gl = g.globs.splice(i, 1)[0];
        hurtHero(g, gl.x);
        if (g.status !== "playing") return;
      }
    }
  }

  // ---- movers -------------------------------------------------------------------------------
  function stepMovers(g, dt) {
    for (const m of g.movers) {
      m.t += dt;
      const s = Math.sin((m.t + m.phase) * m.speed) * m.range;
      const nx = m.axis === "x" ? m.baseX + s : m.baseX;
      const ny = m.axis === "y" ? m.baseY + s : m.baseY;
      m.dx = nx - m.x; m.dy = ny - m.y;
      m.x = nx; m.y = ny;
    }
  }

  function heroOnMover(g) {
    const h = g.hero;
    for (let i = 0; i < g.movers.length; i++) {
      const m = g.movers[i];
      if (h.x + h.w > m.x && h.x < m.x + m.w) {
        const gap = m.y - (h.y + h.h);
        if (gap >= -1 && gap <= 2.5 && h.vy >= 0) return i;
      }
    }
    return -1;
  }

  // ---- the step -----------------------------------------------------------------------------
  // input: { left, right, run, down, jump } booleans
  function step(g, input, dt) {
    g.events = [];
    dt = dt || STEP;

    if (g.status === "dead") {
      g.deadTimer -= dt;
      g.hero.vy = Math.min(MAX_FALL, g.hero.vy + GRAV * dt);
      g.hero.y += g.hero.vy * dt;
      if (g.deadTimer <= 0) {
        g.lives--;
        if (g.lives <= 0) { g.status = "gameover"; g.events.push({ type: "gameover" }); }
        else { respawn(g); g.events.push({ type: "respawn" }); }
      }
      g.prevJump = !!input.jump;
      return;
    }
    if (g.status !== "playing") { g.prevJump = !!input.jump; return; }

    g.time += dt;
    const h = g.hero;
    const jumpPressed = input.jump && !g.prevJump;
    g.prevJump = !!input.jump;

    // timers
    h.inv = Math.max(0, h.inv - dt);
    h.coyote = Math.max(0, h.coyote - dt);
    h.jumpBuf = Math.max(0, h.jumpBuf - dt);
    h.drop = Math.max(0, h.drop - dt);
    if (jumpPressed) h.jumpBuf = BUFFER;

    // drop through one-ways: down + jump while grounded on a one-way
    if (input.down && jumpPressed && h.onGround) {
      const ty = Math.floor((h.y + h.h + 1) / TILE);
      const x0 = Math.floor(h.x / TILE), x1 = Math.floor((h.x + h.w - 0.01) / TILE);
      let onOneWayOnly = false, onSolid = false;
      for (let tx = x0; tx <= x1; tx++) {
        const t = tileAt(g, tx, ty);
        if (t === T.ONEWAY) onOneWayOnly = true;
        else if (isSolid(t)) onSolid = true;
      }
      if (onOneWayOnly && !onSolid) {
        h.drop = DROP_TIME;
        h.jumpBuf = 0;
        h.onGround = false;
        h.y += 2;
        g.events.push({ type: "drop", x: h.x, y: h.y });
      }
    }

    // horizontal
    const wish = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const max = input.run ? RUN_MAX : WALK_MAX;
    h.skidding = false;
    if (wish !== 0) {
      h.facing = wish;
      const acc = h.onGround ? (input.run ? ACC_RUN : ACC_WALK) : AIR_ACC;
      if (h.vx * wish < 0) {
        // skid: braking against current motion
        h.skidding = h.onGround && Math.abs(h.vx) > 30;
        h.vx += wish * SKID_DEC * dt;
        if (h.skidding && Math.abs(h.vx) > 60 && Math.random() < 0.6)
          g.events.push({ type: "skid", x: h.x + h.w / 2, y: h.y + h.h });
      } else if (Math.abs(h.vx) < max) {
        h.vx = clampMag(h.vx + wish * acc * dt, max);
      } else {
        // over max (e.g. stopped running): ease back down
        h.vx = approach(h.vx, wish * max, FRICTION * dt);
      }
    } else {
      const fr = h.onGround ? FRICTION : AIR_DRAG;
      h.vx = approach(h.vx, 0, fr * dt);
    }

    // jump
    const canGround = h.onGround || h.coyote > 0;
    if (h.jumpBuf > 0 && canGround) {
      h.vy = -JUMP_V;
      h.jumping = true;
      h.onGround = false;
      h.coyote = 0;
      h.jumpBuf = 0;
      h.riding = -1;
      g.events.push({ type: "jump", x: h.x, y: h.y + h.h });
    } else if (jumpPressed && !canGround && h.power === "gust" && h.airJumps > 0) {
      h.airJumps--;
      h.vy = -JUMP_V * 0.92;
      h.jumping = true;
      h.jumpBuf = 0;
      g.events.push({ type: "airjump", x: h.x, y: h.y + h.h });
    }
    // early release cuts the rise
    if (!input.jump && h.jumping && h.vy < 0) {
      h.vy *= RELEASE_CUT;
      h.jumping = false;
    }

    // gravity (reduced while rising with jump held)
    const gEff = (h.vy < 0 && input.jump && h.jumping) ? GRAV_HOLD : GRAV;
    h.vy = Math.min(MAX_FALL, h.vy + gEff * dt);
    if (h.vy >= 0) h.jumping = false;

    // movers shift the world (and their rider) before the hero integrates
    stepMovers(g, dt);
    if (h.riding >= 0 && h.riding < g.movers.length) {
      const m = g.movers[h.riding];
      h.x += m.dx;
      moveY(g, h, m.dy, {});
    }

    // integrate + collide
    moveX(g, h, h.vx * dt) && (h.vx = 0);
    const wasRising = h.vy < 0;
    const opts = { oneWays: true, movers: true, hitMover: -1 };
    const hit = moveY(g, h, h.vy * dt, opts);
    const wasGround = h.onGround;
    h.onGround = hit === "floor";
    if (h.onGround) {
      if (!wasGround && h.vy > 60) g.events.push({ type: "land", x: h.x + h.w / 2, y: h.y + h.h });
      h.vy = 0;
      h.coyote = COYOTE;
      if (h.power === "gust") h.airJumps = 1;
      h.riding = opts.hitMover >= 0 ? opts.hitMover : heroOnMover(g);
    } else {
      if (wasGround) { /* walked off a ledge: coyote already set */ }
      h.riding = -1;
    }
    if (hit === "ceil") {
      // head bump: break cracked blocks when empowered by the emberseed
      if (wasRising) {
        const ty = Math.floor((h.y - 1) / TILE);
        const tx = Math.floor((h.x + h.w / 2) / TILE);
        if (isCracked(tileAt(g, tx, ty)) && h.power === "ember") breakBlock(g, tx, ty);
        else g.events.push({ type: "bump", x: h.x + h.w / 2, y: h.y });
      }
      h.vy = 0;
      h.jumping = false;
    }
    // buffered jump executes on landing
    if (h.onGround && h.jumpBuf > 0) {
      h.vy = -JUMP_V;
      h.jumping = true;
      h.onGround = false;
      h.jumpBuf = 0;
      h.riding = -1;
      g.events.push({ type: "jump", x: h.x, y: h.y + h.h });
    }

    // tile triggers over the hero's rect
    const x0 = Math.floor(h.x / TILE), x1 = Math.floor((h.x + h.w - 0.01) / TILE);
    const y0 = Math.floor(h.y / TILE), y1 = Math.floor((h.y + h.h - 0.01) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const t = tileAt(g, tx, ty);
        const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
        if (t === T.SPARK) { setTile(g, tx, ty, T.EMPTY); collectSparks(g, 1, cx, cy); }
        else if (t === T.SEED) {
          setTile(g, tx, ty, T.EMPTY);
          h.power = "ember"; h.airJumps = 0; g.score += 200;
          g.events.push({ type: "powerup", which: "ember", x: cx, y: cy });
        } else if (t === T.FRUIT) {
          setTile(g, tx, ty, T.EMPTY);
          h.power = "gust"; h.airJumps = h.onGround ? 1 : 1; g.score += 200;
          g.events.push({ type: "powerup", which: "gust", x: cx, y: cy });
        } else if (t === T.CHECK) {
          if (!g.checkpoint || g.checkpoint.tx !== tx) {
            g.checkpoint = { x: tx * TILE + 2, y: ty * TILE + TILE - HERO_H, tx };
            g.events.push({ type: "checkpoint", x: cx, y: cy });
          }
        } else if (t === T.GOAL) {
          g.status = "cleared";
          g.events.push({ type: "goal", x: cx, y: cy });
        } else if (t === T.SPIKE) {
          // forgiving inset
          const sp = { x: tx * TILE + 3, y: ty * TILE + 6, w: TILE - 6, h: TILE - 6 };
          if (overlap(h, sp)) killHero(g);
        }
        if (g.status !== "playing") break;
      }
      if (g.status !== "playing") break;
    }
    if (g.status === "cleared") return;
    if (g.status !== "playing") return;

    // fell into a pit
    if (h.y > g.level.h * TILE + 8) { killHero(g); return; }

    // enemies + globs
    for (const e of g.enemies) stepEnemy(g, e, dt);
    for (let i = g.globs.length - 1; i >= 0; i--) {
      const gl = g.globs[i];
      gl.vy = Math.min(MAX_FALL, gl.vy + GRAV * dt);
      gl.x += gl.vx * dt;
      gl.y += gl.vy * dt;
      if (rectVsSolid(g, gl.x, gl.y, gl.w, gl.h) || gl.y > g.level.h * TILE + 40) {
        g.globs.splice(i, 1);
        g.events.push({ type: "globdie", x: gl.x, y: gl.y });
      }
    }
    heroVsEnemies(g, !!input.jump); // stomps always work; hurtHero respects inv
  }

  function clampMag(v, m) { return Math.max(-m, Math.min(m, v)); }
  function approach(v, target, amt) {
    if (v < target) return Math.min(target, v + amt);
    return Math.max(target, v - amt);
  }

  // ---- camera --------------------------------------------------------------------------------
  // Pure: returns the new {x, y, anchorY}. Leads the hero by ~15% of the view
  // in the facing direction, lerped; vertical snaps to the last-landed platform
  // so mid-jump arcs don't jitter the view. Always clamped inside the level.
  function stepCamera(cam, g, viewW, viewH, dt) {
    const h = g.hero;
    const lw = g.level.w * TILE, lh = g.level.h * TILE;
    const cx = h.x + h.w / 2;
    const targetX = cx + h.facing * viewW * 0.15 - viewW / 2;
    let x = cam.x + (targetX - cam.x) * Math.min(1, 6 * dt);

    let anchorY = cam.anchorY;
    if (h.onGround) anchorY = h.y + h.h;
    let targetY = anchorY - viewH * 0.62;
    // if the hero drifts out of the comfortable band, track directly
    const rel = h.y - targetY;
    if (rel < viewH * 0.2) targetY = h.y - viewH * 0.2;
    if (rel > viewH * 0.78) targetY = h.y - viewH * 0.78;
    let y = cam.y + (targetY - cam.y) * Math.min(1, 8 * dt);

    x = Math.max(0, Math.min(lw - viewW, x));
    y = Math.max(0, Math.min(Math.max(0, lh - viewH), y));
    return { x, y, anchorY };
  }

  return {
    TILE, STEP, T, CHAR2TILE,
    WALK_MAX, RUN_MAX, JUMP_V, GRAV, GRAV_HOLD, COYOTE, BUFFER,
    STOMP_BOUNCE, STOMP_BOUNCE_HELD, SPARKS_PER_LIFE, START_LIVES,
    HERO_W, HERO_H, INV_TIME,
    isSolid, isCracked, parseLevel,
    newGame, loadLevel, respawn, step, stepCamera,
    tileAt, setTile, overlap,
  };
});

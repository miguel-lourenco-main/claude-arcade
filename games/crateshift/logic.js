/* Crateshift — pure rules: level parsing, movement, undo, scoring.
 *
 * No DOM, no timers, no audio — game.js layers tweens/sfx/HUD on top.
 * Dual-environment: attaches to window.CrateLogic in the browser and
 * exports via module.exports under node (used by test/logic.test.js).
 */
(function () {
  "use strict";

  const DIR = {
    up:    { dx: 0, dy: -1 },
    down:  { dx: 0, dy: 1 },
    left:  { dx: -1, dy: 0 },
    right: { dx: 1, dy: 0 },
  };

  const key = (x, y) => x + "," + y;

  // Parse an ASCII map into a live level state:
  // '#' wall · ' ' floor · '.' pad · '$' crate · '*' crate on pad
  // '@' worker · '+' worker on pad
  function parseLevel(def) {
    const rows = def.map;
    const h = rows.length;
    const w = Math.max(...rows.map((r) => r.length));
    const wall = new Set();
    const targets = new Set();
    const crates = [];
    let player = null;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = x < rows[y].length ? rows[y][x] : " ";
        const k = key(x, y);
        if (c === "#") wall.add(k);
        if (c === "." || c === "*" || c === "+") targets.add(k);
        if (c === "$" || c === "*") crates.push({ x, y });
        if (c === "@" || c === "+") player = { x, y };
      }
    }
    // interior floor: flood fill from the worker
    const floor = new Set();
    const stack = [key(player.x, player.y)];
    while (stack.length) {
      const k = stack.pop();
      if (floor.has(k) || wall.has(k)) continue;
      floor.add(k);
      const [x, y] = k.split(",").map(Number);
      for (const d of Object.values(DIR)) {
        const nx = x + d.dx, ny = y + d.dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) stack.push(key(nx, ny));
      }
    }
    // static corner cells (non-target floor boxed on two perpendicular sides)
    const corners = new Set();
    for (const k of floor) {
      if (targets.has(k)) continue;
      const [x, y] = k.split(",").map(Number);
      const solid = (xx, yy) => wall.has(key(xx, yy)) || !floor.has(key(xx, yy));
      const vert = solid(x, y - 1) || solid(x, y + 1);
      const horz = solid(x - 1, y) || solid(x + 1, y);
      if (vert && horz) corners.add(k);
    }
    return {
      def, w, h, wall, targets, floor, crates, player, corners,
      history: [], solved: false,
    };
  }

  const crateAt = (s, x, y) => s.crates.find((c) => c.x === x && c.y === y) || null;
  const isWall = (s, x, y) => s.wall.has(key(x, y)) || !s.floor.has(key(x, y));
  const onTarget = (s, c) => s.targets.has(key(c.x, c.y));
  const inCorner = (s, c) => s.corners.has(key(c.x, c.y));
  const movesCount = (s) => s.history.length;
  const pushesCount = (s) => s.history.reduce((n, e) => n + (e.crate ? 1 : 0), 0);
  const isSolved = (s) => s.crates.every((c) => onTarget(s, c));
  const starsFor = (par, moves) =>
    moves <= par ? 3 : moves <= Math.ceil(par * 1.6) ? 2 : 1;

  // Attempt one step. Returns null when blocked (wall, or an unpushable
  // crate: wall/second crate beyond it). On success, mutates the state,
  // appends a history entry, and returns what happened so the caller can
  // animate/sonify it:
  //   { px, py, nx, ny, crate: null | { ref, fx, fy, tx, ty,
  //                                     entered, left, deadlocked } }
  function move(s, dirName) {
    const d = DIR[dirName];
    if (!d) return null;
    const px = s.player.x, py = s.player.y;
    const nx = px + d.dx, ny = py + d.dy;
    if (isWall(s, nx, ny)) return null;
    const crate = crateAt(s, nx, ny);
    const entry = { px, py, crate: null };
    const res = { px, py, nx, ny, crate: null };
    if (crate) {
      // push exactly one crate, only if the cell beyond it is free
      const bx = nx + d.dx, by = ny + d.dy;
      if (isWall(s, bx, by) || crateAt(s, bx, by)) return null;
      const wasOn = onTarget(s, crate);
      entry.crate = { ref: crate, fx: crate.x, fy: crate.y, tx: bx, ty: by };
      crate.x = bx; crate.y = by;
      const nowOn = onTarget(s, crate);
      res.crate = {
        ref: crate, fx: nx, fy: ny, tx: bx, ty: by,
        entered: nowOn && !wasOn,
        left: !nowOn && wasOn,
        deadlocked: !nowOn && inCorner(s, crate),
      };
    }
    s.player.x = nx; s.player.y = ny;
    s.history.push(entry);
    if (isSolved(s)) s.solved = true;
    return res;
  }

  // Undo the last move. Returns null when there is nothing to undo; else
  // mutates the state and returns from→to coords for the animation:
  //   { player: { fx, fy, tx, ty }, crate: null | { ref, fx, fy, tx, ty } }
  function undo(s) {
    if (!s.history.length) return null;
    const e = s.history.pop();
    const res = {
      player: { fx: s.player.x, fy: s.player.y, tx: e.px, ty: e.py },
      crate: null,
    };
    s.player.x = e.px; s.player.y = e.py;
    if (e.crate) {
      const c = e.crate.ref;
      res.crate = { ref: c, fx: c.x, fy: c.y, tx: e.crate.fx, ty: e.crate.fy };
      c.x = e.crate.fx; c.y = e.crate.fy;
    }
    return res;
  }

  const api = {
    DIR, parseLevel, move, undo,
    crateAt, isWall, onTarget, inCorner,
    movesCount, pushesCount, isSolved, starsFor,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.CrateLogic = api;
})();

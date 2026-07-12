"use strict";

/* ================= Wyrm — pure rules =================
 * Dual-environment module: attaches to window.WyrmLogic in the browser
 * (classic <script>, no modules) and to module.exports under node so the
 * committed test suite can exercise the exact same code the game runs.
 * No DOM, no canvas, no audio in here — just the grid rules.
 */
(function (root, factory) {
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = factory();
  } else {
    root.WyrmLogic = factory();
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  const COLS = 26;
  const ROWS = 22;
  const BASE_TPS = 8;              // logic ticks per second at start
  const MAX_TPS = 15;
  const TPS_PER_FOOD = 0.28;       // speed ramp per food eaten
  const START_LEN = 4;
  const QUEUE_MAX = 2;             // buffered direction changes per tick window

  const DIRS = {
    up:    { x: 0, y: -1 },
    down:  { x: 0, y: 1 },
    left:  { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };
  const KEYMAP = {
    ArrowUp: "up",    KeyW: "up",
    ArrowDown: "down", KeyS: "down",
    ArrowLeft: "left", KeyA: "left",
    ArrowRight: "right", KeyD: "right",
  };

  function tps(foodEaten) {
    return Math.min(MAX_TPS, BASE_TPS + foodEaten * TPS_PER_FOOD);
  }

  // Points for the NEXT bite given how many embers were eaten so far:
  // 10 base + a bonus that scales with the tick speed at bite time.
  function biteScore(foodEaten) {
    return 10 + Math.round((tps(foodEaten) - BASE_TPS) * 3);
  }

  function dirNameOf(d) {
    for (const k in DIRS) if (DIRS[k].x === d.x && DIRS[k].y === d.y) return k;
    return "right";
  }

  // Push `name` onto `queue` (mutates) if legal. Returns true when accepted.
  // The reversal check runs against the LAST QUEUED direction, not the
  // currently applied one — this is what stops the classic double-tap
  // self-kill (e.g. up,down tapped within one tick while moving right).
  function queueDirection(queue, currentDir, name) {
    if (queue.length >= QUEUE_MAX) return false;
    const refName = queue.length ? queue[queue.length - 1] : dirNameOf(currentDir);
    const ref = DIRS[refName];
    const next = DIRS[name];
    if (!next) return false;
    if (next.x === -ref.x && next.y === -ref.y) return false; // 180° — rejected
    if (next.x === ref.x && next.y === ref.y) return false;   // no-op
    queue.push(name);
    return true;
  }

  // Starting body: head first, laid out leftward from just left of center.
  function makeSnake() {
    const cy = Math.floor(ROWS / 2);
    const cx = Math.floor(COLS / 2) - 2;
    const snake = [];
    for (let i = 0; i < START_LEN; i++) snake.push({ x: cx - i, y: cy });
    return snake;
  }

  // One movement tick. Pure — never mutates `snake`.
  // Returns { died, ate, snake } where `snake` is the new body array.
  // Movement is push-head + pop-tail in the SAME tick, so when not growing
  // the tail cell vacates this tick — stepping into it is legal. The self
  // collision check therefore excludes the tail segment unless eating.
  function step(snake, dir, food) {
    const head = snake[0];
    const nx = head.x + dir.x;
    const ny = head.y + dir.y;

    // wall collision
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) {
      return { died: true, ate: false, snake: snake };
    }

    const eating = !!food && nx === food.x && ny === food.y;

    const checkLen = eating ? snake.length : snake.length - 1;
    for (let i = 0; i < checkLen; i++) {
      if (snake[i].x === nx && snake[i].y === ny) {
        return { died: true, ate: false, snake: snake };
      }
    }

    const next = snake.map(function (s) { return { x: s.x, y: s.y }; });
    next.unshift({ x: nx, y: ny });
    if (!eating) next.pop();
    return { died: false, ate: eating, snake: next };
  }

  function freeCells(snake) {
    const occupied = new Set(snake.map(function (s) { return s.y * COLS + s.x; }));
    const free = [];
    for (let i = 0; i < COLS * ROWS; i++) if (!occupied.has(i)) free.push(i);
    return free;
  }

  // Uniform pick over FREE cells only — never on the snake.
  // Returns {x,y}, or null when the board is full (the win condition).
  function spawnFood(snake, rand) {
    const free = freeCells(snake);
    if (free.length === 0) return null;
    const r = (rand || Math.random)();
    const i = free[Math.floor(r * free.length)];
    return { x: i % COLS, y: Math.floor(i / COLS) };
  }

  return {
    COLS: COLS, ROWS: ROWS,
    BASE_TPS: BASE_TPS, MAX_TPS: MAX_TPS, TPS_PER_FOOD: TPS_PER_FOOD,
    START_LEN: START_LEN, QUEUE_MAX: QUEUE_MAX,
    DIRS: DIRS, KEYMAP: KEYMAP,
    tps: tps, biteScore: biteScore, dirNameOf: dirNameOf,
    queueDirection: queueDirection, makeSnake: makeSnake, step: step,
    freeCells: freeCells, spawnFood: spawnFood,
  };
});

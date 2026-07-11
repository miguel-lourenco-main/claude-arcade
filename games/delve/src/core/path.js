// A* pathfinding on the tile grid (8-directional) plus a greedy fallback.
// Costs: 2 per cardinal step, 3 per diagonal (integer ~sqrt(2) ratio); the
// heuristic is the matching octile distance, so it stays admissible.
// Classic script: attaches to the page-global Delve namespace.
(function (global) {
  'use strict';
  const Delve = global.Delve = global.Delve || {};

  const DIRS = [
    [1, 0, 2], [-1, 0, 2], [0, 1, 2], [0, -1, 2],
    [1, 1, 3], [1, -1, 3], [-1, 1, 3], [-1, -1, 3],
  ];

  class MinHeap {
    constructor() { this.a = []; }
    get size() { return this.a.length; }
    push(item) {
      const a = this.a;
      a.push(item);
      let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p][0] <= a[i][0]) break;
        [a[p], a[i]] = [a[i], a[p]];
        i = p;
      }
    }
    pop() {
      const a = this.a;
      const top = a[0];
      const last = a.pop();
      if (a.length) {
        a[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < a.length && a[l][0] < a[m][0]) m = l;
          if (r < a.length && a[r][0] < a[m][0]) m = r;
          if (m === i) break;
          [a[m], a[i]] = [a[i], a[m]];
          i = m;
        }
      }
      return top;
    }
  }

  function octile(ax, ay, bx, by) {
    const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
    return 2 * Math.abs(dx - dy) + 3 * Math.min(dx, dy);
  }

  /**
   * A* from (sx,sy) to (tx,ty). `passable(x,y)` decides walkability (the caller
   * should make the goal tile passable). Returns an array of {x,y} steps
   * excluding the start (empty array if already there), or null if unreachable
   * within `maxNodes` expansions.
   */
  function astar(sx, sy, tx, ty, passable, W, H, maxNodes = 4000) {
    if (sx === tx && sy === ty) return [];
    const key = (x, y) => y * W + x;
    const g = new Map();
    const from = new Map();
    const heap = new MinHeap();
    const startK = key(sx, sy);
    g.set(startK, 0);
    heap.push([octile(sx, sy, tx, ty), sx, sy]);
    let expanded = 0;

    while (heap.size && expanded < maxNodes) {
      const [, x, y] = heap.pop();
      const k = key(x, y);
      expanded++;
      if (x === tx && y === ty) {
        const path = [];
        let cur = k;
        while (cur !== startK) {
          path.push({ x: cur % W, y: (cur / W) | 0 });
          cur = from.get(cur);
        }
        path.reverse();
        return path;
      }
      const gc = g.get(k);
      for (const [dx, dy, cost] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (!passable(nx, ny)) continue;
        const nk = key(nx, ny);
        const ng = gc + cost;
        if (g.has(nk) && g.get(nk) <= ng) continue;
        g.set(nk, ng);
        from.set(nk, k);
        heap.push([ng + octile(nx, ny, tx, ty), nx, ny]);
      }
    }
    return null;
  }

  /**
   * Greedy fallback: the passable neighbor that most reduces distance to the
   * target, or null if every improving step is blocked.
   */
  function greedyStep(sx, sy, tx, ty, passable) {
    const cur = octile(sx, sy, tx, ty);
    let best = null, bestD = cur;
    for (const [dx, dy] of DIRS) {
      const nx = sx + dx, ny = sy + dy;
      if (!passable(nx, ny)) continue;
      const d = octile(nx, ny, tx, ty);
      if (d < bestD) { bestD = d; best = { x: nx, y: ny }; }
    }
    return best;
  }

  Delve.astar = astar;
  Delve.greedyStep = greedyStep;
})(globalThis);

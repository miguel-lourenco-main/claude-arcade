// Dowser core rules — pure board logic, no DOM.
// Loads as a classic script in the browser (attaches to window.Dowser.core)
// and via require() in Node so the logic tests can exercise it directly.
(function () {
  "use strict";

  const PRESETS = {
    seedplot:  { cols: 9,  rows: 9,  hollows: 10, label: "Seedplot" },
    meadow:    { cols: 16, rows: 16, hollows: 40, label: "Meadow" },
    longfield: { cols: 30, rows: 16, hollows: 99, label: "Longfield" },
  };

  const idx = (b, r, c) => r * b.cols + c;
  const inBounds = (b, r, c) => r >= 0 && r < b.rows && c >= 0 && c < b.cols;

  function* neighbors(b, r, c) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (inBounds(b, nr, nc)) yield [nr, nc];
      }
    }
  }

  function createBoard(cols, rows, hollows) {
    const n = cols * rows;
    return {
      cols,
      rows,
      hollows,
      hazard: new Uint8Array(n),   // 1 = hollow underneath
      count: new Uint8Array(n),    // adjacent hollow count
      revealed: new Uint8Array(n),
      flagged: new Uint8Array(n),
      seeded: false,               // hazards placed yet?
      revealedCount: 0,
      flagCount: 0,
      burstAt: -1,                 // index of the hollow that ended the run
    };
  }

  // Recompute the adjacency counts from the hazard layer.
  function computeCounts(b) {
    for (let r = 0; r < b.rows; r++) {
      for (let c = 0; c < b.cols; c++) {
        if (b.hazard[idx(b, r, c)]) continue;
        let count = 0;
        for (const [nr, nc] of neighbors(b, r, c)) count += b.hazard[idx(b, nr, nc)];
        b.count[idx(b, r, c)] = count;
      }
    }
  }

  // Hazards are placed only after the first dig: the first-clicked cell and
  // all of its 8 neighbors are guaranteed clear.
  function seedHazards(b, safeR, safeC, random = Math.random) {
    const n = b.cols * b.rows;
    const excluded = new Set([idx(b, safeR, safeC)]);
    for (const [nr, nc] of neighbors(b, safeR, safeC)) excluded.add(idx(b, nr, nc));

    const pool = [];
    for (let i = 0; i < n; i++) if (!excluded.has(i)) pool.push(i);
    // Fisher–Yates, take the first `hollows` entries.
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const placed = Math.min(b.hollows, pool.length);
    for (let k = 0; k < placed; k++) b.hazard[pool[k]] = 1;

    computeCounts(b);
    b.seeded = true;
  }

  // Reveal a cell. Zero-count cells flood-fill outward (BFS); numbered cells
  // stop the fill. Returns the number of cells revealed (0 if nothing
  // happened, -1 if a hollow burst — burstAt is set, the caller ends the run).
  function reveal(b, r, c) {
    const i = idx(b, r, c);
    if (b.revealed[i] || b.flagged[i]) return 0;
    if (b.hazard[i]) {
      b.burstAt = i;
      return -1;
    }
    let opened = 0;
    const queue = [[r, c]];
    b.revealed[i] = 1;
    opened++;
    while (queue.length) {
      const [qr, qc] = queue.shift();
      if (b.count[idx(b, qr, qc)] !== 0) continue; // numbers stop the fill
      for (const [nr, nc] of neighbors(b, qr, qc)) {
        const ni = idx(b, nr, nc);
        if (b.revealed[ni] || b.flagged[ni] || b.hazard[ni]) continue;
        b.revealed[ni] = 1;
        opened++;
        queue.push([nr, nc]);
      }
    }
    b.revealedCount += opened;
    return opened;
  }

  // Chord: on a revealed number whose adjacent flags equal its value, reveal
  // all remaining hidden, unflagged neighbors. Mis-flagged chords can burst.
  function chord(b, r, c) {
    const i = idx(b, r, c);
    const need = b.count[i];
    if (!b.revealed[i] || need === 0) return 0;
    let flags = 0;
    for (const [nr, nc] of neighbors(b, r, c)) flags += b.flagged[idx(b, nr, nc)];
    if (flags !== need) return 0;
    let opened = 0;
    for (const [nr, nc] of neighbors(b, r, c)) {
      const ni = idx(b, nr, nc);
      if (b.revealed[ni] || b.flagged[ni]) continue;
      const res = reveal(b, nr, nc);
      if (res === -1) return -1;
      opened += res;
    }
    return opened;
  }

  function toggleFlag(b, r, c) {
    const i = idx(b, r, c);
    if (b.revealed[i]) return false;
    b.flagged[i] = b.flagged[i] ? 0 : 1;
    b.flagCount += b.flagged[i] ? 1 : -1;
    return true;
  }

  // Win: every non-hazard cell revealed. Flags are irrelevant.
  function isWin(b) {
    return b.revealedCount === b.cols * b.rows - b.hollows;
  }

  const api = {
    PRESETS,
    idx,
    inBounds,
    neighbors,
    createBoard,
    computeCounts,
    seedHazards,
    reveal,
    chord,
    toggleFlag,
    isWin,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") {
    window.Dowser = window.Dowser || {};
    window.Dowser.core = api;
  }
})();

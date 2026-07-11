/*
 * worker.js — runs the AI search off the main thread so the UI never freezes.
 * Protocol:
 *   in : { type:"search", id, fen, gameHashes:[..], level }
 *   out: { type:"info",   id, depth, score, nodes }
 *        { type:"result", id, from, to, promo, score, depth, nodes }
 */
"use strict";
importScripts("engine.js", "search.js");

var LEVELS = {
  1: { maxDepth: 2, timeMs: 800, jitter: true },
  2: { maxDepth: 4, timeMs: 2500, jitter: false },
  3: { maxDepth: 6, timeMs: 6000, jitter: false }
};

self.onmessage = function (e) {
  var msg = e.data;
  if (!msg || msg.type !== "search") return;
  var E = self.ChessEngine, S = self.ChessSearch;
  var cfg = LEVELS[msg.level] || LEVELS[2];
  var pos;
  try {
    pos = E.fromFen(msg.fen);
  } catch (err) {
    self.postMessage({ type: "error", id: msg.id, message: String(err) });
    return;
  }
  var result = S.search(pos, {
    maxDepth: cfg.maxDepth,
    timeMs: cfg.timeMs,
    jitter: cfg.jitter,
    gameHashes: msg.gameHashes || [],
    onInfo: function (info) {
      self.postMessage({ type: "info", id: msg.id, depth: info.depth, score: info.score, nodes: info.nodes });
    }
  });
  self.postMessage({
    type: "result",
    id: msg.id,
    from: result.move ? E.moveFrom(result.move) : -1,
    to: result.move ? E.moveTo(result.move) : -1,
    promo: result.move ? E.movePromo(result.move) : 0,
    score: result.score,
    depth: result.depth,
    nodes: result.nodes
  });
};

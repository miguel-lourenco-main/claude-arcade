// Web worker for the deep (tier 3) AI so the search never blocks the UI.
"use strict";
importScripts("engine.js");

self.onmessage = function (e) {
  var msg = e.data;
  var board = new Int8Array(msg.board);
  var res = self.ReversiEngine.searchDeep(board, msg.player, {
    depth: msg.depth || 5,
    exactAt: msg.exactAt == null ? 12 : msg.exactAt,
  });
  self.postMessage({ token: msg.token, idx: res.idx, exact: res.exact });
};

/*
 * pieces.js — original vector chess pieces, drawn with canvas paths.
 * Each piece is designed in a 100x100 unit space and rendered into cached
 * offscreen sprites at the requested pixel size.
 */
(function (global) {
  "use strict";
  var E = global.ChessEngine;

  var STYLE = {
    // [fill, outline, detail]
    white: ["#e7e2d2", "#15181d", "#15181d"],
    black: ["#2a2f38", "#a9b2bd", "#a9b2bd"]
  };

  function pathBase(ctx) {
    // shared plinth
    rounded(ctx, 26, 78, 48, 10, 3);
  }

  function rounded(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawPawn(ctx) {
    ctx.beginPath();
    ctx.arc(50, 30, 11.5, 0, Math.PI * 2);
    rounded(ctx, 37, 42, 26, 6, 3);
    // tapered body
    ctx.moveTo(41, 49);
    ctx.bezierCurveTo(41, 60, 35, 68, 33, 76);
    ctx.lineTo(67, 76);
    ctx.bezierCurveTo(65, 68, 59, 60, 59, 49);
    ctx.closePath();
    pathBase(ctx);
    ctx.fill(); ctx.stroke();
  }

  function drawRook(ctx) {
    ctx.beginPath();
    // merlons
    ctx.rect(29, 16, 11, 14);
    ctx.rect(44.5, 16, 11, 14);
    ctx.rect(60, 16, 11, 14);
    // top platform
    rounded(ctx, 27, 28, 46, 9, 2);
    // tower
    ctx.moveTo(35, 38);
    ctx.lineTo(33.5, 70);
    ctx.lineTo(66.5, 70);
    ctx.lineTo(65, 38);
    ctx.closePath();
    rounded(ctx, 29, 70, 42, 8, 2);
    pathBase(ctx);
    ctx.fill(); ctx.stroke();
    // brick lines
    ctx.beginPath();
    ctx.moveTo(36, 50); ctx.lineTo(64, 50);
    ctx.moveTo(35, 60); ctx.lineTo(65, 60);
    ctx.stroke();
  }

  function drawKnight(ctx, detail) {
    ctx.beginPath();
    // horse head + neck, facing left
    ctx.moveTo(33, 78);
    ctx.bezierCurveTo(31, 62, 34, 52, 27, 46);      // chest up to jaw
    ctx.bezierCurveTo(22, 42, 17, 40, 16, 35);      // toward nose
    ctx.lineTo(23, 32);                             // mouth notch
    ctx.bezierCurveTo(24, 28, 27, 24, 32, 20);      // forehead
    ctx.lineTo(34, 10);                             // ear one up
    ctx.lineTo(41, 17);                             // ear one down
    ctx.lineTo(47, 12);                             // ear two up
    ctx.lineTo(50, 20);                             // ear two down
    ctx.bezierCurveTo(60, 26, 66, 38, 68, 52);      // back of head / mane
    ctx.bezierCurveTo(69, 62, 69, 70, 68, 78);      // down to base
    ctx.closePath();
    pathBase(ctx);
    ctx.fill(); ctx.stroke();
    // eye + nostril + mane detail
    ctx.beginPath();
    ctx.arc(35, 30, 2.1, 0, Math.PI * 2);
    ctx.fillStyle = detail;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(22, 35.5);
    ctx.lineTo(26, 34.5);
    ctx.moveTo(52, 26);
    ctx.bezierCurveTo(58, 34, 61, 44, 62, 56);
    ctx.stroke();
  }

  function drawBishop(ctx, detail) {
    ctx.beginPath();
    ctx.arc(50, 13, 5, 0, Math.PI * 2);
    // mitre
    ctx.moveTo(50, 19);
    ctx.bezierCurveTo(60, 26, 66, 36, 64, 47);
    ctx.bezierCurveTo(63, 53, 58, 57, 50, 57);
    ctx.bezierCurveTo(42, 57, 37, 53, 36, 47);
    ctx.bezierCurveTo(34, 36, 40, 26, 50, 19);
    // collar + stem
    rounded(ctx, 38, 59, 24, 6, 3);
    ctx.moveTo(43, 66);
    ctx.lineTo(38, 76);
    ctx.lineTo(62, 76);
    ctx.lineTo(57, 66);
    ctx.closePath();
    pathBase(ctx);
    ctx.fill(); ctx.stroke();
    // diagonal slit
    ctx.beginPath();
    ctx.moveTo(45, 33);
    ctx.lineTo(57, 45);
    ctx.strokeStyle = detail;
    ctx.lineWidth = 3.4;
    ctx.stroke();
  }

  function drawQueen(ctx) {
    // crown orbs
    var tips = [[27, 17], [39, 11], [50, 9], [61, 11], [73, 17]];
    ctx.beginPath();
    for (var i = 0; i < tips.length; i++) ctx.arc(tips[i][0], tips[i][1], 3.4, 0, Math.PI * 2), ctx.closePath();
    ctx.fill(); ctx.stroke();
    // crown: spikes down to the band
    ctx.beginPath();
    ctx.moveTo(27, 21);
    ctx.lineTo(35, 44);
    ctx.lineTo(39, 15);
    ctx.lineTo(45, 43);
    ctx.lineTo(50, 13);
    ctx.lineTo(55, 43);
    ctx.lineTo(61, 15);
    ctx.lineTo(65, 44);
    ctx.lineTo(73, 21);
    ctx.bezierCurveTo(69, 34, 67, 40, 66, 46);
    ctx.lineTo(34, 46);
    ctx.bezierCurveTo(33, 40, 31, 34, 27, 21);
    ctx.closePath();
    // body
    ctx.moveTo(37, 50);
    ctx.bezierCurveTo(38, 60, 34, 68, 31, 76);
    ctx.lineTo(69, 76);
    ctx.bezierCurveTo(66, 68, 62, 60, 63, 50);
    ctx.closePath();
    rounded(ctx, 34, 46, 32, 5, 2.5);
    pathBase(ctx);
    ctx.fill(); ctx.stroke();
  }

  function drawKing(ctx) {
    ctx.beginPath();
    // cross
    ctx.rect(46.8, 3, 6.4, 17);
    ctx.rect(40.5, 7.6, 19, 6.4);
    // crown: two side lobes meeting in the middle
    ctx.moveTo(30, 46);
    ctx.bezierCurveTo(24, 34, 30, 24, 40, 24);
    ctx.bezierCurveTo(45, 24, 49, 27, 50, 32);
    ctx.bezierCurveTo(51, 27, 55, 24, 60, 24);
    ctx.bezierCurveTo(70, 24, 76, 34, 70, 46);
    ctx.closePath();
    // robe
    ctx.moveTo(37, 50);
    ctx.bezierCurveTo(37, 60, 33, 68, 30, 76);
    ctx.lineTo(70, 76);
    ctx.bezierCurveTo(67, 68, 63, 60, 63, 50);
    ctx.closePath();
    rounded(ctx, 32, 46, 36, 5, 2.5);
    pathBase(ctx);
    ctx.fill(); ctx.stroke();
    // crown seam
    ctx.beginPath();
    ctx.moveTo(50, 32);
    ctx.lineTo(50, 46);
    ctx.stroke();
  }

  var cache = {};

  // Returns a canvas sprite for piece (engine-encoded) at px x px.
  function sprite(piece, px) {
    var key = piece + "@" + px;
    if (cache[key]) return cache[key];
    var c = document.createElement("canvas");
    c.width = px; c.height = px;
    var ctx = c.getContext("2d");
    var color = E.colorOf(piece) === E.WHITE ? STYLE.white : STYLE.black;
    var scale = px / 100;
    ctx.save();
    ctx.scale(scale, scale);
    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.fillStyle = color[0];
    ctx.strokeStyle = color[1];
    switch (E.typeOf(piece)) {
      case E.PAWN: drawPawn(ctx); break;
      case E.ROOK: drawRook(ctx); break;
      case E.KNIGHT: drawKnight(ctx, color[2]); break;
      case E.BISHOP: drawBishop(ctx, color[2]); break;
      case E.QUEEN: drawQueen(ctx); break;
      case E.KING: drawKing(ctx); break;
    }
    ctx.restore();
    cache[key] = c;
    return c;
  }

  function clearCache() { cache = {}; }

  global.ChessPieces = { sprite: sprite, clearCache: clearCache };
})(typeof self !== "undefined" ? self : globalThis);

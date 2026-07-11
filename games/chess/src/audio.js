/*
 * audio.js — Web Audio synthesized sounds. No samples, just short envelopes.
 * The AudioContext is created lazily on the first user gesture; a global
 * enabled flag gates every play call.
 */
(function (global) {
  "use strict";

  var ctx = null;
  var master = null;
  var enabled = true;

  function ensure() {
    if (!enabled) return null;
    if (!ctx) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freq, dur, opts) {
    var c = ensure();
    if (!c) return;
    opts = opts || {};
    var t0 = c.currentTime + (opts.delay || 0);
    var osc = c.createOscillator();
    var g = c.createGain();
    osc.type = opts.type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.glide) osc.frequency.exponentialRampToValueAtTime(opts.glide, t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(opts.vol || 0.25, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise(dur, opts) {
    var c = ensure();
    if (!c) return;
    opts = opts || {};
    var t0 = c.currentTime + (opts.delay || 0);
    var len = Math.max(1, Math.floor(c.sampleRate * dur));
    var buf = c.createBuffer(1, len, c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = c.createBufferSource();
    src.buffer = buf;
    var filt = c.createBiquadFilter();
    filt.type = opts.filterType || "lowpass";
    filt.frequency.value = opts.cutoff || 800;
    var g = c.createGain();
    g.gain.value = opts.vol || 0.3;
    src.connect(filt).connect(g).connect(master);
    src.start(t0);
  }

  var Sound = {
    get enabled() { return enabled; },
    set enabled(v) { enabled = !!v; },
    // wake the context inside a user-gesture handler
    unlock: function () { if (enabled) ensure(); },
    move: function () {
      tone(340, 0.07, { type: "triangle", glide: 240, vol: 0.22 });
      noise(0.03, { cutoff: 1200, vol: 0.10 });
    },
    capture: function () {
      tone(190, 0.09, { type: "triangle", glide: 120, vol: 0.28 });
      noise(0.07, { cutoff: 650, vol: 0.30 });
    },
    castle: function () {
      tone(300, 0.06, { type: "triangle", glide: 220, vol: 0.2 });
      tone(300, 0.06, { type: "triangle", glide: 220, vol: 0.2, delay: 0.09 });
    },
    check: function () {
      tone(660, 0.09, { type: "square", vol: 0.09 });
      tone(880, 0.11, { type: "square", vol: 0.09, delay: 0.09 });
    },
    promote: function () {
      tone(440, 0.08, { type: "triangle", vol: 0.18 });
      tone(554, 0.08, { type: "triangle", vol: 0.18, delay: 0.07 });
      tone(659, 0.12, { type: "triangle", vol: 0.2, delay: 0.14 });
    },
    illegal: function () {
      tone(140, 0.08, { type: "sawtooth", vol: 0.08 });
    },
    win: function () {
      tone(523, 0.12, { type: "triangle", vol: 0.2 });
      tone(659, 0.12, { type: "triangle", vol: 0.2, delay: 0.12 });
      tone(784, 0.24, { type: "triangle", vol: 0.22, delay: 0.24 });
    },
    lose: function () {
      tone(392, 0.14, { type: "triangle", vol: 0.2 });
      tone(311, 0.14, { type: "triangle", vol: 0.2, delay: 0.14 });
      tone(233, 0.30, { type: "triangle", vol: 0.22, delay: 0.28 });
    },
    draw: function () {
      tone(392, 0.12, { type: "triangle", vol: 0.18 });
      tone(392, 0.18, { type: "triangle", vol: 0.16, delay: 0.16 });
    },
    ui: function () {
      tone(500, 0.04, { type: "sine", vol: 0.10 });
    }
  };

  global.ChessSound = Sound;
})(typeof self !== "undefined" ? self : globalThis);

// Tiny Web Audio synth for UI blips. The AudioContext is only created after
// a user gesture (Sound.unlock() is called from input handlers).
"use strict";
(function (root) {
  var ctx = null;
  var master = null;
  var enabled = true;

  function ensure() {
    if (!ctx) {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
  }

  function tone(freq, dur, type, vol, delay, endFreq) {
    if (!enabled || !ctx) return;
    var t = ctx.currentTime + (delay || 0);
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.3, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  root.Sound = {
    unlock: function () { ensure(); },
    setEnabled: function (v) { enabled = !!v; if (enabled) ensure(); },
    isEnabled: function () { return enabled; },
    ui: function () { tone(440, 0.045, "square", 0.12); },
    place: function () {
      tone(520, 0.07, "triangle", 0.4);
      tone(790, 0.05, "square", 0.1, 0.02);
    },
    // One blip per ripple wave, rising in pitch with distance.
    flip: function (wave) { tone(340 + wave * 75, 0.06, "triangle", 0.24); },
    illegal: function () { tone(150, 0.09, "square", 0.18, 0, 110); },
    pass: function () { tone(230, 0.28, "sawtooth", 0.16, 0, 120); },
    win: function () {
      tone(392, 0.11, "triangle", 0.3);
      tone(494, 0.11, "triangle", 0.3, 0.11);
      tone(587, 0.22, "triangle", 0.32, 0.22);
    },
    lose: function () {
      tone(392, 0.13, "triangle", 0.28);
      tone(311, 0.13, "triangle", 0.28, 0.13);
      tone(233, 0.28, "triangle", 0.3, 0.26);
    },
    draw: function () {
      tone(392, 0.12, "triangle", 0.28);
      tone(392, 0.2, "triangle", 0.28, 0.14);
    },
  };
})(window);

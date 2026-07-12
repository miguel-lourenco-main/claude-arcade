// Dustkart — Web Audio synth. All sound generated at runtime: an engine
// hum that tracks speed, a drift screech, boost whoosh, item pips, spin
// sting, kart bump, countdown beeps and the finish fanfare. The
// AudioContext starts only after a user gesture; everything hangs off one
// toggleable master gain.
// Classic script (file://-safe): attaches to the Dustkart namespace.

(function () {
'use strict';
const NS = typeof globalThis !== 'undefined' ? globalThis : window;
const DK = NS.Dustkart = NS.Dustkart || {};

class AudioSys {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.master = null;
  }

  // Call from a user-gesture handler.
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 1 : 0;
    this.master.connect(ctx.destination);

    // shared noise buffer
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    // ---- engine: putt-putt saw + sub square through a lowpass ----
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 420;
    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'square';
    const o2g = ctx.createGain(); o2g.gain.value = 0.45;
    this.osc1.frequency.value = 52; this.osc2.frequency.value = 26;
    this.osc1.connect(this.engFilter);
    this.osc2.connect(o2g); o2g.connect(this.engFilter);
    this.engFilter.connect(this.engGain); this.engGain.connect(this.master);
    this.osc1.start(); this.osc2.start();

    // ---- drift screech: high bandpassed noise ----
    this.screechGain = ctx.createGain(); this.screechGain.gain.value = 0;
    const scSrc = ctx.createBufferSource();
    scSrc.buffer = buf; scSrc.loop = true;
    scSrc.playbackRate.value = 1.4;
    const scF = ctx.createBiquadFilter();
    scF.type = 'bandpass'; scF.frequency.value = 2100; scF.Q.value = 2.2;
    scSrc.connect(scF); scF.connect(this.screechGain);
    this.screechGain.connect(this.master);
    scSrc.start();

    // ---- off-road rumble: lowpassed noise ----
    this.rumbleGain = ctx.createGain(); this.rumbleGain.gain.value = 0;
    const ruSrc = ctx.createBufferSource();
    ruSrc.buffer = buf; ruSrc.loop = true;
    ruSrc.playbackRate.value = 0.45;
    const ruF = ctx.createBiquadFilter();
    ruF.type = 'lowpass'; ruF.frequency.value = 200;
    ruSrc.connect(ruF); ruF.connect(this.rumbleGain);
    this.rumbleGain.connect(this.master);
    ruSrc.start();

    // ---- boost wind: bandpassed noise swell ----
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    const wSrc = ctx.createBufferSource();
    wSrc.buffer = buf; wSrc.loop = true;
    const wF = ctx.createBiquadFilter();
    wF.type = 'bandpass'; wF.frequency.value = 900; wF.Q.value = 0.5;
    wSrc.connect(wF); wF.connect(this.windGain);
    this.windGain.connect(this.master);
    wSrc.start();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) {
      this.master.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02);
    }
  }

  // Called every frame with the current drive state.
  update(fx) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const r = fx.ratio;

    const idle = fx.driving ? 1 : 0;
    const f = 46 + r * 118 + (fx.boosting ? 24 : 0);
    this.osc1.frequency.setTargetAtTime(f, t, 0.04);
    this.osc2.frequency.setTargetAtTime(f / 2, t, 0.04);
    this.engFilter.frequency.setTargetAtTime(320 + r * 1250, t, 0.05);
    this.engGain.gain.setTargetAtTime(idle * (0.05 + r * 0.07), t, 0.05);

    this.screechGain.gain.setTargetAtTime(fx.drifting ? 0.06 + r * 0.07 : 0, t, 0.03);
    this.rumbleGain.gain.setTargetAtTime(fx.offRoad ? 0.15 + r * 0.1 : (fx.spinning ? 0.18 : 0), t, 0.03);
    this.windGain.gain.setTargetAtTime(fx.boosting ? 0.3 : Math.max(0, r - 0.7) * 0.5, t, 0.08);
  }

  // ---- one-shots ----

  blip(freq = 660, dur = 0.07, type = 'square', vol = 0.16, slide = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noiseBurst(dur, fStart, fEnd, vol, type = 'bandpass') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.Q.value = 1.2;
    f.frequency.setValueAtTime(fStart, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, fEnd), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  countdownBeep(go) {
    if (go) this.blip(880, 0.34, 'square', 0.2);
    else this.blip(440, 0.14, 'square', 0.16);
  }

  launch() { this.noiseBurst(0.5, 500, 2600, 0.4); this.blip(520, 0.2, 'square', 0.14, 300); }
  bog() { this.blip(160, 0.4, 'sawtooth', 0.2, -90); }

  driftTier(tier) { this.blip(tier === 2 ? 1050 : 780, 0.08, 'square', 0.15); }
  boost(tier) {
    this.noiseBurst(0.45, 600, 2800, 0.4);
    this.blip(tier === 2 ? 700 : 560, 0.18, 'square', 0.13, 260);
  }

  itemGet() { this.blip(620, 0.07, 'square', 0.13); setTimeout(() => this.blip(930, 0.09, 'square', 0.13), 80); }
  itemFire() { this.blip(360, 0.1, 'square', 0.15, 200); }
  shieldPop() { this.blip(500, 0.14, 'triangle', 0.18, -180); this.noiseBurst(0.2, 1400, 500, 0.2); }

  spin() {
    this.noiseBurst(0.45, 800, 90, 0.45, 'lowpass');
    this.blip(300, 0.4, 'sawtooth', 0.22, -210);
  }

  bump() { this.noiseBurst(0.16, 420, 120, 0.3, 'lowpass'); }

  lap() { this.blip(700, 0.09, 'square', 0.13); setTimeout(() => this.blip(940, 0.12, 'square', 0.13), 100); }

  fanfare(won) {
    const notes = won ? [523, 659, 784, 1046, 784, 1046, 1318]
                      : [392, 494, 587, 784, 587, 784];
    notes.forEach((f, i) => setTimeout(() => this.blip(f, 0.16, 'square', 0.15), i * 110));
  }
}

Object.assign(DK, { AudioSys });
})();

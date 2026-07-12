// Slipstream — Web Audio synth. Everything generated at runtime:
// engine hum that tracks speed through the gears, wind at high speed,
// skid/off-road noise, and one-shot blips for shifts, passes, crashes,
// checkpoints and the countdown. AudioContext starts only after a
// user gesture; the whole graph hangs off one toggleable master gain.

// Classic script (file://-safe): reads/attaches via the Slipstream
// namespace. Load after sim.js.

(function () {
'use strict';
const NS = typeof globalThis !== 'undefined' ? globalThis : window;
const Slipstream = NS.Slipstream = NS.Slipstream || {};
const { GEARS } = Slipstream;

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

    // shared noise buffer (1s of white noise)
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    // ---- engine: saw + detuned square through a lowpass ----
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 400;
    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'square';
    const o2g = ctx.createGain(); o2g.gain.value = 0.4;
    this.osc1.frequency.value = 44; this.osc2.frequency.value = 22;
    this.osc1.connect(this.engFilter);
    this.osc2.connect(o2g); o2g.connect(this.engFilter);
    this.engFilter.connect(this.engGain); this.engGain.connect(this.master);
    this.osc1.start(); this.osc2.start();

    // ---- wind: bandpassed noise, swells at high speed ----
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = buf; windSrc.loop = true;
    const windF = ctx.createBiquadFilter();
    windF.type = 'bandpass'; windF.frequency.value = 800; windF.Q.value = 0.4;
    windSrc.connect(windF); windF.connect(this.windGain);
    this.windGain.connect(this.master);
    windSrc.start();

    // ---- skid / rumble / off-road: lowpassed noise ----
    this.skidGain = ctx.createGain(); this.skidGain.gain.value = 0;
    const skidSrc = ctx.createBufferSource();
    skidSrc.buffer = buf; skidSrc.loop = true;
    skidSrc.playbackRate.value = 0.5;
    this.skidFilter = ctx.createBiquadFilter();
    this.skidFilter.type = 'lowpass'; this.skidFilter.frequency.value = 220;
    skidSrc.connect(this.skidFilter); this.skidFilter.connect(this.skidGain);
    this.skidGain.connect(this.master);
    skidSrc.start();
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
    const ratio = fx.ratio;

    // rpm within the current gear band
    const lo = GEARS[fx.gear];
    const hi = fx.gear + 1 < GEARS.length ? GEARS[fx.gear + 1] : 1.04;
    const rpm = Math.max(0, Math.min(1, (ratio - lo) / (hi - lo)));

    const idle = fx.driving ? 1 : 0;
    const f = 42 + rpm * 66 + fx.gear * 7;
    this.osc1.frequency.setTargetAtTime(f, t, 0.03);
    this.osc2.frequency.setTargetAtTime(f / 2, t, 0.03);
    this.engFilter.frequency.setTargetAtTime(300 + rpm * 1100 + fx.gear * 60, t, 0.04);
    this.engGain.gain.setTargetAtTime(idle * (0.05 + rpm * 0.055 + ratio * 0.02), t, 0.05);

    const wind = Math.max(0, ratio - 0.45);
    this.windGain.gain.setTargetAtTime(wind * wind * 0.55, t, 0.1);

    let skid = 0;
    if (fx.offRoad) skid = 0.16 + ratio * 0.1;
    else if (fx.onRumble) skid = 0.05 + ratio * 0.04;
    if (fx.spinning) skid = Math.max(skid, 0.18);
    this.skidFilter.frequency.setTargetAtTime(fx.onRumble && !fx.offRoad ? 420 : 220, t, 0.03);
    this.skidGain.gain.setTargetAtTime(skid, t, 0.03);
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

  gearShift() { this.blip(520, 0.05, 'square', 0.1, -160); }

  whoosh() { this.noiseBurst(0.32, 2400, 220, 0.4); }

  crash() {
    this.noiseBurst(0.5, 900, 90, 0.55, 'lowpass');
    this.blip(90, 0.35, 'sawtooth', 0.3, -55);
  }

  checkpoint() {
    this.blip(620, 0.09, 'square', 0.14);
    setTimeout(() => this.blip(830, 0.09, 'square', 0.14), 90);
    setTimeout(() => this.blip(1040, 0.14, 'square', 0.14), 180);
  }

  countdownBeep(go) {
    if (go) this.blip(880, 0.32, 'square', 0.2);
    else this.blip(440, 0.14, 'square', 0.16);
  }

  timeup() {
    this.blip(330, 0.3, 'sawtooth', 0.2, -180);
    setTimeout(() => this.blip(196, 0.5, 'sawtooth', 0.2, -90), 280);
  }

  finish() {
    const notes = [523, 659, 784, 1046, 784, 1046];
    notes.forEach((f, i) => setTimeout(() => this.blip(f, 0.16, 'square', 0.15), i * 110));
  }
}

Object.assign(Slipstream, { AudioSys });
})();

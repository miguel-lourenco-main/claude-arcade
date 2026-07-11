// audio.js — tiny Web Audio synth. Context is only created after a user gesture.
// Classic script: attaches its API to window.Patience (file:// friendly).

(function () {
'use strict';

class Sfx {
  constructor(enabled) {
    this.enabled = enabled;
    this.ctx = null;
    this.master = null;
    this._lastBounce = 0;
  }

  // call from within a user-gesture handler
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  _ready() {
    return this.enabled && this.ctx && this.ctx.state === 'running';
  }

  _tone(freq, dur, type, vol, when = 0, slide = 0) {
    if (!this._ready()) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  _noise(dur, vol, freq = 2200, when = 0) {
    if (!this._ready()) return;
    const t0 = this.ctx.currentTime + when;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
  }

  pick()    { this._noise(0.04, 0.25, 3200); }
  flip()    { this._noise(0.06, 0.30, 2400); this._tone(660, 0.05, 'triangle', 0.08); }
  place()   { this._tone(180, 0.07, 'sine', 0.30, 0, -60); this._noise(0.03, 0.18, 1200); }
  drawTick(){ this._noise(0.05, 0.22, 2800); }
  shuffle() {
    for (let i = 0; i < 5; i++) this._noise(0.05, 0.16, 1800 + i * 250, i * 0.045);
  }
  error()   { this._tone(140, 0.12, 'square', 0.10); }
  undo()    { this._tone(420, 0.06, 'triangle', 0.12, 0, -120); }
  foundation() {
    this._tone(720, 0.08, 'triangle', 0.16);
    this._tone(1080, 0.12, 'triangle', 0.12, 0.05);
  }
  bounce(vel) {
    const now = performance.now();
    if (now - this._lastBounce < 70) return; // rate-limit during the cascade
    this._lastBounce = now;
    const v = Math.min(1, vel / 900);
    this._tone(160 + Math.random() * 240, 0.05, 'triangle', 0.05 + v * 0.07);
  }
  win() {
    const notes = [392, 494, 587, 784, 587, 784, 988];
    notes.forEach((f, i) => this._tone(f, 0.22, 'triangle', 0.16, i * 0.09));
  }
}

window.Patience = window.Patience || {};
window.Patience.Sfx = Sfx;
})();

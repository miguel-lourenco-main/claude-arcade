// Tiny procedural WebAudio SFX: filtered noise bursts per material family.

import { BLOCKS } from "./blocks.js";

const MATERIAL_FREQ = {
  stone: 420, dirt: 620, sand: 880, wood: 540, plant: 1150, glass: 1600,
};

export class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  // must be called from a user gesture the first time
  _ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.enabled = false; return false; }
      this.ctx = new AC();
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return true;
  }

  _noiseBurst(freq, duration, gain) {
    if (!this.enabled || !this._ensure()) return;
    const ctx = this.ctx;
    const frames = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = freq;
    filter.Q.value = 1.2;
    const g = ctx.createGain();
    const now = ctx.currentTime;
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + duration);
    src.connect(filter).connect(g).connect(ctx.destination);
    src.start();
  }

  block(kind, blockId) {
    const def = BLOCKS[blockId];
    const base = MATERIAL_FREQ[def ? def.sound : "stone"] || 500;
    if (kind === "break") this._noiseBurst(base * 0.8, 0.14, 0.18);
    else if (kind === "hit") this._noiseBurst(base * 0.9, 0.06, 0.07); // mining tick
    else this._noiseBurst(base * 1.25, 0.09, 0.14);
  }

  step(blockId) {
    const def = BLOCKS[blockId];
    if (!def || def.sound === undefined) return;
    const base = MATERIAL_FREQ[def.sound] || 500;
    this._noiseBurst(base * 0.6 + Math.random() * 80, 0.07, 0.05);
  }

  hurt() { this._noiseBurst(170, 0.18, 0.3); }

  pickup() {
    if (!this.enabled || !this._ensure()) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const now = ctx.currentTime;
    osc.type = "square";
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
    g.gain.setValueAtTime(0.06, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(g).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  click() { this._noiseBurst(2200, 0.04, 0.08); }
}

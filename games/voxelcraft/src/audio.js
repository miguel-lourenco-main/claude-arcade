// Tiny procedural WebAudio SFX: filtered noise bursts per material family.

import { BLOCKS } from "./blocks.js";

const MATERIAL_FREQ = {
  stone: 420, dirt: 620, sand: 880, wood: 540, plant: 1150, glass: 1600,
};

export class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this._rain = null;  // { src, gain } — the looped shower bed, built once
    this.rainLevel = 0; // last level handed to setRain (test hook)
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

  // ambient creature calls (see LORE.md for who's who)
  creature(kind) {
    switch (kind) {
      case "snuffle": // Snuffet: soft double snort
        this._noiseBurst(320, 0.09, 0.12);
        setTimeout(() => this._noiseBurst(250, 0.1, 0.1), 100);
        break;
      case "rasp": // Murkling: a whisper you wish you hadn't heard
        this._noiseBurst(1400, 0.28, 0.05);
        break;
      case "clicks": // Stalkid: stone knuckles
        this._noiseBurst(950, 0.03, 0.1);
        setTimeout(() => this._noiseBurst(1150, 0.03, 0.1), 90);
        break;
      case "rustle": // Prickleback: dry spines
        this._noiseBurst(750, 0.14, 0.07);
        break;
      case "bellow": // Mirewalker: the shoreline disagrees
        this._noiseBurst(110, 0.45, 0.28);
        break;
      case "bell": // Peddler: the little brass bell on his pack
        this._bellTone(1320, 0.5, 0.05);
        setTimeout(() => this._bellTone(1188, 0.4, 0.035), 210);
        break;
    }
  }

  // a small struck bell: a sine with a faint detuned partial, long decay
  _bellTone(freq, dur, gain) {
    if (!this.enabled || !this._ensure()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    g.connect(ctx.destination);
    for (const [mult, amt] of [[1, 1], [2.76, 0.35]]) {
      const osc = ctx.createOscillator();
      const og = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq * mult;
      og.gain.value = amt;
      osc.connect(og).connect(g);
      osc.start(now);
      osc.stop(now + dur);
    }
  }

  // the Peddler's satisfied hm-hm on a completed trade: two short, low,
  // closed-mouth hums, the second a shade higher (pleased, not surprised)
  peddlerHm() {
    if (!this.enabled || !this._ensure()) return;
    const ctx = this.ctx;
    const hum = (freq, at, dur) => {
      const now = ctx.currentTime + at;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.92, now + dur);
      g.gain.setValueAtTime(0.001, now);
      g.gain.exponentialRampToValueAtTime(0.09, now + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, now + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + dur + 0.02);
    };
    hum(196, 0, 0.13);
    hum(247, 0.16, 0.18);
  }

  mobHurt() { this._noiseBurst(700, 0.12, 0.16); }

  // eating: soft mushy chew ticks while holding, a low gulp on the swallow
  eat(kind) {
    if (kind === "swallow") {
      this._noiseBurst(240, 0.16, 0.16);
      setTimeout(() => this._noiseBurst(160, 0.1, 0.1), 90);
    } else {
      this._noiseBurst(420 + Math.random() * 160, 0.06, 0.1);
    }
  }

  craft() { this._noiseBurst(900, 0.08, 0.1); }

  // the shower itself: a looped, lowpassed noise bed whose gain follows the
  // sky's rain intensity. level 0..1; pass 0 while under cover/underground —
  // the gain eases so stepping through a doorway swells rather than clicks.
  setRain(level) {
    level = Math.min(1, Math.max(0, level || 0));
    if (level === this.rainLevel && !(level > 0 && !this._rain)) return;
    this.rainLevel = level;
    if (level <= 0 && !this._rain) return; // never built, nothing to quiet
    if (!this.enabled || !this._ensure()) return;
    const ctx = this.ctx;
    if (!this._rain) {
      // 2s of pre-softened noise, seamlessly looped
      const frames = Math.floor(ctx.sampleRate * 2);
      const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < frames; i++) {
        last = last * 0.8 + (Math.random() * 2 - 1) * 0.3;
        data[i] = last;
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 900;
      filter.Q.value = 0.5;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(ctx.destination);
      src.start();
      this._rain = { src, gain };
    }
    this._rain.gain.gain.setTargetAtTime(level * 0.14, ctx.currentTime, 0.4);
  }

  // hinge creak for the Plank Door: two short wooden squeaks — pitch climbs
  // when it swings open, sinks when it thuds shut
  door(open) {
    this._noiseBurst(open ? 340 : 430, 0.09, 0.12);
    setTimeout(() => this._noiseBurst(open ? 560 : 250, 0.13, 0.11), 80);
  }

  // a sling stone leaving the foot-hand: a soft rising swoosh of air
  whip() {
    if (!this.enabled || !this._ensure()) return;
    const ctx = this.ctx;
    const dur = 0.14;
    const frames = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 2.2;
    const now = ctx.currentTime;
    filter.frequency.setValueAtTime(520, now);
    filter.frequency.exponentialRampToValueAtTime(2400, now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.exponentialRampToValueAtTime(0.09, now + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(filter).connect(g).connect(ctx.destination);
    src.start();
  }

  // ...and the dry snick of one shattering against something harder
  stoneCrack() {
    this._noiseBurst(1400, 0.05, 0.13);
    setTimeout(() => this._noiseBurst(900, 0.06, 0.08), 30);
  }

  // the dib-float touching down on the water: a soft slap
  splash() { this._noiseBurst(560, 0.09, 0.09); }

  // a bite pulling the float under: a quick hollow descending plip
  plip() {
    if (!this.enabled || !this._ensure()) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const now = ctx.currentTime;
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(240, now + 0.09);
    g.gain.setValueAtTime(0.14, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    osc.connect(g).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  // the Blast Keg's fuse: a dry, urgent little tick...
  kegTick() { this._noiseBurst(2400, 0.03, 0.09); }

  // ...and the deep boom it was building toward: a sharp crack over layered
  // low bursts, then a rolling after-rumble
  kegBoom() {
    this._noiseBurst(900, 0.12, 0.18);  // the crack
    this._noiseBurst(130, 0.45, 0.4);   // the body
    this._noiseBurst(55, 0.9, 0.55);    // the ground answering
    setTimeout(() => this._noiseBurst(80, 0.7, 0.26), 130); // the rumble
  }

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

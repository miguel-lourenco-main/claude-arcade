// Fuse — tiny Web Audio synth. All sounds are short procedural blips.
// The AudioContext is only created/resumed from a user gesture (unlock()).

export class Synth {
  constructor(enabled = true) {
    this.enabled = enabled;
    this.ctx = null;
  }

  // Call from input handlers (keydown / touch / click are all gestures).
  unlock() {
    if (!this.enabled) return;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
      } catch {
        this.ctx = null;
        return;
      }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  tone(freq, dur, { type = 'sine', gain = 0.12, when = 0, glide = 0 } = {}) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + glide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  slide() {
    this.tone(150, 0.07, { type: 'triangle', gain: 0.05, glide: 90 });
  }

  // Merge chime — pitch climbs with the tile value produced.
  merge(value) {
    const step = Math.log2(Math.max(4, value)); // 4→2 … 2048→11
    const f = 240 * Math.pow(1.11, step);
    this.tone(f, 0.1, { type: 'sine', gain: 0.11 });
    this.tone(f * 1.5, 0.12, { type: 'sine', gain: 0.07, when: 0.045 });
  }

  spawnTick() {
    this.tone(660, 0.035, { type: 'square', gain: 0.02 });
  }

  deny() {
    this.tone(95, 0.08, { type: 'square', gain: 0.04, glide: -25 });
  }

  win() {
    const notes = [392, 523, 659, 784, 1046];
    notes.forEach((f, i) => this.tone(f, 0.16, { type: 'triangle', gain: 0.1, when: i * 0.09 }));
  }

  lose() {
    const notes = [330, 262, 208, 156];
    notes.forEach((f, i) => this.tone(f, 0.2, { type: 'sawtooth', gain: 0.05, when: i * 0.13 }));
  }
}

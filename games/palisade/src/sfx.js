// Palisade — Web Audio synthesized sound effects. No samples, all synthesis.
// AudioContext is only created after a user gesture (unlock()).

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = localStorage.getItem('arcade.palisade.audio') !== 'off';
    this.lastAt = {};
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.28;
    this.master.connect(this.ctx.destination);
  }

  setEnabled(on) {
    this.enabled = on;
    localStorage.setItem('arcade.palisade.audio', on ? 'on' : 'off');
  }

  // Rate-limit identical sounds so 2x speed doesn't turn into white noise.
  gate(name, ms) {
    const now = performance.now();
    if (this.lastAt[name] && now - this.lastAt[name] < ms) return false;
    this.lastAt[name] = now;
    return true;
  }

  tone({ type = 'square', f0 = 440, f1 = null, dur = 0.1, vol = 0.5, delay = 0 }) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  noise({ dur = 0.15, vol = 0.4, fc = 1200, q = 1, delay = 0, sweep = null }) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + delay;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(fc, t);
    if (sweep !== null) filt.frequency.exponentialRampToValueAtTime(Math.max(20, sweep), t + dur);
    filt.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(this.master);
    src.start(t);
  }

  // --- one voice per game event -------------------------------------------

  shotArrow() { if (this.gate('arrow', 40)) this.tone({ type: 'square', f0: 900, f1: 500, dur: 0.06, vol: 0.25 }); }
  shotSplash() { if (this.gate('splash', 60)) this.tone({ type: 'sine', f0: 140, f1: 60, dur: 0.18, vol: 0.6 }); }
  shotPoison() { if (this.gate('poison', 60)) this.tone({ type: 'sawtooth', f0: 300, f1: 620, dur: 0.09, vol: 0.18 }); }
  frost() {
    if (!this.gate('frost', 70)) return;
    this.tone({ type: 'sine', f0: 1800, f1: 700, dur: 0.12, vol: 0.22 });
    this.tone({ type: 'sine', f0: 2400, f1: 1000, dur: 0.1, vol: 0.12, delay: 0.02 });
  }
  hit() { if (this.gate('hit', 50)) this.noise({ dur: 0.05, vol: 0.2, fc: 2500 }); }
  explosion() {
    if (!this.gate('boom', 80)) return;
    this.noise({ dur: 0.35, vol: 0.7, fc: 900, sweep: 120 });
    this.tone({ type: 'sine', f0: 90, f1: 40, dur: 0.3, vol: 0.5 });
  }
  death() { if (this.gate('death', 40)) this.tone({ type: 'triangle', f0: 500, f1: 150, dur: 0.12, vol: 0.3 }); }
  leak() {
    this.tone({ type: 'sawtooth', f0: 320, f1: 120, dur: 0.3, vol: 0.5 });
    this.tone({ type: 'square', f0: 160, f1: 80, dur: 0.3, vol: 0.3, delay: 0.05 });
  }
  place() { this.noise({ dur: 0.08, vol: 0.4, fc: 700 }); this.tone({ type: 'triangle', f0: 220, f1: 330, dur: 0.08, vol: 0.3 }); }
  upgrade() {
    this.tone({ type: 'triangle', f0: 330, dur: 0.07, vol: 0.3 });
    this.tone({ type: 'triangle', f0: 440, dur: 0.07, vol: 0.3, delay: 0.07 });
    this.tone({ type: 'triangle', f0: 660, dur: 0.1, vol: 0.3, delay: 0.14 });
  }
  sell() { this.tone({ type: 'triangle', f0: 520, f1: 260, dur: 0.15, vol: 0.3 }); }
  coin() { if (this.gate('coin', 90)) { this.tone({ type: 'square', f0: 1100, dur: 0.04, vol: 0.12 }); this.tone({ type: 'square', f0: 1600, dur: 0.06, vol: 0.1, delay: 0.04 }); } }
  waveStart() {
    this.tone({ type: 'square', f0: 262, dur: 0.09, vol: 0.25 });
    this.tone({ type: 'square', f0: 330, dur: 0.09, vol: 0.25, delay: 0.1 });
    this.tone({ type: 'square', f0: 392, dur: 0.14, vol: 0.25, delay: 0.2 });
  }
  waveClear() {
    this.tone({ type: 'triangle', f0: 392, dur: 0.1, vol: 0.3 });
    this.tone({ type: 'triangle', f0: 523, dur: 0.16, vol: 0.3, delay: 0.11 });
  }
  error() { this.tone({ type: 'square', f0: 130, dur: 0.09, vol: 0.25 }); }
  win() {
    const notes = [262, 330, 392, 523, 660, 784];
    notes.forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.18, vol: 0.3, delay: i * 0.12 }));
  }
  lose() {
    const notes = [392, 330, 262, 196, 131];
    notes.forEach((f, i) => this.tone({ type: 'sawtooth', f0: f, dur: 0.22, vol: 0.25, delay: i * 0.15 }));
  }
}

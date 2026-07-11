// Tiny Web Audio synth: oscillator blips and filtered noise bursts, all
// generated on the fly. The AudioContext is only created after a user
// gesture (unlock()), and the on/off toggle persists via the caller.
export class Sound {
  constructor(enabled = true) {
    this.on = enabled;
    this.ctx = null;
  }

  /** Call from a user gesture (keydown / pointerdown). */
  unlock() {
    if (!this.ctx) {
      const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  blip(freq, dur, { type = 'square', vol = 0.06, slide = 0, delay = 0 } = {}) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0004, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  noise(dur, { vol = 0.08, freq = 900, delay = 0 } = {}) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0004, t0 + dur);
    src.connect(filt).connect(gain).connect(ctx.destination);
    src.start(t0);
  }

  play(name) {
    if (!this.on || !this.ctx) return;
    switch (name) {
      case 'hit': this.blip(190, 0.07, { slide: -90, vol: 0.07 }); break;
      case 'hurt': this.blip(120, 0.13, { type: 'sawtooth', slide: -50, vol: 0.09 }); break;
      case 'miss': this.blip(300, 0.03, { type: 'sine', vol: 0.03 }); break;
      case 'kill': this.noise(0.16, { freq: 700, vol: 0.09 }); break;
      case 'spit': this.blip(520, 0.06, { type: 'sine', slide: -260, vol: 0.045 }); break;
      case 'pickup': this.blip(660, 0.05, { type: 'sine', slide: 220, vol: 0.05 }); break;
      case 'potion': this.blip(520, 0.09, { type: 'sine', slide: 260, vol: 0.05 }); break;
      case 'scroll': this.blip(420, 0.1, { type: 'triangle', slide: 380, vol: 0.05 }); break;
      case 'teleport':
        this.blip(700, 0.12, { type: 'sine', slide: -500, vol: 0.05 });
        this.blip(220, 0.12, { type: 'sine', slide: 480, vol: 0.05, delay: 0.06 });
        break;
      case 'equip': this.noise(0.06, { freq: 2400, vol: 0.05 }); break;
      case 'stairs':
        this.blip(330, 0.08, { type: 'triangle', slide: -80, vol: 0.05 });
        this.blip(240, 0.1, { type: 'triangle', slide: -70, vol: 0.05, delay: 0.09 });
        break;
      case 'levelup':
        this.blip(392, 0.09, { type: 'triangle', vol: 0.06 });
        this.blip(494, 0.09, { type: 'triangle', vol: 0.06, delay: 0.09 });
        this.blip(587, 0.14, { type: 'triangle', vol: 0.06, delay: 0.18 });
        break;
      case 'death':
        this.noise(0.5, { freq: 400, vol: 0.1 });
        this.blip(110, 0.6, { type: 'sawtooth', slide: -70, vol: 0.07 });
        break;
      case 'win':
        [523, 659, 784, 1047].forEach((f, i) => this.blip(f, 0.16, { type: 'triangle', vol: 0.06, delay: i * 0.12 }));
        break;
    }
  }
}

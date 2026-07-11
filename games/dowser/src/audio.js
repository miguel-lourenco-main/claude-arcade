// Tiny Web Audio synth for Dowser. All sounds are short, procedural blips.
// The AudioContext is only created after a user gesture (unlock()).
// Classic script (file:// safe) — attaches Synth to the window.Dowser namespace.
(function () {
  "use strict";

  class Synth {
    constructor(storageKey) {
      this.storageKey = storageKey;
      this.enabled = localStorage.getItem(storageKey) !== "off";
      this.ctx = null;
    }

    unlock() {
      if (!this.enabled) return;
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { this.enabled = false; return; }
        this.ctx = new AC();
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
    }

    toggle() {
      this.enabled = !this.enabled;
      localStorage.setItem(this.storageKey, this.enabled ? "on" : "off");
      if (this.enabled) this.unlock();
      return this.enabled;
    }

    get ready() {
      return this.enabled && this.ctx && this.ctx.state === "running";
    }

    // One oscillator voice with an exponential decay envelope.
    tone(freq, { dur = 0.08, type = "triangle", gain = 0.12, when = 0, slide = 0 } = {}) {
      if (!this.ready) return;
      const t0 = this.ctx.currentTime + when;
      const osc = this.ctx.createOscillator();
      const amp = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
      amp.gain.setValueAtTime(gain, t0);
      amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(amp).connect(this.ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }

    // A filtered noise burst.
    noise({ dur = 0.3, gain = 0.25, when = 0, freq = 700 } = {}) {
      if (!this.ready) return;
      const t0 = this.ctx.currentTime + when;
      const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(freq * 3, t0);
      filter.frequency.exponentialRampToValueAtTime(freq / 3, t0 + dur);
      const amp = this.ctx.createGain();
      amp.gain.setValueAtTime(gain, t0);
      amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filter).connect(amp).connect(this.ctx.destination);
      src.start(t0);
    }

    // --- game events ---

    dig() {
      this.tone(430 + Math.random() * 60, { dur: 0.06, type: "triangle", gain: 0.1 });
      this.noise({ dur: 0.05, gain: 0.05, freq: 500 });
    }

    // Flood-fill cascade: a rising ripple, longer for bigger clears.
    cascade(cells) {
      const steps = Math.min(9, 2 + Math.floor(cells / 6));
      for (let i = 0; i < steps; i++) {
        this.tone(320 + i * 55, { dur: 0.05, type: "triangle", gain: 0.07, when: i * 0.035 });
      }
    }

    flag() {
      this.tone(760, { dur: 0.05, type: "square", gain: 0.07 });
      this.tone(980, { dur: 0.06, type: "square", gain: 0.06, when: 0.05 });
    }

    unflag() {
      this.tone(980, { dur: 0.05, type: "square", gain: 0.06 });
      this.tone(700, { dur: 0.06, type: "square", gain: 0.05, when: 0.05 });
    }

    thud() {
      // blocked action (chord that does nothing, click on flag)
      this.tone(180, { dur: 0.06, type: "sine", gain: 0.08 });
    }

    boom() {
      this.noise({ dur: 0.5, gain: 0.35, freq: 400 });
      this.tone(160, { dur: 0.55, type: "sawtooth", gain: 0.2, slide: -120 });
      this.tone(90, { dur: 0.7, type: "sine", gain: 0.25, slide: -55 });
    }

    win() {
      const notes = [392, 494, 587, 784];
      notes.forEach((f, i) => {
        this.tone(f, { dur: 0.16, type: "triangle", gain: 0.12, when: i * 0.11 });
      });
      this.tone(784, { dur: 0.45, type: "sine", gain: 0.08, when: notes.length * 0.11 });
    }
  }

  window.Dowser = window.Dowser || {};
  window.Dowser.Synth = Synth;
})();

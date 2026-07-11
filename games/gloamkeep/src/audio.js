// Gloamkeep — Web Audio synth SFX. No samples; everything is oscillators and
// filtered noise. The AudioContext is only created after a user gesture.

export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let enabled = true;

  function ensure() {
    if (!enabled) return false;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { enabled = false; return false; }
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      // 1s of white noise, reused by every noise burst
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx.state !== 'closed';
  }

  function env(gainNode, t0, peak, attack, decay) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  function osc(type, freq, t0, dur, peak, freqEnd, dest) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    env(g, t0, peak, 0.005, dur);
    o.connect(g).connect(dest || master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  function noise(t0, dur, peak, filterType, freq, freqEnd, q) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType || 'lowpass';
    f.frequency.setValueAtTime(freq || 1200, t0);
    if (freqEnd !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), t0 + dur);
    f.Q.value = q || 0.8;
    const g = ctx.createGain();
    env(g, t0, peak, 0.004, dur);
    src.connect(f).connect(g).connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  const distVol = (dist) => Math.min(1, 1.5 / (1 + (dist || 0) * 0.35));

  const api = {
    get enabled() { return enabled; },
    setEnabled(on) {
      enabled = on;
      if (!on && ctx && ctx.state === 'running') ctx.suspend();
      if (on && ctx && ctx.state === 'suspended') ctx.resume();
    },
    unlock() { ensure(); },

    shot() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      noise(t, 0.16, 0.5, 'lowpass', 3200, 300);
      osc('square', 220, t, 0.12, 0.25, 60);
      osc('sawtooth', 900, t, 0.05, 0.12, 200);
    },
    dryFire() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      osc('square', 500, t, 0.04, 0.1, 320);
    },
    wallSpark(dist) {
      if (!ensure()) return;
      const t = ctx.currentTime;
      noise(t, 0.06, 0.12 * distVol(dist), 'highpass', 2500, 4000);
    },
    enemyHit() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      noise(t, 0.09, 0.3, 'bandpass', 900, 300, 2);
      osc('triangle', 300, t, 0.08, 0.18, 140);
    },
    enemyDie(dist) {
      if (!ensure()) return;
      const t = ctx.currentTime;
      const v = distVol(dist);
      osc('sawtooth', 180, t, 0.5, 0.3 * v, 40);
      osc('sawtooth', 240, t + 0.04, 0.4, 0.18 * v, 55);
      noise(t + 0.05, 0.4, 0.2 * v, 'lowpass', 800, 100);
    },
    growl(dist) {
      if (!ensure()) return;
      const t = ctx.currentTime;
      const v = distVol(dist) * 0.7;
      // wobbly low snarl
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(70 + Math.random() * 30, t);
      lfo.type = 'sine';
      lfo.frequency.value = 9 + Math.random() * 6;
      lg.gain.value = 22;
      lfo.connect(lg).connect(o.frequency);
      env(g, t, 0.22 * v, 0.08, 0.45);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 500;
      o.connect(f).connect(g).connect(master);
      o.start(t); lfo.start(t);
      o.stop(t + 0.65); lfo.stop(t + 0.65);
    },
    doorOpen() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      noise(t, 0.7, 0.22, 'lowpass', 240, 90, 1.5);
      osc('triangle', 55, t, 0.65, 0.12, 40);
    },
    doorClose() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      noise(t, 0.45, 0.16, 'lowpass', 200, 70, 1.5);
      osc('triangle', 50, t + 0.3, 0.12, 0.14, 35);
    },
    locked() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      osc('square', 130, t, 0.1, 0.2, 110);
      osc('square', 98, t + 0.12, 0.16, 0.2, 80);
    },
    useThud() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      noise(t, 0.07, 0.1, 'lowpass', 400, 150);
    },
    secret() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      noise(t, 1.1, 0.25, 'lowpass', 160, 60, 2);
      osc('triangle', 45, t, 1.0, 0.16, 38);
      // discovery gleam
      osc('sine', 660, t + 0.1, 0.3, 0.08, 990);
    },
    pickup(kind) {
      if (!ensure()) return;
      const t = ctx.currentTime;
      if (kind && kind.startsWith('key')) {
        osc('sine', 620, t, 0.09, 0.16);
        osc('sine', 830, t + 0.09, 0.1, 0.16);
        osc('sine', 1240, t + 0.19, 0.22, 0.16);
      } else if (kind === 'shard') {
        osc('sine', 980, t, 0.08, 0.14);
        osc('sine', 1470, t + 0.07, 0.16, 0.14);
      } else if (kind === 'health') {
        osc('sine', 420, t, 0.1, 0.14);
        osc('sine', 630, t + 0.09, 0.16, 0.14);
      } else { // ammo
        osc('triangle', 260, t, 0.06, 0.16);
        osc('triangle', 350, t + 0.06, 0.08, 0.16);
      }
    },
    playerHit() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      noise(t, 0.2, 0.4, 'lowpass', 500, 120);
      osc('sine', 120, t, 0.18, 0.3, 55);
    },
    boltFire(dist) {
      if (!ensure()) return;
      const t = ctx.currentTime;
      const v = distVol(dist);
      osc('sawtooth', 1200, t, 0.25, 0.14 * v, 250);
      noise(t, 0.2, 0.1 * v, 'bandpass', 1800, 500, 3);
    },
    boltHit(dist) {
      if (!ensure()) return;
      const t = ctx.currentTime;
      noise(t, 0.12, 0.18 * distVol(dist), 'bandpass', 700, 200, 2);
    },
    levelComplete() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      const notes = [392, 494, 587, 784];
      notes.forEach((f, i) => {
        osc('triangle', f, t + i * 0.13, 0.3, 0.16);
        osc('sine', f * 2, t + i * 0.13, 0.2, 0.05);
      });
    },
    gameOver() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      const notes = [220, 196, 165, 110];
      notes.forEach((f, i) => {
        osc('sawtooth', f, t + i * 0.22, 0.45, 0.12, f * 0.92);
      });
      noise(t + 0.6, 0.9, 0.14, 'lowpass', 300, 50);
    },
  };
  return api;
}

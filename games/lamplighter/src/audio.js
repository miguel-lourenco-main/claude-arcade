/* Lamplighter — Web Audio synthesized sound effects.
   Everything is generated at play time: short blips, noise whooshes,
   little arpeggios. The AudioContext is only created after a user
   gesture (unlock()), and the whole thing respects the mute toggle. */

class Sfx {
  constructor(storageKey) {
    this.storageKey = storageKey;
    this.ctx = null;
    this.master = null;
    let stored = null;
    try { stored = localStorage.getItem(storageKey); } catch (e) { /* private mode */ }
    this.enabled = stored !== "off";
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.4;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  setEnabled(v) {
    this.enabled = v;
    try { localStorage.setItem(this.storageKey, v ? "on" : "off"); } catch (e) { /* ignore */ }
  }

  ready() {
    return this.enabled && this.ctx && this.ctx.state === "running";
  }

  tone(f0, f1, dur, type, vol, delay) {
    if (!this.ready()) return;
    const t = this.ctx.currentTime + (delay || 0);
    const o = this.ctx.createOscillator();
    const gn = this.ctx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(Math.max(1, f0), t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.012);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn); gn.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  noise(dur, vol, freq, q, delay) {
    if (!this.ready()) return;
    const t = this.ctx.currentTime + (delay || 0);
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(freq || 800, t);
    bp.Q.value = q || 1;
    const gn = this.ctx.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.02);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(gn); gn.connect(this.master);
    src.start(t); src.stop(t + dur + 0.05);
  }

  /* a soft warm pluck; pitch wanders gently with the running count */
  lantern(n) {
    const base = 460 + (n % 9) * 26;
    this.tone(base, base * 1.18, 0.09, "triangle", 0.16);
    this.tone(base * 2, base * 2.1, 0.06, "sine", 0.05, 0.01);
  }

  /* brazier catches: a whoosh of air and a low bloom */
  brazier() {
    this.noise(0.45, 0.22, 600, 0.8);
    this.tone(90, 180, 0.4, "sine", 0.22);
    this.tone(340, 620, 0.25, "triangle", 0.1, 0.05);
  }

  /* banishing a fleeing gloam: rising chime pair, higher per combo */
  banish(combo) {
    const f = 520 * Math.pow(1.25, combo);
    this.tone(f, f * 1.5, 0.12, "square", 0.09);
    this.tone(f * 1.5, f * 2, 0.14, "triangle", 0.12, 0.07);
    this.noise(0.18, 0.08, 2400, 2, 0.02);
  }

  /* the lamp goes out */
  death() {
    this.tone(420, 60, 0.9, "sawtooth", 0.14);
    this.tone(300, 45, 0.9, "triangle", 0.1, 0.08);
    this.noise(0.6, 0.1, 300, 0.7, 0.25);
  }

  /* level cleared: a little ascending arpeggio */
  clear() {
    const notes = [392, 494, 587, 784, 988];
    notes.forEach((f, i) => this.tone(f, f, 0.16, "triangle", 0.13, i * 0.09));
  }

  /* soft two-note ready cue */
  readyCue() {
    this.tone(330, 330, 0.1, "sine", 0.1);
    this.tone(495, 495, 0.14, "sine", 0.1, 0.12);
  }
}

/* dual environment: classic script in the browser, module in node tests */
if (typeof module !== "undefined" && module.exports) module.exports = Sfx;

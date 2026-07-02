// The Murmur: the Upturn's generative ambient music. Entirely procedural —
// every phrase is a seeded walk over a scale, composed at schedule time on
// soft synth voices (sine/triangle, slow attacks, a dampened echo for space).
// Nothing here quotes anything; the world's seed picks the key and the walk.
//
// Three moods, crossfaded by main.js reading the game each frame:
//   day    — airy major-pentatonic wandering, long rests between phrases
//   night  — slower, minor, an octave down, sparser still
//   delve  — below y~24 or under a roofed-over head: a breathing drone
//            (the old sky, humming in its caves) plus rare deep plinks
// Rain overlays a soft filtered-noise wash on its own lane.
//
// Scheduling uses AudioContext time exclusively (a 250ms lookahead pump), so
// nothing drifts. The context is shared with audio.js's Sfx and, per browser
// autoplay policy, start() is only ever called from a user-gesture path
// (main.js requestLock). Tests drive an injected OfflineAudioContext instead.

import { mulberry32 } from "./noise.js";

const MASTER_CEIL = 0.45; // absolute gain at volume 1.0 — ambient, not loud

// per-mood composition rules: scale degrees (semitones), octave multiplier on
// the seeded root, note count/duration ranges, rest between phrases (seconds),
// voice shape. All original material — the seed walks these, nothing else.
const MOODS = {
  day: {
    scale: [0, 2, 4, 7, 9],        // major pentatonic
    octave: 1,                      // around the seeded root (~A3-ish)
    notes: [4, 8], dur: [1.3, 2.6], rest: [20, 40],
    wave: "triangle", peak: 0.11, attack: 0.35,
  },
  night: {
    scale: [0, 3, 5, 7, 10],       // minor pentatonic
    octave: 0.5,                    // an octave down
    notes: [4, 6], dur: [2.2, 4.0], rest: [26, 45],
    wave: "sine", peak: 0.1, attack: 0.45,
  },
  delve: {
    scale: [0, 7, 12],             // bare fifths and octaves
    octave: 0.5,
    notes: [1, 3], dur: [2.5, 4.5], rest: [24, 45],
    wave: "sine", peak: 0.13, attack: 0.04, // plink: near-instant strike
  },
  cold: {
    scale: [0, 2, 4, 7, 9],        // the day's pentatonic, iced over
    octave: 2,                      // two octaves up: a glassy sparkle
    notes: [3, 6], dur: [1.4, 2.6], rest: [16, 34],
    wave: "sine", peak: 0.07, attack: 0.05, // struck, like tapped river glass
  },
};

export class Music {
  // opts.getContext: () => AudioContext|null — the lazy shared-context hook
  // opts.ctx (+ optional opts.destination): direct injection for tests, which
  //   also skips the interval pump (an OfflineAudioContext renders in one go)
  constructor(seed, opts = {}) {
    this.seed = seed >>> 0;
    this._rand = mulberry32(this.seed ^ 0x6d757263); // "murc"
    this._getContext = opts.getContext || null;
    this.ctx = opts.ctx || null;
    this._dest = opts.destination || null;
    this._injected = !!opts.ctx; // injected contexts get no interval pump

    // settings (persisted by main.js in the save; defaults: on, modest)
    this.enabled = true;
    this.volume = 0.5;

    // the seeded key: one of five roots off A3, fixed for this world
    this.root = 220 * Math.pow(2, [0, 2, 3, 5, 7][this.seed % 5] / 12);

    this.started = false;
    this.mood = "day";
    this.moodTarget = "day"; // last mood update() computed (pre-start too)
    this.rainLevel = 0;
    this.nextPhraseAt = 0;
    this._timer = null;

    // structural test hooks (window.voxelcraft.music reads these)
    this.phrasesScheduled = 0;
    this.notesArmed = 0;
    this.lastPhrase = null; // { mood, at, notes }
  }

  // must be reached from a user gesture the first time (autoplay policy) —
  // main.js calls this from requestLock, which only runs on clicks/keys
  start() {
    if (this.started) return;
    if (!this.ctx && this._getContext) this.ctx = this._getContext();
    if (!this.ctx) return;
    if (!this._dest) this._dest = this.ctx.destination;
    this.started = true;
    this._buildGraph();
    // the first phrase arrives politely soon; the usual rests follow
    this.nextPhraseAt = this.ctx.currentTime + 4 + this._rand() * 6;
    if (!this._injected) this._timer = setInterval(() => this._pump(), 250);
  }

  _buildGraph() {
    const ctx = this.ctx;

    // master (the volume setting lives here) <- a felt of gentle lowpass
    this.master = ctx.createGain();
    this.master.gain.value = this._masterTarget();
    this.master.connect(this._dest);
    this.tone = ctx.createBiquadFilter();
    this.tone.type = "lowpass";
    this.tone.frequency.value = 2400;
    this.tone.Q.value = 0.3;
    this.tone.connect(this.master);

    // one shared echo: a soft, dampened repeat that gives the notes a room
    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = 0.46;
    const damp = ctx.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = 1500;
    const fb = ctx.createGain();
    fb.gain.value = 0.34;
    this.delay.connect(damp).connect(fb).connect(this.delay);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    this.delay.connect(wet).connect(this.tone);
    this._send = ctx.createGain();
    this._send.gain.value = 0.4;
    this._send.connect(this.delay);

    // one bus per mood; update() crossfades them (~3s time constant)
    this.bus = {};
    for (const m of Object.keys(MOODS)) {
      const g = ctx.createGain();
      g.gain.value = m === this.mood ? 1 : 0;
      g.connect(this.tone);
      g.connect(this._send);
      this.bus[m] = g;
    }

    // the delve drone hums forever; its bus keeps it silent above ground.
    // Root + a breath-detuned twin + a faint fifth, breathing on a ~23s swell.
    const droneG = ctx.createGain();
    droneG.gain.value = 0.055;
    droneG.connect(this.bus.delve);
    const droneRoot = this.root * 0.25; // ~55Hz territory
    for (const [mult, det, amt] of [[1, -4, 1], [1, 5, 0.8], [1.5, 2, 0.4]]) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = droneRoot * mult;
      o.detune.value = det;
      const og = ctx.createGain();
      og.gain.value = amt;
      o.connect(og).connect(droneG);
      o.start();
    }
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 1 / 23;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.02;
    lfo.connect(lfoG).connect(droneG.gain);
    lfo.start();

    // rain wash: looped pre-softened noise on its own lane (any mood may rain)
    const frames = Math.floor(ctx.sampleRate * 2);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastS = 0;
    for (let i = 0; i < frames; i++) {
      lastS = lastS * 0.85 + (Math.random() * 2 - 1) * 0.25;
      data[i] = lastS;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const washLp = ctx.createBiquadFilter();
    washLp.type = "lowpass";
    washLp.frequency.value = 480;
    washLp.Q.value = 0.4;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    src.connect(washLp).connect(this.rainGain).connect(this.tone);
    src.start();
  }

  _masterTarget() {
    return this.enabled ? this.volume * MASTER_CEIL : 0;
  }

  _applyMaster() {
    if (!this.master) return;
    this.master.gain.setTargetAtTime(
      this._masterTarget(), this.ctx.currentTime, 0.25);
  }

  setVolume(v) {
    this.volume = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.5));
    this._applyMaster();
  }

  setEnabled(on) {
    this.enabled = !!on;
    this._applyMaster();
  }

  setRain(level) {
    level = Math.min(1, Math.max(0, level || 0));
    if (level === this.rainLevel) return;
    this.rainLevel = level;
    if (this.rainGain) {
      this.rainGain.gain.setTargetAtTime(
        level * 0.05, this.ctx.currentTime, 1.2);
    }
  }

  // called every frame by main.js with the game's read of the world.
  // Priority: the delve owns underground; the cold sparkle owns the
  // Rimelands (day or night — frost doesn't keep office hours); then the
  // usual day/night pair. moodTarget updates even before start() so tests
  // can assert the read without an unlocked AudioContext.
  update(state) {
    const mood = state.delve ? "delve" : state.cold ? "cold"
      : state.night ? "night" : "day";
    this.moodTarget = mood;
    if (!this.started) return;
    if (mood !== this.mood) {
      this.mood = mood;
      const now = this.ctx.currentTime;
      for (const m of Object.keys(this.bus)) {
        this.bus[m].gain.setTargetAtTime(m === mood ? 1 : 0, now, 3);
      }
      // a new mood brings its first phrase a little sooner than the old rest
      this.nextPhraseAt = Math.min(this.nextPhraseAt, now + 5 + this._rand() * 6);
    }
    this.setRain(state.rain);
  }

  // the lookahead pump: fires every 250ms, schedules in AudioContext time —
  // wall-clock jitter (tab throttling, GC) never shifts a note
  _pump() {
    if (!this.started || this.ctx.state !== "running") return;
    const now = this.ctx.currentTime;
    if (!this.enabled) {
      // muted: don't stockpile silent phrases; resume ~5s after re-enabling
      this.nextPhraseAt = Math.max(this.nextPhraseAt, now + 5);
      return;
    }
    if (now + 1 < this.nextPhraseAt) return;
    const end = this.schedulePhrase(this.mood, Math.max(this.nextPhraseAt, now + 0.1));
    const [r0, r1] = MOODS[this.mood].rest;
    this.nextPhraseAt = end + r0 + this._rand() * (r1 - r0);
  }

  // compose one phrase (a seeded walk over the mood's scale, spanning two
  // octaves) and arm its oscillators at `at`. Returns the phrase's end time.
  // Public: the offline-render test drives this directly.
  schedulePhrase(mood, at) {
    const M = MOODS[mood];
    const rand = this._rand;
    const count = M.notes[0] + Math.floor(rand() * (M.notes[1] - M.notes[0] + 1));
    const span = M.scale.length * 2; // two octaves of degrees
    let deg = M.scale.length - 1 + Math.floor(rand() * 3); // start mid-span
    let t = 0;
    let end = at;
    for (let i = 0; i < count; i++) {
      const step = [-2, -1, -1, 1, 1, 2, 3, -3][Math.floor(rand() * 8)];
      deg = Math.max(0, Math.min(span, deg + step));
      const oct = Math.floor(deg / M.scale.length);
      const semi = M.scale[deg % M.scale.length] + 12 * oct;
      const freq = this.root * M.octave * Math.pow(2, semi / 12);
      const dur = M.dur[0] + rand() * (M.dur[1] - M.dur[0]);
      this._voice(this.bus[mood], freq, at + t, dur, M.peak, M.wave, M.attack);
      end = Math.max(end, at + t + dur);
      // notes overlap a touch or leave a small breath — never a pulse grid
      t += dur * (0.55 + rand() * 0.6);
    }
    this.phrasesScheduled++;
    this.notesArmed += count;
    this.lastPhrase = { mood, at, notes: count };
    return end;
  }

  _voice(bus, freq, at, dur, peak, wave, attackFrac) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.value = freq;
    osc.detune.value = (this._rand() - 0.5) * 10; // a breath of drift
    const g = ctx.createGain();
    const atk = Math.max(0.02, dur * attackFrac);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(peak, at + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(bus);
    osc.start(at);
    osc.stop(at + dur + 0.1);
  }
}

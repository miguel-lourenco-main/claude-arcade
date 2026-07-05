// Gleam — the light that clings to work (see LORE.md). Motes of drowned
// starlight shed by work well done: ore cracked loose, beasts felled, the
// kiln's heat, a tool finished at the bench. A Wanderling bottles it without
// thinking about it; a full jar is a "level", and the Loomstone (a later
// wave) is what jars are eventually poured into.
//
// The model is deliberately tiny: a jar count plus progress toward the next
// jar. Costs grow linearly so early jars come quick and late jars mean
// something. Death never spills gleam — the Upturn is polite about grief.

const GLEAM_CAP = 30; // nothing will ever cost more than a handful

export class Gleam {
  constructor() {
    this.level = 0;    // filled jars
    this.progress = 0; // motes toward the next jar
  }

  // motes needed to fill the NEXT jar from the current count
  costForLevel() { return 10 + 5 * this.level; }

  add(n) {
    if (n <= 0 || this.level >= GLEAM_CAP) return;
    this.progress += n;
    while (this.level < GLEAM_CAP && this.progress >= this.costForLevel()) {
      this.progress -= this.costForLevel();
      this.level++;
    }
    if (this.level >= GLEAM_CAP) this.progress = 0; // the satchel is full
  }

  // spend whole jars (the Loomstone's currency); false = can't afford.
  // Costs shrink at lower levels, so clamp progress under the new jar size.
  spendLevels(n) {
    if (n <= 0 || this.level < n) return false;
    this.level -= n;
    this.progress = Math.min(this.progress, this.costForLevel() - 1);
    return true;
  }

  // 0..1 fill of the meter toward the next jar
  frac() {
    return this.level >= GLEAM_CAP ? 1 : this.progress / this.costForLevel();
  }

  serialize() { return [this.level, this.progress]; }

  load(arr) {
    if (!Array.isArray(arr)) return;
    const [level, progress] = arr;
    if (Number.isInteger(level) && level >= 0) {
      this.level = Math.min(GLEAM_CAP, level);
    }
    if (Number.isFinite(progress) && progress >= 0) {
      this.progress = Math.min(progress, this.costForLevel() - 1);
    }
  }
}

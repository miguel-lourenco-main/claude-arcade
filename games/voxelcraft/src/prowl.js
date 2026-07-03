// The Prowl: some nights the dark still remembers the Upturn (see LORE.md).
// A seeded night-siege event — at dusk an uneasy horn warns that tonight the
// old dark walks; from mid-evening until dawn, tagged hunters (murklings and
// stalkids, faster and single-minded) press toward the player at ~3x the
// usual spawn cadence. Torchlight holds exactly as it always has: prowlers
// pass the same dark-cell spawn gate as any creature of the old sky, so a
// lit, walled stead stays defensible. At dawn they are gone like any
// murkling, and a Wanderling who stood the whole night (no deaths) gets the
// "quiet morning": a gentle hunger-free mend back to full over ~20 seconds.
//
// Scheduling is deterministic in (world seed, night index), the Pearlfall's
// idiom (meteors.js): every Wanderling in the same world fears the same
// nights. A Prowl never shares a night with a Pearlfall shower (the sky's
// gift nights stay gentle), and a fresh world's first two nights are always
// quiet — the dark takes a while to notice a new satchel.
//
// Persistence: NOTHING here is saved. Whether a night prowls is re-derived
// from the seed on load, so a save written mid-Prowl RESUMES the same siege
// on reload (the plan still says the night prowls and the clock is still
// inside it; the horn re-sounds since the dusk cue wasn't seen). What a
// reload forgets, deliberately: a forceProwl() arming (test-only), the
// died-this-night flag (a reload after dying could re-earn the dawn mend —
// rare, harmless, accepted), and any in-flight quiet-morning drip.

import { mulberry32 } from "./noise.js";
import { nightHasShower } from "./meteors.js";
import { MAX_HEALTH } from "./player.js";

const PROWL_CHANCE = 0.3;   // ~1 night in 3-4 (of the shower-free nights)
export const GRACE_NIGHTS = 2; // nights 0 and 1 of a fresh world never prowl
const CUE_TIME = 0.52;      // dusk: the last light just went — the horn
const BEGIN_TIME = 0.62;    // the siege proper (mid-evening)
const NIGHT_LIGHT = 0.45;   // the same "night" gate main.js hands the mobs
const SPAWN_EVERY = 4 / 3;  // seconds between prowler spawn attempts —
                            // 3x the spawn director's 4s baseline
const QUIET_SECONDS = 22;   // the dawn mend: ~1 HP/s to full, plus slack

export class Prowl {
  // opts: { mobs, world, player, terrain, onAnnounce(text, ms?),
  //         onHorn(), onDawn() }
  constructor(seed, opts) {
    this.seed = seed >>> 0;
    this.mobs = opts.mobs;
    this.world = opts.world;
    this.player = opts.player;
    this.terrain = opts.terrain;
    this.onAnnounce = opts.onAnnounce;
    this.onHorn = opts.onHorn;
    this.onDawn = opts.onDawn;

    this.active = false;
    this.night = -1;      // the night index the active siege belongs to
    this.died = false;    // the player died at least once during it
    this.quietT = 0;      // seconds left on the quiet-morning mend
    this.cuedNight = -1;  // dusk horn already sounded for this night
    this.endedNight = -1; // a finished night never re-begins
    this._forceNight = -1; // test hook: this night prowls regardless
    this._spawnT = 0;
  }

  // the seeded per-night plan — deterministic in (seed, night index), like
  // the Pearlfall's. A shower night never prowls; the grace nights never
  // prowl; a forced night (test hook) always does.
  nightPlan(n) {
    const shower = nightHasShower(this.seed, n);
    if (this._forceNight === n) return { prowls: true, shower, forced: true };
    if (n < GRACE_NIGHTS) return { prowls: false, shower, grace: true };
    const rand = mulberry32((this.seed ^ Math.imul(n + 1, 0x9e3d79b1)) >>> 0);
    return { prowls: !shower && rand() < PROWL_CHANCE, shower };
  }

  // test/debug hook: arm the coming night to prowl (tonight — the night at
  // day N's dusk — or, mid-siege, the one after), overriding chance, grace,
  // and the shower-collision rule. Not persisted: a reload forgets it.
  forceProwl() {
    this._forceNight = this.active ? this.night + 1
      : this._sky ? this._sky.day : GRACE_NIGHTS;
  }

  update(dt, sky) {
    this._sky = sky;
    const t = sky.time;
    // which night this clock belongs to: the night beginning at day N's dusk
    // runs t in [0.5, 1); after the wrap (early morning) it's day N+1's
    // calendar but still night N's dark tail
    const nightIdx = t >= 0.5 ? sky.day : sky.day - 1;
    const night = sky.lightLevel < NIGHT_LIGHT;

    if (!this.active) {
      // the dusk cue: the horn and the line, once, as the last light goes
      if (t >= CUE_TIME && t < BEGIN_TIME && this.cuedNight !== nightIdx &&
          this.nightPlan(nightIdx).prowls) {
        this.cuedNight = nightIdx;
        this.onHorn?.();
        this.onAnnounce?.("The dark is getting up off its knees tonight. Keep to your light.", 4200);
      }
      // the siege begins — or RESUMES, when a reload lands mid-night on a
      // prowling night (the seeded plan is the only state that matters)
      if (t >= BEGIN_TIME && t < 1 && night && this.endedNight !== nightIdx &&
          this.nightPlan(nightIdx).prowls) {
        this._begin(nightIdx);
      }
    } else {
      if (this.player.dead) this.died = true;
      if (!night) {
        this._end();
      } else {
        this._spawnT -= dt;
        if (this._spawnT <= 0) {
          this._spawnT = SPAWN_EVERY;
          this.mobs.trySpawnProwler(this.world, this.player, this.terrain);
        }
      }
    }

    // the quiet morning: ~1 HP/s back to full, costing no hunger — the
    // Upturn's thanks for standing the whole night. Dying (or leaving
    // survival) forfeits whatever was left of it.
    if (this.quietT > 0) {
      if (this.player.dead || this.player.mode !== "survival") {
        this.quietT = 0;
      } else {
        this.quietT -= dt;
        this.player.health = Math.min(MAX_HEALTH, this.player.health + dt);
        if (this.player.health >= MAX_HEALTH) this.quietT = 0;
      }
    }
  }

  _begin(nightIdx) {
    this.active = true;
    this.night = nightIdx;
    this.died = false;
    this._spawnT = 0;
    if (this.cuedNight !== nightIdx) {
      // resumed from a reload past the dusk window: sound the horn now
      this.cuedNight = nightIdx;
      this.onHorn?.();
      this.onAnnounce?.("The dark is up and walking. Keep to your light.", 4200);
    }
  }

  _end() {
    this.active = false;
    this.endedNight = this.night;
    if (this._forceNight === this.night) this._forceNight = -1;
    this.onDawn?.();
    if (!this.died) {
      this.quietT = QUIET_SECONDS;
      this.onAnnounce?.("Dawn. The dark lies back down — and the quiet morning mends you.", 4200);
    } else {
      this.onAnnounce?.("Dawn. The dark lies back down.", 3600);
    }
  }
}

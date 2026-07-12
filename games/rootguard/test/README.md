# Rootguard test suite

## logic.test.js (node, pure rules)

Run: `node games/rootguard/test/logic.test.js`

- **Kits** — 6 plant defs (costs, cooldowns, dewblossom 24s production, thornshot
  1.4s/20dmg, frostfern 40%/3s chill, bulwarkroot 10x HP, burstcap bomb,
  sporelobber lob+splash) and 5 blight defs (helmed 2.5x HP, sprinter 2x speed
  0.6x HP, hulk 4x HP 0.6x speed 3x wall damage, small skitterer).
- **Level scripts** — 5 levels; level 1 unlocks only 3 plants; unlocks only grow;
  blight types introduced one per level in order; exactly one final mass wave per
  level, last in the script; level 5 outnumbers level 1 and packs skitterers 3-4
  to a lane.
- **Setup** — 50 starting dew, 5 armed surges, empty field, timed spawn queue.
- **Planting rules** — cost deduction, per-card cooldown start/expiry, one plant
  per cell, bounds, locked-card rejection, insufficient-dew rejection.
- **Shovel** — removes a plant, no refund, no-ops on empty cells.
- **Dew economy** — sky motes fall on the level timer and land; collection pays
  25 exactly once; uncollected motes fade after ~8s; dewblossoms bloom their
  first mote at ~12s then every 24s.
- **Lane-scan gate** — no target / wrong lane / behind-the-plant all hold fire;
  a blight ahead in-lane gets shot.
- **Projectiles** — straight shots strike the first (nearest) blight only.
- **Frostfern** — chill is 40% for 3s, measured on real movement, refresh-not-stack.
- **Chomping** — blights latch onto the plant ahead, stop moving, bite on the
  chomp cadence, destroy the plant at 0 HP, then walk on.
- **Hulk** — 3x chomp damage vs bulwarkroots (measured against a control).
- **Burstcap** — detonates on first contact, 3x3 kill zone, single use, spares
  blights outside the square.
- **Sporelobber** — lobs over a bulwarkroot untouched, hits the lead blight,
  splashes within 1 cell, spares beyond.
- **Helmet stages** — intact/cracked/gone at 2/3 and 1/3 HP; break event fires
  on threshold crossings.
- **Root surges** — first breach fires the lane surge (clears the lane, other
  lanes unaffected, game continues); second breach in that lane loses.
- **Win condition** — a defended level 1 playthrough spawns all 14 scripted
  blights and ends in a win; an undefended empty field is not a win.
- **FINAL SURGE banner** — fires once, ~4s before the final wave.
- **Per-pixel movement** — sub-cell per-tick steps at the stated cells/second.

## browser.test.mjs (headless Chrome over CDP, http:// AND file://)

Run: `node games/rootguard/test/browser.test.mjs`

Runs the identical feature suite over both URL schemes and asserts zero
non-favicon console errors/exceptions:

- **Boot** — title, classic-script globals, level-select overlay with 5 buttons
  (only level 1 unlocked), arcade back-link, sized canvas, controls footer.
- **Sound** — toggle via button click and M key; persists to
  `arcade.rootguard.audio`.
- **Level start** — real click on level 1; HUD dew 50, level name, tutorial
  seed bar (3 plants + shovel), wave-bar markers with the final flagged.
- **Seed cards** — unaffordable and cooling cards grey out (cooldown mask
  sweeps), un-grey when dew suffices; selection highlight; number keys and X
  select; Esc cancels.
- **Planting** — real card+cell clicks place the plant, deduct dew, start the
  cooldown; occupied cells reject without spending.
- **Shovel** — real clicks dig a plant up with no refund.
- **Dew motes** — real click on a mote pays 25 and removes it; unclicked motes
  fade; dewblossoms bloom motes beside themselves.
- **Pause** — P pauses/resumes with PAUSED overlay; window blur auto-pauses.
- **Mechanics** (exact-timing via the guarded `?rgtest` handle) — lane-scan
  gate, first-touch projectile hits, chomp-latched blights, frost chill cap,
  burstcap 3x3 single-use, sporelobber over-the-wall lob.
- **Win flow** — GROVE HELD overlay, progress persisted, next-level button
  starts level 2 with frostfern unlocked; L returns to a level select where
  level 2 is unlocked, level 3 locked, level 1 tagged cleared.
- **Level 5** — all 7 cards fielded.
- **Root surges + loss** — first breach spends the lane's surge and clears it;
  second breach shows the OVERRUN dead-styled overlay; any key replants
  instantly with dew/plants/surges reset.
- **FINAL SURGE banner** — real DOM banner flares before the last wave; the
  wave progress bar tracks time.
- **Persistence** — level progress survives a reload.

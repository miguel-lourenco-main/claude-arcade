# Delve tests

Run them with (from `games/delve/`):

    node test/logic.test.js      # headless core-rules tests, no browser needed
    node test/browser.test.mjs   # headless-Chrome feature tests (http:// AND file://)

## logic.test.js — core rules (133 assertions, no DOM)

- **dungeon generation (100 seeds, all depth configs)** — every non-wall tile is flood-fill reachable from the entry, stairs tiles are placed correctly, the down stairs are ≥ 22 walk-steps from the entry, and the entry is walkable.
- **recursive shadowcasting** — a pillar casts a shadow behind itself while off-line tiles stay lit, a solid wall fully blocks the far side, the radius limit is respected, and Bresenham LOS is blocked/clear as expected.
- **pathfinding** — A* finds a contiguous walkable path through a gap, ends at the goal, returns null when sealed off; the greedy fallback steps toward the target.
- **energy/speed scheduling** — exact action ratios against an agi-0 (speed-100) player: a speed-150 skitterlimb acts 150x, a speed-90 murkling 90x, a speed-100 wight 100x and a speed-75 stalkid 75x per 100 player turns; a hasted player fits 90 turns into 60 monster turns.
- **agility: player speed scales with agi** — base agi 1 gives speed 105, agi 3 gives 115 (115 player turns to exactly 100 speed-100 acts and 90 murkling acts), haste multiplies by 1.5 with rounding.
- **bump combat, XP and level-ups** — bump-attacking kills an adjacent monster, kills and XP are counted, and level-ups trigger at the threshold with +5 max HP, bank a stat point, and grant **no** automatic acc/eva/dmg.
- **level-up stat choice: applyStat** — refuses with no pending point, rejects unknown names, and applies vigor (+6 max HP & HP), might (+1 dmg), agility (+1 agi, +5 speed) and focus (+1 acc), each spending exactly one point.
- **floor-scaled monster stats** — the same monster type spawns with more HP and XP value on deeper floors.
- **AI: craven flees below 25% HP** — a wounded craven whelp increases its distance from the player.
- **AI: gallspitter keeps distance and attacks at range** — the player takes damage without the spitter ever closing to melee.
- **AI: idle until seen or heard** — a monster behind a wall stays idle; noise wakes it toward the noise source.
- **AI: sleep state and wake rules** — a sleeper in plain sight never moves or notices the player; noise wakes it toward the sound; the player standing adjacent wakes it (the wake costs its turn — no attack that tick); attacking a sleeper alerts it.
- **AI: hunt patience decays into search, then idle** — patience initializes to sight+6, drains while hunting blind, decays into a search around the last known position and then idle; line of sight pins patience at full.
- **veil: monster sight capped at 2 while veiled** — a veiled player at distance goes unnoticed, the veil ticks down each turn, a monster within 2 tiles still sees, and expiry is reported.
- **pebble: thrown lure** — throwing consumes the pebble and a turn, idle monsters investigate the landing spot, hunters that cannot see the player retarget to it, flight stops before the first wall, and throwing with no pebble costs nothing.
- **out-of-combat regen** — +1 HP every 6 quiet turns; any monster in sight (even a sleeping one) blocks it; the mosskeeper charm halves the interval to 3.
- **elderbark salve** — +2 HP per turn for 6 turns starting on the application turn; taking any damage spoils it (and says so).
- **pearl-dew elixir and scroll of dimming** — the elixir heals to full; the veil scroll grants 12 turns (first ticks on the cast turn).
- **trinkets: slot, swap, and every effect** — trinkets equip into their own slot and swap back to the satchel; keen-eye +1 acc, strider's anklet +1 agi (feeding speed and `floor(agi/2)` evasion), barrow-hide +1 armor via `armorOf`, vigorstone +10 max HP on equip and clamped removal on unequip.
- **spawn budget and sleep fraction (100 seeds)** — floor 1 spawns 4-5 monsters on every seed, ~40% of spawns start asleep, and both floor-9 artifact wardens always spawn awake.
- **map memory: unseen / remembered / visible** — after walking, all three tile states coexist and the visible set is bounded by the FOV radius.
- **serialization: exact resume** — serialize → load → serialize is byte-identical and the resumed game plays out identically (same RNG dice).
- **serialization: v2 fields** — agi/veil/salve/pendingStat/trinket and monster sleep/search/patience round-trip byte-identically, v1 saves are rejected (SAVE_VERSION 2), and missing fields in a doctored save are defaulted defensively.
- **persistent floors on ascend/descend** — revisiting a floor keeps its map memory, monsters and items, and the player arrives on the matching stairs.
- **full playthrough** — a god-mode bot descends all nine floors, auto-spends every banked boon point round-robin, finds the artifact on floor 9 and wins by taking it; descend events fire and all floors are retained.
- **death is fatal and reported** — the player dies, the cause is recorded, and no actions are accepted afterward.
- **monster pools respect depth gates** — no old-sky horrors on floor 1, horrors present on floor 9, every depth has a pool.

## browser.test.mjs — real-browser features (65 assertions x http:// and file://, + console check)

Spawns its own static http server, launches headless Chrome via CDP, and runs
the full suite twice — once over http:// and once over file:// (the way the
arcade is actually played). Each line below is asserted on **both** origins.

- **script loading** — the classic-script namespace (`Delve`) is present, i.e. the game boots without ES modules.
- **new run boot** — the title overlay shows on load, "Enter — new delve" starts a run in play mode, the overlay hides, and the sidebar reads depth 1 / 9.
- **message log updates** — the opening messages render into the log; later, kill/pickup/resume messages are asserted as they happen.
- **movement** — a real ArrowKey press and a real WASD press each move the player to the expected tile, and moving consumes a turn.
- **wait** — `.` consumes a turn without moving.
- **bump attack** — moving into an adjacent monster attacks and kills it; the kill is counted and logged.
- **pickup** — `g` takes the item underfoot into the satchel and logs it.
- **inventory open/use** — `i` opens the satchel and lists the item; pressing its number quaffs the potion (HP goes up, itemsUsed increments) and closes the satchel.
- **equip** — selecting a weapon in the satchel wields it and the sidebar updates.
- **drop** — `d` switches the satchel to drop mode and the dropped item lands on the player's tile.
- **Esc** — Escape closes the satchel.
- **FOV reveal states** — after reading a surveyor scroll, visible / remembered / unseen tiles all coexist and visible tiles stay bounded by the FOV radius.
- **log scroll-hold + pip** — the log auto-scrolls while the reader is at the bottom; scrolled up, it holds its place when new messages arrive and shows a "new" pip; clicking the pip jumps to the bottom and clears it.
- **level-up boon overlay** — a pending stat point opens the overlay, game input is blocked while it is up, and picking might grants +1 damage and closes it.
- **pebble aim mode** — `t` with a pebble shows the aim prompt, Escape cancels keeping the pebble, and a direction key throws it (consuming the pebble and one turn).
- **HUD badges** — the sidebar shows the agility stat, and active salve/veil render as ✚n / ◐n badges in the effects line.
- **trinket equip** — selecting a trinket in the satchel equips it into the charm slot and the sidebar updates.
- **descend stairs + auto-save** — `>` on the down stairs goes to floor 2, the sidebar updates, and `arcade.delve.save` is written.
- **ascend + floor persistence** — `<` climbs back to floor 1 (arriving on its down stairs), `>` descends again.
- **reload resumes run** — after a page reload the continue button appears; clicking it resumes the exact run (depth, turn and seed match) and logs the resume message.
- **death deletes save + death screen** — a lethal monster kills the player: the end overlay shows "You died", the save is deleted, and lifetime records are bumped.
- **R restart** — `r` on the death screen starts a fresh run (turn 0, depth 1) and hides the overlay.
- **audio toggle** — the sound button flips the label and persists to `arcade.delve.audio`; `m` flips it back.
- **console cleanliness** — zero non-favicon console errors, page exceptions or error log entries across both origins.

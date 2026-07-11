# Delve tests

Run them with (from `games/delve/`):

    node test/logic.test.js      # headless core-rules tests, no browser needed
    node test/browser.test.mjs   # headless-Chrome feature tests (http:// AND file://)

## logic.test.js — core rules (69 assertions, no DOM)

- **dungeon generation (100 seeds, all depth configs)** — every non-wall tile is flood-fill reachable from the entry, stairs tiles are placed correctly, the down stairs are ≥ 22 walk-steps from the entry, and the entry is walkable.
- **recursive shadowcasting** — a pillar casts a shadow behind itself while off-line tiles stay lit, a solid wall fully blocks the far side, the radius limit is respected, and Bresenham LOS is blocked/clear as expected.
- **pathfinding** — A* finds a contiguous walkable path through a gap, ends at the goal, returns null when sealed off; the greedy fallback steps toward the target.
- **energy/speed scheduling** — exact action ratios: a speed-150 monster acts 150x and a speed-75 monster 75x per 100 player turns; a hasted player fits 90 turns into 60 monster turns.
- **bump combat, XP and level-ups** — bump-attacking kills an adjacent monster, kills and XP are counted, and level-ups trigger at the threshold with +5 max HP.
- **floor-scaled monster stats** — the same monster type spawns with more HP and XP value on deeper floors.
- **AI: craven flees below 25% HP** — a wounded craven whelp increases its distance from the player.
- **AI: gallspitter keeps distance and attacks at range** — the player takes damage without the spitter ever closing to melee.
- **AI: idle until seen or heard** — a monster behind a wall stays idle; noise wakes it toward the noise source.
- **map memory: unseen / remembered / visible** — after walking, all three tile states coexist and the visible set is bounded by the FOV radius.
- **serialization: exact resume** — serialize → load → serialize is byte-identical and the resumed game plays out identically (same RNG dice).
- **persistent floors on ascend/descend** — revisiting a floor keeps its map memory, monsters and items, and the player arrives on the matching stairs.
- **full playthrough** — a god-mode bot descends all nine floors, finds the artifact on floor 9 and wins by taking it; descend events fire and all floors are retained.
- **death is fatal and reported** — the player dies, the cause is recorded, and no actions are accepted afterward.
- **monster pools respect depth gates** — no old-sky horrors on floor 1, horrors present on floor 9, every depth has a pool.

## browser.test.mjs — real-browser features (49 assertions x http:// and file://, + console check)

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
- **descend stairs + auto-save** — `>` on the down stairs goes to floor 2, the sidebar updates, and `arcade.delve.save` is written.
- **ascend + floor persistence** — `<` climbs back to floor 1 (arriving on its down stairs), `>` descends again.
- **reload resumes run** — after a page reload the continue button appears; clicking it resumes the exact run (depth, turn and seed match) and logs the resume message.
- **death deletes save + death screen** — a lethal monster kills the player: the end overlay shows "You died", the save is deleted, and lifetime records are bumped.
- **R restart** — `r` on the death screen starts a fresh run (turn 0, depth 1) and hides the overlay.
- **audio toggle** — the sound button flips the label and persists to `arcade.delve.audio`; `m` flips it back.
- **console cleanliness** — zero non-favicon console errors, page exceptions or error log entries across both origins.

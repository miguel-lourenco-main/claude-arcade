# Gloamkeep tests

Run them all (no dependencies, node + `/usr/bin/google-chrome` only):

```
node games/gloamkeep/test/logic.test.js
node games/gloamkeep/test/engine.test.mjs
node games/gloamkeep/test/browser.test.mjs
```

## logic.test.js — core rules, plain `node:assert`, no DOM

- namespace exposes the full logic API — the classic-script (file://-safe) conversion publishes everything on `globalThis.Gloamkeep`
- all three maps parse and are fully reachable — map parser + progressive key/door BFS validator
- new game starts with full vigor, 24 shots, no keys — initial loadout
- WASD-style movement advances the player — forward input moves the player
- collision slides along walls instead of sticking — per-axis circle-vs-grid resolution
- firing consumes ammo and respects the cooldown — fire rate gating
- out of ammo: dry fire event, no negative ammo — dry-fire path
- hitscan damages the first enemy on the center ray — weapon ray vs enemy circle
- kills award points and are counted — scoring + kill tally
- use opens an unlocked door; door animates open then auto-closes — full door state machine
- locked door refuses without its key, opens with it — sigil-key gating + HUD message text
- closed door blocks rays, open door lets them through — doors in the shared DDA raycast
- key pickup sets the matching sigil — key items
- health/ammo/shard pickups apply their effects and caps — pickup effects
- secret push-wall: +250 score, secret counted, wall slides away — push-wall secret flow
- damage flow: player hurt, then dies at 0 hp and the game stops — damage + death
- using the exit completes the level with a +500 bonus — level exit
- carry between floors keeps hp/ammo/score but not keys — level-to-level carry rules
- simulation is deterministic for a given seed — seeded-RNG fixed-timestep determinism
- gunshots alert enemies within hearing path-distance — noise propagation AI

## engine.test.mjs — the original deep engine suite (adapted to the namespace)

Covers map validity/reachability for all floors, raycast geometry (axis hits,
sides, texU, diagonals), door ray behaviour, sliding collision, hitscan/combat
events and cooldowns, dry fire, door use/auto-close/locked flows, push-wall
mechanics, enemy AI (shot alerting, chase, melee, ranged bolts), pickups,
death/level-complete flows, carry + determinism, and a raycast performance
smoke test.

## browser.test.mjs — headless Chrome, real page, real inputs

Spawns its own static http server and drives Chrome over CDP. The same
scenario runs twice — once over `http://` and once over `file://` (the way
the arcade is actually played), and the `file://` pass additionally denies
pointer lock to simulate the Chrome configs where it is unavailable. Each run
asserts, one feature at a time:

- boot: title overlay shows, phase is `title`, zero console errors so far
- start: clicking "Enter the keep" begins play and shows the HUD
- WASD movement: a real `W` keypress moves the player
- collision slide: walking aslant into a wall slides along it without clipping
- keyboard look fallback: `←` turns the view with pointer lock absent/denied
- fire + ammo: `Space` spends a shot and the HUD ammo count updates
- door open: `E` in front of an unlocked door opens it
- locked door: `E` refuses with the "Sealed by the crimson sigil." message
- key pickup: walking over the key sets it, lights the HUD gem, then the same door opens
- minimap toggle: `M` hides and re-shows the minimap
- audio toggle: `N` flips the sound button label and persists `arcade.gloamkeep.sound`
- pause on blur: a window `blur` pauses; the Resume button resumes
- damage flow: losing vigor updates the HUD health readout
- scoring: an ember shard adds +100 and the HUD score updates
- level exit: `E` on the way-sigil shows the tally; Continue starts floor 2 with the score carried
- game over + instant restart: death shows the demise overlay; `R` restarts the floor with its starting loadout
- high score persistence: the best lands in `arcade.gloamkeep.high` and survives a page reload onto the title screen
- console hygiene: zero non-favicon console errors/exceptions across the whole run

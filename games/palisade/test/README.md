# Palisade tests

Run from the repo root (or any directory — paths are file-relative):

```
node games/palisade/test/logic.test.js     # headless engine suite (node only)
node games/palisade/test/browser.test.mjs  # headless Chrome, http:// AND file://
```

## logic.test.js / engine.test.js

`logic.test.js` is the entry point; it runs the full engine suite in
`engine.test.js` (308 asserts). One line per covered feature:

- Map/path geometry: every map's paths have real length, `posAt` interpolates and clamps past the end.
- Placement rules: path, water, out-of-bounds and occupied cells are unbuildable; open grass is buildable.
- Tower economy: placing deducts cost, placement refused when broke, no tower stacking.
- Upgrades: cost table, 2-level cap, invested-gold tracking.
- Selling: 70% refund of invested gold, cell freed for rebuilding.
- Targeting: mode cycles first → last → nearest → strongest → first, and each mode picks the right creep (greatest s / least s / euclidean-nearest / most HP).
- Wave flow: early call pays gold and starts the wave, cannot call mid-wave, intermission auto-launches, wave-clear bonus paid.
- Leaks and loss: leaked creeps cost lives (hulks 2), zero lives ends the game with a lose event.
- Combat: towers fire, creeps die, bounties paid, wave 1 is holdable with 8 arrows.
- Projectiles: homing, retarget of the nearest creep when the target dies, fizzle when nothing is near.
- Frost: instant hit (no projectile), slow applied, repeat hits extend the slow duration, slow factor never stacks.
- Poison: DoT applied on hit and keeps ticking damage afterwards.
- Mortar: shell explodes and splash damages multiple clumped creeps.
- Regen creeps heal while hurt; Pincer alternates spawns across both entry paths.
- Scaling: creep HP grows with wave index.
- Full game: a carpeted map wins all 20 waves and the win event carries the lives bonus.
- Determinism: two identical games tick to identical state.

## browser.test.mjs

Self-contained headless-Chrome CDP test (no npm deps). It spawns its own local
http server, then runs the identical feature walkthrough twice — once over
http:// and once over file:// — clicking real buttons and sending real
keys/mouse events. One line per covered README feature:

- Map select: 3 map cards render; clicking one starts that map.
- Tower place: shop button arms placement, canvas click builds and deducts gold; Esc cancels placement.
- Tower select/inspect: clicking a placed tower opens the inspector.
- Targeting cycle: the inspector button and the T key both advance the mode.
- Tower upgrade: inspector upgrade button raises level and deducts gold.
- Tower sell: inspector sell button refunds 70% and hides the inspector.
- Wave start + early call: call-wave button launches the wave, pays the early-call bonus, and disables during the wave.
- Fast forward: F toggles 2× (button label changes).
- Pause: P shows the pause overlay, the resume button hides it.
- Blur pause: window blur auto-pauses, focus resumes.
- Loss flow: a leak at 1 life shows "THE PALISADE FELL"; restart resets to 20 lives.
- Win flow: clearing the final wave shows "THE PALISADE HELD" with the new-best flag.
- Best persistence: `arcade.palisade.best.0` is written and surfaces on the map card.
- Audio toggle: the button flips ♪ on/off and persists `arcade.palisade.audio`.
- Console cleanliness: zero non-favicon console errors/exceptions on BOTH http:// and file://.

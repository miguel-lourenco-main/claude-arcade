# Mothlight tests

Run: `node test/logic.test.js` and `node test/browser.test.mjs` (needs
`/usr/bin/google-chrome`; no npm deps). Both exit 0 on pass.

## logic.test.js — pure logic (node, via `logic.js`)

- `clamp clamps below, inside, above` — utility clamp.
- `lerp hits both endpoints and the midpoint` — utility lerp.
- `constants are self-consistent with the README` — every number the README promises (480×720, moth x, -470 flap, 1750 gravity, 640 terminal, 156 scroll, 236 spacing, 9 px hitbox, 30 px chains, 120 Hz).
- `fall integrates gravity per fixed step` — README: "constant 1750 px/s² gravity".
- `fall caps at terminal velocity` — README: "falls capped at 640 px/s".
- `a flap-then-fall arc returns to flap speed symmetrically` — flap impulse physics.
- `chainGapY stays inside the safe band for all r` — README: gap centers "clear of the ceiling and the ground".
- `chainGapY never steps more than GAP_MAX_STEP from the previous gap` — README: "random within a safe band".
- `every random layout is reachable: full-effort climb beats GAP_MAX_STEP` — the README's reachability claim, verified by simulating optimal flapping between two chains.
- `inChainBand matches the 30px chain + 9px moth widths exactly` — README: "chains collide as 30 px-wide rectangles".
- `hitsChain: centered in the gap is safe, edges are exact` — README: "9 px-radius circle" collision, exact edge behavior.
- `forgiving hitbox: the safe opening is much taller than the moth` — README: "forgiving hitbox".
- `passedGap fires exactly at the center-line crossing` — README: "a point is awarded the exact tick the moth's x crosses a gap's vertical center-line".
- `a chain scrolling past the moth scores exactly once` — README: "each lantern-chain you pass scores 1 point".
- `tiltTarget spans TILT_UP at flap speed to TILT_DOWN at terminal` — README: rotation driven by vy.
- `tiltTarget is monotonic in vy (eases into the nose-dive)` — README: "eases into a nose-dive".

## browser.test.mjs — headless Chrome over CDP, run twice: http:// AND file://

Each line below is asserted in both environments; the whole run also asserts
zero non-favicon console errors / uncaught exceptions.

- boots to the title screen; score starts at 0 — title state.
- logic.js loaded and shared — dual-environment logic file works in-browser.
- back-to-arcade link present — arcade chrome.
- sound button starts "sound: on"; M toggles it off; preference persists to `arcade.mothlight.audio`; clicking the button toggles back; the click does not start the game — README: "M — toggle sound" + persistence.
- Space starts a run with an upward flap; lantern-chains are spawned — README: "Space … flap" / start.
- canvas click, ArrowUp, W, and touch each flap; vy jumps from +620 to negative — README: full control list + "flap sets velocity … never adds".
- P pauses and resumes; any key resumes; window blur auto-pauses; click resumes — README: "P — pause (also auto-pauses on window blur)".
- chains scroll left while the moth's x never changes — README: "world scrolls, moth doesn't".
- passing a lantern-chain scores 1 point, exactly once per chain, at the center-line crossing — README scoring rule.
- touching a lantern starts the dying tumble, which ends on the moss (y≈668) at game over — README: death + tumble.
- best score updates, is flagged "new best", persists to `arcade.mothlight.high` — README high-score rule.
- any key after game over restarts fresh at score 0; a click restarts too — README: "anything (after game over) — instant restart".
- ceiling clamps the moth without killing (y >= 14) — README: ceiling clamps, no death.
- falling to the moss ends the run; a worse run leaves the best untouched — README: "or the moss below".
- best score survives a page reload — README: "persists in localStorage".

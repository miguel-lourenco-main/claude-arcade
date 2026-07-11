# Crateshift tests

Run:

```
node games/crateshift/test/logic.test.js
node games/crateshift/test/browser.test.mjs   # needs /usr/bin/google-chrome
```

## logic.test.js — pure rules (plain Node, no browser; tests `logic.js` + `levels.js`)

- **the set ships exactly 21 levels** — README's "21 original levels" / the 63-star select header.
- **every level has a name and positive integer par/parPushes** — level metadata sanity.
- **every level has one worker and as many crates as pads (>= 1)** — maps are well-formed.
- **parPushes is at least the number of crates starting off their pads** — par metadata is plausible (and par >= parPushes).
- **every crate, pad, and the worker sit on interior floor; floor never touches the map edge** — flood-filled interior is closed.
- **parseLevel reads First Push exactly** — walls / pad / crate / worker / floor from the ASCII map.
- **'\*' parses as crate-on-pad and '+' as worker-on-pad** — the on-pad map variants.
- **static corner detection: non-target corners flagged, pads never** — the red dead-crate rule's data.
- **a plain step moves the worker and records one non-push history entry** — moves counter derives from history.
- **walking into a wall returns null and changes nothing** — blocked steps cost nothing.
- **pushing a crate onto its pad flags entered + solves the level** — push, goal glow cue, win condition.
- **a push against a wall beyond the crate is blocked** — pushes need a free cell beyond.
- **two crates in a row never budge** — the one-crate push rule.
- **pushing a crate into a non-target corner flags deadlocked** — the deadlock warning cue.
- **pushing a crate off its pad flags left** — the un-goal cue (pad-to-pad flags neither).
- **undo restores the worker, the pushed crate, and the counters** — single-step undo.
- **undo with an empty history returns null** — undo bottoms out safely.
- **undo walks the full history back to the start position** — full-history undo (README).
- **starsFor: 3 at/under par, 2 within 1.6x par, 1 otherwise** — the star thresholds (README).
- **BFS solver verifies par (move-optimal) on every tractable level** — 16/21 levels' `par` reproduced exactly by an independent solver (the 5 biggest exceed the state cap; Last Shift asserted `<= par` per its push-optimal par).
- **replaying a solver solution through logic.move wins at par with 3 stars** — end-to-end rules integration.

## browser.test.mjs — headless Chrome via CDP (no npm deps)

Runs the identical feature suite twice — once over a self-spawned local http
server and once via `file://` (the arcade's double-click path) — and fails on
any non-favicon console error or exception on either. Per run it asserts:

- **boots into the level-select view / 21 shift cards / ★ 0/63** — fresh-profile boot.
- **only shift 1 starts unlocked; locked cards hide their names** — the unlock gate.
- **the back link points at the arcade index** — arcade shell integration.
- **arrow keys move the select cursor / Enter on a locked shift refuses** — level-select browsing.
- **Enter starts the selected shift** — select → play flow.
- **HUD names the shift, 0 moves, par, best —** — HUD wiring.
- **canvas is sized and painted (non-blank pixels)** — procedural rendering actually draws.
- **ArrowUp steps / bump costs no move / U undoes / W moves / Z undoes** — arrows + WASD + both undo keys.
- **a crate pushed into a non-target corner is detected as dead** — the red-crate deadlock rule, via a real 7-move trip.
- **R restarts the shift to its layout** — restart.
- **push onto pad solves + SHIFT CLEAR overlay after the win delay** — win flow.
- **3 moves on par 1 scores a single star / overlay reports moves · pushes · par** — star tiers + overlay stats.
- **the finish is persisted as arcade.crateshift.best.0** — best persistence.
- **movement and undo are ignored after the win** — solved-state input freeze.
- **R on the win screen replays / a 1-move finish beats the old best, 3 stars, HUD best updates** — best-improvement path (caught a real stale-HUD bug).
- **Enter on the win screen starts shift 2** — win-screen Enter + finishing unlocks the next shift.
- **holding a direction repeats after the delay and stops at the wall** — hold-to-repeat (~200ms then ~110ms steps), via one held keydown.
- **undo walks the whole held run back** — full-history undo in the browser.
- **held directions are dropped when the window blurs** — the blur safety.
- **shift 2 solved at par (3 moves · 2 pushes) with 3 stars** — multi-crate win at par.
- **N advances / N refuses locked / P steps back** — next/previous navigation.
- **pushing a crate backed by another crate is blocked** — two-in-a-row rule live (Two Lanes).
- **Esc returns to the shift board / star total sums finishes / cards show stars + best / unlock states** — select-view progress display.
- **clicking an unlocked card starts that shift** — mouse path into a level.
- **M mutes + persists / clicking the sound button unmutes** — sound toggle by key and button.
- **star total, audio preference, cursor, and unlocks survive a reload** — `arcade.crateshift.*` persistence.
- **zero non-favicon console errors/exceptions** — clean console on http AND file://.

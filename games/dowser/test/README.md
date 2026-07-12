# Dowser tests

Run:

```
node games/dowser/test/logic.test.js
node games/dowser/test/browser.test.mjs   # needs /usr/bin/google-chrome
```

## logic.test.js — core rules (pure Node, no browser)

- **presets match the shipped difficulties** — Seedplot 9×9/10, Meadow 16×16/40, Longfield 30×16/99.
- **createBoard sizes every layer and starts clean** — flat arrays, zeroed counters, `burstAt = -1`.
- **first-click safety** — across 50 seeded boards, the first-dug cell and all 8 neighbors never hold a hollow.
- **seeding places exactly `hollows` hazards** — hazard layer sums to the preset count.
- **seeding clamps when the pool is smaller than `hollows`** — tiny boards don't over-place.
- **adjacency counts equal the true number of neighboring hollows** — every count cross-checked.
- **digging a zero-plot flood-fills every connected safe cell** — BFS covers the whole safe region.
- **numbered plots stop the flood fill** — a wall of numbers halts the fill.
- **digging a numbered plot reveals only that plot** — no spill from numbers.
- **digging a hollow returns -1 and records burstAt** — the loss signal.
- **re-digging a revealed plot is a no-op** — idempotent reveal.
- **a marker blocks digging that plot** — flagged cells can't be dug.
- **flood fill skips marked plots** — the fill never digs through a marker.
- **toggleFlag plants, pulls, and tracks flagCount** — HUD counter source of truth.
- **toggleFlag refuses revealed plots** — no flags on dug earth.
- **chord with matching flags digs the remaining neighbors** — the chord rule.
- **chord does nothing when flags don't match the number** — under- and over-flagged.
- **chord on a hidden or zero plot does nothing** — chord preconditions.
- **a mis-flagged chord bursts the hollow** — wrong flags make chording lethal.
- **win when every non-hollow plot is revealed; flags irrelevant** — the win condition.
- **full simulated game on a seeded 9×9 ends in a win** — end-to-end rules integration.

## browser.test.mjs — headless Chrome via CDP (no npm deps)

Runs the identical feature suite twice — once over a self-spawned local http
server and once via `file://` (the arcade's double-click path) — and fails on
any non-favicon console error or exception on either. Per run it asserts:

- **intro overlay is shown on load / 'Walk the field' dismisses it** — the Walk the field button starts a game.
- **game starts idle** — no clock, no seeds before the first dig.
- **key 1/2/3 select presets** — keyboard preset switching.
- **timer reads 0:00 before the first dig / clock started on first dig** — timer starts on the first dig.
- **first-click safety + 10 hollows seeded + flood fill opened a region** — real left-click on the canvas.
- **right-click plants a marker / HUD counter drops / marker blocks digging / right-click pulls it** — flag toggle + block.
- **chord: clicking a satisfied number digs its remaining neighbors** — real click on a flagged-up number.
- **R restarts with a fresh idle field** — real keypress.
- **blur pauses with a PAUSED banner / focus resumes** — the pause rule.
- **digging a hollow loses + A HOLLOW BURST banner** — loss flow with banner.
- **Enter restarts after a loss** — post-game restart key.
- **revealing every safe plot wins + THE FIELD IS CLEAR banner** — win flow with banner.
- **best time persisted to localStorage / shown in HUD / survives a reload** — best-time persistence (`arcade.dowser.best.*`).
- **three preset buttons set up 9×9/10, 16×16/40, 30×16/99** — real button clicks.
- **'new field' button resets to a fresh idle field** — new field button.
- **sound button toggles label + persists / M key toggles back** — sound toggle.
- **a tap digs / a long-press plants a marker** — real CDP touch events.
- **zero non-favicon console errors/exceptions** — clean console on http AND file://.

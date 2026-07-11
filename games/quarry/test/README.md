# Quarry tests

Run from the repo root (no npm deps needed):

```
node games/quarry/test/logic.test.js
node games/quarry/test/browser.test.mjs   # needs /usr/bin/google-chrome
```

## logic.test.js (+ harness.js)

`harness.js` loads the real, unmodified `game.js` into a `node:vm` sandbox with a
stub DOM, so every test below exercises the exact code the browser runs.

- **twelve pentominoes, five cells each, in every orientation** — piece data: 12 unique stones, 5 non-overlapping cells preserved by all 4 precomputed rotations.
- **bag randomizer deals every pentomino exactly once per bag** — shuffled-bag coverage over 5 consecutive bags.
- **queue preview keeps at least 3 upcoming stones** — the NEXT preview always has 3 valid stones queued.
- **gravity curve: 800ms at depth 1, faster each depth, 80ms floor** — the drop-speed formula.
- **piece falls one row per gravity interval** — piece fall driven through real fixed-timestep ticks.
- **lock delay: resting stone locks after 500ms, not before** — LOCK_MS timing.
- **successful move while resting resets the lock timer, max 12 times** — lock-delay resets and the LOCK_RESETS cap.
- **soft drop is faster and scores +1 per cell** — soft-drop speed (~10x) and scoring.
- **rotation cycles through 4 orientations** — clockwise and counter-clockwise turns.
- **wall kick: blocked rotation shifts the stone to a fitting offset** — the kick table rescues a wall-blocked rotation.
- **rotation fails (no state change) when no kick fits** — boxed-in rotation is rejected cleanly.
- **ghost piece marks the exact landing row** — ghostY is the lowest fitting row.
- **hard drop locks instantly and scores +2 per cell dropped** — hard-drop behavior and scoring.
- **stash stores the stone, swaps thereafter, once per drop** — the hold slot's full lifecycle.
- **completing a row starts a clear, scores 100 x depth, then collapses** — single seam clear end-to-end.
- **multi-seam scoring is superlinear and multiplied by depth** — 300/700/1600/4000 for 2–5 seams, x depth.
- **depth increases every 10 seams and gravity tightens** — level speedup.
- **DAS: held direction repeats after ~170ms, then every ~40ms** — auto-shift delay, repeat rate, and release.
- **pause freezes gravity and resume restores it** — the P key.
- **R during a run opens the confirm dialog instead of restarting** — NEW restart confirmation: dialog opens, run untouched, "Restart this run?" text and buttons shown.
- **confirm dialog freezes the game while open** — no gravity while the dialog is up.
- **Esc (and the KEEP DIGGING button) cancels and resumes the same run** — cancel paths keep score/piece/board.
- **Enter (and the RESTART button) confirms and starts a fresh run** — confirm paths reset the run.
- **held inputs are dropped when the dialog opens** — DAS/soft-drop can't stick under the dialog.
- **other keys neither confirm nor cancel the dialog** — only Enter/Esc/buttons operate it.
- **game-over restart stays instant (no dialog)** — nothing to lose after top-out.
- **game over only when a new stone cannot be placed at all** — top-out rule.
- **high score persists to localStorage arcade.quarry.high** — and lower scores don't overwrite it.
- **audio toggle flips and persists arcade.quarry.audio; M key works everywhere** — including while the confirm dialog is open.

## browser.test.mjs

Self-contained headless-Chrome CDP test (no npm deps). Spawns its own local http
server, then runs the full feature suite twice — once over `http://` and once over
`file://` — asserting **zero non-favicon console errors/exceptions** in both runs.
Every step uses real CDP key/mouse input against the live page:

- **boots to the title screen** — page loads, state is menu, overlay visible.
- **any key starts a game** — keypress starts a run, overlay hides, stone spawns.
- **piece falls under gravity** — the stone descends in real time.
- **rotation (with kicks available)** — ArrowUp/X rotate; a wall-blocked vertical I kicks off the wall.
- **soft drop scores +1 per cell** — holding ArrowDown scores.
- **hard drop locks instantly and scores +2 per cell** — Space locks the stone into the pit.
- **ghost piece marks the landing row** — ghostY is exactly the landing row.
- **stash (hold) slot, once per drop** — C stashes; a second stash is refused.
- **bag randomizer covers all 12 pentominoes** — one bag = 12 unique stones.
- **line clear + scoring** — a real hard drop completes a seam: clearing state, +100 x depth, row collapses.
- **DAS auto-repeat while a direction is held** — held ArrowLeft auto-repeats.
- **level speedup curve** — deeper levels fall faster, 80ms floor.
- **pause with P** — pauses, freezes gravity, resumes.
- **restart confirmation: R opens a dialog, does not restart** — dialog + buttons + "Restart this run?" text.
- **restart confirmation: game is paused while the dialog is open** — piece frozen under the dialog.
- **restart confirmation: Esc cancels and the run continues** — score survives.
- **restart confirmation: KEEP DIGGING button cancels** — real mouse click on the cancel button.
- **restart confirmation: Enter confirms and restarts** — fresh run.
- **restart confirmation: RESTART button confirms** — real mouse click on the confirm button.
- **game-over restart stays instant** — no dialog after top-out.
- **audio toggle (button + M key) persists arcade.quarry.audio** — SND button + M key, persisted.
- **high score persists across a reload** — arcade.quarry.high survives Page.reload and shows in the HUD.

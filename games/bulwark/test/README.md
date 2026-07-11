# Bulwark test suite

Run from the repo root (plain node, no dependencies):

```
node games/bulwark/test/logic.test.js
node games/bulwark/test/browser.test.mjs   # needs /usr/bin/google-chrome (or CHROME_BIN)
```

`harness.js` is shared plumbing: it loads the real `game.js` into a stubbed
DOM so the logic tests run in plain node without duplicating any game code.

## logic.test.js — mechanics, one line per test

- **fresh game starts with score 0, 3 lives, wave 1, 55 invaders** — SPACE on the attract screen starts a clean game with the overlay hidden.
- **fleet march: one full pass steps every invader 8px** — the one-invader-per-tick fleet emulation, including the rippling frame flip.
- **fleet drops one row and reverses at the right margin** — edge detection queues a 16px drop pass and flips direction.
- **speedup: pass length equals the alive count** — a 55-strong fleet steps every 55 ticks; thinned to 5 it steps every 5.
- **one bullet on screen** — a second SPACE while a bolt flies spawns nothing.
- **bullet kills an invader and scores by rank** — burrower pays 10, spry pays 30.
- **player bullet chews pixels out of a shield** — per-pixel mask erosion from below.
- **invader bomb chews pixels out of a shield** — same erosion from above.
- **invaders shoot** — bombs spawn unprompted and fall.
- **a bomb hit costs a life, then the cannon respawns** — death flash, lives 3 → 2, back to playing.
- **three deaths end the game; any key restarts after the guard** — GAME OVER overlay, restart-guard swallows instant keys, then any key starts fresh.
- **invasion: ranks reaching the cannon row is game over** — "the ranks broke through".
- **saucer crosses the top and pays a bonus when clipped** — bonus is one of 50/100/150/300, shown as a popup at the hit spot.
- **clearing the fleet advances the wave** — wavepause, then wave 2 arrives one row lower with a fresh 55.
- **extra cannon awarded at 1500 points, once** — lives 3 → 4, never twice.
- **high score persists to localStorage** — `arcade.bulwark.hiscore`, HUD best updated.
- **reset button mid-game** — fresh score/lives/wave/fleet immediately, high score untouched.
- **reset button works on the game-over screen** — same, from the GAME OVER overlay.
- **R key resets mid-game (and even while paused)** — reset also clears pause.
- **reset is a no-op on the attract screen** — nothing to reset yet.
- **P pauses and resumes; losing window focus auto-pauses** — world frozen while paused.
- **audio toggles via M and the header button, persisted** — `arcade.bulwark.audio`, button label tracks state.

## browser.test.mjs — real Chrome, real input

Runs the full user-facing feature list twice — once served over a local http
server it spawns itself, once via `file://` (the arcade's double-click path) —
using headless Chrome driven over raw CDP websockets. Real key events
(SPACE/arrows/A/P/R/M/any-key) and real button clicks (`reset`, `sound`)
drive every check:

- load to attract, SPACE starts a fresh game
- fleet march + drop/reverse at the margin
- P pause/resume with PAUSED overlay
- cannon movement (ArrowRight and A)
- fire + one-bullet limit
- invader bombs spawn and fall
- mystery saucer crossing + 50–300 bonus on a hit
- speedup as ranks thin (55-tick pass vs 6-tick pass)
- shield erosion from both player bolts and invader bombs
- wave advance with a fresh, lower fleet
- lives loss and GAME OVER at zero
- any-key restart after the guard
- reset button mid-game (fresh score/lives/wave, best kept) + R key reset
- high score persistence across a real page reload
- audio toggle via button and M key, persisted
- zero non-favicon console errors/exceptions on BOTH http and file://

# Fernfoot

A from-scratch side-scrolling run-and-jump platformer for the Claude Arcade. You are
the fernfoot, a small glade-sprite dashing through six handcrafted levels across two
worlds — sunlit fern glades and dim ruin caverns — collecting sparks, stomping
critters, and touching the waystone at the end of each level.

Everything here is original: the hero, the four critters, the emberseed and
gustfruit power-ups, the tiles, and the level layouts.

## Play

Open `index.html` in a browser (works from `file://`, no server needed) or serve the
arcade root over http.

## Features

- **Level select menu** — six levels with unlock progression; beating a level unlocks
  the next (persisted). Pick with arrows + Enter or click a card. Per-level best time
  is shown on each card and persists across reloads.
- **Momentum movement** — acceleration up to walk speed; hold **Shift** to run
  (~1.5x, slower acceleration); pressing the opposite direction skids with a harder
  brake and a dust puff; friction slows you when idle.
- **Variable jump height** — jump (**Z / Space / ↑ / W**) applies an impulse; gravity
  is reduced while rising with the button held; releasing early cuts upward speed.
  Tap = short hop, hold = full jump (clears 4 tiles; a running jump clears ~6 across).
- **Coyote time** — you can still jump ~90 ms after running off a ledge.
- **Jump buffering** — a jump pressed up to ~120 ms before landing fires on landing.
- **Stomping** — land on a critter's head to bounce (~70% jump impulse; hold jump to
  bounce higher) and defeat it. Side contact hurts you.
- **Two-stage health** — normally one hit is fatal. Carrying a power-up adds a stage:
  a hit drops you back to normal with a brief invulnerability flicker.
  - **Emberseed** — breaks cracked stone blocks by jumping into them from below.
  - **Gustfruit** — grants a mid-air double jump while held.
- **Tile world** — solid stone, one-way platforms (jump up through them, land on
  top, press **↓ + jump** to drop through), cracked blocks (some hide spark caches or
  a spare emberseed), spikes and pits (instant death), and moving platforms that
  carry you as you ride them.
- **Four critters** — the *plodder* walks and turns at walls and ledges; the *lunger*
  waits and dashes when you cross its row; the *spinner* flies a sine path and is
  stomp-immune; the *spitter* lobs arcing globs that die on terrain.
- **Sparks** — collect 100 for an extra life (chime + HUD flash). Cracked caches pay
  out bundles.
- **Checkpoints** — touch a checkpoint post to save a mid-level respawn point.
- **Waystone goal** — touch the glowing waystone to clear the level: a jingle plays
  and a tally screen shows sparks, time, best time and score, then offers the next
  level.
- **Lives, score, HUD** — 3 lives per run; deaths respawn at the checkpoint; running
  out shows a game-over screen with instant any-key restart. HUD tracks level, lives,
  sparks, score, time and current power.
- **Lead camera** — the view leads in the direction you face, lerped, clamped to the
  level, with vertical platform snapping so jump arcs don't jitter the view.
- **Fixed-timestep physics** — 120 Hz logic with an accumulator, rendered at rAF.
- **Sound** — procedural Web Audio synth SFX, gesture-gated; toggle with the sound
  button or **M**; the preference persists.
- **Pause** — **P** pauses/resumes; the game auto-pauses when the window loses focus;
  **Esc** returns to the level list.

## Controls

| Key | Action |
| --- | --- |
| ← → / A D | move |
| Shift | run |
| Z / Space / ↑ / W | jump (hold for a higher jump) |
| ↓ + jump | drop through one-way platforms |
| P | pause |
| M | sound on/off |
| Esc | back to level select |

## Persistence

`localStorage` keys: `arcade.fernfoot.audio`, `arcade.fernfoot.unlocked`,
`arcade.fernfoot.best.<level>`.

## Tests

- `node test/logic.test.js` — pure-logic suite (physics, tiles, critters, levels).
- `node test/browser.test.mjs` — headless-Chrome CDP suite over both `http://` and
  `file://`.

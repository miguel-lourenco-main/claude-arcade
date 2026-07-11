# Rootguard

A from-scratch lane-defense game for the Claude Arcade. Shambling **blights**
pour in from the right across a 5-lane, 9-column grove; you plant magical
flora to stop them, funded by **dew** motes you click to collect. Hold every
lane through the scripted waves and the final surge to win the level.

## Controls

- **Click a seed card**, then click a grid cell to plant (**1-6** also select
  cards, in card order)
- **Click dew motes** before they fade (~8s) to collect 25 dew each
- **X** — select the shovel; click a plant to dig it up (no refund)
- **Esc** — cancel the selected card, or pause; **right-click** also cancels
- **P** — pause / resume (auto-pauses when the window loses focus)
- **M** — toggle sound
- **R** — restart the current level
- **L** — back to level select
- **Any key** — instant replant after a loss; **Enter** advances after a win

## The economy

Everything is priced in dew. You start each level with 50. Dew motes fall
from the sky every ~9-11 seconds and are also grown by dewblossoms (one mote
every 24s). A mote fades ~8 seconds after landing, so keep clicking.

## The plant kit

| plant | cost | cooldown | role |
| --- | --- | --- | --- |
| Dewblossom | 50 | 7s | grows a dew mote every 24s |
| Thornshot | 100 | 7s | fires a 20-dmg thorn every 1.4s |
| Frostfern | 150 | 7s | thorns that also chill 40% for 3s (never stacks) |
| Bulwarkroot | 50 | 20s | no attack; a 10x-HP wall (3000 HP) |
| Burstcap | 125 | 25s | explodes 3x3 the moment a blight touches it — single use |
| Sporelobber | 175 | 7s | lobs spores over walls at the first blight; 1-cell splash |

One plant per cell. Each card has its own cooldown after planting and greys
out while cooling or unaffordable. Shooters hold fire until a blight is in
their lane **ahead of them** (lane-scan gate); straight shots strike the
first blight they touch.

## The blight kit

| blight | HP | speed | quirk |
| --- | --- | --- | --- |
| Shambler | 200 | 1x | the baseline |
| Helmed Shambler | 500 (2.5x) | 1x | helmet visibly cracks, then shatters, at HP thresholds |
| Sprinter | 120 (0.6x) | 2x | fast and fragile |
| Hulk | 800 (4x) | 0.6x | crushes bulwarkroots at 3x damage |
| Skitterer | 100 (0.5x) | 1.35x | small; arrives in packs of 3-4 |

Blights walk per-pixel (no tile hopping) and **stop to chomp** any plant in
their path until it is destroyed.

## The last-ditch guard

Each lane has a one-use **root surge** at the far left (the glowing teal
runes). A blight that breaches the left edge triggers its lane's surge,
clearing that lane once — the rune goes dark and cracked. A **second breach
in the same lane loses the level**. Surges reset every level.

## Levels

Five scripted levels ramp the difficulty, introducing one new blight type at
a time (level 1 is a gentle tutorial with only shamblers and 3 plant types;
frostfern, burstcap and sporelobber unlock along the way). The wave bar above
the field shows wave markers (the red one is the last wave) and a **FINAL
SURGE** banner precedes the closing horde. You win when the last blight
falls. Cleared levels unlock the next; progress persists in `localStorage`
under `arcade.rootguard.progress`.

## Architecture

Vanilla JS, no dependencies, no build step, classic `<script>` tags. All
rules live in `logic.js` (dual-environment: `window.RootguardLogic` in the
browser, `module.exports` under node, so the node test suite runs the exact
game rules); everything DOM/canvas/audio lives in `game.js`.

- **Fixed-timestep logic** — the accumulator pattern drives 60 simulation
  ticks per second; rendering runs at display rate.
- **Procedural art** — all plants, blights, motes and runes are drawn with
  canvas primitives; chomp/pop/explosion particles, screen shake, lane
  flashes, and per-lane striping keep the field readable.
- **Web Audio synth** — planting thunk, thorn pips, chomps, helmet clinks,
  explosions, surge whoosh, mote chimes, win/lose stings. The AudioContext
  is created only after a user gesture; the toggle persists under
  `arcade.rootguard.audio`.

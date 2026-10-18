# The Upturn arc (DRAFT PROPOSAL)

> **Status: a draft for the owner's voice. Nothing here is canon.**
> This is the C1 writing gate (#13). It proposes a playable arc built on
> [LORE.md](LORE.md), so cities (C2's deferred half) and story quests (C3
> phase 2) have something to hang on. No code reads this file. The only
> engineering it constrains are the reserved hooks listed at the end.
> Rewrite freely; where there's a choice, the options are laid out rather
> than decided.

## The central tension: the Long Settling

The world turned over, and that is in every entry of LORE.md. What the
lore doesn't say yet is that **the turn isn't finished**. Everything since
has been the world *settling*, the way a house creaks for years after a
move. Every strange thing in the Upturn is something that hasn't settled:

- **The dark** lost its sky. Most shadows dispersed politely; the
  murklings are what's left, and the Prowl is the dark remembering. **The
  Unshaken** is the one shadow that wouldn't let go of its owner, so it
  never settled at all.
- **The sea** lost its floor. It hangs overhead as the night and grips
  from below as **the Undertow**. The Undersky is the half of the turn
  that never landed.
- **The sky** keeps giving back what it took. The Pearlfall is the sky
  settling its debts one pearl at a time ("the sky is done hurting
  people").

What drives the player is that **Wanderlings are the only folk who move
between all three**. Steadfolk stay put (they stopped wandering, which is
how their steads held). The dark and the sea can't cross the line. A
Wanderling with a satchel can carry things between the unsettled places,
and carrying things is how the Upturn settles.

*Tone check:* it stays cozy. Nobody has to save the world, because the
world is settling anyway. The question is how it settles and who helps.
That keeps danger polite and gives melancholy a reason: some things settle
by being let go.

## History: the Steads-Before → the Living Steads

- **Before the turn**, homesteads farmed (meal roots, bogbeans), dug (the
  Delvings-Under) and fished (the Sunken Steads). The Notice Posts were
  their newspapers.
- **In the turn**, most homesteads "came through the flip the way crockery
  comes through a move — mostly." The Steads-Before are the ones that
  didn't hold.
- **The ones that held** held because their folk *kept a hearth through
  the turn*: a fire lit and fed while the world went over. A hearth is a
  small, deliberate act of settling. Those folk stopped wandering and
  became the Steadfolk. Their steads are the Living Steads.
- **Why some grew into villages** (the C2 tiers): settled ground draws
  settled folk. Where the turn finished first, hearths gathered. This is
  the density field, in story terms.

**The meaning of the Unshaken** (proposal): it is the shadow of the first
Wanderling who *refused to let go* of the world before. Every other shadow
let go of its owner, but this one held on, and that is what made it a
shadow that stayed. Defeating it is not killing it; it finally lets go,
and the Dusk Pearl is what it was holding. (Alternative: keep it
anonymous, "the last shadow". Owner's call. The first version gives the
arc an emotional centre; the second keeps the lore lighter.)

## Why cities exist

A **city** is where enough hearths gathered that the ground around them
finished settling completely. Inside a city's ring the Prowl doesn't walk,
the Pearlfall lands gently, and the old world's leftovers are traded rather
than dug up. Cities are the arc's waypoints: places that are *done*, and
show the player what "settled" looks like.

### What must be seed-consistent (the anchors C2 needs)

| Aspect | Fixed per seed? | Why |
|---|---|---|
| How many cities | **fixed: three** | one per unsettled force (dark, sea, sky) |
| Where | **seeded**: one per ring band (~600 / ~1200 / ~1800 blocks from spawn), angle from the seed | the arc is a journey outward; every world's journey has the same shape |
| Name | **seeded** from a folk-name grammar (see below), so every copy of a world agrees | players compare notes |
| Landmark | **fixed per city type**: the Hearth (a great kiln that never goes out), the Tideward (a well that holds sea-water), the Pearlhouse (a roofless hall the Pearlfall lands in) | each is a story beat's stage |
| Layout | generated around the landmark from the dense-village builder | partly authored, mostly procedural (the issue's "partly hand-authored") |
| Residents | **seeded**, with one named keeper per city who gives the story errand | the dialogue hook needs a speaker |

Folk-name grammar (proposal): `[place-word][settling-word]`, e.g.
Kettlewick, Emberhold, Lowmoot, Brinekeep, Pearlrest, Starfold. The
place-word follows the city type and the settling-word comes from a short
seeded list.

## The beats (five; loose order, all optional)

The arc is a **spine of five beats over the open sandbox**. Nothing gates
the sandbox. Each beat is gated only by mechanics that already exist, so
the arc rides on what the game already teaches.

1. **The Notice Posts** *(onboarding; any time)*. The weathered Notice
   Post fragments in ruins and delvings are pages of one old notice: "a
   hearth was kept at ___". Reading three points the player to the nearest
   city. *Mechanics: existing ruin signs; adds a story errand "read the
   posts".*
2. **The Hearth** *(first city, the dark)*. Its keeper asks for help
   settling the dark: stand a Prowl, then raise the Murk Lantern and let
   the Unshaken go. Reward: the Hearth's standing, which spreads to
   nearby steads (this is where phase-2 "word travels" plugs in).
   *Mechanics: the Prowl, the Unshaken, standing.*
3. **The Tideward** *(second city, the sea)*. Its well holds sea-water
   that remembers the floor. The keeper sends the player through a Cinder
   Door to ring the Pearl Chime and bring the Tideheart home. Reward:
   Heartglass for the Tideward's walls, and the city's markets open
   (rare goods at its traders). *Mechanics: the Cinder Door, the Undertow,
   the kiln.*
4. **The errand of all errands** *(epic quest; the rare, very hard one)*.
   Settle a stead that is falling apart: a hostile stead brought all
   the way back to cherished by errands alone. Reward: the stead
   becomes a village (it grows a tier, which C2's tiers make possible).
   *Mechanics: standing, errands, settlement tiers.*
5. **The Pearlhouse** *(third city, the sky; the ending)*. The Fairday
   rockets already exist to "give the old sky a pearl back". The last beat
   is a Fairday at the Pearlhouse where the player returns the pearls
   they've gathered: starstone, the Dusk Pearl, nacre. *Mechanics:
   Festival Rockets, Fairday, the Pearlfall.*

## Linear or optional? (open question; a recommendation)

**Recommendation: a loose spine.** Beat 1 points at beat 2. Beats 2 and 3
can come in either order (the Undersky is reachable early for a bold
player). Beat 4 is optional and repeatable per stead. Beat 5 needs 2 and 3.
There is no failure state and no timer, and the sandbox never closes.

## Is there an ending? (open question; a recommendation)

**Recommendation: an ending that isn't a stop.** After the Pearlhouse
Fairday the world is **settled**: the Prowl stops walking, the Pearlfall
keeps falling, and nights go quiet and kind. A last Notice Post appears at
spawn in the player's own words. The game continues, because *the Upturn
settles, but Wanderlings don't*. The ending changes the world's mood, not
whether you can play in it.

Alternative endings to consider:
- **No ending**: the beats are just chapters, and the sandbox is the point.
- **A chosen ending**: at the Pearlhouse the player either returns the
  pearls (the world settles; the Prowl stops) or keeps them (the world
  stays restless, with richer Pearlfalls and harder nights). This maps
  onto the raider/friend fork B4 already built.

## Naming register (extensions, to be added to LORE.md once accepted)

- **The Long Settling**: the age since the turn.
- **Hearth-keeping**: what the Steadfolk did that the Steads-Before
  didn't.
- **A settled place / settled ground**: inside a city's ring.
- City types: **the Hearth**, **the Tideward**, **the Pearlhouse**.

## Reserved hooks (what the code already leaves room for)

- `settlements.js cityForCell()` returns null today and is asked first by
  every cell. It's where the three cities plug in, using the anchors
  table above. `TIERS.city` is reserved.
- `quests.js storyQuestFor() / epicQuestFor()` return null today and are
  asked first by `questFor()`. They're where beats 1–5 plug in.
  `KINDS.story/epic` are reserved and refused by the log until then.
- `quests.js dialogueFor()` takes greetings by standing band. Story
  speakers (city keepers) extend that table.
- `standing.js globalStanding()` is the aggregate beat 2's "word
  travels" would build on.

## Questions for the owner

1. Is the Long Settling the right central tension, or should the arc be
   about something else entirely (e.g. finding where the Wanderlings came
   from)?
2. The Unshaken: the first Wanderling's shadow, or kept anonymous?
3. Three cities, one per force: right number? Ring distances?
4. A loose spine, or stricter ordering?
5. Ending: settled-but-continuing, none, or a chosen one?
6. City names: the grammar above, or hand-named?

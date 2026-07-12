# Slipstream tests

Run them with:

```
node games/slipstream/test/logic.test.js
node games/slipstream/test/headless.mjs
node games/slipstream/test/browser.test.mjs   # needs /usr/bin/google-chrome
```

## logic.test.js — core rules (pure node, plain asserts)

- `track is deterministic for the same seed` — the seeded PRNG builds an identical course every run.
- `five stages with contiguous boundaries and time credits` — stage layout and per-stage clock grants.
- `traffic is seeded on the course` — 20+ cars, all within the race distance at sane speeds.
- `segAt clamps outside the track` — segment lookup never walks off either end.
- `throttle accelerates to max speed; countdown holds the clock` — acceleration + frozen clock while `running=false`.
- `coasting decays, braking stops, no reverse` — longitudinal physics.
- `steering moves playerX and is speed-scaled (none when stopped)` — lateral handling.
- `centrifugal pull pushes outward and scales with speed` — bend physics direction + magnitude.
- `off-road drags speed down to the limit; rumble zone flagged first` — shoulder rumble zone, then heavy off-road drag.
- `gears: five upshifts on a full pull, events emitted` — gear thresholds + gear events.
- `rear-ending traffic crashes: spin-out + hard slowdown + event` — collision handling.
- `clean overtake scores a pass; close fast pass whooshes` — overtake scoring + whoosh event.
- `checkpoint adds the next stage time and advances the stage` — checkpoint time credit.
- `clock at zero ends the race and the car coasts to a stop` — time-up game over.
- `finish computes results with time/pass/speed bonuses` — end-of-race scoring math.
- `autopilot completes the full designed course` — the shipped track is beatable within its clock.

## headless.mjs — original engine suite (kept, adapted to classic scripts)

Same engine coverage as above from the original author: track construction,
acceleration/coast/brake, centrifugal direction + scaling, off-road/rumble,
gear events, traffic collision/passes, checkpoint timer, full autopilot
race feasibility, and render-interpolation snapshots.

## browser.test.mjs — headless Chrome over CDP, run against BOTH a local http server and file://

Each feature below is asserted once per transport (http and file), and each
run also asserts **zero non-favicon console errors/exceptions**:

- `boots into attract mode` / `title overlay visible` — title/attract boot (README: title screen).
- `attract demo is driving` — the rAF loop and autopilot demo run.
- `traffic present on the course` — 20+ traffic cars in the sim (README: weave through traffic).
- `audio toggle button mutes + persists` / `M key toggles sound back on` — audio toggle via real click and real M key, persisted to `arcade.slipstream.sound`.
- `Enter starts the countdown` / `countdown ends and the race starts` — countdown flow via a real Enter key.
- `holding accelerate raises speed` — drive: speed rises under a held real ArrowUp.
- `steering right moves the car right` — steering moves player x under a held real ArrowRight.
- `off-road drags speed down to the limit` — off-road slowdown after steering onto the shoulder with real keys.
- `checkpoint credits time` / `checkpoint banner flashed` — checkpoint banner + time credit (test seam repositions the car near the stage boundary; the crossing itself is driven).
- `window blur pauses the race` / `P resumes from pause` — pause on blur + resume.
- `clock at zero ends the race` / `TIME UP overlay appears` / `any key restarts instantly` — time-up game over + instant restart.
- `best score persisted` / `high score survives a reload` — `arcade.slipstream.best` persistence across a page reload.
- `Esc returns to the title` — back-to-title key.

# Dustkart tests

## logic.test.js — `node test/logic.test.js` (pure logic, no browser)

- three circuits build, wrap-closed in height, segments contiguous — closed-loop segment arrays wrap cleanly.
- each circuit has item pads on calm road — pad placement.
- racing line stays on the road and cuts toward apexes — AI line precomputation.
- circuit shapes are distinct: hairpins and chicanes exist — the three designed layouts.
- minimap polyline is normalized and closes the loop — minimap geometry.
- segAt wraps in both directions — modulo segment lookup.
- throttle accelerates toward max, brake slows, coast decays — longitudinal handling.
- steering is scaled by speed — parked karts cannot steer.
- centrifugal force pulls outward through bends — cornering physics.
- off-road drags speed down hard — unless boosting — off-road rule.
- countdown beeps then GO, no press = clean start — 3-2-1 countdown events.
- accelerating inside the launch window grants a start boost — launch mechanic.
- jumping the gun bogs the kart down — bog penalty.
- holding drift while turning at speed starts a slide; charge builds tiers — drift state machine + 2 spark tiers.
- releasing the drift pays out a mini-boost scaled to the tier — 0.62s / 1.25s over-max boosts.
- steering against the drift cancels it without a boost — wrong-way cancel.
- dropping below the keep-speed cancels the drift — too-slow cancel.
- a drift cannot start below the minimum speed — drift entry gate.
- crossing the start/finish wraps position and counts the lap — lap counting + lap timing.
- progress = laps * length + z drives the live ranking — position ranking.
- item weights favor the leader weak / the last strong — position-weighted item tables.
- driving over an item pad grants an item and cools the pad down — pad pickup + ~4s respawn + one-item rule.
- sap slick drops behind and spins whoever runs it over — slick item.
- spin-out lasts ~1s then grants brief invulnerability — spin state.
- barkshield absorbs one hit — shield item.
- homing burr chases and spins the kart ahead — burr item homing.
- tangleroot snares every kart ahead — and nobody behind — tangleroot item.
- gust vial boosts straight over max speed — gust item.
- rubberbanding: mild capped bonus behind, penalty ahead — rubberband cap and sign.
- AI follows the racing line and manages corner speed — AI steering + braking.
- AI fires the burr when a kart is ahead in range — AI item heuristics.
- a full AI-only demo race completes laps without stalling — attract-mode feasibility.
- kart-vs-kart contact bumps them apart with speed loss for the rear — collision.
- player finishing 3 laps ends the race with a full results table — race end + results.

## browser.test.mjs — `node test/browser.test.mjs` (headless Chrome, http:// AND file://)

- boots into the circuit-select menu — page boots from both protocols.
- menu overlay lists 3 circuits — circuit select UI.
- attract demo race is running — background AI demo + rAF loop alive.
- canvas has rendered content — the renderer actually paints.
- audio toggle button mutes + persists / M key toggles — sound toggle, `arcade.dustkart.sound`.
- arrow keys move the circuit selection — menu navigation.
- Enter starts the countdown / overlay hides / selected circuit loaded — race start flow.
- accelerating in the window grants the start boost — countdown launch window with real keys.
- holding accelerate raises speed — driving.
- steering right moves the kart right — steering.
- off-road drags speed to the crawl limit — off-road slowdown.
- holding SHIFT while turning starts a drift / charge builds to tier 2 / release grants the boost — drift loop with real keys.
- driving over an item pad grants an item / pad cooldown — item pads.
- SPACE fires and empties the item box — item firing.
- slick spins the kart out / post-spin invulnerability — spin-out state.
- progress-based ranking puts the lap leader 1st — live position HUD source.
- crossing the start/finish counts the lap — lap counter.
- taking the flag on lap 3 ends the race / results table with player marked — race end + results overlay.
- circuit-best lap persisted — `arcade.dustkart.best.<circuit>`.
- Enter on the results screen restarts instantly — instant restart.
- Esc returns to the circuit select / menu shows the persisted best — navigation + persistence display.
- number key picks a circuit and starts the race — direct circuit hotkeys.
- window blur pauses the race / P resumes — pause on blur.
- sound + best lap survive a reload — localStorage persistence.
- zero non-favicon console errors/exceptions — clean console on http:// and file://.

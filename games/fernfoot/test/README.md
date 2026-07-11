# Fernfoot tests

## logic.test.js (node, pure rules)

- six levels are defined and parse — level data integrity (size, waystone, start, enemies, sparks)
- levels 2..6 have checkpoints; both themes used; later levels have movers — content progression requirements
- progression teaching: emberseed first appears level 3, gustfruit level 4 — mechanic-teaching order
- walking accelerates toward WALK_MAX and stops there — walk acceleration + cap
- running reaches ~1.5x walk speed with slower acceleration — Shift run tuning
- skid: opposite input brakes harder than friction and emits dust — skid mechanic + dust event
- friction stops the hero with no input — ground friction
- variable jump: held jump clears 4 tiles, tap is a short hop — variable jump height
- early release cuts upward velocity in half — jump release cut
- reduced gravity only while rising with jump held — ~55% hold gravity constant
- running jump clears ~6 tiles of horizontal distance — jump-arc tuning target
- coyote time: jump works ~90ms after leaving a ledge, not after — coyote window
- jump buffering: press up to ~120ms before landing executes on landing — input buffer
- stomp kills the enemy and bounces ~70% of jump impulse — stomp resolution + scoring
- holding jump during a stomp bounces higher — held stomp bounce
- side contact with an enemy hurts: empowered drops a stage, normal dies — two-stage health
- plodder turns at walls and at ledges — plodder AI
- lunger waits, then dashes when the hero is near on its row — lunger AI
- spinner flies a sine path and is stomp-immune — spinner AI + immunity
- spitter lobs arcing globs that die on terrain — spitter AI + glob lifecycle
- one-way platforms: jump up through, land on top, drop through with down+jump — one-way tiles
- cracked blocks: only an emberseed hero breaks them from below; caches pay out — cracked tiles + caches
- spikes and pits kill instantly even when empowered — instant-death hazards
- power-ups: emberseed and gustfruit set the stage; gustfruit grants a double jump — power-up pickups
- checkpoints save the respawn point; death respawns there with a life lost — checkpoints + lives
- game over after the last life; goal sets cleared — end states
- 100 sparks award an extra life with a 1up event — spark economy
- hero rides a moving platform (platform delta applied) — moving platforms
- camera leads the hero in the facing direction and clamps to the level — camera rules

## browser.test.mjs (headless Chrome CDP, runs over BOTH http:// and file://)

Per scheme (77 checks each): boot + title + classic-script loading; level-select menu
(6 cards, 5 locked, keyboard clamp, locked-card click ignored, Enter/click start);
sound toggle via button click and M key with localStorage persistence; HUD (level
name, lives, sparks, score); real-key walking, Shift-run, friction stop, Space jump,
landing; camera clamp; P pause + PAUSED overlay; variable jump (hold vs tap);
coyote time; jump buffering; stomp (kill, bounce, score); spark collection + HUD;
100-spark extra life; empowered hit drops stage with invulnerability; gustfruit
double jump; pit death, respawn cost, level-start respawn; game over + FALLEN overlay
+ any-key instant restart; waystone clear + tally screen + unlock + best-time
persistence; Enter to next level; one-way platform land + down+jump drop-through;
checkpoint respawn; cracked blocks (normal can't break, ember can, cache pays);
spitter globs spawn and die on terrain; moving platforms carry the hero; Esc to menu;
unlock shown in menu; clicking unlocked card; auto-pause on blur; persistence across
reload; zero non-favicon console errors.

Run:

    node games/fernfoot/test/logic.test.js
    node games/fernfoot/test/browser.test.mjs

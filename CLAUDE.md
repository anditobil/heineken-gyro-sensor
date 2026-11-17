# Sync Challenge (Heineken House) — project brief

A portrait browser game for a Heineken House activation. The player rolls a green
**Heineken can** down a fridge-style tower, dodging saws and collecting red stars. It is
controlled by a **Joy-Con on a real object** (WebHID), a **phone's tilt**, the **keyboard**, or
an **on-screen stick**.

It started as a rebuild of "CAN DROP" (green ZIROLU can, 3 levels, a DRINK meter). That
identity is **gone**: do not bring back ZIROLU, the drink meter, level select, wall text
signs or the old pink theme.

---

## 1. Rules

1. **No fake hardware.** Never feed random or simulated sensor values into gameplay. If no
   controller is connected, say so (menu status chip) and fall back to keyboard/touch.
2. **Report honestly.** The Joy-Con and phone input are *implemented, not yet tested on real
   hardware*. Synthetic data may check logic; say "verified with synthetic data only".
3. **Brand files are supplied, never drawn.** Logos, labels and illustrations come from
   `public/brand/` (see its README). Missing files fall back to neutral placeholders.
   Do not redraw brand marks in code.
4. **Language.** The user writes Indonesian; reply in Indonesian. Code, comments and all
   in-game text are English.
5. **Stack.** Three.js `^0.187`, vanilla ES modules, Vite `^8`, GSAP `^3` (UI animation),
   `joy-con-webhid ^0.11`. No frameworks, no TypeScript. Sounds are Web Audio only.
6. The user tunes values by hand (e.g. neon intensities). If a value in a file differs from
   what you set earlier, treat the file as the truth and don't revert it.

Commands:

```bash
npm install
npm run dev          # Vite dev server
npm run build        # must be clean
npm run test:sensor  # node tests for the motion pipeline (synthetic data)
```

Deploy only when asked (Vercel works out of the box: `npx vercel@latest deploy --prod --yes`).
HTTPS is required for WebHID and DeviceMotion.

---

## 2. Game flow

| Screen | What it is |
|---|---|
| **Menu** | Heineken House logo, "READY TO PLAY?", Sync Challenge logo, **READY** button, small controller status chip. No 3D behind it. **F1** opens Controller Setup (hidden shortcut). |
| **Tutorial** ("How to play") | Game in a framed **box** at the top; under it the **hands holding a board** (mirrors the controller: tilts with input, mini can slides with the real can); caption "COLLECT THE STARS AND KEEP THE GOOD TIMES ROLLING!". One full-width board, can in the middle, a red star at each end. Collect both → countdown starts automatically. **Esc** = back home. |
| **Gameplay** | **Full screen** (no box, no hands). Level 2 "Saw Tower". HUD top-left: timer · ★ n/5 · 5 hearts. 3-2-1-GO countdown. Esc/P pause, R restart. |
| **Success** | Box returns with a green glow: "YOU MADE IT! / PERFECTLY IN SYNC." + stars collected; below "CHEERS TO GREAT TEAM WORK" with clinking cans; **BACK TO HOME**. |
| **Fail** (lives = 0) | Red glow "NOT QUITE IN SYNC!", "SO CLOSE! FIND YOUR RHYTHM AND GIVE IT ANOTHER GO.", **TRY AGAIN** (restarts the level). |
| **Pause** | Resume, Restart, Controller Setup, Back to home. |

Rules of play:
- **5 lives**; each saw hit costs one (invulnerable 1.2 s after a hit). Lives 0 → fail.
- Goal: land on the checkered goal shelf.
- **5 red stars** in the level are optional; 200 points each.
- Score (saved, not shown): lives × 300 + time bonus `max(0, (par×1.6 − t)×40)` + clean run 1000 + stars × 200.
- The old "drink" resource no longer limits play (`DropMode.drinkLimited = false`); its trail
  logic is kept internally but not drawn. The visible trail is **wall tiles turning white**
  behind the can.
- Only one level is played: `DropMode.levels = DROP_LEVELS.slice(1, 2)` (level 2). Levels 1 and
  3 stay in `src/game/dropLevels.js`. Level 2 data has a `stars` array.

---

## 3. Layout (files)

```
index.html, style.css           DOM screens (menu, tutorial caption, HUD, results, pause, setup)
src/main.js                     font preload, boot
src/core/Game.js                state machine: menu → tutorial → tutorialDone → countdown → playing ⇄ paused → complete/gameover
src/core/GameLoop.js            fixed 120 Hz physics, max frame dt 0.1
src/core/Config.js              CONSTANTS + DEFAULT_SETTINGS (localStorage 'candrop.settings.v1')
src/core/SceneManager.js        renderer (Neutral tone mapping), lights, env map, backdrop, overlay scene
src/core/PostFX.js              post-processing chain (below)
src/game/DropMode.js            world build + 2D physics + hits/goal/stars/drips hooks
src/game/dropLevels.js          level data (+ level 2 stars)
src/game/Tutorial.js            tutorial board + its 2 stars
src/game/Stars.js               collectible stars (drawn in the overlay)
src/game/ShaftDecor.js          tile wall (lights up), side walls, glass shelves, neon, wall logo, sign plates
src/game/CanCharacter.js        the can (brand label texture), roll/squash/blink
src/game/Drips.js, Puddles.js   fridge condensation: drips, wall runs, puddles on shelves
src/game/SheetParticles.js      water splash on hits/pickups
src/game/CameraController.js    framing per screen shape (see §5)
src/game/theme.js               HOUSE_THEME colours
src/controller/*                Joy-Con, calibration, sensor pipeline, phone tilt, keyboard, touch
src/ui/UI.js, HUD.js            screens + GSAP animations, HUD
src/ui/ControllerVisual.js      hands + board SVG under the tutorial box
src/ui/Brand.js                 brand-slot loader (public/brand/*.svg|png|webp)
src/assets/fonts/               Futura Condensed Bold (headings), Myriad Pro (body), Heineken Serif
src/assets/images/stage-backdrop.webp   stage lights + haze behind the tower
public/brand/                   official brand files (README lists names/sizes)
tests/sensor-pipeline.test.mjs  20 deterministic tests (dead zone, bias, axis detect, stale data, tilt)
```

Debug hook: `window.__candrop` (the Game). `ui.gsap` is exposed for fast-forwarding
animations. In a hidden browser pane `requestAnimationFrame` stops; drive the game with
`game.loop.running = false` and call `fixedUpdate(1/120)` / `update(1/60)` / `sceneMgr.render()`
manually, then `loop.start()` again. The tab pauses the game on `visibilitychange`.

---

## 4. Controls and motion pipeline

| Input | Right | Left |
|---|---|---|
| Joy-Con on a roll/board | roll forward / spin | roll backward |
| Phone (DeviceMotion, tilt) | right edge down | left edge down |
| Keyboard | → / D / W | ← / A / S |
| Touch (only when no motion is live) | drag right | drag left |

Final move ∈ [−1, 1]: keyboard/touch if non-zero, else the motion command.

Joy-Con (`SensorProcessor` + `GyroCalibration`), port of the original:
- Read raw per-sample `packet.gyroscopes[i][axis].dps` and `accelerometers[i].{x,y,z}.acc`
  (never `actualGyroscope`). `hidShim.js` must load before `joy-con-webhid`.
- Bias capture (still ~2 s, reject motion; also silent on connect and at level start).
  Spin-axis detection (roll forward ~3 s; largest integrated angle = axis, sign = axisSign;
  fail clearly if ambiguous).
- Per packet: corrected = raw − bias → still detect (|ω| < 3.5 °/s, ||a|−1| < 0.06 G for
  0.35 s) → drift EMA (τ 3 s after 1 s still) → ω on axis × sign × invert → One-Euro
  (minCutoff lerp(8, 0.4, smoothing), beta lerp(0.0005, 0.05, responsiveness)) → 0 while still,
  else `applyDeadZone(ω, 14, max(44, 420)) × sensitivity`, clamped. Stale > 250 ms → 0.
- Phone: `PhoneMotion` emits the same packet shape; `TiltTracker` (gyro-rotated gravity with
  slow accel pull), angle relative to the pose at GO, dead zone 3°, full at 25°.
- Rumble: 0.9/180 ms on a saw hit, 0.6/300 ms on goal, 0.5/100 ms on a star.
- Controller Setup (F1 from menu, or Pause): connect, calibrate bias, detect axis,
  sensitivity / dead zone / max rotation / smoothing / invert, live °/s and command bar,
  phone tilt, audio volumes.

---

## 5. World, physics, camera

Physics is unchanged from CAN DROP (2D X/Y, shaft x ∈ [−6, 6]): GRAVITY 22, MAX_FALL 18,
SHELF_THICK 0.35, SHELF_DEPTH 1.8, CAN_R 0.46, maxSpeed 9.5 × 0.7, accel 16, friction 7,
circle-vs-box collision, moving shelves carry the can, saws: static / line / orbit.
Saw hit: knockback 7, invulnerable 1.2 s, slow 0.8 s, water splash, camera shake 0.6.

Camera (`CameraController._framing`):
- Gameplay portrait: distance 11.5, fov 68, follows x ×0.6 (landscape: 13.5, fov 58).
- Tutorial: fixed and centred, fits the 12 m board, raised **20°** (drone view).
- Can is straight (lid faces the camera). The user rejected a 3/4 yaw.

---

## 6. Look (key visual: green tiled fridge on a stage)

- **Tile wall**: glossy dark-green rounded tiles; tiles behind the can's path turn white.
- **Shelves**: wet glass with droplets, neon line under the front edge; moving shelves lighter.
- **Side walls**: green with droplets and one thick neon strip on the inner edge.
  Strips are thick on purpose: sub-pixel neon lines flickered when the camera moved.
- **Neon intensity** (`neonMat()` in ShaftDecor, HDR × 2.6): user-tuned, currently side
  `0.3`, shelf `0.5`, soft top line `0.45`.
- **Can**: Heineken label from `public/brand/can-label.webp` (kept to its aspect, the rest
  clamps to the label's green); generic aluminium lid unless `can-lid` is supplied.
- **Stars**: red, white halo (a red halo over green reads orange), drawn in the **overlay**.
- **Wall logo**: `heineken-house-logo` on the wall (gameplay only), drawn in the overlay.
- **Backdrop**: stage image, cover-fit. Fog tinted teal.
- **Fridge FX**: drips swelling under shelf edges and falling (fresnel, almost clear),
  wall runs, puddles on shelves (seeded at load, grow where drips land), ice vapour in post.
- **No text signs** in the world and no "GOAL!"/"OUCH!" pop-ups.

Post-processing (`PostFX`, quality `high` on desktop, `low` on touch devices):
scene → GTAO (high) → light DOF on the can (high) → UnrealBloom (strength 0.42,
radius 0.55, threshold 1.3) → OutputPass → colour grade (deep greens, clean highlights,
lifted darks) → light shafts (0.22) + low haze + ice vapour (0.42) → soft vignette →
**overlay pass** (logo + stars: exact colours, no blur/bloom) → SMAA.
Avoid: heavy bloom, chromatic aberration, visible grain in the game view.
`graphics.ambientOcclusion: false` in Config disables the whole post chain.

UI: portrait 9:16 stage (`#app`, container query units `cqw/cqh`), dark navy → green
gradient with fine grain, faint vertical stripes and dust at the top, thin neon lines at the
bottom (two greens). Neon pill buttons. GSAP for all entrances (menu stagger, box pop,
hands slide-in, result glow, hearts/stars pops, countdown).

---

## 7. Brand slots (`public/brand/`)

| File | Status |
|---|---|
| `heineken-house-logo` | supplied (PNG, background removed) |
| `age-badge` | supplied (21+ / Enjoy Responsibly) |
| `can-label` | supplied (webp) |
| `can-lid` | missing → generic lid |
| `sync-challenge-logo` | missing → text + can-outline placeholder |
| `cheers-cans` | missing → generic clinking cans |
| `can-side` | missing → generic mini can on the board |

---

## 8. Status / not done

- Joy-Con and phone: implemented, **not tested on real hardware**.
- Real-device performance of the post chain not measured yet (phones get the `low` chain).
- Done criteria for changes: `npm run build` clean, `npm run test:sensor` passes, the level
  can be finished with the keyboard, and the change is checked in the browser at phone size.

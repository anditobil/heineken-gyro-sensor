# CAN DROP — standalone rebuild brief

This file tells Claude how to rebuild **CAN DROP** as a standalone browser game. CAN DROP is Game 2 of the "FUN GAMES by ZIROLU" hub.

Rebuild **only this game**. Do not add a game hub, a carousel, or the other five games.

The original lives in `E:\AG\CLAUDE-AI\gyro-sober-test`, mainly in these files:
- `src/modes/drop/` — the game mode itself
- `src/controller/` — Joy-Con, phone and keyboard input
- `src/gameplay/PaperSystem.js` — trail strip and particles
- `src/utils/Textures.js` — canvas textures

If that folder is reachable, read those files before writing anything and port them. The numbers below are copied from that code, so they are the source of truth when no source is available.

---

## 1. Hard rules (do not break)

1. **No fake hardware.** Never feed random or simulated sensor values into gameplay to make the Joy-Con look connected. If no controller is connected, show it clearly and fall back to keyboard or touch.
2. **Do not mark hardware features as done without real-device testing.** Synthetic or test data may be used to check logic. When it is, say so explicitly ("verified with synthetic data only").
3. **Original identity.** The name is CAN DROP and the character is a green **ZIROLU** drink can. Use no names, art, levels or layouts from existing commercial games.
4. **Stack.**
   - Three.js (`three@^0.187`), vanilla ES modules and Vite (`vite@^8`).
   - `joy-con-webhid@^0.11` for the Joy-Con.
   - No frameworks, no TypeScript, no audio or image files. Every texture is drawn on a `<canvas>` and every sound comes from Web Audio.
5. **Language.** The user writes in Indonesian; reply in Indonesian. Code, comments and in-game text are in English.

---

## 2. The game in one paragraph

The camera looks at the front of a tall tiled tower shaft. A green ZIROLU can lies on its side on the top shelf. The player **rolls the can left and right**. Gravity drops it through the gaps between shelves, down toward a checkered **GOAL** shelf at the bottom. Moving **saw blades** are in the way. While it rolls, the can leaves a **green drink trail** along the exact path it travels, including vertical streaks down every drop. The trail uses up the "DRINK" resource; rolling back over your own trail winds it back up and refunds it. A saw hit spills a chunk of drink and tears the trail. Reach the goal before the drink runs out. There are 3 levels.

---

## 3. Project layout to create

```
index.html          menu / level select / HUD / pause / result overlays (plain DOM)
style.css
vite.config.js      default; base './' so it can be deployed anywhere (Vercel)
src/main.js
src/core/Game.js            state machine: menu → countdown → playing → paused → complete/gameover
src/core/GameLoop.js        fixed physics step 120 Hz, max frame dt 0.1
src/core/Config.js          CONSTANTS + DEFAULT_SETTINGS, saved in localStorage
src/core/SceneManager.js    renderer, lights, shadows, sky gradient + fog
src/game/DropMode.js        world build + 2D physics + trail (port of src/modes/drop/DropMode.js)
src/game/dropLevels.js      level data (section 9, verbatim)
src/game/CanCharacter.js    can mesh + roll/squash/blink
src/game/Strip.js           dynamic ribbon mesh for the trail
src/game/SheetParticles.js  splash bits on hit
src/game/Textures.js        tile, checker, sign, strip, saw geometry
src/game/CameraController.js
src/controller/hidShim.js        MUST be imported before joy-con-webhid
src/controller/JoyConManager.js
src/controller/SensorProcessor.js  bias, drift, One-Euro filter, dead zone → command −1..1
src/controller/GyroCalibration.js  still/bias capture + spin-axis auto-detect
src/controller/PhoneMotion.js      DeviceMotion → same packet shape as a Joy-Con
src/controller/KeyboardController.js
src/controller/TouchControls.js    on-screen ◀ ▶ stick when no motion sensor
src/controller/InputManager.js
src/audio/AudioManager.js   procedural SFX + simple music loop
src/ui/HUD.js, src/ui/UI.js
tests/sensor-pipeline.test.mjs   node tests for bias/dead zone/axis detect with recorded-style data
```

---

## 4. Controls

| Input | Move right | Move left | Notes |
|---|---|---|---|
| **Joy-Con on a real toilet-paper roll** (main mode) | Roll the roll **forward** | Roll it **backward** | Speed ∝ spin speed (gyro on the detected spin axis) |
| **Phone** (DeviceMotion) | Tilt the right edge down | Tilt the left edge down | Same pipeline; tilt, not spin |
| **Keyboard** | `→` / `D` / `W` | `←` / `A` / `S` | Overrides motion while held |
| **Touch** (no sensor) | stick right | stick left | Only shown when motion is not live |

- There is no jump in CAN DROP; any jump input is ignored.
- `Esc` / `P` pauses, `R` restarts.
- The final move value is `move ∈ [−1, 1]`: keyboard/touch if non-zero, otherwise the motion command.

### Joy-Con pipeline (port `SensorProcessor` + `GyroCalibration`)

**Reading packets.** Use `joy-con-webhid`:
- `connectJoyCon()` and the `connectedJoyCons` Map; listen for `"hidinput"`.
- Read the raw **per-sample arrays**: `packet.gyroscopes[i][axis].dps` (real °/s) and `packet.accelerometers[i].{x,y,z}.acc` (G).
- Do **not** use `actualGyroscope` / `actualAccelerometer`; the library scales them by 0.015 and they are not real units.
- Product IDs: 0x2006 = Joy-Con (L), 0x2007 = Joy-Con (R).

**Loading the library.** `hidShim.js` records `hidSupported` (WebHID needs `navigator.hid` and a secure context). It then installs an inert `navigator.hid` stand-in so the library's top-level `addEventListener` doesn't crash Firefox or Safari. Only show the Connect button when `hidSupported` is true.

**Calibration.**
- **Bias:** the roll lies still for about 2 s. The mean of each gyro axis is the bias; reject the capture if the roll moved. This also runs silently on connect and at level start.
- **Spin-axis detection:** the player rolls forward for about 3 s. Integrate the bias-corrected angular velocity on x, y and z. The axis with the largest accumulated angle becomes `gyro.axis`, and its sign becomes `axisSign`. Fail with a clear message if the result is ambiguous.

**Processing each packet:**
1. Corrected gyro = raw − bias.
2. **Still detection:** |gyro| < 3.5 °/s and |accel| − 1 < 0.06 G. After 0.35 s of that, the roll counts as still.
3. **Drift compensation:** after 1 s still, move the bias toward the raw reading with an EMA (time constant 3 s).
4. ω = corrected[axis] × axisSign × (invert ? −1 : 1).
5. One-Euro filter on ω:
   - minCutoff = lerp(8, 0.4, smoothing)
   - beta = lerp(0.0005, 0.05, responsiveness)
6. Command:
   - 0 while still.
   - Otherwise `applyDeadZone(ω, deadZone=14, fullScale=max(deadZone+30, maxRotationSpeed=420)) × sensitivity`, clamped to −1…1.
   - `applyDeadZone(v, dz, fs) = sign(v) · max(0, |v|−dz) / (fs−dz)`.
7. **Stale data:** if no packet arrived in the last 250 ms, the command is 0.

**Phone.** `PhoneMotion` converts each `devicemotion` event into a packet with the same shape:
- Axes rotated by screen orientation: x = right, y = up, z = out of the screen.
- °/s and G, with +1 G "up" at rest; flip the iOS accel sign.
- iOS 13+ needs `DeviceMotionEvent.requestPermission()` from a tap, and HTTPS.

For moving on a phone, use **tilt**: a gravity vector rotated by the gyro, with a slow accelerometer pull against drift. Take the angle around the screen axis relative to the pose captured at "GO", then map it as below. Phone: tilting the right edge down = positive.

```
dead zone 3°, full tilt 25° → −1..1
```

**Settings screen.** Include a small Controller Setup panel with:
- Connect, calibrate bias, detect spin axis
- Sensitivity, dead zone, max rotation speed, invert
- A live readout of gyro °/s and the command bar

This is how the user verifies the hardware for real.

**Rumble.** 0.9 strength for 180 ms on a saw hit, 0.6 for 300 ms on goal (only if supported).

---

## 5. World and physics (port `DropMode.js` exactly)

**Coordinates.** The shaft uses its own 2D coordinates: x ∈ [−6, 6] left→right, and y = height (0 at the top, negative going down). The physics is 2D (X/Y), drawn at z = 0.

**Constants:**

```
SHAFT_WIDTH 12 (HALF 6)   GRAVITY 22   MAX_FALL 18   SHELF_THICK 0.35   SHELF_DEPTH 1.8
TRAIL SPACING 0.12        CAN_R 0.46   CAN_L 1.15
movement: maxSpeed 9.5, acceleration 16, friction 7   (CAN DROP uses maxSpeed × 0.7)
```

**Horizontal movement** (each fixed step):
- `maxSpeed = 9.5 × 0.7 × (slowTimer > 0 ? 0.5 : 1)`.
- If |move| > 0.01:
  - target = move × maxSpeed.
  - `opposing` = the target's sign differs from vx's sign and |vx| > 0.2.
  - acc = (grounded ? 16 : 16 × 0.45) × (opposing ? 1.8 : 1).
  - vx = approach(vx, target, acc·dt).
- Else: vx = approach(vx, 0, (grounded ? 7 × 1.2 : 0.8)·dt).
- When standing on a moving shelf, add that shelf's velX·dt to x.

**Vertical:** `vy = max(vy − 22·dt, −18)`. Then x += vx·dt and y += vy·dt.

**Collision** (circle vs. each shelf box, with x range [x0+off, x1+off] and y range [y−0.35, y]):
- Find the closest point and push out along the normal by the penetration depth.
- Remove the inward velocity component.
- If normal.y > 0.6, the can is grounded on that shelf. Record `landImpact = −vn`, which drives the squash and the land sound when > 3.
- Clamp x to the side walls (±(6 − r)) and zero vx into the wall.

**Saw motion:**

| Type | Motion |
|---|---|
| `static` | Does not move |
| `line` | k = 0.5 − 0.5·cos(t·speed + phase); lerps between (x, y) and (x2, y2) |
| `orbit` | Angle t·speed + phase, radius `radius` around (x, y) |

The blades spin visually at −12 rad/s.

**Moving shelves.** off = sin(t·speed + phase)·amp, and velX = Δoff/dt.

**Saw hit.**
- A hit is when distance² < (0.95·r + 0.88·sawR)². No hits while invulnerable.
- Knockback: vx = n.x·7, vy = max(n.y·7, 4), grounded = false.
- invulnerable = 1.2 s, slowTimer = 0.8 s.
- Lose `hitLoss` drink.
- Tint the current trail strip dark green (torn). Start a new strip after a 0.4 s delay.
- Burst 16 splash particles, wobble the can, shake the camera by 0.6, toast "💥 Saw! –N drink spilled".

**Goal.** Grounded on the `goal` shelf with drink left: complete.

**Empty.** Drink reaches 0: game over, "You ran out of drink!".

---

## 6. Drink trail (port `Strip` + `DropMode._layPaper`)

**The Strip mesh.**
- A ribbon of point pairs in a dynamic BufferGeometry (`DynamicDrawUsage`, drawRange, `frustumCulled = false`).
- Width is along world Z (`widthZ = true`), so the ribbon reads as a flat band from the front camera.
- UV v = cumulative length.
- `push(x, y, z, t)` returns the added segment length; `pop()` returns the removed one.
- Capacity = ceil(total / 0.12 × 1.3) + 64. Keep a pool of up to 8 strips; recycle the oldest.

**Laying the trail.**
- Each step, the lay point is (x, groundY + 0.012) when grounded, or (x, y − 0.9·r) in the air.
- When it is ≥ 0.12 from the last point, push it and subtract the segment length from `remaining`.
- **Refund:** when grounded and backtracking along a flat run (same height within 0.05/0.1, getting closer to the previous point), pop points and add their length back (capped at the total).
- At reset, tape the trail end to the top shelf 0.9 behind the start.
- `unrollRate` = smoothed (laid / dt). It drives the rolling sound.

**Materials.**
- Strip: MeshStandard, colour #5cf0a4, emissive #12a050 at 0.35, DoubleSide, polygonOffset −2.
- Torn strip: #1f9a57.
- The strip texture is a canvas with faint perforation lines.

---

## 7. Visuals

**Shaft.**
- A back wall with a tile canvas texture (theme `wall`/`grout`), 1.2 m tiles.
- Side walls are boxes in theme `side`.
- The wall spans from y = 9 at the top to goalY − 8 at the bottom.

**Shelves.**
- A RoundedBoxGeometry body (shelf colour × 0.8) plus a thin top cap.
- Cap colour: theme `shelf`, `shelfTop` for moving shelves, a checker texture for the goal.

**Saws.**
- An 18-tooth blade (merged geometry: disc plus cone teeth) with a red hub (#ff4d6d), scaled by r.
- Rail on the back wall: a capsule for `line` saws, a torus for `orbit` saws, a bolt for `static` saws.

**Signs.** Canvas text cards (2.8 × 1.4) on the back wall. Text comes from the level data and uses `\n` for new lines. A "GOAL!" banner (5 × 2.5) sits 3.2 above the goal.

**ZIROLU can** (port `CanCharacter.js`):

*Body*
- Open cylinder R 0.46, length 1.15 × 0.82.
- Label canvas 1024×384: vertical green gradient #0f8c43 → #22c766 → #0f8c43, white stripes near the top and bottom, translucent bubbles.
- "ZIROLU" printed twice around the can (900 weight, white fill, #0b5d2d stroke).

*Ends*
- Tapered metal necks, torus rims and a silver front lid.
- Lid canvas: radial silver, a green ring #19b35a, the "ZIROLU" logo.
- A pull tab and a dark opening on the lid.

*Placement*
- The can axis points at the camera (`rotation.x = π/2`), so the lid faces the viewer.

*Animation*
- Roll: `spin.rotation.z −= vx·dt / CAN_R`.
- Land squash: min(0.25, impact × 0.03), decaying at 1.6/s; scale (1+0.6s, 1−s, 1+0.6s).
- Hit wobble on `tilt.rotation.z`.
- Blink while invulnerable (12 Hz).

**Camera** (front view, follows depth):

```
desired = (target.x·0.35, target.y + 2.2, target.z + 13.5)
look    = (target.x·0.45, target.y − 1.6, target.z)
damp: pos x/z 4, pos y 5, look x/z 4, look y 6   (exponential damping)
```

The menu uses the same view as a backdrop.

**Scene.**
- Hemisphere + directional light with soft shadows.
- Sky gradient from theme `skyTop` → `skyBottom`, fog in the theme `fog` colour.
- Pixel ratio capped at 2.

**Overall look.** Bright, rounded, cute. Use the "Baloo 2" font (Google Fonts) with an "Arial Black" fallback.

---

## 8. Game flow, HUD, scoring, audio

**Flow.**
- **Menu:** title CAN DROP 🥤, Play, How to play, Controller Setup.
- **Level select:** 3 cards with name, subtitle, best score and stars, and a lock icon. A level unlocks when the previous one is cleared.
- **Countdown 3-2-1-GO:** run silent bias capture during it if a Joy-Con is connected.
- **Playing / Paused / Complete / Game over.**
- Save progress in localStorage as `progressDrop: { unlockedLevel, best: { [id]: { score, time, stars } } }`.

**HUD.**
- A depth progress bar: progress = start.y − y over length = start.y − goalY.
- A DRINK meter in metres (remaining / total).
- A speed bar (|vx| / (9.5 × 0.7)), a timer, and an input-source badge (Joy-Con / Phone / Keyboard).

**Scoring** (port `ScoreSystem`):

```
paper  = round(drinkLeft × 20)
time   = completed ? max(0, round((parTime × 1.6 − time) × 40)) : 0
clean  = completed && hits == 0 ? 1000 : 0
total  = paper + time + clean
stars: 1 on clear; 2 if time ≤ par × 1.25 and hits ≤ 2; 3 if time ≤ par and hits == 0
```

- On game over, the score is computed without the completion bonuses, plus round(depth × 5).
- The result screen shows: Time, Drink left "N.N m", Hits, Drink bonus, Time bonus, Clean run, Total, stars, and Next / Retry / Menu.

**Audio** (Web Audio only):
- A rolling hum whose pitch and volume follow speed and `unrollRate` (silent in the air).
- Sounds for land, saw hit, victory jingle and game over.
- A light procedural music loop.
- Master, music and sfx volume plus mute, saved in settings.

---

## 9. Level data (copy verbatim into `src/game/dropLevels.js`)

```js
/**
 * Coordinates are local to the shaft: x ∈ [-6, 6] (left → right), y = height (0 at top, negative down).
 * shelf: { x0, x1, y, move?: { amp, speed, phase? }, goal?: true }   (y = top surface)
 * saw:   { type: 'static', x, y, r }
 *        { type: 'line',   x, y, x2, y2, r, speed, phase? }   ping-pong between the two points
 *        { type: 'orbit',  x, y, radius, r, speed, phase? }   circles around (x, y)
 * sign:  { x, y, text }
 * paper = starting drink (m), hitLoss = drink lost per saw hit, parTime = seconds for 3 stars.
 */
export const SHAFT_WIDTH = 12;

export const DROP_LEVELS = [
  {
    id: 1, name: 'First Drop', subtitle: 'Roll, drop, repeat', paper: 110, hitLoss: 10, parTime: 24,
    start: { x: -4.5, y: 0 },
    theme: { wall: '#ffe9f4', grout: '#ffc6df', shelf: '#7fd0ff', shelfTop: '#e6f6ff', side: '#ff9fc8', skyTop: '#7ec8ff', skyBottom: '#ffe3f1', fog: '#ffe9f3' },
    shelves: [
      { x0: -6, x1: 2, y: 0 },
      { x0: -2, x1: 6, y: -5 },
      { x0: -6, x1: 3, y: -10 },
      { x0: -3, x1: 6, y: -15 },
      { x0: -6, x1: 2, y: -20 },
      { x0: -6, x1: 6, y: -26, goal: true },
    ],
    saws: [
      { type: 'line', x: 0.5, y: -10.4, x2: 0.5, y2: -7.3, r: 0.7, speed: 1.1 },
      { type: 'static', x: 5.2, y: -12.4, r: 0.7 },
    ],
    signs: [
      { x: -3, y: 2.3, text: 'Spin the roll\nto roll →' },
      { x: 3.2, y: -2.6, text: 'Drop through\nthe gaps!' },
      { x: -3, y: -7.6, text: 'Wait for the\nsaw to rise' },
      { x: 2.5, y: -12.6, text: 'Too fast =\nouch!' },
      { x: 0, y: -23.4, text: 'Almost there!' },
    ],
  },
  {
    id: 2, name: 'Saw Tower', subtitle: 'Timing and speed control', paper: 160, hitLoss: 12, parTime: 40,
    start: { x: -4.5, y: 0 },
    theme: { wall: '#fff3dc', grout: '#ffd79a', shelf: '#ff9f7a', shelfTop: '#fff0e2', side: '#b98cff', skyTop: '#9a8cff', skyBottom: '#ffd9c2', fog: '#ffe0cf' },
    shelves: [
      { x0: -6, x1: 1.5, y: 0 },
      { x0: -2, x1: 6, y: -5.5 },
      { x0: -6, x1: 2.5, y: -10.5 },
      { x0: -1.5, x1: 1.5, y: -15, move: { amp: 3, speed: 0.7 } },
      { x0: -6, x1: -1, y: -20 },
      { x0: 1, x1: 6, y: -20 },
      { x0: -6, x1: 3, y: -25.5 },
      { x0: -3, x1: 6, y: -31 },
      { x0: -6, x1: 6, y: -37, goal: true },
    ],
    saws: [
      { type: 'static', x: 4.4, y: -3.2, r: 0.8 },
      { type: 'line', x: -0.5, y: -10.9, x2: -0.5, y2: -7.9, r: 0.7, speed: 1.4 },
      { type: 'orbit', x: 0, y: -19.0, radius: 1.7, r: 0.5, speed: 1.6 },
      { type: 'line', x: 1.4, y: -25.9, x2: 1.4, y2: -22.9, r: 0.7, speed: 1.8 },
      { type: 'line', x: 2, y: -31.4, x2: 2, y2: -28.4, r: 0.65, speed: 1.7 },
      { type: 'line', x: -1, y: -31.4, x2: -1, y2: -28.4, r: 0.65, speed: 1.7, phase: -0.8 },
    ],
    signs: [
      { x: -3, y: 2.3, text: 'Saw Tower' },
      { x: -3.2, y: -13, text: 'Ride the\nmoving shelf' },
    ],
  },
  {
    id: 3, name: 'Grand Descent', subtitle: 'Everything at once', paper: 220, hitLoss: 14, parTime: 58,
    start: { x: -4.5, y: 0 },
    theme: { wall: '#e4fff2', grout: '#a6ebcb', shelf: '#4fc59a', shelfTop: '#e9fff5', side: '#ff8fb8', skyTop: '#3d4bb8', skyBottom: '#ff9ec4', fog: '#f7a8c8' },
    shelves: [
      { x0: -6, x1: 0, y: 0 },
      { x0: -1, x1: 6, y: -5 },
      { x0: -6, x1: 1, y: -10 },
      { x0: -1, x1: 1, y: -14.5, move: { amp: 3.4, speed: 0.9 } },
      { x0: 4, x1: 6, y: -14.5 },
      { x0: -6, x1: -1.2, y: -19.5 },
      { x0: 1.2, x1: 6, y: -19.5 },
      { x0: -4, x1: 6, y: -25 },
      { x0: -6, x1: 2, y: -30.5 },
      { x0: -2.5, x1: 6, y: -35.5 },
      { x0: -6, x1: -0.5, y: -41 },
      { x0: 1.5, x1: 6, y: -41 },
      { x0: -3, x1: 6, y: -47 },
      { x0: -6, x1: 6, y: -53, goal: true },
    ],
    saws: [
      { type: 'static', x: 2.8, y: -2.4, r: 0.8 },
      { type: 'line', x: 3, y: -5.4, x2: 3, y2: -2.6, r: 0.7, speed: 1.6 },
      { type: 'orbit', x: -2.5, y: -9.2, radius: 1.3, r: 0.5, speed: 2 },
      { type: 'static', x: -3.8, y: -17.4, r: 0.7 },
      { type: 'static', x: 3.8, y: -17.4, r: 0.7 },
      { type: 'line', x: -1, y: -25.4, x2: -1, y2: -22.4, r: 0.65, speed: 2 },
      { type: 'line', x: 2.4, y: -25.4, x2: 2.4, y2: -22.4, r: 0.65, speed: 2, phase: 0.9 },
      { type: 'orbit', x: -0.5, y: -29.6, radius: 1.2, r: 0.5, speed: 2.2 },
      { type: 'line', x: 1, y: -35.9, x2: 1, y2: -32.9, r: 0.65, speed: 2 },
      { type: 'line', x: -1.2, y: -35.9, x2: -1.2, y2: -32.9, r: 0.65, speed: 2, phase: -0.9 },
      { type: 'orbit', x: 0.5, y: -40.2, radius: 1.5, r: 0.55, speed: 1.8 },
      { type: 'line', x: 0.5, y: -47.4, x2: 0.5, y2: -44.4, r: 0.7, speed: 2.2 },
    ],
    signs: [
      { x: -3, y: 2.3, text: 'Grand Descent' },
      { x: 0, y: -50.4, text: 'GOAL below!' },
    ],
  },
];
```

---

## 10. Build order and done criteria

1. Scaffold with Vite. `npm run dev` shows an empty Three.js scene. Add `"test:sensor"` to the package.json scripts.
2. Build the shaft, shelves, saws and signs for level 1 from the data, with the camera from section 7.
3. Add the can and the 2D physics, with **keyboard only** first. Check: no tunnelling through shelves at MAX_FALL, the can rests on moving shelves, the walls stop it.
4. Add the trail with the refund rule, drink accounting, saw hits, goal and game over.
5. Add the HUD, menu, level select, result screen, scoring and localStorage progress.
6. Add audio.
7. Add the Joy-Con pipeline, calibration UI and live sensor readout. Then the phone motion and touch fallback.
8. Write node tests for `applyDeadZone`, bias capture rejection, spin-axis detection and the stale-data timeout, using hand-written sample sequences (deterministic, not random).
9. Run `npm run build`; it must have no errors. Smoke-test all 3 levels in the browser with the keyboard.

**Done:** all 3 levels can be finished with the keyboard, the build is clean, and the tests pass.

**Report honestly.** Call the Joy-Con/phone part "implemented, not yet tested on real hardware" until the user confirms it works with a real controller.

**Deploy (only when the user asks).** Vercel works out of the box with Vite: `npx vercel@latest deploy --prod --yes`. HTTPS is required for WebHID and DeviceMotion.

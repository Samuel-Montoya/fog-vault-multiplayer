# survive.io

This build is rebuilt from the working v38 Phaser/Socket.IO version, then re-applies the later safe fixes: clean 3-layer chase music and generator kick/glow. It intentionally keeps the working v38 render/lobby/vaulting systems instead of using the over-split version that broke textures and interactions. Because apparently code can be "organized" straight into a ditch.

## Run

```bash
npm install
npm start
```

Open:

```txt
http://localhost:3000
```

For LAN testing, use your computer's local IP with port `3000`.

## Project files

```txt
server.js              Server-authoritative gameplay, lobbies, AI, collisions, hooks, gens, music state
public/client.js       Phaser renderer, camera, flashlight/fog, audio, HUD, prediction
public/index.html      Lobby/HUD/game shell
public/style.css       Lobby and HUD styling
public/maps.js         Editable ASCII maps
package.json           Node dependencies and scripts
```

## Assets

Put these in `public/` if you want the full audiovisual setup:

```txt
layer_1.mp3   ambience
layer_2.mp3   killer nearby, not in chase
layer_3.mp3   in chase
swing.mp3     killer swing nearby
hooked.mp3    survivor sent to hook
dead.mp3      survivor dies / executed
gen.mp3       generator completed
window_vault.ogg local window vault sound
pallet_vault.ogg local pallet vault sound
injured.ogg   survivor injured sound
gen.svg       generator art
```

Missing audio/art will not crash the game. The game has fallbacks because browsers are fragile little theater kids.

## Map editing

Edit `public/maps.js`. Symbols:

```txt
X wall
+ window vault
- horizontal pallet
| vertical pallet
G generator
P survivor spawn
K killer spawn
E exit gate
. floor
```

Pallets work best when placed between walls. Windows should sit in wall openings.

## Main tuning knobs

### `server.js`

Look near the top for server-authoritative balance:

```js
const SURVIVOR_WALK_SPEED = 170;
const SURVIVOR_SPRINT_SPEED = 285;
const KILLER_SPEED = 310;
const SURVIVOR_VAULT_TIME = 0.38;
const KILLER_VAULT_TIME = 1.05;
const GENERATOR_REPAIR_TIME = 28.0;
const REQUIRED_GENERATORS_TO_COMPLETE = 5;
const GENERATOR_KICK_TIME = 1.0;
const GENERATOR_KICK_REGRESSION = 0.10;
const HEAL_TIME = 6.0;
const HOOKS_BEFORE_EXECUTION = 2;
const TERROR_RADIUS = 760;
```

### `public/client.js`

Look near the top for rendering/audio tuning:

```js
const LIGHTING = { ... };
const MUSIC = { ... };
const SFX = { ... };
const IMMERSION = { ... };
const GENERATOR_VISUAL = { ... };
```

## Controls

### Survivor

- WASD / Arrow Keys: move
- Shift: sprint
- Mouse: aim flashlight
- Space: vault / drop pallet
- Hold E: repair / heal / unhook / escape

### Killer

- WASD / Arrow Keys: move
- Mouse: aim
- M1 tap: quick swing
- M1 hold: lunge
- Space: vault / break pallet
- Hold E: hook / execute / kick generator

## Win conditions

Survivors win when the required generators are completed and all living survivors escape.

Killer wins if all survivors are dead, escaped, or currently hooked/downed in a losing state depending on game rules. Hooked/dead states are fully server-authoritative.


Additional SFX supported in `public/`: `window_vault.ogg`, `pallet_vault.ogg`, `injured.ogg`.


## Survivor skins

The lobby includes three survivor skins: blue square, yellow star, and purple pentagon. Killer remains a red circle. Skin choice is sent to the server and synced to all players.

## v48 lobby theme

The lobby and main menu now use an original campfire horror theme inspired by asymmetrical horror lobbies: animated fire, fog banks, tree silhouettes, survivor silhouettes, and a darker trial panel style. No licensed art/assets are required.

Changed files for this pass:
- `public/index.html`
- `public/style.css`
- `README.md`

## v49 texture polish

- Ground now uses a full-map stamped grass render texture. Each ASCII tile gets a full-size grass tile, so the texture no longer sits in the top-left of the cell.
- Walls now render as connected wooden plank barricades with world-aligned seams and grain instead of separate brick blocks.
- Windows have dark openings, wooden frames, and pale glass/crossbar highlights so they read as vaultable windows.
- Pallets render as layered wood slats with braces, nails, broken-state debris, and clearer dropped/upright states.


## v50 final polish

- Hooked survivors now mark their hook tile with a red outlined square instead of drawing a hook prop.
- Grass is drawn as full-cell world graphics so it fills each map tile instead of looking stamped into the corner.
- Chase camera zoom is stronger. Tune `IMMERSION.CHASE_ZOOM` in `public/client.js`.
- The red chase vignette only appears for survivors when they are in chase and actually looking at the killer.

## v51 performance and visibility pass

- Removed the procedural grass texture/dense per-tile grass blade rendering.
- Ground now uses a cheap green field with broad, low-count patches and a slightly greener edge wash around the map.
- Smoothed the red vignette transition when a survivor looks at or away from the killer during chase.
- Reduced chase shake/heartbeat intensity slightly for smoother client feel.
- Reduced server snapshot rate to 30Hz while keeping the simulation tick at 60Hz. Local prediction still keeps player movement responsive, and this cuts network/browser churn.
- Reduced scratch-mark cap from 180 to 120 for less snapshot/render overhead. v53 lowers this further to 100.

## v52 input and camera polish

- Replaced continuous movement sway with a direction-change-only camera impulse, so straight sprinting stays stable.
- Gameplay keybinds now ignore focused text inputs, textareas, selects, and editable fields so typing names in the lobby works normally.


## v53 performance and direction-sway pass

- Camera sway no longer runs constantly while moving or sprinting. It only nudges when the movement direction changes, then decays back to center.
- `HOOK_INDICATOR` values in `public/client.js` now actually drive the hook bubble size, padding, pulse, and alpha values. Tiny miracle: constants are constanting.
- Socket.IO `perMessageDeflate` is disabled for realtime snapshots to avoid spending CPU compressing tiny high-frequency messages.
- Scratch mark cap reduced to 100 for smaller snapshots and less render work.
- No new packages were added. Phaser already has the right tools here; adding another dependency for camera sway would be ornamental suffering.

## v54 smooth direction camera pass

- Replaced the direction-change camera impulse with a damped target/ease system.
- Direction changes still give a tiny camera lean, but the lean eases in/out instead of snapping.
- Holding a movement key or sprinting straight stays stable.
- Tune these in `public/client.js` under `IMMERSION`:
  - `DIRECTION_SWAY_IMPULSE`
  - `DIRECTION_SWAY_MAX`
  - `DIRECTION_SWAY_TARGET_DECAY`
  - `DIRECTION_SWAY_SMOOTHING`
  - `DIRECTION_SWAY_IDLE_SMOOTHING`

## v55 radial chat wheel

- Hold **R** during a match to open the radial chat wheel.
- Move the mouse toward one of the four wheel slices, then release **R** to send that message.
- Survivor messages:
  - "He's on me!"
  - "Leave me alone!"
  - "Im running!"
  - "Help...!"
- Killer messages:
  - "Im going to get you"
  - "You cant hide forever"
  - "Ill be back..."
  - "What the...?!"
- Messages are server-validated and appear under the speaking player for 3 seconds.
- Speech text is drawn as a separate world-space label, so it stays upright underneath the player even while they rotate/aim.

## v56 state-aware radial chat

- Survivor radial chat messages now change based on the survivor's current state.
- Normal, healthy, not in chase:
  - "Let's do a generator."
  - "I'm so scared..."
  - "Here he comes!"
  - "What was that?!"
- In chase:
  - "He's on me...!"
  - "Leave me alone!"
  - "I'm so scared!"
  - "AHHHH!"
- Injured, not in chase:
  - "I need healing..."
  - "Please, help me..."
  - "I need to hide."
  - "Over here..."
- Downed:
  - "Pick me up!"
  - "Help, please..."
  - "I don't wanna die..."
  - "I'm down...!"
- Hooked:
  - "Save me!"
  - "Unhook me!"
  - "Grab me!"
  - "He's here..."
- Killer messages are unchanged.
- The server validates the chosen message from the actor's current state, so clients cannot send the wrong state set just by being annoying.

## v57 performance pass

- Reworked the flashlight/fog renderer to use a screen-sized `RenderTexture` instead of clearing and filling a full map-sized fog texture every frame. This is the biggest client-side performance win.
- Reduced the flashlight cone texture from 1024px to 768px. It still blends smoothly, but costs less texture work.
- Dynamic world graphics, like generators, pallets, hooks, and gates, now redraw at a capped rate instead of every snapshot.
- Scratch mark rendering is throttled and capped lower to reduce repeated `Graphics.clear()` / redraw churn.
- Particle and shockwave counts are capped more aggressively.
- Phaser render config now requests high-performance WebGL settings and a 60 FPS target.
- Bot pathfinding repaths less aggressively, and survivor flee-point calculation is cached briefly instead of recalculated every tick.
- Bot pathfinding no longer sorts the open list every loop; it selects the best node directly to avoid repeated array sorting.
- Server scratch-mark cleanup mutates in place instead of allocating a filtered array every tick.
- Snapshot emits are now `volatile` and uncompressed, so stale frames can be dropped instead of queueing up and causing rubber-band soup.
- Generator objective counts are computed once per snapshot.

Performance knobs:

```js
// public/client.js
const PERFORMANCE = {
  DYNAMIC_WORLD_FPS: 20,
  SCRATCH_DRAW_FPS: 18,
  MAX_PARTICLES: 90,
  MAX_SHOCKWAVES: 10
};

// server.js
const SNAPSHOT_RATE = 30;
const SCRATCH_MARK_MAX = 80;
const BOT_REPATH_MIN = 0.28;
const BOT_REPATH_MAX = 0.68;
```

## v58 mobile / browser performance pass

This build adds adaptive browser/device tuning so the same code behaves better on weak laptops and mobile browsers.

### Client performance knobs

In `public/client.js`:

- `LOW_POWER_MODE` automatically enables on touch devices, low-core devices, or reduced-motion browsers.
- `RENDER_RESOLUTION` caps device pixel ratio so phones do not try to render a giant canvas for no reason.
- `PERFORMANCE.DYNAMIC_WORLD_FPS` throttles generator/pallet/hook redraws.
- `PERFORMANCE.SCRATCH_DRAW_FPS` throttles scratch-mark graphics redraws.
- `PERFORMANCE.MAX_PARTICLES` and `PERFORMANCE.MAX_SHOCKWAVES` limit visual effect buildup.

### Mobile controls

Touch devices now get a virtual joystick and buttons:

- Left stick: move
- RUN: sprint
- E: repair/heal/unhook/kick/execute
- SPACE: vault/drop/break
- M1: killer attack
- R: chat wheel

### Server bot performance knobs

In `server.js`:

- `BOT_THINK_RATE` controls how many AI decisions bots make per second.
- `BOT_REPATH_MIN` / `BOT_REPATH_MAX` reduce expensive pathfinding churn.
- `SCRATCH_MARK_MAX` limits scratch-mark cleanup and snapshot work.

Bots still move every simulation tick, but their decisions/pathfinding update less often, which cuts server CPU without making them freeze.

## v60 chase smoothness / bot attack polish

- Moved fog rendering back to a screen-sized `RenderTexture` with correct world-to-screen flashlight positioning. This keeps the light cone anchored to the player while avoiding full-map fog redraws during chase zoom.
- Smoothed chase zoom by using time-based damped interpolation and reduced chase-start/heartbeat camera shake.
- Music layers now pause completely outside gameplay. No lobby ambience/chase tracks should play on menu, lobby, or end screens.
- Bot killer M1 behavior is less spammy:
  - quick swings only when very close,
  - held M1/lunge at mid range,
  - path/chase when out of fair attack range,
  - keeps holding during charge instead of twitch-resetting.
- Hook indicators now appear immediately from the hook event, even before the next snapshot fully updates the hooked state.


## v61 flashlight zoom fix

The fog layer is now a padded, camera-window-sized world-space RenderTexture. This keeps the flashlight cone anchored to the local player during chase zoom without using a full-map fog texture.

## v63 chase performance / killer bot tuning

- Dynamic Phaser camera zoom during chase was removed. Chase pressure now uses audio, vignette, tunnel vision, and subtle shake instead of scaling the whole camera every frame. This avoids the browser hitch that happened when chase began.
- Killer bots no longer auto-vault every nearby window from generic pathing. They only vault windows when the survivor is actually using that loop or the window blocks a close chase.
- Killer bots now break dropped pallets more reliably, hold M1 for lunge at mid-range, quick swing only at close range, and commit to chasing instead of window ping-ponging.

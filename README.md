# Fog Vault Multiplayer - Final Stable v41

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

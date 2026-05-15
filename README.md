# Fog Vault Multiplayer Phaser Build

Server-authoritative top-down horror chase prototype using Express, Socket.IO, and Phaser 3.

## Install

```bash
npm install
npm start
```

Open:

```txt
http://localhost:3000
```

## Controls

### Survivor

- WASD / Arrow Keys: move
- Shift: sprint
- Mouse: aim flashlight
- Space: vault/drop pallet/action
- E: repair/escape backup action

### Killer

- WASD / Arrow Keys: move
- Mouse: aim vision/red stain
- M1 / left click: swing melee
- Space/E: vault windows or break dropped pallets

Killer hits are no longer passive touch damage. The killer must swing with M1.

## Bots

The lobby has Add Bot Survivor and Add Bot Killer buttons for testing. Bots use server-side pathfinding, interact with windows/pallets, repair/escape, chase, flee, and swing intentionally.

## Music

Put your music files inside `public/`:

```txt
public/layer_1.mp3
public/layer_2.mp3
public/layer_3.mp3
```

The browser requires a click or key press before audio starts. The game starts all layers together and crossfades volumes from the server music state.

## Lighting knobs

Edit `public/client.js`:

```js
const LIGHTING = {
  MAP_DARKNESS: 0.62,
  SURVIVOR_LENGTH: 700,
  SURVIVOR_ANGLE: Math.PI / 2.25,
  KILLER_LENGTH: 980,
  KILLER_ANGLE: Math.PI / 1.7
};
```

The world renders normally, then Phaser uses a fog render texture and erases a soft cone/aura out of that fog.

# Fog Vault Multiplayer

A server-authoritative Socket.IO horror chase prototype.

## Features

- Open lobbies, no lobby code required
- Up to 4 survivors
- Exactly 1 killer per match
- Role selection in the lobby
- Server-authoritative movement, collision, attacks, vaults, pallets, generators, health, and win conditions
- Editable ASCII maps in `public/maps.js`
- Survivors can sprint, vault, drop pallets, repair generators, and escape
- Killer can move, vault slower, break pallets, swing with M1, and hit by touch
- Match ends when all survivors are dead, all survivors escape, or all generators are complete

## Run it

```bash
npm install
npm start
```

Then open:

```txt
http://localhost:3000
```

To test multiplayer locally, open the page in multiple browser tabs or devices on the same network.

## Controls

### Survivor

- WASD / Arrow Keys: move
- Shift: sprint
- Space: vault window / vault dropped pallet / drop pallet
- E: repair generator, escape, or backup interaction
- Mouse: aim vision cone

### Killer

- WASD / Arrow Keys: move
- Mouse: aim facing/red stain
- M1 / Left Click: melee swing
- Touch survivor: hit survivor if attack cooldown allows
- Space / E: vault windows or break dropped pallets
- No sprint

## Music layers

Optional files can be placed inside `public/`:

```txt
layer_1.mp3
layer_2.mp3
layer_3.mp3
```

Layer 1 is ambient. Layer 2 fades in with terror distance. Layer 3 plays during chase.

## Editing maps

Open `public/maps.js` and edit the rows.

Legend:

```txt
X = wall / stone block
+ = vault window
- = horizontal pallet
| = vertical pallet
G = generator
P = survivor spawn
K = killer spawn
E = exit gate
. = floor
```

Pallets work best between wall pieces. Windows work best inside wall runs.

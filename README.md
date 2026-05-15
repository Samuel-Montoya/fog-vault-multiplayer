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

## v15 fixes

- Brighter fog/flashlight lighting so survivor view is readable again.
- Wider, brighter aura around the player.
- Added warm light bloom in the cone so the visible area does not look flat or dead.
- Killer player visibility now requires line of sight for every survivor reveal rule, including sprinting and repairing.

## v16 fixes

- Chase music now stops after the killer loses chase pressure for 3 seconds instead of staying stuck just because the survivor is inside terror radius.
- `layer_1.mp3` stays as ambient, `layer_2.mp3` fades with terror distance, and `layer_3.mp3` stays up only while chase grace is active.
- Windows and dropped pallets block movement/attacks but no longer block vision, so survivors can see killers through them.
- Walls still block line of sight.
- Server tick rate increased to 60Hz and snapshot rate increased to 30Hz.
- Client input sends at 60Hz.
- Actor positions are no longer rounded before snapshots.
- Client rendering now smooths visible actor movement between snapshots.

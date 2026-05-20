# Voidrift

React + Vite UI shell with the existing Phaser/socket.io Voidrift game mounted inside it.

## Run locally

```bash
npm install
npm run dev
```

Open the URL printed by the server, usually `http://localhost:3000`.

The dev server is a single Express/socket.io process with Vite middleware, so `/socket.io/socket.io.js`, Phaser, the React UI, and the game client all run on the same origin. Tiny miracle, no proxy circus.

## Build and run

```bash
npm run build
npm start
```

## Map-specific rift counts

Edit `public/maps.js` and set this per map:

```js
requiredGenerators: 5
// or
requiredGenerators: "all"
```

The server clamps the required count to the actual number of `G` rift tiles on the map. When the required count is complete, rifts are hidden and stop blocking/interacting.

## Project layout

```txt
server.cjs                  socket.io authoritative game server
public/client.js            Phaser game client
public/maps.js              map data and per-map rift requirements
public/gameplayConfig.js    shared gameplay tuning
public/audioConfig.js       audio tuning
src/App.jsx                 React-rendered UI shell
src/styles/voidrift.css     game/UI CSS moved from the old static page
```

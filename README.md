# RiftRunner

React + Vite UI shell with the Phaser/Socket.IO RiftRunner game mounted inside it.

## Run locally

```bash
npm install
npm run dev
```

Open the URL printed by the server, usually `http://localhost:3000`.

The dev server is a single Express/Socket.IO process with Vite middleware, so `/socket.io/socket.io.js`, Phaser, the React UI, and the game client all run on the same origin.

## Build and run locally like production

```bash
npm run build
npm start
```

## Validate before pushing

```bash
npm run check
```

This runs ESLint and a production Vite build.

## Deploy on Render

Use a Render **Web Service**. Do not use a Static Site because the Socket.IO game server must stay running.

Recommended settings:

```txt
Build Command: npm ci --include=dev && npm run build
Start Command: npm start
Health Check Path: /healthz
```

A `render.yaml` blueprint is included with the same settings.

Important environment variables:

```txt
NODE_ENV=production
HOST=0.0.0.0
HOST_PROFILE=boosted
MAX_CONNECTIONS=80
MAX_LOBBIES=40
```

After your domain is attached and verified, set `ALLOWED_ORIGINS` to your real domains, for example:

```txt
ALLOWED_ORIGINS=https://riftrunner.gg,https://www.riftrunner.gg
```

Render provides and renews TLS for custom domains. Add the domain in the Render dashboard, copy the DNS records into Namecheap, verify it, then use HTTPS.

See `PRODUCTION.md` for the deployment checklist.

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
server.cjs                  Socket.IO authoritative game server
public/client.js            Phaser game client
public/maps.js              map data and per-map rift requirements
public/gameplayConfig.js    shared gameplay tuning
public/audioConfig.js       audio tuning
src/App.jsx                 React-rendered UI shell
src/styles/voidrift.css     game/UI CSS
render.yaml                 Render blueprint
PRODUCTION.md               deployment checklist
```

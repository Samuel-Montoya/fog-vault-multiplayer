# RiftRunner Production Notes

## Render setup

Use a **Web Service**, not a Static Site. RiftRunner needs one Node process because Express serves the built React app and Socket.IO runs the realtime match server.

Recommended Render commands:

```bash
Build Command: npm ci --include=dev && npm run build
Start Command: npm start
Health Check Path: /healthz
```

`render.yaml` already contains those values if you deploy using Render Blueprints.

## Environment variables

Start with these:

```txt
NODE_ENV=production
HOST=0.0.0.0
HOST_PROFILE=boosted
ENABLE_SERVER_METRICS=true
MAX_CONNECTIONS=80
MAX_LOBBIES=40
```

After your custom domain is verified, set:

```txt
ALLOWED_ORIGINS=https://riftrunner.gg,https://www.riftrunner.gg
```

Leave `ALLOWED_ORIGINS` blank for the first deploy if you are testing on the generated `*.onrender.com` URL.

## Domain + HTTPS

Render manages TLS certificates for custom domains and renews them automatically. Add the domain inside your Render service, then update DNS at Namecheap using the records Render gives you. After verification, Render redirects HTTP to HTTPS.

For a root domain like `riftrunner.gg`, Render usually gives you an A/ALIAS/ANAME-style target depending on the registrar. For `www.riftrunner.gg`, use the CNAME target Render shows in the dashboard. Use Render's exact DNS instructions over guesses, because DNS is where joy goes to be slowly composted.

## Health checks

- `/healthz` returns lightweight runtime status for Render.
- `/readyz` checks that the built frontend and Phaser vendor file exist.

## Audio assets

This zip did not include the actual files in `public/sfx`. The game will run, but sounds referenced in `public/audioConfig.js` will 404 until you add the MP3/OGG files back into `public/sfx` before deployment.

## Capacity note

The Standard 2 GB / 1 CPU Render plan is a good starting point for a small realtime browser game. Keep `MAX_CONNECTIONS` and `MAX_LOBBIES` conservative until you test real concurrent players. Socket games fail in the funniest possible way when one tiny box is asked to become an MMO.

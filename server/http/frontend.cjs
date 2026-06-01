const path = require("path");

const AUDIO_FILE_RE = /\.(mp3|ogg|wav|m4a|flac)$/i;

function mountStaticAssetRoutes({ app, express, publicDir, phaserFile }) {
  app.get("/vendor/phaser.min.js", (req, res) => {
    res.setHeader("Cache-Control", "public, max-age=604800");
    res.sendFile(phaserFile);
  });

  app.use(express.static(publicDir, {
    index: false,
    etag: true,
    maxAge: 0,
    setHeaders(res, filePath) {
      if (AUDIO_FILE_RE.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=86400");
        return;
      }
      res.setHeader("Cache-Control", "no-cache");
    }
  }));

  // Do not let the SPA fallback serve index.html for missing audio files.
  // Browsers then try to decode HTML as MP3/OGG and flood the console with useless MIME errors.
  app.use((req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD") {
      if (AUDIO_FILE_RE.test(req.path)) {
        return res.status(404).type("text/plain").send(`Audio file not found: ${req.path}`);
      }
    }
    return next();
  });
}

async function setupFrontend({ app, express, fs, rootDir, distDir, isProduction }) {
  const forceVite = process.argv.includes("--dev") || process.env.VITE_DEV_SERVER === "1";
  const hasBuiltClient = fs.existsSync(path.join(distDir, "index.html"));

  if (forceVite) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root: rootDir,
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
    return;
  }

  if (!hasBuiltClient) {
    throw new Error(
      "Missing production frontend build: dist/index.html was not found. " +
      "Run `npm run build` before `npm start`. On Render, set Build Command to `npm ci --include=dev && npm run build` and Start Command to `npm start`."
    );
  }

  app.use(express.static(distDir, {
    index: false,
    etag: true,
    maxAge: "1y",
    immutable: true,
    setHeaders(res, filePath) {
      if (filePath.endsWith("index.html")) {
        res.setHeader("Cache-Control", "no-store");
      }
    }
  }));

  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(distDir, "index.html"));
  });
}

module.exports = {
  mountStaticAssetRoutes,
  setupFrontend
};

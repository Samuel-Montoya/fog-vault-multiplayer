#!/usr/bin/env node
/*
  Render-safe production launcher.

  If Render starts the service before the Vite frontend exists, build it once,
  then start the Socket.IO/Express server. This makes the project survive both:
  - the correct Render setup: Build Command runs npm run build first
  - the cursed setup: Start Command runs without a built dist folder
*/
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const DIST_INDEX = path.join(ROOT_DIR, "dist", "index.html");
const SERVER_FILE = path.join(ROOT_DIR, "server.cjs");
const IS_WINDOWS = process.platform === "win32";

function hasFrontendBuild() {
  return fs.existsSync(DIST_INDEX);
}

function runBuildIfNeeded() {
  if (hasFrontendBuild()) return;

  console.log("[riftrunner] dist/index.html not found. Building frontend before startup...");
  const result = spawnSync("npm", ["run", "build"], {
    cwd: ROOT_DIR,
    stdio: "inherit",
    shell: IS_WINDOWS
  });

  if (result.error) {
    console.error("[riftrunner] Could not run npm run build:", result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`[riftrunner] npm run build failed with exit code ${result.status}.`);
    process.exit(result.status || 1);
  }

  if (!hasFrontendBuild()) {
    console.error("[riftrunner] Build finished, but dist/index.html still does not exist. Check vite.config.js outputDir and Render root directory.");
    process.exit(1);
  }
}

runBuildIfNeeded();

const child = spawn(process.execPath, [SERVER_FILE], {
  cwd: ROOT_DIR,
  stdio: "inherit",
  env: process.env
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

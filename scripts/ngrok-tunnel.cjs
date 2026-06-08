#!/usr/bin/env node
const path = require("path");
const ngrok = require("@ngrok/ngrok");
const { loadEnv } = require("../server/config/load-env.cjs");

const ROOT_DIR = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || 3000;

loadEnv(ROOT_DIR);

async function main() {
  const authtoken = process.env.NGROK_AUTHTOKEN?.trim();
  if (!authtoken) {
    console.error("[ngrok] Missing NGROK_AUTHTOKEN.");
    console.error("[ngrok] 1. Sign up at https://dashboard.ngrok.com/signup");
    console.error("[ngrok] 2. Copy your authtoken from https://dashboard.ngrok.com/get-started/your-authtoken");
    console.error("[ngrok] 3. Add NGROK_AUTHTOKEN=... to .env in the project root");
    process.exit(1);
  }

  const listener = await ngrok.forward({
    addr: PORT,
    authtoken
  });

  const url = listener.url();
  console.log("");
  console.log("[ngrok] Tunnel ready");
  console.log(`[ngrok] Public URL:  ${url}`);
  console.log(`[ngrok] Local server: http://localhost:${PORT}`);
  console.log("[ngrok] Share the public URL with your friend.");
  console.log("[ngrok] Keep this terminal open while testing.");
  console.log("");

  const keepAlive = setInterval(() => {}, 60_000);

  const shutdown = async () => {
    clearInterval(keepAlive);
    await listener.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await new Promise(() => {});
}

main().catch((error) => {
  const message = String(error.message || error);
  console.error("[ngrok] Failed to start tunnel:", message);

  if (message.includes("ERR_NGROK_108") || message.includes("3 simultaneous ngrok agent sessions")) {
    console.error("[ngrok] Free ngrok accounts allow 3 active tunnels. Close old tunnel terminals or run:");
    console.error('[ngrok]   Get-CimInstance Win32_Process -Filter "Name = \'node.exe\'" | Where-Object { $_.CommandLine -match "ngrok-tunnel|@ngrok/ngrok" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }');
    console.error("[ngrok] Also check https://dashboard.ngrok.com/agents and stop stale sessions.");
  }

  process.exit(1);
});

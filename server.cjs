const path = require("path");
const fs = require("fs");
const vm = require("vm");
const express = require("express");
const http = require("http");
const { monitorEventLoopDelay, performance } = require("perf_hooks");
const { Server } = require("socket.io");

function loadPublicScriptGlobal(relativeFile, globalName) {
  const filePath = path.join(__dirname, relativeFile);
  const source = fs.readFileSync(filePath, "utf8");
  const sandbox = {
    console,
    window: {},
    module: { exports: {} },
    exports: {}
  };
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: filePath });

  const moduleExports = sandbox.module?.exports;
  if (moduleExports && (typeof moduleExports !== "object" || Object.keys(moduleExports).length > 0)) {
    return moduleExports;
  }

  return sandbox.window?.[globalName] || sandbox[globalName] || {};
}

const GAME_MAPS = loadPublicScriptGlobal("public/maps.js", "GAME_MAPS");
const GAMEPLAY_CONFIG = loadPublicScriptGlobal("public/gameplayConfig.js", "GAMEPLAY_CONFIG");
const RIFTRUNNER_CHATS = loadPublicScriptGlobal("public/chats.js", "RIFTRUNNER_CHATS");
const RIFTRUNNER_ABILITIES = loadPublicScriptGlobal("public/abilities.js", "RIFTRUNNER_ABILITIES");

function cfgNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}


const app = express();
const server = http.createServer(app);

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const PHASER_FILE = path.join(ROOT_DIR, "node_modules", "phaser", "dist", "phaser.min.js");

function readAppVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf8"));
    return String(pkg.version || "0.0.0");
  } catch {
    return "0.0.0";
  }
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeOrigin(origin) {
  try {
    const url = new URL(origin);
    return `${url.protocol}//${url.host}`;
  } catch {
    return String(origin || "");
  }
}

const APP_VERSION = readAppVersion();
const ALLOWED_ORIGINS = parseCsv(process.env.ALLOWED_ORIGINS).map(normalizeOrigin);
const MAX_CONNECTIONS = cfgNumber(process.env.MAX_CONNECTIONS, cfgNumber(GAMEPLAY_CONFIG.server?.maxConnections, 80));
const MAX_LOBBIES = cfgNumber(process.env.MAX_LOBBIES, cfgNumber(GAMEPLAY_CONFIG.server?.maxLobbies, 40));
const LOBBY_IDLE_TTL_MS = cfgNumber(process.env.LOBBY_IDLE_TTL_MS, cfgNumber(GAMEPLAY_CONFIG.server?.lobbyIdleTtlMs, 30 * 60 * 1000));
const ENDED_LOBBY_TTL_MS = cfgNumber(process.env.ENDED_LOBBY_TTL_MS, cfgNumber(GAMEPLAY_CONFIG.server?.endedLobbyTtlMs, 10 * 60 * 1000));

function isOriginAllowed(origin) {
  if (!origin) return true;
  if (!ALLOWED_ORIGINS.length) return true;
  const normalized = normalizeOrigin(origin);
  return ALLOWED_ORIGINS.includes(normalized);
}

function socketCorsOrigin(origin, callback) {
  callback(null, isOriginAllowed(origin));
}

const io = new Server(server, {
  cors: { origin: socketCorsOrigin },
  allowRequest: (req, callback) => callback(null, isOriginAllowed(req.headers.origin)),
  maxHttpBufferSize: 32 * 1024,
  pingInterval: 25000,
  pingTimeout: 20000,
  // Realtime games send lots of tiny snapshots. Compressing every message can
  // cost more CPU than it saves here, especially on free hosts and laptops.
  perMessageDeflate: false
});

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  next();
});

app.get("/healthz", (req, res) => {
  const activePlayers = [...lobbies.values()].reduce((sum, lobby) => sum + lobby.players.size, 0);
  res.json({
    ok: true,
    name: "riftrunner",
    version: APP_VERSION,
    uptimeSeconds: Math.round(process.uptime()),
    lobbies: lobbies.size,
    players: activePlayers,
    env: IS_PRODUCTION ? "production" : "development"
  });
});

app.get("/readyz", (req, res) => {
  const phaserReady = fs.existsSync(PHASER_FILE);
  const frontendReady = !IS_PRODUCTION || fs.existsSync(path.join(DIST_DIR, "index.html"));
  if (!phaserReady || !frontendReady) {
    return res.status(503).json({ ok: false, phaserReady, frontendReady });
  }
  return res.json({ ok: true });
});

app.get("/vendor/phaser.min.js", (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=604800");
  res.sendFile(PHASER_FILE);
});
app.use(express.static(PUBLIC_DIR, {
  index: false,
  etag: true,
  maxAge: 0,
  setHeaders(res, filePath) {
    if (/\.(mp3|ogg|wav|m4a|flac)$/i.test(filePath)) {
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
    if (/\.(mp3|ogg|wav|m4a|flac)$/i.test(req.path)) {
      return res.status(404).type("text/plain").send(`Audio file not found: ${req.path}`);
    }
  }
  return next();
});

async function setupFrontend() {
  const forceVite = process.argv.includes("--dev") || process.env.VITE_DEV_SERVER === "1";
  const hasBuiltClient = fs.existsSync(path.join(DIST_DIR, "index.html"));

  if (forceVite) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root: ROOT_DIR,
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

  app.use(express.static(DIST_DIR, {
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
    res.sendFile(path.join(DIST_DIR, "index.html"));
  });
}


const HOST_PROFILE = String(process.env.HOST_PROFILE || GAMEPLAY_CONFIG.server?.hostProfileDefault || "boosted").toLowerCase();
const IS_BOOSTED_HOST = HOST_PROFILE === "boosted" || HOST_PROFILE === "2gb" || HOST_PROFILE === "performance";
const PERF = Object.freeze({
  profile: HOST_PROFILE,
  boosted: IS_BOOSTED_HOST,
  tickRate: cfgNumber(GAMEPLAY_CONFIG.server?.tickRate, 60),
  // Boosted hosts can afford slightly more frequent snapshots, but keep this sane.
  // Generator visuals are already throttled client-side; do not turn snapshots into a firehose again.
  snapshotRate: IS_BOOSTED_HOST ? cfgNumber(GAMEPLAY_CONFIG.server?.snapshotRateBoosted, 20) : cfgNumber(GAMEPLAY_CONFIG.server?.snapshotRateStandard, 16),
  botThinkRate: IS_BOOSTED_HOST ? cfgNumber(GAMEPLAY_CONFIG.server?.botThinkRateBoosted, 12) : cfgNumber(GAMEPLAY_CONFIG.server?.botThinkRateStandard, 8),
  pathfindLoopLimit: IS_BOOSTED_HOST ? cfgNumber(GAMEPLAY_CONFIG.server?.pathfindLoopLimitBoosted, 1600) : cfgNumber(GAMEPLAY_CONFIG.server?.pathfindLoopLimitStandard, 950),
  pathCacheMax: IS_BOOSTED_HOST ? cfgNumber(GAMEPLAY_CONFIG.server?.pathCacheMaxBoosted, 900) : cfgNumber(GAMEPLAY_CONFIG.server?.pathCacheMaxStandard, 300),
  enablePathCache: process.env.ENABLE_PATH_CACHE !== "false",
  enableEventLoopMetrics: process.env.ENABLE_SERVER_METRICS !== "false",
  metricsIntervalMs: cfgNumber(process.env.METRICS_INTERVAL_MS, cfgNumber(GAMEPLAY_CONFIG.server?.metricsIntervalMs, 30000))
});

const TICK_RATE = PERF.tickRate;
const SNAPSHOT_RATE = PERF.snapshotRate;
const BOT_THINK_RATE = PERF.botThinkRate;
const PATHFIND_LOOP_LIMIT = PERF.pathfindLoopLimit;
const MATCH_START_FREEZE_SECONDS = cfgNumber(GAMEPLAY_CONFIG.match?.startFreezeSeconds, 1.5);
const SCRATCH_MARK_MAX = cfgNumber(GAMEPLAY_CONFIG.match?.scratchMarkMax, 45);
const MAX_SURVIVORS = cfgNumber(GAMEPLAY_CONFIG.match?.maxSurvivors, 4);
const SURVIVOR_SKINS = new Set(["blueSquare", "yellowStar", "purplePentagon", "nebulaBloom", "eclipseWisp", "riftMoth", "signalDrone"]);
function sanitizeSkin(value) {
  return SURVIVOR_SKINS.has(value) ? value : "blueSquare";
}

const serverMetrics = {
  tickMaxMs: 0,
  tickSamples: 0,
  snapshotsSent: 0,
  snapshotsSkipped: 0,
  pathCacheHits: 0,
  pathCacheMisses: 0
};

const eventLoopDelay = PERF.enableEventLoopMetrics ? monitorEventLoopDelay({ resolution: 20 }) : null;
if (eventLoopDelay) eventLoopDelay.enable();

function recordTickDuration(ms) {
  if (!PERF.enableEventLoopMetrics) return;
  serverMetrics.tickSamples += 1;
  if (ms > serverMetrics.tickMaxMs) serverMetrics.tickMaxMs = ms;
}

function logServerMetrics() {
  if (!PERF.enableEventLoopMetrics) return;
  const meanLoopMs = eventLoopDelay ? eventLoopDelay.mean / 1e6 : 0;
  const maxLoopMs = eventLoopDelay ? eventLoopDelay.max / 1e6 : 0;
  const activeLobbies = [...lobbies.values()].filter((lobby) => lobby.game?.phase === "game").length;
  const activePlayers = [...lobbies.values()].reduce((sum, lobby) => sum + lobby.players.size, 0);
  console.log(`[perf] profile=${PERF.profile} tickRate=${TICK_RATE} snapshotRate=${SNAPSHOT_RATE} botThinkRate=${BOT_THINK_RATE} lobbies=${activeLobbies} players=${activePlayers} tickMaxMs=${serverMetrics.tickMaxMs.toFixed(2)} loopMeanMs=${meanLoopMs.toFixed(2)} loopMaxMs=${maxLoopMs.toFixed(2)} snapshotsSent=${serverMetrics.snapshotsSent} snapshotsSkipped=${serverMetrics.snapshotsSkipped} pathCache=${serverMetrics.pathCacheHits}/${serverMetrics.pathCacheMisses}`);
  serverMetrics.tickMaxMs = 0;
  serverMetrics.tickSamples = 0;
  serverMetrics.snapshotsSent = 0;
  serverMetrics.snapshotsSkipped = 0;
  serverMetrics.pathCacheHits = 0;
  serverMetrics.pathCacheMisses = 0;
  eventLoopDelay?.reset();
}

if (PERF.enableEventLoopMetrics) {
  const metricsTimer = setInterval(logServerMetrics, PERF.metricsIntervalMs);
  metricsTimer.unref?.();
}

const lobbyCleanupTimer = setInterval(cleanupStaleLobbies, Math.min(LOBBY_IDLE_TTL_MS, ENDED_LOBBY_TTL_MS, 5 * 60 * 1000));
lobbyCleanupTimer.unref?.();
const PLAYER_SIZE = cfgNumber(GAMEPLAY_CONFIG.actor?.survivorSize, 30);
const KILLER_SIZE = cfgNumber(GAMEPLAY_CONFIG.actor?.voidSize, 38);
const INTERACT_DISTANCE = 74;
const QUICK_ATTACK_RANGE = cfgNumber(GAMEPLAY_CONFIG.attack?.quickRange, 82);
const LUNGE_ATTACK_RANGE = cfgNumber(GAMEPLAY_CONFIG.attack?.lungeRange, 118);
const ATTACK_ARC = cfgNumber(GAMEPLAY_CONFIG.attack?.arcRadians, Math.PI * 0.50);
// Small visual/server grace so edge-of-cone hits feel fair without tagging runners who are clearly outside.
const ATTACK_EDGE_GRACE_RADIUS = cfgNumber(GAMEPLAY_CONFIG.attack?.edgeGraceRadius, 9);
const ATTACK_TAP_MAX = cfgNumber(GAMEPLAY_CONFIG.attack?.tapMaxSeconds, 0.18);
const LUNGE_CHARGE_TIME = cfgNumber(GAMEPLAY_CONFIG.attack?.lungeChargeSeconds, 0.32);
const QUICK_ATTACK_ACTIVE = cfgNumber(GAMEPLAY_CONFIG.attack?.quickActiveSeconds, 0.24);
const LUNGE_ATTACK_ACTIVE = cfgNumber(GAMEPLAY_CONFIG.attack?.lungeActiveSeconds, 0.42);
const QUICK_ATTACK_STARTUP = cfgNumber(GAMEPLAY_CONFIG.attack?.quickStartupSeconds, 0.045);
const LUNGE_ATTACK_STARTUP = cfgNumber(GAMEPLAY_CONFIG.attack?.lungeStartupSeconds, 0.075);
const LUNGE_SPEED_MULT = cfgNumber(GAMEPLAY_CONFIG.attack?.lungeSpeedMultiplier, 1.42);
const SURVIVOR_WALK_SPEED = cfgNumber(GAMEPLAY_CONFIG.survivor?.walkSpeed, 170);
const SURVIVOR_SPRINT_SPEED = cfgNumber(GAMEPLAY_CONFIG.survivor?.sprintSpeed, 285);
const SURVIVOR_HIT_BURST_SPEED = cfgNumber(GAMEPLAY_CONFIG.survivor?.hitBurstSpeed, 350);
const KILLER_SPEED = cfgNumber(GAMEPLAY_CONFIG.void?.speed, 310);
const KILLER_RECOVERY_SPEED_MULT = cfgNumber(GAMEPLAY_CONFIG.void?.recoverySpeedMultiplier, 0.28);
const KILLER_QUICK_MISS_RECOVERY = cfgNumber(GAMEPLAY_CONFIG.attack?.quickMissRecoverySeconds, 1.05);
const KILLER_QUICK_HIT_RECOVERY = cfgNumber(GAMEPLAY_CONFIG.attack?.quickHitRecoverySeconds, 1.55);
const KILLER_LUNGE_MISS_RECOVERY = cfgNumber(GAMEPLAY_CONFIG.attack?.lungeMissRecoverySeconds, 1.35);
const KILLER_LUNGE_HIT_RECOVERY = cfgNumber(GAMEPLAY_CONFIG.attack?.lungeHitRecoverySeconds, 1.85);
const KILLER_ATTACK_COOLDOWN = cfgNumber(GAMEPLAY_CONFIG.attack?.cooldownSeconds, 0.24);
const SURVIVOR_INVULN = cfgNumber(GAMEPLAY_CONFIG.survivor?.invulnerableSeconds, 1.45);
const SURVIVOR_HIT_BOOST = cfgNumber(GAMEPLAY_CONFIG.survivor?.hitBoostDuration, 1.0);
const SURVIVOR_VAULT_TIME = cfgNumber(GAMEPLAY_CONFIG.survivor?.vaultTime, 0.38);
const SURVIVOR_WINDOW_VAULT_COOLDOWN = cfgNumber(GAMEPLAY_CONFIG.survivor?.windowVaultCooldown, 1.15);
const SURVIVOR_PALLET_VAULT_COOLDOWN = cfgNumber(GAMEPLAY_CONFIG.survivor?.palletVaultCooldown, SURVIVOR_WINDOW_VAULT_COOLDOWN);
const SURVIVOR_PALLET_DROP_COOLDOWN = cfgNumber(GAMEPLAY_CONFIG.survivor?.palletDropCooldown, SURVIVOR_PALLET_VAULT_COOLDOWN);
const KILLER_VAULT_TIME = cfgNumber(GAMEPLAY_CONFIG.void?.vaultTime, 1.05);
const KILLER_BREAK_TIME = cfgNumber(GAMEPLAY_CONFIG.void?.breakTime, 1.25);
const VOID_STUN_TIME = cfgNumber(GAMEPLAY_CONFIG.pallet?.voidStunSeconds, 1.0);
const VOID_STUN_CLOSE_RADIUS = cfgNumber(GAMEPLAY_CONFIG.pallet?.voidStunCloseRadius, 42);
const VOID_STUN_SWING_RADIUS = cfgNumber(GAMEPLAY_CONFIG.pallet?.voidStunSwingRadius, 64);
// Adjustable generator speed: raise this number to make generators slower.
const GENERATOR_REPAIR_TIME = cfgNumber(GAMEPLAY_CONFIG.rift?.repairTime, 28.0);
// Fallback only. The real match requirement should live on each map in maps.js.
const DEFAULT_REQUIRED_GENERATORS_TO_COMPLETE = cfgNumber(GAMEPLAY_CONFIG.match?.requiredRiftsToComplete, 5);
const GENERATOR_COLLISION_SIZE = cfgNumber(GAMEPLAY_CONFIG.rift?.collisionSize, 54);
// Killer generator kick: hold E near a partially repaired gen to regress it.
const GENERATOR_KICK_TIME = cfgNumber(GAMEPLAY_CONFIG.rift?.kickTime, 1.0);
const GENERATOR_KICK_REGRESSION = cfgNumber(GAMEPLAY_CONFIG.rift?.kickRegression, 0.10);
const GATE_ESCAPE_TIME = cfgNumber(GAMEPLAY_CONFIG.rift?.escapeTime, 4.0);
const HEAL_TIME = cfgNumber(GAMEPLAY_CONFIG.survivor?.healTime, 4.2);
const HEAL_DISTANCE = cfgNumber(GAMEPLAY_CONFIG.survivor?.healDistance, 82);
const HEAL_DECAY_PER_SECOND = cfgNumber(GAMEPLAY_CONFIG.survivor?.healDecayPerSecond, 0.08);
const DOWNED_CRAWL_SPEED = cfgNumber(GAMEPLAY_CONFIG.survivor?.downedCrawlSpeed, 62);
const HOOK_CHANNEL_TIME = cfgNumber(GAMEPLAY_CONFIG.hook?.channelTime, 1.35);
const EXECUTE_CHANNEL_TIME = cfgNumber(GAMEPLAY_CONFIG.hook?.executeTime, 2.15);
const UNHOOK_TIME = cfgNumber(GAMEPLAY_CONFIG.survivor?.unhookTime, 2.15);
const HOOKS_BEFORE_EXECUTION = cfgNumber(GAMEPLAY_CONFIG.hook?.hooksBeforeExecution, 2);
const HOOK_INTERACT_DISTANCE = cfgNumber(GAMEPLAY_CONFIG.hook?.interactDistance, 128);
const HOOK_RESCUE_DISTANCE = cfgNumber(GAMEPLAY_CONFIG.survivor?.hookRescueDistance, 108);
const HOOK_MIN_KILLER_DISTANCE = cfgNumber(GAMEPLAY_CONFIG.void?.hookMinDistance, 430);
const SURVIVOR_DOT_MAX = cfgNumber(GAMEPLAY_CONFIG.orbs?.survivorMax, 30);
const KILLER_DOT_MAX = cfgNumber(GAMEPLAY_CONFIG.orbs?.voidMax, 999);
// Dot economy: survivors complete rifts by collecting orbs and standing near a rift.
// No hold-E rift repair. One inserted orb takes a flat 1.5s and each rift needs dotsPerRift orbs.
const DOTS_PER_GENERATOR = cfgNumber(GAMEPLAY_CONFIG.rift?.dotsPerRift, 30);
const SURVIVOR_DOT_DROP_ON_HIT_PERCENT = cfgNumber(GAMEPLAY_CONFIG.orbs?.survivorDropOnHitPercent, 0.5);
const SURVIVOR_DOT_PICKUP_RADIUS = cfgNumber(GAMEPLAY_CONFIG.orbs?.survivorPickupRadius, 48);
const KILLER_DOT_PICKUP_RADIUS = cfgNumber(GAMEPLAY_CONFIG.orbs?.voidPickupRadius, 92);
const VOID_ABILITY_DEFS = RIFTRUNNER_ABILITIES.abilities || {};
const VOID_ABILITY_ORDER = Array.isArray(RIFTRUNNER_ABILITIES.wheelOrder) ? RIFTRUNNER_ABILITIES.wheelOrder : Object.keys(VOID_ABILITY_DEFS);
const SURVIVOR_ABILITY_DEFS = RIFTRUNNER_ABILITIES.survivorAbilities || {};
const SURVIVOR_ABILITY_ORDER = Array.isArray(RIFTRUNNER_ABILITIES.survivorWheelOrder) ? RIFTRUNNER_ABILITIES.survivorWheelOrder : Object.keys(SURVIVOR_ABILITY_DEFS);
const SURVIVOR_RIFT_LENS_LENGTH_MULT = cfgNumber(GAMEPLAY_CONFIG.survivorAbilities?.riftLensLengthMultiplier, 1.55);
const SURVIVOR_RIFT_LENS_ANGLE_MULT = cfgNumber(GAMEPLAY_CONFIG.survivorAbilities?.riftLensAngleMultiplier, 1.38);
const VOID_SPEED_BUFF_MULT = cfgNumber(GAMEPLAY_CONFIG.voidAbilities?.speedBuffMultiplier, 1.28);
const RED_ORB_SLOW_MULT = cfgNumber(GAMEPLAY_CONFIG.voidAbilities?.redOrbSlowMultiplier, 0.55);
const RED_ORB_SLOW_SECONDS = cfgNumber(GAMEPLAY_CONFIG.voidAbilities?.redOrbSlowSeconds, 0.5);
const DOT_DEPOSIT_DISTANCE = cfgNumber(GAMEPLAY_CONFIG.rift?.depositDistance, 96);
const DOT_DEPOSIT_SECONDS = cfgNumber(GAMEPLAY_CONFIG.rift?.depositSecondsPerOrb, 1.5);
// Chain is still tracked for audio pitch / UI feedback, but it no longer changes deposit speed.
const DOT_DEPOSIT_MAX_CHAIN = cfgNumber(GAMEPLAY_CONFIG.rift?.maxDepositChain, 30);
const DOT_REPAIR_PROGRESS = 1 / DOTS_PER_GENERATOR;
const DOT_MIN_TILE_SPACING = cfgNumber(GAMEPLAY_CONFIG.orbs?.minTileSpacing, 3.0);
const DOT_MIN_OBJECTIVE_TILE_DIST = cfgNumber(GAMEPLAY_CONFIG.orbs?.minObjectiveTileDistance, 1.8);
const DOT_SPAWN_FLOOR_RATIO = cfgNumber(GAMEPLAY_CONFIG.orbs?.spawnFloorRatio, 0.032);
const DOT_SPAWN_MIN = cfgNumber(GAMEPLAY_CONFIG.orbs?.spawnMin, 16);
const DOT_MAX_ON_MAP = cfgNumber(GAMEPLAY_CONFIG.orbs?.maxOnMap, 38);
const DOT_SPAWN_MAX = DOT_MAX_ON_MAP;
const DOT_RESPAWN_SECONDS = cfgNumber(GAMEPLAY_CONFIG.orbs?.respawnSeconds, 2.2);
const DOT_RESPAWN_BATCH = cfgNumber(GAMEPLAY_CONFIG.orbs?.respawnBatch, 3);
const TERROR_RADIUS = cfgNumber(GAMEPLAY_CONFIG.chase?.terrorRadius, 760);
const CHASE_START_RADIUS = cfgNumber(GAMEPLAY_CONFIG.chase?.startRadius, 520);
const CHASE_HOLD_SECONDS = cfgNumber(GAMEPLAY_CONFIG.chase?.holdSeconds, 3);
const CLOSE_REVEAL_RADIUS = cfgNumber(GAMEPLAY_CONFIG.chase?.closeRevealRadius, 120);
const SURVIVOR_CONE_LENGTH = cfgNumber(GAMEPLAY_CONFIG.survivor?.coneLength, 620);
const SURVIVOR_CONE_ANGLE = cfgNumber(GAMEPLAY_CONFIG.survivor?.coneAngle, Math.PI / 2.6);
const KILLER_CONE_LENGTH = cfgNumber(GAMEPLAY_CONFIG.void?.coneLength, 920);
const KILLER_CONE_ANGLE = cfgNumber(GAMEPLAY_CONFIG.void?.coneAngle, Math.PI / 1.75);
const KILLER_SCRATCH_MARK_VISIBILITY_RANGE = cfgNumber(GAMEPLAY_CONFIG.void?.scratchMarkVisibilityRange, 520);
const MUSIC_LAYER_1_VOLUME = cfgNumber(GAMEPLAY_CONFIG.chase?.musicLayer1Volume, 0.12);
const MUSIC_LAYER_2_MAX_VOLUME = cfgNumber(GAMEPLAY_CONFIG.chase?.musicLayer2MaxVolume, 0.30);
const MUSIC_LAYER_3_VOLUME = cfgNumber(GAMEPLAY_CONFIG.chase?.musicLayer3Volume, 0.30);
const BOT_REPATH_MIN = cfgNumber(GAMEPLAY_CONFIG.bots?.repathMin, 0.32);
const BOT_REPATH_MAX = cfgNumber(GAMEPLAY_CONFIG.bots?.repathMax, 0.68);
const BOT_SURVIVOR_THREAT_RADIUS = cfgNumber(GAMEPLAY_CONFIG.bots?.survivorThreatRadius, 640);
const BOT_SURVIVOR_PANIC_RADIUS = cfgNumber(GAMEPLAY_CONFIG.bots?.survivorPanicRadius, 285);
const BOT_SURVIVOR_LOOP_RADIUS = cfgNumber(GAMEPLAY_CONFIG.bots?.survivorLoopRadius, 430);
const BOT_SURVIVOR_RESCUE_RADIUS = cfgNumber(GAMEPLAY_CONFIG.bots?.survivorRescueRadius, 920);
const BOT_SURVIVOR_HEAL_RADIUS = cfgNumber(GAMEPLAY_CONFIG.bots?.survivorHealRadius, 760);
const BOT_SURVIVOR_SAFE_KILLER_DISTANCE = cfgNumber(GAMEPLAY_CONFIG.bots?.survivorSafeKillerDistance, 520);
const BOT_SURVIVOR_ABILITY_THREAT_RADIUS = cfgNumber(GAMEPLAY_CONFIG.bots?.survivorAbilityThreatRadius, 560);
const BOT_KILLER_MEMORY_SECONDS = cfgNumber(GAMEPLAY_CONFIG.bots?.voidMemorySeconds, 7.5);
const BOT_KILLER_SCRATCH_MEMORY_SECONDS = cfgNumber(GAMEPLAY_CONFIG.bots?.voidScratchMemorySeconds, 3.25);
const BOT_KILLER_INTERACT_COOLDOWN = cfgNumber(GAMEPLAY_CONFIG.bots?.voidInteractCooldown, 1.05);
const BOT_KILLER_WINDOW_REUSE_COOLDOWN = cfgNumber(GAMEPLAY_CONFIG.bots?.voidWindowReuseCooldown, 0.85);
const BOT_KILLER_STUCK_SECONDS = cfgNumber(GAMEPLAY_CONFIG.bots?.voidStuckSeconds, 0.72);
const BOT_KILLER_HOOK_PURSUIT_RADIUS = cfgNumber(GAMEPLAY_CONFIG.bots?.voidHookPursuitRadius, 980);
const BOT_KILLER_ABILITY_CHASE_RADIUS = cfgNumber(GAMEPLAY_CONFIG.bots?.voidAbilityChaseRadius, 720);
const BOT_PATH_STUCK_REPATH_DISTANCE = cfgNumber(GAMEPLAY_CONFIG.bots?.pathStuckRepathDistance, 7);
const BOT_SURVIVOR_STUCK_SECONDS = Math.max(0.8, cfgNumber(GAMEPLAY_CONFIG.bots?.survivorStuckSeconds, 1.0));
const BOT_SURVIVOR_OBJECTIVE_STALL_SECONDS = Math.max(0.85, cfgNumber(GAMEPLAY_CONFIG.bots?.survivorObjectiveStallSeconds, 1.0));
// AI quality is useless if it burns the tick loop. Keep expensive A* calls on a small
// per-think budget and use cheap tactical estimates for broad scoring sweeps.
const BOT_EXACT_ROUTE_BUDGET_BASE = cfgNumber(GAMEPLAY_CONFIG.bots?.exactRouteBudgetBase, IS_BOOSTED_HOST ? 18 : 12);
const BOT_EXACT_ROUTE_BUDGET_PER_BOT = cfgNumber(GAMEPLAY_CONFIG.bots?.exactRouteBudgetPerBot, IS_BOOSTED_HOST ? 5 : 3);
const BOT_FLEE_SCAN_RADIUS = cfgNumber(GAMEPLAY_CONFIG.bots?.fleeScanRadius, 6);
const BOT_FLEE_SAMPLE_STRIDE = Math.max(1, Math.floor(cfgNumber(GAMEPLAY_CONFIG.bots?.fleeSampleStride, 2)));
const BOT_MAX_LOOP_CANDIDATES = Math.max(3, Math.floor(cfgNumber(GAMEPLAY_CONFIG.bots?.maxLoopCandidates, 7)));
const BOT_MAX_DOT_CANDIDATES = Math.max(6, Math.floor(cfgNumber(GAMEPLAY_CONFIG.bots?.maxDotCandidates, 14)));
const BOT_SURVIVOR_FLEE_COMMIT_SECONDS = Math.max(1.35, cfgNumber(GAMEPLAY_CONFIG.bots?.survivorFleeCommitSeconds, 1.45));
const BOT_SURVIVOR_OBJECTIVE_COMMIT_SECONDS = Math.max(1.75, cfgNumber(GAMEPLAY_CONFIG.bots?.survivorObjectiveCommitSeconds, 2.15));
const BOT_SURVIVOR_MIN_DECISION_LOCK_SECONDS = Math.max(1.2, cfgNumber(GAMEPLAY_CONFIG.bots?.survivorMinDecisionLockSeconds, 1.55));
const BOT_SURVIVOR_FAR_OBSERVED_DISTANCE = Math.max(BOT_SURVIVOR_PANIC_RADIUS * 1.55, cfgNumber(GAMEPLAY_CONFIG.bots?.survivorFarObservedDistance, 470));
const BOT_SURVIVOR_TASK_REACHED_DISTANCE = cfgNumber(GAMEPLAY_CONFIG.bots?.survivorTaskReachedDistance, 44);
// Runner bots need a separate "oh no, The Void is basically touching me" mode.
// Treating this like normal flee scoring makes them compare almost-equal escape tiles and
// jitter in place while a stationary killer watches. Tiny ballet of failure.
const BOT_SURVIVOR_CONTACT_RADIUS = Math.max(150, cfgNumber(GAMEPLAY_CONFIG.bots?.survivorContactRadius, 178));
const BOT_SURVIVOR_FLEE_PROGRESS_SECONDS = cfgNumber(GAMEPLAY_CONFIG.bots?.survivorFleeProgressSeconds, 0.62);
const BOT_SURVIVOR_FLEE_PROGRESS_MIN_GAIN = cfgNumber(GAMEPLAY_CONFIG.bots?.survivorFleeProgressMinGain, 24);
const BOT_SURVIVOR_EMERGENCY_FLEE_SECONDS = cfgNumber(GAMEPLAY_CONFIG.bots?.survivorEmergencyFleeSeconds, 1.55);
const BOT_SURVIVOR_PRESSURE_RADIUS = Math.max(BOT_SURVIVOR_LOOP_RADIUS + 76, cfgNumber(GAMEPLAY_CONFIG.bots?.survivorPressureRadius, 515));
const BOT_SURVIVOR_DANGER_CORRIDOR_RADIUS = Math.max(BOT_SURVIVOR_PANIC_RADIUS * 1.05, cfgNumber(GAMEPLAY_CONFIG.bots?.survivorDangerCorridorRadius, 335));
const BOT_SURVIVOR_AVOID_KILLER_SECONDS = cfgNumber(GAMEPLAY_CONFIG.bots?.survivorAvoidKillerSeconds, 1.85);
const BOT_SURVIVOR_RISK_RUN_SECONDS = cfgNumber(GAMEPLAY_CONFIG.bots?.survivorRiskRunSeconds, 1.55);
// If a Runner bot hears The Void, objectives stop mattering for a moment.
// Otherwise they happily jog back to a shiny orb parked beside the killer, because apparently
// survival was not on the product roadmap.
const BOT_SURVIVOR_TERROR_FLEE_SECONDS = Math.max(3, cfgNumber(GAMEPLAY_CONFIG.bots?.survivorTerrorFleeSeconds, 3));
const BOT_SURVIVOR_TERROR_OBJECTIVE_AVOID_SECONDS = Math.max(4.5, cfgNumber(GAMEPLAY_CONFIG.bots?.survivorTerrorObjectiveAvoidSeconds, 6.5));
const BOT_SURVIVOR_ORB_DANGER_RADIUS = Math.max(BOT_SURVIVOR_LOOP_RADIUS, cfgNumber(
  GAMEPLAY_CONFIG.bots?.survivorOrbDangerRadius,
  Math.min(TERROR_RADIUS * 0.72, BOT_SURVIVOR_SAFE_KILLER_DISTANCE)
));
const BOT_SURVIVOR_LOOP_CHAIN_RADIUS = Math.max(BOT_SURVIVOR_LOOP_RADIUS * 1.55, cfgNumber(GAMEPLAY_CONFIG.bots?.survivorLoopChainRadius, 760));
const BOT_SURVIVOR_LOOP_COMMIT_SECONDS = Math.max(1.6, cfgNumber(GAMEPLAY_CONFIG.bots?.survivorLoopCommitSeconds, 2.15));
const BOT_SURVIVOR_DEADZONE_EDGE_TILES = Math.max(2.2, cfgNumber(GAMEPLAY_CONFIG.bots?.survivorDeadzoneEdgeTiles, 3.15));
const BOT_SURVIVOR_CORNER_EDGE_TILES = Math.max(2.8, cfgNumber(GAMEPLAY_CONFIG.bots?.survivorCornerEdgeTiles, 3.6));
const BOT_SURVIVOR_STALL_REDIRECT_SECONDS = Math.max(0.8, cfgNumber(GAMEPLAY_CONFIG.bots?.survivorStallRedirectSeconds, 1.0));

const CHAT_MESSAGE_DURATION = 3.0;
const CHAT_WHEEL_MESSAGES = RIFTRUNNER_CHATS.chatWheel || {
  survivor: {
    normal: ["Feed this rift.", "Stay close.", "Void nearby.", "I heard something."],
    chase: ["Void on me.", "Keep moving!", "I need distance.", "Do not come here."],
    injured: ["I need healing.", "Hold still near me.", "I need cover.", "Over here."],
    downed: ["Pick me up.", "I need help.", "I am down.", "Not ideal."],
    hooked: ["Get me down.", "I need a rescue.", "Void is close.", "Hurry."]
  },
  killer: ["I hear you.", "Run while you can.", "The dark is moving.", "You are close."]
};
const CHAT_AUTOMATIC = RIFTRUNNER_CHATS.automatic || {};

const VOID_ESCAPE_CHAT_LINES = CHAT_AUTOMATIC.voidEscape || [
  "I'm almost out!",
  "The void is opening...",
  "Hold on, I'm slipping through!",
  "I can see the other side!",
  "Almost home...",
  "Don't close on me now...",
  "My planet better have snacks."
];

function randomVoidEscapeLine() {
  return VOID_ESCAPE_CHAT_LINES[Math.floor(Math.random() * VOID_ESCAPE_CHAT_LINES.length)];
}

const MATCH_START_SURVIVOR_LINES = CHAT_AUTOMATIC.matchStartRunner || [
  "I need to get back to my planet...",
  "I have to restore our galaxy.",
  "It's my time to shine!",
  "Okay... don't panic. Definitely don't panic.",
  "The rifts are calling again.",
  "If I survive this, I am taking a nap in orbit.",
  "Stay bright. Stay alive.",
  "I should probably stop glowing and start moving."
];

const ORB_FULL_CHAT_MESSAGES = CHAT_AUTOMATIC.orbFull || [
  "I have too many orbs...",
  "I should deposit these",
  "I can't pick any more up.",
  "I'm getting full..."
];

const SURVIVOR_HIT_CHAT_LINES = CHAT_AUTOMATIC.hit || [
  "Ouch...!",
  "That really hurt.",
  "Okay, rude.",
  "My bones have notes.",
  "That was unnecessary.",
  "I felt that in my orbit.",
  "Personal space, please."
];

const SURVIVOR_HIT_WITH_ORBS_CHAT_LINES = CHAT_AUTOMATIC.hitWithOrbs || [
  "My orbs!",
  "Not the orbs!",
  "I was using those!",
  "Great, there goes my stash.",
  "My precious space marbles!"
];

const SURVIVOR_DOWNED_CHAT_LINES = CHAT_AUTOMATIC.downed || [
  "I got got...",
  "You got me...",
  "Finally...",
  "This is fine.",
  "Tell my orbs I loved them.",
  "I meant to lie down.",
  "Okay, dramatic.",
  "I regret several decisions.",
  "The floor and I are friends now."
];

const SURVIVOR_DOWNED_WITH_ORBS_EXTRA_CHAT_LINES = CHAT_AUTOMATIC.downedWithOrbsExtra || [
  "There go the orbs...",
  "I was saving those..."
];

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function randomSurvivorHitLine(hadOrbs = false) {
  const pool = hadOrbs && Math.random() < 0.48
    ? SURVIVOR_HIT_WITH_ORBS_CHAT_LINES
    : SURVIVOR_HIT_CHAT_LINES;
  return randomFrom(pool);
}

function randomSurvivorDownedLine(hadOrbs = false) {
  const pool = hadOrbs
    ? [...SURVIVOR_DOWNED_CHAT_LINES, ...SURVIVOR_DOWNED_WITH_ORBS_EXTRA_CHAT_LINES]
    : SURVIVOR_DOWNED_CHAT_LINES;
  return randomFrom(pool);
}

function isOrbFullChatMessage(message) {
  return ORB_FULL_CHAT_MESSAGES.includes(message);
}

function clearOrbFullChat(actor) {
  if (!actor || !isOrbFullChatMessage(actor.chatText)) return;
  clearActorChat(actor);
}

function randomMatchStartSurvivorLine() {
  return MATCH_START_SURVIVOR_LINES[Math.floor(Math.random() * MATCH_START_SURVIVOR_LINES.length)];
}

function setActorChat(actor, message, game, duration = CHAT_MESSAGE_DURATION) {
  if (!actor || !message) return;
  actor.chatText = message;
  actor.chatUntil = (game?.time || 0) + duration;
}

function clearActorChat(actor) {
  if (!actor) return;
  actor.chatText = null;
  actor.chatUntil = 0;
}

function getSurvivorChatState(actor) {
  if (!actor || actor.role !== "survivor") return "normal";
  if (actor.hooked) return "hooked";
  if (actor.downed || actor.health <= 0) return "downed";
  if (actor.chaseHold > 0) return "chase";
  if (actor.injured || actor.health <= 1) return "injured";
  return "normal";
}

function getChatWheelMessagesForActor(actor) {
  if (actor?.role === "killer") return CHAT_WHEEL_MESSAGES.killer;
  const survivorMessages = CHAT_WHEEL_MESSAGES.survivor;
  return survivorMessages[getSurvivorChatState(actor)] || survivorMessages.normal;
}


function getVoidAbilityDef(id) {
  const key = String(id || "");
  const ability = VOID_ABILITY_DEFS[key];
  if (!ability || ability.cancel || !VOID_ABILITY_ORDER.includes(key)) return null;
  return {
    id: ability.id || key,
    name: ability.name || key,
    cost: Math.max(0, Math.floor(cfgNumber(ability.cost, 0))),
    duration: Math.max(0, cfgNumber(ability.duration, 0)),
    radius: Math.max(0, cfgNumber(ability.radius, 0)),
    stealPerRunner: Math.max(0, Math.floor(cfgNumber(ability.stealPerRunner, 1))),
    stealPercent: clamp(cfgNumber(ability.stealPercent, 0), 0, 1),
    cooldown: Math.max(0, cfgNumber(ability.cooldown, 20))
  };
}

function applyVoidAbility(game, actor, abilityId) {
  if (!game || !actor || actor.role !== "killer" || actor.dead) {
    return { ok: false, message: "Only The Void can use abilities." };
  }
  if ((game.time || 0) < (game.matchStartFreezeSeconds || MATCH_START_FREEZE_SECONDS)) {
    return { ok: false, message: "The Void is still forming." };
  }
  if ((actor.voidStun || 0) > 0 || actor.vault || actor.breakTarget) {
    return { ok: false, message: "The Void cannot use that right now." };
  }

  const ability = getVoidAbilityDef(abilityId);
  if (!ability) return { ok: false, message: "Unknown Void ability." };
  const cooldowns = actor.voidAbilityCooldowns || (actor.voidAbilityCooldowns = {});
  const remainingCooldown = Math.max(0, cfgNumber(cooldowns[ability.id], 0));
  if (remainingCooldown > 0) {
    return { ok: false, message: `${ability.name} is cooling down for ${Math.ceil(remainingCooldown)}s.` };
  }

  const currentOrbs = Math.max(0, Math.floor(actor.dots || 0));
  if (currentOrbs < ability.cost) {
    return { ok: false, message: `${ability.name} needs ${ability.cost} orbs.` };
  }

  let affected = 0;
  let stolen = 0;

  if (ability.id === "nullRush") {
    actor.voidSpeedBoost = Math.max(actor.voidSpeedBoost || 0, ability.duration || 10);
  } else if (ability.id === "redshiftOrbs") {
    game.redOrbs = Math.max(game.redOrbs || 0, ability.duration || 15);
  } else if (ability.id === "voidReveal") {
    game.runnerReveal = Math.max(game.runnerReveal || 0, ability.duration || 5);
    affected = [...game.actors.values()].filter((runner) => runner.role === "survivor" && !runner.dead && !runner.escaped).length;
  } else {
    return { ok: false, message: "That Void ability is not ready." };
  }

  actor.dots = clamp(currentOrbs - ability.cost + stolen, 0, KILLER_DOT_MAX);
  cooldowns[ability.id] = ability.cooldown || 20;
  awardStat(actor, "abilitiesUsed", "Ability used", 1, "void");
  addEvent(game, "voidAbility", {
    x: actor.x,
    y: actor.y,
    actorId: actor.id,
    killerId: actor.id,
    abilityId: ability.id,
    name: ability.name,
    cost: ability.cost,
    duration: ability.duration,
    radius: null,
    affected,
    stolen,
    voidDots: actor.dots,
    redOrbs: game.redOrbs || 0,
    runnerReveal: game.runnerReveal || 0,
    speedBoost: actor.voidSpeedBoost || 0,
    cooldown: cooldowns[ability.id] || 0
  });
  return { ok: true };
}


function getSurvivorAbilityDef(id) {
  const key = String(id || "");
  const ability = SURVIVOR_ABILITY_DEFS[key];
  if (!ability || ability.cancel || ability.disabled || !SURVIVOR_ABILITY_ORDER.includes(key)) return null;
  return {
    id: ability.id || key,
    name: ability.name || key,
    cost: Math.max(0, Math.floor(cfgNumber(ability.cost, 0))),
    duration: Math.max(0, cfgNumber(ability.duration, 0)),
    cooldown: Math.max(0, cfgNumber(ability.cooldown, 30))
  };
}

function survivorVisionLengthFor(actor) {
  const base = SURVIVOR_CONE_LENGTH;
  return actor?.role === "survivor" && (actor.riftLens || 0) > 0
    ? base * SURVIVOR_RIFT_LENS_LENGTH_MULT
    : base;
}

function survivorVisionAngleFor(actor) {
  const base = SURVIVOR_CONE_ANGLE;
  return actor?.role === "survivor" && (actor.riftLens || 0) > 0
    ? Math.min(Math.PI * 1.08, base * SURVIVOR_RIFT_LENS_ANGLE_MULT)
    : base;
}

function applySurvivorAbility(game, actor, abilityId) {
  if (!game || !actor || actor.role !== "survivor" || actor.dead || actor.escaped) {
    return { ok: false, message: "Only Runners can use that." };
  }
  if ((game.time || 0) < (game.matchStartFreezeSeconds || MATCH_START_FREEZE_SECONDS)) {
    return { ok: false, message: "The run has not started yet." };
  }
  if (actor.hooked || actor.downed || actor.vault || actor.actionLock > 0) {
    return { ok: false, message: "You cannot use that right now." };
  }

  const ability = getSurvivorAbilityDef(abilityId);
  if (!ability) return { ok: false, message: "Unknown Runner ability." };

  const cooldowns = actor.survivorAbilityCooldowns || (actor.survivorAbilityCooldowns = {});
  const remainingCooldown = Math.max(0, cfgNumber(cooldowns[ability.id], 0));
  if (remainingCooldown > 0) {
    return { ok: false, message: `${ability.name} is cooling down for ${Math.ceil(remainingCooldown)}s.` };
  }

  const currentOrbs = Math.max(0, Math.floor(actor.dots || 0));
  if (currentOrbs < ability.cost) {
    return { ok: false, message: `${ability.name} needs ${ability.cost} orbs.` };
  }

  if (ability.id === "stealthStep") {
    actor.stealthStep = Math.max(actor.stealthStep || 0, ability.duration || 10);
  } else if (ability.id === "riftLens") {
    actor.riftLens = Math.max(actor.riftLens || 0, ability.duration || 15);
  } else {
    return { ok: false, message: "That Runner ability is not ready." };
  }

  actor.dots = clamp(currentOrbs - ability.cost, 0, SURVIVOR_DOT_MAX);
  cooldowns[ability.id] = ability.cooldown || 30;
  addEvent(game, "survivorAbility", {
    x: actor.x,
    y: actor.y,
    actorId: actor.id,
    survivorId: actor.id,
    abilityId: ability.id,
    name: ability.name,
    cost: ability.cost,
    duration: ability.duration,
    survivorDots: actor.dots,
    stealthStep: actor.stealthStep || 0,
    riftLens: actor.riftLens || 0,
    cooldown: cooldowns[ability.id] || 0
  });
  return { ok: true };
}

let nextLobbyNumber = 1;
const lobbies = new Map();
const socketToLobby = new Map();

const EVENT_LIMITS = Object.freeze({
  input: { limit: 90, intervalMs: 1000 },
  lobby: { limit: 16, intervalMs: 5000 },
  action: { limit: 12, intervalMs: 3000 },
  chat: { limit: 8, intervalMs: 3000 }
});

function cleanString(value, fallback, maxLength) {
  const text = String(value ?? fallback)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return (text || fallback).slice(0, maxLength);
}

function sanitizePlayerName(value) {
  return cleanString(value, "Player", 18);
}

function sanitizeLobbyName(value) {
  return cleanString(value, `Open Lobby ${nextLobbyNumber++}`, 28);
}

function touchLobby(lobby) {
  if (lobby) lobby.lastActivityAt = nowMs();
}

function detachLobbySockets(lobby, message = "Lobby closed.") {
  if (!lobby) return;
  for (const socketId of lobby.players.keys()) {
    const socket = io.sockets.sockets.get(socketId);
    socketToLobby.delete(socketId);
    if (socket) {
      socket.leave(lobby.id);
      socket.emit("toast", { type: "info", message });
    }
  }
}

function cleanupStaleLobbies() {
  const now = nowMs();
  let removed = false;
  for (const lobby of lobbies.values()) {
    const players = [...lobby.players.values()];
    const hasHuman = players.some((p) => !p.isBot);
    const lastActivity = lobby.lastActivityAt || lobby.createdAt || now;
    const endedAt = lobby.game?.endedAt || lastActivity;

    if (!hasHuman) {
      detachLobbySockets(lobby, "Empty lobby closed.");
      lobbies.delete(lobby.id);
      removed = true;
      continue;
    }

    if (lobby.phase === "ended" && now - endedAt > ENDED_LOBBY_TTL_MS) {
      detachLobbySockets(lobby, "Finished match lobby closed.");
      lobbies.delete(lobby.id);
      removed = true;
      continue;
    }

    if (lobby.phase === "lobby" && now - lastActivity > LOBBY_IDLE_TTL_MS) {
      detachLobbySockets(lobby, "Idle lobby closed.");
      lobbies.delete(lobby.id);
      removed = true;
    }
  }
  if (removed) broadcastLobbyList();
}

function allowSocketEvent(socket, key, options = {}) {
  const limit = options.limit || EVENT_LIMITS[key]?.limit || 10;
  const intervalMs = options.intervalMs || EVENT_LIMITS[key]?.intervalMs || 1000;
  const now = nowMs();
  socket.data.rateLimits ||= {};
  let bucket = socket.data.rateLimits[key];
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + intervalMs, warned: false };
    socket.data.rateLimits[key] = bucket;
  }
  bucket.count += 1;
  if (bucket.count <= limit) return true;
  if (!bucket.warned) {
    bucket.warned = true;
    socket.emit("toast", { type: "error", message: "Slow down a bit. The server rejected extra requests." });
  }
  return false;
}

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}

function nowMs() {
  return Date.now();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq <= 0.0001) return dist(px, py, ax, ay);
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / lengthSq, 0, 1);
  return dist(px, py, ax + abx * t, ay + aby * t);
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function pointInRect(x, y, r) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function actorRect(actor, x = actor.x, y = actor.y) {
  const size = actor.role === "killer" ? KILLER_SIZE : PLAYER_SIZE;
  return { x: x - size / 2, y: y - size / 2, w: size, h: size };
}

function centerOf(obj) {
  return { x: obj.x + obj.w / 2, y: obj.y + obj.h / 2 };
}

function normalizeRows(rows) {
  const width = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => r.padEnd(width, "."));
}

function orientationForWindow(rows, cx, cy) {
  const left = rows[cy]?.[cx - 1] === "X";
  const right = rows[cy]?.[cx + 1] === "X";
  const up = rows[cy - 1]?.[cx] === "X";
  const down = rows[cy + 1]?.[cx] === "X";
  if ((left || right) && !(up && down)) return "horizontal";
  if ((up || down) && !(left && right)) return "vertical";
  return left || right ? "horizontal" : "vertical";
}

function resolveRequiredGenerators(mapDef, generatorCandidateCount, fallback = DEFAULT_REQUIRED_GENERATORS_TO_COMPLETE) {
  if (generatorCandidateCount <= 0) return 0;

  const raw = mapDef?.requiredGenerators
    ?? mapDef?.requiredRifts
    ?? mapDef?.requiredGens
    ?? mapDef?.required;

  if (typeof raw === "string") {
    const value = raw.trim().toLowerCase();
    if (value === "all") return generatorCandidateCount;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return clamp(Math.floor(parsed), 1, generatorCandidateCount);
    }
  }

  if (Number.isFinite(raw)) {
    return clamp(Math.floor(raw), 1, generatorCandidateCount);
  }

  return clamp(Math.floor(fallback), 1, generatorCandidateCount);
}

function resolveSpawnedGeneratorCount(mapDef, generatorCandidateCount, requiredCount) {
  if (generatorCandidateCount <= 0) return 0;

  const explicit = mapDef?.spawnedGenerators
    ?? mapDef?.spawnedRifts
    ?? mapDef?.totalGeneratorsToSpawn
    ?? mapDef?.totalRiftsToSpawn
    ?? mapDef?.generatorsToSpawn
    ?? mapDef?.riftsToSpawn
    ?? mapDef?.activeGenerators
    ?? mapDef?.activeRifts;

  let desired;

  if (typeof explicit === "string") {
    const value = explicit.trim().toLowerCase();
    if (value === "all") desired = generatorCandidateCount;
    else {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) desired = Math.floor(parsed);
    }
  } else if (Number.isFinite(explicit)) {
    desired = Math.floor(explicit);
  }

  // DBD-style default: spawn two more rifts than Survivors must seal.
  // Example: requiredGenerators: 5 -> 7 spawn. requiredGenerators: 7 -> 9 spawn.
  // If the map does not have enough G tiles, clamp safely instead of inventing rifts in a wall.
  if (!Number.isFinite(desired)) desired = requiredCount + 2;

  return clamp(desired, requiredCount, generatorCandidateCount);
}

function generatorSpreadScore(generators) {
  if (!Array.isArray(generators) || generators.length < 2) return 0;
  let minDistance = Infinity;
  let totalDistance = 0;
  let pairs = 0;

  for (let i = 0; i < generators.length; i++) {
    for (let j = i + 1; j < generators.length; j++) {
      const d = dist(generators[i].x, generators[i].y, generators[j].x, generators[j].y);
      minDistance = Math.min(minDistance, d);
      totalDistance += d;
      pairs++;
    }
  }

  return (Number.isFinite(minDistance) ? minDistance : 0) * 2.35 + (pairs ? totalDistance / pairs : 0);
}

function chooseSpreadGenerators(candidates, count, tile) {
  if (!Array.isArray(candidates) || candidates.length <= count) return [...(candidates || [])];
  if (count <= 0) return [];

  const attempts = Math.min(72, Math.max(18, candidates.length * 6));
  const layouts = [];

  for (let attempt = 0; attempt < attempts; attempt++) {
    const remaining = candidates.map((candidate, index) => ({ ...candidate, originalIndex: index }));
    const chosen = [];

    // Random first pick keeps every match from feeling stamped out by a bored factory.
    chosen.push(remaining.splice(Math.floor(Math.random() * remaining.length), 1)[0]);

    while (chosen.length < count && remaining.length) {
      const scored = remaining.map((candidate, index) => {
        let minToChosen = Infinity;
        let totalToChosen = 0;
        for (const picked of chosen) {
          const d = dist(candidate.x, candidate.y, picked.x, picked.y);
          minToChosen = Math.min(minToChosen, d);
          totalToChosen += d;
        }
        const avgToChosen = totalToChosen / chosen.length;
        const jitter = Math.random() * Math.max(24, tile * 0.45);
        return { index, score: minToChosen * 1.85 + avgToChosen * 0.22 + jitter };
      }).sort((a, b) => b.score - a.score);

      // Pick from the top cluster instead of always taking the absolute farthest point.
      // This keeps spacing strong while still letting each match vary.
      const eliteCount = Math.max(1, Math.ceil(scored.length * 0.45));
      const picked = scored[Math.floor(Math.random() * Math.min(eliteCount, 8))];
      chosen.push(remaining.splice(picked.index, 1)[0]);
    }

    layouts.push({ score: generatorSpreadScore(chosen), chosen });
  }

  layouts.sort((a, b) => b.score - a.score);
  // Use one of the best layouts instead of the single mathematical winner.
  // The single winner often repeats on small maps, which technically spaces rifts well
  // but feels about as random as a tax form.
  const strongLayouts = layouts.slice(0, Math.min(28, layouts.length));
  const selected = strongLayouts[Math.floor(Math.random() * strongLayouts.length)] || layouts[0] || { chosen: [] };

  return selected.chosen
    .map((candidate) => {
      const { originalIndex, ...generator } = candidate;
      return generator;
    })
    .sort((a, b) => (a.tileY - b.tileY) || (a.tileX - b.tileX));
}

function parseMap(mapDef) {
  if (!mapDef || !Array.isArray(mapDef.rows) || mapDef.rows.length === 0) {
    throw new Error("No valid Riftrunner map definition was found. Check public/maps.js and make sure at least one map has a rows array.");
  }
  const rows = normalizeRows(mapDef.rows);
  const tile = mapDef.tile || 72;
  const map = {
    name: mapDef.name || "Unnamed Map",
    tile,
    cols: rows[0].length,
    rows: rows.length,
    width: rows[0].length * tile,
    height: rows.length * tile,
    rawRows: rows,
    walls: [],
    windows: [],
    pallets: [],
    generators: [],
    gates: [],
    hooks: [],
    survivorSpawns: [],
    killerSpawns: []
  };

  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      const rx = x * tile;
      const ry = y * tile;
      const base = { x: rx, y: ry, w: tile, h: tile, tileX: x, tileY: y };
      if (ch === "X") map.walls.push({ ...base, id: uid("wall") });
      if (ch === "+") map.windows.push({ ...base, id: uid("window"), orientation: orientationForWindow(rows, x, y) });
      if (ch === "-") map.pallets.push({ ...base, id: uid("pallet"), orientation: "horizontal", state: "upright", broken: false });
      if (ch === "|") map.pallets.push({ ...base, id: uid("pallet"), orientation: "vertical", state: "upright", broken: false });
      if (ch === "G") map.generators.push({
        id: uid("gen"),
        x: rx + tile / 2,
        y: ry + tile / 2,
        tileX: x,
        tileY: y,
        progress: 0,
        done: false,
        activeRepairers: [],
        beingKicked: false,
        kickProgress: 0,
        // Prevent kick spam: after a successful kick, this stays true
        // until a survivor actually repairs this generator again.
        kickLocked: false
      });
      if (ch === "E") map.gates.push({ id: uid("gate"), x: rx + tile / 2, y: ry + tile / 2, open: false });
      if (ch === "P") map.survivorSpawns.push({ x: rx + tile / 2, y: ry + tile / 2 });
      if (ch === "K") map.killerSpawns.push({ x: rx + tile / 2, y: ry + tile / 2 });
    }
  }

  if (!map.survivorSpawns.length) map.survivorSpawns.push({ x: tile * 2, y: tile * 2 });
  if (!map.killerSpawns.length) map.killerSpawns.push({ x: map.width - tile * 3, y: map.height - tile * 3 });

  const generatorCandidates = map.generators;
  const requiredGenerators = resolveRequiredGenerators(mapDef, generatorCandidates.length);
  const spawnedGenerators = resolveSpawnedGeneratorCount(mapDef, generatorCandidates.length, requiredGenerators);
  const activeGenerators = chooseSpreadGenerators(generatorCandidates, spawnedGenerators, tile);

  map.generatorCandidateCount = generatorCandidates.length;
  map.spawnedGenerators = activeGenerators.length;
  map.requiredGenerators = clamp(requiredGenerators, 0, activeGenerators.length);
  map.generators = activeGenerators;
  return map;
}

function getMapRegistry() {
  return GAME_MAPS && typeof GAME_MAPS === "object" ? GAME_MAPS : {};
}

function getMapEntries() {
  return Object.entries(getMapRegistry())
    .filter(([id, mapDef]) => id !== "active" && mapDef && typeof mapDef === "object" && Array.isArray(mapDef.rows) && mapDef.rows.length > 0);
}

function getDefaultMapId() {
  const maps = getMapRegistry();
  const entries = getMapEntries();
  const activeId = typeof maps.active === "string" ? maps.active : null;

  if (activeId && entries.some(([id]) => id === activeId)) return activeId;
  if (entries.some(([id]) => id === "bloodyard")) return "bloodyard";
  return entries[0]?.[0] || null;
}

function resolveMapSelection(requestedMapId) {
  const maps = getMapRegistry();
  const entries = getMapEntries();
  const requestedId = typeof requestedMapId === "string" ? requestedMapId.trim() : "";
  const fallbackId = getDefaultMapId();
  const mapId = entries.some(([id]) => id === requestedId) ? requestedId : fallbackId;

  if (!mapId || !maps[mapId]) return null;
  return { id: mapId, def: maps[mapId] };
}

function getActiveMapDef() {
  return resolveMapSelection()?.def || null;
}

function getMapListForClient() {
  return getMapEntries().map(([id, mapDef]) => ({
    id,
    name: mapDef.name || id,
    requiredGenerators: mapDef.requiredGenerators ?? mapDef.requiredRifts ?? mapDef.requiredGens ?? mapDef.required ?? null
  }));
}

function solidRects(game) {
  const solids = [...game.map.walls, ...game.map.windows];
  for (const pallet of game.map.pallets) {
    if (!pallet.broken && pallet.state === "dropped") solids.push(pallet);
  }
  return solids;
}

function cachedMovementBlockingRects(game, role) {
  if (!game?.map) return [];
  const key = role === "survivor" ? "survivor" : "killer";
  const epoch = `${game.pathCacheEpoch || 0}:${areRiftsComplete(game) ? 1 : 0}`;
  if (!game.movementBlockerCache || game.movementBlockerCache.epoch !== epoch) {
    const solids = solidRects(game);
    game.movementBlockerCache = {
      epoch,
      killer: solids,
      survivor: [...solids, ...generatorCollisionRects(game)]
    };
  }
  return game.movementBlockerCache[key] || [];
}

function completedRiftCount(game) {
  return game?.map?.generators?.filter((g) => g.done).length || 0;
}

function areRiftsComplete(game) {
  const generators = game?.map?.generators || [];
  if (!generators.length) return false;
  const required = Number(game?.requiredGenerators ?? game?.map?.requiredGenerators ?? generators.length);
  if (!Number.isFinite(required) || required <= 0) return false;
  return completedRiftCount(game) >= required;
}

function visibleGeneratorsForSnapshot(game) {
  if (areRiftsComplete(game)) return [];
  return game?.map?.generators || [];
}

function generatorCollisionRects(game) {
  if (areRiftsComplete(game)) return [];
  const size = GENERATOR_COLLISION_SIZE;
  return game.map.generators.map((g) => ({
    id: g.id,
    x: g.x - size / 2,
    y: g.y - size / 2,
    w: size,
    h: size
  }));
}

function movementBlockingRects(game, actor) {
  // Cached because pathfinding/collision asks this hundreds of times per second.
  // Rebuilding wall/window/pallet/generator arrays in every wouldCollide() call was
  // one of the reasons the "smart" bots made humans move like they were underwater.
  return cachedMovementBlockingRects(game, actor?.role);
}

function visionBlockingRects(game) {
  // Only true walls block sight. Windows and dropped pallets block bodies, not eyeballs.
  return game.map.walls;
}

function attackBlockingRects(game) {
  // Attacks should not hit through walls, windows, or dropped pallets.
  return solidRects(game);
}

function attackHardBlockingRects(game) {
  const blockers = [...game.map.walls];
  for (const pallet of game.map.pallets) {
    if (!pallet.broken && pallet.state === "dropped") blockers.push(pallet);
  }
  return blockers;
}

function segmentCrossesRect(ax, ay, bx, by, rect) {
  return !segmentClearAgainst([rect], ax, ay, bx, by);
}

function survivorOnOppositeWindowTile(game, killerX, killerY, survivorX, survivorY, window) {
  const survivorTile = tileAt(game, survivorX, survivorY);
  const wx = window.tileX;
  const wy = window.tileY;
  if (Math.abs(survivorTile.x - wx) + Math.abs(survivorTile.y - wy) !== 1) return false;

  const c = centerOf(window);
  if (window.orientation === "horizontal") {
    if (survivorTile.x !== wx) return false;
    const killerSide = Math.sign(killerY - c.y);
    const survivorSide = Math.sign(survivorTile.y - wy);
    return killerSide !== 0 && survivorSide !== 0 && killerSide !== survivorSide;
  }

  if (survivorTile.y !== wy) return false;
  const killerSide = Math.sign(killerX - c.x);
  const survivorSide = Math.sign(survivorTile.x - wx);
  return killerSide !== 0 && survivorSide !== 0 && killerSide !== survivorSide;
}

function attackSegmentClearThroughWindow(game, ax, ay, bx, by) {
  for (const win of game.map.windows) {
    if (!segmentCrossesRect(ax, ay, bx, by, win)) continue;
    if (survivorOnOppositeWindowTile(game, ax, ay, bx, by, win)) return true;
  }
  return false;
}

function collisionBlockingRects(game, actor) {
  const blockers = movementBlockingRects(game, actor);
  if (!(actor?.palletGraceId && actor.palletGraceTime > 0)) return blockers;
  return blockers.filter((r) => {
    // If a survivor drops a pallet while standing still on top of the interaction zone,
    // give them a tiny pass-through grace on that one pallet so they can step out instead of
    // becoming part of the furniture. Humans apparently dislike being furniture.
    return r.id !== actor.palletGraceId;
  });
}

function wouldCollide(game, actor, x, y) {
  const box = actorRect(actor, x, y);
  return collisionBlockingRects(game, actor).some((r) => rectsOverlap(box, r));
}

function getCollisionRectsAt(game, actor, x = actor.x, y = actor.y) {
  const box = actorRect(actor, x, y);
  return collisionBlockingRects(game, actor).filter((r) => rectsOverlap(box, r));
}

function resolveActorOverlaps(game, actor, maxIterations = 6) {
  if (!game || !actor || actor.dead || actor.escaped || actor.hooked || actor.vault) return false;

  let moved = false;
  for (let i = 0; i < maxIterations; i++) {
    const box = actorRect(actor);
    const hits = collisionBlockingRects(game, actor).filter((r) => rectsOverlap(box, r));
    if (!hits.length) break;

    let best = null;
    for (const r of hits) {
      const pushLeft = (r.x - (box.x + box.w));
      const pushRight = ((r.x + r.w) - box.x);
      const pushUp = (r.y - (box.y + box.h));
      const pushDown = ((r.y + r.h) - box.y);
      const options = [
        { dx: pushLeft, dy: 0, amount: Math.abs(pushLeft) },
        { dx: pushRight, dy: 0, amount: Math.abs(pushRight) },
        { dx: 0, dy: pushUp, amount: Math.abs(pushUp) },
        { dx: 0, dy: pushDown, amount: Math.abs(pushDown) }
      ].filter((item) => item.amount > 0 && Number.isFinite(item.amount));
      const local = options.sort((a, b) => a.amount - b.amount)[0];
      if (local && (!best || local.amount < best.amount)) best = local;
    }

    if (!best) break;
    const padding = 0.75;
    actor.x = clamp(actor.x + best.dx + Math.sign(best.dx) * padding, 36, game.map.width - 36);
    actor.y = clamp(actor.y + best.dy + Math.sign(best.dy) * padding, 36, game.map.height - 36);
    moved = true;
  }

  return moved;
}

function bodySegmentClear(game, actor, ax, ay, bx, by, stepSize = 12) {
  const distance = dist(ax, ay, bx, by);
  const steps = Math.max(2, Math.ceil(distance / stepSize));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    if (wouldCollide(game, actor, x, y)) return false;
  }
  return true;
}

function moveActorWithCollision(game, actor, moveX, moveY, options = {}) {
  if (!game || !actor) return false;
  if (!Number.isFinite(moveX) || !Number.isFinite(moveY)) return false;

  resolveActorOverlaps(game, actor);

  const distance = Math.hypot(moveX, moveY);
  if (distance <= 0.0001) return false;

  let moved = false;
  const maxStep = options.maxStep || Math.max(7, Math.min(12, (actor.role === "killer" ? KILLER_SIZE : PLAYER_SIZE) * 0.32));
  const steps = Math.max(1, Math.ceil(distance / maxStep));
  const stepX = moveX / steps;
  const stepY = moveY / steps;

  for (let i = 0; i < steps; i++) {
    const startX = actor.x;
    const startY = actor.y;
    const desiredX = clamp(startX + stepX, 36, game.map.width - 36);
    const desiredY = clamp(startY + stepY, 36, game.map.height - 36);

    if (!wouldCollide(game, actor, desiredX, desiredY)) {
      actor.x = desiredX;
      actor.y = desiredY;
      moved = true;
      continue;
    }

    const tryX = !wouldCollide(game, actor, desiredX, startY);
    const tryY = !wouldCollide(game, actor, startX, desiredY);

    if (tryX && tryY) {
      // Pick the axis with the larger requested movement first so diagonal input slides
      // naturally along walls instead of trembling at corners like a nervous shopping cart.
      if (Math.abs(stepX) >= Math.abs(stepY)) {
        actor.x = desiredX;
        if (!wouldCollide(game, actor, actor.x, desiredY)) actor.y = desiredY;
      } else {
        actor.y = desiredY;
        if (!wouldCollide(game, actor, desiredX, actor.y)) actor.x = desiredX;
      }
      moved = true;
      continue;
    }

    if (tryX) {
      actor.x = desiredX;
      moved = true;
      continue;
    }

    if (tryY) {
      actor.y = desiredY;
      moved = true;
      continue;
    }

    // If both component moves are blocked, we are probably pressing into a convex corner
    // or already kissing a wall. Try several tiny peel-off moves so players and bots can
    // escape geometry pressure instead of getting welded to it.
    const len = Math.hypot(stepX, stepY) || 1;
    const nudge = Math.max(2, Math.min(8, len * 1.4));
    const tangentA = { x: (-stepY / len) * nudge, y: (stepX / len) * nudge };
    const tangentB = { x: -tangentA.x, y: -tangentA.y };
    const backOff = { x: (-stepX / len) * Math.min(4, nudge), y: (-stepY / len) * Math.min(4, nudge) };
    const halfA = { x: tangentA.x * 0.5, y: tangentA.y * 0.5 };
    const halfB = { x: tangentB.x * 0.5, y: tangentB.y * 0.5 };
    const cardinal = [
      { x: nudge, y: 0 },
      { x: -nudge, y: 0 },
      { x: 0, y: nudge },
      { x: 0, y: -nudge }
    ];
    let nudges = [tangentA, tangentB, halfA, halfB, backOff, ...cardinal];
    if (options.preferTarget && Number.isFinite(options.preferTarget.x) && Number.isFinite(options.preferTarget.y)) {
      nudges = nudges.sort((a, b) => (
        dist(startX + a.x, startY + a.y, options.preferTarget.x, options.preferTarget.y)
        - dist(startX + b.x, startY + b.y, options.preferTarget.x, options.preferTarget.y)
      ));
    }

    let nudged = false;
    for (const n of nudges) {
      const nx = clamp(startX + n.x, 36, game.map.width - 36);
      const ny = clamp(startY + n.y, 36, game.map.height - 36);
      if (!wouldCollide(game, actor, nx, ny)) {
        actor.x = nx;
        actor.y = ny;
        moved = true;
        nudged = true;
        break;
      }
    }

    if (!nudged) {
      resolveActorOverlaps(game, actor, 4);
      break;
    }
  }

  resolveActorOverlaps(game, actor, 2);
  return moved;
}

function segmentClearAgainst(blockers, ax, ay, bx, by) {
  const distance = dist(ax, ay, bx, by);
  const steps = Math.max(2, Math.ceil(distance / 18));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    if (blockers.some((r) => pointInRect(x, y, r))) return false;
  }
  return true;
}

function segmentClear(game, ax, ay, bx, by) {
  return segmentClearAgainst(visionBlockingRects(game), ax, ay, bx, by);
}

function attackSegmentClear(game, ax, ay, bx, by) {
  if (!segmentClearAgainst(attackHardBlockingRects(game), ax, ay, bx, by)) return false;
  if (segmentClearAgainst(game.map.windows, ax, ay, bx, by)) return true;
  return attackSegmentClearThroughWindow(game, ax, ay, bx, by);
}

function coneSees(viewer, target, length, angle) {
  const d = dist(viewer.x, viewer.y, target.x, target.y);
  if (d > length) return false;
  const a = Math.atan2(target.y - viewer.y, target.x - viewer.x);
  return angleDiff(a, viewer.angle || 0) <= angle / 2;
}

function createMatchStats(role) {
  if (role === "killer") {
    return {
      riftsKicked: 0,
      orbsCollected: 0,
      injures: 0,
      hooks: 0,
      deaths: 0,
      abilitiesUsed: 0
    };
  }
  return {
    orbsCollected: 0,
    orbsDeposited: 0,
    voidStuns: 0,
    teammatesHealed: 0,
    unhooks: 0,
    escaped: false,
    chaseSeconds: 0,
    longestChase: 0
  };
}

function ensureMatchStats(actor) {
  if (!actor) return createMatchStats("survivor");
  const defaults = createMatchStats(actor.role);
  actor.stats = { ...defaults, ...(actor.stats || {}) };
  return actor.stats;
}

function addStat(actor, key, amount = 1) {
  if (!actor || !key) return;
  const stats = ensureMatchStats(actor);
  stats[key] = Math.max(0, Number(stats[key] || 0) + amount);
}

function notifyScoreGain(actor, label, amount = 1, kind = "point") {
  if (!actor || !actor.id || !label) return;
  const value = Math.max(1, Math.floor(Number(amount) || 1));
  io.to(actor.id).emit("scoreGain", {
    label: String(label).slice(0, 42),
    amount: value,
    kind: String(kind || "point").slice(0, 18)
  });
}

function awardStat(actor, key, label, amount = 1, kind = "point") {
  addStat(actor, key, amount);
  notifyScoreGain(actor, label, amount, kind);
}

function serializeMatchStats(actor) {
  const stats = ensureMatchStats(actor);
  if (actor.role === "killer") {
    return {
      riftsKicked: Math.floor(stats.riftsKicked || 0),
      orbsCollected: Math.floor(stats.orbsCollected || 0),
      injures: Math.floor(stats.injures || 0),
      hooks: Math.floor(stats.hooks || 0),
      deaths: Math.floor(stats.deaths || 0),
      abilitiesUsed: Math.floor(stats.abilitiesUsed || 0)
    };
  }
  return {
    orbsCollected: Math.floor(stats.orbsCollected || 0),
    orbsDeposited: Math.floor(stats.orbsDeposited || 0),
    voidStuns: Math.floor(stats.voidStuns || 0),
    teammatesHealed: Math.floor(stats.teammatesHealed || 0),
    unhooks: Math.floor(stats.unhooks || 0),
    escaped: !!actor.escaped,
    chaseSeconds: Number((stats.chaseSeconds || 0).toFixed(1)),
    longestChase: Number((stats.longestChase || 0).toFixed(1))
  };
}

function getLobbySummary(lobby) {
  const players = [...lobby.players.values()];
  const survivors = players.filter((p) => p.role === "survivor").length;
  const killer = players.some((p) => p.role === "killer");
  return {
    id: lobby.id,
    name: lobby.name,
    mapId: lobby.mapId,
    mapName: lobby.mapName,
    phase: lobby.phase,
    playerCount: players.length,
    survivors,
    killer,
    maxSurvivors: MAX_SURVIVORS,
    createdAt: lobby.createdAt
  };
}

function broadcastLobbyList() {
  const list = [...lobbies.values()]
    .map(getLobbySummary)
    .sort((a, b) => a.createdAt - b.createdAt);
  io.emit("lobbyList", list);
}

function makePlayer(socket, role, name, options = {}) {
  return {
    id: socket.id,
    name: sanitizePlayerName(name),
    isBot: !!options.isBot,
    role,
    skin: role === "survivor" ? sanitizeSkin(options.skin) : "killerCircle",
    ready: false,
    x: 0,
    y: 0,
    angle: 0,
    health: role === "survivor" ? 2 : 999,
    dots: role === "survivor" ? 0 : 0,
    stats: createMatchStats(role),
    currentChaseSeconds: 0,
    dotFullNoticeCooldown: 0,
    dotDepositTargetId: null,
    dotDepositProgress: 0,
    dotDepositChain: 0,
    dead: false,
    escaped: false,
    spectateTargetId: null,
    downed: false,
    hooked: false,
    hookId: null,
    hookProgress: 0,
    unhookProgress: 0,
    hookCount: 0,
    hookActionTargetId: null,
    hookActionType: null,
    unhookTargetId: null,
    injured: false,
    invuln: 0,
    hitBoost: 0,
    healProgress: 0,
    activeHealers: [],
    healingTargetId: null,
    recovery: 0,
    voidStun: 0,
    voidSpeedBoost: 0,
    voidAbilityCooldowns: {},
    stealthStep: 0,
    riftLens: 0,
    survivorAbilityCooldowns: {},
    orbSlow: 0,
    voidSlow: 0,
    actionLock: 0,
    windowVaultCooldown: 0,
    palletVaultCooldown: 0,
    vault: null,
    breakTarget: null,
    attackCooldown: 0,
    attackState: null,
    attackType: null,
    attackTimer: 0,
    attackDuration: 0,
    attackCharge: 0,
    attackHasHit: false,
    attackNeedsRelease: false,
    attackStartup: 0,
    attackSweepStartX: 0,
    attackSweepStartY: 0,
    swingTime: 0,
    chaseHold: 0,
    // For chase music: once the survivor sees the killer during chase, keep layer_3 alive briefly
    // after they look away. This avoids frantic on/off music when checking behind you.
    killerVisibleHold: 0,
    chatText: null,
    chatUntil: 0,
    palletGraceId: null,
    palletGraceTime: 0,
    bot: {
      repath: 0,
      path: [],
      targetId: null,
      lastSeenX: 0,
      lastSeenY: 0,
      lastSeenTime: 0,
      goalX: 0,
      goalY: 0,
      stuckTimer: 0,
      lastX: 0,
      lastY: 0,
      actionCooldown: 0,
      fleeTimer: 0,
      fleeX: 0,
      fleeY: 0
    },
    input: {
      up: false,
      down: false,
      left: false,
      right: false,
      sprint: false,
      action: false,
      repair: false,
      attack: false,
      attackHeld: false,
      attackReleased: false,
      actionDir: null,
      angle: 0
    }
  };
}

function createLobby(name, requestedMapId) {
  cleanupStaleLobbies();
  if (lobbies.size >= MAX_LOBBIES) {
    throw new Error("The server has reached the lobby limit. Try again after a match ends.");
  }

  const selection = resolveMapSelection(requestedMapId);
  if (!selection) {
    throw new Error("Cannot create a lobby because public/maps.js does not contain any valid maps.");
  }

  const id = uid("lobby");
  const createdAt = nowMs();
  const lobby = {
    id,
    name: sanitizeLobbyName(name),
    mapId: selection.id,
    mapName: selection.def.name || selection.id,
    phase: "lobby",
    createdAt,
    lastActivityAt: createdAt,
    players: new Map(),
    game: null
  };
  lobbies.set(id, lobby);
  return lobby;
}

function joinLobby(socket, lobby, requestedRole, name, skin) {
  leaveCurrentLobby(socket);

  let role = requestedRole === "killer" ? "killer" : "survivor";
  const players = [...lobby.players.values()];
  const survivorCount = players.filter((p) => p.role === "survivor").length;

  // Multiple players are allowed to queue as The Void in the lobby.
  // The hard rule is enforced only when the match starts: exactly one Void.
  if (role === "survivor" && survivorCount >= MAX_SURVIVORS) {
    socket.emit("toast", { type: "error", message: "This lobby already has four Runners." });
    return false;
  }
  if (lobby.phase !== "lobby") {
    socket.emit("toast", { type: "error", message: "That lobby is already in a run." });
    return false;
  }

  const player = makePlayer(socket, role, name, { isBot: false, skin });
  lobby.players.set(socket.id, player);
  touchLobby(lobby);
  socketToLobby.set(socket.id, lobby.id);
  socket.join(lobby.id);
  socket.emit("joinedLobby", { lobbyId: lobby.id, playerId: socket.id });
  broadcastLobbyState(lobby);
  broadcastLobbyList();
  return true;
}

function leaveCurrentLobby(socket) {
  const lobbyId = socketToLobby.get(socket.id);
  if (!lobbyId) return;
  const lobby = lobbies.get(lobbyId);
  socketToLobby.delete(socket.id);
  socket.leave(lobbyId);

  if (!lobby) return;
  lobby.players.delete(socket.id);

  const humanCount = [...lobby.players.values()].filter((p) => !p.isBot).length;
  if (lobby.players.size === 0 || humanCount === 0) {
    lobbies.delete(lobby.id);
  } else {
    if (lobby.phase === "game" && lobby.game) {
      const actor = lobby.game.actors.get(socket.id);
      if (actor) {
        if (actor.role === "killer") {
          endGame(lobby, "survivors", "The Void disconnected. The Runners slip away.");
        } else {
          actor.dead = true;
          checkWinConditions(lobby);
        }
      }
    }
    touchLobby(lobby);
    broadcastLobbyState(lobby);
  }
  broadcastLobbyList();
}

function broadcastLobbyState(lobby) {
  io.to(lobby.id).emit("lobbyState", {
    id: lobby.id,
    name: lobby.name,
    phase: lobby.phase,
    mapId: lobby.mapId,
    mapName: lobby.mapName,
    maxSurvivors: MAX_SURVIVORS,
    players: [...lobby.players.values()].map((p) => ({ id: p.id, name: p.name, role: p.role, skin: p.skin || "blueSquare", ready: p.isBot ? true : p.ready, isBot: !!p.isBot }))
  });
}

function addBotToLobby(lobby, role) {
  if (!lobby || lobby.phase !== "lobby") return { ok: false, message: "Bots can only be added in the lobby." };
  const roleValue = role === "killer" ? "killer" : "survivor";
  const players = [...lobby.players.values()];
  if (roleValue === "survivor" && players.filter((p) => p.role === "survivor").length >= MAX_SURVIVORS) {
    return { ok: false, message: "Runner slots are full." };
  }
  const id = uid("bot");
  const count = players.filter((p) => p.isBot && p.role === roleValue).length + 1;
  const name = roleValue === "killer" ? `Void Bot ${count}` : `Runner Bot ${count}`;
  const bot = makePlayer({ id }, roleValue, name, { isBot: true, skin: ["blueSquare", "yellowStar", "purplePentagon", "nebulaBloom", "eclipseWisp", "riftMoth", "signalDrone"][count % 7] });
  bot.ready = true;
  lobby.players.set(id, bot);
  touchLobby(lobby);
  return { ok: true };
}

function removeBotFromLobby(lobby, botId) {
  if (!lobby || lobby.phase !== "lobby") return { ok: false, message: "Bots can only be removed in the lobby." };
  const id = String(botId || "");
  const bot = lobby.players.get(id);
  if (!bot || !bot.isBot) return { ok: false, message: "That bot is no longer in the lobby." };
  lobby.players.delete(id);
  touchLobby(lobby);
  return { ok: true };
}

function canChangeRole(lobby, player, role) {
  if (role === player.role) return true;
  const players = [...lobby.players.values()].filter((p) => p.id !== player.id);
  if (role === "killer") return true;
  if (role === "survivor") return players.filter((p) => p.role === "survivor").length < MAX_SURVIVORS;
  return false;
}

function startGame(lobby) {
  const players = [...lobby.players.values()];
  const killers = players.filter((p) => p.role === "killer");
  const survivors = players.filter((p) => p.role === "survivor");
  if (lobby.phase !== "lobby") return false;
  if (killers.length !== 1 || survivors.length < 1) {
    const voidCount = killers.length;
    const message = voidCount === 0
      ? "Need exactly 1 Void and at least 1 Runner. Nobody chose The Void yet."
      : voidCount > 1
        ? `Only 1 Void can start the run. ${voidCount} are selected right now.`
        : "Need at least 1 Runner to start.";
    io.to(lobby.id).emit("toast", { type: "error", message });
    return false;
  }

  for (const player of players) {
    if (player.isBot) player.ready = true;
  }

  const unreadyHumans = players.filter((player) => !player.isBot && !player.ready);
  if (unreadyHumans.length > 0) {
    const names = unreadyHumans.slice(0, 3).map((player) => player.name || "Player").join(", ");
    const more = unreadyHumans.length > 3 ? ` +${unreadyHumans.length - 3} more` : "";
    io.to(lobby.id).emit("toast", {
      type: "error",
      message: `Everyone has to ready up before the run starts. Waiting on ${names}${more}.`
    });
    broadcastLobbyState(lobby);
    return false;
  }

  const selection = resolveMapSelection(lobby.mapId);
  if (!selection) {
    io.to(lobby.id).emit("toast", { type: "error", message: "No valid map was found. Check public/maps.js." });
    return false;
  }

  lobby.mapId = selection.id;
  lobby.mapName = selection.def.name || selection.id;
  const map = parseMap(selection.def);
  chooseActiveExitGates(map, 2);
  const game = {
    map,
    phase: "game",
    startedAt: nowMs(),
    endedAt: null,
    winner: null,
    endReason: "",
    actors: new Map(),
    events: [],
    particles: [],
    scratchMarks: [],
    snapshotSeq: 0,
    pathCache: new Map(),
    pathCacheEpoch: 0,
    requiredGenerators: map.requiredGenerators,
    escapeOpen: false,
    time: 0,
    botThinkAccumulator: 0,
    matchStartFreezeSeconds: MATCH_START_FREEZE_SECONDS,
    collectibleDots: [],
    dotRespawnQueue: 0,
    redOrbs: 0,
    runnerReveal: 0,
    dotRespawnTimer: DOT_RESPAWN_SECONDS
  };

  seedInitialCollectibleDots(game);

  let survivorSpawnIndex = 0;
  for (const player of players) {
    const actor = makePlayer({ id: player.id }, player.role, player.name, { isBot: !!player.isBot, skin: player.skin });
    actor.ready = player.ready;
    actor.stats = createMatchStats(actor.role);
    actor.currentChaseSeconds = 0;
    if (actor.role === "killer") {
      const spawn = map.killerSpawns[0];
      actor.x = spawn.x;
      actor.y = spawn.y;
    } else {
      const spawn = map.survivorSpawns[survivorSpawnIndex % map.survivorSpawns.length];
      survivorSpawnIndex++;
      actor.x = spawn.x;
      actor.y = spawn.y;
    }
    if (actor.role === "survivor") {
      setActorChat(actor, randomMatchStartSurvivorLine(), game, 4.2);
    }
    game.actors.set(actor.id, actor);
  }

  lobby.phase = "game";
  lobby.game = game;
  touchLobby(lobby);
  for (const player of lobby.players.values()) player.ready = false;
  io.to(lobby.id).emit("gameStarted", serializeMapForClient(map));
  broadcastLobbyState(lobby);
  broadcastLobbyList();
  return true;
}

function serializeMapForClient(map) {
  return {
    name: map.name,
    startFreezeSeconds: MATCH_START_FREEZE_SECONDS,
    tile: map.tile,
    width: map.width,
    height: map.height,
    rows: map.rawRows,
    requiredGenerators: map.requiredGenerators,
    totalGenerators: map.generators.length,
    generatorCandidateCount: map.generatorCandidateCount || map.generators.length,
    spawnedGenerators: map.spawnedGenerators || map.generators.length,
    walls: map.walls.map(stripRect),
    windows: map.windows.map((w) => ({ ...stripRect(w), orientation: w.orientation })),
    pallets: map.pallets.map((p) => ({ ...stripRect(p), orientation: p.orientation, state: p.state, broken: p.broken })),
    generators: map.generators.map((g) => ({ id: g.id, x: g.x, y: g.y, progress: g.progress, done: g.done })),
    gates: map.gates.map((g) => ({ id: g.id, x: g.x, y: g.y, open: g.open })),
    hooks: (map.hooks || []).map((h) => ({ id: h.id, x: h.x, y: h.y, survivorId: h.survivorId, active: h.active }))
  };
}

function stripRect(r) {
  return { id: r.id, x: r.x, y: r.y, w: r.w, h: r.h };
}

function chooseActiveExitGates(map, count = 2) {
  const gates = Array.isArray(map?.gates) ? map.gates : [];
  if (gates.length <= count) {
    map.gates = gates.map((g) => ({ ...g, open: false, active: true }));
    map.exitCandidateCount = gates.length;
    return map.gates;
  }

  // Pick one at random, then pick the second from the farthest half of candidates.
  // This keeps exits unpredictable without letting both portals spawn shoulder-to-shoulder.
  const first = gates[Math.floor(Math.random() * gates.length)];
  const remaining = gates
    .filter((g) => g.id !== first.id)
    .map((g) => ({ gate: g, d: dist(first.x, first.y, g.x, g.y) }))
    .sort((a, b) => b.d - a.d);

  const farPoolSize = Math.max(1, Math.ceil(remaining.length * 0.5));
  const farPool = remaining.slice(0, farPoolSize);
  const second = farPool[Math.floor(Math.random() * farPool.length)]?.gate || remaining[0]?.gate;
  const pickedIds = new Set([first.id, second?.id].filter(Boolean));

  // If count grows later, fill remaining slots randomly without duplicates.
  const shuffled = gates.filter((g) => !pickedIds.has(g.id));
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  for (const gate of shuffled) {
    if (pickedIds.size >= count) break;
    pickedIds.add(gate.id);
  }

  map.exitCandidateCount = gates.length;
  map.gates = gates
    .filter((g) => pickedIds.has(g.id))
    .map((g) => ({ ...g, open: false, active: true }));
  return map.gates;
}

function addEvent(game, type, data = {}) {
  game.events.push({ id: uid("evt"), type, ...data });
  if (game.events.length > 40) game.events.splice(0, game.events.length - 40);
}

function addScratch(game, actor) {
  if (actor?.role === "survivor" && (actor.stealthStep || 0) > 0) return;
  game.scratchMarks.push({ id: uid("scratch"), x: actor.x, y: actor.y, angle: actor.angle + (Math.random() - 0.5), ttl: 4.0, createdAt: game.time || 0 });
  if (game.scratchMarks.length > SCRATCH_MARK_MAX) game.scratchMarks.splice(0, game.scratchMarks.length - SCRATCH_MARK_MAX);
}

function moveActor(game, actor, dt) {
  if (actor.dead || actor.escaped || actor.hooked) return;

  actor.angle = Number.isFinite(actor.input.angle) ? actor.input.angle : actor.angle;

  if (actor.role === "survivor" && actor.downed) {
    actor.input.sprint = false;
    actor.input.action = false;
  }

  if (actor.vault) {
    actor.vault.t += dt;
    const t = clamp(actor.vault.t / actor.vault.duration, 0, 1);
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    actor.x = actor.vault.fromX + (actor.vault.toX - actor.vault.fromX) * eased;
    actor.y = actor.vault.fromY + (actor.vault.toY - actor.vault.fromY) * eased;
    if (t >= 1) {
      actor.vault = null;
      resolveActorOverlaps(game, actor);
    }
    return;
  }

  if (actor.breakTarget) {
    actor.actionLock -= dt;
    if (actor.actionLock <= 0) {
      const pallet = game.map.pallets.find((p) => p.id === actor.breakTarget);
      if (pallet && pallet.state === "dropped") {
        pallet.broken = true;
        pallet.state = "broken";
        bumpPathCache(game);
        addEvent(game, "palletBreak", { x: pallet.x + pallet.w / 2, y: pallet.y + pallet.h / 2 });
      }
      actor.breakTarget = null;
      actor.actionLock = 0;
    }
    return;
  }

  if (actor.role === "killer" && (actor.voidStun || 0) > 0) {
    actor.actionLock = Math.max(0, actor.actionLock - dt);
    actor.input.up = actor.input.down = actor.input.left = actor.input.right = false;
    actor.input.attack = false;
    actor.input.attackHeld = false;
    actor.input.attackReleased = false;
    return;
  }

  if (actor.actionLock > 0) {
    actor.actionLock = Math.max(0, actor.actionLock - dt);
    return;
  }

  let dx = 0;
  let dy = 0;
  if (actor.input.up) dy -= 1;
  if (actor.input.down) dy += 1;
  if (actor.input.left) dx -= 1;
  if (actor.input.right) dx += 1;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;

  // During a lunge the killer gets a short forward burst in their facing direction.
  // This is server-authoritative so the client can't fake a giga-lunge. Truly tragic.
  if (actor.role === "killer" && actor.attackState === "lunge") {
    const lungeSpeed = KILLER_SPEED * LUNGE_SPEED_MULT;
    const lx = Math.cos(actor.angle || 0);
    const ly = Math.sin(actor.angle || 0);
    moveActorWithCollision(game, actor, lx * lungeSpeed * dt, ly * lungeSpeed * dt, {
      maxStep: 8,
      preferTarget: { x: actor.x + lx * 96, y: actor.y + ly * 96 }
    });
    return;
  }

  // Quick attacks commit the killer briefly. Charging still allows normal movement.
  if (actor.role === "killer" && actor.attackState === "quick") return;

  let speed = actor.role === "killer" ? KILLER_SPEED : (actor.input.sprint ? SURVIVOR_SPRINT_SPEED : SURVIVOR_WALK_SPEED);
  if (actor.role === "survivor" && actor.downed) speed = DOWNED_CRAWL_SPEED;
  else if (actor.role === "survivor" && actor.hitBoost > 0) speed = SURVIVOR_HIT_BURST_SPEED;
  if (actor.role === "killer" && actor.recovery > 0) speed *= KILLER_RECOVERY_SPEED_MULT;
  if (actor.role === "killer" && (actor.voidSpeedBoost || 0) > 0) speed *= VOID_SPEED_BUFF_MULT;
  if (actor.role === "survivor" && (actor.orbSlow || 0) > 0) speed *= RED_ORB_SLOW_MULT;
  if (actor.role === "survivor" && (actor.voidSlow || 0) > 0) speed *= GRAVITY_WELL_SLOW_MULT;

  const moved = moveActorWithCollision(game, actor, dx * speed * dt, dy * speed * dt, {
    preferTarget: { x: actor.x + dx * 96, y: actor.y + dy * 96 }
  });

  if (!moved && (Math.abs(dx) + Math.abs(dy) > 0.05)) {
    // Last server-side de-stick pass. If input is active but the actor did not move,
    // separate from any tiny overlap so the next tick can slide instead of grinding.
    resolveActorOverlaps(game, actor, 4);
  }

  if (actor.role === "survivor" && !actor.downed && actor.input.sprint && (Math.abs(dx) + Math.abs(dy) > 0.05)) {
    if (Math.random() < 0.45) addScratch(game, actor);
  }
}

function nearestInteractable(game, actor, includePalletDrop = true) {
  const options = [];
  for (const win of game.map.windows) {
    const c = centerOf(win);
    const d = dist(actor.x, actor.y, c.x, c.y);
    if (d <= INTERACT_DISTANCE) options.push({ type: "window", object: win, d });
  }
  for (const pallet of game.map.pallets) {
    if (pallet.broken) continue;
    const c = centerOf(pallet);
    const d = dist(actor.x, actor.y, c.x, c.y);
    if (d <= INTERACT_DISTANCE) {
      if (pallet.state === "upright" && includePalletDrop) options.push({ type: "palletDrop", object: pallet, d });
      if (pallet.state === "dropped") options.push({ type: actor.role === "killer" ? "palletBreak" : "palletVault", object: pallet, d });
    }
  }
  options.sort((a, b) => a.d - b.d);
  return options[0] || null;
}

function isVaultObjectLocked(game, object, vaultType, actorToIgnore = null) {
  if (!object || !vaultType) return false;
  for (const other of game.actors.values()) {
    if (!other || other === actorToIgnore) continue;
    if (!other.vault) continue;
    if (other.vault.vaultType !== vaultType) continue;
    if (other.vault.objectId === object.id) return true;
  }
  return false;
}

function canStartVault(game, actor, object, vaultType = "window") {
  if (!actor || !object) return false;

  if (vaultType === "window") {
    // One body through the window at a time, regardless of survivor/killer role.
    // This prevents the classic multiplayer clown-car vault where two survivors and The Void
    // all squeeze through the same rectangle because the server was too polite to say no.
    if (isVaultObjectLocked(game, object, "window", actor)) return false;

    // Survivors need a short commitment window after vaulting so they cannot instantly
    // spam the same window back and forth.
    if (actor.role === "survivor" && (actor.windowVaultCooldown || 0) > 0) return false;

    // Bot killers need a stronger memory. Without this, The Void can decide the same window
    // is useful every second and perform a tragic little vault recital instead of chasing.
    if (actor.role === "killer" && actor.isBot && actor.bot?.lastVaultWindowId === object.id && game.time < (actor.bot.lastVaultWindowUntil || 0)) return false;
  }

  if (vaultType === "pallet") {
    // Same idea for dropped pallets: one survivor vaulting the pallet at a time, plus
    // a short survivor-only commitment cooldown so spacebar spam does not turn pallets
    // into tiny indecision treadmills.
    if (isVaultObjectLocked(game, object, "pallet", actor)) return false;
    if (actor.role === "survivor" && (actor.palletVaultCooldown || 0) > 0) return false;
  }

  return true;
}

function startVault(game, actor, object, vaultType = "window") {
  if (!canStartVault(game, actor, object, vaultType)) return false;

  const c = centerOf(object);
  const duration = actor.role === "killer" ? KILLER_VAULT_TIME : SURVIVOR_VAULT_TIME;
  let toX = actor.x;
  let toY = actor.y;
  const offset = game.map.tile * 0.92;

  if (object.orientation === "horizontal") {
    const side = actor.y < c.y ? -1 : 1;
    toX = clamp(actor.x, object.x + PLAYER_SIZE, object.x + object.w - PLAYER_SIZE);
    toY = c.y - side * offset;
  } else {
    const side = actor.x < c.x ? -1 : 1;
    toX = c.x - side * offset;
    toY = clamp(actor.y, object.y + PLAYER_SIZE, object.y + object.h - PLAYER_SIZE);
  }

  actor.vault = {
    t: 0,
    duration,
    fromX: actor.x,
    fromY: actor.y,
    toX: clamp(toX, 44, game.map.width - 44),
    toY: clamp(toY, 44, game.map.height - 44),
    objectId: object.id || null,
    vaultType
  };

  if (actor.role === "survivor" && vaultType === "window") {
    actor.windowVaultCooldown = Math.max(actor.windowVaultCooldown || 0, SURVIVOR_WINDOW_VAULT_COOLDOWN);
  }
  if (actor.role === "survivor" && vaultType === "pallet") {
    actor.palletVaultCooldown = Math.max(actor.palletVaultCooldown || 0, SURVIVOR_PALLET_VAULT_COOLDOWN);
  }

  if (actor.role === "killer" && actor.isBot && vaultType === "window") {
    const bot = actor.bot || (actor.bot = {});
    bot.lastVaultWindowId = object.id || null;
    bot.lastVaultWindowUntil = (game.time || 0) + Math.max(1.35, BOT_KILLER_WINDOW_REUSE_COOLDOWN * 1.75);
    bot.lastVaultWindowFromSide = botWindowSide(object, actor.x, actor.y);
    bot.path = [];
    bot.repath = 0;
  }

  addEvent(game, "vault", { x: c.x, y: c.y, role: actor.role, actorId: actor.id, vaultType });
  return true;
}

function movementDirection(input) {
  return {
    dx: (input.right ? 1 : 0) - (input.left ? 1 : 0),
    dy: (input.down ? 1 : 0) - (input.up ? 1 : 0)
  };
}

function clampOrCenter(value, min, max) {
  if (min > max) return (min + max) / 2;
  return clamp(value, min, max);
}

function palletSidePosition(actor, pallet, direction, slideOffset = 0, extraClearance = 0) {
  const size = actor.role === "killer" ? KILLER_SIZE : PLAYER_SIZE;
  const margin = size / 2 + 8 + Math.max(0, extraClearance || 0);
  const minX = pallet.x + margin;
  const maxX = pallet.x + pallet.w - margin;
  const minY = pallet.y + margin;
  const maxY = pallet.y + pallet.h - margin;

  if (direction === "up") {
    return { x: clampOrCenter(actor.x + slideOffset, minX, maxX), y: pallet.y - margin };
  }
  if (direction === "down") {
    return { x: clampOrCenter(actor.x + slideOffset, minX, maxX), y: pallet.y + pallet.h + margin };
  }
  if (direction === "left") {
    return { x: pallet.x - margin, y: clampOrCenter(actor.y + slideOffset, minY, maxY) };
  }
  return { x: pallet.x + pallet.w + margin, y: clampOrCenter(actor.y + slideOffset, minY, maxY) };
}

function wouldCollideWithFuturePallet(game, actor, x, y, pallet) {
  const box = actorRect(actor, x, y);
  const blockers = [...movementBlockingRects(game, actor)];
  if (!pallet.broken) blockers.push(pallet);
  return blockers.some((r) => rectsOverlap(box, r));
}

function actorOverlapsPallet(actor, pallet) {
  return rectsOverlap(actorRect(actor), pallet);
}

function nearestPalletSideDirections(actor, pallet) {
  const directions = ["up", "down", "left", "right"];
  const center = centerOf(pallet);
  const orientationBias = pallet.orientation === "horizontal"
    ? new Set([actor.y <= center.y ? "up" : "down", actor.y <= center.y ? "down" : "up"])
    : pallet.orientation === "vertical"
      ? new Set([actor.x <= center.x ? "left" : "right", actor.x <= center.x ? "right" : "left"])
      : new Set();

  return directions
    .map((direction) => {
      const pos = palletSidePosition(actor, pallet, direction, 0);
      const orientationPenalty = orientationBias.size && !orientationBias.has(direction) ? 24 : 0;
      return { direction, distance: dist(actor.x, actor.y, pos.x, pos.y) + orientationPenalty };
    })
    .sort((a, b) => a.distance - b.distance)
    .map((item) => item.direction);
}

function moveToNearestClearPalletSide(game, actor, pallet, { force = false } = {}) {
  if (!actor || actor.dead || actor.escaped) return false;
  if (!force && !actorOverlapsPallet(actor, pallet)) return false;

  const directions = nearestPalletSideDirections(actor, pallet);
  const offsets = [0, -16, 16, -32, 32, -48, 48, -64, 64, -80, 80];
  const clearances = [0, 8, 16, 28, 40, 56, 72];
  let fallback = null;
  let fallbackScore = Infinity;

  for (const direction of directions) {
    for (const clearance of clearances) {
      for (const offset of offsets) {
        const pos = palletSidePosition(actor, pallet, direction, offset, clearance);
        const x = clamp(pos.x, 36, game.map.width - 36);
        const y = clamp(pos.y, 36, game.map.height - 36);
        const score = dist(actor.x, actor.y, x, y) + clearance * 0.35 + Math.abs(offset) * 0.08;
        if (score < fallbackScore) {
          fallbackScore = score;
          fallback = { x, y };
        }
        if (!wouldCollideWithFuturePallet(game, actor, x, y, pallet)) {
          actor.x = x;
          actor.y = y;
          actor.palletGraceId = null;
          actor.palletGraceTime = 0;
          return true;
        }
      }
    }
  }

  // If the map is cramped, still force them out of the dropped pallet instead of leaving
  // their collision box fused with it. Movement can resolve wall pressure after this,
  // unless the Void is intentionally stunned.
  if (fallback) {
    actor.x = fallback.x;
    actor.y = fallback.y;
  }
  actor.palletGraceId = null;
  actor.palletGraceTime = 0;
  return !!fallback;
}

function separateActorsFromDroppedPallet(game, pallet, dropper) {
  if (dropper) moveToNearestClearPalletSide(game, dropper, pallet, { force: true });

  for (const actor of game.actors.values()) {
    if (actor === dropper || actor.dead || actor.escaped) continue;
    if (actorOverlapsPallet(actor, pallet)) {
      moveToNearestClearPalletSide(game, actor, pallet, { force: true });
    }
  }
}

function handleAction(game, actor) {
  if (actor.dead || actor.escaped || actor.hooked || actor.downed || actor.vault || actor.breakTarget || actor.actionLock > 0 || (actor.role === "killer" && (actor.voidStun || 0) > 0)) return;
  const hit = nearestInteractable(game, actor, actor.role === "survivor");
  if (!hit) return;

  if (hit.type === "window" || hit.type === "palletVault") {
    startVault(game, actor, hit.object, hit.type === "palletVault" ? "pallet" : "window");
  } else if (hit.type === "palletDrop") {
    hit.object.state = "dropped";
    separateActorsFromDroppedPallet(game, hit.object, actor);

    // Dropping a pallet is a commitment too. Without this, a survivor can slam the pallet
    // and instantly vault it on the next Space press, which turns the pallet into a tiny
    // panic elevator instead of an actual decision.
    if (actor.role === "survivor") {
      actor.palletVaultCooldown = Math.max(actor.palletVaultCooldown || 0, SURVIVOR_PALLET_DROP_COOLDOWN);
    }

    bumpPathCache(game);
    addEvent(game, "palletDrop", { actorId: actor.id, x: hit.object.x + hit.object.w / 2, y: hit.object.y + hit.object.h / 2 });

    const killer = [...game.actors.values()].find((p) => p.role === "killer" && !p.dead);
    if (killer) applyVoidStun(game, actor, killer, hit.object);
  } else if (hit.type === "palletBreak") {
    actor.breakTarget = hit.object.id;
    actor.actionLock = KILLER_BREAK_TIME;
    addEvent(game, "palletBreakStart", { x: hit.object.x + hit.object.w / 2, y: hit.object.y + hit.object.h / 2 });
  }
}

function circleNearRect(cx, cy, r, rect) {
  const closestX = clamp(cx, rect.x, rect.x + rect.w);
  const closestY = clamp(cy, rect.y, rect.y + rect.h);
  return dist(cx, cy, closestX, closestY) <= r;
}

function pointRectDistance(px, py, rect) {
  if (!rect) return Infinity;
  const closestX = clamp(px, rect.x, rect.x + rect.w);
  const closestY = clamp(py, rect.y, rect.y + rect.h);
  return dist(px, py, closestX, closestY);
}

function killerIsSwingingForVoidStun(killer) {
  return killer?.attackState === "quick" || killer?.attackState === "lunge";
}

function shouldVoidStunKiller(killer, pallet) {
  if (!killer || killer.role !== "killer" || killer.dead || killer.escaped) return false;
  if ((killer.voidStun || 0) > 0) return false;
  const d = pointRectDistance(killer.x, killer.y, pallet);
  if (d <= VOID_STUN_CLOSE_RADIUS) return true;
  return killerIsSwingingForVoidStun(killer) && d <= VOID_STUN_SWING_RADIUS;
}

function clearKillerAttackState(killer) {
  killer.attackState = null;
  killer.attackType = null;
  killer.attackTimer = 0;
  killer.attackDuration = 0;
  killer.attackStartup = 0;
  killer.attackCharge = 0;
  killer.attackHasHit = false;
  killer.attackNeedsRelease = true;
}

function applyVoidStun(game, survivor, killer, pallet) {
  if (!shouldVoidStunKiller(killer, pallet)) return false;

  killer.voidStun = Math.max(killer.voidStun || 0, VOID_STUN_TIME);
  killer.recovery = Math.max(killer.recovery || 0, VOID_STUN_TIME);
  killer.attackCooldown = Math.max(killer.attackCooldown || 0, VOID_STUN_TIME);
  killer.actionLock = Math.max(killer.actionLock || 0, VOID_STUN_TIME);
  killer.input.up = killer.input.down = killer.input.left = killer.input.right = false;
  killer.input.sprint = false;
  killer.input.attack = false;
  killer.input.attackHeld = false;
  killer.input.attackReleased = false;
  clearKillerAttackState(killer);
  if (survivor?.role === "survivor") awardStat(survivor, "voidStuns", "Stunned The Void", 1, "stun");

  addEvent(game, "voidStun", {
    actorId: survivor?.id || null,
    survivorId: survivor?.id || null,
    killerId: killer.id,
    palletId: pallet?.id || null,
    x: Number(killer.x.toFixed(2)),
    y: Number(killer.y.toFixed(2)),
    palletX: pallet ? pallet.x + pallet.w / 2 : Number(killer.x.toFixed(2)),
    palletY: pallet ? pallet.y + pallet.h / 2 : Number(killer.y.toFixed(2)),
    duration: VOID_STUN_TIME
  });
  return true;
}

function damageSurvivor(game, killer, survivor) {
  if (!survivor || survivor.dead || survivor.escaped || survivor.hooked || survivor.downed || survivor.invuln > 0) return false;
  // Clear stale orb-cap chatter immediately when control is lost.
  // Otherwise someone can get downed/hooked while still saying "I'm getting full...",
  // which is funny once and then deeply stupid forever.
  clearActorChat(survivor);
  survivor.dotFullNoticeCooldown = 0;
  const dotsBeforeHit = Math.max(0, survivor.dots || 0);
  survivor.health -= 1;
  const willBeDowned = survivor.health <= 0;
  let autoChatMessage = null;
  let autoChatDuration = 2.65;
  survivor.healProgress = 0;
  survivor.activeHealers = [];
  survivor.healingTargetId = null;
  survivor.hookProgress = 0;
  survivor.unhookProgress = 0;
  survivor.dotDepositTargetId = null;
  survivor.dotDepositProgress = 0;
  survivor.dotDepositChain = 0;
  awardStat(killer, "injures", "Runner injured", 1, "void");

  if (willBeDowned) {
    survivor.health = 0;
    survivor.injured = true;
    survivor.downed = true;
    survivor.hitBoost = 0;
    survivor.invuln = 0;
    survivor.chaseHold = 0;
    survivor.input.sprint = false;
    autoChatMessage = randomSurvivorDownedLine(dotsBeforeHit > 0);
    autoChatDuration = 3.4;
    addEvent(game, "downed", {
      x: survivor.x,
      y: survivor.y,
      survivorId: survivor.id,
      health: survivor.health,
      impact: true,
      chatText: autoChatMessage
    });
  } else {
    survivor.injured = true;
    survivor.invuln = SURVIVOR_INVULN;
    survivor.hitBoost = SURVIVOR_HIT_BOOST;
    autoChatMessage = randomSurvivorHitLine(dotsBeforeHit > 0);
    autoChatDuration = 2.65;
    addEvent(game, "hit", {
      x: survivor.x,
      y: survivor.y,
      survivorId: survivor.id,
      health: survivor.health,
      chatText: autoChatMessage
    });
  }

  if (killer && dotsBeforeHit > 0) {
    const before = Math.max(0, killer.dots || 0);
    killer.dots = clamp(before + dotsBeforeHit, 0, KILLER_DOT_MAX);
    awardStat(killer, "orbsCollected", "Orbs collected", killer.dots - before, "orb");
    addEvent(game, "voidOrbSteal", {
      x: survivor.x,
      y: survivor.y,
      survivorId: survivor.id,
      killerId: killer.id,
      stolen: killer.dots - before,
      carriedBefore: dotsBeforeHit,
      voidDots: killer.dots
    });
  }

  loseSurvivorDots(game, survivor, survivor.downed ? "stolenDowned" : "stolenHit");
  setActorChat(survivor, autoChatMessage, game, autoChatDuration);

  if (killer && killer.attackState) killer.attackHasHit = true;
  else if (killer) {
    killer.recovery = Math.max(killer.recovery, KILLER_QUICK_HIT_RECOVERY);
    killer.attackCooldown = Math.max(killer.attackCooldown, KILLER_ATTACK_COOLDOWN);
  }
  return true;
}

function attackProfile(type) {
  const lunge = type === "lunge";
  return {
    type: lunge ? "lunge" : "quick",
    range: lunge ? LUNGE_ATTACK_RANGE : QUICK_ATTACK_RANGE,
    // Lunges get a slightly wider arc because The Void is moving during active frames.
    // Hit testing now uses this same cone shape instead of a hidden skinny capsule. Humanity survives one more geometry bug.
    arc: lunge ? ATTACK_ARC * 1.12 : ATTACK_ARC,
    edgeGrace: lunge ? ATTACK_EDGE_GRACE_RADIUS * 1.25 : ATTACK_EDGE_GRACE_RADIUS,
    duration: lunge ? LUNGE_ATTACK_ACTIVE : QUICK_ATTACK_ACTIVE,
    startup: lunge ? LUNGE_ATTACK_STARTUP : QUICK_ATTACK_STARTUP,
    hitRecovery: lunge ? KILLER_LUNGE_HIT_RECOVERY : KILLER_QUICK_HIT_RECOVERY,
    missRecovery: lunge ? KILLER_LUNGE_MISS_RECOVERY : KILLER_QUICK_MISS_RECOVERY
  };
}

function startKillerAttack(game, killer, type) {
  const profile = attackProfile(type);
  killer.attackState = profile.type;
  killer.attackType = profile.type;
  killer.attackTimer = 0;
  killer.attackDuration = profile.duration;
  killer.attackStartup = profile.startup;
  killer.attackSweepStartX = killer.x;
  killer.attackSweepStartY = killer.y;
  killer.attackHasHit = false;
  killer.attackCharge = 0;
  killer.attackNeedsRelease = true;
  const visualEdgeGrace = Math.max(0, profile.edgeGrace || 0);
  const visualRange = profile.range + visualEdgeGrace;
  const visualArc = profile.arc + Math.atan2(visualEdgeGrace, Math.max(1, profile.range)) * 2;
  addEvent(game, "swipe", {
    actorId: killer.id,
    x: killer.x,
    y: killer.y,
    angle: killer.angle,
    attackType: profile.type,
    range: visualRange,
    arc: visualArc,
    duration: profile.duration,
    startup: profile.startup
  });
}

function finishKillerAttack(killer) {
  const profile = attackProfile(killer.attackType || "quick");
  killer.recovery = Math.max(killer.recovery, killer.attackHasHit ? profile.hitRecovery : profile.missRecovery);
  killer.attackCooldown = Math.max(killer.attackCooldown, KILLER_ATTACK_COOLDOWN);
  killer.attackState = null;
  killer.attackType = null;
  killer.attackTimer = 0;
  killer.attackDuration = 0;
  killer.attackStartup = 0;
  killer.attackCharge = 0;
  killer.attackHasHit = false;
}

function pointInAttackSwipe(originX, originY, angle, survivor, profile) {
  const dx = survivor.x - originX;
  const dy = survivor.y - originY;
  const distance = Math.hypot(dx, dy);
  const facingX = Math.cos(angle || 0);
  const facingY = Math.sin(angle || 0);
  const forward = dx * facingX + dy * facingY;
  const edgeGrace = Math.max(0, profile.edgeGrace || 0);

  // Strict front-cone test with a tiny grace band. The old check also required a narrow
  // invisible capsule, which made the drawn cone lie to the player. Society has enough lies.
  if (distance > profile.range + edgeGrace) return null;
  if (forward < -edgeGrace || forward > profile.range + edgeGrace) return null;

  const targetAngle = Math.atan2(dy, dx);
  const angleGrace = distance > 1 ? Math.atan2(edgeGrace, distance) : Math.PI / 2;
  const angleDelta = angleDiff(targetAngle, angle || 0);
  if (angleDelta > profile.arc / 2 + angleGrace) return null;

  return {
    originX,
    originY,
    distance,
    angleDelta
  };
}

function survivorInAttackSwipe(killer, survivor, profile) {
  const startX = killer.attackSweepStartX || killer.x;
  const startY = killer.attackSweepStartY || killer.y;
  const sampleSteps = killer.attackType === "lunge" ? 6 : 1;
  let bestHit = null;

  for (let i = 0; i < sampleSteps; i += 1) {
    const t = sampleSteps === 1 ? 1 : i / (sampleSteps - 1);
    const originX = startX + (killer.x - startX) * t;
    const originY = startY + (killer.y - startY) * t;
    const hit = pointInAttackSwipe(originX, originY, killer.angle || 0, survivor, profile);
    if (!hit) continue;
    if (!bestHit || hit.distance < bestHit.distance) bestHit = hit;
  }

  return bestHit;
}

function resolveKillerAttackHit(game, killer) {
  if (!killer.attackState || killer.attackHasHit) return;
  const profile = attackProfile(killer.attackType || killer.attackState);
  const survivors = [...game.actors.values()]
    .filter((p) => p.role === "survivor" && !p.dead && !p.escaped && !p.hooked && !p.downed && p.invuln <= 0)
    .sort((a, b) => dist(killer.x, killer.y, a.x, a.y) - dist(killer.x, killer.y, b.x, b.y));

  for (const survivor of survivors) {
    const hit = survivorInAttackSwipe(killer, survivor, profile);
    if (!hit) continue;
    if (!attackSegmentClear(game, hit.originX, hit.originY, survivor.x, survivor.y)) continue;
    if (damageSurvivor(game, killer, survivor)) {
      // End the active hit window once the swing connects, then enter slowdown.
      finishKillerAttack(killer);
      return;
    }
  }
}

function updateKillerAttack(game, killer, dt) {
  if (!killer || killer.dead) return;

  if ((killer.voidStun || 0) > 0) {
    clearKillerAttackState(killer);
    killer.input.attack = false;
    killer.input.attackHeld = false;
    killer.input.attackReleased = false;
    return;
  }

  if (killer.input.attackReleased) killer.attackNeedsRelease = false;

  if (killer.actionLock > 0 || killer.vault || killer.breakTarget) {
    killer.attackState = null;
    killer.attackType = null;
    killer.attackCharge = 0;
    return;
  }

  if (killer.attackState === "quick" || killer.attackState === "lunge") {
    killer.attackTimer += dt;
    if (killer.attackTimer >= (killer.attackStartup || 0)) resolveKillerAttackHit(game, killer);
    if (killer.attackState && killer.attackTimer >= killer.attackDuration) finishKillerAttack(killer);
    return;
  }

  if (killer.recovery > 0 || killer.attackCooldown > 0) {
    killer.attackCharge = 0;
    if (!killer.input.attackHeld) killer.attackNeedsRelease = false;
    return;
  }

  if (killer.attackNeedsRelease) {
    killer.attackCharge = 0;
    if (!killer.input.attackHeld) killer.attackNeedsRelease = false;
    return;
  }

  if (killer.input.attackHeld) {
    killer.attackState = "charging";
    killer.attackCharge += dt;
    if (killer.attackCharge >= LUNGE_CHARGE_TIME) startKillerAttack(game, killer, "lunge");
    return;
  }

  if (killer.input.attackReleased || killer.input.attack) {
    startKillerAttack(game, killer, "quick");
    return;
  }

  killer.attackState = null;
  killer.attackCharge = 0;
}

function updateTimers(game, dt) {
  for (const actor of game.actors.values()) {
    actor.invuln = Math.max(0, actor.invuln - dt);
    actor.hitBoost = Math.max(0, actor.hitBoost - dt);
    actor.recovery = Math.max(0, actor.recovery - dt);
    actor.voidStun = Math.max(0, (actor.voidStun || 0) - dt);
    actor.voidSpeedBoost = Math.max(0, (actor.voidSpeedBoost || 0) - dt);
    if (actor.voidAbilityCooldowns) {
      for (const [abilityId, remaining] of Object.entries(actor.voidAbilityCooldowns)) {
        const nextRemaining = Math.max(0, cfgNumber(remaining, 0) - dt);
        if (nextRemaining <= 0) delete actor.voidAbilityCooldowns[abilityId];
        else actor.voidAbilityCooldowns[abilityId] = nextRemaining;
      }
    }
    actor.stealthStep = Math.max(0, (actor.stealthStep || 0) - dt);
    actor.riftLens = Math.max(0, (actor.riftLens || 0) - dt);
    if (actor.survivorAbilityCooldowns) {
      for (const [abilityId, remaining] of Object.entries(actor.survivorAbilityCooldowns)) {
        const nextRemaining = Math.max(0, cfgNumber(remaining, 0) - dt);
        if (nextRemaining <= 0) delete actor.survivorAbilityCooldowns[abilityId];
        else actor.survivorAbilityCooldowns[abilityId] = nextRemaining;
      }
    }
    actor.orbSlow = Math.max(0, (actor.orbSlow || 0) - dt);
    actor.voidSlow = Math.max(0, (actor.voidSlow || 0) - dt);
    actor.windowVaultCooldown = Math.max(0, (actor.windowVaultCooldown || 0) - dt);
    actor.palletVaultCooldown = Math.max(0, (actor.palletVaultCooldown || 0) - dt);
    actor.attackCooldown = Math.max(0, actor.attackCooldown - dt);
    actor.chaseHold = Math.max(0, actor.chaseHold - dt);
    actor.killerVisibleHold = Math.max(0, (actor.killerVisibleHold || 0) - dt);
    actor.dotFullNoticeCooldown = Math.max(0, (actor.dotFullNoticeCooldown || 0) - dt);
    actor.palletGraceTime = Math.max(0, actor.palletGraceTime - dt);
    if (actor.palletGraceTime <= 0) actor.palletGraceId = null;
  }
  game.redOrbs = Math.max(0, (game.redOrbs || 0) - dt);
  game.runnerReveal = Math.max(0, (game.runnerReveal || 0) - dt);
  for (let i = game.scratchMarks.length - 1; i >= 0; i--) {
    game.scratchMarks[i].ttl -= dt;
    if (game.scratchMarks[i].ttl <= 0) game.scratchMarks.splice(i, 1);
  }
}


function countFloorTiles(map) {
  let count = 0;
  for (let y = 0; y < map.rows; y++) {
    for (let x = 0; x < map.cols; x++) {
      if (map.rawRows[y]?.[x] === ".") count += 1;
    }
  }
  return count;
}

function initialDotSpawnCount(map) {
  const floorTiles = countFloorTiles(map);
  return clamp(Math.round(floorTiles * DOT_SPAWN_FLOOR_RATIO), DOT_SPAWN_MIN, DOT_MAX_ON_MAP);
}

function enumerateFloorDotCandidates(game, options = {}) {
  const tile = game.map.tile;
  const minObjective = tile * DOT_MIN_OBJECTIVE_TILE_DIST;
  const minDotSpacing = tile * DOT_MIN_TILE_SPACING;
  const excludeNearObjectives = options.excludeNearObjectives !== false;
  const excludeExistingDots = options.excludeExistingDots !== false;
  const candidates = [];

  for (let y = 1; y < game.map.rows - 1; y++) {
    for (let x = 1; x < game.map.cols - 1; x++) {
      if (game.map.rawRows[y]?.[x] !== ".") continue;
      const p = tileCenter(game, x, y);
      if (excludeNearObjectives) {
        const nearObjective = [
          ...game.map.generators,
          ...game.map.gates,
          ...game.map.survivorSpawns,
          ...game.map.killerSpawns
        ].some((o) => dist(o.x, o.y, p.x, p.y) < minObjective);
        if (nearObjective) continue;
      }
      if (excludeExistingDots) {
        const tooClose = (game.collectibleDots || []).some((d) => dist(d.x, d.y, p.x, p.y) < minDotSpacing);
        if (tooClose) continue;
      }
      candidates.push({ x: p.x, y: p.y, tileX: x, tileY: y });
    }
  }
  return candidates;
}

function spawnWorldDotAt(game, spot) {
  if (!game || !spot) return false;
  game.collectibleDots = game.collectibleDots || [];
  if (game.collectibleDots.length >= DOT_MAX_ON_MAP) return false;
  if (game.collectibleDots.some((d) => d.tileX === spot.tileX && d.tileY === spot.tileY)) return false;
  game.collectibleDots.push({
    id: uid("dot"),
    x: spot.x,
    y: spot.y,
    tileX: spot.tileX,
    tileY: spot.tileY
  });
  return true;
}

function spawnRandomWorldDot(game) {
  if (!game || (game.collectibleDots || []).length >= DOT_MAX_ON_MAP) return false;
  const candidates = enumerateFloorDotCandidates(game);
  if (!candidates.length) return false;
  const spot = candidates[Math.floor(Math.random() * candidates.length)];
  return spawnWorldDotAt(game, spot);
}

function queueDotRespawns(game, count = 1) {
  if (!game || count <= 0) return;
  game.dotRespawnQueue = Math.min(DOT_MAX_ON_MAP, (game.dotRespawnQueue || 0) + count);
  if (!Number.isFinite(game.dotRespawnTimer)) game.dotRespawnTimer = DOT_RESPAWN_SECONDS;
}

function updateDotRespawns(game, dt) {
  if (!game) return;
  game.collectibleDots = game.collectibleDots || [];
  game.dotRespawnQueue = Math.max(0, game.dotRespawnQueue || 0);

  // Keep the live world populated enough for dot-only objectives without turning
  // the map into an arcade carpet. Queue the missing amount, then respawn in small batches.
  const targetMinimum = Math.min(DOT_SPAWN_MIN, DOT_MAX_ON_MAP);
  if (game.collectibleDots.length < targetMinimum && game.dotRespawnQueue < DOT_MAX_ON_MAP) {
    const missing = targetMinimum - game.collectibleDots.length;
    game.dotRespawnQueue = Math.min(DOT_MAX_ON_MAP, game.dotRespawnQueue + missing);
  }

  if (!game.dotRespawnQueue || game.collectibleDots.length >= DOT_MAX_ON_MAP) return;

  game.dotRespawnTimer = Math.max(0, (game.dotRespawnTimer || DOT_RESPAWN_SECONDS) - dt);
  if (game.dotRespawnTimer > 0) return;

  game.dotRespawnTimer = DOT_RESPAWN_SECONDS;
  const spawnCount = Math.min(DOT_RESPAWN_BATCH, game.dotRespawnQueue, DOT_MAX_ON_MAP - game.collectibleDots.length);
  for (let i = 0; i < spawnCount; i++) {
    if (spawnRandomWorldDot(game)) game.dotRespawnQueue = Math.max(0, game.dotRespawnQueue - 1);
    else break;
  }
}

function spawnWorldDotNear(game, nearX, nearY) {
  const actorTile = tileAt(game, nearX, nearY);
  const tile = game.map.tile;
  const minSpacing = tile * DOT_MIN_TILE_SPACING;
  const radius = 5;
  let best = null;
  let bestDist = Infinity;

  for (let ty = actorTile.y - radius; ty <= actorTile.y + radius; ty++) {
    for (let tx = actorTile.x - radius; tx <= actorTile.x + radius; tx++) {
      if (game.map.rawRows[ty]?.[tx] !== ".") continue;
      const p = tileCenter(game, tx, ty);
      if ((game.collectibleDots || []).some((d) => d.tileX === tx && d.tileY === ty)) continue;
      if ((game.collectibleDots || []).some((d) => dist(d.x, d.y, p.x, p.y) < minSpacing)) continue;
      const d = dist(nearX, nearY, p.x, p.y);
      if (d < bestDist) {
        bestDist = d;
        best = { x: p.x, y: p.y, tileX: tx, tileY: ty };
      }
    }
  }

  if (!best) {
    const fallback = enumerateFloorDotCandidates(game).sort(
      (a, b) => dist(nearX, nearY, a.x, a.y) - dist(nearX, nearY, b.x, b.y)
    )[0];
    best = fallback || null;
  }

  return spawnWorldDotAt(game, best);
}

function seedInitialCollectibleDots(game) {
  game.collectibleDots = [];
  game.dotRespawnQueue = 0;
  game.dotRespawnTimer = DOT_RESPAWN_SECONDS;

  const target = initialDotSpawnCount(game.map);
  const candidates = enumerateFloorDotCandidates(game, { excludeExistingDots: false });
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const tile = game.map.tile;
  const minSpacing = tile * DOT_MIN_TILE_SPACING;
  for (const candidate of candidates) {
    if (game.collectibleDots.length >= target || game.collectibleDots.length >= DOT_MAX_ON_MAP) break;
    const tooClose = game.collectibleDots.some((d) => dist(d.x, d.y, candidate.x, candidate.y) < minSpacing);
    if (tooClose) continue;
    game.collectibleDots.push({
      id: uid("dot"),
      x: candidate.x,
      y: candidate.y,
      tileX: candidate.tileX,
      tileY: candidate.tileY
    });
  }
}

function actorCanPickupDots(actor) {
  if (!actor || actor.dead || actor.escaped || actor.hooked || actor.downed) return false;
  if (actor.role === "survivor") return (actor.dots || 0) < SURVIVOR_DOT_MAX;
  if (actor.role === "killer") return (actor.dots || 0) < KILLER_DOT_MAX;
  return false;
}

function dotPickupRadiusForActor(actor) {
  return actor?.role === "killer" ? KILLER_DOT_PICKUP_RADIUS : SURVIVOR_DOT_PICKUP_RADIUS;
}

function loseSurvivorDots(game, survivor, mode = "hit") {
  if (!survivor || survivor.role !== "survivor") return;
  const held = Math.max(0, survivor.dots || 0);
  if (!held) return;

  const lost = held;

  survivor.dots = Math.max(0, held - lost);
  survivor.dotDepositTargetId = null;
  survivor.dotDepositProgress = 0;

  const stolenByVoid = String(mode || "").startsWith("stolen");
  let scattered = 0;
  if (!stolenByVoid) {
    for (let i = 0; i < lost; i++) {
      if (spawnWorldDotNear(game, survivor.x, survivor.y)) scattered += 1;
    }

    const leftover = lost - scattered;
    if (leftover > 0) queueDotRespawns(game, leftover);
  }
  addEvent(game, "dotLoss", { x: survivor.x, y: survivor.y, survivorId: survivor.id, lost, mode });
}

function updateCollectibleDots(game, dt) {
  updateDotRespawns(game, dt);
  if (!game.collectibleDots?.length) return;

  for (const actor of game.actors.values()) {
    if (!actor || actor.dead || actor.escaped || actor.hooked) continue;

    const pickupRadius = dotPickupRadiusForActor(actor);
    const pickupRadius2 = pickupRadius * pickupRadius;
    let nearestIdx = -1;
    let nearestD2 = pickupRadius2;
    for (let i = 0; i < game.collectibleDots.length; i++) {
      const dot = game.collectibleDots[i];
      const dx = actor.x - dot.x;
      const dy = actor.y - dot.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > nearestD2) continue;
      if (!segmentClear(game, actor.x, actor.y, dot.x, dot.y)) continue;
      nearestIdx = i;
      nearestD2 = d2;
    }

    if (nearestIdx < 0) continue;

    if (!actorCanPickupDots(actor)) {
      // Survivors at the carry cap still "try" to pick up nearby orbs.
      // Send a local-only notice event, throttled so the toast does not become spam confetti.
      if (actor.role === "survivor" && (actor.dotFullNoticeCooldown || 0) <= 0) {
        const dot = game.collectibleDots[nearestIdx];
        const message = ORB_FULL_CHAT_MESSAGES[Math.floor(Math.random() * ORB_FULL_CHAT_MESSAGES.length)];
        setActorChat(actor, message, game);
        actor.dotFullNoticeCooldown = 1.35;
        addEvent(game, "dotFull", { x: dot.x, y: dot.y, actorId: actor.id, message });
      }
      continue;
    }

    const dot = game.collectibleDots.splice(nearestIdx, 1)[0];
    const maxDots = actor.role === "killer" ? KILLER_DOT_MAX : SURVIVOR_DOT_MAX;
    const dotsBefore = actor.dots || 0;
    actor.dots = Math.min(maxDots, dotsBefore + 1);
    awardStat(actor, "orbsCollected", "Orb collected", Math.max(0, actor.dots - dotsBefore), "orb");
    if (actor.role === "survivor" && (game.redOrbs || 0) > 0) {
      actor.orbSlow = Math.max(actor.orbSlow || 0, RED_ORB_SLOW_SECONDS);
      addEvent(game, "redOrbSlow", { x: actor.x, y: actor.y, survivorId: actor.id, duration: RED_ORB_SLOW_SECONDS });
    }
    queueDotRespawns(game, 1);
    addEvent(game, "dotPickup", {
      x: dot.x,
      y: dot.y,
      actorId: actor.id,
      survivorId: actor.role === "survivor" ? actor.id : null,
      role: actor.role,
      dotsBefore,
      dotsAfter: actor.dots,
      carriedDots: actor.dots,
      carryMax: maxDots
    });
  }
}

function nearestDotDepositGenerator(game, actor) {
  if (areRiftsComplete(game)) return null;
  if (!actor || actor.role !== "survivor" || (actor.dots || 0) <= 0) return null;
  if (actor.dead || actor.escaped || actor.downed || actor.hooked || actor.vault || actor.actionLock > 0) return null;
  if (actor.healingTargetId || actor.unhookTargetId || (actor.activeHealers && actor.activeHealers.length > 0)) return null;

  let best = null;
  let bestDist = Infinity;
  for (const gen of game.map.generators) {
    if (!gen || gen.done) continue;
    const d = dist(actor.x, actor.y, gen.x, gen.y);
    if (d > DOT_DEPOSIT_DISTANCE || d >= bestDist) continue;
    if (!segmentClear(game, actor.x, actor.y, gen.x, gen.y)) continue;
    best = gen;
    bestDist = d;
  }
  return best;
}

function clearDotDepositState(game) {
  for (const gen of game.map.generators) {
    gen.dotDepositing = false;
    gen.dotDepositProgress = 0;
  }
}

function dotDepositSecondsForActor(actor) {
  return DOT_DEPOSIT_SECONDS;
}

function resetActorDotDeposit(actor) {
  if (!actor) return;
  actor.dotDepositTargetId = null;
  actor.dotDepositProgress = 0;
  actor.dotDepositChain = 0;
}

function updateDotDeposits(game, dt) {
  clearDotDepositState(game);
  const buckets = new Map();

  for (const actor of game.actors.values()) {
    if (actor.role !== "survivor") continue;
    const gen = nearestDotDepositGenerator(game, actor);
    if (!gen) {
      resetActorDotDeposit(actor);
      continue;
    }

    if (actor.dotDepositTargetId !== gen.id) {
      actor.dotDepositTargetId = gen.id;
      actor.dotDepositProgress = 0;
      actor.dotDepositChain = 0;
    }

    const depositSeconds = dotDepositSecondsForActor(actor);
    actor.dotDepositProgress = clamp((actor.dotDepositProgress || 0) + dt / depositSeconds, 0, 1);

    // Depositing is automatic: survivors can circle the gen while feeding orbs.
    // Bots keep facing the gen so their intent is readable.
    if (actor.isBot) actor.input.angle = Math.atan2(gen.y - actor.y, gen.x - actor.x);

    let bucket = buckets.get(gen.id);
    if (!bucket) {
      bucket = { gen, actors: [] };
      buckets.set(gen.id, bucket);
    }
    bucket.actors.push(actor);
  }

  for (const { gen, actors } of buckets.values()) {
    if (!actors.length || gen.done) continue;
    gen.dotDepositing = true;
    gen.dotDepositProgress = Math.max(...actors.map((actor) => actor.dotDepositProgress || 0));

    for (const actor of actors) {
      if ((actor.dotDepositProgress || 0) < 1 || (actor.dots || 0) <= 0 || gen.done) continue;

      actor.dots = Math.max(0, (actor.dots || 0) - 1);
      awardStat(actor, "orbsDeposited", "Orb deposited", 1, "rift");
      actor.dotDepositProgress = 0;
      actor.dotDepositChain = clamp((actor.dotDepositChain || 0) + 1, 1, DOT_DEPOSIT_MAX_CHAIN);
      const depositIndex = actor.dotDepositChain;

      const oldProgress = gen.progress;
      gen.progress = clamp(gen.progress + DOT_REPAIR_PROGRESS, 0, 1);
      gen.kickLocked = false;
      gen.dotDepositing = true;
      gen.dotDepositProgress = 0;

      addEvent(game, "dotDeposit", {
        x: gen.x,
        y: gen.y,
        survivorId: actor.id,
        generatorId: gen.id,
        depositIndex,
        nextDepositSeconds: dotDepositSecondsForActor(actor),
        progress: gen.progress
      });

      if ((actor.dots || 0) <= 0) {
        resetActorDotDeposit(actor);
      }

      if (gen.progress > oldProgress && gen.progress >= 1 && !gen.done) {
        gen.done = true;
        gen.repairing = false;
        gen.dotDepositing = false;
        gen.activeRepairers = [];
        const completedRifts = game.map.generators.filter((g) => g.done).length;
        const allRiftsDone = completedRifts >= game.requiredGenerators;
        if (allRiftsDone) bumpPathCache(game);
        addEvent(game, "genDone", {
          x: gen.x,
          y: gen.y,
          generatorId: gen.id,
          completedRifts,
          requiredRifts: game.requiredGenerators,
          allRiftsDone
        });
        break;
      }
    }
  }
}

function randomFloorHookSpot(game, killer = null) {
  const tile = game.map.tile;
  const baseCandidates = [];
  const farCandidates = [];
  const minKillerDistance = Math.max(HOOK_MIN_KILLER_DISTANCE, tile * 5.5);

  for (let y = 1; y < game.map.rows - 1; y++) {
    for (let x = 1; x < game.map.cols - 1; x++) {
      if (game.map.rawRows[y]?.[x] !== ".") continue;
      const p = tileCenter(game, x, y);
      const tooCloseToExisting = (game.map.hooks || []).some((h) => h.active && dist(h.x, h.y, p.x, p.y) < tile * 3);
      if (tooCloseToExisting) continue;
      const nearObjective = [...game.map.generators, ...game.map.gates].some((o) => dist(o.x, o.y, p.x, p.y) < tile * 1.4);
      if (nearObjective) continue;
      baseCandidates.push(p);
      if (!killer || dist(killer.x, killer.y, p.x, p.y) >= minKillerDistance) farCandidates.push(p);
    }
  }

  // Prefer hooks far from the killer so the pickup does not become an instant camp.
  // If the map is cramped, fall back to any valid floor tile instead of failing the hook.
  const list = farCandidates.length ? farCandidates : baseCandidates.length ? baseCandidates : [{ x: game.map.width / 2, y: game.map.height / 2 }];
  return list[Math.floor(Math.random() * list.length)];
}

function releasePositionNearHook(game, hook, survivor) {
  const tile = game.map.tile;
  const offsets = [
    { x: tile * 0.72, y: 0 },
    { x: -tile * 0.72, y: 0 },
    { x: 0, y: tile * 0.72 },
    { x: 0, y: -tile * 0.72 },
    { x: tile * 0.72, y: tile * 0.72 },
    { x: -tile * 0.72, y: tile * 0.72 },
    { x: tile * 0.72, y: -tile * 0.72 },
    { x: -tile * 0.72, y: -tile * 0.72 }
  ];
  for (const o of offsets) {
    const x = clamp(hook.x + o.x, 44, game.map.width - 44);
    const y = clamp(hook.y + o.y, 44, game.map.height - 44);
    if (!wouldCollide(game, survivor, x, y)) return { x, y };
  }
  return { x: hook.x, y: hook.y };
}

function nearestDownedSurvivorForHook(game, killer) {
  if (!killer || killer.role !== "killer" || killer.dead || killer.escaped) return null;

  return [...game.actors.values()]
    .filter((target) => target.role === "survivor" && target.downed && !target.hooked && !target.dead && !target.escaped && target.health <= 0)
    .filter((target) => dist(killer.x, killer.y, target.x, target.y) <= HOOK_INTERACT_DISTANCE)
    // Hooking is a pickup/channel interaction, not an attack. Walls should block it,
    // but dropped pallets and windows should not silently cancel it when the killer is standing on the body.
    .filter((target) => segmentClear(game, killer.x, killer.y, target.x, target.y))
    .sort((a, b) => dist(killer.x, killer.y, a.x, a.y) - dist(killer.x, killer.y, b.x, b.y))[0] || null;
}

function actorHasMoveInput(actor) {
  return !!(actor?.input?.up || actor?.input?.down || actor?.input?.left || actor?.input?.right);
}

function isStationarySurvivorHelper(actor) {
  if (!actor || actor.role !== "survivor" || actor.dead || actor.escaped || actor.downed || actor.hooked) return false;
  if (actor.vault || actor.actionLock > 0) return false;
  if (actorHasMoveInput(actor)) return false;
  return true;
}

function nearestHookedSurvivorForRescue(game, healer) {
  if (!isStationarySurvivorHelper(healer)) return null;
  return [...game.actors.values()]
    .filter((target) => target.id !== healer.id && target.role === "survivor" && target.hooked && !target.dead && !target.escaped)
    .filter((target) => dist(healer.x, healer.y, target.x, target.y) <= HOOK_RESCUE_DISTANCE)
    .filter((target) => segmentClear(game, healer.x, healer.y, target.x, target.y))
    .sort((a, b) => dist(healer.x, healer.y, a.x, a.y) - dist(healer.x, healer.y, b.x, b.y))[0] || null;
}

function sendSurvivorToHook(game, survivor) {
  const killer = [...game.actors.values()].find((p) => p.role === "killer" && !p.dead) || null;
  const spot = randomFloorHookSpot(game, killer);
  const hook = {
    id: uid("hook"),
    x: spot.x,
    y: spot.y,
    survivorId: survivor.id,
    active: true
  };
  game.map.hooks.push(hook);
  survivor.x = hook.x;
  survivor.y = hook.y;
  survivor.hooked = true;
  survivor.downed = true;
  survivor.hookId = hook.id;
  survivor.hookCount = (survivor.hookCount || 0) + 1;
  awardStat(killer, "hooks", "Runner hooked", 1, "void");
  survivor.hookProgress = 0;
  survivor.unhookProgress = 0;
  survivor.dotDepositTargetId = null;
  survivor.dotDepositProgress = 0;
  survivor.dotDepositChain = 0;
  clearActorChat(survivor);
  survivor.dotFullNoticeCooldown = 0;
  survivor.healProgress = 0;
  survivor.activeHealers = [];
  survivor.healingTargetId = null;
  survivor.input.up = survivor.input.down = survivor.input.left = survivor.input.right = false;
  addEvent(game, "hooked", { x: hook.x, y: hook.y, survivorId: survivor.id, hookId: hook.id, hookCount: survivor.hookCount });
}

function executeSurvivor(game, survivor) {
  const oldHook = survivor.hookId ? game.map.hooks.find((h) => h.id === survivor.hookId) : null;
  const killer = [...game.actors.values()].find((p) => p.role === "killer" && !p.dead) || null;
  if (oldHook) oldHook.active = false;
  awardStat(killer, "deaths", "Runner consumed", 1, "void");
  survivor.dead = true;
  survivor.downed = false;
  survivor.hooked = false;
  survivor.hookId = null;
  survivor.health = 0;
  survivor.injured = true;
  survivor.invuln = 0;
  survivor.hitBoost = 0;
  survivor.healProgress = 0;
  survivor.hookProgress = 0;
  survivor.unhookProgress = 0;
  survivor.dotDepositTargetId = null;
  survivor.dotDepositProgress = 0;
  survivor.dotDepositChain = 0;
  survivor.activeHealers = [];
  survivor.healingTargetId = null;
  survivor.input.up = survivor.input.down = survivor.input.left = survivor.input.right = false;
  addEvent(game, "execute", { x: survivor.x, y: survivor.y, survivorId: survivor.id });
}

function freeSurvivorFromHook(game, survivor, rescuers = []) {
  const hook = game.map.hooks.find((h) => h.id === survivor.hookId);
  if (hook) hook.active = false;
  const pos = hook ? releasePositionNearHook(game, hook, survivor) : { x: survivor.x, y: survivor.y };
  const rescuerIds = [...new Set((Array.isArray(rescuers) ? rescuers : [])
    .map((rescuer) => typeof rescuer === "string" ? rescuer : rescuer?.id)
    .filter(Boolean))];
  survivor.x = pos.x;
  survivor.y = pos.y;
  survivor.hooked = false;
  survivor.downed = false;
  survivor.hookId = null;
  survivor.health = 1;
  survivor.injured = true;
  survivor.invuln = SURVIVOR_INVULN;
  survivor.hitBoost = SURVIVOR_HIT_BOOST * 0.55;
  survivor.hookProgress = 0;
  survivor.unhookProgress = 0;
  survivor.dotDepositTargetId = null;
  survivor.dotDepositProgress = 0;
  survivor.dotDepositChain = 0;
  survivor.activeHealers = [];
  survivor.healingTargetId = null;
  for (const actor of game.actors.values()) {
    if (actor.unhookTargetId === survivor.id) actor.unhookTargetId = null;
  }
  for (const rescuerId of rescuerIds) {
    const rescuer = game.actors.get(rescuerId);
    if (rescuer?.role === "survivor" && rescuer.id !== survivor.id) awardStat(rescuer, "unhooks", "Teammate unhooked", 1, "team");
  }
  addEvent(game, "unhooked", {
    x: survivor.x,
    y: survivor.y,
    survivorId: survivor.id,
    rescuerId: rescuerIds[0] || null,
    rescuerIds
  });
}

function updateHookInteractions(game, dt) {
  for (const actor of game.actors.values()) {
    actor.hookActionTargetId = null;
    actor.hookActionType = null;
    actor.unhookTargetId = null;
  }

  const activeHookTargets = new Set();
  const activeUnhookTargets = new Set();
  const killer = [...game.actors.values()].find((p) => p.role === "killer" && !p.dead);

  if (killer && killer.input.repair && !killer.vault && !killer.breakTarget && !killer.attackState && killer.actionLock <= 0) {
    const target = nearestDownedSurvivorForHook(game, killer);
    if (target) {
      killer.hookActionTargetId = target.id;
      killer.input.up = killer.input.down = killer.input.left = killer.input.right = false;
      killer.input.sprint = false;
      killer.input.angle = Math.atan2(target.y - killer.y, target.x - killer.x);

      // Keep the downed survivor from crawling out of the pickup channel. Without this,
      // bots can inch away during the hold and make E feel like it is doing nothing.
      target.input.up = target.input.down = target.input.left = target.input.right = false;
      target.input.sprint = false;

      const shouldExecute = (target.hookCount || 0) >= HOOKS_BEFORE_EXECUTION;
      killer.hookActionType = shouldExecute ? "execute" : "hook";
      const channelTime = shouldExecute ? EXECUTE_CHANNEL_TIME : HOOK_CHANNEL_TIME;
      target.hookProgress = clamp((target.hookProgress || 0) + dt / channelTime, 0, 1);
      activeHookTargets.add(target.id);
      if (target.hookProgress >= 1) {
        if (shouldExecute) executeSurvivor(game, target);
        else sendSurvivorToHook(game, target);
      }
    }
  }

  const unhookHelpersByTarget = new Map();
  for (const healer of game.actors.values()) {
    const target = nearestHookedSurvivorForRescue(game, healer);
    if (!target) continue;
    healer.unhookTargetId = target.id;
    healer.input.angle = Math.atan2(target.y - healer.y, target.x - healer.x);
    if (!unhookHelpersByTarget.has(target.id)) unhookHelpersByTarget.set(target.id, { target, helpers: [] });
    unhookHelpersByTarget.get(target.id).helpers.push(healer);
  }

  for (const { target, helpers } of unhookHelpersByTarget.values()) {
    if (!target?.hooked || !helpers.length) continue;
    target.unhookProgress = clamp((target.unhookProgress || 0) + (dt * helpers.length) / UNHOOK_TIME, 0, 1);
    activeUnhookTargets.add(target.id);
    if (target.unhookProgress >= 1) freeSurvivorFromHook(game, target, helpers);
  }

  for (const target of game.actors.values()) {
    if (target.role !== "survivor") continue;
    if (target.downed && !target.hooked && !activeHookTargets.has(target.id)) target.hookProgress = Math.max(0, (target.hookProgress || 0) - dt * 0.45);
    if (target.hooked && !activeUnhookTargets.has(target.id)) target.unhookProgress = Math.max(0, (target.unhookProgress || 0) - dt * 0.35);
    if (!target.downed) target.hookProgress = 0;
    if (!target.hooked) target.unhookProgress = 0;
  }
}

function isWoundedSurvivor(target) {
  return !!(
    target
    && target.role === "survivor"
    && !target.dead
    && !target.escaped
    && !target.hooked
    && ((target.downed && target.health <= 0) || (target.health === 1 && target.injured))
  );
}

function isHealTarget(target) {
  return !!(
    isWoundedSurvivor(target)
    && !target.vault
    && !actorHasMoveInput(target)
  );
}

function healTargetsNearHelper(game, healer) {
  if (!isStationarySurvivorHelper(healer)) return [];
  return [...game.actors.values()]
    .filter((target) => target.id !== healer.id && isHealTarget(target))
    .filter((target) => dist(healer.x, healer.y, target.x, target.y) <= HEAL_DISTANCE)
    .filter((target) => segmentClear(game, healer.x, healer.y, target.x, target.y))
    .sort((a, b) => dist(healer.x, healer.y, a.x, a.y) - dist(healer.x, healer.y, b.x, b.y));
}

function updateHealing(game, dt) {
  for (const actor of game.actors.values()) {
    actor.activeHealers = [];
    actor.healingTargetId = null;
  }

  for (const healer of game.actors.values()) {
    const targets = healTargetsNearHelper(game, healer);
    if (!targets.length) continue;

    healer.healingTargetId = targets[0].id;
    healer.input.angle = Math.atan2(targets[0].y - healer.y, targets[0].x - healer.x);

    for (const target of targets) {
      target.activeHealers.push(healer.id);
      target.healProgress = clamp((target.healProgress || 0) + dt / HEAL_TIME, 0, 1);
    }
  }

  for (const target of game.actors.values()) {
    if (target.role !== "survivor") continue;
    const stillWounded = isWoundedSurvivor(target);
    if (!stillWounded) {
      target.healProgress = 0;
      target.activeHealers = [];
      continue;
    }

    if (target.activeHealers.length > 0 && target.healProgress >= 1) {
      const healerIds = [...new Set(target.activeHealers || [])].filter((id) => id && id !== target.id);
      for (const healerId of healerIds) {
        const healer = game.actors.get(healerId);
        if (healer?.role === "survivor") awardStat(healer, "teammatesHealed", "Teammate healed", 1, "team");
      }
      if (target.downed) {
        target.downed = false;
        target.health = 1;
        target.injured = true;
        target.invuln = Math.max(target.invuln || 0, SURVIVOR_INVULN * 0.65);
        target.hitBoost = Math.max(target.hitBoost || 0, SURVIVOR_HIT_BOOST * 0.55);
        target.hookProgress = 0;
      } else {
        target.health = 2;
        target.injured = false;
        target.invuln = 0;
      }
      target.healProgress = 0;
      target.activeHealers = [];
      addEvent(game, "healDone", { x: target.x, y: target.y, survivorId: target.id });
    } else if (target.activeHealers.length === 0) {
      target.healProgress = Math.max(0, (target.healProgress || 0) - dt * HEAL_DECAY_PER_SECOND);
    }
  }
}


function nearestKickableGenerator(game, killer) {
  if (areRiftsComplete(game)) return null;
  if (!killer || killer.role !== "killer" || killer.dead || killer.escaped) return null;
  let best = null;
  let bestD2 = Infinity;
  const maxD = INTERACT_DISTANCE + 10;
  const maxD2 = maxD * maxD;
  for (const gen of game.map.generators) {
    if (gen.done || gen.progress <= 0.001 || gen.kickLocked) continue;
    const dx = killer.x - gen.x;
    const dy = killer.y - gen.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > maxD2 || d2 >= bestD2) continue;
    if (!segmentClear(game, killer.x, killer.y, gen.x, gen.y)) continue;
    best = gen;
    bestD2 = d2;
  }
  return best;
}

function resetGeneratorKick(killer) {
  if (!killer) return;
  killer.generatorKickTargetId = null;
  killer.generatorKickChannelId = null;
  killer.generatorKickProgress = 0;
}

function updateGeneratorKicks(game, dt) {
  for (const gen of game.map.generators) {
    gen.beingKicked = false;
    gen.kickProgress = Math.max(0, (gen.kickProgress || 0) - dt * 1.8);
  }

  const killer = [...game.actors.values()].find((p) => p.role === "killer" && !p.dead);
  if (!killer) return;

  killer.generatorKickTargetId = null;

  const busy = killer.vault || killer.breakTarget || killer.attackState || killer.actionLock > 0 || killer.hookActionTargetId;
  if (!killer.input.repair || busy) {
    resetGeneratorKick(killer);
    return;
  }

  const gen = nearestKickableGenerator(game, killer);
  if (!gen) {
    resetGeneratorKick(killer);
    return;
  }

  if (killer.generatorKickChannelId !== gen.id) {
    killer.generatorKickChannelId = gen.id;
    killer.generatorKickProgress = 0;
  }

  killer.generatorKickTargetId = gen.id;
  killer.input.up = killer.input.down = killer.input.left = killer.input.right = false;
  killer.input.sprint = false;
  killer.input.angle = Math.atan2(gen.y - killer.y, gen.x - killer.x);

  killer.generatorKickProgress = clamp((killer.generatorKickProgress || 0) + dt / GENERATOR_KICK_TIME, 0, 1);
  gen.beingKicked = true;
  gen.kickProgress = killer.generatorKickProgress;

  if (killer.generatorKickProgress >= 1) {
    const oldProgress = gen.progress;
    gen.progress = clamp(gen.progress - GENERATOR_KICK_REGRESSION, 0, 1);
    // A kicked generator cannot be kicked again until survivors work on it.
    gen.kickLocked = true;
    gen.beingKicked = false;
    gen.kickProgress = 0;
    awardStat(killer, "riftsKicked", "Rift kicked", 1, "void");
    addEvent(game, "genKick", { x: gen.x, y: gen.y, generatorId: gen.id, oldProgress, progress: gen.progress });
    resetGeneratorKick(killer);
  }
}

function nearestRepairableGenerator(game, actor) {
  if (areRiftsComplete(game)) return null;
  let gen = null;
  let bestD2 = INTERACT_DISTANCE * INTERACT_DISTANCE;
  for (const candidate of game.map.generators) {
    if (candidate.done) continue;
    const dx = actor.x - candidate.x;
    const dy = actor.y - candidate.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2 && segmentClear(game, actor.x, actor.y, candidate.x, candidate.y)) {
      gen = candidate;
      bestD2 = d2;
    }
  }
  return gen;
}

function updateGeneratorsAndGates(game, dt) {
  // Generator/rift progress is dot-only. Holding E no longer repairs rifts.
  // Keep these flags reset so old repair visuals never get stuck from stale state.
  for (const gen of game.map.generators) {
    gen.repairing = false;
    gen.repairerCount = 0;
    if (Array.isArray(gen.activeRepairers)) gen.activeRepairers.length = 0;
    else gen.activeRepairers = [];
  }

  const doneCount = completedRiftCount(game);
  const riftsDone = areRiftsComplete(game);
  if (riftsDone) {
    for (const gen of game.map.generators) {
      gen.repairing = false;
      gen.dotDepositing = false;
      gen.beingKicked = false;
      gen.kickProgress = 0;
      if (Array.isArray(gen.activeRepairers)) gen.activeRepairers.length = 0;
    }
  }
  if (riftsDone && !game.escapeOpen) {
    game.escapeOpen = true;
    for (const gate of game.map.gates) {
      gate.open = true;
      addEvent(game, "voidOpen", { x: gate.x, y: gate.y, gateId: gate.id });
    }
  } else if (game.escapeOpen) {
    for (const gate of game.map.gates) gate.open = true;
  }

  for (const actor of game.actors.values()) {
    if (actor.role !== "survivor") continue;

    const canEscape = game.escapeOpen && !actor.dead && !actor.escaped && !actor.hooked;
    const gate = canEscape
      ? game.map.gates.find((g) => g.open && dist(actor.x, actor.y, g.x, g.y) < INTERACT_DISTANCE + 24)
      : null;

    // Downed survivors can crawl/bleed into a void and still escape. Very dramatic, very rude to The Void.
    if (gate) {
      actor.escapeGateId = gate.id;
      actor.escapeProgress = Math.min(GATE_ESCAPE_TIME, (actor.escapeProgress || 0) + dt);
      actor.dotDepositTargetId = null;
      actor.dotDepositProgress = 0;

      if (!actor.escapeChatAt || (game.time || 0) >= actor.escapeChatAt) {
        actor.chatText = randomVoidEscapeLine();
        actor.chatUntil = (game.time || 0) + 1.35;
        actor.escapeChatAt = (game.time || 0) + 1.15 + Math.random() * 0.35;
      }

      if (actor.escapeProgress >= GATE_ESCAPE_TIME) {
        actor.escaped = true;
        ensureMatchStats(actor).escaped = true;
        notifyScoreGain(actor, "Escaped", 1, "team");
        actor.dead = false;
        actor.hooked = false;
        actor.downed = false;
        actor.hookId = null;
        actor.health = Math.max(actor.health || 0, 1);
        actor.escapeProgress = 0;
        actor.escapeGateId = null;
        actor.chatText = null;
        actor.chatUntil = 0;
        actor.escapeChatAt = 0;
        addEvent(game, "escape", { x: actor.x, y: actor.y, survivorId: actor.id });
      }
    } else {
      actor.escapeProgress = 0;
      actor.escapeGateId = null;
      actor.escapeChatAt = 0;
    }
  }
}

function updateChaseState(game, dt) {
  const killer = [...game.actors.values()].find((p) => p.role === "killer" && !p.dead);
  if (!killer) return;

  for (const survivor of game.actors.values()) {
    if (survivor.role !== "survivor" || survivor.dead || survivor.escaped || survivor.downed || survivor.hooked) continue;

    const d = dist(killer.x, killer.y, survivor.x, survivor.y);
    const los = segmentClear(game, killer.x, killer.y, survivor.x, survivor.y);
    const killerLooking = coneSees(killer, survivor, KILLER_CONE_LENGTH, KILLER_CONE_ANGLE);
    const killerMoving = Math.abs(killer.input.up - killer.input.down) + Math.abs(killer.input.left - killer.input.right) > 0;

    // Start chase only when the killer actually sees the survivor.
    const startsChase = d <= CHASE_START_RADIUS && los && killerLooking && killerMoving;

    // Once chase has started, keep it alive while the killer is still meaningfully on them.
    // Windows and pallets do not block this, but walls do. When this stops being true,
    // chaseHold counts down for three seconds and the layer_3 music fades out.
    const closePressure = d <= CLOSE_REVEAL_RADIUS * 2.4;
    const keepsChase = survivor.chaseHold > 0 && los && d <= TERROR_RADIUS && (killerLooking || closePressure);

    if (startsChase || keepsChase) {
      survivor.chaseHold = CHASE_HOLD_SECONDS;
    }

    // Music-only memory: if the survivor sees the killer during chase, keep the high chase
    // layer for a few seconds after they look away, until they spot the killer again.
    // This is intentionally separate from chaseHold so audio can be dramatic without
    // changing chase rules, visibility, or win conditions.
    const survivorCanSeeKiller = survivor.chaseHold > 0 && isActorVisibleToViewer(game, survivor, killer);
    if (survivorCanSeeKiller) {
      survivor.killerVisibleHold = CHASE_HOLD_SECONDS;
    }
  }
}

function updateChaseStats(game, dt) {
  for (const survivor of game.actors.values()) {
    if (survivor.role !== "survivor") continue;
    const stats = ensureMatchStats(survivor);
    const inChase = survivor.chaseHold > 0 && !survivor.dead && !survivor.escaped && !survivor.downed && !survivor.hooked;
    if (!inChase) {
      survivor.currentChaseSeconds = 0;
      continue;
    }
    survivor.currentChaseSeconds = (survivor.currentChaseSeconds || 0) + dt;
    stats.chaseSeconds = (stats.chaseSeconds || 0) + dt;
    stats.longestChase = Math.max(stats.longestChase || 0, survivor.currentChaseSeconds);
  }
}

function survivorCanStillAffectMatch(survivor) {
  if (!survivor || survivor.role !== "survivor") return false;
  if (survivor.escaped || survivor.dead || survivor.hooked || survivor.downed) return false;
  // Extra guard for stale edge cases where a survivor reaches 0 HP before the downed flag lands.
  // Humans call this "being dead-ish". Code calls it "please stop keeping the match alive".
  if (Number(survivor.health || 0) <= 0) return false;
  return true;
}

function survivorIsOutOrIncapacitated(survivor) {
  if (!survivor || survivor.role !== "survivor") return true;
  return !!(
    survivor.escaped
    || survivor.dead
    || survivor.hooked
    || survivor.downed
    || Number(survivor.health || 0) <= 0
  );
}

function checkWinConditions(lobby) {
  const game = lobby.game;
  if (!game || game.phase !== "game") return;
  const survivors = [...game.actors.values()].filter((p) => p.role === "survivor");
  if (!survivors.length) return;

  const escapedCount = survivors.filter((p) => p.escaped).length;
  const activeSurvivors = survivors.filter(survivorCanStillAffectMatch);
  const allEscaped = escapedCount === survivors.length;
  const allOutOrIncapacitated = survivors.every(survivorIsOutOrIncapacitated);
  const noOneLeftToPlay = activeSurvivors.length === 0 || allOutOrIncapacitated;

  if (allEscaped) {
    endGame(lobby, "survivors", "All Runners escaped.");
    return;
  }

  // If at least one Survivor escaped and nobody else can still play, end the match immediately.
  // This covers: one player escapes after all bots are dead, hooked, downed, or otherwise 0 HP.
  if (escapedCount > 0 && noOneLeftToPlay) {
    endGame(lobby, "survivors", "Some Runners escaped. The rest were claimed by The Void.");
    return;
  }

  // The Void only gets the win text if nobody escaped.
  if (escapedCount === 0 && noOneLeftToPlay) {
    endGame(lobby, "killer", "No Runners escaped. The Void consumed them all.");
    return;
  }

  // Rifts complete now opens the escape voids. Survivors still have to escape through E tiles.
}

function endGame(lobby, winner, reason) {
  if (!lobby.game || lobby.game.phase === "ended") return;
  const game = lobby.game;
  const finalActors = [...game.actors.values()].map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    dead: !!p.dead,
    escaped: !!p.escaped,
    downed: !!p.downed,
    hooked: !!p.hooked,
    health: p.health,
    stats: serializeMatchStats(p)
  }));
  const finalSurvivors = finalActors.filter((p) => p.role === "survivor");
  const escapedCount = finalSurvivors.filter((p) => p.escaped).length;

  game.phase = "ended";
  game.endedAt = nowMs();
  game.winner = winner;
  game.endReason = reason;
  lobby.phase = "ended";
  touchLobby(lobby);
  io.to(lobby.id).emit("matchEnded", {
    winner,
    reason,
    escapedCount,
    totalSurvivors: finalSurvivors.length,
    finalActors
  });
  broadcastLobbyState(lobby);
  broadcastLobbyList();
}



function resetInput(input) {
  input.up = false;
  input.down = false;
  input.left = false;
  input.right = false;
  input.sprint = false;
  input.action = false;
  input.repair = false;
  input.attack = false;
  input.attackHeld = false;
  input.attackReleased = false;
  input.actionDir = null;
}

function setMoveToward(actor, tx, ty, sprint = false) {
  const dx = tx - actor.x;
  const dy = ty - actor.y;
  actor.input.left = dx < -8;
  actor.input.right = dx > 8;
  actor.input.up = dy < -8;
  actor.input.down = dy > 8;
  actor.input.sprint = !!sprint;
  actor.input.angle = Math.atan2(dy, dx);
}

function setMoveAway(actor, fromX, fromY, sprint = true) {
  const dx = actor.x - fromX;
  const dy = actor.y - fromY;
  const len = Math.hypot(dx, dy) || 1;
  setMoveToward(actor, actor.x + (dx / len) * 300, actor.y + (dy / len) * 300, sprint);
}

function botRandomRepath() {
  return BOT_REPATH_MIN + Math.random() * (BOT_REPATH_MAX - BOT_REPATH_MIN);
}

function tileAt(game, x, y) {
  return {
    x: clamp(Math.floor(x / game.map.tile), 0, game.map.cols - 1),
    y: clamp(Math.floor(y / game.map.tile), 0, game.map.rows - 1)
  };
}

function tileCenter(game, tx, ty) {
  return {
    x: tx * game.map.tile + game.map.tile / 2,
    y: ty * game.map.tile + game.map.tile / 2
  };
}

function clonePath(path) {
  return Array.isArray(path) ? path.map((p) => ({ x: p.x, y: p.y })) : [];
}

function bumpPathCache(game) {
  if (!game) return;
  game.pathCacheEpoch = (game.pathCacheEpoch || 0) + 1;
  game.pathCache?.clear?.();
  game.movementBlockerCache = null;
}

function getCachedPath(game, key) {
  if (!PERF.enablePathCache || !game?.pathCache) return null;
  const cached = game.pathCache.get(key);
  if (!cached) {
    serverMetrics.pathCacheMisses += 1;
    return null;
  }
  serverMetrics.pathCacheHits += 1;
  return clonePath(cached);
}

function setCachedPath(game, key, path) {
  if (!PERF.enablePathCache || !game?.pathCache || !Array.isArray(path)) return;
  if (game.pathCache.size >= PERF.pathCacheMax) {
    const oldest = game.pathCache.keys().next().value;
    if (oldest) game.pathCache.delete(oldest);
  }
  game.pathCache.set(key, clonePath(path));
}

function isWallTile(game, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= game.map.cols || ty >= game.map.rows) return true;
  return game.map.rawRows[ty]?.[tx] === "X";
}

function isDroppedPalletTile(game, tx, ty) {
  return game.map.pallets.some((p) => !p.broken && p.state === "dropped" && p.tileX === tx && p.tileY === ty);
}

function isBrokenPalletTile(game, tx, ty) {
  return game.map.pallets.some((p) => p.broken && p.tileX === tx && p.tileY === ty);
}

function isWindowTile(game, tx, ty) {
  return game.map.windows.some((w) => w.tileX === tx && w.tileY === ty);
}

function botTileClearancePenalty(game, actor, tx, ty) {
  if (!game || !actor) return 0;
  const c = tileCenter(game, tx, ty);
  const body = actor.role === "killer" ? KILLER_SIZE : PLAYER_SIZE;
  const check = Math.max(8, body * 0.44);
  const samples = [
    { x: c.x + check, y: c.y },
    { x: c.x - check, y: c.y },
    { x: c.x, y: c.y + check },
    { x: c.x, y: c.y - check },
    { x: c.x + check * 0.72, y: c.y + check * 0.72 },
    { x: c.x - check * 0.72, y: c.y + check * 0.72 },
    { x: c.x + check * 0.72, y: c.y - check * 0.72 },
    { x: c.x - check * 0.72, y: c.y - check * 0.72 }
  ];

  let penalty = 0;
  for (const sample of samples) {
    if (wouldCollide(game, actor, sample.x, sample.y)) penalty += 0.55;
  }

  // Broken pallets are no longer real blockers, but bots were still choosing the old tile
  // as a path anchor and visually grinding against the debris. Treat it as ugly terrain.
  if (isBrokenPalletTile(game, tx, ty)) penalty += 1.25;
  return penalty;
}

function botMovementBlockingRects(game, actor) {
  // Use real body blockers for movement tests, not vision blockers. Vision ignores windows
  // and pallets, which is great for eyeballs and terrible for bots trying not to ram their
  // little digital faces into furniture.
  return movementBlockingRects(game, actor);
}

function botMovementSegmentClear(game, actor, ax, ay, bx, by) {
  // Body-aware LOS for movement. The old version only tested the actor center, so
  // bots would smooth paths through wall corners and then get stuck trying to fit
  // a 38px Void body through a mathematical point. Computers, somehow, remain literal.
  return bodySegmentClear(game, actor, ax, ay, bx, by, 10);
}

function isPathTileBlocked(game, tx, ty, role, options = {}) {
  if (isWallTile(game, tx, ty)) return true;

  // Windows are not normal floor for The Void; they are tactical shortcuts.
  // During chase we allow the planner to consider them with a cost penalty, then
  // the tactical layer decides whether vaulting actually improves the chase.
  // For patrol/objective movement, keep them blocked so the bot does not cosplay
  // as a windshield wiper through the same window forever.
  if (role === "killer" && isWindowTile(game, tx, ty) && !options.allowKillerWindows) return true;

  // Dropped pallets remain pathable so The Void can walk to them and break them instead of
  // planning a mile-long detour around one rectangle.
  return false;
}

function isPathTileBodyBlocked(game, actor, tx, ty, role, options = {}) {
  if (isPathTileBlocked(game, tx, ty, role, options)) return true;

  // If the chase planner is allowed to reason about windows, keep the window tile in the
  // graph as a deliberate doorway/portal. The movement collision still blocks walking
  // through it; the tactical layer presses Space only when vaulting is actually the right
  // move. Blocking it here made the bot "know" windows existed but never use them.
  if (role === "killer" && options.allowKillerWindows && isWindowTile(game, tx, ty)) return false;

  const c = tileCenter(game, tx, ty);
  return wouldCollide(game, actor, c.x, c.y);
}

function resolvePathGoalTile(game, actor, targetX, targetY, role, options = {}) {
  const desired = tileAt(game, targetX, targetY);
  if (!isPathTileBodyBlocked(game, actor, desired.x, desired.y, role, options)) return desired;

  let best = null;
  let bestScore = Infinity;
  const maxRadius = 7;

  for (let radius = 1; radius <= maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const tx = desired.x + dx;
        const ty = desired.y + dy;
        if (isPathTileBodyBlocked(game, actor, tx, ty, role, options)) continue;
        const c = tileCenter(game, tx, ty);
        const score = dist(c.x, c.y, targetX, targetY) + Math.abs(dx) * 5 + Math.abs(dy) * 5;
        if (score < bestScore) {
          bestScore = score;
          best = { x: tx, y: ty };
        }
      }
    }
    if (best) return best;
  }

  return null;
}

function botRouteEndpoint(game, actor, targetX, targetY, options = {}) {
  const role = options.role || actor.role;
  const pathOptions = { allowKillerWindows: !!options.allowKillerWindows };
  const goal = resolvePathGoalTile(game, actor, targetX, targetY, role, pathOptions);
  if (!goal) return null;
  const c = tileCenter(game, goal.x, goal.y);
  return { x: c.x, y: c.y, tileX: goal.x, tileY: goal.y };
}


function botCheapRouteDistance(game, actor, targetX, targetY, options = {}) {
  if (!game || !actor || !Number.isFinite(targetX) || !Number.isFinite(targetY)) return Infinity;

  const role = options.role || actor.role;
  const endpoint = botRouteEndpoint(game, actor, targetX, targetY, {
    role,
    allowKillerWindows: !!options.allowKillerWindows
  });
  if (!endpoint) return Infinity;

  const directDistance = dist(actor.x, actor.y, endpoint.x, endpoint.y);
  if (
    options.exact !== true
    && directDistance < game.map.tile * 6.5
    && !wouldCollide(game, actor, endpoint.x, endpoint.y)
    && botMovementSegmentClear(game, actor, actor.x, actor.y, endpoint.x, endpoint.y)
  ) {
    return directDistance;
  }

  const start = tileAt(game, actor.x, actor.y);
  const goal = { x: endpoint.tileX, y: endpoint.tileY };
  const dx = Math.abs(goal.x - start.x);
  const dy = Math.abs(goal.y - start.y);
  const octile = (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
  const losPenalty = botMovementSegmentClear(game, actor, actor.x, actor.y, endpoint.x, endpoint.y) ? 0 : game.map.tile * 1.5;
  const tightPenalty = botTileClearancePenalty(game, actor, goal.x, goal.y) * game.map.tile * 1.15;
  game.botCheapRouteFallbacks = (game.botCheapRouteFallbacks || 0) + 1;
  return octile * game.map.tile + losPenalty + tightPenalty;
}

function findPath(game, actor, targetX, targetY, options = {}) {
  const role = options.role || actor.role;
  const pathOptions = {
    allowKillerWindows: !!options.allowKillerWindows
  };
  const start = tileAt(game, actor.x, actor.y);
  const goal = resolvePathGoalTile(game, actor, targetX, targetY, role, pathOptions);
  const key = (x, y) => `${x},${y}`;
  if (!goal) return [];
  const startKey = key(start.x, start.y);
  const goalKey = key(goal.x, goal.y);
  if (startKey === goalKey) return [tileCenter(game, goal.x, goal.y)];

  if (
    dist(actor.x, actor.y, targetX, targetY) < game.map.tile * 7
    && !wouldCollide(game, actor, targetX, targetY)
    && botMovementSegmentClear(game, actor, actor.x, actor.y, targetX, targetY)
  ) {
    return [{ x: targetX, y: targetY }];
  }

  const pathCacheKey = `${game.pathCacheEpoch || 0}|${role}|${pathOptions.allowKillerWindows ? "kwin" : "solid"}|${startKey}|${goalKey}`;
  const cachedPath = getCachedPath(game, pathCacheKey);
  if (cachedPath) return cachedPath;

  const open = [{ x: start.x, y: start.y, f: 0, g: 0 }];
  const cameFrom = new Map();
  const gScore = new Map([[startKey, 0]]);
  const seen = new Set();
  let loops = 0;

  function h(x, y) {
    const dx = Math.abs(x - goal.x);
    const dy = Math.abs(y - goal.y);
    return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
  }

  function movementCost(x, y, diagonal) {
    const palletCost = isDroppedPalletTile(game, x, y)
      ? (role === "killer" ? 2.2 : 1.45)
      : 0;
    const windowCost = role === "killer" && pathOptions.allowKillerWindows && isWindowTile(game, x, y)
      ? 3.35
      : 0;
    const clearanceCost = botTileClearancePenalty(game, actor, x, y);
    return (diagonal ? Math.SQRT2 : 1) + palletCost + windowCost + clearanceCost;
  }

  while (open.length && loops++ < PATHFIND_LOOP_LIMIT) {
    let bestIndex = 0;
    let bestF = open[0].f;
    let bestH = h(open[0].x, open[0].y);
    for (let i = 1; i < open.length; i++) {
      const itemH = h(open[i].x, open[i].y);
      if (open[i].f < bestF || (open[i].f === bestF && itemH < bestH)) {
        bestF = open[i].f;
        bestH = itemH;
        bestIndex = i;
      }
    }
    const current = open.splice(bestIndex, 1)[0];
    const currentKey = key(current.x, current.y);
    if (seen.has(currentKey)) continue;
    seen.add(currentKey);

    if (currentKey === goalKey) {
      const tiles = [];
      let k = currentKey;
      while (k) {
        const [x, y] = k.split(",").map(Number);
        tiles.push(tileCenter(game, x, y));
        k = cameFrom.get(k);
      }
      tiles.reverse();
      const last = tiles[tiles.length - 1];
      if (
        last
        && dist(last.x, last.y, targetX, targetY) > game.map.tile * 0.22
        && !wouldCollide(game, actor, targetX, targetY)
        && botMovementSegmentClear(game, actor, last.x, last.y, targetX, targetY)
      ) {
        tiles.push({ x: targetX, y: targetY });
      }
      setCachedPath(game, pathCacheKey, tiles);
      return tiles;
    }

    const neighbors = [
      { x: current.x + 1, y: current.y, diagonal: false },
      { x: current.x - 1, y: current.y, diagonal: false },
      { x: current.x, y: current.y + 1, diagonal: false },
      { x: current.x, y: current.y - 1, diagonal: false },
      { x: current.x + 1, y: current.y + 1, diagonal: true },
      { x: current.x - 1, y: current.y + 1, diagonal: true },
      { x: current.x + 1, y: current.y - 1, diagonal: true },
      { x: current.x - 1, y: current.y - 1, diagonal: true }
    ];

    for (const n of neighbors) {
      if (isPathTileBodyBlocked(game, actor, n.x, n.y, role, pathOptions)) continue;
      if (n.diagonal) {
        if (
          isPathTileBodyBlocked(game, actor, current.x, n.y, role, pathOptions)
          || isPathTileBodyBlocked(game, actor, n.x, current.y, role, pathOptions)
        ) continue;
      }
      const nk = key(n.x, n.y);
      if (seen.has(nk)) continue;
      const tentative = (gScore.get(currentKey) ?? Infinity) + movementCost(n.x, n.y, n.diagonal);
      if (tentative < (gScore.get(nk) ?? Infinity)) {
        cameFrom.set(nk, currentKey);
        gScore.set(nk, tentative);
        open.push({ x: n.x, y: n.y, g: tentative, f: tentative + h(n.x, n.y) });
      }
    }
  }
  return [];
}

function botPathDistance(path) {
  if (!Array.isArray(path) || !path.length) return Infinity;
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += dist(path[i - 1].x, path[i - 1].y, path[i].x, path[i].y);
  }
  return total;
}

function botEstimateRouteDistance(game, actor, targetX, targetY, options = {}) {
  const budgetCost = Math.max(1, Math.floor(options.budgetCost || 1));
  if (Number.isFinite(game?.botExactRouteBudget)) {
    if (game.botExactRouteBudget < budgetCost) {
      return botCheapRouteDistance(game, actor, targetX, targetY, options);
    }
    game.botExactRouteBudget -= budgetCost;
  }

  const path = findPath(game, actor, targetX, targetY, options);
  if (!path.length) return botCheapRouteDistance(game, actor, targetX, targetY, options);
  return dist(actor.x, actor.y, path[0].x, path[0].y) + botPathDistance(path);
}

function followPath(game, actor, targetX, targetY, sprint = false, options = {}) {
  const bot = actor.bot || (actor.bot = {});
  bot.repath = (bot.repath || 0) - 1 / TICK_RATE;

  const hadMoveInput = actor.input.up || actor.input.down || actor.input.left || actor.input.right;
  bot.stuckCheckElapsed = (bot.stuckCheckElapsed || 0) + (1 / TICK_RATE);
  if (bot.stuckCheckElapsed >= 0.34) {
    const movedSinceLastCheck = dist(actor.x, actor.y, bot.stuckCheckX ?? actor.x, bot.stuckCheckY ?? actor.y);
    const busy = actor.vault || actor.breakTarget || actor.attackState || actor.actionLock > 0 || (actor.role === "killer" && (actor.voidStun || 0) > 0);
    if (hadMoveInput && !busy && movedSinceLastCheck < BOT_PATH_STUCK_REPATH_DISTANCE) {
      bot.stuckTimer = (bot.stuckTimer || 0) + bot.stuckCheckElapsed;
      bot.hardStuckTimer = (bot.hardStuckTimer || 0) + bot.stuckCheckElapsed;
    } else {
      bot.stuckTimer = Math.max(0, (bot.stuckTimer || 0) - bot.stuckCheckElapsed * 1.25);
      bot.hardStuckTimer = Math.max(0, (bot.hardStuckTimer || 0) - bot.stuckCheckElapsed * 0.65);
    }
    bot.stuckCheckElapsed = 0;
    bot.stuckCheckX = actor.x;
    bot.stuckCheckY = actor.y;
  }

  const targetChangedThreshold = options.chase ? game.map.tile * 1.15 : game.map.tile * 0.55;
  const targetChanged = dist(bot.goalX || 0, bot.goalY || 0, targetX, targetY) > targetChangedThreshold;
  const stuckSeconds = actor.role === "survivor" ? BOT_SURVIVOR_STUCK_SECONDS : BOT_KILLER_STUCK_SECONDS;
  const forcedRepath = (bot.stuckTimer || 0) >= stuckSeconds;
  if (forcedRepath) {
    const hardThreshold = actor.role === "survivor" ? BOT_SURVIVOR_STUCK_SECONDS * 2.6 : BOT_KILLER_STUCK_SECONDS * 2.35;
    const emergency = (bot.hardStuckTimer || 0) > hardThreshold
      ? botEmergencyUnstuck(game, actor, targetX, targetY)
      : null;
    const killer = actor.role === "survivor" ? botNearestKiller(game) : null;
    const directionChange = actor.role === "survivor"
      ? botRunnerChaseRedirectPoint(game, actor, killer, { x: targetX, y: targetY })
      : null;
    const unstuck = emergency || directionChange || chooseBotUnstuckPoint(game, actor, targetX, targetY);
    bot.stuckTimer = 0;
    if (emergency) bot.hardStuckTimer = 0;
    else bot.hardStuckTimer = Math.max(0, (bot.hardStuckTimer || 0) - stuckSeconds * 0.45);
    bot.path = unstuck ? [unstuck] : [];
    bot.repath = BOT_REPATH_MIN * 0.45;
    if (actor.role === "survivor") {
      bot.runnerDirectionChangeUntil = (game.time || 0) + 0.95;
      bot.lastTaskProgressAt = game.time || 0;
      bot.goalX = null;
      bot.goalY = null;
    }
    if (unstuck) {
      setMoveToward(actor, unstuck.x, unstuck.y, sprint);
      return;
    }
  }

  if (!bot.path?.length || bot.repath <= 0 || targetChanged) {
    bot.goalX = targetX;
    bot.goalY = targetY;
    bot.path = findPath(game, actor, targetX, targetY, {
      role: actor.role,
      allowKillerWindows: !!options.allowKillerWindows
    });
    bot.repath = botRandomRepath();
  }

  if (!bot.path?.length) {
    if (!wouldCollide(game, actor, targetX, targetY) && botMovementSegmentClear(game, actor, actor.x, actor.y, targetX, targetY)) {
      setMoveToward(actor, targetX, targetY, sprint);
      return;
    }

    const unstuck = actor.role === "survivor"
      ? (botRunnerChaseRedirectPoint(game, actor, botNearestKiller(game), { x: targetX, y: targetY }) || chooseBotUnstuckPoint(game, actor, targetX, targetY))
      : chooseBotUnstuckPoint(game, actor, targetX, targetY);
    if (unstuck) {
      setMoveToward(actor, unstuck.x, unstuck.y, sprint);
      bot.path = [unstuck];
      bot.repath = BOT_REPATH_MIN * 0.4;
      return;
    }

    actor.input.up = actor.input.down = actor.input.left = actor.input.right = false;
    actor.input.sprint = false;
    bot.repath = Math.min(bot.repath || BOT_REPATH_MIN, BOT_REPATH_MIN * 0.5);
    return;
  }

  // Do not force bots to step back onto the exact center of their current tile before
  // continuing to the next waypoint. That center-seeking behavior caused Runner bots to
  // twitch back and forth when their objective path refreshed near walls, rifts, or orbs.
  while (bot.path.length > 1) {
    const first = bot.path[0];
    const second = bot.path[1];
    const firstTile = tileAt(game, first.x, first.y);
    const actorTile = tileAt(game, actor.x, actor.y);
    const firstIsCurrentTileCenter = firstTile.x === actorTile.x && firstTile.y === actorTile.y;
    const closeToFirst = dist(actor.x, actor.y, first.x, first.y) < game.map.tile * 0.42;
    const canHeadToSecond = !wouldCollide(game, actor, second.x, second.y)
      && botMovementSegmentClear(game, actor, actor.x, actor.y, second.x, second.y);
    if ((firstIsCurrentTileCenter && canHeadToSecond) || closeToFirst) {
      bot.path.shift();
      continue;
    }
    break;
  }

  while (bot.path.length > 2) {
    const skip = bot.path[2];
    const skipTile = tileAt(game, skip.x, skip.y);
    const nearTightGeometry = botTileClearancePenalty(game, actor, skipTile.x, skipTile.y) > 0.4;
    if (nearTightGeometry || !botMovementSegmentClear(game, actor, actor.x, actor.y, skip.x, skip.y)) break;
    bot.path.shift();
  }

  let next = bot.path[0];
  if (bot.path.length > 1) {
    const candidate = bot.path[1];
    const candidateTile = tileAt(game, candidate.x, candidate.y);
    const safeToSkip = botTileClearancePenalty(game, actor, candidateTile.x, candidateTile.y) <= 0.25
      && botMovementSegmentClear(game, actor, actor.x, actor.y, candidate.x, candidate.y);
    if (safeToSkip) next = candidate;
  }
  setMoveToward(actor, next.x, next.y, sprint);

  // Objective path-following should not auto-vault/drop pallets. That was the real
  // source of the AFK-Void Runner jitter: bots would walk toward an orb/rift, touch a
  // window or pallet, auto-interact, then path back through/around it again. Survivors
  // now only use loop objects from the threat/flee layer via botUseLoopObject().
  const allowAutoInteract = actor.role === "killer"
    ? options.allowKillerInteract === true
    : options.allowSurvivorInteract === true;
  if (!allowAutoInteract) return;

  const hit = nearestInteractable(game, actor, actor.role === "survivor");
  if (hit && actor.bot.actionCooldown <= 0) {
    const tactical = actor.role === "killer"
      ? hit.type === "palletBreak"
      : (hit.type === "window" || hit.type === "palletVault" || hit.type === "palletBreak");
    const objectId = hit.object?.id || `${hit.type}:${hit.object?.x}:${hit.object?.y}`;
    const recentlyUsed = actor.bot.lastInteractableId === objectId && game.time < (actor.bot.lastInteractableUntil || 0);
    if (!recentlyUsed && tactical && dist(actor.x, actor.y, hit.object.x + hit.object.w / 2, hit.object.y + hit.object.h / 2) <= INTERACT_DISTANCE) {
      actor.input.action = true;
      actor.bot.actionCooldown = actor.role === "killer" ? BOT_KILLER_INTERACT_COOLDOWN : 0.18;
      actor.bot.lastInteractableId = objectId;
      actor.bot.lastInteractableUntil = game.time + (actor.role === "killer" ? BOT_KILLER_WINDOW_REUSE_COOLDOWN : 0.55);
    }
  }
}

function nearestLivingSurvivor(game, actor) {
  let best = null;
  let bestDist = Infinity;
  for (const p of game.actors.values()) {
    if (p.role !== "survivor" || p.dead || p.escaped || p.hooked) continue;
    const d = dist(actor.x, actor.y, p.x, p.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

function livingSurvivors(game) {
  return [...game.actors.values()].filter((p) => p.role === "survivor" && !p.dead && !p.escaped && !p.hooked);
}

function visibleSurvivorsForKiller(game, killer) {
  const visible = [];
  for (const p of game.actors.values()) {
    if (p.role !== "survivor" || p.dead || p.escaped || p.hooked) continue;
    const d = dist(killer.x, killer.y, p.x, p.y);
    const los = segmentClear(game, killer.x, killer.y, p.x, p.y);
    if (!los) continue;
    if (d <= CLOSE_REVEAL_RADIUS || coneSees(killer, p, KILLER_CONE_LENGTH, KILLER_CONE_ANGLE)) {
      const carryingBonus = Math.min(SURVIVOR_DOT_MAX, p.dots || 0) * 4;
      const injuryBonus = (p.health <= 1 || p.injured) ? 95 : 0;
      const downBonus = p.downed ? 360 : 0;
      const chaseBonus = p.chaseHold > 0 ? 60 : 0;
      const gateBonus = p.escapeProgress > 0 ? 170 : 0;
      const score = d - carryingBonus - injuryBonus - downBonus - chaseBonus - gateBonus;
      visible.push({ survivor: p, d, score });
    }
  }
  visible.sort((a, b) => a.score - b.score);
  return visible;
}

function visibleLivingSurvivors(game, killer) {
  return visibleSurvivorsForKiller(game, killer).map((item) => item.survivor);
}

function botNearestKiller(game) {
  return [...(game?.actors?.values?.() || [])].find((p) => p.role === "killer" && !p.dead) || null;
}

function botDistanceToKiller(game, actor) {
  const killer = botNearestKiller(game);
  return killer ? dist(actor.x, actor.y, killer.x, killer.y) : Infinity;
}

function botKillerHasLineOfSight(game, actor) {
  const killer = botNearestKiller(game);
  return !!(killer && segmentClear(game, actor.x, actor.y, killer.x, killer.y));
}

function botAbilityReady(actor, abilityId, role) {
  if (!actor || !abilityId) return false;
  const ability = role === "killer" ? getVoidAbilityDef(abilityId) : getSurvivorAbilityDef(abilityId);
  if (!ability) return false;
  const cooldowns = role === "killer" ? actor.voidAbilityCooldowns : actor.survivorAbilityCooldowns;
  if (Math.max(0, cfgNumber(cooldowns?.[ability.id], 0)) > 0) return false;
  return Math.floor(actor.dots || 0) >= ability.cost;
}

function botTryVoidAbility(game, killer, abilityId) {
  if (!botAbilityReady(killer, abilityId, "killer")) return false;
  return !!applyVoidAbility(game, killer, abilityId).ok;
}

function botTrySurvivorAbility(game, survivor, abilityId) {
  if (!botAbilityReady(survivor, abilityId, "survivor")) return false;
  return !!applySurvivorAbility(game, survivor, abilityId).ok;
}

function chooseDownedSurvivorForHookPursuit(game, killer) {
  let best = null;
  let bestScore = Infinity;
  for (const target of game.actors.values()) {
    if (target.role !== "survivor" || !target.downed || target.hooked || target.dead || target.escaped || target.health > 0) continue;
    const d = dist(killer.x, killer.y, target.x, target.y);
    if (d > BOT_KILLER_HOOK_PURSUIT_RADIUS) continue;
    const route = botCheapRouteDistance(game, killer, target.x, target.y, { role: "killer", allowKillerWindows: true, exact: false });
    const allyPressure = [...game.actors.values()].filter((p) => (
      p.role === "survivor" && p.id !== target.id && !p.dead && !p.escaped && !p.hooked && !p.downed
      && dist(p.x, p.y, target.x, target.y) < HEAL_DISTANCE * 2.8
    )).length;
    const score = (Number.isFinite(route) ? route : d + game.map.tile * 8) - allyPressure * 180 - (target.hookProgress || 0) * 120;
    if (score < bestScore) {
      bestScore = score;
      best = target;
    }
  }
  return best;
}

function botKillerMaybeUseAbility(game, killer, targetInfo, targetDistance, hasClearAttack) {
  if (!killer || killer.role !== "killer" || killer.dead || (killer.voidStun || 0) > 0) return false;
  const survivors = livingSurvivors(game);
  if (!survivors.length) return false;

  const visibleCount = visibleLivingSurvivors(game, killer).length;
  const noReliableTarget = !targetInfo?.actor || targetInfo.visible === false;

  if ((game.runnerReveal || 0) <= 0 && noReliableTarget && survivors.length >= 2 && botTryVoidAbility(game, killer, "voidReveal")) {
    return true;
  }

  if (targetInfo?.actor && targetDistance < BOT_KILLER_ABILITY_CHASE_RADIUS) {
    if ((killer.voidSpeedBoost || 0) <= 0 && targetDistance > LUNGE_ATTACK_RANGE * 1.8 && botTryVoidAbility(game, killer, "nullRush")) {
      return true;
    }
    if ((game.redOrbs || 0) <= 0 && visibleCount >= 1 && (game.collectibleDots?.length || 0) >= 10 && targetDistance > QUICK_ATTACK_RANGE * 1.4) {
      if (botTryVoidAbility(game, killer, "redshiftOrbs")) return true;
    }
  }

  if ((game.runnerReveal || 0) <= 0 && survivors.length === 1 && noReliableTarget && botTryVoidAbility(game, killer, "voidReveal")) {
    return true;
  }

  return false;
}

function botSurvivorMaybeUseAbility(game, survivor, killer, threatened, killerDistance, killerHasLos) {
  if (!survivor || survivor.role !== "survivor" || survivor.dead || survivor.escaped || survivor.hooked || survivor.downed) return false;

  if (threatened && (survivor.stealthStep || 0) <= 0 && (killerHasLos || killerDistance < BOT_SURVIVOR_ABILITY_THREAT_RADIUS || survivor.chaseHold > 0)) {
    if (botTrySurvivorAbility(game, survivor, "stealthStep")) return true;
  }

  const lowInformation = (survivor.riftLens || 0) <= 0 && (survivor.dots || 0) >= 10;
  const objectivePressure = !threatened && ((survivor.dots || 0) >= 18 || game.escapeOpen || (game.collectibleDots?.length || 0) < 10);
  const chaseSetup = threatened && killerDistance > BOT_SURVIVOR_PANIC_RADIUS && killerDistance < BOT_SURVIVOR_THREAT_RADIUS;
  if (lowInformation && (objectivePressure || chaseSetup)) {
    if (botTrySurvivorAbility(game, survivor, "riftLens")) return true;
  }

  return false;
}

function botSafeToRescueOrHeal(game, helper, target, killer, urgent = false) {
  if (!target) return false;
  if (!killer || killer.dead) return true;
  const helperDanger = dist(helper.x, helper.y, killer.x, killer.y);
  const targetDanger = dist(target.x, target.y, killer.x, killer.y);
  if (urgent && targetDanger > BOT_SURVIVOR_PANIC_RADIUS * 0.82) return true;
  if (helperDanger < BOT_SURVIVOR_PANIC_RADIUS || targetDanger < BOT_SURVIVOR_PANIC_RADIUS) return false;
  if (targetDanger < BOT_SURVIVOR_SAFE_KILLER_DISTANCE && segmentClear(game, killer.x, killer.y, target.x, target.y)) return false;
  return true;
}

function nearestUndoneGenerator(game, x, y) {
  let best = null;
  let bestDist = Infinity;
  for (const gen of game.map.generators || []) {
    if (gen.done) continue;
    const d = dist(x, y, gen.x, gen.y);
    if (d < bestDist) {
      bestDist = d;
      best = gen;
    }
  }
  return best ? { gen: best, d: bestDist } : null;
}

function chooseKillerTarget(game, killer) {
  const visible = visibleSurvivorsForKiller(game, killer);
  const target = visible[0]?.survivor || null;

  if (target) {
    killer.bot.targetId = target.id;
    killer.bot.lastSeenX = target.x;
    killer.bot.lastSeenY = target.y;
    killer.bot.lastSeenTime = game.time;
    return { actor: target, x: target.x, y: target.y, visible: true };
  }

  const remembered = killer.bot.targetId ? game.actors.get(killer.bot.targetId) : null;
  if (remembered && !remembered.dead && !remembered.escaped && !remembered.hooked && game.time - (killer.bot.lastSeenTime || 0) < BOT_KILLER_MEMORY_SECONDS) {
    return { actor: remembered, x: killer.bot.lastSeenX, y: killer.bot.lastSeenY, visible: false };
  }

  let scratch = null;
  let scratchScore = Infinity;
  for (const s of game.scratchMarks || []) {
    if (s.ttl <= 0 || game.time - (s.createdAt || 0) >= BOT_KILLER_SCRATCH_MEMORY_SECONDS) continue;
    const d = dist(killer.x, killer.y, s.x, s.y);
    const freshness = Math.max(0, BOT_KILLER_SCRATCH_MEMORY_SECONDS - (game.time - (s.createdAt || 0)));
    const score = d - freshness * 95;
    if (score < scratchScore) {
      scratchScore = score;
      scratch = s;
    }
  }
  if (scratch) return { actor: null, x: scratch.x, y: scratch.y, visible: false };

  const patrol = chooseKillerPatrolTarget(game, killer);
  if (patrol) return patrol;

  return null;
}

function botTargetMovementVector(target) {
  if (!target?.input) return { x: 0, y: 0 };
  const x = (target.input.right ? 1 : 0) - (target.input.left ? 1 : 0);
  const y = (target.input.down ? 1 : 0) - (target.input.up ? 1 : 0);
  const len = Math.hypot(x, y);
  return len > 0.001 ? { x: x / len, y: y / len } : { x: 0, y: 0 };
}

function chooseKillerChasePoint(game, killer, target, targetDistance, hasClearAttack) {
  if (!target) return null;

  // Direct chase only when the body can actually travel there. Otherwise choose a small
  // shortlist of reachable approach points, then spend exact A* only on the best few.
  if (hasClearAttack && botMovementSegmentClear(game, killer, killer.x, killer.y, target.x, target.y)) {
    return { x: target.x, y: target.y, direct: true };
  }

  const move = botTargetMovementVector(target);
  const awayFromKiller = (() => {
    const dx = target.x - killer.x;
    const dy = target.y - killer.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  })();
  const lead = clamp(targetDistance * 0.18, game.map.tile * 1.0, game.map.tile * 4.0);
  const side = { x: -awayFromKiller.y, y: awayFromKiller.x };

  const rawCandidates = [
    { x: target.x + move.x * lead, y: target.y + move.y * lead, weight: -120, label: "lead" },
    { x: target.x, y: target.y, weight: -30, label: "body" },
    { x: target.x + awayFromKiller.x * game.map.tile * 1.15, y: target.y + awayFromKiller.y * game.map.tile * 1.15, weight: 12, label: "behind" },
    { x: target.x + side.x * game.map.tile * 1.45, y: target.y + side.y * game.map.tile * 1.45, weight: 22, label: "flank-a" },
    { x: target.x - side.x * game.map.tile * 1.45, y: target.y - side.y * game.map.tile * 1.45, weight: 22, label: "flank-b" },
    { x: target.x + move.x * game.map.tile * 2.8 + side.x * game.map.tile * 0.9, y: target.y + move.y * game.map.tile * 2.8 + side.y * game.map.tile * 0.9, weight: 58, label: "cutoff-a" },
    { x: target.x + move.x * game.map.tile * 2.8 - side.x * game.map.tile * 0.9, y: target.y + move.y * game.map.tile * 2.8 - side.y * game.map.tile * 0.9, weight: 58, label: "cutoff-b" }
  ];

  const candidates = [];
  for (const raw of rawCandidates) {
    const x = clamp(raw.x, 44, game.map.width - 44);
    const y = clamp(raw.y, 44, game.map.height - 44);
    const endpoint = botRouteEndpoint(game, killer, x, y, { role: "killer", allowKillerWindows: true });
    if (!endpoint) continue;
    const cheapRoute = botCheapRouteDistance(game, killer, endpoint.x, endpoint.y, { role: "killer", allowKillerWindows: true, exact: false });
    if (!Number.isFinite(cheapRoute)) continue;
    const attackLaneBonus = attackSegmentClear(game, endpoint.x, endpoint.y, target.x, target.y) ? -game.map.tile * 1.45 : 0;
    const seesTargetBonus = segmentClear(game, endpoint.x, endpoint.y, target.x, target.y) ? -game.map.tile * 0.55 : 0;
    const closeness = dist(endpoint.x, endpoint.y, target.x, target.y) * 0.50;
    candidates.push({ endpoint, raw, cheapScore: cheapRoute + closeness + raw.weight + attackLaneBonus + seesTargetBonus });
  }

  let best = null;
  let bestScore = Infinity;
  for (const candidate of candidates.sort((a, b) => a.cheapScore - b.cheapScore).slice(0, 3)) {
    const route = botEstimateRouteDistance(game, killer, candidate.endpoint.x, candidate.endpoint.y, {
      role: "killer",
      allowKillerWindows: true,
      budgetCost: 2
    });
    if (!Number.isFinite(route)) continue;
    const tile = tileAt(game, candidate.endpoint.x, candidate.endpoint.y);
    const clearance = botTileClearancePenalty(game, killer, tile.x, tile.y) * game.map.tile * 0.72;
    const score = route + candidate.cheapScore * 0.25 + clearance;
    if (score < bestScore) {
      bestScore = score;
      best = { x: candidate.endpoint.x, y: candidate.endpoint.y, direct: false };
    }
  }

  return best || botRouteEndpoint(game, killer, target.x, target.y, { role: "killer", allowKillerWindows: true }) || { x: target.x, y: target.y, direct: false };
}

function botWindowSide(windowObj, x, y) {
  if (!windowObj) return 0;
  const c = centerOf(windowObj);
  if (windowObj.orientation === "horizontal") return Math.sign(y - c.y) || 0;
  return Math.sign(x - c.x) || 0;
}

function predictedVaultDestination(game, actor, object) {
  if (!game || !actor || !object) return null;
  const c = centerOf(object);
  const offset = game.map.tile * 0.92;
  let toX = actor.x;
  let toY = actor.y;

  if (object.orientation === "horizontal") {
    const side = actor.y < c.y ? -1 : 1;
    toX = clamp(actor.x, object.x + PLAYER_SIZE, object.x + object.w - PLAYER_SIZE);
    toY = c.y - side * offset;
  } else {
    const side = actor.x < c.x ? -1 : 1;
    toX = c.x - side * offset;
    toY = clamp(actor.y, object.y + PLAYER_SIZE, object.y + object.h - PLAYER_SIZE);
  }

  return {
    x: clamp(toX, 44, game.map.width - 44),
    y: clamp(toY, 44, game.map.height - 44)
  };
}

function chooseBotUnstuckPoint(game, actor, targetX, targetY) {
  if (!game || !actor) return null;

  let best = null;
  let bestScore = -Infinity;
  const baseAngle = Math.atan2(targetY - actor.y, targetX - actor.x);
  const radii = [game.map.tile * 0.72, game.map.tile * 1.15, game.map.tile * 1.75, game.map.tile * 2.35];
  const blockers = movementBlockingRects(game, actor);

  for (const radius of radii) {
    for (let i = 0; i < 24; i++) {
      const angle = baseAngle + (Math.PI * 2 * i) / 24;
      const x = clamp(actor.x + Math.cos(angle) * radius, 44, game.map.width - 44);
      const y = clamp(actor.y + Math.sin(angle) * radius, 44, game.map.height - 44);
      if (wouldCollide(game, actor, x, y)) continue;

      const segmentClearToPoint = botMovementSegmentClear(game, actor, actor.x, actor.y, x, y);
      const targetGain = dist(actor.x, actor.y, targetX, targetY) - dist(x, y, targetX, targetY);
      const nearestBlocker = blockers.length
        ? Math.min(...blockers.slice(0, 180).map((w) => pointRectDistance(x, y, w)))
        : game.map.tile * 3;
      const tile = tileAt(game, x, y);
      const clearancePenalty = botTileClearancePenalty(game, actor, tile.x, tile.y);
      const score = targetGain
        + (segmentClearToPoint ? 95 : -35)
        + radius * 0.12
        + Math.min(nearestBlocker || 0, game.map.tile * 3) * 0.09
        - clearancePenalty * 120
        + Math.random() * 6;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }

  return best;
}

function chooseRunnerDirectionChangePoint(game, actor, targetX, targetY, killer = null) {
  if (!game || !actor) return null;
  const bot = actor.bot || (actor.bot = {});
  const tile = game.map.tile || 64;
  const center = { x: game.map.width / 2, y: game.map.height / 2 };
  const targetAngle = Number.isFinite(targetX) && Number.isFinite(targetY)
    ? Math.atan2(targetY - actor.y, targetX - actor.x)
    : Math.atan2(center.y - actor.y, center.x - actor.x);
  const centerAngle = Math.atan2(center.y - actor.y, center.x - actor.x);
  const currentCenterDistance = dist(actor.x, actor.y, center.x, center.y);
  const currentTargetDistance = Number.isFinite(targetX) && Number.isFinite(targetY) ? dist(actor.x, actor.y, targetX, targetY) : currentCenterDistance;
  const currentKillerDistance = killer ? dist(actor.x, actor.y, killer.x, killer.y) : Infinity;
  const nearEdge = actor.x < tile * BOT_SURVIVOR_DEADZONE_EDGE_TILES || actor.y < tile * BOT_SURVIVOR_DEADZONE_EDGE_TILES || actor.x > game.map.width - tile * BOT_SURVIVOR_DEADZONE_EDGE_TILES || actor.y > game.map.height - tile * BOT_SURVIVOR_DEADZONE_EDGE_TILES;
  const away = killer ? botRunnerVectorAwayFromKiller(actor, killer) : null;
  const awayAngle = away ? Math.atan2(away.y, away.x) : null;
  const radii = [tile * 1.4, tile * 2.2, tile * 3.2, tile * 4.25];
  const angles = [];

  const addAngle = (angle) => {
    if (!Number.isFinite(angle)) return;
    const key = Math.round(angle * 1000);
    if (!angles.some((a) => Math.round(a * 1000) === key)) angles.push(angle);
  };

  addAngle(centerAngle);
  addAngle(targetAngle + Math.PI * 0.5);
  addAngle(targetAngle - Math.PI * 0.5);
  addAngle(targetAngle + Math.PI);
  if (awayAngle != null) {
    addAngle(awayAngle);
    addAngle(awayAngle + 0.55);
    addAngle(awayAngle - 0.55);
    addAngle(awayAngle + 1.05);
    addAngle(awayAngle - 1.05);
  }
  for (let i = 0; i < 16; i += 1) addAngle((Math.PI * 2 * i) / 16);

  let best = null;
  let bestScore = -Infinity;
  const lastAngle = Number.isFinite(bot.lastRunnerDirectionChangeAngle) ? bot.lastRunnerDirectionChangeAngle : null;

  for (const radius of radii) {
    for (const angle of angles) {
      const x = clamp(actor.x + Math.cos(angle) * radius, 44, game.map.width - 44);
      const y = clamp(actor.y + Math.sin(angle) * radius, 44, game.map.height - 44);
      if (wouldCollide(game, actor, x, y)) continue;

      const tileAtPoint = tileAt(game, x, y);
      if (isPathTileBodyBlocked(game, actor, tileAtPoint.x, tileAtPoint.y, "survivor")) continue;
      const segmentClearToPoint = botMovementSegmentClear(game, actor, actor.x, actor.y, x, y);
      const route = botCheapRouteDistance(game, actor, x, y, { role: "survivor", exact: false });
      const routePenalty = Number.isFinite(route) ? Math.min(route, tile * 8) * 0.05 : 110;
      const centerGain = currentCenterDistance - dist(x, y, center.x, center.y);
      const targetGain = currentTargetDistance - (Number.isFinite(targetX) && Number.isFinite(targetY) ? dist(x, y, targetX, targetY) : dist(x, y, center.x, center.y));
      const killerGain = killer ? dist(x, y, killer.x, killer.y) - currentKillerDistance : 0;
      const breaksLos = killer ? !segmentClear(game, killer.x, killer.y, x, y) : false;
      const edgeDistance = Math.min(x, y, game.map.width - x, game.map.height - y);
      const edgePenalty = edgeDistance < tile * 1.55 ? 1700 : edgeDistance < tile * BOT_SURVIVOR_DEADZONE_EDGE_TILES ? 780 : 0;
      const cornerPenalty = ((x < tile * BOT_SURVIVOR_CORNER_EDGE_TILES || x > game.map.width - tile * BOT_SURVIVOR_CORNER_EDGE_TILES) && (y < tile * BOT_SURVIVOR_CORNER_EDGE_TILES || y > game.map.height - tile * BOT_SURVIVOR_CORNER_EDGE_TILES)) ? 2600 : 0;
      const clearancePenalty = botTileClearancePenalty(game, actor, tileAtPoint.x, tileAtPoint.y) * 130;
      const sameDirectionPenalty = lastAngle == null ? 0 : Math.max(0, Math.cos(angle - lastAngle)) * 90;

      const score = radius * 0.05
        + (segmentClearToPoint ? 130 : -40)
        + centerGain * (nearEdge ? 3.4 : 0.34)
        + targetGain * (nearEdge ? -0.04 : 0.28)
        + killerGain * (killer ? 2.35 : 0)
        + (breaksLos ? 360 : 0)
        - edgePenalty
        - cornerPenalty
        - clearancePenalty
        - routePenalty
        - sameDirectionPenalty
        + Math.random() * 8;

      if (score > bestScore) {
        bestScore = score;
        best = { x, y, score, directionChange: true };
      }
    }
  }

  if (best) {
    bot.lastRunnerDirectionChangeAngle = Math.atan2(best.y - actor.y, best.x - actor.x);
    return best;
  }
  return null;
}

function botRunnerChaseRedirectPoint(game, actor, killer, target = null) {
  if (!game || !actor) return null;
  const targetX = Number.isFinite(target?.x) ? target.x : game.map.width / 2;
  const targetY = Number.isFinite(target?.y) ? target.y : game.map.height / 2;

  if (killer && !killer.dead) {
    const loop = botFindBestLoopEscape(game, actor, killer, {
      force: true,
      maxApproach: BOT_SURVIVOR_LOOP_CHAIN_RADIUS * 1.08
    });
    if (loop) {
      actor.bot = actor.bot || {};
      actor.bot.preferredLoopId = loop.id;
      actor.bot.preferredLoopUntil = (game.time || 0) + BOT_SURVIVOR_LOOP_COMMIT_SECONDS;
      actor.bot.fleeLoopApproachX = loop.approachX;
      actor.bot.fleeLoopApproachY = loop.approachY;
      return { x: loop.x, y: loop.y, loop, redirect: true };
    }
  }

  return chooseRunnerDirectionChangePoint(game, actor, targetX, targetY, killer)
    || chooseBotUnstuckPoint(game, actor, targetX, targetY);
}

function botRunnerMovementStallRedirect(game, actor, killer, dt, target = null) {
  if (!game || !actor?.isBot || actor.role !== "survivor") return false;
  const bot = actor.bot || (actor.bot = {});
  const now = game.time || 0;
  const busy = actor.vault || actor.breakTarget || actor.actionLock > 0 || actor.dotDepositTargetId || actor.healProgress > 0;
  if (busy) {
    bot.runnerMoveWatchX = actor.x;
    bot.runnerMoveWatchY = actor.y;
    bot.runnerMoveWatchAt = now;
    bot.runnerStillSeconds = 0;
    return false;
  }

  const moved = dist(actor.x, actor.y, bot.runnerMoveWatchX ?? actor.x, bot.runnerMoveWatchY ?? actor.y);
  const expectedInput = actor.input.up || actor.input.down || actor.input.left || actor.input.right || killer;
  if (moved > 12 || !expectedInput) {
    bot.runnerMoveWatchX = actor.x;
    bot.runnerMoveWatchY = actor.y;
    bot.runnerMoveWatchAt = now;
    bot.runnerStillSeconds = 0;
    return false;
  }

  bot.runnerStillSeconds = (bot.runnerStillSeconds || 0) + Math.max(0.001, dt || 1 / BOT_THINK_RATE);
  if (bot.runnerStillSeconds < BOT_SURVIVOR_STALL_REDIRECT_SECONDS) return false;

  bot.runnerStillSeconds = 0;
  bot.runnerMoveWatchX = actor.x;
  bot.runnerMoveWatchY = actor.y;
  bot.runnerMoveWatchAt = now;
  bot.path = [];
  bot.goalX = null;
  bot.goalY = null;
  bot.repath = 0;
  bot.fleeTimer = 0;
  bot.runnerDirectionChangeUntil = now + 1.0;

  const redirect = botRunnerChaseRedirectPoint(game, actor, killer, target);
  if (!redirect) return false;
  setMoveToward(actor, redirect.x, redirect.y, true);
  return true;
}

function botEmergencyUnstuck(game, actor, targetX, targetY) {
  if (!game || !actor?.isBot) return null;
  const startTile = tileAt(game, actor.x, actor.y);
  let best = null;
  let bestScore = Infinity;

  for (let radius = 1; radius <= 7; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const tx = startTile.x + dx;
        const ty = startTile.y + dy;
        if (tx < 0 || ty < 0 || tx >= game.map.cols || ty >= game.map.rows) continue;
        if (isPathTileBodyBlocked(game, actor, tx, ty, actor.role, { allowKillerWindows: actor.role === "killer" })) continue;
        const c = tileCenter(game, tx, ty);
        if (wouldCollide(game, actor, c.x, c.y)) continue;
        const route = botCheapRouteDistance(game, { ...actor, x: c.x, y: c.y }, targetX, targetY, { role: actor.role, allowKillerWindows: actor.role === "killer", exact: false });
        const routeScore = Number.isFinite(route) ? route : dist(c.x, c.y, targetX, targetY) + game.map.tile * 8;
        const score = routeScore + dist(actor.x, actor.y, c.x, c.y) * 0.45 + botTileClearancePenalty(game, actor, tx, ty) * 220;
        if (score < bestScore) {
          bestScore = score;
          best = { x: c.x, y: c.y };
        }
      }
    }
    if (best) break;
  }

  if (best) {
    actor.x = best.x;
    actor.y = best.y;
    actor.bot.path = [];
    actor.bot.repath = 0;
    actor.bot.stuckTimer = 0;
    actor.bot.hardStuckTimer = 0;
    actor.bot.stuckCheckX = actor.x;
    actor.bot.stuckCheckY = actor.y;
    resolveActorOverlaps(game, actor, 8);
  }
  return best;
}

function botPatrolApproachPoints(game, actor, point, radius = null) {
  const r = radius || game.map.tile * 2.35;
  const candidates = [{ x: point.x, y: point.y, direct: true }];
  const steps = 8;
  for (let i = 0; i < steps; i++) {
    const angle = (Math.PI * 2 * i) / steps;
    candidates.push({
      x: clamp(point.x + Math.cos(angle) * r, 44, game.map.width - 44),
      y: clamp(point.y + Math.sin(angle) * r, 44, game.map.height - 44),
      direct: false
    });
  }
  return candidates
    .map((candidate) => {
      const endpoint = botRouteEndpoint(game, actor, candidate.x, candidate.y, { role: actor.role, allowKillerWindows: false });
      if (!endpoint || wouldCollide(game, actor, endpoint.x, endpoint.y)) return null;
      return { ...endpoint, direct: candidate.direct };
    })
    .filter(Boolean);
}

function botSightValueFromPoint(game, x, y) {
  let value = 0;
  for (const gen of game.map.generators || []) {
    if (gen.done) continue;
    if (segmentClear(game, x, y, gen.x, gen.y)) value += 70 + (gen.progress || 0) * 260;
  }
  for (const gate of game.map.gates || []) {
    if (segmentClear(game, x, y, gate.x, gate.y)) value += game.escapeOpen ? 180 : 25;
  }
  for (const survivor of game.actors.values()) {
    if (survivor.role !== "survivor" || survivor.dead || survivor.escaped || survivor.hooked) continue;
    if (segmentClear(game, x, y, survivor.x, survivor.y)) value += 55;
  }
  return value;
}

function chooseKillerPatrolTarget(game, killer) {
  if (!game || !killer) return null;
  if (killer.bot.cachedPatrolTarget && game.time < (killer.bot.cachedPatrolUntil || 0)) {
    return { ...killer.bot.cachedPatrolTarget };
  }

  const objectives = [];
  for (const gen of game.map.generators || []) {
    if (gen.done) continue;
    objectives.push({
      x: gen.x,
      y: gen.y,
      kind: "rift",
      value: 260 + (gen.progress || 0) * 900 + (gen.repairerCount || (gen.repairing ? 1 : 0)) * 320
    });
  }
  for (const gate of game.map.gates || []) {
    objectives.push({ x: gate.x, y: gate.y, kind: "gate", value: game.escapeOpen ? 920 : 80 });
  }

  if (!objectives.length) {
    objectives.push({ x: game.map.width / 2, y: game.map.height / 2, kind: "center", value: 120 });
  }

  const shortlistedObjectives = objectives
    .map((objective) => ({
      objective,
      prescore: dist(killer.x, killer.y, objective.x, objective.y) - objective.value
    }))
    .sort((a, b) => a.prescore - b.prescore)
    .slice(0, 3)
    .map((item) => item.objective);

  let best = null;
  let bestScore = Infinity;
  for (const objective of shortlistedObjectives) {
    const points = botPatrolApproachPoints(game, killer, objective, game.map.tile * 2.2)
      .sort((a, b) => dist(killer.x, killer.y, a.x, a.y) - dist(killer.x, killer.y, b.x, b.y))
      .slice(0, 5);

    for (const point of points) {
      const route = botCheapRouteDistance(game, killer, point.x, point.y, { role: "killer", allowKillerWindows: false, exact: false });
      if (!Number.isFinite(route)) continue;
      const sight = botSightValueFromPoint(game, point.x, point.y);
      const recentPenalty = killer.bot.lastPatrolKind === objective.kind && dist(point.x, point.y, killer.bot.lastPatrolX || -99999, killer.bot.lastPatrolY || -99999) < game.map.tile * 2.6 ? 260 : 0;
      const score = route - objective.value - sight + recentPenalty + Math.random() * 18;
      if (score < bestScore) {
        bestScore = score;
        best = { x: point.x, y: point.y, visible: false, patrol: true, kind: objective.kind };
      }
    }
  }

  if (best) {
    killer.bot.lastPatrolX = best.x;
    killer.bot.lastPatrolY = best.y;
    killer.bot.lastPatrolKind = best.kind;
    killer.bot.cachedPatrolTarget = { ...best };
    killer.bot.cachedPatrolUntil = (game.time || 0) + 0.95 + Math.random() * 0.45;
  }
  return best;
}

function botTargetIsInFacingArc(killer, target, arc = ATTACK_ARC * 1.15) {
  if (!killer || !target) return false;
  const angleToTarget = Math.atan2(target.y - killer.y, target.x - killer.x);
  return angleDiff(angleToTarget, killer.angle || 0) <= arc / 2;
}

function botFaceTarget(killer, target) {
  if (!killer || !target) return;
  const angleToTarget = Math.atan2(target.y - killer.y, target.x - killer.x);
  killer.input.angle = angleToTarget;
  killer.angle = angleToTarget;
}

function botShouldVaultWindow(game, killer, target, hit, hasClearAttack, targetDistance) {
  if (!hit || hit.type !== "window" || !target) return false;
  if (targetDistance < QUICK_ATTACK_RANGE * 1.2 && hasClearAttack) return false;

  const windowObj = hit.object;
  const objectId = windowObj?.id || `window:${windowObj?.x}:${windowObj?.y}`;
  if (killer.bot.lastInteractableId === objectId && game.time < (killer.bot.lastInteractableUntil || 0)) return false;
  if (killer.bot.lastVaultWindowId === objectId && game.time < (killer.bot.lastVaultWindowUntil || 0)) return false;

  const c = centerOf(windowObj);
  if (dist(killer.x, killer.y, c.x, c.y) > INTERACT_DISTANCE + 10) return false;

  const killerSide = botWindowSide(windowObj, killer.x, killer.y);
  const targetSide = botWindowSide(windowObj, target.x, target.y);
  const targetAcrossWindow = killerSide !== 0 && targetSide !== 0 && killerSide !== targetSide;

  const landing = predictedVaultDestination(game, killer, windowObj);
  if (!landing || wouldCollide(game, killer, landing.x, landing.y)) return false;

  const currentDist = dist(killer.x, killer.y, target.x, target.y);
  const landingDist = dist(landing.x, landing.y, target.x, target.y);
  const targetNearWindow = dist(target.x, target.y, c.x, c.y) < game.map.tile * 3.1;
  const windowBetweenKillerAndTarget = segmentClearAgainst([windowObj], killer.x, killer.y, target.x, target.y) === false;

  const ghost = { ...killer, x: landing.x, y: landing.y };
  const noWindowRoute = botEstimateRouteDistance(game, killer, target.x, target.y, { role: "killer", allowKillerWindows: false, budgetCost: 2 });
  const afterVaultRoute = botEstimateRouteDistance(game, ghost, target.x, target.y, { role: "killer", allowKillerWindows: false, budgetCost: 2 });
  const vaultCommitCost = KILLER_SPEED * Math.max(0.35, KILLER_VAULT_TIME * 0.72);
  const vaultRoute = dist(killer.x, killer.y, c.x, c.y) + vaultCommitCost + afterVaultRoute;

  const directGain = currentDist - landingDist;
  const routeGain = noWindowRoute - vaultRoute;
  const attackBlockedAndClose = !hasClearAttack && targetDistance < 520;
  const opensAttackLane = attackSegmentClear(game, landing.x, landing.y, target.x, target.y) && landingDist < LUNGE_ATTACK_RANGE * 1.35;

  // Think a few steps ahead: only take the window if it either shortens the real route,
  // opens an attack lane, or is the obvious loop cut when the Runner is across/near it.
  // This lets windows act like pathways without reviving the old back-and-forth vault circus.
  if (routeGain > game.map.tile * 0.75) return true;
  if (targetAcrossWindow && targetNearWindow && (directGain > game.map.tile * 0.28 || opensAttackLane)) return true;
  if (windowBetweenKillerAndTarget && attackBlockedAndClose && (directGain > game.map.tile * 0.35 || opensAttackLane)) return true;

  return false;
}
function botUseKillerObstacle(game, killer, target, hit, hasClearAttack, targetDistance) {
  if (!hit || killer.bot.actionCooldown > 0) return false;
  const objectId = hit.object?.id || `${hit.type}:${hit.object?.x}:${hit.object?.y}`;
  if (killer.bot.lastInteractableId === objectId && game.time < (killer.bot.lastInteractableUntil || 0)) return false;

  if (hit.type === "palletBreak") {
    const c = centerOf(hit.object);
    // Break pallets aggressively if they block a close chase, trap the bot, or are directly
    // in front of the target path. Dropped pallets are not scenery; they are tasks.
    const stuckPressure = (killer.bot.stuckTimer || 0) > BOT_KILLER_STUCK_SECONDS * 0.42;
    const blocksRoute = target && !botMovementSegmentClear(game, killer, killer.x, killer.y, target.x, target.y);
    const shouldBreak = stuckPressure || blocksRoute || !hasClearAttack || targetDistance < 430 || dist(target.x, target.y, c.x, c.y) < game.map.tile * 2.4;
    if (shouldBreak) {
      killer.input.action = true;
      killer.bot.actionCooldown = 1.0;
      killer.bot.lastInteractableId = objectId;
      killer.bot.lastInteractableUntil = game.time + 1.1;
      killer.bot.path = [];
      killer.bot.repath = 0;
      return true;
    }
  }

  if (botShouldVaultWindow(game, killer, target, hit, hasClearAttack, targetDistance)) {
    killer.input.action = true;
    killer.bot.actionCooldown = Math.max(BOT_KILLER_INTERACT_COOLDOWN, 1.05);
    killer.bot.lastInteractableId = objectId;
    killer.bot.lastInteractableUntil = game.time + 0.42;
    // Do not set lastVaultWindowId here. That cooldown is checked by canStartVault(),
    // so setting it before the action is processed blocks the very vault we just requested.
    // StartVault sets the real reuse cooldown after the bot actually crosses.
    killer.bot.path = [];
    killer.bot.repath = 0;
    return true;
  }

  return false;
}


function botKillerCanStartAttack(killer) {
  if (!killer || killer.role !== "killer" || killer.dead || killer.escaped) return false;
  if ((killer.voidStun || 0) > 0) return false;
  if ((killer.recovery || 0) > 0 || (killer.attackCooldown || 0) > 0) return false;
  if ((killer.actionLock || 0) > 0 || killer.vault || killer.breakTarget || killer.hookActionTargetId) return false;

  // updateKillerAttack requires a clean release frame after a previous swing.
  // If the bot starts holding again too early, it can get stuck fighting the input gate instead
  // of actually attacking, because apparently even robots need trigger discipline.
  if (killer.attackNeedsRelease) {
    killer.input.attack = false;
    killer.input.attackHeld = false;
    killer.input.attackReleased = false;
    return false;
  }

  return !killer.attackState;
}

function botSetAttackIntent(game, killer, target, targetDistance, hasClearAttack) {
  if (!target || !hasClearAttack) return false;

  // Finish an existing charge/lunge instead of releasing and re-pressing every bot tick.
  // Holding lets updateKillerAttack promote the charge into a real lunge at the exact server tick.
  if (killer.attackState === "charging") {
    botFaceTarget(killer, target);
    killer.input.attackHeld = true;
    return true;
  }

  if (!botKillerCanStartAttack(killer)) return false;

  botFaceTarget(killer, target);

  const quickProfile = attackProfile("quick");
  const lungeProfile = attackProfile("lunge");
  const targetInQuickCone = Boolean(pointInAttackSwipe(killer.x, killer.y, killer.angle || 0, target, quickProfile));
  const targetInLungeCone = Boolean(pointInAttackSwipe(killer.x, killer.y, killer.angle || 0, target, lungeProfile));

  // The old bot AI checked a hidden close-AOE value, but the cone-based hit system removed that
  // invisible fallback. Use the real swipe profiles here so bot decisions match what the server can hit.
  if (!targetInQuickCone && !targetInLungeCone) return false;

  // Quick swing only when the survivor is actually inside the quick cone.
  // Use lunge for the medium gap so the bot commits instead of tiny-whiffing forever.
  const quickRange = QUICK_ATTACK_RANGE * 0.72;
  const lungeMin = QUICK_ATTACK_RANGE * 0.62;
  const lungeMax = LUNGE_ATTACK_RANGE * 1.06;

  if (targetInQuickCone && targetDistance <= quickRange) {
    killer.input.attackReleased = true;
    return true;
  }

  if (targetInLungeCone && targetDistance >= lungeMin && targetDistance <= lungeMax) {
    killer.input.attackHeld = true;
    return true;
  }

  return false;
}


function botLoopObjectId(hitOrObject, fallbackType = "loop") {
  const object = hitOrObject?.object || hitOrObject;
  if (!object) return `${fallbackType}:unknown`;
  return object.id || `${fallbackType}:${Math.round(object.x || 0)}:${Math.round(object.y || 0)}`;
}

function botLoopApproachPoint(game, survivor, object) {
  if (!game || !survivor || !object) return null;
  const c = centerOf(object);
  const offset = game.map.tile * 0.78;
  const candidates = [];

  if (object.orientation === "horizontal") {
    const currentSide = Math.sign(survivor.y - c.y) || 1;
    const x = clamp(survivor.x, object.x + PLAYER_SIZE, object.x + object.w - PLAYER_SIZE);
    candidates.push({ x, y: c.y + currentSide * offset });
    candidates.push({ x: c.x, y: c.y + currentSide * offset });
  } else {
    const currentSide = Math.sign(survivor.x - c.x) || 1;
    const y = clamp(survivor.y, object.y + PLAYER_SIZE, object.y + object.h - PLAYER_SIZE);
    candidates.push({ x: c.x + currentSide * offset, y });
    candidates.push({ x: c.x + currentSide * offset, y: c.y });
  }

  let best = null;
  let bestDistance = Infinity;
  for (const raw of candidates) {
    const x = clamp(raw.x, 44, game.map.width - 44);
    const y = clamp(raw.y, 44, game.map.height - 44);
    if (wouldCollide(game, survivor, x, y)) continue;
    const d = dist(survivor.x, survivor.y, x, y);
    if (d < bestDistance) {
      bestDistance = d;
      best = { x, y };
    }
  }

  return best || { x: c.x, y: c.y };
}

function botLoopLandingPoint(game, survivor, killer, object) {
  if (!game || !survivor || !killer || !object) return null;
  const c = centerOf(object);
  const offset = game.map.tile * 1.18;
  const candidates = [];

  if (object.orientation === "horizontal") {
    for (const side of [-1, 1]) {
      const x = clamp(survivor.x, object.x + PLAYER_SIZE, object.x + object.w - PLAYER_SIZE);
      const y = c.y + side * offset;
      candidates.push({ x, y, side });
    }
  } else {
    for (const side of [-1, 1]) {
      const x = c.x + side * offset;
      const y = clamp(survivor.y, object.y + PLAYER_SIZE, object.y + object.h - PLAYER_SIZE);
      candidates.push({ x, y, side });
    }
  }

  let best = null;
  let bestScore = -Infinity;
  const currentKillerDistance = dist(survivor.x, survivor.y, killer.x, killer.y);
  for (const raw of candidates) {
    const x = clamp(raw.x, 44, game.map.width - 44);
    const y = clamp(raw.y, 44, game.map.height - 44);
    if (wouldCollide(game, survivor, x, y)) continue;

    const killerDistance = dist(x, y, killer.x, killer.y);
    const selfDistance = dist(x, y, survivor.x, survivor.y);
    const breaksLos = !segmentClear(game, killer.x, killer.y, x, y);
    const onOppositeSide = object.orientation === "horizontal"
      ? Math.sign(y - c.y) !== Math.sign(killer.y - c.y)
      : Math.sign(x - c.x) !== Math.sign(killer.x - c.x);
    const route = botCheapRouteDistance(game, survivor, x, y, { role: "survivor", exact: false });
    const routePenalty = Number.isFinite(route) ? Math.min(route, 900) * 0.14 : 120;
    const score = (killerDistance - currentKillerDistance) * 1.4
      + (breaksLos ? 360 : 0)
      + (onOppositeSide ? 260 : 0)
      - selfDistance * 0.18
      - routePenalty;

    if (score > bestScore) {
      bestScore = score;
      best = { x, y, score, breaksLos, onOppositeSide };
    }
  }

  return best;
}

function botRunnerEdgeDistance(game, x, y) {
  if (!game?.map) return Infinity;
  return Math.min(x, y, game.map.width - x, game.map.height - y);
}

function botRunnerDeadzonePenalty(game, x, y, scale = 1) {
  const tile = game?.map?.tile || 64;
  const edgeDistance = botRunnerEdgeDistance(game, x, y);
  const edgeSoft = tile * BOT_SURVIVOR_DEADZONE_EDGE_TILES;
  const edgeHard = tile * 1.45;
  const nearCorner = (x < tile * BOT_SURVIVOR_CORNER_EDGE_TILES || x > game.map.width - tile * BOT_SURVIVOR_CORNER_EDGE_TILES)
    && (y < tile * BOT_SURVIVOR_CORNER_EDGE_TILES || y > game.map.height - tile * BOT_SURVIVOR_CORNER_EDGE_TILES);

  let penalty = 0;
  if (edgeDistance < edgeHard) penalty += 1800;
  else if (edgeDistance < edgeSoft) penalty += (edgeSoft - edgeDistance) * 4.2;
  if (nearCorner) penalty += 2200;
  return penalty * scale;
}

function botRunnerPointIsDeadzone(game, x, y) {
  const tile = game?.map?.tile || 64;
  const edgeDistance = botRunnerEdgeDistance(game, x, y);
  const nearCorner = (x < tile * BOT_SURVIVOR_CORNER_EDGE_TILES || x > game.map.width - tile * BOT_SURVIVOR_CORNER_EDGE_TILES)
    && (y < tile * BOT_SURVIVOR_CORNER_EDGE_TILES || y > game.map.height - tile * BOT_SURVIVOR_CORNER_EDGE_TILES);
  return nearCorner || edgeDistance < tile * 1.35;
}

function botRunnerLoopValue(object, type = "loop") {
  if (!object) return 0;
  if (type === "window") return 560;
  if (type === "palletVault") return 380;
  if (type === "pallet") return object.state === "upright" ? 520 : 330;
  if (object.state === "upright") return 500;
  if (object.state === "dropped") return 340;
  return 420;
}

function botFindBestLoopEscape(game, survivor, killer, options = {}) {
  if (!game || !survivor || !killer) return null;

  const tile = game.map.tile || 64;
  const currentKillerDistance = dist(survivor.x, survivor.y, killer.x, killer.y);
  const force = !!options.force;
  const currentEdgePenalty = botRunnerDeadzonePenalty(game, survivor.x, survivor.y, 0.42);
  const maxApproach = Math.max(
    tile * 4.8,
    cfgNumber(options.maxApproach, currentKillerDistance < BOT_SURVIVOR_PANIC_RADIUS
      ? BOT_SURVIVOR_LOOP_CHAIN_RADIUS * 0.72
      : BOT_SURVIVOR_LOOP_CHAIN_RADIUS)
  );

  let best = null;
  let bestScore = -Infinity;

  const objects = [];
  for (const win of game.map.windows || []) objects.push({ object: win, type: "window" });
  for (const pallet of game.map.pallets || []) {
    if (pallet.broken) continue;
    objects.push({
      object: pallet,
      type: pallet.state === "dropped" ? "palletVault" : "pallet"
    });
  }

  objects
    .map((item) => {
      const c = centerOf(item.object);
      const approachPoint = botLoopApproachPoint(game, survivor, item.object);
      const directDistance = approachPoint ? dist(survivor.x, survivor.y, approachPoint.x, approachPoint.y) : Infinity;
      return { ...item, center: c, approachPoint, directDistance };
    })
    .filter((item) => item.approachPoint && item.directDistance <= maxApproach * 1.18)
    .sort((a, b) => a.directDistance - b.directDistance)
    .slice(0, Math.max(BOT_MAX_LOOP_CANDIDATES, force ? 10 : 7))
    .forEach((item) => {
      const { object, type, center: c, approachPoint, directDistance } = item;
      if (wouldCollide(game, survivor, approachPoint.x, approachPoint.y)) return;

      const immediate = directDistance <= INTERACT_DISTANCE + tile * 0.85;
      const route = botCheapRouteDistance(game, survivor, approachPoint.x, approachPoint.y, { role: "survivor", exact: false });
      const routeDistance = Number.isFinite(route) ? route : directDistance + tile * 5;
      if (routeDistance > maxApproach * (force ? 1.65 : 1.38) && !immediate) return;

      const landing = botLoopLandingPoint(game, survivor, killer, object);
      if (!landing) return;

      const approachKillerDistance = dist(approachPoint.x, approachPoint.y, killer.x, killer.y);
      const landingKillerDistance = dist(landing.x, landing.y, killer.x, killer.y);
      const approachGain = approachKillerDistance - currentKillerDistance;
      const landingGain = landingKillerDistance - currentKillerDistance;
      const approachVectorDistance = Math.max(1, dist(survivor.x, survivor.y, approachPoint.x, approachPoint.y));
      const away = botRunnerVectorAwayFromKiller(survivor, killer);
      const approachAwayAlignment = ((approachPoint.x - survivor.x) * away.x + (approachPoint.y - survivor.y) * away.y) / approachVectorDistance;
      const loopBetweenThem = pointSegmentDistance(c.x, c.y, survivor.x, survivor.y, killer.x, killer.y) < tile * 2.35;
      const killerNearLoop = dist(killer.x, killer.y, c.x, c.y) < tile * 2.65;
      const approachBreaksLos = !segmentClear(game, killer.x, killer.y, approachPoint.x, approachPoint.y);
      const landingBreaksLos = !segmentClear(game, killer.x, killer.y, landing.x, landing.y);
      const objectIsDeadzone = botRunnerPointIsDeadzone(game, c.x, c.y);
      const endpointDeadzonePenalty = botRunnerDeadzonePenalty(game, approachPoint.x, approachPoint.y, 1.15)
        + botRunnerDeadzonePenalty(game, landing.x, landing.y, 0.85);

      // Running all the way backward to set up a loop is not looping. It is donating a hit.
      if (approachGain < -tile * 0.28 && !immediate && !approachBreaksLos) return;
      if (approachAwayAlignment < -0.18 && !immediate && !approachBreaksLos) return;
      if (landingKillerDistance < currentKillerDistance - tile * 0.2 && !landingBreaksLos) return;
      if (objectIsDeadzone && !immediate && currentEdgePenalty <= 0) return;

      const targetX = immediate ? landing.x : approachPoint.x;
      const targetY = immediate ? landing.y : approachPoint.y;
      const targetDistance = dist(survivor.x, survivor.y, targetX, targetY);
      const sideSafety = landing.onOppositeSide ? 230 : 0;
      const lineSafety = (approachBreaksLos ? 240 : 0) + (landingBreaksLos ? 420 : 0);
      const baseValue = botRunnerLoopValue(object, type);
      const deadzoneEscapeBonus = Math.min(900, currentEdgePenalty * 0.8);

      const score = baseValue
        + landing.score * 0.82
        + landingGain * 2.15
        + Math.max(-120, approachGain * 1.1)
        + approachAwayAlignment * 185
        + sideSafety
        + lineSafety
        + (loopBetweenThem ? 260 : 0)
        + (killerNearLoop ? 120 : 0)
        + (immediate ? 290 : 0)
        + deadzoneEscapeBonus
        - routeDistance * 0.58
        - targetDistance * 0.20
        - endpointDeadzonePenalty
        - (objectIsDeadzone ? 650 : 0);

      if (score > bestScore) {
        bestScore = score;
        best = {
          id: botLoopObjectId(object, type),
          type,
          object,
          x: targetX,
          y: targetY,
          landingX: landing.x,
          landingY: landing.y,
          approachX: approachPoint.x,
          approachY: approachPoint.y,
          score,
          usableSoon: immediate,
          routeDistance
        };
      }
    });

  const threshold = force ? -120 : 110;
  return best && best.score > threshold ? best : null;
}


function botRunnerVectorAwayFromKiller(survivor, killer) {
  let dx = survivor.x - killer.x;
  let dy = survivor.y - killer.y;
  let len = Math.hypot(dx, dy);
  if (len < 0.001) {
    const angle = Number.isFinite(survivor.angle) ? survivor.angle : Math.random() * Math.PI * 2;
    dx = Math.cos(angle);
    dy = Math.sin(angle);
    len = 1;
  }
  return { x: dx / len, y: dy / len };
}

function botRunnerCurrentInputVector(actor) {
  const dx = (actor.input.right ? 1 : 0) - (actor.input.left ? 1 : 0);
  const dy = (actor.input.down ? 1 : 0) - (actor.input.up ? 1 : 0);
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return null;
  return { x: dx / len, y: dy / len };
}

function botRunnerInputMovesCloserToKiller(game, survivor, killer, options = {}) {
  if (!game || !survivor || !killer) return false;
  const vec = botRunnerCurrentInputVector(survivor);
  if (!vec) return false;

  const currentDistance = dist(survivor.x, survivor.y, killer.x, killer.y);
  const lookahead = Math.max(game.map.tile * 0.55, cfgNumber(options.lookahead, game.map.tile * 0.9));
  const projectedX = clamp(survivor.x + vec.x * lookahead, 36, game.map.width - 36);
  const projectedY = clamp(survivor.y + vec.y * lookahead, 36, game.map.height - 36);
  const projectedDistance = dist(projectedX, projectedY, killer.x, killer.y);
  const away = botRunnerVectorAwayFromKiller(survivor, killer);
  const awayAlignment = vec.x * away.x + vec.y * away.y;
  const toleratedLoss = cfgNumber(options.toleratedLoss, game.map.tile * 0.12);

  // True backwards input in chase is poison: it either hands the Void a hit or makes the bot
  // look like it is reconsidering every life choice it has ever made. Sidesteps are fine,
  // but anything that meaningfully closes distance is replaced below.
  return awayAlignment < -0.08 || projectedDistance < currentDistance - toleratedLoss;
}

function botRunnerBestNoBacktrackPoint(game, survivor, killer, target = null, options = {}) {
  if (!game || !survivor || !killer) return null;

  const away = botRunnerVectorAwayFromKiller(survivor, killer);
  const tangent = { x: -away.y, y: away.x };
  const currentDistance = dist(survivor.x, survivor.y, killer.x, killer.y);
  const targetAngle = target && Number.isFinite(target.x) && Number.isFinite(target.y)
    ? Math.atan2(target.y - survivor.y, target.x - survivor.x)
    : Math.atan2(away.y, away.x);
  const allowTangent = options.allowTangent !== false;

  const candidates = [];
  const radii = [game.map.tile * 1.6, game.map.tile * 2.7, game.map.tile * 4.1];
  const rawDirs = [
    { x: away.x, y: away.y, label: "away" },
    { x: away.x * 0.86 + tangent.x * 0.5, y: away.y * 0.86 + tangent.y * 0.5, label: "awayRight" },
    { x: away.x * 0.86 - tangent.x * 0.5, y: away.y * 0.86 - tangent.y * 0.5, label: "awayLeft" },
    { x: away.x * 0.58 + tangent.x * 0.82, y: away.y * 0.58 + tangent.y * 0.82, label: "wideRight" },
    { x: away.x * 0.58 - tangent.x * 0.82, y: away.y * 0.58 - tangent.y * 0.82, label: "wideLeft" }
  ];

  if (allowTangent) {
    rawDirs.push({ x: tangent.x, y: tangent.y, label: "sideRight" });
    rawDirs.push({ x: -tangent.x, y: -tangent.y, label: "sideLeft" });
  }

  for (const dir of rawDirs) {
    const len = Math.hypot(dir.x, dir.y) || 1;
    const nx = dir.x / len;
    const ny = dir.y / len;
    for (const radius of radii) {
      candidates.push({
        x: clamp(survivor.x + nx * radius, 44, game.map.width - 44),
        y: clamp(survivor.y + ny * radius, 44, game.map.height - 44),
        dirX: nx,
        dirY: ny,
        radius,
        label: dir.label
      });
    }
  }

  if (target && Number.isFinite(target.x) && Number.isFinite(target.y)) {
    const tx = target.x - survivor.x;
    const ty = target.y - survivor.y;
    const tl = Math.hypot(tx, ty) || 1;
    const txNorm = tx / tl;
    const tyNorm = ty / tl;
    const alignment = txNorm * away.x + tyNorm * away.y;
    if (alignment >= -0.02) {
      candidates.push({
        x: clamp(survivor.x + txNorm * game.map.tile * 2.2, 44, game.map.width - 44),
        y: clamp(survivor.y + tyNorm * game.map.tile * 2.2, 44, game.map.height - 44),
        dirX: txNorm,
        dirY: tyNorm,
        radius: game.map.tile * 2.2,
        label: "targetSafe"
      });
    }
  }

  let best = null;
  let bestScore = -Infinity;
  const seen = new Set();
  for (const raw of candidates) {
    const key = `${Math.round(raw.x / 6)},${Math.round(raw.y / 6)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (wouldCollide(game, survivor, raw.x, raw.y)) continue;

    const candidateDistance = dist(raw.x, raw.y, killer.x, killer.y);
    const gain = candidateDistance - currentDistance;
    if (gain < -game.map.tile * 0.04) continue;

    const segmentClearToPoint = botMovementSegmentClear(game, survivor, survivor.x, survivor.y, raw.x, raw.y);
    if (!segmentClearToPoint && raw.label?.startsWith("side")) continue;

    const breaksLos = !segmentClear(game, killer.x, killer.y, raw.x, raw.y);
    const targetAlignment = target && Number.isFinite(target.x) && Number.isFinite(target.y)
      ? Math.cos(Math.atan2(raw.y - survivor.y, raw.x - survivor.x) - targetAngle)
      : 0;
    const tile = tileAt(game, raw.x, raw.y);
    const clearancePenalty = botTileClearancePenalty(game, survivor, tile.x, tile.y) * 115;
    const edgeDistance = Math.min(raw.x, raw.y, game.map.width - raw.x, game.map.height - raw.y);
    const edgePenalty = edgeDistance < game.map.tile * 1.55 ? 360 : edgeDistance < game.map.tile * 2.5 ? 170 : 0;
    const cornerPenalty = ((raw.x < game.map.tile * 2 || raw.x > game.map.width - game.map.tile * 2)
      && (raw.y < game.map.tile * 2 || raw.y > game.map.height - game.map.tile * 2)) ? 290 : 0;
    const centerGain = dist(survivor.x, survivor.y, game.map.width / 2, game.map.height / 2) - dist(raw.x, raw.y, game.map.width / 2, game.map.height / 2);
    const route = botCheapRouteDistance(game, survivor, raw.x, raw.y, { role: "survivor", exact: false });
    const routePenalty = Number.isFinite(route) ? Math.min(route, game.map.tile * 7) * 0.05 : 120;

    const score = gain * 2.1
      + raw.radius * 0.08
      + (breaksLos ? 420 : 0)
      + (segmentClearToPoint ? 125 : -45)
      + targetAlignment * 70
      - routePenalty
      + centerGain * 0.22
      - clearancePenalty
      - edgePenalty
      - cornerPenalty;

    if (score > bestScore) {
      bestScore = score;
      best = { x: raw.x, y: raw.y, score, gain, label: raw.label };
    }
  }

  return best;
}

function botRunnerApplyChaseMovementGuard(game, survivor, killer, target = null, options = {}) {
  if (!game || !survivor || !killer) return false;
  if (survivor.vault || survivor.breakTarget || survivor.actionLock > 0) return false;
  if (!botRunnerInputMovesCloserToKiller(game, survivor, killer, options)) return false;

  const safePoint = botRunnerBestNoBacktrackPoint(game, survivor, killer, target, options);
  if (safePoint) {
    setMoveToward(survivor, safePoint.x, safePoint.y, true);
    survivor.bot.path = [];
    survivor.bot.repath = 0;
    survivor.bot.noBacktrackUntil = (game.time || 0) + 0.35;
    return true;
  }

  setMoveAway(survivor, killer.x, killer.y, true);
  survivor.bot.path = [];
  survivor.bot.repath = 0;
  survivor.bot.noBacktrackUntil = (game.time || 0) + 0.35;
  return true;
}

function botRunnerEmergencyFleePoint(game, survivor, killer) {
  if (!game || !survivor || !killer) return null;

  const away = botRunnerVectorAwayFromKiller(survivor, killer);
  const tangent = { x: -away.y, y: away.x };
  const currentKillerDistance = dist(survivor.x, survivor.y, killer.x, killer.y);

  // Even emergency fleeing should prefer a playable loop if the killer is not literally
  // chewing on the Runner. This is the difference between "survivor AI" and "corner enthusiast."
  if (currentKillerDistance > BOT_SURVIVOR_CONTACT_RADIUS * 0.58) {
    const loopEscape = botFindBestLoopEscape(game, survivor, killer, {
      force: true,
      maxApproach: BOT_SURVIVOR_LOOP_CHAIN_RADIUS * 0.95
    });
    if (loopEscape) {
      survivor.bot.preferredLoopId = loopEscape.id;
      survivor.bot.preferredLoopUntil = (game.time || 0) + BOT_SURVIVOR_LOOP_COMMIT_SECONDS;
      survivor.bot.fleeLoopApproachX = loopEscape.approachX;
      survivor.bot.fleeLoopApproachY = loopEscape.approachY;
      return { x: loopEscape.x, y: loopEscape.y, score: loopEscape.score + 600, loop: loopEscape, emergency: true };
    }
  }

  const radii = [
    game.map.tile * 3.2,
    game.map.tile * 4.7,
    game.map.tile * 6.2,
    game.map.tile * 8.0
  ];
  const offsets = [0, 0.35, -0.35, 0.72, -0.72, 1.1, -1.1];

  let best = null;
  let bestScore = -Infinity;
  for (const radius of radii) {
    for (const sideOffset of offsets) {
      const vx = away.x * Math.cos(sideOffset) + tangent.x * Math.sin(sideOffset);
      const vy = away.y * Math.cos(sideOffset) + tangent.y * Math.sin(sideOffset);
      const rawX = clamp(survivor.x + vx * radius, 44, game.map.width - 44);
      const rawY = clamp(survivor.y + vy * radius, 44, game.map.height - 44);
      const endpoint = botRouteEndpoint(game, survivor, rawX, rawY, { role: "survivor" });
      if (!endpoint) continue;
      if (wouldCollide(game, survivor, endpoint.x, endpoint.y)) continue;

      const killerDistance = dist(endpoint.x, endpoint.y, killer.x, killer.y);
      if (killerDistance < currentKillerDistance + game.map.tile * 0.55) continue;

      const route = botCheapRouteDistance(game, survivor, endpoint.x, endpoint.y, { role: "survivor", exact: false });
      if (!Number.isFinite(route)) continue;

      const breaksLos = !segmentClear(game, killer.x, killer.y, endpoint.x, endpoint.y);
      const directAwayAlignment = ((endpoint.x - survivor.x) * away.x + (endpoint.y - survivor.y) * away.y) / Math.max(1, dist(survivor.x, survivor.y, endpoint.x, endpoint.y));
      const edgeDistance = Math.min(endpoint.x, endpoint.y, game.map.width - endpoint.x, game.map.height - endpoint.y);
      const nearEdgePenalty = edgeDistance < game.map.tile * 1.65 ? 1700 : edgeDistance < game.map.tile * BOT_SURVIVOR_DEADZONE_EDGE_TILES ? 780 : 0;
      const cornerPenalty = ((endpoint.x < game.map.tile * BOT_SURVIVOR_CORNER_EDGE_TILES || endpoint.x > game.map.width - game.map.tile * BOT_SURVIVOR_CORNER_EDGE_TILES)
        && (endpoint.y < game.map.tile * BOT_SURVIVOR_CORNER_EDGE_TILES || endpoint.y > game.map.height - game.map.tile * BOT_SURVIVOR_CORNER_EDGE_TILES)) ? 2600 : 0;
      const centerGain = dist(survivor.x, survivor.y, game.map.width / 2, game.map.height / 2) - dist(endpoint.x, endpoint.y, game.map.width / 2, game.map.height / 2);
      const routePenalty = Math.min(route, game.map.tile * 14) * 0.28;
      const score = killerDistance * 0.98
        + (breaksLos ? 560 : 0)
        + directAwayAlignment * 260
        + centerGain * 0.34
        - routePenalty
        - nearEdgePenalty
        - cornerPenalty
        - botTileClearancePenalty(game, survivor, endpoint.tileX, endpoint.tileY) * 95;

      if (score > bestScore) {
        bestScore = score;
        best = { x: endpoint.x, y: endpoint.y, score, emergency: true };
      }
    }
  }

  if (best) return best;

  // Last resort: don't stand there vibrating. Pick a local nudge away from the killer.
  const fallback = chooseBotUnstuckPoint(game, survivor, survivor.x + away.x * game.map.tile * 4, survivor.y + away.y * game.map.tile * 4);
  if (fallback) return { ...fallback, emergency: true, score: -1 };
  return {
    x: clamp(survivor.x + away.x * game.map.tile * 3, 44, game.map.width - 44),
    y: clamp(survivor.y + away.y * game.map.tile * 3, 44, game.map.height - 44),
    emergency: true,
    score: -2
  };
}

function botRunnerFleeProgressStalled(game, survivor, killer, killerDistance, dt) {
  const bot = survivor.bot || (survivor.bot = {});
  const now = game.time || 0;
  if (!killer || !Number.isFinite(killerDistance)) {
    bot.fleeProgressLastDistance = null;
    bot.fleeProgressLastAt = now;
    bot.fleeNoProgressFor = 0;
    return false;
  }

  const lastDistance = Number.isFinite(bot.fleeProgressLastDistance) ? bot.fleeProgressLastDistance : killerDistance;
  const gained = killerDistance - lastDistance;
  if (gained >= BOT_SURVIVOR_FLEE_PROGRESS_MIN_GAIN || killerDistance > BOT_SURVIVOR_LOOP_RADIUS) {
    bot.fleeProgressLastDistance = killerDistance;
    bot.fleeProgressLastAt = now;
    bot.fleeNoProgressFor = 0;
    return false;
  }

  // If the bot is close to The Void and has not increased distance, escalate quickly.
  // This is the real fix for the stationary-Void jiggle: progress away is mandatory.
  if (killerDistance < BOT_SURVIVOR_CONTACT_RADIUS * 1.28) {
    bot.fleeNoProgressFor = (bot.fleeNoProgressFor || 0) + Math.max(0.001, dt || 1 / BOT_THINK_RATE);
  } else {
    bot.fleeNoProgressFor = Math.max(0, (bot.fleeNoProgressFor || 0) - Math.max(0.001, dt || 1 / BOT_THINK_RATE) * 0.5);
  }

  // Slowly update the baseline so a bot doesn't get punished forever after one bad route,
  // while still requiring visible distance gain when body-close to The Void.
  if (now - (bot.fleeProgressLastAt || now) > 0.85) {
    bot.fleeProgressLastDistance = Math.min(lastDistance, killerDistance);
    bot.fleeProgressLastAt = now;
  }

  return (bot.fleeNoProgressFor || 0) >= BOT_SURVIVOR_FLEE_PROGRESS_SECONDS;
}

function botRunnerSetFleeTarget(game, survivor, flee, duration = BOT_SURVIVOR_FLEE_COMMIT_SECONDS) {
  const bot = survivor.bot || (survivor.bot = {});
  bot.fleeX = flee.x;
  bot.fleeY = flee.y;
  bot.fleeTimer = duration + Math.random() * 0.18;
  bot.fleeLockUntil = (game.time || 0) + bot.fleeTimer + 0.35;
  bot.path = [];
  bot.repath = 0;
  bot.goalX = null;
  bot.goalY = null;
}

function botRunnerDangerObjectiveKey(kind, targetOrTask) {
  if (!kind || !targetOrTask) return null;
  const id = targetOrTask.id || `${kind}:${Math.round(targetOrTask.x || 0)}:${Math.round(targetOrTask.y || 0)}`;
  return `${kind}:${id}`;
}

function botRunnerObjectiveTemporarilyAvoided(game, actor, kind, targetOrTask) {
  const bot = actor?.bot;
  if (!bot || !kind || !targetOrTask) return false;
  if ((bot.runnerDangerAvoidUntil || 0) <= (game.time || 0)) return false;
  const key = botRunnerDangerObjectiveKey(kind, targetOrTask);
  return !!key && bot.runnerDangerAvoidKey === key;
}

function botRunnerRememberDangerousObjective(game, actor, kind, targetOrTask) {
  const bot = actor?.bot || (actor.bot = {});
  const key = botRunnerDangerObjectiveKey(kind, targetOrTask);
  if (!key) return;
  bot.runnerDangerAvoidKey = key;
  bot.runnerDangerAvoidKind = kind;
  bot.runnerDangerAvoidUntil = (game.time || 0) + BOT_SURVIVOR_TERROR_OBJECTIVE_AVOID_SECONDS + Math.random() * 0.6;
}

function botRunnerAbortObjectiveForTerror(game, actor) {
  if (!actor?.bot) return;
  const bot = actor.bot;
  const task = bot.runnerTask || bot.survivorTask;
  const hadObjectiveMemory = !!(bot.objectiveDotId || bot.objectiveGenId || bot.runnerDecisionLockUntil);
  if (task && (task.kind === "dot" || task.kind === "gen")) {
    botRunnerRememberDangerousObjective(game, actor, task.kind, task);
  }
  if (task || hadObjectiveMemory) botRunnerClearTask(actor, true);
  bot.runnerDecisionLockUntil = 0;
  bot.runnerRiskUntil = 0;
  bot.runnerAvoidUntil = 0;
  bot.objectiveDotId = null;
  bot.objectiveGenId = null;
}

function botRunnerStartTerrorFlee(game, actor, killer, killerDistance) {
  if (!game || !actor?.bot || !killer) return;
  const now = game.time || 0;
  const bot = actor.bot;
  const task = bot.runnerTask || bot.survivorTask;
  const taskKey = task ? botRunnerDangerObjectiveKey(task.kind, task) : null;
  const wasTerrorFleeActive = (bot.runnerTerrorFleeUntil || 0) > now;

  bot.runnerTerrorFleeUntil = Math.max(bot.runnerTerrorFleeUntil || 0, now + BOT_SURVIVOR_TERROR_FLEE_SECONDS);
  bot.emergencyFleeUntil = Math.max(bot.emergencyFleeUntil || 0, now + Math.min(BOT_SURVIVOR_TERROR_FLEE_SECONDS, BOT_SURVIVOR_EMERGENCY_FLEE_SECONDS + 0.75));

  // Only blow away pathing when the bot is newly reacting or still holding an objective.
  // Resetting this every think tick would create a new kind of jitter, because naturally
  // the solution to one loop should not be inventing a second loop with a different hat.
  if (taskKey && (bot.runnerTerrorLastAbortedKey !== taskKey || (bot.runnerTerrorLastAbortedUntil || 0) <= now)) {
    bot.runnerTerrorLastAbortedKey = taskKey;
    bot.runnerTerrorLastAbortedUntil = now + BOT_SURVIVOR_TERROR_OBJECTIVE_AVOID_SECONDS;
    botRunnerAbortObjectiveForTerror(game, actor);
  } else if (!wasTerrorFleeActive || (bot.fleeTimer || 0) <= 0) {
    bot.path = [];
    bot.repath = 0;
    bot.goalX = null;
    bot.goalY = null;
  }

  bot.runnerTerrorLastReactedAt = now;
}

function chooseFleePoint(game, survivor, killer) {
  const actorTile = tileAt(game, survivor.x, survivor.y);
  let best = { x: survivor.x, y: survivor.y, score: -Infinity, loop: null };
  const radius = BOT_FLEE_SCAN_RADIUS;
  const currentKillerDistance = dist(survivor.x, survivor.y, killer.x, killer.y);
  const loopEscape = botFindBestLoopEscape(game, survivor, killer);

  // DBD-ish chase rule: if a real window/pallet route is available, commit to the tile.
  // Do not let a mathematically far corner beat an actual loop resource. Corners are where
  // bot dignity goes to die.
  if (loopEscape) {
    survivor.bot.preferredLoopId = loopEscape.id;
    survivor.bot.preferredLoopUntil = (game.time || 0) + BOT_SURVIVOR_LOOP_COMMIT_SECONDS;
    survivor.bot.fleeLoopApproachX = loopEscape.approachX;
    survivor.bot.fleeLoopApproachY = loopEscape.approachY;
    return {
      x: loopEscape.x,
      y: loopEscape.y,
      score: loopEscape.score + 800,
      loop: loopEscape
    };
  }

  const nearbyLoops = [];
  for (const win of game.map.windows || []) nearbyLoops.push({ object: win, value: 430 });
  for (const pallet of game.map.pallets || []) {
    if (!pallet.broken) nearbyLoops.push({ object: pallet, value: pallet.state === "upright" ? 520 : 310 });
  }

  const candidates = [];
  for (let ty = actorTile.y - radius; ty <= actorTile.y + radius; ty++) {
    for (let tx = actorTile.x - radius; tx <= actorTile.x + radius; tx++) {
      const edge = Math.abs(tx - actorTile.x) === radius || Math.abs(ty - actorTile.y) === radius;
      const strideHit = ((Math.abs(tx - actorTile.x) + Math.abs(ty - actorTile.y)) % BOT_FLEE_SAMPLE_STRIDE) === 0;
      if (!edge && !strideHit) continue;
      candidates.push({ tx, ty });
    }
  }

  // Always include cardinal escape lanes. They make the bot feel more deliberate and avoid
  // missing obvious safe tiles just because the sampled grid skipped them.
  for (const [dx, dy] of [[radius,0],[-radius,0],[0,radius],[0,-radius],[radius,radius],[-radius,radius],[radius,-radius],[-radius,-radius]]) {
    candidates.push({ tx: actorTile.x + dx, ty: actorTile.y + dy });
  }

  const seen = new Set();
  for (const { tx, ty } of candidates) {
    const key = `${tx},${ty}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (tx < 0 || ty < 0 || tx >= game.map.cols || ty >= game.map.rows) continue;
    if (isPathTileBlocked(game, tx, ty, survivor.role)) continue;
    const p = tileCenter(game, tx, ty);
    if (wouldCollide(game, survivor, p.x, p.y)) continue;

    const distanceFromKiller = dist(p.x, p.y, killer.x, killer.y);
    const distanceFromSelf = dist(p.x, p.y, survivor.x, survivor.y);
    if (distanceFromSelf < game.map.tile * 1.15) continue;
    if (distanceFromKiller < currentKillerDistance - game.map.tile * 0.35) continue;

    const breaksLos = !segmentClear(game, killer.x, killer.y, p.x, p.y);
    const route = botCheapRouteDistance(game, survivor, p.x, p.y, { role: "survivor", exact: false });
    const selfHasPath = Number.isFinite(route) && route < game.map.tile * 11.5;
    const pathPenalty = Number.isFinite(route) ? route * 0.10 : distanceFromSelf * 0.32 + 160;
    const edgeDistance = Math.min(p.x, p.y, game.map.width - p.x, game.map.height - p.y);
    const nearEdgePenalty = edgeDistance < game.map.tile * 1.65 ? 1700 : edgeDistance < game.map.tile * BOT_SURVIVOR_DEADZONE_EDGE_TILES ? 780 : 0;
    const cornerPenalty = ((p.x < game.map.tile * BOT_SURVIVOR_CORNER_EDGE_TILES || p.x > game.map.width - game.map.tile * BOT_SURVIVOR_CORNER_EDGE_TILES)
      && (p.y < game.map.tile * BOT_SURVIVOR_CORNER_EDGE_TILES || p.y > game.map.height - game.map.tile * BOT_SURVIVOR_CORNER_EDGE_TILES)) ? 2600 : 0;

    let loopBonus = 0;
    for (const item of nearbyLoops) {
      const c = centerOf(item.object);
      const d = dist(p.x, p.y, c.x, c.y);
      if (d < game.map.tile * 4.8) loopBonus += Math.max(0, item.value - d * 0.46);
    }

    const towardMapCenter = (dist(survivor.x, survivor.y, game.map.width / 2, game.map.height / 2) - dist(p.x, p.y, game.map.width / 2, game.map.height / 2)) * 0.18;
    const score = distanceFromKiller * 0.92
      + (breaksLos ? 520 : 0)
      + (selfHasPath ? 120 : 0)
      + loopBonus
      + towardMapCenter
      - pathPenalty
      - distanceFromSelf * 0.08
      - nearEdgePenalty
      - cornerPenalty;
    if (score > best.score) best = { x: p.x, y: p.y, score, loop: null };
  }

  if (best.loop) {
    survivor.bot.preferredLoopId = best.loop.id;
    survivor.bot.preferredLoopUntil = (game.time || 0) + 1.15;
    survivor.bot.fleeLoopApproachX = best.loop.approachX;
    survivor.bot.fleeLoopApproachY = best.loop.approachY;
  } else if ((survivor.bot.preferredLoopUntil || 0) < (game.time || 0)) {
    survivor.bot.preferredLoopId = null;
  }

  if (!Number.isFinite(best.score) || best.score === -Infinity || dist(best.x, best.y, survivor.x, survivor.y) < game.map.tile * 0.82) {
    const redirect = botRunnerChaseRedirectPoint(game, survivor, killer, { x: game.map.width / 2, y: game.map.height / 2 });
    if (redirect) return { x: redirect.x, y: redirect.y, score: (redirect.loop?.score || 0) + 260, loop: redirect.loop || null };
  }

  return best;
}

function botShouldDropPallet(game, survivor, killer, hit) {
  if (!hit || hit.type !== "palletDrop") return false;
  const killerDistance = dist(survivor.x, survivor.y, killer.x, killer.y);
  if (killerDistance > BOT_SURVIVOR_PANIC_RADIUS * 1.32) return false;

  const palletCenter = centerOf(hit.object);
  const killerNearPallet = dist(killer.x, killer.y, palletCenter.x, palletCenter.y) < game.map.tile * 2.2;
  const killerHasLos = segmentClear(game, survivor.x, survivor.y, killer.x, killer.y);
  const survivorInjured = survivor.health <= 1 || survivor.injured;
  const palletBetweenThem = pointSegmentDistance(palletCenter.x, palletCenter.y, survivor.x, survivor.y, killer.x, killer.y) < game.map.tile * 1.15;
  const killerSameSide = hit.object.orientation === "horizontal"
    ? Math.sign(killer.y - palletCenter.y) === Math.sign(survivor.y - palletCenter.y)
    : Math.sign(killer.x - palletCenter.x) === Math.sign(survivor.x - palletCenter.x);

  return killerNearPallet
    || (palletBetweenThem && killerDistance < BOT_SURVIVOR_LOOP_RADIUS)
    || (killerSameSide && killerHasLos && killerDistance < BOT_SURVIVOR_PANIC_RADIUS * 1.08)
    || killerDistance < 205
    || (survivorInjured && killerHasLos && killerDistance < BOT_SURVIVOR_PANIC_RADIUS * 1.18);
}

function botNearbyInteractables(game, actor, includePalletDrop = true) {
  const options = [];
  for (const win of game.map.windows || []) {
    const c = centerOf(win);
    const d = dist(actor.x, actor.y, c.x, c.y);
    if (d <= INTERACT_DISTANCE) options.push({ type: "window", object: win, d });
  }
  for (const pallet of game.map.pallets || []) {
    if (pallet.broken) continue;
    const c = centerOf(pallet);
    const d = dist(actor.x, actor.y, c.x, c.y);
    if (d <= INTERACT_DISTANCE) {
      if (pallet.state === "upright" && includePalletDrop) options.push({ type: "palletDrop", object: pallet, d });
      if (pallet.state === "dropped") options.push({ type: actor.role === "killer" ? "palletBreak" : "palletVault", object: pallet, d });
    }
  }
  options.sort((a, b) => a.d - b.d);
  return options;
}

function botVaultGainsSafety(game, survivor, killer, hit, preferred = false) {
  if (!hit || (hit.type !== "window" && hit.type !== "palletVault")) return false;
  if (!canStartVault(game, survivor, hit.object, hit.type === "palletVault" ? "pallet" : "window")) return false;

  const landing = predictedVaultDestination(game, survivor, hit.object) || botLoopLandingPoint(game, survivor, killer, hit.object);
  if (!landing || wouldCollide(game, survivor, landing.x, landing.y)) return false;

  const currentKillerDistance = dist(survivor.x, survivor.y, killer.x, killer.y);
  const landingKillerDistance = dist(landing.x, landing.y, killer.x, killer.y);
  const breaksLosNow = !segmentClear(game, killer.x, killer.y, survivor.x, survivor.y);
  const breaksLosAfter = !segmentClear(game, killer.x, killer.y, landing.x, landing.y);
  const gainsSafety = landingKillerDistance > currentKillerDistance + game.map.tile * 0.14;
  const dangerClose = currentKillerDistance < BOT_SURVIVOR_PANIC_RADIUS * 1.25;
  const oppositeSide = hit.object.orientation === "horizontal"
    ? Math.sign(landing.y - centerOf(hit.object).y) !== Math.sign(killer.y - centerOf(hit.object).y)
    : Math.sign(landing.x - centerOf(hit.object).x) !== Math.sign(killer.x - centerOf(hit.object).x);

  return preferred || breaksLosAfter || gainsSafety || (oppositeSide && dangerClose) || (dangerClose && !breaksLosNow);
}

function botUseLoopObject(game, survivor, killer) {
  if (!killer || survivor.bot.actionCooldown > 0) return false;
  const hits = botNearbyInteractables(game, survivor, true);
  if (!hits.length) return false;
  const killerDistance = dist(survivor.x, survivor.y, killer.x, killer.y);
  const preferredActive = game.time < (survivor.bot.preferredLoopUntil || 0);

  const sortedHits = hits.slice().sort((a, b) => {
    const aPreferred = preferredActive && survivor.bot.preferredLoopId === botLoopObjectId(a, a.type);
    const bPreferred = preferredActive && survivor.bot.preferredLoopId === botLoopObjectId(b, b.type);
    if (aPreferred !== bPreferred) return aPreferred ? -1 : 1;
    if (a.type === "window" && b.type !== "window") return -1;
    if (b.type === "window" && a.type !== "window") return 1;
    return a.d - b.d;
  });

  for (const hit of sortedHits) {
    const objectId = botLoopObjectId(hit, hit.type);
    const preferred = preferredActive && survivor.bot.preferredLoopId === objectId;

    if (hit.type === "window" || hit.type === "palletVault") {
      if (killerDistance >= BOT_SURVIVOR_LOOP_RADIUS && !preferred) continue;
      if (!botVaultGainsSafety(game, survivor, killer, hit, preferred)) continue;

      survivor.input.action = true;
      survivor.bot.actionCooldown = 0.24;
      survivor.bot.preferredLoopId = objectId;
      survivor.bot.preferredLoopUntil = Math.max(survivor.bot.preferredLoopUntil || 0, (game.time || 0) + 0.55);
      return true;
    }

    if (botShouldDropPallet(game, survivor, killer, hit)) {
      const md = movementDirection(survivor.input);
      if (Math.abs(md.dx) > Math.abs(md.dy)) survivor.input.actionDir = md.dx < 0 ? "left" : "right";
      else if (md.dy !== 0) survivor.input.actionDir = md.dy < 0 ? "up" : "down";
      survivor.input.action = true;
      survivor.bot.actionCooldown = 0.35;
      survivor.bot.preferredLoopId = objectId;
      survivor.bot.preferredLoopUntil = (game.time || 0) + 0.85;
      return true;
    }
  }

  return false;
}

function chooseBotDotTarget(game, actor) {
  const bot = actor.bot || (actor.bot = {});
  const existing = bot.objectiveDotId ? (game.collectibleDots || []).find((d) => d.id === bot.objectiveDotId) : null;
  if (existing && game.time < (bot.objectiveDotUntil || 0)) return existing;

  const killer = [...game.actors.values()].find((p) => p.role === "killer" && !p.dead);
  const nearestGenInfo = (dot) => nearestUndoneGenerator(game, dot.x, dot.y);
  let best = null;
  let bestScore = Infinity;

  const candidates = (game.collectibleDots || [])
    .filter(Boolean)
    .map((dot) => {
      const directDistance = dist(actor.x, actor.y, dot.x, dot.y);
      const killerDanger = killer ? Math.max(0, BOT_SURVIVOR_SAFE_KILLER_DISTANCE - dist(killer.x, killer.y, dot.x, dot.y)) : 0;
      const genInfo = nearestGenInfo(dot);
      const genBonus = genInfo ? -Math.max(0, 300 - genInfo.d) * 0.34 - ((genInfo.gen?.progress || 0) * 130) : 0;
      return { dot, directDistance, prescore: directDistance + killerDanger * 1.15 + genBonus };
    })
    .sort((a, b) => a.prescore - b.prescore)
    .slice(0, BOT_MAX_DOT_CANDIDATES);

  for (const item of candidates) {
    const dot = item.dot;
    const route = botCheapRouteDistance(game, actor, dot.x, dot.y, { role: "survivor", exact: false });
    const routeDistance = Number.isFinite(route) ? route : item.directDistance + game.map.tile * 3;
    const directBonus = segmentClear(game, actor.x, actor.y, dot.x, dot.y) ? -90 : 0;
    const killerPenalty = killer ? Math.max(0, BOT_SURVIVOR_SAFE_KILLER_DISTANCE - dist(killer.x, killer.y, dot.x, dot.y)) * 1.35 : 0;
    const genInfo = nearestGenInfo(dot);
    const genBonus = genInfo ? -Math.max(0, 300 - genInfo.d) * 0.34 - ((genInfo.gen?.progress || 0) * 130) : 0;
    const carryPenalty = Math.max(0, (actor.dots || 0) - SURVIVOR_DOT_MAX * 0.65) * 24;
    const score = routeDistance + killerPenalty + carryPenalty + directBonus + genBonus;
    if (score < bestScore) {
      bestScore = score;
      best = dot;
    }
  }

  bot.objectiveDotId = best?.id || null;
  bot.objectiveDotUntil = (game.time || 0) + Math.max(BOT_SURVIVOR_OBJECTIVE_COMMIT_SECONDS, 3.6) + Math.random() * 0.65;
  return best;
}

function botMoveToDot(game, actor) {
  const dot = chooseBotDotTarget(game, actor);
  if (!dot) return false;
  botSurvivorCommitTask(game, actor, "dot", dot, Math.max(BOT_SURVIVOR_OBJECTIVE_COMMIT_SECONDS, 3.4));
  followPath(game, actor, dot.x, dot.y, true);
  return true;
}

function botStandAndDepositAtGen(game, actor, gen) {
  actor.input.up = actor.input.down = actor.input.left = actor.input.right = false;
  actor.input.sprint = false;
  actor.input.repair = false;
  actor.input.angle = Math.atan2(gen.y - actor.y, gen.x - actor.x);
  actor.bot.path = [];
  actor.bot.goalX = gen.x;
  actor.bot.goalY = gen.y;
}

function botRiftCompletionValue(game, actor, gen, routeDistance, killer) {
  const progress = clamp(Number(gen.progress || 0), 0, 1);
  const missing = Math.max(0, 1 - progress);
  const carried = Math.max(0, actor.dots || 0);
  const depositsToFinish = Math.ceil(missing / Math.max(0.0001, DOT_REPAIR_PROGRESS));
  const canMeaningfullyPush = carried > 0;
  const canFinish = canMeaningfullyPush && carried >= depositsToFinish;
  const almostDone = progress >= 0.72;
  const halfDone = progress >= 0.45;
  const nearby = routeDistance <= game.map.tile * 8.5;

  let value = Math.pow(progress, 1.32) * 1180;
  if (halfDone) value += 170;
  if (almostDone) value += 360;
  if (canFinish) value += 520;
  if (nearby && progress > 0.05) value += progress * 320;
  if (game.requiredGenerators && completedRiftCount(game) >= game.requiredGenerators - 1 && progress > 0.55) value += 240;
  if (gen.dotDepositing || gen.repairing) value += 90;

  if (killer && !killer.dead) {
    const killerDistance = dist(killer.x, killer.y, gen.x, gen.y);
    const killerHasLane = segmentClear(game, killer.x, killer.y, gen.x, gen.y);
    if (killerDistance < BOT_SURVIVOR_PANIC_RADIUS) value -= 420;
    else if (killerDistance < BOT_SURVIVOR_SAFE_KILLER_DISTANCE && killerHasLane) value -= 210;
  }

  return value;
}

function chooseBotGeneratorTarget(game, actor) {
  const bot = actor.bot || (actor.bot = {});
  const existing = bot.objectiveGenId ? game.map.generators.find((g) => g.id === bot.objectiveGenId && !g.done) : null;
  if (existing && game.time < (bot.objectiveGenUntil || 0)) return existing;

  const killer = [...game.actors.values()].find((p) => p.role === "killer" && !p.dead);
  let best = null;
  let bestScore = Infinity;
  for (const gen of game.map.generators) {
    if (gen.done) continue;

    const directDistance = dist(actor.x, actor.y, gen.x, gen.y);
    const route = botCheapRouteDistance(game, actor, gen.x, gen.y, { role: "survivor", exact: false });
    const routeDistance = Number.isFinite(route) ? route : directDistance + game.map.tile * 2;
    const killerPenalty = killer ? Math.max(0, BOT_SURVIVOR_SAFE_KILLER_DISTANCE - dist(killer.x, killer.y, gen.x, gen.y)) * 0.85 : 0;
    const progressValue = botRiftCompletionValue(game, actor, gen, routeDistance, killer);
    const helperCount = gen.repairerCount || (gen.repairing ? 1 : 0) || (Array.isArray(gen.activeRepairers) ? gen.activeRepairers.length : 0);
    // Small crowd penalty only. The old giant penalty made bots abandon nearly finished rifts
    // just because one teammate had the audacity to also understand the objective.
    const repairerPenalty = helperCount * 105;
    const carryingBonus = Math.min(actor.dots || 0, DOTS_PER_GENERATOR) * 14;
    const nearbyHighProgressBonus = (directDistance < game.map.tile * 7 && (gen.progress || 0) > 0.25)
      ? (gen.progress || 0) * 260
      : 0;
    const score = routeDistance + killerPenalty + repairerPenalty - progressValue - carryingBonus - nearbyHighProgressBonus;
    if (score < bestScore) {
      bestScore = score;
      best = gen;
    }
  }

  bot.objectiveGenId = best?.id || null;
  bot.objectiveGenUntil = (game.time || 0) + Math.max(BOT_SURVIVOR_OBJECTIVE_COMMIT_SECONDS, 4.2) + Math.random() * 0.65;
  return best;
}


function botSurvivorTaskStillValid(game, actor, kind, target, killer = null) {
  if (!game || !actor || !target) return false;
  const task = actor.bot?.survivorTask;
  if (!task || task.kind !== kind) return false;
  const targetId = target.id || `${kind}:${Math.round(target.x || 0)}:${Math.round(target.y || 0)}`;
  if (task.id !== targetId) return false;
  if ((task.until || 0) < (game.time || 0)) return false;
  if (kind === "gen" && target.done) return false;
  if (kind === "dot" && !(game.collectibleDots || []).some((dot) => dot.id === target.id)) return false;
  if (kind === "hook" && (!target.hooked || target.dead || target.escaped)) return false;
  if (kind === "heal" && (target.dead || target.escaped || target.hooked || (!target.downed && !(target.health === 1 && target.injured)))) return false;
  if (killer && !killer.dead) {
    const danger = dist(killer.x, killer.y, target.x, target.y);
    const killerHasLane = segmentClear(game, killer.x, killer.y, target.x, target.y);
    if (danger < BOT_SURVIVOR_PANIC_RADIUS * 0.85) return false;
    if (danger < BOT_SURVIVOR_SAFE_KILLER_DISTANCE * 0.82 && killerHasLane) return false;
  }
  return true;
}


function resolveBotSurvivorTaskTarget(game, actor, killer = null) {
  const task = actor.bot?.survivorTask;
  if (!task || (task.until || 0) < (game.time || 0)) return null;

  if (task.kind === "gen") {
    const gen = game.map.generators.find((g) => g.id === task.id && !g.done);
    return botSurvivorTaskStillValid(game, actor, "gen", gen, killer) ? gen : null;
  }

  if (task.kind === "dot") {
    const dot = (game.collectibleDots || []).find((d) => d.id === task.id);
    return botSurvivorTaskStillValid(game, actor, "dot", dot, killer) ? dot : null;
  }

  if (task.kind === "hook") {
    const ally = game.actors.get(task.id);
    return botSurvivorTaskStillValid(game, actor, "hook", ally, killer) ? ally : null;
  }

  if (task.kind === "heal") {
    const ally = game.actors.get(task.id);
    return botSurvivorTaskStillValid(game, actor, "heal", ally, killer) ? ally : null;
  }

  return null;
}

function botSurvivorCommitTask(game, actor, kind, target, duration = BOT_SURVIVOR_OBJECTIVE_COMMIT_SECONDS) {
  if (!target) {
    if (actor.bot) actor.bot.survivorTask = null;
    return null;
  }
  const bot = actor.bot || (actor.bot = {});
  bot.survivorTask = {
    kind,
    id: target.id || `${kind}:${Math.round(target.x || 0)}:${Math.round(target.y || 0)}`,
    x: target.x,
    y: target.y,
    until: (game.time || 0) + duration
  };
  return target;
}

function chooseBotFallbackObjectivePoint(game, actor, killer = null) {
  if (!game || !actor) return null;
  const points = [];
  for (const gen of game.map.generators || []) {
    if (gen.done) continue;
    points.push({ x: gen.x, y: gen.y, kind: "rift", value: 220 + (gen.progress || 0) * 820 });
  }
  for (const dot of game.collectibleDots || []) {
    points.push({ x: dot.x, y: dot.y, kind: "orb", value: (actor.dots || 0) >= SURVIVOR_DOT_MAX ? 0 : 110 });
  }
  for (const gate of game.map.gates || []) {
    points.push({ x: gate.x, y: gate.y, kind: "gate", value: game.escapeOpen ? 1000 : 30 });
  }
  if (!points.length) points.push({ x: game.map.width / 2, y: game.map.height / 2, kind: "center", value: 40 });

  let best = null;
  let bestScore = Infinity;
  for (const point of points) {
    const route = botCheapRouteDistance(game, actor, point.x, point.y, { role: "survivor", exact: false });
    const routeDistance = Number.isFinite(route) ? route : dist(actor.x, actor.y, point.x, point.y) + game.map.tile * 6;
    const dangerPenalty = killer && !killer.dead
      ? Math.max(0, BOT_SURVIVOR_SAFE_KILLER_DISTANCE - dist(killer.x, killer.y, point.x, point.y)) * 0.85
      : 0;
    const score = routeDistance + dangerPenalty - point.value + Math.random() * 8;
    if (score < bestScore) {
      bestScore = score;
      best = point;
    }
  }
  return best;
}

function botFleeTargetStillUseful(game, survivor, killer) {
  const bot = survivor.bot || {};
  if (!Number.isFinite(bot.fleeX) || !Number.isFinite(bot.fleeY)) return false;
  const now = game.time || 0;
  if ((bot.fleeLockUntil || 0) < now) return false;
  const target = { x: bot.fleeX, y: bot.fleeY };
  if (dist(survivor.x, survivor.y, target.x, target.y) < BOT_SURVIVOR_TASK_REACHED_DISTANCE) return false;
  if (wouldCollide(game, survivor, target.x, target.y)) return false;
  const targetDeadzone = botRunnerPointIsDeadzone(game, target.x, target.y);
  const survivorDeadzone = botRunnerPointIsDeadzone(game, survivor.x, survivor.y);
  if (targetDeadzone && !survivorDeadzone && !(bot.preferredLoopId && (bot.preferredLoopUntil || 0) > now)) return false;
  const currentKillerDistance = dist(survivor.x, survivor.y, killer.x, killer.y);
  const targetKillerDistance = dist(target.x, target.y, killer.x, killer.y);
  const breaksLos = !segmentClear(game, killer.x, killer.y, target.x, target.y);
  if (currentKillerDistance < BOT_SURVIVOR_CONTACT_RADIUS && targetKillerDistance < currentKillerDistance + game.map.tile * 1.15) return false;
  if (targetKillerDistance < currentKillerDistance - game.map.tile * 0.18 && !breaksLos) return false;
  const targetHasRoute = Number.isFinite(botCheapRouteDistance(game, survivor, target.x, target.y, { role: "survivor", exact: false }));
  if (!targetHasRoute) return false;

  // Flee hysteresis: during the lock window, keep moving to the chosen escape unless
  // it has become obviously worse. Without this, the bot can alternate between two
  // almost-equal tiles every think tick while The Void stands still in LOS.
  const lockRemaining = (bot.fleeLockUntil || 0) - now;
  if (lockRemaining > 0.35) {
    const becameMuchWorse = targetKillerDistance < currentKillerDistance - game.map.tile * 1.2
      && currentKillerDistance < BOT_SURVIVOR_LOOP_RADIUS;
    return !becameMuchWorse;
  }

  return breaksLos || targetKillerDistance > currentKillerDistance + game.map.tile * 0.7;
}


function botRunnerTaskKey(kind, target) {
  if (!target) return null;
  return String(target.id || `${kind}:${Math.round(target.x || 0)}:${Math.round(target.y || 0)}`);
}

function botRunnerTaskReservedByOther(game, actor, kind, target) {
  const targetId = botRunnerTaskKey(kind, target);
  if (!targetId) return false;
  for (const other of game.actors.values()) {
    if (!other || other.id === actor.id || !other.isBot || other.role !== "survivor") continue;
    if (other.dead || other.escaped || other.hooked || other.downed) continue;
    const task = other.bot?.runnerTask || other.bot?.survivorTask;
    if (task?.kind === kind && String(task.id) === targetId && (task.until || 0) > (game.time || 0)) return true;
    if (kind === "hook" && other.unhookTargetId === targetId) return true;
  }
  return false;
}

function botRunnerClearTask(actor, clearPath = false) {
  if (!actor?.bot) return;
  actor.bot.runnerTask = null;
  actor.bot.survivorTask = null;
  actor.bot.objectiveDotId = null;
  actor.bot.objectiveGenId = null;
  if (clearPath) {
    actor.bot.path = [];
    actor.bot.goalX = null;
    actor.bot.goalY = null;
    actor.bot.repath = 0;
  }
}

function botRunnerCommitTask(game, actor, kind, target, duration = 7.5) {
  if (!target) {
    botRunnerClearTask(actor);
    return null;
  }
  const bot = actor.bot || (actor.bot = {});
  const id = botRunnerTaskKey(kind, target);
  const now = game.time || 0;
  const sameTask = bot.runnerTask?.kind === kind && bot.runnerTask?.id === id;
  bot.runnerTask = {
    kind,
    id,
    x: target.x,
    y: target.y,
    until: now + duration,
    startedAt: sameTask ? (bot.runnerTask.startedAt || now) : now
  };
  // Keep the older task field in sync because some legacy helpers still inspect it.
  bot.survivorTask = { ...bot.runnerTask };
  if (!sameTask) {
    // Hysteresis: once a Runner bot picks an objective, force it to honor that
    // choice briefly. This prevents the classic utility-AI oscillation where two
    // nearly equal goals make the bot step left, rethink, step right, rethink.
    bot.runnerDecisionLockUntil = now + BOT_SURVIVOR_MIN_DECISION_LOCK_SECONDS + Math.random() * 0.28;
    bot.path = [];
    bot.goalX = null;
    bot.goalY = null;
    bot.lastTaskProgressDistance = null;
    bot.lastTaskProgressAt = now;
  }
  return target;
}

function botRunnerDecisionLocked(game, actor) {
  const bot = actor?.bot;
  const task = bot?.runnerTask || bot?.survivorTask;
  return !!task && (bot.runnerDecisionLockUntil || 0) > (game.time || 0);
}

function botRunnerResolveTask(game, actor, killer = null) {
  const task = actor.bot?.runnerTask || actor.bot?.survivorTask;
  if (!task || (task.until || 0) < (game.time || 0)) return null;
  let target = null;
  if (task.kind === "dot") target = (game.collectibleDots || []).find((dot) => dot.id === task.id) || null;
  else if (task.kind === "gen") target = (game.map.generators || []).find((gen) => gen.id === task.id && !gen.done) || null;
  else if (task.kind === "hook" || task.kind === "heal") target = game.actors.get(task.id) || null;
  else if (task.kind === "gate") target = (game.map.gates || []).find((gate) => gate.id === task.id && gate.open) || null;
  else if (Number.isFinite(task.x) && Number.isFinite(task.y)) target = { id: task.id, x: task.x, y: task.y };
  if (!target) return null;

  if (botRunnerObjectiveTemporarilyAvoided(game, actor, task.kind, target)) return null;
  if (task.kind === "dot" && (actor.dots || 0) >= SURVIVOR_DOT_MAX) return null;
  if (task.kind === "gen" && ((actor.dots || 0) <= 0 || target.done)) return null;
  if (task.kind === "hook") {
    if (!target.hooked || target.dead || target.escaped) return null;
    if (botRunnerTaskReservedByOther(game, actor, "hook", target)) return null;
  }
  if (task.kind === "heal") {
    if (target.dead || target.escaped || target.hooked || (!target.downed && !(target.health === 1 && target.injured))) return null;
  }
  if ((task.kind === "hook" || task.kind === "heal" || task.kind === "gen") && killer && !killer.dead) {
    const danger = dist(killer.x, killer.y, target.x, target.y);
    if (danger < BOT_SURVIVOR_PANIC_RADIUS * 0.82 && segmentClear(game, killer.x, killer.y, target.x, target.y)) return null;
  }
  return { kind: task.kind, target };
}

function botRunnerStopAndFace(actor, target) {
  actor.input.up = actor.input.down = actor.input.left = actor.input.right = false;
  actor.input.sprint = false;
  actor.input.action = false;
  actor.input.repair = false;
  if (target) actor.input.angle = Math.atan2(target.y - actor.y, target.x - actor.x);
}

function botRunnerProgressWatchdog(game, actor, target) {
  const bot = actor.bot || (actor.bot = {});
  if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return true;
  const d = dist(actor.x, actor.y, target.x, target.y);
  const now = game.time || 0;
  const last = Number.isFinite(bot.lastTaskProgressDistance) ? bot.lastTaskProgressDistance : Infinity;
  if (d < last - 14 || Math.abs(d - last) < 3) {
    bot.lastTaskProgressDistance = Math.min(d, last);
    bot.lastTaskProgressAt = bot.lastTaskProgressAt || now;
  } else if (d > last + game.map.tile * 0.45) {
    bot.lastTaskProgressDistance = d;
    bot.lastTaskProgressAt = now;
  }

  if (now - (bot.lastTaskProgressAt || now) > BOT_SURVIVOR_OBJECTIVE_STALL_SECONDS) {
    bot.path = [];
    bot.goalX = null;
    bot.goalY = null;
    bot.repath = 0;
    bot.stuckTimer = Math.max(bot.stuckTimer || 0, BOT_SURVIVOR_STUCK_SECONDS);
    bot.runnerDirectionChangeUntil = now + 0.95;
    bot.lastTaskProgressAt = now;
    bot.lastTaskProgressDistance = d;
    const nudge = botRunnerChaseRedirectPoint(game, actor, botNearestKiller(game), target)
      || chooseBotUnstuckPoint(game, actor, target.x, target.y);
    if (nudge) {
      setMoveToward(actor, nudge.x, nudge.y, true);
      return false;
    }
  }
  return true;
}

function botRunnerObjectiveRiskScore(game, actor, kind, target) {
  if (!target) return 0;
  const carried = actor.dots || 0;
  if (kind === "gate") return 1200;
  if (kind === "hook") return 720;
  if (kind === "heal") return target.downed ? 360 : 220;
  if (kind === "gen") {
    const progress = clamp(Number(target.progress || 0), 0, 1);
    const missingDeposits = Math.ceil(Math.max(0, 1 - progress) / Math.max(0.0001, DOT_REPAIR_PROGRESS));
    return progress * 920
      + Math.min(carried, SURVIVOR_DOT_MAX) * 26
      + (carried >= missingDeposits ? 540 : 0)
      + (progress >= 0.72 ? 360 : 0)
      + (progress >= 0.9 ? 420 : 0);
  }
  if (kind === "dot") return 80 + Math.max(0, 16 - carried) * 8;
  return 120;
}

function botRunnerPressureTargetId(kind, target) {
  if (!target) return "none";
  return `${kind || "move"}:${target.id || Math.round(target.x || 0) + ":" + Math.round(target.y || 0)}`;
}

function botRunnerFindKillerAvoidPoint(game, actor, killer, target, kind = "move") {
  if (!game || !actor || !killer || !target) return null;

  const now = game.time || 0;
  const bot = actor.bot || (actor.bot = {});
  const pressureId = botRunnerPressureTargetId(kind, target);
  if (
    (bot.runnerAvoidUntil || 0) > now
    && bot.runnerAvoidTargetId === pressureId
    && Number.isFinite(bot.runnerAvoidX)
    && Number.isFinite(bot.runnerAvoidY)
    && dist(actor.x, actor.y, bot.runnerAvoidX, bot.runnerAvoidY) > game.map.tile * 0.48
    && dist(killer.x, killer.y, bot.runnerAvoidX, bot.runnerAvoidY) > BOT_SURVIVOR_LOOP_RADIUS * 0.98
    && !wouldCollide(game, actor, bot.runnerAvoidX, bot.runnerAvoidY)
  ) {
    return { x: bot.runnerAvoidX, y: bot.runnerAvoidY, reused: true };
  }

  const awayFromKiller = botRunnerVectorAwayFromKiller(actor, killer);
  const targetVector = { x: target.x - actor.x, y: target.y - actor.y };
  const targetLen = Math.max(1, Math.hypot(targetVector.x, targetVector.y));
  targetVector.x /= targetLen;
  targetVector.y /= targetLen;

  const baseAngle = Math.atan2(actor.y - killer.y, actor.x - killer.x);
  const tangentPreference = Math.sign((-awayFromKiller.y * targetVector.x + awayFromKiller.x * targetVector.y) || (Math.random() - 0.5)) || 1;
  const angleOffsets = [
    tangentPreference * 0.82,
    tangentPreference * 1.12,
    -tangentPreference * 0.82,
    -tangentPreference * 1.12,
    tangentPreference * 1.55,
    -tangentPreference * 1.55,
    0
  ];
  const radii = [
    BOT_SURVIVOR_PRESSURE_RADIUS + game.map.tile * 0.45,
    BOT_SURVIVOR_PRESSURE_RADIUS + game.map.tile * 1.45,
    BOT_SURVIVOR_PRESSURE_RADIUS + game.map.tile * 2.35
  ];

  let best = null;
  let bestScore = Infinity;
  for (const radius of radii) {
    for (const offset of angleOffsets) {
      const angle = baseAngle + offset;
      const rawX = clamp(killer.x + Math.cos(angle) * radius, 44, game.map.width - 44);
      const rawY = clamp(killer.y + Math.sin(angle) * radius, 44, game.map.height - 44);
      const endpoint = botRouteEndpoint(game, actor, rawX, rawY, { role: "survivor" });
      if (!endpoint || wouldCollide(game, actor, endpoint.x, endpoint.y)) continue;

      const killerDistance = dist(endpoint.x, endpoint.y, killer.x, killer.y);
      if (killerDistance < BOT_SURVIVOR_LOOP_RADIUS * 0.95) continue;

      const corridorDistance = pointSegmentDistance(killer.x, killer.y, actor.x, actor.y, endpoint.x, endpoint.y);
      if (corridorDistance < BOT_SURVIVOR_PANIC_RADIUS * 0.76) continue;

      const route = botCheapRouteDistance(game, actor, endpoint.x, endpoint.y, { role: "survivor", exact: false });
      if (!Number.isFinite(route)) continue;

      const progressToTarget = dist(endpoint.x, endpoint.y, target.x, target.y);
      const currentToTarget = dist(actor.x, actor.y, target.x, target.y);
      const improvesTarget = progressToTarget < currentToTarget + game.map.tile * 2.1;
      const targetPenalty = improvesTarget ? 0 : 260;
      const edgeDistance = Math.min(endpoint.x, endpoint.y, game.map.width - endpoint.x, game.map.height - endpoint.y);
      const edgePenalty = edgeDistance < game.map.tile * 1.7 ? 460 : edgeDistance < game.map.tile * 2.8 ? 220 : 0;
      const cornerPenalty = ((endpoint.x < game.map.tile * 2.1 || endpoint.x > game.map.width - game.map.tile * 2.1)
        && (endpoint.y < game.map.tile * 2.1 || endpoint.y > game.map.height - game.map.tile * 2.1)) ? 330 : 0;
      const losBreakBonus = !segmentClear(game, killer.x, killer.y, endpoint.x, endpoint.y) ? 260 : 0;
      const clearancePenalty = botTileClearancePenalty(game, actor, endpoint.tileX, endpoint.tileY) * 180;
      const score = route
        + progressToTarget * 0.34
        + targetPenalty
        + edgePenalty
        + cornerPenalty
        + clearancePenalty
        - losBreakBonus
        - Math.max(0, killerDistance - BOT_SURVIVOR_LOOP_RADIUS) * 0.18;

      if (score < bestScore) {
        bestScore = score;
        best = { x: endpoint.x, y: endpoint.y, score };
      }
    }
  }

  if (best) {
    bot.runnerAvoidX = best.x;
    bot.runnerAvoidY = best.y;
    bot.runnerAvoidUntil = now + BOT_SURVIVOR_AVOID_KILLER_SECONDS + Math.random() * 0.25;
    bot.runnerAvoidTargetId = pressureId;
    bot.path = [];
    bot.goalX = null;
    bot.goalY = null;
    bot.repath = 0;
  }

  return best;
}

function botRunnerKillerPressurePlan(game, actor, target, options = {}) {
  if (!game || !actor || !target) return null;
  const killer = options.killer || [...game.actors.values()].find((p) => p.role === "killer" && !p.dead) || null;
  if (!killer || killer.dead) return null;

  const now = game.time || 0;
  const bot = actor.bot || (actor.bot = {});
  const currentDistance = dist(actor.x, actor.y, killer.x, killer.y);
  if (currentDistance < BOT_SURVIVOR_PANIC_RADIUS * 0.96 || currentDistance > BOT_SURVIVOR_THREAT_RADIUS * 1.08) return null;

  const kind = options.objectiveKind || actor.bot?.runnerTask?.kind || actor.bot?.survivorTask?.kind || "move";
  const targetDistance = dist(target.x, target.y, killer.x, killer.y);
  const corridorDistance = pointSegmentDistance(killer.x, killer.y, actor.x, actor.y, target.x, target.y);
  const actorSeen = segmentClear(game, actor.x, actor.y, killer.x, killer.y);
  const targetSeen = segmentClear(game, target.x, target.y, killer.x, killer.y);
  const movingIntoPressure = targetDistance < currentDistance - game.map.tile * 0.22;
  const crossesDangerCorridor = corridorDistance < BOT_SURVIVOR_DANGER_CORRIDOR_RADIUS;
  const targetInsideLoop = targetDistance < BOT_SURVIVOR_LOOP_RADIUS * 1.05;
  const edgePressure = currentDistance < BOT_SURVIVOR_PRESSURE_RADIUS && (actorSeen || targetSeen || crossesDangerCorridor);

  if (!edgePressure || (!movingIntoPressure && !crossesDangerCorridor && !targetInsideLoop)) return null;

  const pressureId = botRunnerPressureTargetId(kind, target);
  if ((bot.runnerRiskUntil || 0) > now && bot.runnerRiskTargetId === pressureId) {
    return { type: "risk" };
  }

  const riskScore = botRunnerObjectiveRiskScore(game, actor, kind, target);
  const canRisk = riskScore >= 720
    && currentDistance > BOT_SURVIVOR_PANIC_RADIUS * 1.08
    && (kind === "gen" || kind === "gate" || kind === "hook");

  if (canRisk) {
    bot.runnerRiskUntil = now + BOT_SURVIVOR_RISK_RUN_SECONDS + Math.random() * 0.2;
    bot.runnerRiskTargetId = pressureId;
    bot.runnerAvoidUntil = 0;
    return { type: "risk" };
  }

  const avoid = botRunnerFindKillerAvoidPoint(game, actor, killer, target, kind);
  if (avoid) return { type: "avoid", x: avoid.x, y: avoid.y };

  // If the bot cannot find a proper flank, commit to a short risk run instead of
  // bouncing on the chase edge. Progress beats indecision; panic range still overrides it.
  bot.runnerRiskUntil = now + Math.min(1.05, BOT_SURVIVOR_RISK_RUN_SECONDS);
  bot.runnerRiskTargetId = pressureId;
  return { type: "risk" };
}

function botRunnerMoveTo(game, actor, target, sprint = true, options = {}) {
  if (!target) return false;
  const stopDistance = options.stopDistance || BOT_SURVIVOR_TASK_REACHED_DISTANCE;
  const d = dist(actor.x, actor.y, target.x, target.y);
  if (d <= stopDistance && (!options.requireLine || segmentClear(game, actor.x, actor.y, target.x, target.y))) {
    if (options.stopAtTarget) botRunnerStopAndFace(actor, target);
    else setMoveToward(actor, target.x, target.y, sprint);
    return true;
  }

  const pressurePlan = botRunnerKillerPressurePlan(game, actor, target, options);
  if (pressurePlan?.type === "avoid") {
    const avoidTarget = { x: pressurePlan.x, y: pressurePlan.y };
    if (!botRunnerProgressWatchdog(game, actor, avoidTarget)) return true;
    followPath(game, actor, avoidTarget.x, avoidTarget.y, true, { allowSurvivorInteract: false });
    return true;
  }

  if (!botRunnerProgressWatchdog(game, actor, target)) return true;
  followPath(game, actor, target.x, target.y, sprint, { allowSurvivorInteract: false });
  return true;
}

function botRunnerChooseGate(game, actor) {
  if (!game.escapeOpen || !(game.map.gates || []).length) return null;
  let best = null;
  let bestScore = Infinity;
  for (const gate of game.map.gates) {
    if (!gate.open) continue;
    const route = botCheapRouteDistance(game, actor, gate.x, gate.y, { role: "survivor", exact: false });
    const routeDistance = Number.isFinite(route) ? route : dist(actor.x, actor.y, gate.x, gate.y) + game.map.tile * 5;
    if (routeDistance < bestScore) {
      bestScore = routeDistance;
      best = gate;
    }
  }
  return best;
}

function botRunnerChooseHookSave(game, actor, killer) {
  let best = null;
  let bestScore = Infinity;
  for (const ally of game.actors.values()) {
    if (ally.id === actor.id || ally.role !== "survivor" || !ally.hooked || ally.dead || ally.escaped) continue;
    if (botRunnerTaskReservedByOther(game, actor, "hook", ally)) continue;
    if (!botSafeToRescueOrHeal(game, actor, ally, killer, true)) continue;
    const route = botCheapRouteDistance(game, actor, ally.x, ally.y, { role: "survivor", exact: false });
    const routeDistance = Number.isFinite(route) ? route : dist(actor.x, actor.y, ally.x, ally.y) + game.map.tile * 6;
    const hookUrgency = (ally.unhookProgress || 0) * 380 + (ally.hookCount || 0) * 260;
    const score = routeDistance - hookUrgency;
    if (score < bestScore) {
      bestScore = score;
      best = ally;
    }
  }
  return best;
}

function botRunnerChooseHealTarget(game, actor, killer) {
  let best = null;
  let bestScore = Infinity;
  for (const ally of game.actors.values()) {
    if (ally.id === actor.id || ally.role !== "survivor" || ally.dead || ally.escaped || ally.hooked) continue;
    if (!(ally.downed && ally.health <= 0) && !(ally.health === 1 && ally.injured)) continue;
    const direct = dist(actor.x, actor.y, ally.x, ally.y);
    // Healing is a close-by opportunistic support action. Long-map rescue/heal trips are what made
    // bots abandon objectives and shuffle around like confused little Roombas.
    if (direct > Math.min(BOT_SURVIVOR_HEAL_RADIUS, 360)) continue;
    if (!botSafeToRescueOrHeal(game, actor, ally, killer, ally.downed)) continue;
    const route = botCheapRouteDistance(game, actor, ally.x, ally.y, { role: "survivor", exact: false });
    const routeDistance = Number.isFinite(route) ? route : direct + game.map.tile * 4;
    const score = routeDistance - (ally.downed ? 260 : 80);
    if (score < bestScore) {
      bestScore = score;
      best = ally;
    }
  }
  return best;
}

function botRunnerChooseRift(game, actor, killer) {
  if ((actor.dots || 0) <= 0) return null;
  let best = null;
  let bestScore = Infinity;
  const carried = Math.max(0, actor.dots || 0);
  for (const gen of game.map.generators || []) {
    if (gen.done) continue;
    const route = botCheapRouteDistance(game, actor, gen.x, gen.y, { role: "survivor", exact: false });
    const routeDistance = Number.isFinite(route) ? route : dist(actor.x, actor.y, gen.x, gen.y) + game.map.tile * 4;
    const progress = clamp(Number(gen.progress || 0), 0, 1);
    const missingDeposits = Math.ceil(Math.max(0, 1 - progress) / Math.max(0.0001, DOT_REPAIR_PROGRESS));
    const canFinish = carried >= missingDeposits;
    const killerDanger = killer && !killer.dead
      ? Math.max(0, BOT_SURVIVOR_SAFE_KILLER_DISTANCE - dist(killer.x, killer.y, gen.x, gen.y)) * (segmentClear(game, killer.x, killer.y, gen.x, gen.y) ? 1.1 : 0.45)
      : 0;
    const progressBonus = progress * 1250 + (progress >= 0.65 ? 420 : 0) + (progress >= 0.85 ? 420 : 0);
    const carryBonus = Math.min(carried, SURVIVOR_DOT_MAX) * 34;
    const finishBonus = canFinish ? 760 : 0;
    const activeTeamBonus = (gen.dotDepositing || gen.repairing ? 130 : 0);
    const score = routeDistance + killerDanger - progressBonus - carryBonus - finishBonus - activeTeamBonus;
    if (score < bestScore) {
      bestScore = score;
      best = gen;
    }
  }
  return best;
}

function botRunnerChooseOrb(game, actor, killer) {
  if ((actor.dots || 0) >= SURVIVOR_DOT_MAX) return null;
  const dots = (game.collectibleDots || []).filter(Boolean);
  if (!dots.length) return null;
  const carried = actor.dots || 0;
  const shortlist = dots
    .map((dot) => ({ dot, direct: dist(actor.x, actor.y, dot.x, dot.y) }))
    .sort((a, b) => a.direct - b.direct)
    .slice(0, Math.min(12, dots.length));

  let best = null;
  let bestScore = Infinity;
  for (const item of shortlist) {
    const dot = item.dot;
    if (botRunnerObjectiveTemporarilyAvoided(game, actor, "dot", dot)) continue;
    if (killer && !killer.dead) {
      const killerDotDistance = dist(killer.x, killer.y, dot.x, dot.y);
      const killerHasLaneToOrb = segmentClear(game, killer.x, killer.y, dot.x, dot.y);
      if (killerDotDistance < BOT_SURVIVOR_ORB_DANGER_RADIUS && killerHasLaneToOrb) continue;
      if (killerDotDistance < BOT_SURVIVOR_PANIC_RADIUS * 0.9) continue;
    }
    const route = botCheapRouteDistance(game, actor, dot.x, dot.y, { role: "survivor", exact: false });
    const routeDistance = Number.isFinite(route) ? route : item.direct + game.map.tile * 4;
    const nearbyRift = nearestUndoneGenerator(game, dot.x, dot.y);
    const riftBonus = nearbyRift ? Math.max(0, 420 - nearbyRift.d) * 0.45 + ((nearbyRift.gen?.progress || 0) * 180) : 0;
    const killerDanger = killer && !killer.dead
      ? Math.max(0, BOT_SURVIVOR_SAFE_KILLER_DISTANCE - dist(killer.x, killer.y, dot.x, dot.y)) * 0.9
      : 0;
    const carryPenalty = carried >= SURVIVOR_DOT_MAX * 0.72 ? carried * 42 : carried * 5;
    const score = routeDistance + killerDanger + carryPenalty - riftBonus;
    if (score < bestScore) {
      bestScore = score;
      best = dot;
    }
  }
  return best;
}

function botRunnerShouldDeposit(game, actor, rift) {
  if (!rift || (actor.dots || 0) <= 0) return false;
  const carried = actor.dots || 0;
  const progress = clamp(Number(rift.progress || 0), 0, 1);
  const missingDeposits = Math.ceil(Math.max(0, 1 - progress) / Math.max(0.0001, DOT_REPAIR_PROGRESS));
  return carried >= SURVIVOR_DOT_MAX
    || carried >= 18
    || (carried >= 10 && progress >= 0.25)
    || (carried >= 6 && progress >= 0.55)
    || carried >= missingDeposits
    || (game?.collectibleDots?.length || 0) <= 6;
}

function botRunnerExecuteTask(game, actor, kind, target, killer = null) {
  if (!target) return false;
  if (botRunnerObjectiveTemporarilyAvoided(game, actor, kind, target)) return false;
  if (kind === "gate") {
    botRunnerCommitTask(game, actor, "gate", target, 8.5);
    botRunnerMoveTo(game, actor, target, true, { stopDistance: INTERACT_DISTANCE * 0.8, stopAtTarget: true, killer, objectiveKind: "gate" });
    return true;
  }

  if (kind === "hook") {
    botRunnerCommitTask(game, actor, "hook", target, 5.2);
    if (dist(actor.x, actor.y, target.x, target.y) <= HOOK_RESCUE_DISTANCE && segmentClear(game, actor.x, actor.y, target.x, target.y)) {
      botRunnerStopAndFace(actor, target);
    } else {
      botRunnerMoveTo(game, actor, target, true, { stopDistance: HOOK_RESCUE_DISTANCE * 0.72, requireLine: true, killer, objectiveKind: "hook" });
    }
    return true;
  }

  if (kind === "heal") {
    botRunnerCommitTask(game, actor, "heal", target, 4.5);
    if (dist(actor.x, actor.y, target.x, target.y) <= HEAL_DISTANCE && segmentClear(game, actor.x, actor.y, target.x, target.y)) {
      botRunnerStopAndFace(actor, target);
      // If both are bots, ask the wounded bot to stop briefly too so the actual heal channel can finish.
      if (target.isBot && !target.hooked && !target.dead && !target.escaped) {
        target.bot = target.bot || {};
        target.bot.holdForHealUntil = Math.max(target.bot.holdForHealUntil || 0, (game.time || 0) + 0.6);
      }
    } else {
      botRunnerMoveTo(game, actor, target, true, { stopDistance: HEAL_DISTANCE * 0.72, requireLine: true, killer, objectiveKind: "heal" });
    }
    return true;
  }

  if (kind === "gen") {
    botRunnerCommitTask(game, actor, "gen", target, 8.2);
    if ((actor.dots || 0) <= 0 || target.done) return false;
    if (dist(actor.x, actor.y, target.x, target.y) <= DOT_DEPOSIT_DISTANCE && segmentClear(game, actor.x, actor.y, target.x, target.y)) {
      botStandAndDepositAtGen(game, actor, target);
    } else {
      botRunnerMoveTo(game, actor, target, true, { stopDistance: DOT_DEPOSIT_DISTANCE * 0.72, requireLine: true, killer, objectiveKind: "gen" });
    }
    return true;
  }

  if (kind === "dot") {
    botRunnerCommitTask(game, actor, "dot", target, 6.5);
    botRunnerMoveTo(game, actor, target, true, { stopDistance: Math.max(18, game.map.tile * 0.28), killer, objectiveKind: "dot" });
    return true;
  }

  return false;
}

function botMoveToObjective(game, actor) {
  const killer = [...game.actors.values()].find((p) => p.role === "killer" && !p.dead) || null;

  // If another bot is healing this bot, let the heal channel actually complete instead of walking away.
  if ((actor.bot?.holdForHealUntil || 0) > (game.time || 0) && (actor.health <= 1 || actor.downed)) {
    botRunnerStopAndFace(actor, killer || actor);
    return;
  }

  // 1) Gates open means leave. No heroic indecision, no farming orbs in the endgame.
  const gate = botRunnerChooseGate(game, actor);
  if (gate) {
    botRunnerExecuteTask(game, actor, "gate", gate, killer);
    return;
  }

  // 2) Save hooked teammates, but only one bot claims each hook save.
  // This overrides orb/rift work; objectives matter, but dangling teammates matter more.
  const hookSave = botRunnerChooseHookSave(game, actor, killer);
  if (hookSave) {
    botRunnerExecuteTask(game, actor, "hook", hookSave, killer);
    return;
  }

  // 3) Honor the current orb/rift/gate decision during its short lock window.
  // This is the important anti-jitter layer: a far-away stationary Void should not make
  // Runner bots repeatedly re-score equivalent objectives and step back and forth.
  const committed = botRunnerResolveTask(game, actor, killer);
  if (committed && botRunnerDecisionLocked(game, actor) && (committed.kind === "dot" || committed.kind === "gen" || committed.kind === "gate")) {
    if (botRunnerExecuteTask(game, actor, committed.kind, committed.target, killer)) return;
  }

  // 4) Heal only when it is close-by and safe. This prevents objective abandonment across the whole map.
  const healTarget = botRunnerChooseHealTarget(game, actor, killer);
  if (healTarget) {
    botRunnerExecuteTask(game, actor, "heal", healTarget, killer);
    return;
  }

  // 5) Finish current committed orb/rift objective unless it has become invalid or dangerous.
  if (committed && (committed.kind === "dot" || committed.kind === "gen" || committed.kind === "gate")) {
    if (botRunnerExecuteTask(game, actor, committed.kind, committed.target, killer)) return;
  } else if (actor.bot?.runnerTask || actor.bot?.survivorTask) {
    botRunnerClearTask(actor, true);
  }

  // 5) If already in deposit range with orbs, stay there and feed until empty or the rift completes.
  if ((actor.dots || 0) > 0) {
    const nearbyDepositGen = nearestDotDepositGenerator(game, actor);
    if (nearbyDepositGen && !nearbyDepositGen.done) {
      botRunnerExecuteTask(game, actor, "gen", nearbyDepositGen, killer);
      return;
    }
  }

  // 6) Carrying lots of orbs, or carrying enough to meaningfully push a rift, means deposit.
  const bestRift = botRunnerChooseRift(game, actor, killer);
  if (bestRift && botRunnerShouldDeposit(game, actor, bestRift)) {
    botRunnerExecuteTask(game, actor, "gen", bestRift, killer);
    return;
  }

  // 7) Otherwise collect orbs until the bot has a useful bundle to deposit.
  const orb = botRunnerChooseOrb(game, actor, killer);
  if (orb) {
    botRunnerExecuteTask(game, actor, "dot", orb, killer);
    return;
  }

  // 8) No orbs available? Move toward the most valuable unfinished rift so the bot is never idle.
  if (bestRift) {
    botRunnerMoveTo(game, actor, bestRift, true, { stopDistance: game.map.tile * 0.8, killer, objectiveKind: "gen" });
    return;
  }

  const fallback = chooseBotFallbackObjectivePoint(game, actor, killer);
  if (fallback) botRunnerMoveTo(game, actor, fallback, true, { stopDistance: game.map.tile * 0.45, killer, objectiveKind: fallback.kind || "move" });
}

function updateBotInputs(game, dt) {
  const killer = [...game.actors.values()].find((p) => p.role === "killer" && !p.dead);

  for (const actor of game.actors.values()) {
    if (!actor.isBot || actor.dead || actor.escaped || actor.hooked || actor.downed) continue;
    resetInput(actor.input);
    actor.bot.actionCooldown = Math.max(0, actor.bot.actionCooldown - dt);

    if (actor.role === "killer") {
      const hookReady = nearestDownedSurvivorForHook(game, actor);
      if (hookReady) {
        actor.input.repair = true;
        actor.input.angle = Math.atan2(hookReady.y - actor.y, hookReady.x - actor.x);
        continue;
      }

      const downedPursuit = chooseDownedSurvivorForHookPursuit(game, actor);
      if (downedPursuit) {
        actor.input.angle = Math.atan2(downedPursuit.y - actor.y, downedPursuit.x - actor.x);
        followPath(game, actor, downedPursuit.x, downedPursuit.y, false, { allowKillerInteract: true, allowKillerWindows: true });
        if (dist(actor.x, actor.y, downedPursuit.x, downedPursuit.y) <= HOOK_INTERACT_DISTANCE && segmentClear(game, actor.x, actor.y, downedPursuit.x, downedPursuit.y)) {
          actor.input.repair = true;
        }
        continue;
      }

      const target = chooseKillerTarget(game, actor);
      if (!target) continue;

      if (target.actor) botFaceTarget(actor, target.actor);
      else actor.input.angle = Math.atan2(target.y - actor.y, target.x - actor.x);

      const targetDistance = dist(actor.x, actor.y, target.x, target.y);
      const hasClearAttack = target.actor && attackSegmentClear(game, actor.x, actor.y, target.actor.x, target.actor.y);
      botKillerMaybeUseAbility(game, actor, target, targetDistance, hasClearAttack);

      if (target.actor && target.actor.downed && !target.actor.hooked) {
        followPath(game, actor, target.actor.x, target.actor.y, false, { allowKillerInteract: true, allowKillerWindows: true });
        if (dist(actor.x, actor.y, target.actor.x, target.actor.y) <= HOOK_INTERACT_DISTANCE) actor.input.repair = true;
        continue;
      }

      const attacking = target.actor && botSetAttackIntent(game, actor, target.actor, targetDistance, hasClearAttack);

      const hitBeforeMove = target.actor ? nearestInteractable(game, actor, false) : null;
      if (target.actor && !attacking && botUseKillerObstacle(game, actor, target.actor, hitBeforeMove, hasClearAttack, targetDistance)) {
        continue;
      }

      if (!attacking) {
        const chasePoint = target.actor
          ? chooseKillerChasePoint(game, actor, target.actor, targetDistance, hasClearAttack)
          : { x: target.x, y: target.y };
        followPath(game, actor, chasePoint.x, chasePoint.y, false, {
          allowKillerInteract: true,
          allowKillerWindows: !!target.actor,
          chase: !!target.actor
        });
      }

      const hitAfterMoveIntent = target.actor ? nearestInteractable(game, actor, false) : null;
      if (target.actor && !attacking) {
        botUseKillerObstacle(game, actor, target.actor, hitAfterMoveIntent, hasClearAttack, targetDistance);
      }
      continue;
    }

    if (actor.role === "survivor") {
      const now = game.time || 0;
      const killerDistance = killer && !killer.dead ? dist(actor.x, actor.y, killer.x, killer.y) : Infinity;
      const killerHasLos = killer && segmentClear(game, actor.x, actor.y, killer.x, killer.y);
      const inTerrorRadius = !!(killer && !killer.dead && killerDistance <= TERROR_RADIUS);

      if (inTerrorRadius) {
        botRunnerStartTerrorFlee(game, actor, killer, killerDistance);
      }

      const terrorFleeActive = !!(killer && !killer.dead && (actor.bot.runnerTerrorFleeUntil || 0) > now);
      const riskRunActive = !!(
        killer
        && !terrorFleeActive
        && (actor.bot.runnerRiskUntil || 0) > now
        && killerDistance > BOT_SURVIVOR_PANIC_RADIUS * 0.96
      );
      const contactThreat = killer && killerDistance < BOT_SURVIVOR_CONTACT_RADIUS;
      const panicThreat = killer && killerDistance < BOT_SURVIVOR_PANIC_RADIUS;
      const loopThreat = killer && !riskRunActive && killerHasLos && killerDistance < BOT_SURVIVOR_LOOP_RADIUS;
      const activeChaseThreat = killer && !riskRunActive && actor.chaseHold > 0 && killerDistance < BOT_SURVIVOR_FAR_OBSERVED_DISTANCE;
      const threatened = !!(killer && (terrorFleeActive || contactThreat || panicThreat || loopThreat || activeChaseThreat));
      const observedButSafe = !!(killer && !threatened && killerHasLos && killerDistance < BOT_SURVIVOR_THREAT_RADIUS);

      if (observedButSafe) {
        // Being watched from far away is not the same as being in chase. Previous logic
        // treated any far LOS as panic, which made bots drop objectives and oscillate
        // between flee points while a stationary Void stared at them. Keep their goal.
        actor.bot.observedByKillerUntil = now + 0.9;
        actor.bot.fleeTimer = Math.max(actor.bot.fleeTimer || 0, 0.35);
      }

      botSurvivorMaybeUseAbility(game, actor, killer, threatened || observedButSafe, killerDistance, killerHasLos);

      if (threatened) {
        if (terrorFleeActive) {
          botRunnerAbortObjectiveForTerror(game, actor);
        } else {
          actor.bot.runnerTask = null;
          actor.bot.survivorTask = null;
        }

        const fleeStalled = botRunnerFleeProgressStalled(game, actor, killer, killerDistance, dt);
        if (contactThreat || fleeStalled) {
          actor.bot.emergencyFleeUntil = Math.max(actor.bot.emergencyFleeUntil || 0, now + BOT_SURVIVOR_EMERGENCY_FLEE_SECONDS);
          actor.bot.preferredLoopUntil = 0;
          actor.bot.preferredLoopId = null;
          actor.bot.fleeTimer = 0;
          actor.bot.path = [];
          actor.bot.repath = 0;
        }

        actor.bot.fleeTimer = Math.max(0, (actor.bot.fleeTimer || 0) - dt);
        const emergencyFleeActive = contactThreat || (actor.bot.emergencyFleeUntil || 0) > now;
        const fleeDuration = terrorFleeActive
          ? Math.max(BOT_SURVIVOR_TERROR_FLEE_SECONDS, BOT_SURVIVOR_FLEE_COMMIT_SECONDS)
          : (emergencyFleeActive ? BOT_SURVIVOR_EMERGENCY_FLEE_SECONDS : BOT_SURVIVOR_FLEE_COMMIT_SECONDS);

        if (actor.bot.fleeTimer <= 0 || !botFleeTargetStillUseful(game, actor, killer)) {
          const cornerEscape = botRunnerPointIsDeadzone(game, actor.x, actor.y)
            ? botRunnerChaseRedirectPoint(game, actor, killer, { x: game.map.width / 2, y: game.map.height / 2 })
            : null;
          const flee = cornerEscape
            || ((emergencyFleeActive || terrorFleeActive)
              ? (botRunnerEmergencyFleePoint(game, actor, killer) || chooseFleePoint(game, actor, killer))
              : chooseFleePoint(game, actor, killer));
          botRunnerSetFleeTarget(game, actor, flee, fleeDuration);
        }

        const usingLoop = !emergencyFleeActive
          && actor.bot.preferredLoopId && (actor.bot.preferredLoopUntil || 0) > now
          && Number.isFinite(actor.bot.fleeLoopApproachX) && Number.isFinite(actor.bot.fleeLoopApproachY)
          && dist(actor.x, actor.y, actor.bot.fleeLoopApproachX, actor.bot.fleeLoopApproachY) > INTERACT_DISTANCE * 0.7;
        const moveX = usingLoop ? actor.bot.fleeLoopApproachX : actor.bot.fleeX;
        const moveY = usingLoop ? actor.bot.fleeLoopApproachY : actor.bot.fleeY;
        const chaseMoveTarget = Number.isFinite(moveX) && Number.isFinite(moveY)
          ? { x: moveX, y: moveY }
          : null;

        // If body-close to The Void, distance comes first. Windows/pallets are still useful,
        // but only if the movement setup does not make the Runner backtrack into danger.
        const loopActionAllowed = !contactThreat || killerDistance > BOT_SURVIVOR_CONTACT_RADIUS * 1.18;
        const usedLoopBeforeMove = loopActionAllowed && botUseLoopObject(game, actor, killer);
        if (!usedLoopBeforeMove) {
          if (chaseMoveTarget) {
            followPath(game, actor, chaseMoveTarget.x, chaseMoveTarget.y, true);
          } else {
            setMoveAway(actor, killer.x, killer.y, true);
          }
          if (!contactThreat || killerDistance > BOT_SURVIVOR_CONTACT_RADIUS * 1.18) {
            botUseLoopObject(game, actor, killer);
          }
          if (!botRunnerMovementStallRedirect(game, actor, killer, dt, chaseMoveTarget)) {
            botRunnerApplyChaseMovementGuard(game, actor, killer, chaseMoveTarget, {
              toleratedLoss: (emergencyFleeActive || terrorFleeActive) ? game.map.tile * 0.035 : game.map.tile * 0.08,
              allowTangent: !contactThreat
            });
          }
        }
        continue;
      } else if (actor.bot) {
        actor.bot.fleeProgressLastDistance = null;
        actor.bot.fleeNoProgressFor = 0;
        actor.bot.emergencyFleeUntil = 0;
        actor.bot.runnerStillSeconds = 0;
        actor.bot.runnerMoveWatchX = actor.x;
        actor.bot.runnerMoveWatchY = actor.y;
        actor.bot.runnerMoveWatchAt = now;
      }

      botMoveToObjective(game, actor);
    }
  }
}

function updateGame(lobby, dt) {
  const game = lobby.game;
  if (!game || game.phase !== "game") return;

  game.time = (game.time || 0) + dt;

  // Hard match-start lock. The client also shows a zoomed spawn intro, but this is
  // the real gate: no human or bot movement/actions until the intro window ends.
  if (game.time < (game.matchStartFreezeSeconds || MATCH_START_FREEZE_SECONDS)) {
    game.botThinkAccumulator = 0;
    for (const actor of game.actors.values()) {
      resetInput(actor.input);
      actor.vault = null;
      actor.breakTarget = null;
      actor.attackState = null;
      actor.attackType = null;
      actor.attackTimer = 0;
      actor.attackCharge = 0;
    }
    return;
  }

  game.botThinkAccumulator = (game.botThinkAccumulator || 0) + dt;
  if (game.botThinkAccumulator >= 1 / BOT_THINK_RATE) {
    const botDt = game.botThinkAccumulator;
    game.botThinkAccumulator = 0;
    const botCount = [...game.actors.values()].filter((actor) => actor.isBot && !actor.dead && !actor.escaped).length;
    game.botExactRouteBudget = BOT_EXACT_ROUTE_BUDGET_BASE + botCount * BOT_EXACT_ROUTE_BUDGET_PER_BOT;
    game.botCheapRouteFallbacks = 0;
    updateBotInputs(game, botDt);
  }
  updateTimers(game, dt);
  updateHookInteractions(game, dt);
  updateGeneratorKicks(game, dt);
  const killer = [...game.actors.values()].find((p) => p.role === "killer");
  for (const actor of game.actors.values()) moveActor(game, actor, dt);
  updateCollectibleDots(game, dt);
  updateKillerAttack(game, killer, dt);
  for (const actor of game.actors.values()) {
    if (actor.input.action) handleAction(game, actor);
  }
  updateHealing(game, dt);
  updateDotDeposits(game, dt);
  updateGeneratorsAndGates(game, dt);
  updateChaseState(game, dt);
  updateChaseStats(game, dt);
  checkWinConditions(lobby);

  for (const actor of game.actors.values()) {
    actor.input.action = false;
    actor.input.attack = false;
    actor.input.attackReleased = false;
  }
}

function isLivingSurvivor(actor) {
  return !!actor && actor.role === "survivor" && !actor.dead && !actor.escaped;
}

function getSpectateTarget(game, viewer) {
  if (!viewer || viewer.role !== "survivor" || (!viewer.dead && !viewer.escaped)) return null;
  const preferred = viewer.spectateTargetId ? game.actors.get(viewer.spectateTargetId) : null;
  if (isLivingSurvivor(preferred)) return preferred;
  let nearest = null;
  let nearestDist = Infinity;
  for (const actor of game.actors.values()) {
    if (!isLivingSurvivor(actor) || actor.id === viewer.id) continue;
    const d = dist(viewer.x, viewer.y, actor.x, actor.y);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = actor;
    }
  }
  return nearest;
}

/** Dead/escaped survivors spectate through a living teammate's fog and LOS rules. */
function getViewerForVisibility(game, viewer) {
  if (!viewer) return viewer;
  if (viewer.role === "survivor" && (viewer.dead || viewer.escaped)) {
    return getSpectateTarget(game, viewer) || viewer;
  }
  return viewer;
}

function isActorVisibleToViewer(game, viewer, actor) {
  if (!viewer || !actor) return false;
  if (viewer.id === actor.id) return true;
  if (actor.dead || actor.escaped) return false;

  const d = dist(viewer.x, viewer.y, actor.x, actor.y);
  const los = segmentClear(game, viewer.x, viewer.y, actor.x, actor.y);

  if (viewer.role === "survivor" && actor.role === "killer") {
    if (d <= CLOSE_REVEAL_RADIUS && los) return true;
    return los && coneSees(viewer, actor, survivorVisionLengthFor(viewer), survivorVisionAngleFor(viewer));
  }

  if (viewer.role === "killer" && actor.role === "survivor") {
    if ((game.runnerReveal || 0) > 0) return true;
    // Killers only see survivors (including hooked) through line of sight: inside their cone,
    // or extremely close, including right behind them. No global sprint/repair wallhack nonsense.
    if (!los) return false;
    if (d <= CLOSE_REVEAL_RADIUS) return true;
    return coneSees(viewer, actor, KILLER_CONE_LENGTH, KILLER_CONE_ANGLE);
  }

  if (viewer.role === "survivor" && actor.role === "survivor") {
    // Hooked teammates are global survivor information. They should be visible on
    // the map even outside cone/LOS so rescue pathing is readable and not a fog lottery.
    if (actor.hooked || actor.downed) return true;
    if (!los) return false;
    if (d <= CLOSE_REVEAL_RADIUS) return true;
    return coneSees(viewer, actor, survivorVisionLengthFor(viewer), survivorVisionAngleFor(viewer));
  }

  return true;
}

function hooksForSnapshot(game, viewer) {
  return (game.map?.hooks || [])
    .filter((h) => h.active)
    .map((h) => {
      const entry = { id: h.id, x: h.x, y: h.y, active: h.active, survivorId: null };
      if (!h.survivorId) return entry;
      if (viewer?.role !== "killer") return { ...entry, survivorId: h.survivorId };
      const survivor = game.actors.get(h.survivorId);
      if (survivor && isActorVisibleToViewer(game, viewer, survivor)) {
        return { ...entry, survivorId: h.survivorId };
      }
      return entry;
    });
}

function serializeActor(game, actor, visible = true) {
  // Always send position, angle, and skin, even when the viewer cannot see this actor.
  // The client hides the sprite locally but keeps interpolating it, so reappearing actors
  // do not teleport from an old stale position. The fog may lie, the server does not.
  const actorSkin = actor.role === "survivor" ? sanitizeSkin(actor.skin) : "killerCircle";
  return {
    id: actor.id,
    name: actor.name,
    role: actor.role,
    skin: actorSkin,
    visible: !!visible,
    x: Number(actor.x.toFixed(2)),
    y: Number(actor.y.toFixed(2)),
    angle: actor.angle,
    health: actor.health,
    dots: actor.role === "killer" ? clamp(actor.dots || 0, 0, KILLER_DOT_MAX) : actor.role === "survivor" ? clamp(actor.dots || 0, 0, SURVIVOR_DOT_MAX) : 0,
    stats: serializeMatchStats(actor),
    dotDepositTargetId: actor.role === "survivor" ? actor.dotDepositTargetId || null : null,
    dotDepositProgress: actor.role === "survivor" ? quantizedProgress(actor.dotDepositProgress || 0) : 0,
    injured: actor.injured,
    dead: actor.dead,
    escaped: actor.escaped,
    escapeProgress: actor.role === "survivor" ? quantizedProgress((actor.escapeProgress || 0) / GATE_ESCAPE_TIME) : 0,
    escapeGateId: actor.role === "survivor" ? actor.escapeGateId || null : null,
    downed: actor.downed,
    hooked: actor.hooked,
    hookId: actor.hookId,
    hookCount: actor.hookCount || 0,
    hookProgress: actor.hookProgress || 0,
    unhookProgress: actor.unhookProgress || 0,
    hookActionTargetId: actor.hookActionTargetId || null,
    hookActionType: actor.hookActionType || null,
    hookReadyTargetId: actor.role === "killer" ? (nearestDownedSurvivorForHook(game, actor)?.id || null) : null,
    generatorKickTargetId: actor.generatorKickTargetId || null,
    generatorKickProgress: actor.generatorKickProgress || 0,
    unhookTargetId: actor.unhookTargetId || null,
    recovery: actor.recovery,
    voidStun: actor.role === "killer" ? actor.voidStun || 0 : 0,
    voidSpeedBoost: actor.role === "killer" ? actor.voidSpeedBoost || 0 : 0,
    voidAbilityCooldowns: actor.role === "killer" ? Object.fromEntries(
      Object.entries(actor.voidAbilityCooldowns || {}).map(([id, remaining]) => [id, Number(Math.max(0, remaining || 0).toFixed(2))])
    ) : {},
    stealthStep: actor.role === "survivor" ? actor.stealthStep || 0 : 0,
    riftLens: actor.role === "survivor" ? actor.riftLens || 0 : 0,
    survivorAbilityCooldowns: actor.role === "survivor" ? Object.fromEntries(
      Object.entries(actor.survivorAbilityCooldowns || {}).map(([id, remaining]) => [id, Number(Math.max(0, remaining || 0).toFixed(2))])
    ) : {},
    orbSlow: actor.role === "survivor" ? actor.orbSlow || 0 : 0,
    voidSlow: actor.role === "survivor" ? actor.voidSlow || 0 : 0,
    attackState: actor.attackState,
    attackType: actor.attackType,
    attackCharge: actor.attackCharge,
    attackTimer: actor.attackTimer,
    attackDuration: actor.attackDuration,
    attackStartup: actor.attackStartup,
    attacking: actor.attackState === "quick" || actor.attackState === "lunge",
    vaulting: !!actor.vault,
    vaultFromX: actor.vault ? Number(actor.vault.fromX.toFixed(2)) : null,
    vaultFromY: actor.vault ? Number(actor.vault.fromY.toFixed(2)) : null,
    vaultToX: actor.vault ? Number(actor.vault.toX.toFixed(2)) : null,
    vaultToY: actor.vault ? Number(actor.vault.toY.toFixed(2)) : null,
    vaultProgress: actor.vault ? quantizedProgress(actor.vault.t / actor.vault.duration) : 0,
    windowVaultCooldown: actor.role === "survivor" ? Number((actor.windowVaultCooldown || 0).toFixed(2)) : 0,
    breaking: !!actor.breakTarget,
    invuln: actor.invuln,
    hitBoost: actor.hitBoost,
    healProgress: actor.healProgress || 0,
    activeHealers: actor.activeHealers || [],
    healingTargetId: actor.healingTargetId || null,
    chase: actor.chaseHold > 0,
    killerVisibleHold: actor.killerVisibleHold || 0,
    chatText: (() => {
      const text = actor.chatUntil > (game.time || 0) ? actor.chatText : null;
      if ((actor.downed || actor.hooked || actor.dead || actor.escaped) && isOrbFullChatMessage(text)) return null;
      return text;
    })()
  };
}

function quantizedProgress(value) {
  if (value >= 1) return 1;
  // Keep repair traffic smooth but bounded. Sending microscopic 60Hz float changes
  // during generator repair is how a browser tab becomes a sad space heater.
  return Math.round(clamp(value || 0, 0, 1) * 50) / 50;
}

function canViewerSeeGeneratorDetails(game, viewer, gen) {
  if (!viewer || viewer.role !== "killer") return true;
  const d = dist(viewer.x, viewer.y, gen.x, gen.y);
  if (d <= CLOSE_REVEAL_RADIUS) return segmentClear(game, viewer.x, viewer.y, gen.x, gen.y);
  if (d > KILLER_CONE_LENGTH) return false;
  return segmentClear(game, viewer.x, viewer.y, gen.x, gen.y)
    && coneSees(viewer, { x: gen.x, y: gen.y }, KILLER_CONE_LENGTH, KILLER_CONE_ANGLE);
}

function canViewerSeeCollectibleDot(game, viewer, dot) {
  if (!viewer || !dot || viewer.dead || viewer.escaped || viewer.hooked) return false;
  const length = viewer.role === "killer" ? KILLER_CONE_LENGTH : survivorVisionLengthFor(viewer);
  const angle = viewer.role === "killer" ? KILLER_CONE_ANGLE : survivorVisionAngleFor(viewer);
  const target = { x: dot.x, y: dot.y };
  if (dist(viewer.x, viewer.y, dot.x, dot.y) > length) return false;
  return coneSees(viewer, target, length, angle) && segmentClear(game, viewer.x, viewer.y, dot.x, dot.y);
}

function visibleCollectibleDotsForViewer(game, viewer) {
  if (!viewer) return [];
  return (game.collectibleDots || []).filter((dot) => canViewerSeeCollectibleDot(game, viewer, dot));
}

function serializeGeneratorForViewer(game, viewer, gen) {
  const showDetails = canViewerSeeGeneratorDetails(game, viewer, gen);
  const repairing = showDetails && !!(gen.repairing || (gen.activeRepairers && gen.activeRepairers.length));
  const depositing = showDetails && !!gen.dotDepositing;
  const kicking = showDetails && !!gen.beingKicked;
  return {
    id: gen.id,
    x: gen.x,
    y: gen.y,
    progress: showDetails ? quantizedProgress(gen.progress) : 0,
    done: gen.done,
    showProgress: showDetails,
    showRepairFx: showDetails,
    repairing,
    dotDepositing: depositing,
    dotDepositProgress: showDetails ? quantizedProgress(gen.dotDepositProgress || 0) : 0,
    activeRepairers: repairing ? ["active"] : [],
    beingKicked: kicking,
    kickProgress: showDetails ? quantizedProgress(gen.kickProgress || 0) : 0,
    kickLocked: showDetails ? !!gen.kickLocked : false
  };
}

function buildSnapshotFor(lobby, socketId) {
  const game = lobby.game;
  const viewer = game.actors.get(socketId);
  const pov = getViewerForVisibility(game, viewer);
  const map = game.map;
  const actors = [];
  for (const actor of game.actors.values()) {
    actors.push(serializeActor(game, actor, isActorVisibleToViewer(game, pov, actor)));
  }

  const killer = [...game.actors.values()].find((p) => p.role === "killer");
  let music = {
    layer1: MUSIC_LAYER_1_VOLUME,
    layer2: 0,
    layer3: 0,
    chase: false,
    terror: 0,
    distance: 9999,
    killerVisible: false,
    visibleHold: false
  };

  const musicViewer = (viewer?.role === "survivor" && (viewer.dead || viewer.escaped)) ? pov : viewer;
  if (musicViewer && musicViewer.role === "survivor" && killer && isLivingSurvivor(musicViewer)) {
    const d = dist(musicViewer.x, musicViewer.y, killer.x, killer.y);
    const terror = clamp(1 - d / TERROR_RADIUS, 0, 1);
    const chase = musicViewer.chaseHold > 0;
    const killerVisible = isActorVisibleToViewer(game, musicViewer, killer);

    // Clean three-layer music ladder:
    // layer_1 = normal ambient when the survivor is safe / no meaningful terror pressure.
    // layer_2 = killer is nearby, but the survivor is NOT in chase.
    // layer_3 = survivor is in chase, regardless of whether the killer is currently on-screen.
    const nearbyNoChase = !chase && terror > 0;
    const terrorRamp = Math.pow(terror, 0.72);

    music = {
      layer1: chase ? 0 : MUSIC_LAYER_1_VOLUME * (nearbyNoChase ? clamp(1 - terrorRamp * 0.85, 0.15, 1) : 1),
      layer2: nearbyNoChase ? terrorRamp * MUSIC_LAYER_2_MAX_VOLUME : 0,
      layer3: chase ? MUSIC_LAYER_3_VOLUME : 0,
      chase,
      terror,
      distance: d,
      killerVisible,
      visibleHold: chase
    };
  }

  const visibleScratchMarks = pov?.role === "killer"
    ? game.scratchMarks.filter((s) => {
        if (!pov) return false;
        const d = dist(pov.x, pov.y, s.x, s.y);
        if (d > KILLER_SCRATCH_MARK_VISIBILITY_RANGE) return false;
        const target = { x: s.x, y: s.y };
        return coneSees(pov, target, KILLER_SCRATCH_MARK_VISIBILITY_RANGE, KILLER_CONE_ANGLE) && segmentClear(game, pov.x, pov.y, s.x, s.y);
      })
    : game.scratchMarks.filter((s) => dist(pov?.x || 0, pov?.y || 0, s.x, s.y) < 180);

  const doneGenerators = map.generators.reduce((count, g) => count + (g.done ? 1 : 0), 0);
  const requiredGenerators = game.requiredGenerators;
  const riftsComplete = areRiftsComplete(game);

  return {
    lobbyId: lobby.id,
    seq: game.snapshotSeq || 0,
    matchStartFreezeRemaining: Math.max(0, (game.matchStartFreezeSeconds || MATCH_START_FREEZE_SECONDS) - (game.time || 0)),
    map: {
      width: map.width,
      height: map.height,
      tile: map.tile,
      pallets: map.pallets.map((p) => ({ id: p.id, x: p.x, y: p.y, w: p.w, h: p.h, orientation: p.orientation, state: p.state, broken: p.broken })),
      generators: visibleGeneratorsForSnapshot(game).map((g) => serializeGeneratorForViewer(game, pov, g)),
      riftsHidden: riftsComplete,
      gates: map.gates.map((g) => ({
        id: g.id,
        x: g.x,
        y: g.y,
        open: g.open,
        escapeProgress: Math.max(0, ...[...game.actors.values()]
          .filter((a) => a.role === "survivor" && !a.dead && !a.escaped && a.escapeGateId === g.id)
          .map((a) => quantizedProgress((a.escapeProgress || 0) / GATE_ESCAPE_TIME)))
      })),
      hooks: hooksForSnapshot(game, pov)
    },
    phase: game.phase,
    winner: game.winner,
    endReason: game.endReason,
    viewerId: socketId,
    actors,
    events: game.events.slice(),
    scratchMarks: visibleScratchMarks.map((s) => ({ id: s.id, x: s.x, y: s.y, angle: s.angle, ttl: s.ttl })),
    objective: {
      doneGenerators,
      requiredGenerators,
      totalGenerators: map.generators.length,
      generatorCandidateCount: map.generatorCandidateCount || map.generators.length,
      spawnedGenerators: map.spawnedGenerators || map.generators.length,
      remainingGenerators: Math.max(0, requiredGenerators - doneGenerators),
      riftsHidden: riftsComplete,
      escapeOpen: game.escapeOpen
    },
    collectibleDots: visibleCollectibleDotsForViewer(game, pov).map((d) => ({ id: d.id, x: Math.round(d.x), y: Math.round(d.y), red: (game.redOrbs || 0) > 0 })),
    voidEffects: {
      redOrbs: Number((game.redOrbs || 0).toFixed(2)),
      runnerReveal: Number((game.runnerReveal || 0).toFixed(2))
    },
    music
  };
}

function sendSnapshots() {
  for (const lobby of lobbies.values()) {
    if (!lobby.game) continue;
    lobby.game.snapshotSeq = (lobby.game.snapshotSeq || 0) + 1;
    for (const socketId of lobby.players.keys()) {
      const socket = io.sockets.sockets.get(socketId);
      if (!socket) continue;
      // If a client is already backed up, skip this frame instead of piling JSON
      // into the transport queue. The next volatile snapshot will catch them up.
      if (socket.conn?.transport && socket.conn.transport.writable === false) {
        serverMetrics.snapshotsSkipped += 1;
        continue;
      }
      socket.compress(false).volatile.emit("snapshot", buildSnapshotFor(lobby, socketId));
      serverMetrics.snapshotsSent += 1;
    }
    if (lobby.game.events.length) lobby.game.events.length = 0;
  }
}

setInterval(() => {
  const started = performance.now();
  const dt = 1 / TICK_RATE;
  for (const lobby of lobbies.values()) updateGame(lobby, dt);
  recordTickDuration(performance.now() - started);
}, 1000 / TICK_RATE);

setInterval(sendSnapshots, 1000 / SNAPSHOT_RATE);

io.on("connection", (socket) => {
  if (io.engine.clientsCount > MAX_CONNECTIONS) {
    socket.emit("toast", { type: "error", message: "Server is full right now. Try again in a bit." });
    socket.disconnect(true);
    return;
  }

  socket.data.connectedAt = nowMs();
  socket.emit("hello", { id: socket.id, maps: getMapListForClient(), activeMapId: getDefaultMapId() });
  socket.emit("lobbyList", [...lobbies.values()].map(getLobbySummary));

  socket.on("createLobby", ({ name, role, playerName, skin, mapId } = {}) => {
    if (!allowSocketEvent(socket, "lobby")) return;
    try {
      const lobby = createLobby(name, mapId);
      joinLobby(socket, lobby, role, playerName, skin);
    } catch (error) {
      console.error("Failed to create lobby", error);
      socket.emit("toast", { type: "error", message: error.message || "Failed to create lobby." });
    }
  });

  socket.on("joinLobby", ({ lobbyId, role, playerName, skin } = {}) => {
    if (!allowSocketEvent(socket, "lobby")) return;
    const lobby = lobbies.get(String(lobbyId || ""));
    if (!lobby) {
      socket.emit("toast", { type: "error", message: "Lobby not found." });
      return;
    }
    joinLobby(socket, lobby, role, playerName, skin);
  });

  socket.on("quickJoin", ({ role, playerName, skin, mapId } = {}) => {
    if (!allowSocketEvent(socket, "lobby")) return;
    try {
      const available = [...lobbies.values()].filter((l) => l.phase === "lobby");
      const roleValue = role === "killer" ? "killer" : "survivor";
      const lobby = available.find((l) => {
        const players = [...l.players.values()];
        if (roleValue === "killer") return true;
        return players.filter((p) => p.role === "survivor").length < MAX_SURVIVORS;
      }) || createLobby("Open Lobby", mapId);
      joinLobby(socket, lobby, roleValue, playerName, skin);
    } catch (error) {
      console.error("Failed to quick join", error);
      socket.emit("toast", { type: "error", message: error.message || "Failed to quick join." });
    }
  });

  socket.on("leaveLobby", () => {
    if (!allowSocketEvent(socket, "lobby")) return;
    leaveCurrentLobby(socket);
  });

  socket.on("setRole", ({ role, skin } = {}) => {
    if (!allowSocketEvent(socket, "lobby")) return;
    const lobby = lobbies.get(socketToLobby.get(socket.id));
    if (!lobby || lobby.phase !== "lobby") return;
    const player = lobby.players.get(socket.id);
    if (!player) return;
    const nextRole = role === "killer" ? "killer" : "survivor";
    if (!canChangeRole(lobby, player, nextRole)) {
      socket.emit("toast", { type: "error", message: nextRole === "killer" ? "Could not select The Void." : "Runner slots are full." });
      return;
    }
    player.role = nextRole;
    // If the player picked a survivor skin before switching back from killer,
    // preserve that choice instead of silently resetting them to blue square.
    player.skin = nextRole === "survivor" ? sanitizeSkin(skin || player.skin) : "killerCircle";
    player.ready = false;
    touchLobby(lobby);
    broadcastLobbyState(lobby);
    broadcastLobbyList();
  });

  socket.on("setSkin", ({ skin } = {}) => {
    if (!allowSocketEvent(socket, "lobby")) return;
    const lobby = lobbies.get(socketToLobby.get(socket.id));
    if (!lobby || lobby.phase !== "lobby") return;
    const player = lobby.players.get(socket.id);
    if (!player || player.role !== "survivor") return;
    player.skin = sanitizeSkin(skin);
    player.ready = false;
    touchLobby(lobby);
    broadcastLobbyState(lobby);
  });

  socket.on("setReady", ({ ready } = {}) => {
    if (!allowSocketEvent(socket, "lobby")) return;
    const lobby = lobbies.get(socketToLobby.get(socket.id));
    if (!lobby || lobby.phase !== "lobby") return;
    const player = lobby.players.get(socket.id);
    if (!player) return;
    player.ready = !!ready;
    touchLobby(lobby);
    broadcastLobbyState(lobby);
  });

  socket.on("addBot", ({ role } = {}) => {
    if (!allowSocketEvent(socket, "lobby")) return;
    const lobby = lobbies.get(socketToLobby.get(socket.id));
    if (!lobby) return;
    const result = addBotToLobby(lobby, role);
    if (!result.ok) {
      socket.emit("toast", { type: "error", message: result.message });
      return;
    }
    broadcastLobbyState(lobby);
    broadcastLobbyList();
  });

  socket.on("removeBot", ({ botId } = {}) => {
    if (!allowSocketEvent(socket, "lobby")) return;
    const lobby = lobbies.get(socketToLobby.get(socket.id));
    if (!lobby) return;
    const result = removeBotFromLobby(lobby, botId);
    if (!result.ok) {
      socket.emit("toast", { type: "error", message: result.message });
      return;
    }
    broadcastLobbyState(lobby);
    broadcastLobbyList();
  });

  socket.on("startGame", () => {
    if (!allowSocketEvent(socket, "lobby")) return;
    const lobby = lobbies.get(socketToLobby.get(socket.id));
    if (!lobby) return;
    startGame(lobby);
  });

  socket.on("spectate", (payload = {}) => {
    if (!allowSocketEvent(socket, "action")) return;
    const lobby = lobbies.get(socketToLobby.get(socket.id));
    if (!lobby || !lobby.game || lobby.game.phase !== "game") return;
    const viewer = lobby.game.actors.get(socket.id);
    if (!viewer || viewer.role !== "survivor" || (!viewer.dead && !viewer.escaped)) return;
    const targetId = String(payload.targetId || "");
    const target = lobby.game.actors.get(targetId);
    if (!isLivingSurvivor(target)) return;
    viewer.spectateTargetId = targetId;
  });

  socket.on("input", (input = {}) => {
    if (!allowSocketEvent(socket, "input")) return;
    const lobby = lobbies.get(socketToLobby.get(socket.id));
    if (!lobby || !lobby.game) return;
    const actor = lobby.game.actors.get(socket.id);
    if (!actor) return;
    if (actor.role === "survivor" && actor.dead) return;
    if ((lobby.game.time || 0) < (lobby.game.matchStartFreezeSeconds || MATCH_START_FREEZE_SECONDS)) {
      resetInput(actor.input);
      // Let aim update during the intro so the camera/flashlight can settle naturally,
      // but do not allow movement, attacks, vaults, healing, or deposits yet.
      if (Number.isFinite(input.angle)) actor.input.angle = input.angle;
      return;
    }
    if (actor.role === "killer" && (actor.voidStun || 0) > 0) {
      resetInput(actor.input);
      if (Number.isFinite(input.angle)) actor.input.angle = input.angle;
      return;
    }

    actor.input.up = !!input.up;
    actor.input.down = !!input.down;
    actor.input.left = !!input.left;
    actor.input.right = !!input.right;
    actor.input.sprint = actor.role === "survivor" && !!input.sprint;
    actor.input.repair = !!input.repair;
    actor.input.action = actor.input.action || !!input.action;
    actor.input.actionDir = ["up", "down", "left", "right"].includes(input.actionDir)
      ? input.actionDir
      : null;
    if (actor.role === "killer") {
      actor.input.attack = actor.input.attack || !!input.attack;
      actor.input.attackHeld = !!input.attackHeld;
      actor.input.attackReleased = actor.input.attackReleased || !!input.attackReleased;
    }
    if (Number.isFinite(input.angle)) actor.input.angle = input.angle;
  });

  socket.on("voidAbility", (payload = {}) => {
    if (!allowSocketEvent(socket, "action")) return;
    const lobby = lobbies.get(socketToLobby.get(socket.id));
    if (!lobby || !lobby.game || lobby.game.phase !== "game") return;
    const actor = lobby.game.actors.get(socket.id);
    const result = applyVoidAbility(lobby.game, actor, payload.id);
    if (!result.ok) socket.emit("toast", { type: "error", message: result.message || "The Void cannot use that." });
  });

  socket.on("survivorAbility", (payload = {}) => {
    if (!allowSocketEvent(socket, "action")) return;
    const lobby = lobbies.get(socketToLobby.get(socket.id));
    if (!lobby || !lobby.game || lobby.game.phase !== "game") return;
    const actor = lobby.game.actors.get(socket.id);
    const result = applySurvivorAbility(lobby.game, actor, payload.id);
    if (!result.ok) socket.emit("toast", { type: "error", message: result.message || "Runner ability cannot be used." });
  });

  socket.on("chatWheel", (payload = {}) => {
    if (!allowSocketEvent(socket, "chat")) return;
    const lobby = lobbies.get(socketToLobby.get(socket.id));
    if (!lobby || !lobby.game || lobby.game.phase !== "game") return;
    const actor = lobby.game.actors.get(socket.id);
    if (!actor || actor.dead || actor.escaped) return;
    const messages = getChatWheelMessagesForActor(actor);
    const index = Number.isInteger(payload.index) ? payload.index : Math.floor(Number(payload.index));
    if (!Number.isInteger(index) || index < 0 || index >= messages.length) return;
    setActorChat(actor, messages[index], lobby.game);
  });

  socket.on("backToLobby", () => {
    if (!allowSocketEvent(socket, "lobby")) return;
    const lobby = lobbies.get(socketToLobby.get(socket.id));
    if (!lobby) return;
    if (lobby.phase === "ended") {
      lobby.phase = "lobby";
      lobby.game = null;
      touchLobby(lobby);
      for (const p of lobby.players.values()) p.ready = false;
      broadcastLobbyState(lobby);
      broadcastLobbyList();
    }
  });

  socket.on("disconnect", () => leaveCurrentLobby(socket));
});

setupFrontend()
  .then(() => {
    server.listen(PORT, HOST, () => {
      console.log(`riftrunner running on ${HOST}:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start Riftrunner server", error);
    process.exit(1);
  });


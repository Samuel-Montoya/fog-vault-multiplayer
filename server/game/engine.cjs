const path = require("path");
const fs = require("fs");
const express = require("express");
const http = require("http");
const { monitorEventLoopDelay, performance } = require("perf_hooks");
const { Server } = require("socket.io");
const { loadPublicScriptGlobal } = require("../config/load-public-script.cjs");
const { cfgNumber, parseCsv, normalizeOrigin, readAppVersion } = require("../config/server-runtime.cjs");
const { mountStaticAssetRoutes, setupFrontend } = require("../http/frontend.cjs");

async function startRiftRunnerServer({ rootDir = path.resolve(__dirname, "..") } = {}) {
  const ROOT_DIR = rootDir;
  const botAi = require(path.join(ROOT_DIR, "ai/server-bot-ai.cjs"));
  const GAME_MAPS = loadPublicScriptGlobal(ROOT_DIR, "public/maps.js", "GAME_MAPS");
  const GAMEPLAY_CONFIG = loadPublicScriptGlobal(ROOT_DIR, "public/gameplayConfig.js", "GAMEPLAY_CONFIG");
  const RIFTRUNNER_CHATS = loadPublicScriptGlobal(ROOT_DIR, "public/chats.js", "RIFTRUNNER_CHATS");
  const RIFTRUNNER_ABILITIES = loadPublicScriptGlobal(ROOT_DIR, "public/abilities.js", "RIFTRUNNER_ABILITIES");

  const app = express();
  const server = http.createServer(app);

  const IS_PRODUCTION = process.env.NODE_ENV === "production";
  const PORT = Number(process.env.PORT) || 3000;
  const HOST = process.env.HOST || "0.0.0.0";
  const PUBLIC_DIR = path.join(ROOT_DIR, "public");
  const DIST_DIR = path.join(ROOT_DIR, "dist");
  const PHASER_FILE = path.join(ROOT_DIR, "node_modules", "phaser", "dist", "phaser.min.js");

  const APP_VERSION = readAppVersion(ROOT_DIR);
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
    // RiftRunner is a desktop-only realtime game now, so skip long-polling.
    // WebSocket-only transport avoids polling overhead and old packet backlogs.
    transports: ["websocket"],
    allowUpgrades: false,
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

  mountStaticAssetRoutes({ app, express, publicDir: PUBLIC_DIR, phaserFile: PHASER_FILE });

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
    inputsReceived: 0,
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
    console.log(`[perf] profile=${PERF.profile} tickRate=${TICK_RATE} snapshotRate=${SNAPSHOT_RATE} botThinkRate=${BOT_THINK_RATE} lobbies=${activeLobbies} players=${activePlayers} tickMaxMs=${serverMetrics.tickMaxMs.toFixed(2)} loopMeanMs=${meanLoopMs.toFixed(2)} loopMaxMs=${maxLoopMs.toFixed(2)} inputs=${serverMetrics.inputsReceived} snapshotsSent=${serverMetrics.snapshotsSent} snapshotsSkipped=${serverMetrics.snapshotsSkipped} pathCache=${serverMetrics.pathCacheHits}/${serverMetrics.pathCacheMisses}`);
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
  const GENERATOR_KICK_DISTANCE = cfgNumber(GAMEPLAY_CONFIG.rift?.kickDistance, INTERACT_DISTANCE + 10);
  const QUICK_ATTACK_RANGE = cfgNumber(GAMEPLAY_CONFIG.attack?.quickRange, 82);
  const LUNGE_ATTACK_RANGE = cfgNumber(GAMEPLAY_CONFIG.attack?.lungeRange, 118);
  const ATTACK_ARC = cfgNumber(GAMEPLAY_CONFIG.attack?.arcRadians, Math.PI * 0.50);
  // Small visual/server grace so edge-of-cone hits feel fair without tagging runners who are clearly outside.
  const ATTACK_EDGE_GRACE_RADIUS = cfgNumber(GAMEPLAY_CONFIG.attack?.edgeGraceRadius, 9);
  const ATTACK_TARGET_BODY_RADIUS = cfgNumber(GAMEPLAY_CONFIG.attack?.targetBodyRadius, PLAYER_SIZE * 0.5);
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
  const KILLER_ENDGAME_SPEED_MULT = cfgNumber(GAMEPLAY_CONFIG.void?.endgameSpeedMultiplier, 1.10);
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
  const BOT_KILLER_WINDOW_REUSE_COOLDOWN = cfgNumber(GAMEPLAY_CONFIG.bots?.voidWindowReuseCooldown, 0.85);
  const KILLER_BREAK_TIME = cfgNumber(GAMEPLAY_CONFIG.void?.breakTime, 1.25);
  const VOID_STUN_TIME = cfgNumber(GAMEPLAY_CONFIG.pallet?.voidStunSeconds, 1.0);
  const VOID_STUN_CLOSE_RADIUS = cfgNumber(GAMEPLAY_CONFIG.pallet?.voidStunCloseRadius, 42);
  const VOID_STUN_SWING_RADIUS = cfgNumber(GAMEPLAY_CONFIG.pallet?.voidStunSwingRadius, 64);
  // Adjustable generator speed: raise this number to make generators slower.
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
  const HOOK_TEAMMATE_SEARCH_RADIUS = cfgNumber(GAMEPLAY_CONFIG.hook?.teammateSearchRadius, 760);
  const HOOK_TEAMMATE_IDEAL_DISTANCE = cfgNumber(GAMEPLAY_CONFIG.hook?.teammateIdealDistance, 360);
  const HOOK_TEAMMATE_MIN_DISTANCE = cfgNumber(GAMEPLAY_CONFIG.hook?.teammateMinDistance, 150);
  const HOOK_INTERACTABLE_AVOID_DISTANCE = cfgNumber(GAMEPLAY_CONFIG.hook?.interactableAvoidDistance, 92);
  const HOOK_EDGE_PADDING_TILES = cfgNumber(GAMEPLAY_CONFIG.hook?.edgePaddingTiles, 1.35);
  const SURVIVOR_DOT_MAX = cfgNumber(GAMEPLAY_CONFIG.orbs?.survivorMax, 30);
  const KILLER_DOT_MAX = cfgNumber(GAMEPLAY_CONFIG.orbs?.voidMax, 999);
  // Dot economy: survivors complete rifts by collecting orbs and standing near a rift.
  // No hold-E rift repair. One inserted orb takes a flat 1.5s and each rift needs dotsPerRift orbs.
  const DOTS_PER_GENERATOR = cfgNumber(GAMEPLAY_CONFIG.rift?.dotsPerRift, 30);
  const SURVIVOR_DOT_PICKUP_RADIUS = cfgNumber(GAMEPLAY_CONFIG.orbs?.survivorPickupRadius, 48);
  const KILLER_DOT_PICKUP_RADIUS = cfgNumber(GAMEPLAY_CONFIG.orbs?.voidPickupRadius, 92);
  const VOID_ABILITY_DEFS = RIFTRUNNER_ABILITIES.abilities || {};
  const VOID_ABILITY_ORDER = Array.isArray(RIFTRUNNER_ABILITIES.wheelOrder) ? RIFTRUNNER_ABILITIES.wheelOrder : Object.keys(VOID_ABILITY_DEFS);
  const SURVIVOR_ABILITY_DEFS = RIFTRUNNER_ABILITIES.survivorAbilities || {};
  const SURVIVOR_ABILITY_ORDER = Array.isArray(RIFTRUNNER_ABILITIES.survivorWheelOrder) ? RIFTRUNNER_ABILITIES.survivorWheelOrder : Object.keys(SURVIVOR_ABILITY_DEFS);
  const SURVIVOR_RIFT_LENS_LENGTH_MULT = cfgNumber(GAMEPLAY_CONFIG.survivorAbilities?.riftLensLengthMultiplier, 1.55);
  const SURVIVOR_RIFT_LENS_ANGLE_MULT = cfgNumber(GAMEPLAY_CONFIG.survivorAbilities?.riftLensAngleMultiplier, 1.38);
  const SURVIVOR_SAFE_CONE_LENGTH_MULT = Math.max(1, cfgNumber(
    GAMEPLAY_CONFIG.survivor?.nonSprintingConeLengthMultiplier ?? GAMEPLAY_CONFIG.survivor?.walkingConeLengthMultiplier,
    1.22
  ));
  const SURVIVOR_SAFE_CONE_ANGLE_MULT = Math.max(1, cfgNumber(
    GAMEPLAY_CONFIG.survivor?.nonSprintingConeAngleMultiplier ?? GAMEPLAY_CONFIG.survivor?.walkingConeAngleMultiplier,
    1.12
  ));
  const SURVIVOR_HOURGLASS_BACK_LENGTH_MULT = cfgNumber(GAMEPLAY_CONFIG.survivorAbilities?.hourglassBackLengthMultiplier, 0.92);
  const SURVIVOR_HOURGLASS_BACK_ANGLE_MULT = cfgNumber(GAMEPLAY_CONFIG.survivorAbilities?.hourglassBackAngleMultiplier, 1.0);
  const SURVIVOR_HOURGLASS_HIDES_SCRATCH = GAMEPLAY_CONFIG.survivorAbilities?.hourglassHidesScratchMarks !== false;
  const SURVIVOR_SPEED_BURST_MULT = cfgNumber(GAMEPLAY_CONFIG.survivorAbilities?.speedBurstSpeedMultiplier, 1.14);
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
  const MUSIC_LAYER_2_RADIUS = cfgNumber(GAMEPLAY_CONFIG.chase?.musicLayer2Radius, TERROR_RADIUS * 1.45);
  const MUSIC_LAYER_2_FULL_RADIUS = cfgNumber(GAMEPLAY_CONFIG.chase?.musicLayer2FullRadius, CHASE_START_RADIUS * 0.82);
  const MUSIC_LAYER_2_MIN_VOLUME = cfgNumber(GAMEPLAY_CONFIG.chase?.musicLayer2MinVolume, 0.035);
  const MUSIC_LAYER_2_MAX_VOLUME = cfgNumber(GAMEPLAY_CONFIG.chase?.musicLayer2MaxVolume, 0.42);
  const MUSIC_LAYER_2_CHASE_BED_VOLUME = cfgNumber(GAMEPLAY_CONFIG.chase?.musicLayer2ChaseBedVolume, 0.07);
  const MUSIC_LAYER_2_CURVE = cfgNumber(GAMEPLAY_CONFIG.chase?.musicLayer2Curve, 1.08);
  const MUSIC_LAYER_3_VOLUME = cfgNumber(GAMEPLAY_CONFIG.chase?.musicLayer3Volume, 0.30);
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

  function survivorCarefulVisionActive(actor) {
    if (!actor || actor.role !== "survivor" || actor.dead || actor.escaped || actor.downed || actor.hooked) return false;
    // Server-side match for the client cone: not holding sprint grants the bigger
    // awareness cone, whether the Runner is standing still or walking. Holding
    // Shift immediately falls back to the normal base cone.
    return !actor.input?.sprint;
  }

  function survivorVisionLengthFor(actor) {
    let length = SURVIVOR_CONE_LENGTH;
    if (survivorCarefulVisionActive(actor)) length *= SURVIVOR_SAFE_CONE_LENGTH_MULT;
    if (actor?.role === "survivor" && (actor.riftLens || 0) > 0) length *= SURVIVOR_RIFT_LENS_LENGTH_MULT;
    return length;
  }

  function survivorVisionAngleFor(actor) {
    let angle = SURVIVOR_CONE_ANGLE;
    if (survivorCarefulVisionActive(actor)) angle *= SURVIVOR_SAFE_CONE_ANGLE_MULT;
    if (actor?.role === "survivor" && (actor.riftLens || 0) > 0) angle *= SURVIVOR_RIFT_LENS_ANGLE_MULT;
    return Math.min(Math.PI * 1.08, angle);
  }

  function survivorBackVisionLengthFor(actor) {
    return survivorVisionLengthFor(actor) * SURVIVOR_HOURGLASS_BACK_LENGTH_MULT;
  }

  function survivorBackVisionAngleFor(actor) {
    return Math.min(Math.PI * 1.08, survivorVisionAngleFor(actor) * SURVIVOR_HOURGLASS_BACK_ANGLE_MULT);
  }

  function survivorVisionSamplesForActor(actor) {
    if (!actor) return [];
    const radius = actor.role === "killer" ? KILLER_SIZE * 0.48 : PLAYER_SIZE * 0.48;
    return [
      { x: actor.x, y: actor.y },
      { x: actor.x + radius, y: actor.y },
      { x: actor.x - radius, y: actor.y },
      { x: actor.x, y: actor.y + radius },
      { x: actor.x, y: actor.y - radius }
    ];
  }

  function survivorConeSeesPoint(viewer, target, length = survivorVisionLengthFor(viewer), angle = survivorVisionAngleFor(viewer)) {
    if (!viewer || !target) return false;
    if (coneSees(viewer, target, length, angle)) return true;
    if ((viewer.hourglass || 0) <= 0) return false;
    return coneSees({ ...viewer, angle: (viewer.angle || 0) + Math.PI }, target, survivorBackVisionLengthFor(viewer), survivorBackVisionAngleFor(viewer));
  }

  function survivorCanSeePoint(game, viewer, x, y, { allowCloseReveal = false } = {}) {
    if (!viewer || viewer.role !== "survivor" || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const d = dist(viewer.x, viewer.y, x, y);
    if (allowCloseReveal && d <= CLOSE_REVEAL_RADIUS) return segmentClear(game, viewer.x, viewer.y, x, y);
    const maxLength = Math.max(survivorVisionLengthFor(viewer), (viewer.hourglass || 0) > 0 ? survivorBackVisionLengthFor(viewer) : 0);
    if (d > maxLength) return false;
    if (!survivorConeSeesPoint(viewer, { x, y })) return false;
    return segmentClear(game, viewer.x, viewer.y, x, y);
  }

  function survivorCanSeeActor(game, viewer, actor, { allowCloseReveal = true } = {}) {
    if (!viewer || !actor) return false;
    const d = dist(viewer.x, viewer.y, actor.x, actor.y);
    if (allowCloseReveal && d <= CLOSE_REVEAL_RADIUS) return segmentClear(game, viewer.x, viewer.y, actor.x, actor.y);
    for (const sample of survivorVisionSamplesForActor(actor)) {
      if (survivorCanSeePoint(game, viewer, sample.x, sample.y, { allowCloseReveal: false })) return true;
    }
    return false;
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

    if (ability.id === "riftLens") {
      actor.riftLens = Math.max(actor.riftLens || 0, ability.duration || 15);
    } else if (ability.id === "hourglass") {
      actor.hourglass = Math.max(actor.hourglass || 0, ability.duration || 5);
      if (SURVIVOR_HOURGLASS_HIDES_SCRATCH && Array.isArray(game.scratchMarks)) {
        game.scratchMarks = game.scratchMarks.filter((mark) => mark.actorId !== actor.id);
      }
    } else if (ability.id === "speedBurst") {
      actor.speedBurst = Math.max(actor.speedBurst || 0, ability.duration || 5);
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
      riftLens: actor.riftLens || 0,
      hourglass: actor.hourglass || 0,
      speedBurst: actor.speedBurst || 0,
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

  function smoothstep(value) {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  }

  function dist(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
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

  function visibleGeneratorsForSnapshot(game, forceVisible = false) {
    if (areRiftsComplete(game) && !forceVisible) return [];
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

  function attackSegmentClearToSurvivor(game, ax, ay, survivor, hit) {
    if (!survivor) return false;

    const candidates = [];
    const pushCandidate = (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const duplicate = candidates.some((p) => dist(p.x, p.y, x, y) < 1.5);
      if (!duplicate) candidates.push({ x, y });
    };

    // Center first for the normal clean case. The extra body-edge samples make the
    // server agree with what the player sees when the visible Runner shape is clipped
    // by the edge of the M1 cone. Yes, hitboxes are geometry drama with keyboards.
    pushCandidate(survivor.x, survivor.y);

    const hitX = Number(hit?.hitX);
    const hitY = Number(hit?.hitY);
    pushCandidate(hitX, hitY);

    const dx = survivor.x - ax;
    const dy = survivor.y - ay;
    const len = Math.hypot(dx, dy);
    const radius = Math.max(0, Number(hit?.targetRadius) || ATTACK_TARGET_BODY_RADIUS);

    if (len > 0.001 && radius > 0.001) {
      const ux = dx / len;
      const uy = dy / len;
      const px = -uy;
      const py = ux;
      const edge = Math.min(radius * 0.82, Math.max(4, radius - 2));
      const front = Math.max(0, len - radius);

      pushCandidate(ax + ux * front, ay + uy * front);
      pushCandidate(survivor.x + px * edge, survivor.y + py * edge);
      pushCandidate(survivor.x - px * edge, survivor.y - py * edge);
      pushCandidate(ax + ux * Math.max(0, front) + px * edge * 0.55, ay + uy * Math.max(0, front) + py * edge * 0.55);
      pushCandidate(ax + ux * Math.max(0, front) - px * edge * 0.55, ay + uy * Math.max(0, front) - py * edge * 0.55);
    }

    return candidates.some((p) => attackSegmentClear(game, ax, ay, p.x, p.y));
  }

  function coneSees(viewer, target, length, angle) {
    const d = dist(viewer.x, viewer.y, target.x, target.y);
    if (d > length) return false;
    const a = Math.atan2(target.y - viewer.y, target.x - viewer.x);
    return angleDiff(a, viewer.angle || 0) <= angle / 2;
  }

  function createMatchStats(role) {
    if (role === "spectator") {
      return {};
    }
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
    const killerCount = players.filter((p) => p.role === "killer").length;
    const spectators = players.filter((p) => p.role === "spectator").length;
    const killer = killerCount > 0;
    return {
      id: lobby.id,
      name: lobby.name,
      mapId: lobby.mapId,
      mapName: lobby.mapName,
      phase: lobby.phase,
      playerCount: players.length,
      survivors,
      killer,
      killerCount,
      spectators,
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
      skin: role === "survivor" ? sanitizeSkin(options.skin) : role === "killer" ? "killerCircle" : "spectatorEye",
      ready: role === "spectator",
      x: 0,
      y: 0,
      angle: 0,
      health: role === "survivor" ? 2 : role === "killer" ? 999 : 1,
      dots: 0,
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
      hourglass: 0,
      speedBurst: 0,
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

  const SPECTATE_OVERVIEW_ID = "__overview__";

  function isSpectateOverviewId(id) {
    return id === SPECTATE_OVERVIEW_ID;
  }

  function normalizeRequestedRole(requestedRole) {
    if (requestedRole === "killer") return "killer";
    if (requestedRole === "spectator") return "spectator";
    return "survivor";
  }

  function getSpectatorTargetCandidates(game, viewer = null) {
    if (!game?.actors) return [];
    return [...game.actors.values()].filter((actor) => {
      if (!actor || actor.id === viewer?.id || actor.role === "spectator") return false;
      if (actor.role === "killer") return !actor.dead;
      if (actor.role === "survivor") return !actor.dead && !actor.escaped;
      return false;
    });
  }

  function defaultSpectatorTarget(game, viewer = null) {
    const targets = getSpectatorTargetCandidates(game, viewer);
    return targets.find((actor) => actor.role === "killer") || targets.find((actor) => actor.role === "survivor") || null;
  }

  function isSpectatorOverviewViewer(viewer) {
    return !!(viewer && viewer.role === "spectator" && isSpectateOverviewId(viewer.spectateTargetId));
  }

  function placeSpectatorNearTarget(game, spectator) {
    const target = defaultSpectatorTarget(game, spectator);
    if (target) {
      spectator.x = target.x;
      spectator.y = target.y;
      spectator.angle = target.angle || 0;
      spectator.spectateTargetId = target.id;
    } else if (game?.map) {
      spectator.x = game.map.width / 2;
      spectator.y = game.map.height / 2;
      spectator.angle = 0;
      spectator.spectateTargetId = null;
    }
    return spectator;
  }

  function addSpectatorActorToGame(lobby, player) {
    if (!lobby?.game || !player || player.role !== "spectator") return null;
    const existing = lobby.game.actors.get(player.id);
    if (existing?.role === "spectator") return existing;
    const spectator = makePlayer({ id: player.id }, "spectator", player.name, { isBot: false });
    spectator.ready = true;
    placeSpectatorNearTarget(lobby.game, spectator);
    lobby.game.actors.set(spectator.id, spectator);
    return spectator;
  }

  function joinSpectatorLobby(socket, lobby, name) {
    leaveCurrentLobby(socket);

    if (!lobby || (lobby.phase !== "lobby" && lobby.phase !== "game")) {
      socket.emit("toast", { type: "error", message: "That lobby is not available to spectate." });
      return false;
    }

    const player = makePlayer(socket, "spectator", name || "Spectator", { isBot: false });
    player.ready = true;
    lobby.players.set(socket.id, player);
    touchLobby(lobby);
    socketToLobby.set(socket.id, lobby.id);
    socket.join(lobby.id);
    socket.emit("joinedLobby", { lobbyId: lobby.id, playerId: socket.id, spectator: true });

    if (lobby.phase === "game" && lobby.game) {
      addSpectatorActorToGame(lobby, player);
      socket.emit("gameStarted", {
        ...serializeMapForClient(lobby.game.map),
        spectator: true,
        inProgress: true
      });
      socket.emit("toast", { type: "info", message: "Spectating run — Tab switches views." });
    }

    broadcastLobbyState(lobby);
    broadcastLobbyList();
    return true;
  }

  function joinLobby(socket, lobby, requestedRole, name, skin) {
    const role = normalizeRequestedRole(requestedRole);
    if (role === "spectator") return joinSpectatorLobby(socket, lobby, name);

    leaveCurrentLobby(socket);

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
          if (actor.role === "spectator") {
            lobby.game.actors.delete(socket.id);
          } else if (actor.role === "killer") {
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
      players: [...lobby.players.values()].map((p) => ({ id: p.id, name: p.name, role: p.role, skin: p.skin || "blueSquare", ready: (p.role === "spectator" || p.isBot) ? true : !!p.ready, isBot: !!p.isBot }))
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
    if (role === "spectator") return true;
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
      if (player.role === "spectator" || player.isBot) player.ready = true;
    }

    const unreadyHumans = players.filter((player) => player.role !== "spectator" && !player.isBot && !player.ready);
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
      riftEndgameActive: false,
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
    const spectatorPlayers = [];
    for (const player of players) {
      if (player.role === "spectator") {
        spectatorPlayers.push(player);
        continue;
      }
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

    for (const player of spectatorPlayers) {
      const spectator = makePlayer({ id: player.id }, "spectator", player.name, { isBot: false });
      spectator.ready = true;
      placeSpectatorNearTarget(game, spectator);
      game.actors.set(spectator.id, spectator);
    }

    botAi.assignRunnerBotPersonalities(game);

    lobby.phase = "game";
    lobby.game = game;
    touchLobby(lobby);
    for (const player of lobby.players.values()) player.ready = player.role === "spectator";
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
    game.events.push({
      id: uid("evt"),
      type,
      createdAt: Number((game.time || 0).toFixed(3)),
      ...data
    });
    if (game.events.length > 40) game.events.splice(0, game.events.length - 40);
  }

  function addScratch(game, actor) {
    if (actor?.role === "survivor" && ((actor.stealthStep || 0) > 0 || (SURVIVOR_HOURGLASS_HIDES_SCRATCH && (actor.hourglass || 0) > 0))) return;
    game.scratchMarks.push({ id: uid("scratch"), actorId: actor.id, x: actor.x, y: actor.y, angle: actor.angle + (Math.random() - 0.5), ttl: 4.0, createdAt: game.time || 0 });
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
    if (actor.role === "killer" && areRiftsComplete(game)) speed *= KILLER_ENDGAME_SPEED_MULT;
    if (actor.role === "killer" && actor.recovery > 0) speed *= KILLER_RECOVERY_SPEED_MULT;
    if (actor.role === "killer" && (actor.voidSpeedBoost || 0) > 0) speed *= VOID_SPEED_BUFF_MULT;
    if (actor.role === "survivor" && (actor.speedBurst || 0) > 0 && !actor.downed) speed *= SURVIVOR_SPEED_BURST_MULT;
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

  function botWindowSide(windowObj, x, y) {
    if (!windowObj) return 0;
    const c = centerOf(windowObj);
    if (windowObj.orientation === "horizontal") return Math.sign(y - c.y) || 0;
    return Math.sign(x - c.x) || 0;
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
      targetRadius: ATTACK_TARGET_BODY_RADIUS,
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
      startup: profile.startup,
      activeDuration: profile.duration
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
    const targetRadius = Math.max(0, profile.targetRadius || ATTACK_TARGET_BODY_RADIUS);
    const bodyGrace = edgeGrace + targetRadius;

    // Test the Runner body as a circle, not just the center point. The drawn actor has
    // size, so the hit check must accept body-edge overlaps with the visible M1 cone.
    if (distance > profile.range + bodyGrace) return null;
    if (forward < -bodyGrace || forward > profile.range + bodyGrace) return null;

    const targetAngle = Math.atan2(dy, dx);
    const angleGrace = distance > 1
      ? Math.asin(clamp(bodyGrace / distance, 0, 1))
      : Math.PI / 2;
    const angleDelta = angleDiff(targetAngle, angle || 0);
    if (angleDelta > profile.arc / 2 + angleGrace) return null;

    const hitDistance = Math.max(0, distance - targetRadius);
    const invDistance = distance > 0.001 ? 1 / distance : 0;

    return {
      originX,
      originY,
      distance,
      angleDelta,
      targetRadius,
      hitX: originX + dx * invDistance * hitDistance,
      hitY: originY + dy * invDistance * hitDistance
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
      if (!attackSegmentClearToSurvivor(game, hit.originX, hit.originY, survivor, hit)) continue;
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
      actor.hourglass = Math.max(0, (actor.hourglass || 0) - dt);
      actor.speedBurst = Math.max(0, (actor.speedBurst || 0) - dt);
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
        carryMax: maxDots,
        red: (game.redOrbs || 0) > 0
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
          if (allRiftsDone) {
            game.riftEndgameActive = true;
            bumpPathCache(game);
          }
          addEvent(game, "genDone", {
            x: gen.x,
            y: gen.y,
            generatorId: gen.id,
            completedRifts,
            requiredRifts: game.requiredGenerators,
            allRiftsDone,
            voidBuffed: allRiftsDone,
            voidSpeedMultiplier: allRiftsDone ? KILLER_ENDGAME_SPEED_MULT : 1
          });
          break;
        }
      }
    }
  }

  function activeRescueTeammatesForHook(game, survivor) {
    if (!game || !survivor) return [];
    return [...game.actors.values()]
      .filter((actor) => actor.id !== survivor.id)
      .filter((actor) => actor.role === "survivor" && !actor.dead && !actor.escaped)
      // Prefer teammates who can actually rescue. Hooking near another hooked/downed Runner is
      // technically "near a teammate" and also technically terrible, the way humans use Excel.
      .filter((actor) => !actor.hooked && !actor.downed);
  }

  function hookSpotNearInteractable(game, x, y) {
    const avoid = Math.max(HOOK_INTERACTABLE_AVOID_DISTANCE, game.map.tile * 0.92);
    const bodySize = Math.max(PLAYER_SIZE, game.map.tile * 0.74);
    const body = { x: x - bodySize / 2, y: y - bodySize / 2, w: bodySize, h: bodySize };
    const interactables = [
      ...(game.map.windows || []),
      ...(game.map.pallets || []).filter((p) => !p.broken)
    ];

    for (const obj of interactables) {
      if (rectsOverlap(body, obj)) return true;
      const c = centerOf(obj);
      if (dist(x, y, c.x, c.y) < avoid) return true;
    }
    return false;
  }

  function hookSpotEdgePenalty(game, x, y) {
    const pad = Math.max(0, HOOK_EDGE_PADDING_TILES) * game.map.tile;
    if (pad <= 0) return 0;
    const left = x;
    const right = game.map.width - x;
    const top = y;
    const bottom = game.map.height - y;
    const nearest = Math.min(left, right, top, bottom);
    return nearest >= pad ? 0 : (pad - nearest) / pad;
  }

  function isValidHookFloorSpot(game, survivor, p) {
    if (!game || !p) return false;
    const tile = game.map.tile;
    const t = tileAt(game, p.x, p.y);
    if (game.map.rawRows[t.y]?.[t.x] !== ".") return false;

    // Never put a fresh hook on top of an existing hook, objective, window, or pallet.
    const tooCloseToExisting = (game.map.hooks || []).some((h) => h.active && dist(h.x, h.y, p.x, p.y) < tile * 3);
    if (tooCloseToExisting) return false;

    const nearObjective = [...(game.map.generators || []), ...(game.map.gates || [])]
      .some((o) => dist(o.x, o.y, p.x, p.y) < tile * 1.45);
    if (nearObjective) return false;
    if (hookSpotNearInteractable(game, p.x, p.y)) return false;

    // Use the actual movement collision check too. Raw floor tiles can still be ugly because
    // a generator collision rect or dropped pallet may overlap the body area.
    if (survivor && wouldCollide(game, survivor, p.x, p.y)) return false;
    return true;
  }

  function scoreHookSpot(game, survivor, killer, p, teammates, teammateRequired) {
    const tile = game.map.tile;
    const killerDistance = killer ? dist(killer.x, killer.y, p.x, p.y) : game.map.width + game.map.height;
    const nearestTeammateDistance = teammates.length
      ? Math.min(...teammates.map((mate) => dist(mate.x, mate.y, p.x, p.y)))
      : Infinity;

    if (teammateRequired && nearestTeammateDistance > HOOK_TEAMMATE_SEARCH_RADIUS) return -Infinity;

    const ideal = Math.max(HOOK_TEAMMATE_MIN_DISTANCE + tile * 0.4, HOOK_TEAMMATE_IDEAL_DISTANCE);
    const teammateCloseness = Number.isFinite(nearestTeammateDistance)
      ? Math.max(0, 1 - Math.abs(nearestTeammateDistance - ideal) / Math.max(ideal, 1))
      : 0;
    const rescueTooClosePenalty = nearestTeammateDistance < HOOK_TEAMMATE_MIN_DISTANCE
      ? (HOOK_TEAMMATE_MIN_DISTANCE - nearestTeammateDistance) * 2.25
      : 0;
    const killerSafety = killer ? killerDistance : game.map.width;
    const killerCampingPenalty = killer && killerDistance < HOOK_MIN_KILLER_DISTANCE
      ? (HOOK_MIN_KILLER_DISTANCE - killerDistance) * 4.5
      : 0;
    const edgePenalty = hookSpotEdgePenalty(game, p.x, p.y) * tile * 2.25;

    // If we have real rescue teammates, favor a reachable-ish rescue bubble first, then push the
    // hook to the safest point from The Void inside that bubble. No teammate? Fall back to pure safety.
    const teammateScore = teammates.length ? teammateCloseness * 900 - Math.max(0, nearestTeammateDistance - HOOK_TEAMMATE_SEARCH_RADIUS) * 5 : 0;
    return killerSafety * 2.2 + teammateScore - rescueTooClosePenalty - killerCampingPenalty - edgePenalty + Math.random() * 0.01;
  }

  function randomFloorHookSpot(game, killer = null, survivor = null) {
    const tile = game.map.tile;
    const candidates = [];
    const teammateCandidates = [];
    const farCandidates = [];
    const minKillerDistance = Math.max(HOOK_MIN_KILLER_DISTANCE, tile * 5.5);
    const teammates = activeRescueTeammatesForHook(game, survivor);

    for (let y = 1; y < game.map.rows - 1; y++) {
      for (let x = 1; x < game.map.cols - 1; x++) {
        const p = tileCenter(game, x, y);
        if (!isValidHookFloorSpot(game, survivor, p)) continue;

        const nearestTeammateDistance = teammates.length
          ? Math.min(...teammates.map((mate) => dist(mate.x, mate.y, p.x, p.y)))
          : Infinity;
        const candidate = {
          ...p,
          score: scoreHookSpot(game, survivor, killer, p, teammates, false),
          teammateScore: scoreHookSpot(game, survivor, killer, p, teammates, true),
          killerDistance: killer ? dist(killer.x, killer.y, p.x, p.y) : Infinity,
          nearestTeammateDistance
        };
        candidates.push(candidate);
        if (candidate.killerDistance >= minKillerDistance) farCandidates.push(candidate);
        if (teammates.length && Number.isFinite(nearestTeammateDistance) && nearestTeammateDistance <= HOOK_TEAMMATE_SEARCH_RADIUS) {
          teammateCandidates.push(candidate);
        }
      }
    }

    const sortByScore = (a, b) => b.score - a.score;
    const sortByTeammateScore = (a, b) => b.teammateScore - a.teammateScore;

    // Primary rule: hook near a teammate who can rescue, while choosing the safest point from The Void
    // inside that rescue neighborhood. This prevents lonely corner hooks without turning hooks into
    // instant free rescues. Civilization limps forward.
    if (teammateCandidates.length) {
      const safeTeammateCandidates = teammateCandidates.filter((c) => !killer || c.killerDistance >= minKillerDistance * 0.72);
      return (safeTeammateCandidates.length ? safeTeammateCandidates : teammateCandidates).sort(sortByTeammateScore)[0];
    }

    // Secondary rule: if every active teammate is too far or dead-ish, go as far from The Void as possible.
    if (farCandidates.length) return farCandidates.sort(sortByScore)[0];
    if (candidates.length) return candidates.sort(sortByScore)[0];
    return { x: game.map.width / 2, y: game.map.height / 2 };
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
    const spot = randomFloorHookSpot(game, killer, survivor);
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
    const maxD2 = GENERATOR_KICK_DISTANCE * GENERATOR_KICK_DISTANCE;
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
      game.riftEndgameActive = true;
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
    const finalActors = [...game.actors.values()].filter((p) => p.role !== "spectator").map((p) => ({
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

  function bumpPathCache(game) {
    if (!game) return;
    game.pathCacheEpoch = (game.pathCacheEpoch || 0) + 1;
    game.pathCache?.clear?.();
    game.movementBlockerCache = null;
  }

  function canBotStandAt(game, actor, x, y) {
    if (!game || !actor || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    return !wouldCollide(game, actor, x, y);
  }

  const BOT_AI_HELPERS = Object.freeze({
    resetInput,
    dist,
    segmentClear,
    attackSegmentClear,
    canActorStandAt: canBotStandAt,
    dotDepositDistance: DOT_DEPOSIT_DISTANCE,
    survivorDotMax: SURVIVOR_DOT_MAX,
    survivorPickupRadius: SURVIVOR_DOT_PICKUP_RADIUS,
    dotsPerRift: DOTS_PER_GENERATOR,
    riftKickDistance: GENERATOR_KICK_DISTANCE,
    interactDistance: INTERACT_DISTANCE,
    quickAttackRange: QUICK_ATTACK_RANGE,
    lungeAttackRange: LUNGE_ATTACK_RANGE,
    hookInteractDistance: HOOK_INTERACT_DISTANCE,
    hookRescueDistance: HOOK_RESCUE_DISTANCE,
    healDistance: HEAL_DISTANCE
  });

  function updateGame(lobby, dt) {
    const game = lobby.game;
    if (!game || game.phase !== "game") return;

    game.time = (game.time || 0) + dt;

    // Hard match-start lock. The client also shows a zoomed spawn intro, but this is
    // the real gate: no human or bot movement/actions until the intro window ends.
    if (game.time < (game.matchStartFreezeSeconds || MATCH_START_FREEZE_SECONDS)) {
      game.botThinkAccumulator = 0;
      for (const actor of game.actors.values()) {
        if (actor.role === "spectator") continue;
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
      botAi.updateBotInputs(game, botDt, BOT_AI_HELPERS);
    }
    updateTimers(game, dt);
    updateHookInteractions(game, dt);
    updateGeneratorKicks(game, dt);
    const killer = [...game.actors.values()].find((p) => p.role === "killer");
    for (const actor of game.actors.values()) {
      if (actor.role !== "spectator") moveActor(game, actor, dt);
    }
    updateCollectibleDots(game, dt);
    updateKillerAttack(game, killer, dt);
    for (const actor of game.actors.values()) {
      if (actor.role !== "spectator" && actor.input.action) handleAction(game, actor);
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

  function isSpectatableActorForViewer(viewer, target) {
    if (!viewer || !target || target.id === viewer.id || target.role === "spectator") return false;
    if (viewer.role === "spectator") {
      if (target.role === "killer") return !target.dead;
      if (target.role === "survivor") return !target.dead && !target.escaped;
      return false;
    }
    if (viewer.role === "survivor" && (viewer.dead || viewer.escaped)) {
      return isLivingSurvivor(target);
    }
    return false;
  }

  function getSpectateTarget(game, viewer) {
    if (!viewer || !game?.actors) return null;
    if (isSpectatorOverviewViewer(viewer)) return null;
    if (viewer.role !== "spectator" && !(viewer.role === "survivor" && (viewer.dead || viewer.escaped))) return null;

    const preferred = viewer.spectateTargetId ? game.actors.get(viewer.spectateTargetId) : null;
    if (isSpectatableActorForViewer(viewer, preferred)) return preferred;

    const spectatorDefault = viewer.role === "spectator" ? defaultSpectatorTarget(game, viewer) : null;
    if (spectatorDefault) return spectatorDefault;

    let nearest = null;
    let nearestDist = Infinity;
    for (const actor of game.actors.values()) {
      if (!isSpectatableActorForViewer(viewer, actor)) continue;
      const d = dist(viewer.x, viewer.y, actor.x, actor.y);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = actor;
      }
    }
    return nearest;
  }

  /** Spectators and out-of-run survivors view through their selected target's fog and LOS rules. */
  function getViewerForVisibility(game, viewer) {
    if (!viewer) return viewer;
    if (isSpectatorOverviewViewer(viewer)) {
      return {
        id: viewer.id,
        role: "spectatorOverview",
        x: game?.map?.width ? game.map.width / 2 : viewer.x,
        y: game?.map?.height ? game.map.height / 2 : viewer.y,
        angle: 0
      };
    }
    if (viewer.role === "spectator" || (viewer.role === "survivor" && (viewer.dead || viewer.escaped))) {
      return getSpectateTarget(game, viewer) || viewer;
    }
    return viewer;
  }

  function isActorVisibleToViewer(game, viewer, actor) {
    if (!viewer || !actor) return false;
    if (viewer.id === actor.id) return true;
    if (viewer.role === "spectatorOverview") return !actor.dead && !actor.escaped;
    if (actor.dead || actor.escaped) return false;

    const d = dist(viewer.x, viewer.y, actor.x, actor.y);
    const los = segmentClear(game, viewer.x, viewer.y, actor.x, actor.y);

    if (viewer.role === "survivor" && actor.role === "killer") {
      return survivorCanSeeActor(game, viewer, actor, { allowCloseReveal: true });
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
      // Hooked/downed teammates are global survivor information. They should be visible on
      // the map even outside cone/LOS so rescue pathing is readable and not a fog lottery.
      if (actor.hooked || actor.downed) return true;
      return survivorCanSeeActor(game, viewer, actor, { allowCloseReveal: true });
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


  function serializeBotAiDebug(game, actor) {
    if (!actor?.isBot) return null;
    const input = actor.input || {};
    const isMoving = !!(input.up || input.down || input.left || input.right || actor.vault);
    const movement = [
      input.up ? "U" : "",
      input.down ? "D" : "",
      input.left ? "L" : "",
      input.right ? "R" : ""
    ].join("") || "none";

    const runnerBrain = actor.role === "survivor" ? actor.bot?.simpleAi : null;
    const voidBrain = actor.role === "killer" ? actor.bot?.voidRiftAi : null;
    const brain = runnerBrain || voidBrain;
    if (!brain) return null;

    let mode = "idle";
    let task = brain.task || null;
    let targetId = task?.id || null;
    let reason = "";

    if (actor.role === "survivor") {
      if (actor.vault) {
        mode = "vaulting";
        reason = "server vault animation";
      } else if (brain.postTraversalTarget && (game.time || 0) <= (brain.postTraversalUntil || 0)) {
        mode = "post-vault move";
        reason = "moving away from used window/pallet";
      } else if (brain.survivalTask) {
        task = brain.survivalTask;
        targetId = task.id || null;
        mode = actor.chaseHold > 0 ? "chase escape" : "danger escape";
        reason = task.kind || "safe task";
      } else if (brain.unhookTask) {
        task = brain.unhookTask;
        targetId = task.id || null;
        mode = "unhook";
        reason = "rescue teammate";
      } else if (brain.healTask) {
        task = brain.healTask;
        targetId = task.id || null;
        mode = "heal";
        reason = "heal teammate";
      } else if (brain.nextStep?.kind === "receive-heal") {
        mode = "receive heal";
        targetId = brain.nextStep.targetId || null;
        reason = "waiting for nearby healer";
      } else if (brain.task) {
        task = brain.task;
        targetId = task.id || null;
        mode = task.kind === "deposit" ? "deposit" : task.kind === "orb" ? "collect orb" : task.kind || "objective";
        reason = task.reason || (task.nextKind ? `next:${task.nextKind}` : "objective");
      }
    } else if (actor.role === "killer") {
      if (actor.hookActionTargetId || voidBrain.hookCommitTargetId) {
        mode = "hook/execute";
        targetId = actor.hookActionTargetId || voidBrain.hookCommitTargetId || null;
        reason = "holding interaction";
      } else if (actor.vault) {
        mode = "vaulting";
        reason = "window traversal";
      } else if (actor.breakTarget) {
        mode = "breaking pallet";
        targetId = actor.breakTarget?.id || null;
        reason = "obstacle clear";
      } else if (voidBrain.lungeCommitTargetId && (game.time || 0) <= (voidBrain.lungeCommitUntil || 0)) {
        mode = "lunge commit";
        targetId = voidBrain.lungeCommitTargetId;
        reason = "holding M1";
      } else if (voidBrain.huntTargetId) {
        mode = "hunt";
        targetId = voidBrain.huntTargetId;
        reason = voidBrain.nextStep?.kind || "chasing runner";
      } else if (voidBrain.task) {
        task = voidBrain.task;
        targetId = task.id || null;
        mode = task.kind === "kick" ? "kick rift" : task.kind === "check" ? "check rift" : task.kind || "rift control";
        reason = voidBrain.nextStep?.kind || "objective pressure";
      }
    }

    const nextStep = brain.nextStep || null;
    const pathLength = Array.isArray(brain.path) ? brain.path.length : 0;
    const debug = {
      mode,
      reason,
      targetId: targetId || nextStep?.targetId || null,
      taskKind: task?.kind || null,
      nextKind: nextStep?.kind || null,
      nextTargetId: nextStep?.targetId || null,
      pathLength,
      repathIn: Number(Math.max(0, brain.repathIn || 0).toFixed(2)),
      stuckFor: Number(Math.max(0, brain.stuckFor || 0).toFixed(2)),
      move: movement,
      moving: isMoving,
      sprint: !!input.sprint,
      action: !!input.action,
      repair: !!input.repair,
      attackHeld: !!input.attackHeld,
      attackState: actor.attackState || null,
      vaulting: !!actor.vault,
      breaking: !!actor.breakTarget,
      chase: actor.role === "survivor" ? (actor.chaseHold || 0) > 0 : false,
      dots: actor.role === "survivor" ? clamp(actor.dots || 0, 0, SURVIVOR_DOT_MAX) : clamp(actor.dots || 0, 0, KILLER_DOT_MAX)
    };

    if (runnerBrain?.survivalTask) {
      debug.survivalKind = runnerBrain.survivalTask.kind || null;
      debug.survivalLock = Number(Math.max(0, (runnerBrain.survivalTask.lockUntil || 0) - (game.time || 0)).toFixed(2));
    }
    if (runnerBrain?.moveIntent) {
      debug.moveIntent = {
        x: Math.round(runnerBrain.moveIntent.x || 0),
        y: Math.round(runnerBrain.moveIntent.y || 0),
        ttl: Number(Math.max(0, (runnerBrain.moveIntent.until || 0) - (game.time || 0)).toFixed(2))
      };
    }
    if (voidBrain?.obstacleCommit) {
      debug.obstacleCommit = {
        type: voidBrain.obstacleCommit.type || null,
        targetId: voidBrain.obstacleCommit.id || null,
        ttl: Number(Math.max(0, (voidBrain.obstacleCommit.until || 0) - (game.time || 0)).toFixed(2))
      };
    }

    return debug;
  }

  function serializeBotDebug(debug) {
    if (!debug || typeof debug !== "object") return null;
    const cleanText = (value, fallback = "") => String(value ?? fallback).slice(0, 96);
    const cleanNumber = (value, fallback = 0) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    };
    const cleanBool = (value) => value === true;
    const moveIntent = debug.moveIntent && typeof debug.moveIntent === "object" ? {
      x: Math.round(cleanNumber(debug.moveIntent.x)),
      y: Math.round(cleanNumber(debug.moveIntent.y)),
      ttl: Number(cleanNumber(debug.moveIntent.ttl).toFixed(2))
    } : null;
    const obstacleCommit = debug.obstacleCommit && typeof debug.obstacleCommit === "object" ? {
      type: debug.obstacleCommit.type ? cleanText(debug.obstacleCommit.type) : null,
      targetId: debug.obstacleCommit.targetId ? cleanText(debug.obstacleCommit.targetId) : null
    } : null;
    return {
      mode: cleanText(debug.mode, "bot"),
      task: cleanText(debug.task, "none"),
      taskKind: debug.taskKind ? cleanText(debug.taskKind) : null,
      reason: debug.reason ? cleanText(debug.reason) : null,
      path: Math.max(0, Math.floor(cleanNumber(debug.path))),
      pathLength: Math.max(0, Math.floor(cleanNumber(debug.pathLength ?? debug.path))),
      stuck: Number(cleanNumber(debug.stuck).toFixed(2)),
      stuckFor: Number(cleanNumber(debug.stuckFor ?? debug.stuck).toFixed(2)),
      repathIn: Number(cleanNumber(debug.repathIn).toFixed(2)),
      moveLock: Number(cleanNumber(debug.moveLock).toFixed(2)),
      input: cleanText(debug.input, "idle"),
      move: cleanText(debug.move, "idle"),
      sprint: cleanBool(debug.sprint),
      action: cleanBool(debug.action),
      repair: cleanBool(debug.repair),
      attackHeld: cleanBool(debug.attackHeld),
      attackReleased: cleanBool(debug.attackReleased),
      targetId: debug.targetId ? cleanText(debug.targetId) : null,
      nextTargetId: debug.nextTargetId ? cleanText(debug.nextTargetId) : null,
      nextKind: debug.nextKind ? cleanText(debug.nextKind) : null,
      survivalKind: debug.survivalKind ? cleanText(debug.survivalKind) : null,
      survivalLock: Number(cleanNumber(debug.survivalLock).toFixed(2)),
      moveIntent,
      obstacleCommit,
      x: Math.round(cleanNumber(debug.x)),
      y: Math.round(cleanNumber(debug.y)),
      line1: cleanText(debug.line1, cleanText(debug.mode, "bot")),
      line2: cleanText(debug.line2, ""),
      line3: cleanText(debug.line3, "")
    };
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
      isBot: !!actor.isBot,
      aiDebug: actor.isBot ? serializeBotDebug(actor.bot?.aiDebug) : null,
      skin: actorSkin,
      visible: !!visible,
      x: Number(actor.x.toFixed(2)),
      y: Number(actor.y.toFixed(2)),
      angle: actor.angle,
      moving: !!(actor.vault || actorHasMoveInput(actor)),
      sprinting: actor.role === "survivor" && !!actor.input?.sprint && !!actorHasMoveInput(actor),
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
      hourglass: actor.role === "survivor" ? actor.hourglass || 0 : 0,
      speedBurst: actor.role === "survivor" ? actor.speedBurst || 0 : 0,
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
      aiDebug: serializeBotAiDebug(game, actor),
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
    if (viewer.role === "spectatorOverview") return true;
    if (viewer.role === "survivor") return survivorCanSeePoint(game, viewer, dot.x, dot.y, { allowCloseReveal: false });
    const length = KILLER_CONE_LENGTH;
    const angle = KILLER_CONE_ANGLE;
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
    const spectatorOverview = isSpectatorOverviewViewer(viewer);
    const pov = getViewerForVisibility(game, viewer);
    const map = game.map;
    const actors = [];
    for (const actor of game.actors.values()) {
      if (actor.role === "spectator") continue;
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

    const musicViewer = viewer?.role === "spectator"
      ? pov
      : (viewer?.role === "survivor" && (viewer.dead || viewer.escaped)) ? pov : viewer;
    if (musicViewer && musicViewer.role === "survivor" && killer && isLivingSurvivor(musicViewer)) {
      const d = dist(musicViewer.x, musicViewer.y, killer.x, killer.y);
      const terror = clamp(1 - d / TERROR_RADIUS, 0, 1);
      const chase = musicViewer.chaseHold > 0;
      const killerVisible = isActorVisibleToViewer(game, musicViewer, killer);

      // Clean three-layer music ladder:
      // layer_1 = normal ambient when the survivor is safe / no meaningful terror pressure.
      // layer_2 = warning pressure before a full chase, with a wider radius than the UI terror pulse.
      // layer_3 = survivor is in chase, regardless of whether the killer is currently on-screen.
      const layer2Radius = Math.max(MUSIC_LAYER_2_RADIUS, MUSIC_LAYER_2_FULL_RADIUS + 1);
      const layer2Range = Math.max(1, layer2Radius - MUSIC_LAYER_2_FULL_RADIUS);
      const layer2DistanceBlend = clamp((layer2Radius - d) / layer2Range, 0, 1);
      const layer2Ramp = Math.pow(smoothstep(layer2DistanceBlend), Math.max(0.35, MUSIC_LAYER_2_CURVE));
      const layer2Audible = d < layer2Radius;
      const layer2NoChase = layer2Audible
        ? MUSIC_LAYER_2_MIN_VOLUME + (MUSIC_LAYER_2_MAX_VOLUME - MUSIC_LAYER_2_MIN_VOLUME) * layer2Ramp
        : 0;
      const layer2ChaseBed = chase && layer2Audible
        ? MUSIC_LAYER_2_CHASE_BED_VOLUME * clamp(0.35 + layer2Ramp * 0.65, 0, 1)
        : 0;
      const layer2Target = chase ? layer2ChaseBed : layer2NoChase;
      const layer1Duck = clamp(layer2Ramp * 0.78 + (chase ? 1 : 0), 0, 1);

      music = {
        layer1: chase ? 0 : MUSIC_LAYER_1_VOLUME * clamp(1 - layer1Duck, 0.16, 1),
        layer2: layer2Target,
        layer3: chase ? MUSIC_LAYER_3_VOLUME : 0,
        chase,
        terror,
        musicPressure: layer2Ramp,
        distance: d,
        killerVisible,
        visibleHold: chase
      };
    } else if (musicViewer && musicViewer.role === "killer" && killer) {
      const chasedSurvivors = [...game.actors.values()].filter((actor) => actor.role === "survivor" && isLivingSurvivor(actor) && (actor.chaseHold || 0) > 0);
      if (chasedSurvivors.length) {
        const nearestChaseDistance = Math.min(...chasedSurvivors.map((actor) => dist(killer.x, killer.y, actor.x, actor.y)));
        music = {
          layer1: 0,
          layer2: MUSIC_LAYER_2_CHASE_BED_VOLUME,
          layer3: MUSIC_LAYER_3_VOLUME,
          chase: true,
          terror: 1,
          musicPressure: 1,
          distance: nearestChaseDistance,
          killerVisible: true,
          visibleHold: true
        };
      }
    }

    const visibleScratchMarks = spectatorOverview
      ? game.scratchMarks
      : pov?.role === "killer"
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
      serverTime: Number((game.time || 0).toFixed(3)),
      matchStartFreezeRemaining: Math.max(0, (game.matchStartFreezeSeconds || MATCH_START_FREEZE_SECONDS) - (game.time || 0)),
      map: {
        width: map.width,
        height: map.height,
        tile: map.tile,
        pallets: map.pallets.map((p) => ({ id: p.id, x: p.x, y: p.y, w: p.w, h: p.h, orientation: p.orientation, state: p.state, broken: p.broken })),
        generators: visibleGeneratorsForSnapshot(game, spectatorOverview).map((g) => serializeGeneratorForViewer(game, pov, g)),
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
      viewer: viewer ? {
        id: socketId,
        role: viewer.role,
        spectating: viewer.role === "spectator" || (viewer.role === "survivor" && (!!viewer.dead || !!viewer.escaped)),
        spectateTargetId: spectatorOverview ? SPECTATE_OVERVIEW_ID : (getSpectateTarget(game, viewer)?.id || null),
        canPlay: viewer.role !== "spectator" && !viewer.dead && !viewer.escaped
      } : { id: socketId, role: null, spectating: false, spectateTargetId: null, canPlay: false },
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
        escapeOpen: game.escapeOpen,
        voidBuffed: !!(game.riftEndgameActive || riftsComplete),
        voidSpeedMultiplier: (game.riftEndgameActive || riftsComplete) ? KILLER_ENDGAME_SPEED_MULT : 1
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

  const GAME_TICK_DT = 1 / TICK_RATE;
  const GAME_TICK_MS = 1000 / TICK_RATE;
  let lastGameTickAt = performance.now();
  let gameTickAccumulator = 0;

  function runGameTickFrame() {
    const frameStarted = performance.now();
    const now = frameStarted;
    let elapsed = (now - lastGameTickAt) / 1000;
    lastGameTickAt = now;

    // If the process was paused by deploy/sleep/debugger, do not simulate a whole
    // vacation in one frame. If it merely hiccuped, catch up a few fixed ticks so
    // movement does not slow down for everyone.
    elapsed = clamp(elapsed, 0, 0.12);
    gameTickAccumulator += elapsed;

    let steps = 0;
    const maxSteps = 4;
    while (gameTickAccumulator >= GAME_TICK_DT && steps < maxSteps) {
      for (const lobby of lobbies.values()) updateGame(lobby, GAME_TICK_DT);
      gameTickAccumulator -= GAME_TICK_DT;
      steps++;
    }

    if (steps >= maxSteps && gameTickAccumulator > GAME_TICK_DT * 2) {
      gameTickAccumulator = GAME_TICK_DT;
    }

    recordTickDuration(performance.now() - frameStarted);
  }

  setInterval(runGameTickFrame, GAME_TICK_MS);
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

    socket.on("spectateLobby", ({ lobbyId, playerName } = {}) => {
      if (!allowSocketEvent(socket, "lobby")) return;
      const lobby = lobbies.get(String(lobbyId || ""));
      if (!lobby) {
        socket.emit("toast", { type: "error", message: "Lobby not found." });
        return;
      }
      joinSpectatorLobby(socket, lobby, playerName);
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

      const nextRole = role === "spectator" ? "spectator" : role === "killer" ? "killer" : "survivor";

      if (player.role === "spectator" && nextRole !== "spectator") {
        socket.emit("toast", { type: "info", message: "Spectators cannot switch into a playable role from this lobby." });
        return;
      }

      if (!canChangeRole(lobby, player, nextRole)) {
        socket.emit("toast", { type: "error", message: nextRole === "killer" ? "Could not select The Void." : nextRole === "spectator" ? "Could not join as spectator." : "Runner slots are full." });
        return;
      }

      player.role = nextRole;
      // If the player picked a survivor skin before switching back from killer,
      // preserve that choice instead of silently resetting them to blue square.
      player.skin = nextRole === "survivor" ? sanitizeSkin(skin || player.skin) : nextRole === "killer" ? "killerCircle" : "spectatorEye";
      player.ready = nextRole === "spectator";
      if (nextRole === "spectator") {
        socket.emit("toast", { type: "info", message: "Joined as Spectator. You will load into the run watching only." });
      }
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
      if (player.role === "spectator") {
        player.ready = true;
        socket.emit("toast", { type: "info", message: "Spectators are always ready and do not affect match start." });
        broadcastLobbyState(lobby);
        return;
      }
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
      if (!viewer || (viewer.role !== "spectator" && !(viewer.role === "survivor" && (viewer.dead || viewer.escaped)))) return;
      const targetId = String(payload.targetId || "");
      if (viewer.role === "spectator" && isSpectateOverviewId(targetId)) {
        viewer.spectateTargetId = SPECTATE_OVERVIEW_ID;
        viewer.x = lobby.game.map?.width ? lobby.game.map.width / 2 : viewer.x;
        viewer.y = lobby.game.map?.height ? lobby.game.map.height / 2 : viewer.y;
        viewer.angle = 0;
        return;
      }
      const target = lobby.game.actors.get(targetId);
      if (!isSpectatableActorForViewer(viewer, target)) return;
      viewer.spectateTargetId = targetId;
      viewer.x = target.x;
      viewer.y = target.y;
      viewer.angle = target.angle || 0;
    });

    socket.on("input", (input = {}) => {
      if (!allowSocketEvent(socket, "input")) return;
      serverMetrics.inputsReceived += 1;
      const lobby = lobbies.get(socketToLobby.get(socket.id));
      if (!lobby || !lobby.game) return;
      const actor = lobby.game.actors.get(socket.id);
      if (!actor || actor.role === "spectator") return;
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
        for (const p of lobby.players.values()) p.ready = p.role === "spectator" || p.isBot;
        broadcastLobbyState(lobby);
        broadcastLobbyList();
      }
    });

    socket.on("disconnect", () => leaveCurrentLobby(socket));
  });


  await setupFrontend({
    app,
    express,
    fs,
    rootDir: ROOT_DIR,
    distDir: DIST_DIR,
    isProduction: IS_PRODUCTION
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, HOST, () => {
      server.off("error", reject);
      console.log(`riftrunner running on ${HOST}:${PORT}`);
      resolve();
    });
  });

  return { app, server, io, lobbies };
}

module.exports = { startRiftRunnerServer };

const path = require("path");
const fs = require("fs");
const express = require("express");
const http = require("http");
const { monitorEventLoopDelay } = require("perf_hooks");
const { Server } = require("socket.io");
const { loadPublicScriptGlobal } = require("../config/load-public-script.cjs");
const { cfgNumber, parseCsv, normalizeOrigin, readAppVersion } = require("../config/server-runtime.cjs");
const { mountStaticAssetRoutes, setupFrontend } = require("../http/frontend.cjs");
const { createBotDebugTools } = require("./bot-debug.cjs");
const { registerSocketHandlers } = require("../net/socket-handlers.cjs");
const { startGameLoops } = require("./tick-loop.cjs");
const accountService = require("../auth/account-service.cjs");
const { createAuthRoutes } = require("../auth/routes.cjs");
const { computeMatchProgression } = require("../progression/leveling.cjs");

async function startRiftRunnerServer({ rootDir = path.resolve(__dirname, "..") } = {}) {
  const ROOT_DIR = rootDir;
  const botAi = require(path.join(ROOT_DIR, "ai/server-bot-ai.cjs"));
  const { analyzeMap, formatAnalysisSummary } = require(path.join(ROOT_DIR, "ai/nav/map-analysis.cjs"));
  const GAME_MAPS = loadPublicScriptGlobal(ROOT_DIR, "public/maps.js", "GAME_MAPS");
  const GAMEPLAY_CONFIG = loadPublicScriptGlobal(ROOT_DIR, "public/gameplayConfig.js", "GAMEPLAY_CONFIG");
  const RIFTRUNNER_CHATS = loadPublicScriptGlobal(ROOT_DIR, "public/chats.js", "RIFTRUNNER_CHATS");
  const RIFTRUNNER_ABILITIES = loadPublicScriptGlobal(ROOT_DIR, "public/abilities.js", "RIFTRUNNER_ABILITIES");
  const RIFTRUNNER_PERKS = loadPublicScriptGlobal(ROOT_DIR, "public/perkConfig.js", "RIFTRUNNER_PERK_CONFIG");
  const RIFTRUNNER_LEVELS = loadPublicScriptGlobal(ROOT_DIR, "public/levelConfig.js", "RIFTRUNNER_LEVEL_CONFIG");
  const RIFTRUNNER_RUNNER_CLASSES = loadPublicScriptGlobal(ROOT_DIR, "public/runnerClassConfig.js", "RIFTRUNNER_RUNNER_CLASS_CONFIG");

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
  app.use(express.json({ limit: "32kb" }));

  createAuthRoutes({ app, accountService });

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
      env: IS_PRODUCTION ? "production" : "development",
      accounts: accountService.authAvailable() ? "online" : "disabled"
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
    // Keep gameplay at 60Hz, but do not let config turn snapshots/bot thinking into
    // a CPU firehose. 30 snapshots + 15 bot thinks was enough to make one lobby hitch.
    snapshotRate: Math.min(
      IS_BOOSTED_HOST ? 20 : 16,
      IS_BOOSTED_HOST ? cfgNumber(GAMEPLAY_CONFIG.server?.snapshotRateBoosted, 20) : cfgNumber(GAMEPLAY_CONFIG.server?.snapshotRateStandard, 16)
    ),
    botThinkRate: Math.min(
      IS_BOOSTED_HOST ? 10 : 8,
      IS_BOOSTED_HOST ? cfgNumber(GAMEPLAY_CONFIG.server?.botThinkRateBoosted, 10) : cfgNumber(GAMEPLAY_CONFIG.server?.botThinkRateStandard, 8)
    ),
    pathfindLoopLimit: IS_BOOSTED_HOST ? cfgNumber(GAMEPLAY_CONFIG.server?.pathfindLoopLimitBoosted, 950) : cfgNumber(GAMEPLAY_CONFIG.server?.pathfindLoopLimitStandard, 700),
    pathCacheMax: IS_BOOSTED_HOST ? cfgNumber(GAMEPLAY_CONFIG.server?.pathCacheMaxBoosted, 900) : cfgNumber(GAMEPLAY_CONFIG.server?.pathCacheMaxStandard, 300),
    enablePathCache: process.env.ENABLE_PATH_CACHE !== "false",
    enableEventLoopMetrics: process.env.ENABLE_SERVER_METRICS !== "false",
    metricsIntervalMs: cfgNumber(process.env.METRICS_INTERVAL_MS, cfgNumber(GAMEPLAY_CONFIG.server?.metricsIntervalMs, 30000))
  });

  const TICK_RATE = PERF.tickRate;
  const SNAPSHOT_RATE = PERF.snapshotRate;
  const BOT_THINK_RATE = PERF.botThinkRate;
  const MATCH_START_FREEZE_SECONDS = cfgNumber(GAMEPLAY_CONFIG.match?.startFreezeSeconds, 1.5);
  const SCRATCH_MARK_MAX = cfgNumber(GAMEPLAY_CONFIG.match?.scratchMarkMax, 75);
  const SCRATCH_MARK_TTL = Math.max(0.5, cfgNumber(GAMEPLAY_CONFIG.match?.scratchMarkTtl, 6.5));
  const MAX_SURVIVORS = cfgNumber(GAMEPLAY_CONFIG.match?.maxSurvivors, 4);
  const GAME_MODE_STANDARD = "standard";
  const GAME_MODE_FFA = "ffa";
  const FFA_MAX_PLAYERS = Math.max(2, Math.floor(cfgNumber(GAMEPLAY_CONFIG.ffa?.maxPlayers, 5)));
  const FFA_KILL_LIMIT = Math.max(1, Math.floor(cfgNumber(GAMEPLAY_CONFIG.ffa?.killLimit, 10)));
  const FFA_RESPAWN_SECONDS = Math.max(0.5, cfgNumber(GAMEPLAY_CONFIG.ffa?.respawnSeconds, 3));
  const FFA_SHOT_COOLDOWN = Math.max(0.05, cfgNumber(GAMEPLAY_CONFIG.ffa?.shotCooldown, 1));
  const FFA_PROJECTILE_SPEED = Math.max(120, cfgNumber(GAMEPLAY_CONFIG.ffa?.projectileSpeed, 9000));
  const FFA_PROJECTILE_RANGE = Math.max(160, cfgNumber(GAMEPLAY_CONFIG.ffa?.projectileRange, 1150));
  const FFA_PROJECTILE_RADIUS = Math.max(8, cfgNumber(GAMEPLAY_CONFIG.ffa?.projectileRadius, 18));
  const FFA_HEAL_BOX_RESPAWN_SECONDS = Math.max(0.1, cfgNumber(GAMEPLAY_CONFIG.ffa?.healBoxRespawnSeconds, 2));
  const SURVIVOR_SKINS = new Set(["blueSquare", "yellowStar", "purplePentagon", "nebulaBloom", "eclipseWisp", "riftMoth", "signalDrone"]);
  const VOID_SKINS = new Set(["voidCore", "solarMaw", "azureRift", "bloodEclipse", "starlessWyrm", "lanternHusk", "abyssSiren", "crownedHollow", "staticNull", "riftSeraph"]);
  function sanitizeSkin(value) {
    return SURVIVOR_SKINS.has(value) ? value : "blueSquare";
  }
  function sanitizeVoidSkin(value) {
    if (value === "killerCircle") return "voidCore";
    return VOID_SKINS.has(value) ? value : "voidCore";
  }
  function sanitizeRoleSkin(role, value) {
    if (role === "killer") return sanitizeVoidSkin(value);
    if (role === "survivor" || role === "ffa") return sanitizeSkin(value);
    return "spectatorEye";
  }

  function normalizeLobbyMode(value) {
    return value === GAME_MODE_FFA || value === "freeForAll" || value === "free-for-all" ? GAME_MODE_FFA : GAME_MODE_STANDARD;
  }

  function isFfaLobby(lobby) {
    return normalizeLobbyMode(lobby?.mode) === GAME_MODE_FFA;
  }

  function isFfaGame(game) {
    return normalizeLobbyMode(game?.mode) === GAME_MODE_FFA;
  }

  function isFfaActor(actor) {
    return !!(actor && (actor.gameMode === GAME_MODE_FFA || actor.lobbyRole === GAME_MODE_FFA));
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
  const HEALING_DART_PICKUP_INVULN = Math.max(1.5, cfgNumber(GAMEPLAY_CONFIG.survivor?.healingDartPickupInvulnSeconds, 1.5));
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
  const RUNNER_CLASS_DEFS = RIFTRUNNER_RUNNER_CLASSES.classes || {};
  const RUNNER_CLASS_ABILITY_DEFS = RIFTRUNNER_RUNNER_CLASSES.abilities || {};
  const RUNNER_CLASS_DEFAULT_ID = String(RIFTRUNNER_RUNNER_CLASSES.defaultClass || "orbCollector");
  const SURVIVOR_ABILITY_DEFS = { ...(RIFTRUNNER_ABILITIES.survivorAbilities || {}), ...RUNNER_CLASS_ABILITY_DEFS };
  const SURVIVOR_ABILITY_ORDER = Array.isArray(RIFTRUNNER_ABILITIES.survivorWheelOrder) ? RIFTRUNNER_ABILITIES.survivorWheelOrder : Object.keys(SURVIVOR_ABILITY_DEFS);

  function normalizeRunnerClassId(value) {
    const raw = String(value || RUNNER_CLASS_DEFAULT_ID);
    if (RUNNER_CLASS_DEFS[raw]) return raw;
    for (const [id, def] of Object.entries(RUNNER_CLASS_DEFS)) {
      if (Array.isArray(def?.aliases) && def.aliases.includes(raw)) return id;
    }
    if (RUNNER_CLASS_DEFS[RUNNER_CLASS_DEFAULT_ID]) return RUNNER_CLASS_DEFAULT_ID;
    return Object.keys(RUNNER_CLASS_DEFS)[0] || "orbCollector";
  }

  function runnerClassDef(value) {
    return RUNNER_CLASS_DEFS[normalizeRunnerClassId(value)] || null;
  }

  function runnerClassWheelOrder(actor) {
    const classDef = runnerClassDef(actor?.runnerClass);
    const rawOrder = Array.isArray(classDef?.wheelOrder) && classDef.wheelOrder.length
      ? classDef.wheelOrder
      : SURVIVOR_ABILITY_ORDER;

    const activeIds = rawOrder
      .map((id) => String(id || ""))
      .filter((id) => {
        if (!id || id === "cancel" || id === "moreSoon") return false;
        if (id === String(classDef?.passive?.id || "")) return false;
        const ability = SURVIVOR_ABILITY_DEFS[id];
        return !(ability?.passive || ability?.disabled);
      })
      .slice(0, 3);

    return [activeIds[0] || "moreSoon", activeIds[1] || "moreSoon", "cancel", activeIds[2] || "moreSoon"];
  }

  function runnerClassGrantsAbility(actor, abilityId) {
    if (!actor || actor.role !== "survivor") return false;
    return runnerClassWheelOrder(actor).includes(String(abilityId || ""));
  }

  function classGrantedPerkLevel(actor, perkId) {
    if (!actor || actor.role !== "survivor") return 0;
    const classDef = runnerClassDef(actor.runnerClass);
    const rawLevel = classDef?.grantedPerks?.[String(perkId || "")];
    return Math.max(0, Math.floor(cfgNumber(rawLevel, 0)));
  }

  function actorRunnerLevel(actor) {
    const fallback = actor?.isBot ? cfgNumber(RIFTRUNNER_PERKS.botRunnerLevel, 1) : 1;
    return Math.max(1, Math.floor(cfgNumber(actor?.runnerLevel, fallback)));
  }

  function classLevelConfig(levels, actor) {
    const rows = Array.isArray(levels) ? levels : [];
    if (!rows.length) return null;
    const runnerLevel = actorRunnerLevel(actor);
    let best = rows[0];
    for (const row of rows) {
      const minRunnerLevel = Math.max(1, Math.floor(cfgNumber(row.minRunnerLevel, 1)));
      if (runnerLevel >= minRunnerLevel) best = row;
    }
    return best || rows[0];
  }

  function classAbilityLevelConfig(ability, actor) {
    return classLevelConfig(ability?.levels, actor) || { level: 1 };
  }

  function shortenedAbilityCooldown(value) {
    return Math.max(0, cfgNumber(value, 0));
  }

  function configuredAbilityCooldown(value, fallback = 30) {
    return shortenedAbilityCooldown(cfgNumber(value, fallback));
  }

  function isDartAbilityDef(ability, effect = null) {
    return !!(ability?.shootAbility || ability?.inputType === "m1" || ability?.projectileKind || effect?.projectileKind);
  }

  function configuredSurvivorAbilityCost(ability, effect, fallbackCost = 0) {
    if (isDartAbilityDef(ability, effect)) return 0;
    return Math.max(0, Math.floor(cfgNumber(fallbackCost, 0)));
  }

  function passivePerkIdForClass(classDef) {
    if (classDef?.passive?.id) return String(classDef.passive.id);
    const id = String(classDef?.id || "");
    if (id === "orbCollector") return "orbMagnet";
    if (id === "nebulizer") return "voidTrace";
    if (id === "escapist") return "flowState";
    if (id === "healer") return "fieldMedic";
    return "";
  }

  function runnerClassPassiveEffect(actor) {
    const classDef = runnerClassDef(actor?.runnerClass);
    const passive = classDef?.passive || {};
    const passiveId = passivePerkIdForClass(classDef);
    const passivePerk = passiveId ? perkConfigById(passiveId, "survivor") : null;
    const boughtLevel = passivePerk ? actorPerkLevel(actor, passiveId, "survivor") : 0;
    const boughtConfig = boughtLevel > 0 ? perkLevelConfig(passivePerk, boughtLevel) : null;
    const classConfig = classLevelConfig(passive.levels, actor);
    const level = boughtConfig || classConfig;
    return level ? { ...passive, ...(passivePerk || {}), ...classConfig, ...boughtConfig, id: passiveId || passive.id } : passive;
  }

  function normalizePerkRole(role) {
    const value = String(role || "").toLowerCase();
    if (value === "killer" || value === "void") return "killer";
    return "survivor";
  }

  function perkConfigById(perkId, role = null) {
    const id = String(perkId || "");
    const roleKey = role ? normalizePerkRole(role) : null;
    if (roleKey && RIFTRUNNER_PERKS.roles?.[roleKey]?.perks?.[id]) return RIFTRUNNER_PERKS.roles[roleKey].perks[id];
    for (const roleDef of Object.values(RIFTRUNNER_PERKS.roles || {})) {
      if (roleDef?.perks?.[id]) return roleDef.perks[id];
    }
    return null;
  }

  function perkLevels(perk) {
    return Array.isArray(perk?.levels) ? perk.levels : [];
  }

  function perkMaxLevel(perk) {
    const configured = Math.max(1, Math.floor(cfgNumber(perk?.maxLevel || RIFTRUNNER_PERKS.maxLevel, 4)));
    const levels = perkLevels(perk).map((level) => Math.floor(cfgNumber(level.level, 0))).filter(Boolean);
    return Math.max(1, Math.min(configured, levels.length ? Math.max(...levels) : configured));
  }

  function perkDefaultLevel(perk) {
    if (!perk) return 0;
    const rawDefault = perk.defaultLevel ?? (perk.passive || perk.alwaysUnlocked ? 1 : 0);
    const level = Math.floor(cfgNumber(rawDefault, 0));
    if (level <= 0) return 0;
    return Math.max(0, Math.min(perkMaxLevel(perk), level));
  }

  function perkEffectiveLevel(perk, storedLevel = 0) {
    const maxLevel = perkMaxLevel(perk);
    const boughtLevel = Math.max(0, Math.min(maxLevel, Math.floor(cfgNumber(storedLevel, 0))));
    return Math.max(perkDefaultLevel(perk), boughtLevel);
  }

  function perkLevelConfig(perk, level) {
    const target = Math.max(1, Math.floor(cfgNumber(level, 1)));
    return perkLevels(perk).find((row) => Math.floor(cfgNumber(row.level, 0)) === target) || null;
  }

  function normalizePerkLevelMap(perks, role = null, isBot = false) {
    const roleKey = role ? normalizePerkRole(role) : null;
    const out = { all: {}, survivor: {}, killer: {} };
    if (isBot) {
      const botLevel = Math.max(1, Math.floor(cfgNumber(RIFTRUNNER_PERKS.botLevel, RIFTRUNNER_PERKS.maxLevel || 4)));
      for (const [configuredRole, roleDef] of Object.entries(RIFTRUNNER_PERKS.roles || {})) {
        const normalizedRole = normalizePerkRole(configuredRole);
        if (roleKey && normalizedRole !== roleKey) continue;
        for (const perk of Object.values(roleDef?.perks || {})) {
          const level = Math.min(perkMaxLevel(perk), botLevel);
          out.all[perk.id] = level;
          out[normalizedRole][perk.id] = level;
        }
      }
      return out;
    }
    for (const [configuredRole, roleDef] of Object.entries(RIFTRUNNER_PERKS.roles || {})) {
      const normalizedRole = normalizePerkRole(configuredRole);
      if (roleKey && normalizedRole !== roleKey) continue;
      for (const perk of Object.values(roleDef?.perks || {})) {
        const defaultLevel = perkDefaultLevel(perk);
        if (defaultLevel <= 0) continue;
        out.all[perk.id] = Math.max(out.all[perk.id] || 0, defaultLevel);
        out[normalizedRole][perk.id] = Math.max(out[normalizedRole][perk.id] || 0, defaultLevel);
      }
    }
    const sources = [perks?.all, perks?.survivor, perks?.runner, perks?.killer, perks?.void, perks].filter(Boolean);
    for (const source of sources) {
      for (const [id, rawLevel] of Object.entries(source || {})) {
        const perk = perkConfigById(id);
        if (!perk) continue;
        const normalizedRole = normalizePerkRole(perk.role);
        if (roleKey && normalizedRole !== roleKey) continue;
        const level = perkEffectiveLevel(perk, rawLevel);
        if (level <= 0) continue;
        out.all[perk.id] = Math.max(out.all[perk.id] || 0, level);
        out[normalizedRole][perk.id] = Math.max(out[normalizedRole][perk.id] || 0, level);
      }
    }
    return out;
  }

  function actorPerkLevel(actor, perkId, role = null) {
    const id = String(perkId || "");
    if (!id || !actor) return 0;
    const roleKey = normalizePerkRole(role || actor.role);
    const debugLevel = abilityTestingLevel(actor);
    const debugPerk = debugLevel > 0 ? perkConfigById(id, roleKey) : null;
    if (debugPerk) return Math.max(1, Math.min(perkMaxLevel(debugPerk), debugLevel));

    const perks = actor.perkLevels || normalizePerkLevelMap(null, roleKey, !!actor.isBot);
    const sources = [
      perks[roleKey],
      roleKey === "killer" ? perks.void : perks.runner,
      perks.all,
      perks
    ].filter(Boolean);
    const perk = perkConfigById(id, roleKey);
    let best = Math.max(perkDefaultLevel(perk), roleKey === "survivor" ? classGrantedPerkLevel(actor, id) : 0);
    for (const source of sources) {
      const level = Math.floor(cfgNumber(source?.[id], 0));
      if (level > best) best = level;
    }
    return best;
  }

  function actorPerkEffect(actor, perkId, role = null) {
    const roleKey = normalizePerkRole(role || actor?.role);
    const perk = perkConfigById(perkId, roleKey);
    const level = actorPerkLevel(actor, perkId, roleKey);
    if (!perk || level <= 0) return null;
    return perkLevelConfig(perk, level) || null;
  }

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
  const DART_DEFAULT_SPEED_MULT = cfgNumber(
    GAMEPLAY_CONFIG.survivorAbilities?.dartBoostSpeedMultiplier,
    1.10
  );
  const DASH_DART_MAX_SPEED_MULT = Math.max(1, cfgNumber(
    GAMEPLAY_CONFIG.survivorAbilities?.dashDartMaxSpeedMultiplier,
    1.35
  ));
  const DART_DEFAULT_DURATION = cfgNumber(
    GAMEPLAY_CONFIG.survivorAbilities?.dartBoostDuration,
    1.25
  );
  const DART_DEFAULT_RADIUS = cfgNumber(
    GAMEPLAY_CONFIG.survivorAbilities?.dartRadius,
    112
  );
  const DART_DEFAULT_PROJECTILE_SPEED = cfgNumber(
    GAMEPLAY_CONFIG.survivorAbilities?.dartProjectileSpeed,
    1040
  );
  const DART_DEFAULT_RANGE = cfgNumber(
    GAMEPLAY_CONFIG.survivorAbilities?.dartRange,
    620
  );
  const VOID_SPEED_BUFF_MULT = cfgNumber(GAMEPLAY_CONFIG.voidAbilities?.speedBuffMultiplier, 1.28);
  const RED_ORB_SLOW_MULT = cfgNumber(GAMEPLAY_CONFIG.voidAbilities?.redOrbSlowMultiplier, 0.55);
  const GRAVITY_WELL_SLOW_MULT = cfgNumber(GAMEPLAY_CONFIG.voidAbilities?.gravityWellSlowMultiplier, 0.58);
  const RED_ORB_SLOW_SECONDS = cfgNumber(GAMEPLAY_CONFIG.voidAbilities?.redOrbSlowSeconds, 0.5);
  const VOID_SWIRL_DEFAULT_RADIUS = cfgNumber(GAMEPLAY_CONFIG.survivorAbilities?.voidSwirlRadius, 86);
  const VOID_SWIRL_DEFAULT_DURATION = cfgNumber(GAMEPLAY_CONFIG.survivorAbilities?.voidSwirlDuration, 6);
  const VOID_SWIRL_DEFAULT_SLOW_MULT = cfgNumber(GAMEPLAY_CONFIG.survivorAbilities?.voidSwirlSlowMultiplier, 0.65);
  const VOID_SWIRL_DEFAULT_SLOW_SECONDS = cfgNumber(GAMEPLAY_CONFIG.survivorAbilities?.voidSwirlSlowSeconds, 1.75);
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
  const DART_AMMO_MAX = Math.max(1, Math.floor(cfgNumber(GAMEPLAY_CONFIG.dartBoxes?.maxAmmo, 3)));
  const DART_COLLECTOR_AMMO_MAX = Math.max(DART_AMMO_MAX, Math.floor(cfgNumber(GAMEPLAY_CONFIG.dartBoxes?.collectorMaxAmmo, 15)));
  const DART_FIRE_LOCKOUT_SECONDS = Math.max(0.05, cfgNumber(GAMEPLAY_CONFIG.dartBoxes?.fireLockoutSeconds, 0.5));
  const DART_BOX_COLLECT_SECONDS = Math.max(0.25, cfgNumber(GAMEPLAY_CONFIG.dartBoxes?.collectSeconds, 2));
  const DART_BOX_INTERACT_RADIUS = Math.max(32, cfgNumber(GAMEPLAY_CONFIG.dartBoxes?.interactRadius, 74));
  const DART_BOX_AOE_RADIUS = Math.max(80, cfgNumber(GAMEPLAY_CONFIG.dartBoxes?.aoeRadius, 220));
  const DART_BOX_MOVING_COLLECT_MULT = clamp(cfgNumber(GAMEPLAY_CONFIG.dartBoxes?.movingCollectMultiplier, 0.44), 0.1, 1);
  const DART_BOX_MIN_TILE_SPACING = Math.max(1, cfgNumber(GAMEPLAY_CONFIG.dartBoxes?.minTileSpacing, 5.0));
  const DART_BOX_INITIAL_MIN = Math.max(1, Math.floor(cfgNumber(GAMEPLAY_CONFIG.dartBoxes?.spawnMin, 3)));
  const DART_BOX_MAX_ON_MAP = Math.max(1, Math.floor(cfgNumber(GAMEPLAY_CONFIG.dartBoxes?.maxOnMap, 5)));
  const DART_BOX_SPAWN_FLOOR_RATIO = Math.max(0.0005, cfgNumber(GAMEPLAY_CONFIG.dartBoxes?.spawnFloorRatio, 0.0052));
  const DART_BOX_RESPAWN_SECONDS = Math.max(5, cfgNumber(GAMEPLAY_CONFIG.dartBoxes?.respawnSeconds, 24));
  const TERROR_RADIUS = cfgNumber(GAMEPLAY_CONFIG.chase?.terrorRadius, 760);
  const CHASE_START_RADIUS = cfgNumber(GAMEPLAY_CONFIG.chase?.startRadius, 520);
  const CHASE_HOLD_SECONDS = cfgNumber(GAMEPLAY_CONFIG.chase?.holdSeconds, 3);
  const CLOSE_REVEAL_RADIUS = cfgNumber(GAMEPLAY_CONFIG.chase?.closeRevealRadius, 120);
  const SURVIVOR_KILLER_CLOSE_REVEAL_RADIUS = cfgNumber(GAMEPLAY_CONFIG.chase?.survivorKillerCloseRevealRadius, CLOSE_REVEAL_RADIUS * 1.55);
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

  const NO_DART_AMMO_CHAT_MESSAGES = CHAT_AUTOMATIC.noDartAmmo || [
    "No ammo?!",
    "I'm out of bolts...",
    "Empty. Obviously.",
    "I brought vibes, not bolts.",
    "Click harder? Nope.",
    "Bolt budget: zero.",
    "Great. Space reload, please.",
    "Nothing in the chamber.",
    "I need a Dart Box.",
    "My bolts have left me."
  ];
  const NO_DART_AMMO_CHAT_COOLDOWN = 3;

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

  function randomNoDartAmmoLine() {
    return randomFrom(NO_DART_AMMO_CHAT_MESSAGES);
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


  function abilityTestingLevel(actor) {
    const rawLevel = actor?.abilityTestLevel ?? (actor?.abilityTestMode ? 1 : 0);
    return Math.max(0, Math.min(3, Math.floor(cfgNumber(rawLevel, 0))));
  }

  function abilityTestingEnabled(actor) {
    return abilityTestingLevel(actor) > 0;
  }

  function applyAbilityTestingOverride(def, actor) {
    const testLevel = abilityTestingLevel(actor);
    if (!def || testLevel <= 0) return def;
    return {
      ...def,
      cost: 0,
      cooldown: 0,
      locked: false,
      testMode: true,
      testLevel
    };
  }

  function resetActorAbilityCooldowns(actor) {
    if (!actor) return;
    actor.voidAbilityCooldowns = {};
    actor.survivorAbilityCooldowns = {};
    if (actor.role === "survivor") {
      actor.runnerDartMaxAmmo = runnerDartMaxAmmo(actor);
      actor.runnerDartAmmo = actor.runnerDartMaxAmmo;
      actor.runnerDartReloadTimer = 0;
      actor.runnerDartFireLockout = 0;
    }
  }

  function getVoidAbilityDef(id, actor = null) {
    const key = String(id || "");
    const ability = VOID_ABILITY_DEFS[key];
    if (!ability || ability.cancel || !VOID_ABILITY_ORDER.includes(key)) return null;
    const abilityId = ability.id || key;
    const perk = perkConfigById(abilityId, "killer");
    const level = actor ? actorPerkLevel(actor, abilityId, "killer") : 0;
    const effect = level > 0 ? perkLevelConfig(perk, level) : null;
    return applyAbilityTestingOverride({
      id: abilityId,
      name: ability.name || key,
      cost: configuredSurvivorAbilityCost(ability, effect, perk?.abilityCost ?? ability.cost),
      duration: Math.max(0, cfgNumber(effect?.duration ?? ability.duration, 0)),
      radius: Math.max(0, cfgNumber(effect?.radius ?? ability.radius, 0)),
      stealPerRunner: Math.max(0, Math.floor(cfgNumber(effect?.stealPerRunner ?? ability.stealPerRunner, 1))),
      stealPercent: clamp(cfgNumber(effect?.stealPercent ?? ability.stealPercent, 0), 0, 1),
      cooldown: configuredAbilityCooldown(perk?.cooldown ?? ability.cooldown, 20),
      level,
      maxLevel: perkMaxLevel(perk || {}),
      effect,
      locked: level <= 0
    }, actor);
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

    const ability = getVoidAbilityDef(abilityId, actor);
    if (!ability) return { ok: false, message: "Unknown Void ability." };
    if (ability.locked) return { ok: false, message: `Unlock ${ability.name} in Perks first.` };
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
      game.redOrbSlowMultiplier = cfgNumber(ability.effect?.slowMultiplier, RED_ORB_SLOW_MULT);
      game.redOrbSlowSeconds = cfgNumber(ability.effect?.slowSeconds, RED_ORB_SLOW_SECONDS);
    } else if (ability.id === "voidReveal") {
      game.runnerReveal = Math.max(game.runnerReveal || 0, ability.duration || 5);
      affected = [...game.actors.values()].filter((runner) => runner.role === "survivor" && !runner.dead && !runner.escaped).length;
    } else {
      return { ok: false, message: "That Void ability is not ready." };
    }

    actor.dots = clamp(currentOrbs - ability.cost + stolen, 0, KILLER_DOT_MAX);
    cooldowns[ability.id] = Math.max(0, cfgNumber(ability.cooldown, 20));
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


  function getSurvivorAbilityDef(id, actor = null) {
    const key = String(id || "");
    const ability = SURVIVOR_ABILITY_DEFS[key];
    if (!ability || ability.cancel || ability.disabled) return null;
    const abilityId = ability.id || key;
    const order = actor ? runnerClassWheelOrder(actor) : SURVIVOR_ABILITY_ORDER;
    if (!order.includes(key) && !order.includes(abilityId)) return null;

    if (ability.classAbility) {
      if (!runnerClassGrantsAbility(actor, abilityId)) return null;
      const perk = perkConfigById(abilityId, "survivor");
      const fallbackEffect = classAbilityLevelConfig(ability, actor);
      const fallbackLevel = Math.max(1, Math.floor(cfgNumber(fallbackEffect?.level, 1)));
      const levels = Array.isArray(ability.levels) ? ability.levels : [];
      const maxLevel = perk ? perkMaxLevel(perk) : Math.max(1, levels.length || 1);
      const perkLevel = perk ? actorPerkLevel(actor, abilityId, "survivor") : 0;
      const testLevel = abilityTestingLevel(actor);
      const forcedLevel = testLevel > 0 ? Math.min(maxLevel, testLevel) : 0;
      const level = forcedLevel || Math.max(1, Math.min(maxLevel, Math.floor(cfgNumber(perkLevel || fallbackLevel, 1))));
      const effect = perk
        ? (perkLevelConfig(perk, level) || fallbackEffect || perkLevelConfig(perk, 1))
        : fallbackEffect;
      return applyAbilityTestingOverride({
        id: abilityId,
        name: ability.name || key,
        cost: configuredSurvivorAbilityCost(ability, effect, effect?.cost ?? perk?.abilityCost ?? ability.cost),
        duration: Math.max(0, cfgNumber(effect?.duration ?? effect?.boostDuration ?? ability.duration, 0)),
        radius: Math.max(0, cfgNumber(effect?.radius ?? ability.radius, 0)),
        projectileSpeed: Math.max(0, cfgNumber(effect?.projectileSpeed ?? ability.projectileSpeed, 0)),
        range: Math.max(0, cfgNumber(effect?.range ?? ability.range, 0)),
        speedMultiplier: Math.max(0, cfgNumber(effect?.speedMultiplier ?? ability.speedMultiplier, 0)),
        boostDuration: Math.max(0, cfgNumber(effect?.boostDuration ?? effect?.duration ?? ability.boostDuration ?? ability.duration, 0)),
        aimWindow: Math.max(0, cfgNumber(effect?.aimWindow ?? ability.aimWindow, 0)),
        projectileKind: ability.projectileKind || effect?.projectileKind ? String(effect?.projectileKind || ability.projectileKind) : "",
        hidesScratchMarks: !!(effect?.hidesScratchMarks ?? ability.hidesScratchMarks),
        scratchHideDuration: Math.max(0, cfgNumber(effect?.scratchHideDuration ?? effect?.duration ?? ability.scratchHideDuration ?? ability.duration, 0)),
        cooldown: configuredAbilityCooldown(effect?.cooldown ?? perk?.cooldown ?? ability.cooldown, 30),
        level,
        maxLevel,
        effect,
        locked: false
      }, actor);
    }

    const perk = perkConfigById(abilityId, "survivor");
    const level = actor ? actorPerkLevel(actor, abilityId, "survivor") : 0;
    const effect = level > 0 ? perkLevelConfig(perk, level) : null;
    return applyAbilityTestingOverride({
      id: abilityId,
      name: ability.name || key,
      cost: Math.max(0, Math.floor(cfgNumber(perk?.abilityCost ?? ability.cost, 0))),
      duration: Math.max(0, cfgNumber(effect?.duration ?? ability.duration, 0)),
      radius: Math.max(0, cfgNumber(effect?.radius ?? ability.radius, 0)),
      projectileSpeed: Math.max(0, cfgNumber(effect?.projectileSpeed ?? ability.projectileSpeed, 0)),
      range: Math.max(0, cfgNumber(effect?.range ?? ability.range, 0)),
      speedMultiplier: Math.max(0, cfgNumber(effect?.speedMultiplier ?? ability.speedMultiplier, 0)),
      boostDuration: Math.max(0, cfgNumber(effect?.boostDuration ?? effect?.duration ?? ability.boostDuration ?? ability.duration, 0)),
      aimWindow: Math.max(0, cfgNumber(effect?.aimWindow ?? ability.aimWindow, 0)),
      projectileKind: ability.projectileKind || effect?.projectileKind ? String(effect?.projectileKind || ability.projectileKind) : "",
      hidesScratchMarks: !!(effect?.hidesScratchMarks ?? ability.hidesScratchMarks),
      scratchHideDuration: Math.max(0, cfgNumber(effect?.scratchHideDuration ?? effect?.duration ?? ability.scratchHideDuration ?? ability.duration, 0)),
      cooldown: configuredAbilityCooldown(perk?.cooldown ?? ability.cooldown, 30),
      level,
      maxLevel: perkMaxLevel(perk || {}),
      effect,
      locked: level <= 0
    }, actor);
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
    if (actor?.role === "survivor" && (actor.riftLens || 0) > 0) length *= cfgNumber(actorPerkEffect(actor, "riftLens", "survivor")?.lengthMultiplier, SURVIVOR_RIFT_LENS_LENGTH_MULT);
    return length;
  }

  function survivorVisionAngleFor(actor) {
    let angle = SURVIVOR_CONE_ANGLE;
    if (survivorCarefulVisionActive(actor)) angle *= SURVIVOR_SAFE_CONE_ANGLE_MULT;
    if (actor?.role === "survivor" && (actor.riftLens || 0) > 0) angle *= cfgNumber(actorPerkEffect(actor, "riftLens", "survivor")?.angleMultiplier, SURVIVOR_RIFT_LENS_ANGLE_MULT);
    return Math.min(Math.PI * 1.08, angle);
  }

  function survivorBackVisionLengthFor(actor) {
    return survivorVisionLengthFor(actor) * cfgNumber(actorPerkEffect(actor, "hourglass", "survivor")?.backLengthMultiplier, SURVIVOR_HOURGLASS_BACK_LENGTH_MULT);
  }

  function survivorBackVisionAngleFor(actor) {
    return Math.min(Math.PI * 1.08, survivorVisionAngleFor(actor) * cfgNumber(actorPerkEffect(actor, "hourglass", "survivor")?.backAngleMultiplier, SURVIVOR_HOURGLASS_BACK_ANGLE_MULT));
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
    const closeRevealRadius = actor.role === "killer" ? SURVIVOR_KILLER_CLOSE_REVEAL_RADIUS : CLOSE_REVEAL_RADIUS;
    if (allowCloseReveal && d <= closeRevealRadius) return segmentClear(game, viewer.x, viewer.y, actor.x, actor.y);
    for (const sample of survivorVisionSamplesForActor(actor)) {
      if (survivorCanSeePoint(game, viewer, sample.x, sample.y, { allowCloseReveal: false })) return true;
    }
    return false;
  }
  function activeSmokeClouds(game) {
    return Array.isArray(game?.smokeClouds) ? game.smokeClouds.filter((cloud) => cfgNumber(cloud?.remaining, 0) > 0) : [];
  }

  function smokeContainsPoint(cloud, x, y) {
    if (!cloud || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    return dist(cloud.x, cloud.y, x, y) <= Math.max(0, cfgNumber(cloud.radius, 0));
  }

  function viewerSharesSmokeWithPoint(game, viewer, x, y) {
    if (!viewer || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    return activeSmokeClouds(game).some((cloud) => smokeContainsPoint(cloud, viewer.x, viewer.y) && smokeContainsPoint(cloud, x, y));
  }

  function smokeBlocksViewerPoint(game, viewer, x, y) {
    if (!viewer || viewer.role === "spectatorOverview") return false;
    const viewerClouds = activeSmokeClouds(game).filter((cloud) => smokeContainsPoint(cloud, viewer.x, viewer.y));
    const pointClouds = activeSmokeClouds(game).filter((cloud) => smokeContainsPoint(cloud, x, y));

    // If the viewer is standing inside smoke, their vision is confined to that same smoke.
    // They can only see targets that are also inside at least one cloud they currently occupy.
    if (viewerClouds.length) {
      return !viewerClouds.some((cloud) => smokeContainsPoint(cloud, x, y));
    }

    // If the viewer is outside smoke, anything inside smoke stays hidden.
    if (!pointClouds.length) return false;
    return true;
  }

  function actorInsideSmokeCloud(game, actor) {
    if (!actor || !Number.isFinite(actor.x) || !Number.isFinite(actor.y)) return false;
    return activeSmokeClouds(game).some((cloud) => smokeContainsPoint(cloud, actor.x, actor.y));
  }

  function nebulizerVaporTrailEffect(actor) {
    if (!actor || actor.role !== "survivor") return null;
    const classDef = runnerClassDef(actor.runnerClass);
    if (String(classDef?.id || "") !== "nebulizer") return null;
    const effect = runnerClassPassiveEffect(actor);
    if (!["voidTrace", "vaporTrail"].includes(String(effect?.id || ""))) return null;
    const multiplier = Math.max(1, cfgNumber(effect.vaporTrailSpeedMultiplier ?? effect.speedMultiplier, 1));
    const duration = Math.max(0, cfgNumber(effect.vaporTrailDuration ?? effect.duration, 0));
    if (multiplier <= 1 || duration <= 0) return null;
    return { multiplier, duration };
  }

  function refreshNebulizerVaporTrailFromSmoke(game, actor) {
    if (!game || !actor || actor.dead || actor.escaped || actor.hooked || actor.downed) return;
    if (!actorInsideSmokeCloud(game, actor)) return;
    const effect = nebulizerVaporTrailEffect(actor);
    if (!effect) return;
    actor.nebulizerVaporTrail = Math.max(actor.nebulizerVaporTrail || 0, effect.duration);
    actor.nebulizerVaporTrailMultiplier = Math.max(1, effect.multiplier);
    actor.dartScratchHidden = Math.max(actor.dartScratchHidden || 0, effect.duration);
    if (Array.isArray(game.scratchMarks)) game.scratchMarks = game.scratchMarks.filter((mark) => mark.actorId !== actor.id);
  }

  function grantHealingDartPickupIframes(target) {
    if (!target || target.role !== "survivor") return;
    target.invuln = Math.max(cfgNumber(target.invuln, 0), HEALING_DART_PICKUP_INVULN);
    target.reviveInvuln = Math.max(cfgNumber(target.reviveInvuln, 0), HEALING_DART_PICKUP_INVULN);
  }

  function clearReviveIframes(target) {
    if (!target) return;
    target.reviveInvuln = 0;
  }

  function applyInstantHealProgress(game, healer, target, progressAmount) {
    if (!game || !healer || !target || healer.id === target.id || !isWoundedSurvivor(target)) return false;
    const amount = clamp(cfgNumber(progressAmount, 0), 0, 1);
    if (amount <= 0) return false;
    target.healProgress = clamp((target.healProgress || 0) + amount, 0, 1);
    target.activeHealers = [...new Set([...(target.activeHealers || []), healer.id])];
    target.healingTargetId = null;

    if (target.healProgress < 1) return true;

    awardStat(healer, "teammatesHealed", "Healing pulse", 1, "team");
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
    addEvent(game, "healDone", { x: target.x, y: target.y, survivorId: target.id, healerId: healer.id, source: "healingPulse" });
    return true;
  }

  function healingPulseTargets(game, healer, radius) {
    const maxDistance = Math.max(0, cfgNumber(radius, 0));
    if (!game || !healer || maxDistance <= 0) return [];
    return [...game.actors.values()]
      .filter((target) => target.id !== healer.id && isWoundedSurvivor(target))
      .filter((target) => dist(healer.x, healer.y, target.x, target.y) <= maxDistance)
      .filter((target) => segmentClear(game, healer.x, healer.y, target.x, target.y))
      .sort((a, b) => dist(healer.x, healer.y, a.x, a.y) - dist(healer.x, healer.y, b.x, b.y));
  }

  function wallImpactPoint(game, ax, ay, bx, by) {
    const walls = game?.map?.walls || [];
    if (!walls.length) return null;
    const distance = dist(ax, ay, bx, by);
    const steps = Math.max(2, Math.ceil(distance / 5));
    let lastSafe = { x: ax, y: ay };
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      if (walls.some((wall) => pointInRect(x, y, wall))) return lastSafe;
      lastSafe = { x, y };
    }
    return null;
  }

  function segmentCircleImpact(ax, ay, bx, by, cx, cy, radius) {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (!Number.isFinite(lenSq) || lenSq <= 0.0001 || !(radius > 0)) return null;

    const fx = ax - cx;
    const fy = ay - cy;
    const a = lenSq;
    const b = 2 * (fx * dx + fy * dy);
    const c = (fx * fx + fy * fy) - radius * radius;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;

    const sqrt = Math.sqrt(discriminant);
    const t1 = (-b - sqrt) / (2 * a);
    const t2 = (-b + sqrt) / (2 * a);
    const t = t1 >= 0 && t1 <= 1 ? t1 : (t2 >= 0 && t2 <= 1 ? t2 : null);
    if (t === null) return null;

    return {
      x: ax + dx * t,
      y: ay + dy * t,
      t
    };
  }


  function nearestPointOnSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (!Number.isFinite(lenSq) || lenSq <= 0.0001) return { x: ax, y: ay, t: 0, distance: dist(px, py, ax, ay) };
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1);
    const x = ax + dx * t;
    const y = ay + dy * t;
    return { x, y, t, distance: dist(px, py, x, y) };
  }

  function pointSegmentDistance(px, py, ax, ay, bx, by) {
    return nearestPointOnSegment(px, py, ax, ay, bx, by).distance;
  }


  function runnerProjectileAbilityIds(actor) {
    return runnerClassWheelOrder(actor)
      .map((id) => SURVIVOR_ABILITY_DEFS[id])
      .filter((ability) => ability && ability.shootAbility && !ability.disabled && !ability.cancel)
      .map((ability) => ability.id || ability.key);
  }

  function runnerDartMaxAmmoForClass(runnerClass) {
    return normalizeRunnerClassId(runnerClass) === "orbCollector" ? DART_COLLECTOR_AMMO_MAX : DART_AMMO_MAX;
  }

  function runnerDartMaxAmmo(actor) {
    return actor?.role === "survivor" ? runnerDartMaxAmmoForClass(actor.runnerClass) : 0;
  }

  function ensureRunnerDartAmmo(actor) {
    if (!actor || actor.role !== "survivor") return 0;
    const maxAmmo = runnerDartMaxAmmo(actor) || DART_AMMO_MAX;
    const previousMax = Math.max(1, Math.floor(cfgNumber(actor.runnerDartMaxAmmo, maxAmmo)));
    const rawAmmo = Number(actor.runnerDartAmmo);
    actor.runnerDartMaxAmmo = maxAmmo;
    if (!Number.isFinite(rawAmmo)) {
      actor.runnerDartAmmo = maxAmmo;
    } else if (previousMax !== maxAmmo && rawAmmo >= previousMax) {
      actor.runnerDartAmmo = maxAmmo;
    } else {
      actor.runnerDartAmmo = clamp(Math.floor(cfgNumber(rawAmmo, maxAmmo)), 0, maxAmmo);
    }
    actor.runnerDartReloadTimer = 0;
    actor.runnerDartFireLockout = Math.max(0, cfgNumber(actor.runnerDartFireLockout, 0));
    return actor.runnerDartAmmo;
  }

  function activeRunnerDartAbility(actor) {
    const id = runnerProjectileAbilityIds(actor)[0] || null;
    return id ? getSurvivorAbilityDef(id, actor) : null;
  }

  function runnerDartReloadSeconds(actor, ability = null) {
    const dartAbility = ability || activeRunnerDartAbility(actor);
    return Math.max(0.25, cfgNumber(dartAbility?.cooldown, 10));
  }

  function startRunnerDartReload(actor, ability = null) {
    if (!actor || actor.role !== "survivor") return;
    ensureRunnerDartAmmo(actor);
    actor.runnerDartReloadTimer = 0;
  }

  function spendRunnerDartAmmo(actor, ability = null) {
    if (!actor || actor.role !== "survivor") return;
    ensureRunnerDartAmmo(actor);
    actor.runnerDartAmmo = clamp((actor.runnerDartAmmo || 0) - 1, 0, runnerDartMaxAmmo(actor));
    actor.runnerDartReloadTimer = 0;
    actor.runnerDartFireLockout = Math.max(cfgNumber(actor.runnerDartFireLockout, 0), DART_FIRE_LOCKOUT_SECONDS);
  }

  function refillRunnerDartAmmo(actor, source = "refill") {
    if (!actor || actor.role !== "survivor") return false;
    ensureRunnerDartAmmo(actor);
    const maxAmmo = runnerDartMaxAmmo(actor);
    const before = actor.runnerDartAmmo || 0;
    actor.runnerDartAmmo = maxAmmo;
    actor.runnerDartReloadTimer = 0;
    return actor.runnerDartAmmo > before;
  }

  function updateRunnerDartAmmo(game, actor, dt) {
    if (!actor || actor.role !== "survivor") return;
    ensureRunnerDartAmmo(actor);
    actor.runnerDartReloadTimer = 0;
    if (abilityTestingEnabled(actor)) {
      actor.runnerDartAmmo = runnerDartMaxAmmo(actor);
      actor.runnerDartFireLockout = 0;
    }
  }

  function runnerProjectileImpact(game, projectile, ax, ay, bx, by) {
    if (!game || !projectile) return null;
    const ownerId = String(projectile.ownerId || "");
    const kind = String(projectile.kind || projectile.type || "");
    const canHitDowned = kind === "heal";
    const canHitHooked = kind === "heal" && !!projectile.canUnhook;
    const hitsRunners = kind === "boost" || kind === "heal" || kind === "ffaShot";
    const hitsAnyLivePlayer = kind === "smoke";
    if (!hitsRunners && !hitsAnyLivePlayer) return null;
    let best = null;

    for (const target of game.actors.values()) {
      if (!target || target.role === "spectator") continue;
      if (String(target.id || "") === ownerId) continue;
      if (hitsRunners && target.role !== "survivor") continue;
      if (target.dead || target.escaped) continue;
      if (target.hooked && !canHitHooked && kind !== "smoke") continue;
      if (kind === "ffaShot" && (target.downed || target.hooked || isFfaActor(target) === false)) continue;
      if (target.downed && !canHitDowned && kind !== "boost" && kind !== "smoke") continue;
      const targetRadius = target.role === "killer"
        ? Math.max(24, Math.min(56, KILLER_SIZE * 0.58))
        : Math.max(18, Math.min(42, PLAYER_SIZE * 0.72));
      const impact = segmentCircleImpact(ax, ay, bx, by, target.x, target.y, targetRadius);
      if (!impact) continue;
      if (!best || impact.t < best.t) best = { ...impact, survivorId: target.id, actorId: target.id, role: target.role };
    }

    return best;
  }

  function applyRunnerBoost(game, sourceId, x, y, ability, reason = "impact") {
    const radius = Math.max(0, cfgNumber(ability.radius, DART_DEFAULT_RADIUS));
    const duration = Math.max(0.1, cfgNumber(ability.boostDuration ?? ability.duration, DART_DEFAULT_DURATION));
    const rawSpeedMultiplier = Math.max(1, cfgNumber(ability.speedMultiplier, DART_DEFAULT_SPEED_MULT));
    const isDashDart = String(ability.id || ability.abilityId || ability.type || "") === "dashDart";
    const speedMultiplier = isDashDart ? Math.min(rawSpeedMultiplier, DASH_DART_MAX_SPEED_MULT) : rawSpeedMultiplier;
    const hidesScratchMarks = !!ability.hidesScratchMarks;
    const scratchHideDuration = Math.max(0, cfgNumber(ability.scratchHideDuration, duration));
    let affected = 0;
    const boostedIds = [];
    for (const target of game.actors.values()) {
      if (!target || target.role !== "survivor" || target.dead || target.escaped || target.hooked || target.downed) continue;
      if (dist(x, y, target.x, target.y) > radius) continue;
      if (!segmentClear(game, x, y, target.x, target.y)) continue;
      target.dashBoost = Math.max(target.dashBoost || 0, duration);
      target.dashBoostMultiplier = Math.max(target.dashBoostMultiplier || 1, speedMultiplier);
      if (hidesScratchMarks && scratchHideDuration > 0) {
        target.dartScratchHidden = Math.max(target.dartScratchHidden || 0, scratchHideDuration);
        if (Array.isArray(game.scratchMarks)) game.scratchMarks = game.scratchMarks.filter((mark) => mark.actorId !== target.id);
      }
      affected += 1;
      boostedIds.push(target.id);
    }
    addEvent(game, "runnerProjectileExplode", {
      x,
      y,
      actorId: sourceId,
      survivorId: sourceId,
      ownerId: sourceId,
      projectileId: ability.id || null,
      abilityId: ability.abilityId || ability.type || "dashDart",
      projectileType: "boost",
      radius,
      duration,
      speedMultiplier,
      hidesScratchMarks,
      scratchHideDuration,
      affected,
      boostedIds,
      reason
    });
  }

  function collectOrbByIndex(game, actor, dotIndex, source = "collectionBolt") {
    if (!game || !actor || actor.role !== "survivor") return 0;
    const maxDots = SURVIVOR_DOT_MAX;
    if ((actor.dots || 0) >= maxDots) return 0;
    const dot = game.collectibleDots?.[dotIndex];
    if (!dot) return 0;
    const dotsBefore = actor.dots || 0;
    actor.dots = Math.min(maxDots, dotsBefore + 1);
    if (actor.dots <= dotsBefore) return 0;
    game.collectibleDots.splice(dotIndex, 1);
    awardStat(actor, "orbsCollected", source === "collectionBoltBeam" ? "Collection Bolt beam" : source === "collectionBolt" ? "Collection Bolt" : "Orb collected", actor.dots - dotsBefore, "orb");
    queueDotRespawns(game, 1);
    addEvent(game, "dotPickup", {
      x: dot.x,
      y: dot.y,
      actorId: actor.id,
      survivorId: actor.id,
      role: actor.role,
      dotsBefore,
      dotsAfter: actor.dots,
      carriedDots: actor.dots,
      carryMax: maxDots,
      red: (game.redOrbs || 0) > 0,
      source
    });
    return 1;
  }

  function collectOrbsInRadius(game, actor, x, y, radius, source = "collectionBolt") {
    if (!game || !actor || actor.role !== "survivor") return 0;
    let collected = 0;
    for (let i = game.collectibleDots.length - 1; i >= 0; i--) {
      if ((actor.dots || 0) >= SURVIVOR_DOT_MAX) break;
      const dot = game.collectibleDots[i];
      if (!dot || dist(x, y, dot.x, dot.y) > radius) continue;
      if (!segmentClear(game, x, y, dot.x, dot.y)) continue;
      collected += collectOrbByIndex(game, actor, i, source);
    }
    return collected;
  }

  function collectOrbsAlongSegment(game, actor, ax, ay, bx, by, radius, source = "collectionBoltBeam") {
    if (!game || !actor || actor.role !== "survivor" || !(radius > 0)) return 0;
    if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return 0;
    let collected = 0;
    for (let i = game.collectibleDots.length - 1; i >= 0; i--) {
      if ((actor.dots || 0) >= SURVIVOR_DOT_MAX) break;
      const dot = game.collectibleDots[i];
      if (!dot) continue;
      const nearest = nearestPointOnSegment(dot.x, dot.y, ax, ay, bx, by);
      if (nearest.distance > radius) continue;
      // The bolt is the line segment. Only require the tiny perpendicular hop from the beam
      // to the orb to be clear, instead of demanding both segment endpoints can see the orb.
      // Endpoint LOS made valid beam pickups fail around walls/corners, because geometry is a goblin.
      if (!segmentClear(game, nearest.x, nearest.y, dot.x, dot.y)) continue;
      collected += collectOrbByIndex(game, actor, i, source);
    }
    return collected;
  }

  function applyCollectionBolt(game, projectile, x, y, reason = "impact") {
    const actor = game.actors.get(projectile.ownerId);
    const radius = Math.max(0, cfgNumber(projectile.radius, 100));
    const burstCollected = collectOrbsInRadius(game, actor, x, y, radius, "collectionBolt");
    const beamCollected = Math.max(0, Math.floor(cfgNumber(projectile.beamCollected, 0)));
    const collected = burstCollected + beamCollected;
    addEvent(game, "runnerProjectileExplode", {
      x,
      y,
      actorId: projectile.ownerId,
      survivorId: projectile.ownerId,
      ownerId: projectile.ownerId,
      projectileId: projectile.id || null,
      abilityId: projectile.abilityId || "collectionBolt",
      projectileType: "collect",
      radius,
      affected: collected,
      collected,
      burstCollected,
      beamCollected,
      reason
    });
  }

  function addSmokeCloud(game, projectile, x, y, reason = "impact") {
    const radius = Math.max(30, cfgNumber(projectile.radius, 150));
    const duration = Math.max(0.5, cfgNumber(projectile.duration, 5));
    game.smokeClouds = Array.isArray(game.smokeClouds) ? game.smokeClouds : [];
    game.smokeClouds.push({
      id: uid("smoke"),
      ownerId: projectile.ownerId,
      x,
      y,
      radius,
      duration,
      remaining: duration,
      createdAt: game.time || 0
    });
    addEvent(game, "runnerProjectileExplode", {
      x,
      y,
      actorId: projectile.ownerId,
      survivorId: projectile.ownerId,
      ownerId: projectile.ownerId,
      projectileId: projectile.id || null,
      abilityId: projectile.abilityId || "smokeDart",
      projectileType: "smoke",
      radius,
      duration,
      reason
    });
  }

  function addVoidSwirl(game, actor, ability) {
    if (!game || !actor) return null;
    const effect = ability?.effect || {};
    const radius = Math.max(28, cfgNumber(effect.radius ?? ability.radius, VOID_SWIRL_DEFAULT_RADIUS));
    const duration = Math.max(1, cfgNumber(effect.duration ?? ability.duration, VOID_SWIRL_DEFAULT_DURATION));
    const slowMultiplier = clamp(cfgNumber(effect.slowMultiplier ?? ability.slowMultiplier, VOID_SWIRL_DEFAULT_SLOW_MULT), 0.1, 1);
    const slowDuration = Math.max(0.2, cfgNumber(effect.slowDuration ?? ability.slowDuration, VOID_SWIRL_DEFAULT_SLOW_SECONDS));
    const swirl = {
      id: uid("swirl"),
      ownerId: actor.id,
      x: clamp(actor.x, radius, game.map.width - radius),
      y: clamp(actor.y, radius, game.map.height - radius),
      radius,
      duration,
      remaining: duration,
      slowMultiplier,
      slowDuration,
      createdAt: game.time || 0,
      phase: Math.random() * Math.PI * 2
    };
    game.voidSwirls = Array.isArray(game.voidSwirls) ? game.voidSwirls : [];
    game.voidSwirls.push(swirl);
    return swirl;
  }

  function updateVoidSwirls(game, dt) {
    if (!game || !Array.isArray(game.voidSwirls)) return;
    const killer = [...game.actors.values()].find((actor) => actor.role === "killer" && !actor.dead);
    for (let i = game.voidSwirls.length - 1; i >= 0; i -= 1) {
      const swirl = game.voidSwirls[i];
      swirl.remaining = Math.max(0, cfgNumber(swirl.remaining, 0) - dt);
      if (swirl.remaining <= 0) {
        game.voidSwirls.splice(i, 1);
        continue;
      }
      if (!killer || killer.hooked || killer.downed) continue;
      const triggerRadius = Math.max(0, cfgNumber(swirl.radius, VOID_SWIRL_DEFAULT_RADIUS)) + KILLER_SIZE * 0.42;
      if (dist(killer.x, killer.y, swirl.x, swirl.y) > triggerRadius) continue;
      const slowDuration = Math.max(0.2, cfgNumber(swirl.slowDuration, VOID_SWIRL_DEFAULT_SLOW_SECONDS));
      const slowMultiplier = clamp(cfgNumber(swirl.slowMultiplier, VOID_SWIRL_DEFAULT_SLOW_MULT), 0.1, 1);
      killer.voidSwirlSlow = Math.max(killer.voidSwirlSlow || 0, slowDuration);
      killer.voidSwirlSlowMultiplier = Math.min(cfgNumber(killer.voidSwirlSlowMultiplier || 1, 1), slowMultiplier);
      addEvent(game, "voidSwirlTriggered", {
        x: swirl.x,
        y: swirl.y,
        actorId: swirl.ownerId,
        ownerId: swirl.ownerId,
        killerId: killer.id,
        abilityId: "voidSwirl",
        radius: swirl.radius,
        duration: slowDuration,
        slowMultiplier,
        text: "The Void hit a Void Swirl."
      });
      game.voidSwirls.splice(i, 1);
    }
  }

  function resetDownedExecutionChannel(game, target, interruptSeconds = 0) {
    if (!game || !target || target.role !== "survivor" || !target.downed || target.hooked || target.dead || target.escaped) return false;
    const hadProgress = (target.hookProgress || 0) > 0;
    target.hookProgress = 0;
    target.healingDartExecutionBlock = Math.max(
      cfgNumber(target.healingDartExecutionBlock, 0),
      Math.max(0, cfgNumber(interruptSeconds, 0))
    );
    for (const actor of game.actors.values()) {
      if (actor?.role !== "killer") continue;
      if (actor.hookActionTargetId === target.id) {
        actor.hookActionTargetId = null;
        actor.hookActionType = null;
      }
    }
    return hadProgress || target.healingDartExecutionBlock > 0;
  }

  function survivorHasManualHealingHelp(game, target) {
    if (!game || !target || target.role !== "survivor") return false;
    if ((target.healProgress || 0) > 0.001) return true;
    if (Array.isArray(target.activeHealers) && target.activeHealers.length > 0) return true;
    for (const actor of game.actors.values()) {
      if (!actor || actor.role !== "survivor" || actor.id === target.id) continue;
      if (actor.healingTargetId === target.id) return true;
    }
    return false;
  }

  function survivorHasManualUnhookHelp(game, target) {
    if (!game || !target || target.role !== "survivor") return false;
    if ((target.unhookProgress || 0) > 0.001) return true;
    for (const actor of game.actors.values()) {
      if (!actor || actor.role !== "survivor" || actor.id === target.id) continue;
      if (actor.unhookTargetId === target.id) return true;
    }
    return false;
  }

  function stackTimedSupport(existing, next) {
    if (!existing || typeof existing !== "object") return next;
    return {
      ...next,
      remaining: Math.max(cfgNumber(existing.remaining, 0), cfgNumber(next.remaining, 0)),
      totalProgress: Math.max(cfgNumber(existing.totalProgress, 0), cfgNumber(next.totalProgress, 0)),
      progressPerSecond: Math.max(cfgNumber(existing.progressPerSecond, 0), cfgNumber(next.progressPerSecond, 0)),
      canPickupDowned: !!(existing.canPickupDowned || next.canPickupDowned)
    };
  }

  function applyHealingDart(game, projectile, x, y, reason = "impact", targetId = null) {
    const owner = game.actors.get(projectile.ownerId);
    const effect = projectile.effect || {};
    const radius = Math.max(0, cfgNumber(projectile.radius, 58));
    const duration = Math.max(0.2, cfgNumber(projectile.duration, 3));
    let affected = 0;
    let completedHeals = 0;
    let completedUnhooks = 0;
    let executionResets = 0;
    const candidates = [...game.actors.values()]
      .filter((target) => target && target.role === "survivor" && !target.dead && !target.escaped)
      .filter((target) => !targetId || target.id === targetId || dist(x, y, target.x, target.y) <= radius)
      .filter((target) => targetId ? true : dist(x, y, target.x, target.y) <= radius)
      .filter((target) => segmentClear(game, x, y, target.x, target.y));

    for (const target of candidates) {
      if (target.hooked && !projectile.canUnhook) continue;
      if (target.downed && !projectile.canPickupDowned && !isWoundedSurvivor(target)) continue;
      if (!target.hooked && !isWoundedSurvivor(target)) continue;

      if (target.hooked && projectile.canUnhook) {
        const progress = clamp(cfgNumber(projectile.unhookProgress, effect.unhookProgress || 0.8), 0, 2);
        const isAlreadyBeingUnbound = survivorHasManualUnhookHelp(game, target);
        const speedBoost = isAlreadyBeingUnbound ? 1.75 : 1;
        target.healingDartUnhook = stackTimedSupport(target.healingDartUnhook, {
          rescuerId: projectile.ownerId,
          remaining: duration,
          totalProgress: progress,
          // Do not front-load unbind progress. The dart starts or boosts the rescue over time.
          // If a Runner is already being unbound, this adds a clear rescue-speed boost instead of wasting the hit.
          progressPerSecond: Math.max(0, (progress / duration) * speedBoost),
          boostedManualAction: isAlreadyBeingUnbound
        });
        affected += 1;
        continue;
      }

      const progress = clamp(cfgNumber(projectile.healProgress, effect.healProgress || 0.55), 0, 2);
      const canPickupDowned = !!projectile.canPickupDowned;
      if (target.downed && canPickupDowned) {
        if (resetDownedExecutionChannel(game, target, 0)) executionResets += 1;
        target.downed = false;
        target.health = 1;
        target.injured = true;
        target.healProgress = 0;
        target.hookProgress = 0;
        target.healingDartHeal = null;
        target.healingDartExecutionBlock = 0;
        target.recovery = 0;
        grantHealingDartPickupIframes(target);
        target.hitBoost = Math.max(target.hitBoost || 0, SURVIVOR_HIT_BOOST * 0.55);
        if (owner?.role === "survivor") awardStat(owner, "teammatesHealed", "Healing dart pickup", 1, "team");
        addEvent(game, "healDone", { x: target.x, y: target.y, survivorId: target.id, healerId: owner?.id || null, source: "healingDartPickup" });
        completedHeals += 1;
        affected += 1;
        continue;
      }
      const isAlreadyBeingHealed = survivorHasManualHealingHelp(game, target);
      const speedBoost = isAlreadyBeingHealed ? 1.75 : 1;
      target.healingDartHeal = stackTimedSupport(target.healingDartHeal, {
        healerId: projectile.ownerId,
        remaining: duration,
        totalProgress: progress,
        progressPerSecond: Math.max(0, (progress / duration) * speedBoost),
        canPickupDowned,
        boostedManualAction: isAlreadyBeingHealed
      });
      affected += 1;
    }

    addEvent(game, "runnerProjectileExplode", {
      x,
      y,
      actorId: projectile.ownerId,
      survivorId: projectile.ownerId,
      ownerId: projectile.ownerId,
      projectileId: projectile.id || null,
      abilityId: projectile.abilityId || "healingDart",
      projectileType: "heal",
      radius,
      duration,
      affected,
      completedHeals,
      completedUnhooks,
      executionResets,
      reason
    });
  }

  function explodeRunnerProjectile(game, projectile, x, y, reason = "impact", targetId = null) {
    if (!game || !projectile) return;
    const kind = String(projectile.kind || projectile.projectileKind || projectile.type || "boost");
    if (kind === "collect") return applyCollectionBolt(game, projectile, x, y, reason);
    if (kind === "smoke") return addSmokeCloud(game, projectile, x, y, reason);
    if (kind === "heal") return applyHealingDart(game, projectile, x, y, reason, targetId);
    if (kind === "ffaShot") return applyFfaShotHit(game, projectile, x, y, reason, targetId);
    return applyRunnerBoost(game, projectile.ownerId, x, y, projectile, reason);
  }

  function updateRunnerProjectiles(game, dt) {
    const projectiles = game?.runnerProjectiles;
    if (!Array.isArray(projectiles) || !projectiles.length) return;
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const projectile = projectiles[i];
      const prevX = projectile.x;
      const prevY = projectile.y;
      const speed = Math.max(1, cfgNumber(projectile.speed, DART_DEFAULT_PROJECTILE_SPEED));
      const range = Math.max(0, cfgNumber(projectile.range, DART_DEFAULT_RANGE));
      const traveled = Math.max(0, cfgNumber(projectile.traveled, 0));
      const remainingRange = Math.max(0, range - traveled);
      if (remainingRange <= 0.001) {
        explodeRunnerProjectile(game, projectile, prevX, prevY, "target");
        projectiles.splice(i, 1);
        continue;
      }
      const step = Math.min(speed * dt, remainingRange);
      const nextX = prevX + projectile.dx * step;
      const nextY = prevY + projectile.dy * step;
      const wallImpact = wallImpactPoint(game, prevX, prevY, nextX, nextY);
      const wallImpactT = wallImpact
        ? clamp(dist(prevX, prevY, wallImpact.x, wallImpact.y) / Math.max(0.0001, dist(prevX, prevY, nextX, nextY)), 0, 1)
        : Infinity;
      const runnerImpact = runnerProjectileImpact(game, projectile, prevX, prevY, nextX, nextY);
      const runnerImpactT = runnerImpact ? clamp(runnerImpact.t, 0, 1) : Infinity;
      const impactT = Math.min(wallImpactT, runnerImpactT, 1);
      if (String(projectile.kind || projectile.type || "") === "collect") {
        const beamRadius = Math.max(0, cfgNumber(projectile.beamCollectRadius ?? projectile.effect?.beamCollectRadius, 0));
        if (beamRadius > 0) {
          const beamEndX = prevX + (nextX - prevX) * impactT;
          const beamEndY = prevY + (nextY - prevY) * impactT;
          const actor = game.actors.get(projectile.ownerId);
          const beamCollected = collectOrbsAlongSegment(game, actor, prevX, prevY, beamEndX, beamEndY, beamRadius, "collectionBoltBeam");
          if (beamCollected > 0) projectile.beamCollected = Math.max(0, cfgNumber(projectile.beamCollected, 0)) + beamCollected;
        }
      }
      projectile.age = (projectile.age || 0) + dt;
      if (runnerImpact && runnerImpactT <= wallImpactT) {
        explodeRunnerProjectile(game, projectile, runnerImpact.x, runnerImpact.y, "runner", runnerImpact.survivorId);
        projectiles.splice(i, 1);
        continue;
      }
      if (wallImpact) {
        explodeRunnerProjectile(game, projectile, wallImpact.x, wallImpact.y, "wall");
        projectiles.splice(i, 1);
        continue;
      }
      projectile.x = clamp(nextX, 0, game.map.width);
      projectile.y = clamp(nextY, 0, game.map.height);
      projectile.traveled = traveled + dist(prevX, prevY, projectile.x, projectile.y);
      const outOfBounds = projectile.x <= 0 || projectile.y <= 0 || projectile.x >= game.map.width || projectile.y >= game.map.height;
      if (outOfBounds || projectile.traveled >= range || projectile.age >= projectile.ttl) {
        explodeRunnerProjectile(game, projectile, projectile.x, projectile.y, outOfBounds ? "boundary" : "target");
        projectiles.splice(i, 1);
      }
    }
  }

  function fireRunnerShootAbility(game, actor, payload = {}) {
    if (!game || !actor || actor.role !== "survivor" || actor.dead || actor.escaped) return { ok: false, message: "Only Runners can fire that." };
    if ((game.time || 0) < (game.matchStartFreezeSeconds || MATCH_START_FREEZE_SECONDS)) return { ok: false, message: "The run has not started yet." };
    if (actor.hooked || actor.downed || actor.vault || actor.actionLock > 0) return { ok: false, message: "You cannot fire that right now." };

    const requestedId = String(payload.id || payload.abilityId || "");
    const allowedIds = runnerProjectileAbilityIds(actor);
    const abilityId = allowedIds.includes(requestedId) ? requestedId : allowedIds[0];
    const ability = getSurvivorAbilityDef(abilityId, actor);
    if (!ability || !ability.projectileKind) return { ok: false, message: "No projectile ability is ready." };
    if (ability.locked) return { ok: false, message: `Unlock ${ability.name || "that ability"} first.` };

    const testingAbilities = abilityTestingEnabled(actor);
    ensureRunnerDartAmmo(actor);
    const fireLockout = Math.max(0, cfgNumber(actor.runnerDartFireLockout, 0));
    if (!testingAbilities && fireLockout > 0) {
      return { ok: false, message: `${ability.name} is chambering for ${fireLockout.toFixed(1)}s.` };
    }
    if (!testingAbilities && (actor.runnerDartAmmo || 0) <= 0) {
      const now = game.time || 0;
      if (now >= cfgNumber(actor.noDartAmmoChatUntil, 0)) {
        setActorChat(actor, randomNoDartAmmoLine(), game, 2.1);
        actor.noDartAmmoChatUntil = now + NO_DART_AMMO_CHAT_COOLDOWN;
      }
      return { ok: false, noAmmo: true, message: `${ability.name} is out of dart ammo. Find a Dart Box.` };
    }

    const rawTargetX = Number(payload.targetX);
    const rawTargetY = Number(payload.targetY);
    const hasTarget = Number.isFinite(rawTargetX) && Number.isFinite(rawTargetY);
    const targetX = hasTarget ? clamp(rawTargetX, 0, game.map.width) : null;
    const targetY = hasTarget ? clamp(rawTargetY, 0, game.map.height) : null;
    let angle = Number(payload.angle);
    let aimDistance = hasTarget ? dist(actor.x, actor.y, targetX, targetY) : Infinity;
    if (hasTarget && aimDistance > 0.001) angle = Math.atan2(targetY - actor.y, targetX - actor.x);
    if (!Number.isFinite(angle)) angle = Number(actor.input?.angle);
    if (!Number.isFinite(angle)) angle = actor.angle || 0;
    let dx = Math.cos(angle);
    let dy = Math.sin(angle);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { ok: false, message: `Bad ${ability.name} aim.` };

    const maxRange = Math.max(80, cfgNumber(ability.range, DART_DEFAULT_RANGE));
    const radius = Math.max(20, cfgNumber(ability.radius, DART_DEFAULT_RADIUS));
    const duration = Math.max(0.1, cfgNumber(ability.duration, DART_DEFAULT_DURATION));
    const muzzleOffset = Math.max(PLAYER_SIZE * 0.68, 30);
    let startX = clamp(actor.x + dx * muzzleOffset, 0, game.map.width);
    let startY = clamp(actor.y + dy * muzzleOffset, 0, game.map.height);
    if (!segmentClear(game, actor.x, actor.y, startX, startY)) {
      startX = clamp(actor.x, 0, game.map.width);
      startY = clamp(actor.y, 0, game.map.height);
    }
    let projectileRange = maxRange;
    if (hasTarget) {
      const distanceFromStart = dist(startX, startY, targetX, targetY);
      if (distanceFromStart > 8) {
        angle = Math.atan2(targetY - startY, targetX - startX);
        dx = Math.cos(angle);
        dy = Math.sin(angle);
        projectileRange = Math.max(0, Math.min(maxRange, distanceFromStart));
      } else if (aimDistance > 8) {
        projectileRange = Math.max(0, Math.min(maxRange, aimDistance));
      }
    }
    const effect = ability.effect || {};
    const projectile = {
      id: uid("runnerproj"),
      type: ability.id,
      abilityId: ability.id,
      kind: String(ability.projectileKind || effect.projectileKind || ability.id),
      ownerId: actor.id,
      x: startX,
      y: startY,
      dx,
      dy,
      angle,
      speed: Math.max(1, cfgNumber(ability.projectileSpeed, DART_DEFAULT_PROJECTILE_SPEED)),
      range: projectileRange,
      radius,
      duration,
      boostDuration: Math.max(0, cfgNumber(ability.boostDuration ?? effect.boostDuration ?? ability.duration, ability.duration)),
      speedMultiplier: ability.id === "dashDart"
        ? Math.min(Math.max(1, cfgNumber(ability.speedMultiplier ?? effect.speedMultiplier, DART_DEFAULT_SPEED_MULT)), DASH_DART_MAX_SPEED_MULT)
        : Math.max(1, cfgNumber(ability.speedMultiplier ?? effect.speedMultiplier, DART_DEFAULT_SPEED_MULT)),
      hidesScratchMarks: !!(ability.hidesScratchMarks || effect.hidesScratchMarks),
      scratchHideDuration: Math.max(0, cfgNumber(ability.scratchHideDuration ?? effect.scratchHideDuration ?? ability.duration, duration)),
      healProgress: Math.max(0, cfgNumber(effect.healProgress, 0)),
      unhookProgress: Math.max(0, cfgNumber(effect.unhookProgress, 0)),
      canUnhook: !!effect.canUnhook,
      canPickupDowned: !!effect.canPickupDowned,
      beamCollectRadius: Math.max(0, cfgNumber(effect.beamCollectRadius ?? ability.beamCollectRadius, 0)),
      beamCollected: 0,
      effect,
      traveled: 0,
      age: 0,
      ttl: 2
    };

    if (!testingAbilities) spendRunnerDartAmmo(actor, ability);
    awardStat(actor, "abilitiesUsed", "Ability used", 1, "team");
    addEvent(game, "runnerProjectileFire", {
      x: startX,
      y: startY,
      actorId: actor.id,
      survivorId: actor.id,
      ownerId: actor.id,
      projectileId: projectile.id,
      abilityId: ability.id,
      projectileType: projectile.kind,
      angle,
      radius: projectile.radius,
      duration: projectile.duration,
      ammo: actor.runnerDartAmmo || 0,
      maxAmmo: actor.runnerDartMaxAmmo || runnerDartMaxAmmo(actor),
      reloadRemaining: 0,
      fireLockoutRemaining: actor.runnerDartFireLockout || 0,
      speedMultiplier: projectile.speedMultiplier,
      hidesScratchMarks: projectile.hidesScratchMarks,
      scratchHideDuration: projectile.scratchHideDuration
    });

    game.runnerProjectiles = Array.isArray(game.runnerProjectiles) ? game.runnerProjectiles : [];
    game.runnerProjectiles.push(projectile);
    return { ok: true };
  }

  function chooseFfaRespawnSpot(game, actor) {
    const spawns = Array.isArray(game?.map?.survivorSpawns) && game.map.survivorSpawns.length
      ? game.map.survivorSpawns
      : [{ x: game.map.width / 2, y: game.map.height / 2 }];
    const liveOpponents = [...game.actors.values()].filter((other) => other && other.id !== actor.id && isFfaActor(other) && !other.dead && !other.downed && !other.escaped);
    let best = spawns[0];
    let bestScore = -Infinity;
    for (const spawn of spawns) {
      const nearest = liveOpponents.length
        ? Math.min(...liveOpponents.map((other) => dist(spawn.x, spawn.y, other.x, other.y)))
        : 99999;
      const score = nearest + Math.random() * 12;
      if (score > bestScore) {
        bestScore = score;
        best = spawn;
      }
    }
    return { x: best.x, y: best.y };
  }

  function respawnFfaActor(game, actor) {
    if (!game || !actor || !isFfaActor(actor)) return;
    const spot = chooseFfaRespawnSpot(game, actor);
    actor.x = spot.x;
    actor.y = spot.y;
    actor.health = 2;
    actor.injured = false;
    actor.dead = false;
    actor.downed = false;
    actor.escaped = false;
    actor.hooked = false;
    actor.invuln = Math.max(actor.invuln || 0, 1.1);
    actor.hitBoost = 0;
    actor.healProgress = 0;
    actor.hookProgress = 0;
    actor.recovery = 0;
    actor.ffaRespawnTimer = 0;
    actor.actionLock = 0;
    actor.vault = null;
    resetInput(actor.input);
    addEvent(game, "ffaRespawn", { x: actor.x, y: actor.y, survivorId: actor.id, actorId: actor.id });
  }

  function applyFfaShotHit(game, projectile, x, y, reason = "impact", targetId = null) {
    addEvent(game, "runnerProjectileExplode", {
      x,
      y,
      actorId: projectile.ownerId,
      survivorId: projectile.ownerId,
      ownerId: projectile.ownerId,
      projectileId: projectile.id || null,
      abilityId: "voidShooter",
      projectileType: "ffaShot",
      radius: FFA_PROJECTILE_RADIUS,
      affected: targetId ? 1 : 0,
      reason
    });
    if (!isFfaGame(game) || !targetId) return;
    const shooter = game.actors.get(projectile.ownerId);
    const target = game.actors.get(targetId);
    if (!shooter || !target || !isFfaActor(shooter) || !isFfaActor(target)) return;
    if (target.dead || target.downed || target.escaped || target.invuln > 0) return;
    awardStat(shooter, "shotHits", "Shot landed", 1, "hit");

    if ((target.health || 2) > 1) {
      target.health = 1;
      target.injured = true;
      target.invuln = Math.max(target.invuln || 0, 0.25);
      target.hitBoost = Math.max(target.hitBoost || 0, SURVIVOR_HIT_BOOST * 0.55);
      addEvent(game, "ffaHit", {
        x: target.x,
        y: target.y,
        survivorId: target.id,
        actorId: shooter.id,
        killerId: shooter.id,
        playerName: shooter.name,
        otherPlayerName: target.name
      });
      return;
    }

    target.health = 0;
    target.injured = true;
    target.downed = true;
    target.dead = true;
    target.ffaRespawnTimer = FFA_RESPAWN_SECONDS;
    target.actionLock = 0;
    target.vault = null;
    target.healingTargetId = null;
    target.unhookTargetId = null;
    target.dartBoxTargetId = null;
    target.dartBoxProgress = 0;
    resetInput(target.input);
    awardStat(shooter, "kills", "Elimination", 1, "kill");
    awardStat(target, "deaths", "Death", 1, "death");
    shooter.killScore = Math.max(shooter.killScore || 0, Math.floor(shooter.stats?.kills || 0));
    addEvent(game, "ffaKill", {
      x: target.x,
      y: target.y,
      killerId: shooter.id,
      actorId: shooter.id,
      survivorId: target.id,
      playerName: shooter.name,
      otherPlayerName: target.name,
      text: `${shooter.name || "Someone"} shot down ${target.name || "someone"}!`,
      killerKills: shooter.killScore,
      killLimit: FFA_KILL_LIMIT
    });
    const lobby = lobbyForGame(game);
    if (lobby) checkWinConditions(lobby);
  }

  function fireFfaShot(game, actor, payload = {}) {
    if (!game || !actor || !isFfaGame(game) || !isFfaActor(actor)) return { ok: false, message: "Only Void Shooters can fire that." };
    if ((game.time || 0) < (game.matchStartFreezeSeconds || MATCH_START_FREEZE_SECONDS)) return { ok: false, message: "The arena has not started yet." };
    if (actor.dead || actor.escaped || actor.hooked || actor.downed || actor.vault || actor.actionLock > 0) return { ok: false, message: "You cannot shoot right now." };
    const cooldown = Math.max(0, cfgNumber(actor.ffaShotCooldown, 0));
    if (cooldown > 0) return { ok: false, message: `Void Shot is cooling down for ${cooldown.toFixed(1)}s.` };

    const rawTargetX = Number(payload.targetX);
    const rawTargetY = Number(payload.targetY);
    const hasTarget = Number.isFinite(rawTargetX) && Number.isFinite(rawTargetY);
    const targetX = hasTarget ? clamp(rawTargetX, 0, game.map.width) : null;
    const targetY = hasTarget ? clamp(rawTargetY, 0, game.map.height) : null;
    let angle = Number(payload.angle);
    if (hasTarget && dist(actor.x, actor.y, targetX, targetY) > 0.001) angle = Math.atan2(targetY - actor.y, targetX - actor.x);
    if (!Number.isFinite(angle)) angle = Number(actor.input?.angle);
    if (!Number.isFinite(angle)) angle = actor.angle || 0;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { ok: false, message: "Bad shot aim." };

    const muzzleOffset = Math.max(PLAYER_SIZE * 0.68, 30);
    let startX = clamp(actor.x + dx * muzzleOffset, 0, game.map.width);
    let startY = clamp(actor.y + dy * muzzleOffset, 0, game.map.height);
    if (!segmentClear(game, actor.x, actor.y, startX, startY)) {
      startX = clamp(actor.x, 0, game.map.width);
      startY = clamp(actor.y, 0, game.map.height);
    }
    const projectile = {
      id: uid("ffashot"),
      type: "ffaShot",
      abilityId: "voidShooter",
      kind: "ffaShot",
      ownerId: actor.id,
      x: startX,
      y: startY,
      dx,
      dy,
      angle,
      speed: FFA_PROJECTILE_SPEED,
      range: FFA_PROJECTILE_RANGE,
      radius: FFA_PROJECTILE_RADIUS,
      duration: 0,
      traveled: 0,
      age: 0,
      ttl: Math.max(0.25, FFA_PROJECTILE_RANGE / Math.max(1, FFA_PROJECTILE_SPEED) + 0.08)
    };
    actor.ffaShotCooldown = FFA_SHOT_COOLDOWN;
    awardStat(actor, "shotsFired", "Shot fired", 1, "shot");
    addEvent(game, "runnerProjectileFire", {
      x: startX,
      y: startY,
      actorId: actor.id,
      survivorId: actor.id,
      ownerId: actor.id,
      projectileId: projectile.id,
      abilityId: "voidShooter",
      projectileType: "ffaShot",
      angle,
      radius: projectile.radius,
      duration: 0,
      ammo: null,
      maxAmmo: null,
      reloadRemaining: 0,
      fireLockoutRemaining: actor.ffaShotCooldown
    });
    game.runnerProjectiles = Array.isArray(game.runnerProjectiles) ? game.runnerProjectiles : [];
    game.runnerProjectiles.push(projectile);
    return { ok: true };
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

    const ability = getSurvivorAbilityDef(abilityId, actor);
    if (!ability) return { ok: false, message: "Unknown Runner ability." };
    if (ability.locked) return { ok: false, message: `Unlock ${ability.name} in Perks first.` };

    const cooldowns = actor.survivorAbilityCooldowns || (actor.survivorAbilityCooldowns = {});
    const remainingCooldown = Math.max(0, cfgNumber(cooldowns[ability.id], 0));
    if (remainingCooldown > 0) {
      return { ok: false, message: `${ability.name} is cooling down for ${Math.ceil(remainingCooldown)}s.` };
    }

    const currentOrbs = Math.max(0, Math.floor(actor.dots || 0));
    if (currentOrbs < ability.cost) {
      return { ok: false, message: `${ability.name} needs ${ability.cost} orbs.` };
    }

    let affected = 0;
    let completedHeals = 0;

    if (ability.projectileKind || SURVIVOR_ABILITY_DEFS[ability.id]?.shootAbility) {
      return { ok: false, message: `${ability.name} fires with M1.` };
    } else if (ability.id === "doubleOrb") {
      actor.doubleOrb = Math.max(actor.doubleOrb || 0, ability.duration || 5);
      actor.doubleOrbChance = clamp(cfgNumber(ability.effect?.chance, 0.25), 0, 1);
      actor.doubleOrbMinBonus = Math.max(0, Math.floor(cfgNumber(ability.effect?.minBonus, 2)));
      actor.doubleOrbMaxBonus = Math.max(actor.doubleOrbMinBonus, Math.floor(cfgNumber(ability.effect?.maxBonus, 4)));
    } else if (ability.id === "swiftVault") {
      actor.swiftVaultReady = Math.max(actor.swiftVaultReady || 0, ability.duration || 10);
      actor.swiftVaultBoostDuration = Math.max(0, cfgNumber(ability.effect?.boostDuration ?? ability.duration, 2));
      actor.swiftVaultSpeedMultiplier = Math.max(1, cfgNumber(ability.speedMultiplier || ability.effect?.speedMultiplier, 1.2));
    } else if (ability.id === "voidSwirl") {
      const swirl = addVoidSwirl(game, actor, ability);
      if (!swirl) return { ok: false, message: "Void Swirl fizzled." };
      affected = 1;
    } else if (ability.id === "riftLens") {
      actor.riftLens = Math.max(actor.riftLens || 0, ability.duration || 15);
    } else if (ability.id === "hourglass") {
      actor.hourglass = Math.max(actor.hourglass || 0, ability.duration || 5);
      if ((ability.effect?.hidesScratchMarks ?? SURVIVOR_HOURGLASS_HIDES_SCRATCH) && Array.isArray(game.scratchMarks)) {
        game.scratchMarks = game.scratchMarks.filter((mark) => mark.actorId !== actor.id);
      }
    } else if (ability.id === "speedBurst") {
      actor.speedBurst = Math.max(actor.speedBurst || 0, ability.duration || 5);
    } else if (ability.id === "healingPulse") {
      const targets = healingPulseTargets(game, actor, ability.radius || ability.effect?.radius || 140);
      if (!targets.length) return { ok: false, message: "No wounded Runners are close enough for Healing Pulse." };
      const progress = clamp(cfgNumber(ability.effect?.healProgress, 0.15), 0, 1);
      for (const target of targets) {
        const wasComplete = (target.healProgress || 0) + progress >= 1;
        if (applyInstantHealProgress(game, actor, target, progress)) {
          affected += 1;
          if (wasComplete) completedHeals += 1;
        }
      }
    } else {
      return { ok: false, message: "That Runner ability is not ready." };
    }

    actor.dots = clamp(currentOrbs - ability.cost, 0, SURVIVOR_DOT_MAX);
    cooldowns[ability.id] = Math.max(0, cfgNumber(ability.cooldown, 30));
    addEvent(game, "survivorAbility", {
      x: actor.x,
      y: actor.y,
      actorId: actor.id,
      survivorId: actor.id,
      abilityId: ability.id,
      name: ability.name,
      cost: ability.cost,
      duration: ability.duration,
      radius: ability.radius || ability.effect?.radius || null,
      affected,
      completedHeals,
      healProgress: ability.effect?.healProgress || null,
      survivorDots: actor.dots,
      riftLens: actor.riftLens || 0,
      hourglass: actor.hourglass || 0,
      speedBurst: actor.speedBurst || 0,
      doubleOrb: actor.doubleOrb || 0,
      swiftVaultReady: actor.swiftVaultReady || 0,
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

  function buildMapAnalysis(mapId, mapDef) {
    try {
      const analysis = analyzeMap(mapId, mapDef, { freeze: false });
      if (process.env.MAP_ANALYSIS_DEBUG === "1") {
        console.log(`[nav] Semantic map analysis ready for ${mapId}:\n${formatAnalysisSummary(analysis)}`);
      }
      return analysis;
    } catch (error) {
      console.warn(`[nav] Failed to analyze map ${mapId || "<unknown>"}:`, error?.message || error);
      return null;
    }
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

  function resolveMapSelection(requestedMapId, mode = GAME_MODE_STANDARD) {
    const maps = getMapRegistry();
    const entries = getMapEntries();
    const requestedId = typeof requestedMapId === "string" ? requestedMapId.trim() : "";
    const lobbyMode = normalizeLobbyMode(mode);
    const requestedEntry = entries.find(([id]) => id === requestedId);
    const requestedMode = requestedEntry ? normalizeLobbyMode(requestedEntry[1]?.mode) : null;
    const ffaEntry = entries.find(([id, def]) => id === "ffaTest" || normalizeLobbyMode(def?.mode) === GAME_MODE_FFA);
    const standardEntry = entries.find(([id, def]) => normalizeLobbyMode(def?.mode) !== GAME_MODE_FFA && id === getDefaultMapId())
      || entries.find(([, def]) => normalizeLobbyMode(def?.mode) !== GAME_MODE_FFA);
    const fallbackId = lobbyMode === GAME_MODE_FFA ? (ffaEntry?.[0] || standardEntry?.[0] || getDefaultMapId()) : (standardEntry?.[0] || getDefaultMapId());
    const requestedMatchesMode = requestedEntry && (lobbyMode === GAME_MODE_FFA ? requestedMode === GAME_MODE_FFA : requestedMode !== GAME_MODE_FFA);
    const mapId = requestedMatchesMode ? requestedEntry[0] : fallbackId;

    if (!mapId || !maps[mapId]) return null;
    return { id: mapId, def: maps[mapId] };
  }

  function getMapListForClient() {
    return getMapEntries().map(([id, mapDef]) => ({
      id,
      name: mapDef.name || id,
      mode: normalizeLobbyMode(mapDef.mode),
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

  function visibleGeneratorsForSnapshot(game, viewer, forceVisible = false) {
    if (areRiftsComplete(game) && !forceVisible) return [];
    const generators = game?.map?.generators || [];
    if (forceVisible || !viewer || viewer.role === "spectatorOverview") return generators;
    return generators.filter((gen) => !smokeBlocksViewerPoint(game, viewer, gen.x, gen.y));
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
    if (role === "ffa") {
      return {
        kills: 0,
        deaths: 0,
        shotsFired: 0,
        shotHits: 0,
        healBoxes: 0
      };
    }
    if (role === "killer") {
      return {
        riftsKicked: 0,
        orbsCollected: 0,
        orbsStolen: 0,
        injures: 0,
        downs: 0,
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
    const defaults = createMatchStats(isFfaActor(actor) ? "ffa" : actor.role);
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
    if (isFfaActor(actor)) {
      return {
        kills: Math.floor(stats.kills || 0),
        deaths: Math.floor(stats.deaths || 0),
        shotsFired: Math.floor(stats.shotsFired || 0),
        shotHits: Math.floor(stats.shotHits || 0),
        healBoxes: Math.floor(stats.healBoxes || 0)
      };
    }
    if (actor.role === "killer") {
      return {
        riftsKicked: Math.floor(stats.riftsKicked || 0),
        orbsCollected: Math.floor(stats.orbsCollected || 0),
        orbsStolen: Math.floor(stats.orbsStolen || 0),
        injures: Math.floor(stats.injures || 0),
        downs: Math.floor(stats.downs || 0),
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
    const ffaCount = players.filter((p) => p.role === "ffa").length;
    const killerCount = players.filter((p) => p.role === "killer").length;
    const spectators = players.filter((p) => p.role === "spectator").length;
    const killer = killerCount > 0;
    return {
      id: lobby.id,
      mode: normalizeLobbyMode(lobby.mode),
      name: lobby.name,
      mapId: lobby.mapId,
      mapName: lobby.mapName,
      phase: lobby.phase,
      playerCount: players.length,
      survivors,
      ffaCount,
      killer,
      killerCount,
      spectators,
      maxSurvivors: MAX_SURVIVORS,
      maxFfaPlayers: FFA_MAX_PLAYERS,
      killLimit: FFA_KILL_LIMIT,
      hostId: lobby.hostId || null,
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
      accountId: options.accountId || null,
      role,
      lobbyRole: options.lobbyRole || role,
      gameMode: normalizeLobbyMode(options.gameMode),
      skin: sanitizeRoleSkin(options.lobbyRole || role, options.skin),
      runnerClass: role === "survivor" && normalizeLobbyMode(options.gameMode) !== GAME_MODE_FFA ? normalizeRunnerClassId(options.runnerClass) : null,
      runnerLevel: Math.max(1, Math.floor(cfgNumber(options.runnerLevel, 1))),
      perkLevels: normalizePerkLevelMap(options.perkLevels, role, !!options.isBot),
      botDebugEnabled: !!options.botDebugEnabled,
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
      reviveInvuln: 0,
      hitBoost: 0,
      healProgress: 0,
      activeHealers: [],
      healingTargetId: null,
      recovery: 0,
      voidStun: 0,
      voidSpeedBoost: 0,
      voidSwirlSlow: 0,
      voidSwirlSlowMultiplier: 1,
      voidAbilityCooldowns: {},
      stealthStep: 0,
      riftLens: 0,
      hourglass: 0,
      speedBurst: 0,
      doubleOrb: 0,
      doubleOrbChance: 0,
      doubleOrbMinBonus: 0,
      doubleOrbMaxBonus: 0,
      swiftVaultReady: 0,
      swiftVaultBoostDuration: 0,
      swiftVaultSpeedMultiplier: 1,
      healingDartHeal: null,
      healingDartUnhook: null,
      dashBoost: 0,
      dashBoostMultiplier: 1,
      dartScratchHidden: 0,
      survivorAbilityCooldowns: {},
      runnerDartAmmo: role === "survivor" && normalizeLobbyMode(options.gameMode) !== GAME_MODE_FFA ? runnerDartMaxAmmoForClass(options.runnerClass) : 0,
      runnerDartMaxAmmo: role === "survivor" && normalizeLobbyMode(options.gameMode) !== GAME_MODE_FFA ? runnerDartMaxAmmoForClass(options.runnerClass) : 0,
      ffaShotCooldown: 0,
      ffaRespawnTimer: 0,
      killScore: 0,
      runnerDartReloadTimer: 0,
      runnerDartFireLockout: 0,
      dartBoxTargetId: null,
      dartBoxProgress: 0,
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
      noDartAmmoChatUntil: 0,
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

  function createLobby(name, requestedMapId, mode = GAME_MODE_STANDARD) {
    cleanupStaleLobbies();
    if (lobbies.size >= MAX_LOBBIES) {
      throw new Error("The server has reached the lobby limit. Try again after a match ends.");
    }

    const lobbyMode = normalizeLobbyMode(mode);
    const requested = requestedMapId || (lobbyMode === GAME_MODE_FFA ? "ffaTest" : null);
    const selection = resolveMapSelection(requested, lobbyMode);
    if (!selection) {
      throw new Error("Cannot create a lobby because public/maps.js does not contain any valid maps.");
    }

    const id = uid("lobby");
    const createdAt = nowMs();
    const lobby = {
      id,
      mode: lobbyMode,
      name: sanitizeLobbyName(name || (lobbyMode === GAME_MODE_FFA ? "Free-For-All" : "Open Lobby")),
      mapId: selection.id,
      mapName: selection.def.name || selection.id,
      phase: "lobby",
      createdAt,
      lastActivityAt: createdAt,
      hostId: null,
      players: new Map(),
      game: null
    };
    lobbies.set(id, lobby);
    return lobby;
  }

  function assignLobbyHostIfNeeded(lobby, preferredId = null) {
    if (!lobby) return null;
    if (lobby.hostId && lobby.players.has(lobby.hostId)) return lobby.hostId;
    const preferred = preferredId ? lobby.players.get(preferredId) : null;
    if (preferred && !preferred.isBot) {
      lobby.hostId = preferredId;
      return lobby.hostId;
    }
    const nextHuman = [...lobby.players.values()].find((player) => !player.isBot);
    lobby.hostId = nextHuman?.id || null;
    return lobby.hostId;
  }

  const SPECTATE_OVERVIEW_ID = "__overview__";

  function isSpectateOverviewId(id) {
    return id === SPECTATE_OVERVIEW_ID;
  }

  function normalizeRequestedRole(requestedRole) {
    if (requestedRole === "killer") return "killer";
    if (requestedRole === "ffa") return "ffa";
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
    const spectator = makePlayer({ id: player.id }, "spectator", player.name, { isBot: false, botDebugEnabled: !!player.botDebugEnabled });
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

    const player = makePlayer(socket, "spectator", name || "Spectator", { isBot: false, botDebugEnabled: !!socket.data?.botDebugEnabled });
    player.ready = true;
    lobby.players.set(socket.id, player);
    assignLobbyHostIfNeeded(lobby, socket.id);
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

  function joinLobby(socket, lobby, requestedRole, name, skin, runnerClass = null) {
    let role = normalizeRequestedRole(requestedRole);
    if (role === "spectator") return joinSpectatorLobby(socket, lobby, name);

    if (!lobby || lobby.phase !== "lobby") {
      socket.emit("toast", { type: "error", message: "That lobby is already in a run." });
      return false;
    }

    const ffaLobby = isFfaLobby(lobby);
    if (ffaLobby) role = "ffa";
    if (!ffaLobby && role === "ffa") {
      socket.emit("toast", { type: "error", message: "Free-For-All uses its own lobby." });
      return false;
    }

    leaveCurrentLobby(socket);

    const players = [...lobby.players.values()];
    const survivorCount = players.filter((p) => p.role === "survivor").length;
    const ffaCount = players.filter((p) => p.role === "ffa").length;

    // Multiple players are allowed to queue as The Void in the lobby.
    // The hard rule is enforced only when the match starts: exactly one Void.
    if (role === "survivor" && survivorCount >= MAX_SURVIVORS) {
      socket.emit("toast", { type: "error", message: "This lobby already has four Runners." });
      return false;
    }
    if (role === "ffa" && ffaCount >= FFA_MAX_PLAYERS) {
      socket.emit("toast", { type: "error", message: "This Free-For-All arena is full." });
      return false;
    }

    const account = socket.data?.account || null;
    const player = makePlayer(socket, role, name, {
      isBot: false,
      skin,
      runnerClass: role === "survivor" ? (runnerClass || account?.selectedRunnerClass || RUNNER_CLASS_DEFAULT_ID) : null,
      runnerLevel: account?.runnerLevel || account?.progression?.runner?.level || 1,
      accountId: account?.id || null,
      perkLevels: account?.perks || null,
      botDebugEnabled: !!socket.data?.botDebugEnabled
    });
    lobby.players.set(socket.id, player);
    assignLobbyHostIfNeeded(lobby, socket.id);
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
    assignLobbyHostIfNeeded(lobby);

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
            awardAccountRewardForActor(lobby, lobby.game, actor, "disconnect");
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
      mode: normalizeLobbyMode(lobby.mode),
      name: lobby.name,
      phase: lobby.phase,
      mapId: lobby.mapId,
      mapName: lobby.mapName,
      maxSurvivors: MAX_SURVIVORS,
      maxFfaPlayers: FFA_MAX_PLAYERS,
      killLimit: FFA_KILL_LIMIT,
      hostId: lobby.hostId || null,
      players: [...lobby.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        skin: p.skin || "blueSquare",
        runnerClass: p.role === "survivor" ? normalizeRunnerClassId(p.runnerClass) : null,
        ready: (p.role === "spectator" || p.isBot) ? true : !!p.ready,
        isBot: !!p.isBot,
        isHost: p.id === lobby.hostId
      }))
    });
  }

  function addBotToLobby(lobby, role) {
    if (!lobby || lobby.phase !== "lobby") return { ok: false, message: "Bots can only be added in the lobby." };
    if (isFfaLobby(lobby)) return { ok: false, message: "FFA bots are not wired yet. Terrifying, I know: actual humans required." };
    const roleValue = role === "killer" ? "killer" : "survivor";
    const players = [...lobby.players.values()];
    if (roleValue === "survivor" && players.filter((p) => p.role === "survivor").length >= MAX_SURVIVORS) {
      return { ok: false, message: "Runner slots are full." };
    }
    const id = uid("bot");
    const count = players.filter((p) => p.isBot && p.role === roleValue).length + 1;
    const name = roleValue === "killer" ? `Void Bot ${count}` : `Runner Bot ${count}`;
    const survivorBotSkins = ["blueSquare", "yellowStar", "purplePentagon", "nebulaBloom", "eclipseWisp", "riftMoth", "signalDrone"];
    const voidBotSkins = ["voidCore", "solarMaw", "azureRift", "bloodEclipse", "starlessWyrm", "lanternHusk", "abyssSiren", "crownedHollow", "staticNull", "riftSeraph"];
    const botSkin = roleValue === "killer" ? voidBotSkins[count % voidBotSkins.length] : survivorBotSkins[count % survivorBotSkins.length];
    const runnerClassIds = Object.keys(RUNNER_CLASS_DEFS);
    const botRunnerClass = roleValue === "survivor" ? (runnerClassIds[(count - 1) % Math.max(1, runnerClassIds.length)] || RUNNER_CLASS_DEFAULT_ID) : null;
    const bot = makePlayer({ id }, roleValue, name, { isBot: true, skin: botSkin, runnerClass: botRunnerClass, runnerLevel: Math.max(1, Math.floor(cfgNumber(RIFTRUNNER_PERKS.botRunnerLevel, 1))) });
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
    if (isFfaLobby(lobby)) return role === "ffa" && players.filter((p) => p.role === "ffa").length < FFA_MAX_PLAYERS;
    if (role === "ffa") return false;
    if (role === "killer") return true;
    if (role === "survivor") return players.filter((p) => p.role === "survivor").length < MAX_SURVIVORS;
    return false;
  }

  function startFfaGame(lobby) {
    const players = [...lobby.players.values()];
    const shooters = players.filter((p) => p.role === "ffa");
    if (lobby.phase !== "lobby") return false;
    if (shooters.length < 2) {
      io.to(lobby.id).emit("toast", { type: "error", message: "Need at least 2 Void Shooters to start Free-For-All." });
      return false;
    }
    if (shooters.length > FFA_MAX_PLAYERS) {
      io.to(lobby.id).emit("toast", { type: "error", message: `Free-For-All supports up to ${FFA_MAX_PLAYERS} players.` });
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
        message: `Everyone has to ready up before FFA starts. Waiting on ${names}${more}.`
      });
      broadcastLobbyState(lobby);
      return false;
    }

    const selection = resolveMapSelection(lobby.mapId, GAME_MODE_FFA);
    if (!selection) {
      io.to(lobby.id).emit("toast", { type: "error", message: "No valid Free-For-All map was found. Check public/maps.js." });
      return false;
    }

    lobby.mapId = selection.id;
    lobby.mapName = selection.def.name || selection.id;
    const map = parseMap(selection.def);
    map.id = selection.id;
    map.requiredGenerators = 0;
    map.generators = [];
    map.gates = [];
    map.hooks = [];
    const mapAnalysis = buildMapAnalysis(selection.id, selection.def);
    const game = {
      mode: GAME_MODE_FFA,
      map,
      mapAnalysis,
      matchId: uid("match"),
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
      requiredGenerators: 0,
      killLimit: FFA_KILL_LIMIT,
      escapeOpen: false,
      riftEndgameActive: false,
      time: 0,
      botThinkAccumulator: 0,
      matchStartFreezeSeconds: MATCH_START_FREEZE_SECONDS,
      collectibleDots: [],
      runnerProjectiles: [],
      dartBoxes: [],
      dartBoxRespawnQueue: 0,
      dartBoxRespawnTimer: DART_BOX_RESPAWN_SECONDS,
      smokeClouds: [],
      voidSwirls: [],
      dotRespawnQueue: 0,
      redOrbs: 0,
      redOrbSlowMultiplier: RED_ORB_SLOW_MULT,
      redOrbSlowSeconds: RED_ORB_SLOW_SECONDS,
      runnerReveal: 0,
      dotRespawnTimer: DOT_RESPAWN_SECONDS,
      paused: false,
      pausedBy: null,
      pausedByName: null,
      pausedAt: null
    };

    seedInitialDartBoxes(game);

    let spawnIndex = 0;
    const spectatorPlayers = [];
    for (const player of players) {
      if (player.role === "spectator") {
        spectatorPlayers.push(player);
        continue;
      }
      if (player.role !== "ffa") continue;
      const actor = makePlayer({ id: player.id }, "survivor", player.name, {
        isBot: !!player.isBot,
        skin: player.skin,
        runnerClass: null,
        runnerLevel: player.runnerLevel || 1,
        accountId: player.accountId || null,
        perkLevels: player.perkLevels || null,
        botDebugEnabled: !!player.botDebugEnabled,
        lobbyRole: "ffa",
        gameMode: GAME_MODE_FFA
      });
      actor.ready = player.ready;
      actor.gameMode = GAME_MODE_FFA;
      actor.lobbyRole = "ffa";
      actor.runnerClass = null;
      actor.stats = createMatchStats("ffa");
      actor.killScore = 0;
      actor.runnerDartAmmo = 0;
      actor.runnerDartMaxAmmo = 0;
      const spawn = map.survivorSpawns[spawnIndex % map.survivorSpawns.length];
      spawnIndex += 1;
      actor.x = spawn.x;
      actor.y = spawn.y;
      setActorChat(actor, "Void Shooter online.", game, 2.2);
      game.actors.set(actor.id, actor);
    }

    for (const player of spectatorPlayers) {
      const spectator = makePlayer({ id: player.id }, "spectator", player.name, { isBot: false, botDebugEnabled: !!player.botDebugEnabled });
      spectator.ready = true;
      placeSpectatorNearTarget(game, spectator);
      game.actors.set(spectator.id, spectator);
    }

    lobby.phase = "game";
    lobby.game = game;
    touchLobby(lobby);
    for (const player of lobby.players.values()) player.ready = player.role === "spectator";
    io.to(lobby.id).emit("gameStarted", serializeMapForClient(map, game));
    broadcastLobbyState(lobby);
    broadcastLobbyList();
    return true;
}

  function startGame(lobby) {
    if (isFfaLobby(lobby)) return startFfaGame(lobby);
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
    map.id = selection.id;
    const mapAnalysis = buildMapAnalysis(selection.id, selection.def);
    chooseActiveExitGates(map, 2);
    const game = {
      map,
      mapAnalysis,
      matchId: uid("match"),
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
      runnerProjectiles: [],
      dartBoxes: [],
      dartBoxRespawnQueue: 0,
      dartBoxRespawnTimer: DART_BOX_RESPAWN_SECONDS,
      smokeClouds: [],
      voidSwirls: [],
      dotRespawnQueue: 0,
      redOrbs: 0,
      redOrbSlowMultiplier: RED_ORB_SLOW_MULT,
      redOrbSlowSeconds: RED_ORB_SLOW_SECONDS,
      runnerReveal: 0,
      dotRespawnTimer: DOT_RESPAWN_SECONDS,
      paused: false,
      pausedBy: null,
      pausedByName: null,
      pausedAt: null
    };

    seedInitialCollectibleDots(game);
    seedInitialDartBoxes(game);

    let survivorSpawnIndex = 0;
    const spectatorPlayers = [];
    for (const player of players) {
      if (player.role === "spectator") {
        spectatorPlayers.push(player);
        continue;
      }
      const actor = makePlayer({ id: player.id }, player.role, player.name, {
        isBot: !!player.isBot,
        skin: player.skin,
        runnerClass: player.runnerClass || RUNNER_CLASS_DEFAULT_ID,
        runnerLevel: player.runnerLevel || 1,
        accountId: player.accountId || null,
        perkLevels: player.perkLevels || null,
        botDebugEnabled: !!player.botDebugEnabled
      });
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
      const spectator = makePlayer({ id: player.id }, "spectator", player.name, { isBot: false, botDebugEnabled: !!player.botDebugEnabled });
      spectator.ready = true;
      placeSpectatorNearTarget(game, spectator);
      game.actors.set(spectator.id, spectator);
    }

    botAi.assignRunnerBotPersonalities(game);

    lobby.phase = "game";
    lobby.game = game;
    touchLobby(lobby);
    for (const player of lobby.players.values()) player.ready = player.role === "spectator";
    io.to(lobby.id).emit("gameStarted", serializeMapForClient(map, game));
    broadcastLobbyState(lobby);
    broadcastLobbyList();
    return true;
  }

  function serializeMapForClient(map, game = null) {
    const ffa = isFfaGame(game);
    return {
      name: map.name,
      mode: ffa ? GAME_MODE_FFA : GAME_MODE_STANDARD,
      killLimit: ffa ? FFA_KILL_LIMIT : null,
      startFreezeSeconds: MATCH_START_FREEZE_SECONDS,
      tile: map.tile,
      width: map.width,
      height: map.height,
      rows: map.rawRows,
      requiredGenerators: ffa ? 0 : map.requiredGenerators,
      totalGenerators: ffa ? 0 : map.generators.length,
      generatorCandidateCount: ffa ? 0 : (map.generatorCandidateCount || map.generators.length),
      spawnedGenerators: ffa ? 0 : (map.spawnedGenerators || map.generators.length),
      walls: map.walls.map(stripRect),
      windows: map.windows.map((w) => ({ ...stripRect(w), orientation: w.orientation })),
      pallets: map.pallets.map((p) => ({ ...stripRect(p), orientation: p.orientation, state: p.state, broken: p.broken })),
      generators: ffa ? [] : map.generators.map((g) => ({ id: g.id, x: g.x, y: g.y, progress: g.progress, done: g.done })),
      gates: ffa ? [] : map.gates.map((g) => ({ id: g.id, x: g.x, y: g.y, open: g.open })),
      hooks: ffa ? [] : (map.hooks || []).map((h) => ({ id: h.id, x: h.x, y: h.y, survivorId: h.survivorId, active: h.active }))
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
    if (actor?.role === "survivor" && ((actor.stealthStep || 0) > 0 || (actor.dartScratchHidden || 0) > 0 || (actor.nebulizerVaporTrail || 0) > 0 || (SURVIVOR_HOURGLASS_HIDES_SCRATCH && (actor.hourglass || 0) > 0))) return;
    game.scratchMarks.push({ id: uid("scratch"), actorId: actor.id, x: actor.x, y: actor.y, angle: actor.angle + (Math.random() - 0.5), ttl: SCRATCH_MARK_TTL, createdAt: game.time || 0 });
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
        const completedVaultType = actor.vault.vaultType;
        actor.vault = null;
        if (actor.role === "survivor" && (actor.swiftVaultReady || 0) > 0) {
          const duration = Math.max(0.1, cfgNumber(actor.swiftVaultBoostDuration, 2));
          const multiplier = Math.max(1, cfgNumber(actor.swiftVaultSpeedMultiplier, 1.2));
          actor.swiftVaultReady = 0;
          actor.dashBoost = Math.max(actor.dashBoost || 0, duration);
          actor.dashBoostMultiplier = Math.max(actor.dashBoostMultiplier || 1, multiplier);
          addEvent(game, "survivorAbility", {
            x: actor.x,
            y: actor.y,
            actorId: actor.id,
            survivorId: actor.id,
            abilityId: "swiftVault",
            duration,
            speedMultiplier: multiplier,
            vaultType: completedVaultType
          });
        }
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
    if (actor.role === "killer" && (actor.voidSpeedBoost || 0) > 0) speed *= cfgNumber(actorPerkEffect(actor, "nullRush", "killer")?.speedMultiplier, VOID_SPEED_BUFF_MULT);
    if (actor.role === "killer" && (actor.voidSwirlSlow || 0) > 0) speed *= clamp(cfgNumber(actor.voidSwirlSlowMultiplier, VOID_SWIRL_DEFAULT_SLOW_MULT), 0.1, 1);
    if (actor.role === "survivor" && (actor.speedBurst || 0) > 0 && !actor.downed) speed *= cfgNumber(actorPerkEffect(actor, "speedBurst", "survivor")?.speedMultiplier, SURVIVOR_SPEED_BURST_MULT);
    if (actor.role === "survivor" && (actor.dashBoost || 0) > 0 && !actor.downed) {
      const dashMultiplier = Math.min(Math.max(1, cfgNumber(actor.dashBoostMultiplier, DART_DEFAULT_SPEED_MULT)), DASH_DART_MAX_SPEED_MULT);
      speed *= dashMultiplier;
      // Dash Dart is a support burst, not permission to stack every movement buff into hyperspace.
      speed = Math.min(speed, SURVIVOR_SPRINT_SPEED * DASH_DART_MAX_SPEED_MULT);
    }
    if (actor.role === "survivor" && (actor.nebulizerVaporTrail || 0) > 0 && !actor.downed) speed *= Math.max(1, cfgNumber(actor.nebulizerVaporTrailMultiplier, 1));
    if (actor.role === "survivor" && (actor.orbSlow || 0) > 0) speed *= cfgNumber(game.redOrbSlowMultiplier, RED_ORB_SLOW_MULT);
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
    const duration = actor.role === "killer" ? KILLER_VAULT_TIME : survivorVaultDurationForActor(actor);
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

  function clearHealingProgressInvolvingActor(game, interruptedActor) {
    if (!game || !interruptedActor || interruptedActor.role !== "survivor") return;
    const interruptedId = String(interruptedActor.id || "");

    for (const actor of game.actors.values()) {
      if (!actor || actor.role !== "survivor") continue;
      const activeHealers = Array.isArray(actor.activeHealers) ? actor.activeHealers.map(String) : [];
      const healingDartHealerId = actor.healingDartHeal?.healerId ? String(actor.healingDartHeal.healerId) : "";
      const targetBeingHealedByInterrupted = String(actor.id || "") === String(interruptedActor.healingTargetId || "");
      const normalHealingThisActor = actor === interruptedActor && ((actor.healProgress || 0) > 0 || activeHealers.length > 0 || actor.healingDartHeal);
      const interruptedWasHealingThisActor = targetBeingHealedByInterrupted || activeHealers.includes(interruptedId) || String(actor.healingTargetId || "") === interruptedId || healingDartHealerId === interruptedId;

      if (normalHealingThisActor || interruptedWasHealingThisActor) {
        actor.healProgress = 0;
        actor.activeHealers = [];
        actor.healingDartHeal = null;
      }

      if (actor === interruptedActor || interruptedWasHealingThisActor) {
        actor.healingTargetId = null;
      }
    }

    interruptedActor.healProgress = 0;
    interruptedActor.activeHealers = [];
    interruptedActor.healingTargetId = null;
    interruptedActor.healingDartHeal = null;
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
    clearHealingProgressInvolvingActor(game, survivor);
    survivor.hookProgress = 0;
    survivor.unhookProgress = 0;
    survivor.dotDepositTargetId = null;
    survivor.dotDepositProgress = 0;
    survivor.dotDepositChain = 0;
    survivor.dartBoxTargetId = null;
    survivor.dartBoxProgress = 0;
    awardStat(killer, "injures", "Runner injured", 1, "void");

    if (willBeDowned) {
      awardStat(killer, "downs", "Runner downed", 1, "void");
      survivor.health = 0;
      survivor.injured = true;
      survivor.downed = true;
      survivor.hitBoost = 0;
      survivor.invuln = 0;
      clearReviveIframes(survivor);
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

    const orbsLostThisHit = willBeDowned ? Math.floor(dotsBeforeHit) : Math.ceil(dotsBeforeHit * 0.5);

    if (killer && orbsLostThisHit > 0) {
      const before = Math.max(0, killer.dots || 0);
      killer.dots = clamp(before + orbsLostThisHit, 0, KILLER_DOT_MAX);
      const gainedForAbilities = Math.max(0, killer.dots - before);
      const stolenForBank = Math.max(0, Math.floor(orbsLostThisHit));
      if (gainedForAbilities > 0) awardStat(killer, "orbsCollected", "Orbs collected", gainedForAbilities, "orb");
      // This is the permanent Void reward bucket. Loose map pickups stay as in-match ability fuel only.
      // Stolen hit-orbs are credited at match end, even if The Void was already at the ability-orb cap.
      if (stolenForBank > 0) awardStat(killer, "orbsStolen", "Orbs stolen", stolenForBank, "void");
      addEvent(game, "voidOrbSteal", {
        x: survivor.x,
        y: survivor.y,
        survivorId: survivor.id,
        killerId: killer.id,
        stolen: stolenForBank,
        gained: gainedForAbilities,
        carriedBefore: dotsBeforeHit,
        carriedAfter: Math.max(0, dotsBeforeHit - orbsLostThisHit),
        voidDots: killer.dots
      });
    }

    loseSurvivorDots(game, survivor, survivor.downed ? "stolenDowned" : "stolenHit", orbsLostThisHit);
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

  function updateRunnerTimedSupportEffects(game, actor, dt) {
    if (!game || !actor || actor.role !== "survivor") return;

    if (actor.healingDartHeal) {
      const healer = game.actors.get(actor.healingDartHeal.healerId);
      actor.healingDartHeal.remaining = Math.max(0, cfgNumber(actor.healingDartHeal.remaining, 0) - dt);
      if (!isWoundedSurvivor(actor) || actor.dead || actor.escaped || actor.hooked) {
        actor.healingDartHeal = null;
      } else {
        const rate = Math.max(0, cfgNumber(actor.healingDartHeal.progressPerSecond, 0));
        actor.healProgress = clamp((actor.healProgress || 0) + rate * dt, 0, 1);
        if (actor.healingDartHeal.remaining <= 0 && cfgNumber(actor.healingDartHeal.totalProgress, 0) >= 1) {
          actor.healProgress = 1;
        }
        if (healer?.role === "survivor" && !actor.activeHealers?.includes(healer.id)) {
          actor.activeHealers = [...(actor.activeHealers || []), healer.id];
        }
        if (actor.healProgress >= 1) {
          if (healer?.role === "survivor") awardStat(healer, "teammatesHealed", "Healing dart", 1, "team");
          if (actor.downed) {
            actor.downed = false;
            actor.health = 1;
            actor.injured = true;
            if (actor.healingDartHeal?.canPickupDowned) {
              grantHealingDartPickupIframes(actor);
            } else {
              actor.invuln = Math.max(actor.invuln || 0, SURVIVOR_INVULN * 0.65);
              clearReviveIframes(actor);
            }
            actor.hitBoost = Math.max(actor.hitBoost || 0, SURVIVOR_HIT_BOOST * 0.55);
            actor.hookProgress = 0;
            actor.healingDartExecutionBlock = 0;
          } else {
            actor.health = 2;
            actor.injured = false;
            actor.invuln = 0;
            clearReviveIframes(actor);
          }
          actor.healProgress = 0;
          actor.healingDartHeal = null;
          addEvent(game, "healDone", { x: actor.x, y: actor.y, survivorId: actor.id, healerId: healer?.id || null, source: "healingDart" });
        } else if (actor.healingDartHeal && actor.healingDartHeal.remaining <= 0) {
          actor.healingDartHeal = null;
        }
      }
    }

    if (actor.healingDartUnhook) {
      const rescuer = game.actors.get(actor.healingDartUnhook.rescuerId);
      actor.healingDartUnhook.remaining = Math.max(0, cfgNumber(actor.healingDartUnhook.remaining, 0) - dt);
      if (!actor.hooked || actor.dead || actor.escaped) {
        actor.healingDartUnhook = null;
      } else {
        const rate = Math.max(0, cfgNumber(actor.healingDartUnhook.progressPerSecond, 0));
        actor.unhookProgress = clamp((actor.unhookProgress || 0) + rate * dt, 0, 1);
        if (actor.healingDartUnhook.remaining <= 0 && cfgNumber(actor.healingDartUnhook.totalProgress, 0) >= 1) {
          actor.unhookProgress = 1;
        }
        if (actor.unhookProgress >= 1) {
          freeSurvivorFromHook(game, actor, [rescuer].filter(Boolean));
          actor.healingDartUnhook = null;
        } else if (actor.healingDartUnhook && actor.healingDartUnhook.remaining <= 0) {
          actor.healingDartUnhook = null;
        }
      }
    }
  }

  function updateSmokeClouds(game, dt) {
    if (!Array.isArray(game?.smokeClouds)) return;
    for (let i = game.smokeClouds.length - 1; i >= 0; i--) {
      const cloud = game.smokeClouds[i];
      cloud.remaining = Math.max(0, cfgNumber(cloud.remaining, 0) - dt);
      if (cloud.remaining <= 0) game.smokeClouds.splice(i, 1);
    }
  }

  function updateTimers(game, dt) {
    for (const actor of game.actors.values()) {
      actor.invuln = Math.max(0, actor.invuln - dt);
      actor.reviveInvuln = Math.max(0, cfgNumber(actor.reviveInvuln, 0) - dt);
      actor.hitBoost = Math.max(0, actor.hitBoost - dt);
      actor.recovery = Math.max(0, actor.recovery - dt);
      actor.voidStun = Math.max(0, (actor.voidStun || 0) - dt);
      actor.voidSpeedBoost = Math.max(0, (actor.voidSpeedBoost || 0) - dt);
      actor.voidSwirlSlow = Math.max(0, (actor.voidSwirlSlow || 0) - dt);
      if ((actor.voidSwirlSlow || 0) <= 0) actor.voidSwirlSlowMultiplier = 1;
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
      actor.doubleOrb = Math.max(0, (actor.doubleOrb || 0) - dt);
      actor.swiftVaultReady = Math.max(0, (actor.swiftVaultReady || 0) - dt);
      actor.dashBoost = Math.max(0, (actor.dashBoost || 0) - dt);
      actor.nebulizerVaporTrail = Math.max(0, (actor.nebulizerVaporTrail || 0) - dt);
      if ((actor.nebulizerVaporTrail || 0) <= 0) actor.nebulizerVaporTrailMultiplier = 1;
      actor.dartScratchHidden = Math.max(0, (actor.dartScratchHidden || 0) - dt);
      refreshNebulizerVaporTrailFromSmoke(game, actor);
      actor.runnerDartFireLockout = Math.max(0, cfgNumber(actor.runnerDartFireLockout, 0) - dt);
      actor.ffaShotCooldown = Math.max(0, cfgNumber(actor.ffaShotCooldown, 0) - dt);
      if ((actor.dashBoost || 0) <= 0) actor.dashBoostMultiplier = 1;
      if (actor.survivorAbilityCooldowns) {
        for (const [abilityId, remaining] of Object.entries(actor.survivorAbilityCooldowns)) {
          const nextRemaining = Math.max(0, cfgNumber(remaining, 0) - dt);
          if (nextRemaining <= 0) delete actor.survivorAbilityCooldowns[abilityId];
          else actor.survivorAbilityCooldowns[abilityId] = nextRemaining;
        }
      }
      updateRunnerDartAmmo(game, actor, dt);
      updateRunnerTimedSupportEffects(game, actor, dt);
      actor.healingDartExecutionBlock = Math.max(0, cfgNumber(actor.healingDartExecutionBlock, 0) - dt);
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
    updateSmokeClouds(game, dt);
    updateVoidSwirls(game, dt);
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


  function dartBoxSpawnTargetCount(game) {
    const floorTiles = countFloorTiles(game.map);
    const ratioTarget = Math.round(floorTiles * DART_BOX_SPAWN_FLOOR_RATIO);
    return clamp(ratioTarget, DART_BOX_INITIAL_MIN, DART_BOX_MAX_ON_MAP);
  }

  function dartBoxMinSpacingPixels(game) {
    const tile = Math.max(1, cfgNumber(game?.map?.tile, 32));
    return tile * DART_BOX_MIN_TILE_SPACING;
  }

  function dartBoxTooClose(game, spot) {
    if (!game || !spot) return true;
    const minSpacing = dartBoxMinSpacingPixels(game);
    return (game.dartBoxes || []).some((box) => dist(box.x, box.y, spot.x, spot.y) < minSpacing);
  }

  function dartBoxCandidates(game) {
    const tile = game.map.tile;
    return enumerateFloorDotCandidates(game, { excludeExistingDots: false })
      .filter((spot) => !dartBoxTooClose(game, spot))
      .filter((spot) => !(game.collectibleDots || []).some((dot) => dist(dot.x, dot.y, spot.x, spot.y) < tile * 1.6));
  }

  function spawnDartBoxAt(game, spot) {
    if (!game || !spot) return false;
    game.dartBoxes = game.dartBoxes || [];
    if (game.dartBoxes.length >= DART_BOX_MAX_ON_MAP) return false;
    if (dartBoxTooClose(game, spot)) return false;
    if (game.dartBoxes.some((box) => box.tileX === spot.tileX && box.tileY === spot.tileY)) return false;
    game.dartBoxes.push({
      id: uid(isFfaGame(game) ? "healbox" : "dartbox"),
      type: isFfaGame(game) ? "heal" : "dart",
      x: spot.x,
      y: spot.y,
      tileX: spot.tileX,
      tileY: spot.tileY,
      progress: 0,
      activeCollectorId: null
    });
    return true;
  }

  function spawnRandomDartBox(game) {
    if (!game || (game.dartBoxes || []).length >= DART_BOX_MAX_ON_MAP) return false;
    const candidates = dartBoxCandidates(game);
    if (!candidates.length) return false;
    const spot = candidates[Math.floor(Math.random() * candidates.length)];
    return spawnDartBoxAt(game, spot);
  }

  function seedInitialDartBoxes(game) {
    game.dartBoxes = [];
    game.dartBoxRespawnQueue = 0;
    game.dartBoxRespawnTimer = DART_BOX_RESPAWN_SECONDS;
    const candidates = dartBoxCandidates(game);
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const target = dartBoxSpawnTargetCount(game);
    for (const spot of candidates) {
      if ((game.dartBoxes || []).length >= target) break;
      spawnDartBoxAt(game, spot);
    }
  }

  function dartBoxRespawnSecondsForGame(game) {
    return isFfaGame(game) ? FFA_HEAL_BOX_RESPAWN_SECONDS : DART_BOX_RESPAWN_SECONDS;
  }

  function queueDartBoxRespawn(game, count = 1) {
    if (!game || count <= 0) return;
    const respawnSeconds = dartBoxRespawnSecondsForGame(game);
    game.dartBoxRespawnQueue = Math.min(DART_BOX_MAX_ON_MAP, (game.dartBoxRespawnQueue || 0) + count);
    if (!Number.isFinite(game.dartBoxRespawnTimer) || game.dartBoxRespawnTimer > respawnSeconds) {
      game.dartBoxRespawnTimer = respawnSeconds;
    }
  }

  function updateDartBoxRespawns(game, dt) {
    if (!game) return;
    game.dartBoxes = game.dartBoxes || [];
    game.dartBoxRespawnQueue = Math.max(0, game.dartBoxRespawnQueue || 0);
    const respawnSeconds = dartBoxRespawnSecondsForGame(game);
    const targetMinimum = Math.min(DART_BOX_INITIAL_MIN, DART_BOX_MAX_ON_MAP);
    if (game.dartBoxes.length < targetMinimum && game.dartBoxRespawnQueue < DART_BOX_MAX_ON_MAP) {
      game.dartBoxRespawnQueue = Math.min(DART_BOX_MAX_ON_MAP, game.dartBoxRespawnQueue + (targetMinimum - game.dartBoxes.length));
    }
    if (!game.dartBoxRespawnQueue || game.dartBoxes.length >= DART_BOX_MAX_ON_MAP) return;
    game.dartBoxRespawnTimer = Math.max(0, (game.dartBoxRespawnTimer || respawnSeconds) - dt);
    if (game.dartBoxRespawnTimer > 0) return;
    game.dartBoxRespawnTimer = respawnSeconds;
    if (spawnRandomDartBox(game)) game.dartBoxRespawnQueue = Math.max(0, game.dartBoxRespawnQueue - 1);
  }

  function isDartBoxCollector(actor) {
    return !!(
      actor
      && actor.role === "survivor"
      && !actor.dead
      && !actor.escaped
      && !actor.hooked
      && !actor.downed
      && !actor.vault
      && actor.actionLock <= 0
      && !actor.healingTargetId
      && !actor.unhookTargetId
      && !actor.dotDepositTargetId
      && !(actor.activeHealers && actor.activeHealers.length > 0)
    );
  }

  function clearDartBoxProgressForMissingTargets(game) {
    const activeIds = new Set((game.dartBoxes || []).map((box) => box.id));
    for (const actor of game.actors.values()) {
      if (actor.role !== "survivor") continue;
      if (actor.dartBoxTargetId && !activeIds.has(actor.dartBoxTargetId)) {
        actor.dartBoxTargetId = null;
        actor.dartBoxProgress = 0;
      }
    }
  }

  function nearestDartBoxForActor(game, actor) {
    if (!isDartBoxCollector(actor)) return null;
    let best = null;
    let bestDist = Infinity;
    for (const box of game.dartBoxes || []) {
      const d = dist(actor.x, actor.y, box.x, box.y);
      if (d > DART_BOX_INTERACT_RADIUS || d >= bestDist) continue;
      if (!segmentClear(game, actor.x, actor.y, box.x, box.y)) continue;
      best = box;
      bestDist = d;
    }
    return best;
  }

  function replenishDartBoxAmmo(game, box, collector) {
    const affected = [];
    const isHealBox = isFfaGame(game) || box?.type === "heal";
    for (const runner of game.actors.values()) {
      if (runner.role !== "survivor" || runner.dead || runner.escaped || runner.hooked || runner.downed) continue;
      if (dist(box.x, box.y, runner.x, runner.y) > DART_BOX_AOE_RADIUS) continue;
      if (!segmentClear(game, box.x, box.y, runner.x, runner.y)) continue;
      if (isHealBox) {
        if ((runner.health || 2) < 2 || runner.injured) {
          runner.health = Math.min(2, Math.max(1, Number(runner.health || 1) + 1));
          if (runner.health >= 2) runner.injured = false;
          runner.invuln = Math.max(runner.invuln || 0, 0.35);
          affected.push(runner.id);
        }
      } else if (refillRunnerDartAmmo(runner, "dartBox")) affected.push(runner.id);
    }
    if (isHealBox && collector) awardStat(collector, "healBoxes", "Heal box", 1, "heal");
    addEvent(game, isHealBox ? "healBoxCollected" : "dartBoxCollected", {
      x: box.x,
      y: box.y,
      boxId: box.id,
      boxType: isHealBox ? "heal" : "dart",
      survivorId: collector?.id || null,
      actorId: collector?.id || null,
      affected,
      radius: DART_BOX_AOE_RADIUS,
      ammo: isHealBox ? null : Math.max(DART_AMMO_MAX, ...affected.map((id) => runnerDartMaxAmmo(game.actors.get(id))))
    });
    return affected;
  }

  function updateDartBoxes(game, dt) {
    updateDartBoxRespawns(game, dt);
    game.dartBoxes = game.dartBoxes || [];
    if (!game.dartBoxes.length) return;
    clearDartBoxProgressForMissingTargets(game);

    const collectorsByBox = new Map();
    for (const actor of game.actors.values()) {
      if (actor.role !== "survivor") continue;
      const box = nearestDartBoxForActor(game, actor);
      if (!box) {
        actor.dartBoxTargetId = null;
        actor.dartBoxProgress = 0;
        continue;
      }
      actor.dartBoxTargetId = box.id;
      const movingCollectScale = actorHasMoveInput(actor) ? DART_BOX_MOVING_COLLECT_MULT : 1;
      actor.dartBoxProgress = clamp((actor.dartBoxProgress || 0) + (dt * movingCollectScale) / DART_BOX_COLLECT_SECONDS, 0, 1);
      actor.input.angle = Math.atan2(box.y - actor.y, box.x - actor.x);
      if (!collectorsByBox.has(box.id)) collectorsByBox.set(box.id, { box, actors: [] });
      collectorsByBox.get(box.id).actors.push(actor);
    }

    for (let i = game.dartBoxes.length - 1; i >= 0; i -= 1) {
      const box = game.dartBoxes[i];
      const entry = collectorsByBox.get(box.id);
      const collectors = entry?.actors || [];
      box.progress = collectors.length ? Math.max(...collectors.map((actor) => actor.dartBoxProgress || 0)) : Math.max(0, (box.progress || 0) - dt * 0.55);
      box.activeCollectorId = collectors[0]?.id || null;
      if (box.progress >= 1) {
        replenishDartBoxAmmo(game, box, collectors[0] || null);
        for (const actor of game.actors.values()) {
          if (actor.dartBoxTargetId === box.id) {
            actor.dartBoxTargetId = null;
            actor.dartBoxProgress = 0;
          }
        }
        game.dartBoxes.splice(i, 1);
        queueDartBoxRespawn(game, 1);
      }
    }
  }

  function actorCanPickupDots(actor) {
    if (!actor || actor.dead || actor.escaped || actor.hooked || actor.downed) return false;
    if (actor.role === "survivor") return (actor.dots || 0) < SURVIVOR_DOT_MAX;
    if (actor.role === "killer") return (actor.dots || 0) < KILLER_DOT_MAX;
    return false;
  }

  function runnerClassPassive(actor) {
    if (!actor || actor.role !== "survivor") return {};
    return runnerClassPassiveEffect(actor) || {};
  }

  function survivorVaultDurationForActor(actor) {
    let duration = SURVIVOR_VAULT_TIME;
    const passive = runnerClassPassive(actor);
    const vaultMultiplier = Math.max(0.1, cfgNumber(passive?.vaultSpeedMultiplier, 1));
    const injuredVaultMultiplier = Math.max(0.1, cfgNumber(passive?.injuredVaultSpeedMultiplier, 1));
    const bestMultiplier = Math.max(vaultMultiplier, (actor?.injured || actor?.health <= 1) ? injuredVaultMultiplier : 1);
    if (actor?.role === "survivor" && bestMultiplier > 1.001) duration /= bestMultiplier;
    return duration;
  }

  function dotPickupRadiusForActor(actor) {
    if (actor?.role === "killer") return KILLER_DOT_PICKUP_RADIUS;
    const multiplier = cfgNumber(runnerClassPassive(actor)?.orbPickupRadiusMultiplier, 1);
    return SURVIVOR_DOT_PICKUP_RADIUS * Math.max(0.1, multiplier);
  }

  function loseSurvivorDots(game, survivor, mode = "hit", requestedLost = null) {
    if (!survivor || survivor.role !== "survivor") return;
    const held = Math.max(0, survivor.dots || 0);
    if (!held) return;

    const requested = Number(requestedLost);
    const lost = clamp(Number.isFinite(requested) ? Math.floor(requested) : held, 0, held);
    if (lost <= 0) return;

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
      let gain = 1;
      let bonusOrbs = 0;
      if (actor.role === "survivor" && (actor.doubleOrb || 0) > 0) {
        const chance = clamp(cfgNumber(actor.doubleOrbChance, 0), 0, 1);
        if (Math.random() < chance) {
          const minBonus = Math.max(0, Math.floor(cfgNumber(actor.doubleOrbMinBonus, 0)));
          const maxBonus = Math.max(minBonus, Math.floor(cfgNumber(actor.doubleOrbMaxBonus, minBonus)));
          bonusOrbs = minBonus + Math.floor(Math.random() * (maxBonus - minBonus + 1));
          gain += bonusOrbs;
        }
      }
      actor.dots = Math.min(maxDots, dotsBefore + gain);
      awardStat(actor, "orbsCollected", bonusOrbs > 0 ? "Double Orb pickup" : "Orb collected", Math.max(0, actor.dots - dotsBefore), "orb");
      if (actor.role === "survivor" && (game.redOrbs || 0) > 0) {
        actor.orbSlow = Math.max(actor.orbSlow || 0, cfgNumber(game.redOrbSlowSeconds, RED_ORB_SLOW_SECONDS));
        addEvent(game, "redOrbSlow", { x: actor.x, y: actor.y, survivorId: actor.id, duration: cfgNumber(game.redOrbSlowSeconds, RED_ORB_SLOW_SECONDS) });
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
        red: (game.redOrbs || 0) > 0,
        source: bonusOrbs > 0 ? "doubleOrb" : "pickup",
        bonusOrbs
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
    awardStat(killer, "hooks", "Runner bound", 1, "void");
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
    survivor.healingDartHeal = null;
    survivor.healingDartExecutionBlock = 0;
    clearReviveIframes(survivor);
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
    clearReviveIframes(survivor);
    survivor.hitBoost = 0;
    survivor.healProgress = 0;
    survivor.hookProgress = 0;
    survivor.unhookProgress = 0;
    survivor.dotDepositTargetId = null;
    survivor.dotDepositProgress = 0;
    survivor.dotDepositChain = 0;
    survivor.activeHealers = [];
    survivor.healingTargetId = null;
    survivor.healingDartHeal = null;
    survivor.healingDartExecutionBlock = 0;
    survivor.input.up = survivor.input.down = survivor.input.left = survivor.input.right = false;
    addEvent(game, "execute", { x: survivor.x, y: survivor.y, survivorId: survivor.id });
    const lobby = lobbyForGame(game);
    if (lobby) awardAccountRewardForActor(lobby, game, survivor, "death");
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
    survivor.healingDartHeal = null;
    survivor.healingDartExecutionBlock = 0;
    for (const actor of game.actors.values()) {
      if (actor.unhookTargetId === survivor.id) actor.unhookTargetId = null;
    }
    for (const rescuerId of rescuerIds) {
      const rescuer = game.actors.get(rescuerId);
      if (rescuer?.role === "survivor" && rescuer.id !== survivor.id) awardStat(rescuer, "unhooks", "Teammate rescued", 1, "team");
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
        const dartPickupBlocksExecution = shouldExecute && cfgNumber(target.healingDartExecutionBlock, 0) > 0;
        killer.hookActionType = shouldExecute ? "execute" : "hook";
        if (dartPickupBlocksExecution) {
          target.hookProgress = 0;
          killer.hookActionTargetId = null;
          killer.hookActionType = null;
        } else {
          const channelTime = shouldExecute ? EXECUTE_CHANNEL_TIME : HOOK_CHANNEL_TIME;
          target.hookProgress = clamp((target.hookProgress || 0) + dt / channelTime, 0, 1);
          activeHookTargets.add(target.id);
          if (target.hookProgress >= 1) {
            if (shouldExecute) executeSurvivor(game, target);
            else sendSurvivorToHook(game, target);
          }
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
      const helperSpeed = helpers.reduce((sum, helper) => sum + Math.max(0.1, cfgNumber(runnerClassPassive(helper)?.unhookActionSpeedMultiplier, 1)), 0);
      target.unhookProgress = clamp((target.unhookProgress || 0) + (dt * helperSpeed) / UNHOOK_TIME, 0, 1);
      activeUnhookTargets.add(target.id);
      if (target.unhookProgress >= 1) freeSurvivorFromHook(game, target, helpers);
    }

    for (const target of game.actors.values()) {
      if (target.role !== "survivor") continue;
      if (target.downed && !target.hooked && !activeHookTargets.has(target.id)) target.hookProgress = Math.max(0, (target.hookProgress || 0) - dt * 0.45);
      if (target.hooked && !activeUnhookTargets.has(target.id) && !target.healingDartUnhook) target.unhookProgress = Math.max(0, (target.unhookProgress || 0) - dt * 0.35);
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
        const healSpeedMultiplier = Math.max(0.1, cfgNumber(runnerClassPassive(healer)?.healActionSpeedMultiplier, 1));
        target.healProgress = clamp((target.healProgress || 0) + (dt * healSpeedMultiplier) / HEAL_TIME, 0, 1);
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
          clearReviveIframes(target);
          target.hitBoost = Math.max(target.hitBoost || 0, SURVIVOR_HIT_BOOST * 0.55);
          target.hookProgress = 0;
          target.healingDartExecutionBlock = 0;
        } else {
          target.health = 2;
          target.injured = false;
          target.invuln = 0;
        }
        target.healProgress = 0;
        target.activeHealers = [];
        addEvent(game, "healDone", { x: target.x, y: target.y, survivorId: target.id });
      } else if (target.activeHealers.length === 0 && !target.healingDartHeal) {
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
          const lobby = lobbyForGame(game);
          if (lobby) {
            const socket = io.sockets.sockets.get(actor.id);
            if (socket) {
              socket.emit("personalRunEnded", {
                status: "escaped",
                reason: "You slipped through the void. The run is still alive.",
                finalActors: buildEndActorStats(game)
              });
            }
            awardAccountRewardForActor(lobby, game, actor, "escape");
          }
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
    if (isFfaGame(game)) {
      const shooters = [...game.actors.values()].filter((p) => isFfaActor(p));
      const winner = shooters.find((p) => Math.floor(p.stats?.kills || 0) >= FFA_KILL_LIMIT);
      if (winner) {
        endGame(lobby, `ffa:${winner.id}`, `${winner.name || "Void Shooter"} wins Free-For-All with ${Math.floor(winner.stats?.kills || 0)} kills.`);
      }
      return;
    }
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

  function lobbyForGame(game) {
    if (!game) return null;
    for (const lobby of lobbies.values()) {
      if (lobby.game === game) return lobby;
    }
    return null;
  }

  function accountRewardForActor(actor) {
    const stats = ensureMatchStats(actor);
    if (isFfaActor(actor)) {
      return { amount: 0, source: "ffa", toastLabel: "FFA orbs" };
    }
    if (actor.role === "survivor") {
      return {
        amount: Math.max(0, Math.floor(Number(stats.orbsDeposited || 0))),
        source: "deposited",
        toastLabel: "deposited orbs"
      };
    }
    if (actor.role === "killer") {
      return {
        amount: Math.max(0, Math.floor(Number(stats.orbsStolen || 0))),
        source: "voidStolen",
        toastLabel: "stolen Void orbs"
      };
    }
    return { amount: 0, source: "none", toastLabel: "orbs" };
  }

  function matchProgressionContext(lobby, game, actor, reason = "match", winnerOverride = null) {
    const survivors = [...(game?.actors?.values?.() || [])].filter((p) => p.role === "survivor");
    const escapedCount = survivors.filter((p) => p.escaped).length;
    const endedAt = game?.endedAt || nowMs();
    const startedAt = game?.startedAt || endedAt;
    return {
      reason,
      winner: winnerOverride || game?.winner || null,
      escapedCount,
      totalSurvivors: survivors.length,
      matchSeconds: Math.max(0, (endedAt - startedAt) / 1000),
      lobbyId: lobby?.id || "",
      matchId: game?.matchId || `${lobby?.id || "lobby"}:${startedAt}`,
      role: actor?.role
    };
  }

  function progressionForActor(lobby, game, actor, reason = "match", winnerOverride = null) {
    if (!actor || (actor.role !== "survivor" && actor.role !== "killer")) return null;
    return computeMatchProgression({
      actor,
      stats: serializeMatchStats(actor),
      context: matchProgressionContext(lobby, game, actor, reason, winnerOverride),
      config: RIFTRUNNER_LEVELS
    });
  }

  function awardAccountRewardForActor(lobby, game, actor, reason = "match") {
    if (!accountService.authAvailable()) return;
    if (!lobby || !game || !actor || actor.isBot || !actor.accountId) return;
    if (actor.role !== "survivor" && actor.role !== "killer") return;
    if (actor.accountRewardAwarded || actor.accountRewardPending) return;

    const reward = accountRewardForActor(actor);
    const progression = progressionForActor(lobby, game, actor, reason);
    const orbsDeposited = reward.amount;
    if (orbsDeposited <= 0 && (!progression || progression.score <= 0)) return;

    const matchId = game.matchId || `${lobby.id}:${game.startedAt || nowMs()}`;
    actor.accountRewardPending = true;
    accountService.awardMatchProgression({
      accountId: actor.accountId,
      lobbyId: lobby.id,
      matchId,
      playerId: actor.id,
      playerName: actor.name,
      role: progression?.role || (actor.role === "killer" ? "void" : "runner"),
      reason,
      matchSeconds: progression?.matchSeconds || 0,
      baseScore: progression?.baseScore || 0,
      score: progression?.score || 0,
      accountXp: progression?.accountXp || 0,
      roleXp: progression?.roleXp || 0,
      orbsDeposited,
      breakdown: progression?.breakdown || []
    }).then((result) => {
      actor.accountRewardPending = false;
      if (!result?.account) return;
      actor.accountRewardAwarded = true;
      actor.accountRewardAwardReason = reason;
      actor.accountRewardSource = reward.source;
      actor.progressionAward = result.award || progression || null;
      const socket = io.sockets.sockets.get(actor.id);
      if (socket) {
        socket.data.account = result.account;
        socket.emit("accountState", {
          ok: true,
          account: result.account,
          skins: accountService.publicCatalog(),
          perks: accountService.publicPerkCatalog(),
          reward: {
            orbsDeposited: result.award?.orbsDeposited ?? orbsDeposited,
            levelRewardOrbs: result.award?.levelRewardOrbs || 0,
            reason,
            role: actor.role,
            source: reward.source,
            label: reward.toastLabel,
            progression: result.award || progression || null
          }
        });
      }
    }).catch((error) => {
      actor.accountRewardPending = false;
      console.error(`Failed to award ${reason} progression`, error.message || error);
    });
  }

  function awardAccountRewardsAfterMatch(lobby, game) {
    if (!accountService.authAvailable()) return;
    for (const actor of game.actors.values()) {
      awardAccountRewardForActor(lobby, game, actor, actor?.dead ? "death" : actor?.escaped ? "escape" : "match");
    }
  }

  function buildEndActorStats(game, winnerOverride = null, reason = "match") {
    if (!game?.actors) return [];
    const lobby = lobbyForGame(game);
    return [...game.actors.values()].filter((p) => p.role !== "spectator").map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      lobbyRole: p.lobbyRole || p.role,
      gameMode: p.gameMode || game.mode || GAME_MODE_STANDARD,
      kills: Math.floor(p.stats?.kills || 0),
      deaths: Math.floor(p.stats?.deaths || 0),
      dead: !!p.dead,
      escaped: !!p.escaped,
      downed: !!p.downed,
      hooked: !!p.hooked,
      health: p.health,
      stats: serializeMatchStats(p),
      progression: p.progressionAward || progressionForActor(lobby, game, p, reason, winnerOverride)
    }));
  }

  function endGame(lobby, winner, reason) {
    if (!lobby.game || lobby.game.phase === "ended") return;
    const game = lobby.game;
    const finalActors = buildEndActorStats(game, winner, reason);
    const finalSurvivors = finalActors.filter((p) => p.role === "survivor");
    const escapedCount = finalSurvivors.filter((p) => p.escaped).length;

    awardAccountRewardsAfterMatch(lobby, game);

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

  function resetMatchInputs(game) {
    if (!game?.actors) return;
    for (const actor of game.actors.values()) {
      if (!actor?.input) continue;
      const angle = Number.isFinite(actor.input.angle) ? actor.input.angle : actor.angle || 0;
      resetInput(actor.input);
      actor.input.angle = angle;
      actor.input.actionDir = null;
      actor.input.attackHeld = false;
      actor.input.attackReleased = false;
    }
  }

  function toggleAbilityTestMode(lobby, socketId) {
    if (!lobby?.game || lobby.game.phase !== "game") {
      return { ok: false, message: "Ability test mode only works during a match." };
    }
    const actor = lobby.game.actors.get(socketId);
    if (!actor || (actor.role !== "survivor" && actor.role !== "killer") || actor.dead || actor.escaped) {
      return { ok: false, message: "Only an active Runner or The Void can toggle ability testing." };
    }

    const currentLevel = abilityTestingLevel(actor);
    const nextLevel = currentLevel >= 3 ? 0 : currentLevel + 1;
    actor.abilityTestLevel = nextLevel;
    actor.abilityTestMode = nextLevel > 0;
    resetActorAbilityCooldowns(actor);

    const enabled = nextLevel > 0;
    const label = enabled ? `LV ${nextLevel}` : "OFF";
    addEvent(lobby.game, enabled ? "abilityTestingOn" : "abilityTestingOff", {
      x: actor.x,
      y: actor.y,
      actorId: actor.id,
      survivorId: actor.role === "survivor" ? actor.id : null,
      killerId: actor.role === "killer" ? actor.id : null,
      abilityTestLevel: nextLevel,
      text: enabled ? `Ability testing ${label}` : "Ability testing OFF",
      t: lobby.game.time || 0
    });
    io.to(socketId).emit("abilityTestModeChanged", { enabled, level: nextLevel });
    touchLobby(lobby);
    return {
      ok: true,
      enabled,
      level: nextLevel,
      message: enabled
        ? `Ability testing ${label}: all perks unlocked at level ${nextLevel}; costs/cooldowns zeroed.`
        : "Ability testing OFF: normal purchases, costs, and cooldowns restored."
    };
  }

  function canSocketControlPause(lobby, socketId) {
    if (!lobby || !socketId) return false;
    return lobby.hostId === socketId;
  }

  function setMatchPaused(lobby, socketId, paused) {
    if (!lobby?.game || lobby.game.phase !== "game") return false;
    if (!canSocketControlPause(lobby, socketId)) return false;
    const game = lobby.game;
    const nextPaused = !!paused;
    if (game.paused === nextPaused) return true;
    const controller = lobby.players.get(socketId) || game.actors.get(socketId);
    if (nextPaused) captureLiveBotAiDebug(game);
    game.paused = nextPaused;
    game.pausedBy = nextPaused ? socketId : null;
    game.pausedByName = nextPaused ? (controller?.name || "Host") : null;
    game.pausedAt = nextPaused ? nowMs() : null;
    resetMatchInputs(game);
    game.events.push({
      id: uid("evt"),
      type: nextPaused ? "matchPaused" : "matchResumed",
      text: nextPaused ? `Match paused by ${game.pausedByName}` : "Match resumed",
      t: game.time || 0
    });
    io.to(lobby.id).emit("matchPauseChanged", {
      paused: game.paused,
      pausedBy: game.pausedBy,
      pausedByName: game.pausedByName
    });
    touchLobby(lobby);
    return true;
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
    healDistance: HEAL_DISTANCE,
    dartBoxInteractRadius: DART_BOX_INTERACT_RADIUS,
    dartBoxAoeRadius: DART_BOX_AOE_RADIUS,
    applySurvivorAbility,
    getSurvivorAbilityDef,
    fireRunnerShootAbility,
    runnerDartMaxAmmo,
    pathfindLoopLimit: PERF.pathfindLoopLimit,
    pathCacheMax: PERF.pathCacheMax,
    enablePathCache: PERF.enablePathCache,
    recordPathCacheHit: () => { serverMetrics.pathCacheHits += 1; },
    recordPathCacheMiss: () => { serverMetrics.pathCacheMisses += 1; },
    getMapAnalysis: (game) => game?.mapAnalysis || null
  });

  function updateFfaRespawns(game, dt) {
    if (!isFfaGame(game)) return;
    for (const actor of game.actors.values()) {
      if (!isFfaActor(actor)) continue;
      if (actor.dead || actor.downed || Number(actor.health || 0) <= 0) {
        actor.ffaRespawnTimer = Math.max(0, cfgNumber(actor.ffaRespawnTimer || FFA_RESPAWN_SECONDS, FFA_RESPAWN_SECONDS) - dt);
        if (actor.ffaRespawnTimer <= 0) respawnFfaActor(game, actor);
      }
    }
  }

  function clearOneShotInputs(game) {
    if (!game?.actors) return;
    for (const actor of game.actors.values()) {
      if (!actor?.input) continue;
      actor.input.action = false;
      actor.input.attack = false;
      actor.input.attackReleased = false;
    }
  }

  function updateGame(lobby, dt) {
    const game = lobby.game;
    if (!game || game.phase !== "game") return;

    if (game.paused) {
      resetMatchInputs(game);
      return;
    }

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

    if (isFfaGame(game)) {
      updateTimers(game, dt);
      updateRunnerProjectiles(game, dt);
      updateDartBoxes(game, dt);
      updateFfaRespawns(game, dt);
      for (const actor of game.actors.values()) {
        if (actor.role !== "spectator") moveActor(game, actor, dt);
      }
      for (const actor of game.actors.values()) {
        if (actor.role !== "spectator" && actor.input.action) handleAction(game, actor);
      }
      checkWinConditions(lobby);
      clearOneShotInputs(game);
      return;
    }

    game.botThinkAccumulator = (game.botThinkAccumulator || 0) + dt;
    if (game.botThinkAccumulator >= 1 / BOT_THINK_RATE) {
      const botDt = game.botThinkAccumulator;
      game.botThinkAccumulator = 0;
      botAi.updateBotInputs(game, botDt, BOT_AI_HELPERS);
    }
    updateTimers(game, dt);
    updateRunnerProjectiles(game, dt);
    updateHookInteractions(game, dt);
    updateGeneratorKicks(game, dt);
    const killer = [...game.actors.values()].find((p) => p.role === "killer");
    for (const actor of game.actors.values()) {
      if (actor.role !== "spectator") moveActor(game, actor, dt);
    }
    updateVoidSwirls(game, 0);
    updateCollectibleDots(game, dt);
    updateDartBoxes(game, dt);
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
    if (isFfaGame(game)) return !actor.dead && !actor.escaped && actor.role !== "spectator";
    if (viewer.role === "spectatorOverview") return !actor.dead && !actor.escaped;
    if (actor.dead || actor.escaped) return false;
    if (smokeBlocksViewerPoint(game, viewer, actor.x, actor.y)) return false;

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
      .filter((h) => !viewer || viewer.role === "spectatorOverview" || !smokeBlocksViewerPoint(game, viewer, h.x, h.y))
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


  const {
    captureLiveBotAiDebug,
    serializeBotAiDebug,
    serializeBotDebug
  } = createBotDebugTools({
    nowMs,
    clamp,
    survivorDotMax: SURVIVOR_DOT_MAX,
    killerDotMax: KILLER_DOT_MAX
  });


  function shouldSendFullActorSnapshot(viewer, actor, visible, spectatorOverview = false) {
    if (!actor) return false;
    if (!viewer) return true;
    if (spectatorOverview) return true;
    if (actor.id === viewer.id) return true;
    if (visible) return true;
    // Survivor HUD needs rescue/death state for teammates even when fog hides their body.
    if (viewer.role === "survivor" && actor.role === "survivor" && (actor.hooked || actor.downed || actor.dead || actor.escaped)) return true;
    return false;
  }

  function serializeActor(game, actor, visible = true, options = {}) {
    const lobbyRole = actor.lobbyRole || actor.role;
    const actorSkin = sanitizeRoleSkin(lobbyRole, actor.skin);
    const isSelf = !!options.isSelf;
    const sendDebug = !!options.sendBotDebug && !!actor.isBot;
    const debugPayload = sendDebug ? serializeBotAiDebug(game, actor) : null;
    const chatText = (() => {
      const text = actor.chatUntil > (game.time || 0) ? actor.chatText : null;
      if ((actor.downed || actor.hooked || actor.dead || actor.escaped) && isOrbFullChatMessage(text)) return null;
      return text;
    })();

    const base = {
      id: actor.id,
      name: actor.name,
      role: actor.role,
      lobbyRole,
      gameMode: actor.gameMode || game.mode || GAME_MODE_STANDARD,
      isBot: !!actor.isBot,
      skin: actorSkin,
      runnerClass: actor.role === "survivor" && !isFfaActor(actor) ? normalizeRunnerClassId(actor.runnerClass) : null,
      visible: !!visible,
      x: Math.round((actor.x || 0) * 10) / 10,
      y: Math.round((actor.y || 0) * 10) / 10,
      angle: Number((actor.angle || 0).toFixed(2)),
      moving: !!(actor.vault || actorHasMoveInput(actor)),
      sprinting: actor.role === "survivor" && !!actor.input?.sprint && !!actorHasMoveInput(actor),
      health: actor.health,
      dots: actor.role === "killer" ? clamp(actor.dots || 0, 0, KILLER_DOT_MAX) : actor.role === "survivor" ? clamp(actor.dots || 0, 0, SURVIVOR_DOT_MAX) : 0,
      injured: !!actor.injured,
      dead: !!actor.dead,
      escaped: !!actor.escaped,
      downed: !!actor.downed,
      hooked: !!actor.hooked,
      hookId: actor.hookId || null,
      hookCount: actor.hookCount || 0,
      hookProgress: actor.hookProgress || 0,
      kills: Math.floor(actor.stats?.kills || 0),
      deaths: Math.floor(actor.stats?.deaths || 0),
      respawnRemaining: isFfaActor(actor) ? Number(Math.max(0, actor.ffaRespawnTimer || 0).toFixed(2)) : 0,
      unhookProgress: actor.unhookProgress || 0,
      escapeProgress: actor.role === "survivor" ? quantizedProgress((actor.escapeProgress || 0) / GATE_ESCAPE_TIME) : 0,
      escapeGateId: actor.role === "survivor" ? actor.escapeGateId || null : null,
      chase: actor.chaseHold > 0,
      chatText,
      aiDebug: debugPayload,
      abilityTestMode: abilityTestingEnabled(actor),
      abilityTestLevel: abilityTestingLevel(actor),
      nebulizerVaporTrail: actor.role === "survivor" ? actor.nebulizerVaporTrail || 0 : 0,
      nebulizerVaporTrailMultiplier: actor.role === "survivor" ? actor.nebulizerVaporTrailMultiplier || 1 : 1
    };

    if (!options.full) return base;

    return {
      ...base,
      dotDepositTargetId: actor.role === "survivor" ? actor.dotDepositTargetId || null : null,
      dotDepositProgress: actor.role === "survivor" ? quantizedProgress(actor.dotDepositProgress || 0) : 0,
      hookActionTargetId: actor.hookActionTargetId || null,
      hookActionType: actor.hookActionType || null,
      hookReadyTargetId: actor.role === "killer" && isSelf ? (nearestDownedSurvivorForHook(game, actor)?.id || null) : null,
      generatorKickTargetId: actor.generatorKickTargetId || null,
      generatorKickProgress: actor.generatorKickProgress || 0,
      unhookTargetId: actor.unhookTargetId || null,
      recovery: actor.recovery,
      voidStun: actor.role === "killer" ? actor.voidStun || 0 : 0,
      voidSpeedBoost: actor.role === "killer" ? actor.voidSpeedBoost || 0 : 0,
      voidSwirlSlow: actor.role === "killer" ? actor.voidSwirlSlow || 0 : 0,
      voidSwirlSlowMultiplier: actor.role === "killer" ? actor.voidSwirlSlowMultiplier || 1 : 1,
      voidAbilityCooldowns: actor.role === "killer" && isSelf ? Object.fromEntries(
        Object.entries(actor.voidAbilityCooldowns || {}).map(([id, remaining]) => [id, Number(Math.max(0, remaining || 0).toFixed(2))])
      ) : {},
      perkLevels: isSelf && (actor.role === "killer" || actor.role === "survivor") ? actor.perkLevels || {} : {},
      runnerLevel: actor.role === "survivor" && isSelf ? actorRunnerLevel(actor) : 1,
      stealthStep: actor.role === "survivor" ? actor.stealthStep || 0 : 0,
      riftLens: actor.role === "survivor" ? actor.riftLens || 0 : 0,
      hourglass: actor.role === "survivor" ? actor.hourglass || 0 : 0,
      speedBurst: actor.role === "survivor" ? actor.speedBurst || 0 : 0,
      dashBoost: actor.role === "survivor" ? actor.dashBoost || 0 : 0,
      dashBoostMultiplier: actor.role === "survivor" ? actor.dashBoostMultiplier || 1 : 1,
      dartScratchHidden: actor.role === "survivor" ? actor.dartScratchHidden || 0 : 0,
      doubleOrb: actor.role === "survivor" ? actor.doubleOrb || 0 : 0,
      swiftVaultReady: actor.role === "survivor" ? actor.swiftVaultReady || 0 : 0,
      survivorAbilityCooldowns: actor.role === "survivor" && isSelf && !isFfaActor(actor) ? Object.fromEntries(
        Object.entries(actor.survivorAbilityCooldowns || {}).map(([id, remaining]) => [id, Number(Math.max(0, remaining || 0).toFixed(2))])
      ) : {},
      ffaShotCooldownRemaining: actor.role === "survivor" && isSelf && isFfaActor(actor) ? Number(Math.max(0, cfgNumber(actor.ffaShotCooldown, 0)).toFixed(2)) : 0,
      runnerDartAmmo: actor.role === "survivor" && isSelf && !isFfaActor(actor) ? Math.max(0, Math.floor(cfgNumber(actor.runnerDartAmmo, runnerDartMaxAmmo(actor)))) : 0,
      runnerDartMaxAmmo: actor.role === "survivor" && isSelf && !isFfaActor(actor) ? runnerDartMaxAmmo(actor) : 0,
      runnerDartReloadRemaining: 0,
      runnerDartFireLockoutRemaining: actor.role === "survivor" && isSelf ? Number(Math.max(0, cfgNumber(isFfaActor(actor) ? actor.ffaShotCooldown : actor.runnerDartFireLockout, 0)).toFixed(2)) : 0,
      dartBoxTargetId: actor.role === "survivor" ? actor.dartBoxTargetId || null : null,
      dartBoxProgress: actor.role === "survivor" ? quantizedProgress(actor.dartBoxProgress || 0) : 0,
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
      vaultDuration: actor.vault ? Number(actor.vault.duration.toFixed(3)) : 0,
      windowVaultCooldown: actor.role === "survivor" && isSelf ? Number((actor.windowVaultCooldown || 0).toFixed(2)) : 0,
      breaking: !!actor.breakTarget,
      invuln: actor.invuln,
      reviveInvuln: actor.role === "survivor" ? actor.reviveInvuln || 0 : 0,
      hitBoost: actor.hitBoost,
      healProgress: actor.healProgress || 0,
      activeHealers: actor.activeHealers || [],
      healingTargetId: actor.healingTargetId || null,
      killerVisibleHold: actor.killerVisibleHold || 0
    };
  }

  function quantizedProgress(value) {
    if (value >= 1) return 1;
    // Keep repair traffic smooth but bounded. Sending microscopic 60Hz float changes
    // during generator repair is how a browser tab becomes a sad space heater.
    return Math.round(clamp(value || 0, 0, 1) * 50) / 50;
  }

  function canViewerSeeGeneratorDetails(game, viewer, gen) {
    if (!viewer || viewer.role === "spectatorOverview") return true;
    if (smokeBlocksViewerPoint(game, viewer, gen.x, gen.y)) return false;
    if (viewer.role !== "killer") return true;
    const d = dist(viewer.x, viewer.y, gen.x, gen.y);
    if (d <= CLOSE_REVEAL_RADIUS) return segmentClear(game, viewer.x, viewer.y, gen.x, gen.y);
    if (d > KILLER_CONE_LENGTH) return false;
    return segmentClear(game, viewer.x, viewer.y, gen.x, gen.y)
      && coneSees(viewer, { x: gen.x, y: gen.y }, KILLER_CONE_LENGTH, KILLER_CONE_ANGLE);
  }

  function canViewerSeeCollectibleDot(game, viewer, dot) {
    if (!viewer || !dot || viewer.dead || viewer.escaped || viewer.hooked) return false;
    if (viewer.role === "spectatorOverview") return true;
    if (smokeBlocksViewerPoint(game, viewer, dot.x, dot.y)) return false;

    // Orbs should respect the same close reveal bubble that keeps nearby walls
    // and actors readable. The cone still matters at range, but nearby orbs no
    // longer disappear just because the Runner/Void is facing a few degrees away.
    const d = dist(viewer.x, viewer.y, dot.x, dot.y);
    if (d <= CLOSE_REVEAL_RADIUS) return segmentClear(game, viewer.x, viewer.y, dot.x, dot.y);

    if (viewer.role === "survivor") return survivorCanSeePoint(game, viewer, dot.x, dot.y, { allowCloseReveal: false });
    const length = KILLER_CONE_LENGTH;
    const angle = KILLER_CONE_ANGLE;
    const target = { x: dot.x, y: dot.y };
    if (d > length) return false;
    return coneSees(viewer, target, length, angle) && segmentClear(game, viewer.x, viewer.y, dot.x, dot.y);
  }

  function visibleCollectibleDotsForViewer(game, viewer) {
    if (isFfaGame(game)) return [];
    if (!viewer) return [];
    return (game.collectibleDots || []).filter((dot) => canViewerSeeCollectibleDot(game, viewer, dot));
  }

  function canViewerSeeDartBox(game, viewer, box) {
    if (!viewer || !box || viewer.dead || viewer.escaped || viewer.hooked) return false;
    if (viewer.role === "spectatorOverview") return true;
    if (smokeBlocksViewerPoint(game, viewer, box.x, box.y)) return false;
    if (viewer.role === "survivor") return survivorCanSeePoint(game, viewer, box.x, box.y, { allowCloseReveal: true });
    const d = dist(viewer.x, viewer.y, box.x, box.y);
    if (d <= CLOSE_REVEAL_RADIUS) return segmentClear(game, viewer.x, viewer.y, box.x, box.y);
    if (d > KILLER_CONE_LENGTH) return false;
    return coneSees(viewer, { x: box.x, y: box.y }, KILLER_CONE_LENGTH, KILLER_CONE_ANGLE) && segmentClear(game, viewer.x, viewer.y, box.x, box.y);
  }

  function visibleDartBoxesForViewer(game, viewer) {
    if (!viewer) return [];
    const boxes = game.dartBoxes || [];
    if (isFfaGame(game)) {
      if (viewer.role === "spectatorOverview") return boxes;
      return boxes.filter((box) => !smokeBlocksViewerPoint(game, viewer, box.x, box.y));
    }
    return boxes.filter((box) => canViewerSeeDartBox(game, viewer, box));
  }

  function visibleVoidSwirlsForViewer(game, viewer, spectatorOverview = false) {
    const swirls = Array.isArray(game?.voidSwirls) ? game.voidSwirls : [];
    if (!swirls.length) return [];
    if (spectatorOverview) return swirls;
    if (!viewer || viewer.dead || viewer.escaped || viewer.hooked) return [];
    return swirls.filter((swirl) => {
      if (!swirl || !Number.isFinite(swirl.x) || !Number.isFinite(swirl.y)) return false;
      return visibleWorldPointForViewer(game, viewer, swirl.x, swirl.y, { radius: swirl.radius || VOID_SWIRL_DEFAULT_RADIUS, allowCloseReveal: true });
    });
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

  function snapshotListKey(items, mapper) {
    if (!Array.isArray(items) || !items.length) return "";
    return items.map(mapper).join("|");
  }

  function compactValueKey(value) {
    if (value == null) return value;
    if (typeof value !== "object") return value;
    try { return JSON.stringify(value); }
    catch { return String(value); }
  }

  function compactActorSnapshotsForSocket(cache, actors) {
    if (!cache || !Array.isArray(actors) || !actors.length) return actors;
    const previousById = cache.actorsById instanceof Map ? cache.actorsById : null;
    const nextById = new Map();
    const compacted = actors.map((actor) => {
      if (!actor || !actor.id) return actor;
      nextById.set(actor.id, actor);
      const previous = previousById?.get(actor.id);
      if (!previous) return actor;
      const delta = { id: actor.id };
      for (const [key, value] of Object.entries(actor)) {
        if (key === "id") continue;
        if (compactValueKey(previous[key]) !== compactValueKey(value)) delta[key] = value;
      }
      return Object.keys(delta).length <= 1 ? { id: actor.id } : delta;
    });
    cache.actorsById = nextById;
    return compacted;
  }

  function visibleWorldPointForViewer(game, viewer, x, y, options = {}) {
    if (!viewer || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (viewer.role === "spectatorOverview") return true;
    if (viewer.dead || viewer.escaped || viewer.hooked) return false;
    if (smokeBlocksViewerPoint(game, viewer, x, y)) return false;
    const radius = Math.max(0, cfgNumber(options.radius, 0));
    const d = dist(viewer.x, viewer.y, x, y);
    if (d <= CLOSE_REVEAL_RADIUS + radius) return segmentClear(game, viewer.x, viewer.y, x, y);
    if (viewer.role === "survivor") return survivorCanSeePoint(game, viewer, x, y, { allowCloseReveal: options.allowCloseReveal !== false });
    if (viewer.role === "killer") {
      if (d > KILLER_CONE_LENGTH + radius) return false;
      return coneSees(viewer, { x, y }, KILLER_CONE_LENGTH + radius, KILLER_CONE_ANGLE) && segmentClear(game, viewer.x, viewer.y, x, y);
    }
    return false;
  }

  function visibleRunnerProjectilesForViewer(game, viewer, socketId, spectatorOverview = false) {
    const projectiles = Array.isArray(game?.runnerProjectiles) ? game.runnerProjectiles : [];
    if (spectatorOverview) return projectiles;
    if (!viewer) return [];
    return projectiles.filter((p) => {
      if (!p) return false;
      if (smokeBlocksViewerPoint(game, viewer, p.x, p.y)) return false;
      if (isFfaGame(game)) return true;
      if (String(p.ownerId || "") === String(socketId || viewer.id || "")) return true;
      return visibleWorldPointForViewer(game, viewer, p.x, p.y, { radius: 18, allowCloseReveal: true });
    });
  }

  function viewerInsideSmokeCloud(viewer, cloud) {
    return !!(viewer && cloud && smokeContainsPoint(cloud, viewer.x, viewer.y));
  }

  function visibleSmokeCloudsForViewer(game, viewer, spectatorOverview = false) {
    const clouds = Array.isArray(game?.smokeClouds) ? game.smokeClouds : [];
    if (spectatorOverview) return clouds;
    if (!viewer || viewer.dead || viewer.escaped || viewer.hooked) return [];
    const viewerClouds = clouds.filter((cloud) => viewerInsideSmokeCloud(viewer, cloud));
    if (viewerClouds.length) return viewerClouds;
    return clouds.filter((cloud) => {
      if (!cloud) return false;
      const radius = Math.max(0, cfgNumber(cloud.radius, 0));
      const d = dist(viewer.x, viewer.y, cloud.x, cloud.y);
      if (d <= CLOSE_REVEAL_RADIUS + Math.min(radius, 140)) return segmentClear(game, viewer.x, viewer.y, cloud.x, cloud.y);
      if (viewer.role === "survivor") return survivorCanSeePoint(game, viewer, cloud.x, cloud.y, { allowCloseReveal: true });
      if (viewer.role === "killer") {
        if (d > KILLER_CONE_LENGTH + Math.min(radius, 140)) return false;
        return coneSees(viewer, { x: cloud.x, y: cloud.y }, KILLER_CONE_LENGTH + Math.min(radius, 140), KILLER_CONE_ANGLE)
          && segmentClear(game, viewer.x, viewer.y, cloud.x, cloud.y);
      }
      return false;
    });
  }

  // State-change events should be delivered to every viewer, not only nearby players.
  // The client also has state-transition fallbacks, but broadcasting these keeps
  // match announcements timely and avoids range-based "someone got bound and nobody heard" moments.
  const GLOBAL_EVENT_TYPES = new Set(["genDone", "voidOpen", "escape", "hooked", "unhooked", "death", "execute", "ffaHit", "ffaKill", "ffaRespawn", "healBoxCollected"]);
  const LOCAL_EVENT_RANGE = Math.max(900, cfgNumber(GAMEPLAY_CONFIG.server?.eventSendRange, 1250));

  function eventActorIds(event) {
    const ids = [];
    for (const key of ["actorId", "survivorId", "killerId", "healerId", "targetId", "ownerId", "collectorId"]) {
      if (event?.[key]) ids.push(String(event[key]));
    }
    if (Array.isArray(event?.affected)) {
      for (const id of event.affected) if (id) ids.push(String(id));
    }
    if (Array.isArray(event?.boostedIds)) {
      for (const id of event.boostedIds) if (id) ids.push(String(id));
    }
    return ids;
  }

  function eventVisibleToViewer(game, viewer, socketId, event, spectatorOverview = false) {
    if (!event) return false;
    if (spectatorOverview || GLOBAL_EVENT_TYPES.has(event.type)) return true;
    const ids = eventActorIds(event);
    const viewerIds = new Set([String(socketId || ""), String(viewer?.id || "")]);
    if (ids.some((id) => viewerIds.has(id))) return true;
    if (!viewer || !Number.isFinite(event.x) || !Number.isFinite(event.y)) return true;
    if (smokeBlocksViewerPoint(game, viewer, event.x, event.y)) return false;
    return dist(viewer.x, viewer.y, event.x, event.y) <= LOCAL_EVENT_RANGE;
  }

  function eventsForViewer(game, viewer, socketId, spectatorOverview = false) {
    const events = Array.isArray(game?.events) ? game.events : [];
    if (!events.length) return [];
    return events.filter((event) => eventVisibleToViewer(game, viewer, socketId, event, spectatorOverview));
  }

  function trimUnchangedSnapshotForSocket(game, socketId, snapshot) {
    if (!game || !socketId || !snapshot?.map) return snapshot;
    const cache = game.snapshotClientCache || (game.snapshotClientCache = new Map());
    const previous = cache.get(socketId) || null;
    const map = snapshot.map;
    const keys = {
      pallets: snapshotListKey(map.pallets, (p) => `${p.id}:${p.state}:${p.broken ? 1 : 0}`),
      generators: snapshotListKey(map.generators, (g) => `${g.id}:${g.showProgress ? 1 : 0}:${Math.round((g.progress || 0) * 50)}:${g.done ? 1 : 0}:${g.repairing ? 1 : 0}:${g.dotDepositing ? 1 : 0}:${Math.round((g.dotDepositProgress || 0) * 12)}:${g.beingKicked ? 1 : 0}:${Math.round((g.kickProgress || 0) * 12)}:${g.kickLocked ? 1 : 0}`),
      gates: snapshotListKey(map.gates, (g) => `${g.id}:${g.open ? 1 : 0}:${Math.round((g.escapeProgress || 0) * 20)}`),
      hooks: snapshotListKey(map.hooks, (h) => `${h.id}:${h.active ? 1 : 0}:${h.survivorId || ""}`),
      dots: snapshotListKey(snapshot.collectibleDots, (d) => `${d.id}:${d.red ? 1 : 0}`),
      runnerProjectiles: snapshotListKey(snapshot.runnerProjectiles, (p) => `${p.id}:${Math.round(p.x)}:${Math.round(p.y)}:${p.type || ""}`),
      dartBoxes: snapshotListKey(snapshot.dartBoxes, (b) => `${b.id}:${Math.round(b.x)}:${Math.round(b.y)}:${Math.round((b.progress || 0) * 20)}:${b.type || ""}`),
      smokeClouds: snapshotListKey(snapshot.smokeClouds, (c) => `${c.id}:${Math.round(c.x)}:${Math.round(c.y)}:${Math.round(c.radius)}`),
      voidSwirls: snapshotListKey(snapshot.voidSwirls, (s) => `${s.id}:${Math.round(s.x)}:${Math.round(s.y)}:${Math.round(s.radius)}:${Math.round((s.remaining || 0) * 10)}`),
      scratchMarks: snapshotListKey(snapshot.scratchMarks, (s) => s.id)
    };
    const nextCache = { ...keys, actorsById: previous?.actorsById instanceof Map ? previous.actorsById : null };
    cache.set(socketId, nextCache);
    if (!previous) {
      nextCache.actorsById = new Map((snapshot.actors || []).filter(Boolean).map((actor) => [actor.id, actor]));
      return snapshot;
    }
    snapshot.actors = compactActorSnapshotsForSocket(nextCache, snapshot.actors);

    const nextMap = { ...map };
    if (previous.pallets === keys.pallets) delete nextMap.pallets;
    if (previous.generators === keys.generators) delete nextMap.generators;
    if (previous.gates === keys.gates) delete nextMap.gates;
    if (previous.hooks === keys.hooks) delete nextMap.hooks;
    snapshot.map = nextMap;
    if (previous.dots === keys.dots) delete snapshot.collectibleDots;
    if (previous.runnerProjectiles === keys.runnerProjectiles) delete snapshot.runnerProjectiles;
    if (previous.dartBoxes === keys.dartBoxes) delete snapshot.dartBoxes;
    if (previous.smokeClouds === keys.smokeClouds) delete snapshot.smokeClouds;
    if (previous.voidSwirls === keys.voidSwirls) delete snapshot.voidSwirls;
    if (previous.scratchMarks === keys.scratchMarks) delete snapshot.scratchMarks;
    return snapshot;
  }

  function buildSnapshotFor(lobby, socketId) {
    const game = lobby.game;
    const viewer = game.actors.get(socketId);
    const spectatorOverview = isSpectatorOverviewViewer(viewer);
    const pov = getViewerForVisibility(game, viewer);
    const map = game.map;
    const sendBotDebug = !!(game.paused || viewer?.botDebugEnabled || lobby.players.get(socketId)?.botDebugEnabled);
    const actors = [];
    for (const actor of game.actors.values()) {
      if (actor.role === "spectator") continue;
      const visible = isActorVisibleToViewer(game, pov, actor);
      const full = shouldSendFullActorSnapshot(viewer, actor, visible, spectatorOverview);
      actors.push(serializeActor(game, actor, visible, {
        full,
        isSelf: actor.id === socketId,
        sendBotDebug
      }));
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
            if (smokeBlocksViewerPoint(game, pov, s.x, s.y)) return false;
            const d = dist(pov.x, pov.y, s.x, s.y);
            if (d > KILLER_SCRATCH_MARK_VISIBILITY_RANGE) return false;
            const target = { x: s.x, y: s.y };
            return coneSees(pov, target, KILLER_SCRATCH_MARK_VISIBILITY_RANGE, KILLER_CONE_ANGLE) && segmentClear(game, pov.x, pov.y, s.x, s.y);
          })
        : [];

    const ffaMode = isFfaGame(game);
    const doneGenerators = ffaMode ? 0 : map.generators.reduce((count, g) => count + (g.done ? 1 : 0), 0);
    const requiredGenerators = ffaMode ? 0 : game.requiredGenerators;
    const riftsComplete = ffaMode ? false : areRiftsComplete(game);
    const ffaScoreboard = ffaMode ? [...game.actors.values()]
      .filter((actor) => isFfaActor(actor))
      .map((actor) => ({
        id: actor.id,
        name: actor.name,
        kills: Math.floor(actor.stats?.kills || 0),
        deaths: Math.floor(actor.stats?.deaths || 0),
        dead: !!actor.dead,
        respawnRemaining: Number(Math.max(0, actor.ffaRespawnTimer || 0).toFixed(2))
      }))
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name)) : [];

    const snapshot = {
      lobbyId: lobby.id,
      mode: ffaMode ? GAME_MODE_FFA : GAME_MODE_STANDARD,
      killLimit: ffaMode ? FFA_KILL_LIMIT : null,
      seq: game.snapshotSeq || 0,
      serverTime: Number((game.time || 0).toFixed(3)),
      paused: !!game.paused,
      pausedBy: game.pausedBy || null,
      pausedByName: game.pausedByName || null,
      canPause: canSocketControlPause(lobby, socketId),
      matchStartFreezeRemaining: Math.max(0, (game.matchStartFreezeSeconds || MATCH_START_FREEZE_SECONDS) - (game.time || 0)),
      map: {
        width: map.width,
        height: map.height,
        tile: map.tile,
        pallets: map.pallets.map((p) => ({ id: p.id, x: p.x, y: p.y, w: p.w, h: p.h, orientation: p.orientation, state: p.state, broken: p.broken })),
        generators: ffaMode ? [] : visibleGeneratorsForSnapshot(game, pov, spectatorOverview).map((g) => serializeGeneratorForViewer(game, pov, g)),
        riftsHidden: ffaMode ? true : riftsComplete,
        gates: ffaMode ? [] : map.gates.filter((g) => spectatorOverview || !pov || !smokeBlocksViewerPoint(game, pov, g.x, g.y)).map((g) => ({
          id: g.id,
          x: g.x,
          y: g.y,
          open: g.open,
          escapeProgress: Math.max(0, ...[...game.actors.values()]
            .filter((a) => a.role === "survivor" && !a.dead && !a.escaped && a.escapeGateId === g.id)
            .map((a) => quantizedProgress((a.escapeProgress || 0) / GATE_ESCAPE_TIME)))
        })),
        hooks: ffaMode ? [] : hooksForSnapshot(game, pov)
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
        canPlay: viewer.role !== "spectator" && !viewer.dead && !viewer.escaped,
        canPause: canSocketControlPause(lobby, socketId)
      } : { id: socketId, role: null, spectating: false, spectateTargetId: null, canPlay: false, canPause: false },
      actors,
      events: eventsForViewer(game, pov, socketId, spectatorOverview),
      scratchMarks: visibleScratchMarks.map((s) => ({
        id: s.id,
        x: Math.round((s.x || 0) * 10) / 10,
        y: Math.round((s.y || 0) * 10) / 10,
        angle: Number((s.angle || 0).toFixed(2)),
        expiresAt: Number(((s.createdAt || 0) + SCRATCH_MARK_TTL).toFixed(3))
      })),
      objective: {
        mode: ffaMode ? GAME_MODE_FFA : GAME_MODE_STANDARD,
        killLimit: ffaMode ? FFA_KILL_LIMIT : null,
        scoreboard: ffaScoreboard,
        doneGenerators,
        requiredGenerators,
        totalGenerators: ffaMode ? 0 : map.generators.length,
        generatorCandidateCount: ffaMode ? 0 : (map.generatorCandidateCount || map.generators.length),
        spawnedGenerators: ffaMode ? 0 : (map.spawnedGenerators || map.generators.length),
        remainingGenerators: Math.max(0, requiredGenerators - doneGenerators),
        riftsHidden: riftsComplete,
        escapeOpen: game.escapeOpen,
        voidBuffed: !!(game.riftEndgameActive || riftsComplete),
        voidSpeedMultiplier: (game.riftEndgameActive || riftsComplete) ? KILLER_ENDGAME_SPEED_MULT : 1
      },
      collectibleDots: visibleCollectibleDotsForViewer(game, pov).map((d) => ({ id: d.id, x: Math.round(d.x), y: Math.round(d.y), red: (game.redOrbs || 0) > 0 })),
      dartBoxes: visibleDartBoxesForViewer(game, pov).map((box) => ({
        id: box.id,
        x: Math.round(box.x),
        y: Math.round(box.y),
        progress: quantizedProgress(box.progress || 0),
        active: !!box.activeCollectorId,
        type: box.type || (ffaMode ? "heal" : "dart"),
        radius: DART_BOX_AOE_RADIUS
      })),
      runnerProjectiles: visibleRunnerProjectilesForViewer(game, pov, socketId, spectatorOverview).map((p) => ({
        id: p.id,
        type: p.kind || p.type || "runnerProjectile",
        abilityId: p.abilityId || p.type || null,
        ownerId: p.ownerId,
        x: Math.round((p.x || 0) * 10) / 10,
        y: Math.round((p.y || 0) * 10) / 10,
        angle: Number((p.angle || 0).toFixed(2)),
        speed: Math.round(p.speed || DART_DEFAULT_PROJECTILE_SPEED),
        radius: Math.round(p.radius || DART_DEFAULT_RADIUS)
      })),
      smokeClouds: visibleSmokeCloudsForViewer(game, pov, spectatorOverview).map((c) => ({
        id: c.id,
        ownerId: c.ownerId,
        x: Math.round((c.x || 0) * 10) / 10,
        y: Math.round((c.y || 0) * 10) / 10,
        radius: Math.round(c.radius || 0),
        duration: Number((c.duration || 0).toFixed(1)),
        remaining: Number((c.remaining || 0).toFixed(1)),
        viewerInside: !spectatorOverview && !!pov && viewerInsideSmokeCloud(pov, c)
      })),
      voidSwirls: visibleVoidSwirlsForViewer(game, pov, spectatorOverview).map((s) => ({
        id: s.id,
        ownerId: s.ownerId,
        x: Math.round((s.x || 0) * 10) / 10,
        y: Math.round((s.y || 0) * 10) / 10,
        radius: Math.round(s.radius || 0),
        duration: Number((s.duration || 0).toFixed(1)),
        remaining: Number((s.remaining || 0).toFixed(1)),
        slowMultiplier: Number((s.slowMultiplier || VOID_SWIRL_DEFAULT_SLOW_MULT).toFixed(2)),
        slowDuration: Number((s.slowDuration || VOID_SWIRL_DEFAULT_SLOW_SECONDS).toFixed(2))
      })),
      voidEffects: {
        redOrbs: Number((game.redOrbs || 0).toFixed(2)),
        runnerReveal: Number((game.runnerReveal || 0).toFixed(2))
      },
      music
    };

    return trimUnchangedSnapshotForSocket(game, socketId, snapshot);
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

  startGameLoops({
    lobbies,
    io,
    serverMetrics,
    tickRate: TICK_RATE,
    snapshotRate: SNAPSHOT_RATE,
    updateGame,
    buildSnapshotFor,
    recordTickDuration
  });

  registerSocketHandlers({
    io,
    maxConnections: MAX_CONNECTIONS,
    maxSurvivors: MAX_SURVIVORS,
    maxFfaPlayers: FFA_MAX_PLAYERS,
    lobbies,
    socketToLobby,
    serverMetrics,
    matchStartFreezeSeconds: MATCH_START_FREEZE_SECONDS,
    getMapListForClient,
    getDefaultMapId,
    getLobbySummary,
    allowSocketEvent,
    createLobby,
    joinLobby,
    joinSpectatorLobby,
    leaveCurrentLobby,
    canChangeRole,
    sanitizeSkin,
    sanitizeVoidSkin,
    normalizeRunnerClassId,
    accountService,
    touchLobby,
    broadcastLobbyState,
    broadcastLobbyList,
    addBotToLobby,
    removeBotFromLobby,
    startGame,
    canSocketControlPause,
    setMatchPaused,
    toggleAbilityTestMode,
    isSpectateOverviewId,
    spectateOverviewId: SPECTATE_OVERVIEW_ID,
    isSpectatableActorForViewer,
    resetInput,
    applyVoidAbility,
    applySurvivorAbility,
    fireRunnerShootAbility,
    fireFfaShot,
    getChatWheelMessagesForActor,
    setActorChat,
    nowMs
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

// public/gameplayConfig.js
// Shared gameplay knobs for both the Node server and browser client.
// Edit numbers here, restart the server, then hard-refresh the browser.
// Internal role names stay "survivor" and "killer" because networking enjoys not exploding.

const GAMEPLAY_CONFIG = {
  server: {
    hostProfileDefault: "boosted",
    tickRate: 60,
    snapshotRateBoosted: 30,
    snapshotRateStandard: 20,
    botThinkRateBoosted: 15,
    botThinkRateStandard: 10,
    pathfindLoopLimitBoosted: 1600,
    pathfindLoopLimitStandard: 950,
    pathCacheMaxBoosted: 900,
    pathCacheMaxStandard: 300,
    metricsIntervalMs: 30000
  },

  match: {
    startFreezeSeconds: 1.5,
    maxSurvivors: 4,
    requiredRiftsToComplete: 4,
    scratchMarkMax: 45
  },

  lighting: {
    mapDarkness: 0.38
  },

  // Client-only adaptive performance mode. If the browser drops under lowFps for a few samples,
  // Phaser automatically reduces particles, redraw rates, cone effects, shockwaves, and heavy Void FX.
  performance: {
    // Adaptive renderer thresholds. If the browser cannot hold a clean 60 FPS,
    // drop into the cheap renderer and stay there for the match. Bouncing back
    // to normal mid-chase is how frame pacing becomes a flipbook with feelings.
    lowFps: 60,
    ultraFps: 45,
    recoverFps: 62,
    ultraRecoverFps: 48,
    lowSamples: 2,
    ultraSamples: 2,
    recoverSamples: 9999,
    minModeSeconds: 9,
    // Cap high-DPI laptops. Rendering 2x pixels for a browser game is how GPUs go to therapy.
    maxDevicePixelRatio: 1,
    // High-end clients get a small fidelity bump without wasting 2x Retina rendering.
    highPowerDevicePixelRatio: 1.15,
    // Low-power clients render fewer pixels and upscale the canvas. The game stays responsive;
    // only the browser's unnecessary pixel-count vanity project gets sacrificed.
    lowPowerDevicePixelRatio: 0.72,
    // Client visual smoothing for networked actors. Server still owns movement;
    // the client renders remote actors slightly in the past so low FPS/network jitter
    // does not look like teleporting. Yes, this is the part that keeps bots from moonwalking.
    remoteInterpolationDelayMs: 165,
    remoteExtrapolateMs: 115,
    // The Void gets a shorter render delay than normal remote actors. Survivors need to see
    // where the server says the killer is now, not where he was three browser hiccups ago.
    voidInterpolationDelayMs: 90,
    voidExtrapolateMs: 135,
    voidMaxVisualLag: 72,
    remoteSnapDistance: 300,
    localMaxCorrectionPerSecond: 115,
    localCorrectionDeadzoneIdle: 6,
    localCorrectionDeadzoneMoving: 22,
    localCorrectionSnapDistance: 270,
    localCameraFollowRate: 999,
    localCameraSnapDistance: 340,
    toastCooldownMs: 12000,
    // Send human input at a steady, sane cadence. Reliable input events keep the
    // server current while snapshots stay volatile so old frames can be dropped.
    inputRateNormal: 30,
    inputRateLowPower: 24,
    inputRateUltra: 18,
    inputHeartbeatMs: 140,
    inputAngleEpsilon: 0.012,
    snapshotJitterDelayMaxMs: 42
  },

  // Client camera / immersion knobs. These only affect how the camera feels, not server hitboxes.
  camera: {
    baseZoom: 1,
    // Minimum allowed camera zoom. Negative zoom offsets, like injuredZoom: -0.5,
    // cannot zoom farther out than this floor.
    minZoom: 0.34,
    lowPowerMinZoom: 0.42,

    terrorZoom: 0.04,
    lowPowerTerrorZoom: 0.012,
    chaseZoom: 0.45,
    lowPowerChaseZoom: 0.18,

    voidM1HoldZoom: 0.085,
    lowPowerVoidM1HoldZoom: 0.018,
    voidM1PulseZoom: 0.065,
    lowPowerVoidM1PulseZoom: 0.012,

    riftDepositZoom: 0.12,
    lowPowerRiftDepositZoom: 0.055,
    riftKickZoom: 0.075,
    lowPowerRiftKickZoom: 0.04,
    healZoom: 0.045,
    lowPowerHealZoom: 0.025,
    unhookZoom: 0.12,
    lowPowerUnhookZoom: 0.06,
    hookedZoom: -0.3,
    lowPowerHookedZoom: 0.055,
    injuredZoom: 0.035,
    lowPowerInjuredZoom: 0.018,
    downedZoom: 0.55,
    lowPowerDownedZoom: 0.075,
    escapeZoom: 0.12,
    lowPowerEscapeZoom: 0.06,

    spawnPopZoom: 0.18,
    lowPowerSpawnPopZoom: 0.10,
    spawnPopZoomDecay: 5.6,
    lowPowerSpawnPopZoomDecay: 4.2,
    matchStartZoomOut: 0.36,
    lowPowerMatchStartZoomOut: 0.22,
    matchStartZoomSmoothing: 3.0,
    lowPowerMatchStartZoomSmoothing: 2.2,

    zoomSmoothing: 6.4,
    lowPowerZoomSmoothing: 4.4,
    chaseInLerp: 0.055,
    lowPowerChaseInLerp: 0.045,
    chaseOutLerp: 0.04,
    lowPowerChaseOutLerp: 0.035,
    terrorLerp: 0.07,
    lowPowerTerrorLerp: 0.055,
    zoomUpdateThreshold: 0.0035,
    lowPowerZoomUpdateThreshold: 0.0065,
    breathSway: 4,
    lowPowerBreathSway: 2.5,
    chaseSway: 5,
    lowPowerChaseSway: 3
  },

  actor: {
    survivorSize: 30,
    voidSize: 38
  },

  survivor: {
    walkSpeed: 170,
    sprintSpeed: 285,
    downedCrawlSpeed: 62,
    hitBurstSpeed: 350,
    hitBoostDuration: 1.0,
    invulnerableSeconds: 1.45,
    vaultTime: 0.38,
    // After a survivor vaults a window/pallet, they must commit for a moment before vaulting again.
    windowVaultCooldown: 1.15,
    palletVaultCooldown: 1.15,
    // Dropping a pallet also locks pallet vaulting briefly, so survivors cannot slam and instantly hop over.
    palletDropCooldown: 1.15,
    healTime: 4.2,
    healDistance: 82,
    // If a heal is started and then interrupted, progress drains slowly instead of snapping to zero.
    healDecayPerSecond: 0.08,
    unhookTime: 2.15,
    hookRescueDistance: 108,
    coneLength: 620,
    coneAngle: Math.PI / 2.6,
    clientConeLength: 880,
    clientConeAngle: Math.PI / 2.05
  },

  void: {
    speed: 310,
    recoverySpeedMultiplier: 0.28,
    vaultTime: 1.05,
    breakTime: 1.25,
    coneLength: 920,
    coneAngle: Math.PI / 1.75,
    scratchMarkVisibilityRange: 520,
    hookMinDistance: 430,
    clientConeLength: 1080,
    clientConeAngle: Math.PI / 1.62
  },

  voidAbilities: {
    speedBuffMultiplier: 1.28,
    redOrbSlowMultiplier: 0.55,
    redOrbSlowSeconds: 0.5
  },

  attack: {
    quickRange: 82,
    lungeRange: 118,
    arcRadians: Math.PI * 0.50,
    sideRadius: 24,
    closeAoeRadius: 26,
    edgeGraceRadius: 9,
    // M1 hit detection uses Runner body overlap, not just center-point math.
    targetBodyRadius: 15,
    tapMaxSeconds: 0.18,
    lungeChargeSeconds: 0.32,
    quickActiveSeconds: 0.24,
    lungeActiveSeconds: 0.42,
    quickStartupSeconds: 0.045,
    lungeStartupSeconds: 0.075,
    lungeSpeedMultiplier: 1.42,
    quickMissRecoverySeconds: 1.05,
    quickHitRecoverySeconds: 1.55,
    lungeMissRecoverySeconds: 1.35,
    lungeHitRecoverySeconds: 1.85,
    cooldownSeconds: 0.24
  },

  pallet: {
    // If a survivor drops a pallet while The Void is inside/near it, The Void is stunned.
    // Swinging extends the catch distance slightly so risky M1s at pallets can be punished.
    voidStunSeconds: 1.0,
    voidStunCloseRadius: 42,
    voidStunSwingRadius: 64
  },

  rift: {
    collisionSize: 54,
    // Rifts are completed by deposits now. repairTime is kept only for old/fallback code paths.
    repairTime: 28.0,
    kickTime: 1.0,
    kickRegression: 0.10,
    escapeTime: 4.0,
    dotsPerRift: 30,
    depositDistance: 96,
    depositSecondsPerOrb: 0.5,
    maxDepositChain: 30
  },

  survivorAbilities: {
    riftLensLengthMultiplier: 1.55,
    riftLensAngleMultiplier: 1.38
  },

  orbs: {
    survivorMax: 30,
    voidMax: 999,
    survivorDropOnHitPercent: 1.0,
    survivorPickupRadius: 48,
    voidPickupRadius: 92,
    minTileSpacing: 3.0,
    minObjectiveTileDistance: 1.8,
    spawnFloorRatio: 0.032,
    spawnMin: 16,
    maxOnMap: 38,
    respawnSeconds: 2.2,
    respawnBatch: 3
  },

  hook: {
    channelTime: 1.35,
    executeTime: 2.15,
    hooksBeforeExecution: 2,
    interactDistance: 128
  },

  chase: {
    terrorRadius: 760,
    startRadius: 520,
    holdSeconds: 3,
    closeRevealRadius: 120,
    musicLayer1Volume: 0.12,
    // Layer 2 is intentionally skipped. Chase goes straight from ambient layer_1 to layer_3.
    musicLayer2MaxVolume: 0,
    musicLayer3Volume: 0.30
  },

  bots: {
    repathMin: 0.32,
    repathMax: 0.68,
    survivorThreatRadius: 640,
    survivorPanicRadius: 285,
    survivorLoopRadius: 430,
    // Chase bots should chain toward windows/pallets instead of worshipping map corners.
    survivorLoopChainRadius: 780,
    survivorLoopCommitSeconds: 2.15,
    survivorDeadzoneEdgeTiles: 3.15,
    survivorCornerEdgeTiles: 3.6,
    survivorStuckSeconds: 1.0,
    survivorObjectiveStallSeconds: 1.0,
    survivorStallRedirectSeconds: 1.0,
    survivorTerrorFleeSeconds: 3.0,
    // Runner bots use server omniscience for escape planning. They should not pretend
    // The Void vanished because a wall blocked line-of-sight for half a second.
    survivorMapAwareRadius: 1080,
    survivorEscapePlanSeconds: 2.65,
    survivorEscapeScanSteps: 2,
    survivorEscapeMinSafeExits: 2,
    voidMemorySeconds: 6.0,
    voidScratchMemorySeconds: 2.5,
    voidInteractCooldown: 1.25,
    voidWindowReuseCooldown: 0.95,
    voidStuckSeconds: 0.85
  }
};

if (typeof window !== "undefined") {
  window.GAMEPLAY_CONFIG = GAMEPLAY_CONFIG;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = GAMEPLAY_CONFIG;
}

// public/gameplayConfig.js
// Shared gameplay knobs for both the Node server and browser client.
// Edit numbers here, restart the server, then hard-refresh the browser.
// Internal role names stay "survivor" and "killer" because networking enjoys not exploding.

const GAMEPLAY_CONFIG = {
  server: {
    hostProfileDefault: "boosted",
    tickRate: 60,
    snapshotRateBoosted: 20,
    snapshotRateStandard: 16,
    botThinkRateBoosted: 12,
    botThinkRateStandard: 8,
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

  // Client camera / immersion knobs. These only affect how the camera feels, not server hitboxes.
  camera: {
    baseZoom: 1,
    // Minimum allowed camera zoom. Negative zoom offsets, like injuredZoom: -0.5,
    // cannot zoom farther out than this floor.
    minZoom: 0.34,
    lowPowerMinZoom: 0.42,

    terrorZoom: 0.04,
    lowPowerTerrorZoom: 0.025,
    chaseZoom: 0.45,
    lowPowerChaseZoom: 0.42,

    voidM1HoldZoom: 0.085,
    lowPowerVoidM1HoldZoom: 0.045,
    voidM1PulseZoom: 0.065,
    lowPowerVoidM1PulseZoom: 0.035,

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
    musicLayer2MaxVolume: 0.30,
    musicLayer3Volume: 0.30
  },

  bots: {
    repathMin: 0.24,
    repathMax: 0.52,
    survivorThreatRadius: 690,
    survivorPanicRadius: 315,
    survivorLoopRadius: 470,
    survivorRescueRadius: 920,
    survivorHealRadius: 760,
    survivorSafeKillerDistance: 520,
    survivorAbilityThreatRadius: 560,
    voidMemorySeconds: 7.5,
    voidScratchMemorySeconds: 3.25,
    voidInteractCooldown: 1.05,
    voidWindowReuseCooldown: 0.85,
    voidStuckSeconds: 0.72,
    voidHookPursuitRadius: 980,
    voidAbilityChaseRadius: 720,
    pathStuckRepathDistance: 7
  }
};

if (typeof window !== "undefined") {
  window.GAMEPLAY_CONFIG = GAMEPLAY_CONFIG;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = GAMEPLAY_CONFIG;
}

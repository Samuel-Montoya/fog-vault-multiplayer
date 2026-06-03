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
    // Only enable low performance mode after measured FPS drops below this threshold.
    // Hardware hints no longer force low mode at startup, because guessing performance
    // from CPU threads is how decent PCs get punished for crimes they did not commit.
    fpsTriggerOnly: true,
    lowFps: 55,
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
    // Survivor Speed Burst uses a light version of the Void rush trail so the
    // boost reads clearly without turning low-end machines into fondue.
    survivorSpeedBurstTrailGapMs: 82,
    survivorSpeedBurstTrailCount: 2,
    survivorSpeedBurstTrailAlpha: 0.36,
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

  // Additive camera zoom stack. Final zoom = baseZoom + active modifiers, then clamped.
  // Positive values zoom in. Negative values zoom out. Tiny mercy: all numbers live here.
  camera: {
    baseZoom: 0.90,
    lowPowerBaseZoom: 0.88,
    chaseZoomOffset: 0.50,
    // Walking stays at base zoom. Holding Shift to sprint is the only movement zoom.
    walkZoomOffset: 0,
    sprintZoomOffset: 0.20,
    actionZoomOffset: 0.20,
    // Absolute zoom while you are hooked and nobody is actively rescuing you.
    // Keep it just above base zoom so the hook view feels focused without becoming
    // the world's saddest satellite camera.
    hookedUnrescuedZoom: 1.05,
    hookedRescueProgressEpsilon: 0.001,
    survivorAbilityZoomOffsets: {
      riftLens: -0.20,
      hourglass: 0,
      speedBurst: 0
    },
    killerAbilityZoomOffsets: {
      voidReveal: -0.20,
      nullRush: 0,
      redshiftOrbs: 0
    },
    maxZoomInOffset: 0.50,
    maxZoomOutOffset: 0.30,
    zoomLerpRate: 4.4,
    lowPowerZoomLerpRate: 5.2,
    zoomSnapEpsilon: 0.0008,
    // Dedicated spectators get this after cycling past all player targets with Tab.
    // It fits the full map, disables fog/LOS limits, and centers the camera perfectly.
    spectatorOverviewPadding: 72,
    spectatorOverviewMinZoom: 0.08,
    spectatorOverviewMaxZoom: 0.95,
    applyWalkZoomOnlyWhileMoving: true
  },

  // Client-only chase feedback. These drive overlays/shake/sway, not camera zoom.
  immersion: {
    chaseInLerp: 0.055,
    lowPowerChaseInLerp: 0.045,
    chaseOutLerp: 0.04,
    lowPowerChaseOutLerp: 0.035,
    terrorLerp: 0.07,
    lowPowerTerrorLerp: 0.055,
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
    // Not holding sprint gets a wider/longer cone than sprinting. This applies while
    // standing still or walking. Holding Shift immediately returns to the base cone,
    // so speed still trades away awareness. Server and client both read these.
    nonSprintingConeLengthMultiplier: 1.22,
    nonSprintingConeAngleMultiplier: 1.12,
    // Backward-compatible aliases for older code/config edits.
    walkingConeLengthMultiplier: 1.22,
    walkingConeAngleMultiplier: 1.12,
    clientConeLength: 880,
    clientConeAngle: Math.PI / 2.05
  },

  void: {
    speed: 310,
    // Permanent endgame buff after all rifts are complete. Smaller than Null Rush.
    endgameSpeedMultiplier: 1.10,
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
    // Bot-only M1 discipline. These make The Void AI commit to a good charge/lunge
    // instead of cancelling because the target clipped behind a corner for one tick.
    botCommitSeconds: 0.55,
    botLosGraceSeconds: 0.24,
    botQuickCommitRangeMultiplier: 0.96,
    botLungeMinRangeMultiplier: 0.74,
    botLungeMaxRangeMultiplier: 1.18,
    botLungeKeepRangeMultiplier: 1.42,
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
    dotsPerRift: 25,
    depositDistance: 96,
    depositSecondsPerOrb: 0.5,
    maxDepositChain: 25
  },

  survivorAbilities: {
    riftLensLengthMultiplier: 1.55,
    riftLensAngleMultiplier: 1.38,
    hourglassBackLengthMultiplier: 0.92,
    hourglassBackAngleMultiplier: 1.0,
    // Hourglass now also hides scratch marks, replacing Stealth Step.
    hourglassHidesScratchMarks: true,
    speedBurstSpeedMultiplier: 1.14
  },

  orbs: {
    survivorMax: 25,
    voidMax: 999,
    survivorDropOnHitPercent: 1.0,
    survivorPickupRadius: 48,
    voidPickupRadius: 92,
    minTileSpacing: 2.55,
    minObjectiveTileDistance: 1.55,
    spawnFloorRatio: 0.046,
    spawnMin: 24,
    maxOnMap: 56,
    respawnSeconds: 1.25,
    respawnBatch: 5
  },

  hook: {
    channelTime: 1.35,
    executeTime: 2.15,
    hooksBeforeExecution: 2,
    interactDistance: 128,
    // Hook spawns now favor rescueable locations near an active teammate, then pick
    // the safest available point away from The Void inside that rescue bubble.
    teammateSearchRadius: 760,
    teammateIdealDistance: 360,
    teammateMinDistance: 150,
    // Keep hooks off/away from pallets and windows so rescue interactions do not
    // stack on top of loop resources like a tiny geometry crime scene.
    interactableAvoidDistance: 92,
    edgePaddingTiles: 1.35
  },

  chase: {
    terrorRadius: 760,
    startRadius: 520,
    holdSeconds: 3,
    closeRevealRadius: 120,
    musicLayer1Volume: 0.12,
    // Layer 2 is the warning layer before a full chase. It starts farther out than
    // the terror UI so players feel the threat coming instead of getting silent jumpscared.
    musicLayer2Radius: 1160,
    // Inside this distance layer_2 reaches full strength. Between radius and full radius
    // it uses a smoothstep ramp so it fades in instead of clicking on.
    musicLayer2FullRadius: 430,
    musicLayer2MinVolume: 0.02,
    musicLayer2MaxVolume: 0.34,
    // Keep a faint layer_2 bed under layer_3 so the transition into chase feels blended.
    musicLayer2ChaseBedVolume: 0.045,
    musicLayer2Curve: 1.08,
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
    // Audible terror radius is now caution, not instant full panic. Hard panic still wins
    // when The Void has line-of-sight, chase pressure, or gets truly close.
    survivorTerrorFleeSeconds: 2.65,
    survivorTerrorObjectiveAvoidSeconds: 3.35,
    survivorHardTerrorRadius: 360,
    survivorBraveObjectiveDistance: 455,
    // At this many carried orbs, Runner bots stop collecting and route to the closest rift.
    survivorDepositAtDots: 8,
    // Runner bots use server omniscience for escape planning. They should not pretend
    // The Void vanished because a wall blocked line-of-sight for half a second.
    survivorMapAwareRadius: 1080,
    survivorEscapePlanSeconds: 2.65,
    survivorEscapeScanSteps: 2,
    survivorEscapeMinSafeExits: 2,
    survivorOrbDangerRadius: 430,
    // Bot Runners should spend Speed Burst during real chases if they have enough orbs,
    // instead of dying with a full wallet like tiny capitalist tragedies.
    survivorSpeedBurstChaseRadius: 700,
    survivorSpeedBurstMinChaseHoldSeconds: 0.22,
    survivorSpeedBurstEmergencyRadius: 240,
    survivorPalletStunIntentRadius: 92,
    survivorPalletStunForecastSeconds: 0.32,
    survivorPalletWallEmergencyRadius: 190,
    survivorPersonalities: {
      enabled: true,
      // If there is only one living Runner bot, it becomes a Generalist at decision time.
      // This covers 3-human/1-bot lobbies and late-game "last bot standing" situations.
      generalistFallbackWhenBotCountAtOrBelow: 1
    },
    voidMemorySeconds: 6.0,
    voidScratchMemorySeconds: 2.5,
    // Killer bot macro priorities: pressure/kick active rifts, then farm enough orbs
    // for Void Sight / Null Rush during downtime instead of wandering like a haunted Roomba.
    voidRiftPressureRadius: 1080,
    voidRiftKickMinProgress: 0.045,
    voidRiftDepositPressureBonus: 780,
    voidOrbHuntMaxDistance: 680,
    voidOrbHuntTargetDots: 18,
    voidOrbHuntChaseLockout: 620,
    voidSearchScanSeconds: 1.15,
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

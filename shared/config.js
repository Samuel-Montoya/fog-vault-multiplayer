/**
 * Fog Vault Final Config
 * ----------------------
 * Most balance, tuning, and presentation values live here.
 * Server-only values can be changed safely without touching client render code.
 */
const CONFIG = {
  server: {
    port: process.env.PORT || 3000,
    tickRate: 60,
    snapshotRate: 60
  },

  lobby: {
    maxSurvivors: 4,
    maxBots: 4
  },

  map: {
    defaultTile: 72
  },

  actor: {
    survivorSize: 30,
    killerSize: 38,
    interactDistance: 78
  },

  survivor: {
    walkSpeed: 170,
    sprintSpeed: 285,
    hitBurstSpeed: 350,
    hitBurstSeconds: 1.0,
    invulnerableSeconds: 1.45,
    crawlSpeed: 62,
    vaultSeconds: 0.38
  },

  killer: {
    speed: 310,
    vaultSeconds: 1.05,
    breakPalletSeconds: 1.25,
    recoverySpeedMultiplier: 0.28
  },

  attack: {
    quickRange: 58,
    lungeRange: 88,
    arcRadians: Math.PI * 0.40,
    sideRadius: 20,
    closeAoeRadius: 24,
    tapMaxSeconds: 0.18,
    chargeSeconds: 0.32,
    quickStartupSeconds: 0.085,
    lungeStartupSeconds: 0.105,
    quickActiveSeconds: 0.18,
    lungeActiveSeconds: 0.30,
    lungeSpeedMultiplier: 1.16,
    quickMissRecoverySeconds: 0.95,
    quickHitRecoverySeconds: 1.35,
    lungeMissRecoverySeconds: 1.20,
    lungeHitRecoverySeconds: 1.65,
    cooldownSeconds: 0.22
  },

  objective: {
    // Add as many G symbols as you want to maps.js. The match still needs only this many.
    requiredGenerators: 5,
    generatorRepairSeconds: 32.0,
    // Killer generator kick: hold E for this long to remove this much total bar progress.
    generatorKickSeconds: 1.0,
    generatorKickRegression: 0.10,
    generatorCollisionSize: 54,
    gateEscapeSeconds: 0.85
  },

  healing: {
    healSeconds: 6.0,
    distance: 84
  },

  hooks: {
    beforeExecution: 2,
    hookSeconds: 1.35,
    executeSeconds: 2.15,
    unhookSeconds: 3.25,
    hookDistance: 130,
    rescueDistance: 110
  },

  visibility: {
    terrorRadius: 760,
    chaseStartRadius: 520,
    chaseHoldSeconds: 3,
    closeRevealRadius: 120,
    survivorConeLength: 620,
    survivorConeAngle: Math.PI / 2.6,
    killerConeLength: 920,
    killerConeAngle: Math.PI / 1.75,
    scratchMarkRange: 520,
    scratchMarkLifetimeSeconds: 4.0,
    scratchMarkSpacingSeconds: 0.09
  },

  audio: {
    layer1Volume: 0.12,
    layer2MaxVolume: 0.30,
    layer3Volume: 0.30
  },

  bot: {
    repathMinSeconds: 0.16,
    repathMaxSeconds: 0.42,
    survivorThreatRadius: 640,
    survivorPanicRadius: 285,
    killerMemorySeconds: 4.5,
    scratchMemorySeconds: 3.0
  }
};

module.exports = CONFIG;

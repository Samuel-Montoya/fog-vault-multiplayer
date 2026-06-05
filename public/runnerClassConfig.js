// public/runnerClassConfig.js
// Shared Runner class tuning. Change class abilities, passives, level scaling, and wheel layouts here.

const RIFTRUNNER_RUNNER_CLASS_CONFIG = {
  defaultClass: "orbCollector",
  passiveLevelThresholds: [1, 6, 14],
  classes: {
    orbCollector: {
      id: "orbCollector",
      name: "Collector",
      shortName: "Collector",
      accent: "yellow",
      icon: "✦",
      summary: "Objective Runner built around orb control, fast collection bursts, and greedy-but-safe economy.",
      detail: "Collector vacuums nearby orbs, fires rapid pickup bolts, and briefly multiplies pickups for aggressive rift progress.",
      wheelOrder: ["collectionBolt", "doubleOrb", "cancel", "orbMagnet"],
      grantedPerks: {},
      passive: {
        id: "orbMagnet",
        label: "Orb Magnet",
        detail: "Collects loose orbs in a larger radius around the Runner.",
        levels: [
          { level: 1, minRunnerLevel: 1, orbPickupRadiusMultiplier: 1.50, label: "50% larger pickup radius" },
          { level: 2, minRunnerLevel: 6, orbPickupRadiusMultiplier: 1.75, label: "75% larger pickup radius" },
          { level: 3, minRunnerLevel: 14, orbPickupRadiusMultiplier: 2.00, label: "100% larger pickup radius" }
        ],
        pickupRadiusRing: {
          color: 0xfacc15,
          lineAlpha: 0.36,
          lineWidth: 1.38
        }
      }
    },
    nebulizer: {
      id: "nebulizer",
      name: "Nebulizer",
      shortName: "Nebula",
      accent: "purple",
      icon: "☁",
      summary: "Control Runner that creates void-smoke cover and turns fog into team safety.",
      detail: "Nebulizer fires smoke darts that hide anything inside from outsiders. Runners standing inside smoke can read the cloud and spot The Void through it.",
      wheelOrder: ["smokeDart", "voidTrace", "cancel", "moreSoon"],
      grantedPerks: {},
      passive: {
        id: "voidTrace",
        label: "Void Trace",
        detail: "While standing inside any smoke cloud, you can see The Void through the haze in a wider radius.",
        levels: [
          { level: 1, minRunnerLevel: 1, smokeKillerRevealRadius: 440, label: "Short smoke reveal while inside smoke" },
          { level: 2, minRunnerLevel: 6, smokeKillerRevealRadius: 540, label: "Medium smoke reveal while inside smoke" },
          { level: 3, minRunnerLevel: 14, smokeKillerRevealRadius: 660, label: "Long smoke reveal while inside smoke" }
        ]
      }
    },
    escapist: {
      id: "escapist",
      aliases: ["chase"],
      name: "Escapist",
      shortName: "Escapist",
      accent: "orange",
      icon: "➟",
      summary: "Chase Runner built for distance, fast vaults, and team speed saves.",
      detail: "Escapist vaults faster, shoots Dash Darts to boost teammates, and primes a Swift Vault burst for escapes.",
      wheelOrder: ["dashDart", "swiftVault", "cancel", "flowState"],
      grantedPerks: {},
      passive: {
        id: "flowState",
        label: "Flow State",
        detail: "Vaults windows and pallets faster.",
        levels: [
          { level: 1, minRunnerLevel: 1, vaultSpeedMultiplier: 1.05, label: "5% faster vaults" },
          { level: 2, minRunnerLevel: 6, vaultSpeedMultiplier: 1.07, label: "7% faster vaults" },
          { level: 3, minRunnerLevel: 14, vaultSpeedMultiplier: 1.09, label: "9% faster vaults" }
        ]
      }
    },
    healer: {
      id: "healer",
      name: "Healer",
      shortName: "Healer",
      accent: "green",
      icon: "+",
      summary: "Support Runner that heals, unbinds, and saves teammates through pressure.",
      detail: "Healer works faster on normal heals and rescues, then uses Healing Dart to recover teammates from range.",
      wheelOrder: ["healingDart", "fieldMedic", "cancel", "moreSoon"],
      grantedPerks: {},
      passive: {
        id: "fieldMedic",
        label: "Field Medic",
        detail: "Heals and unbinds teammates faster.",
        levels: [
          { level: 1, minRunnerLevel: 1, healActionSpeedMultiplier: 1.05, unhookActionSpeedMultiplier: 1.05, label: "5% faster heals and unbinds" },
          { level: 2, minRunnerLevel: 6, healActionSpeedMultiplier: 1.07, unhookActionSpeedMultiplier: 1.07, label: "7% faster heals and unbinds" },
          { level: 3, minRunnerLevel: 14, healActionSpeedMultiplier: 1.09, unhookActionSpeedMultiplier: 1.09, label: "9% faster heals and unbinds" }
        ]
      }
    }
  },
  abilities: {
    collectionBolt: {
      id: "collectionBolt",
      classAbility: true,
      classId: "orbCollector",
      name: "Collection Bolt",
      shortName: "Bolt",
      accent: "yellow",
      cost: 0,
      cooldown: 3,
      radius: 96,
      projectileSpeed: 1500,
      range: 660,
      summary: "M1 fires a bolt that collects loose orbs inside its burst radius.",
      detail: "Explodes on walls or at max range and pulls every clear-line orb in the burst into your inventory. At Level 3, the bolt also collects orbs the laser path passes through.",
      inputType: "m1",
      shootAbility: true,
      projectileKind: "collect",
      levels: [
        { level: 1, minRunnerLevel: 1, radius: 96, projectileSpeed: 1450, range: 620, cooldown: 3, cost: 0, label: "Small burst · 3s cooldown" },
        { level: 2, minRunnerLevel: 6, radius: 132, projectileSpeed: 1550, range: 660, cooldown: 2, cost: 0, label: "Medium burst · 2s cooldown" },
        { level: 3, minRunnerLevel: 14, radius: 172, beamCollectRadius: 48, projectileSpeed: 1650, range: 700, cooldown: 1, cost: 0, label: "Large burst + pass-through beam pickup · 1s cooldown" }
      ]
    },
    doubleOrb: {
      id: "doubleOrb",
      classAbility: true,
      classId: "orbCollector",
      name: "Double Orb",
      shortName: "Double",
      accent: "yellow",
      cost: 10,
      duration: 5,
      cooldown: 30,
      summary: "Temporarily gives orb pickups a chance to add bonus carried orbs.",
      detail: "The bonus respects your carry cap, so banking at a rift still matters.",
      levels: [
        { level: 1, minRunnerLevel: 1, chance: 0.25, minBonus: 2, maxBonus: 4, duration: 5, cooldown: 30, cost: 10, label: "25% chance for +2-4" },
        { level: 2, minRunnerLevel: 6, chance: 0.50, minBonus: 3, maxBonus: 5, duration: 7, cooldown: 20, cost: 10, label: "50% chance for +3-5" },
        { level: 3, minRunnerLevel: 14, chance: 0.75, minBonus: 4, maxBonus: 6, duration: 10, cooldown: 10, cost: 10, label: "75% chance for +4-6" }
      ]
    },
    smokeDart: {
      id: "smokeDart",
      classAbility: true,
      classId: "nebulizer",
      name: "Smoke Dart",
      shortName: "Smoke",
      accent: "purple",
      cost: 0,
      duration: 5,
      cooldown: 30,
      radius: 132,
      projectileSpeed: 1380,
      range: 620,
      summary: "M1 fires a dart that blooms into a dark smoke cloud.",
      detail: "Anything inside is hidden from outsiders. Step inside the smoke to see clearly through that specific cloud.",
      inputType: "m1",
      shootAbility: true,
      projectileKind: "smoke",
      levels: [
        { level: 1, minRunnerLevel: 1, radius: 132, duration: 5, projectileSpeed: 1320, range: 600, cooldown: 30, cost: 0, label: "Small smoke" },
        { level: 2, minRunnerLevel: 6, radius: 170, duration: 7, projectileSpeed: 1400, range: 640, cooldown: 20, cost: 0, label: "Medium smoke" },
        { level: 3, minRunnerLevel: 14, radius: 220, duration: 10, projectileSpeed: 1500, range: 700, cooldown: 10, cost: 0, label: "Large smoke" }
      ]
    },
    dashDart: {
      id: "dashDart",
      classAbility: true,
      classId: "escapist",
      name: "Dash Dart",
      shortName: "Dash",
      accent: "orange",
      cost: 0,
      duration: 3,
      cooldown: 30,
      radius: 112,
      projectileSpeed: 1600,
      range: 660,
      summary: "M1 fires a dart that speed-boosts Runners in the burst.",
      detail: "Shoot teammates, the ground, or a wall. Level 3 also hides scratch marks during the boost.",
      inputType: "m1",
      shootAbility: true,
      projectileKind: "boost",
      levels: [
        { level: 1, minRunnerLevel: 1, speedMultiplier: 1.20, duration: 3, radius: 108, projectileSpeed: 1500, range: 620, cooldown: 30, cost: 0, hidesScratchMarks: false, label: "1.2x boost" },
        { level: 2, minRunnerLevel: 6, speedMultiplier: 1.40, duration: 4, radius: 116, projectileSpeed: 1600, range: 660, cooldown: 20, cost: 0, hidesScratchMarks: false, label: "1.4x boost" },
        { level: 3, minRunnerLevel: 14, speedMultiplier: 1.80, duration: 5, radius: 124, projectileSpeed: 1720, range: 700, cooldown: 10, cost: 0, hidesScratchMarks: true, scratchHideDuration: 5, label: "1.8x boost + hidden scratch marks" }
      ]
    },
    swiftVault: {
      id: "swiftVault",
      classAbility: true,
      classId: "escapist",
      name: "Swift Vault",
      shortName: "Swift",
      accent: "orange",
      cost: 5,
      duration: 10,
      cooldown: 30,
      summary: "Prime your next window or pallet vault to trigger a speed boost.",
      detail: "The boost triggers after your next vault, rewarding planned routes through windows or pallets.",
      levels: [
        { level: 1, minRunnerLevel: 1, speedMultiplier: 1.20, boostDuration: 2, duration: 10, cooldown: 30, cost: 5, label: "1.2x for 2s" },
        { level: 2, minRunnerLevel: 6, speedMultiplier: 1.40, boostDuration: 3, duration: 12, cooldown: 20, cost: 5, label: "1.4x for 3s" },
        { level: 3, minRunnerLevel: 14, speedMultiplier: 1.80, boostDuration: 4, duration: 14, cooldown: 10, cost: 5, label: "1.8x for 4s" }
      ]
    },
    healingDart: {
      id: "healingDart",
      classAbility: true,
      classId: "healer",
      name: "Healing Dart",
      shortName: "Heal",
      accent: "green",
      cost: 0,
      duration: 3,
      cooldown: 30,
      radius: 58,
      projectileSpeed: 1500,
      range: 660,
      summary: "M1 fires a dart that starts healing a teammate over time.",
      detail: "Level 1 heals. Level 2 can unbind hooked teammates. Level 3 can pick up downed Runners and fight through bind/consume pressure.",
      inputType: "m1",
      shootAbility: true,
      projectileKind: "heal",
      levels: [
        { level: 1, minRunnerLevel: 1, cost: 0, cooldown: 30, duration: 3, healProgress: 1.05, unhookProgress: 0, canUnhook: false, canPickupDowned: false, projectileSpeed: 1450, range: 620, radius: 58, label: "Full heal over time" },
        { level: 2, minRunnerLevel: 6, cost: 0, cooldown: 20, duration: 3, healProgress: 1.05, unhookProgress: 1.05, canUnhook: true, canPickupDowned: false, projectileSpeed: 1550, range: 660, radius: 62, label: "Full heal + full unbind over time" },
        { level: 3, minRunnerLevel: 14, cost: 0, cooldown: 10, duration: 3, healProgress: 1.05, unhookProgress: 1.05, canUnhook: true, canPickupDowned: true, projectileSpeed: 1650, range: 700, radius: 66, label: "Heal, unbind, and pick up downed Runners" }
      ]
    },
    orbMagnet: {
      id: "orbMagnet",
      name: "Orb Magnet",
      shortName: "Magnet",
      accent: "yellow",
      cost: 0,
      cooldown: 0,
      summary: "Passive: larger orb pickup radius.",
      detail: "Passive class bonus. No button press needed.",
      disabled: true,
      passive: true
    },
    voidTrace: {
      id: "voidTrace",
      name: "Void Trace",
      shortName: "Trace",
      accent: "purple",
      cost: 0,
      cooldown: 0,
      summary: "Passive: while inside smoke, read The Void through the haze.",
      detail: "Passive class bonus. No button press needed.",
      disabled: true,
      passive: true
    },
    flowState: {
      id: "flowState",
      name: "Flow State",
      shortName: "Flow",
      accent: "orange",
      cost: 0,
      cooldown: 0,
      summary: "Passive: faster window and pallet vaults.",
      detail: "Passive class bonus. No button press needed.",
      disabled: true,
      passive: true
    },
    fieldMedic: {
      id: "fieldMedic",
      name: "Field Medic",
      shortName: "Medic",
      accent: "green",
      cost: 0,
      cooldown: 0,
      summary: "Passive: faster heals and unbinds.",
      detail: "Passive class bonus. No button press needed.",
      disabled: true,
      passive: true
    }
  }
};

if (typeof window !== "undefined") {
  window.RIFTRUNNER_RUNNER_CLASS_CONFIG = RIFTRUNNER_RUNNER_CLASS_CONFIG;
  if (typeof window.dispatchEvent === "function" && typeof window.CustomEvent === "function") {
    window.dispatchEvent(new window.CustomEvent("riftrunner:runner-class-config-ready", {
      detail: { config: RIFTRUNNER_RUNNER_CLASS_CONFIG }
    }));
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = RIFTRUNNER_RUNNER_CLASS_CONFIG;
}

// public/perkConfig.js
// Shared account perk/shop + level tuning. Change prices, durations, and multipliers here.
// Level costs live on the target level: level 2's upgradeCost is the price to go from 1 -> 2.

const RIFTRUNNER_PERK_CONFIG = {
  maxLevel: 4,
  // Bots should use starter-level perks unless explicitly tuned up.
  // Max-level bots made support darts, especially Dash Dart, feel wildly overtuned.
  botLevel: 1,
  roles: {
    survivor: {
      label: "Runner",
      shopTitle: "Runner perks",
      perks: {
        orbMagnet: {
          id: "orbMagnet",
          role: "survivor",
          passive: true,
          alwaysUnlocked: true,
          defaultLevel: 1,
          classAbility: true,
          classId: "orbCollector",
          name: "Orb Magnet",
          shortName: "Magnet",
          accent: "yellow",
          maxLevel: 3,
          summary: "Collector passive: loose orbs are pulled in from farther away.",
          detail: "Upgrade this passive to widen your automatic orb pickup radius while you run objectives.",
          levels: [
            { level: 1, unlockCost: 0, orbPickupRadiusMultiplier: 1.50, label: "Small magnet radius" },
            { level: 2, upgradeCost: 100, orbPickupRadiusMultiplier: 1.75, label: "Medium magnet radius" },
            { level: 3, upgradeCost: 150, orbPickupRadiusMultiplier: 2.00, label: "Large magnet radius" }
          ]
        },
        collectionBolt: {
          id: "collectionBolt",
          role: "survivor",
          classAbility: true,
          classId: "orbCollector",
          name: "Collection Bolt",
          shortName: "Bolt",
          accent: "yellow",
          maxLevel: 3,
          abilityCost: 0,
          cooldown: 3,
          summary: "Collector ability: fire a yellow bolt that collects loose orbs inside its pickup radius.",
          detail: "Aimed with M1. The bolt pops on walls, players, or max range and pulls clear-line orbs into your inventory. At Level 3, the laser path also vacuums any orbs it passes through.",
          inputType: "m1",
          shootAbility: true,
          projectileKind: "collect",
          levels: [
            { level: 1, unlockCost: 50, radius: 96, projectileSpeed: 1450, range: 620, cooldown: 3, cost: 0, label: "Small pickup radius" },
            { level: 2, upgradeCost: 100, radius: 132, projectileSpeed: 1550, range: 660, cooldown: 2, cost: 0, label: "Medium pickup radius" },
            { level: 3, upgradeCost: 150, radius: 172, beamCollectRadius: 48, projectileSpeed: 1650, range: 700, cooldown: 1, cost: 0, label: "Large pickup radius + pass-through beam pickup" }
          ]
        },
        doubleOrb: {
          id: "doubleOrb",
          role: "survivor",
          classAbility: true,
          classId: "orbCollector",
          name: "Double Orb",
          shortName: "Double",
          accent: "yellow",
          maxLevel: 3,
          abilityCost: 10,
          cooldown: 30,
          summary: "Collector ability: temporarily adds bonus carried orbs when pickups proc.",
          detail: "For a short window, normal orb pickups can add extra carried orbs. It respects your carry cap, because even chaos needs accounting.",
          levels: [
            { level: 1, unlockCost: 50, chance: 0.25, minBonus: 2, maxBonus: 4, duration: 5, cooldown: 30, cost: 10, label: "25% chance for +2-4" },
            { level: 2, upgradeCost: 100, chance: 0.50, minBonus: 3, maxBonus: 5, duration: 7, cooldown: 20, cost: 10, label: "50% chance for +3-5" },
            { level: 3, upgradeCost: 150, chance: 0.75, minBonus: 4, maxBonus: 6, duration: 10, cooldown: 10, cost: 10, label: "75% chance for +4-6" }
          ]
        },
        voidTrace: {
          id: "voidTrace",
          role: "survivor",
          passive: true,
          alwaysUnlocked: true,
          defaultLevel: 1,
          classAbility: true,
          classId: "nebulizer",
          name: "Vapor Trail",
          shortName: "Vapor",
          accent: "purple",
          maxLevel: 3,
          summary: "Nebulizer passive: while inside smoke, gain speed and erase scratch marks.",
          detail: "Vapor Trail activates in smoke, boosting Nebulizer's speed and preventing scratch marks for the level duration.",
          levels: [
            { level: 1, unlockCost: 0, vaporTrailSpeedMultiplier: 1.20, vaporTrailDuration: 2, hidesScratchMarks: true, label: "1.2x boost · 2s duration · no scratch marks" },
            { level: 2, upgradeCost: 100, vaporTrailSpeedMultiplier: 1.40, vaporTrailDuration: 3, hidesScratchMarks: true, label: "1.4x boost · 3s duration · no scratch marks" },
            { level: 3, upgradeCost: 150, vaporTrailSpeedMultiplier: 1.80, vaporTrailDuration: 4, hidesScratchMarks: true, label: "1.8x boost · 4s duration · no scratch marks" }
          ]
        },
        smokeDart: {
          id: "smokeDart",
          role: "survivor",
          classAbility: true,
          classId: "nebulizer",
          name: "Smoke Dart",
          shortName: "Smoke",
          accent: "purple",
          maxLevel: 3,
          abilityCost: 0,
          cooldown: 30,
          summary: "Nebulizer ability: fire a purple dart that blooms into a vision-blocking smoke cloud.",
          detail: "Anything inside smoke is hidden from outsiders. Step inside and everything outside that same smoke cloud disappears from vision.",
          inputType: "m1",
          shootAbility: true,
          projectileKind: "smoke",
          levels: [
            { level: 1, unlockCost: 50, radius: 132, duration: 5, projectileSpeed: 1320, range: 600, cooldown: 30, cost: 0, label: "Small smoke" },
            { level: 2, upgradeCost: 100, radius: 170, duration: 7, projectileSpeed: 1400, range: 640, cooldown: 20, cost: 0, label: "Medium smoke" },
            { level: 3, upgradeCost: 150, radius: 220, duration: 10, projectileSpeed: 1500, range: 700, cooldown: 10, cost: 0, label: "Large smoke" }
          ]
        },
        voidSwirl: {
          id: "voidSwirl",
          role: "survivor",
          classAbility: true,
          classId: "nebulizer",
          alwaysUnlocked: true,
          defaultLevel: 1,
          name: "Void Swirl",
          shortName: "Swirl",
          accent: "red",
          maxLevel: 3,
          abilityCost: 5,
          cooldown: 30,
          summary: "Nebulizer ability: drop a red void swirl trap that slows The Void when stepped on.",
          detail: "Place a small red swirl at your feet. It arms instantly, burns out after a few seconds, and disappears after slowing The Void.",
          inputType: "q",
          levels: [
            { level: 1, unlockCost: 0, radius: 62, duration: 6, slowMultiplier: 0.75, slowDuration: 1.25, cooldown: 30, cost: 5, label: "Small swirl · 25% slow for 1.25s" },
            { level: 2, upgradeCost: 100, radius: 74, duration: 7, slowMultiplier: 0.65, slowDuration: 1.75, cooldown: 20, cost: 5, label: "Medium swirl · 35% slow for 1.75s" },
            { level: 3, upgradeCost: 150, radius: 88, duration: 8, slowMultiplier: 0.55, slowDuration: 2.25, cooldown: 10, cost: 5, label: "Large swirl · 45% slow for 2.25s" }
          ]
        },
        flowState: {
          id: "flowState",
          role: "survivor",
          passive: true,
          alwaysUnlocked: true,
          defaultLevel: 1,
          classAbility: true,
          classId: "escapist",
          name: "Flow State",
          shortName: "Flow",
          accent: "orange",
          maxLevel: 3,
          summary: "Escapist passive: vault windows and pallets faster.",
          detail: "Upgrade this passive to make chase routes smoother and punish The Void for forcing vault decisions.",
          levels: [
            { level: 1, unlockCost: 0, vaultSpeedMultiplier: 1.05, label: "Small vault speed boost" },
            { level: 2, upgradeCost: 100, vaultSpeedMultiplier: 1.07, label: "Medium vault speed boost" },
            { level: 3, upgradeCost: 150, vaultSpeedMultiplier: 1.09, label: "Large vault speed boost" }
          ]
        },
        dashDart: {
          id: "dashDart",
          role: "survivor",
          classAbility: true,
          classId: "escapist",
          name: "Dash Dart",
          shortName: "Dash",
          accent: "orange",
          maxLevel: 3,
          abilityCost: 0,
          cooldown: 30,
          summary: "Escapist ability: fire an orange dart that speed-boosts Runners in the radius.",
          detail: "Shoot teammates, the ground, or a wall. Level 3 hides scratch marks during the boost.",
          inputType: "m1",
          shootAbility: true,
          projectileKind: "boost",
          levels: [
            { level: 1, unlockCost: 50, speedMultiplier: 1.20, duration: 3, radius: 108, projectileSpeed: 1500, range: 620, cooldown: 30, cost: 0, hidesScratchMarks: false, label: "1.2x boost" },
            { level: 2, upgradeCost: 100, speedMultiplier: 1.40, duration: 4, radius: 116, projectileSpeed: 1600, range: 660, cooldown: 20, cost: 0, hidesScratchMarks: false, label: "1.4x boost" },
            { level: 3, upgradeCost: 150, speedMultiplier: 1.80, duration: 5, radius: 124, projectileSpeed: 1720, range: 700, cooldown: 10, cost: 0, hidesScratchMarks: true, scratchHideDuration: 5, label: "1.8x boost + hidden scratch marks" }
          ]
        },
        swiftVault: {
          id: "swiftVault",
          role: "survivor",
          classAbility: true,
          classId: "escapist",
          name: "Swift Vault",
          shortName: "Swift",
          accent: "orange",
          maxLevel: 3,
          abilityCost: 5,
          cooldown: 30,
          summary: "Escapist ability: prime your next window or pallet vault for a speed boost.",
          detail: "The boost triggers after your next vault, rewarding planned chase routes instead of frantic wall-hugging.",
          levels: [
            { level: 1, unlockCost: 50, speedMultiplier: 1.20, boostDuration: 2, duration: 10, cooldown: 30, cost: 5, label: "1.2x for 2s" },
            { level: 2, upgradeCost: 100, speedMultiplier: 1.40, boostDuration: 3, duration: 12, cooldown: 20, cost: 5, label: "1.4x for 3s" },
            { level: 3, upgradeCost: 150, speedMultiplier: 1.80, boostDuration: 4, duration: 14, cooldown: 10, cost: 5, label: "1.8x for 4s" }
          ]
        },
        fieldMedic: {
          id: "fieldMedic",
          role: "survivor",
          passive: true,
          alwaysUnlocked: true,
          defaultLevel: 1,
          classAbility: true,
          classId: "healer",
          name: "Field Medic",
          shortName: "Medic",
          accent: "green",
          maxLevel: 3,
          summary: "Healer passive: heal and unbind teammates faster at close range.",
          detail: "Upgrade this passive to make normal support actions finish faster when you are helping teammates directly.",
          levels: [
            { level: 1, unlockCost: 0, healActionSpeedMultiplier: 1.05, unhookActionSpeedMultiplier: 1.05, label: "Small support speed boost" },
            { level: 2, upgradeCost: 100, healActionSpeedMultiplier: 1.07, unhookActionSpeedMultiplier: 1.07, label: "Medium support speed boost" },
            { level: 3, upgradeCost: 150, healActionSpeedMultiplier: 1.09, unhookActionSpeedMultiplier: 1.09, label: "Large support speed boost" }
          ]
        },
        healingDart: {
          id: "healingDart",
          role: "survivor",
          classAbility: true,
          classId: "healer",
          name: "Healing Dart",
          shortName: "Heal",
          accent: "green",
          maxLevel: 3,
          abilityCost: 0,
          cooldown: 30,
          summary: "Healer ability: fire a green dart that starts ranged teammate recovery.",
          detail: "Tier 1 heals. Tier 2 adds ranged unbinding. Max Level instantly picks up downed Runners and grants brief i-frames.",
          inputType: "m1",
          shootAbility: true,
          projectileKind: "heal",
          levels: [
            { level: 1, unlockCost: 50, cost: 0, cooldown: 30, duration: 3, healProgress: 1.05, unhookProgress: 0, canUnhook: false, canPickupDowned: false, projectileSpeed: 1450, range: 620, radius: 58, label: "Full heal over time" },
            { level: 2, upgradeCost: 100, cost: 0, cooldown: 20, duration: 3, healProgress: 1.05, unhookProgress: 1.05, canUnhook: true, canPickupDowned: false, projectileSpeed: 1550, range: 660, radius: 62, label: "Full heal + full unbind over time" },
            { level: 3, upgradeCost: 150, cost: 0, cooldown: 10, duration: 3, healProgress: 1.05, unhookProgress: 1.05, canUnhook: true, canPickupDowned: true, projectileSpeed: 1650, range: 700, radius: 66, label: "Heal, unbind, and pick up downed Runners" }
          ]
        },
      }
    },
    killer: {
      label: "Void",
      shopTitle: "Void perks",
      perks: {
        nullRush: {
          id: "nullRush",
          role: "killer",
          name: "Null Rush",
          shortName: "Rush",
          accent: "gray",
          abilityCost: 15,
          cooldown: 20,
          summary: "A forward speed surge for catching greedy Runners.",
          detail: "Higher levels extend the rush and slightly increase its speed.",
          levels: [
            { level: 1, unlockCost: 50, duration: 4, speedMultiplier: 1.16 },
            { level: 2, upgradeCost: 100, duration: 6, speedMultiplier: 1.20 },
            { level: 3, upgradeCost: 150, duration: 8, speedMultiplier: 1.24 },
            { level: 4, upgradeCost: 200, duration: 10, speedMultiplier: 1.28 }
          ]
        },
        redshiftOrbs: {
          id: "redshiftOrbs",
          role: "killer",
          name: "Redshift Bloom",
          shortName: "Redshift",
          accent: "red",
          abilityCost: 25,
          cooldown: 20,
          summary: "Turns loose orbs into temporary slowdown hazards.",
          detail: "Higher levels last longer and make the slow more punishing.",
          levels: [
            { level: 1, unlockCost: 50, duration: 5, slowMultiplier: 0.72, slowSeconds: 0.30 },
            { level: 2, upgradeCost: 100, duration: 8, slowMultiplier: 0.65, slowSeconds: 0.40 },
            { level: 3, upgradeCost: 150, duration: 11, slowMultiplier: 0.58, slowSeconds: 0.50 },
            { level: 4, upgradeCost: 200, duration: 15, slowMultiplier: 0.55, slowSeconds: 0.60 }
          ]
        },
        voidReveal: {
          id: "voidReveal",
          role: "killer",
          name: "Void Sight",
          shortName: "Sight",
          accent: "purple",
          abilityCost: 15,
          cooldown: 20,
          summary: "Reveal every Runner for a short hunt window.",
          detail: "Higher levels extend the global reveal and camera pullback.",
          levels: [
            { level: 1, unlockCost: 50, duration: 1.5 },
            { level: 2, upgradeCost: 100, duration: 2.5 },
            { level: 3, upgradeCost: 150, duration: 3.75 },
            { level: 4, upgradeCost: 200, duration: 5 }
          ]
        }
      }
    }
  }
};

if (typeof window !== "undefined") {
  window.RIFTRUNNER_PERK_CONFIG = RIFTRUNNER_PERK_CONFIG;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = RIFTRUNNER_PERK_CONFIG;
}

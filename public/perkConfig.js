// public/perkConfig.js
// Shared account perk/shop + level tuning. Change prices, durations, and multipliers here.
// Level costs live on the target level: level 2's upgradeCost is the price to go from 1 -> 2.

const RIFTRUNNER_PERK_CONFIG = {
  maxLevel: 4,
  botLevel: 4,
  roles: {
    survivor: {
      label: "Runner",
      shopTitle: "Runner perks",
      perks: {
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
          summary: "Collector ability: fire a yellow bolt that collects loose orbs inside its burst.",
          detail: "Aimed with M1. The bolt pops on walls, players, or max range and pulls clear-line orbs into your inventory.",
          inputType: "m1",
          shootAbility: true,
          projectileKind: "collect",
          levels: [
            { level: 1, unlockCost: 50, radius: 96, projectileSpeed: 1450, range: 620, cooldown: 3, cost: 0, label: "Small burst · 3s cooldown" },
            { level: 2, upgradeCost: 100, radius: 132, projectileSpeed: 1550, range: 660, cooldown: 2, cost: 0, label: "Medium burst · 2s cooldown" },
            { level: 3, upgradeCost: 150, radius: 172, projectileSpeed: 1650, range: 700, cooldown: 1, cost: 0, label: "Large burst · 1s cooldown" }
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
          cooldown: 60,
          summary: "Collector ability: temporarily adds bonus carried orbs when pickups proc.",
          detail: "For a short window, normal orb pickups can add extra carried orbs. It respects your carry cap, because even chaos needs accounting.",
          levels: [
            { level: 1, unlockCost: 50, chance: 0.25, minBonus: 2, maxBonus: 4, duration: 5, cooldown: 60, cost: 10, label: "25% chance for +2-4" },
            { level: 2, upgradeCost: 100, chance: 0.50, minBonus: 3, maxBonus: 5, duration: 7, cooldown: 45, cost: 10, label: "50% chance for +3-5" },
            { level: 3, upgradeCost: 150, chance: 0.75, minBonus: 4, maxBonus: 6, duration: 10, cooldown: 30, cost: 10, label: "75% chance for +4-6" }
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
          abilityCost: 10,
          cooldown: 60,
          summary: "Nebulizer ability: fire a purple dart that blooms into a vision-blocking smoke cloud.",
          detail: "Anything inside the smoke is hidden from outsiders. Step inside the cloud to see through that same smoke.",
          inputType: "m1",
          shootAbility: true,
          projectileKind: "smoke",
          levels: [
            { level: 1, unlockCost: 50, radius: 132, duration: 5, projectileSpeed: 1320, range: 600, cooldown: 60, cost: 10, label: "Small smoke" },
            { level: 2, upgradeCost: 100, radius: 170, duration: 7, projectileSpeed: 1400, range: 640, cooldown: 45, cost: 10, label: "Medium smoke" },
            { level: 3, upgradeCost: 150, radius: 220, duration: 10, projectileSpeed: 1500, range: 700, cooldown: 30, cost: 10, label: "Large smoke" }
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
          abilityCost: 2,
          cooldown: 60,
          summary: "Escapist ability: fire an orange dart that speed-boosts Runners in the burst.",
          detail: "Shoot teammates, the ground, or a wall. Level 3 hides scratch marks during the boost.",
          inputType: "m1",
          shootAbility: true,
          projectileKind: "boost",
          levels: [
            { level: 1, unlockCost: 50, speedMultiplier: 1.20, duration: 3, radius: 108, projectileSpeed: 1500, range: 620, cooldown: 60, cost: 2, hidesScratchMarks: false, label: "1.2x boost" },
            { level: 2, upgradeCost: 100, speedMultiplier: 1.40, duration: 4, radius: 116, projectileSpeed: 1600, range: 660, cooldown: 45, cost: 2, hidesScratchMarks: false, label: "1.4x boost" },
            { level: 3, upgradeCost: 150, speedMultiplier: 1.80, duration: 5, radius: 124, projectileSpeed: 1720, range: 700, cooldown: 30, cost: 2, hidesScratchMarks: true, scratchHideDuration: 5, label: "1.8x boost + hidden scratch marks" }
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
          cooldown: 60,
          summary: "Escapist ability: prime your next window or pallet vault for a speed burst.",
          detail: "The boost triggers after your next vault, rewarding planned chase routes instead of frantic wall-hugging.",
          levels: [
            { level: 1, unlockCost: 50, speedMultiplier: 1.20, boostDuration: 2, duration: 10, cooldown: 60, cost: 5, label: "1.2x for 2s" },
            { level: 2, upgradeCost: 100, speedMultiplier: 1.40, boostDuration: 3, duration: 12, cooldown: 45, cost: 5, label: "1.4x for 3s" },
            { level: 3, upgradeCost: 150, speedMultiplier: 1.80, boostDuration: 4, duration: 14, cooldown: 30, cost: 5, label: "1.8x for 4s" }
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
          abilityCost: 2,
          cooldown: 60,
          summary: "Healer ability: fire a green dart that starts a ranged teammate recovery.",
          detail: "Level 2 can unbind hooked teammates. Level 3 can pick up downed Runners, even through ugly Void pressure.",
          inputType: "m1",
          shootAbility: true,
          projectileKind: "heal",
          levels: [
            { level: 1, unlockCost: 50, cost: 2, cooldown: 60, duration: 3, healProgress: 0.55, canUnhook: false, canPickupDowned: false, projectileSpeed: 1450, range: 620, radius: 58, label: "Heal over time" },
            { level: 2, upgradeCost: 100, cost: 2, cooldown: 45, duration: 3, healProgress: 0.70, unhookProgress: 0.80, canUnhook: true, canPickupDowned: false, projectileSpeed: 1550, range: 660, radius: 62, label: "Heal + unbind over time" },
            { level: 3, upgradeCost: 150, cost: 10, cooldown: 30, duration: 3, healProgress: 1.05, unhookProgress: 1.05, canUnhook: true, canPickupDowned: true, projectileSpeed: 1650, range: 700, radius: 66, label: "Heal, unbind, and pick up downed Runners" }
          ]
        },
        speedBurst: {
          id: "speedBurst",
          role: "survivor",
          name: "Speed Burst",
          shortName: "Burst",
          accent: "orange",
          abilityCost: 10,
          cooldown: 60,
          summary: "Legacy Runner speed boost kept for older accounts.",
          detail: "Unlocks the Runner speed boost. Higher levels extend the burst.",
          levels: [
            { level: 1, unlockCost: 50, duration: 2, speedMultiplier: 1.14 },
            { level: 2, upgradeCost: 100, duration: 3, speedMultiplier: 1.14 },
            { level: 3, upgradeCost: 150, duration: 4, speedMultiplier: 1.14 },
            { level: 4, upgradeCost: 200, duration: 5, speedMultiplier: 1.14 }
          ]
        },
        rallyDart: {
          id: "rallyDart",
          role: "survivor",
          name: "Rally Dart",
          shortName: "Dart",
          accent: "orange",
          abilityCost: 1,
          cooldown: 1,
          summary: "Fire a fast orange support dart that bursts into a Runner speed-boost ring.",
          detail: "Press M1 when ready to fire a fast support shot at your cursor or at your feet for a self boost. It explodes on walls and Runners, travels through windows and pallets, and boosts Runners in the blast. At tier 4, boosted Runners also hide scratch marks for the boost duration.",
          inputType: "m1",
          shootAbility: true,
          levels: [
            { level: 1, unlockCost: 50, duration: 1.25, speedMultiplier: 1.10, radius: 108, projectileSpeed: 1450, range: 600, aimWindow: 5, hidesScratchMarks: false },
            { level: 2, upgradeCost: 100, duration: 1.55, speedMultiplier: 1.12, radius: 112, projectileSpeed: 1550, range: 620, aimWindow: 5, hidesScratchMarks: false },
            { level: 3, upgradeCost: 150, duration: 1.85, speedMultiplier: 1.14, radius: 116, projectileSpeed: 1660, range: 640, aimWindow: 5.5, hidesScratchMarks: false },
            { level: 4, upgradeCost: 200, duration: 2.20, speedMultiplier: 1.16, radius: 122, projectileSpeed: 1780, range: 665, aimWindow: 6, hidesScratchMarks: true, scratchHideDuration: 2.20, special: "Boosted Runners hide scratch marks for the full boost duration." }
          ]
        },
        riftLens: {
          id: "riftLens",
          role: "survivor",
          name: "Rift Lens",
          shortName: "Lens",
          accent: "yellow",
          abilityCost: 10,
          cooldown: 30,
          summary: "Legacy Runner vision cone boost kept for older accounts.",
          detail: "Higher levels last longer and push your vision cone farther/wider.",
          levels: [
            { level: 1, unlockCost: 50, duration: 6, lengthMultiplier: 1.25, angleMultiplier: 1.14 },
            { level: 2, upgradeCost: 100, duration: 9, lengthMultiplier: 1.40, angleMultiplier: 1.25 },
            { level: 3, upgradeCost: 150, duration: 12, lengthMultiplier: 1.55, angleMultiplier: 1.38 },
            { level: 4, upgradeCost: 200, duration: 15, lengthMultiplier: 1.70, angleMultiplier: 1.50 }
          ]
        },
        hourglass: {
          id: "hourglass",
          role: "survivor",
          name: "Hourglass",
          shortName: "Hourglass",
          accent: "cyan",
          abilityCost: 10,
          cooldown: 30,
          summary: "Adds rear vision and hides scratch marks while active.",
          detail: "Higher levels improve the rear cone and scratch-mark hiding duration.",
          levels: [
            { level: 1, unlockCost: 50, duration: 2.5, backLengthMultiplier: 0.62, backAngleMultiplier: 0.78, hidesScratchMarks: true },
            { level: 2, upgradeCost: 100, duration: 3.5, backLengthMultiplier: 0.82, backAngleMultiplier: 1.00, hidesScratchMarks: true },
            { level: 3, upgradeCost: 150, duration: 4.5, backLengthMultiplier: 1.00, backAngleMultiplier: 1.18, hidesScratchMarks: true },
            { level: 4, upgradeCost: 200, duration: 5.5, backLengthMultiplier: 1.18, backAngleMultiplier: 1.32, hidesScratchMarks: true }
          ]
        }
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

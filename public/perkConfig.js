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
        speedBurst: {
          id: "speedBurst",
          role: "survivor",
          name: "Speed Burst",
          shortName: "Burst",
          accent: "green",
          abilityCost: 10,
          cooldown: 60,
          summary: "Panic sprint when The Void is breathing down your neck.",
          detail: "Unlocks the Runner speed boost. Higher levels extend the burst.",
          levels: [
            { level: 1, unlockCost: 50, duration: 2, speedMultiplier: 1.14 },
            { level: 2, upgradeCost: 100, duration: 3, speedMultiplier: 1.14 },
            { level: 3, upgradeCost: 150, duration: 4, speedMultiplier: 1.14 },
            { level: 4, upgradeCost: 200, duration: 5, speedMultiplier: 1.14 }
          ]
        },
        riftLens: {
          id: "riftLens",
          role: "survivor",
          name: "Rift Lens",
          shortName: "Lens",
          accent: "gold",
          abilityCost: 10,
          cooldown: 30,
          summary: "Widen your cone and read the map before becoming floor decoration.",
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
          detail: "Higher levels make the rear cone less pathetic, which is apparently useful when hunted.",
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
          summary: "Turns loose orbs into little slowdown landmines. Charming.",
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

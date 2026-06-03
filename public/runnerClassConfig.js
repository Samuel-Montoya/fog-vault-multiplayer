// public/runnerClassConfig.js
// Shared Runner class tuning. Change class abilities, granted perks, level scaling, and wheel layouts here.

const RIFTRUNNER_RUNNER_CLASS_CONFIG = {
  defaultClass: "orbCollector",
  classes: {
    healer: {
      id: "healer",
      name: "Healer",
      shortName: "Healer",
      accent: "cyan",
      icon: "+",
      summary: "Support Runner that keeps teammates alive and moving through pressure.",
      detail: "Built around recovery, rescue momentum, and quick healing windows during danger.",
      wheelOrder: ["healingPulse", "medicAura", "cancel", "moreSoon"],
      grantedPerks: {},
      passive: {
        label: "Medic Aura",
        healActionSpeedMultiplier: 1.08
      }
    },
    orbCollector: {
      id: "orbCollector",
      name: "Orb Collector",
      shortName: "Orb",
      accent: "gold",
      icon: "✦",
      summary: "Objective-focused Runner that controls routing, vision, and orb economy.",
      detail: "Built for banking orbs safely, scouting routes, and using a doubled orange-ring pickup radius.",
      wheelOrder: ["riftLens", "hourglass", "cancel", "orbMagnet"],
      grantedPerks: {
        riftLens: 1,
        hourglass: 1
      },
      passive: {
        label: "Orb Magnet",
        orbPickupRadiusMultiplier: 2,
        pickupRadiusRing: {
          color: 0xff9f1c,
          lineAlpha: 0.82,
          lineWidth: 2.2
        }
      }
    },
    chase: {
      id: "chase",
      name: "Chase",
      shortName: "Chase",
      accent: "purple",
      icon: "➟",
      summary: "Distraction Runner built to create space, absorb pressure, and escape.",
      detail: "Built for stretching chase, pulling attention, and creating breathing room for the team.",
      wheelOrder: ["rallyDart", "speedBurst", "cancel", "cleanFooting"],
      grantedPerks: {
        rallyDart: 1,
        speedBurst: 1
      },
      passive: {
        label: "Clean Footing",
        injuredVaultSpeedMultiplier: 1.08,
        detail: "While injured, window and pallet vaults are 8% faster."
      }
    }
  },
  abilities: {
    healingPulse: {
      id: "healingPulse",
      classAbility: true,
      classId: "healer",
      name: "Healing Pulse",
      shortName: "Pulse",
      accent: "cyan",
      cost: 12,
      cooldown: 50,
      radius: 140,
      duration: 0,
      summary: "Pulse nearby wounded Runners with quick healing progress.",
      detail: "Can be used while moving and during chase. Higher Runner levels make the pulse stronger.",
      levels: [
        { level: 1, minRunnerLevel: 1, healProgress: 0.15, radius: 130, cost: 12, cooldown: 52 },
        { level: 2, minRunnerLevel: 6, healProgress: 0.20, radius: 140, cost: 12, cooldown: 50 },
        { level: 3, minRunnerLevel: 14, healProgress: 0.30, radius: 150, cost: 14, cooldown: 48 },
        { level: 4, minRunnerLevel: 25, healProgress: 0.50, radius: 160, cost: 16, cooldown: 45 }
      ]
    },
    medicAura: {
      id: "medicAura",
      name: "Medic Aura",
      shortName: "Aura",
      accent: "cyan",
      cost: 0,
      cooldown: 0,
      summary: "Passive: slightly faster normal heals and rescues.",
      detail: "Passive class bonus. No button press needed.",
      disabled: true,
      passive: true
    },
    orbMagnet: {
      id: "orbMagnet",
      name: "Orb Magnet",
      shortName: "Magnet",
      accent: "gold",
      cost: 0,
      cooldown: 0,
      summary: "Passive: doubled orb pickup radius, shown by a simple orange ring.",
      detail: "Passive class bonus. The simple orange ring shows your doubled orb pickup range; no button press needed.",
      disabled: true,
      passive: true
    },
    rallyDart: {
      id: "rallyDart",
      name: "Rally Dart",
      shortName: "Dart",
      accent: "orange",
      cost: 15,
      cooldown: 55,
      radius: 112,
      duration: 1.25,
      summary: "Press M1 when ready to shoot a Rally Dart at your cursor or on yourself.",
      detail: "No Q activation needed. M1 fires the dart through windows and pallets, explodes on walls or Runners, and boosts anyone inside the orange ring. At tier 4, boosted Runners hide scratch marks for the boost duration.",
      inputType: "m1",
      shootAbility: true
    },
    cleanFooting: {
      id: "cleanFooting",
      name: "Clean Footing",
      shortName: "Footing",
      accent: "purple",
      cost: 0,
      cooldown: 0,
      summary: "Passive: injured window and pallet vaults are 8% faster.",
      detail: "Passive class bonus. While injured, your vault animation is 8% faster; no button press needed.",
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

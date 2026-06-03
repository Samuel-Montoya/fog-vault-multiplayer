// public/abilities.js
// Shared Void + Runner ability definitions for the React UI, Phaser client bridge, and Node server.
// Internal role names stay "killer"/"survivor" because games enjoy not detonating.

const RIFTRUNNER_ABILITIES = {
  wheelOrder: ["nullRush", "redshiftOrbs", "cancel", "voidReveal"],
  abilities: {
    nullRush: {
      id: "nullRush",
      name: "Null Rush",
      shortName: "Rush",
      cost: 15,
      duration: 10,
      cooldown: 20,
      summary: "Move faster for 10 seconds.",
      detail: "The Void tears forward, leaving a gray afterimage wake.",
      accent: "gray"
    },
    redshiftOrbs: {
      id: "redshiftOrbs",
      name: "Redshift Bloom",
      shortName: "Redshift",
      cost: 25,
      duration: 15,
      cooldown: 20,
      summary: "Turns map orbs red for 15 seconds.",
      detail: "Runners that touch red orbs are slowed for a heartbeat.",
      accent: "red"
    },
    cancel: {
      id: "cancel",
      name: "Cancel",
      shortName: "Cancel",
      cost: 0,
      duration: 0,
      summary: "Close the wheel.",
      detail: "Drop the selection without spending orbs.",
      accent: "muted",
      cancel: true
    },
    voidReveal: {
      id: "voidReveal",
      name: "Void Sight",
      shortName: "Sight",
      cost: 15,
      duration: 5,
      cooldown: 20,
      summary: "Reveals all Runners for 5 seconds.",
      detail: "The Void sees every Runner and pulls the camera back.",
      accent: "purple"
    }
  },

  survivorWheelOrder: ["speedBurst", "riftLens", "cancel", "hourglass"],
  survivorAbilities: {
    speedBurst: {
      id: "speedBurst",
      name: "Speed Burst",
      shortName: "Burst",
      cost: 10,
      duration: 5,
      cooldown: 60,
      summary: "Small speed boost for 5 seconds.",
      detail: "A controlled burst of speed. Fast enough to reposition, not fast enough to become a caffeinated mosquito.",
      accent: "green"
    },
    rallyDart: {
      id: "rallyDart",
      name: "Rally Dart",
      shortName: "Dart",
      cost: 15,
      duration: 1.25,
      cooldown: 55,
      radius: 112,
      projectileSpeed: 560,
      range: 620,
      aimWindow: 5,
      speedMultiplier: 1.10,
      summary: "Press M1 when ready to fire an orange support dart at your cursor or feet.",
      detail: "No Q activation needed. M1 fires the dart toward the cursor, through windows and pallets, and into an orange boost ring. Tier 4 also hides boosted Runners' scratch marks for the boost duration.",
      accent: "orange",
      inputType: "m1",
      shootAbility: true
    },
    riftLens: {
      id: "riftLens",
      name: "Rift Lens",
      shortName: "Lens",
      cost: 10,
      duration: 15,
      cooldown: 30,
      summary: "Widen your vision cone for 15 seconds.",
      detail: "Your cone expands and reveals more of the world: orbs, players, The Void, walls, and objectives.",
      accent: "gold"
    },
    hourglass: {
      id: "hourglass",
      name: "Hourglass",
      shortName: "Hourglass",
      cost: 10,
      duration: 5,
      cooldown: 30,
      summary: "See behind you and hide scratch marks for 5 seconds.",
      detail: "Adds a second cone behind you and hides scratch marks while active, because escaping should involve slightly fewer breadcrumbs.",
      accent: "cyan"
    },
    cancel: {
      id: "cancel",
      name: "Cancel",
      shortName: "Cancel",
      cost: 0,
      duration: 0,
      summary: "Close the wheel.",
      detail: "Drop the selection without spending orbs.",
      accent: "muted",
      cancel: true
    },
    moreSoon: {
      id: "moreSoon",
      name: "More Soon",
      shortName: "Soon",
      cost: 0,
      duration: 0,
      cooldown: 0,
      summary: "More Runner abilities later.",
      detail: "A quiet little placeholder, because apparently two powers are not enough forever.",
      accent: "muted",
      cancel: true,
      disabled: true
    }
  }
};

if (typeof window !== "undefined") {
  window.RIFTRUNNER_ABILITIES = RIFTRUNNER_ABILITIES;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = RIFTRUNNER_ABILITIES;
}

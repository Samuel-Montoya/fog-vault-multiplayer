// public/abilities.js
// Shared Void + Runner ability definitions for the React UI, Phaser client bridge, and Node server.
// Internal role names stay "killer"/"survivor" for compatibility with existing server/client code.

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

  survivorWheelOrder: ["collectionBolt", "doubleOrb", "cancel", "orbMagnet"],
  survivorAbilities: {
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
      summary: "More class tools later.",
      detail: "Placeholder slot for future class tools.",
      accent: "muted",
      cancel: true,
      disabled: true
    },
  }
};

if (typeof window !== "undefined") {
  window.RIFTRUNNER_ABILITIES = RIFTRUNNER_ABILITIES;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = RIFTRUNNER_ABILITIES;
}

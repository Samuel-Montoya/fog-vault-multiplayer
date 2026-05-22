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

  survivorWheelOrder: ["stealthStep", "riftLens", "cancel", "moreSoon"],
  survivorAbilities: {
    stealthStep: {
      id: "stealthStep",
      name: "Stealth Step",
      shortName: "Stealth",
      cost: 10,
      duration: 10,
      cooldown: 30,
      summary: "Hide scratch marks for 10 seconds.",
      detail: "Move quietly enough that The Void loses your trail.",
      accent: "cyan"
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

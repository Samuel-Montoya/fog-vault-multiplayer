// public/abilities.js
// Shared Void ability definitions for the React UI, Phaser client bridge, and Node server.
// Internal role names stay "killer"/"survivor" because games enjoy not detonating.

const RIFTRUNNER_ABILITIES = {
  wheelOrder: ["nullRush", "redshiftOrbs", "cancel", "orbLeech"],
  abilities: {
    nullRush: {
      id: "nullRush",
      name: "Null Rush",
      shortName: "Rush",
      cost: 15,
      duration: 10,
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
    orbLeech: {
      id: "orbLeech",
      name: "Hollow Leech",
      shortName: "Leech",
      cost: 8,
      duration: 0,
      summary: "Steals half of every Runner's carried orbs.",
      detail: "The Void pulls half of each carried stash into itself.",
      accent: "gold",
      stealPercent: 0.5
    }
  }
};

if (typeof window !== "undefined") {
  window.RIFTRUNNER_ABILITIES = RIFTRUNNER_ABILITIES;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = RIFTRUNNER_ABILITIES;
}

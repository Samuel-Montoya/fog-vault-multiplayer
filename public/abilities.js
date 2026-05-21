// public/abilities.js
// Shared Void ability definitions for the React UI, Phaser client bridge, and Node server.
// Internal role names stay "killer"/"survivor" because games enjoy not detonating.

const RIFTRUNNER_ABILITIES = {
  wheelOrder: ["nullRush", "redshiftOrbs", "gravityWell", "orbLeech"],
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
    gravityWell: {
      id: "gravityWell",
      name: "Gravity Well",
      shortName: "Well",
      cost: 20,
      duration: 1.25,
      summary: "Briefly slows nearby Runners.",
      detail: "A pressure wave bends the route around The Void.",
      accent: "purple",
      radius: 560
    },
    orbLeech: {
      id: "orbLeech",
      name: "Hollow Leech",
      shortName: "Leech",
      cost: 18,
      duration: 0,
      summary: "Steals 1 orb from each loaded Runner.",
      detail: "The Void pulls loose carried light and keeps it.",
      accent: "gold",
      stealPerRunner: 1
    }
  }
};

if (typeof window !== "undefined") {
  window.RIFTRUNNER_ABILITIES = RIFTRUNNER_ABILITIES;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = RIFTRUNNER_ABILITIES;
}

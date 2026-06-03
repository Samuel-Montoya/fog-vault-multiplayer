// public/levelConfig.js
// Shared leveling + match scoring knobs for RiftRunner.
// Edit this file to rebalance score, XP, level curves, and level-up orb rewards.
// Server restart required after edits. Hard-refresh clients if you also use these values in UI.

const RIFTRUNNER_LEVEL_CONFIG = {
  version: 1,

  // Level curve formula:
  // XP needed for next level = baseXp + currentLevel * perLevelXp + currentLevel^exponent * exponentBonus
  // With these defaults, early levels move fast and later levels stop pretending people have infinite weekends.
  levelCurve: {
    maxLevel: 100,
    baseXp: 900,
    perLevelXp: 125,
    exponent: 1.12,
    exponentBonus: 12,
    minXp: 1000,
    maxXp: 14000
  },

  tracks: {
    account: {
      label: "Rift Level",
      shortLabel: "RIFT",
      xpRate: 0.25,
      levelRewardOrbs: 35,
      bonusEveryLevels: 5,
      bonusRewardOrbs: 100
    },
    runner: {
      label: "Runner Level",
      shortLabel: "RUNNER",
      xpRate: 0.18,
      levelRewardOrbs: 15,
      bonusEveryLevels: 5,
      bonusRewardOrbs: 60
    },
    void: {
      label: "Void Level",
      shortLabel: "VOID",
      xpRate: 0.18,
      levelRewardOrbs: 15,
      bonusEveryLevels: 5,
      bonusRewardOrbs: 60
    }
  },

  score: {
    minimumScore: 25,
    shortMatch: {
      fullXpSeconds: 180,
      naturalEndMinimumMultiplier: 0.70,
      earlyExitMinimumMultiplier: 0.45
    },
    afk: {
      minMatchSeconds: 120,
      maxMultiplier: 0.10,
      runnerMinUsefulScore: 120,
      voidMinUsefulScore: 160
    },

    runner: {
      actions: {
        orbsCollected: { label: "Orbs collected", points: 4, cap: 520 },
        orbsDeposited: { label: "Orbs deposited", points: 24, cap: 2200 },
        voidStuns: { label: "Void stuns", points: 160, cap: 640 },
        teammatesHealed: { label: "Heals", points: 275, cap: 1100 },
        unhooks: { label: "Rescues", points: 350, cap: 1050 },
        chaseSeconds: { label: "Chase survival", points: 8, cap: 1400 }
      },
      bonuses: {
        escaped: 650,
        diedAfterMeaningfulContribution: 250,
        teamEscapePerRunner: 125,
        longestChase20: 150,
        longestChase40: 300,
        longestChase60: 500
      },
      multipliers: {
        escaped: 1.15,
        usefulDeath: 1.00,
        lowContributionDeath: 0.75,
        disconnected: 0.55
      }
    },

    void: {
      actions: {
        riftsKicked: { label: "Rifts kicked", points: 150, cap: 900 },
        orbsCollected: { label: "Orbs collected", points: 5, cap: 500 },
        orbsStolen: { label: "Orbs stolen", points: 12, cap: 840 },
        injures: { label: "Injuries", points: 170, cap: 1360 },
        downs: { label: "Downs", points: 260, cap: 1560 },
        hooks: { label: "Binds", points: 360, cap: 2160 },
        deaths: { label: "Runners consumed", points: 725, cap: 2900 },
        abilitiesUsed: { label: "Abilities used", points: 55, cap: 440 }
      },
      bonuses: {
        noEscapes: 900,
        oneEscapeOnly: 450,
        fullTeamPressure: 250
      },
      multipliers: {
        fourKills: 1.20,
        threeKills: 1.10,
        twoKills: 1.00,
        oneKill: 0.90,
        noKillsHighPressure: 0.85,
        disconnected: 0.55
      }
    }
  }
};

if (typeof window !== "undefined") {
  window.RIFTRUNNER_LEVEL_CONFIG = RIFTRUNNER_LEVEL_CONFIG;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = RIFTRUNNER_LEVEL_CONFIG;
}

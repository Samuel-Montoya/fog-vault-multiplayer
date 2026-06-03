const DEFAULT_CURVE = Object.freeze({
  maxLevel: 100,
  baseXp: 900,
  perLevelXp: 125,
  exponent: 1.12,
  exponentBonus: 12,
  minXp: 1000,
  maxXp: 14000
});

const TRACK_DEFAULTS = Object.freeze({
  account: { label: "Rift Level", shortLabel: "RIFT", xpRate: 0.25, levelRewardOrbs: 35, bonusEveryLevels: 5, bonusRewardOrbs: 100 },
  runner: { label: "Runner Level", shortLabel: "RUNNER", xpRate: 0.18, levelRewardOrbs: 15, bonusEveryLevels: 5, bonusRewardOrbs: 60 },
  void: { label: "Void Level", shortLabel: "VOID", xpRate: 0.18, levelRewardOrbs: 15, bonusEveryLevels: 5, bonusRewardOrbs: 60 }
});

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toInt(value, fallback = 0) {
  return Math.floor(toNumber(value, fallback));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function scoreConfig(config) {
  return config?.score || {};
}

function curveConfig(config, trackKey = "account") {
  const trackCurve = config?.tracks?.[trackKey]?.levelCurve || {};
  return { ...DEFAULT_CURVE, ...(config?.levelCurve || {}), ...trackCurve };
}

function trackConfig(config, trackKey = "account") {
  return { ...(TRACK_DEFAULTS[trackKey] || TRACK_DEFAULTS.account), ...(config?.tracks?.[trackKey] || {}) };
}

function xpNeededForLevel(level, config, trackKey = "account") {
  const curve = curveConfig(config, trackKey);
  const currentLevel = clamp(toInt(level, 1), 1, toInt(curve.maxLevel, 100));
  const raw = toNumber(curve.baseXp, 900)
    + currentLevel * toNumber(curve.perLevelXp, 125)
    + Math.pow(currentLevel, toNumber(curve.exponent, 1.12)) * toNumber(curve.exponentBonus, 12);
  return clamp(Math.round(raw), Math.max(1, toInt(curve.minXp, 1)), Math.max(1, toInt(curve.maxXp, 14000)));
}

function publicTrackProgression(trackKey, rowOrState = {}, config) {
  const curve = curveConfig(config, trackKey);
  const cfg = trackConfig(config, trackKey);
  const level = clamp(toInt(rowOrState.level, 1), 1, toInt(curve.maxLevel, 100));
  const xp = Math.max(0, toInt(rowOrState.xp, 0));
  const totalXp = Math.max(0, toInt(rowOrState.totalXp, rowOrState.total_xp || 0));
  const nextXp = level >= toInt(curve.maxLevel, 100) ? 0 : xpNeededForLevel(level, config, trackKey);
  return {
    key: trackKey,
    label: cfg.label,
    shortLabel: cfg.shortLabel,
    level,
    xp: nextXp > 0 ? Math.min(xp, nextXp) : xp,
    totalXp,
    nextXp,
    progress: nextXp > 0 ? clamp(xp / nextXp, 0, 1) : 1,
    maxLevel: toInt(curve.maxLevel, 100)
  };
}

function levelRewardForLevel(level, config, trackKey) {
  const cfg = trackConfig(config, trackKey);
  const normal = Math.max(0, toInt(cfg.levelRewardOrbs, 0));
  const every = Math.max(0, toInt(cfg.bonusEveryLevels, 0));
  const bonus = every > 0 && level % every === 0 ? Math.max(0, toInt(cfg.bonusRewardOrbs, 0)) : 0;
  return normal + bonus;
}

function applyXpToTrack(state, xpGained, config, trackKey = "account") {
  const curve = curveConfig(config, trackKey);
  const maxLevel = toInt(curve.maxLevel, 100);
  let level = clamp(toInt(state?.level, 1), 1, maxLevel);
  let xp = Math.max(0, toInt(state?.xp, 0));
  let totalXp = Math.max(0, toInt(state?.totalXp, state?.total_xp || 0));
  const gained = Math.max(0, toInt(xpGained, 0));
  const before = publicTrackProgression(trackKey, { level, xp, totalXp }, config);
  let overflow = gained;
  let levelsGained = 0;
  let rewardOrbs = 0;
  const levelUps = [];

  totalXp += gained;
  xp += gained;

  while (level < maxLevel) {
    const needed = xpNeededForLevel(level, config, trackKey);
    if (xp < needed) break;
    xp -= needed;
    overflow = xp;
    level += 1;
    levelsGained += 1;
    const orbs = levelRewardForLevel(level, config, trackKey);
    rewardOrbs += orbs;
    levelUps.push({ level, rewardOrbs: orbs });
  }

  if (level >= maxLevel) xp = 0;

  const after = publicTrackProgression(trackKey, { level, xp, totalXp }, config);
  return {
    key: trackKey,
    xpGained: gained,
    levelsGained,
    rewardOrbs,
    overflowXp: Math.max(0, overflow),
    levelUps,
    before,
    after
  };
}

function rowToProgression(row = {}, config) {
  return {
    account: publicTrackProgression("account", {
      level: row.account_level,
      xp: row.account_xp,
      totalXp: row.account_total_xp
    }, config),
    runner: publicTrackProgression("runner", {
      level: row.runner_level,
      xp: row.runner_xp,
      totalXp: row.runner_total_xp
    }, config),
    void: publicTrackProgression("void", {
      level: row.void_level,
      xp: row.void_xp,
      totalXp: row.void_total_xp
    }, config)
  };
}

function addBreakdownItem(items, label, raw, points, cap = Infinity) {
  const count = Math.max(0, toNumber(raw, 0));
  const value = Math.max(0, Math.round(count * toNumber(points, 0)));
  const capped = Math.min(value, Number.isFinite(cap) ? Math.max(0, toInt(cap, 0)) : value);
  if (capped > 0) items.push({ label, count, points: capped });
  return capped;
}

function addFlatBonus(items, label, points) {
  const value = Math.max(0, Math.round(toNumber(points, 0)));
  if (value > 0) items.push({ label, count: 1, points: value, bonus: true });
  return value;
}

function stat(stats, key) {
  return toNumber(stats?.[key], 0);
}

function computeRunnerScore({ stats = {}, actor = {}, context = {}, config = {} }) {
  const cfg = scoreConfig(config).runner || {};
  const actions = cfg.actions || {};
  const bonuses = cfg.bonuses || {};
  const items = [];
  let base = 0;

  for (const [key, def] of Object.entries(actions)) {
    base += addBreakdownItem(items, def.label || key, stat(stats, key), def.points, def.cap);
  }

  const escaped = !!(stats.escaped || actor.escaped);
  const dead = !!actor.dead;
  const disconnected = context.reason === "disconnect";
  const escapedCount = Math.max(0, toInt(context.escapedCount, 0));
  const meaningful = stat(stats, "orbsDeposited") >= 8 || stat(stats, "unhooks") > 0 || stat(stats, "teammatesHealed") > 0 || stat(stats, "chaseSeconds") >= 20;

  if (escaped) base += addFlatBonus(items, "Escaped", bonuses.escaped);
  if (!escaped && (dead || actor.hooked || actor.downed) && meaningful) {
    base += addFlatBonus(items, "Meaningful sacrifice", bonuses.diedAfterMeaningfulContribution);
  }
  if (escapedCount > 0) base += addFlatBonus(items, "Team escape pressure", escapedCount * toNumber(bonuses.teamEscapePerRunner, 0));

  const longest = stat(stats, "longestChase");
  if (longest >= 60) base += addFlatBonus(items, "Longest chase 60s+", bonuses.longestChase60);
  else if (longest >= 40) base += addFlatBonus(items, "Longest chase 40s+", bonuses.longestChase40);
  else if (longest >= 20) base += addFlatBonus(items, "Longest chase 20s+", bonuses.longestChase20);

  const multCfg = cfg.multipliers || {};
  let multiplier = escaped
    ? toNumber(multCfg.escaped, 1.15)
    : meaningful
      ? toNumber(multCfg.usefulDeath, 1)
      : toNumber(multCfg.lowContributionDeath, 0.75);
  if (disconnected) multiplier = Math.min(multiplier, toNumber(multCfg.disconnected, 0.55));

  return { base, multiplier, items, usefulScore: base };
}

function computeVoidScore({ stats = {}, context = {}, config = {} }) {
  const cfg = scoreConfig(config).void || {};
  const actions = cfg.actions || {};
  const bonuses = cfg.bonuses || {};
  const items = [];
  let base = 0;

  for (const [key, def] of Object.entries(actions)) {
    base += addBreakdownItem(items, def.label || key, stat(stats, key), def.points, def.cap);
  }

  const escapedCount = Math.max(0, toInt(context.escapedCount, 0));
  const totalSurvivors = Math.max(0, toInt(context.totalSurvivors, 0));
  const kills = Math.max(0, toInt(stats.deaths, 0));
  const disconnected = context.reason === "disconnect";

  if (totalSurvivors > 0 && escapedCount === 0) base += addFlatBonus(items, "No escapes", bonuses.noEscapes);
  else if (escapedCount === 1) base += addFlatBonus(items, "One escape only", bonuses.oneEscapeOnly);
  if (totalSurvivors >= 3 && stat(stats, "hooks") >= totalSurvivors) {
    base += addFlatBonus(items, "Full team pressure", bonuses.fullTeamPressure);
  }

  const multCfg = cfg.multipliers || {};
  let multiplier = kills >= 4
    ? toNumber(multCfg.fourKills, 1.20)
    : kills === 3
      ? toNumber(multCfg.threeKills, 1.10)
      : kills === 2
        ? toNumber(multCfg.twoKills, 1.00)
        : kills === 1
          ? toNumber(multCfg.oneKill, 0.90)
          : toNumber(multCfg.noKillsHighPressure, 0.85);
  if (disconnected) multiplier = Math.min(multiplier, toNumber(multCfg.disconnected, 0.55));

  return { base, multiplier, items, usefulScore: base };
}

function shortMatchMultiplier(matchSeconds, naturalEnd, config) {
  const shortCfg = scoreConfig(config).shortMatch || {};
  const full = Math.max(1, toNumber(shortCfg.fullXpSeconds, 180));
  const seconds = Math.max(0, toNumber(matchSeconds, 0));
  if (seconds >= full) return 1;
  const floor = naturalEnd ? toNumber(shortCfg.naturalEndMinimumMultiplier, 0.70) : toNumber(shortCfg.earlyExitMinimumMultiplier, 0.45);
  return clamp(floor + (1 - floor) * (seconds / full), floor, 1);
}

function afkMultiplier(roleKey, usefulScore, matchSeconds, config) {
  const afk = scoreConfig(config).afk || {};
  if (Math.max(0, toNumber(matchSeconds, 0)) < toNumber(afk.minMatchSeconds, 120)) return 1;
  const minimum = roleKey === "void" ? toNumber(afk.voidMinUsefulScore, 160) : toNumber(afk.runnerMinUsefulScore, 120);
  return usefulScore < minimum ? toNumber(afk.maxMultiplier, 0.10) : 1;
}

function computeMatchProgression({ actor = {}, stats = null, context = {}, config = {} } = {}) {
  const role = actor.role === "killer" || context.role === "killer" || context.role === "void" ? "killer" : "survivor";
  const roleTrack = role === "killer" ? "void" : "runner";
  const safeStats = stats || actor.stats || {};
  const scored = roleTrack === "void"
    ? computeVoidScore({ stats: safeStats, actor, context, config })
    : computeRunnerScore({ stats: safeStats, actor, context, config });

  const naturalEnd = context.reason !== "disconnect";
  let multiplier = scored.multiplier * shortMatchMultiplier(context.matchSeconds, naturalEnd, config);
  const afk = afkMultiplier(roleTrack, scored.usefulScore, context.matchSeconds, config);
  if (afk < 1) multiplier = Math.min(multiplier, afk);

  const minimumScore = Math.max(0, toInt(scoreConfig(config).minimumScore, 25));
  const score = scored.base > 0 ? Math.max(minimumScore, Math.round(scored.base * multiplier)) : 0;
  const accountXp = Math.max(0, Math.round(score * toNumber(trackConfig(config, "account").xpRate, 0.25)));
  const roleXp = Math.max(0, Math.round(score * toNumber(trackConfig(config, roleTrack).xpRate, 0.18)));

  return {
    role: roleTrack,
    score,
    baseScore: Math.round(scored.base),
    multiplier: Number(multiplier.toFixed(3)),
    accountXp,
    roleXp,
    matchSeconds: Math.max(0, toNumber(context.matchSeconds, 0)),
    breakdown: scored.items
  };
}

module.exports = {
  xpNeededForLevel,
  publicTrackProgression,
  rowToProgression,
  applyXpToTrack,
  computeMatchProgression,
  trackConfig
};

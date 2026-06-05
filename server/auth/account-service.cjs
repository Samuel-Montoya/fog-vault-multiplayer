const crypto = require("crypto");
const path = require("path");
const { query, withTransaction, isDatabaseReady } = require("../db/pool.cjs");
const skinCatalog = require("../economy/skin-catalog.cjs");
const { loadPublicScriptGlobal } = require("../config/load-public-script.cjs");
const perkCatalog = loadPublicScriptGlobal(path.resolve(__dirname, "../.."), "public/perkConfig.js", "RIFTRUNNER_PERK_CONFIG");
const levelConfig = loadPublicScriptGlobal(path.resolve(__dirname, "../.."), "public/levelConfig.js", "RIFTRUNNER_LEVEL_CONFIG");
const runnerClassConfig = loadPublicScriptGlobal(path.resolve(__dirname, "../.."), "public/runnerClassConfig.js", "RIFTRUNNER_RUNNER_CLASS_CONFIG");
const {
  applyXpToTrack,
  rowToProgression,
  xpNeededForLevel
} = require("../progression/leveling.cjs");

let bcrypt = null;
let jwt = null;
try { bcrypt = require("bcryptjs"); } catch { bcrypt = null; }
try { jwt = require("jsonwebtoken"); } catch { jwt = null; }

const TOKEN_DAYS = Math.max(1, Number(process.env.AUTH_TOKEN_DAYS || 90));
const BCRYPT_ROUNDS = Math.max(8, Math.min(14, Number(process.env.BCRYPT_ROUNDS || 10)));
const USERNAME_RE = /^[a-zA-Z0-9_\-.]{3,24}$/;

function authSecret() {
  const secret = process.env.AUTH_SECRET || process.env.SESSION_SECRET || process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") return "";
  return "riftrunner-dev-secret-change-me";
}

function authAvailable() {
  return !!bcrypt && !!jwt && !!authSecret() && isDatabaseReady();
}

function assertAuthReady() {
  if (!bcrypt) throw new Error("bcryptjs is not installed. Run npm install.");
  if (!jwt) throw new Error("jsonwebtoken is not installed. Run npm install.");
  if (!authSecret()) throw new Error("AUTH_SECRET is not set.");
  if (!isDatabaseReady()) throw new Error("Database is not configured. Set DATABASE_URL and run npm run db:init.");
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function cleanDisplayName(value, fallback = "Runner") {
  const cleaned = String(value || "").replace(/[^\w .\-]/g, "").trim().slice(0, 24);
  return cleaned || fallback;
}

function assertUsername(username) {
  const value = String(username || "").trim();
  if (!USERNAME_RE.test(value)) {
    throw new Error("Username must be 3-24 characters and only use letters, numbers, _, -, or .");
  }
  return value;
}

function assertPassword(password) {
  const value = String(password || "");
  if (value.length < 6 || value.length > 72) throw new Error("Password must be 6-72 characters.");
  return value;
}

let progressionSchemaPromise = null;

function progressionColumnSql() {
  return `
    ALTER TABLE accounts
      ADD COLUMN IF NOT EXISTS account_level INTEGER NOT NULL DEFAULT 1 CHECK (account_level >= 1),
      ADD COLUMN IF NOT EXISTS account_xp INTEGER NOT NULL DEFAULT 0 CHECK (account_xp >= 0),
      ADD COLUMN IF NOT EXISTS account_total_xp INTEGER NOT NULL DEFAULT 0 CHECK (account_total_xp >= 0),
      ADD COLUMN IF NOT EXISTS runner_level INTEGER NOT NULL DEFAULT 1 CHECK (runner_level >= 1),
      ADD COLUMN IF NOT EXISTS runner_xp INTEGER NOT NULL DEFAULT 0 CHECK (runner_xp >= 0),
      ADD COLUMN IF NOT EXISTS runner_total_xp INTEGER NOT NULL DEFAULT 0 CHECK (runner_total_xp >= 0),
      ADD COLUMN IF NOT EXISTS void_level INTEGER NOT NULL DEFAULT 1 CHECK (void_level >= 1),
      ADD COLUMN IF NOT EXISTS void_xp INTEGER NOT NULL DEFAULT 0 CHECK (void_xp >= 0),
      ADD COLUMN IF NOT EXISTS void_total_xp INTEGER NOT NULL DEFAULT 0 CHECK (void_total_xp >= 0),
      ADD COLUMN IF NOT EXISTS selected_runner_class TEXT NOT NULL DEFAULT 'orbCollector';

    CREATE TABLE IF NOT EXISTS match_progression_awards (
      id BIGSERIAL PRIMARY KEY,
      account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
      lobby_id TEXT NOT NULL,
      match_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      player_name TEXT NOT NULL,
      player_role TEXT NOT NULL CHECK (player_role IN ('runner', 'void')),
      reason TEXT NOT NULL DEFAULT 'match',
      match_seconds NUMERIC NOT NULL DEFAULT 0,
      base_score INTEGER NOT NULL DEFAULT 0 CHECK (base_score >= 0),
      match_score INTEGER NOT NULL DEFAULT 0 CHECK (match_score >= 0),
      account_xp INTEGER NOT NULL DEFAULT 0 CHECK (account_xp >= 0),
      role_xp INTEGER NOT NULL DEFAULT 0 CHECK (role_xp >= 0),
      orbs_deposited INTEGER NOT NULL DEFAULT 0 CHECK (orbs_deposited >= 0),
      level_reward_orbs INTEGER NOT NULL DEFAULT 0 CHECK (level_reward_orbs >= 0),
      breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
      progression_result JSONB NOT NULL DEFAULT '{}'::jsonb,
      awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (match_id, player_id)
    );

    CREATE INDEX IF NOT EXISTS idx_match_progression_awards_account_id ON match_progression_awards (account_id);
    CREATE INDEX IF NOT EXISTS idx_match_progression_awards_match_id ON match_progression_awards (match_id);
  `;
}

async function ensureProgressionSchema() {
  if (!isDatabaseReady()) return;
  if (!progressionSchemaPromise) {
    progressionSchemaPromise = query(progressionColumnSql()).catch((error) => {
      progressionSchemaPromise = null;
      throw error;
    });
  }
  await progressionSchemaPromise;
}


function normalizeRunnerClassId(value) {
  const classes = runnerClassConfig.classes || {};
  const fallback = String(runnerClassConfig.defaultClass || "orbCollector");
  const id = String(value || fallback);
  if (classes[id]) return id;
  const aliasMatch = Object.values(classes).find((runnerClass) => Array.isArray(runnerClass.aliases) && runnerClass.aliases.includes(id));
  if (aliasMatch?.id && classes[aliasMatch.id]) return aliasMatch.id;
  return classes[fallback] ? fallback : Object.keys(classes)[0] || "orbCollector";
}

function publicRunnerClassCatalog() {
  return Object.values(runnerClassConfig.classes || {}).map((runnerClass) => ({
    id: normalizeRunnerClassId(runnerClass.id),
    name: runnerClass.name || runnerClass.id,
    shortName: runnerClass.shortName || runnerClass.name || runnerClass.id,
    accent: runnerClass.accent || "cyan",
    icon: runnerClass.icon || "◆",
    summary: runnerClass.summary || "Runner class.",
    detail: runnerClass.detail || runnerClass.summary || "Runner class.",
    grantedPerks: runnerClass.grantedPerks || {},
    passive: runnerClass.passive || null
  }));
}

function progressionStateFromAccountRow(row) {
  return rowToProgression(row || {}, levelConfig);
}

function progressionTrackState(row, track) {
  const key = track === "void" ? "void" : track === "runner" ? "runner" : "account";
  return {
    level: Number(row?.[`${key}_level`] || 1),
    xp: Number(row?.[`${key}_xp`] || 0),
    totalXp: Number(row?.[`${key}_total_xp`] || 0)
  };
}

function summarizeProgressionAward({ accountAward, roleAward, role, score, baseScore, orbsDeposited, levelRewardOrbs, breakdown, matchSeconds }) {
  return {
    score: Math.max(0, Math.floor(Number(score || 0))),
    baseScore: Math.max(0, Math.floor(Number(baseScore || 0))),
    accountXp: Math.max(0, Math.floor(Number(accountAward?.xpGained || 0))),
    roleXp: Math.max(0, Math.floor(Number(roleAward?.xpGained || 0))),
    role,
    matchSeconds: Math.max(0, Number(matchSeconds || 0)),
    orbsDeposited: Math.max(0, Math.floor(Number(orbsDeposited || 0))),
    levelRewardOrbs: Math.max(0, Math.floor(Number(levelRewardOrbs || 0))),
    totalOrbReward: Math.max(0, Math.floor(Number(orbsDeposited || 0))) + Math.max(0, Math.floor(Number(levelRewardOrbs || 0))),
    account: accountAward,
    roleTrack: roleAward,
    breakdown: Array.isArray(breakdown) ? breakdown : []
  };
}


function normalizePerkRole(role) {
  const value = String(role || "").toLowerCase();
  if (value === "void" || value === "killer") return "killer";
  return "survivor";
}

function getPerkDef(perkId) {
  const id = String(perkId || "");
  const roles = perkCatalog.roles || {};
  for (const [role, roleDef] of Object.entries(roles)) {
    const perk = roleDef?.perks?.[id];
    if (perk) return { ...perk, role: normalizePerkRole(perk.role || role) };
  }
  return null;
}

function perkLevelRows(perk) {
  return Array.isArray(perk?.levels) ? perk.levels : [];
}

function getMaxPerkLevel(perk) {
  const configured = Math.max(1, Math.floor(Number(perkCatalog.maxLevel || 4)));
  const levels = perkLevelRows(perk).map((level) => Math.floor(Number(level.level || 0))).filter(Boolean);
  return Math.max(1, Math.min(configured, levels.length ? Math.max(...levels) : configured));
}

function getPerkDefaultLevel(perk) {
  if (!perk) return 0;
  const rawDefault = perk.defaultLevel ?? (perk.passive || perk.alwaysUnlocked ? 1 : 0);
  const level = Math.floor(Number(rawDefault || 0));
  if (!Number.isFinite(level) || level <= 0) return 0;
  return Math.max(0, Math.min(getMaxPerkLevel(perk), level));
}

function getPerkEffectiveLevel(perk, storedLevel = 0) {
  const maxLevel = getMaxPerkLevel(perk);
  const boughtLevel = Math.max(0, Math.min(maxLevel, Math.floor(Number(storedLevel || 0))));
  return Math.max(getPerkDefaultLevel(perk), boughtLevel);
}

function seedDefaultPerks(out, roleFilter = null) {
  const roles = perkCatalog.roles || {};
  for (const [role, roleDef] of Object.entries(roles)) {
    const normalizedRole = normalizePerkRole(role);
    if (roleFilter && normalizedRole !== roleFilter) continue;
    for (const perk of Object.values(roleDef?.perks || {})) {
      const defaultLevel = getPerkDefaultLevel({ ...perk, role: normalizePerkRole(perk.role || role) });
      if (defaultLevel <= 0) continue;
      out.all[perk.id] = Math.max(out.all[perk.id] || 0, defaultLevel);
      out[normalizedRole][perk.id] = Math.max(out[normalizedRole][perk.id] || 0, defaultLevel);
    }
  }
  return out;
}

function getPerkLevelConfig(perk, level) {
  const target = Math.max(1, Math.floor(Number(level || 1)));
  return perkLevelRows(perk).find((row) => Math.floor(Number(row.level || 0)) === target) || null;
}

function getPerkNextCost(perk, currentLevel) {
  const level = getPerkEffectiveLevel(perk, currentLevel);
  const maxLevel = getMaxPerkLevel(perk);
  if (level >= maxLevel) return 0;
  const target = getPerkLevelConfig(perk, level + 1);
  if (!target) return 0;
  if (level <= 0) return Math.max(0, Math.floor(Number(target.unlockCost ?? perk.unlockCost ?? 0)));
  return Math.max(0, Math.floor(Number(target.upgradeCost ?? target.unlockCost ?? perk.upgradeCost ?? 0)));
}

function publicPerkCatalog() {
  const roles = perkCatalog.roles || {};
  const catalog = [];
  for (const [role, roleDef] of Object.entries(roles)) {
    const normalizedRole = normalizePerkRole(role);
    for (const perk of Object.values(roleDef?.perks || {})) {
      const levels = perkLevelRows(perk).map((level) => ({
        level: Math.max(1, Math.floor(Number(level.level || 1))),
        unlockCost: level.unlockCost == null ? undefined : Math.max(0, Math.floor(Number(level.unlockCost || 0))),
        upgradeCost: level.upgradeCost == null ? undefined : Math.max(0, Math.floor(Number(level.upgradeCost || 0))),
        label: level.label == null ? undefined : String(level.label),
        cost: level.cost == null ? undefined : Math.max(0, Math.floor(Number(level.cost || 0))),
        cooldown: level.cooldown == null ? undefined : Math.max(0, Number(level.cooldown || 0)),
        duration: Number(level.duration || 0),
        boostDuration: level.boostDuration == null ? undefined : Number(level.boostDuration),
        radius: level.radius == null ? undefined : Number(level.radius),
        revealRadius: level.revealRadius == null ? undefined : Number(level.revealRadius),
        projectileSpeed: level.projectileSpeed == null ? undefined : Number(level.projectileSpeed),
        range: level.range == null ? undefined : Number(level.range),
        chance: level.chance == null ? undefined : Number(level.chance),
        minBonus: level.minBonus == null ? undefined : Math.max(0, Math.floor(Number(level.minBonus || 0))),
        maxBonus: level.maxBonus == null ? undefined : Math.max(0, Math.floor(Number(level.maxBonus || 0))),
        healProgress: level.healProgress == null ? undefined : Number(level.healProgress),
        unhookProgress: level.unhookProgress == null ? undefined : Number(level.unhookProgress),
        canUnhook: level.canUnhook == null ? undefined : !!level.canUnhook,
        canPickupDowned: level.canPickupDowned == null ? undefined : !!level.canPickupDowned,
        speedMultiplier: level.speedMultiplier == null ? undefined : Number(level.speedMultiplier),
        lengthMultiplier: level.lengthMultiplier == null ? undefined : Number(level.lengthMultiplier),
        angleMultiplier: level.angleMultiplier == null ? undefined : Number(level.angleMultiplier),
        backLengthMultiplier: level.backLengthMultiplier == null ? undefined : Number(level.backLengthMultiplier),
        backAngleMultiplier: level.backAngleMultiplier == null ? undefined : Number(level.backAngleMultiplier),
        slowMultiplier: level.slowMultiplier == null ? undefined : Number(level.slowMultiplier),
        slowSeconds: level.slowSeconds == null ? undefined : Number(level.slowSeconds),
        hidesScratchMarks: level.hidesScratchMarks == null ? undefined : !!level.hidesScratchMarks,
        scratchHideDuration: level.scratchHideDuration == null ? undefined : Number(level.scratchHideDuration),
        orbPickupRadiusMultiplier: level.orbPickupRadiusMultiplier == null ? undefined : Number(level.orbPickupRadiusMultiplier),
        smokeKillerRevealRadius: level.smokeKillerRevealRadius == null ? undefined : Number(level.smokeKillerRevealRadius),
        vaultSpeedMultiplier: level.vaultSpeedMultiplier == null ? undefined : Number(level.vaultSpeedMultiplier),
        healActionSpeedMultiplier: level.healActionSpeedMultiplier == null ? undefined : Number(level.healActionSpeedMultiplier),
        unhookActionSpeedMultiplier: level.unhookActionSpeedMultiplier == null ? undefined : Number(level.unhookActionSpeedMultiplier)
      }));
      catalog.push({
        id: perk.id,
        role: normalizePerkRole(perk.role || normalizedRole),
        name: perk.name || perk.id,
        shortName: perk.shortName || perk.name || perk.id,
        accent: perk.accent || (normalizedRole === "killer" ? "purple" : "cyan"),
        abilityCost: Math.max(0, Math.floor(Number(perk.abilityCost || 0))),
        cooldown: Math.max(0, Number(perk.cooldown || 0)),
        classAbility: perk.classAbility == null ? undefined : !!perk.classAbility,
        passive: perk.passive == null ? undefined : !!perk.passive,
        alwaysUnlocked: perk.alwaysUnlocked == null ? undefined : !!perk.alwaysUnlocked,
        defaultLevel: getPerkDefaultLevel({ ...perk, role: normalizePerkRole(perk.role || normalizedRole) }) || undefined,
        classId: perk.classId == null ? undefined : String(perk.classId),
        inputType: perk.inputType == null ? undefined : String(perk.inputType),
        shootAbility: perk.shootAbility == null ? undefined : !!perk.shootAbility,
        projectileKind: perk.projectileKind == null ? undefined : String(perk.projectileKind),
        summary: perk.summary || "Unlock and upgrade this ability.",
        detail: perk.detail || "Spend banked orbs to make this ability less embarrassing.",
        maxLevel: getMaxPerkLevel(perk),
        levels
      });
    }
  }
  return catalog;
}

function signToken(account) {
  assertAuthReady();
  return jwt.sign(
    { sub: account.id, guest: !!account.is_guest },
    authSecret(),
    { expiresIn: `${TOKEN_DAYS}d`, issuer: "riftrunner" }
  );
}

function verifyToken(token) {
  assertAuthReady();
  try {
    const payload = jwt.verify(String(token || ""), authSecret(), { issuer: "riftrunner" });
    return payload?.sub ? String(payload.sub) : null;
  } catch {
    return null;
  }
}

function tokenFromRequest(req) {
  const header = String(req.headers.authorization || "");
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return "";
}

function rowToAccount(row) {
  if (!row) return null;
  const progression = progressionStateFromAccountRow(row);
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    isGuest: !!row.is_guest,
    orbBalance: Math.max(0, Number(row.orb_balance || 0)),
    totalOrbsDeposited: Math.max(0, Number(row.total_orbs_deposited || 0)),
    progression,
    level: progression.account.level,
    runnerLevel: progression.runner.level,
    voidLevel: progression.void.level,
    selectedRunnerClass: normalizeRunnerClassId(row.selected_runner_class),
    createdAt: row.created_at
  };
}

async function ensureDefaultSkins(accountId, client = null) {
  const runner = client || { query };
  for (const skinId of skinCatalog.DEFAULT_SKINS) {
    const skin = skinCatalog.getSkin(skinId);
    if (!skin) continue;
    await runner.query(
      `INSERT INTO account_skins (account_id, skin_id, skin_role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [accountId, skin.id, skin.role]
    );
  }
}

async function getOwnedSkins(accountId, client = null) {
  const runner = client || { query };
  const result = await runner.query(
    `SELECT skin_id FROM account_skins WHERE account_id = $1`,
    [accountId]
  );
  const owned = skinCatalog.createOwnedSkinSet(result.rows.map((row) => row.skin_id));
  return {
    all: [...owned],
    runner: [...owned].filter((id) => skinCatalog.skinBelongsToRole(id, "runner")),
    void: [...owned].filter((id) => skinCatalog.skinBelongsToRole(id, "void"))
  };
}


async function getOwnedPerks(accountId, client = null) {
  const runner = client || { query };
  const result = await runner.query(
    `SELECT perk_id, perk_role, level FROM account_perks WHERE account_id = $1`,
    [accountId]
  );
  const out = seedDefaultPerks({ all: {}, survivor: {}, killer: {} });
  for (const row of result.rows) {
    const perk = getPerkDef(row.perk_id);
    if (!perk) continue;
    const role = normalizePerkRole(row.perk_role || perk.role);
    const level = getPerkEffectiveLevel(perk, row.level);
    if (level <= 0) continue;
    out.all[perk.id] = Math.max(out.all[perk.id] || 0, level);
    out[role][perk.id] = Math.max(out[role][perk.id] || 0, level);
  }
  return out;
}

async function accountSummary(accountId) {
  assertAuthReady();
  await ensureProgressionSchema();
  const result = await query(`SELECT * FROM accounts WHERE id = $1`, [accountId]);
  const account = rowToAccount(result.rows[0]);
  if (!account) return null;
  await ensureDefaultSkins(account.id);
  account.ownedSkins = await getOwnedSkins(account.id);
  account.perks = await getOwnedPerks(account.id);
  return account;
}

async function register({ username, password }) {
  assertAuthReady();
  const cleanUsername = assertUsername(username);
  const normalized = normalizeUsername(cleanUsername);
  const pass = assertPassword(password);
  const passwordHash = await bcrypt.hash(pass, BCRYPT_ROUNDS);
  const id = crypto.randomUUID();

  const account = await withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO accounts (id, username, username_normalized, display_name, password_hash, is_guest)
       VALUES ($1, $2, $3, $4, $5, FALSE)
       RETURNING *`,
      [id, cleanUsername, normalized, cleanUsername, passwordHash]
    );
    await ensureDefaultSkins(id, client);
    return rowToAccount(result.rows[0]);
  }).catch((error) => {
    if (error?.code === "23505") throw new Error("That username is already taken.");
    throw error;
  });

  const fullAccount = await accountSummary(account.id);
  return { token: signToken({ id: account.id, is_guest: false }), account: fullAccount };
}

async function login({ username, password }) {
  assertAuthReady();
  const normalized = normalizeUsername(username);
  const pass = assertPassword(password);
  const result = await query(
    `SELECT * FROM accounts WHERE username_normalized = $1 AND is_guest = FALSE`,
    [normalized]
  );
  const row = result.rows[0];
  if (!row || !row.password_hash) throw new Error("Invalid username or password.");
  const ok = await bcrypt.compare(pass, row.password_hash);
  if (!ok) throw new Error("Invalid username or password.");
  const account = await accountSummary(row.id);
  return { token: signToken(rowToAccount(row)), account };
}

async function createGuest({ name } = {}) {
  assertAuthReady();
  const suffix = crypto.randomBytes(3).toString("hex");
  const display = cleanDisplayName(name, `Guest-${suffix}`);
  const username = `guest_${suffix}_${Date.now().toString(36)}`;
  const id = crypto.randomUUID();
  const account = await withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO accounts (id, username, username_normalized, display_name, is_guest)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING *`,
      [id, username, normalizeUsername(username), display]
    );
    await ensureDefaultSkins(id, client);
    return rowToAccount(result.rows[0]);
  });
  const fullAccount = await accountSummary(account.id);
  return { token: signToken({ id: account.id, is_guest: true }), account: fullAccount };
}

async function getAccountFromToken(token) {
  if (!token) return null;
  const accountId = verifyToken(token);
  if (!accountId) return null;
  return accountSummary(accountId);
}

async function accountFromRequest(req) {
  const token = tokenFromRequest(req);
  if (!token) return null;
  return getAccountFromToken(token);
}

async function purchaseSkin(accountId, skinId) {
  assertAuthReady();
  const skin = skinCatalog.getSkin(skinId);
  if (!skin) throw new Error("Unknown skin.");
  const price = Math.max(0, Math.floor(Number(skin.price) || 0));

  await withTransaction(async (client) => {
    await ensureDefaultSkins(accountId, client);
    const already = await client.query(
      `SELECT 1 FROM account_skins WHERE account_id = $1 AND skin_id = $2`,
      [accountId, skin.id]
    );
    if (already.rows.length) return;

    const account = await client.query(
      `SELECT orb_balance FROM accounts WHERE id = $1 FOR UPDATE`,
      [accountId]
    );
    if (!account.rows.length) throw new Error("Account not found.");
    const balance = Number(account.rows[0].orb_balance || 0);
    if (balance < price) throw new Error(`Need ${price} deposited orbs to unlock ${skin.label}.`);
    if (price > 0) {
      await client.query(
        `UPDATE accounts SET orb_balance = orb_balance - $2, updated_at = NOW() WHERE id = $1`,
        [accountId, price]
      );
    }
    await client.query(
      `INSERT INTO account_skins (account_id, skin_id, skin_role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [accountId, skin.id, skin.role]
    );
  });

  return accountSummary(accountId);
}


async function purchasePerk(accountId, perkId) {
  assertAuthReady();
  const perk = getPerkDef(perkId);
  if (!perk) throw new Error("Unknown perk.");
  const maxLevel = getMaxPerkLevel(perk);
  const nextLevel = await withTransaction(async (client) => {
    const current = await client.query(
      `SELECT level FROM account_perks WHERE account_id = $1 AND perk_id = $2 FOR UPDATE`,
      [accountId, perk.id]
    );
    const storedLevel = Math.max(0, Math.floor(Number(current.rows[0]?.level || 0)));
    const currentLevel = getPerkEffectiveLevel(perk, storedLevel);
    if (currentLevel >= maxLevel) throw new Error(`${perk.name || "Perk"} is already max level.`);
    const targetLevel = currentLevel + 1;
    const cost = getPerkNextCost(perk, currentLevel);

    const account = await client.query(
      `SELECT orb_balance FROM accounts WHERE id = $1 FOR UPDATE`,
      [accountId]
    );
    if (!account.rows.length) throw new Error("Account not found.");
    const balance = Number(account.rows[0].orb_balance || 0);
    if (balance < cost) {
      throw new Error(`Need ${cost} deposited orbs to ${currentLevel <= 0 ? "unlock" : "upgrade"} ${perk.name}.`);
    }
    if (cost > 0) {
      await client.query(
        `UPDATE accounts SET orb_balance = orb_balance - $2, updated_at = NOW() WHERE id = $1`,
        [accountId, cost]
      );
    }
    await client.query(
      `INSERT INTO account_perks (account_id, perk_id, perk_role, level)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id, perk_id)
       DO UPDATE SET level = EXCLUDED.level, perk_role = EXCLUDED.perk_role, updated_at = NOW()`,
      [accountId, perk.id, perk.role, targetLevel]
    );
    return targetLevel;
  });

  const account = await accountSummary(accountId);
  return { account, perk: { id: perk.id, role: perk.role, level: nextLevel, maxLevel } };
}

async function updateSelectedRunnerClass(accountId, runnerClassId) {
  assertAuthReady();
  await ensureProgressionSchema();
  const selectedRunnerClass = normalizeRunnerClassId(runnerClassId);
  await query(
    `UPDATE accounts SET selected_runner_class = $2, updated_at = NOW() WHERE id = $1`,
    [accountId, selectedRunnerClass]
  );
  return accountSummary(accountId);
}

function ownsSkinSync(account, skinId) {
  if (!skinCatalog.hasSkin(skinId)) return false;
  if (skinCatalog.isDefaultSkin(skinId)) return true;
  const owned = account?.ownedSkins;
  if (!owned) return false;
  if (Array.isArray(owned.all)) return owned.all.includes(skinId);
  if (owned instanceof Set) return owned.has(skinId);
  return false;
}

function sanitizeOwnedSkin(account, role, skinId) {
  const normalizedRole = skinCatalog.normalizeSkinRole(role);
  const fallback = normalizedRole === "void" ? "voidCore" : "blueSquare";
  const skin = skinCatalog.getSkin(skinId);
  if (!skin || skin.role !== normalizedRole) return fallback;
  return ownsSkinSync(account, skin.id) ? skin.id : fallback;
}

async function awardMatchOrbs({ accountId, lobbyId, matchId, playerId, playerName, orbsDeposited }) {
  assertAuthReady();
  await ensureProgressionSchema();
  const amount = Math.max(0, Math.floor(Number(orbsDeposited) || 0));
  if (!accountId || amount <= 0) return null;

  const result = await withTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO match_rewards (account_id, lobby_id, match_id, player_id, player_name, orbs_deposited)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (match_id, player_id) DO NOTHING
       RETURNING orbs_deposited`,
      [accountId, String(lobbyId || ""), String(matchId || ""), String(playerId || ""), String(playerName || "Player").slice(0, 24), amount]
    );
    if (!inserted.rows.length) return null;
    await client.query(
      `UPDATE accounts
       SET orb_balance = orb_balance + $2,
           total_orbs_deposited = total_orbs_deposited + $2,
           updated_at = NOW()
       WHERE id = $1`,
      [accountId, amount]
    );
    return amount;
  });

  if (!result) return null;
  return accountSummary(accountId);
}

async function awardMatchProgression({
  accountId,
  lobbyId,
  matchId,
  playerId,
  playerName,
  role,
  reason = "match",
  matchSeconds = 0,
  baseScore = 0,
  score = 0,
  accountXp = 0,
  roleXp = 0,
  orbsDeposited = 0,
  breakdown = []
}) {
  assertAuthReady();
  await ensureProgressionSchema();

  const safeAccountId = String(accountId || "");
  const safeMatchId = String(matchId || "");
  const safePlayerId = String(playerId || "");
  const roleTrack = role === "void" || role === "killer" ? "void" : "runner";
  const deposited = Math.max(0, Math.floor(Number(orbsDeposited) || 0));
  const safeScore = Math.max(0, Math.floor(Number(score) || 0));
  const safeBaseScore = Math.max(0, Math.floor(Number(baseScore) || 0));
  const safeAccountXp = Math.max(0, Math.floor(Number(accountXp) || 0));
  const safeRoleXp = Math.max(0, Math.floor(Number(roleXp) || 0));
  const safeBreakdown = Array.isArray(breakdown) ? breakdown.slice(0, 32) : [];

  if (!safeAccountId || !safeMatchId || !safePlayerId) return null;
  if (deposited <= 0 && safeScore <= 0 && safeAccountXp <= 0 && safeRoleXp <= 0) return null;

  const award = await withTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO match_progression_awards
         (account_id, lobby_id, match_id, player_id, player_name, player_role, reason, match_seconds,
          base_score, match_score, account_xp, role_xp, orbs_deposited, breakdown)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
       ON CONFLICT (match_id, player_id) DO NOTHING
       RETURNING id`,
      [
        safeAccountId,
        String(lobbyId || ""),
        safeMatchId,
        safePlayerId,
        String(playerName || "Player").slice(0, 24),
        roleTrack,
        String(reason || "match").slice(0, 32),
        Math.max(0, Number(matchSeconds) || 0),
        safeBaseScore,
        safeScore,
        safeAccountXp,
        safeRoleXp,
        deposited,
        JSON.stringify(safeBreakdown)
      ]
    );
    if (!inserted.rows.length) return null;

    const accountResult = await client.query(
      `SELECT * FROM accounts WHERE id = $1 FOR UPDATE`,
      [safeAccountId]
    );
    const row = accountResult.rows[0];
    if (!row) throw new Error("Account not found.");

    let creditedDepositedOrbs = 0;
    if (deposited > 0) {
      const orbInsert = await client.query(
        `INSERT INTO match_rewards (account_id, lobby_id, match_id, player_id, player_name, orbs_deposited)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (match_id, player_id) DO NOTHING
         RETURNING orbs_deposited`,
        [safeAccountId, String(lobbyId || ""), safeMatchId, safePlayerId, String(playerName || "Player").slice(0, 24), deposited]
      );
      creditedDepositedOrbs = orbInsert.rows.length ? deposited : 0;
    }

    const accountAward = applyXpToTrack(progressionTrackState(row, "account"), safeAccountXp, levelConfig, "account");
    const roleAward = applyXpToTrack(progressionTrackState(row, roleTrack), safeRoleXp, levelConfig, roleTrack);
    const levelRewardOrbs = Math.max(0, Math.floor(Number(accountAward.rewardOrbs || 0) + Number(roleAward.rewardOrbs || 0)));
    const resultSummary = summarizeProgressionAward({
      accountAward,
      roleAward,
      role: roleTrack,
      score: safeScore,
      baseScore: safeBaseScore,
      orbsDeposited: creditedDepositedOrbs,
      levelRewardOrbs,
      breakdown: safeBreakdown,
      matchSeconds
    });

    const totalOrbGain = creditedDepositedOrbs + levelRewardOrbs;
    await client.query(
      `UPDATE accounts
       SET account_level = $2,
           account_xp = $3,
           account_total_xp = $4,
           runner_level = CASE WHEN $5 = 'runner' THEN $6 ELSE runner_level END,
           runner_xp = CASE WHEN $5 = 'runner' THEN $7 ELSE runner_xp END,
           runner_total_xp = CASE WHEN $5 = 'runner' THEN $8 ELSE runner_total_xp END,
           void_level = CASE WHEN $5 = 'void' THEN $6 ELSE void_level END,
           void_xp = CASE WHEN $5 = 'void' THEN $7 ELSE void_xp END,
           void_total_xp = CASE WHEN $5 = 'void' THEN $8 ELSE void_total_xp END,
           orb_balance = orb_balance + $9,
           total_orbs_deposited = total_orbs_deposited + $10,
           updated_at = NOW()
       WHERE id = $1`,
      [
        safeAccountId,
        accountAward.after.level,
        accountAward.after.xp,
        accountAward.after.totalXp,
        roleTrack,
        roleAward.after.level,
        roleAward.after.xp,
        roleAward.after.totalXp,
        totalOrbGain,
        creditedDepositedOrbs
      ]
    );

    await client.query(
      `UPDATE match_progression_awards
       SET level_reward_orbs = $2,
           orbs_deposited = $3,
           progression_result = $4::jsonb
       WHERE id = $1`,
      [inserted.rows[0].id, levelRewardOrbs, creditedDepositedOrbs, JSON.stringify(resultSummary)]
    );

    return resultSummary;
  });

  if (!award) return null;
  const account = await accountSummary(safeAccountId);
  return { account, award };
}

module.exports = {
  authAvailable,
  accountSummary,
  accountFromRequest,
  getAccountFromToken,
  register,
  login,
  createGuest,
  purchaseSkin,
  purchasePerk,
  updateSelectedRunnerClass,
  awardMatchOrbs,
  awardMatchProgression,
  ownsSkinSync,
  sanitizeOwnedSkin,
  publicCatalog: skinCatalog.publicCatalog,
  publicPerkCatalog,
  publicRunnerClassCatalog,
  normalizeRunnerClassId,
  getSkin: skinCatalog.getSkin,
  getPerkDef,
  xpNeededForLevel
};

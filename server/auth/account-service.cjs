const crypto = require("crypto");
const { query, withTransaction, isDatabaseReady } = require("../db/pool.cjs");
const skinCatalog = require("../economy/skin-catalog.cjs");

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
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    isGuest: !!row.is_guest,
    orbBalance: Math.max(0, Number(row.orb_balance || 0)),
    totalOrbsDeposited: Math.max(0, Number(row.total_orbs_deposited || 0)),
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

async function accountSummary(accountId) {
  assertAuthReady();
  const result = await query(`SELECT * FROM accounts WHERE id = $1`, [accountId]);
  const account = rowToAccount(result.rows[0]);
  if (!account) return null;
  await ensureDefaultSkins(account.id);
  account.ownedSkins = await getOwnedSkins(account.id);
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

module.exports = {
  authAvailable,
  accountSummary,
  accountFromRequest,
  getAccountFromToken,
  register,
  login,
  createGuest,
  purchaseSkin,
  awardMatchOrbs,
  ownsSkinSync,
  sanitizeOwnedSkin,
  publicCatalog: skinCatalog.publicCatalog,
  getSkin: skinCatalog.getSkin
};

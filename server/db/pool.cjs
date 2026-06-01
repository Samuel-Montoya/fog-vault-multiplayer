const { loadEnv } = require("../config/load-env.cjs");
loadEnv();

let PgPool = null;
try {
  ({ Pool: PgPool } = require("pg"));
} catch {
  PgPool = null;
}

let pool = null;

function hasDatabaseUrl() {
  return !!String(process.env.DATABASE_URL || "").trim();
}

function getPool() {
  if (!PgPool) throw new Error("PostgreSQL package 'pg' is not installed. Run npm install.");
  if (!hasDatabaseUrl()) throw new Error("DATABASE_URL is not set.");
  if (!pool) {
    const sslMode = String(process.env.PGSSL || process.env.POSTGRES_SSL || "").toLowerCase();
    const useSsl = sslMode === "true" || sslMode === "1" || sslMode === "require" || /sslmode=require/i.test(process.env.DATABASE_URL || "");
    pool = new PgPool({
      connectionString: process.env.DATABASE_URL,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined,
      max: Math.max(1, Math.min(12, Number(process.env.PG_POOL_MAX || 5))),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });
  }
  return pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* ignore rollback errors */ }
    throw error;
  } finally {
    client.release();
  }
}

function isDatabaseReady() {
  return !!PgPool && hasDatabaseUrl();
}

module.exports = { getPool, query, withTransaction, isDatabaseReady };

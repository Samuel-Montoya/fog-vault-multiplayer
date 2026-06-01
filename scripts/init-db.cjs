#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { loadEnv } = require("../server/config/load-env.cjs");
loadEnv(path.resolve(__dirname, ".."));
const { getPool } = require("../server/db/pool.cjs");

async function main() {
  const schemaPath = path.join(__dirname, "..", "server", "db", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  const pool = getPool();
  await pool.query(schema);
  console.log("RiftRunner database schema is ready.");
  await pool.end();
}

main().catch((error) => {
  console.error("Failed to initialize RiftRunner database:", error.message);
  process.exitCode = 1;
});

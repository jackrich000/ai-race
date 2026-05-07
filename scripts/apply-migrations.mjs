#!/usr/bin/env node
// scripts/apply-migrations.mjs
// Applies SQL migrations from migrations/*.sql to the linked Supabase project
// via the Management API. Tracks applied migrations in schema_migrations
// (created on first run). Migrations are immutable: editing an applied file
// is detected via SHA-256 hash mismatch and aborts.
//
// Usage:
//   npm run migrate
//
// Env (loaded from .env if present):
//   SUPABASE_ACCESS_TOKEN — Personal Access Token from
//                           https://supabase.com/dashboard/account/tokens
//   SUPABASE_PROJECT_REF  — defaults to "jtrhsqdfevyqzzjjvcdr"

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.resolve(PROJECT_ROOT, "migrations");

// Load .env (same pattern as run-pipeline.mjs)
const envPath = path.resolve(PROJECT_ROOT, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  }
}

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "jtrhsqdfevyqzzjjvcdr";
const API_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

if (!ACCESS_TOKEN) {
  console.error("Error: SUPABASE_ACCESS_TOKEN not set.");
  console.error("Generate at https://supabase.com/dashboard/account/tokens and add to .env.");
  process.exit(1);
}

/**
 * POST a SQL statement to the Supabase Management API.
 * Returns parsed JSON body. Throws on non-2xx with a descriptive message.
 */
async function runSql(query, label) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} failed (HTTP ${response.status}): ${text}`);
  }

  try { return JSON.parse(text); }
  catch { return text; }
}

function sha256(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

async function main() {
  // ─── Step 1: Bootstrap schema_migrations ────────────────
  console.log("Ensuring schema_migrations table exists...");
  await runSql(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename TEXT PRIMARY KEY,
       content_hash TEXT NOT NULL,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     );`,
    "Bootstrap schema_migrations"
  );

  // ─── Step 2: Read applied migrations from DB ────────────
  const appliedRows = await runSql(
    "SELECT filename, content_hash FROM schema_migrations;",
    "Query schema_migrations"
  );
  const applied = new Map();
  for (const row of appliedRows || []) {
    applied.set(row.filename, row.content_hash);
  }
  console.log(`  ${applied.size} migration(s) already applied.`);

  // ─── Step 3: Discover migration files ───────────────────
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
    process.exit(1);
  }
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith(".sql"))
    .sort();
  console.log(`  ${files.length} migration file(s) on disk.`);

  // ─── Step 4: Apply each migration in order ──────────────
  let appliedThisRun = 0;
  let skipped = 0;

  for (const filename of files) {
    const filePath = path.join(MIGRATIONS_DIR, filename);
    const content = fs.readFileSync(filePath, "utf8");
    const hash = sha256(content);

    if (applied.has(filename)) {
      const existingHash = applied.get(filename);
      if (existingHash === hash) {
        skipped++;
        continue;
      }
      console.error(`\nERROR: Migration ${filename} has been edited after apply.`);
      console.error(`  Recorded hash: ${existingHash}`);
      console.error(`  Current hash:  ${hash}`);
      console.error(`  Migrations are immutable. Create a new migration file instead of editing.`);
      console.error(`  If the on-disk version is the source of truth and the DB is out of sync,`);
      console.error(`  manually update schema_migrations.content_hash via the Supabase SQL editor.`);
      process.exit(1);
    }

    console.log(`\nApplying ${filename}...`);
    // Wrap in transaction so multi-statement migrations roll back atomically
    // on any failure. Without this, a partial apply leaves the schema in a
    // half-state with no record in schema_migrations.
    const transactionalSql = `BEGIN;\n${content}\nCOMMIT;`;
    try {
      await runSql(transactionalSql, `Apply ${filename}`);
    } catch (err) {
      console.error(`  ${err.message}`);
      console.error(`\n  Migration aborted. No row inserted into schema_migrations.`);
      console.error(`  Fix the SQL and re-run.`);
      process.exit(1);
    }

    // Record successful application. Escape single quotes in hash (defensive;
    // hex digests don't contain quotes, but better to be explicit).
    const escapedFilename = filename.replace(/'/g, "''");
    const escapedHash = hash.replace(/'/g, "''");
    await runSql(
      `INSERT INTO schema_migrations (filename, content_hash)
       VALUES ('${escapedFilename}', '${escapedHash}');`,
      `Record ${filename}`
    );
    console.log(`  Applied and recorded.`);
    appliedThisRun++;
  }

  console.log(`\nDone. Applied ${appliedThisRun}, skipped ${skipped}.`);
}

main().catch(err => {
  console.error("\nFatal:", err.message);
  process.exit(1);
});

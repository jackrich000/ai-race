#!/usr/bin/env node
// scripts/run-pipeline.mjs
// Combined pipeline orchestrator: extraction → ingestion → diff → report.
//
// Usage:
//   node scripts/run-pipeline.mjs                # Full pipeline
//   node scripts/run-pipeline.mjs --dry-run      # No DB writes, no GitHub issue
//   node scripts/run-pipeline.mjs --skip-extract  # Skip extraction, just ingest + diff + report

import { createRequire } from "module";
import { spawn } from "child_process";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const { BENCHMARK_META, LABS } = require("../lib/config.js");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

// ─── Environment ─────────────────────────────────────────────

// Load .env if present (same pattern as extract-model-cards.mjs)
const envPath = path.resolve(PROJECT_ROOT, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL || "https://jtrhsqdfevyqzzjjvcdr.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// CLI flags
const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_EXTRACT = process.argv.includes("--skip-extract");

// Automated benchmarks (must match update-data.js)
const AUTOMATED_BENCHMARKS = ["swe-bench-verified", "arc-agi-1", "arc-agi-2", "hle", "gpqa", "aime", "frontiermath", "math-l5"];

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Snapshot current best scores from benchmark_scores.
 * Returns Map of "benchmark|lab" → { score, model, verified }
 */
async function snapshotBestScores(supabase) {
  const { data, error } = await supabase
    .from("benchmark_scores")
    .select("benchmark, lab, score, model, source, verified")
    .not("score", "is", null);

  if (error) throw new Error(`Snapshot query failed: ${error.message}`);

  const best = new Map();
  for (const row of data || []) {
    const key = `${row.benchmark}|${row.lab}`;
    const existing = best.get(key);
    if (!existing || row.score > existing.score) {
      best.set(key, {
        score: row.score,
        model: row.model,
        verified: row.verified,
        source: row.source,
      });
    }
  }
  return best;
}

/**
 * Run a Node.js script as a subprocess, streaming output in real-time.
 * Returns { code, stdout, stderr }.
 */
function runScript(scriptPath, args, label) {
  return new Promise((resolve) => {
    console.log(`\n${"═".repeat(60)}`);
    console.log(`  ${label}`);
    console.log(`${"═".repeat(60)}\n`);

    const proc = spawn(process.execPath, [scriptPath, ...args], {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    proc.on("close", (code) => {
      console.log(`\n  ${label}: exited with code ${code}`);
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * Diff best scores before and after ingestion.
 * Returns array of changes: { benchmark, lab, score, previous, model, verified }
 */
async function diffScores(supabase, beforeSnapshot) {
  const afterSnapshot = await snapshotBestScores(supabase);
  const changes = [];

  for (const [key, after] of afterSnapshot) {
    const before = beforeSnapshot.get(key);
    const prevScore = before ? before.score : null;

    if (prevScore === null || after.score !== prevScore) {
      const [benchmark, lab] = key.split("|");
      changes.push({
        benchmark,
        lab,
        score: after.score,
        previous: prevScore,
        model: after.model,
        verified: after.verified,
      });
    }
  }

  // Sort by benchmark name, then lab
  changes.sort((a, b) => a.benchmark.localeCompare(b.benchmark) || a.lab.localeCompare(b.lab));
  return changes;
}

/**
 * Query all unresolved flagged items from benchmark_raw.
 * Partitions into new (this run) vs carried over.
 */
async function queryFlaggedItems(supabase, runStartTime) {
  const { data, error } = await supabase
    .from("benchmark_raw")
    .select("benchmark, lab, model, model_variant, score, source_url, extracted_at, triage_reason")
    .eq("triage_status", "flag")
    .order("extracted_at", { ascending: false });

  if (error) {
    console.warn(`  Warning: Failed to query flagged items: ${error.message}`);
    return { newItems: [], carriedOver: [] };
  }

  const newItems = [];
  const carriedOver = [];

  for (const row of data || []) {
    const extractedAt = new Date(row.extracted_at);
    if (extractedAt >= runStartTime) {
      newItems.push(row);
    } else {
      carriedOver.push(row);
    }
  }

  return { newItems, carriedOver };
}

/**
 * Query this run's rejected items from benchmark_raw.
 */
async function queryRejectedItems(supabase, runStartTime) {
  const { data, error } = await supabase
    .from("benchmark_raw")
    .select("benchmark, lab, model, model_variant, score, source_url, triage_reason")
    .eq("triage_status", "reject")
    .eq("source", "model_card_auto")
    .gte("extracted_at", runStartTime.toISOString());

  if (error) {
    console.warn(`  Warning: Failed to query rejected items: ${error.message}`);
    return [];
  }

  return data || [];
}

/**
 * Post-ingestion health check: verify benchmark_scores has data for each automated benchmark.
 */
async function healthCheck(supabase) {
  const failures = [];

  for (const benchKey of AUTOMATED_BENCHMARKS) {
    const { count, error } = await supabase
      .from("benchmark_scores")
      .select("*", { count: "exact", head: true })
      .eq("benchmark", benchKey);

    if (error) {
      failures.push(`${benchKey}: query error (${error.message})`);
    } else if (count === 0) {
      failures.push(`${benchKey}: 0 rows`);
    }
  }

  return failures;
}

/**
 * Get human-readable benchmark name from config, fallback to key.
 */
function benchmarkName(key) {
  return BENCHMARK_META[key]?.name || key;
}

/**
 * Get human-readable lab name from config, fallback to key.
 */
function labName(key) {
  return LABS[key]?.name || key;
}

/**
 * Build the combined GitHub issue report.
 */
function buildReport({ changes, flagged, rejected, extractResult, ingestResult, runDate }) {
  const parts = [];

  // ─── Header ─────────────────────────────────────────────
  const extractStatus = extractResult
    ? (extractResult.code === 0 ? "OK" : `FAILED (exit ${extractResult.code})`)
    : "Skipped";
  const ingestStatus = ingestResult.code === 0 ? "OK" : `FAILED (exit ${ingestResult.code})`;

  parts.push(`## Pipeline Run (${runDate})`);
  parts.push(`Extraction: ${extractStatus} | Ingestion: ${ingestStatus}`);
  parts.push("");

  // ─── Needs Review ───────────────────────────────────────
  const totalFlagged = flagged.newItems.length + flagged.carriedOver.length;

  if (totalFlagged > 0) {
    parts.push(`## Needs Review (${totalFlagged})`);
    parts.push("");

    if (flagged.newItems.length > 0) {
      parts.push("### New (this run)");
      parts.push("");
      for (const item of flagged.newItems) {
        const variant = item.model_variant ? ` [${item.model_variant}]` : "";
        const reason = item.triage_reason || "No reason recorded";
        parts.push(`- **${item.model}** on **${benchmarkName(item.benchmark)}**: ${item.score}${variant}`);
        parts.push(`  Reason: ${reason} | [Source](${item.source_url})`);
      }
      parts.push("");
    }

    if (flagged.carriedOver.length > 0) {
      parts.push(`<details><summary>Carried over (${flagged.carriedOver.length} from previous runs)</summary>`);
      parts.push("");
      for (const item of flagged.carriedOver) {
        const variant = item.model_variant ? ` [${item.model_variant}]` : "";
        const reason = item.triage_reason || "No reason recorded";
        const since = item.extracted_at ? item.extracted_at.split("T")[0] : "unknown";
        parts.push(`- **${item.model}** on **${benchmarkName(item.benchmark)}**: ${item.score}${variant} (since ${since})`);
        parts.push(`  Reason: ${reason} | [Source](${item.source_url})`);
      }
      parts.push("");
      parts.push("</details>");
      parts.push("");
    }
  }

  // ─── Auto-Rejected ──────────────────────────────────────
  if (rejected.length > 0) {
    parts.push(`## Auto-Rejected (${rejected.length})`);
    parts.push("Scores automatically rejected this run. Listed for transparency.");
    parts.push("");
    for (const item of rejected) {
      const variant = item.model_variant ? ` [${item.model_variant}]` : "";
      const reason = item.triage_reason || "No reason recorded";
      parts.push(`- **${item.model}** on **${benchmarkName(item.benchmark)}**: ${item.score}${variant}`);
      parts.push(`  Reason: ${reason} | [Source](${item.source_url})`);
    }
    parts.push("");
  }

  // ─── New Scores on Site ─────────────────────────────────
  parts.push("## New Scores on Site");
  parts.push("");

  if (changes.length > 0) {
    parts.push("Changes to best scores on the live site this run.");
    parts.push("");
    parts.push("| Benchmark | Lab | Score | Previous | Model | Status |");
    parts.push("|-----------|-----|-------|----------|-------|--------|");
    for (const c of changes) {
      const prev = c.previous !== null ? c.previous : "—";
      const status = c.verified ? "Verified" : "Unverified";
      parts.push(`| ${benchmarkName(c.benchmark)} | ${labName(c.lab)} | ${c.score} | ${prev} | ${c.model} | ${status} |`);
    }
  } else {
    parts.push("_No changes this run._");
  }

  parts.push("");
  parts.push("---");
  parts.push("_Generated automatically by the pipeline orchestrator._");

  // ─── Title & labels ─────────────────────────────────────
  const scoreCount = changes.length;
  const reviewCount = totalFlagged;

  let title;
  if (scoreCount > 0 && reviewCount > 0) {
    title = `[Pipeline] ${runDate}: ${scoreCount} new score${scoreCount !== 1 ? "s" : ""}, ${reviewCount} need review`;
  } else if (scoreCount > 0) {
    title = `[Pipeline] ${runDate}: ${scoreCount} new score${scoreCount !== 1 ? "s" : ""}`;
  } else if (reviewCount > 0) {
    title = `[Pipeline] ${runDate}: No changes, ${reviewCount} need review`;
  } else {
    title = `[Pipeline] ${runDate}: No changes`;
  }

  const labels = totalFlagged > 0 ? "pipeline-report,needs-review" : "pipeline-report";

  return { title, body: parts.join("\n"), labels };
}

/**
 * Post a GitHub issue using the gh CLI.
 */
function postGitHubIssue(title, body, labels) {
  const tmpFile = path.resolve(PROJECT_ROOT, ".pipeline-report-body.md");

  try {
    fs.writeFileSync(tmpFile, body, "utf8");
    const { execFileSync } = require("child_process");
    execFileSync("gh", ["issue", "create", "--title", title, "--body-file", tmpFile, "--label", labels], {
      cwd: PROJECT_ROOT,
      stdio: "pipe",
    });
    console.log(`\n  Report posted: ${title}`);
  } catch (err) {
    console.warn(`\n  Failed to post GitHub issue: ${err.message.substring(0, 200)}`);
    console.log("\n  Report body (printed to console as fallback):\n");
    console.log(body);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

// ─── Main ────────────────────────────────────────────────────

async function main() {
  const runStartTime = new Date();
  const runDate = runStartTime.toISOString().split("T")[0];

  console.log(`\nPipeline run: ${runDate}${DRY_RUN ? " (dry run)" : ""}`);

  if (!SUPABASE_SERVICE_KEY) {
    console.error("Error: SUPABASE_SERVICE_KEY is required.");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // ─── Step 1: Snapshot current best scores ───────────────
  console.log("\nStep 1: Snapshotting current best scores...");
  const beforeSnapshot = await snapshotBestScores(supabase);
  console.log(`  Snapshot: ${beforeSnapshot.size} (benchmark, lab) pairs`);

  // ─── Step 2: Run extraction ─────────────────────────────
  let extractResult = null;

  if (SKIP_EXTRACT) {
    console.log("\nStep 2: Extraction skipped (--skip-extract)");
  } else {
    const extractArgs = ["--local", "--no-report"];
    if (DRY_RUN) extractArgs.push("--dry-run");

    extractResult = await runScript(
      path.resolve(__dirname, "extract-model-cards.mjs"),
      extractArgs,
      "Step 2: Extraction"
    );

    if (extractResult.code !== 0) {
      console.warn("\n  Warning: Extraction failed. Continuing with ingestion (existing data)...");
    }
  }

  // ─── Step 3: Run ingestion ──────────────────────────────
  let ingestResult;

  if (DRY_RUN) {
    console.log("\nStep 3: Ingestion skipped (dry run)");
    ingestResult = { code: 0 };
  } else {
    ingestResult = await runScript(
      path.resolve(__dirname, "update-data.js"),
      [],
      "Step 3: Ingestion"
    );

    if (ingestResult.code !== 0) {
      console.error("\n  Error: Ingestion failed. Data may be inconsistent.");
      process.exit(1);
    }
  }

  // ─── Step 4: Post-ingestion health check ────────────────
  console.log("\nStep 4: Health check...");
  const healthFailures = await healthCheck(supabase);

  if (healthFailures.length > 0) {
    console.error(`  Health check FAILED:\n    ${healthFailures.join("\n    ")}`);
    process.exit(1);
  }
  console.log("  Health check passed.");

  // ─── Step 5: Diff scores ───────────────────────────────
  console.log("\nStep 5: Diffing scores...");
  const changes = await diffScores(supabase, beforeSnapshot);
  console.log(`  ${changes.length} score change${changes.length !== 1 ? "s" : ""} detected.`);

  if (changes.length > 0) {
    for (const c of changes) {
      const prev = c.previous !== null ? c.previous : "new";
      console.log(`    ${benchmarkName(c.benchmark)} | ${labName(c.lab)}: ${prev} → ${c.score} (${c.model})`);
    }
  }

  // ─── Step 6: Query flagged & rejected items ─────────────
  console.log("\nStep 6: Querying flagged and rejected items...");
  const flagged = await queryFlaggedItems(supabase, runStartTime);
  const rejected = await queryRejectedItems(supabase, runStartTime);
  console.log(`  Flagged: ${flagged.newItems.length} new, ${flagged.carriedOver.length} carried over`);
  console.log(`  Rejected: ${rejected.length} this run`);

  // ─── Step 7: Build and post report ──────────────────────
  console.log("\nStep 7: Building report...");
  const report = buildReport({
    changes,
    flagged,
    rejected,
    extractResult,
    ingestResult,
    runDate,
  });

  console.log(`  Title: ${report.title}`);

  if (DRY_RUN) {
    console.log("\n  Dry run — report not posted. Preview:\n");
    console.log(report.body);
  } else {
    postGitHubIssue(report.title, report.body, report.labels);
  }

  console.log("\nPipeline complete.");
}

main().catch((err) => {
  console.error("Pipeline crashed:", err);
  process.exit(1);
});

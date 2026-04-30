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
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const { BENCHMARK_META, LABS, LAB_KEYS, TIME_LABELS, compareQuarters, getPresets } = require("../lib/config.js");
const { isHarnessVariant, isAcknowledgedConfigVariant, normalizeVariant, shouldRegenerateAnalyses } = require("../lib/pipeline.js");

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

// Automated benchmarks (must match update-data.js's automatedBenchmarks list)
const AUTOMATED_BENCHMARKS = ["swe-bench-verified", "arc-agi-1", "arc-agi-2", "hle", "gpqa", "aime", "frontiermath", "math-l5", "swe-bench-pro"];

// Labs that have automated extraction via model card scraping
const EXTRACTED_LABS = ["openai", "anthropic", "google", "xai", "chinese"];

// Staleness threshold: warn if a lab hasn't had new extraction data in this many weeks
const STALENESS_WEEKS = 6;

// Marker files (must match scripts/extract-model-cards.mjs)
const MARKER_DIR = os.tmpdir();
const MARKER_STARTED = path.join(MARKER_DIR, "ai-race-extraction-started.json");
const MARKER_COMPLETE = path.join(MARKER_DIR, "ai-race-extraction-complete.json");
const MARKER_BB_SKIP = path.join(MARKER_DIR, "ai-race-browserbase-skip.json");

function readMarker(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch { return null; }
}

function unlinkMarker(filePath) {
  try { fs.unlinkSync(filePath); } catch { /* not present, fine */ }
}

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
 * Snapshot cost_intelligence rows. update-data.js delete+inserts this table
 * each run, so we compare a normalized representation of every row to detect
 * semantic changes (new cheapest model, price drop, new quarter).
 * Returns Map of "benchmark|quarter" → "price|model|lab".
 */
async function snapshotCostIntelligence(supabase) {
  const { data, error } = await supabase
    .from("cost_intelligence")
    .select("benchmark, quarter, price, model, lab");

  if (error) throw new Error(`cost_intelligence snapshot failed: ${error.message}`);

  const snap = new Map();
  for (const row of data || []) {
    snap.set(`${row.benchmark}|${row.quarter}`, `${row.price}|${row.model}|${row.lab}`);
  }
  return snap;
}

/**
 * Count differences between two cost_intelligence snapshots.
 * Counts changed values, new keys, and removed keys.
 */
function diffCostIntelligence(before, after) {
  let count = 0;
  for (const [k, v] of after) {
    if (before.get(k) !== v) count++;
  }
  for (const [k] of before) {
    if (!after.has(k)) count++;
  }
  return count;
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

    proc.on("error", (err) => {
      console.error(`\n  ${label}: spawn error: ${err.message}`);
      resolve({ code: 1, stdout, stderr: stderr + err.message });
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
        source: after.source,
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
 * Query model_card_auto rows whose model_variant is unknown (neither matched
 * by HARNESS_PATTERN nor in ACKNOWLEDGED_CONFIG_VARIANTS). Surfaces variants
 * across all runs, not just this one — so missing a week doesn't silently
 * lose visibility. Jack reviews each unique variant once: either add a keyword
 * to HARNESS_KEYWORDS (real harness) or add the string to
 * ACKNOWLEDGED_CONFIG_VARIANTS in lib/pipeline.js (config knob).
 */
async function queryUnknownVariants(supabase) {
  const { data, error } = await supabase
    .from("benchmark_raw")
    .select("benchmark, lab, model, model_variant, score, source_url, extracted_at")
    .eq("triage_status", "ingest")
    .eq("source", "model_card_auto")
    .not("model_variant", "is", null)
    .order("extracted_at", { ascending: false });

  if (error) {
    console.warn(`  Warning: Failed to query unknown variants: ${error.message}`);
    return [];
  }

  return (data || []).filter(row => {
    // Normalize first so "without tools"/"no tools" (which become null at ingestion
    // and never reach the chart as variants) don't clutter the review.
    const v = normalizeVariant(row.model_variant);
    if (!v) return false;
    if (isHarnessVariant(v)) return false;
    if (isAcknowledgedConfigVariant(v)) return false;
    return true;
  });
}

/**
 * Query last extraction date per lab from benchmark_raw.
 * Returns array of { lab, lastExtraction, stale } objects.
 */
async function queryLabFreshness(supabase) {
  const staleThreshold = new Date();
  staleThreshold.setDate(staleThreshold.getDate() - STALENESS_WEEKS * 7);

  const queries = EXTRACTED_LABS.map(async (lab) => {
    const { data, error } = await supabase
      .from("benchmark_raw")
      .select("extracted_at")
      .eq("lab", lab)
      .eq("source", "model_card_auto")
      .order("extracted_at", { ascending: false })
      .limit(1);

    if (error) return { lab, lastExtraction: null, stale: true };
    const lastDate = data?.[0]?.extracted_at || null;
    const stale = !lastDate || new Date(lastDate) < staleThreshold;
    return { lab, lastExtraction: lastDate, stale };
  });

  return Promise.all(queries);
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
 * Get human-readable source name, fallback to key.
 */
function sourceName(key) {
  const names = {
    artificialanalysis: "Artificial Analysis",
    swebench: "SWE-bench",
    arcprize: "ARC Prize",
    epoch: "Epoch AI",
    model_card: "Model Card",
    model_card_auto: "Model Card (auto)",
    manual: "Manual",
  };
  return names[key] || key || "Unknown";
}

/**
 * Build the combined GitHub issue report.
 */
function buildReport({ changes, flagged, rejected, unknownVariants, extractResult, ingestResult, labFreshness, runDate, regen, extractionCrashed, browserbaseSkipped }) {
  const parts = [];

  // ─── Header ─────────────────────────────────────────────
  let extractStatus;
  if (!extractResult) extractStatus = "Skipped";
  else if (extractionCrashed) extractStatus = "CRASHED (no completion marker)";
  else if (extractResult.code === 0) extractStatus = "OK";
  else extractStatus = `FAILED (exit ${extractResult.code})`;

  const ingestStatus = ingestResult.code === 0 ? "OK" : `FAILED (exit ${ingestResult.code})`;

  parts.push(`## Pipeline Run (${runDate})`);
  parts.push(`Extraction: ${extractStatus} | Ingestion: ${ingestStatus}`);
  if (regen) {
    parts.push(`Analyses regeneration: ${regen.shouldRegen ? "queued" : "skipped"} — ${regen.reason}`);
  }
  parts.push("");

  // ─── Extraction issues (crash or Browserbase unavailability) ─
  if (extractionCrashed) {
    parts.push("## Extraction Crashed");
    parts.push("The extraction subprocess exited without writing a completion marker. ");
    parts.push("This usually means a fatal error mid-run (browser crash, OOM, network hang). ");
    parts.push("Check the Actions log for the stack trace.");
    parts.push("");
  }
  if (browserbaseSkipped && browserbaseSkipped.skippedUrls?.length > 0) {
    parts.push("## Browserbase Unavailable");
    parts.push(`Skipped extraction for ${browserbaseSkipped.skippedUrls.length} article(s) flagged as \`useBrowserbase\` (currently OpenAI). `);
    parts.push("Other labs ingested normally. Causes: quota exhausted, API outage, key rotation.");
    parts.push("");
    parts.push("<details><summary>Skipped URLs</summary>");
    parts.push("");
    for (const item of browserbaseSkipped.skippedUrls) {
      parts.push(`- ${item.url}${item.reason ? `  \n  _${item.reason}_` : ""}`);
    }
    parts.push("");
    parts.push("</details>");
    parts.push("");
  }

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

  // ─── Variant Review ─────────────────────────────────────
  // Variants that aren't classified as harness and aren't in the acknowledged-config
  // set. Each unique string is a one-time decision: edit lib/pipeline.js to either
  // add a HARNESS_KEYWORDS entry (real harness) or add to ACKNOWLEDGED_CONFIG_VARIANTS.
  if (unknownVariants && unknownVariants.length > 0) {
    parts.push(`## Variant Review (${unknownVariants.length})`);
    parts.push("Unrecognized variants currently being ingested. Decide for each unique variant string:");
    parts.push("- If it's a harness/scaffold (different evaluation rig): add a keyword to `HARNESS_KEYWORDS` in `lib/pipeline.js`.");
    parts.push("- If it's a config knob (same rig, different settings): add the lowercase string to `ACKNOWLEDGED_CONFIG_VARIANTS`.");
    parts.push("");
    for (const item of unknownVariants) {
      const since = item.extracted_at ? item.extracted_at.split("T")[0] : "unknown";
      const sourceLink = item.source_url ? ` | [Source](${item.source_url})` : "";
      // Show the normalized form (what actually reaches the chart and is matched
      // by HARNESS_PATTERN / ACKNOWLEDGED_CONFIG_VARIANTS at runtime).
      const displayVariant = normalizeVariant(item.model_variant) ?? item.model_variant;
      parts.push(`- **${item.model}** on **${benchmarkName(item.benchmark)}**: ${item.score} \`[${displayVariant}]\` (since ${since})${sourceLink}`);
    }
    parts.push("");
  }

  // ─── New Scores on Site ─────────────────────────────────
  parts.push("## New Scores on Site");
  parts.push("");

  if (changes.length > 0) {
    parts.push("Changes to best scores on the live site this run.");
    parts.push("");
    parts.push("| Benchmark | Lab | Score | Previous | Model | Source | Status |");
    parts.push("|-----------|-----|-------|----------|-------|--------|--------|");
    for (const c of changes) {
      const prev = c.previous !== null ? c.previous : "—";
      const status = c.verified ? "Verified" : "Unverified";
      parts.push(`| ${benchmarkName(c.benchmark)} | ${labName(c.lab)} | ${c.score} | ${prev} | ${c.model} | ${sourceName(c.source)} | ${status} |`);
    }
  } else {
    parts.push("_No changes this run._");
  }

  // ─── Lab Freshness ──────────────────────────────────────
  const staleLabs = labFreshness.filter(l => l.stale);

  parts.push("");
  parts.push("## Lab Freshness");
  parts.push("");
  parts.push("| Lab | Last Extraction | Status |");
  parts.push("|-----|----------------|--------|");
  for (const l of labFreshness) {
    const date = l.lastExtraction ? l.lastExtraction.split("T")[0] : "Never";
    const status = l.stale ? `Stale (>${STALENESS_WEEKS} weeks)` : "OK";
    parts.push(`| ${labName(l.lab)} | ${date} | ${status} |`);
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

  const needsReview = totalFlagged > 0 || staleLabs.length > 0;
  const labels = needsReview ? "pipeline-report,needs-review" : "pipeline-report";

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
  const beforeCostSnapshot = await snapshotCostIntelligence(supabase);
  console.log(`  Snapshot: ${beforeSnapshot.size} (benchmark, lab) pairs, ${beforeCostSnapshot.size} cost rows`);

  // ─── Step 2: Run extraction ─────────────────────────────
  let extractResult = null;
  let extractionCrashed = false;
  let browserbaseSkipped = null; // payload from .browserbase-skip.json if present

  if (SKIP_EXTRACT) {
    console.log("\nStep 2: Extraction skipped (--skip-extract)");
  } else {
    // Defensive: clear any stale markers from a prior run before launching
    unlinkMarker(MARKER_STARTED);
    unlinkMarker(MARKER_COMPLETE);
    unlinkMarker(MARKER_BB_SKIP);

    const extractArgs = ["--no-report"];
    if (DRY_RUN) extractArgs.push("--dry-run");

    extractResult = await runScript(
      path.resolve(__dirname, "extract-model-cards.mjs"),
      extractArgs,
      "Step 2: Extraction"
    );

    if (extractResult.code !== 0) {
      console.warn("\n  Warning: Extraction failed. Continuing with ingestion (existing data)...");
    }

    // Marker file inspection — single source of truth for "did extraction actually finish?"
    const completeMarker = readMarker(MARKER_COMPLETE);
    const bbSkipMarker = readMarker(MARKER_BB_SKIP);

    if (!completeMarker) {
      // Subprocess didn't write the complete marker → it crashed somewhere
      extractionCrashed = true;
      console.warn("\n  Warning: Extraction did not write the complete marker — likely crashed mid-run.");
    }
    if (bbSkipMarker) {
      browserbaseSkipped = bbSkipMarker;
      console.warn(`\n  Warning: Browserbase was unavailable for ${bbSkipMarker.skippedUrls?.length || 0} article(s).`);
    }

    // Tidy up — orchestrator owns marker lifecycle
    unlinkMarker(MARKER_STARTED);
    unlinkMarker(MARKER_COMPLETE);
    unlinkMarker(MARKER_BB_SKIP);
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

  const afterCostSnapshot = await snapshotCostIntelligence(supabase);
  const costChangeCount = diffCostIntelligence(beforeCostSnapshot, afterCostSnapshot);
  console.log(`  ${costChangeCount} cost intelligence change${costChangeCount !== 1 ? "s" : ""} detected.`);

  // ─── Step 5.5: Compute analyses-regen gate ──────────────
  console.log("\nStep 5.5: Computing analyses-regen gate...");
  const { data: cachedRows, error: cachedErr } = await supabase
    .from("cached_analyses")
    .select("date_range, end_quarter, generated_at");
  if (cachedErr) {
    console.warn(`  Warning: cached_analyses query failed (${cachedErr.message}). Defaulting to regen.`);
  }
  const regen = cachedErr
    ? { shouldRegen: true, reason: `cached_analyses query error: ${cachedErr.message}` }
    : shouldRegenerateAnalyses({
        changeCount: changes.length,
        costChangeCount,
        cachedRows: cachedRows || [],
        expectedPresets: getPresets(),
        currentQuarter: TIME_LABELS[TIME_LABELS.length - 1],
        compareQuarters,
      });
  console.log(`  Analyses regen: ${regen.shouldRegen ? "queued" : "skipped"} (${regen.reason})`);

  if (process.env.GITHUB_OUTPUT) {
    try {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `should_regen_analyses=${regen.shouldRegen}\n`);
    } catch (err) {
      console.warn(`  Warning: failed to write GITHUB_OUTPUT (${err.message}).`);
    }
  }

  // ─── Step 6: Query flagged, rejected, variants, and freshness ─────
  console.log("\nStep 6: Querying flagged, rejected, unknown variants, and lab freshness...");
  const flagged = await queryFlaggedItems(supabase, runStartTime);
  const rejected = await queryRejectedItems(supabase, runStartTime);
  const unknownVariants = await queryUnknownVariants(supabase);
  const labFreshness = await queryLabFreshness(supabase);
  console.log(`  Flagged: ${flagged.newItems.length} new, ${flagged.carriedOver.length} carried over`);
  console.log(`  Rejected: ${rejected.length} this run`);
  console.log(`  Unknown variants needing review: ${unknownVariants.length}`);
  const staleLabs = labFreshness.filter(l => l.stale);
  if (staleLabs.length > 0) {
    console.warn(`  Stale labs: ${staleLabs.map(l => labName(l.lab)).join(", ")}`);
  } else {
    console.log(`  All ${labFreshness.length} labs have fresh data`);
  }

  // ─── Step 7: Build and post report ──────────────────────
  console.log("\nStep 7: Building report...");
  const report = buildReport({
    changes,
    flagged,
    rejected,
    unknownVariants,
    extractResult,
    ingestResult,
    labFreshness,
    runDate,
    regen,
    extractionCrashed,
    browserbaseSkipped,
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

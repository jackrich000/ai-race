// scripts/update-data.js
// Multi-source data ingestion for AI Benchmark Tracker.
// Fetches from: Artificial Analysis API, SWE-bench GitHub, ARC Prize, Epoch AI.
// Computes cumulative-best scores per lab per quarter, writes to Supabase (delete + insert).
//
// Usage:
//   SUPABASE_SERVICE_KEY=xxx AA_API_KEY=xxx node scripts/update-data.js

const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const AdmZip = require("adm-zip");
const { parse } = require("csv-parse/sync");
const { createClient } = require("@supabase/supabase-js");

// ─── Config ──────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL || "https://jtrhsqdfevyqzzjjvcdr.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const AA_API_KEY = process.env.AA_API_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error("Error: Set SUPABASE_SERVICE_KEY environment variable.");
  process.exit(1);
}
if (!AA_API_KEY) {
  console.error("Error: Set AA_API_KEY environment variable (Artificial Analysis API key).");
  process.exit(1);
}

const {
  LAB_KEYS, TIME_LABELS: QUARTERS, compareQuarters,
} = require("../lib/config.js");

const {
  normalizeOrg, quarterEndDate, extractDateFromModelId,
  arcModelIdToLab, modelNameToLab,
  filterVerifiedDuplicates, computeCumulativeBest, computeCumulativeMin,
  generateMatchVerifiedRegex, findCol,
} = require("../lib/pipeline.js");

// Current quarter midpoint for ARC Prize entries without extractable dates
const now = new Date();
const curQ = Math.ceil((now.getMonth() + 1) / 3);
const curQStart = new Date(now.getFullYear(), (curQ - 1) * 3, 1);
const curQEnd = new Date(now.getFullYear(), curQ * 3, 0);
const CURRENT_QUARTER_DATE = new Date((curQStart.getTime() + curQEnd.getTime()) / 2);

// Earliest valid quarter per benchmark (scores before this are nulled out).
// Prevents retroactive evaluations from appearing before a benchmark existed.
const BENCHMARK_START_QUARTER = {
  "hle":       "Q1 2025",  // Released January 2025
  "gpqa":      "Q4 2023",  // Published November 2023
  "arc-agi-2": "Q1 2025",  // Released as part of ARC Prize 2025
};

// Cost of Intelligence: benchmarks with price thresholds
const COST_BENCHMARKS = {
  gpqa:          { evalField: "gpqa",          threshold: 36, startQuarter: "Q4 2023" },
  "mmlu-pro":    { evalField: "mmlu_pro",      threshold: 73, startQuarter: "Q2 2024" },
  livecodebench: { evalField: "livecodebench", threshold: 29, startQuarter: "Q1 2024" },
};

// Epoch: CSV files to process (AIME + ARC-AGI + SWE-bench for historical data)
const EPOCH_BENCHMARK_FILES = {
  "otis_mock_aime_2024_2025.csv": { key: "aime",      scoreCol: "mean_score" },
  "arc_agi_external.csv":         { key: "arc-agi-1",  scoreCol: "Score" },
  "arc_agi_2_external.csv":       { key: "arc-agi-2",  scoreCol: "Score" },
  "swe_bench_verified.csv":       { key: "swe-bench-verified", scoreCol: "mean_score" },
  "frontiermath.csv":             { key: "frontiermath", scoreCol: "mean_score" },
  "math_level_5.csv":             { key: "math-l5",      scoreCol: "mean_score" },
};

// ─── Source 6: Model card data (self-reported, unverified) ────
// Hardcoded here so the scoped DELETE doesn't wipe it on re-run.
// Each entry: { benchmark, lab, model, score, date, source, verified }
const MODEL_CARD_DATA = [
  // GPT-5.4 (https://openai.com/index/introducing-gpt-5-4/, March 5 2026)
  { benchmark: "hle", lab: "openai", model: "GPT-5.4 Pro (with tools)", score: 58.7, date: new Date("2026-03-05"), source: "model_card", verified: false, matchVerified: /gpt.?5.?4/i },
  { benchmark: "gpqa", lab: "openai", model: "GPT-5.4 Pro", score: 94.4, date: new Date("2026-03-05"), source: "model_card", verified: false, matchVerified: /gpt.?5.?4/i },
  { benchmark: "arc-agi-2", lab: "openai", model: "GPT-5.4 Pro", score: 83.3, date: new Date("2026-03-05"), source: "model_card", verified: false, matchVerified: /gpt.?5.?4/i },
  { benchmark: "arc-agi-1", lab: "openai", model: "GPT-5.4 Pro", score: 94.5, date: new Date("2026-03-05"), source: "model_card", verified: false, matchVerified: /gpt.?5.?4/i },

  // Claude Sonnet 4.6 (https://www.anthropic.com/claude/sonnet, Feb 17 2026)
  { benchmark: "gpqa", lab: "anthropic", model: "Claude Sonnet 4.6", score: 89.9, date: new Date("2026-02-17"), source: "model_card", verified: false, matchVerified: /sonnet.?4[\.\s-]?6/i },
  { benchmark: "swe-bench-verified", lab: "anthropic", model: "Claude Sonnet 4.6", score: 79.6, date: new Date("2026-02-17"), source: "model_card", verified: false, matchVerified: /sonnet.?4[\.\s-]?6/i },
  { benchmark: "arc-agi-2", lab: "anthropic", model: "Claude Sonnet 4.6", score: 58.3, date: new Date("2026-02-17"), source: "model_card", verified: false, matchVerified: /sonnet.?4[\.\s-]?6/i },
  { benchmark: "hle", lab: "anthropic", model: "Claude Sonnet 4.6 (with tools)", score: 49.0, date: new Date("2026-02-17"), source: "model_card", verified: false, matchVerified: /sonnet.?4[\.\s-]?6/i },

  // Claude Opus 4.6 (https://www.anthropic.com/news/claude-opus-4-6, March 2026)
  { benchmark: "gpqa", lab: "anthropic", model: "Claude Opus 4.6", score: 91.3, date: new Date("2026-03-01"), source: "model_card", verified: false, matchVerified: /opus.?4[\.\s-]?6/i },
  { benchmark: "swe-bench-verified", lab: "anthropic", model: "Claude Opus 4.6", score: 80.8, date: new Date("2026-03-01"), source: "model_card", verified: false, matchVerified: /opus.?4[\.\s-]?6/i },
  { benchmark: "hle", lab: "anthropic", model: "Claude Opus 4.6 (with tools)", score: 53.0, date: new Date("2026-03-01"), source: "model_card", verified: false, matchVerified: /opus.?4[\.\s-]?6/i },
  { benchmark: "arc-agi-2", lab: "anthropic", model: "Claude Opus 4.6", score: 68.8, date: new Date("2026-03-01"), source: "model_card", verified: false, matchVerified: /opus.?4[\.\s-]?6/i },

  // Gemini 3 Deep Think (https://blog.google/.../gemini-3-deep-think/, Feb 12 2026)
  { benchmark: "hle", lab: "google", model: "Gemini 3 Deep Think (with tools)", score: 53.4, date: new Date("2026-02-12"), source: "model_card", verified: false, matchVerified: /deep.?think/i },
  { benchmark: "hle", lab: "google", model: "Gemini 3 Deep Think", score: 48.4, date: new Date("2026-02-12"), source: "model_card", verified: false, matchVerified: /deep.?think/i },
  { benchmark: "arc-agi-2", lab: "google", model: "Gemini 3 Deep Think", score: 84.6, date: new Date("2026-02-12"), source: "model_card", verified: false, matchVerified: /deep.?think/i },

  // Gemini 3.1 Pro (https://blog.google/.../gemini-3-1-pro/, Feb 19 2026)
  { benchmark: "gpqa", lab: "google", model: "Gemini 3.1 Pro", score: 94.3, date: new Date("2026-02-19"), source: "model_card", verified: false, matchVerified: /gemini.?3[\.\s-]?1.?pro/i },
  { benchmark: "hle", lab: "google", model: "Gemini 3.1 Pro (with tools)", score: 51.4, date: new Date("2026-02-19"), source: "model_card", verified: false, matchVerified: /gemini.?3[\.\s-]?1.?pro/i },
  { benchmark: "hle", lab: "google", model: "Gemini 3.1 Pro", score: 44.4, date: new Date("2026-02-19"), source: "model_card", verified: false, matchVerified: /gemini.?3[\.\s-]?1.?pro/i },
  { benchmark: "arc-agi-2", lab: "google", model: "Gemini 3.1 Pro", score: 77.1, date: new Date("2026-02-19"), source: "model_card", verified: false, matchVerified: /gemini.?3[\.\s-]?1.?pro/i },
];

// ─── Source 7: Model cards from Supabase (DB-driven path) ────

/**
 * Fetch model card data from benchmark_raw.
 * Includes manually seeded entries (source='model_card') and auto-extracted entries
 * that passed triage (source='model_card_auto', triage_status='ingest').
 * Returns same shape as MODEL_CARD_DATA for drop-in replacement.
 */
async function fetchModelCardData(supabase) {
  // Manual seeds (source='model_card') don't have triage_status — include all.
  // Auto-extracted (source='model_card_auto') — only include triaged 'ingest'.
  const { data, error } = await supabase
    .from("benchmark_raw")
    .select("benchmark, lab, model, score, date, source, verified")
    .or("source.eq.model_card,and(source.eq.model_card_auto,triage_status.eq.ingest)");

  if (error) {
    console.warn("   [ModelCards] WARN: Failed to fetch from DB:", error.message);
    return null; // Caller falls back to hardcoded
  }

  if (!data || data.length === 0) {
    console.warn("   [ModelCards] WARN: No model card rows in DB");
    return null;
  }

  return data.map(row => ({
    benchmark: row.benchmark,
    lab: row.lab,
    model: row.model,
    score: row.score,
    date: new Date(row.date),
    source: row.source,
    verified: row.verified === true,
    matchVerified: generateMatchVerifiedRegex(row.model),
  }));
}

// ─── HTTP helpers ────────────────────────────────────────────

/** Fetch JSON from a URL with optional headers. Follows redirects. */
function fetchJSON(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = (reqUrl) => {
      const urlObj = new URL(reqUrl);
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        headers: { ...headers },
      };

      https.get(options, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          request(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} from ${reqUrl}`));
          return;
        }

        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch (e) {
            reject(new Error(`JSON parse error from ${reqUrl}: ${e.message}`));
          }
        });
      }).on("error", reject);
    };

    request(url);
  });
}

/** Download a file to a temp directory. Follows redirects. */
function downloadFile(url) {
  return new Promise((resolve, reject) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "epoch-"));
    const zipPath = path.join(tmpDir, "benchmark_data.zip");
    const file = fs.createWriteStream(zipPath);

    const request = (reqUrl) => {
      https.get(reqUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          request(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve({ zipPath, tmpDir });
        });
      }).on("error", reject);
    };

    request(url);
  });
}

// ─── Source 1: Artificial Analysis API (HLE + GPQA Diamond) ──

async function fetchArtificialAnalysis() {
  console.log("   [AA] Fetching Artificial Analysis API...");
  const response = await fetchJSON(
    "https://artificialanalysis.ai/api/v2/data/llms/models",
    { "x-api-key": AA_API_KEY }
  );

  // API returns { status, prompt_options, data: [...models] }
  const models = response.data || response;
  if (!Array.isArray(models)) {
    console.warn("   [AA] WARN: Unexpected response structure, expected array in .data");
    return [];
  }

  const results = [];
  let skipped = 0;

  for (const model of models) {
    const lab = normalizeOrg(model.model_creator?.name);
    if (!lab || !LAB_KEYS.includes(lab)) { skipped++; continue; }

    const releaseDate = model.release_date ? new Date(model.release_date) : null;
    if (!releaseDate || isNaN(releaseDate.getTime())) { skipped++; continue; }

    const evals = model.evaluations || {};
    const modelName = model.name || model.slug || "Unknown";

    // HLE
    if (evals.hle != null) {
      results.push({
        benchmark: "hle",
        lab,
        model: modelName,
        score: evals.hle * 100,
        date: releaseDate,
        source: "artificialanalysis",
        verified: true,
      });
    }

    // GPQA Diamond
    if (evals.gpqa != null) {
      results.push({
        benchmark: "gpqa",
        lab,
        model: modelName,
        score: evals.gpqa * 100,
        date: releaseDate,
        source: "artificialanalysis",
        verified: true,
      });
    }
  }

  console.log(`   [AA] ${results.length} data points from ${models.length} models (${skipped} skipped)`);
  return results;
}

// ─── Source 2: SWE-bench Verified ────────────────────────────

async function fetchSWEBench() {
  console.log("   [SWE] Fetching SWE-bench leaderboard JSON...");
  const data = await fetchJSON(
    "https://raw.githubusercontent.com/swe-bench/swe-bench.github.io/master/data/leaderboards.json"
  );

  // Structure: { leaderboards: [{ name: "Verified", results: [...] }, ...] }
  let entries;
  if (data.leaderboards && Array.isArray(data.leaderboards)) {
    const verified = data.leaderboards.find(lb => lb.name && lb.name.toLowerCase() === "verified");
    entries = verified ? verified.results : [];
    if (!verified) {
      console.warn("   [SWE] WARN: No 'Verified' leaderboard found. Names:", data.leaderboards.map(l => l.name).join(", "));
    }
  } else if (Array.isArray(data)) {
    entries = data;
  } else {
    console.warn("   [SWE] WARN: Unexpected JSON structure. Keys:", Object.keys(data).join(", "));
    return [];
  }

  const results = [];
  let skipped = 0;

  let rejected = 0;

  for (const entry of entries) {
    // Parse org and all model tags
    const tags = entry.tags || [];
    const orgTag = tags.find(t => typeof t === "string" && t.startsWith("Org: "));
    const orgName = orgTag ? orgTag.substring(5).trim() : null;
    const modelTags = tags
      .filter(t => typeof t === "string" && t.startsWith("Model: "))
      .map(t => t.substring(7).trim());

    // Derive lab from org tag
    let lab = normalizeOrg(orgName);

    // Derive labs from all Model tags
    const modelLabs = [...new Set(modelTags.map(m => modelNameToLab(m)).filter(Boolean))];

    // Reject multi-vendor entries (models from 2+ different labs)
    if (modelLabs.length > 1) {
      console.log(`   [SWE] REJECTED multi-vendor: "${entry.name}" (models span ${modelLabs.join("+")})`);
      rejected++;
      continue;
    }

    const modelLab = modelLabs[0] || null;

    // Cross-validate: if both org and model lab are known, they must match
    if (modelLab && lab && modelLab !== lab) {
      console.log(`   [SWE] REJECTED cross-lab: "${entry.name}" (Org=${orgName}→${lab}, Model=${modelTags[0]}→${modelLab})`);
      rejected++;
      continue;
    }

    // If no org tag but model tag exists, derive lab from model
    if (!lab && modelLab) lab = modelLab;

    if (!lab || !LAB_KEYS.includes(lab)) { skipped++; continue; }

    const score = parseFloat(entry.resolved);
    if (isNaN(score)) { skipped++; continue; }

    const date = entry.date ? new Date(entry.date) : null;
    if (!date || isNaN(date.getTime())) { skipped++; continue; }

    results.push({
      benchmark: "swe-bench-verified",
      lab,
      model: entry.name || "Unknown",
      score,
      date,
      source: "swebench",
      verified: true,
    });
  }

  if (rejected > 0) {
    console.log(`   [SWE] Rejected ${rejected} cross-lab/multi-vendor entries`);
  }

  console.log(`   [SWE] ${results.length} data points from ${entries.length} entries (${skipped} skipped)`);
  return results;
}

// ─── Source 3: ARC Prize (ARC-AGI-1 + ARC-AGI-2) ────────────

async function fetchARCPrize() {
  console.log("   [ARC] Fetching ARC Prize evaluations...");
  const data = await fetchJSON(
    "https://arcprize.org/media/data/leaderboard/evaluations.json"
  );

  const evaluations = Array.isArray(data) ? data : [];
  const results = [];
  let skipped = 0;

  const datasetMap = {
    "v1_Semi_Private": "arc-agi-1",
    "v2_Semi_Private": "arc-agi-2",
  };

  for (const entry of evaluations) {
    const benchKey = datasetMap[entry.datasetId];
    if (!benchKey) continue; // Not a dataset we care about

    // Derive lab from modelId (start-anchored patterns reject third-party scaffolds)
    const lab = arcModelIdToLab(entry.modelId || "");
    if (!lab) { skipped++; continue; }

    const score = parseFloat(entry.score);
    if (isNaN(score)) { skipped++; continue; }

    // Extract date from modelId, fallback to current quarter
    const date = extractDateFromModelId(entry.modelId || "") || CURRENT_QUARTER_DATE;

    results.push({
      benchmark: benchKey,
      lab,
      model: entry.modelId || "Unknown",
      score: score * 100, // 0-1 → percentage
      date,
      source: "arcprize",
      verified: true,
    });
  }

  console.log(`   [ARC] ${results.length} data points (${skipped} skipped as non-lab/third-party)`);
  return results;
}

// ─── Source 4: Epoch AI (AIME + ARC-AGI historical) ──────────

async function fetchEpoch() {
  console.log("   [Epoch] Downloading Epoch AI benchmark ZIP...");
  const { zipPath, tmpDir } = await downloadFile("https://epoch.ai/data/benchmark_data.zip");

  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();

  // Extract target CSVs
  const csvContents = {};
  for (const entry of entries) {
    const name = path.basename(entry.entryName);
    if (EPOCH_BENCHMARK_FILES[name]) {
      csvContents[name] = entry.getData().toString("utf-8");
    }
  }

  const results = [];

  for (const [filename, config] of Object.entries(EPOCH_BENCHMARK_FILES)) {
    const csvContent = csvContents[filename];
    if (!csvContent) {
      console.warn(`   [Epoch] WARN: ${filename} not found in ZIP`);
      continue;
    }

    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });

    if (records.length === 0) continue;

    const headers = Object.keys(records[0]);

    // Find columns
    const scoreCol = findCol(headers, config.scoreCol, ["Score", "score", "mean_score", "Accuracy", "EM"]);
    const dateCol = findCol(headers, null, ["Release date", "release_date", "Date", "date", "Publication date"]);
    const orgCol = findCol(headers, null, ["Organization", "organization", "Org", "org"]);
    const nameCol = findCol(headers, null, ["Name", "name", "Model version"]);

    if (!scoreCol || !dateCol || !orgCol) {
      console.warn(`   [Epoch] WARN: ${filename} missing required columns (score=${scoreCol}, date=${dateCol}, org=${orgCol})`);
      continue;
    }

    let count = 0;
    for (const row of records) {
      const lab = normalizeOrg(row[orgCol]);
      if (!lab || !LAB_KEYS.includes(lab)) continue;

      const date = new Date(row[dateCol]);
      if (isNaN(date.getTime())) continue;

      const rawScore = parseFloat(row[scoreCol]);
      if (isNaN(rawScore)) continue;

      // Auto-scale: if score looks like 0-1 range, multiply by 100
      const score = rawScore <= 1.0 ? rawScore * 100 : rawScore;

      const modelName = row[nameCol] || row["Model version"] || "Unknown";

      results.push({
        benchmark: config.key,
        lab,
        model: modelName,
        score,
        date,
        source: "epoch",
        verified: true,
      });
      count++;
    }

    console.log(`   [Epoch] ${filename} → ${count} data points for ${config.key}`);
  }

  // Cleanup temp files
  try { fs.rmSync(tmpDir, { recursive: true }); } catch (_) {}

  console.log(`   [Epoch] ${results.length} total data points`);
  return results;
}

// ─── Source 5: Cost data (AA pricing + Epoch GPQA scores) ─────

async function fetchCostData() {
  console.log("   [Cost] Fetching AA pricing data...");
  const response = await fetchJSON(
    "https://artificialanalysis.ai/api/v2/data/llms/models",
    { "x-api-key": AA_API_KEY }
  );

  const models = response.data || response;
  if (!Array.isArray(models)) {
    console.warn("   [Cost] WARN: Unexpected AA response structure");
    return [];
  }

  const results = [];

  // ── Part 1: AA models with both score and price (all benchmarks) ──
  let aaCount = 0;
  // Also build a price lookup for cross-referencing with Epoch
  // Key: release_date string (YYYY-MM-DD) + "|" + lowercase lab name
  const aaPriceLookup = new Map();

  for (const model of models) {
    const releaseDate = model.release_date ? new Date(model.release_date) : null;
    if (!releaseDate || isNaN(releaseDate.getTime())) continue;

    const pricing = model.pricing || {};
    const price = pricing.price_1m_blended_3_to_1;
    if (price == null || price <= 0) continue;

    const modelName = model.name || model.slug || "Unknown";
    const lab = model.model_creator?.name || "Unknown";

    // Store in price lookup for Epoch cross-reference
    const dateStr = model.release_date;
    const labLower = lab.toLowerCase();
    const lookupKey = `${dateStr}|${labLower}`;
    // Keep cheapest price per date+lab (some labs have multiple models same day)
    if (!aaPriceLookup.has(lookupKey) || price < aaPriceLookup.get(lookupKey).price) {
      aaPriceLookup.set(lookupKey, { price, name: modelName, lab });
    }
    // Also store by model name for direct matching
    aaPriceLookup.set(`name|${modelName.toLowerCase()}`, { price, name: modelName, lab, date: releaseDate });

    const evals = model.evaluations || {};
    for (const [benchKey, config] of Object.entries(COST_BENCHMARKS)) {
      const rawScore = evals[config.evalField];
      if (rawScore == null) continue;
      const score = rawScore * 100;
      if (score < config.threshold) continue;

      results.push({
        benchmark: benchKey,
        date: releaseDate,
        price,
        score: Math.round(score * 10) / 10,
        model: modelName,
        lab,
      });
      aaCount++;
    }
  }

  console.log(`   [Cost] ${aaCount} data points from AA (score+price)`);

  // ── Part 2: Epoch GPQA scores cross-referenced with AA prices ──
  // Epoch has GPQA scores for older models (GPT-4 Turbo etc.) that AA lacks
  console.log("   [Cost] Fetching Epoch GPQA scores for cross-reference...");
  let epochCount = 0;
  try {
    const { zipPath, tmpDir } = await downloadFile("https://epoch.ai/data/benchmark_data.zip");
    const zip = new AdmZip(zipPath);
    const gpqaEntry = zip.getEntries().find(e => path.basename(e.entryName) === "gpqa_diamond.csv");

    if (gpqaEntry) {
      const records = parse(gpqaEntry.getData().toString("utf-8"), {
        columns: true, skip_empty_lines: true, trim: true, relax_column_count: true,
      });

      const gpqaConfig = COST_BENCHMARKS["gpqa"];

      for (const row of records) {
        const rawScore = parseFloat(row["mean_score"]);
        if (isNaN(rawScore)) continue;
        const score = rawScore <= 1.0 ? rawScore * 100 : rawScore;
        if (score < gpqaConfig.threshold) continue;

        const dateStr = row["Release date"];
        if (!dateStr) continue;
        const releaseDate = new Date(dateStr);
        if (isNaN(releaseDate.getTime())) continue;

        const epochOrg = row["Organization"] || "";

        // Try to find AA price: match by date + lab
        const orgLower = epochOrg.toLowerCase().split(",")[0].trim();
        const lookupKey = `${dateStr}|${orgLower}`;
        let match = aaPriceLookup.get(lookupKey);

        // Fallback: try common org name variations
        if (!match) {
          const orgVariations = {
            "meta ai": "meta",
            "google deepmind": "google",
            "mistral ai": "mistral",
          };
          const altOrg = orgVariations[orgLower];
          if (altOrg) match = aaPriceLookup.get(`${dateStr}|${altOrg}`);
        }

        if (!match) continue;

        // Check we don't already have an AA data point for this exact model+date
        const isDuplicate = results.some(r =>
          r.benchmark === "gpqa" &&
          r.date.getTime() === releaseDate.getTime() &&
          r.lab.toLowerCase() === match.lab.toLowerCase()
        );
        if (isDuplicate) continue;

        results.push({
          benchmark: "gpqa",
          date: releaseDate,
          price: match.price,
          score: Math.round(score * 10) / 10,
          model: match.name,
          lab: match.lab,
        });
        epochCount++;
      }
    }

    try { fs.rmSync(tmpDir, { recursive: true }); } catch (_) {}
  } catch (err) {
    console.warn("   [Cost] WARN: Epoch cross-reference failed:", err.message);
  }

  console.log(`   [Cost] ${epochCount} additional GPQA data points from Epoch cross-reference`);
  console.log(`   [Cost] ${results.length} total cost data points`);
  return results;
}

// ─── Main ────────────────────────────────────────────────────

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const BATCH_SIZE = 500;

  // Pre-flight: check that model/source/verified columns exist
  console.log("0. Checking Supabase schema...");
  const { error: schemaErr } = await supabase
    .from("benchmark_scores")
    .select("model,source,verified")
    .limit(1);

  if (schemaErr && schemaErr.message.includes("column")) {
    console.error("\n   Schema migration needed! Run in the Supabase SQL editor:");
    console.error("     ALTER TABLE benchmark_scores ADD COLUMN model TEXT;");
    console.error("     ALTER TABLE benchmark_scores ADD COLUMN source TEXT;");
    console.error("     ALTER TABLE benchmark_scores ADD COLUMN verified BOOLEAN DEFAULT true;");
    process.exit(1);
  }

  // Check benchmark_raw table exists
  const { error: rawSchemaErr } = await supabase
    .from("benchmark_raw")
    .select("benchmark")
    .limit(1);

  if (rawSchemaErr) {
    console.error("\n   benchmark_raw table not found! Run the schema SQL in the Supabase SQL editor.");
    process.exit(1);
  }

  // Check cost_intelligence table exists
  const { error: costSchemaErr } = await supabase
    .from("cost_intelligence")
    .select("benchmark")
    .limit(1);

  if (costSchemaErr) {
    console.error("\n   cost_intelligence table not found! Run in the Supabase SQL editor:");
    console.error("     CREATE TABLE cost_intelligence (");
    console.error("       id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,");
    console.error("       benchmark TEXT NOT NULL, quarter TEXT NOT NULL,");
    console.error("       price NUMERIC, model TEXT, lab TEXT, score NUMERIC,");
    console.error("       threshold NUMERIC NOT NULL, UNIQUE (benchmark, quarter)");
    console.error("     );");
    process.exit(1);
  }

  // Fetch from all 4 sources in parallel
  console.log("\n1. Fetching from all sources...");
  const [aaData, sweData, arcData, epochData, costData] = await Promise.all([
    fetchArtificialAnalysis().catch(err => { console.error("   [AA] FAILED:", err.message); return []; }),
    fetchSWEBench().catch(err => { console.error("   [SWE] FAILED:", err.message); return []; }),
    fetchARCPrize().catch(err => { console.error("   [ARC] FAILED:", err.message); return []; }),
    fetchEpoch().catch(err => { console.error("   [Epoch] FAILED:", err.message); return []; }),
    fetchCostData().catch(err => { console.error("   [Cost] FAILED:", err.message); return []; }),
  ]);

  // Fetch model card data: try DB first, fall back to hardcoded
  console.log("\n2. Merging data and computing cumulative best...");
  const dbModelCards = await fetchModelCardData(supabase);
  const modelCardData = dbModelCards || MODEL_CARD_DATA;
  if (dbModelCards) {
    console.log(`   Using ${dbModelCards.length} model card entries from DB`);
  } else {
    console.log(`   Using ${MODEL_CARD_DATA.length} hardcoded model card entries (DB fallback)`);
  }

  const allMerged = [...aaData, ...sweData, ...arcData, ...epochData, ...modelCardData];
  const allFiltered = filterVerifiedDuplicates(allMerged);

  const byBenchmark = {}; // { benchKey: { labKey: [dataPoints] } }
  for (const p of allFiltered) {
    if (!byBenchmark[p.benchmark]) byBenchmark[p.benchmark] = {};
    if (!byBenchmark[p.benchmark][p.lab]) byBenchmark[p.benchmark][p.lab] = [];
    byBenchmark[p.benchmark][p.lab].push(p);
  }

  // Write raw observations to benchmark_raw (audit trail — includes all points, even filtered ones)
  const allRawPoints = allMerged;
  if (allRawPoints.length > 0) {
    console.log(`   Writing ${allRawPoints.length} raw observations to benchmark_raw...`);
    const rawRows = allRawPoints.map(p => ({
      benchmark: p.benchmark,
      lab: p.lab,
      model: p.model,
      score: Math.round(p.score * 10) / 10,
      date: p.date.toISOString().split("T")[0],
      source: p.source,
      verified: p.verified !== false,
    }));

    for (let i = 0; i < rawRows.length; i += BATCH_SIZE) {
      const batch = rawRows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from("benchmark_raw")
        .upsert(batch, { onConflict: "benchmark,lab,model,source" });

      if (error) {
        console.warn(`   benchmark_raw upsert WARN (batch ${Math.floor(i / BATCH_SIZE) + 1}):`, error.message);
      }
    }
    console.log(`   benchmark_raw: upserted ${rawRows.length} rows.`);
  }

  // Compute cumulative best per (benchmark, lab) and build upsert rows
  const allRows = [];

  for (const [benchKey, labsData] of Object.entries(byBenchmark)) {
    for (const lab of LAB_KEYS) {
      const points = labsData[lab] || [];
      const cumulBest = computeCumulativeBest(points, QUARTERS);

      const startQuarter = BENCHMARK_START_QUARTER[benchKey];
      for (const [quarter, best] of Object.entries(cumulBest)) {
        // Null out scores before the benchmark existed
        const tooEarly = startQuarter && compareQuarters(quarter, startQuarter) < 0;
        allRows.push({
          benchmark: benchKey,
          lab,
          quarter,
          score: best !== null && !tooEarly ? Math.round(best.score * 10) / 10 : null,
          model: best !== null && !tooEarly ? best.model || null : null,
          source: best !== null && !tooEarly ? best.source || null : null,
          verified: best !== null && !tooEarly ? best.verified : true,
        });
      }
    }
  }

  // Emit null rows for benchmarks with NO data at all (e.g., if a source was down)
  // Benchmarks already in byBenchmark are fully handled by the cumulative-best loop above
  // Automated benchmarks (ingested from sources). Manual seeds (humaneval, swe-bench-pro) are excluded.
  const automatedBenchmarks = ["swe-bench-verified", "arc-agi-1", "arc-agi-2", "hle", "gpqa", "aime", "frontiermath", "math-l5"];
  const allBenchmarks = automatedBenchmarks;
  for (const benchKey of allBenchmarks) {
    if (byBenchmark[benchKey]) continue; // Already processed above
    for (const lab of LAB_KEYS) {
      for (const quarter of QUARTERS) {
        allRows.push({
          benchmark: benchKey,
          lab,
          quarter,
          score: null,
          model: null,
          source: null,
          verified: true,
        });
      }
    }
  }

  console.log(`   Built ${allRows.length} rows across ${Object.keys(byBenchmark).length} benchmarks`);

  // Log summary per benchmark
  for (const benchKey of allBenchmarks) {
    const benchLabs = byBenchmark[benchKey] || {};
    const labsWithData = LAB_KEYS.filter(l => (benchLabs[l] || []).length > 0);
    const totalPoints = LAB_KEYS.reduce((sum, l) => sum + (benchLabs[l] || []).length, 0);
    const sources = [...new Set(LAB_KEYS.flatMap(l => (benchLabs[l] || []).map(p => p.source)))];
    console.log(`   ${benchKey}: ${totalPoints} points, labs=[${labsWithData.join(",")}], sources=[${sources.join(",")}]`);
  }

  // Sanity check: abort if any benchmark has zero data points (likely source outage)
  const emptyBenchmarks = allBenchmarks.filter(b =>
    byBenchmark[b] && LAB_KEYS.every(l => !(byBenchmark[b][l] || []).length)
  );
  const missingBenchmarks = allBenchmarks.filter(b => !byBenchmark[b]);
  if (emptyBenchmarks.length > 0 || missingBenchmarks.length > 0) {
    const problems = [...emptyBenchmarks, ...missingBenchmarks];
    console.error(`\n   ABORT: No data for benchmarks: ${problems.join(", ")}`);
    console.error("   This likely means a data source is down. Skipping write to preserve existing data.");
    process.exit(1);
  }

  const nonNullRows = allRows.filter(r => r.score !== null).length;
  if (nonNullRows < 100) {
    console.error(`\n   ABORT: Only ${nonNullRows} non-null scores (expected ~200). Possible data source failure.`);
    console.error("   Skipping write to preserve existing data.");
    process.exit(1);
  }

  // Delete rows for all benchmarks we're about to insert (covers both automated sources
  // and any benchmark that gained model card data via extraction)
  const benchmarksToReplace = [...new Set(allRows.map(r => r.benchmark))];
  console.log(`\n3. Replacing ${allRows.length} rows in Supabase (scoped delete + insert)...`);

  const { error: delError } = await supabase
    .from("benchmark_scores")
    .delete()
    .in("benchmark", benchmarksToReplace);

  if (delError) {
    console.error("   DELETE failed:", delError.message);
    process.exit(1);
  }
  console.log(`   Deleted existing rows for benchmarks: ${benchmarksToReplace.join(", ")}`);

  // Insert in chunks of 500 to stay within Supabase limits
  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    const batch = allRows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from("benchmark_scores")
      .insert(batch);

    if (error) {
      console.error(`   Insert FAILED (batch ${Math.floor(i / BATCH_SIZE) + 1}):`, error.message);
      process.exit(1);
    }
  }

  console.log(`   Inserted ${allRows.length} rows successfully.`);

  // Post-insert verification: check row counts per benchmark
  console.log("   Verifying post-insert row counts...");
  let verifyFailed = false;
  for (const benchKey of automatedBenchmarks) {
    const { count, error: countErr } = await supabase
      .from("benchmark_scores")
      .select("*", { count: "exact", head: true })
      .eq("benchmark", benchKey);

    if (countErr) {
      console.error(`   VERIFY ERROR: Could not count rows for ${benchKey}: ${countErr.message}`);
      verifyFailed = true;
    } else if (count === 0) {
      console.error(`   VERIFY FAILED: ${benchKey} has 0 rows after insert!`);
      verifyFailed = true;
    } else {
      const expectedMin = LAB_KEYS.length * QUARTERS.length;
      if (count < expectedMin) {
        console.warn(`   VERIFY WARN: ${benchKey} has ${count} rows (expected >= ${expectedMin})`);
      }
    }
  }
  if (verifyFailed) {
    console.error("\n   POST-INSERT VERIFICATION FAILED. The site may be showing incomplete data.");
    console.error("   Re-run this script or investigate the benchmark_scores table.");
  }

  // ─── Cost of Intelligence processing ────────────────────────
  console.log("\n4. Processing cost data...");

  // Group cost data by benchmark
  const costByBenchmark = {};
  for (const dp of costData) {
    if (!costByBenchmark[dp.benchmark]) costByBenchmark[dp.benchmark] = [];
    costByBenchmark[dp.benchmark].push(dp);
  }

  const costRows = [];
  for (const [benchKey, config] of Object.entries(COST_BENCHMARKS)) {
    const points = costByBenchmark[benchKey] || [];
    const cumulMin = computeCumulativeMin(points, QUARTERS);

    const startIdx = QUARTERS.indexOf(config.startQuarter);

    for (const [quarter, best] of Object.entries(cumulMin)) {
      const qi = QUARTERS.indexOf(quarter);
      const isBeforeStart = qi < startIdx;

      costRows.push({
        benchmark: benchKey,
        quarter,
        price: isBeforeStart ? null : (best ? Math.round(best.price * 1000) / 1000 : null),
        model: isBeforeStart ? null : (best?.model || null),
        lab: isBeforeStart ? null : (best?.lab || null),
        score: isBeforeStart ? null : (best?.score || null),
        threshold: config.threshold,
      });
    }

    const validPoints = Object.entries(cumulMin)
      .filter(([q]) => QUARTERS.indexOf(q) >= startIdx)
      .filter(([, v]) => v !== null);
    if (validPoints.length > 0) {
      const first = validPoints[0][1];
      const last = validPoints[validPoints.length - 1][1];
      const decline = first.price / last.price;
      console.log(`   ${benchKey}: ${validPoints.length} quarters, $${first.price.toFixed(2)} → $${last.price.toFixed(2)} (${decline.toFixed(0)}x decline)`);
    } else {
      console.log(`   ${benchKey}: no data points above threshold`);
    }
  }

  const nonNullCostRows = costRows.filter(r => r.price !== null).length;
  if (nonNullCostRows === 0) {
    console.error("\n   ABORT: Zero cost data points. Skipping write to preserve existing data.");
    process.exit(1);
  }

  // Delete all existing cost rows and insert fresh data
  console.log(`\n5. Replacing ${costRows.length} cost rows in Supabase (delete + insert)...`);

  const { error: costDelError } = await supabase
    .from("cost_intelligence")
    .delete()
    .gte("quarter", "Q1 2000"); // match all rows

  if (costDelError) {
    console.error("   Cost DELETE failed:", costDelError.message);
    process.exit(1);
  }
  console.log("   Deleted all existing cost_intelligence rows.");

  for (let i = 0; i < costRows.length; i += BATCH_SIZE) {
    const batch = costRows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from("cost_intelligence")
      .insert(batch);

    if (error) {
      console.error(`   Cost insert FAILED:`, error.message);
      process.exit(1);
    }
  }

  console.log(`   Inserted ${costRows.length} cost rows successfully.`);
  console.log("\nDone!");
  console.log("\nReminder: Run generate-analyses.js to update cached AI analyses:");
  console.log("  SUPABASE_SERVICE_KEY=xxx ANTHROPIC_API_KEY=xxx node scripts/generate-analyses.js");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});

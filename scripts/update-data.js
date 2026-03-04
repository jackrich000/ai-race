// scripts/update-data.js
// Multi-source data ingestion for AI Benchmark Tracker.
// Fetches from: Artificial Analysis API, SWE-bench GitHub, ARC Prize, Epoch AI.
// Computes cumulative-best scores per lab per quarter, upserts into Supabase.
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

const LAB_KEYS = ["openai", "anthropic", "google", "xai", "chinese"];

const QUARTERS = [
  "Q1 2023", "Q2 2023", "Q3 2023", "Q4 2023",
  "Q1 2024", "Q2 2024", "Q3 2024", "Q4 2024",
  "Q1 2025", "Q2 2025", "Q3 2025", "Q4 2025",
  "Q1 2026",
];

// Current quarter midpoint for ARC Prize entries without extractable dates
const CURRENT_QUARTER_DATE = new Date("2026-02-15");

// Earliest valid quarter per benchmark (scores before this are nulled out).
// Prevents retroactive evaluations from appearing before a benchmark existed.
const BENCHMARK_START_QUARTER = {
  "hle":       "Q1 2025",  // Released January 2025
  "gpqa":      "Q4 2023",  // Published November 2023
  "arc-agi-2": "Q1 2025",  // Released as part of ARC Prize 2025
};

// Org name normalization (covers all sources)
const ORG_MAP = {
  "openai":              "openai",
  "anthropic":           "anthropic",
  "google deepmind":     "google",
  "google":              "google",
  "xai":                 "xai",
  "x.ai":                "xai",
  "deepseek":            "chinese",
  "alibaba":             "chinese",
  "kimi":                "chinese",
  "minimax":             "chinese",
  "z ai":                "chinese",
  "z.ai":                "chinese",
  "z-ai":                "chinese",
  "z.ai (zhipu ai)":     "chinese",
  "zhipu ai":            "chinese",
  "bytedance":           "chinese",
  "bytedance seed":      "chinese",
  "baidu":               "chinese",
  "moonshot":            "chinese",
  "moonshot ai":         "chinese",
  "qwen":                "chinese",
};

// ARC Prize: derive org from modelId prefix (start-anchored to reject third-party scaffolds)
const ARC_LAB_PATTERNS = [
  [/^claude/i,       "anthropic"],
  [/^gpt[-_ ]/i,    "openai"],
  [/^o[134][-_ ]/i,  "openai"],
  [/^gemini/i,       "google"],
  [/^grok/i,         "xai"],
  [/^deepseek/i,     "chinese"],
  [/^qwen/i,         "chinese"],
  [/^kimi/i,         "chinese"],
  [/^minimax/i,      "chinese"],
  [/^glm/i,          "chinese"],
];

// Epoch: CSV files to process (AIME + ARC-AGI + SWE-bench for historical data)
const EPOCH_BENCHMARK_FILES = {
  "otis_mock_aime_2024_2025.csv": { key: "aime",      scoreCol: "mean_score" },
  "arc_agi_external.csv":         { key: "arc-agi-1",  scoreCol: "Score" },
  "arc_agi_2_external.csv":       { key: "arc-agi-2",  scoreCol: "Score" },
  "swe_bench_verified.csv":       { key: "swe-bench",  scoreCol: "mean_score" },
};

// ─── Helpers ─────────────────────────────────────────────────

/** Compare quarter strings like "Q1 2023" numerically. Returns negative/zero/positive. */
function compareQuarters(a, b) {
  const [qa, ya] = [parseInt(a[1]), parseInt(a.substring(3))];
  const [qb, yb] = [parseInt(b[1]), parseInt(b.substring(3))];
  return ya !== yb ? ya - yb : qa - qb;
}

function normalizeOrg(raw) {
  if (!raw) return null;
  const primary = raw.split(",")[0].trim().toLowerCase();
  return ORG_MAP[primary] || null;
}

function quarterEndDate(quarter) {
  const qNum = parseInt(quarter[1]);
  const year = parseInt(quarter.substring(3));
  return new Date(year, qNum * 3, 0, 23, 59, 59);
}

/** Extract a date from an ARC Prize modelId string. Returns Date or null. */
function extractDateFromModelId(modelId) {
  // YYYY-MM-DD (e.g., gpt-5-2-2025-12-11-thinking-xhigh)
  const m1 = modelId.match(/(202[3-9])-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])/);
  if (m1) return new Date(`${m1[1]}-${m1[2]}-${m1[3]}`);

  // YYYYMMDD (e.g., claude-opus-4-20250514)
  const m2 = modelId.match(/(202[3-9])(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/);
  if (m2) return new Date(`${m2[1]}-${m2[2]}-${m2[3]}`);

  // MMYYYY (e.g., gemini_3_deep_think_022026)
  const m3 = modelId.match(/(0[1-9]|1[0-2])(202[3-9])/);
  if (m3) return new Date(`${m3[2]}-${m3[1]}-01`);

  return null;
}

/** Derive lab key from an ARC Prize modelId. Returns lab key or null. */
function arcModelIdToLab(modelId) {
  for (const [pattern, lab] of ARC_LAB_PATTERNS) {
    if (pattern.test(modelId)) return lab;
  }
  return null;
}

/**
 * Compute cumulative best score per quarter, tracking which model achieved it.
 * @param {Array<{date: Date, score: number, model: string, source: string}>} dataPoints
 * @param {string[]} quarters
 * @returns {Object<string, {score: number, model: string, source: string}|null>}
 */
function computeCumulativeBest(dataPoints, quarters) {
  dataPoints.sort((a, b) => a.date - b.date);

  const result = {};
  let best = null;
  let dpIndex = 0;

  for (const quarter of quarters) {
    const end = quarterEndDate(quarter);

    while (dpIndex < dataPoints.length && dataPoints[dpIndex].date <= end) {
      const dp = dataPoints[dpIndex];
      if (best === null || dp.score > best.score) {
        best = { score: dp.score, model: dp.model, source: dp.source };
      }
      dpIndex++;
    }

    result[quarter] = best ? { ...best } : null;
  }

  return result;
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

  for (const entry of entries) {
    // Parse org from tags
    const tags = entry.tags || [];
    const orgTag = tags.find(t => typeof t === "string" && t.startsWith("Org: "));
    const orgName = orgTag ? orgTag.substring(5).trim() : null;
    const lab = normalizeOrg(orgName);

    if (!lab || !LAB_KEYS.includes(lab)) { skipped++; continue; }

    const score = parseFloat(entry.resolved);
    if (isNaN(score)) { skipped++; continue; }

    const date = entry.date ? new Date(entry.date) : null;
    if (!date || isNaN(date.getTime())) { skipped++; continue; }

    results.push({
      benchmark: "swe-bench",
      lab,
      model: entry.name || "Unknown",
      score,
      date,
      source: "swebench",
    });
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

function findCol(headers, preferred, candidates) {
  if (preferred && headers.includes(preferred)) return preferred;
  for (const c of candidates) {
    if (headers.includes(c)) return c;
  }
  return null;
}

// ─── Main ────────────────────────────────────────────────────

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Pre-flight: check that model/source columns exist
  console.log("0. Checking Supabase schema...");
  const { error: schemaErr } = await supabase
    .from("benchmark_scores")
    .select("model,source")
    .limit(1);

  if (schemaErr && schemaErr.message.includes("column")) {
    console.error("\n   Schema migration needed! Run in the Supabase SQL editor:");
    console.error("     ALTER TABLE benchmark_scores ADD COLUMN model TEXT;");
    console.error("     ALTER TABLE benchmark_scores ADD COLUMN source TEXT;");
    console.error("     DELETE FROM benchmark_scores WHERE benchmark = 'mmlu';");
    process.exit(1);
  }

  // Fetch from all 4 sources in parallel
  console.log("\n1. Fetching from all sources...");
  const [aaData, sweData, arcData, epochData] = await Promise.all([
    fetchArtificialAnalysis().catch(err => { console.error("   [AA] FAILED:", err.message); return []; }),
    fetchSWEBench().catch(err => { console.error("   [SWE] FAILED:", err.message); return []; }),
    fetchARCPrize().catch(err => { console.error("   [ARC] FAILED:", err.message); return []; }),
    fetchEpoch().catch(err => { console.error("   [Epoch] FAILED:", err.message); return []; }),
  ]);

  // Merge all data points by benchmark
  console.log("\n2. Merging data and computing cumulative best...");
  const byBenchmark = {}; // { benchKey: { labKey: [dataPoints] } }

  function addPoints(points) {
    for (const p of points) {
      if (!byBenchmark[p.benchmark]) byBenchmark[p.benchmark] = {};
      if (!byBenchmark[p.benchmark][p.lab]) byBenchmark[p.benchmark][p.lab] = [];
      byBenchmark[p.benchmark][p.lab].push(p);
    }
  }

  addPoints(aaData);    // HLE, GPQA
  addPoints(sweData);   // SWE-bench
  addPoints(arcData);   // ARC-AGI-1, ARC-AGI-2
  addPoints(epochData); // AIME, ARC-AGI-1, ARC-AGI-2, SWE-bench (historical)

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
        });
      }
    }
  }

  // Emit null rows for benchmarks with NO data at all (e.g., if a source was down)
  // Benchmarks already in byBenchmark are fully handled by the cumulative-best loop above
  const allBenchmarks = ["swe-bench", "arc-agi-1", "arc-agi-2", "hle", "gpqa", "aime"];
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

  // Upsert to Supabase
  console.log(`\n3. Upserting ${allRows.length} rows to Supabase...`);

  // Batch in chunks of 500 to stay within Supabase limits
  const BATCH_SIZE = 500;
  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    const batch = allRows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from("benchmark_scores")
      .upsert(batch, { onConflict: "benchmark,lab,quarter" });

    if (error) {
      console.error(`   Upsert FAILED (batch ${Math.floor(i / BATCH_SIZE) + 1}):`, error.message);
      process.exit(1);
    }
  }

  console.log(`   Upserted ${allRows.length} rows successfully.`);
  console.log("\nDone!");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});

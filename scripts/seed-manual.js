// scripts/seed-manual.js
// One-time seed for manually-curated benchmark data (HumanEval + SWE-bench Pro).
// These are not auto-ingested — the ingestion script's scoped DELETE preserves them.
// Produces cumulative-best rows (running max per lab per quarter, same as auto-ingestion).
//
// Usage:
//   SUPABASE_SERVICE_KEY="..." node scripts/seed-manual.js

const https = require("https");

const SUPABASE_URL = "https://jtrhsqdfevyqzzjjvcdr.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error("Error: Set SUPABASE_SERVICE_KEY environment variable.");
  process.exit(1);
}

// Generate quarters Q1 2023 through current
function generateQuarters() {
  const now = new Date();
  const endYear = now.getFullYear();
  const endQ = Math.ceil((now.getMonth() + 1) / 3);
  const quarters = [];
  for (let y = 2023; y <= endYear; y++) {
    for (let q = 1; q <= 4; q++) {
      quarters.push(`Q${q} ${y}`);
      if (y === endYear && q === endQ) return quarters;
    }
  }
  return quarters;
}

const QUARTERS = generateQuarters();
const LAB_KEYS = ["openai", "anthropic", "google", "xai", "chinese"];

// ─── HumanEval data (sourced from model cards / papers) ──────
// Raw data points: lab, quarter, score, model, verified
const HUMANEVAL_RAW = [
  { lab: "openai", quarter: "Q1 2023", score: 67.0, model: "GPT-4", verified: true },
  { lab: "google", quarter: "Q1 2023", score: 63.2, model: "PaLM 2", verified: true },
  { lab: "anthropic", quarter: "Q2 2023", score: 71.2, model: "Claude 2", verified: true },
  { lab: "chinese", quarter: "Q3 2023", score: 72.4, model: "DeepSeek Coder 33B", verified: true },
  { lab: "google", quarter: "Q4 2023", score: 67.7, model: "Gemini Pro", verified: true },
  { lab: "anthropic", quarter: "Q1 2024", score: 84.9, model: "Claude 3 Opus", verified: true },
  { lab: "google", quarter: "Q1 2024", score: 74.3, model: "Gemini Ultra 1.0", verified: true },
  { lab: "openai", quarter: "Q2 2024", score: 90.2, model: "GPT-4o", verified: true },
  { lab: "anthropic", quarter: "Q2 2024", score: 92.0, model: "Claude 3.5 Sonnet", verified: true },
  { lab: "chinese", quarter: "Q2 2024", score: 90.0, model: "DeepSeek-V2", verified: true },
  { lab: "openai", quarter: "Q3 2024", score: 92.4, model: "o1-preview", verified: true },
  { lab: "chinese", quarter: "Q3 2024", score: 93.7, model: "Qwen2.5-Coder 32B", verified: true },
  { lab: "google", quarter: "Q3 2024", score: 87.0, model: "Gemini 1.5 Pro", verified: true },
  { lab: "openai", quarter: "Q4 2024", score: 94.6, model: "o1", verified: true },
  { lab: "anthropic", quarter: "Q4 2024", score: 93.7, model: "Claude 3.5 Sonnet v2", verified: true },
  { lab: "google", quarter: "Q4 2024", score: 89.5, model: "Gemini 2.0 Flash", verified: true },
  { lab: "chinese", quarter: "Q4 2024", score: 97.3, model: "DeepSeek-V3", verified: true },
  { lab: "xai", quarter: "Q4 2024", score: 74.1, model: "Grok-2", verified: true },
];

// ─── SWE-bench Pro data (Scale AI SEAL leaderboard, Jan 2026) ──
// Source: https://scale.com/leaderboard — SWE-Bench Pro (Public Dataset)
const SWEBENCH_PRO_RAW = [
  { lab: "anthropic", quarter: "Q3 2025", score: 43.6, model: "Claude 4.5 Sonnet", verified: true },
  { lab: "anthropic", quarter: "Q4 2025", score: 45.9, model: "Claude Opus 4.5", verified: true },
  { lab: "google", quarter: "Q4 2025", score: 43.3, model: "Gemini 3 Pro", verified: true },
  { lab: "openai", quarter: "Q4 2025", score: 41.8, model: "GPT-5", verified: true },
  // GPT-5.4 model card (https://openai.com/index/introducing-gpt-5-4/, March 5 2026)
  { lab: "openai", quarter: "Q1 2026", score: 57.7, model: "GPT-5.4", verified: false, source: "model_card" },
];

/**
 * Convert raw data points into cumulative-best rows per (lab, quarter).
 * Produces a row for every quarter where the lab has any data (running max).
 * All data points compete on score — highest wins.
 * The verified status travels with the winning data point.
 */
function computeCumulativeBestRows(rawData, benchmarkKey, startQuarter) {
  const rows = [];
  const startIdx = QUARTERS.indexOf(startQuarter);

  for (const lab of LAB_KEYS) {
    const labPoints = rawData.filter(d => d.lab === lab);
    if (labPoints.length === 0) continue;

    let best = null;

    for (let qi = startIdx; qi < QUARTERS.length; qi++) {
      const quarter = QUARTERS[qi];

      // Collect data points for this quarter — all compete on score
      const quarterPoints = labPoints.filter(dp => dp.quarter === quarter);
      for (const dp of quarterPoints) {
        if (!best || dp.score > best.score) {
          best = { score: dp.score, model: dp.model, verified: dp.verified !== false, source: dp.source || "manual" };
        }
      }

      // Emit cumulative-best row
      rows.push({
        benchmark: benchmarkKey,
        lab,
        quarter,
        score: best ? best.score : null,
        model: best ? best.model : null,
        source: best ? best.source : "manual",
        verified: best ? best.verified : true,
      });
    }
  }

  return rows;
}

async function supabaseRequest(method, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, SUPABASE_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
        ...extraHeaders,
      },
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const data = Buffer.concat(chunks).toString();
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        } else {
          resolve(data ? JSON.parse(data) : null);
        }
      });
    });

    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/** Derive approximate date from quarter string (midpoint of quarter). */
function quarterMidDate(quarter) {
  const qNum = parseInt(quarter[1]);
  const year = parseInt(quarter.substring(3));
  const startMonth = (qNum - 1) * 3;
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth + 3, 0);
  return new Date((start.getTime() + end.getTime()) / 2).toISOString().split("T")[0];
}

async function main() {
  console.log("Deleting existing humaneval and swe-bench-pro rows...");
  await supabaseRequest("DELETE", "/rest/v1/benchmark_scores?benchmark=in.(humaneval,swe-bench-pro)");

  const humanEvalRows = computeCumulativeBestRows(HUMANEVAL_RAW, "humaneval", "Q1 2023");
  const sweProRows = computeCumulativeBestRows(SWEBENCH_PRO_RAW, "swe-bench-pro", "Q3 2025");
  const allRows = [...humanEvalRows, ...sweProRows];

  // Summary
  console.log(`HumanEval: ${humanEvalRows.length} rows (${humanEvalRows.filter(r => r.score !== null).length} non-null)`);
  console.log(`SWE-bench Pro: ${sweProRows.length} rows (${sweProRows.filter(r => r.score !== null).length} non-null)`);

  console.log(`Inserting ${allRows.length} rows...`);

  // Insert in batches
  const BATCH_SIZE = 500;
  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    const batch = allRows.slice(i, i + BATCH_SIZE);
    await supabaseRequest("POST", "/rest/v1/benchmark_scores", batch);
  }

  // Write raw observations to benchmark_raw (audit trail)
  const allRawData = [
    ...HUMANEVAL_RAW.map(d => ({ ...d, benchmark: "humaneval", source: "manual" })),
    ...SWEBENCH_PRO_RAW.map(d => ({ ...d, benchmark: "swe-bench-pro", source: "manual" })),
  ];
  const rawRows = allRawData.map(d => ({
    benchmark: d.benchmark,
    lab: d.lab,
    model: d.model,
    score: d.score,
    date: quarterMidDate(d.quarter),
    source: d.source,
    verified: d.verified !== false,
  }));

  console.log(`Writing ${rawRows.length} raw observations to benchmark_raw...`);
  try {
    await supabaseRequest("POST", "/rest/v1/benchmark_raw", rawRows, {
      "Prefer": "return=minimal,resolution=merge-duplicates",
    });
    console.log(`   benchmark_raw: upserted ${rawRows.length} rows.`);
  } catch (err) {
    console.warn(`   benchmark_raw upsert WARN:`, err.message);
  }

  console.log("Done! Manual seed data inserted with cumulative best.");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});

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
// Raw data points: lab, quarter, score, model
const HUMANEVAL_RAW = [
  { lab: "openai", quarter: "Q1 2023", score: 67.0, model: "GPT-4" },
  { lab: "google", quarter: "Q1 2023", score: 63.2, model: "PaLM 2" },
  { lab: "anthropic", quarter: "Q2 2023", score: 71.2, model: "Claude 2" },
  { lab: "chinese", quarter: "Q3 2023", score: 72.4, model: "DeepSeek Coder 33B" },
  { lab: "google", quarter: "Q4 2023", score: 67.7, model: "Gemini Pro" },
  { lab: "anthropic", quarter: "Q1 2024", score: 84.9, model: "Claude 3 Opus" },
  { lab: "google", quarter: "Q1 2024", score: 74.3, model: "Gemini Ultra 1.0" },
  { lab: "openai", quarter: "Q2 2024", score: 90.2, model: "GPT-4o" },
  { lab: "anthropic", quarter: "Q2 2024", score: 92.0, model: "Claude 3.5 Sonnet" },
  { lab: "chinese", quarter: "Q2 2024", score: 90.0, model: "DeepSeek-V2" },
  { lab: "openai", quarter: "Q3 2024", score: 92.4, model: "o1-preview" },
  { lab: "chinese", quarter: "Q3 2024", score: 93.7, model: "Qwen2.5-Coder 32B" },
  { lab: "google", quarter: "Q3 2024", score: 87.0, model: "Gemini 1.5 Pro" },
  { lab: "openai", quarter: "Q4 2024", score: 94.6, model: "o1" },
  { lab: "anthropic", quarter: "Q4 2024", score: 93.7, model: "Claude 3.5 Sonnet v2" },
  { lab: "google", quarter: "Q4 2024", score: 89.5, model: "Gemini 2.0 Flash" },
  { lab: "chinese", quarter: "Q4 2024", score: 97.3, model: "DeepSeek-V3" },
  { lab: "xai", quarter: "Q4 2024", score: 74.1, model: "Grok-2" },
];

// ─── SWE-bench Pro data (Feb 2026 leaderboard) ──
const SWEBENCH_PRO_RAW = [
  { lab: "openai", quarter: "Q1 2026", score: 42.7, model: "o3" },
  { lab: "anthropic", quarter: "Q1 2026", score: 40.2, model: "Claude Opus 4" },
  { lab: "google", quarter: "Q1 2026", score: 35.8, model: "Gemini 2.5 Pro" },
  { lab: "chinese", quarter: "Q1 2026", score: 33.1, model: "DeepSeek-R2" },
];

/**
 * Convert raw data points into cumulative-best rows per (lab, quarter).
 * Produces a row for every quarter where the lab has any data (running max).
 */
function computeCumulativeBestRows(rawData, benchmarkKey, startQuarter) {
  const rows = [];
  const startIdx = QUARTERS.indexOf(startQuarter);

  for (const lab of LAB_KEYS) {
    const labPoints = rawData.filter(d => d.lab === lab);
    if (labPoints.length === 0) continue;

    let bestScore = null;
    let bestModel = null;

    for (let qi = startIdx; qi < QUARTERS.length; qi++) {
      const quarter = QUARTERS[qi];

      // Check if there's a new data point this quarter
      for (const dp of labPoints) {
        if (dp.quarter === quarter) {
          if (bestScore === null || dp.score > bestScore) {
            bestScore = dp.score;
            bestModel = dp.model;
          }
        }
      }

      // Emit cumulative-best row
      rows.push({
        benchmark: benchmarkKey,
        lab,
        quarter,
        score: bestScore,
        model: bestModel,
        source: "manual",
      });
    }
  }

  return rows;
}

async function supabaseRequest(method, path, body) {
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

async function main() {
  console.log("Deleting existing humaneval and swe-bench-pro rows...");
  await supabaseRequest("DELETE", "/rest/v1/benchmark_scores?benchmark=in.(humaneval,swe-bench-pro)");

  const humanEvalRows = computeCumulativeBestRows(HUMANEVAL_RAW, "humaneval", "Q1 2023");
  const sweProRows = computeCumulativeBestRows(SWEBENCH_PRO_RAW, "swe-bench-pro", "Q1 2026");
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

  console.log("Done! Manual seed data inserted with cumulative best.");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});

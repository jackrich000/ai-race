// scripts/update-data.js
// Downloads Epoch AI benchmark data ZIP, parses CSVs, computes cumulative-best
// scores per lab per quarter, and upserts into Supabase.
//
// Usage:
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_KEY=eyJ... node scripts/update-data.js

const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const AdmZip = require("adm-zip");
const { parse } = require("csv-parse/sync");
const { createClient } = require("@supabase/supabase-js");

// ─── Config ──────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Error: Set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables.");
  process.exit(1);
}

const ZIP_URL = "https://epoch.ai/data/benchmark_data.zip";

// Map: CSV filename → { key (our benchmark ID), scoreCol (preferred score column) }
const BENCHMARK_FILES = {
  "swe_bench_verified.csv":         { key: "swe-bench",  scoreCol: "mean_score" },
  "arc_agi_external.csv":           { key: "arc-agi-1",  scoreCol: "Score" },
  "arc_agi_2_external.csv":         { key: "arc-agi-2",  scoreCol: "Score" },
  "hle_external.csv":               { key: "hle",        scoreCol: "Accuracy" },
  "mmlu_external.csv":              { key: "mmlu",       scoreCol: "EM" },
  "gpqa_diamond.csv":               { key: "gpqa",       scoreCol: "mean_score" },
  "otis_mock_aime_2024_2025.csv":   { key: "aime",       scoreCol: "mean_score" },
};

// Org name normalization → our lab keys
const ORG_MAP = {
  "openai":          "openai",
  "anthropic":       "anthropic",
  "google deepmind": "google",
  "google":          "google",
  "xai":             "xai",
  "x.ai":            "xai",
  "meta ai":         "meta",
  "meta":            "meta",
  "meta platforms":  "meta",
};

const LAB_KEYS = ["openai", "anthropic", "google", "xai", "meta"];

const QUARTERS = [
  "Q1 2023", "Q2 2023", "Q3 2023", "Q4 2023",
  "Q1 2024", "Q2 2024", "Q3 2024", "Q4 2024",
  "Q1 2025", "Q2 2025", "Q3 2025", "Q4 2025",
  "Q1 2026",
];

// ─── Helpers ─────────────────────────────────────────────────

function normalizeOrg(raw) {
  if (!raw) return null;
  const primary = raw.split(",")[0].trim().toLowerCase();
  return ORG_MAP[primary] || null;
}

function dateToQuarter(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const year = d.getFullYear();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q} ${year}`;
}

function quarterEndDate(quarter) {
  const qNum = parseInt(quarter[1]);
  const year = parseInt(quarter.substring(3));
  return new Date(year, qNum * 3, 0, 23, 59, 59); // last day of quarter's final month
}

function findScoreColumn(headers, preferredCol) {
  if (headers.includes(preferredCol)) return preferredCol;
  const candidates = ["Score", "score", "mean_score", "Accuracy", "accuracy", "EM", "em"];
  for (const c of candidates) {
    if (headers.includes(c)) return c;
  }
  return null;
}

function findDateColumn(headers) {
  const candidates = ["Release date", "release_date", "Date", "date", "Publication date"];
  for (const c of candidates) {
    if (headers.includes(c)) return c;
  }
  return null;
}

function findOrgColumn(headers) {
  const candidates = ["Organization", "organization", "Org", "org"];
  for (const c of candidates) {
    if (headers.includes(c)) return c;
  }
  return null;
}

/**
 * Compute cumulative best score per quarter.
 * dataPoints: [{ date: Date, score: number }] — already scaled to 0-100
 * Returns: Map<quarter, number|null>
 */
function computeCumulativeBest(dataPoints, quarters) {
  dataPoints.sort((a, b) => a.date - b.date);

  const result = {};
  let best = null;
  let dpIndex = 0;

  for (const quarter of quarters) {
    const end = quarterEndDate(quarter);

    while (dpIndex < dataPoints.length && dataPoints[dpIndex].date <= end) {
      const s = dataPoints[dpIndex].score;
      if (best === null || s > best) best = s;
      dpIndex++;
    }

    result[quarter] = best;
  }

  return result;
}

// ─── Download ────────────────────────────────────────────────

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

// ─── Main ────────────────────────────────────────────────────

async function main() {
  console.log("1. Downloading benchmark data ZIP...");
  const { zipPath, tmpDir } = await downloadFile(ZIP_URL);
  console.log(`   Downloaded to ${zipPath}`);

  console.log("2. Extracting target CSVs...");
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();

  // Build map of filename → CSV content (only our targets)
  const csvContents = {};
  for (const entry of entries) {
    const name = path.basename(entry.entryName);
    if (BENCHMARK_FILES[name]) {
      csvContents[name] = entry.getData().toString("utf-8");
    }
  }

  const foundFiles = Object.keys(csvContents);
  console.log(`   Found ${foundFiles.length} of ${Object.keys(BENCHMARK_FILES).length} target CSVs: ${foundFiles.join(", ")}`);

  console.log("3. Processing benchmarks...");
  const allRows = [];

  for (const [filename, config] of Object.entries(BENCHMARK_FILES)) {
    const csvContent = csvContents[filename];
    if (!csvContent) {
      console.warn(`   WARN: ${filename} not found in ZIP — skipping ${config.key}`);
      continue;
    }

    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });

    if (records.length === 0) {
      console.warn(`   WARN: ${filename} has 0 records — skipping`);
      continue;
    }

    const headers = Object.keys(records[0]);
    const scoreCol = findScoreColumn(headers, config.scoreCol);
    const dateCol = findDateColumn(headers);
    const orgCol = findOrgColumn(headers);

    if (!scoreCol) {
      console.warn(`   WARN: ${filename} — no score column found (tried "${config.scoreCol}" and fallbacks). Headers: ${headers.join(", ")}`);
      continue;
    }
    if (!dateCol) {
      console.warn(`   WARN: ${filename} — no date column found. Headers: ${headers.join(", ")}`);
      continue;
    }
    if (!orgCol) {
      console.warn(`   WARN: ${filename} — no organization column found. Headers: ${headers.join(", ")}`);
      continue;
    }

    console.log(`   Processing ${filename} → ${config.key} (score: "${scoreCol}", date: "${dateCol}", org: "${orgCol}")`);

    // Group data points by lab
    const labData = {}; // { labKey: [{ date, score }] }
    let skippedOrg = 0;
    let skippedParse = 0;

    for (const row of records) {
      const lab = normalizeOrg(row[orgCol]);
      if (!lab) { skippedOrg++; continue; }

      const date = new Date(row[dateCol]);
      if (isNaN(date.getTime())) { skippedParse++; continue; }

      const rawScore = parseFloat(row[scoreCol]);
      if (isNaN(rawScore)) { skippedParse++; continue; }

      if (!labData[lab]) labData[lab] = [];
      labData[lab].push({ date, score: rawScore });
    }

    // Auto-detect score scale: if max ≤ 1.0, multiply by 100
    const allScores = Object.values(labData).flat().map(d => d.score);
    const maxScore = allScores.length > 0 ? Math.max(...allScores) : 0;
    const scaleFactor = maxScore <= 1.0 ? 100 : 1;

    if (scaleFactor === 100) {
      for (const points of Object.values(labData)) {
        for (const p of points) p.score *= 100;
      }
    }

    // Compute cumulative best per lab and build upsert rows
    for (const lab of LAB_KEYS) {
      const points = labData[lab] || [];
      const cumulBest = computeCumulativeBest(points, QUARTERS);

      for (const [quarter, score] of Object.entries(cumulBest)) {
        allRows.push({
          benchmark: config.key,
          lab,
          quarter,
          score: score !== null ? Math.round(score * 10) / 10 : null,
        });
      }
    }

    const labsWithData = LAB_KEYS.filter(l => (labData[l] || []).length > 0);
    console.log(`     ${records.length} records, ${allScores.length} usable. Labs with data: ${labsWithData.join(", ")}. Skipped: ${skippedOrg} unknown orgs, ${skippedParse} parse errors. Scale: ×${scaleFactor}`);
  }

  console.log(`\n4. Upserting ${allRows.length} rows to Supabase...`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Supabase upsert supports up to ~1000 rows per call; we have ~455
  const { error } = await supabase
    .from("benchmark_scores")
    .upsert(allRows, { onConflict: "benchmark,lab,quarter" });

  if (error) {
    console.error("   Upsert FAILED:", error.message);
    process.exit(1);
  }

  console.log(`   Upserted ${allRows.length} rows successfully.`);

  // Cleanup
  try {
    fs.rmSync(tmpDir, { recursive: true });
  } catch (_) { /* ignore cleanup errors */ }

  console.log("\nDone!");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});

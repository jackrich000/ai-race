// lib/pipeline.js
// Pure functions extracted from scripts/update-data.js for reuse and testing.
// Works as a CommonJS module (Node scripts).

// ─── Org normalization ───────────────────────────────────────

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

function normalizeOrg(raw) {
  if (!raw) return null;
  const primary = raw.split(",")[0].trim().toLowerCase();
  return ORG_MAP[primary] || null;
}

// ─── Quarter helpers ─────────────────────────────────────────

function quarterEndDate(quarter) {
  const qNum = parseInt(quarter[1]);
  const year = parseInt(quarter.substring(3));
  return new Date(year, qNum * 3, 0, 23, 59, 59);
}

// ─── Date extraction from model IDs ─────────────────────────

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

// ─── Model-to-lab pattern matching ───────────────────────────

const MODEL_LAB_PATTERNS = [
  [/claude/i,        "anthropic"],
  [/gpt[-_ ]/i,     "openai"],
  [/o[134][-_ ]/i,  "openai"],
  [/gemini/i,        "google"],
  [/grok/i,          "xai"],
  [/deepseek/i,      "chinese"],
  [/qwen/i,          "chinese"],
  [/kimi/i,          "chinese"],
  [/minimax/i,       "chinese"],
  [/glm/i,           "chinese"],
  [/doubao/i,        "chinese"],
];

// ARC Prize: start-anchored version to reject third-party scaffolds
const ARC_LAB_PATTERNS = MODEL_LAB_PATTERNS.map(([re, lab]) => [
  new RegExp("^" + re.source, re.flags), lab,
]);

function arcModelIdToLab(modelId) {
  for (const [pattern, lab] of ARC_LAB_PATTERNS) {
    if (pattern.test(modelId)) return lab;
  }
  return null;
}

function modelNameToLab(modelName) {
  for (const [pattern, lab] of MODEL_LAB_PATTERNS) {
    if (pattern.test(modelName)) return lab;
  }
  return null;
}

// ─── Verified duplicate filtering ────────────────────────────

function filterVerifiedDuplicates(allPoints) {
  const verifiedPoints = allPoints.filter(p => p.verified !== false);

  return allPoints.filter(p => {
    if (p.source !== "model_card" && p.source !== "model_card_auto") return true;
    if (!p.matchVerified) return true;

    const hasVerifiedMatch = verifiedPoints.some(vp =>
      vp.benchmark === p.benchmark &&
      vp.lab === p.lab &&
      p.matchVerified.test(vp.model)
    );

    return !hasVerifiedMatch;
  });
}

// ─── Cumulative computations ─────────────────────────────────

function computeCumulativeBest(dataPoints, quarters) {
  const sorted = [...dataPoints].sort((a, b) => a.date - b.date);

  const result = {};
  let best = null;
  let dpIndex = 0;

  for (const quarter of quarters) {
    const end = quarterEndDate(quarter);

    while (dpIndex < sorted.length && sorted[dpIndex].date <= end) {
      const dp = sorted[dpIndex];
      if (!best || dp.score > best.score) {
        best = { score: dp.score, model: dp.model, source: dp.source, verified: dp.verified !== false };
      }
      dpIndex++;
    }

    result[quarter] = best ? { ...best } : null;
  }

  return result;
}

function computeCumulativeMin(dataPoints, quarters) {
  const sorted = [...dataPoints].sort((a, b) => a.date - b.date);

  const result = {};
  let best = null;
  let dpIndex = 0;

  for (const quarter of quarters) {
    const end = quarterEndDate(quarter);

    while (dpIndex < sorted.length && sorted[dpIndex].date <= end) {
      const dp = sorted[dpIndex];
      if (best === null || dp.price < best.price) {
        best = { price: dp.price, model: dp.model, lab: dp.lab, score: dp.score };
      }
      dpIndex++;
    }

    result[quarter] = best ? { ...best } : null;
  }

  return result;
}

// ─── Benchmark name normalization ────────────────────────────

const BENCHMARK_ALIASES = {
  // Exact matches (lowercased)
  "gpqa diamond":          { key: "gpqa",         confidence: "exact" },
  "gpqa":                  { key: "gpqa",         confidence: "exact" },
  "arc-agi-2":             { key: "arc-agi-2",    confidence: "exact" },
  "arc agi 2":             { key: "arc-agi-2",    confidence: "exact" },
  "arc-agi 2":             { key: "arc-agi-2",    confidence: "exact" },
  "arc-agi-1":             { key: "arc-agi-1",    confidence: "exact" },
  "arc agi 1":             { key: "arc-agi-1",    confidence: "exact" },
  "arc-agi":               { key: "arc-agi-1",    confidence: "fuzzy" },
  "hle":                   { key: "hle",          confidence: "exact" },
  "humanity's last exam":  { key: "hle",          confidence: "exact" },
  "humanitys last exam":   { key: "hle",          confidence: "exact" },
  "swe-bench verified":    { key: "swe-bench",    confidence: "exact" },
  "swebench verified":     { key: "swe-bench",    confidence: "exact" },
  "swe-bench pro":         { key: "swe-bench-pro", confidence: "exact" },
  "swe-bench pro (public)": { key: "swe-bench-pro", confidence: "exact" },
  "swebench pro":          { key: "swe-bench-pro", confidence: "exact" },
  "swe-bench":             { key: "swe-bench",    confidence: "fuzzy" },
  "aime":                  { key: "aime",         confidence: "exact" },
  "otis mock aime":        { key: "aime",         confidence: "exact" },
  "aime 2024":             { key: "aime",         confidence: "fuzzy" },
  "aime 2025":             { key: "aime",         confidence: "fuzzy" },
  "frontiermath":          { key: "frontiermath",  confidence: "exact" },
  "frontier math":         { key: "frontiermath",  confidence: "exact" },
  "math level 5":          { key: "math-l5",      confidence: "exact" },
  "math-500":              { key: "math-l5",      confidence: "fuzzy" },
  "math 500":              { key: "math-l5",      confidence: "fuzzy" },
  "humaneval":             { key: "humaneval",    confidence: "exact" },
  "human eval":            { key: "humaneval",    confidence: "exact" },
};

/**
 * Normalize a raw benchmark name to a tracked benchmark key.
 * @returns {{ key: string, confidence: "exact"|"fuzzy"|"none" }}
 */
function normalizeBenchmarkName(rawName) {
  if (!rawName) return { key: null, confidence: "none" };
  const cleaned = rawName.trim().toLowerCase()
    .replace(/[()]/g, "")
    .replace(/\s+/g, " ");

  // Direct lookup
  if (BENCHMARK_ALIASES[cleaned]) return BENCHMARK_ALIASES[cleaned];

  // Try removing trailing qualifiers like "pass@1", percentages
  const stripped = cleaned.replace(/\s*(pass@\d+|%|\(.*\))$/i, "").trim();
  if (BENCHMARK_ALIASES[stripped]) return BENCHMARK_ALIASES[stripped];

  return { key: null, confidence: "none" };
}

// ─── Score triage ────────────────────────────────────────────

/**
 * Triage an extracted score: auto-ingest, auto-reject, or flag-for-review.
 * @param {number} score - The extracted score
 * @param {number|null} currentBest - Current best score for this benchmark+lab (null if none)
 * @param {string|null} benchmarkKey - Normalized benchmark key (null = untracked)
 * @param {string} confidence - "exact", "fuzzy", or "none"
 * @param {string} [notes] - Any qualifiers from extraction
 * @returns {{ action: "ingest"|"reject"|"review", reason: string }}
 */
function triageScore(score, currentBest, benchmarkKey, confidence, notes) {
  // Auto-reject: nonsensical scores
  if (score < 0 || score > 100) {
    return { action: "reject", reason: `Score ${score} outside valid range (0-100)` };
  }

  // Auto-reject: untracked benchmark
  if (!benchmarkKey) {
    return { action: "reject", reason: "Benchmark not tracked" };
  }

  // Flag: fuzzy benchmark match
  if (confidence === "fuzzy") {
    return { action: "review", reason: `Fuzzy benchmark match for "${benchmarkKey}"` };
  }

  // Flag: suspicious harness indicators
  const notesLower = (notes || "").toLowerCase();
  const harnessFlags = ["ensemble", "multiple retries", "retry", "custom scaffold", "extended compute"];
  // "with tools" is acceptable for HLE
  if (benchmarkKey !== "hle" && notesLower.includes("with tools")) {
    harnessFlags.push("with tools");
  }
  for (const flag of harnessFlags) {
    if (notesLower.includes(flag)) {
      return { action: "review", reason: `Harness flag: "${flag}" in notes` };
    }
  }

  // Flag: >10pp above current best (absolute threshold)
  if (currentBest !== null && score > currentBest + 10) {
    return { action: "review", reason: `Score ${score} is ${(score - currentBest).toFixed(1)}pp above current best ${currentBest}` };
  }

  // Auto-ingest
  return { action: "ingest", reason: "Passed all checks" };
}

// ─── Regex generation for verified matching ─────────────────

/**
 * Auto-generate a matchVerified regex from a model name.
 * E.g., "GPT-5.4 Mini" -> /gpt.?5[\.\s-]?4.?mini/i
 * Handles version numbers (dots/dashes between digits) and whitespace/punctuation.
 */
function generateMatchVerifiedRegex(modelName) {
  // Normalize: lowercase, strip parentheticals like "(with tools)"
  const cleaned = modelName.replace(/\s*\(.*?\)\s*/g, "").trim().toLowerCase();

  // Build regex: replace separators with flexible matchers
  let pattern = "";
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (/[a-z0-9]/.test(ch)) {
      pattern += ch;
      // After a digit followed by a dot/dash/space + digit, insert flexible separator
      if (/[0-9]/.test(ch) && i + 1 < cleaned.length && /[.\-\s]/.test(cleaned[i + 1]) && i + 2 < cleaned.length && /[0-9]/.test(cleaned[i + 2])) {
        pattern += "[.\\s-]?";
        i++; // Skip the separator
      }
    } else if (/[\s.\-]/.test(ch)) {
      pattern += ".?";
    }
    // Other chars (punctuation) are skipped
  }

  return new RegExp(pattern, "i");
}

// ─── CSV column finder ───────────────────────────────────────

function findCol(headers, preferred, candidates) {
  if (preferred && headers.includes(preferred)) return preferred;
  for (const c of candidates) {
    if (headers.includes(c)) return c;
  }
  return null;
}

// ─── Module export ───────────────────────────────────────────

module.exports = {
  ORG_MAP,
  normalizeOrg,
  quarterEndDate,
  extractDateFromModelId,
  MODEL_LAB_PATTERNS,
  ARC_LAB_PATTERNS,
  arcModelIdToLab,
  modelNameToLab,
  filterVerifiedDuplicates,
  computeCumulativeBest,
  computeCumulativeMin,
  generateMatchVerifiedRegex,
  BENCHMARK_ALIASES,
  normalizeBenchmarkName,
  triageScore,
  findCol,
};

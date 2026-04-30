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

// ─── Analysis regen gate ─────────────────────────────────────

// Decides whether the weekly pipeline should regenerate cached AI analyses.
// Pure function: callers inject compareQuarters and (optionally) `now` so the
// helper stays free of new module dependencies and is trivially testable.
//
// Returns { shouldRegen, reason }. The reason is surfaced in the GitHub
// pipeline-report issue so a "skipped" decision is auditable.
//
// Implicit contract: at least one entry in expectedPresets must always have
// end_quarter == currentQuarter (rolling presets like "all-time" do). If
// every preset becomes year-only, the rollover branch silently never fires.
function shouldRegenerateAnalyses({
  changeCount,
  costChangeCount,
  cachedRows,
  expectedPresets,
  currentQuarter,
  compareQuarters,
  now = new Date(),
  maxAgeDays = 30,
}) {
  if (changeCount > 0 || costChangeCount > 0) {
    const parts = [];
    if (changeCount > 0) parts.push(`${changeCount} score change(s)`);
    if (costChangeCount > 0) parts.push(`${costChangeCount} cost change(s)`);
    return { shouldRegen: true, reason: parts.join(", ") };
  }
  if (!cachedRows || cachedRows.length === 0) {
    return { shouldRegen: true, reason: "no cached analyses found (first run or wipe)" };
  }
  const cachedKeys = new Set(cachedRows.map(r => r.date_range));
  const missing = (expectedPresets || []).filter(p => !cachedKeys.has(p));
  if (missing.length > 0) {
    return { shouldRegen: true, reason: `new preset(s) without cache: ${missing.join(", ")}` };
  }
  const maxCached = cachedRows.reduce(
    (m, r) => !m || compareQuarters(r.end_quarter, m) > 0 ? r.end_quarter : m,
    null
  );
  if (compareQuarters(maxCached, currentQuarter) !== 0) {
    return { shouldRegen: true, reason: `quarter rollover (${maxCached} → ${currentQuarter})` };
  }
  const dayMs = 24 * 60 * 60 * 1000;
  const oldest = cachedRows.reduce((min, r) => {
    const t = new Date(r.generated_at).getTime();
    return min === null || t < min ? t : min;
  }, null);
  if (oldest !== null && now.getTime() - oldest > maxAgeDays * dayMs) {
    const ageDays = Math.round((now.getTime() - oldest) / dayMs);
    return { shouldRegen: true, reason: `cached analyses ${ageDays}d old (max ${maxAgeDays}d)` };
  }
  return { shouldRegen: false, reason: "no score/cost changes, presets covered, no rollover, fresh" };
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
  findCol,
  shouldRegenerateAnalyses,
};

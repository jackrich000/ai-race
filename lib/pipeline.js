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

// ─── Variant classification ──────────────────────────────────
// Harness = different evaluation rig (tools, scaffolds, browsing).
//   Cannot be superseded by a verified standard-condition score.
// Config = same rig, different model settings (thinking effort, reasoning mode).
//   Equivalent to AA/Epoch's standard test; verified score wins.
// Default for unknown variants = config (treat as equivalent).
//
// Note: in-memory field is `variant`; SQL column is `model_variant`.
// Translation happens in fetchModelCardData (read) and update-data row builder (write).

const HARNESS_KEYWORDS = [
  "with\\s+tools?",
  "with\\s+python",
  "with\\s+search",
  "with\\s+browser",
  "with\\s+code\\s+(exec|interpreter)",
  "with\\s+harness",
  "with\\s+computer\\s+use",
  "tool\\s+use",
  "code\\s+interpreter",
  "function\\s+calling",
  "agent(ic)?(\\s+(mode|harness|scaffold))?",
  "scaffold(ing)?",
  "browsing(\\s+enabled)?",
  "internet\\s+access",
];
const HARNESS_PATTERN = new RegExp(`\\b(?:${HARNESS_KEYWORDS.join("|")})\\b`, "i");

// Acknowledged-as-config: silenced in pipeline Variant Review after Jack reviewed once.
// Add to this set to stop a variant string from showing up in the weekly report.
const ACKNOWLEDGED_CONFIG_VARIANTS = new Set([
  "xhigh", "high", "medium", "low",
  "think", "thinking",
  "speciale",
]);

function isHarnessVariant(variant) {
  if (!variant) return false;
  return HARNESS_PATTERN.test(String(variant).trim());
}

function isAcknowledgedConfigVariant(variant) {
  if (!variant) return false;
  return ACKNOWLEDGED_CONFIG_VARIANTS.has(String(variant).trim().toLowerCase());
}

function normalizeVariant(variant) {
  if (variant == null) return null;
  // Collapse unicode whitespace (incl. NBSP) to single spaces, then trim.
  const trimmed = String(variant).replace(/\s+/g, " ").trim();
  if (trimmed === "") return null;
  const lower = trimmed.toLowerCase();
  if (lower === "no tools" || lower === "without tools" || lower === "no tool" || lower === "without tool") return null;
  if (lower === "with tool" || lower === "with tools") return "with tools";
  return trimmed; // Pass-through: preserve original casing for unknown variants.
}

// Splits "(with tools)" / "(no tools)" off a model name into a separate variant.
// Returns { model, variant }. Used to clean up legacy rows where extraction baked
// the variant into the model column. Conservative pattern: only strips known
// tool-related strings to avoid eating real name parens like "(mini)" or "(Beta)".
function splitVariantFromModel(model, existingVariant) {
  if (existingVariant || !model) return { model, variant: existingVariant ?? null };
  const m = String(model).match(/^(.+?)\s*\((with\s+tools?|without\s+tools?|no\s+tools?)\)\s*$/i);
  if (!m) return { model, variant: null };
  return { model: m[1].trim(), variant: normalizeVariant(m[2]) };
}

// ─── Verified duplicate filtering ────────────────────────────

function filterVerifiedDuplicates(allPoints) {
  const verifiedPoints = allPoints.filter(p => p.verified !== false);

  return allPoints.filter(p => {
    if (p.source !== "model_card" && p.source !== "model_card_auto") return true;
    if (!p.matchVerified) return true;
    // Harness variants measure a different evaluation condition than verified
    // standard-condition scores, so never let a verified row supersede them.
    if (isHarnessVariant(p.variant)) return true;

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
      const dpVerified = dp.verified !== false;
      // Tie-break: on identical scores, prefer the verified point so AA wins
      // over a coincidentally-equal model_card claim. Stable across runs.
      const isBetter = !best
        || dp.score > best.score
        || (dp.score === best.score && dpVerified && best.verified === false);
      if (isBetter) {
        best = {
          score: dp.score,
          model: dp.model,
          source: dp.source,
          verified: dpVerified,
          variant: dp.variant ?? null,
        };
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
  HARNESS_KEYWORDS,
  HARNESS_PATTERN,
  ACKNOWLEDGED_CONFIG_VARIANTS,
  isHarnessVariant,
  isAcknowledgedConfigVariant,
  normalizeVariant,
  splitVariantFromModel,
  filterVerifiedDuplicates,
  computeCumulativeBest,
  computeCumulativeMin,
  generateMatchVerifiedRegex,
  findCol,
};

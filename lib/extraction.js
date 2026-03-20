// lib/extraction.js
// Pure extraction helpers for the model card pipeline.
// No external dependencies — operates on plain data only.
// Works as a CommonJS module (Node scripts).

// ─── Image URL extraction ─────────────────────────────────────

/**
 * Extract the raw CDN image URL from a Next.js /_next/image proxy URL.
 * If not a proxy URL, returns the original src.
 */
function extractRawImageUrl(src) {
  if (!src) return null;
  try {
    const url = new URL(src);
    // Next.js image optimization proxy pattern: /_next/image?url=...&w=...&q=...
    if (url.pathname === "/_next/image" && url.searchParams.has("url")) {
      return decodeURIComponent(url.searchParams.get("url"));
    }
    return src;
  } catch {
    return src;
  }
}

// ─── Content image filtering ──────────────────────────────────

/**
 * Filter an array of image data objects to keep only content images.
 * Removes logos, icons, SVGs, tiny images, and decorative elements.
 *
 * @param {Array<{src: string, width: number, height: number, alt: string}>} images
 * @returns {Array<{src: string, width: number, height: number, alt: string}>}
 */
function filterContentImages(images) {
  if (!images || !Array.isArray(images)) return [];

  return images.filter(img => {
    if (!img.src) return false;

    // Skip SVGs (not useful for vision extraction)
    if (/\.svg(\?|$)/i.test(img.src)) return false;

    // Skip data URIs (usually tiny inline images)
    if (img.src.startsWith("data:")) return false;

    // Skip tiny images (logos, icons, favicons)
    const minDimension = 150;
    if (img.width && img.width < minDimension) return false;
    if (img.height && img.height < minDimension) return false;

    // Skip images with logo/icon in alt text or src
    const combined = `${img.alt || ""} ${img.src}`.toLowerCase();
    if (/logo|icon|favicon|avatar|badge|arrow|caret/.test(combined)) return false;

    return true;
  });
}

// ─── Text block building ──────────────────────────────────────

/**
 * Build a structured text block from DOM section data for LLM analysis.
 * Preserves hierarchy (headings, tables, lists) and marks data types.
 *
 * @param {Array<{type: string, content: string}>} sections
 *   type is one of: "heading", "paragraph", "table", "list", "svg-chart", "other"
 * @returns {string}
 */
function buildTextBlock(sections) {
  if (!sections || !Array.isArray(sections)) return "";

  const parts = [];
  for (const section of sections) {
    if (!section.content || !section.content.trim()) continue;

    const content = section.content.trim();
    switch (section.type) {
      case "heading":
        parts.push(`\n## ${content}\n`);
        break;
      case "table":
        parts.push(`\n[TABLE]\n${content}\n[/TABLE]\n`);
        break;
      case "svg-chart":
        parts.push(`\n[CHART DATA]\n${content}\n[/CHART DATA]\n`);
        break;
      case "list":
        parts.push(`\n${content}\n`);
        break;
      default:
        parts.push(`${content}\n`);
        break;
    }
  }

  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ─── Score deduplication ──────────────────────────────────────

/**
 * Deterministic deduplication of scores from vision and text extraction.
 * Deduplicates on (benchmark lowercase, score, model_variant lowercase).
 * Vision scores take priority (listed first).
 *
 * @param {Array<{benchmark: string, score: number, model_variant?: string, notes?: string}>} visionScores
 * @param {Array<{benchmark: string, score: number, model_variant?: string, notes?: string}>} textScores
 * @returns {Array<{benchmark: string, score: number, model_variant?: string, notes?: string, source_method: string}>}
 */
function deduplicateScores(visionScores, textScores) {
  const seen = new Set();
  const result = [];

  // Vision scores first (higher priority)
  for (const s of (visionScores || [])) {
    const key = `${(s.benchmark || "").toLowerCase()}|${s.score}|${(s.model_variant || "").toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ ...s, source_method: "vision" });
    }
  }

  // Then text scores (only if not already seen)
  for (const s of (textScores || [])) {
    const key = `${(s.benchmark || "").toLowerCase()}|${s.score}|${(s.model_variant || "").toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ ...s, source_method: "text" });
    }
  }

  return result;
}

// ─── Date parsing ─────────────────────────────────────────────

const MONTH_MAP = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5,
  jul: 6, july: 6, aug: 7, august: 7, sep: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

/**
 * Parse common date formats from blog pages.
 * Handles: "17 Feb 2026", "February 17, 2026", "2026-02-17", "Feb 17, 2026"
 *
 * @param {string} dateString
 * @returns {Date|null}
 */
function parsePublishDate(dateString) {
  if (!dateString || typeof dateString !== "string") return null;
  const s = dateString.trim();

  // ISO format: 2026-02-17
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  // "17 Feb 2026" or "17 February 2026"
  const dmy = s.match(/^(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (dmy) {
    const month = MONTH_MAP[dmy[2].toLowerCase()];
    if (month !== undefined) {
      const d = new Date(parseInt(dmy[3]), month, parseInt(dmy[1]));
      return isNaN(d.getTime()) ? null : d;
    }
  }

  // "February 17, 2026" or "Feb 17, 2026"
  const mdy = s.match(/^(\w+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (mdy) {
    const month = MONTH_MAP[mdy[1].toLowerCase()];
    if (month !== undefined) {
      const d = new Date(parseInt(mdy[3]), month, parseInt(mdy[2]));
      return isNaN(d.getTime()) ? null : d;
    }
  }

  return null;
}

// ─── Benchmark name normalization ─────────────────────────────

/**
 * Benchmark name aliases. Maps various LLM-extracted names to our canonical keys.
 * Keys are lowercase, values are { key, confidence }.
 */
const BENCHMARK_ALIASES = {
  // GPQA Diamond
  "gpqa diamond":             { key: "gpqa", confidence: "exact" },
  "gpqa":                     { key: "gpqa", confidence: "fuzzy" },
  "gpqa (diamond)":           { key: "gpqa", confidence: "exact" },
  "gpqa-diamond":             { key: "gpqa", confidence: "exact" },

  // ARC-AGI-2
  "arc-agi-2":                { key: "arc-agi-2", confidence: "exact" },
  "arc-agi 2":                { key: "arc-agi-2", confidence: "exact" },
  "arc agi 2":                { key: "arc-agi-2", confidence: "exact" },
  "arcagi2":                  { key: "arc-agi-2", confidence: "exact" },
  "arc-agi-2 (semi-private)": { key: "arc-agi-2", confidence: "exact" },

  // ARC-AGI-1
  "arc-agi-1":                { key: "arc-agi-1", confidence: "exact" },
  "arc-agi 1":                { key: "arc-agi-1", confidence: "exact" },
  "arc agi 1":                { key: "arc-agi-1", confidence: "exact" },
  "arc-agi":                  { key: "arc-agi-1", confidence: "fuzzy" },
  "arcagi":                   { key: "arc-agi-1", confidence: "fuzzy" },

  // HLE (Humanity's Last Exam)
  "hle":                      { key: "hle", confidence: "exact" },
  "humanity's last exam":     { key: "hle", confidence: "exact" },
  "humanitys last exam":      { key: "hle", confidence: "exact" },
  "humanity\u2019s last exam":       { key: "hle", confidence: "exact" },

  // SWE-bench Pro
  "swe-bench pro":            { key: "swe-bench-pro", confidence: "exact" },
  "swe-bench pro (public)":   { key: "swe-bench-pro", confidence: "exact" },
  "swebench pro":             { key: "swe-bench-pro", confidence: "exact" },

  // SWE-bench Verified
  "swe-bench verified":       { key: "swe-bench", confidence: "exact" },
  "swebench verified":        { key: "swe-bench", confidence: "exact" },
  "swe-bench":                { key: "swe-bench", confidence: "fuzzy" },
  "swebench":                 { key: "swe-bench", confidence: "fuzzy" },

  // AIME
  "aime":                     { key: "aime", confidence: "fuzzy" },
  "aime 2024":                { key: "aime", confidence: "fuzzy" },
  "aime 2025":                { key: "aime", confidence: "fuzzy" },
  "otis mock aime":           { key: "aime", confidence: "exact" },
  "otis mock aime 2024-2025": { key: "aime", confidence: "exact" },

  // FrontierMath
  "frontiermath":             { key: "frontiermath", confidence: "exact" },
  "frontier math":            { key: "frontiermath", confidence: "exact" },

  // MATH Level 5
  "math level 5":             { key: "math-l5", confidence: "exact" },
  "math-l5":                  { key: "math-l5", confidence: "exact" },
  "math (level 5)":           { key: "math-l5", confidence: "exact" },
  "math level-5":             { key: "math-l5", confidence: "exact" },

  // HumanEval
  "humaneval":                { key: "humaneval", confidence: "exact" },
  "human eval":               { key: "humaneval", confidence: "exact" },
};

/**
 * Normalize a benchmark name from LLM extraction to our canonical key.
 *
 * @param {string} rawName - The benchmark name as extracted by the LLM
 * @returns {{ key: string|null, confidence: "exact"|"fuzzy"|"none" }}
 */
function normalizeBenchmarkName(rawName) {
  if (!rawName || typeof rawName !== "string") return { key: null, confidence: "none" };

  const cleaned = rawName.trim().toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[()]/g, m => m); // preserve parens for lookup

  // Direct lookup
  if (BENCHMARK_ALIASES[cleaned]) {
    return BENCHMARK_ALIASES[cleaned];
  }

  // Try without parenthetical qualifiers: "GPQA Diamond (0-shot)" -> "gpqa diamond"
  const withoutParens = cleaned.replace(/\s*\(.*?\)\s*/g, " ").trim().replace(/\s+/g, " ");
  if (withoutParens !== cleaned && BENCHMARK_ALIASES[withoutParens]) {
    return BENCHMARK_ALIASES[withoutParens];
  }

  // Try stripping trailing qualifiers: "HLE without tools" -> "hle"
  const stripQualifiers = (s) => s
    .replace(/\s+(with|without)\s+tools?\s*$/i, "")
    .replace(/\s+(pass@\d+|0-shot|few-shot|chain.of.thought|cot)\s*$/i, "")
    .trim();

  const withoutQualifiers = stripQualifiers(cleaned);
  if (withoutQualifiers !== cleaned && BENCHMARK_ALIASES[withoutQualifiers]) {
    return BENCHMARK_ALIASES[withoutQualifiers];
  }

  // Combined: strip parens AND qualifiers (e.g., "Humanity's Last Exam (HLE) without tools")
  const combined = stripQualifiers(withoutParens);
  if (combined !== cleaned && BENCHMARK_ALIASES[combined]) {
    return BENCHMARK_ALIASES[combined];
  }

  return { key: null, confidence: "none" };
}

// ─── Score triage ─────────────────────────────────────────────

/**
 * Triage an extracted score to decide: auto-ingest, flag for review, or auto-reject.
 *
 * @param {number} score - The extracted score
 * @param {number|null} currentBest - Current best score for this benchmark+lab (null if none)
 * @param {string} benchmarkKey - Canonical benchmark key (from normalizeBenchmarkName)
 * @param {"exact"|"fuzzy"|"none"} confidence - Benchmark name match confidence
 * @param {string} [notes] - Any qualifiers from extraction
 * @returns {{ action: "ingest"|"review"|"reject", reason: string }}
 */
function triageScore(score, currentBest, benchmarkKey, confidence, notes) {
  // Reject: untracked benchmark
  if (!benchmarkKey || confidence === "none") {
    return { action: "reject", reason: "untracked benchmark" };
  }

  // Flag: fuzzy benchmark match
  if (confidence === "fuzzy") {
    return { action: "review", reason: "fuzzy benchmark name match" };
  }

  // Flag: score mentions harness qualifiers that may affect comparability
  const harnessPatterns = /with tools|with code|scaffol|agent|harness/i;
  if (notes && harnessPatterns.test(notes)) {
    return { action: "review", reason: "harness qualifier detected" };
  }

  // Flag: >10pp above current best (suspiciously high)
  if (currentBest !== null && score > currentBest + 10) {
    return { action: "review", reason: `>10pp above current best (${currentBest})` };
  }

  // Auto-ingest: exact match, reasonable score
  return { action: "ingest", reason: "exact match, score within range" };
}

// ─── JSON schema for structured outputs ───────────────────────

/**
 * JSON schema for LLM structured outputs (shared by vision + text extraction).
 * Used with Anthropic's output_config feature.
 */
const SCORES_SCHEMA = {
  type: "object",
  properties: {
    description: {
      type: "string",
      description: "Brief description of what benchmark data was found",
    },
    scores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          benchmark: {
            type: "string",
            description: "Full benchmark name as written (e.g., 'GPQA Diamond', 'SWE-bench Verified')",
          },
          score: {
            type: "number",
            description: "The numeric score (percentage 0-100, or raw number for Elo-style)",
          },
          model_variant: {
            type: "string",
            description: "Specific variant if multiple tested (e.g., 'with tools', 'without tools')",
          },
          notes: {
            type: "string",
            description: "Any qualifiers: pass@1, 0-shot, with tools, etc.",
          },
        },
        required: ["benchmark", "score"],
      },
      description: "All benchmark scores found",
    },
  },
  required: ["scores"],
};

// ─── Module export ────────────────────────────────────────────

module.exports = {
  extractRawImageUrl,
  filterContentImages,
  buildTextBlock,
  deduplicateScores,
  parsePublishDate,
  normalizeBenchmarkName,
  triageScore,
  BENCHMARK_ALIASES,
  SCORES_SCHEMA,
};

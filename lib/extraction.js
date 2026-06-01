// lib/extraction.js
// Pure extraction helpers for the model card pipeline.
// Depends only on lib/config.js (the single source of truth for benchmark
// metadata, including name aliases); operates on plain data otherwise.
// Works as a CommonJS module (Node scripts).

const { BENCHMARK_META } = require("./config.js");

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

// ─── Variant normalization ────────────────────────────────────

/**
 * Normalize model_variant strings to canonical forms.
 * "no tools" → "without tools", trims whitespace, lowercases for comparison.
 */
function normalizeVariant(variant) {
  if (!variant) return "";
  let v = variant.trim().toLowerCase();
  // "no tools" and "without tools" are semantically identical
  if (v === "no tools") v = "without tools";
  return v;
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
    const key = `${(s.benchmark || "").toLowerCase()}|${s.score}|${normalizeVariant(s.model_variant)}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ ...s, source_method: "vision" });
    }
  }

  // Then text scores (only if not already seen)
  for (const s of (textScores || [])) {
    const key = `${(s.benchmark || "").toLowerCase()}|${s.score}|${normalizeVariant(s.model_variant)}`;
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
 * Built from config.js BENCHMARK_META `aliases` fields — config is the single
 * source of truth, so adding/changing a benchmark's aliases is a one-file change
 * there (this table can no longer drift from the benchmark list). Keys are the
 * normalized (lowercase, single-spaced) alias strings; values are { key, confidence }.
 *
 * The OTIS Mock AIME aliases are deliberately the only AIME forms present:
 * generic "AIME 2024"/"AIME 2025" are different competitions and must NOT match.
 */
function buildBenchmarkAliases(meta) {
  const table = {};
  for (const [key, def] of Object.entries(meta)) {
    if (!def.aliases) continue;
    for (const confidence of ["exact", "fuzzy"]) {
      for (const raw of (def.aliases[confidence] || [])) {
        const norm = raw.trim().toLowerCase().replace(/\s+/g, " ");
        table[norm] = { key, confidence };
      }
    }
  }
  return table;
}

const BENCHMARK_ALIASES = buildBenchmarkAliases(BENCHMARK_META);

/**
 * Normalize a benchmark name from LLM extraction to our canonical key.
 *
 * @param {string} rawName - The benchmark name as extracted by the LLM
 * @returns {{ key: string|null, confidence: "exact"|"fuzzy"|"none" }}
 */
function normalizeBenchmarkName(rawName) {
  if (!rawName || typeof rawName !== "string") return { key: null, confidence: "none" };

  const cleaned = rawName.trim().toLowerCase()
    .replace(/\s+/g, " ");

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
function triageScore(score, currentBest, benchmarkKey, confidence) {
  // Reject: untracked benchmark
  if (!benchmarkKey || confidence === "none") {
    return { action: "reject", reason: "untracked benchmark" };
  }

  // Flag: fuzzy benchmark match
  if (confidence === "fuzzy") {
    return { action: "review", reason: "fuzzy benchmark name match" };
  }

  // Flag: >10pp above current best (suspiciously high)
  if (currentBest !== null && score > currentBest + 10) {
    return { action: "review", reason: `>10pp above current best (${currentBest})` };
  }

  // Auto-ingest: exact match, reasonable score
  return { action: "ingest", reason: "exact match, score within range" };
}

/**
 * Cross-check scores within an article for conflicts.
 * Returns an array of { index, reason } for scores that should be upgraded to "review".
 *
 * @param {Array<{benchmark: string, score: number, model_variant?: string}>} scores
 * @returns {Array<{index: number, reason: string}>}
 */
function crossCheckScores(scores) {
  const flags = [];

  for (let i = 0; i < scores.length; i++) {
    for (let j = i + 1; j < scores.length; j++) {
      const a = scores[i];
      const b = scores[j];
      if (a.benchmark.toLowerCase() !== b.benchmark.toLowerCase()) continue;

      const aVariant = normalizeVariant(a.model_variant);
      const bVariant = normalizeVariant(b.model_variant);

      // Same benchmark + same variant + different scores
      if (aVariant === bVariant && a.score !== b.score) {
        const reason = `duplicate benchmark "${a.benchmark}" with different scores (${a.score} vs ${b.score})`;
        flags.push({ index: i, reason });
        flags.push({ index: j, reason });
      }

      // Same benchmark + same score + different variants
      if (a.score === b.score && aVariant !== bVariant) {
        const reason = `duplicate score ${a.score} for "${a.benchmark}" with different variants ("${a.model_variant || "none"}" vs "${b.model_variant || "none"}")`;
        flags.push({ index: i, reason });
        flags.push({ index: j, reason });
      }
    }
  }

  // Deduplicate by index (a score might be flagged multiple times)
  const seen = new Set();
  return flags.filter(f => {
    if (seen.has(f.index)) return false;
    seen.add(f.index);
    return true;
  });
}

// ─── Hugging Face Hub helpers ─────────────────────────────────

/**
 * Filter the raw /api/models?author=... response down to candidate model cards.
 * Pure function: takes the API JSON and a `now` reference, returns a sorted array.
 *
 * Filters:
 *   - lastModified within `windowMs` of `now` (catches stub READMEs filled in later)
 *   - pipeline_tag in allowed set (skips TTS, image-feature-extraction, encoders, etc.)
 *   - id local part does not match the suffix-exclude regex (Base/FP8/AWQ/GPTQ/...)
 *   - tags do not include `base_model:quantized:` (HF's own derivative-quantization marker)
 *
 * NOTE on tag-based quantization filtering: we deliberately do NOT exclude on bare
 * tags like `fp8`/`gptq`/`awq`. DeepSeek V4 and MiniMax M2.7 are natively trained
 * in fp8 — those tags appear on the flagship, not just on derivative quants. The
 * `-FP8`/`-AWQ`/etc. suffix on the repo ID is a more reliable signal for derivative
 * repos, and `base_model:quantized:` is how HF surfaces actual lineage.
 *
 * Sort: newest createdAt first (deterministic given API result is stable).
 */
const HF_DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const HF_DEFAULT_PIPELINE_TAGS = new Set(["text-generation", "image-text-to-text"]);
const HF_DEFAULT_SUFFIX_EXCLUDE = /-(Base|FP8|AWQ|GPTQ|Int4|Int8|GGUF)$/i;
const HF_DEFAULT_DERIVATIVE_TAG_PREFIX = "base_model:quantized:";

function filterHfModels(models, opts = {}) {
  if (!Array.isArray(models)) return [];
  const {
    now = new Date(),
    windowMs = HF_DEFAULT_WINDOW_MS,
    allowedPipelineTags = HF_DEFAULT_PIPELINE_TAGS,
    suffixExclude = HF_DEFAULT_SUFFIX_EXCLUDE,
    derivativeTagPrefix = HF_DEFAULT_DERIVATIVE_TAG_PREFIX,
    limit = 20,
  } = opts;

  const cutoffMs = now.getTime() - windowMs;

  const kept = [];
  for (const m of models) {
    if (!m || typeof m !== "object" || !m.id) continue;
    if (!m.lastModified || !m.createdAt) continue;
    const lastModMs = new Date(m.lastModified).getTime();
    if (Number.isNaN(lastModMs) || lastModMs < cutoffMs) continue;
    if (!allowedPipelineTags.has(m.pipeline_tag)) continue;
    const localName = String(m.id).split("/")[1] || String(m.id);
    if (suffixExclude.test(localName)) continue;
    const tags = Array.isArray(m.tags) ? m.tags.map(t => String(t).toLowerCase()) : [];
    if (tags.some(t => t.startsWith(derivativeTagPrefix))) continue;
    kept.push(m);
  }

  // Sort newest createdAt first for deterministic ordering across runs.
  kept.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return kept.slice(0, limit);
}

/**
 * Parse a HF README markdown blob for image references (markdown + HTML img tags).
 * Resolves relative paths to HF's resolve URL pattern. Skips .svg, .gif, .webp.
 *
 * @param {string} markdown
 * @param {string} hfModelId — e.g., "deepseek-ai/DeepSeek-V4-Pro"
 * @param {string} branch — sha or branch name (e.g., "main")
 * @returns {string[]} absolute image URLs, deduplicated
 */
function parseHfReadmeImages(markdown, hfModelId, branch) {
  if (!markdown || typeof markdown !== "string") return [];
  if (!hfModelId || !branch) return [];

  const seen = new Set();
  const out = [];

  const tryAdd = (raw) => {
    if (!raw || typeof raw !== "string") return;
    const trimmed = raw.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);

    let abs;
    if (/^https?:\/\//i.test(trimmed)) {
      abs = trimmed;
    } else if (trimmed.startsWith("data:") || trimmed.startsWith("#")) {
      return;
    } else {
      const cleaned = trimmed.replace(/^\.\//, "").replace(/^\//, "");
      abs = `https://huggingface.co/${hfModelId}/resolve/${branch}/${cleaned}`;
    }
    if (/\.(svg|gif|webp)(\?|#|$)/i.test(abs)) return;
    out.push(abs);
  };

  // Markdown image syntax: ![alt](url) or ![alt](url "title")
  const mdImg = /!\[[^\]]*\]\(([^)\s]+)/g;
  let m;
  while ((m = mdImg.exec(markdown)) !== null) tryAdd(m[1]);

  // HTML <img src="..."> — common inside <p align="center"> wrappers in HF READMEs
  const htmlImg = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
  while ((m = htmlImg.exec(markdown)) !== null) tryAdd(m[1]);

  return out;
}

// ─── JSON schema for structured outputs ───────────────────────

/**
 * JSON schema for LLM structured outputs (shared by vision + text extraction).
 * Used with Anthropic's output_config feature.
 */
const SCORES_SCHEMA = {
  type: "object",
  properties: {
    scores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          benchmark: {
            type: "string",
            description: "The specific benchmark name (e.g., 'HLE', 'MMMU-Pro', 'SWE-bench Verified'). Do not include evaluation qualifiers here.",
          },
          score: {
            type: "number",
            description: "The exact numeric score as printed, without % sign (e.g., 79.6 not '79.6%')",
          },
          model_variant: {
            type: "string",
            description: "Evaluation qualifier if any (e.g., 'with tools', 'without tools', 'max effort'). Omit if none.",
          },
          notes: {
            type: "string",
            description: "Two parts: (1) Where this score appears (e.g., 'main benchmark table', 'footnote', 'body text'). (2) Any testing conditions or harness details (e.g., 'pass@1', '0-shot', 'with prompt modification'). Do not include capability category labels (e.g., 'Agentic coding', 'Visual reasoning') — these describe what the benchmark tests, not how the model was evaluated.",
          },
        },
        required: ["benchmark"],
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
  crossCheckScores,
  normalizeVariant,
  filterHfModels,
  parseHfReadmeImages,
  BENCHMARK_ALIASES,
  SCORES_SCHEMA,
};

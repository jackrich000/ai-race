// lib/llm-extract.js
// LLM interaction layer for model card extraction.
// Each function makes exactly one Anthropic API call.
// Caller handles parallelism and error recovery.
// Works as a CommonJS module (Node scripts).

const { SCORES_SCHEMA } = require("./extraction.js");

// ─── Structured output tool definition ───────────────────────

const EXTRACT_SCORES_TOOL = {
  name: "extract_scores",
  description: "Record the benchmark scores extracted from the content.",
  input_schema: SCORES_SCHEMA,
};

// ─── Response parsing helper ─────────────────────────────────

/**
 * Parse scores from a structured output (tool_use) response.
 * Falls back to text parsing if no tool_use block found.
 */
function parseStructuredResponse(response) {
  const toolBlock = response.content.find(b => b.type === "tool_use" && b.name === "extract_scores");
  if (toolBlock) {
    return (toolBlock.input.scores || []).filter(s => s.score != null);
  }
  return [];
}

/**
 * Extract and parse JSON from an LLM response that may contain markdown fences or prose.
 * Used by classifyArticles which doesn't use structured outputs.
 */
function parseJsonResponse(text) {
  // Strip markdown code fences
  let cleaned = text.replace(/^```json\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();

  // If it doesn't start with {, try to find a JSON object in the text
  if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
    const match = cleaned.match(/\{[\s\S]*"scores"[\s\S]*\}/);
    if (match) cleaned = match[0];
  }

  return JSON.parse(cleaned);
}

// ─── Vision extraction ────────────────────────────────────────

/**
 * Extract benchmark scores from an image using Claude Vision.
 * Uses structured outputs (tool use) for guaranteed valid JSON.
 * Temperature 0 for deterministic output.
 *
 * @param {import("@anthropic-ai/sdk").default} anthropic - Anthropic SDK client
 * @param {Object} opts
 * @param {string} opts.base64Data - Base64-encoded image data
 * @param {string} opts.mediaType - MIME type (e.g., "image/png", "image/jpeg")
 * @param {string} opts.modelName - The model name to extract scores for
 * @returns {Promise<Array<{benchmark: string, score: number, model_variant?: string, notes?: string}>>}
 */
async function extractScoresFromImage(anthropic, { base64Data, mediaType, modelName }) {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    temperature: 0,
    system: "You extract benchmark scores from images of AI model announcements.",
    tools: [EXTRACT_SCORES_TOOL],
    tool_choice: { type: "tool", name: "extract_scores" },
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: mediaType, data: base64Data },
        },
        {
          type: "text",
          text: `Extract benchmark scores for "${modelName}" from this image.

STEP 1: Does this image contain benchmark scores with explicitly printed numeric values?
  - If YES (table, labeled chart, scored list, etc.) → proceed
  - If NO (chart without numeric labels, decorative image, diagram, photo) → return no scores

STEP 2: Find the column, section, bar, or line for "${modelName}".

STEP 3: For each benchmark score found, extract it as a separate entry.

RULES:
- ONLY extract scores for "${modelName}". Ignore other models entirely.
- NEVER estimate values from visual position (bar heights, line endpoints, axis interpolation). Only extract numbers explicitly printed as text.
- Report exact numbers as written. Do not round.
- Extract the specific benchmark name, as written (e.g., "Humanity's Last Exam", "SWE-bench Verified", "MMMU-Pro"). Ignore labels that describe what capability the benchmark tests (e.g., "Multidisciplinary reasoning", "Agentic coding").
- If evaluation qualifiers like "with tools", "without tools", "max effort" appear — whether as part of the benchmark name, as sub-row labels, or alongside the score — extract each variant as a separate entry. Put the base benchmark name in benchmark and the qualifier in model_variant. Note, benchmark sub-categories that describe which specific test was run (e.g., "Retail", "Telecom") should be kept in the benchmark name — even though these are often displayed similarly to evaluation qualifiers.
- Do NOT extract scores from customer quotes or testimonials.`,
        },
      ],
    }],
  });

  return parseStructuredResponse(response);
}

// ─── Text extraction ──────────────────────────────────────────

/**
 * Extract benchmark scores from structured text content using Claude.
 * Uses structured outputs (tool use) for guaranteed valid JSON.
 * Temperature 0 for deterministic output.
 *
 * @param {import("@anthropic-ai/sdk").default} anthropic - Anthropic SDK client
 * @param {Object} opts
 * @param {string} opts.textContent - Structured text from buildTextBlock()
 * @param {string} opts.modelName - The model name to extract scores for
 * @returns {Promise<Array<{benchmark: string, score: number, model_variant?: string, notes?: string}>>}
 */
async function extractScoresFromText(anthropic, { textContent, modelName }) {
  if (!textContent || textContent.trim().length < 50) return [];

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    temperature: 0,
    system: "You extract benchmark scores from text content of AI model announcements.",
    tools: [EXTRACT_SCORES_TOOL],
    tool_choice: { type: "tool", name: "extract_scores" },
    messages: [{
      role: "user",
      content: `Extract all benchmark scores for "${modelName}" from this text content.

RULES:
- ONLY extract scores for "${modelName}". Ignore other models entirely.
- NEVER estimate values from visual position (bar heights, line endpoints, axis interpolation). Only extract numbers explicitly printed as text.
- If a benchmark is mentioned without an explicit score provided, DO NOT include it in the results. Only include entries where you can fill in an actual score from the text.
- Report exact numbers as written. Do not round.
- Extract the specific benchmark name, as written (e.g., "Humanity's Last Exam", "SWE-bench Verified", "MMMU-Pro"). Ignore labels that describe what capability the benchmark tests (e.g., "Multidisciplinary reasoning", "Agentic coding").
- If evaluation qualifiers like "with tools", "without tools", "max effort" appear — whether as part of the benchmark name, as sub-row labels, or alongside the score — extract each variant as a separate entry. Put the base benchmark name in benchmark and the qualifier in model_variant. Note, benchmark sub-categories that describe which specific test was run (e.g., "Retail", "Telecom") should be kept in the benchmark name — even though these are often displayed similarly to evaluation qualifiers.
- Extract EVERY instance of a score, even if the same benchmark appears multiple times with different values. Do not deduplicate.
- Do NOT extract scores from customer quotes or testimonials.

TEXT CONTENT:
${textContent}`,
    }],
  });

  return parseStructuredResponse(response);
}

// ─── Variant review ──────────────────────────────────────────

const VARIANT_REVIEW_TOOL = {
  name: "review_scores",
  description: "Review extracted benchmark scores for quality and conflicts.",
  input_schema: {
    type: "object",
    properties: {
      decisions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "number", description: "Zero-based index of the score in the input list" },
            action: { type: "string", enum: ["ingest", "reject", "flag"], description: "ingest = auto-accept, reject = auto-reject (not the official score), flag = needs human review" },
            reason: { type: "string", description: "Why this action was chosen" },
          },
          required: ["index", "action", "reason"],
        },
        description: "Only include scores that should be rejected or flagged. Scores not listed are auto-ingested.",
      },
    },
    required: ["decisions"],
  },
};

/**
 * Review all extracted scores for an article. Handles two jobs:
 * 1. Flag scores with unusual evaluation conditions (abnormal variants)
 * 2. Resolve conflicts when the same benchmark appears multiple times
 *    (using page position and variant info to identify the official score)
 *
 * One LLM call per article. Returns decisions for scores that should be
 * rejected or flagged — unlisted scores are auto-ingested.
 *
 * @param {import("@anthropic-ai/sdk").default} anthropic - Anthropic SDK client
 * @param {Array<{benchmark: string, score: number, model_variant?: string, notes?: string}>} scores
 * @param {string} modelName - The model being evaluated
 * @returns {Promise<Array<{index: number, action: "reject"|"flag", reason: string}>>}
 */
async function reviewVariants(anthropic, scores, modelName) {
  if (!scores || scores.length === 0) return [];

  const scoreList = scores.map((s, i) =>
    `${i}. ${s.benchmark}: ${s.score}${s.model_variant ? ` [variant: ${s.model_variant}]` : ""}${s.notes ? ` [notes: ${s.notes}]` : ""}`
  ).join("\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    temperature: 0,
    system: "You review AI benchmark scores for quality, conflicts, and unusual evaluation conditions.",
    tools: [VARIANT_REVIEW_TOOL],
    tool_choice: { type: "tool", name: "review_scores" },
    messages: [{
      role: "user",
      content: `Review these benchmark scores for "${modelName}". You have two jobs:

JOB 1 — RESOLVE CONFLICTS:
When the same benchmark appears multiple times with different scores, determine which is the official score. Use these signals:
- Scores from the "main benchmark table" are official; scores from "footnotes" or "body text" are secondary
- Scores with non-standard evaluation setups (e.g., "with prompt modification") are secondary
- The official score should be INGESTED (omit from your response). The secondary score should be REJECTED with a clear reason.
- If you cannot confidently determine which is official, FLAG both for human review.

JOB 2 — FLAG ABNORMAL VARIANTS:
Flag scores where the evaluation setup is unusual, making the score not directly comparable.

NORMAL evaluation setups (do NOT flag):
- "with tools", "without tools", "No tools" — standard harness options
- "high", "max", "xhigh" — standard reasoning effort levels
- High thinking budgets (e.g., "120k thinking budget") — just more compute, standard setup
- No variant specified — default evaluation

ABNORMAL evaluation setups (FLAG or REJECT):
- "with prompt modification", "custom scaffold", "enhanced prompting" — non-standard evaluation
- Any setup that suggests the score was achieved under non-standard conditions

Only include scores in your response that should be REJECTED or FLAGGED.
Scores you do not mention will be auto-ingested.

SCORES:
${scoreList}`,
    }],
  });

  const toolBlock = response.content.find(b => b.type === "tool_use" && b.name === "review_scores");
  if (toolBlock) {
    return (toolBlock.input.decisions || []).filter(d => d.action === "reject" || d.action === "flag");
  }
  return [];
}

// ─── Article classification ───────────────────────────────────

/**
 * Classify blog articles as model release announcements.
 * Uses Haiku for cheap, fast classification.
 * Biased toward over-classification (false positives are cheap; false negatives miss data).
 *
 * @param {import("@anthropic-ai/sdk").default} anthropic - Anthropic SDK client
 * @param {Array<{title: string, url: string}>} articles - Articles to classify
 * @returns {Promise<Array<{index: number, is_model_release: boolean, model_name: string|null}>>}
 */
async function classifyArticles(anthropic, articles) {
  if (!articles || articles.length === 0) return [];

  const prompt = `You are classifying blog post titles from AI labs. For each title, decide if it is likely about a NEW AI MODEL RELEASE that would include benchmark scores.

Be GENEROUS with classification — include borderline cases. It's better to check a page that turns out to have no scores than to miss a model release entirely.

Include as model releases:
- New model announcements ("Introducing GPT-5.4", "Claude Sonnet 4.6")
- Model updates with performance improvements
- System cards or technical reports for new models
- Posts saying a model is "now available in the API"
- Research posts announcing new model capabilities with benchmarks

Exclude:
- Product feature announcements (new UI, API features, integrations)
- Safety/policy posts without new models
- Company news (hiring, partnerships, funding)
- Tutorial/guide posts

Respond with ONLY this JSON format:
{"results": [{"index": 0, "is_model_release": true, "model_name": "Model Name or null"}]}

Titles:
${articles.map((a, i) => `${i}. "${a.title}" (${a.url})`).join("\n")}`;

  const resp = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    temperature: 0,
    messages: [{ role: "user", content: prompt }],
  });

  const text = resp.content.filter(b => b.type === "text").map(b => b.text).join("");
  try {
    return parseJsonResponse(text).results || [];
  } catch {
    console.warn("   Failed to parse article classification response");
    return [];
  }
}

// ─── Module export ────────────────────────────────────────────

module.exports = {
  extractScoresFromImage,
  extractScoresFromText,
  classifyArticles,
  reviewVariants,
};

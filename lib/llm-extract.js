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

// ─── HF model card markdown extraction ───────────────────────
// HF READMEs differ from blog posts:
//   1. They almost always include comparison tables with multiple model columns.
//      The standard text prompt's "extract scores for X" instruction is not
//      enough — the LLM has no spatial cues in markdown to identify which
//      column is the target model. Forcing it to echo back the column header
//      lets us add a programmatic guard against off-by-one column errors.
//   2. Same-family-different-version is the most common hallucination pattern
//      (e.g. a GLM-4.7 README referencing GLM-4.6 in a comparison row).
//      Token-overlap heuristics cannot catch this — only the prompt can.

const HF_EXTRACT_TOOL = {
  name: "extract_hf_scores",
  description: "Record benchmark scores from a Hugging Face model card README.",
  input_schema: {
    type: "object",
    properties: {
      scores: {
        type: "array",
        items: {
          type: "object",
          properties: {
            benchmark: { type: "string", description: "Specific benchmark name as written (e.g., 'GPQA Diamond', 'SWE-bench Verified', 'HLE'). Do NOT include qualifiers." },
            score: { type: "number", description: "Exact numeric score, no % sign." },
            model_variant: { type: "string", description: "Evaluation qualifier if any (e.g., 'with tools', 'thinking', 'OpenHands'). Omit if none." },
            column_header: { type: "string", description: "If the score came from a comparison table, the exact text of the column header it was in. Omit if the score was in prose or in a single-model table." },
            row_label: { type: "string", description: "If the score came from a table, the row label (usually the benchmark name). Omit if prose." },
            table_caption: { type: "string", description: "If the score came from a table, any caption or heading directly above it. Omit if none." },
            notes: { type: "string", description: "Where in the document the score appeared (e.g., 'main eval table', 'agentic capabilities section'). Optional." },
          },
          required: ["benchmark", "score"],
        },
      },
    },
    required: ["scores"],
  },
};

/**
 * Extract benchmark scores from HF model card README markdown.
 * Uses a HF-specific prompt that forces the LLM to identify the model column
 * in comparison tables, plus explicit handling of same-family-different-version
 * cases. Caller should run extractColumnHeaderGuard() on the result.
 *
 * @param {import("@anthropic-ai/sdk").default} anthropic
 * @param {Object} opts
 * @param {string} opts.markdown - Raw README markdown
 * @param {string} opts.modelName - Target model (e.g., "MiniMax-M2.7")
 * @returns {Promise<Array>} scores
 */
async function extractScoresFromHfMarkdown(anthropic, { markdown, modelName }) {
  if (!markdown || markdown.trim().length < 50) return [];

  // Cap markdown size to control token spend on huge READMEs.
  // 60kB ≈ ~15k tokens, comfortable for sonnet's 4k output budget.
  const CAP = 60_000;
  const text = markdown.length > CAP
    ? markdown.substring(0, CAP) + "\n\n[... README truncated for length ...]"
    : markdown;

  // 16K output budget: DeepSeek V4 READMEs emit ~80 scores across 3 eval tables,
  // each carrying ~200 tokens of structured fields. 4K silently truncates the tool
  // call mid-stream and the SDK returns the empty input — ie. zero scores extracted.
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 16384,
    temperature: 0,
    system: "You extract benchmark scores from Hugging Face model card READMEs (markdown).",
    tools: [HF_EXTRACT_TOOL],
    tool_choice: { type: "tool", name: "extract_hf_scores" },
    messages: [{
      role: "user",
      content: `Extract every benchmark score that applies to "${modelName}" from this Hugging Face model card README. The README is FOR "${modelName}", so any score described as the model's own performance is in scope.

The "${modelName}" column in comparison tables may appear under any of these forms — extract scores under all of them:
- The exact name
- An abbreviation: "DS-V4-Pro" for "DeepSeek-V4-Pro", "K2.6" for "Kimi-K2.6", "M2.7" for "MiniMax-M2.7", "GLM-5.1" for "GLM-5.1"
- With a reasoning-mode suffix attached: "${modelName} Max", "${modelName} High", "${modelName} Non-Think", "${modelName} Thinking", "DS-V4-Pro Max", "K2.6 Thinking", etc. Put the mode in model_variant. If the README explicitly says "Pro-Max is the maximum reasoning mode of Pro", treat "Pro-Max" columns as the target model with model_variant="Max".
- With "with tools" / "without tools" / "with python" qualifiers — same idea, put the qualifier in model_variant.

DO NOT extract from columns for:
- OTHER labs (Opus, GPT, Gemini, Claude, etc.).
- SIBLING MODELS from the same lab — e.g. if target is "DeepSeek-V4-Pro", skip "V4-Flash"; if target is "GLM-5.1", skip "GLM-4.6"; if target is "Kimi-K2.6", skip "Kimi-K2.5".
- BASE / PRETRAINING CHECKPOINTS — any column ending in "-Base" or labeled "Base" is a pre-instruction-tuning checkpoint, NOT the target model. Skip these. Example: if target is "DeepSeek-V4-Pro", skip "DeepSeek-V4-Pro-Base" columns. The base model has its own benchmarks measured under different conditions and is not comparable to the instructed model.

If you're unsure whether a column refers to the target (e.g. "DS-V4-Pro Max" — abbreviation + reasoning mode), prefer to include it (with column_header populated) — the downstream guard will drop misidentified columns.

For each score in a table, populate column_header with the exact column header text you read. For scores in prose (e.g. "achieved 56.22% on SWE-Pro"), omit column_header.

OTHER RULES:
- Report exact numbers (no rounding, no % sign).
- Extract the benchmark name as written ("GPQA Diamond", "SWE-bench Verified"). Do NOT include capability descriptors ("Agentic Reasoning", "Coding").
- If a row presents multiple variants for ${modelName} ("Non-Think" / "Thinking" / "Max" / "with tools"), extract each as a separate score with the variant in model_variant.
- If the evaluation uses a third-party scaffold or harness ("OpenHands", "WebExplorer", "Trae", "Aider"), put that in model_variant.
- If a cell is "N/A", "—", "-", "TBD", or empty, do NOT extract it.
- DO NOT extract scores from quotes or testimonials.
- Extract from prose with marketing-style language ("achieved X on Benchmark Y") just like from tables.

OUTPUT for each score:
- benchmark, score (required)
- model_variant, column_header, row_label, table_caption, notes (optional but include when applicable)

README MARKDOWN:
${text}`,
    }],
  });

  const toolBlock = response.content.find(b => b.type === "tool_use" && b.name === "extract_hf_scores");
  if (!toolBlock) return [];
  return (toolBlock.input.scores || []).filter(s => s.score != null && s.benchmark);
}

/**
 * Programmatic backstop for the column-header check enforced in the prompt.
 * Drops scores where column_header is present but doesn't fuzzy-match modelName.
 * Scores without column_header (prose extractions) pass through unchanged.
 *
 * Fuzzy match: case-insensitive token comparison after stripping known suffix
 * variants (-Base, -Pro, -Flash, -Max, -Instruct, -Mini, -Lite, -Air) and
 * non-alphanumerics. A column header passes if it shares at least one
 * 3+-char token with the modelName, after suffix stripping.
 *
 * Note: the same-family-different-version case (e.g., GLM-4.6 vs GLM-4.7) is
 * the prompt's responsibility — token overlap cannot distinguish them.
 *
 * @param {Array} scores - Output from extractScoresFromHfMarkdown
 * @param {string} modelName - Target model
 * @returns {{ kept: Array, dropped: Array }}
 */
function columnHeaderGuard(scores, modelName) {
  // Tokens: split on separators, drop tier-suffix words, drop pure-numeric
  // (so "M2.7" → ["m2"], "Kimi-K2.6" → ["kimi", "k2"]). Pure-numeric tokens
  // are dropped because version digits alone can collide spuriously across
  // unrelated models. We keep tokens of length 2+ that contain at least one
  // letter — this catches "m2", "k2", "v4", "glm" and other short version IDs.
  const tokenize = (s) => {
    if (!s || typeof s !== "string") return [];
    return s.toLowerCase()
      .replace(/[\-_/.()]/g, " ")
      .replace(/\b(base|pro|flash|max|instruct|mini|lite|air|preview|exp)\b/g, " ")
      .split(/\s+/)
      .filter(t => t.length >= 2 && /[a-z]/.test(t));
  };

  const targetTokens = new Set(tokenize(modelName));
  // Base-checkpoint columns: drop unless the target itself is a Base model.
  // The prompt instructs the LLM to skip these but it isn't 100% reliable on
  // multi-table READMEs (e.g. DeepSeek V4-Flash README where the Base column
  // sits alongside the instructed model's mode columns).
  const targetIsBase = /-base\b/i.test(modelName || "");
  const baseColumnRegex = /(^|\b|[\-_\s])base($|\b|[\-_\s])/i;

  if (targetTokens.size === 0) return { kept: scores, dropped: [] };

  const kept = [];
  const dropped = [];

  for (const s of scores) {
    if (!s.column_header) {
      kept.push(s);
      continue;
    }

    if (!targetIsBase && baseColumnRegex.test(s.column_header)) {
      dropped.push({
        ...s,
        _dropReason: `column_header "${s.column_header}" is a -Base checkpoint, target "${modelName}" is the instructed model`,
      });
      continue;
    }

    const headerTokens = tokenize(s.column_header);
    const hasOverlap = headerTokens.some(t => targetTokens.has(t));
    if (hasOverlap) {
      kept.push(s);
    } else {
      dropped.push({
        ...s,
        _dropReason: `column_header "${s.column_header}" shares no token with modelName "${modelName}"`,
      });
    }
  }

  return { kept, dropped };
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

For model_name, capture the COMPLETE model name including any size/tier qualifier exactly as written (Flash, Pro, mini, Nano, Air, Max, Ultra, Opus, Sonnet, Haiku, etc.). Never shorten to the family name (e.g. keep "Gemini 3.5 Flash", not "Gemini 3.5").

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
  extractScoresFromHfMarkdown,
  columnHeaderGuard,
  classifyArticles,
  reviewVariants,
};

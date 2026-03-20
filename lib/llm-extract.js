// lib/llm-extract.js
// LLM interaction layer for model card extraction.
// Each function makes exactly one Anthropic API call.
// Caller handles parallelism and error recovery.
// Works as a CommonJS module (Node scripts).

// ─── JSON parsing helper ──────────────────────────────────────

/**
 * Extract and parse JSON from an LLM response that may contain markdown fences or prose.
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
 * Temperature 0 for deterministic output. JSON-only system prompt.
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
    system: "You extract benchmark scores from images of tables, charts, and figures. Always respond with valid JSON only. No explanations, no markdown fences.",
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

STEP 1: List all column headers you can see (left to right).
STEP 2: Identify which column belongs to "${modelName}".
STEP 3: For each row, read the score from the "${modelName}" column ONLY.

RULES:
- ONLY extract scores for "${modelName}". Ignore all other models.
- Only extract scores with explicit numeric values. Do NOT estimate from bar/chart heights.
- Report exact numbers as written. Do not round.
- If variants exist (e.g., "with tools" / "without tools"), extract both as separate entries.
- Use the benchmark name exactly as shown in the row label. Prefer specific subtitles (e.g., "SWE-bench Verified") over general labels.

Respond with ONLY this JSON format, nothing else:
{"scores": [{"benchmark": "...", "score": <number>, "model_variant": "...", "notes": "..."}]}

If no scores are found for "${modelName}", respond with: {"scores": []}`,
        },
      ],
    }],
  });

  const text = response.content.filter(b => b.type === "text").map(b => b.text).join("");
  try {
    const parsed = parseJsonResponse(text);
    return (parsed.scores || []).filter(s => s.score != null);
  } catch {
    return [];
  }
}

// ─── Text extraction ──────────────────────────────────────────

/**
 * Extract benchmark scores from structured text content using Claude.
 * Temperature 0 for deterministic output. JSON-only system prompt.
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
    system: "You extract benchmark scores from text content of AI model announcements. Always respond with valid JSON only. No explanations, no markdown fences.",
    messages: [{
      role: "user",
      content: `Extract all benchmark scores for "${modelName}" from this text content.

RULES:
- ONLY extract scores for "${modelName}". Ignore scores for other models.
- Only extract scores that are explicitly stated as numbers. Do NOT infer or calculate.
- If a score appears multiple times (e.g., in a summary AND in detail), use the most specific version.
- Include exact qualifiers: "with tools", "without tools", "pass@1", "0-shot", etc.
- Use the full benchmark name as written (e.g., "GPQA Diamond", not just "GPQA").

Respond with ONLY this JSON format, nothing else:
{"scores": [{"benchmark": "...", "score": <number>, "model_variant": "...", "notes": "..."}]}

If no scores are found, respond with: {"scores": []}

TEXT CONTENT:
${textContent}`,
    }],
  });

  const text = response.content.filter(b => b.type === "text").map(b => b.text).join("");
  try {
    const parsed = parseJsonResponse(text);
    return (parsed.scores || []).filter(s => s.score != null);
  } catch {
    return [];
  }
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
};

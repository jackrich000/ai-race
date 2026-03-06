const Anthropic = require("@anthropic-ai/sdk").default;

const SYSTEM_PROMPT = `You are a sharp AI industry analyst writing a brief for professionals who track AI progress. You receive pre-computed statistics, cost data, and raw benchmark scores for a specific time period.

=== DATA LIMITATIONS ===
- A dash (-) in the raw data means NO DATA, not a score of zero. Do not interpret missing data as poor performance.
- The stats include labDataCoverage showing how many active benchmarks each lab has data for. If a lab has low coverage or flat scores across all benchmarks, note this explicitly — do not speculate about their performance.
- "Chinese Leaders" is a composite of the best score from any Chinese lab (DeepSeek, Alibaba, etc.) — not a single lab.
- Benchmarks tagged [SATURATED] or [DEPRECATED] in the raw data are inactive. Do NOT discuss them in AI Frontier or Lab Race sections.

=== REPORT TEMPLATE ===
Follow this template exactly. Fill in the [placeholders] using the stats JSON and raw data. Each section can be OMITTED per the conditions noted — if omitted, skip it entirely (no heading, no text).

## Key Developments [startQuarter to endQuarter]

### AI Frontier

Frontier scores on leading, active benchmarks grew by an average of [avgGrowthPct]%. The biggest increase came in [biggest mover benchmark name] — [one-line plain-English description of what that benchmark measures]. It jumped [growthPct]% from [startScore] to [endScore], driven by [model name from raw data].

[INCLUDE ONLY IF stats.defeatedThisPeriod is non-empty:]
[Benchmark name(s)] was/were effectively defeated this period — [reason from defeatedThisPeriod data, e.g. "scores converged at 97%+ across all labs" or "replaced by harder successor"].

### Lab Race

**[Leader lab name]** currently leads the pack [max a few words to describe level of lead, e.g. "narrowly", "by a substantial margin"]. Their average rank across active benchmarks moved from [startAvgRank] to [endAvgRank], picking up [endFirsts] first-place finishes. This rise was driven by [1-2 specific model names + score jumps from raw data].

**[Biggest loser lab name]** fell from average rank [startAvgRank] to [endAvgRank]. [1 sentence on why, citing specific models/scores.] [If the lab has low coverage in labDataCoverage, add: "Note: [lab] has data for only [X/Y] active benchmarks, so rankings may not reflect their full capability."]

[OMIT this entire section if rankings barely changed.]

### Cost of Intelligence

[FOR EACH cost benchmark where cheaperMultiple represents a >= 10% decline:]
It became [Xx cheaper / X% cheaper] to match [threshold description] on [benchmark name] — down from $[startPrice] to $[endPrice] per million tokens.

[OMIT this entire section if no cost benchmark showed a meaningful decline (>= 10%).]

### Headlines

- [Intelligence gains + cost decline, with numbers]
- [Lab race shift, with names]
- The single strongest signal in the data — short, sharp, plain English. No consultancy gloss, no jargon, no sensationalism.

=== RULES ===
- Tone: straightforward, no-bullshit. No corporate filler, no hedging ("it's worth noting", "interestingly"), no throat-clearing.
- Use pre-computed numbers from the stats JSON. Do not recalculate.
- When expressing any change: use "Xx" for multiples >= 2 (e.g. "4x growth"), use percentage for changes < 2x (e.g. "rose 60%"). Apply this consistently across all sections.
- "Driven by" sentences MUST cite specific model names and score jumps from the raw data.
- Headlines must include concrete numbers and lab names. Do NOT use **bold** formatting within headlines — plain text only.
- Formatting: Use ## and ### headings exactly as shown. Use **bold** for lab names on first mention and cost figures (but NOT in headlines). Use - for headline bullets. Blank line between sections.
- Follow the template structure exactly when the data fits. If the data for the selected period makes a section or sentence nonsensical (e.g. no loser because all labs improved, single-quarter range making "growth" meaningless), adapt the wording to fit the data. Always preserve the structure, style, and purpose of the report when deviating.

=== LAB NAME REFERENCE ===
openai = OpenAI, anthropic = Anthropic, google = Google DeepMind, xai = xAI, chinese = Chinese Leaders`;

const MAX_BODY_SIZE = 100000; // 100KB — expanded for stats payload

let client = null;
function getClient() {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
  }

  const bodySize = JSON.stringify(req.body).length;
  if (bodySize > MAX_BODY_SIZE) {
    return res.status(413).json({ error: "Request too large" });
  }

  const { startQuarter, endQuarter, benchmarkData, stats, costData } = req.body;
  if (!startQuarter || !endQuarter || !benchmarkData || !stats || !costData) {
    return res.status(400).json({ error: "Missing required fields: startQuarter, endQuarter, benchmarkData, stats, costData" });
  }

  const userPrompt = `=== PRE-COMPUTED STATISTICS ===
${JSON.stringify(stats, null, 2)}

=== COST OF INTELLIGENCE ===
${JSON.stringify(costData, null, 2)}

=== RAW BENCHMARK SCORES (${startQuarter} to ${endQuarter}) ===
${benchmarkData}`;

  try {
    const message = await getClient().messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    return res.status(200).json({ analysis: text });
  } catch (err) {
    console.error("Claude API error:", err);
    return res.status(500).json({ error: "Failed to generate analysis" });
  }
};

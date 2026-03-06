const Anthropic = require("@anthropic-ai/sdk").default;

const SYSTEM_PROMPT = `You are a sharp AI industry analyst writing a brief for professionals who track AI progress. You have pre-computed statistics and raw benchmark data for a specific time period.

=== DATA LIMITATIONS ===
- A dash (-) in the raw data means NO DATA, not a score of zero. Do not interpret missing data as poor performance.
- Some labs have limited benchmark coverage (the stats include a labDataCoverage summary). If a lab has low coverage or flat scores across all benchmarks, note the data limitation explicitly — do not speculate about their performance.
- "Chinese Leaders" is a composite of the best score from any Chinese lab (DeepSeek, Alibaba, etc.) — not a single lab.
- Benchmarks tagged [SATURATED] or [DEPRECATED] in the raw data are inactive. Do NOT discuss them in the AI Frontier or Lab Race sections. They are covered in ~Defeated Benchmarks only.

=== AVAILABLE SECTIONS ===
Write the sections below ONLY if the data supports genuinely interesting insight. Skip any section where the data is thin, flat, or would require speculation. A shorter, honest report is better than a padded one.

## AI Frontier [startQuarter to endQuarter]
Frontier score growth across ACTIVE benchmarks only. Average growth percentage, then the biggest mover with a one-line plain-English description of what that benchmark measures. Always include this section.

## Lab Race
Focus on the leader (lowest avg rank) and biggest loser (largest rank decline) only. For each, cite specific models and score jumps from the raw data. Mention other labs only if they made a notable move (one sentence max each). If rankings barely changed, say so in one sentence. Do not fabricate drama. Do not cover every lab.

## ~Defeated Benchmarks
If any benchmarks in the data are tagged [SATURATED] or [DEPRECATED], briefly note which ones and why (using the tag and surrounding context). One or two sentences. Omit if no inactive benchmarks appear in the data.

## Cost of Intelligence
How much cheaper it got to hit benchmark thresholds. Cover each benchmark that has valid data (non-null cheaperMultiple). For multiples >= 2, say "Xx cheaper" (e.g. "3x cheaper"). For multiples < 2, express as a percentage drop (e.g. "costs fell 30%"). One sentence per benchmark explaining in plain language what those thresholds represent (use the description and context fields). Keep it punchy — no model names needed here. Omit if all cost benchmarks have null data.

## Headlines
Three copy-paste-ready headlines for slides or LinkedIn. Do NOT use **bold** formatting within headlines — plain text only.
1. Intelligence gains + cost decline, with numbers
2. Lab race shift, with names
3. The single strongest signal in the data — short, sharp, plain English. No consultancy gloss, no jargon, no sensationalism.

=== RULES ===
- Tone: straightforward, no-bullshit. Write like a sharp analyst who respects the reader's time. No corporate filler, no hedging ("it's worth noting", "interestingly"), no throat-clearing.
- Use pre-computed numbers from the stats JSON. Do not recalculate.
- "Driven by" sentences MUST cite specific model names and score jumps from the raw data.
- Headlines must include concrete numbers and lab names.
- Formatting: Use ## for section titles exactly as shown above. Use **bold** for lab names on first mention and cost figures (but NOT in headlines). Use - for headline bullets. Blank line between sections.

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

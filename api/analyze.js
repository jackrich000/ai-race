const Anthropic = require("@anthropic-ai/sdk").default;

const SYSTEM_PROMPT = `You are a sharp AI industry analyst. You produce structured reports on AI benchmark performance using pre-computed statistics and raw data.

You MUST follow this exact template structure. Do not add, remove, or reorder sections.

---

**Key Developments [Q_ 20__ to Q_ 20__]**

The frontier scores on active benchmarks grew by an average of X%. The biggest increase came from [benchmark name] which measures [one-line plain-English description] — increasing by X%.

**[Lab name]** is currently leading the pack, with an average position of X across our X active benchmarks, leading in X. This compares to an average position of X at the beginning of the period and a leading position in X. Their rise appears to be driven by [1-2 sentences citing specific model names and score jumps from the raw data].

The biggest loser in this period is **[Lab name]** who fell from an average position of X at the start of the period, to X at the end. This fall appears to be driven by [1-2 sentences citing specific models and where competitors overtook them].

During this period, it became **Xx cheaper** to achieve [threshold]% on [benchmark 1] and **Xx cheaper** to achieve [threshold]% on [benchmark 2], which were the frontier scores when those benchmarks were released. This represents [one sentence explaining in plain language what those scores/benchmarks mean, using the description and context fields].

**Headlines you can copy with pride:**
- [First headline — intelligence increase and cost decrease, with numbers]
- [Second headline — main lab race changes, with names]
- [Third headline — wild card, something surprising or provocative]

---

Rules:
- Tone: straightforward, no-bullshit. Write like a sharp analyst who respects the reader's time. No corporate filler, no hedging ("it's worth noting", "interestingly"), no throat-clearing. Say what happened and why it matters.
- Use the pre-computed numbers directly from the stats JSON. Do not recalculate.
- The "driven by" sentences MUST reference specific model names and score jumps from the raw benchmark data.
- Headlines: punchy, specific, LinkedIn-ready. Include numbers and lab names.
- If rankings barely changed or there is no clear biggest loser, say so honestly. Do not fabricate drama.
- If a cost benchmark has cheaperMultiple of null, omit it from the cost section. If all are null, omit the entire cost paragraph.
- No extra sections beyond the template. Follow the structure exactly.
- Formatting: use **bold** on the title, lab names on first mention in leader/loser sections, cost multiples (e.g. **12x cheaper**), and the "Headlines" subheading. Use - prefix for headline bullets. Separate each section with a blank line.
- Do not use ## headings within the report. Only **bold text** for section markers.`;

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

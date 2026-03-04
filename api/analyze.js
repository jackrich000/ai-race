const Anthropic = require("@anthropic-ai/sdk").default;

const SYSTEM_PROMPT = `You are a sharp AI industry analyst writing for executive presentations.
Given benchmark performance data for frontier AI models, produce a concise
analysis suitable for copy-pasting into presentation slides.

Rules:
- Lead with the single most important headline finding
- Use 3-5 bullet points maximum
- Each bullet: one key insight with specific numbers
- Name the models and labs — be specific
- Note surprising gaps, accelerations, or reversals
- End with a one-sentence forward-looking statement
- No hedging, no filler, no "it's worth noting" — be direct
- Format: markdown with **bold** for emphasis`;

const MAX_BODY_SIZE = 50000; // 50KB — plenty for benchmark data

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

  const { startQuarter, endQuarter, benchmarkData } = req.body;
  if (!startQuarter || !endQuarter || !benchmarkData) {
    return res.status(400).json({ error: "Missing required fields: startQuarter, endQuarter, benchmarkData" });
  }

  const userPrompt = `Analyze the following AI benchmark data from ${startQuarter} to ${endQuarter}:\n\n${benchmarkData}`;

  try {
    const message = await getClient().messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
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

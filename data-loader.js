// data-loader.js
// Fetches live benchmark data from Supabase and exposes the same
// TIME_LABELS, LABS, BENCHMARKS globals that app.js expects.

// ─── Supabase config (anon key is safe to expose — RLS allows read only) ───
const SUPABASE_URL = "https://jtrhsqdfevyqzzjjvcdr.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_NW3JPCH8VQ0_ym-UFnGavw_JCVcDDp9";

// ─── Static config ──────────────────────────────────────────────

const TIME_LABELS = [
  "Q1 2023", "Q2 2023", "Q3 2023", "Q4 2023",
  "Q1 2024", "Q2 2024", "Q3 2024", "Q4 2024",
  "Q1 2025", "Q2 2025", "Q3 2025", "Q4 2025",
  "Q1 2026",
];

const LABS = {
  openai:    { name: "OpenAI",          color: "#10a37f" },
  anthropic: { name: "Anthropic",       color: "#d4a574" },
  google:    { name: "Google DeepMind", color: "#4285f4" },
  xai:       { name: "xAI",            color: "#ef4444" },
  meta:      { name: "Meta",           color: "#a855f7" },
};

// Benchmark metadata — descriptions, categories, links (these rarely change)
const BENCHMARK_META = {
  "swe-bench": {
    name: "SWE-bench Verified",
    description: "Tests ability to resolve real GitHub issues from popular open-source Python repositories. Models must understand codebases, locate bugs, and generate working patches.",
    category: "Coding",
    link: "https://www.swebench.com/",
  },
  "arc-agi-1": {
    name: "ARC-AGI-1",
    description: "Abstract and Reasoning Corpus — tests fluid intelligence through novel visual pattern recognition puzzles that require generalization from few examples.",
    category: "Reasoning",
    link: "https://arcprize.org/",
  },
  "arc-agi-2": {
    name: "ARC-AGI-2",
    description: "Harder successor to ARC-AGI-1 with more complex abstract reasoning puzzles. Designed to remain challenging as models improve on the original.",
    category: "Reasoning",
    link: "https://arcprize.org/",
  },
  "hle": {
    name: "Humanity's Last Exam",
    description: "Expert-level questions spanning dozens of academic disciplines, designed to be at the frontier of human knowledge. Tests deep expertise rather than pattern matching.",
    category: "Knowledge",
    link: "https://lastexam.ai/",
  },
  "mmlu": {
    name: "MMLU",
    description: "Massive Multitask Language Understanding — 57 subjects from STEM, humanities, and social sciences. The longest-running LLM benchmark with the most historical data.",
    category: "Knowledge",
    link: "https://arxiv.org/abs/2009.03300",
  },
  "gpqa": {
    name: "GPQA Diamond",
    description: "Graduate-level science questions in physics, chemistry, and biology that are \u2018Google-proof\u2019 — experts in the field achieve ~65% while non-experts score near random chance.",
    category: "Science",
    link: "https://arxiv.org/abs/2311.12022",
  },
  "aime": {
    name: "AIME (OTIS Mock)",
    description: "Competition-level math problems evaluated by Epoch AI using OTIS mock AIME exams. Tests creative mathematical problem solving and reasoning under constraints.",
    category: "Math",
    link: "https://epoch.ai/data/math-benchmark-scores",
  },
};

// ─── Data loading ───────────────────────────────────────────────

let BENCHMARKS = {};

async function loadData() {
  const url = `${SUPABASE_URL}/rest/v1/benchmark_scores?select=benchmark,lab,quarter,score&order=benchmark,lab,quarter`;

  const response = await fetch(url, {
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Supabase fetch failed: ${response.status} ${response.statusText}`);
  }

  const rows = await response.json();

  // Build quarter → index lookup
  const quarterIndex = {};
  TIME_LABELS.forEach((q, i) => quarterIndex[q] = i);

  // Group rows by benchmark
  const grouped = {};
  for (const row of rows) {
    if (!grouped[row.benchmark]) grouped[row.benchmark] = [];
    grouped[row.benchmark].push(row);
  }

  // Construct BENCHMARKS in the same shape as the old data.js
  BENCHMARKS = {};
  for (const [benchKey, meta] of Object.entries(BENCHMARK_META)) {
    const scores = {};

    // Initialize all labs with null arrays
    for (const labKey of Object.keys(LABS)) {
      scores[labKey] = new Array(TIME_LABELS.length).fill(null);
    }

    // Fill in actual scores from Supabase
    const benchRows = grouped[benchKey] || [];
    for (const row of benchRows) {
      const qi = quarterIndex[row.quarter];
      if (qi !== undefined && scores[row.lab]) {
        scores[row.lab][qi] = row.score !== null
          ? Math.round(row.score * 10) / 10
          : null;
      }
    }

    BENCHMARKS[benchKey] = { ...meta, scores };
  }
}

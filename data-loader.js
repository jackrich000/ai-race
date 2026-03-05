// data-loader.js
// Fetches live benchmark data from Supabase and exposes the same
// TIME_LABELS, LABS, BENCHMARKS globals that app.js expects.

// ─── Supabase config (anon key is safe to expose — RLS allows read only) ───
const SUPABASE_URL = "https://jtrhsqdfevyqzzjjvcdr.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_NW3JPCH8VQ0_ym-UFnGavw_JCVcDDp9";

// ─── Static config ──────────────────────────────────────────────

// Generate quarters from Q1 2023 through the current quarter
const TIME_LABELS = (() => {
  const now = new Date();
  const endYear = now.getFullYear();
  const endQ = Math.ceil((now.getMonth() + 1) / 3);
  const labels = [];
  for (let y = 2023; y <= endYear; y++) {
    for (let q = 1; q <= 4; q++) {
      labels.push(`Q${q} ${y}`);
      if (y === endYear && q === endQ) return labels;
    }
  }
  return labels;
})();

const LABS = {
  openai:    { name: "OpenAI",          color: "#10a37f" },
  anthropic: { name: "Anthropic",       color: "#d4a574" },
  google:    { name: "Google DeepMind", color: "#4285f4" },
  xai:       { name: "xAI",            color: "#ef4444" },
  chinese:   { name: "Chinese Leaders", color: "#a855f7" },
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

// Cost of Intelligence metadata
const COST_BENCHMARK_META = {
  gpqa: {
    name: "GPQA Diamond", threshold: 36, thresholdLabel: "36%",
    description: "Best-in-the-world science reasoning, Nov 2023",
    context: "When GPQA Diamond launched, GPT-4 scored 35.7%",
    color: "#06b6d4", startQuarter: "Q4 2023",
  },
  "mmlu-pro": {
    name: "MMLU-Pro", threshold: 73, thresholdLabel: "73%",
    description: "Best-in-the-world academic knowledge, Jun 2024",
    context: "When MMLU-Pro launched, GPT-4o scored 72.6%",
    color: "#a855f7", startQuarter: "Q2 2024",
  },
};

// ─── Data loading ───────────────────────────────────────────────

let BENCHMARKS = {};
let COST_DATA = {};

async function loadBenchmarkScores() {
  const url = `${SUPABASE_URL}/rest/v1/benchmark_scores?select=benchmark,lab,quarter,score,model&order=benchmark,lab,quarter`;

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

    // Fill in actual scores from Supabase (objects with score + model)
    const benchRows = grouped[benchKey] || [];
    for (const row of benchRows) {
      const qi = quarterIndex[row.quarter];
      if (qi !== undefined && scores[row.lab]) {
        scores[row.lab][qi] = row.score !== null
          ? { score: Math.round(row.score * 10) / 10, model: row.model || null }
          : null;
      }
    }

    BENCHMARKS[benchKey] = { ...meta, scores };
  }
}

async function loadCostData() {
  const url = `${SUPABASE_URL}/rest/v1/cost_intelligence?select=benchmark,quarter,price,model,lab,score,threshold&order=benchmark,quarter`;

  const response = await fetch(url, {
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });

  if (!response.ok) {
    console.warn("Cost data fetch failed:", response.status);
    return;
  }

  const rows = await response.json();

  const quarterIndex = {};
  TIME_LABELS.forEach((q, i) => quarterIndex[q] = i);

  COST_DATA = {};
  for (const [benchKey, meta] of Object.entries(COST_BENCHMARK_META)) {
    COST_DATA[benchKey] = {
      ...meta,
      entries: new Array(TIME_LABELS.length).fill(null),
    };
  }

  for (const row of rows) {
    if (!COST_DATA[row.benchmark]) continue;
    const qi = quarterIndex[row.quarter];
    if (qi === undefined) continue;

    COST_DATA[row.benchmark].entries[qi] = row.price !== null
      ? { price: parseFloat(row.price), model: row.model, lab: row.lab, score: parseFloat(row.score) }
      : null;
  }
}

async function loadData() {
  await Promise.all([loadBenchmarkScores(), loadCostData()]);
}

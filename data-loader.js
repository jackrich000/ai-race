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
  xai:       { name: "xAI",            color: "#f97316" },
  chinese:   { name: "Chinese Leaders", color: "#a855f7" },
};

// Benchmark metadata — descriptions, categories, links, lifecycle status
// Active benchmarks first, then inactive (grouped for readability)
const BENCHMARK_META = {
  // ─── Active benchmarks ───
  "gpqa": {
    name: "GPQA Diamond",
    description: "Graduate-level science questions in physics, chemistry, and biology. Domain experts achieve ~65%; non-experts perform at chance. Verified scores come from Artificial Analysis's independent evaluations. These are supplemented with unverified model card scores from the labs, to show the latest model releases (shown with hollow dots).",
    category: "Science",
    link: "https://arxiv.org/abs/2311.12022",
    status: "active",
  },
  "arc-agi-2": {
    name: "ARC-AGI-2",
    description: "Measures novel pattern recognition and abstraction with tasks that are trivial for humans but difficult for AI. Released January 2025 as part of ARC Prize 2025. Scores from the official ARC Prize leaderboard; only first-party model submissions are included. Third-party scaffolds and wrappers are excluded.",
    category: "Reasoning",
    link: "https://arcprize.org/",
    status: "active",
  },
  "hle": {
    name: "Humanity's Last Exam",
    description: "A collaboration of 3,000+ experts across 100+ subjects, designed to be the hardest public benchmark. Released January 2025. Verified scores come from Artificial Analysis's independent evaluations. These are supplemented with unverified model card scores from the labs, to show the latest model releases (shown with hollow dots).",
    category: "Knowledge",
    link: "https://lastexam.ai/",
    status: "active",
  },
  "swe-bench-pro": {
    name: "SWE-bench Pro (Public)",
    description: "Long-horizon software engineering tasks in real open-source repositories. Harder than SWE-bench Verified, with multi-file changes, longer reasoning chains, and fixes for bugs in Verified's question set. Scores from the official Scale AI SEAL public leaderboard. These are supplemented with unverified model card scores from the labs, to show the latest model releases (shown with hollow dots).",
    category: "Coding",
    link: "https://scale.com/leaderboard",
    status: "active",
  },
  "aime": {
    name: "AIME (OTIS Mock)",
    description: "Competition-level math problems modeled on the American Invitational Mathematics Examination. Uses the OTIS Mock AIME 2024\u20132025 variant tracked by Epoch AI, which is harder than the standard AIME and less susceptible to data contamination.",
    category: "Math",
    link: "https://epoch.ai/data/math-benchmark-scores",
    status: "active",
  },
  "frontiermath": {
    name: "FrontierMath",
    description: "Research-level mathematics problems created by professional mathematicians. Goes beyond competition math (AIME) into open research questions requiring deep mathematical reasoning across multiple fields. Independently evaluated by Epoch AI.",
    category: "Math",
    link: "https://epoch.ai/frontiermath",
    status: "active",
  },
  // ─── Inactive benchmarks ───
  "humaneval": {
    name: "HumanEval",
    description: "164 hand-written Python programming problems testing code generation from docstrings. Created by OpenAI in 2021, it became the standard coding benchmark. Scores compiled from published papers and technical reports.",
    category: "Coding",
    link: "https://arxiv.org/abs/2107.03374",
    status: "saturated",
    activeUntil: "Q4 2024",
    inactiveReason: "Top models score 97%+, benchmark is effectively solved",
  },
  "arc-agi-1": {
    name: "ARC-AGI-1",
    description: "The original ARC Prize benchmark for novel pattern recognition and abstraction. Tasks that are trivial for humans but difficult for AI. Scores from the official ARC Prize leaderboard; only first-party model submissions are included.",
    category: "Reasoning",
    link: "https://arcprize.org/",
    status: "deprecated",
    activeUntil: "Q1 2025",
    inactiveReason: "Replaced by ARC-AGI-2, with first submissions in Q1 2025",
  },
  "swe-bench": {
    name: "SWE-bench Verified",
    description: "Real GitHub issues from popular open-source Python repositories. Models must generate working patches. Scores from the official SWE-bench Verified leaderboard. Each submission pairs a scaffold with a model; we attribute scores to the underlying model\u2019s lab. Multi-lab entries are excluded.",
    category: "Coding",
    link: "https://www.swebench.com/",
    status: "saturated",
    activeUntil: "Q3 2025",
    inactiveReason: "Scores plateaued Q3 2025 due to known question-set ceiling; officially deprecated Feb 2026",
  },
  "math-l5": {
    name: "MATH Level 5",
    description: "The hardest tier of the MATH benchmark: olympiad and research-competition problems requiring multi-step reasoning. Independently evaluated by Epoch AI.",
    category: "Math",
    link: "https://arxiv.org/abs/2103.03874",
    status: "saturated",
    activeUntil: "Q1 2025",
    inactiveReason: "Top models score 96%+, even the hardest math tier is effectively solved",
  },
};

// ─── Lifecycle helpers ──────────────────────────────────────

/** Compare quarter strings like "Q1 2023" numerically. Returns negative/zero/positive. */
function compareQuarters(a, b) {
  const [qa, ya] = [parseInt(a[1]), parseInt(a.substring(3))];
  const [qb, yb] = [parseInt(b[1]), parseInt(b.substring(3))];
  return ya !== yb ? ya - yb : qa - qb;
}

/** Returns the end quarter of the current filter range (hook for future date filter). */
function getFilterEndDate() {
  return TIME_LABELS[TIME_LABELS.length - 1];
}

/** Returns true if a benchmark is active relative to the given filter end quarter.
 *  A benchmark is inactive once the filter end date reaches its activeUntil quarter. */
function isBenchmarkActive(benchKey, filterEndQuarter) {
  const meta = BENCHMARK_META[benchKey];
  if (!meta || !meta.activeUntil) return true;
  return compareQuarters(filterEndQuarter, meta.activeUntil) < 0;
}

// Cost of Intelligence metadata
const COST_BENCHMARK_META = {
  gpqa: {
    name: "GPQA Diamond", threshold: 36, thresholdLabel: "36%",
    description: "Graduate-level science questions in physics, chemistry, and biology. Domain experts achieve ~65%; non-experts perform at chance. The cost threshold (36%) is set at what GPT-4 scored when the benchmark launched in late 2023. Pricing data from Artificial Analysis.",
    link: "https://arxiv.org/abs/2311.12022",
    color: "#06b6d4", startQuarter: "Q4 2023",
  },
  "mmlu-pro": {
    name: "MMLU-Pro", threshold: 73, thresholdLabel: "73%",
    description: "A harder successor to MMLU with 10 answer choices (vs 4) across 14 academic subjects, designed to test genuine reasoning rather than recall. The cost threshold (73%) is set at what GPT-4o scored when the benchmark launched in mid-2024. Pricing data from Artificial Analysis.",
    link: "https://arxiv.org/abs/2406.01574",
    color: "#a855f7", startQuarter: "Q2 2024",
  },
  livecodebench: {
    name: "LiveCodeBench", threshold: 29, thresholdLabel: "29%",
    description: "Continuously-updated coding benchmark sourced from competitive programming platforms. New problems added regularly to prevent data contamination. The cost threshold (29%) is set at what GPT-4 Turbo scored when the benchmark launched in early 2024. Pricing data from Artificial Analysis.",
    link: "https://livecodebench.github.io/",
    color: "#f59e0b", startQuarter: "Q1 2024",
  },
};

// ─── Data loading ───────────────────────────────────────────────

let BENCHMARKS = {};
let COST_DATA = {};
let costLoadFailed = false;

async function loadBenchmarkScores() {
  const url = `${SUPABASE_URL}/rest/v1/benchmark_scores?select=benchmark,lab,quarter,score,model,source,verified&order=benchmark,lab,quarter`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  let response;
  try {
    response = await fetch(url, {
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") throw new Error("Request timed out");
    throw err;
  }
  clearTimeout(timeoutId);

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
          ? {
              score: Math.round(row.score * 10) / 10,
              model: row.model || null,
              source: row.source || null,
              verified: row.verified !== false,
            }
          : null;
      }
    }

    BENCHMARKS[benchKey] = { ...meta, scores };
  }
}

async function loadCostData() {
  const url = `${SUPABASE_URL}/rest/v1/cost_intelligence?select=benchmark,quarter,price,model,lab,score,threshold&order=benchmark,quarter`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  let response;
  try {
    response = await fetch(url, {
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn("Cost data fetch failed:", err.name === "AbortError" ? "Request timed out" : err.message);
    costLoadFailed = true;
    return;
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    console.warn("Cost data fetch failed:", response.status);
    costLoadFailed = true;
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

// scripts/generate-analyses.js
// Pre-generates AI analysis for all date range presets and stores them in Supabase.
// Computes structured stats (callouts), calls Claude for qualitative commentary,
// stores merged JSON in cached_analyses.
//
// Usage:
//   node scripts/generate-analyses.js            # all presets, reads .env
//   node scripts/generate-analyses.js all-time    # single preset

const fs = require("fs");
const path = require("path");

// Load .env file from project root
const envPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.substring(0, eqIdx);
      const val = trimmed.substring(eqIdx + 1);
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const Anthropic = require("@anthropic-ai/sdk").default;
const { createClient } = require("@supabase/supabase-js");
const { SYSTEM_PROMPT } = require("../lib/analysis-prompt.js");

// ─── Config ──────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL || "https://jtrhsqdfevyqzzjjvcdr.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error("Error: Set SUPABASE_SERVICE_KEY environment variable.");
  process.exit(1);
}
if (!ANTHROPIC_API_KEY) {
  console.error("Error: Set ANTHROPIC_API_KEY environment variable.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// ─── Static config (mirrored from data-loader.js) ────────────

function generateTimeLabels() {
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
}

const TIME_LABELS = generateTimeLabels();

const LABS = {
  openai:    { name: "OpenAI" },
  anthropic: { name: "Anthropic" },
  google:    { name: "Google DeepMind" },
  xai:       { name: "xAI" },
  chinese:   { name: "Chinese Leaders" },
};

const BENCHMARK_META = {
  "gpqa": {
    name: "GPQA Diamond", category: "Science", status: "active",
    description: "Graduate-level science questions spanning physics, chemistry, and biology",
  },
  "aime": {
    name: "AIME (OTIS Mock)", category: "Math", status: "active",
    description: "Competition-level math problems modeled on the American Invitational Mathematics Examination",
  },
  "arc-agi-2": {
    name: "ARC-AGI-2", category: "Reasoning", status: "active",
    description: "The harder successor to ARC-AGI-1, released January 2025",
  },
  "hle": {
    name: "Humanity's Last Exam", category: "Knowledge", status: "active",
    description: "A collaboration of 3,000+ experts across 100+ subjects",
  },
  "swe-bench-pro": {
    name: "SWE-bench Pro", category: "Coding", status: "active",
    description: "Long-horizon software engineering tasks in real open-source repositories",
  },
  "humaneval": {
    name: "HumanEval", category: "Coding", status: "saturated",
    description: "164 hand-written Python programming problems testing code generation",
    activeUntil: "Q4 2024",
    inactiveReason: "Top models score 97%+, benchmark is effectively solved",
  },
  "arc-agi-1": {
    name: "ARC-AGI-1", category: "Reasoning", status: "deprecated",
    description: "Measures novel pattern recognition and abstraction",
    activeUntil: "Q1 2025",
    inactiveReason: "Replaced by ARC-AGI-2, with first submissions in Q1 2025",
  },
  "swe-bench": {
    name: "SWE-bench Verified", category: "Coding", status: "saturated",
    description: "Real GitHub issues from popular open-source Python repositories",
    activeUntil: "Q3 2025",
    inactiveReason: "Scores plateaued Q3 2025 due to known question-set ceiling; officially deprecated Feb 2026",
  },
  "frontiermath": {
    name: "FrontierMath", category: "Math", status: "active",
    description: "Research-level mathematics problems (Tiers 1-3)",
  },
  "math-l5": {
    name: "MATH Level 5", category: "Math", status: "saturated",
    description: "The hardest tier of the MATH benchmark",
    activeUntil: "Q1 2025",
    inactiveReason: "Top models score 96%+, even the hardest math tier is effectively solved",
  },
};

const COST_BENCHMARK_META = {
  gpqa: {
    name: "GPQA Diamond", threshold: 36, thresholdLabel: "36%",
    description: "Graduate-level science questions in physics, chemistry, and biology. Domain experts achieve ~65%; non-experts perform at chance. The cost threshold (36%) is set at what GPT-4 scored when the benchmark launched in late 2023.",
    startQuarter: "Q4 2023",
  },
  "mmlu-pro": {
    name: "MMLU-Pro", threshold: 73, thresholdLabel: "73%",
    description: "A harder successor to MMLU with 10 answer choices (vs 4) across 14 academic subjects, designed to test genuine reasoning rather than recall. The cost threshold (73%) is set at what GPT-4o scored when the benchmark launched in mid-2024.",
    startQuarter: "Q2 2024",
  },
};

// ─── Lifecycle helpers ──────────────────────────────────────

function compareQuarters(a, b) {
  const [qa, ya] = [parseInt(a[1]), parseInt(a.substring(3))];
  const [qb, yb] = [parseInt(b[1]), parseInt(b.substring(3))];
  return ya !== yb ? ya - yb : qa - qb;
}

function getFilterEndDate() {
  return TIME_LABELS[TIME_LABELS.length - 1];
}

function isBenchmarkActive(benchKey, filterEndQuarter) {
  const meta = BENCHMARK_META[benchKey];
  if (!meta || !meta.activeUntil) return true;
  return compareQuarters(filterEndQuarter, meta.activeUntil) < 0;
}

// ─── Data loading from Supabase ──────────────────────────────

let BENCHMARKS = {};
let COST_DATA = {};

async function loadData() {
  const { data: scoreRows, error: scoreErr } = await supabase
    .from("benchmark_scores")
    .select("benchmark,lab,quarter,score,model")
    .order("benchmark")
    .order("lab")
    .order("quarter");

  if (scoreErr) throw new Error(`Failed to load benchmark_scores: ${scoreErr.message}`);

  const quarterIndex = {};
  TIME_LABELS.forEach((q, i) => quarterIndex[q] = i);

  const grouped = {};
  for (const row of scoreRows) {
    if (!grouped[row.benchmark]) grouped[row.benchmark] = [];
    grouped[row.benchmark].push(row);
  }

  BENCHMARKS = {};
  for (const [benchKey, meta] of Object.entries(BENCHMARK_META)) {
    const scores = {};
    for (const labKey of Object.keys(LABS)) {
      scores[labKey] = new Array(TIME_LABELS.length).fill(null);
    }

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

  const { data: costRows, error: costErr } = await supabase
    .from("cost_intelligence")
    .select("benchmark,quarter,price,model,lab,score,threshold")
    .order("benchmark")
    .order("quarter");

  if (costErr) throw new Error(`Failed to load cost_intelligence: ${costErr.message}`);

  COST_DATA = {};
  for (const [benchKey, meta] of Object.entries(COST_BENCHMARK_META)) {
    COST_DATA[benchKey] = {
      ...meta,
      entries: new Array(TIME_LABELS.length).fill(null),
    };
  }

  for (const row of costRows) {
    if (!COST_DATA[row.benchmark]) continue;
    const qi = quarterIndex[row.quarter];
    if (qi === undefined) continue;

    COST_DATA[row.benchmark].entries[qi] = row.price !== null
      ? { price: parseFloat(row.price), model: row.model, lab: row.lab, score: parseFloat(row.score) }
      : null;
  }
}

// ─── Stat functions ──────────────────────────────────────────

function getLatestScore(scoresArray, maxIdx) {
  for (let i = maxIdx; i >= 0; i--) {
    if (scoresArray[i]) return { score: scoresArray[i].score, model: scoresArray[i].model };
  }
  return null;
}

function getEarliestScore(scoresArray, minIdx, maxIdx) {
  for (let i = minIdx; i <= maxIdx; i++) {
    if (scoresArray[i]) return { score: scoresArray[i].score, model: scoresArray[i].model };
  }
  return null;
}

function computeFrontierGrowth(startIdx, endIdx) {
  const filterEnd = getFilterEndDate();
  const labKeys = Object.keys(LABS);
  const results = [];
  for (const [benchKey, bench] of Object.entries(BENCHMARKS)) {
    if (!isBenchmarkActive(benchKey, filterEnd)) continue;
    let startMax = null, endMax = null;
    for (const labKey of labKeys) {
      // Find earliest data point in range for start, latest for end
      const s = getEarliestScore(bench.scores[labKey], startIdx, endIdx);
      const e = getLatestScore(bench.scores[labKey], endIdx);
      if (s && (startMax === null || s.score > startMax)) startMax = s.score;
      if (e && (endMax === null || e.score > endMax)) endMax = e.score;
    }
    if (startMax === null || endMax === null) continue;
    const ppChange = Math.round((endMax - startMax) * 10) / 10;
    const relPct = startMax > 0 ? Math.round(((endMax - startMax) / startMax) * 1000) / 10 : null;
    results.push({
      benchmark: bench.name,
      benchKey,
      startScore: startMax,
      endScore: endMax,
      ppChange,
      relPct,
    });
  }
  results.sort((a, b) => b.ppChange - a.ppChange);

  // Median relative increase (handles low-base outliers better than mean)
  const validRel = results.filter(r => r.relPct !== null).map(r => r.relPct).sort((a, b) => a - b);
  let medianRelPct = 0;
  if (validRel.length > 0) {
    const mid = Math.floor(validRel.length / 2);
    medianRelPct = validRel.length % 2 === 0
      ? Math.round(((validRel[mid - 1] + validRel[mid]) / 2) * 10) / 10
      : validRel[mid];
  }

  return { benchmarks: results, medianRelPct, biggestMover: results[0] || null };
}

function computePerQuarterFrontier(startIdx, endIdx) {
  const filterEnd = getFilterEndDate();
  const labKeys = Object.keys(LABS);
  const activeBenchKeys = Object.keys(BENCHMARKS).filter(k => isBenchmarkActive(k, filterEnd));
  const quarters = {};

  for (let qi = startIdx; qi <= endIdx; qi++) {
    const qLabel = TIME_LABELS[qi];
    const benchScores = {};
    for (const benchKey of activeBenchKeys) {
      const bench = BENCHMARKS[benchKey];
      let bestScore = null;
      for (const labKey of labKeys) {
        const entry = bench.scores[labKey][qi];
        if (entry && (bestScore === null || entry.score > bestScore)) {
          bestScore = entry.score;
        }
      }
      if (bestScore !== null) benchScores[bench.name] = bestScore;
    }
    if (Object.keys(benchScores).length > 0) {
      quarters[qLabel] = benchScores;
    }
  }
  return quarters;
}

function computeRankings(startIdx, endIdx) {
  const filterEnd = getFilterEndDate();
  const labKeys = Object.keys(LABS);
  const activeBenchKeys = Object.keys(BENCHMARKS).filter(k => isBenchmarkActive(k, filterEnd));

  function rankAtIndex(idx) {
    const perLab = {};
    for (const labKey of labKeys) perLab[labKey] = { ranks: [], firsts: 0, detail: {} };

    for (const benchKey of activeBenchKeys) {
      const bench = BENCHMARKS[benchKey];
      const entries = [];
      for (const labKey of labKeys) {
        const entry = getLatestScore(bench.scores[labKey], idx);
        if (entry) entries.push({ labKey, score: entry.score, model: entry.model });
      }
      if (entries.length === 0) continue;

      entries.sort((a, b) => b.score - a.score);

      let rank = 1;
      for (let i = 0; i < entries.length; i++) {
        if (i > 0 && entries[i].score < entries[i - 1].score) rank++;
        const lab = entries[i].labKey;
        perLab[lab].ranks.push(rank);
        perLab[lab].detail[benchKey] = { rank, score: entries[i].score, model: entries[i].model };
        if (rank === 1) perLab[lab].firsts++;
      }
    }

    const result = {};
    for (const labKey of labKeys) {
      const d = perLab[labKey];
      if (d.ranks.length === 0) continue;
      result[labKey] = {
        avgRank: Math.round((d.ranks.reduce((a, b) => a + b, 0) / d.ranks.length) * 10) / 10,
        firsts: d.firsts,
        benchmarksRanked: d.ranks.length,
        detail: d.detail,
      };
    }
    return result;
  }

  const startRanks = rankAtIndex(startIdx);
  const endRanks = rankAtIndex(endIdx);

  let leader = null, lowestAvg = Infinity;
  for (const [labKey, data] of Object.entries(endRanks)) {
    if (data.avgRank < lowestAvg) { lowestAvg = data.avgRank; leader = labKey; }
  }

  // Biggest mover: largest absolute rank change, excluding the leader
  let biggestMover = null, biggestAbsChange = 0;
  for (const [labKey, endData] of Object.entries(endRanks)) {
    if (labKey === leader) continue;
    const startData = startRanks[labKey];
    if (!startData) continue;
    const change = endData.avgRank - startData.avgRank;
    if (Math.abs(change) > biggestAbsChange) {
      biggestAbsChange = Math.abs(change);
      biggestMover = { labKey, change };
    }
  }

  return {
    leader: leader ? {
      lab: LABS[leader].name,
      labKey: leader,
      startAvgRank: startRanks[leader] ? startRanks[leader].avgRank : null,
      endAvgRank: endRanks[leader].avgRank,
      endFirsts: endRanks[leader].firsts,
      benchmarksRanked: endRanks[leader].benchmarksRanked,
      detail: endRanks[leader].detail,
    } : null,
    biggestMover: biggestMover && biggestAbsChange > 0 ? {
      lab: LABS[biggestMover.labKey].name,
      labKey: biggestMover.labKey,
      change: biggestMover.change,
      startAvgRank: startRanks[biggestMover.labKey].avgRank,
      endAvgRank: endRanks[biggestMover.labKey].avgRank,
      endFirsts: endRanks[biggestMover.labKey].firsts,
    } : null,
    allRanks: endRanks,
  };
}

function computeCostDecline(startIdx, endIdx) {
  const results = [];
  for (const [benchKey, meta] of Object.entries(COST_BENCHMARK_META)) {
    const data = COST_DATA[benchKey];
    if (!data) continue;

    // Bug fix: search forward from startIdx to find the first entry in range
    let startEntry = null, startQ = null;
    for (let i = startIdx; i <= endIdx; i++) {
      if (data.entries[i]) { startEntry = data.entries[i]; startQ = TIME_LABELS[i]; break; }
    }
    let endEntry = null, endQ = null;
    for (let i = endIdx; i >= startIdx; i--) {
      if (data.entries[i]) { endEntry = data.entries[i]; endQ = TIME_LABELS[i]; break; }
    }

    if (!startEntry || !endEntry || startEntry === endEntry || startEntry.price <= 0 || endEntry.price <= 0) {
      results.push({ benchmark: meta.name, benchKey, threshold: meta.thresholdLabel, decline: null });
      continue;
    }

    const decline = Math.round((startEntry.price / endEntry.price) * 10) / 10;
    results.push({
      benchmark: meta.name,
      benchKey,
      threshold: meta.thresholdLabel,
      decline: `${decline}x`,
      startPrice: startEntry.price,
      endPrice: endEntry.price,
      startModel: startEntry.model,
      endModel: endEntry.model,
      startQ,
      endQ,
    });
  }
  return results;
}

function computeDataFreshness(endIdx) {
  const filterEnd = getFilterEndDate();
  const activeBenchKeys = Object.keys(BENCHMARKS).filter(k => isBenchmarkActive(k, filterEnd));
  const freshness = {};

  for (const [labKey, lab] of Object.entries(LABS)) {
    freshness[lab.name] = {};
    for (const benchKey of activeBenchKeys) {
      const bench = BENCHMARKS[benchKey];
      let latestQ = null;
      for (let i = endIdx; i >= 0; i--) {
        if (bench.scores[labKey][i]) {
          latestQ = TIME_LABELS[i];
          break;
        }
      }
      freshness[lab.name][bench.name] = latestQ || "no data";
    }
  }
  return freshness;
}

function getDataForRange(startIdx, endIdx) {
  const filterEnd = getFilterEndDate();
  let lines = [];
  for (const [benchKey, bench] of Object.entries(BENCHMARKS)) {
    const meta = BENCHMARK_META[benchKey];
    const isInactive = !isBenchmarkActive(benchKey, filterEnd);
    let header = `\n## ${bench.name} (${bench.category})`;
    if (isInactive && meta.status === "saturated") {
      header += ` [SATURATED - ${meta.activeUntil}]`;
    } else if (isInactive && meta.status === "deprecated") {
      header += ` [DEPRECATED - ${meta.activeUntil}]`;
    }
    lines.push(header);
    for (const [labKey, lab] of Object.entries(LABS)) {
      const scores = bench.scores[labKey].slice(startIdx, endIdx + 1);
      const labels = TIME_LABELS.slice(startIdx, endIdx + 1);
      const parts = scores.map((d, i) =>
        d ? `${labels[i]}: ${d.score}%${d.model ? " (" + d.model + ")" : ""}` : `${labels[i]}: -`
      );
      lines.push(`${lab.name}: ${parts.join(" | ")}`);
    }
  }
  return lines.join("\n");
}

// ─── Date range presets ──────────────────────────────────────

function computeQuarterRange(preset) {
  const endIdx = TIME_LABELS.length - 1;

  if (preset === "all-time") {
    return { startIdx: 0, endIdx };
  }

  if (preset === "last-12-months") {
    return { startIdx: Math.max(0, endIdx - 4), endIdx };
  }

  if (preset === "last-6-months") {
    return { startIdx: Math.max(0, endIdx - 2), endIdx };
  }

  if (preset === "last-3-months") {
    return { startIdx: Math.max(0, endIdx - 1), endIdx };
  }

  const year = parseInt(preset);
  if (!isNaN(year)) {
    const q1Label = `Q1 ${year}`;
    const q4Label = `Q4 ${year}`;
    let si = TIME_LABELS.indexOf(q1Label);
    let ei = TIME_LABELS.indexOf(q4Label);
    if (si < 0) si = 0;
    if (ei < 0) ei = endIdx;
    return { startIdx: si, endIdx: ei };
  }

  return { startIdx: 0, endIdx };
}

function getPresets() {
  const presets = ["all-time", "last-12-months", "last-6-months", "last-3-months"];

  const years = [...new Set(TIME_LABELS.map(q => q.substring(3)))];
  for (const year of years) {
    // Skip single-quarter years (e.g. 2026 with only Q1)
    const quartersInYear = TIME_LABELS.filter(q => q.endsWith(year));
    if (quartersInYear.length <= 1) continue;
    presets.push(year);
  }

  return presets;
}

// ─── Build structured analysis JSON ──────────────────────────

function buildCallouts(startIdx, endIdx) {
  // For frontier stats: use trailing 12-month window when range > 4 quarters
  const rangeQuarters = endIdx - startIdx;
  const frontierStartIdx = rangeQuarters > 4 ? Math.max(0, endIdx - 4) : startIdx;
  const frontierGrowth = computeFrontierGrowth(frontierStartIdx, endIdx);

  // For race stats: also use trailing 12-month window for comparison
  const raceCompareIdx = rangeQuarters > 4 ? Math.max(0, endIdx - 4) : startIdx;
  const rankings = computeRankings(raceCompareIdx, endIdx);
  const raceMonthsBack = (endIdx - raceCompareIdx) * 3;

  const costDecline = computeCostDecline(startIdx, endIdx);

  // Defeated benchmarks in this period (uses full range, not trailing)
  const startQ = TIME_LABELS[startIdx];
  const endQ = TIME_LABELS[endIdx];
  const defeatedThisPeriod = [];
  for (const [benchKey, meta] of Object.entries(BENCHMARK_META)) {
    if (!meta.activeUntil) continue;
    if (compareQuarters(meta.activeUntil, startQ) >= 0 && compareQuarters(meta.activeUntil, endQ) <= 0) {
      defeatedThisPeriod.push({ name: meta.name, reason: meta.inactiveReason });
    }
  }

  // Frontier callouts
  const frontierMonths = (endIdx - frontierStartIdx) * 3;
  const periodSuffix = frontierMonths > 0 ? ` over the last ${frontierMonths} months` : "";
  const frontier = {
    callouts: {
      medianIncrease: {
        value: `${frontierGrowth.medianRelPct}%`,
        label: "median increase",
        detail: `across ${frontierGrowth.benchmarks.length} active benchmarks${periodSuffix}`,
      },
    },
  };
  if (frontierGrowth.biggestMover) {
    const bm = frontierGrowth.biggestMover;
    frontier.callouts.biggestMover = {
      name: bm.benchmark,
      ppChange: bm.ppChange,
      periodLabel: periodSuffix.trim(),
    };
  }
  if (defeatedThisPeriod.length > 0) {
    frontier.callouts.benchmarksSaturated = {
      count: defeatedThisPeriod.length,
      names: defeatedThisPeriod.map(d => d.name),
    };
  }

  // Race callouts
  const race = { callouts: {} };
  if (rankings.leader) {
    const l = rankings.leader;
    const direction = l.startAvgRank !== null
      ? (l.endAvgRank < l.startAvgRank ? "down" : l.endAvgRank > l.startAvgRank ? "up" : "unchanged")
      : null;
    race.callouts.leader = {
      name: l.lab,
      avgRank: l.endAvgRank,
      firsts: l.endFirsts,
      benchmarkCount: l.benchmarksRanked,
      startAvgRank: l.startAvgRank,
      direction,
      monthsBack: raceMonthsBack,
    };
  }
  if (rankings.biggestMover) {
    const m = rankings.biggestMover;
    const change = Math.round(m.change * 10) / 10;
    const direction = change < 0 ? "improved" : "worsened";
    race.callouts.biggestMover = {
      name: m.lab,
      avgRank: m.endAvgRank,
      change,
      direction,
      firsts: m.endFirsts,
      benchmarkCount: rankings.leader ? rankings.leader.benchmarksRanked : m.benchmarksRanked,
      monthsBack: raceMonthsBack,
    };
  }

  // Cost callouts
  const cost = {
    callouts: costDecline.filter(c => c.decline !== null),
    explanation: "Shows the cheapest model (any lab) scoring above a fixed threshold on each benchmark, measured in $/M tokens (blended 3:1 input:output). Thresholds are set at what the best model scored when each benchmark launched.",
  };

  return { frontier, race, cost };
}

async function generateAnalysis(preset) {
  const { startIdx, endIdx } = computeQuarterRange(preset);
  const startQ = TIME_LABELS[startIdx];
  const endQ = TIME_LABELS[endIdx];

  const callouts = buildCallouts(startIdx, endIdx);
  const perQuarterFrontier = computePerQuarterFrontier(startIdx, endIdx);
  const freshness = computeDataFreshness(endIdx);
  const benchmarkData = getDataForRange(startIdx, endIdx);

  const filterEnd = getFilterEndDate();
  const activeBenchKeys = Object.keys(BENCHMARKS).filter(k => isBenchmarkActive(k, filterEnd));
  const labCoverage = {};
  for (const [labKey, lab] of Object.entries(LABS)) {
    let has = 0;
    for (const bk of activeBenchKeys) {
      const latest = getLatestScore(BENCHMARKS[bk].scores[labKey], endIdx);
      if (latest) has++;
    }
    labCoverage[lab.name] = `${has}/${activeBenchKeys.length} active benchmarks`;
  }

  const userPrompt = `=== CALLOUT STATS (code-computed, displayed to user — reference these numbers) ===
${JSON.stringify(callouts, null, 2)}

=== PER-QUARTER FRONTIER SCORES (best across all labs per benchmark per quarter) ===
${JSON.stringify(perQuarterFrontier, null, 2)}

=== DATA FRESHNESS (most recent quarter with data per lab per benchmark) ===
${JSON.stringify(freshness, null, 2)}

=== LAB DATA COVERAGE ===
${JSON.stringify(labCoverage, null, 2)}

=== RAW BENCHMARK SCORES (${startQ} to ${endQ}) ===
${benchmarkData}`;

  const message = await anthropic.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  // Parse LLM JSON response
  let llmOutput;
  try {
    // Strip markdown code fences if present
    const cleaned = text.replace(/^```json\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
    llmOutput = JSON.parse(cleaned);
  } catch (err) {
    console.error(`   Failed to parse LLM JSON response:`);
    console.error(`   Raw text: ${text.substring(0, 500)}`);
    throw new Error(`LLM returned invalid JSON: ${err.message}`);
  }

  // Merge callout stats with LLM commentary
  const analysis = {
    frontier: {
      ...callouts.frontier,
      headline: llmOutput.frontier?.headline || "",
      commentary: llmOutput.frontier?.commentary || "",
    },
    race: {
      ...callouts.race,
      headline: llmOutput.race?.headline || "",
      commentary: llmOutput.race?.commentary || "",
    },
    cost: {
      ...callouts.cost,
      headline: llmOutput.cost?.headline || "",
      commentary: llmOutput.cost?.commentary || "",
    },
  };

  return { analysis: JSON.stringify(analysis), startQuarter: startQ, endQuarter: endQ };
}

// ─── Main ────────────────────────────────────────────────────

async function main() {
  console.log("1. Loading data from Supabase...");
  await loadData();
  console.log(`   Loaded ${Object.keys(BENCHMARKS).length} benchmarks, ${Object.keys(COST_DATA).length} cost benchmarks`);
  console.log(`   TIME_LABELS: ${TIME_LABELS[0]} to ${TIME_LABELS[TIME_LABELS.length - 1]} (${TIME_LABELS.length} quarters)\n`);

  // Allow running a single preset via CLI arg
  const cliPreset = process.argv[2];
  const presets = cliPreset ? [cliPreset] : getPresets();
  console.log(`2. Generating analyses for ${presets.length} presets: ${presets.join(", ")}\n`);

  for (const preset of presets) {
    const { startIdx, endIdx } = computeQuarterRange(preset);
    console.log(`   [${preset}] ${TIME_LABELS[startIdx]} to ${TIME_LABELS[endIdx]}...`);

    try {
      const { analysis, startQuarter, endQuarter } = await generateAnalysis(preset);

      const { error } = await supabase
        .from("cached_analyses")
        .upsert({
          date_range: preset,
          analysis,
          start_quarter: startQuarter,
          end_quarter: endQuarter,
          generated_at: new Date().toISOString(),
        }, { onConflict: "date_range" });

      if (error) {
        console.error(`   [${preset}] UPSERT FAILED: ${error.message}`);
      } else {
        console.log(`   [${preset}] Done (${analysis.length} chars)`);
      }
    } catch (err) {
      console.error(`   [${preset}] FAILED: ${err.message}`);
    }
  }

  console.log("\nDone!");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});

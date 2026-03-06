// scripts/generate-analyses.js
// Pre-generates AI analysis for all date range presets and stores them in Supabase.
// Fetches data from Supabase, computes stats (same logic as app.js), calls Claude, upserts results.
//
// Usage:
//   SUPABASE_SERVICE_KEY=xxx ANTHROPIC_API_KEY=xxx node scripts/generate-analyses.js

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
    activeUntil: "Q4 2024",
    inactiveReason: "Top models score 97%+, benchmark is effectively solved",
  },
  "arc-agi-1": {
    name: "ARC-AGI-1", category: "Reasoning", status: "deprecated",
    activeUntil: "Q1 2025",
    inactiveReason: "Replaced by ARC-AGI-2, with first submissions in Q1 2025",
  },
  "swe-bench": {
    name: "SWE-bench Verified", category: "Coding", status: "saturated",
    activeUntil: "Q3 2025",
    inactiveReason: "Scores plateaued Q3 2025 due to known question-set ceiling; officially deprecated Feb 2026",
  },
};

const COST_BENCHMARK_META = {
  gpqa: {
    name: "GPQA Diamond", threshold: 36, thresholdLabel: "36%",
    description: "Best-in-the-world science reasoning, Nov 2023",
    context: "When GPQA Diamond launched, GPT-4 scored 35.7%",
    startQuarter: "Q4 2023",
  },
  "mmlu-pro": {
    name: "MMLU-Pro", threshold: 73, thresholdLabel: "73%",
    description: "Best-in-the-world academic knowledge, Jun 2024",
    context: "When MMLU-Pro launched, GPT-4o scored 72.6%",
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
  // Load benchmark scores
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

  // Load cost data
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

// ─── Stat functions (ported from app.js) ─────────────────────

function getLatestScore(scoresArray, maxIdx) {
  for (let i = maxIdx; i >= 0; i--) {
    if (scoresArray[i]) return { score: scoresArray[i].score, model: scoresArray[i].model };
  }
  return null;
}

function computeFrontierGrowth(startIdx, endIdx) {
  const labKeys = Object.keys(LABS);
  const results = [];
  for (const [benchKey, bench] of Object.entries(BENCHMARKS)) {
    let startMax = null, endMax = null;
    for (const labKey of labKeys) {
      const s = getLatestScore(bench.scores[labKey], startIdx);
      const e = getLatestScore(bench.scores[labKey], endIdx);
      if (s && (startMax === null || s.score > startMax)) startMax = s.score;
      if (e && (endMax === null || e.score > endMax)) endMax = e.score;
    }
    if (startMax === null || endMax === null || startMax === 0) continue;
    const growth = Math.round(((endMax - startMax) / startMax) * 1000) / 10;
    results.push({
      benchmark: bench.name,
      description: bench.description.split(" \u2014 ")[0],
      startScore: startMax,
      endScore: endMax,
      growthPct: growth,
    });
  }
  results.sort((a, b) => b.growthPct - a.growthPct);
  const avg = results.length > 0 ? Math.round((results.reduce((s, r) => s + r.growthPct, 0) / results.length) * 10) / 10 : 0;
  return { benchmarks: results, avgGrowthPct: avg, biggestMover: results[0] || null };
}

function computeRankings(startIdx, endIdx) {
  const labKeys = Object.keys(LABS);
  const benchKeys = Object.keys(BENCHMARKS);

  function rankAtIndex(idx) {
    const perLab = {};
    for (const labKey of labKeys) perLab[labKey] = { ranks: [], firsts: 0, detail: {} };

    for (const benchKey of benchKeys) {
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

  let biggestLoser = null, biggestDrop = -Infinity;
  for (const [labKey, endData] of Object.entries(endRanks)) {
    const startData = startRanks[labKey];
    if (!startData) continue;
    const drop = endData.avgRank - startData.avgRank;
    if (drop > biggestDrop) { biggestDrop = drop; biggestLoser = labKey; }
  }
  if (biggestDrop <= 0) biggestLoser = null;

  return {
    leader: leader ? {
      lab: LABS[leader].name,
      labKey: leader,
      startAvgRank: startRanks[leader] ? startRanks[leader].avgRank : null,
      startFirsts: startRanks[leader] ? startRanks[leader].firsts : 0,
      endAvgRank: endRanks[leader].avgRank,
      endFirsts: endRanks[leader].firsts,
      detail: endRanks[leader].detail,
    } : null,
    biggestLoser: biggestLoser ? {
      lab: LABS[biggestLoser].name,
      labKey: biggestLoser,
      startAvgRank: startRanks[biggestLoser].avgRank,
      startFirsts: startRanks[biggestLoser].firsts,
      endAvgRank: endRanks[biggestLoser].avgRank,
      endFirsts: endRanks[biggestLoser].firsts,
      detail: endRanks[biggestLoser].detail,
    } : null,
  };
}

function computeCostDecline(startIdx, endIdx) {
  const results = [];
  for (const [benchKey, meta] of Object.entries(COST_BENCHMARK_META)) {
    const data = COST_DATA[benchKey];
    if (!data) continue;

    let startEntry = null, endEntry = null;
    for (let i = startIdx; i >= 0; i--) {
      if (data.entries[i]) { startEntry = data.entries[i]; break; }
    }
    for (let i = endIdx; i >= 0; i--) {
      if (data.entries[i]) { endEntry = data.entries[i]; break; }
    }

    if (!startEntry || !endEntry || startEntry.price <= 0 || endEntry.price <= 0) {
      results.push({ benchmark: meta.name, threshold: meta.thresholdLabel, cheaperMultiple: null, description: meta.description, context: meta.context });
      continue;
    }

    const multiple = Math.round((startEntry.price / endEntry.price) * 10) / 10;
    results.push({
      benchmark: meta.name,
      threshold: meta.thresholdLabel,
      startPrice: startEntry.price,
      endPrice: endEntry.price,
      startModel: startEntry.model,
      endModel: endEntry.model,
      cheaperMultiple: multiple,
      description: meta.description,
      context: meta.context,
    });
  }
  return results;
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

  // Year preset like "2023", "2024", etc.
  const year = parseInt(preset);
  if (!isNaN(year)) {
    const q1Label = `Q1 ${year}`;
    const q4Label = `Q4 ${year}`;
    let si = TIME_LABELS.indexOf(q1Label);
    let ei = TIME_LABELS.indexOf(q4Label);
    if (si < 0) si = 0;
    if (ei < 0) ei = endIdx; // partial year — clamp to end
    return { startIdx: si, endIdx: ei };
  }

  return { startIdx: 0, endIdx };
}

function getPresets() {
  // Fixed presets
  const presets = ["all-time", "last-12-months", "last-6-months", "last-3-months"];

  // Year presets from TIME_LABELS
  const years = [...new Set(TIME_LABELS.map(q => q.substring(3)))];
  for (const year of years) {
    presets.push(year);
  }

  return presets;
}

// ─── Analysis generation ─────────────────────────────────────

async function generateAnalysis(preset) {
  const { startIdx, endIdx } = computeQuarterRange(preset);
  const startQ = TIME_LABELS[startIdx];
  const endQ = TIME_LABELS[endIdx];

  const benchmarkData = getDataForRange(startIdx, endIdx);
  const frontierGrowth = computeFrontierGrowth(startIdx, endIdx);
  const rankings = computeRankings(startIdx, endIdx);
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

  const defeatedThisPeriod = [];
  for (const [benchKey, meta] of Object.entries(BENCHMARK_META)) {
    if (!meta.activeUntil) continue;
    if (compareQuarters(meta.activeUntil, startQ) >= 0 && compareQuarters(meta.activeUntil, endQ) <= 0) {
      defeatedThisPeriod.push({
        name: meta.name,
        status: meta.status,
        activeUntil: meta.activeUntil,
        reason: meta.inactiveReason,
      });
    }
  }

  const stats = {
    frontierGrowth,
    leader: rankings.leader,
    biggestLoser: rankings.biggestLoser,
    activeBenchmarkCount: frontierGrowth.benchmarks.length,
    labDataCoverage: labCoverage,
    defeatedThisPeriod,
  };
  const costData = computeCostDecline(startIdx, endIdx);

  const userPrompt = `=== PRE-COMPUTED STATISTICS ===
${JSON.stringify(stats, null, 2)}

=== COST OF INTELLIGENCE ===
${JSON.stringify(costData, null, 2)}

=== RAW BENCHMARK SCORES (${startQ} to ${endQ}) ===
${benchmarkData}`;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  return { analysis: text, startQuarter: startQ, endQuarter: endQ };
}

// ─── Main ────────────────────────────────────────────────────

async function main() {
  console.log("1. Loading data from Supabase...");
  await loadData();
  console.log(`   Loaded ${Object.keys(BENCHMARKS).length} benchmarks, ${Object.keys(COST_DATA).length} cost benchmarks`);
  console.log(`   TIME_LABELS: ${TIME_LABELS[0]} to ${TIME_LABELS[TIME_LABELS.length - 1]} (${TIME_LABELS.length} quarters)\n`);

  const presets = getPresets();
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

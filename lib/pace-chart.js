// lib/pace-chart.js
// Pace of Progress chart aggregation. Pure functions; no Supabase, no DOM.
// Dual-export (CommonJS + browser global) following lib/config.js.

// The 16-benchmark cohort. Listed in capability groups for readability.
const PACE_COHORT = [
  // Coding (5)
  "swe-bench-pro", "swe-bench-verified", "aider-polyglot", "terminal-bench-2-0", "humaneval",
  // Math (3)
  "frontiermath", "aime", "math-l5",
  // Expert Reasoning (3)
  "hle", "gpqa", "mmlu-pro",
  // Novel Problem Solving (3)
  "arc-agi-1", "arc-agi-2", "arc-agi-3",
  // Visual Reasoning (1)
  "mmmu-pro",
  // Computer Use (1)
  "osworld-verified",
];

// Hard-clip: the headline line starts here. Q1 2024 is the first quarter where
// 5 of 6 capabilities have an in-flight reporting benchmark (Computer Use joins
// at Q3 2024 once OSWorld launches). Earlier quarters had too narrow a cohort.
const PACE_CHART_START = "Q1 2024";

// Bar chart window: last N quarters.
const PACE_BAR_WINDOW = 4;

function _compareQuarters(a, b) {
  const [qa, ya] = [parseInt(a[1]), parseInt(a.substring(3))];
  const [qb, yb] = [parseInt(b[1]), parseInt(b.substring(3))];
  return ya !== yb ? ya - yb : qa - qb;
}

// Inclusive lifecycle gate (matches scratch v3 convention): a saturated/deprecated
// benchmark counts in quarter Q if Q <= activeUntil. Different from lib/config's
// `isBenchmarkActive`, which is strict (inactive AT activeUntil) — Pace deliberately
// includes the final saturation quarter so the visible flatline is in the cohort.
function _isInFlightAtQuarter(meta, quarter) {
  if (!meta) return false;
  if (meta.status === "active") return true;
  if (!meta.activeUntil) return false;
  return _compareQuarters(quarter, meta.activeUntil) <= 0;
}

// Frontier score per quarter for one benchmark: max across labs of the pre-computed
// per-lab cumulative-best (already in benchmark_scores). The max-across-labs at each
// quarter is already monotonic because each lab's cell is itself cumulative-best.
function _frontierByQuarter(benchData, timeLabels) {
  const frontier = new Array(timeLabels.length).fill(null);
  let last = null;
  for (let i = 0; i < timeLabels.length; i++) {
    let maxAtQ = null;
    for (const labKey of Object.keys(benchData.scores)) {
      const cell = benchData.scores[labKey][i];
      if (cell && cell.score != null) {
        if (maxAtQ == null || cell.score > maxAtQ) maxAtQ = cell.score;
      }
    }
    if (maxAtQ != null) last = last == null ? maxAtQ : Math.max(last, maxAtQ);
    frontier[i] = last;
  }
  return frontier;
}

/**
 * Compute the Pace of Progress series.
 *
 * @param {Object} params
 * @param {Object} params.BENCHMARKS    - {benchKey: {capability, scores: {lab: [perQuarter]}}}
 * @param {Object} params.BENCHMARK_META- {benchKey: {status, activeUntil, capability}}
 * @param {string[]} params.CAPABILITIES- canonical order, drives bar order
 * @param {string[]} params.TIME_LABELS - ["Q1 2023", ...]
 * @param {string}  params.now          - current quarter, e.g. "Q2 2026"
 * @param {string[]} [params.cohort]    - override the default 16-key cohort
 *
 * @returns {{
 *   lineSeries: Array<{ quarter, value, n, isPartial, contributors }>,
 *   barSeries:  Array<{ capability, value, n, isLowN, contributors }>
 * }}
 */
function computePaceSeries({ BENCHMARKS, BENCHMARK_META, CAPABILITIES, TIME_LABELS, now, cohort }) {
  const COHORT = cohort || PACE_COHORT;

  // Per-benchmark frontier curve.
  const frontierByBench = {};
  for (const benchKey of COHORT) {
    const benchData = BENCHMARKS[benchKey];
    if (!benchData) continue;
    frontierByBench[benchKey] = _frontierByQuarter(benchData, TIME_LABELS);
  }

  // Per-benchmark quarterly delta.
  const deltaByBench = {};
  for (const [benchKey, frontier] of Object.entries(frontierByBench)) {
    const deltas = new Array(TIME_LABELS.length).fill(null);
    for (let i = 1; i < TIME_LABELS.length; i++) {
      if (frontier[i] != null && frontier[i - 1] != null) {
        deltas[i] = +(frontier[i] - frontier[i - 1]).toFixed(2);
      }
    }
    deltaByBench[benchKey] = deltas;
  }

  // Headline line: per-quarter mean delta across in-flight cohort, clipped to PACE_CHART_START.
  const startIdx = TIME_LABELS.indexOf(PACE_CHART_START);
  const lineSeries = [];
  for (let i = Math.max(0, startIdx); i < TIME_LABELS.length; i++) {
    const quarter = TIME_LABELS[i];
    const contributors = [];
    for (const benchKey of COHORT) {
      const meta = BENCHMARK_META[benchKey];
      if (!_isInFlightAtQuarter(meta, quarter)) continue;
      const delta = deltaByBench[benchKey]?.[i];
      if (delta == null) continue;
      contributors.push({ benchKey, delta });
    }
    const n = contributors.length;
    const mean = n > 0
      ? +(contributors.reduce((s, c) => s + c.delta, 0) / n).toFixed(2)
      : null;
    lineSeries.push({
      quarter,
      value: mean,
      n,
      isPartial: quarter === now,
      contributors,
    });
  }

  // Bar chart: per-capability mean over the trailing 4 quarters.
  const nowIdx = TIME_LABELS.indexOf(now);
  const windowQuarters = [];
  for (let offset = PACE_BAR_WINDOW - 1; offset >= 0; offset--) {
    const idx = nowIdx - offset;
    if (idx >= 0) windowQuarters.push(TIME_LABELS[idx]);
  }

  const barSeries = [];
  for (const capability of CAPABILITIES) {
    const cohortInCap = COHORT.filter(b => BENCHMARK_META[b]?.capability === capability);
    const deltas = [];
    for (const benchKey of cohortInCap) {
      const meta = BENCHMARK_META[benchKey];
      for (const quarter of windowQuarters) {
        if (!_isInFlightAtQuarter(meta, quarter)) continue;
        const qIdx = TIME_LABELS.indexOf(quarter);
        const delta = deltaByBench[benchKey]?.[qIdx];
        if (delta == null) continue;
        deltas.push(delta);
      }
    }
    const value = deltas.length > 0
      ? +(deltas.reduce((s, d) => s + d, 0) / deltas.length).toFixed(2)
      : 0;
    barSeries.push({
      capability,
      value,
      n: cohortInCap.length,
      isLowN: cohortInCap.length === 1,
      contributors: cohortInCap,
    });
  }

  return { lineSeries, barSeries };
}

const _paceChart = {
  PACE_COHORT,
  PACE_CHART_START,
  PACE_BAR_WINDOW,
  computePaceSeries,
};

if (typeof module !== "undefined" && module.exports) module.exports = _paceChart;
if (typeof window !== "undefined") Object.assign(window, _paceChart);

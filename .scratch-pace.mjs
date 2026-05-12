// Exploratory pace-of-change analysis.
// Pulls cumulative-best frontier scores per benchmark per quarter from Supabase,
// computes several pace framings, and writes an HTML report with Chart.js charts.
// Scratch file — delete after use.

import fs from 'node:fs/promises';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jtrhsqdfevyqzzjjvcdr.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_KEY) {
  console.error('Set SUPABASE_SERVICE_KEY env var (or source .env). See MEMORY.md for the key.');
  process.exit(1);
}

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'User-Agent': 'node-fetch/1.0',
};

const BENCHMARK_LABELS = {
  'aime': 'AIME (OTIS Mock)',
  'arc-agi-1': 'ARC-AGI-1',
  'arc-agi-2': 'ARC-AGI-2',
  'arc-agi-3': 'ARC-AGI-3',
  'frontiermath': 'FrontierMath',
  'gpqa': 'GPQA Diamond',
  'hle': 'Humanity\'s Last Exam',
  'humaneval': 'HumanEval',
  'math-l5': 'MATH Level 5',
  'osworld-verified': 'OSWorld-Verified',
  'swe-bench-pro': 'SWE-bench Pro',
  'swe-bench-verified': 'SWE-bench Verified',
};

const STATUS = {
  'gpqa': 'saturated',
  'aime': 'saturated',
  'humaneval': 'saturated',
  'math-l5': 'saturated',
  'arc-agi-1': 'deprecated',
  'swe-bench-verified': 'saturated',
  'arc-agi-2': 'active',
  'arc-agi-3': 'active',
  'hle': 'active',
  'swe-bench-pro': 'active',
  'frontiermath': 'active',
  'osworld-verified': 'active',
};

const COLORS = {
  'gpqa': '#a855f7',
  'aime': '#f59e0b',
  'humaneval': '#94a3b8',
  'math-l5': '#fbbf24',
  'arc-agi-1': '#cbd5e1',
  'swe-bench-verified': '#22d3ee',
  'arc-agi-2': '#ef4444',
  'arc-agi-3': '#dc2626',
  'hle': '#3b82f6',
  'swe-bench-pro': '#2dd4bf',
  'frontiermath': '#10b981',
  'osworld-verified': '#f97316',
};

function parseQuarter(q) {
  const m = q.match(/Q(\d) (\d{4})/);
  if (!m) return null;
  const quarter = parseInt(m[1], 10);
  const year = parseInt(m[2], 10);
  return year * 4 + (quarter - 1);
}

function fmtQuarter(idx) {
  const year = Math.floor(idx / 4);
  const q = (idx % 4) + 1;
  return `Q${q} ${year}`;
}

async function fetchAllScores() {
  const all = [];
  let offset = 0;
  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/benchmark_scores?select=benchmark,lab,quarter,score&score=not.is.null&limit=1000&offset=${offset}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }
  return all;
}

function buildFrontierSeries(scores) {
  // Per benchmark, take max score across labs per quarter.
  // Then enforce monotonic-non-decreasing (cumulative best) over time.
  const byBench = {};
  for (const row of scores) {
    if (row.score == null) continue;
    const qIdx = parseQuarter(row.quarter);
    if (qIdx == null) continue;
    if (!byBench[row.benchmark]) byBench[row.benchmark] = {};
    const cur = byBench[row.benchmark][qIdx] ?? -Infinity;
    if (row.score > cur) byBench[row.benchmark][qIdx] = row.score;
  }

  const series = {};
  for (const [bench, quarters] of Object.entries(byBench)) {
    const sortedQs = Object.keys(quarters).map(Number).sort((a, b) => a - b);
    if (sortedQs.length === 0) continue;
    const firstQ = sortedQs[0];
    const lastQ = sortedQs[sortedQs.length - 1];
    let last = null;
    const points = [];
    for (let q = firstQ; q <= lastQ; q++) {
      const raw = quarters[q];
      if (raw != null) {
        last = last == null ? raw : Math.max(last, raw);
      }
      if (last != null) points.push({ q, score: last });
    }
    series[bench] = points;
  }
  return series;
}

function computePaceMetrics(series) {
  const out = {};
  for (const [bench, pts] of Object.entries(series)) {
    const labels = pts.map(p => fmtQuarter(p.q));
    const scores = pts.map(p => p.score);
    const quarterlyDelta = scores.map((s, i) => i === 0 ? null : +(s - scores[i-1]).toFixed(2));
    // Rolling 4-quarter average of delta (so noise smooths out)
    const smoothedDelta = quarterlyDelta.map((_, i) => {
      const window = quarterlyDelta.slice(Math.max(0, i-3), i+1).filter(v => v != null);
      if (window.length === 0) return null;
      return +(window.reduce((a, b) => a + b, 0) / window.length).toFixed(2);
    });
    // Error rate = 100 - score (assuming 100-cap; for sub-100 ceilings this is approximate)
    const errorRate = scores.map(s => Math.max(0.1, 100 - s));
    // Error reduction factor per quarter (errorPrev / errorNow). >1 means errors falling.
    const errorReduction = errorRate.map((e, i) => i === 0 ? null : +(errorRate[i-1] / e).toFixed(3));
    // Headroom-closed: what fraction of (100 - prev_score) did we close this quarter?
    const headroomClosed = scores.map((s, i) => {
      if (i === 0) return null;
      const headroomBefore = 100 - scores[i-1];
      if (headroomBefore <= 0) return 0;
      return +(((s - scores[i-1]) / headroomBefore) * 100).toFixed(2);
    });
    out[bench] = { labels, scores, quarterlyDelta, smoothedDelta, errorRate, errorReduction, headroomClosed };
  }
  return out;
}

function summarize(metrics) {
  const rows = [];
  for (const [bench, m] of Object.entries(metrics)) {
    if (m.scores.length < 2) continue;
    const first = m.scores[0];
    const last = m.scores[m.scores.length - 1];
    const span = m.scores.length - 1; // quarters
    const totalDelta = last - first;
    const pointsPerQuarter = totalDelta / span;
    const errFirst = 100 - first;
    const errLast = 100 - last;
    const errReductionTotal = errFirst / Math.max(0.1, errLast);
    // Recent-4-quarter pace vs prior pace
    const last4Delta = m.scores.length >= 5
      ? m.scores[m.scores.length-1] - m.scores[m.scores.length-5]
      : null;
    const prior4Delta = m.scores.length >= 9
      ? m.scores[m.scores.length-5] - m.scores[m.scores.length-9]
      : null;
    rows.push({
      bench,
      status: STATUS[bench],
      span,
      firstQ: m.labels[0],
      lastQ: m.labels[m.labels.length-1],
      first: first.toFixed(1),
      last: last.toFixed(1),
      totalDelta: totalDelta.toFixed(1),
      pointsPerQuarter: pointsPerQuarter.toFixed(2),
      errFirst: errFirst.toFixed(1),
      errLast: errLast.toFixed(1),
      errReductionTotal: errReductionTotal.toFixed(1) + 'x',
      last4Delta: last4Delta?.toFixed(1) ?? '—',
      prior4Delta: prior4Delta?.toFixed(1) ?? '—',
      accel: last4Delta != null && prior4Delta != null
        ? (last4Delta > prior4Delta + 1 ? '↑' : last4Delta < prior4Delta - 1 ? '↓' : '=')
        : '?',
    });
  }
  return rows.sort((a, b) => parseFloat(b.last) - parseFloat(a.last));
}

function buildHtml(metrics, summary) {
  const benchOrder = ['humaneval', 'math-l5', 'arc-agi-1', 'aime', 'swe-bench-verified', 'gpqa', 'arc-agi-2', 'hle', 'swe-bench-pro', 'frontiermath', 'osworld-verified', 'arc-agi-3'];
  const orderedBenches = benchOrder.filter(b => metrics[b]);

  // Build a common quarter axis (min to max across all)
  const allQs = new Set();
  for (const m of Object.values(metrics)) for (const l of m.labels) allQs.add(l);
  const allQsSorted = [...allQs].sort((a, b) => parseQuarter(a) - parseQuarter(b));

  function alignSeries(bench, key) {
    const m = metrics[bench];
    const lookup = {};
    m.labels.forEach((l, i) => { lookup[l] = m[key][i]; });
    return allQsSorted.map(l => lookup[l] ?? null);
  }

  function chartDataset(bench, key, opts = {}) {
    return {
      label: BENCHMARK_LABELS[bench] + (STATUS[bench] !== 'active' ? ' *' : ''),
      data: alignSeries(bench, key),
      borderColor: COLORS[bench],
      backgroundColor: COLORS[bench] + '20',
      borderDash: STATUS[bench] === 'active' ? [] : [4, 4],
      borderWidth: STATUS[bench] === 'active' ? 2.5 : 1.5,
      tension: 0.2,
      spanGaps: true,
      pointRadius: 2,
      ...opts,
    };
  }

  const summaryRows = summary.map(r => `
    <tr>
      <td>${BENCHMARK_LABELS[r.bench]}</td>
      <td>${r.status}</td>
      <td>${r.firstQ} → ${r.lastQ}</td>
      <td>${r.first}% → ${r.last}%</td>
      <td>${r.totalDelta}</td>
      <td>${r.pointsPerQuarter}</td>
      <td>${r.errFirst}% → ${r.errLast}%</td>
      <td>${r.errReductionTotal}</td>
      <td>${r.prior4Delta} → ${r.last4Delta} ${r.accel}</td>
    </tr>
  `).join('\n');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Pace of Change — Exploratory Analysis</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  body { background:#0a0a0a; color:#e5e7eb; font:14px/1.5 -apple-system,Segoe UI,sans-serif; max-width:1200px; margin:0 auto; padding:24px; }
  h1 { font-size:22px; margin:0 0 4px; }
  h2 { font-size:17px; margin:32px 0 8px; color:#fbbf24; border-bottom:1px solid #333; padding-bottom:6px; }
  h3 { font-size:14px; margin:18px 0 6px; color:#a3a3a3; font-weight:600; }
  .sub { color:#888; font-size:13px; margin:0 0 24px; }
  .chart-wrap { background:#161616; border:1px solid #2a2a2a; border-radius:8px; padding:16px; margin-bottom:18px; }
  .caption { font-size:12px; color:#9ca3af; margin:8px 0 0; }
  table { border-collapse:collapse; font-size:12px; width:100%; margin:10px 0 20px; }
  th, td { padding:5px 8px; text-align:left; border-bottom:1px solid #2a2a2a; }
  th { background:#1a1a1a; color:#fbbf24; font-weight:600; }
  td { color:#d1d5db; }
  .legend-note { font-size:11px; color:#888; margin:6px 0 14px; }
</style>
</head><body>
<h1>Pace of Change — Exploratory Analysis</h1>
<p class="sub">Real data, frontier (best across labs) per benchmark per quarter. Dashed lines = saturated/deprecated benchmarks.</p>

<h2>Summary table</h2>
<table>
  <thead><tr>
    <th>Benchmark</th><th>Status</th><th>Span</th><th>Score range</th>
    <th>Δ pts (total)</th><th>Pts/quarter</th>
    <th>Error rate range</th><th>Error reduction</th>
    <th>Prior 4Q → Last 4Q (pts)</th>
  </tr></thead>
  <tbody>${summaryRows}</tbody>
</table>
<p class="legend-note">"Error reduction" is errFirst / errLast: 10x = errors are now one-tenth of what they were. "Prior 4Q → Last 4Q" compares the last year's gains to the year before it; arrow shows acceleration (↑), deceleration (↓), or steady (=). "?" means insufficient history.</p>

<h2>Chart 1 — Frontier scores over time (raw)</h2>
<div class="chart-wrap"><canvas id="c1" height="320"></canvas></div>
<p class="caption">Reference view. Same as the current site. Saturated benchmarks crowd toward 100%, active ones are more spread.</p>

<h2>Chart 2 — Quarterly delta, 4-quarter smoothed (raw pace in percentage points)</h2>
<div class="chart-wrap"><canvas id="c2" height="320"></canvas></div>
<p class="caption">Pace measured as points gained per quarter, smoothed over a 4-quarter window. Reads cleanly during breakthrough, collapses to ~0 during saturation. "Plateau" reading lives here.</p>

<h2>Chart 3 — Error rate (100 − score) on log scale</h2>
<div class="chart-wrap"><canvas id="c3" height="320"></canvas></div>
<p class="caption">Same data, flipped. Y-axis is log error rate. A steady downward slope = errors halving at a constant rate. This is where late-stage "still improving" gains reveal themselves.</p>

<h2>Chart 4 — Headroom closed per quarter (% of remaining gap to 100% closed)</h2>
<div class="chart-wrap"><canvas id="c4" height="320"></canvas></div>
<p class="caption">A different lens: ignores absolute points, asks "what fraction of the remaining headroom did this quarter close." Late-stage gains are weighted more.</p>

<h2>Chart 5 — Active benchmarks only, raw scores (zoomed-in view)</h2>
<div class="chart-wrap"><canvas id="c5" height="320"></canvas></div>
<p class="caption">Just the currently active benchmarks, no saturated lines crowding the chart. Shows the actual frontier we're tracking now.</p>

<h2>Chart 6 — Active benchmarks only, error rate on log scale</h2>
<div class="chart-wrap"><canvas id="c6" height="320"></canvas></div>
<p class="caption">Same restriction, log-error view. Helps see whether active benchmarks are entering saturation phase yet.</p>

<script>
const labels = ${JSON.stringify(allQsSorted)};
const allBenches = ${JSON.stringify(orderedBenches)};
const data = ${JSON.stringify(metrics)};
const STATUS_LOCAL = ${JSON.stringify(STATUS)};
const COLORS_LOCAL = ${JSON.stringify(COLORS)};
const LABELS_LOCAL = ${JSON.stringify(BENCHMARK_LABELS)};

function alignSeries(bench, key) {
  const m = data[bench];
  const lookup = {};
  m.labels.forEach((l, i) => { lookup[l] = m[key][i]; });
  return labels.map(l => lookup[l] ?? null);
}

function ds(bench, key, override={}) {
  return {
    label: LABELS_LOCAL[bench] + (STATUS_LOCAL[bench] !== 'active' ? ' *' : ''),
    data: alignSeries(bench, key),
    borderColor: COLORS_LOCAL[bench],
    backgroundColor: COLORS_LOCAL[bench] + '40',
    borderDash: STATUS_LOCAL[bench] === 'active' ? [] : [5, 5],
    borderWidth: STATUS_LOCAL[bench] === 'active' ? 2.5 : 1.5,
    pointRadius: 2,
    tension: 0.15,
    spanGaps: true,
    ...override,
  };
}

const commonOpts = {
  responsive: true,
  plugins: {
    legend: { labels: { color: '#e5e7eb', font: { size: 11 } } },
    tooltip: { mode: 'index', intersect: false },
  },
  scales: {
    x: { ticks: { color: '#9ca3af', font: { size: 10 } }, grid: { color: '#222' } },
    y: { ticks: { color: '#9ca3af' }, grid: { color: '#222' } },
  },
  interaction: { mode: 'nearest', axis: 'x', intersect: false },
};

new Chart(document.getElementById('c1'), {
  type: 'line',
  data: { labels, datasets: allBenches.map(b => ds(b, 'scores')) },
  options: { ...commonOpts, scales: { ...commonOpts.scales, y: { ...commonOpts.scales.y, title: { display: true, text: 'Frontier score (%)', color: '#9ca3af' }, min: 0, max: 100 } } },
});

new Chart(document.getElementById('c2'), {
  type: 'line',
  data: { labels, datasets: allBenches.map(b => ds(b, 'smoothedDelta')) },
  options: { ...commonOpts, scales: { ...commonOpts.scales, y: { ...commonOpts.scales.y, title: { display: true, text: 'Points gained per quarter (4Q avg)', color: '#9ca3af' } } } },
});

new Chart(document.getElementById('c3'), {
  type: 'line',
  data: { labels, datasets: allBenches.map(b => ds(b, 'errorRate')) },
  options: { ...commonOpts, scales: { ...commonOpts.scales, y: { type: 'logarithmic', ticks: { color: '#9ca3af' }, grid: { color: '#222' }, title: { display: true, text: 'Error rate (100 − score, log)', color: '#9ca3af' }, min: 0.1, max: 100 } } },
});

new Chart(document.getElementById('c4'), {
  type: 'line',
  data: { labels, datasets: allBenches.map(b => ds(b, 'headroomClosed')) },
  options: { ...commonOpts, scales: { ...commonOpts.scales, y: { ...commonOpts.scales.y, title: { display: true, text: '% of remaining gap closed this quarter', color: '#9ca3af' } } } },
});

const activeBenches = allBenches.filter(b => STATUS_LOCAL[b] === 'active');

new Chart(document.getElementById('c5'), {
  type: 'line',
  data: { labels, datasets: activeBenches.map(b => ds(b, 'scores')) },
  options: { ...commonOpts, scales: { ...commonOpts.scales, y: { ...commonOpts.scales.y, title: { display: true, text: 'Frontier score (%)', color: '#9ca3af' }, min: 0, max: 100 } } },
});

new Chart(document.getElementById('c6'), {
  type: 'line',
  data: { labels, datasets: activeBenches.map(b => ds(b, 'errorRate')) },
  options: { ...commonOpts, scales: { ...commonOpts.scales, y: { type: 'logarithmic', ticks: { color: '#9ca3af' }, grid: { color: '#222' }, title: { display: true, text: 'Error rate (100 − score, log)', color: '#9ca3af' }, min: 0.1, max: 100 } } },
});
</script>
</body></html>`;
}

function computeInFlightCohort(metrics) {
  // For each quarter, which benchmarks were "in flight" (score between 5% and 90%) at that time?
  // This is the contemporaneous frontier-pushing set: benchmarks where labs were actively making progress.
  const allQs = new Set();
  for (const m of Object.values(metrics)) for (const l of m.labels) allQs.add(l);
  const quarters = [...allQs].sort((a, b) => parseQuarter(a) - parseQuarter(b));

  const inFlight = {};
  for (const q of quarters) {
    inFlight[q] = [];
    for (const [bench, m] of Object.entries(metrics)) {
      const idx = m.labels.indexOf(q);
      if (idx === -1 || idx === 0) continue;
      const prevScore = m.scores[idx - 1];
      if (prevScore >= 5 && prevScore <= 90) {
        inFlight[q].push({ bench, delta: m.quarterlyDelta[idx], errRed: m.errorReduction[idx], score: m.scores[idx] });
      }
    }
  }
  return { quarters, inFlight };
}

function computeClimbTimes(metrics) {
  // For each benchmark: how many quarters from first ≥10% score to first ≥80% score?
  // Tests "is climb time growing over benchmark generations?"
  const out = [];
  for (const [bench, m] of Object.entries(metrics)) {
    const startIdx = m.scores.findIndex(s => s >= 10);
    const endIdx = m.scores.findIndex(s => s >= 80);
    if (startIdx === -1) {
      out.push({ bench, releaseQ: m.labels[0], firstAboveQ: null, first80Q: null, climbQuarters: null });
      continue;
    }
    out.push({
      bench,
      releaseQ: m.labels[0],
      firstAboveQ: m.labels[startIdx],
      first80Q: endIdx === -1 ? null : m.labels[endIdx],
      climbQuarters: endIdx === -1 ? null : endIdx - startIdx,
    });
  }
  return out.sort((a, b) => {
    if (a.firstAboveQ == null) return 1;
    if (b.firstAboveQ == null) return -1;
    return parseQuarter(a.firstAboveQ) - parseQuarter(b.firstAboveQ);
  });
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - pos) + sorted[hi] * (pos - lo);
}

function aggregateInFlight(inFlight) {
  // For each quarter, compute median and mean delta and error reduction across the in-flight cohort.
  const quarters = Object.keys(inFlight).sort((a, b) => parseQuarter(a) - parseQuarter(b));
  function stats(arr) {
    if (arr.length === 0) return { n: 0, mean: null, median: null, p25: null, p75: null };
    const sorted = [...arr].sort((a, b) => a - b);
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const med = quantile(sorted, 0.5);
    const p25 = quantile(sorted, 0.25);
    const p75 = quantile(sorted, 0.75);
    return { n: arr.length, mean: +mean.toFixed(2), median: +med.toFixed(2), p25: +p25.toFixed(2), p75: +p75.toFixed(2) };
  }
  return quarters.map(q => {
    const items = inFlight[q].filter(it => it.delta != null);
    const deltaStats = stats(items.map(it => it.delta));
    const errItems = inFlight[q].filter(it => it.errRed != null && isFinite(it.errRed));
    const errStats = stats(errItems.map(it => it.errRed));
    return { quarter: q, ...deltaStats, deltaMean: deltaStats.mean, deltaMedian: deltaStats.median, deltaP25: deltaStats.p25, deltaP75: deltaStats.p75,
             errMean: errStats.mean, errMedian: errStats.median, members: inFlight[q].map(it => it.bench) };
  });
}

function smoothSeries(values, window = 4) {
  return values.map((_, i) => {
    const sub = values.slice(Math.max(0, i - window + 1), i + 1).filter(v => v != null);
    if (sub.length === 0) return null;
    return +(sub.reduce((a, b) => a + b, 0) / sub.length).toFixed(2);
  });
}

function computeCrossBenchAverages(metrics) {
  // Build a common quarter axis
  const allQs = new Set();
  for (const m of Object.values(metrics)) for (const l of m.labels) allQs.add(l);
  const quarters = [...allQs].sort((a, b) => parseQuarter(a) - parseQuarter(b));

  // For each benchmark, build a quarter -> metric lookup
  function getValueAt(bench, quarter, key) {
    const m = metrics[bench];
    const idx = m.labels.indexOf(quarter);
    if (idx === -1) return null;
    return m[key][idx];
  }

  // Two cohort definitions:
  //   "all" = every benchmark with data + delta that quarter (saturated or not)
  //   "frozenActive" = only the 6 currently-active benchmarks (frozen set)
  const frozenActive = Object.keys(metrics).filter(b => STATUS[b] === 'active');
  const allBench = Object.keys(metrics);

  function aggregate(cohort, key, agg) {
    return quarters.map(q => {
      const vals = cohort.map(b => getValueAt(b, q, key)).filter(v => v != null);
      if (vals.length === 0) return null;
      const sorted = [...vals].sort((a, b) => a - b);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const median = quantile(sorted, 0.5);
      return +(agg === 'mean' ? mean : median).toFixed(3);
    });
  }

  function counts(cohort, key) {
    return quarters.map(q => cohort.filter(b => getValueAt(b, q, key) != null).length);
  }

  return {
    quarters,
    deltaAllMean:        aggregate(allBench, 'quarterlyDelta', 'mean'),
    deltaAllMedian:      aggregate(allBench, 'quarterlyDelta', 'median'),
    deltaFrozenMean:     aggregate(frozenActive, 'quarterlyDelta', 'mean'),
    deltaFrozenMedian:   aggregate(frozenActive, 'quarterlyDelta', 'median'),
    smoothedAllMean:     aggregate(allBench, 'smoothedDelta', 'mean'),
    smoothedFrozenMean:  aggregate(frozenActive, 'smoothedDelta', 'mean'),
    errRedAllMean:       aggregate(allBench, 'errorReduction', 'mean'),
    errRedFrozenMean:    aggregate(frozenActive, 'errorReduction', 'mean'),
    headroomAllMean:     aggregate(allBench, 'headroomClosed', 'mean'),
    headroomFrozenMean:  aggregate(frozenActive, 'headroomClosed', 'mean'),
    nAll:                counts(allBench, 'quarterlyDelta'),
    nFrozen:             counts(frozenActive, 'quarterlyDelta'),
  };
}

function buildAggHtml(metrics, summary, agg) {
  const labels = agg.quarters;
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Pace of Change — Cross-Benchmark Averages</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  body { background:#0a0a0a; color:#e5e7eb; font:14px/1.5 -apple-system,Segoe UI,sans-serif; max-width:1200px; margin:0 auto; padding:24px; }
  h1 { font-size:22px; margin:0 0 4px; }
  h2 { font-size:17px; margin:32px 0 8px; color:#fbbf24; border-bottom:1px solid #333; padding-bottom:6px; }
  .sub { color:#888; font-size:13px; margin:0 0 24px; }
  .chart-wrap { background:#161616; border:1px solid #2a2a2a; border-radius:8px; padding:16px; margin-bottom:18px; }
  .caption { font-size:12px; color:#9ca3af; margin:8px 0 0; }
  table { border-collapse:collapse; font-size:12px; width:100%; margin:10px 0 20px; }
  th, td { padding:5px 8px; text-align:left; border-bottom:1px solid #2a2a2a; }
  th { background:#1a1a1a; color:#fbbf24; font-weight:600; }
  td { color:#d1d5db; }
</style></head><body>
<h1>Pace of Change — Cross-Benchmark Averages</h1>
<p class="sub">Aggregating per quarter across benchmarks. Two cohort definitions: "All benchmarks with data" (mixes saturated + active over time) and "Frozen active set" (just the 6 currently-active, applied retroactively).</p>

<h2>Cohort size per quarter (how many benchmarks went into each average)</h2>
<div class="chart-wrap"><canvas id="cN" height="200"></canvas></div>
<p class="caption">Pre-2024 the averages are 1-2 benchmarks. They get statistically meaningful around late 2024.</p>

<h2>A1 — Average raw delta per quarter (mean across all benchmarks)</h2>
<div class="chart-wrap"><canvas id="cA1" height="320"></canvas></div>
<p class="caption">Single-quarter mean of point gains across the cohort. Volatile but answers "how much did the typical benchmark gain this quarter."</p>

<h2>A2 — Average raw delta per quarter (median across all benchmarks)</h2>
<div class="chart-wrap"><canvas id="cA2" height="320"></canvas></div>
<p class="caption">Same data, median instead of mean. Less affected by single-benchmark outliers.</p>

<h2>A3 — 4Q-smoothed average delta (both cohorts)</h2>
<div class="chart-wrap"><canvas id="cA3" height="320"></canvas></div>
<p class="caption">Same average but with each benchmark's delta already smoothed over 4 quarters before aggregating. Closer to a "trend pace" reading.</p>

<h2>A4 — Average error reduction factor per quarter</h2>
<div class="chart-wrap"><canvas id="cA4" height="320"></canvas></div>
<p class="caption">Mean of (errorPrev / errorNow) across the cohort. Values > 1 = errors falling. A value of 1.5 means the typical benchmark's error rate dropped to 67% of last quarter's.</p>

<h2>A5 — Average % of remaining headroom closed per quarter</h2>
<div class="chart-wrap"><canvas id="cA5" height="320"></canvas></div>
<p class="caption">Mean of "% of gap-to-ceiling closed this quarter" across the cohort. Most-saturation-honest aggregation.</p>

<script>
const labels = ${JSON.stringify(labels)};
const agg = ${JSON.stringify(agg)};

const dsCfg = (label, key, color, dash=[]) => ({
  label, data: agg[key], borderColor: color, backgroundColor: color + '30',
  borderWidth: 2, pointRadius: 2, tension: 0.2, spanGaps: true, borderDash: dash,
});

const common = (yTitle, opts={}) => ({
  responsive: true,
  plugins: { legend: { labels: { color: '#e5e7eb', font: { size: 11 } } } },
  scales: {
    x: { ticks: { color: '#9ca3af', font: { size: 10 } }, grid: { color: '#222' } },
    y: { ticks: { color: '#9ca3af' }, grid: { color: '#222' }, title: { display: true, text: yTitle, color: '#9ca3af' }, ...opts },
  },
  interaction: { mode: 'nearest', axis: 'x', intersect: false },
});

new Chart(document.getElementById('cN'), {
  type: 'bar',
  data: { labels, datasets: [
    { label: 'All (with data)', data: agg.nAll, backgroundColor: '#3b82f6' },
    { label: 'Frozen active set', data: agg.nFrozen, backgroundColor: '#10b981' },
  ]},
  options: common('# benchmarks contributing', { beginAtZero: true }),
});

new Chart(document.getElementById('cA1'), {
  type: 'line',
  data: { labels, datasets: [
    dsCfg('All — mean Δ', 'deltaAllMean', '#3b82f6'),
    dsCfg('Frozen active — mean Δ', 'deltaFrozenMean', '#10b981'),
  ]},
  options: common('Points/quarter (mean)'),
});

new Chart(document.getElementById('cA2'), {
  type: 'line',
  data: { labels, datasets: [
    dsCfg('All — median Δ', 'deltaAllMedian', '#3b82f6'),
    dsCfg('Frozen active — median Δ', 'deltaFrozenMedian', '#10b981'),
  ]},
  options: common('Points/quarter (median)'),
});

new Chart(document.getElementById('cA3'), {
  type: 'line',
  data: { labels, datasets: [
    dsCfg('All — smoothed Δ', 'smoothedAllMean', '#3b82f6'),
    dsCfg('Frozen active — smoothed Δ', 'smoothedFrozenMean', '#10b981'),
  ]},
  options: common('Smoothed pace (pts/quarter, 4Q avg each benchmark first)'),
});

new Chart(document.getElementById('cA4'), {
  type: 'line',
  data: { labels, datasets: [
    dsCfg('All — error-reduction', 'errRedAllMean', '#3b82f6'),
    dsCfg('Frozen active — error-reduction', 'errRedFrozenMean', '#10b981'),
  ]},
  options: common('Avg error reduction factor (>1 = errors falling)'),
});

new Chart(document.getElementById('cA5'), {
  type: 'line',
  data: { labels, datasets: [
    dsCfg('All — % headroom closed', 'headroomAllMean', '#3b82f6'),
    dsCfg('Frozen active — % headroom closed', 'headroomFrozenMean', '#10b981'),
  ]},
  options: common('Avg % of remaining gap closed/quarter'),
});
</script>
</body></html>`;
}

async function main() {
  console.log('Fetching scores...');
  const scores = await fetchAllScores();
  console.log(`Got ${scores.length} score rows`);
  const series = buildFrontierSeries(scores);
  const metrics = computePaceMetrics(series);
  const summary = summarize(metrics);
  const agg = computeCrossBenchAverages(metrics);

  console.log('\nPer-benchmark summary:');
  console.table(summary);

  console.log('\nCross-benchmark aggregates (last 10 quarters):');
  const tail = agg.quarters.length - 10;
  const aggTable = agg.quarters.slice(tail).map((q, i) => ({
    quarter: q,
    nAll: agg.nAll[tail+i],
    nFrozen: agg.nFrozen[tail+i],
    deltaAllMean: agg.deltaAllMean[tail+i],
    deltaFrozenMean: agg.deltaFrozenMean[tail+i],
    smoothedFrozenMean: agg.smoothedFrozenMean[tail+i],
    errRedFrozenMean: agg.errRedFrozenMean[tail+i],
    headroomFrozenMean: agg.headroomFrozenMean[tail+i],
  }));
  console.table(aggTable);

  const { quarters: ifQuarters, inFlight } = computeInFlightCohort(metrics);
  const inFlightAgg = aggregateInFlight(inFlight);
  const climb = computeClimbTimes(metrics);

  console.log('\nIn-flight cohort per quarter (score 5-90% at quarter start):');
  console.table(inFlightAgg.map(r => ({
    quarter: r.quarter, n: r.n,
    'Δ mean': r.deltaMean, 'Δ median': r.deltaMedian, 'Δ p25': r.deltaP25, 'Δ p75': r.deltaP75,
    'err mean': r.errMean, 'err median': r.errMedian,
    members: r.members.join(', '),
  })));

  console.log('\nClimb times (release → first 80%):');
  console.table(climb);

  // Add smoothed series
  inFlightAgg.forEach((r, i, arr) => {
    const window4 = arr.slice(Math.max(0, i - 3), i + 1);
    const validMed = window4.map(x => x.deltaMedian).filter(v => v != null);
    const validMean = window4.map(x => x.deltaMean).filter(v => v != null);
    const validErr = window4.map(x => x.errMedian).filter(v => v != null);
    r.deltaMedianSmoothed = validMed.length ? +(validMed.reduce((a,b)=>a+b,0)/validMed.length).toFixed(2) : null;
    r.deltaMeanSmoothed = validMean.length ? +(validMean.reduce((a,b)=>a+b,0)/validMean.length).toFixed(2) : null;
    r.errMedianSmoothed = validErr.length ? +(validErr.reduce((a,b)=>a+b,0)/validErr.length).toFixed(3) : null;
  });

  const html = buildHtml(metrics, summary);
  await fs.writeFile('.scratch-pace.html', html);
  console.log('\nWrote .scratch-pace.html');

  const aggHtml = buildAggHtml(metrics, summary, agg);
  await fs.writeFile('.scratch-pace-agg.html', aggHtml);
  console.log('Wrote .scratch-pace-agg.html');

  const focusHtml = buildFocusHtml(inFlightAgg, climb);
  await fs.writeFile('.scratch-pace-focus.html', focusHtml);
  console.log('Wrote .scratch-pace-focus.html');

  await fs.writeFile('.scratch-pace.json', JSON.stringify({ metrics, summary, agg, inFlightAgg, climb }, null, 2));
  console.log('Wrote .scratch-pace.json');
}

function buildFocusHtml(inFlightAgg, climb) {
  const labels = inFlightAgg.map(r => r.quarter);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Pace of Change — Focused Signals</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  body { background:#0a0a0a; color:#e5e7eb; font:14px/1.5 -apple-system,Segoe UI,sans-serif; max-width:1100px; margin:0 auto; padding:24px; }
  h1 { font-size:22px; margin:0 0 4px; }
  h2 { font-size:17px; margin:32px 0 8px; color:#fbbf24; border-bottom:1px solid #333; padding-bottom:6px; }
  h3 { font-size:14px; margin:18px 0 6px; color:#a3a3a3; font-weight:600; }
  .sub { color:#888; font-size:13px; margin:0 0 24px; }
  .chart-wrap { background:#161616; border:1px solid #2a2a2a; border-radius:8px; padding:16px; margin-bottom:18px; }
  .caption { font-size:12px; color:#9ca3af; margin:8px 0 0; }
  table { border-collapse:collapse; font-size:12px; width:100%; margin:10px 0 20px; }
  th, td { padding:5px 8px; text-align:left; border-bottom:1px solid #2a2a2a; }
  th { background:#1a1a1a; color:#fbbf24; font-weight:600; }
  td { color:#d1d5db; }
  .members { font-size:10px; color:#666; }
</style></head><body>
<h1>Pace of Change — Focused Signals</h1>
<p class="sub">Contemporaneous "in-flight" cohort: benchmarks whose previous quarter's score was between 5% and 90% — i.e. benchmarks where labs were actively pushing progress, not benchmarks at floor or near saturation. This avoids the "frozen active set" selection bias.</p>

<h2>Headline — Median pace across in-flight benchmarks (smoothed)</h2>
<div class="chart-wrap"><canvas id="cMain" height="350"></canvas></div>
<p class="caption">Single line, single number. "How fast did the median in-flight frontier benchmark improve, per quarter, smoothed over 4 quarters." This is the cleanest single-signal candidate.</p>

<h2>Mean vs Median — does the choice matter?</h2>
<div class="chart-wrap"><canvas id="cMM" height="350"></canvas></div>
<p class="caption">Mean is more sensitive to single benchmarks jumping a lot (e.g., ARC-AGI-2 +30 in one quarter). Median tells you the typical benchmark behaviour. Where the two diverge, you're getting a fingerprint of outlier dynamics.</p>

<h2>Dispersion — IQR (p25 to p75) per quarter</h2>
<div class="chart-wrap"><canvas id="cIQR" height="350"></canvas></div>
<p class="caption">Shaded band shows interquartile range. Tight band = labs are pushing all benchmarks at similar rates. Wide band = some benchmarks racing while others stall.</p>

<h2>Error reduction — median error-reduction factor per quarter (smoothed)</h2>
<div class="chart-wrap"><canvas id="cErr" height="350"></canvas></div>
<p class="caption">>1.0 means the median in-flight benchmark's error rate fell that quarter. 1.25 = errors dropped to 80% of last quarter's. This is the late-stage-honest version.</p>

<h2>Time to climb — quarters from first 10% to first 80% per benchmark</h2>
<div class="chart-wrap"><canvas id="cClimb" height="320"></canvas></div>
<p class="caption">Ordered by release. If labs are slowing, climb times grow over benchmark generations. If they're keeping pace, climb times stay flat or shrink.</p>

<h2>Cohort detail (which benchmarks were in flight each quarter)</h2>
<table>
<thead><tr><th>Quarter</th><th>n</th><th>Δ median</th><th>Δ mean</th><th>Smoothed median</th><th>Err median</th><th>Members</th></tr></thead>
<tbody>
${inFlightAgg.filter(r => r.n > 0).map(r => `<tr><td>${r.quarter}</td><td>${r.n}</td><td>${r.deltaMedian ?? '—'}</td><td>${r.deltaMean ?? '—'}</td><td>${r.deltaMedianSmoothed ?? '—'}</td><td>${r.errMedian ?? '—'}</td><td class="members">${r.members.join(', ')}</td></tr>`).join('')}
</tbody>
</table>

<script>
const labels = ${JSON.stringify(labels)};
const data = ${JSON.stringify(inFlightAgg)};
const climb = ${JSON.stringify(climb)};

const common = (yTitle, opts={}) => ({
  responsive: true,
  plugins: { legend: { labels: { color: '#e5e7eb', font: { size: 11 } } } },
  scales: {
    x: { ticks: { color: '#9ca3af', font: { size: 10 } }, grid: { color: '#222' } },
    y: { ticks: { color: '#9ca3af' }, grid: { color: '#222' }, title: { display: true, text: yTitle, color: '#9ca3af' }, ...opts },
  },
  interaction: { mode: 'nearest', axis: 'x', intersect: false },
});

new Chart(document.getElementById('cMain'), {
  type: 'line',
  data: { labels, datasets: [
    { label: 'Median Δ (4Q smoothed)', data: data.map(r => r.deltaMedianSmoothed), borderColor: '#10b981', backgroundColor: '#10b98140', borderWidth: 3, tension: 0.2, pointRadius: 3, spanGaps: true },
    { label: 'Median Δ (quarter)', data: data.map(r => r.deltaMedian), borderColor: '#10b98180', borderWidth: 1, tension: 0.1, pointRadius: 1, borderDash: [3,3], spanGaps: true },
  ]},
  options: common('Points/quarter (median, in-flight cohort)', { beginAtZero: true }),
});

new Chart(document.getElementById('cMM'), {
  type: 'line',
  data: { labels, datasets: [
    { label: 'Mean Δ', data: data.map(r => r.deltaMean), borderColor: '#3b82f6', borderWidth: 2, tension: 0.2, pointRadius: 2, spanGaps: true },
    { label: 'Median Δ', data: data.map(r => r.deltaMedian), borderColor: '#10b981', borderWidth: 2, tension: 0.2, pointRadius: 2, spanGaps: true },
  ]},
  options: common('Points/quarter (in-flight)', { beginAtZero: true }),
});

new Chart(document.getElementById('cIQR'), {
  type: 'line',
  data: { labels, datasets: [
    { label: 'p75 (top quartile)', data: data.map(r => r.deltaP75), borderColor: '#94a3b8', borderWidth: 1, fill: '+1', backgroundColor: '#94a3b830', tension: 0.2, pointRadius: 1, spanGaps: true },
    { label: 'p25 (bottom quartile)', data: data.map(r => r.deltaP25), borderColor: '#94a3b8', borderWidth: 1, tension: 0.2, pointRadius: 1, spanGaps: true },
    { label: 'Median', data: data.map(r => r.deltaMedian), borderColor: '#10b981', borderWidth: 2.5, tension: 0.2, pointRadius: 3, spanGaps: true },
  ]},
  options: common('Δ points/quarter (in-flight)', { beginAtZero: true }),
});

new Chart(document.getElementById('cErr'), {
  type: 'line',
  data: { labels, datasets: [
    { label: 'Median err-reduction (4Q smoothed)', data: data.map(r => r.errMedianSmoothed), borderColor: '#f59e0b', borderWidth: 3, tension: 0.2, pointRadius: 3, spanGaps: true },
    { label: 'Median err-reduction (quarter)', data: data.map(r => r.errMedian), borderColor: '#f59e0b80', borderWidth: 1, tension: 0.1, pointRadius: 1, borderDash: [3,3], spanGaps: true },
  ]},
  options: common('Median error-reduction factor (>1 = errors falling)'),
});

new Chart(document.getElementById('cClimb'), {
  type: 'bar',
  data: {
    labels: climb.filter(c => c.climbQuarters != null).map(c => c.bench),
    datasets: [{
      label: 'Quarters from first ≥10% to first ≥80%',
      data: climb.filter(c => c.climbQuarters != null).map(c => c.climbQuarters),
      backgroundColor: '#3b82f6',
    }],
  },
  options: common('Quarters', { beginAtZero: true }),
});
</script>
</body></html>`;
}

main().catch(err => { console.error(err); process.exit(1); });

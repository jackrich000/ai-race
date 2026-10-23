// data-loader.js
// Loads benchmark data from the static snapshot in data/ and exposes the same
// BENCHMARKS, COST_DATA globals that app.js expects.
// Shared config (LABS, BENCHMARK_META, etc.) comes from lib/config.js.

// ─── Snapshot (site paused Oct 2026) ────────────────────────────
// data/*.json are exports of the Supabase tables (benchmark_scores,
// cost_intelligence, cached_analyses) taken 2026-10-23, the last pipeline run.
// The pipeline and migrations still target Supabase; to resume live updates,
// point these loaders back at the Supabase REST API (see git history).

let BENCHMARKS = {};
let COST_DATA = {};
let costLoadFailed = false;

async function loadSnapshot(name) {
  const response = await fetch(`data/${name}.json`);
  if (!response.ok) {
    throw new Error(`Snapshot fetch failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function loadBenchmarkScores() {
  const rows = await loadSnapshot("benchmark_scores");

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

    // Fill in actual scores from the snapshot (objects with score + model)
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
              // SQL column model_variant → in-memory field variant. ?? null tolerates pre-migration rows.
              variant: row.model_variant ?? null,
            }
          : null;
      }
    }

    BENCHMARKS[benchKey] = { ...meta, scores };
  }
}

async function loadCostData() {
  let rows;
  try {
    rows = await loadSnapshot("cost_intelligence");
  } catch (err) {
    console.warn("Cost data fetch failed:", err.message);
    costLoadFailed = true;
    return;
  }

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

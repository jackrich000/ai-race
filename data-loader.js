// data-loader.js
// Fetches live benchmark data from Supabase and exposes the same
// BENCHMARKS, COST_DATA globals that app.js expects.
// Shared config (LABS, BENCHMARK_META, etc.) comes from lib/config.js.

// ─── Supabase config (anon key is safe to expose — RLS allows read only) ───
const SUPABASE_URL = "https://jtrhsqdfevyqzzjjvcdr.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_NW3JPCH8VQ0_ym-UFnGavw_JCVcDDp9";

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

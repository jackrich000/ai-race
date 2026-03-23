// scripts/migrate-model-cards.js
// One-time migration: inserts existing hardcoded MODEL_CARD_DATA entries into
// benchmark_raw with source_url and raw_benchmark_name backfilled.
// Safe to re-run (uses upsert on benchmark,lab,model,source).
//
// Usage:
//   SUPABASE_SERVICE_KEY=xxx node scripts/migrate-model-cards.js

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://jtrhsqdfevyqzzjjvcdr.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error("Error: Set SUPABASE_SERVICE_KEY environment variable.");
  process.exit(1);
}

// Blog post URLs per model release (source of each model card entry)
const SOURCE_URLS = {
  "GPT-5.4":          "https://openai.com/index/introducing-gpt-5-4/",
  "Claude Sonnet 4.6": "https://www.anthropic.com/claude/sonnet",
  "Claude Opus 4.6":  "https://www.anthropic.com/news/claude-opus-4-6",
  "Gemini 3 Deep Think": "https://blog.google/technology/google-deepmind/gemini-3-deep-think/",
  "Gemini 3.1 Pro":   "https://blog.google/technology/google-deepmind/gemini-3-1-pro/",
};

// Raw benchmark names as they appear on model cards
const RAW_BENCHMARK_NAMES = {
  "hle":        "Humanity's Last Exam",
  "gpqa":       "GPQA Diamond",
  "arc-agi-2":  "ARC-AGI-2",
  "arc-agi-1":  "ARC-AGI-1",
  "swe-bench-verified":  "SWE-bench Verified",
};

// The 17 hardcoded model card entries (same data as MODEL_CARD_DATA in update-data.js)
const ENTRIES = [
  // GPT-5.4
  { benchmark: "hle", lab: "openai", model: "GPT-5.4 Pro (with tools)", score: 58.7, date: "2026-03-05", modelFamily: "GPT-5.4" },
  { benchmark: "gpqa", lab: "openai", model: "GPT-5.4 Pro", score: 94.4, date: "2026-03-05", modelFamily: "GPT-5.4" },
  { benchmark: "arc-agi-2", lab: "openai", model: "GPT-5.4 Pro", score: 83.3, date: "2026-03-05", modelFamily: "GPT-5.4" },
  { benchmark: "arc-agi-1", lab: "openai", model: "GPT-5.4 Pro", score: 94.5, date: "2026-03-05", modelFamily: "GPT-5.4" },

  // Claude Sonnet 4.6
  { benchmark: "gpqa", lab: "anthropic", model: "Claude Sonnet 4.6", score: 89.9, date: "2026-02-17", modelFamily: "Claude Sonnet 4.6" },
  { benchmark: "swe-bench-verified", lab: "anthropic", model: "Claude Sonnet 4.6", score: 79.6, date: "2026-02-17", modelFamily: "Claude Sonnet 4.6" },
  { benchmark: "arc-agi-2", lab: "anthropic", model: "Claude Sonnet 4.6", score: 58.3, date: "2026-02-17", modelFamily: "Claude Sonnet 4.6" },
  { benchmark: "hle", lab: "anthropic", model: "Claude Sonnet 4.6 (with tools)", score: 49.0, date: "2026-02-17", modelFamily: "Claude Sonnet 4.6" },

  // Claude Opus 4.6
  { benchmark: "gpqa", lab: "anthropic", model: "Claude Opus 4.6", score: 91.3, date: "2026-03-01", modelFamily: "Claude Opus 4.6" },
  { benchmark: "swe-bench-verified", lab: "anthropic", model: "Claude Opus 4.6", score: 80.8, date: "2026-03-01", modelFamily: "Claude Opus 4.6" },
  { benchmark: "hle", lab: "anthropic", model: "Claude Opus 4.6 (with tools)", score: 53.0, date: "2026-03-01", modelFamily: "Claude Opus 4.6" },
  { benchmark: "arc-agi-2", lab: "anthropic", model: "Claude Opus 4.6", score: 68.8, date: "2026-03-01", modelFamily: "Claude Opus 4.6" },

  // Gemini 3 Deep Think
  { benchmark: "hle", lab: "google", model: "Gemini 3 Deep Think (with tools)", score: 53.4, date: "2026-02-12", modelFamily: "Gemini 3 Deep Think" },
  { benchmark: "hle", lab: "google", model: "Gemini 3 Deep Think", score: 48.4, date: "2026-02-12", modelFamily: "Gemini 3 Deep Think" },
  { benchmark: "arc-agi-2", lab: "google", model: "Gemini 3 Deep Think", score: 84.6, date: "2026-02-12", modelFamily: "Gemini 3 Deep Think" },

  // Gemini 3.1 Pro
  { benchmark: "gpqa", lab: "google", model: "Gemini 3.1 Pro", score: 94.3, date: "2026-02-19", modelFamily: "Gemini 3.1 Pro" },
  { benchmark: "hle", lab: "google", model: "Gemini 3.1 Pro (with tools)", score: 51.4, date: "2026-02-19", modelFamily: "Gemini 3.1 Pro" },
  { benchmark: "hle", lab: "google", model: "Gemini 3.1 Pro", score: 44.4, date: "2026-02-19", modelFamily: "Gemini 3.1 Pro" },
  { benchmark: "arc-agi-2", lab: "google", model: "Gemini 3.1 Pro", score: 77.1, date: "2026-02-19", modelFamily: "Gemini 3.1 Pro" },
];

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const rows = ENTRIES.map(e => ({
    benchmark: e.benchmark,
    lab: e.lab,
    model: e.model,
    score: e.score,
    date: e.date,
    source: "model_card",
    verified: false,
    source_url: SOURCE_URLS[e.modelFamily] || null,
    raw_benchmark_name: RAW_BENCHMARK_NAMES[e.benchmark] || null,
    extracted_at: new Date().toISOString(),
  }));

  console.log(`Upserting ${rows.length} model card entries to benchmark_raw...`);

  const { error } = await supabase
    .from("benchmark_raw")
    .upsert(rows, { onConflict: "benchmark,lab,model,source" });

  if (error) {
    console.error("Upsert FAILED:", error.message);
    process.exit(1);
  }

  console.log(`Done. ${rows.length} rows upserted.`);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});

-- Migration 006: Add model_variant to benchmark_scores.
-- Carries evaluation-condition qualifier (e.g., "with tools") from benchmark_raw
-- through cumulative-best aggregation to the site tooltip.
-- Run in Supabase SQL editor.

ALTER TABLE benchmark_scores ADD COLUMN IF NOT EXISTS model_variant TEXT;

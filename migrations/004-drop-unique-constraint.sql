-- Migration 004: Drop unique constraint on benchmark_raw.
-- The pipeline now uses delete + insert (by source_url) instead of upsert,
-- so the constraint is no longer needed and blocks rows with different model_variant.
-- Run in Supabase SQL editor.

ALTER TABLE benchmark_raw DROP CONSTRAINT IF EXISTS benchmark_raw_benchmark_lab_model_source_key;

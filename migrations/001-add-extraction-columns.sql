-- Migration 001: Add columns for automated model card extraction pipeline.
-- Run in Supabase SQL editor.

ALTER TABLE benchmark_raw ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE benchmark_raw ADD COLUMN IF NOT EXISTS raw_benchmark_name TEXT;
ALTER TABLE benchmark_raw ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ DEFAULT NOW();

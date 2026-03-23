-- Migration 003: Add model_variant and triage_status columns to benchmark_raw.
-- model_variant: evaluation qualifier (e.g., "with tools", "without tools")
-- triage_status: extraction pipeline triage decision (ingest/reject/flag/null for untracked)
-- Run in Supabase SQL editor.

ALTER TABLE benchmark_raw ADD COLUMN IF NOT EXISTS model_variant TEXT;
ALTER TABLE benchmark_raw ADD COLUMN IF NOT EXISTS triage_status TEXT;

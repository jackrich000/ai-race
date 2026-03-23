-- Migration 005: Add triage_reason column to benchmark_raw.
-- Stores the human-readable reason for triage decisions (ingest/flag/reject),
-- so the combined pipeline report can show why scores were flagged or rejected.
-- Run in Supabase SQL editor.

ALTER TABLE benchmark_raw ADD COLUMN IF NOT EXISTS triage_reason TEXT;

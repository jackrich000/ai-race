-- Migration 007: Per-run, per-lab extraction stats for streak alerting.
-- Detects gradual silent decay (RSS format change, page restructure, source going dark)
-- by tracking scraped-article counts per lab over consecutive pipeline runs.
-- Applied via scripts/apply-migrations.mjs (npm run migrate).

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_started_at TIMESTAMPTZ NOT NULL,
  lab TEXT NOT NULL,
  articles_scraped INTEGER NOT NULL DEFAULT 0,
  scores_yielded INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pipeline_runs_run_lab_unique UNIQUE (run_started_at, lab)
);

CREATE INDEX IF NOT EXISTS pipeline_runs_lab_started_idx
  ON pipeline_runs (lab, run_started_at DESC);

ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read pipeline_runs" ON pipeline_runs;
CREATE POLICY "Anyone can read pipeline_runs"
  ON pipeline_runs
  FOR SELECT
  USING (true);
-- No INSERT policy needed: service_role bypasses RLS.

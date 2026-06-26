-- Migration 009: Add scores_extracted to pipeline_runs for sharper streak alerts.
-- The original streak alert ("no_scores") fired when articles_scraped>0 but
-- scores_yielded=0 — but scores_yielded only counts tracked-and-ingested scores, so
-- a lab publishing rich posts full of *untracked* benchmarks (voice, cyber, bio,
-- agentic) tripped a false "extraction broken" alarm. scores_extracted counts every
-- score the LLM pulled from a page before triage, which lets detectStreakAlerts tell
-- a genuine parse failure (extracted=0) apart from "healthy extraction, nothing on a
-- tracked benchmark" (extracted>0, yielded=0).
--
-- Deliberately NULLable with no default: existing rows stay NULL ("unknown"), so the
-- new no_extraction / untracked_only rules can't fire on pre-migration history and
-- won't resurrect the old false alarm during the ~4-run bootstrap.
-- Applied via scripts/apply-migrations.mjs (npm run migrate).

ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS scores_extracted INTEGER;

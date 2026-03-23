-- Migration 002: Rename benchmark key "swe-bench" to "swe-bench-verified".
-- Avoids confusion with "swe-bench-pro" (a different benchmark).
-- Run in Supabase SQL editor.

UPDATE benchmark_scores SET benchmark = 'swe-bench-verified' WHERE benchmark = 'swe-bench';
UPDATE benchmark_raw SET benchmark = 'swe-bench-verified' WHERE benchmark = 'swe-bench';

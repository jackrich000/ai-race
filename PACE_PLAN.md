# Pace of Change chart — execution plan (locked 2026-05-12)

Battle-test a pace-of-change aggregate chart as a standalone scratch artifact. Not production integration. Output: `.scratch-pace-v3.html` plus a written verdict on viability.

## Locked decisions (do not relitigate without strong cause)

- **Metric**: median raw % point delta per quarter across the in-flight cohort. Equal-weight, no editorial weighting.
- **In-flight cohort definition**: benchmarks where `status == "active"` at quarter Q, OR `status == "saturated"` AND quarter <= `activeUntil`. Drop the previous 5-90% score gate entirely. Use the curated lifecycle fields, not a score threshold.
- **Visualization**: smoothed 4Q median line (primary) + per-quarter median dots + faint strip underlay showing each individual benchmark's quarterly delta. Visible N per quarter. Tooltip lists contributing benchmarks.
- **Data sourcing**: verified-primary (AA API, Epoch CSVs, official leaderboards). Fall back to model-card scores from `benchmark_raw` when verified hasn't caught up to a recent model release. Matches existing site logic.
- **Smoothing window**: 4 quarters.
- **Chart start**: earliest quarter where N >= 5 in-flight (likely Q4 2024). Disclose in caption.
- **Frame**: "pace over time, not current ranking" explicitly. Differentiate from AA Intelligence Index.
- **Out of scope for v1**: site placement, methodology copy, GDPval Elo, METR, multimodal aggregation philosophy beyond MMMU-Pro inclusion.

## Cohort

Total target: 17 benchmarks (12 existing + 5 new) with MMLU full optional pending Epoch availability.

| Benchmark | Status | activeUntil | Source |
|---|---|---|---|
| ARC-AGI-2 | active | — | existing (ARC Prize) |
| ARC-AGI-3 | active | — | existing (ARC Prize) |
| HLE | active | — | existing (AA) |
| SWE-bench Pro | active | — | existing (Scale SEAL + model cards) |
| FrontierMath | active | — | existing (Epoch) |
| OSWorld-Verified | active | — | existing (Epoch + model cards) |
| GPQA Diamond | saturated | Q1 2026 | existing (AA) |
| AIME OTIS Mock | saturated | Q2 2026 | existing (Epoch) |
| HumanEval | saturated | Q4 2024 | existing |
| MATH Level 5 | saturated | Q1 2025 | existing (Epoch) |
| ARC-AGI-1 | deprecated | Q1 2025 | existing (ARC Prize) |
| SWE-bench Verified | saturated | Q3 2025 | existing (SWE-bench) |
| **MMLU-Pro** | **active** | — | AA API (standalone) |
| **MMMU-Pro** | **active** | — | AA API (standalone) |
| **Aider Polyglot** | **active** | — | aider.chat scrape; Epoch as backup |
| **Terminal-Bench 2.0** | **active** | — | tbench.ai scrape (not Terminal-Bench Hard which is AA Index v4) |
| **SimpleQA Verified** | **active** | — | Epoch CSV |
| **MMLU (full)** | **saturated** | **Q2 2024 (refine from data)** | Epoch CSV — verify availability, skip if absent |

Explicitly excluded: LiveCodeBench v6 (weak Western lab self-reporting), GDPval Elo (non-%), METR (addressed in copy only when methodology phase begins), other AA Intelligence Index v4 components (CritPt, AA-LCR, AA-Omniscience, IFBench, SciCode, τ²-Bench Telecom — thin history and/or narrow lab coverage).

## Phase A — Data gathering

1. **AA API exploration**: hit `https://artificialanalysis.ai/api/v2/data/llms/models` with `x-api-key` header. Discover what eval keys exist beyond the `hle` and `gpqa` already used in `scripts/update-data.js`. Specifically check for: MMLU-Pro, MMMU-Pro, Terminal-Bench 2.0 (likely absent — they have Terminal-Bench Hard), Aider Polyglot, SimpleQA Verified.
2. **Epoch CSV inspection**: download `https://epoch.ai/data/ai-benchmarking-data.zip`, list contents, check for MMLU full, MMLU-Pro, Aider Polyglot, SimpleQA Verified historical CSVs.
3. **Checkpoint**: report A1 + A2 results before committing to any scraping work. Jack reviews and confirms which scrape paths are worth.
4. **Scrape Aider Polyglot** from `https://aider.chat/docs/leaderboards/` if not in AA/Epoch. Markdown/HTML table parsing.
5. **Scrape Terminal-Bench 2.0** from `https://www.tbench.ai/leaderboard/terminal-bench/2.0` if not in AA. HTML scrape.
6. **Pull model-card fallback data** from existing `benchmark_raw` for each new benchmark (especially MMMU-Pro, Terminal-Bench, SimpleQA — for recency).
7. **Output per benchmark**: normalized CSV/JSON with `lab`, `model`, `quarter`, `score`, `source` (verified vs model-card). Stage in scratch files, not Supabase.

## Phase B — Quality testing

For each new benchmark:
1. Spot-check 5 top scores against the original source page. Confirm lab/model/score/quarter.
2. Frontier monotonicity check (cumulative max should not decrease).
3. Lab coverage audit (require >= 3 labs in last 4 quarters).
4. Recency-lag measurement (compare verified vs model card for the most recent quarter).
5. Validate lifecycle classification matches observed frontier curve. For MMLU full, find actual saturation quarter from data and update `activeUntil`.

Output: a quality table with pass/fail per check. Any benchmark failing >=2 checks gets flagged and decision deferred to Jack.

## Phase C — Chart regeneration

1. Update `.scratch-pace.mjs`:
   - Remove the 5-90% gate logic.
   - Add lifecycle-based cohort check.
   - Add new benchmark configs (name, status, activeUntil, colour, source).
   - Load new data from scratch CSVs alongside existing benchmark_scores data.
   - Update HTML generation to include strip plot underlay.
   - Set chart start quarter to first Q where N >= 5.
2. Save output as `.scratch-pace-v3.html`.

## Phase D — Path-to-production analysis

Assess after seeing v3 chart:
1. Does expanded cohort tell a cleaner story? Is 2025 slowdown still visible?
2. N stability: minimum N per quarter post-Q4 2024 should be >= 5, ideally >= 8.
3. Outlier sensitivity: drop each new benchmark in turn, re-compute median, observe shift. If any single benchmark moves the line by >2 pts in any quarter, flag.
4. Red team re-run: walk through earlier critiques (cohort survivorship, small N, climb-time endogeneity already cut). Which still land? Which are blunted?
5. Production requirements list: pipeline integration, `BENCHMARK_META` updates in `lib/config.js`, chart component, methodology copy, site placement decision, engineering estimate.
6. Verdict: ship/iterate/kill, with reasoning.

## Reference material in repo

- `scripts/update-data.js` — AA API call pattern (line ~269-325); Epoch zip download (`EPOCH_BENCHMARK_FILES` dict)
- `lib/config.js` — `BENCHMARK_META` schema for new benchmark configs
- `.scratch-pace.mjs` — current pace analysis script (v2). Median calculation bug already fixed (lines around the `quantile` helper).
- `.scratch-pace-focus.html` — current best version of the pace chart, with the bug fix applied. Use as visual reference for v3.
- `benchmark_raw` table in Supabase — model-card fallback source

## Reference material in memory

- `project_capability_taxonomy.md` — the 8-bucket capability framework. Pace chart is conceptually adjacent but separate.
- `project_capability_benchmark_principle.md` — "capabilities follow benchmarks" rule. Applies to lifecycle classifications.
- `MEMORY.md` — auto-loaded index; main file paths and Supabase keys are documented there.

## Estimated effort

- Phase A: 2-3 hours (mostly AA/Epoch exploration, then scrapers if needed)
- Phase B: 1-2 hours
- Phase C: 2 hours
- Phase D: 1 hour
- Total: ~6-8 hours, plausibly across 2 sessions. Phase A has the variance.

## Open items to resolve during execution

- True MMLU full saturation date (refine `activeUntil` after Phase A data check)
- Whether AA Index v4 has Terminal-Bench Hard data that's compatible with Terminal-Bench 2.0 timeline (probably not, but check)
- Whether Aider Polyglot scraping is sufficiently reliable for scratch v1

# Pace of Change chart — execution plan (locked 2026-05-12)

Battle-test a pace-of-change aggregate chart as a standalone scratch artifact. Not production integration. Output: `.scratch-pace-v3.html` plus a written verdict on viability.

## Locked decisions (do not relitigate without strong cause)

- **Metric**: median raw % point delta per quarter across the in-flight cohort. Equal-weight, no editorial weighting. Median (not mean) chosen for defensibility — easier to deflect "you averaged 6 benchmarks and one outlier propped up the headline." After the median calculation was fixed during this session, mean and median tell similar stories most quarters but diverge in concentrated-progress quarters (e.g., Q1 2025: mean 8.77, median 3.7 — one big mover, most stalled). The median is the more honest signal for "is the typical benchmark moving."
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

**MMMU-Pro-specific extra checks** (Jack expressed lingering skepticism in this session — AA Intelligence Index v4 explicitly separates multimodal; the data is available but treated as a different track):
- Verify AA's MMMU-Pro update cadence: are new frontier model scores landing within ~4 weeks of release, or longer? If lag is materially worse than text benchmarks, flag.
- Confirm earliest evaluation date on AA's leaderboard (the previous web fetch could not pin this down).
- Compare MMMU-Pro frontier curve shape against text benchmarks — does multimodal progress move on a different cadence? If visible divergence, flag in Phase D for whether multimodal pace deserves its own slice rather than blending.

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
1. Does expanded cohort tell a cleaner story? Is 2025 slowdown still visible? (Pre-expansion median: 2024 ~13.5, 2025 ~5.6, 2026 YTD ~8.65. The 2025 dip is the cleanest signal in the current data and should survive cohort expansion — if it doesn't, that's a finding worth surfacing.)
2. **Lived-experience sanity check**: does the chart still align with Jack's subjective narrative? Q3-Q4 2024 should show the o1-era leap (~17 median across that period). 2025 should show a meaningful slowdown across most benchmarks. Q1 2026 should show recovery driven by Gemini 3 Deep Think (ARC-AGI-2 +30) and GPT-5.4 Pro (HLE +20). Q2 2026 should be modest, dominated by Mythos coding gains (SWE-bench Pro +20, SWE-bench Verified +12.5) and underwhelming GPT-5.5 reasoning gains. If the v3 chart disagrees with this calibrated story, investigate before trusting it.
3. N stability: minimum N per quarter post-Q4 2024 should be >= 5, ideally >= 8.
4. Outlier sensitivity: drop each new benchmark in turn, re-compute median, observe shift. If any single benchmark moves the line by >2 pts in any quarter, flag.
5. **Red team checklist** (re-run against the v3 chart):
   - **Cohort survivorship**: does expanding to ~17 benchmarks blunt the "you cherry-picked the active set" critique? Compare what the median looks like with rolling cohort (current proposal) vs hypothetical "every benchmark ever, including saturated ones" view.
   - **Small N**: confirm N >= 5 from Q4 2024 onwards. If any quarter dips below, flag.
   - **Contamination sensitivity**: separately compute the median including vs excluding contamination-prone benchmarks (HumanEval, MMLU full, MMLU-Pro). If the headline shifts materially, contamination is doing too much work.
   - **Cumulative-max-across-labs artifact**: when does Meta entering the dataset (Q2 2026 with Muse Spark) visibly bump frontier? Is the bump real progress or just measurement bandwidth?
   - **METR comparison defence**: prepare a one-paragraph response to "why should we believe this over METR's exponential?" The argument is "broad cohort across many capabilities, no single test dominates, METR's coding-heavy task slice is one of many measurements."
   - **Already-resolved (don't re-litigate)**: climb-time endogeneity (cut from spec), error-reduction misinterpretation (cut from spec), single-quarter mean noise (resolved by smoothing).
6. Production requirements list: pipeline integration, `BENCHMARK_META` updates in `lib/config.js`, chart component, methodology copy, site placement decision, engineering estimate. Note: methodology copy should borrow AA's HLE adversarial-selection disclosure pattern (AA explicitly notes HLE was curated against specific models, so direct comparison vs models not in curation is biased — same pattern applies to several of our benchmarks).
7. **Verdict format**: a short markdown report (~500-800 words) covering: (a) does the v3 chart hold up under the red team checklist? (b) is the story still defensible? (c) ship/iterate/kill recommendation with concrete next steps for whichever path. Saved as `.scratch-pace-verdict.md`.

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
- Whether Aider Polyglot scraping is sufficiently reliable for scratch v1 (single-maintainer source, may break)
- MMMU-Pro update cadence and earliest evaluation date on AA's leaderboard (couldn't pin down in session web fetches; Phase B should verify)
- Whether MMMU-Pro's multimodal curve diverges meaningfully from text benchmarks (if so, may need separate slice in v2)

## Implementation pitfalls (real bugs encountered during this session)

- **Median calculation for even N**: the naive `sorted[Math.floor(n/2)]` returns the upper-middle value, not the true median. For N=4 with sorted deltas [0, 4.3, 37.5, 40.1], naive median = 37.5, true median = (4.3+37.5)/2 = 20.9. The current `.scratch-pace.mjs` has a proper `quantile(sorted, q)` helper using linear interpolation — use that. The session conclusions were initially distorted by this bug; do not let future code regress.
- **Supabase REST API in browser-flavoured UA**: returns "Forbidden use of secret API key in browser" with default PowerShell/Invoke-RestMethod. Set `User-Agent: node-fetch/1.0` (or any non-browser UA) in headers to bypass.
- **PostgREST 1000-row limit**: the Supabase REST API caps at 1000 rows per request even when `limit=3000` is specified. Paginate via `offset=` for larger pulls.
- **Hardcoded keys vs env vars**: this session's scratch script initially had a hardcoded Supabase key. GitHub push protection blocked the commit. Always use `process.env.SUPABASE_SERVICE_KEY` even in scratch scripts; the `.env` file is gitignored.

## v2 references (for later, not now)

- **GDPval Elo normalization**: AA uses `clamp((Elo - 500) / 2000)` (so Elo 500 = 0%, Elo 2500 = 100%, anchored to GPT-5.1 Non-Reasoning at Elo 1000). If/when non-% benchmarks join, this is the reference formula.
- **AA Intelligence Index v4 components** (currently excluded for thin history / proprietary nature): GDPval-AA, τ²-Bench Telecom, Terminal-Bench Hard, SciCode, AA-LCR, AA-Omniscience, IFBench, CritPt. Most have history starting late 2025 — reconsider for v2 once they accumulate 4+ quarters.
- **Memory file state**: `project_capability_taxonomy.md` was corrected during this session to fix an earlier inaccuracy that claimed MMMU-Pro was "not on AA's API." It is on AA (189 models, standalone evaluation, not in Intelligence Index v4). Current memory state is correct.

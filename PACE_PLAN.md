# Pace of Change chart — session 2 findings (2026-05-12)

**Status**: scratch v3 built and validated. Methodology revised from the original locked plan. NOT yet locked for production integration.

**Outputs**:
- `.scratch-pace-v3.html` — the chart
- `.scratch-pace-v3.json` — raw aggregate (mean, smoothed mean, per-quarter contributors, lifecycle metadata)
- `.scratch-pace-newbench.json` — normalized entries for the new benchmarks (615 rows, lab/model/quarter/score/source)
- `.scratch-pace-verdict.md` — verdict + iteration recommendations
- `.scratch-pace-phaseA.md` — Phase A discovery checkpoint
- Scripts: `.scratch-pace-phaseA.mjs`, `.scratch-pace-phaseA-deep.mjs`, `.scratch-pace-phaseA6.mjs`, `.scratch-pace-phaseB.mjs`, `.scratch-pace-v3.mjs`, `.scratch-pace-phaseD.mjs`

## Final methodology (after session 2 corrections to the original plan)

| Decision | Original plan | Final (after session 2) | Why changed |
|---|---|---|---|
| Aggregation | Median | **Mean** | With N=10-12 contributors, median hides real capability breakthroughs. Q3 2024 (o1-preview) had median 3.0 vs mean 13.77 — exactly the event the chart should register. Outlier-robustness argument was calibrated for N=6 and no longer applies. |
| Cohort | 17 benchmarks (12 existing + 5 new + 1 conditional MMLU full) | **17 benchmarks** (12 existing + 5 new) — MMLU full **dropped** | MMLU full saturates at noise floor ~89% due to known dataset quality issues (~10% of questions buggy/ambiguous per audits). 86.4 → 89.5 over 2.5 years is not real frontier movement. |
| Cohort gate | Lifecycle only | **Lifecycle + activity gate** | A benchmark counts in quarter Q only if at least one in-scope lab reported a fresh score in Q. Without this, cumulative-best carry-forward 0-deltas drag the mean. Refinement, not a major shift (most benchmarks are actively tested). |
| Aider Polyglot lifecycle | Active | **Saturated, activeUntil = Q3 2025** | Frontier hit 88.0 in Q3 2025 and stayed flat through Q1 2026. Real plateau (likely 88-ish ceiling from edit-format error rates), not just no testing. |
| MMMU-Pro source | AA API | **AA page scrape** (`/evaluations/mmmu-pro` embedded `defaultData` JSON) | Memory note was right; AA's models endpoint doesn't expose mmmu_pro, but the per-benchmark page does. 189/189 join success against models API by `id`. Reusable pattern documented separately. |
| Terminal-Bench 2.0 source | Probably Epoch CSV, scrape tbench.ai if not | **Epoch `terminalbench_external.csv`** — verified by exact match on top 4 scores vs tbench.ai 2.0 | No scrape needed. |

## What the chart actually shows

Final cohort (17 benchmarks):

**Active (10)**: ARC-AGI-2, ARC-AGI-3, HLE, SWE-bench Pro, FrontierMath, OSWorld-Verified, MMMU-Pro, Terminal-Bench 2.0, SimpleQA Verified, (plus MMLU-Pro saturated until activeUntil)
**Saturated/Deprecated (7)**: GPQA Diamond (Q1 2026), AIME OTIS Mock (Q2 2026), HumanEval (Q4 2024), MATH L5 (Q1 2025), ARC-AGI-1 (Q1 2025), SWE-bench Verified (Q3 2025), MMLU-Pro (Q4 2025), Aider Polyglot (Q3 2025)

Smoothed (4Q rolling) mean per quarter:

| Quarter | Smoothed mean | Narrative |
|---|---:|---|
| Q1 2024 | 4.49 | Claude 3 / GPT-4o era — warming up |
| Q2 2024 | 6.71 | GPT-4o + Sonnet 3.5 — knowledge benchmarks moving |
| Q3 2024 | 9.84 | **o1-preview inflection point** — AIME +40, MATH L5 +37, MMMU-Pro +25 |
| Q4 2024 | 10.47 | o1-full + Sonnet 3.5 New + DeepSeek V3 — broad-front quarter |
| Q1 2025 | 11.02 | **Peak** — o3-mini + R1 + Sonnet 3.7 + OSWorld +30 (agent era) |
| Q2 2025 | 11.04 | Sustained — o3-pro + Gemini 2.5 + Claude 4 + SimpleQA +49 (Google factuality) |
| Q3 2025 | 9.67 | GPT-5 era — broad but moderate |
| Q4 2025 | 8.78 | Gemini 3 Pro + Opus 4.5/4.6 + DeepSeek V3.x |
| Q1 2026 | 9.51 | Gemini 3 Deep Think + Sonnet 4.6 + Gemini 3.1 Pro + GPT-5.4 Pro + Opus 4.6 |
| Q2 2026 | 7.73 | Partial (~6 weeks); SWE-bench Pro +20, HLE +6 so far |

**Narrative shift from the original plan**: the locked plan expected "2025 slowdown then Q1 2026 recovery." The actual chart shows **Q3 2024 – Q2 2025 was the fast year** (~10-11), with the entire 2025 H2 + 2026 YTD trending mildly downward (~8-10) rather than spiking. The "recovery" framing came from a smaller cohort that over-weighted specific lab cluster releases. The broader story: AI progress has been **broadly steady at ~8-10 pts/quarter on the typical benchmark since Q3 2024**, with the reasoning-model era (o1 → o3 → R1) being the cleanest sustained-acceleration window.

## Red team checklist results

| Check | Result |
|---|---|
| Cohort survivorship (drop new benchmarks one at a time) | ✅ All shifts <1pt anywhere post-Q4 2024 |
| Small N | ✅ Minimum N from Q4 2024 onwards = 10 (target was ≥5, ideally ≥8) |
| Contamination sensitivity (drop HumanEval + MMLU-Pro) | ⚠️ Q3 2024 shifts +5.5pt without them; disclosure-worthy, not invalidating |
| Outlier sensitivity per benchmark | ✅ No new benchmark shifts the chart >2pt anywhere |
| Multimodal-vs-text divergence | ⚠️ MMMU-Pro shows lumpier cadence than text benchmarks; flagged for v2 multimodal slice |
| SimpleQA Verified Google domination | ⚠️ 29.5pt gap to 2nd-best lab in Q1 2026; not fatal, methodology copy should disclose |
| Cumulative-max artifact (Meta entering) | ✅ Muse Spark joins the pack, doesn't dominate any quarter |
| METR comparison defence | ✅ One paragraph drafted in `.scratch-pace-verdict.md` |

## Pending decisions before production integration

These are open questions for the next session. Not pre-decided.

1. **Site placement**: standalone tab? Hero chart above the existing per-benchmark charts? New "headline" mode in the existing chart toggle?
2. **Methodology copy framing**: how to explain "mean frontier delta across lifecycle-gated cohort with activity gate" to a non-technical reader. Borrow AA's HLE adversarial-selection disclosure pattern.
3. **Multimodal slice**: build a side-by-side MMMU-Pro-vs-text-benchmarks chart in v1? Or defer to v2?
4. **Bonus AA benchmarks**: SciCode (479 models, 50 labs), IFBench (413, 48), AA-LCR (413, 48), τ²-Bench Telecom (405, 47), AIME 25 (269, 36), MATH 500 (201, 28), LiveCodeBench (343, 40). All have higher coverage than several benchmarks already in the cohort. Original plan held these for v2 — revisit?
5. **SimpleQA Verified disclosure**: methodology blurb about Google-only race, or stronger (drop it?). Currently a +5 contributor in Q1 2026 — small but Google-driven.
6. **GDPval Elo**: still deferred (chart can't handle non-% Y-axis yet). Re-raise when chart engine is more flexible.

## Production integration sketch (when ready)

- Add `lib/pace-chart.js` module mirroring `.scratch-pace-v3.mjs` logic (frontier + lifecycle gate + activity gate + 4Q rolling mean).
- Add 4 remaining new benchmarks to `lib/config.js` `BENCHMARK_META` with `status` + `activeUntil` fields. **MMMU-Pro already shipped 2026-05-13** as part of the capability-labels PR (status `active`, capability `Visual Reasoning`).
- Ingestion changes in `scripts/update-data.js`:
  - **MMLU-Pro**: add `mmlu_pro` to AA fetcher (1 line + meta entry)
  - **~~MMMU-Pro~~**: shipped 2026-05-13. `fetchArtificialAnalysisMMMUPro()` is in production; Pace can read from `benchmark_scores` directly. 145 verified data points across all 5 labs as of the first run.
  - **Aider Polyglot, SimpleQA Verified, Terminal-Bench 2.0**: add to `EPOCH_BENCHMARK_FILES` dict (3 new entries)
- New chart component. Methodology copy section.
- Estimate: 1-2 days once decisions above are settled (one item smaller now that MMMU-Pro is done).

---

## Original plan (for reference; superseded by the findings above)

Locked 2026-05-12 (early in session). Several locked decisions were revisited during execution after data was inspected. See "Final methodology" table above for what changed and why.

Original plan was: median (not mean) raw % point delta per quarter across an in-flight cohort defined by `status == active OR status == saturated AND quarter <= activeUntil`. Smoothed 4Q median. Strip-plot underlay. Started at first quarter with N >= 5. Cohort target: 17 benchmarks plus MMLU full conditionally. Execution in 4 phases (A: data gathering, B: quality testing, C: chart regeneration, D: red team + verdict).

All four phases executed. Key findings during execution that drove the methodology revisions: MMMU-Pro IS on AA (memory was right; needed page scrape, not API call); MMLU full unreliable; activity gate needed; mean tells the story better than median once N >= 10.

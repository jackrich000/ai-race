# Lab Race aggregate view — ideation plan (paused 2026-05-12)

Brainstorm session to rethink the Lab Race tab's aggregate view. Decisions captured for a future implementation session. Not yet committed to scope or timeline.

## Problem statement

The current Lab Race tab shows one benchmark at a time (filter pills switch the active benchmark). With 6 active benchmarks, getting a sense of "who is really ahead" requires flipping through tabs and holding too much in your head. Need a single chart that answers "who has been leading over time, who leads now, and by how much."

Distinguishing characteristic from AA Intelligence Index and LiveBench: those provide a single number for current state. We want **leadership over time** (historical trajectory), preserving margin and capability fragmentation. AA's v3 → v4 version changes break their own historical line, so the over-time question is genuinely uncontested ground.

## Locked decisions (this session, 2026-05-12)

1. **Two-level structure**: headline = one race (single composite line per lab over time); drill-down = many races (per-capability detail).
2. **Methodology spine shared with Pace of Change** (`PACE_PLAN.md`), but partial. **Shared**: data sources (verified-primary, model-card fallback), lifecycle metadata (`status`, `activeUntil`), capability rollup, expanded benchmark cohort built during Pace's v3 work (17 benchmarks — see below). **Independent**: aggregator (Pace landed on mean per-quarter delta during v3 work; Lab Race uses average of % of frontier — these don't need to match) and cohort selection rule (#8 below). Make the divergences explicit in methodology copy, not hidden.
3. **Capability taxonomy is the foundation** (8 buckets from `project_capability_taxonomy.md`). Aggregate at bucket level, not flat across benchmarks. Each bucket gets equal weight regardless of how many benchmarks it contains.
4. **Unit on the chart**: **% of frontier** (lab score ÷ best-in-class score at that point in time). Naturally normalizes across benchmarks, preserves margin (98% and 60% read differently), composes by averaging.
5. **Rank within bucket** surfaced on hover or drill-down panel, not on the main chart. Two views of the same data: % of frontier for "by how much," rank for "in what position."
6. **Margin preserved, not reduced to tally.** "Count of #1 spots" was explicitly rejected because it flattens the now-fragmented era (a 0.1pt lead and a 20pt lead count the same).
7. **Coverage gaps handled visually, not mathematically.** No imputation, no zero-fill for benchmarks a lab didn't run. Average only over capabilities the lab actually tested. Show a coverage indicator on the chart (e.g., "based on N/8 capabilities") so readers can discount narrow-coverage labs themselves.
8. **Cohort = active benchmarks only at each point in time.** Saturated benchmarks drop out of their capability bucket as soon as a successor activates. This is **different from Pace of Change**, which uses "active OR saturated-within-window." Justification: Pace asks "how fast did things move?" — saturated benchmarks contributed real progress at the time. Lab Race asks "who is ahead?" — saturated benchmarks no longer discriminate between labs.

## Open items to resolve in next session

1. **Capability buckets with no active benchmark for some period.** If a benchmark saturates before its successor activates, what happens to that bucket? Three options:
   - (a) Bucket drops out of the average for those quarters. Cleanest, but the lab-race number jumps mechanically when buckets enter/leave.
   - (b) Most recent saturated benchmark continues to contribute until successor arrives. Smooths transitions but contradicts the "active only" principle.
   - (c) Bucket carries forward a frozen "% of frontier" snapshot until successor arrives. Hybrid.
   - **Tentative lean**: (a) with an explicit "N buckets contributing: X" annotation per quarter so readers can see the changes.
2. **Single-benchmark buckets.** The existing site has 6 active benchmarks; on a one-bucket-per-benchmark view, every bucket is single-benchmark and the bucket's "% of frontier" is just that benchmark's. High variance, no within-bucket smoothing. **Materially defused if Lab Race uses Pace's expanded 17-benchmark cohort** (MMLU-Pro, MMMU-Pro, Aider Polyglot, Terminal-Bench 2.0, SimpleQA Verified added; saturated benchmarks like SWE-bench Verified, GPQA Diamond etc. drop out per cohort rule #8 but a couple are still in their successor's bucket). Mitigation: visual indicator on the per-bucket drill-down showing how many benchmarks support it that quarter.
3. **Verified vs unverified.** Both, visually distinguished (matching the rest of the site)? Or verified-only for the headline number to prevent a single model-card score determining who "leads"? Tentative lean: both-with-distinction.
4. **Frontier definition.** "% of frontier" against: (a) current quarter's best across labs, (b) cumulative best across labs at that point in time, (c) cumulative best including future scores. Tentative lean: (b), matches how the existing chart reasons about frontier.

## Six-month regret flags (resolve in next session)

- **Cohort-change movement.** The headline number can move because a bucket entered/left the average, not because any lab got better or worse. Readers may misattribute. The "N buckets contributing" annotation helps but may not be enough — consider whether a separate "bucket count" indicator strip is needed.
- **Capability framing has to be load-bearing.** If most buckets only have one healthy benchmark, the chart is a dressed-up restatement of a familiar five benchmarks. The capability rollup must be genuinely informative, not cosmetic.
- **Narrow-coverage labs look stronger than they "should."** xAI averaged over 3 buckets at 95% looks more dominant than OpenAI averaged over 8 buckets at 75%. Coverage tag mitigates but doesn't eliminate. Hostile-critic test: "you let xAI skip half the race." Need a defensible answer before launch.
- **Chinese Leaders composite at capability level.** Chinese Leaders is itself an aggregate of five sub-labs (DeepSeek, Kimi, MiniMax, Zhipu, Qwen — see memory `project_extraction_status.md`). Does mixing across them make sense at the capability level? At the headline level? Or do we need to handle them specially (e.g., decompose into Chinese sub-labs for this chart only, or render them as a band rather than a single line)? Pace currently treats Chinese Leaders as one entity; if Lab Race diverges, that's another methodology gap to document.

## Rejected approaches (do not relitigate without strong cause)

- **Borrow an external index (AA Intelligence Index / LiveBench).** Cheap and defensible, but inherits their methodology debt. AA's v3 → v4 transition already breaks the historical line. Site becomes a re-publisher; loses independent value.
- **Frontier-chart-with-leader-icons.** Under-uses the chart. Leadership info lives in the tooltip, not the visual. Readers who don't hover never see the story.
- **Pure "count of capabilities led" tally.** Loses margin entirely — a 0.1pt lead and a 20pt lead count the same. Flattens the now-fragmented era; chart becomes less informative as the race tightens.
- **Composite score without methodology justification.** Hardest to defend without doing methodology work that rivals AA Index. Avoided in favour of "% of frontier," which is a single transparent transform.
- **Penalty score / zero-fill for missing benchmarks.** Punishes labs (notably xAI) for not running every test. Coverage shown visually instead.
- **Imputation of missing scores.** Methodology nightmare; opens up "you made it up." Coverage shown visually instead.

## Drill-down format candidates (not yet locked)

The "drill-down = many races" half needs its own format decision in the next session. Candidates surfaced here:

- **Pole-position timeline per capability**: 8 horizontal rows (one per bucket), time on X, each row coloured by current leader. Reads instantly. Captures fragmentation. Heatmap rather than line chart.
- **Per-capability small multiples**: 8 mini line charts (one per bucket), labs as lines, current leader highlighted. Preserves the full margin story per capability. Higher real-estate cost.
- **Hover-only drill-down**: hovering a lab's point on the headline chart shows per-bucket rank + score breakdown. Lower commitment, but only available to hover-capable readers (mobile loses it).

## Reference material in repo

- `PACE_PLAN.md` — sibling aggregate chart, methodology spine partly shared.
- `lib/config.js` — `BENCHMARK_META` schema, lifecycle fields (`status`, `activeUntil`), capability bucket assignments.
- `app.js` `buildRaceDatasets()` (~line 384) — current per-benchmark Lab Race rendering.
- `app.js` `buildFrontierDatasets()` (~line 410) — cumulative-best-across-labs pattern, reusable for frontier computation.

## Reference material in memory

- `project_capability_taxonomy.md` — the 8-bucket capability framework.
- `project_capability_benchmark_principle.md` — "capabilities follow benchmarks" rule. Applies to successor-replacement logic in cohort rule #8.

## Upstream dependencies (must be resolved or known-state before Lab Race work)

- **Capability taxonomy anchors finalized.** `project_capability_taxonomy.md` v1 still has Computer Use and Real-world Tasks anchors being finalized (per TASKS.md "Make the site work for non-technical audiences" item). Lab Race's bucket-first aggregation rests on the taxonomy being settled. Either confirm anchors before starting Lab Race, or design with a known-pending state and a way to swap later.
- **Pace of Change production-integration status.** Pace's v3 scratch is built (`.scratch-pace-v3.html`); production integration is pending decisions on site placement and methodology copy. If Lab Race ships before Pace's production integration, it sets infrastructure precedent (capability-bucket schema, frontier calc, % of frontier helper) that Pace then has to conform to — or vice versa. Worth deciding ordering deliberately.
- **`PACE_PLAN.md` is slightly stale.** During v3 work Pace shifted from median to mean and dropped MMLU full; the locked-decisions section in that file hasn't been rewritten. Treat it as a historical snapshot, not the current spec. TASKS.md line 24 has the more current summary.

## Out of scope for v1

- Site placement decision (replaces the existing Lab Race tab? Sits alongside? New tab?). Decide after seeing a scratch prototype.
- Methodology copy / public-facing explanation.
- Engineering estimate. Produce one after the scratch artifact is built and the four open items are resolved.

## Next session entry point

1. `/clear` to start fresh.
2. Read this file.
3. Confirm upstream dependencies above are in a usable state (taxonomy anchors, Pace integration ordering).
4. Resolve the four open items, then the six-month regret flags.
5. Decide drill-down format.
6. **Build a scratch artifact first** (`.scratch-lab-race.html` or similar) before any production integration. Mirrors Pace's pattern — battle-test the methodology and visualization before committing to engineering.
7. Verdict on the scratch: does the headline tell a defensible story? Do the open items have clean answers?
8. Then decide site placement and enter plan mode for production integration.

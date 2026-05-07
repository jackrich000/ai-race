# AI Benchmark Tracker - Task Board

> **Owner**: Jack | **Agent**: Claude Code
> Statuses: `[ ]` Todo | `[-]` In Progress | `[x]` Done

---

## Backlog

- [x] **Fix automated extraction reliability — DeepSeek + 3 bonus Chinese labs** — Replaced the broken DeepSeek HF DOM scanner with a pure-HTTP HF Hub API path (PR #46, merged 2026-05-07). Same path covers DeepSeek (`deepseek-ai`), Kimi (`moonshotai`), MiniMax (`MiniMaxAI`), Zhipu (`zai-org`); Qwen retains its existing `qwen.ai` card scanner. First production run (issue #47) ingested DeepSeek-V4-Pro/Flash with per-mode variants (Max/High/Non-Think), Kimi-K2.6, GLM-5.1; GLM-5.1 became the new HLE best for Chinese Leaders at 52.3. ByteDance/Doubao remains the only Chinese sub-lab not automated (no flagship on HF as open weights — punt unless they start publishing).
- [ ] **Pipeline health checks** — Combined defense against silent data loss. Two parts:
  - **Source-level sanity check**: Before delete+insert, verify each source returned at least a minimum number of rows (per-source threshold). Abort or flag in the pipeline issue if a normally-populated source comes back empty. Defends against the ARC Prize URL-change failure mode where `fetchARCPrize()` silently returned `[]` and delete+insert wiped ~4 weeks of data.
  - **Zero-article-streak alert**: Track week-over-week extracted-article counts per lab in pipeline run history. Alert if any lab returns 0 articles for 4 consecutive weeks. Catches gradual silent decay (RSS format change, page restructure, source going dark). Especially load-bearing for Qwen's 4-card rolling window and Google's `/gemini-models/` URL pattern. Subsumes the earlier "Monitor Google DeepMind URL pattern" item.
- [ ] **Consider new benchmarks to add to the site, now GPQA Diamond and AIME are saturated** — Active benchmark count is down to 4 (ARC-AGI-2, HLE, SWE-bench Pro, FrontierMath) and dropping as benchmarks saturate. Candidates to evaluate:
  - **OSWorld-Verified**: Strong candidate. In-place upgrade of the original OSWorld (better task quality, grading, infrastructure) with comparable scores per Anthropic's Opus 4.7 footnote. Gives a continuous timeline from Oct 2024 (Sonnet 3.5 at 14.9%) to present (GPT-5.5 at 78.7%, Muse Spark 79.6%, Opus 4.7 78.0%). Labs are self-reporting it (OpenAI, Anthropic, Meta, Kimi). Not saturated — scores 42-80%. Measures computer use, a new category we don't cover. Needs: config entry, historical data seeding, data source investigation (leaderboard vs model cards only), methodology description.
  - **GDPval (wins/ties)**: Real-world task benchmark where metric is win/tie rate vs human experts. Worth evaluating once data sources are understood.
  - **Non-percentage scoring benchmarks**: METR Time Horizons (minutes), Codeforces / LiveCodeBench Pro (Elo), GDPval. Requires a different chart type or normalization approach — site currently has no support for non-% benchmarks. Tied to whichever of these we decide to add.
  - **Review latest extracted model card data**: Survey what benchmarks labs are commonly self-reporting in `benchmark_raw` to identify candidates that would add coverage we don't have.
- [ ] **Rethink aggregate view on Lab Race tab** — Hard to get a sense of who is really ahead when data is spread across 6 benchmark tabs. Need a way to show the overall picture.
- [ ] **Make the site work for non-technical audiences**:
  - Better structure expanded benchmark descriptions in methodology section: clearly separate a) what the benchmark is from b) where we get the data
  - Label benchmarks on the chart for context (e.g. "SWE-Bench Pro (Coding)") so unfamiliar visitors know what they're looking at
  - Sharpen the AI-generated analysis for non-technical / executive audiences. Manually extract the best insights from the data, then work backwards to tune the analysis prompt. What would you highlight presenting to a C-level audience? (e.g. not "ARC-AGI 2 scores increased" but "scores on the hardest benchmark for testing problem-solving capabilities increased...")
- [ ] **Small UI fixes**:
  - Add "last updated" date to chart so visitors know how current the data is
  - Deprecated benchmark icon renders in front of (rather than behind) the tooltip on the chart
  - Pre-relaunch QA pass: mobile experience, broken links, chart load on slow connections, OG preview rendering when shared on LinkedIn / X / Reddit / Hacker News
- [ ] **Set targets for engagement, to justify continued work after re-launch** — Pre-commit to numeric success criteria *before* promoting, so post-launch evaluation isn't post-hoc rationalisation. Set at least one target per dimension below — having both a reach target and an inbound target lets you distinguish "post didn't travel" from "site didn't convert". For each target, define a **time horizon** (30/60/90 days) and a **kill criterion** (if missed, stop or pivot — not just success thresholds).
  - **Reach**: unique visitors / page views (top of funnel — did anyone see it?)
  - **Engagement quality**: time on site, returning visitors (did the content actually land?)
  - **Social signal**: LinkedIn engagement, Hacker News points, Reddit upvotes, Substack subscribers (did it travel?)
  - **Inbound interest**: contacts / inquiries / mentions (did it create opportunity? — most decision-relevant for "is this worth continuing?")
- [ ] **Share best insights from the site on LinkedIn / Reddit / Substack / Hacker News** — Identify the most compelling data stories and package them for social sharing. Sequence after the accessibility + executive-tuning work so the site is ready for non-technical traffic.
- [ ] **Quarterly maintenance: ground truth re-verification + API credit top-up — Next: 2026-07-01** — Manually re-verify each documented ground truth in `project_extraction_groundtruths.md` (Anthropic 16, OpenAI 16, xAI 5, Google 15, DeepSeek 14, Qwen 8) against the current source page. Also: at the next checkpoint, manually verify and document GTs for the four HF API labs (DeepSeek-V4-Pro, Kimi-K2.6, MiniMax-M2.7, Zhipu/GLM-5.1) — they currently have `scripts/validate-extraction.mjs` smoke checks derived from a single production run but aren't yet in the manual reference.
  1. Open each `URL` in a browser
  2. Confirm every listed score still appears with the same benchmark name and value
  3. If a page has been re-templated or a score has changed, update both `scripts/validate-extraction.mjs` ground truths AND `project_extraction_groundtruths.md`
  4. Re-run `node scripts/validate-extraction.mjs` to confirm the suite passes against the updated GTs
  5. Check Anthropic API credit balance + Browserbase usage; top up if low (no auto-recharge configured). Pipeline health checks would catch a hard outage between checkpoints, but quarterly proactive top-up avoids any gap.
  6. After completion, update this task date to 2026-10-01

  Why: Lab pages can be silently re-templated with new layouts. The fresh-article canary catches new-article failures but not re-templated old articles, so the validation suite can drift from reality without anyone noticing.
- [ ] **Modernise frontend stack** — Migrate to TypeScript + build step (Vite), then adopt a component framework (Vue or Svelte). Addresses known architectural debt: monolithic app.js, manual DOM manipulation, no type safety. Do in two phases: (1) TypeScript + Vite, (2) framework. Requires external research + subagent red team per new process.
- [ ] **Differentiated branding / visual identity** — Come up with branding that could extend across apps, blog, slides. Opportunity to define a reusable visual identity. Explore testing the [frontend-design skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) for this.

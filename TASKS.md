# AI Benchmark Tracker - Task Board

> **Owner**: Jack | **Agent**: Claude Code
> Statuses: `[ ]` Todo | `[-]` In Progress | `[x]` Done | `[~]` Killed

---

## Archive: Launch (Complete)

Waves 1-4 shipped. See git history for details.

---

## Backlog

- [ ] **Make site accessible to non-technical audiences** — Multiple improvements:
  - Better structure expanded benchmark descriptions in methodology section: clearly separate a) what the benchmark is from b) where we get the data
  - Label benchmarks on the chart for context (e.g. "SWE-Bench Pro (Coding)") so unfamiliar visitors know what they're looking at
  - Make AI analysis understandable without benchmark expertise (e.g. not "ARC-AGI 2 scores increased" but "scores on the hardest benchmark for testing problem-solving capabilities increased...")
- [ ] **Sharpen AI analysis for executive audiences** — Manually extract the best insights from the data, then work backwards to tune the analysis prompt. What would you highlight presenting to a C-level audience?
- [ ] **Share best insights from the site on LinkedIn / Reddit** — Identify the most compelling data stories and package them for social sharing.
- [ ] **Rethink aggregate view on Lab Race tab** — Hard to get a sense of who is really ahead when data is spread across 6 benchmark tabs. Need a way to show the overall picture.
- [ ] **Differentiated branding / visual identity** — Come up with branding that could extend across apps, blog, slides. Opportunity to define a reusable visual identity. Explore testing the [frontend-design skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) for this.
- [ ] **Fix automated extraction reliability — DeepSeek** — OpenAI resolved 2026-04-30 via Browserbase (PR #44). Qwen reinvestigated 2026-05-01: extraction works (69 scores from `qwen.ai/blog?id=qwen3.6` including all 8 ground truth values), card scanner finds 4 latest cards (acceptable rolling window for weekly cadence). Qwen3.6-Plus manually seeded same day. Remaining:
  - **DeepSeek on HuggingFace**: `scanBlogIndex()` scans `huggingface.co/deepseek-ai` looking for `<a>` links, but HuggingFace model pages aren't blogs — DOM structure is different. DeepSeek V4-Pro was not discovered despite URL pattern matching. Investigate the HuggingFace API path first (`/api/models?author=...` for discovery + raw README URLs for content) before writing a HF-DOM scraper.
- [ ] **Browserbase outage simulation test** — Temporarily set an invalid `BROWSERBASE_API_KEY` in Actions secrets, trigger pipeline manually, confirm Anthropic/Google/xAI ingest normally and a "Browserbase Unavailable" section appears in the GH issue. Restore the real key after. (Real-world verification done 2026-04-30; this validates the failure-isolation path.)
- [ ] **OpenAI extraction quality monitor** — Cross-check newly-ingested OpenAI scores against AA/Epoch verified data for the same model+benchmark. Auto-flag deviations >5pp for triage. Defends against silent garbage if Browserbase ever returns partially anti-bot-blocked pages and the LLM hallucinates plausible scores. (Surfaced by red team review of PR #44.)
- [ ] **Zero-article-streak alert** — Track week-over-week extracted-article counts per lab. Alert if any lab returns 0 articles for 4 consecutive weeks. Catches the failure mode where a lab silently goes quiet (RSS feed format change, source going dark) and the pipeline reports "no changes" instead of "broken". Especially important for Qwen since its discovery surface is a 4-card rolling window (`qwen.ai/research` "Latest Advancements" carousel) — bumped models won't be caught if pipeline misses a week. (Surfaced by red team review of PR #44.)
- [ ] **Quarterly ground truth re-verification** — Schedule a recurring quarterly task to manually re-verify scores in `validate-extraction.mjs` and `project_extraction_groundtruths.md`. Lab pages can be silently re-rendered with new templates; the fresh-article canary catches some of this, but not all. (Surfaced by red team review of PR #44.)
- [ ] **Chinese Leaders automated extraction config** — Expand extraction sources for the Chinese Leaders lab:
  - **Kimi/Moonshot**: Not configured at all. Need to add `LAB_SOURCES` entry. HuggingFace page: `huggingface.co/moonshotai`. Kimi K2.6 was manually seeded (2026-04-27) but future releases won't be caught.
  - **DeepSeek HuggingFace scanning**: Configured but not working (see extraction reliability task above). URL pattern `/\/deepseek-ai\/DeepSeek-/` is correct but `scanBlogIndex()` doesn't work on HF's DOM.
  - **Qwen discovery surface**: Working but limited to a 4-card rolling window on `qwen.ai/research`. Acceptable at current weekly pipeline cadence (Qwen rarely ships >4 articles/week), but if a model gets bumped before the pipeline runs, manual seed is required. Defended by zero-article-streak alert (above).
  - Other Chinese labs to consider: MiniMax, Zhipu/GLM, ByteDance (from original backlog).
- [ ] **Evaluate bringing back Meta as a lab** — Meta released Muse Spark (2026-04-25) with competitive scores: HLE 58.4 (with tools), GPQA Diamond 89.5, SWE-bench Verified 77.4, SWE-bench Pro 52.4, ARC-AGI-2 42.5. Scores manually extracted and stored in benchmark_raw (2026-04-27). Questions to resolve: (1) Is Meta now a serious enough player to warrant a dedicated lab line on the chart? (2) If yes, add `ai.meta.com/blog/` to extraction sources. (3) Consider what color/branding to use (previously removed).
- [ ] **Add source-level sanity checks before ingestion** — The pipeline silently lost all ARC Prize data for ~4 weeks when their URL changed (404). Root cause: `fetchARCPrize()` error is caught and returns `[]`, then delete+insert proceeds and wipes the old data. Fix: before the delete step, verify each source returned a minimum number of results. If a source that normally provides data comes back empty, either abort ingestion for that source or flag it prominently in the pipeline report. The URL was fixed (2026-04-27, commit bd9693d), but the silent-failure pattern affects all sources.
- [ ] **Monitor Google DeepMind URL pattern** — Extraction relies on `/gemini-models/` URL pattern, which is fragile if Google changes their blog structure.
- [ ] **Add OSWorld-Verified as a new active benchmark** — Strong candidate to replace GPQA Diamond/AIME now that both are saturated. OSWorld-Verified (released July 2025) is an in-place upgrade of the original OSWorld (better task quality, grading, infrastructure) with comparable scores, per Anthropic's footnote on the Opus 4.7 page. This gives a continuous timeline from Oct 2024 (Sonnet 3.5 at 14.9%) to present (GPT-5.5 at 78.7%, Muse Spark 79.6%, Opus 4.7 78.0%). Labs are self-reporting it in model cards (OpenAI, Anthropic, Meta, Kimi). Not saturated — scores range 42-80% across current models. Measures computer use capability, which is a new category we don't cover. Needs: config entry, historical data seeding, data source investigation (leaderboard vs model cards only), methodology description.
- [ ] **Zoom to fit** — Chart automatically zooms to the time period where the selected benchmark is active, so you're not looking at empty space before/after it existed.
- [ ] **Add "last updated" date to chart** — Show when the data was last refreshed so visitors know how current it is.
- [ ] **Non-percentage benchmark visualizations** — Design a way to display benchmarks with non-% scoring (Elo, minutes, percentile). Candidates: METR Time Horizons, GDPval, Codeforces / LiveCodeBench Pro. Requires a different chart type or normalization approach.
- [ ] **Modernise frontend stack** — Migrate to TypeScript + build step (Vite), then adopt a component framework (Vue or Svelte). Addresses known architectural debt: monolithic app.js, manual DOM manipulation, no type safety. Do in two phases: (1) TypeScript + Vite, (2) framework. Requires external research + subagent red team per new process.

---

## Done

### Launch

- [x] **Data accuracy deep dive**
- [x] **OG meta tags + site copy review**
- [x] **Chart image export / copy button**
- [x] **Simple analytics**
- [x] **Review recent PRs (benchmark lifecycle + LLM analysis)**
- [x] **Unified date filter**
- [x] **Error / loading states**
- [x] **Verified/unverified data tier**
- [x] **Benchmark expansion** — FrontierMath + MATH Level 5
- [x] **In-chart citation & source attribution**
- [x] **Security audit** (PR #20)
- [x] **Design, accessibility & responsiveness review**
- [x] **Refine AI analysis prompt & UI** (PR #18)
- [x] **QA generated analyses across all presets** (PR #19)
- [x] **Code cleanliness review & refactor**
- [x] **Add contact / author details**
- [x] **Write LinkedIn post to announce site**
- [x] **Redesign Cost Intelligence tab**
- [x] **Add older saturated benchmarks**

### Post-Launch

- [x] **Review JP's codebase roast** — Feedback reviewed, quick wins shipped (2beec7e), bigger items logged as architectural debt. (2026-03-18)
- [x] **Codebase walkthrough** — Guided tour so Jack understands file/module responsibilities and data flow. (2026-03-18)
- [x] **Automated data pipeline** — Weekly automated refresh of all data sources + model card extraction from lab blogs. 4 phases: test suite (PR #22), data model (PR #23), extraction (PR #25), orchestrator + GitHub Actions (PR #31). 334 tests. (2026-03-23)
- [x] **Fix SWE-bench Pro data wipe** — Pipeline's dynamic DELETE scope accidentally wiped manually-seeded data. Promoted swe-bench-pro to automated pipeline, restricted DELETE to static benchmark list. (2026-03-23)
- [x] **Fix OpenAI extraction + Qwen scanner** — OpenAI never worked due to IP-level rate limiting from blog index scanning; replaced with RSS feed discovery. Qwen scanner found 0 articles due to SPA div-based navigation; added card-based scanner. Also separated scanning/extraction into separate browser instances. GPT-5.4 mini/nano manually re-extracted and split into separate models. PR #36. (2026-04-03)
- [x] **Fix OpenAI extraction reliability via Browserbase** — Per-lab opt-in (`useBrowserbase: true` in lab-sources.js) routes OpenAI through Browserbase cloud browser, bypassing the anti-bot that defeated four prior fixes. Validation rewritten to mirror production exactly (multi-article session, count + yield + render checks, fresh-article canary against OpenAI RSS). Failure isolation at three layers via tmpdir marker files; Browserbase outage skips OpenAI gracefully without blocking other labs. PR #44. (2026-04-30)
- [x] **Skip analysis regeneration when nothing changed** — Pipeline now gates the weekly regen step on benchmark_scores diff, cost_intelligence diff, preset coverage, quarter rollover, and 30-day max age. Adds workflow_dispatch override for prompt/model changes. PR #43. (2026-04-30)
- [x] **Carry `model_variant` through pipeline to tooltip** — Variant info (e.g. "with tools") now flows benchmark_raw → benchmark_scores → tooltip. Two-class classifier: harness variants (tools, scaffolds, browsing) preserved through dedup; config variants (thinking effort, etc.) still superseded by verified scores. Pipeline GitHub issue gains a Variant Review section listing unknown variants until they're added to HARNESS_KEYWORDS or ACKNOWLEDGED_CONFIG_VARIANTS in lib/pipeline.js. Migration 006 (manual) + select=* on data-loader.js for schema-tolerant deploys. PR #42. (2026-04-30)
- [x] **Verify OpenAI Browserbase extraction in production** — First post-merge pipeline run (2026-04-30) ingested 5 GPT-5.5 scores via automation with no manual seeding (GPQA 93.6, HLE 41.4 [no tools], HLE 52.2 [with tools], ARC-AGI-1 95, ARC-AGI-2 85), plus 26 untracked stored in raw. Validation 6/6 passed including fresh-article canary. Lab freshness OpenAI moved to 2026-05-01. Two non-blocking bugs fixed in the same session (3d1d9de): Google tree-walker tagName guard, and validation image-size guard to match production. (2026-05-01)
- [x] **Resolve carry-over variants from pipeline issue #45** — Classified `nonthinking` as acknowledged config and `prompt modification` as harness in lib/pipeline.js. Lifted GPT-5.5 SWE-bench Pro 58.6 manual flag (raw row 14661, triage_status `flag` → `ingest`); score was already on chart via the model_card row, override prevents weekly carry-over. Commit 3d1d9de. (2026-05-01)

### Other

- [x] Fix spacing between AI analysis and benchmark description (2026-03-04)
- [x] Add favicon (2026-03-04)
- [x] Remove Meta lab
- [x] Add qualitative data insights (LLM analysis)
- [x] Find a way to improve xAI data or scrap it

## Killed

- [~] Add best 'Open Source' line
- [~] Research additional benchmarks — Superseded by Wave 3 benchmark expansion task.

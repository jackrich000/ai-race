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
- [ ] **Fix automated extraction reliability** — Multiple extraction failures discovered 2026-04-27:
  - **OpenAI**: RSS discovery works but article page extraction fails (0 images, 2 text sections). Anti-bot protection fires on individual article pages, not just the index. The RSS fix (PR #36) only solved discovery, not content extraction. Next escalation: Browserbase cloud browser, or alternative content sources (system card PDFs on cdn.openai.com).
  - **Qwen**: Card scanner at `qwen.ai/research` finds some models (27b, 35b-a3b) but missed `qwen3.6-max-preview`. Playwright renders 31 text sections but LLM extracts 0 scores. Need to investigate: is the scanner not finding the article, or is the LLM extraction prompt failing on Qwen's page structure?
  - **DeepSeek on HuggingFace**: `scanBlogIndex()` scans `huggingface.co/deepseek-ai` looking for `<a>` links, but HuggingFace model pages aren't blogs — DOM structure is different. DeepSeek V4-Pro was not discovered despite URL pattern matching. Need to investigate HF-specific scanning.
- [ ] **Chinese Leaders automated extraction config** — Expand extraction sources for the Chinese Leaders lab:
  - **Kimi/Moonshot**: Not configured at all. Need to add `LAB_SOURCES` entry. HuggingFace page: `huggingface.co/moonshotai`. Kimi K2.6 was manually seeded (2026-04-27) but future releases won't be caught.
  - **DeepSeek HuggingFace scanning**: Configured but not working (see extraction reliability task above). URL pattern `/\/deepseek-ai\/DeepSeek-/` is correct but `scanBlogIndex()` doesn't work on HF's DOM.
  - **Qwen card scanner gaps**: Partially working (found 27b, 35b-a3b) but missed max-preview. May need to scan `qwen.ai/blog` in addition to `qwen.ai/research`, or adjust card selector.
  - Other Chinese labs to consider: MiniMax, Zhipu/GLM, ByteDance (from original backlog).
- [ ] **Evaluate bringing back Meta as a lab** — Meta released Muse Spark (2026-04-25) with competitive scores: HLE 58.4 (with tools), GPQA Diamond 89.5, SWE-bench Verified 77.4, SWE-bench Pro 52.4, ARC-AGI-2 42.5. Scores manually extracted and stored in benchmark_raw (2026-04-27). Questions to resolve: (1) Is Meta now a serious enough player to warrant a dedicated lab line on the chart? (2) If yes, add `ai.meta.com/blog/` to extraction sources. (3) Consider what color/branding to use (previously removed).
- [ ] **Add source-level sanity checks before ingestion** — The pipeline silently lost all ARC Prize data for ~4 weeks when their URL changed (404). Root cause: `fetchARCPrize()` error is caught and returns `[]`, then delete+insert proceeds and wipes the old data. Fix: before the delete step, verify each source returned a minimum number of results. If a source that normally provides data comes back empty, either abort ingestion for that source or flag it prominently in the pipeline report. The URL was fixed (2026-04-27, commit bd9693d), but the silent-failure pattern affects all sources.
- [ ] **Monitor Google DeepMind URL pattern** — Extraction relies on `/gemini-models/` URL pattern, which is fragile if Google changes their blog structure.
- [ ] **Fix SWE-bench variant extraction gap** — LLM doesn't tag "with prompt modification" as `model_variant` for the 80.2 SWE-bench score, causing dedup loss. (Surfaced in PR #42's first Variant Review section as an unknown variant.)
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
- [x] **Skip analysis regeneration when nothing changed** — Pipeline now gates the weekly regen step on benchmark_scores diff, cost_intelligence diff, preset coverage, quarter rollover, and 30-day max age. Adds workflow_dispatch override for prompt/model changes. PR #43. (2026-04-30)
- [x] **Carry `model_variant` through pipeline to tooltip** — Variant info (e.g. "with tools") now flows benchmark_raw → benchmark_scores → tooltip. Two-class classifier: harness variants (tools, scaffolds, browsing) preserved through dedup; config variants (thinking effort, etc.) still superseded by verified scores. Pipeline GitHub issue gains a Variant Review section listing unknown variants until they're added to HARNESS_KEYWORDS or ACKNOWLEDGED_CONFIG_VARIANTS in lib/pipeline.js. Migration 006 (manual) + select=* on data-loader.js for schema-tolerant deploys. PR #42. (2026-04-30)

### Other

- [x] Fix spacing between AI analysis and benchmark description (2026-03-04)
- [x] Add favicon (2026-03-04)
- [x] Remove Meta lab
- [x] Add qualitative data insights (LLM analysis)
- [x] Find a way to improve xAI data or scrap it

## Killed

- [~] Add best 'Open Source' line
- [~] Research additional benchmarks — Superseded by Wave 3 benchmark expansion task.

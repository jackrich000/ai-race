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
- [ ] **Expand extraction to more Chinese labs** — Add Kimi/Moonshot, MiniMax, Zhipu/GLM, ByteDance to the model card extraction pipeline. Need blog/model card URLs identified. (Qwen and DeepSeek already covered.)
- [ ] **Add source-level sanity checks before ingestion** — The pipeline silently lost all ARC Prize data for ~4 weeks when their URL changed (404). Root cause: `fetchARCPrize()` error is caught and returns `[]`, then delete+insert proceeds and wipes the old data. Fix: before the delete step, verify each source returned a minimum number of results. If a source that normally provides data comes back empty, either abort ingestion for that source or flag it prominently in the pipeline report. The URL was fixed (2026-04-27, commit bd9693d), but the silent-failure pattern affects all sources.
- [ ] **Skip analysis regeneration when no scores changed** — Gate `generate-analyses.js` on whether the ingestion diff is non-empty. Saves ~$5-15/week in API credits.
- [ ] **Monitor Google DeepMind URL pattern** — Extraction relies on `/gemini-models/` URL pattern, which is fragile if Google changes their blog structure.
- [ ] **Carry `model_variant` through pipeline to tooltip** — Model variant info (e.g. "with tools") exists in `benchmark_raw` but is lost before reaching the site. Needs end-to-end threading so variant-specific scores display correctly.
  - **Problem discovered (2026-04-27):** HLE "with tools" scores (e.g. Claude Opus 4.7: 54.7) are being silently dropped by `filterVerifiedDuplicates()` because Artificial Analysis has a verified HLE score for the same model (39.6). But "with tools" is a fundamentally different evaluation condition, not a duplicate. Meanwhile, OpenAI's "GPT-5.4 Pro (with tools)" at 58.7 *survives* only because AA hasn't tested that model yet. So the site inconsistently shows "with tools" data for some labs but not others.
  - **AA provides no variant metadata** — just one score per model, no indication of evaluation conditions. AA's HLE 39.6 for Opus 4.7 is below even the model card "no tools" score (46.9), suggesting AA uses a different standardized setup. We can't infer AA's variant from the numbers.
  - **Scope of changes:**
    1. **DB schema:** Add `model_variant` column to `benchmark_scores` table (nullable text)
    2. **Ingestion (`update-data.js`):** Update `fetchModelCardData()` SELECT to include `model_variant` (currently only selects `benchmark, lab, model, score, date, source, verified`). Thread variant through cumulative-best computation and INSERT.
    3. **Dedup logic (`filterVerifiedDuplicates()` in `lib/pipeline.js`):** Make variant-aware. Only supersede unverified entry if variants are "equivalent": null/empty/"no tools"/"without tools" all count as standard condition (equivalent); "with tools" is distinct and should not be superseded by a standard-condition verified score.
    4. **Frontend tooltip (`app.js`):** Display variant when present (e.g. "Claude Opus 4.7 [with tools]")
    5. **Export canvas (`buildExportCanvas()`):** Match any tooltip changes
  - **Current DB state:** 5 items just approved for ingestion (2026-04-27): Opus 4.7 HLE 46.9 [no tools] (id:8898), HLE 54.7 [with tools] (id:8899), SWE-bench Pro 64.3 (id:8895), Qwen3.6-35B-A3B SWE-bench Pro 49.5 (id:8932), SWE-bench Verified 73.4 (id:8933). The Opus 4.7 HLE "with tools" score will be eaten by the dedup filter until step 3 is implemented.
  - **Existing hardcoded seeds already affected:** `MODEL_CARD_DATA` in `update-data.js` includes "(with tools)" baked into model names for HLE (lines 91, 100, 105, 109, 115). These survive inconsistently depending on whether AA has tested the model.
- [ ] **Fix SWE-bench variant extraction gap** — LLM doesn't tag "with prompt modification" as `model_variant` for the 80.2 SWE-bench score, causing dedup loss.
- [ ] **Explore efficient manual benchmark entry** — MMMU/MMMU-Pro (multimodal) and OSWorld (computer use) would broaden capability coverage but lack automated data sources. Investigate lightweight manual entry workflows.
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

### Other

- [x] Fix spacing between AI analysis and benchmark description (2026-03-04)
- [x] Add favicon (2026-03-04)
- [x] Remove Meta lab
- [x] Add qualitative data insights (LLM analysis)
- [x] Find a way to improve xAI data or scrap it

## Killed

- [~] Add best 'Open Source' line
- [~] Research additional benchmarks — Superseded by Wave 3 benchmark expansion task.

# AI Benchmark Tracker - Task Board

> **Owner**: Jack | **Agent**: Claude Code
> Statuses: `[ ]` Todo | `[-]` In Progress | `[x]` Done | `[~]` Killed

---

## Archive: Launch (Complete)

Waves 1-4 shipped. See git history for details.

---

## Backlog

- [x] **Review JP's codebase roast** — Go through JP's feedback and identify concrete, actionable improvements. Separate signal from noise. Quick wins shipped (2beec7e), bigger items logged as architectural debt. (2026-03-18)
- [x] **Codebase walkthrough** — Guided tour of the codebase so Jack understands what each file/module does and how data flows end-to-end. (2026-03-18)

- [ ] **Make site accessible to non-technical audiences** — Multiple improvements:
  - Better structure expanded benchmark descriptions in methodology section: clearly separate a) what the benchmark is from b) where we get the data
  - Label benchmarks on the chart for context (e.g. "SWE-Bench Pro (Coding)") so unfamiliar visitors know what they're looking at
  - Make AI analysis understandable without benchmark expertise (e.g. not "ARC-AGI 2 scores increased" but "scores on the hardest benchmark for testing problem-solving capabilities increased...")
- [ ] **Sharpen AI analysis for executive audiences** — Manually extract the best insights from the data, then work backwards to tune the analysis prompt. What would you highlight presenting to a C-level audience?
- [ ] **Share best insights from the site on LinkedIn / Reddit** — Identify the most compelling data stories and package them for social sharing.
- [ ] **Rethink aggregate view on Lab Race tab** — Hard to get a sense of who is really ahead when data is spread across 6 benchmark tabs. Need a way to show the overall picture.
- [ ] **Differentiated branding / visual identity** — Come up with branding that could extend across apps, blog, slides. Opportunity to define a reusable visual identity. Explore testing the [frontend-design skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) for this.
- [-] **Automated data pipeline** — Weekly automated refresh of all data sources + model card extraction from lab blogs. (2026-03-19)
  - [x] Phase 1: Test suite (Vitest + `lib/pipeline.js`, 77 tests) — PR #22, merged
  - [x] Phase 2: Data model + DB-driven model cards (migration, seed script, post-insert verification) — PR #23, merged
  - [-] Phase 3: Model card extraction — PR #25 (replaces old PR #24, now closed). Rewritten from scratch with clean module structure. (2026-03-20)
    - [x] Clean module architecture: `lib/extraction.js` (pure helpers), `lib/llm-extract.js` (LLM calls), `scripts/extract-model-cards.mjs` (orchestrator)
    - [x] 110 unit tests passing (48 new extraction tests)
    - [x] Blog scanning + article classification (Haiku) working
    - [x] Benchmark normalization (`normalizeBenchmarkName`) + triage (`triageScore`) with tests
    - [x] All scores stored in `benchmark_raw` (tracked + untracked). Triage only affects curated pipeline.
    - [x] Post-run GitHub Issue report (summary table, flagged scores, auto-ingested, untracked)
    - [x] Browserbase integration for navigation (bypasses anti-bot on OpenAI, xAI)
    - [x] Anthropic: 20+ scores extracted, all 16 ground truth scores present
    - [-] **OpenAI: only 4/16 scores extracted**. Images download but vision returns 0. Text extraction gets 2. Needs investigation.
    - [-] **xAI: 5 scores extracted (matches ground truth count)**. xAI uses SVG charts, not raster images — text+SVG extraction handles this. Need to verify exact values match ground truth.
    - [ ] **Google DeepMind**: URL updated to `deepmind.google/discover/blog/`, not yet tested
    - [ ] **Qwen**: SPA at `qwen.ai/blog`, not yet tested. Has HTML tables with benchmark data.
    - [ ] **DeepSeek**: HuggingFace model cards, not a blog. Needs custom discovery logic. Has text-based HTML tables.
    - [ ] Fix fabricated ground truth test file (`tests/extraction-ground-truth.test.js`) — rewrite with real data from `project_extraction_groundtruths.md`
    - [ ] Near 100% accuracy on Anthropic + OpenAI + xAI before merging
    - **Note**: Final prototype code (`test-extraction.mjs`) was never committed and is lost. Early prototypes (screenshot-based) still on disk as `scripts/prototype-*.mjs`. Current code implements the validated approach (DOM text + SVG text + CDN image download + LLM analysis, no screenshots) but cannot be diffed against the exact prototype.
  - [ ] Phase 4: GitHub Actions workflow (blocked on Phase 3). Weekly Thursday night run. Must sync with verified data ingestion (`update-data.js`) so both sources are fresh before the site renders.
- [ ] **Explore efficient manual benchmark entry** — MMMU/MMMU-Pro (multimodal) and OSWorld (computer use) would broaden capability coverage but lack automated data sources. Investigate lightweight manual entry workflows.
- [ ] **Zoom to fit** — Chart automatically zooms to the time period where the selected benchmark is active, so you're not looking at empty space before/after it existed.
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

### Other

- [x] Fix spacing between AI analysis and benchmark description (2026-03-04)
- [x] Add favicon (2026-03-04)
- [x] Remove Meta lab
- [x] Add qualitative data insights (LLM analysis)
- [x] Find a way to improve xAI data or scrap it

## Killed

- [~] Add best 'Open Source' line
- [~] Research additional benchmarks — Superseded by Wave 3 benchmark expansion task.

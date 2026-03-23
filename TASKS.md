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
- [x] **Automated data pipeline** — Weekly automated refresh of all data sources + model card extraction from lab blogs. (2026-03-23)
  - [x] Phase 1: Test suite (Vitest + `lib/pipeline.js`, 77 tests) — PR #22, merged
  - [x] Phase 2: Data model + DB-driven model cards (migration, seed script, post-insert verification) — PR #23, merged
  - [x] Phase 3: Model card extraction — PR #25, merged
  - [x] Phase 4: Pipeline orchestrator + GitHub Actions — PR #31, merged (2026-03-23)
    - [x] Combined orchestrator (`scripts/run-pipeline.mjs`): extraction → ingestion → diff → combined GitHub issue report
    - [x] GitHub Actions workflow: weekly Thursday 11 PM UTC cron + manual `workflow_dispatch` trigger
    - [x] Combined report shows: flagged items (with rollover), auto-rejected, new scores on site (diff table)
    - [x] Full pipeline test across all 5 labs: 32 articles processed, 16 review items resolved
    - [x] Review workflow tested: Jack reviews GitHub issue, tells Claude Code what to ingest/reject/dismiss
    - [x] AIME normalization fixed: only OTIS Mock variant matches, not generic AIME 2024/2025
    - [x] Variant normalization: "no tools"/"without tools" treated as equivalent
    - [x] Dynamic delete scope in ingestion: prevents duplicate key errors when new benchmarks enter via extraction
    - [x] DB migration 005: `triage_reason` column (applied 2026-03-23)
    - [x] 334 tests passing
    - [x] CI verified: manual `workflow_dispatch` run succeeded, heartbeat report posted (issue #32)
  - [ ] Phase 3b: Expand extraction to Qwen + other Chinese labs — Qwen (`qwen.ai/research`), Kimi/Moonshot, MiniMax, Zhipu/GLM, ByteDance. **Qwen issue**: SPA with no `<a href>` links; article discovery requires click-based navigation (titles are `<div>` elements with JS routing, URLs use `qwen.ai/blog?id={slug}` pattern). Other Chinese labs need blog/model card URLs identified.
  - [ ] Future improvements:
    - [ ] Browser isolation per lab (single browser session currently shared; one blocked site hangs the pipeline)
    - [ ] Monitor Google DeepMind URL pattern (`/gemini-models/`) — fragile if Google changes URL structure
    - [ ] SWE-bench 80.2 variant extraction gap: LLM doesn't tag "with prompt modification" as model_variant, causing dedup loss
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

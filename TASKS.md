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
- [-] **Automated data pipeline** — Consolidated from 3 separate tasks (scheduled refresh, model card automation, test suite). Plan complete, ready for implementation. Weekly Thursday night cron + manual dispatch. Full plan in `.claude/plans/floofy-pondering-river.md`. (2026-03-19)
  - Phase 1: Test suite (Vitest, extract pure functions, comprehensive tests)
  - Phase 2: Data model migration (benchmark_raw columns, seed existing model cards, read from Supabase)
  - Phase 3: Model card extraction (Browserbase/Stagehand, extract() + vision, LLM triage, GitHub Issue alerts)
  - Phase 4: GitHub Actions workflow + alerting
  - Prototype validated: Browserbase bypasses anti-bot on OpenAI/xAI, extract() + vision complementary, Sonnet 4.5 100% accurate on viewport screenshots
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

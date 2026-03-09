# AI Benchmark Tracker - Task Board

> **Owner**: Jack | **Agent**: Claude Code
> Statuses: `[ ]` Todo | `[-]` In Progress | `[x]` Done | `[~]` Killed

---

## Launch Scope

Minimum viable launch. Organized into waves for parallel execution.

### Wave 1 — Start first, all independent

- [x] **Data accuracy deep dive** — Check all data points against official external sources. Think through where users might challenge the numbers.
- [x] **OG meta tags + site copy review** *(single worktree)* — Add og:title, og:description, og:image for good LinkedIn/X previews. Review and refine all site copy to align around purpose: easy, reliable, up-to-date view of AI model progress for consultants/employees building slides. Do copy first since OG description should match.
- [x] **Chart image export / copy button** — High quality image export so users can paste charts directly into slides.
- [x] **Simple analytics** — Vercel Web Analytics (cookieless, GDPR compliant, no consent banner needed). Enabled in dashboard + script tag in index.html.

### Wave 2 — After Wave 1 merges

- [x] **Review recent PRs (benchmark lifecycle + LLM analysis)** — Detailed review of PRs #11 and #12. Three focus areas: (1) Review LLM analysis prompt and output quality in detail, (2) Think through deprecation/saturation logic and how it's labelled in the UI, (3) Retest copy-to-clipboard and image export to verify they work correctly after the benchmark lifecycle changes.
- [x] **Unified date filter** *(single worktree)* — Single date filter controls both chart view and AI analysis. Remove the "generate analysis" button entirely. Chart updates and analysis auto-generates for selected period. **Also:** add rate limiting + response caching on `/api/analyze`; redesign analysis panel — copy icon (not text button, match chart style with green flash), headlines-first layout with individual copy buttons per headline.
- [x] **Error / loading states** — Handle Supabase slowness or API failures gracefully. A blank chart or crash kills trust.

### Wave 3 — Data completeness

- [x] **Verified/unverified data tier** — Added `verified` column, `benchmark_raw` audit table, model card ingestion (GPT-5.4, Claude Sonnet/Opus 4.6, Gemini Deep Think/3.1 Pro) with per-entry `matchVerified` regex filtering against verified sources. Hollow dots for unverified, source attribution in tooltips. Currently 2 unverified entries survive: HLE Google (Deep Think), SWE-bench Pro OpenAI (GPT-5.4).
- [x] **Benchmark expansion** — Added FrontierMath (active, research-level math from Epoch AI, ~25-50% range) and MATH Level 5 (saturated, hardest MATH tier, 23%→98% over 2023-2025). Both sourced from Epoch AI CSVs — config-only changes, no new ingestion code. Full data refresh across all benchmarks completed. Now tracking 7 active + 4 inactive benchmarks.
- [x] **In-chart citation & source attribution** — Dynamic citation line (right-aligned, sources update per view), info button linking to methodology section, per-point source attribution in tooltips, methodology intro explaining verified/unverified, analysis disclaimer, export canvas uses dynamic sources. Also: benchmark descriptions rewritten (conversational, source-aware), SWE-bench Pro renamed to "(Public)", math benchmarks grouped at bottom of active list.

### Wave 4 — Final polish before launch

- [ ] **Security audit** — Deep dive all potential security holes and risks before public release. Execute necessary improvements.
- [ ] **Design, accessibility & responsiveness review** — Not a redesign. High-impact / low-effort pass: contrast, focus states, aria labels, colour-blind friendliness, visual hierarchy, spacing. Also responsiveness: desktop sizing/scaling at 100% zoom, mobile pitfalls (hardcoded px widths, missing overflow handling, media query gaps, font sizing).
- [x] **Refine AI analysis prompt & UI** — Rearchitected: structured stat cards (code-computed) + LLM headlines/commentary (JSON). Mode-specific rendering, trailing 12-month window, unified info area, single-quarter presets filtered. All 7 presets regenerated. PR #18.
- [ ] **QA generated analyses across all presets** — Spot-check LLM headlines and commentary across all 7 presets (all-time, last-12-months, last-6-months, last-3-months, 2023, 2024, 2025) and all 3 modes. Check: headlines don't repeat stats, commentary adds genuine insight, numbers are consistent with callouts, tone matches guidelines, edge cases (2023 sparse data, last-3-months single quarter).
- [ ] **Code cleanliness review & refactor** — Review codebase, refactor where valuable.
- [ ] **Add contact / author details** — Add links to Jack's Substack and LinkedIn somewhere on the site, so visitors can reach out if it gets traction. Keep it subtle (e.g. footer or small "by" line).
- [ ] **Write LinkedIn post to announce site**

---

## Backlog

Deferred — good ideas, not needed for launch.

- [~] **Research additional benchmarks** — Superseded by Wave 3 benchmark expansion task.
- [ ] **Rethink aggregate view on Lab Race tab** — Hard to get a sense of who is really ahead when data is spread across 6 benchmark tabs. Need a way to show the overall picture.
- [ ] **Differentiated branding / visual identity** — Come up with branding that could extend across apps, blog, slides. Opportunity to define a reusable visual identity.
- [ ] **Redesign Cost Intelligence tab** — Concept is complicated, current design isn't intuitive enough.
- [x] **Add older saturated benchmarks** — Implemented as benchmark lifecycle system: 5 active + 3 inactive (HumanEval saturated, ARC-AGI-1 deprecated, SWE-bench Verified deprecated). Grey dashed lines with hover-to-highlight and custom tooltips. Also added SWE-bench Pro as active replacement.
- [ ] **Set up scheduled data refresh** — Decide frequency (daily vs weekly) based on source update cadence. Automate the ingestion script.
- [ ] **Automate model card data collection** — Currently MODEL_CARD_DATA is manually curated by reading lab blog posts. Explore browser-use MCP tools (e.g. Playwright MCP, browser-use) to give Claude access to view model card pages and extract benchmark scores directly from official lab announcements. Would eliminate the manual step of reading images/tables and transcribing numbers. Key challenge: scores are often in images/infographics, not structured text.
- [ ] **Explore efficient manual benchmark entry** — MMMU/MMMU-Pro (multimodal) and OSWorld (computer use) would broaden capability coverage but lack automated data sources. Investigate lightweight manual entry workflows.
- [ ] **Non-percentage benchmark visualizations** — Design a way to display benchmarks with non-% scoring (Elo, minutes, percentile). Candidates: METR Time Horizons (autonomous task duration — all major labs, run by METR/Epoch AI), GDPval (economic value — Elo-based, on Artificial Analysis), Codeforces / LiveCodeBench Pro (competitive coding — Elo-based). Requires a different chart type or normalization approach. Would unlock some of the most important agentic and economic benchmarks.

---

## Done

- [x] Fix spacing between AI analysis and benchmark description (2026-03-04)
- [x] Add favicon (2026-03-04)
- [x] Remove Meta lab
- [x] Add qualitative data insights (LLM analysis)
- [x] Find a way to improve xAI data or scrap it

## Killed

- [~] Add best 'Open Source' line

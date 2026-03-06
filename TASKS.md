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

- [ ] **Review recent PRs (benchmark lifecycle + LLM analysis)** — Detailed review of PRs #11 and #12. Three focus areas: (1) Review LLM analysis prompt and output quality in detail, (2) Think through deprecation/saturation logic and how it's labelled in the UI, (3) Retest copy-to-clipboard and image export to verify they work correctly after the benchmark lifecycle changes.
- [ ] **Unified date filter** *(single worktree)* — Single date filter controls both chart view and AI analysis. Remove the "generate analysis" button entirely. Chart updates and analysis auto-generates for selected period.
- [ ] **Error / loading states** — Handle Supabase slowness or API failures gracefully. A blank chart or crash kills trust.

### Wave 3 — Data completeness

- [ ] **Verified/unverified data tier** — Add data model support (source column, verified/unverified flag, multi-row-per-model with preference logic). UI treatment: hollow dots for unverified scores, tooltip tags showing provenance. Chart logic prefers verified, falls back to unverified. Test with a few manual model-card scores on existing benchmarks. This is the foundation for benchmark expansion.
- [ ] **Benchmark expansion** *(requires verified/unverified tier)* — Survey latest frontier model cards (GPT-5.4, Sonnet 4.6, Gemini 3.1 Pro, Grok 3.5, Chinese frontier) for benchmarks appearing on >50% of them. Check for gaps in agentic, browser use, and long-horizon evals (e.g. METR, GDPval). Explore data sources (current APIs + new), review options, decide what to add, implement. Goals: (a) most up-to-date view, (b) diverse range of AI capabilities.
- [ ] **In-chart citation & source attribution** — Add a citation line inside the chart area (left: `ai-race.vercel.app`, right: source names for current view). Add an info icon with tooltip explaining data sources and methodology. Must also update `buildExportCanvas()` to read from the same source of truth.
  - **Short citation line** (visible in chart area): Left: `ai-race.vercel.app` | Right: dynamic source names per view (e.g. "Source: ARC Prize" or "Source: Artificial Analysis")
  - **Info tooltip** (on hover/click of an info icon): "Scores are sourced from official benchmark leaderboards (ARC Prize, SWE-bench Verified) and independent evaluation platforms (Artificial Analysis, Epoch AI). Scores may differ slightly from lab-reported model card numbers due to differences in evaluation methodology. Price data is from Artificial Analysis (blended 3:1 input:output per million tokens)." — NB: revisit this text after verified/unverified tier and benchmark expansion are complete; will need to reflect new sources and provenance model.

### Wave 4 — Final polish before launch

- [ ] **Security audit** — Deep dive all potential security holes and risks before public release. Execute necessary improvements.
- [ ] **Design, accessibility & responsiveness review** — Not a redesign. High-impact / low-effort pass: contrast, focus states, aria labels, colour-blind friendliness, visual hierarchy, spacing. Also responsiveness: desktop sizing/scaling at 100% zoom, mobile pitfalls (hardcoded px widths, missing overflow handling, media query gaps, font sizing).
- [ ] **Code cleanliness review & refactor** — Review codebase, refactor where valuable.
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

---

## Done

- [x] Fix spacing between AI analysis and benchmark description (2026-03-04)
- [x] Add favicon (2026-03-04)
- [x] Remove Meta lab
- [x] Add qualitative data insights (LLM analysis)
- [x] Find a way to improve xAI data or scrap it

## Killed

- [~] Add best 'Open Source' line

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

- [ ] **In-chart citation & source attribution** — Add a citation line inside the chart area (left: `ai-race.vercel.app`, right: source names for current view). Add an info icon with tooltip explaining data sources and methodology. Must also update `buildExportCanvas()` to read from the same source of truth.
  - **Short citation line** (visible in chart area): Left: `ai-race.vercel.app` | Right: dynamic source names per view (e.g. "Source: ARC Prize" or "Source: Artificial Analysis")
  - **Info tooltip** (on hover/click of an info icon): "Scores are sourced from official benchmark leaderboards (ARC Prize, SWE-bench Verified) and independent evaluation platforms (Artificial Analysis, Epoch AI). Scores may differ slightly from lab-reported model card numbers due to differences in evaluation methodology. Price data is from Artificial Analysis (blended 3:1 input:output per million tokens)."
- [ ] **Unified date filter + LLM analysis prompt** *(single worktree)* — Single date filter controls both chart view and AI analysis. Remove the "generate analysis" button entirely. Chart updates and analysis auto-generates for selected period. Also improve the analysis prompt: give it specific narratives to look for, use more vivid language. Do date filter first, then refine prompt to work with new mechanism.
- [ ] **Error / loading states** — Handle Supabase slowness or API failures gracefully. A blank chart or crash kills trust.
- [ ] **Responsiveness audit** — Broader than just mobile. On desktop at 100% zoom the site feels small — investigate sizing/scaling approach. Also review HTML/CSS for mobile pitfalls: hardcoded px widths, missing overflow handling, elements assuming minimum widths, media query gaps, font sizing issues. Do this last in Wave 2 so it catches issues from new UI features.

### Wave 3 — Final polish before launch

- [ ] **Security audit** — Deep dive all potential security holes and risks before public release. Execute necessary improvements.
- [ ] **Code cleanliness review & refactor** — Review codebase, refactor where valuable.
- [ ] **Write LinkedIn post to announce site**

---

## Backlog

Deferred — good ideas, not needed for launch.

- [ ] **Research additional benchmarks** — Check latest model cards + Reddit/LinkedIn/X trends for gaps. Suspicion: missing GDPval, browser use benchmarks, agentic execution benchmarks (e.g. METR long task horizon). Need to verify reliable data sources exist before committing.
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

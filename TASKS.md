# AI Benchmark Tracker - Task Board

> **Owner**: Jack | **Agent**: Claude Code
> Statuses: `[ ]` Todo | `[-]` In Progress | `[x]` Done | `[~]` Killed

---

## Ideas

These are ideas to explore / research before committing to execution.

- [ ] **Improve LLM analysis prompt** — Give it specific narratives to look for, e.g. "share the biggest jump in performance during your selected time period from the Frontier Progress chart." Use more vivid, specific language patterns.
- [ ] **Research additional benchmarks** — Check latest model cards + Reddit/LinkedIn/X trends for gaps. Suspicion: missing GDPval, browser use benchmarks, agentic execution benchmarks (e.g. METR long task horizon). Need to verify reliable data sources exist before committing.
- [ ] **Rethink aggregate view on Lab Race tab** — Hard to get a sense of who is really ahead when data is spread across 6 benchmark tabs. Need a way to show the overall picture.
- [ ] **Differentiated branding / visual identity** — Come up with branding that could extend across apps, blog, slides. Opportunity to define a reusable visual identity.

---

## To Do

Committed work, ready to be picked up.

- [ ] **Add simple analytics** — Just visitor counts, nothing detailed. Check if GDPR notice is required and implement if so.
- [ ] **Set up scheduled data refresh** — Decide frequency (daily vs weekly) based on source update cadence. Automate the ingestion script.
- [ ] **Security audit** — Deep dive all potential security holes and risks before public release. Execute necessary improvements.
- [ ] **Code cleanliness review & refactor** — Review codebase, refactor where valuable.
- [ ] **Add older saturated benchmarks** — Show historic progress for benchmarks that are now saturated, but only up to their saturation point (90-95%+). Addresses the gap where Q1 2023 to Q2 2024 looks flat.
- [x] **Fix spacing between AI analysis and benchmark description** (completed 2026-03-04)
- [ ] **Review and refine all site copy** — Align around purpose: easy, reliable, up-to-date view of AI model progress for consultants/employees building slides for superiors/clients.
- [ ] **Redesign Cost Intelligence tab** — Concept is complicated, current design isn't intuitive enough.
- [ ] **Add date filter to chart** — Consider merging with AI analysis element to avoid two separate date filters. E.g. "generate analysis for selected time period" button, or auto-generate on filter change.
- [ ] **Data accuracy deep dive** — Check all data points against official external sources. Think through where users might challenge the numbers.
- [ ] **Chart image export / copy button** — High quality image export so users can paste charts directly into slides.
- [x] **Add favicon** (completed 2026-03-04)
- [ ] **Write LinkedIn post to announce site**
- [ ] **Add Open Graph / social meta tags** — Proper og:title, og:description, og:image so LinkedIn/X previews look good when sharing. Critical for launch announcement.
- [ ] **Mobile responsiveness** — Ensure charts and layout render well on phones. Consultants will tap the LinkedIn link on mobile first.
- [ ] **Error / loading states** — Handle Supabase slowness or API failures gracefully. A blank chart or crash kills trust.

---

## In Progress


---

## Done

- [x] Remove Meta lab
- [x] Add qualitative data insights (LLM analysis)
- [x] Find a way to improve xAI data or scrap it

## Killed

- [~] Add best 'Open Source' line

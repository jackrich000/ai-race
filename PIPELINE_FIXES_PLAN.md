# Pipeline Fixes Plan — label bug + alias drift + OpenAI/xAI streak

> Planned 2026-05-29. Approach agreed with Jack; red-teamed. Ready to execute in a future session.
> Lifecycle: this is a scratch planning artifact — delete it once all three issues have shipped.

## How this came up

Jack checked his GitHub issues on 2026-05-29 (Friday) and found no pipeline report for the
Thursday-night scheduled run. Investigation (`gh run view 26609931926`) showed the run **did**
fire (2026-05-29 00:11 UTC) and **succeeded** — data ingested, analyses regenerated — but the
final "post a GitHub issue" step failed silently, so no report appeared. Digging into that
uncovered three separate problems, two of them latent bugs and one open question.

For context, the report that never posted (recovered from the Actions log) contained:
- 3 new scores on site: FrontierMath/Google 39, Terminal-Bench 2.0/Anthropic 90.2 (Opus 4.7),
  Terminal-Bench 2.0/OpenAI 84.7 (GPT-5.5) — all from Epoch AI, verified.
- 1 variant-review item: Qwen3.7 HLE 53.5 [w/ tools].
- **2 streak alerts**: OpenAI and xAI, "articles scraped, no scores yielded" since 2026-05-07.

Separately, the Claude Opus 4.8 launch article (https://www.anthropic.com/news/claude-opus-4-8,
published 2026-05-28) was correctly scanned and extracted. All four tracked-ish numbers were
extracted accurately (verified against the article with Jack):
- SWE-bench Pro 69.2 → INGESTED ✓
- HLE 49.8 [no tools] → INGESTED ✓
- HLE 57.9 [with tools] → INGESTED ✓
- OSWorld-Verified 83.4 → **SKIPPED to raw as "untracked"** (this is issue #2)

---

## Issue 1 — Report never posts (missing-label bug)

**Root cause.** `scripts/run-pipeline.mjs` builds the issue's label set (~lines 646-650):
```
const labelSet = new Set(["pipeline-report"]);
if (totalFlagged > 0 || staleLabs.length > 0) labelSet.add("needs-review");
if (hasSourceHealthFailure) labelSet.add("pipeline-failure");   // line 648
if (streakAlerts.length > 0) labelSet.add("pipeline-alert");    // line 649
```
`pipeline-failure` and `pipeline-alert` **do not exist in the repo** (only `pipeline-report`,
`needs-review`, `extraction-report` exist — confirmed via `gh label list`). `postGitHubIssue()`
(~line 658) runs `gh issue create ... --label <labels>`, and `gh` fails hard when handed a
nonexistent label. The whole report is lost (caught at ~line 669, printed to the Actions log only).

**Why it only broke now.** Streak alerts need 4 consecutive runs to fire. The OpenAI/xAI streak
started 2026-05-07, so 2026-05-29 was the first run to ever add the `pipeline-alert` label →
first time `gh issue create` was handed a missing label → first failure. Prior weeks (#56, #57)
posted fine.

**Fix.**
1. Create the two missing repo labels with explicit color + description, **check-then-create**
   (do NOT blind `gh label create --force` over the whole set — `--force` resets color/description
   of labels that already exist). [red-team S1]
2. Harden `postGitHubIssue()`:
   - Before posting, ensure each required label exists (idempotent: only create if missing).
   - If `gh issue create` still fails, retry once **without** `--label` — but only on a
     label-specific error. For any other failure (bad token, rate limit, malformed body), surface
     the real error loudly rather than masking it as "posted unlabelled". [red-team S2]
   - Rationale: a single bad label must never again silently eat the entire report. Same failure
     class as the alias drift — a missing registration entry shouldn't destroy output.
3. CI already grants `issues: write` (confirmed in the run log "Issues: write"), so label creation
   works in Actions too.
4. **Re-post the lost 2026-05-29 report** as a tracked issue so Jack has this week's 3 scores +
   2 streak alerts. Body is recoverable from `gh run view 26609931926 --log` (search "Report body").

**Tests.** Unit-test the label-set builder. Real verification = the re-post + the next scheduled run.

---

## Issue 2 — Alias drift drops tracked scores (OSWorld, MMMU-Pro)

**Root cause.** `normalizeBenchmarkName()` (`lib/extraction.js` ~271-306) decides "tracked vs
untracked" via a hand-maintained `BENCHMARK_ALIASES` table (~line 206). That table only contains
the original ~10 benchmarks (GPQA, ARC-AGI-1/2, HLE, SWE-bench Pro/Verified, AIME, FrontierMath,
MATH-L5, HumanEval). It is a **second source of truth** that drifted from `config.js`
(`BENCHMARK_META`), the documented single source. Active benchmarks **OSWorld-Verified** and
**MMMU-Pro** have no alias, so `normalizeBenchmarkName("OSWorld-Verified")` returns
`{key:null, confidence:"none"}`.

**Why the score vanishes (data-flow trace).** In `scripts/extract-model-cards.mjs`:
- ALL extracted scores are written to `benchmark_raw`. For an untracked name, `benchmark` is set
  to a slugified raw name and triage is **skipped** (the `if (normalized.key && BENCHMARK_META[...])`
  guard ~line 1285 is false), so `triage_status` stays **null**.
- Ingestion (`scripts/update-data.js` `fetchModelCardData()` ~line 168) pulls model-card rows via:
  `.or("source.eq.model_card,and(source.eq.model_card_auto,triage_status.eq.ingest)")`.
  A row with `triage_status=null` is never picked up → never reaches the site.

So the Opus 4.8 OSWorld 83.4 is sitting in `benchmark_raw` (source=`model_card_auto`,
triage_status=null), invisible.

**Important nuance.** OSWorld-Verified and MMMU-Pro are *actively pinned* as untracked in the
ground-truth tests (`tests/extraction-ground-truth.test.js:22,28,42,43,63`) — so the untracked
status was encoded, not merely absent. Flipping them is a deliberate behavior change. By contrast
**Terminal-Bench 2.0** is pinned null in TWO files (`extraction-ground-truth.test.js:21,38` and
`extraction-helpers.test.js:278`) and is independently slated to **pause tracking** (see the
"Merge Pace into Frontier" task in TASKS.md) — so TB stays excluded.

**Decision: config-derived aliases** (Jack chose the proper fix over a quick patch, to kill the
drift bug class permanently).
1. Add an `aliases` field to extractable benchmarks in `config.js` `BENCHMARK_META`. It MUST
   preserve the exact-vs-fuzzy confidence distinction (e.g. `"gpqa"`→fuzzy, `"gpqa diamond"`→exact;
   `"swe-bench"`/`"swebench"`→fuzzy). Suggested shape: `aliases: { exact: [...], fuzzy: [...] }`.
2. Rebuild `BENCHMARK_ALIASES` in `extraction.js` FROM config. **Keep `normalizeBenchmarkName`'s
   staged matching logic (lowercase+collapse-space → paren-strip → qualifier-strip → combined)
   and its signature byte-for-byte unchanged — only swap the data source.** [red-team S3]
3. Keep the `BENCHMARK_ALIASES` export stable (consumed by `extract-model-cards.mjs`,
   `validate-extraction.mjs`).
4. **Regression test (do this BEFORE adding new aliases):** assert the config-generated table is
   identical to the old hardcoded table for every existing string + confidence. The full 334-test
   suite must pass unchanged except the deliberate OSWorld/MMMU-Pro flips.
5. Add aliases for **OSWorld-Verified** and **MMMU-Pro** only. Flip their GT tests
   (`extraction-ground-truth.test.js:22,28,42,43,63`) to expect the resolved keys. Keep
   Terminal-Bench 2.0 + saturated/Epoch-only benchmarks WITHOUT aliases (tests stay green).
6. Update the `extraction.js` header comment ("No external dependencies — operates on plain data
   only", ~line 2-3) since it now requires config. No circular import: `config.js` requires nothing
   and guards its browser-global export with `typeof module`. [red-team N1]

**Decision: auto-ingest** OSWorld/MMMU-Pro model-card scores (Jack chose this over flag-for-review).
- Residual risk accepted (red-team C1): OSWorld scores vary by agent scaffold (15/50/100-step),
  scaffold step-count is NOT in `HARNESS_KEYWORDS` (`lib/pipeline.js` ~120-156), and both
  benchmarks already carry verified Epoch/AA data (`update-data.js:90` os_world_external.csv;
  `update-data.js:396-438` AA MMMU-Pro page-scrape). So an unverified scaffold-variant score can
  become the displayed best via `computeCumulativeBest`.
- Why accepted: this is the SAME treatment HLE / SWE-bench Pro already get ("supplemented with
  unverified model card scores, hollow dots, best-per-quarter" is in the OSWorld config
  description). The `triageScore` >10pp-above-current-best guard still routes egregious outliers
  to review. Auto-ingest just makes these two behave like the others.
- Optional transparency follow-up (not required): add scaffold step-count patterns
  (`\d+-step`) to `HARNESS_KEYWORDS` so the scaffold shows in the tooltip. Note this does NOT
  prevent the score from being the displayed best — it only labels the condition.

---

## Backfill — recover stranded scores (separate, gated, explicit-ask)

Forward fix alone won't recover the Opus 4.8 OSWorld 83.4: the index scanner won't re-process an
already-seen article, so the stranded raw row (triage_status=null) stays stranded.

**Mechanism: a re-triage sweep.** New script `scripts/retriage-raw.mjs` (with `--dry-run`):
- Fetch all `source='model_card_auto'` rows from `benchmark_raw`.
- Re-run `normalizeBenchmarkName` + `triageScore` against current config.
- Update `triage_status` / `triage_reason` for rows whose classification changed.
- **Compute `currentBest` from `benchmark_scores` exactly as the live extractor does**
  (`extract-model-cards.mjs` ~913-926) so the >10pp guard behaves identically to forward runs and
  flags scaffold-inflated outliers. Do NOT default currentBest to null — that disables the guard.
  [red-team C2/C3]
- Data is fully recoverable: `raw_benchmark_name` is stored, so re-triage is deterministic.

**Run protocol (production data action — never automatic):**
1. Only after the alias PR merges.
2. Run `--dry-run`, show Jack the diff.
3. Explicit go-ahead, then run for real.
4. Then a normal ingestion run surfaces the now-`ingest` rows.

**Heads-up for Jack:** backfilling historical scores places them at their original publish
quarter, which can retroactively reshape past-quarter cumulative-best lines on the chart — not
just the latest point. [red-team N3]

---

## Issue 3 — OpenAI/xAI extraction streak (DIAGNOSE ONLY this session)

Both labs: "articles scraped, no scores yielded" for 4 consecutive runs since 2026-05-07. Root
cause unknown. Jack chose diagnose-first (the fix could be a one-line prompt tweak or a scraper
rework — don't commit blind).

**Diagnosis steps (in order):**
1. **FIRST** — check `benchmark_raw` for OpenAI/xAI `source='model_card_auto'` rows since
   2026-05-07 with `triage_status=null`. If they exist, the "streak" is the **alias gap** (those
   labs reported only untracked benchmarks like Terminal-Bench / τ2-bench / BrowseComp), NOT a
   scraper break — likely resolved by the alias work plus maybe one or two more aliases. This could
   collapse Issue 3 into Issue 2. [red-team N2 — strong hypothesis: both broke the same day
   PR #48's streak counter started tracking, so it may be a false positive]
2. If no such rows: real breakage. Run extraction locally for OpenAI + xAI
   (`node scripts/extract-model-cards.mjs --local`), inspect scraped articles vs LLM output.
   Check git/PR history around 2026-05-07 (PR #48 — pipeline health checks — shipped then).
   Inspect the `pipeline_runs` table history (articles_scraped vs scores_yielded per lab per run).
3. Write up findings → replan the actual fix.

**Memory hygiene note:** `project_extraction_status.md` says "All 5 labs working as of 2026-05-07".
That may be stale depending on diagnosis outcome — update it only AFTER root cause is confirmed
(don't record an unconfirmed regression).

---

## Sequencing & PR structure

- **PR 1 (bundled — Jack's choice):** label fix + config-derived aliases + GT test updates.
  Worktree → branch → PR. Deterministic, fully testable, no prod writes.
- **Post-merge, gated:** create the two repo labels; re-post the lost 2026-05-29 report; run the
  backfill re-triage (dry-run → diff → go-ahead → real → ingest).
- **Separate track:** Issue 3 diagnosis → findings → replan → (future PR 2).
- Update TASKS.md on master when done. Never edit TASKS.md inside a worktree branch.

## Key facts / IDs for a cold start
- Failed-to-post run: GitHub Actions run `26609931926` (2026-05-29). Report body in its log.
- Existing repo labels: `pipeline-report`, `needs-review`, `extraction-report`. Missing (referenced
  in code): `pipeline-alert`, `pipeline-failure`.
- Stranded row: Claude Opus 4.8, OSWorld-Verified 83.4, source=`model_card_auto`, triage_status=null.
- Opus 4.8 article: https://www.anthropic.com/news/claude-opus-4-8 (published 2026-05-28).

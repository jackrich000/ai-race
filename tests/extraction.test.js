import { describe, it, expect } from "vitest";

// Forward-looking tests for Phase 3 extraction functions.
// normalizeBenchmarkName and triageScore will be filled in during Phase 3.
// generateMatchVerifiedRegex tests are now in pipeline.test.js (implemented in Phase 2).

describe("normalizeBenchmarkName (placeholder)", () => {
  it.todo("exact matches: 'GPQA Diamond' -> gpqa");
  it.todo("fuzzy matches: 'GPQA' -> gpqa with fuzzy confidence");
  it.todo("untracked benchmarks return confidence 'none'");
});

describe("triageScore (placeholder)", () => {
  it.todo("auto-ingest: exact match, within 10pp of current best");
  it.todo("auto-reject: untracked benchmark");
  it.todo("auto-reject: nonsensical score (<0 or >100)");
  it.todo("flag-for-review: >10pp above current best");
  it.todo("flag-for-review: fuzzy benchmark match");
});

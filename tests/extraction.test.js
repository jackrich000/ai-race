import { describe, it, expect } from "vitest";

// Forward-looking tests for Phase 3 extraction functions.
// These will be filled in when lib/pipeline.js gains normalizeBenchmarkName,
// triageScore, and generateMatchVerifiedRegex.

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

describe("generateMatchVerifiedRegex (placeholder)", () => {
  it.todo("produces correct pattern for 'GPT-5.4 Mini'");
  it.todo("produces correct pattern for 'Claude Sonnet 4.6'");
});

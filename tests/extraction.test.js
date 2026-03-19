import { describe, it, expect } from "vitest";

const {
  normalizeBenchmarkName,
  triageScore,
} = require("../lib/pipeline.js");

// ─── normalizeBenchmarkName ──────────────────────────────────

describe("normalizeBenchmarkName", () => {
  it("exact matches for known benchmarks", () => {
    expect(normalizeBenchmarkName("GPQA Diamond")).toEqual({ key: "gpqa", confidence: "exact" });
    expect(normalizeBenchmarkName("ARC-AGI-2")).toEqual({ key: "arc-agi-2", confidence: "exact" });
    expect(normalizeBenchmarkName("HLE")).toEqual({ key: "hle", confidence: "exact" });
    expect(normalizeBenchmarkName("Humanity's Last Exam")).toEqual({ key: "hle", confidence: "exact" });
    expect(normalizeBenchmarkName("SWE-bench Verified")).toEqual({ key: "swe-bench", confidence: "exact" });
    expect(normalizeBenchmarkName("SWE-bench Pro")).toEqual({ key: "swe-bench-pro", confidence: "exact" });
    expect(normalizeBenchmarkName("AIME")).toEqual({ key: "aime", confidence: "exact" });
    expect(normalizeBenchmarkName("FrontierMath")).toEqual({ key: "frontiermath", confidence: "exact" });
    expect(normalizeBenchmarkName("MATH Level 5")).toEqual({ key: "math-l5", confidence: "exact" });
    expect(normalizeBenchmarkName("HumanEval")).toEqual({ key: "humaneval", confidence: "exact" });
  });

  it("fuzzy matches for ambiguous names", () => {
    expect(normalizeBenchmarkName("GPQA")).toEqual({ key: "gpqa", confidence: "exact" });
    expect(normalizeBenchmarkName("ARC-AGI")).toEqual({ key: "arc-agi-1", confidence: "fuzzy" });
    expect(normalizeBenchmarkName("SWE-bench")).toEqual({ key: "swe-bench", confidence: "fuzzy" });
    expect(normalizeBenchmarkName("AIME 2024")).toEqual({ key: "aime", confidence: "fuzzy" });
  });

  it("handles case insensitivity and whitespace", () => {
    expect(normalizeBenchmarkName("gpqa diamond")).toEqual({ key: "gpqa", confidence: "exact" });
    expect(normalizeBenchmarkName("  HLE  ")).toEqual({ key: "hle", confidence: "exact" });
    expect(normalizeBenchmarkName("arc agi 2")).toEqual({ key: "arc-agi-2", confidence: "exact" });
  });

  it("untracked benchmarks return confidence 'none'", () => {
    expect(normalizeBenchmarkName("MMLU")).toEqual({ key: null, confidence: "none" });
    expect(normalizeBenchmarkName("HellaSwag")).toEqual({ key: null, confidence: "none" });
    expect(normalizeBenchmarkName("")).toEqual({ key: null, confidence: "none" });
    expect(normalizeBenchmarkName(null)).toEqual({ key: null, confidence: "none" });
  });

  it("strips trailing qualifiers", () => {
    expect(normalizeBenchmarkName("HumanEval pass@1")).toEqual({ key: "humaneval", confidence: "exact" });
  });
});

// ─── triageScore ─────────────────────────────────────────────

describe("triageScore", () => {
  it("auto-ingest: exact match, within 10pp of current best", () => {
    const result = triageScore(85, 80, "gpqa", "exact", "");
    expect(result.action).toBe("ingest");
  });

  it("auto-ingest: no current best (first score)", () => {
    const result = triageScore(50, null, "hle", "exact", "");
    expect(result.action).toBe("ingest");
  });

  it("auto-reject: untracked benchmark", () => {
    const result = triageScore(80, null, null, "none", "");
    expect(result.action).toBe("reject");
    expect(result.reason).toContain("not tracked");
  });

  it("auto-reject: score below 0", () => {
    const result = triageScore(-5, 80, "gpqa", "exact", "");
    expect(result.action).toBe("reject");
  });

  it("auto-reject: score above 100", () => {
    const result = triageScore(105, 80, "gpqa", "exact", "");
    expect(result.action).toBe("reject");
  });

  it("flag-for-review: >10pp above current best", () => {
    const result = triageScore(95, 80, "gpqa", "exact", "");
    expect(result.action).toBe("review");
    expect(result.reason).toContain("15.0pp above");
  });

  it("flag-for-review: exactly 10pp above is OK", () => {
    const result = triageScore(90, 80, "gpqa", "exact", "");
    expect(result.action).toBe("ingest");
  });

  it("flag-for-review: fuzzy benchmark match", () => {
    const result = triageScore(50, 45, "aime", "fuzzy", "");
    expect(result.action).toBe("review");
    expect(result.reason).toContain("Fuzzy");
  });

  it("flag-for-review: harness flags in notes", () => {
    expect(triageScore(50, 45, "gpqa", "exact", "ensemble of 3 runs").action).toBe("review");
    expect(triageScore(50, 45, "gpqa", "exact", "custom scaffold").action).toBe("review");
  });

  it("allows 'with tools' for HLE only", () => {
    const hle = triageScore(50, 45, "hle", "exact", "with tools");
    expect(hle.action).toBe("ingest");

    const gpqa = triageScore(50, 45, "gpqa", "exact", "with tools");
    expect(gpqa.action).toBe("review");
  });
});

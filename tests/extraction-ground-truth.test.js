// tests/extraction-ground-truth.test.js
//
// Tests that ground truth benchmark names normalize correctly
// and that the deduplication and triage logic handles real-world data.
// Ground truths from project_extraction_groundtruths.md.

import { describe, it, expect } from "vitest";
import { normalizeBenchmarkName, deduplicateScores, triageScore } from "../lib/extraction.js";

// ─── Ground truth benchmark names (as extracted by the LLM) ──────

describe("ground truth benchmark normalization", () => {
  it("normalizes Anthropic Claude Sonnet 4.6 benchmarks", () => {
    // From main benchmark table (vision extraction)
    expect(normalizeBenchmarkName("SWE-bench Verified").key).toBe("swe-bench-verified");
    expect(normalizeBenchmarkName("Humanity's Last Exam (HLE)").key).toBe("hle");
    expect(normalizeBenchmarkName("ARC-AGI-2").key).toBe("arc-agi-2");
    expect(normalizeBenchmarkName("GPQA Diamond").key).toBe("gpqa");

    // Untracked benchmarks should return null key
    expect(normalizeBenchmarkName("Terminal-Bench 2.0").key).toBeNull();
    expect(normalizeBenchmarkName("OSWorld-Verified").key).toBeNull();
    expect(normalizeBenchmarkName("τ2-bench Retail").key).toBeNull();
    expect(normalizeBenchmarkName("MCP-Atlas").key).toBeNull();
    expect(normalizeBenchmarkName("BrowseComp").key).toBeNull();
    expect(normalizeBenchmarkName("Finance Agent v1.1").key).toBeNull();
    expect(normalizeBenchmarkName("GDPval-AA Elo").key).toBeNull();
    expect(normalizeBenchmarkName("MMMU-Pro").key).toBeNull();
    expect(normalizeBenchmarkName("MMMLU").key).toBeNull();
  });

  it("normalizes OpenAI GPT 5.4 Mini benchmarks", () => {
    expect(normalizeBenchmarkName("SWE-Bench Pro (Public)").key).toBe("swe-bench-pro");
    expect(normalizeBenchmarkName("GPQA Diamond").key).toBe("gpqa");
    expect(normalizeBenchmarkName("HLE").key).toBe("hle");

    // Untracked
    expect(normalizeBenchmarkName("Terminal-Bench 2.0").key).toBeNull();
    expect(normalizeBenchmarkName("MCP Atlas").key).toBeNull();
    expect(normalizeBenchmarkName("Toolathlon").key).toBeNull();
    expect(normalizeBenchmarkName("τ2-bench (telecom)").key).toBeNull();
    expect(normalizeBenchmarkName("OSWorld-Verified").key).toBeNull();
    expect(normalizeBenchmarkName("MMMUPro").key).toBeNull();
    expect(normalizeBenchmarkName("OmniDocBench 1.5").key).toBeNull();
    expect(normalizeBenchmarkName("OpenAI MRCR v2 8-needle 64K–128K").key).toBeNull();
    expect(normalizeBenchmarkName("Graphwalks BFS 0K–128K").key).toBeNull();
  });

  it("normalizes xAI Grok 4.1 Fast benchmarks", () => {
    // All xAI ground truth benchmarks are untracked
    expect(normalizeBenchmarkName("Multi Turn Acc").key).toBeNull();
    expect(normalizeBenchmarkName("Multi Turn Long Context").key).toBeNull();
    expect(normalizeBenchmarkName("Research-Eval Reka").key).toBeNull();
    expect(normalizeBenchmarkName("FRAMES").key).toBeNull();
    expect(normalizeBenchmarkName("X Browse").key).toBeNull();
  });

  it("normalizes Google DeepMind Gemini 3.1 Flash-Lite benchmarks", () => {
    expect(normalizeBenchmarkName("Humanity's Last Exam").key).toBe("hle");
    expect(normalizeBenchmarkName("GPQA Diamond").key).toBe("gpqa");

    // Untracked
    expect(normalizeBenchmarkName("MMMU-Pro").key).toBeNull();
    expect(normalizeBenchmarkName("CharXiv Reasoning").key).toBeNull();
    expect(normalizeBenchmarkName("Video-MMMU").key).toBeNull();
    expect(normalizeBenchmarkName("SimpleQA Verified").key).toBeNull();
    expect(normalizeBenchmarkName("FACTS Benchmark Suite").key).toBeNull();
    expect(normalizeBenchmarkName("MMMLU").key).toBeNull();
    expect(normalizeBenchmarkName("LiveCodeBench").key).toBeNull();
    expect(normalizeBenchmarkName("MRCR v2 (8-needle)").key).toBeNull();
    expect(normalizeBenchmarkName("Arena.ai Leaderboard").key).toBeNull();
  });

  it("normalizes DeepSeek V3.2-Exp benchmarks", () => {
    expect(normalizeBenchmarkName("GPQA-Diamond").key).toBe("gpqa");
    expect(normalizeBenchmarkName("Humanity's Last Exam").key).toBe("hle");
    expect(normalizeBenchmarkName("AIME 2025").key).toBe("aime");

    // Untracked
    expect(normalizeBenchmarkName("MMLU-Pro").key).toBeNull();
    expect(normalizeBenchmarkName("LiveCodeBench").key).toBeNull();
    expect(normalizeBenchmarkName("HMMT 2025").key).toBeNull();
    expect(normalizeBenchmarkName("Codeforces").key).toBeNull();
    expect(normalizeBenchmarkName("Aider-Polyglot").key).toBeNull();
    expect(normalizeBenchmarkName("BrowseComp").key).toBeNull();
    expect(normalizeBenchmarkName("BrowseComp-zh").key).toBeNull();
    expect(normalizeBenchmarkName("SimpleQA").key).toBeNull();
    expect(normalizeBenchmarkName("SWE Verified").key).toBeNull();
    expect(normalizeBenchmarkName("SWE-bench Multilingual").key).toBeNull();
    expect(normalizeBenchmarkName("Terminal-bench").key).toBeNull();
  });
});

// ─── Deduplication with real-world patterns ──────────────────────

describe("deduplication with ground truth patterns", () => {
  it("deduplicates same benchmark from vision and text", () => {
    const vision = [
      { benchmark: "SWE-bench Verified", score: 79.6, notes: "main benchmark table" },
    ];
    const text = [
      { benchmark: "SWE-bench Verified", score: 79.6, notes: "body text" },
    ];
    const result = deduplicateScores(vision, text);
    expect(result).toHaveLength(1);
    expect(result[0].source_method).toBe("vision");
  });

  it("keeps different scores for same benchmark (footnote vs table)", () => {
    const vision = [
      { benchmark: "SWE-bench Verified", score: 79.6, notes: "main benchmark table" },
    ];
    const text = [
      { benchmark: "SWE-bench Verified", score: 80.2, model_variant: "with prompt modification", notes: "footnote" },
    ];
    const result = deduplicateScores(vision, text);
    expect(result).toHaveLength(2);
  });

  it("keeps with-tools and without-tools as separate entries", () => {
    const vision = [
      { benchmark: "HLE", score: 33.2, model_variant: "without tools" },
      { benchmark: "HLE", score: 49, model_variant: "with tools" },
    ];
    const result = deduplicateScores(vision, []);
    expect(result).toHaveLength(2);
  });
});

// ─── Triage with ground truth scores ─────────────────────────────

describe("triage with ground truth scores", () => {
  it("ingests exact match tracked benchmark", () => {
    const result = triageScore(89.9, null, "gpqa", "exact");
    expect(result.action).toBe("ingest");
  });

  it("flags fuzzy benchmark match", () => {
    const result = triageScore(79.6, null, "swe-bench-verified", "fuzzy");
    expect(result.action).toBe("review");
    expect(result.reason).toContain("fuzzy");
  });

  it("flags score far above current best", () => {
    const result = triageScore(95, 80, "gpqa", "exact");
    expect(result.action).toBe("review");
    expect(result.reason).toContain("above current best");
  });

  it("rejects untracked benchmark", () => {
    const result = triageScore(72.5, null, null, "none");
    expect(result.action).toBe("reject");
  });
});

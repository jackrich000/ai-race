import { describe, it, expect } from "vitest";

const {
  extractRawImageUrl,
  filterContentImages,
  buildTextBlock,
  deduplicateScores,
  parsePublishDate,
  normalizeBenchmarkName,
  triageScore,
} = require("../lib/extraction.js");

// ─── extractRawImageUrl ───────────────────────────────────────

describe("extractRawImageUrl", () => {
  it("extracts URL from Next.js image proxy", () => {
    const proxy = "https://www.anthropic.com/_next/image?url=https%3A%2F%2Fcdn.example.com%2Fimg.png&w=1200&q=75";
    expect(extractRawImageUrl(proxy)).toBe("https://cdn.example.com/img.png");
  });

  it("returns original URL if not a proxy", () => {
    const direct = "https://cdn.example.com/img.png";
    expect(extractRawImageUrl(direct)).toBe(direct);
  });

  it("handles encoded special characters in proxy URL", () => {
    const proxy = "https://example.com/_next/image?url=%2Fimages%2Fbenchmark-chart.png&w=800&q=90";
    expect(extractRawImageUrl(proxy)).toBe("/images/benchmark-chart.png");
  });

  it("returns null for null/undefined input", () => {
    expect(extractRawImageUrl(null)).toBeNull();
    expect(extractRawImageUrl(undefined)).toBeNull();
  });

  it("returns original for malformed URLs", () => {
    expect(extractRawImageUrl("not-a-url")).toBe("not-a-url");
  });
});

// ─── filterContentImages ──────────────────────────────────────

describe("filterContentImages", () => {
  it("keeps large content images", () => {
    const images = [
      { src: "https://cdn.example.com/chart.png", width: 800, height: 600, alt: "Benchmark chart" },
    ];
    expect(filterContentImages(images)).toHaveLength(1);
  });

  it("filters out SVGs", () => {
    const images = [
      { src: "https://cdn.example.com/logo.svg", width: 800, height: 600, alt: "Logo" },
      { src: "https://cdn.example.com/icon.svg?v=2", width: 200, height: 200, alt: "" },
    ];
    expect(filterContentImages(images)).toHaveLength(0);
  });

  it("filters out small images", () => {
    const images = [
      { src: "https://cdn.example.com/tiny.png", width: 100, height: 100, alt: "" },
      { src: "https://cdn.example.com/narrow.png", width: 50, height: 500, alt: "" },
    ];
    expect(filterContentImages(images)).toHaveLength(0);
  });

  it("filters out logos and icons by alt text or src", () => {
    const images = [
      { src: "https://cdn.example.com/company-logo.png", width: 300, height: 200, alt: "" },
      { src: "https://cdn.example.com/img.png", width: 300, height: 200, alt: "Company Logo" },
      { src: "https://cdn.example.com/favicon.png", width: 300, height: 200, alt: "" },
    ];
    expect(filterContentImages(images)).toHaveLength(0);
  });

  it("filters out data URIs", () => {
    const images = [
      { src: "data:image/png;base64,abc123", width: 800, height: 600, alt: "" },
    ];
    expect(filterContentImages(images)).toHaveLength(0);
  });

  it("returns empty array for null/invalid input", () => {
    expect(filterContentImages(null)).toEqual([]);
    expect(filterContentImages(undefined)).toEqual([]);
    expect(filterContentImages("not-array")).toEqual([]);
  });

  it("keeps images without dimensions (unknown size)", () => {
    const images = [
      { src: "https://cdn.example.com/chart.png", alt: "Benchmark results" },
    ];
    expect(filterContentImages(images)).toHaveLength(1);
  });
});

// ─── buildTextBlock ───────────────────────────────────────────

describe("buildTextBlock", () => {
  it("builds structured text from sections", () => {
    const sections = [
      { type: "heading", content: "Benchmark Results" },
      { type: "paragraph", content: "Our model achieves state-of-the-art performance." },
      { type: "table", content: "GPQA Diamond: 89.9\nHLE: 49.0" },
    ];
    const result = buildTextBlock(sections);
    expect(result).toContain("## Benchmark Results");
    expect(result).toContain("[TABLE]");
    expect(result).toContain("GPQA Diamond: 89.9");
    expect(result).toContain("[/TABLE]");
  });

  it("wraps SVG chart data", () => {
    const sections = [
      { type: "svg-chart", content: "bar: GPQA 89.9, HLE 49.0" },
    ];
    const result = buildTextBlock(sections);
    expect(result).toContain("[CHART DATA]");
    expect(result).toContain("[/CHART DATA]");
  });

  it("skips empty sections", () => {
    const sections = [
      { type: "heading", content: "Title" },
      { type: "paragraph", content: "" },
      { type: "paragraph", content: "   " },
      { type: "paragraph", content: "Content" },
    ];
    const result = buildTextBlock(sections);
    expect(result).not.toContain("\n\n\n");
    expect(result).toContain("Content");
  });

  it("returns empty string for null/invalid input", () => {
    expect(buildTextBlock(null)).toBe("");
    expect(buildTextBlock(undefined)).toBe("");
    expect(buildTextBlock([])).toBe("");
  });
});

// ─── deduplicateScores ────────────────────────────────────────

describe("deduplicateScores", () => {
  it("removes duplicates across vision and text", () => {
    const vision = [
      { benchmark: "GPQA Diamond", score: 89.9, model_variant: "" },
    ];
    const text = [
      { benchmark: "GPQA Diamond", score: 89.9, model_variant: "" },
      { benchmark: "HLE", score: 49.0, model_variant: "with tools" },
    ];
    const result = deduplicateScores(vision, text);
    expect(result).toHaveLength(2);
    expect(result[0].source_method).toBe("vision");
    expect(result[1].benchmark).toBe("HLE");
    expect(result[1].source_method).toBe("text");
  });

  it("vision takes priority over text for same score", () => {
    const vision = [{ benchmark: "GPQA Diamond", score: 89.9 }];
    const text = [{ benchmark: "GPQA Diamond", score: 89.9, notes: "from text" }];
    const result = deduplicateScores(vision, text);
    expect(result).toHaveLength(1);
    expect(result[0].source_method).toBe("vision");
  });

  it("keeps different scores for same benchmark", () => {
    const vision = [{ benchmark: "HLE", score: 49.0, model_variant: "with tools" }];
    const text = [{ benchmark: "HLE", score: 33.2, model_variant: "without tools" }];
    const result = deduplicateScores(vision, text);
    expect(result).toHaveLength(2);
  });

  it("dedup is case-insensitive on benchmark name", () => {
    const vision = [{ benchmark: "gpqa diamond", score: 89.9 }];
    const text = [{ benchmark: "GPQA Diamond", score: 89.9 }];
    const result = deduplicateScores(vision, text);
    expect(result).toHaveLength(1);
  });

  it("handles null/empty arrays", () => {
    expect(deduplicateScores(null, null)).toEqual([]);
    expect(deduplicateScores([], [])).toEqual([]);
    expect(deduplicateScores([{ benchmark: "A", score: 1 }], null)).toHaveLength(1);
  });
});

// ─── parsePublishDate ─────────────────────────────────────────

describe("parsePublishDate", () => {
  it("parses ISO format: 2026-02-17", () => {
    const d = parsePublishDate("2026-02-17");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(1); // Feb = 1
    expect(d.getDate()).toBe(17);
  });

  it("parses 'DD Month YYYY': 17 Feb 2026", () => {
    const d = parsePublishDate("17 Feb 2026");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(1);
    expect(d.getDate()).toBe(17);
  });

  it("parses 'Month DD, YYYY': February 17, 2026", () => {
    const d = parsePublishDate("February 17, 2026");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(1);
    expect(d.getDate()).toBe(17);
  });

  it("parses 'Mon DD, YYYY': Feb 17, 2026", () => {
    const d = parsePublishDate("Feb 17, 2026");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(1);
    expect(d.getDate()).toBe(17);
  });

  it("parses without comma: March 5 2026", () => {
    const d = parsePublishDate("March 5 2026");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2); // March = 2
    expect(d.getDate()).toBe(5);
  });

  it("returns null for invalid input", () => {
    expect(parsePublishDate(null)).toBeNull();
    expect(parsePublishDate("")).toBeNull();
    expect(parsePublishDate("not a date")).toBeNull();
    expect(parsePublishDate(42)).toBeNull();
  });
});

// ─── normalizeBenchmarkName ───────────────────────────────────

describe("normalizeBenchmarkName", () => {
  it("exact matches known benchmarks", () => {
    expect(normalizeBenchmarkName("GPQA Diamond")).toEqual({ key: "gpqa", confidence: "exact" });
    expect(normalizeBenchmarkName("ARC-AGI-2")).toEqual({ key: "arc-agi-2", confidence: "exact" });
    expect(normalizeBenchmarkName("HLE")).toEqual({ key: "hle", confidence: "exact" });
    expect(normalizeBenchmarkName("SWE-bench Verified")).toEqual({ key: "swe-bench", confidence: "exact" });
    expect(normalizeBenchmarkName("SWE-bench Pro")).toEqual({ key: "swe-bench-pro", confidence: "exact" });
    expect(normalizeBenchmarkName("FrontierMath")).toEqual({ key: "frontiermath", confidence: "exact" });
    expect(normalizeBenchmarkName("MATH Level 5")).toEqual({ key: "math-l5", confidence: "exact" });
    expect(normalizeBenchmarkName("HumanEval")).toEqual({ key: "humaneval", confidence: "exact" });
  });

  it("fuzzy matches partial names", () => {
    expect(normalizeBenchmarkName("GPQA")).toEqual({ key: "gpqa", confidence: "fuzzy" });
    expect(normalizeBenchmarkName("ARC-AGI")).toEqual({ key: "arc-agi-1", confidence: "fuzzy" });
    expect(normalizeBenchmarkName("SWE-bench")).toEqual({ key: "swe-bench", confidence: "fuzzy" });
    expect(normalizeBenchmarkName("AIME")).toEqual({ key: "aime", confidence: "fuzzy" });
  });

  it("handles variant names", () => {
    expect(normalizeBenchmarkName("Humanity's Last Exam")).toEqual({ key: "hle", confidence: "exact" });
    expect(normalizeBenchmarkName("GPQA (Diamond)")).toEqual({ key: "gpqa", confidence: "exact" });
    expect(normalizeBenchmarkName("ARC AGI 2")).toEqual({ key: "arc-agi-2", confidence: "exact" });
    expect(normalizeBenchmarkName("Frontier Math")).toEqual({ key: "frontiermath", confidence: "exact" });
  });

  it("strips qualifier suffixes before matching", () => {
    expect(normalizeBenchmarkName("HLE with tools")).toEqual({ key: "hle", confidence: "exact" });
    expect(normalizeBenchmarkName("HLE without tools")).toEqual({ key: "hle", confidence: "exact" });
    expect(normalizeBenchmarkName("GPQA Diamond (0-shot)")).toEqual({ key: "gpqa", confidence: "exact" });
  });

  it("handles combined parenthetical + qualifier (e.g., LLM-extracted names)", () => {
    expect(normalizeBenchmarkName("Humanity's Last Exam (HLE) without tools")).toEqual({ key: "hle", confidence: "exact" });
    expect(normalizeBenchmarkName("Humanity's Last Exam (HLE) with tools")).toEqual({ key: "hle", confidence: "exact" });
  });

  it("returns confidence 'none' for untracked benchmarks", () => {
    expect(normalizeBenchmarkName("MMLU")).toEqual({ key: null, confidence: "none" });
    expect(normalizeBenchmarkName("BrowseComp")).toEqual({ key: null, confidence: "none" });
    expect(normalizeBenchmarkName("Terminal-Bench 2.0")).toEqual({ key: null, confidence: "none" });
  });

  it("returns confidence 'none' for null/empty input", () => {
    expect(normalizeBenchmarkName(null)).toEqual({ key: null, confidence: "none" });
    expect(normalizeBenchmarkName("")).toEqual({ key: null, confidence: "none" });
  });

  it("is case-insensitive", () => {
    expect(normalizeBenchmarkName("gpqa diamond")).toEqual({ key: "gpqa", confidence: "exact" });
    expect(normalizeBenchmarkName("HUMANITY'S LAST EXAM")).toEqual({ key: "hle", confidence: "exact" });
  });
});

// ─── triageScore ──────────────────────────────────────────────

describe("triageScore", () => {
  it("auto-ingest: exact match, within range of current best", () => {
    const result = triageScore(90, 85, "gpqa", "exact", "");
    expect(result.action).toBe("ingest");
  });

  it("auto-ingest: exact match, no current best", () => {
    const result = triageScore(50, null, "hle", "exact", "");
    expect(result.action).toBe("ingest");
  });

  it("auto-reject: untracked benchmark (confidence=none)", () => {
    const result = triageScore(80, null, null, "none", "");
    expect(result.action).toBe("reject");
    expect(result.reason).toContain("untracked");
  });

  it("auto-reject: null benchmark key", () => {
    const result = triageScore(80, null, null, "none", "");
    expect(result.action).toBe("reject");
  });

  it("accepts scores outside 0-100 range (Elo, raw counts, etc.)", () => {
    const result1 = triageScore(1633, null, "gpqa", "exact", "");
    expect(result1.action).toBe("ingest");

    const result2 = triageScore(-5, null, "gpqa", "exact", "");
    expect(result2.action).toBe("ingest");
  });

  it("flag for review: >10pp above current best", () => {
    const result = triageScore(96, 85, "gpqa", "exact", "");
    expect(result.action).toBe("review");
    expect(result.reason).toContain(">10pp");
  });

  it("flag for review: fuzzy benchmark match", () => {
    const result = triageScore(80, 85, "gpqa", "fuzzy", "");
    expect(result.action).toBe("review");
    expect(result.reason).toContain("fuzzy");
  });

  it("flag for review: harness qualifier detected", () => {
    const result = triageScore(80, 85, "gpqa", "exact", "with tools");
    expect(result.action).toBe("review");
    expect(result.reason).toContain("harness");
  });

  it("does not flag for exactly 10pp above", () => {
    const result = triageScore(95, 85, "gpqa", "exact", "");
    expect(result.action).toBe("ingest");
  });

  it("does not flag for 10.1pp above", () => {
    const result = triageScore(95.1, 85, "gpqa", "exact", "");
    expect(result.action).toBe("review");
  });

  it("allows score of exactly 0", () => {
    const result = triageScore(0, null, "arc-agi-2", "exact", "");
    expect(result.action).toBe("ingest");
  });

  it("allows score of exactly 100", () => {
    const result = triageScore(100, 90, "humaneval", "exact", "");
    expect(result.action).toBe("ingest");
  });
});

import { describe, it, expect } from "vitest";

const {
  generateTimeLabels,
  compareQuarters,
  isBenchmarkActive,
  BENCHMARK_META,
  COST_BENCHMARK_META,
  LAB_KEYS,
} = require("../lib/config.js");

// ─── generateTimeLabels ──────────────────────────────────────

describe("generateTimeLabels", () => {
  const labels = generateTimeLabels();

  it("starts at Q1 2023", () => {
    expect(labels[0]).toBe("Q1 2023");
  });

  it("ends at current quarter", () => {
    const now = new Date();
    const endQ = Math.ceil((now.getMonth() + 1) / 3);
    expect(labels[labels.length - 1]).toBe(`Q${endQ} ${now.getFullYear()}`);
  });

  it("has no duplicates", () => {
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("is in chronological order", () => {
    for (let i = 1; i < labels.length; i++) {
      expect(compareQuarters(labels[i], labels[i - 1])).toBeGreaterThan(0);
    }
  });
});

// ─── compareQuarters ─────────────────────────────────────────

describe("compareQuarters", () => {
  it("handles same-year comparison", () => {
    expect(compareQuarters("Q1 2024", "Q3 2024")).toBeLessThan(0);
    expect(compareQuarters("Q4 2024", "Q2 2024")).toBeGreaterThan(0);
  });

  it("handles cross-year comparison", () => {
    expect(compareQuarters("Q4 2023", "Q1 2024")).toBeLessThan(0);
    expect(compareQuarters("Q1 2025", "Q4 2024")).toBeGreaterThan(0);
  });

  it("handles equal quarters", () => {
    expect(compareQuarters("Q2 2024", "Q2 2024")).toBe(0);
  });
});

// ─── isBenchmarkActive ───────────────────────────────────────

describe("isBenchmarkActive", () => {
  it("returns true for active benchmarks", () => {
    expect(isBenchmarkActive("gpqa", "Q1 2025")).toBe(true);
    expect(isBenchmarkActive("hle", "Q1 2025")).toBe(true);
  });

  it("returns false for saturated benchmarks past their activeUntil", () => {
    expect(isBenchmarkActive("humaneval", "Q1 2025")).toBe(false);
    expect(isBenchmarkActive("math-l5", "Q2 2025")).toBe(false);
  });

  it("returns true for benchmarks before their activeUntil", () => {
    expect(isBenchmarkActive("humaneval", "Q3 2024")).toBe(true);
  });

  it("returns false when filter end equals activeUntil", () => {
    // activeUntil means inactive once we reach that quarter
    expect(isBenchmarkActive("humaneval", "Q4 2024")).toBe(false);
  });

  it("returns true for benchmarks with no activeUntil", () => {
    expect(isBenchmarkActive("hle", "Q4 2030")).toBe(true);
  });
});

// ─── BENCHMARK_META ──────────────────────────────────────────

describe("BENCHMARK_META", () => {
  const expectedKeys = [
    "gpqa", "arc-agi-2", "hle", "swe-bench-pro", "aime", "frontiermath",
    "humaneval", "arc-agi-1", "swe-bench-verified", "math-l5",
  ];

  it("has all 10 expected benchmark keys", () => {
    for (const key of expectedKeys) {
      expect(BENCHMARK_META).toHaveProperty(key);
    }
    expect(Object.keys(BENCHMARK_META)).toHaveLength(10);
  });

  it("each benchmark has required fields", () => {
    for (const [key, meta] of Object.entries(BENCHMARK_META)) {
      expect(meta).toHaveProperty("name");
      expect(meta).toHaveProperty("description");
      expect(meta).toHaveProperty("category");
      expect(meta).toHaveProperty("link");
      expect(meta).toHaveProperty("status");
      expect(["active", "saturated", "deprecated"]).toContain(meta.status);
    }
  });

  it("every inactive benchmark has activeUntil", () => {
    for (const [key, meta] of Object.entries(BENCHMARK_META)) {
      if (meta.status !== "active") {
        expect(meta).toHaveProperty("activeUntil");
        expect(meta.activeUntil).toMatch(/^Q[1-4] \d{4}$/);
      }
    }
  });
});

// ─── LAB_KEYS ────────────────────────────────────────────────

describe("LAB_KEYS", () => {
  it("has exactly 5 expected entries", () => {
    expect(LAB_KEYS).toEqual(["openai", "anthropic", "google", "xai", "chinese"]);
  });
});

// ─── COST_BENCHMARK_META ─────────────────────────────────────

describe("COST_BENCHMARK_META", () => {
  it("has required fields for each entry", () => {
    for (const [key, meta] of Object.entries(COST_BENCHMARK_META)) {
      expect(meta).toHaveProperty("name");
      expect(meta).toHaveProperty("threshold");
      expect(meta).toHaveProperty("thresholdLabel");
      expect(meta).toHaveProperty("description");
      expect(meta).toHaveProperty("link");
      expect(meta).toHaveProperty("color");
      expect(meta).toHaveProperty("startQuarter");
      expect(typeof meta.threshold).toBe("number");
    }
  });
});

import { describe, it, expect } from "vitest";

const {
  generateTimeLabels,
  compareQuarters,
  isBenchmarkActive,
  isInChartMode,
  BENCHMARK_META,
  CAPABILITIES,
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
    "gpqa", "arc-agi-2", "arc-agi-3", "hle", "swe-bench-pro", "aime", "frontiermath",
    "osworld-verified", "mmmu-pro", "terminal-bench-2-0",
    "humaneval", "arc-agi-1", "swe-bench-verified", "aider-polyglot", "mmlu-pro", "math-l5",
  ];

  it("has all 16 expected benchmark keys", () => {
    for (const key of expectedKeys) {
      expect(BENCHMARK_META).toHaveProperty(key);
    }
    expect(Object.keys(BENCHMARK_META)).toHaveLength(16);
  });

  it("arc-agi-3 is active and anchors Novel Problem Solving", () => {
    expect(BENCHMARK_META["arc-agi-3"].status).toBe("active");
    expect(BENCHMARK_META["arc-agi-3"].capability).toBe("Novel Problem Solving");
  });

  it("arc-agi-2 is deprecated as of Q2 2026 (replaced by ARC-AGI-3)", () => {
    expect(BENCHMARK_META["arc-agi-2"].status).toBe("deprecated");
    expect(BENCHMARK_META["arc-agi-2"].activeUntil).toBe("Q2 2026");
    expect(BENCHMARK_META["arc-agi-2"].inactiveReason).toMatch(/ARC-AGI-3/);
  });

  it("mmmu-pro is active and anchors Visual Reasoning", () => {
    expect(BENCHMARK_META["mmmu-pro"].status).toBe("active");
    expect(BENCHMARK_META["mmmu-pro"].capability).toBe("Visual Reasoning");
  });

  it("osworld-verified is active and explicitly notes lab-coverage gaps in its description", () => {
    expect(BENCHMARK_META["osworld-verified"].status).toBe("active");
    // Methodology must disclose missing labs so users don't read silence as poor performance.
    expect(BENCHMARK_META["osworld-verified"].description).toMatch(/Google.*xAI.*Meta|xAI.*Meta.*Google|Meta.*Google.*xAI/);
  });

  it("each benchmark has required fields", () => {
    for (const [key, meta] of Object.entries(BENCHMARK_META)) {
      expect(meta).toHaveProperty("name");
      expect(meta).toHaveProperty("description");
      expect(meta).toHaveProperty("capability");
      expect(meta).toHaveProperty("link");
      expect(meta).toHaveProperty("status");
      expect(["active", "saturated", "deprecated"]).toContain(meta.status);
    }
  });

  it("every benchmark's capability is in the canonical CAPABILITIES list", () => {
    for (const [key, meta] of Object.entries(BENCHMARK_META)) {
      expect(CAPABILITIES).toContain(meta.capability);
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

// ─── chartModes ──────────────────────────────────────────────

describe("chartModes / isInChartMode", () => {
  it("benchmarks without chartModes default to every mode", () => {
    expect(isInChartMode("gpqa", "frontier")).toBe(true);
    expect(isInChartMode("gpqa", "race")).toBe(true);
    expect(isInChartMode("gpqa", "pace")).toBe(true);
    expect(isInChartMode("hle", "frontier")).toBe(true);
    expect(isInChartMode("hle", "race")).toBe(true);
  });

  it("aider-polyglot and mmlu-pro appear on Frontier + Pace but not Race", () => {
    for (const key of ["aider-polyglot", "mmlu-pro"]) {
      expect(isInChartMode(key, "frontier")).toBe(true);
      expect(isInChartMode(key, "pace")).toBe(true);
      expect(isInChartMode(key, "race")).toBe(false);
    }
  });

  it("terminal-bench-2-0 is Pace-only", () => {
    expect(isInChartMode("terminal-bench-2-0", "pace")).toBe(true);
    expect(isInChartMode("terminal-bench-2-0", "frontier")).toBe(false);
    expect(isInChartMode("terminal-bench-2-0", "race")).toBe(false);
  });

  it("unknown benchmark keys return false", () => {
    expect(isInChartMode("does-not-exist", "frontier")).toBe(false);
  });
});

// ─── CAPABILITIES ────────────────────────────────────────────

describe("CAPABILITIES", () => {
  it("has exactly 6 entries in canonical order", () => {
    expect(CAPABILITIES).toEqual([
      "Coding",
      "Math",
      "Expert Reasoning",
      "Visual Reasoning",
      "Computer Use",
      "Novel Problem Solving",
    ]);
  });

  it("every capability has at least one benchmark anchoring it", () => {
    const usedCapabilities = new Set(Object.values(BENCHMARK_META).map(m => m.capability));
    for (const cap of CAPABILITIES) {
      expect(usedCapabilities).toContain(cap);
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

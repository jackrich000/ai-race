import { describe, it, expect } from "vitest";

const { computePaceSeries, PACE_COHORT, PACE_CHART_START } = require("../lib/pace-chart.js");

// ─── Fixtures ────────────────────────────────────────────────

const CAPABILITIES = ["Coding", "Math", "Expert Reasoning", "Visual Reasoning", "Computer Use", "Novel Problem Solving"];

// Mini timeline covering Q1 2024 → Q2 2026 (10 quarters).
const TIME_LABELS = [
  "Q1 2024", "Q2 2024", "Q3 2024", "Q4 2024",
  "Q1 2025", "Q2 2025", "Q3 2025", "Q4 2025",
  "Q1 2026", "Q2 2026",
];

function cellsFromArray(arr) {
  // helper: number → cumulative cell shape used by data-loader
  return arr.map(v => v == null ? null : { score: v, model: "test", source: "epoch", verified: true, variant: null });
}

function buildBench(scoresByLab) {
  // scoresByLab: {labKey: number[]} where each number is the lab's cumulative-best at that quarter
  const scores = {};
  for (const [lab, arr] of Object.entries(scoresByLab)) scores[lab] = cellsFromArray(arr);
  return { scores };
}

// ─── Tests ───────────────────────────────────────────────────

describe("computePaceSeries — line series", () => {
  it("clips to PACE_CHART_START (Q4 2024) and runs through now", () => {
    const BENCHMARKS = {
      "hle": buildBench({ openai: [10, 20, 30, 40, 50, 55, 60, 62, 64, 65] }),
    };
    const BENCHMARK_META = { "hle": { status: "active", capability: "Expert Reasoning" } };

    const { lineSeries } = computePaceSeries({
      BENCHMARKS, BENCHMARK_META, CAPABILITIES, TIME_LABELS, now: "Q2 2026",
      cohort: ["hle"],
    });

    expect(lineSeries[0].quarter).toBe("Q4 2024");
    expect(lineSeries[lineSeries.length - 1].quarter).toBe("Q2 2026");
  });

  it("flags the current quarter as partial", () => {
    const BENCHMARKS = {
      "hle": buildBench({ openai: [10, 20, 30, 40, 50, 55, 60, 62, 64, 65] }),
    };
    const BENCHMARK_META = { "hle": { status: "active", capability: "Expert Reasoning" } };

    const { lineSeries } = computePaceSeries({
      BENCHMARKS, BENCHMARK_META, CAPABILITIES, TIME_LABELS, now: "Q2 2026",
      cohort: ["hle"],
    });

    const last = lineSeries[lineSeries.length - 1];
    expect(last.isPartial).toBe(true);
    // Only the most recent quarter is partial.
    const others = lineSeries.slice(0, -1).filter(p => p.isPartial);
    expect(others).toHaveLength(0);
  });

  it("lifecycle gate excludes saturated/deprecated benchmarks past activeUntil", () => {
    // humaneval saturated, activeUntil = Q4 2024. Q1 2025+ excluded.
    // hle active, contributes every quarter.
    const BENCHMARKS = {
      "humaneval": buildBench({ openai: [70, 80, 90, 95, 96, 97, 97, 97, 97, 97] }),
      "hle":       buildBench({ openai: [10, 20, 30, 40, 50, 60, 65, 70, 73, 75] }),
    };
    const BENCHMARK_META = {
      "humaneval": { status: "saturated", activeUntil: "Q4 2024", capability: "Coding" },
      "hle":       { status: "active",                            capability: "Expert Reasoning" },
    };

    const { lineSeries } = computePaceSeries({
      BENCHMARKS, BENCHMARK_META, CAPABILITIES, TIME_LABELS, now: "Q2 2026",
      cohort: ["humaneval", "hle"],
    });

    // Q4 2024: humaneval still in-flight (95-90=5, both at activeUntil), hle +10 → mean (5+10)/2 = 7.5
    const q4_2024 = lineSeries.find(p => p.quarter === "Q4 2024");
    expect(q4_2024.n).toBe(2);
    expect(q4_2024.contributors.map(c => c.benchKey).sort()).toEqual(["hle", "humaneval"]);

    // Q1 2025: humaneval excluded (past activeUntil), hle alone +10
    const q1_2025 = lineSeries.find(p => p.quarter === "Q1 2025");
    expect(q1_2025.n).toBe(1);
    expect(q1_2025.contributors[0].benchKey).toBe("hle");
  });

  it("counts saturated benchmarks at zero pace within their activeUntil window", () => {
    // humaneval frozen at 95 from Q3 2024 onwards but in-flight through Q4 2024.
    const BENCHMARKS = {
      "humaneval": buildBench({ openai: [80, 90, 95, 95, 95, 95, 95, 95, 95, 95] }),
    };
    const BENCHMARK_META = {
      "humaneval": { status: "saturated", activeUntil: "Q4 2024", capability: "Coding" },
    };

    const { lineSeries } = computePaceSeries({
      BENCHMARKS, BENCHMARK_META, CAPABILITIES, TIME_LABELS, now: "Q2 2026",
      cohort: ["humaneval"],
    });

    // Q4 2024 (last in-flight quarter): humaneval frozen → delta 0.
    const q4_2024 = lineSeries.find(p => p.quarter === "Q4 2024");
    expect(q4_2024.value).toBe(0);
    expect(q4_2024.n).toBe(1);
  });

  it("handles ARC overlap: ARC-AGI-1 and ARC-AGI-2 both contribute in their transition quarter", () => {
    // ARC-AGI-1 activeUntil Q1 2025; ARC-AGI-2 active.
    // ARC-AGI-2 has a fresh score in Q4 2024 (early submissions), so Q1 2025 delta exists.
    // In Q1 2025, both are in-flight AND both have prior-quarter frontier → both contribute.
    const BENCHMARKS = {
      "arc-agi-1": buildBench({ openai: [10, 15, 20, 30, 50, 50, 50, 50, 50, 50] }),
      "arc-agi-2": buildBench({ openai: [null, null, null, 3, 8, 12, 15, 20, 25, 30] }),
    };
    const BENCHMARK_META = {
      "arc-agi-1": { status: "deprecated", activeUntil: "Q1 2025", capability: "Novel Problem Solving" },
      "arc-agi-2": { status: "active",                              capability: "Novel Problem Solving" },
    };

    const { lineSeries } = computePaceSeries({
      BENCHMARKS, BENCHMARK_META, CAPABILITIES, TIME_LABELS, now: "Q2 2026",
      cohort: ["arc-agi-1", "arc-agi-2"],
    });

    // Q1 2025 deltas: arc-agi-1 = 50-30 = 20; arc-agi-2 = 8-3 = 5. Both contribute.
    const q1_2025 = lineSeries.find(p => p.quarter === "Q1 2025");
    expect(q1_2025.n).toBe(2);
    expect(q1_2025.contributors.map(c => c.benchKey).sort()).toEqual(["arc-agi-1", "arc-agi-2"]);
    expect(Number.isFinite(q1_2025.value)).toBe(true);
  });
});

describe("computePaceSeries — bar series", () => {
  it("averages over the last 12 months (4 trailing quarters)", () => {
    // hle: Q3 2025 to Q2 2026 deltas of [2, 3, 4, 5] → mean = 3.5
    const BENCHMARKS = {
      "hle": buildBench({ openai: [10, 20, 30, 40, 50, 55, 58, 61, 65, 70] }),
    };
    const BENCHMARK_META = { "hle": { status: "active", capability: "Expert Reasoning" } };

    const { barSeries } = computePaceSeries({
      BENCHMARKS, BENCHMARK_META, CAPABILITIES, TIME_LABELS, now: "Q2 2026",
      cohort: ["hle"],
    });

    const er = barSeries.find(b => b.capability === "Expert Reasoning");
    // Q3 2025 (58-55=3), Q4 2025 (61-58=3), Q1 2026 (65-61=4), Q2 2026 (70-65=5) → mean = 3.75
    expect(er.value).toBeCloseTo(3.75, 1);
    expect(er.n).toBe(1);
    expect(er.isLowN).toBe(true);
  });

  it("flags N=1 capabilities (Visual Reasoning, Computer Use in default cohort)", () => {
    const BENCHMARKS = {
      "mmmu-pro":         buildBench({ openai: [10, 15, 20, 25, 30, 35, 40, 45, 50, 55] }),
      "osworld-verified": buildBench({ anthropic: [null, null, 10, 15, 20, 25, 30, 35, 40, 45] }),
      "hle":              buildBench({ openai: [10, 20, 30, 40, 50, 55, 58, 61, 65, 70] }),
      "gpqa":             buildBench({ openai: [50, 55, 60, 65, 70, 75, 80, 85, 88, 90] }),
    };
    const BENCHMARK_META = {
      "mmmu-pro":         { status: "active", capability: "Visual Reasoning" },
      "osworld-verified": { status: "active", capability: "Computer Use" },
      "hle":              { status: "active", capability: "Expert Reasoning" },
      "gpqa":             { status: "active", capability: "Expert Reasoning" },
    };

    const { barSeries } = computePaceSeries({
      BENCHMARKS, BENCHMARK_META, CAPABILITIES, TIME_LABELS, now: "Q2 2026",
      cohort: ["mmmu-pro", "osworld-verified", "hle", "gpqa"],
    });

    expect(barSeries.find(b => b.capability === "Visual Reasoning").isLowN).toBe(true);
    expect(barSeries.find(b => b.capability === "Computer Use").isLowN).toBe(true);
    expect(barSeries.find(b => b.capability === "Expert Reasoning").isLowN).toBe(false);
    expect(barSeries.find(b => b.capability === "Expert Reasoning").n).toBe(2);
  });

  it("returns value=0 (not NaN) for a capability whose benchmarks are all past activeUntil", () => {
    // Math: math-l5 saturated Q1 2025, frontiermath also saturated Q1 2025 (synthetic for this test).
    // Both past activeUntil before the bar window (Q3 2025 → Q2 2026). No contributors.
    const BENCHMARKS = {
      "math-l5":      buildBench({ openai: [80, 90, 95, 95, 95, 95, 95, 95, 95, 95] }),
      "frontiermath": buildBench({ openai: [10, 15, 20, 22, 22, 22, 22, 22, 22, 22] }),
    };
    const BENCHMARK_META = {
      "math-l5":      { status: "saturated", activeUntil: "Q1 2025", capability: "Math" },
      "frontiermath": { status: "saturated", activeUntil: "Q1 2025", capability: "Math" },
    };

    const { barSeries } = computePaceSeries({
      BENCHMARKS, BENCHMARK_META, CAPABILITIES, TIME_LABELS, now: "Q2 2026",
      cohort: ["math-l5", "frontiermath"],
    });

    const math = barSeries.find(b => b.capability === "Math");
    expect(math.value).toBe(0);
    expect(Number.isFinite(math.value)).toBe(true);
  });

  it("returns one bar per capability in the canonical order", () => {
    const { barSeries } = computePaceSeries({
      BENCHMARKS: {},
      BENCHMARK_META: {},
      CAPABILITIES,
      TIME_LABELS,
      now: "Q2 2026",
      cohort: [],
    });
    expect(barSeries.map(b => b.capability)).toEqual(CAPABILITIES);
  });
});

describe("PACE_COHORT", () => {
  it("has exactly 16 benchmarks", () => {
    expect(PACE_COHORT).toHaveLength(16);
  });

  it("contains the canonical Pace cohort", () => {
    const expected = [
      "swe-bench-pro", "swe-bench-verified", "aider-polyglot", "terminal-bench-2-0", "humaneval",
      "frontiermath", "aime", "math-l5",
      "hle", "gpqa", "mmlu-pro",
      "arc-agi-1", "arc-agi-2", "arc-agi-3",
      "mmmu-pro",
      "osworld-verified",
    ];
    expect(PACE_COHORT.sort()).toEqual(expected.sort());
  });
});

describe("PACE_CHART_START", () => {
  it("is Q4 2024", () => {
    expect(PACE_CHART_START).toBe("Q4 2024");
  });
});

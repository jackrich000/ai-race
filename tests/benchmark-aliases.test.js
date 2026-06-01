// tests/benchmark-aliases.test.js
//
// Golden-master regression for the config-derived benchmark alias table.
// BENCHMARK_ALIASES is now generated from config.js BENCHMARK_META `aliases`
// fields (single source of truth) rather than hand-maintained in extraction.js.
//
// This test pins the FULL expected table so an unintended change to any
// benchmark's aliases (or the generator) fails loudly. When you deliberately
// add/change aliases in config.js, update EXPECTED_ALIASES here in the same PR.

import { describe, it, expect } from "vitest";

const { BENCHMARK_ALIASES } = require("../lib/extraction.js");

// The complete expected alias table. Keys are normalized (lowercase,
// single-spaced) alias strings; values are { key, confidence }.
const EXPECTED_ALIASES = {
  // GPQA Diamond
  "gpqa diamond":             { key: "gpqa", confidence: "exact" },
  "gpqa":                     { key: "gpqa", confidence: "fuzzy" },
  "gpqa (diamond)":           { key: "gpqa", confidence: "exact" },
  "gpqa-diamond":             { key: "gpqa", confidence: "exact" },

  // ARC-AGI-2
  "arc-agi-2":                { key: "arc-agi-2", confidence: "exact" },
  "arc-agi 2":                { key: "arc-agi-2", confidence: "exact" },
  "arc agi 2":                { key: "arc-agi-2", confidence: "exact" },
  "arcagi2":                  { key: "arc-agi-2", confidence: "exact" },
  "arc-agi-2 (semi-private)": { key: "arc-agi-2", confidence: "exact" },

  // ARC-AGI-1
  "arc-agi-1":                { key: "arc-agi-1", confidence: "exact" },
  "arc-agi 1":                { key: "arc-agi-1", confidence: "exact" },
  "arc agi 1":                { key: "arc-agi-1", confidence: "exact" },
  "arc-agi":                  { key: "arc-agi-1", confidence: "fuzzy" },
  "arcagi":                   { key: "arc-agi-1", confidence: "fuzzy" },

  // HLE (Humanity's Last Exam)
  "hle":                      { key: "hle", confidence: "exact" },
  "humanity's last exam":     { key: "hle", confidence: "exact" },
  "humanitys last exam":      { key: "hle", confidence: "exact" },
  "humanity’s last exam": { key: "hle", confidence: "exact" },

  // SWE-bench Pro
  "swe-bench pro":            { key: "swe-bench-pro", confidence: "exact" },
  "swe-bench pro (public)":   { key: "swe-bench-pro", confidence: "exact" },
  "swebench pro":             { key: "swe-bench-pro", confidence: "exact" },

  // SWE-bench Verified
  "swe-bench verified":       { key: "swe-bench-verified", confidence: "exact" },
  "swebench verified":        { key: "swe-bench-verified", confidence: "exact" },
  "swe-bench":                { key: "swe-bench-verified", confidence: "fuzzy" },
  "swebench":                 { key: "swe-bench-verified", confidence: "fuzzy" },

  // AIME (OTIS Mock) — only the OTIS Mock variant matches our benchmark.
  "otis mock aime":           { key: "aime", confidence: "exact" },
  "otis mock aime 2024-2025": { key: "aime", confidence: "exact" },
  "aime (otis mock)":         { key: "aime", confidence: "exact" },

  // FrontierMath
  "frontiermath":             { key: "frontiermath", confidence: "exact" },
  "frontier math":            { key: "frontiermath", confidence: "exact" },

  // MATH Level 5
  "math level 5":             { key: "math-l5", confidence: "exact" },
  "math-l5":                  { key: "math-l5", confidence: "exact" },
  "math (level 5)":           { key: "math-l5", confidence: "exact" },
  "math level-5":             { key: "math-l5", confidence: "exact" },

  // HumanEval
  "humaneval":                { key: "humaneval", confidence: "exact" },
  "human eval":               { key: "humaneval", confidence: "exact" },

  // OSWorld-Verified
  "osworld-verified":         { key: "osworld-verified", confidence: "exact" },
  "osworld verified":         { key: "osworld-verified", confidence: "exact" },
  "osworld":                  { key: "osworld-verified", confidence: "fuzzy" },

  // MMMU-Pro
  "mmmu-pro":                 { key: "mmmu-pro", confidence: "exact" },
  "mmmu pro":                 { key: "mmmu-pro", confidence: "exact" },
  "mmmupro":                  { key: "mmmu-pro", confidence: "exact" },
};

describe("config-derived BENCHMARK_ALIASES", () => {
  it("matches the full expected alias table exactly", () => {
    expect(BENCHMARK_ALIASES).toEqual(EXPECTED_ALIASES);
  });

  it("every alias key resolves to a real benchmark in config", () => {
    const { BENCHMARK_META } = require("../lib/config.js");
    for (const [alias, { key }] of Object.entries(BENCHMARK_ALIASES)) {
      expect(BENCHMARK_META[key], `alias "${alias}" points at unknown benchmark "${key}"`).toBeDefined();
    }
  });
});

import { describe, it, expect } from "vitest";

const {
  normalizeOrg,
  quarterEndDate,
  extractDateFromModelId,
  arcModelIdToLab,
  modelNameToLab,
  HARNESS_KEYWORDS,
  isHarnessVariant,
  isAcknowledgedConfigVariant,
  normalizeVariant,
  splitVariantFromModel,
  filterVerifiedDuplicates,
  computeCumulativeBest,
  computeCumulativeMin,
  generateMatchVerifiedRegex,
  findCol,
} = require("../lib/pipeline.js");

// ─── normalizeOrg ────────────────────────────────────────────

describe("normalizeOrg", () => {
  it("maps known labs correctly", () => {
    expect(normalizeOrg("OpenAI")).toBe("openai");
    expect(normalizeOrg("Anthropic")).toBe("anthropic");
    expect(normalizeOrg("Google DeepMind")).toBe("google");
    expect(normalizeOrg("Google")).toBe("google");
    expect(normalizeOrg("xAI")).toBe("xai");
    expect(normalizeOrg("X.AI")).toBe("xai");
  });

  it("maps Chinese composite labs", () => {
    expect(normalizeOrg("DeepSeek")).toBe("chinese");
    expect(normalizeOrg("Alibaba")).toBe("chinese");
    expect(normalizeOrg("ByteDance")).toBe("chinese");
    expect(normalizeOrg("Qwen")).toBe("chinese");
    expect(normalizeOrg("Moonshot AI")).toBe("chinese");
    expect(normalizeOrg("Baidu")).toBe("chinese");
    expect(normalizeOrg("MiniMax")).toBe("chinese");
  });

  it("returns null for unknown orgs", () => {
    expect(normalizeOrg("Meta AI")).toBeNull();
    expect(normalizeOrg("Unknown Corp")).toBeNull();
  });

  it("returns null for null/empty input", () => {
    expect(normalizeOrg(null)).toBeNull();
    expect(normalizeOrg(undefined)).toBeNull();
    expect(normalizeOrg("")).toBeNull();
  });

  it("handles comma-separated org strings (takes first)", () => {
    expect(normalizeOrg("DeepSeek, Alibaba")).toBe("chinese");
    expect(normalizeOrg("OpenAI, Microsoft")).toBe("openai");
  });
});

// ─── quarterEndDate ──────────────────────────────────────────

describe("quarterEndDate", () => {
  it("returns end of Q1 (March 31)", () => {
    const d = quarterEndDate("Q1 2024");
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(2); // March (0-indexed)
    expect(d.getDate()).toBe(31);
  });

  it("returns end of Q4 (December 31)", () => {
    const d = quarterEndDate("Q4 2023");
    expect(d.getFullYear()).toBe(2023);
    expect(d.getMonth()).toBe(11); // December
    expect(d.getDate()).toBe(31);
  });

  it("returns end of Q2 (June 30)", () => {
    const d = quarterEndDate("Q2 2025");
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(5); // June
    expect(d.getDate()).toBe(30);
  });

  it("returns end of Q3 (September 30)", () => {
    const d = quarterEndDate("Q3 2025");
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(8); // September
    expect(d.getDate()).toBe(30);
  });
});

// ─── extractDateFromModelId ──────────────────────────────────

describe("extractDateFromModelId", () => {
  it("parses YYYY-MM-DD format", () => {
    const d = extractDateFromModelId("gpt-5-2-2025-12-11-thinking-xhigh");
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(11); // December
    expect(d.getDate()).toBe(11);
  });

  it("parses YYYYMMDD format", () => {
    const d = extractDateFromModelId("claude-opus-4-20250514");
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(4); // May
    expect(d.getDate()).toBe(14);
  });

  it("parses MMYYYY format", () => {
    const d = extractDateFromModelId("gemini_3_deep_think_022026");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(1); // February
    expect(d.getDate()).toBe(1);
  });

  it("returns null when no date found", () => {
    expect(extractDateFromModelId("some-model-no-date")).toBeNull();
    expect(extractDateFromModelId("")).toBeNull();
  });
});

// ─── arcModelIdToLab ─────────────────────────────────────────

describe("arcModelIdToLab", () => {
  it("matches start-anchored model IDs", () => {
    expect(arcModelIdToLab("claude-opus-4-20250514")).toBe("anthropic");
    expect(arcModelIdToLab("gpt-5-2-2025-12-11")).toBe("openai");
    expect(arcModelIdToLab("gemini_3_deep_think_022026")).toBe("google");
    expect(arcModelIdToLab("o1-preview-2024-09-12")).toBe("openai");
    expect(arcModelIdToLab("deepseek-v3")).toBe("chinese");
  });

  it("rejects third-party scaffolds (model name not at start)", () => {
    expect(arcModelIdToLab("scaffold-with-claude-inside")).toBeNull();
    expect(arcModelIdToLab("my-wrapper-gpt-4")).toBeNull();
  });

  it("returns null for unrecognized models", () => {
    expect(arcModelIdToLab("llama-3-70b")).toBeNull();
    expect(arcModelIdToLab("")).toBeNull();
  });
});

// ─── modelNameToLab ──────────────────────────────────────────

describe("modelNameToLab", () => {
  it("matches all 5 lab families via substring", () => {
    expect(modelNameToLab("Claude Sonnet 4.6")).toBe("anthropic");
    expect(modelNameToLab("GPT-5.4 Pro")).toBe("openai");
    expect(modelNameToLab("o1-preview")).toBe("openai");
    expect(modelNameToLab("Gemini 3 Deep Think")).toBe("google");
    expect(modelNameToLab("Grok-3")).toBe("xai");
    expect(modelNameToLab("DeepSeek-V3")).toBe("chinese");
    expect(modelNameToLab("Qwen-2.5-Max")).toBe("chinese");
  });

  it("matches substring anywhere in name", () => {
    expect(modelNameToLab("Some wrapper around Claude")).toBe("anthropic");
  });

  it("returns null for unrecognized names", () => {
    expect(modelNameToLab("LLaMA-3")).toBeNull();
    expect(modelNameToLab("Mistral-Large")).toBeNull();
  });
});

// ─── filterVerifiedDuplicates ────────────────────────────────

describe("filterVerifiedDuplicates", () => {
  it("keeps all verified points", () => {
    const points = [
      { benchmark: "gpqa", lab: "openai", model: "GPT-5", source: "artificialanalysis", verified: true },
      { benchmark: "gpqa", lab: "anthropic", model: "Claude 4", source: "epoch", verified: true },
    ];
    expect(filterVerifiedDuplicates(points)).toHaveLength(2);
  });

  it("drops model_card when verified match exists", () => {
    const points = [
      { benchmark: "gpqa", lab: "openai", model: "GPT-5.4 Pro", source: "artificialanalysis", verified: true },
      { benchmark: "gpqa", lab: "openai", model: "GPT-5.4 Pro", score: 94.4, source: "model_card", verified: false, matchVerified: /gpt.?5.?4/i },
    ];
    const filtered = filterVerifiedDuplicates(points);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].source).toBe("artificialanalysis");
  });

  it("keeps model_card when no verified match", () => {
    const points = [
      { benchmark: "gpqa", lab: "anthropic", model: "Claude 3.5", source: "artificialanalysis", verified: true },
      { benchmark: "gpqa", lab: "openai", model: "GPT-5.4 Pro", score: 94.4, source: "model_card", verified: false, matchVerified: /gpt.?5.?4/i },
    ];
    const filtered = filterVerifiedDuplicates(points);
    expect(filtered).toHaveLength(2);
  });

  it("keeps model_card without matchVerified regex", () => {
    const points = [
      { benchmark: "gpqa", lab: "openai", model: "GPT-5.4 Pro", source: "artificialanalysis", verified: true },
      { benchmark: "gpqa", lab: "openai", model: "GPT-5.4 Pro", source: "model_card", verified: false },
    ];
    expect(filterVerifiedDuplicates(points)).toHaveLength(2);
  });

  it("handles empty arrays", () => {
    expect(filterVerifiedDuplicates([])).toEqual([]);
  });

  it("also filters model_card_auto source", () => {
    const points = [
      { benchmark: "gpqa", lab: "openai", model: "GPT-5.4 Pro", source: "artificialanalysis", verified: true },
      { benchmark: "gpqa", lab: "openai", model: "GPT-5.4 Auto", source: "model_card_auto", verified: false, matchVerified: /gpt.?5.?4/i },
    ];
    const filtered = filterVerifiedDuplicates(points);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].source).toBe("artificialanalysis");
  });

  it("preserves harness variant rows even when verified match exists", () => {
    const points = [
      { benchmark: "hle", lab: "anthropic", model: "Claude Opus 4.7", source: "artificialanalysis", verified: true },
      { benchmark: "hle", lab: "anthropic", model: "Claude Opus 4.7", variant: "with tools", score: 54.7, source: "model_card_auto", verified: false, matchVerified: /opus.?4[\.\s-]?7/i },
    ];
    const filtered = filterVerifiedDuplicates(points);
    expect(filtered).toHaveLength(2);
    expect(filtered.find(p => p.variant === "with tools")).toBeTruthy();
  });

  it("drops null-variant model_card when verified match exists; keeps harness sibling", () => {
    const points = [
      { benchmark: "hle", lab: "anthropic", model: "Claude Opus 4.7", source: "artificialanalysis", verified: true },
      { benchmark: "hle", lab: "anthropic", model: "Claude Opus 4.7", variant: null, score: 46.9, source: "model_card_auto", verified: false, matchVerified: /opus.?4[\.\s-]?7/i },
      { benchmark: "hle", lab: "anthropic", model: "Claude Opus 4.7", variant: "with tools", score: 54.7, source: "model_card_auto", verified: false, matchVerified: /opus.?4[\.\s-]?7/i },
    ];
    const filtered = filterVerifiedDuplicates(points);
    expect(filtered).toHaveLength(2);
    const sources = filtered.map(p => `${p.source}:${p.variant ?? "null"}`).sort();
    expect(sources).toEqual(["artificialanalysis:null", "model_card_auto:with tools"]);
  });

  it("config-only variant ('xhigh') is superseded by verified score", () => {
    const points = [
      { benchmark: "gpqa", lab: "openai", model: "GPT-5.4 mini", source: "artificialanalysis", verified: true },
      { benchmark: "gpqa", lab: "openai", model: "GPT-5.4 mini", variant: "xhigh", source: "model_card_auto", verified: false, matchVerified: /gpt.?5[\.\s-]?4.?mini/i },
    ];
    const filtered = filterVerifiedDuplicates(points);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].source).toBe("artificialanalysis");
  });
});

// ─── computeCumulativeBest ───────────────────────────────────

describe("computeCumulativeBest", () => {
  const quarters = ["Q1 2024", "Q2 2024", "Q3 2024"];

  it("tracks running max across quarters", () => {
    const points = [
      { date: new Date("2024-01-15"), score: 50, model: "A", source: "test", verified: true },
      { date: new Date("2024-04-15"), score: 70, model: "B", source: "test", verified: true },
    ];
    const result = computeCumulativeBest(points, quarters);
    expect(result["Q1 2024"].score).toBe(50);
    expect(result["Q2 2024"].score).toBe(70);
    expect(result["Q3 2024"].score).toBe(70); // Carries forward
  });

  it("carries forward the best to later quarters", () => {
    const points = [
      { date: new Date("2024-01-15"), score: 80, model: "A", source: "test", verified: true },
    ];
    const result = computeCumulativeBest(points, quarters);
    expect(result["Q1 2024"].score).toBe(80);
    expect(result["Q2 2024"].score).toBe(80);
    expect(result["Q3 2024"].score).toBe(80);
  });

  it("handles ties (keeps first)", () => {
    const points = [
      { date: new Date("2024-01-15"), score: 50, model: "A", source: "test", verified: true },
      { date: new Date("2024-02-15"), score: 50, model: "B", source: "test", verified: true },
    ];
    const result = computeCumulativeBest(points, quarters);
    expect(result["Q1 2024"].model).toBe("A"); // First seen wins
  });

  it("verified status travels with winning data point", () => {
    const points = [
      { date: new Date("2024-01-15"), score: 50, model: "A", source: "test", verified: true },
      { date: new Date("2024-04-15"), score: 70, model: "B", source: "model_card", verified: false },
    ];
    const result = computeCumulativeBest(points, quarters);
    expect(result["Q1 2024"].verified).toBe(true);
    expect(result["Q2 2024"].verified).toBe(false);
  });

  it("handles single data point", () => {
    const points = [
      { date: new Date("2024-05-01"), score: 60, model: "X", source: "test", verified: true },
    ];
    const result = computeCumulativeBest(points, quarters);
    expect(result["Q1 2024"]).toBeNull();
    expect(result["Q2 2024"].score).toBe(60);
  });

  it("handles empty array", () => {
    const result = computeCumulativeBest([], quarters);
    expect(result["Q1 2024"]).toBeNull();
    expect(result["Q2 2024"]).toBeNull();
    expect(result["Q3 2024"]).toBeNull();
  });

  it("defaults variant to null on baseline points", () => {
    const points = [
      { date: new Date("2024-01-15"), score: 50, model: "A", source: "test", verified: true },
    ];
    const result = computeCumulativeBest(points, quarters);
    expect(result["Q1 2024"].variant).toBeNull();
  });

  it("carries the winning point's variant", () => {
    const points = [
      { date: new Date("2024-01-15"), score: 46.9, model: "Opus 4.7", source: "model_card_auto", verified: false, variant: null },
      { date: new Date("2024-04-15"), score: 54.7, model: "Opus 4.7", source: "model_card_auto", verified: false, variant: "with tools" },
    ];
    const result = computeCumulativeBest(points, quarters);
    expect(result["Q1 2024"].variant).toBeNull();
    expect(result["Q2 2024"].variant).toBe("with tools");
    expect(result["Q3 2024"].variant).toBe("with tools"); // carried forward
  });

  it("verified wins ties (deterministic across runs)", () => {
    const points = [
      // unverified arrives first by date
      { date: new Date("2024-01-10"), score: 60, model: "Unverified", source: "model_card", verified: false, variant: "with tools" },
      { date: new Date("2024-01-20"), score: 60, model: "Verified", source: "artificialanalysis", verified: true, variant: null },
    ];
    const result = computeCumulativeBest(points, quarters);
    expect(result["Q1 2024"].verified).toBe(true);
    expect(result["Q1 2024"].model).toBe("Verified");
    expect(result["Q1 2024"].variant).toBeNull();
  });
});

// ─── computeCumulativeMin ────────────────────────────────────

describe("computeCumulativeMin", () => {
  const quarters = ["Q1 2024", "Q2 2024", "Q3 2024"];

  it("tracks running min across quarters", () => {
    const points = [
      { date: new Date("2024-01-15"), price: 10, model: "A", lab: "openai", score: 80 },
      { date: new Date("2024-04-15"), price: 5, model: "B", lab: "google", score: 85 },
    ];
    const result = computeCumulativeMin(points, quarters);
    expect(result["Q1 2024"].price).toBe(10);
    expect(result["Q2 2024"].price).toBe(5);
    expect(result["Q3 2024"].price).toBe(5); // Carries forward
  });

  it("does not replace with higher price", () => {
    const points = [
      { date: new Date("2024-01-15"), price: 5, model: "A", lab: "openai", score: 80 },
      { date: new Date("2024-04-15"), price: 10, model: "B", lab: "google", score: 85 },
    ];
    const result = computeCumulativeMin(points, quarters);
    expect(result["Q2 2024"].price).toBe(5); // Keeps the lower price
  });

  it("handles empty array", () => {
    const result = computeCumulativeMin([], quarters);
    expect(result["Q1 2024"]).toBeNull();
    expect(result["Q2 2024"]).toBeNull();
  });
});

// ─── findCol ─────────────────────────────────────────────────

describe("findCol", () => {
  const headers = ["Name", "Score", "Release date", "Organization"];

  it("returns preferred match when available", () => {
    expect(findCol(headers, "Score", ["score", "mean_score"])).toBe("Score");
  });

  it("falls back to candidates when preferred not found", () => {
    expect(findCol(headers, "mean_score", ["Score", "Accuracy"])).toBe("Score");
  });

  it("returns first matching candidate", () => {
    expect(findCol(headers, null, ["Release date", "Date", "date"])).toBe("Release date");
  });

  it("returns null when nothing matches", () => {
    expect(findCol(headers, "missing", ["also_missing", "nope"])).toBeNull();
  });

  it("returns null with null preferred and no candidate matches", () => {
    expect(findCol(headers, null, ["x", "y", "z"])).toBeNull();
  });
});

// ─── generateMatchVerifiedRegex ──────────────────────────────

describe("generateMatchVerifiedRegex", () => {
  it("matches the model name it was generated from", () => {
    const re = generateMatchVerifiedRegex("GPT-5.4 Pro");
    expect(re.test("GPT-5.4 Pro")).toBe(true);
  });

  it("is case-insensitive", () => {
    const re = generateMatchVerifiedRegex("GPT-5.4 Mini");
    expect(re.test("gpt-5.4 mini")).toBe(true);
    expect(re.test("GPT-5.4 MINI")).toBe(true);
  });

  it("handles version number separators flexibly", () => {
    const re = generateMatchVerifiedRegex("Claude Sonnet 4.6");
    expect(re.test("Claude Sonnet 4.6")).toBe(true);
    expect(re.test("claude sonnet 4-6")).toBe(true);
    expect(re.test("claude sonnet 4 6")).toBe(true);
    expect(re.test("claude-sonnet-4.6")).toBe(true);
  });

  it("strips parenthetical suffixes like '(with tools)'", () => {
    const re = generateMatchVerifiedRegex("GPT-5.4 Pro (with tools)");
    expect(re.test("GPT-5.4 Pro")).toBe(true);
    expect(re.test("gpt 5.4 pro")).toBe(true);
  });

  it("produces patterns that match real model names", () => {
    expect(generateMatchVerifiedRegex("Gemini 3.1 Pro").test("Gemini 3.1 Pro")).toBe(true);
    expect(generateMatchVerifiedRegex("Gemini 3 Deep Think").test("Gemini 3 Deep Think")).toBe(true);
    expect(generateMatchVerifiedRegex("Claude Opus 4.6").test("claude opus 4.6")).toBe(true);
  });

  it("does not match unrelated models", () => {
    const re = generateMatchVerifiedRegex("GPT-5.4 Pro");
    expect(re.test("Claude Sonnet 4.6")).toBe(false);
    expect(re.test("Gemini 3.1 Pro")).toBe(false);
  });

  it("paren cleanup is regex-equivalent: '(with tools)' makes no difference", () => {
    // Locks in the invariant that splitting (with tools) into a separate variant
    // field doesn't change the matchVerified regex for hardcoded MODEL_CARD_DATA rows.
    expect(generateMatchVerifiedRegex("Claude Opus 4.6 (with tools)").source)
      .toBe(generateMatchVerifiedRegex("Claude Opus 4.6").source);
    expect(generateMatchVerifiedRegex("Gemini 3.1 Pro (with tools)").source)
      .toBe(generateMatchVerifiedRegex("Gemini 3.1 Pro").source);
  });
});

// ─── normalizeVariant ────────────────────────────────────────

describe("normalizeVariant", () => {
  it("returns null for null/undefined/empty", () => {
    expect(normalizeVariant(null)).toBeNull();
    expect(normalizeVariant(undefined)).toBeNull();
    expect(normalizeVariant("")).toBeNull();
    expect(normalizeVariant("   ")).toBeNull();
  });

  it("treats explicit no-tools strings as standard (null)", () => {
    expect(normalizeVariant("no tools")).toBeNull();
    expect(normalizeVariant("No Tools")).toBeNull();
    expect(normalizeVariant("without tools")).toBeNull();
    expect(normalizeVariant("no tool")).toBeNull();
    expect(normalizeVariant("without tool")).toBeNull();
  });

  it("canonicalizes with-tools variants", () => {
    expect(normalizeVariant("with tools")).toBe("with tools");
    expect(normalizeVariant("with tool")).toBe("with tools");
    expect(normalizeVariant("With Tools")).toBe("with tools");
    expect(normalizeVariant("  with tools  ")).toBe("with tools");
  });

  it("collapses unicode whitespace (e.g. NBSP) before checking", () => {
    expect(normalizeVariant("with tools")).toBe("with tools");
  });

  it("passes unknown variants through verbatim (preserving case)", () => {
    expect(normalizeVariant("xhigh")).toBe("xhigh");
    expect(normalizeVariant("Think")).toBe("Think");
    expect(normalizeVariant("Speciale")).toBe("Speciale");
    expect(normalizeVariant("with Python")).toBe("with Python");
  });
});

// ─── isHarnessVariant ────────────────────────────────────────

describe("isHarnessVariant", () => {
  it("returns false for null/empty", () => {
    expect(isHarnessVariant(null)).toBe(false);
    expect(isHarnessVariant(undefined)).toBe(false);
    expect(isHarnessVariant("")).toBe(false);
  });

  it("matches all listed harness keywords", () => {
    // Reference samples that exercise each branch of HARNESS_PATTERN.
    const positives = [
      "with tools", "with tool", "with python", "with search", "with browser",
      "with code exec", "with code interpreter", "with harness", "with computer use",
      "tool use", "code interpreter", "function calling",
      "agent", "agentic", "agent mode", "agent harness", "agent scaffold",
      "scaffold", "scaffolding", "browsing", "browsing enabled", "internet access",
    ];
    for (const v of positives) {
      expect(isHarnessVariant(v), `expected ${JSON.stringify(v)} to be harness`).toBe(true);
    }
    // Sanity check: HARNESS_KEYWORDS list isn't empty (catches accidental deletion)
    expect(HARNESS_KEYWORDS.length).toBeGreaterThan(5);
  });

  it("returns false for config knobs and unknown strings", () => {
    expect(isHarnessVariant("xhigh")).toBe(false);
    expect(isHarnessVariant("high")).toBe(false);
    expect(isHarnessVariant("medium")).toBe(false);
    expect(isHarnessVariant("Think")).toBe(false);
    expect(isHarnessVariant("Thinking")).toBe(false);
    expect(isHarnessVariant("Speciale")).toBe(false);
  });

  it("is case-insensitive and tolerates surrounding whitespace", () => {
    expect(isHarnessVariant("With Tools")).toBe(true);
    expect(isHarnessVariant("  with tools  ")).toBe(true);
    expect(isHarnessVariant("WITH TOOLS")).toBe(true);
  });
});

// ─── splitVariantFromModel ───────────────────────────────────

describe("splitVariantFromModel", () => {
  it("strips '(with tools)' from model and promotes to variant when variant is null", () => {
    expect(splitVariantFromModel("Claude Opus 4.6 (with tools)", null))
      .toEqual({ model: "Claude Opus 4.6", variant: "with tools" });
  });

  it("strips '(no tools)' / '(without tools)' to null variant", () => {
    expect(splitVariantFromModel("Claude Opus 4.7 (no tools)", null))
      .toEqual({ model: "Claude Opus 4.7", variant: null });
    expect(splitVariantFromModel("Claude Opus 4.7 (without tools)", null))
      .toEqual({ model: "Claude Opus 4.7", variant: null });
  });

  it("does not touch parens that aren't tool variants", () => {
    expect(splitVariantFromModel("GPT-4o (mini)", null))
      .toEqual({ model: "GPT-4o (mini)", variant: null });
    expect(splitVariantFromModel("Claude (Beta)", null))
      .toEqual({ model: "Claude (Beta)", variant: null });
  });

  it("preserves an existing non-null variant rather than re-deriving", () => {
    expect(splitVariantFromModel("Claude Opus 4.6 (with tools)", "with tools"))
      .toEqual({ model: "Claude Opus 4.6 (with tools)", variant: "with tools" });
  });

  it("handles plain model names with no parens", () => {
    expect(splitVariantFromModel("Claude Sonnet 4.6", null))
      .toEqual({ model: "Claude Sonnet 4.6", variant: null });
  });
});

// ─── isAcknowledgedConfigVariant ─────────────────────────────

describe("isAcknowledgedConfigVariant", () => {
  it("returns true for known config strings (case-insensitive)", () => {
    expect(isAcknowledgedConfigVariant("xhigh")).toBe(true);
    expect(isAcknowledgedConfigVariant("XHigh")).toBe(true);
    expect(isAcknowledgedConfigVariant("high")).toBe(true);
    expect(isAcknowledgedConfigVariant("Think")).toBe(true);
    expect(isAcknowledgedConfigVariant("Thinking")).toBe(true);
    expect(isAcknowledgedConfigVariant("Speciale")).toBe(true);
  });

  it("returns false for harness variants and unknown strings", () => {
    expect(isAcknowledgedConfigVariant("with tools")).toBe(false);
    expect(isAcknowledgedConfigVariant("with python")).toBe(false);
    expect(isAcknowledgedConfigVariant("brand new variant")).toBe(false);
  });

  it("returns false for null/empty", () => {
    expect(isAcknowledgedConfigVariant(null)).toBe(false);
    expect(isAcknowledgedConfigVariant("")).toBe(false);
  });
});

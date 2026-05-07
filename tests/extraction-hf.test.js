import { describe, it, expect } from "vitest";

const { filterHfModels, parseHfReadmeImages } = require("../lib/extraction.js");
const { columnHeaderGuard } = require("../lib/llm-extract.js");

// ─── filterHfModels ──────────────────────────────────────────

describe("filterHfModels", () => {
  const NOW = new Date("2026-05-07T00:00:00Z");
  const recent = "2026-05-01T00:00:00Z";
  const old = "2025-01-01T00:00:00Z";

  function model(overrides = {}) {
    return {
      id: "lab/Model-1",
      createdAt: recent,
      lastModified: recent,
      pipeline_tag: "text-generation",
      tags: ["transformers"],
      ...overrides,
    };
  }

  it("keeps a normal flagship model card", () => {
    const out = filterHfModels([model()], { now: NOW });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("lab/Model-1");
  });

  it("drops models last-modified outside the 30-day window", () => {
    const out = filterHfModels([model({ lastModified: old })], { now: NOW });
    expect(out).toHaveLength(0);
  });

  it("drops models with non-text pipeline_tag (TTS, image-feature-extraction, etc.)", () => {
    expect(filterHfModels([model({ pipeline_tag: "text-to-speech" })], { now: NOW })).toHaveLength(0);
    expect(filterHfModels([model({ pipeline_tag: "image-feature-extraction" })], { now: NOW })).toHaveLength(0);
    expect(filterHfModels([model({ pipeline_tag: "automatic-speech-recognition" })], { now: NOW })).toHaveLength(0);
  });

  it("keeps text-generation and image-text-to-text", () => {
    expect(filterHfModels([model({ pipeline_tag: "text-generation" })], { now: NOW })).toHaveLength(1);
    expect(filterHfModels([model({ id: "lab/Vision-1", pipeline_tag: "image-text-to-text" })], { now: NOW })).toHaveLength(1);
  });

  it("drops null/missing pipeline_tag (covers DeepSeek-V4-Flash-Base case)", () => {
    expect(filterHfModels([model({ pipeline_tag: null })], { now: NOW })).toHaveLength(0);
    expect(filterHfModels([model({ pipeline_tag: undefined })], { now: NOW })).toHaveLength(0);
  });

  it("drops -Base/-FP8/-AWQ/-GPTQ/-Int4/-Int8/-GGUF suffix variants", () => {
    const ids = [
      "lab/Model-Base", "lab/Model-FP8", "lab/Model-AWQ",
      "lab/Model-GPTQ", "lab/Model-Int4", "lab/Model-Int8", "lab/Model-GGUF",
    ];
    for (const id of ids) {
      expect(filterHfModels([model({ id })], { now: NOW })).toHaveLength(0);
    }
  });

  it("keeps models whose name happens to contain Base/FP8 mid-string but not as suffix", () => {
    expect(filterHfModels([model({ id: "lab/Baseline-Model" })], { now: NOW })).toHaveLength(1);
    expect(filterHfModels([model({ id: "lab/FP8-Improved-Model" })], { now: NOW })).toHaveLength(1);
  });

  it("KEEPS natively-fp8 flagships (e.g. DeepSeek V4, MiniMax M2)", () => {
    // DeepSeek V4 and MiniMax M2.7 ship with `fp8` in tags as a native-precision
    // marker, not as a derivative-quantization marker. Excluding on bare quant
    // tags would drop the flagships of two of our four HF labs.
    expect(filterHfModels([model({ tags: ["transformers", "fp8", "endpoints_compatible"] })], { now: NOW })).toHaveLength(1);
    expect(filterHfModels([model({ tags: ["8-bit", "fp8", "region:us"] })], { now: NOW })).toHaveLength(1);
  });

  it("drops models tagged as derivative quantizations via base_model:quantized:", () => {
    expect(filterHfModels([model({
      tags: ["transformers", "base_model:quantized:lab/Original-Model"],
    })], { now: NOW })).toHaveLength(0);
  });

  it("drops malformed entries gracefully", () => {
    expect(filterHfModels([null, undefined, {}, { id: "x" }, "string"], { now: NOW })).toHaveLength(0);
  });

  it("returns empty array on non-array input", () => {
    expect(filterHfModels(null)).toEqual([]);
    expect(filterHfModels({})).toEqual([]);
    expect(filterHfModels("not-an-array")).toEqual([]);
  });

  it("respects the limit parameter", () => {
    const many = Array.from({ length: 50 }, (_, i) => model({
      id: `lab/Model-${i}`,
      createdAt: new Date(NOW.getTime() - i * 1000).toISOString(),
    }));
    expect(filterHfModels(many, { now: NOW, limit: 5 })).toHaveLength(5);
    expect(filterHfModels(many, { now: NOW, limit: 20 })).toHaveLength(20);
  });

  it("sorts by createdAt descending (newest first)", () => {
    const inputs = [
      model({ id: "lab/Older", createdAt: "2026-04-01T00:00:00Z" }),
      model({ id: "lab/Newest", createdAt: "2026-05-01T00:00:00Z" }),
      model({ id: "lab/Middle", createdAt: "2026-04-15T00:00:00Z" }),
    ];
    const out = filterHfModels(inputs, { now: NOW });
    expect(out.map(m => m.id)).toEqual(["lab/Newest", "lab/Middle", "lab/Older"]);
  });
});

// ─── parseHfReadmeImages ─────────────────────────────────────

describe("parseHfReadmeImages", () => {
  it("extracts markdown image syntax", () => {
    const md = "Some prose\n\n![chart](figures/bench.png)\n\nMore prose";
    const out = parseHfReadmeImages(md, "lab/Model", "main");
    expect(out).toEqual([
      "https://huggingface.co/lab/Model/resolve/main/figures/bench.png",
    ]);
  });

  it("extracts HTML img tags (common inside <p align=center> in HF READMEs)", () => {
    const md = `<p align="center"><img width="100%" src="figures/benchmark_overview.png"></p>`;
    const out = parseHfReadmeImages(md, "lab/Model", "abc123");
    expect(out).toEqual([
      "https://huggingface.co/lab/Model/resolve/abc123/figures/benchmark_overview.png",
    ]);
  });

  it("preserves absolute URLs (e.g., GitHub raw)", () => {
    const md = `![](https://raw.githubusercontent.com/lab/repo/main/bench.png)`;
    const out = parseHfReadmeImages(md, "lab/Model", "main");
    expect(out).toEqual(["https://raw.githubusercontent.com/lab/repo/main/bench.png"]);
  });

  it("skips .svg, .gif, .webp images (not vision-friendly)", () => {
    const md = `![logo](assets/logo.svg)\n![demo](assets/demo.gif)\n![chart](assets/chart.png)\n![ico](assets/ico.webp)`;
    const out = parseHfReadmeImages(md, "lab/Model", "main");
    expect(out).toEqual(["https://huggingface.co/lab/Model/resolve/main/assets/chart.png"]);
  });

  it("deduplicates repeated references", () => {
    const md = `![a](figures/x.png)\n![b](figures/x.png)`;
    const out = parseHfReadmeImages(md, "lab/Model", "main");
    expect(out).toHaveLength(1);
  });

  it("handles ./ and / prefixed relative paths", () => {
    const md = `![a](./figures/x.png)\n![b](/figures/y.png)`;
    const out = parseHfReadmeImages(md, "lab/Model", "main");
    expect(out).toEqual([
      "https://huggingface.co/lab/Model/resolve/main/figures/x.png",
      "https://huggingface.co/lab/Model/resolve/main/figures/y.png",
    ]);
  });

  it("returns empty for empty/missing input", () => {
    expect(parseHfReadmeImages("", "lab/Model", "main")).toEqual([]);
    expect(parseHfReadmeImages(null, "lab/Model", "main")).toEqual([]);
    expect(parseHfReadmeImages("![](x.png)", null, "main")).toEqual([]);
  });

  it("captures both markdown + HTML images in the same blob", () => {
    const md = `
![one](figures/one.png)
<img src="figures/two.jpg">
<p align="center"><img alt="three" src="figures/three.png" width="80%"></p>
`;
    const out = parseHfReadmeImages(md, "lab/Model", "main");
    expect(out).toHaveLength(3);
    expect(out).toContain("https://huggingface.co/lab/Model/resolve/main/figures/one.png");
    expect(out).toContain("https://huggingface.co/lab/Model/resolve/main/figures/two.jpg");
    expect(out).toContain("https://huggingface.co/lab/Model/resolve/main/figures/three.png");
  });
});

// ─── columnHeaderGuard ───────────────────────────────────────

describe("columnHeaderGuard", () => {
  it("keeps scores without column_header (prose extractions)", () => {
    const scores = [
      { benchmark: "GPQA", score: 90.1 },
      { benchmark: "HLE", score: 38, model_variant: "with tools" },
    ];
    const { kept, dropped } = columnHeaderGuard(scores, "MiniMax-M2.7");
    expect(kept).toHaveLength(2);
    expect(dropped).toHaveLength(0);
  });

  it("keeps scores whose column_header shares a token with modelName", () => {
    const scores = [
      { benchmark: "GPQA", score: 90.1, column_header: "MiniMax-M2.7" },
      { benchmark: "HLE", score: 37.7, column_header: "M2.7" },
    ];
    const { kept } = columnHeaderGuard(scores, "MiniMax-M2.7");
    expect(kept).toHaveLength(2);
  });

  it("drops scores whose column_header does not match the target model", () => {
    const scores = [
      { benchmark: "GPQA", score: 91.0, column_header: "GPT-5.5" },
      { benchmark: "GPQA", score: 89.5, column_header: "Claude 4.7" },
      { benchmark: "GPQA", score: 88.0, column_header: "Gemini 3" },
      { benchmark: "GPQA", score: 90.1, column_header: "Kimi-K2.6" },
    ];
    const { kept, dropped } = columnHeaderGuard(scores, "Kimi-K2.6");
    expect(kept).toHaveLength(1);
    expect(kept[0].column_header).toBe("Kimi-K2.6");
    expect(dropped).toHaveLength(3);
  });

  it("handles suffix variants on the column header (Pro/Flash/Max/Instruct/Base)", () => {
    const scores = [
      { benchmark: "GPQA", score: 90.1, column_header: "DeepSeek-V4-Pro" },
      { benchmark: "GPQA", score: 87.5, column_header: "DeepSeek-V4" },
    ];
    const { kept } = columnHeaderGuard(scores, "DeepSeek-V4");
    expect(kept.length).toBeGreaterThanOrEqual(1);
  });

  it("does NOT catch same-family-different-version (relies on prompt for that)", () => {
    // GLM-4.6 vs GLM-4.7 — both share the "glm" token, so the programmatic
    // guard keeps both. The LLM prompt is responsible for not extracting
    // GLM-4.6 rows when the target is GLM-4.7. This test documents the gap.
    const scores = [
      { benchmark: "GPQA", score: 88.0, column_header: "GLM-4.6" },
      { benchmark: "GPQA", score: 90.0, column_header: "GLM-4.7" },
    ];
    const { kept, dropped } = columnHeaderGuard(scores, "GLM-4.7");
    expect(kept).toHaveLength(2);
    expect(dropped).toHaveLength(0);
  });

  it("handles missing/empty modelName by passing scores through", () => {
    const scores = [{ benchmark: "GPQA", score: 90, column_header: "Anything" }];
    expect(columnHeaderGuard(scores, "").kept).toEqual(scores);
    expect(columnHeaderGuard(scores, null).kept).toEqual(scores);
  });

  it("annotates dropped scores with a reason for audit", () => {
    const scores = [{ benchmark: "GPQA", score: 90, column_header: "GPT-5.5" }];
    const { dropped } = columnHeaderGuard(scores, "Kimi-K2.6");
    expect(dropped[0]._dropReason).toContain("GPT-5.5");
    expect(dropped[0]._dropReason).toContain("Kimi-K2.6");
  });

  it("drops -Base columns when target is the instructed model", () => {
    const scores = [
      { benchmark: "MMLU-Pro", score: 73.5, column_header: "DeepSeek-V4-Pro-Base" },
      { benchmark: "MMLU-Pro", score: 87.5, column_header: "DS-V4-Pro Max" },
    ];
    const { kept, dropped } = columnHeaderGuard(scores, "DeepSeek-V4-Pro");
    expect(kept).toHaveLength(1);
    expect(kept[0].column_header).toBe("DS-V4-Pro Max");
    expect(dropped[0]._dropReason).toContain("Base checkpoint");
  });

  it("KEEPS -Base columns when the target itself is a Base model (rare but defensible)", () => {
    const scores = [
      { benchmark: "MMLU-Pro", score: 73.5, column_header: "DeepSeek-V4-Pro-Base" },
    ];
    const { kept } = columnHeaderGuard(scores, "DeepSeek-V4-Pro-Base");
    expect(kept).toHaveLength(1);
  });
});

import { describe, it, expect } from "vitest";

const { LAB_SOURCES } = require("../lib/lab-sources.js");

describe("LAB_SOURCES", () => {
  it("includes the four HF API sources for Chinese Leaders", () => {
    const hfSources = LAB_SOURCES.filter(s => s.scanMethod === "huggingfaceApi");
    const slugs = hfSources.map(s => s.slug).sort();
    expect(slugs).toEqual(["deepseek", "kimi", "minimax", "zhipu"]);
    for (const s of hfSources) {
      expect(s.lab).toBe("chinese");
      expect(s.hfAuthor).toBeTruthy();
      expect(typeof s.hfAuthor).toBe("string");
      expect(s.minExpectedArticles).toBeGreaterThanOrEqual(1); // never 0 — silences failure signals
    }
  });

  it("uses correct HF org names for each lab", () => {
    const byName = Object.fromEntries(
      LAB_SOURCES.filter(s => s.scanMethod === "huggingfaceApi").map(s => [s.slug, s.hfAuthor])
    );
    expect(byName.deepseek).toBe("deepseek-ai");
    expect(byName.kimi).toBe("moonshotai");
    expect(byName.minimax).toBe("MiniMaxAI");
    expect(byName.zhipu).toBe("zai-org");
  });

  it("Qwen retains its existing card-scanner config (not migrated to HF)", () => {
    const qwen = LAB_SOURCES.find(s => s.slug === "qwen");
    expect(qwen).toBeTruthy();
    expect(qwen.scanMethod).toBe("qwenCards");
    expect(qwen.indexUrl).toBe("https://qwen.ai/research");
  });

  it("OpenAI keeps useBrowserbase: true", () => {
    const openai = LAB_SOURCES.find(s => s.lab === "openai");
    expect(openai.useBrowserbase).toBe(true);
  });

  it("HF sources do not set useBrowserbase (no browser path needed)", () => {
    for (const s of LAB_SOURCES.filter(s => s.scanMethod === "huggingfaceApi")) {
      expect(s.useBrowserbase).toBeUndefined();
    }
  });
});

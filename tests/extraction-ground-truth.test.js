// tests/extraction-ground-truth.test.js
// Integration tests for extraction pipeline against live blog pages.
// Requires: ANTHROPIC_API_KEY + Playwright browsers + RUN_INTEGRATION=1
//
// Run: RUN_INTEGRATION=1 npm test -- extraction-ground-truth

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const shouldRun = process.env.RUN_INTEGRATION === "1";

// Ground truth data from validated prototype extraction runs.
// Each entry: { url, modelName, minScores, expectedScores[] }
const GROUND_TRUTH = [
  {
    lab: "anthropic",
    url: "https://www.anthropic.com/claude/sonnet",
    modelName: "Claude Sonnet 4.6",
    minScores: 14,
    expectedScores: [
      { benchmark: /terminal.bench/i, score: 59.1 },
      { benchmark: /swe.bench.*verified/i, score: 79.6 },
      { benchmark: /osworld/i, score: 72.5 },
      { benchmark: /t2.bench.*retail/i, score: 91.7 },
      { benchmark: /t2.bench.*telecom/i, score: 97.9 },
      { benchmark: /mcp.atlas/i, score: 61.3 },
      { benchmark: /browsecomp/i, score: 74.7 },
      { benchmark: /hle/i, scoreRange: [33, 49] }, // with/without tools
      { benchmark: /finance.*agent/i, score: 63.3 },
      { benchmark: /arc.agi.2/i, score: 58.3 },
      { benchmark: /gpqa.*diamond/i, score: 89.9 },
      { benchmark: /mmmu.pro/i, scoreRange: [74, 76] }, // with/without tools
      { benchmark: /mmmlu/i, score: 89.3 },
    ],
  },
  {
    lab: "openai",
    url: "https://openai.com/index/introducing-gpt-5-4-mini/",
    modelName: "GPT-5.4 Mini",
    minScores: 10,
    expectedScores: [
      { benchmark: /gpqa.*diamond/i },
      { benchmark: /swe.bench/i },
      { benchmark: /aime/i },
      { benchmark: /hle/i },
    ],
  },
  {
    lab: "xai",
    url: "https://x.ai/news/grok-4-1",
    modelName: "Grok 4.1 Fast",
    minScores: 5,
    expectedScores: [
      { benchmark: /gpqa/i },
      { benchmark: /aime/i },
    ],
  },
];

describe.skipIf(!shouldRun)("extraction ground truth (integration)", () => {
  let browser, page, anthropic;

  beforeAll(async () => {
    const { chromium } = await import("playwright");
    const Anthropic = (await import("@anthropic-ai/sdk")).default;

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 720 },
    });
    page = await context.newPage();
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }, 30000);

  afterAll(async () => {
    if (browser) await browser.close();
  });

  for (const gt of GROUND_TRUTH) {
    it(`extracts scores from ${gt.lab}: ${gt.modelName}`, async () => {
      // Dynamic import of the extraction functions
      const { extractRawImageUrl, filterContentImages, buildTextBlock, deduplicateScores } =
        require("../lib/extraction.js");
      const { extractScoresFromImage, extractScoresFromText } =
        require("../lib/llm-extract.js");

      // Navigate and extract page content
      await page.goto(gt.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.evaluate(async () => {
        const delay = ms => new Promise(r => setTimeout(r, ms));
        for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) {
          window.scrollTo(0, y);
          await delay(200);
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(1000);

      // Get images
      const images = await page.evaluate(() =>
        Array.from(document.querySelectorAll("img")).map(img => ({
          src: img.src, width: img.naturalWidth || img.width || 0,
          height: img.naturalHeight || img.height || 0, alt: img.alt || "",
        }))
      );
      const contentImages = filterContentImages(images);
      const imageUrls = [...new Set(contentImages.map(i => extractRawImageUrl(i.src)).filter(Boolean))];

      // Download images
      const downloaded = [];
      for (const url of imageUrls) {
        try {
          const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
          if (!resp.ok) continue;
          const buf = Buffer.from(await resp.arrayBuffer());
          if (buf.length < 5000) continue;
          downloaded.push({
            base64Data: buf.toString("base64"),
            mediaType: (resp.headers.get("content-type") || "image/png").split(";")[0],
          });
        } catch { /* skip */ }
      }

      // Get text
      const sections = await page.evaluate(() => {
        const results = [];
        const main = document.querySelector("main, article, [class*='content']") || document.body;
        const walker = document.createTreeWalker(main, NodeFilter.SHOW_ELEMENT, null);
        let node = walker.nextNode();
        while (node) {
          const tag = node.tagName.toLowerCase();
          if (/^h[1-6]$/.test(tag)) results.push({ type: "heading", content: node.textContent.trim() });
          else if (tag === "table") {
            const rows = Array.from(node.querySelectorAll("tr")).map(row =>
              Array.from(row.querySelectorAll("th, td")).map(c => c.textContent.trim()).join(" | ")
            );
            results.push({ type: "table", content: rows.join("\n") });
          } else if (tag === "p") {
            const text = node.textContent.trim();
            if (text.length > 20) results.push({ type: "paragraph", content: text });
          }
          node = walker.nextNode();
        }
        return results;
      });
      const textBlock = buildTextBlock(sections);

      // Run LLM extraction in parallel
      const visionPromises = downloaded.map(img =>
        extractScoresFromImage(anthropic, { ...img, modelName: gt.modelName }).catch(() => [])
      );
      const textPromise = extractScoresFromText(anthropic, { textContent: textBlock, modelName: gt.modelName }).catch(() => []);

      const [visionResults, textResults] = await Promise.all([
        Promise.all(visionPromises).then(r => r.flat()),
        textPromise,
      ]);

      const scores = deduplicateScores(visionResults, textResults);
      console.log(`\n  ${gt.modelName}: ${scores.length} scores extracted`);
      for (const s of scores) {
        console.log(`    ${s.benchmark}: ${s.score} (${s.source_method})`);
      }

      // Verify minimum count
      expect(scores.length).toBeGreaterThanOrEqual(gt.minScores);

      // Verify expected scores are present
      for (const expected of gt.expectedScores) {
        const match = scores.find(s => expected.benchmark.test(s.benchmark));
        expect(match, `Expected to find benchmark matching ${expected.benchmark}`).toBeTruthy();

        if (expected.score !== undefined) {
          expect(match.score).toBeCloseTo(expected.score, 0);
        }
        if (expected.scoreRange) {
          expect(match.score).toBeGreaterThanOrEqual(expected.scoreRange[0]);
          expect(match.score).toBeLessThanOrEqual(expected.scoreRange[1]);
        }
      }
    }, 120000); // 2 minute timeout per test
  }
});

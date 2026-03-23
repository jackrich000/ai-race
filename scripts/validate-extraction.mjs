#!/usr/bin/env node
// scripts/validate-extraction.mjs
// End-to-end extraction validation against ground truth data.
// Loads each ground truth URL, runs full extraction (browser + LLM),
// and compares extracted scores against manually verified ground truths.
// Runs as part of the weekly pipeline to ensure extraction still works.
//
// Usage:
//   node scripts/validate-extraction.mjs          # Full validation
//   node scripts/validate-extraction.mjs --quick   # Page rendering check only (no LLM)

import { createRequire } from "module";
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const { filterContentImages, buildTextBlock, deduplicateScores, parsePublishDate } = require("../lib/extraction.js");
const { extractScoresFromText, extractScoresFromImage } = require("../lib/llm-extract.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// Load .env
const envPath = path.resolve(PROJECT_ROOT, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

const QUICK_MODE = process.argv.includes("--quick");

// ─── Ground truth data ───────────────────────────────────────
// Manually verified scores from lab blog pages. Each entry lists
// benchmark names as they appear in extraction output (pre-normalization).

const GROUND_TRUTHS = [
  {
    lab: "anthropic",
    labName: "Anthropic",
    url: "https://www.anthropic.com/news/claude-sonnet-4-6",
    model: "Claude Sonnet 4.6",
    minSections: 20,
    expectedScores: [
      { benchmark: /swe.?bench verified/i, score: 79.6 },
      { benchmark: /gpqa.?diamond/i, score: 89.9 },
      { benchmark: /arc.?agi.?2/i, score: 58.3 },
      { benchmark: /hle|humanity.*last.*exam/i, score: 33.2 },  // without tools
      { benchmark: /hle|humanity.*last.*exam/i, score: 49.0 },  // with tools
    ],
  },
  {
    lab: "openai",
    labName: "OpenAI",
    url: "https://openai.com/index/introducing-gpt-5-4-mini-and-nano/",
    model: "GPT-5.4 mini and nano",
    minSections: 30,
    expectedScores: [
      { benchmark: /swe.?bench pro/i, score: 54.4 },
      { benchmark: /gpqa.?diamond/i, score: 88.0 },
      { benchmark: /hle.*tool/i, score: 41.5 },     // with tool
      { benchmark: /hle.*w\/o|hle.*without/i, score: 28.2 },  // without tools
      { benchmark: /osworld/i, score: 72.1 },
    ],
  },
  {
    lab: "xai",
    labName: "xAI",
    url: "https://x.ai/news/grok-4-1-fast",
    model: "Grok 4.1 Fast",
    minSections: 20,
    expectedScores: [
      { benchmark: /multi.?turn.?acc/i, score: 57.12 },
      { benchmark: /frames/i, score: 87.6 },
      { benchmark: /research.?eval|reka/i, score: 63.9 },
    ],
  },
  {
    lab: "google",
    labName: "Google DeepMind",
    url: "https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-1-flash-lite/",
    model: "Gemini 3.1 Flash-Lite",
    minSections: 20,
    expectedScores: [
      { benchmark: /gpqa.?diamond/i, score: 86.9 },
      { benchmark: /humanity.*last.*exam|hle/i, score: 16.0 },
      { benchmark: /mmmu.?pro/i, score: 76.8 },
      { benchmark: /mmmlu/i, score: 88.9 },
    ],
  },
  {
    lab: "chinese",
    labName: "DeepSeek",
    url: "https://huggingface.co/deepseek-ai/DeepSeek-V3.2-Exp",
    model: "DeepSeek-V3.2-Exp",
    minSections: 5,
    expectedScores: [
      { benchmark: /gpqa.?diamond/i, score: 79.9 },
      { benchmark: /humanity.*last.*exam|hle/i, score: 19.8 },
      { benchmark: /mmlu.?pro/i, score: 85.0 },
    ],
  },
];

// ─── Page content extraction (mirrors extract-model-cards.mjs) ──

async function extractPageContent(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(6000);

  // Scroll to trigger lazy loading
  await page.evaluate(async () => {
    const step = window.innerHeight;
    const total = document.body.scrollHeight;
    for (let y = 0; y < total; y += step) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 200));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1000);

  const images = await page.evaluate(() =>
    Array.from(document.querySelectorAll("img")).map(img => ({
      src: img.src || img.getAttribute("data-src") || "",
      width: img.naturalWidth || img.width || 0,
      height: img.naturalHeight || img.height || 0,
      alt: img.alt || "",
    }))
  );

  const sections = await page.evaluate(() => {
    const results = [];
    const mainContent = document.querySelector("main") || document.querySelector("article") ||
                        document.querySelector("[class*='content']") || document.body;
    const walker = document.createTreeWalker(mainContent, NodeFilter.SHOW_ELEMENT, null);
    let node = walker.nextNode();
    while (node) {
      const tag = node.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        results.push({ type: "heading", content: node.textContent.trim() });
      } else if (tag === "table") {
        const rows = Array.from(node.querySelectorAll("tr")).map(row =>
          Array.from(row.querySelectorAll("th, td")).map(cell => cell.textContent.trim()).join(" | ")
        );
        results.push({ type: "table", content: rows.join("\n") });
      } else if (tag === "ul" || tag === "ol") {
        const items = Array.from(node.querySelectorAll("li")).map(li => `- ${li.textContent.trim()}`);
        results.push({ type: "list", content: items.join("\n") });
      } else if (tag === "p" || tag === "div") {
        const text = node.textContent.trim();
        if (text.length > 20 && !node.querySelector("h1,h2,h3,h4,h5,h6,table,ul,ol")) {
          results.push({ type: "paragraph", content: text });
        }
      }
      node = walker.nextNode();
    }
    return results;
  });

  const svgData = await page.evaluate(() => {
    const svgs = document.querySelectorAll("svg");
    const svgsWithText = Array.from(svgs).filter(svg =>
      Array.from(svg.querySelectorAll("text")).some(t => t.textContent.trim())
    );
    if (svgsWithText.length === 0) return [];
    const containers = new Set();
    for (const svg of svgsWithText) {
      let el = svg.parentElement;
      let best = null;
      for (let i = 0; i < 8 && el; i++) {
        const text = el.textContent.trim();
        if (text.length > 20 && text.length < 500) best = el;
        el = el.parentElement;
      }
      if (best) containers.add(best);
    }
    const containerArr = Array.from(containers);
    return containerArr
      .filter(c => !containerArr.some(other => other !== c && other.contains(c)))
      .map(c => ({ type: "svg-chart", content: c.textContent.trim() }));
  });

  return { images, sections: [...sections, ...svgData] };
}

// ─── Image download ──────────────────────────────────────────

async function downloadImage(url) {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    const contentType = resp.headers.get("content-type") || "image/png";
    return { base64: buf.toString("base64"), mediaType: contentType.split(";")[0] };
  } catch { return null; }
}

// ─── Validate one ground truth ───────────────────────────────

async function validateOne(browser, anthropic, gt) {
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  try {
    // Step 1: Extract page content
    const { images, sections } = await extractPageContent(page, gt.url);

    // Check rendering
    if (sections.length < gt.minSections) {
      return {
        lab: gt.labName,
        renderOk: false,
        sections: sections.length,
        message: `Only ${sections.length} sections (need ${gt.minSections}). Page did not render.`,
      };
    }

    if (QUICK_MODE) {
      return {
        lab: gt.labName,
        renderOk: true,
        sections: sections.length,
        message: "Render OK (quick mode, LLM skipped)",
      };
    }

    // Step 2: LLM extraction
    const contentImages = filterContentImages(images);
    const textBlock = buildTextBlock(sections);

    // Download and extract from images
    let visionScores = [];
    for (const img of contentImages.slice(0, 5)) {
      const downloaded = await downloadImage(img.src);
      if (!downloaded) continue;
      try {
        const scores = await extractScoresFromImage(anthropic, {
          base64Data: downloaded.base64,
          mediaType: downloaded.mediaType,
          modelName: gt.model,
        });
        visionScores.push(...scores);
      } catch (err) { console.warn(`    Image extraction failed: ${err.message.substring(0, 80)}`); }
    }

    // Extract from text
    let textScores = [];
    if (textBlock.length > 50) {
      try {
        textScores = await extractScoresFromText(anthropic, {
          textContent: textBlock,
          modelName: gt.model,
        });
      } catch (err) { console.warn(`    Text extraction failed: ${err.message.substring(0, 80)}`); }
    }

    const allScores = deduplicateScores(visionScores, textScores);

    // Step 3: Compare against ground truth
    const found = [];
    const missing = [];

    for (const expected of gt.expectedScores) {
      // Match against benchmark name, model_variant, or both combined
      const match = allScores.find(s => {
        const combined = `${s.benchmark} ${s.model_variant || ""}`;
        return (expected.benchmark.test(s.benchmark) || expected.benchmark.test(combined)) &&
               Math.abs(s.score - expected.score) < 0.5;
      });
      if (match) {
        found.push({ expected: expected.score, got: match.score, benchmark: match.benchmark });
      } else {
        missing.push({ score: expected.score, pattern: expected.benchmark.source });
      }
    }

    return {
      lab: gt.labName,
      renderOk: true,
      sections: sections.length,
      totalExtracted: allScores.length,
      found: found.length,
      missing: missing.length,
      missingDetails: missing,
      passed: missing.length === 0,
      message: missing.length === 0
        ? `${found.length}/${gt.expectedScores.length} ground truth scores found (${allScores.length} total)`
        : `${found.length}/${gt.expectedScores.length} found, MISSING: ${missing.map(m => m.pattern + "=" + m.score).join(", ")}`,
    };
  } catch (err) {
    return {
      lab: gt.labName,
      renderOk: false,
      message: `Error: ${err.message.substring(0, 150)}`,
    };
  } finally {
    await context.close();
  }
}

// ─── Main ────────────────────────────────────────────────────

async function main() {
  console.log(`\nExtraction Validation${QUICK_MODE ? " (quick mode)" : ""}\n`);

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  let anthropic = null;

  if (!QUICK_MODE) {
    if (!ANTHROPIC_API_KEY) {
      console.error("Error: ANTHROPIC_API_KEY required for full validation. Use --quick for render-only check.");
      process.exit(1);
    }
    const Anthropic = require("@anthropic-ai/sdk");
    anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const results = [];
  for (const gt of GROUND_TRUTHS) {
    process.stdout.write(`  ${gt.labName}... `);
    const result = await validateOne(browser, anthropic, gt);
    results.push(result);
    console.log(result.message);
  }

  await browser.close();

  const passed = results.filter(r => r.passed !== false && r.renderOk !== false);
  const failed = results.filter(r => r.passed === false || r.renderOk === false);
  console.log(`\n${passed.length}/${results.length} passed.`);

  if (failed.length > 0) {
    console.error(`Failed: ${failed.map(f => f.lab).join(", ")}`);
  }

  // Fail if majority of labs broke (likely a systemic issue like Playwright or API failure).
  // Single-lab failures are warnings, not blockers (the lab's page may have changed).
  if (passed.length < 3) {
    console.error("\nToo many failures — likely a systemic issue. Blocking pipeline.");
    process.exit(1);
  } else if (failed.length > 0) {
    console.warn("\nSome labs failed but majority passed. Pipeline will continue.");
  }
}

main().catch(err => {
  console.error("Validation crashed:", err.message);
  process.exit(1);
});

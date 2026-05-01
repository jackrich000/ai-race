#!/usr/bin/env node
// scripts/validate-extraction.mjs
// End-to-end extraction validation against ground truth data.
//
// Designed to break the "validation passes, production fails" loop by mirroring
// the actual production pipeline conditions:
//   - Same browser launcher as production (Browserbase for `useBrowserbase` sources, local otherwise)
//   - All ground-truth articles per browser kind in ONE session (fresh context per article — matches
//     scripts/extract-model-cards.mjs at line 785). Past validation launched a fresh BROWSER per
//     article, which masked anti-bot session contamination.
//   - Three failure conditions: render < min sections, render OK but 0 scores extracted, or extraction
//     count below `minExpectedScoreCount` (catches under-extraction; LLM hallucination is harder to
//     detect with absolute counts since GT may not list all benchmarks).
//   - Pass 3 fresh-article canary: hit OpenAI's RSS, pick the newest article, render-check via
//     Browserbase. Defends against ground truth URLs going stale.
//
// Usage:
//   node scripts/validate-extraction.mjs          # Full validation
//   node scripts/validate-extraction.mjs --quick   # Page rendering check only (no LLM)

import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { BrowserPool } from "../lib/browser.mjs";

const require = createRequire(import.meta.url);
const { filterContentImages, buildTextBlock, deduplicateScores } = require("../lib/extraction.js");
const { extractScoresFromText, extractScoresFromImage } = require("../lib/llm-extract.js");
const { LAB_SOURCES } = require("../lib/lab-sources.js");

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
// Manually verified scores from lab blog pages. Each entry includes:
//   - expectedScores: a sample of tracked benchmark scores to match precisely
//   - minExpectedScoreCount: the minimum number of scores the LLM should extract
//     from the article overall (catches catastrophic under-extraction even when
//     the GT sample alone matches)

const GROUND_TRUTHS = [
  {
    lab: "anthropic",
    labName: "Anthropic",
    url: "https://www.anthropic.com/news/claude-sonnet-4-6",
    model: "Claude Sonnet 4.6",
    minSections: 20,
    minExpectedScoreCount: 12,  // Memory says 16 ground truth scores; allow some slack
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
    minExpectedScoreCount: 12,  // GT lists 16; E2 actually extracted 32
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
    minExpectedScoreCount: 4,
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
    minExpectedScoreCount: 10,
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
    minExpectedScoreCount: 8,
    expectedScores: [
      { benchmark: /gpqa.?diamond/i, score: 79.9 },
      { benchmark: /humanity.*last.*exam|hle/i, score: 19.8 },
      { benchmark: /mmlu.?pro/i, score: 85.0 },
    ],
  },
];

// Look up the source's `useBrowserbase` flag so validation matches production.
function browserKindForLab(lab) {
  const source = LAB_SOURCES.find(s => s.lab === lab);
  return source?.useBrowserbase === true ? "browserbase" : "local";
}

// ─── Page content extraction (mirrors extract-model-cards.mjs) ──

async function extractPageContent(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(6000);

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

async function downloadImage(url) {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 5000) return null;
    const contentType = resp.headers.get("content-type") || "image/png";
    return { base64: buf.toString("base64"), mediaType: contentType.split(";")[0] };
  } catch { return null; }
}

// ─── Validate one ground truth ───────────────────────────────
// Caller provides the browser; we create a fresh context per article (mirrors production).

async function validateOne(browser, anthropic, gt) {
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  try {
    const { images, sections } = await extractPageContent(page, gt.url);

    if (sections.length < gt.minSections) {
      return {
        lab: gt.labName,
        renderOk: false,
        passed: false,
        sections: sections.length,
        message: `Only ${sections.length} sections (need ${gt.minSections}). Page did not render.`,
      };
    }

    if (QUICK_MODE) {
      return {
        lab: gt.labName,
        renderOk: true,
        passed: true,
        sections: sections.length,
        message: "Render OK (quick mode, LLM skipped)",
      };
    }

    // LLM extraction
    const contentImages = filterContentImages(images);
    const textBlock = buildTextBlock(sections);

    const visionScores = [];
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
      } catch (err) { console.warn(`    Image extraction failed: ${err.message}`); }
    }

    let textScores = [];
    if (textBlock.length > 50) {
      try {
        textScores = await extractScoresFromText(anthropic, {
          textContent: textBlock,
          modelName: gt.model,
        });
      } catch (err) { console.warn(`    Text extraction failed: ${err.message}`); }
    }

    const allScores = deduplicateScores(visionScores, textScores);

    // Failure mode A: render OK but extraction yielded zero scores
    if (allScores.length === 0) {
      return {
        lab: gt.labName,
        renderOk: true,
        passed: false,
        sections: sections.length,
        totalExtracted: 0,
        message: `Page rendered (${sections.length} sections) but extraction yielded ZERO scores. Likely LLM prompt or content-image filter regression.`,
      };
    }

    // Failure mode B: extracted count significantly below expected (catches under-extraction)
    if (gt.minExpectedScoreCount && allScores.length < gt.minExpectedScoreCount) {
      return {
        lab: gt.labName,
        renderOk: true,
        passed: false,
        sections: sections.length,
        totalExtracted: allScores.length,
        message: `Only ${allScores.length} scores extracted (expected ≥${gt.minExpectedScoreCount}). Possible partial render or LLM regression.`,
      };
    }

    // Failure mode C: ground truth sample didn't match
    const found = [];
    const missing = [];
    for (const expected of gt.expectedScores) {
      const match = allScores.find(s => {
        const combined = `${s.benchmark} ${s.model_variant || ""}`;
        return (expected.benchmark.test(s.benchmark) || expected.benchmark.test(combined)) &&
               Math.abs(s.score - expected.score) < 0.5;
      });
      if (match) found.push({ expected: expected.score, got: match.score, benchmark: match.benchmark });
      else missing.push({ score: expected.score, pattern: expected.benchmark.source });
    }

    return {
      lab: gt.labName,
      renderOk: true,
      passed: missing.length === 0,
      sections: sections.length,
      totalExtracted: allScores.length,
      found: found.length,
      missing: missing.length,
      missingDetails: missing,
      message: missing.length === 0
        ? `${found.length}/${gt.expectedScores.length} GT scores found (${allScores.length} total)`
        : `${found.length}/${gt.expectedScores.length} found, MISSING: ${missing.map(m => `${m.pattern}=${m.score}`).join(", ")}`,
    };
  } catch (err) {
    return {
      lab: gt.labName,
      renderOk: false,
      passed: false,
      message: `Error: ${err.message.substring(0, 200)}`,
    };
  } finally {
    try { await context.close(); } catch { /* ignore */ }
  }
}

// ─── Pass 3: fresh-article canary ────────────────────────────
// Defends against ground truths fossilizing. Fetches OpenAI's RSS feed,
// picks the newest article matching the article path pattern, opens it via
// Browserbase, and verifies the page renders.

async function validateFreshCanary(pool) {
  const openaiSource = LAB_SOURCES.find(s => s.lab === "openai");
  if (!openaiSource?.feedUrl || !openaiSource.useBrowserbase) {
    return { name: "fresh-article-canary", skipped: true, message: "OpenAI source missing feedUrl or useBrowserbase" };
  }

  let articles;
  try {
    const resp = await fetch(openaiSource.feedUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ai-race-pipeline/1.0)" },
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) return { name: "fresh-article-canary", passed: false, message: `RSS fetch failed: ${resp.status}` };
    const xml = await resp.text();
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const body = match[1];
      const link = body.match(/<link><!\[CDATA\[(.*?)\]\]><\/link>/)?.[1]
        || body.match(/<link>(.*?)<\/link>/)?.[1] || "";
      if (link) items.push(link.trim());
    }
    articles = items.filter(url => {
      try { return openaiSource.articlePathPattern.test(new URL(url).pathname); }
      catch { return false; }
    });
  } catch (err) {
    return { name: "fresh-article-canary", passed: false, message: `RSS error: ${err.message.substring(0, 150)}` };
  }

  if (articles.length === 0) {
    return { name: "fresh-article-canary", passed: false, message: "No articles found in RSS matching path pattern" };
  }

  const url = articles[0];
  let browser;
  try {
    browser = await pool.getBrowser("browserbase");
  } catch (err) {
    // Browserbase unavailable during validation = soft fail for OpenAI specifically,
    // not a systemic failure that blocks the entire pipeline.
    return { name: "fresh-article-canary", passed: false, soft: true, message: `Browserbase unavailable: ${err.message.substring(0, 150)}` };
  }

  let context;
  try {
    context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 720 },
    });
  } catch (err) {
    return { name: "fresh-article-canary", passed: false, soft: true, message: `Browserbase newContext failed: ${err.message.substring(0, 150)}` };
  }

  const page = await context.newPage();
  try {
    const { sections } = await extractPageContent(page, url);
    const minSections = 30;
    const passed = sections.length >= minSections;
    return {
      name: "fresh-article-canary",
      passed,
      sections: sections.length,
      url,
      message: passed
        ? `Newest OpenAI article rendered (${sections.length} sections): ${url}`
        : `Newest OpenAI article only ${sections.length} sections (<${minSections}). Anti-bot may be tightening or template changed: ${url}`,
    };
  } catch (err) {
    return { name: "fresh-article-canary", passed: false, message: `Render error: ${err.message.substring(0, 200)}` };
  } finally {
    try { await context.close(); } catch { /* ignore */ }
  }
}

// ─── Run a pass for one browser kind ─────────────────────────

async function runPassForKind(pool, anthropic, kind, gts) {
  if (gts.length === 0) return [];
  console.log(`\nPass: ${kind} (${gts.length} ground truth${gts.length === 1 ? "" : "s"})`);

  let browser;
  try {
    browser = await pool.getBrowser(kind);
  } catch (err) {
    // Browserbase unavailable during validation: soft-fail just the BB-flagged GTs.
    console.warn(`  ${kind} unavailable: ${err.message.substring(0, 150)}`);
    return gts.map(gt => ({
      lab: gt.labName,
      renderOk: false,
      passed: false,
      soft: kind === "browserbase",
      message: `${kind} unavailable: ${err.message.substring(0, 150)}`,
    }));
  }

  const results = [];
  for (const gt of gts) {
    process.stdout.write(`  ${gt.labName}... `);
    const result = await validateOne(browser, anthropic, gt);
    results.push(result);
    console.log(result.message);
  }
  return results;
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

  const pool = new BrowserPool();

  // Group ground truths by browser kind.
  const localGts = GROUND_TRUTHS.filter(gt => browserKindForLab(gt.lab) === "local");
  const bbGts = GROUND_TRUTHS.filter(gt => browserKindForLab(gt.lab) === "browserbase");

  let allResults = [];
  try {
    allResults = allResults.concat(await runPassForKind(pool, anthropic, "local", localGts));
    allResults = allResults.concat(await runPassForKind(pool, anthropic, "browserbase", bbGts));

    // Pass 3: fresh-article canary (only if we have a Browserbase-flagged source).
    if (bbGts.length > 0) {
      console.log(`\nPass 3: fresh-article canary`);
      process.stdout.write(`  newest OpenAI article... `);
      const canaryResult = await validateFreshCanary(pool);
      console.log(canaryResult.message);
      allResults.push({ ...canaryResult, lab: "OpenAI (canary)" });
    }
  } finally {
    await pool.closeAll();
  }

  // ─── Tally ──────────────────────────────────────────────────

  const passed = allResults.filter(r => r.passed === true);
  const hardFailed = allResults.filter(r => r.passed === false && !r.soft);
  const softFailed = allResults.filter(r => r.passed === false && r.soft);

  console.log(`\n${passed.length}/${allResults.length} passed.`);

  if (softFailed.length > 0) {
    console.warn(`Soft failures (Browserbase unavailable, will not block pipeline): ${softFailed.map(f => f.lab).join(", ")}`);
  }
  if (hardFailed.length > 0) {
    console.error(`Hard failures: ${hardFailed.map(f => f.lab).join(", ")}`);
  }

  // Block if too many hard failures (likely systemic). Soft failures (Browserbase outage)
  // do NOT block — extraction will skip OpenAI gracefully and other labs ingest.
  // Threshold: passed must be at least half of (hard-checkable) results.
  const hardCheckable = allResults.length - softFailed.length;
  if (hardCheckable > 0 && passed.length < Math.ceil(hardCheckable / 2)) {
    console.error("\nToo many hard failures — likely a systemic issue. Blocking pipeline.");
    process.exit(1);
  } else if (hardFailed.length > 0) {
    console.warn("\nSome hard failures but majority passed. Pipeline will continue.");
  }
}

main().catch(err => {
  console.error("Validation crashed:", err.message);
  process.exit(1);
});

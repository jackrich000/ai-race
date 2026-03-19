// scripts/extract-model-cards.mjs
// Automated model card extraction pipeline.
// Scans lab blog indexes for new model announcements, extracts benchmark scores
// via Stagehand extract() + Claude Vision, stores in benchmark_raw, triages results.
//
// Usage:
//   node scripts/extract-model-cards.mjs              # Full run
//   node scripts/extract-model-cards.mjs --dry-run    # Preview without DB writes
//   node scripts/extract-model-cards.mjs --lab openai  # Single lab only

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env
const envPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.substring(0, eqIdx);
      const val = trimmed.substring(eqIdx + 1);
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

// CJS imports
const { createClient } = require("@supabase/supabase-js");
const { LAB_SOURCES } = require("../lib/lab-sources.js");
const {
  normalizeBenchmarkName, triageScore,
} = require("../lib/pipeline.js");
const { BENCHMARK_META } = require("../lib/config.js");

// ESM imports
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";

// ─── Config ──────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL || "https://jtrhsqdfevyqzzjjvcdr.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const BROWSERBASE_API_KEY = process.env.BROWSERBASE_API_KEY;
const BROWSERBASE_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID;

const DRY_RUN = process.argv.includes("--dry-run");
const LAB_FILTER = (() => {
  const idx = process.argv.indexOf("--lab");
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
})();

if (!DRY_RUN && !SUPABASE_SERVICE_KEY) {
  console.error("Error: Set SUPABASE_SERVICE_KEY (or use --dry-run).");
  process.exit(1);
}
if (!ANTHROPIC_API_KEY) {
  console.error("Error: Set ANTHROPIC_API_KEY.");
  process.exit(1);
}
if (!BROWSERBASE_API_KEY || !BROWSERBASE_PROJECT_ID) {
  console.error("Error: Set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID.");
  process.exit(1);
}

// ─── Zod schema for Stagehand extract() ──────────────────────

const BenchmarkScoresSchema = z.object({
  model_name: z.string().describe("The primary model name from the announcement"),
  scores: z.array(z.object({
    benchmark: z.string().describe("Name of the benchmark"),
    score: z.number().describe("The score as a number (percentage, 0-100)"),
    model_variant: z.string().optional().describe("Specific model variant if multiple are compared"),
    notes: z.string().optional().describe("Any qualifiers like 'with tools', 'pass@1', etc."),
  })).describe("All benchmark scores mentioned on the page"),
});

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Classify articles on a blog index page as model release announcements.
 * Uses Haiku for cheap, fast classification.
 */
async function classifyArticles(anthropic, articles) {
  if (articles.length === 0) return [];

  const prompt = `You are classifying blog post titles. For each title, decide if it is likely a NEW AI MODEL RELEASE announcement (where a lab announces a new model with benchmark scores).

Respond with JSON: {"results": [{"index": 0, "is_model_release": true/false, "model_name": "..." or null}]}

Titles:
${articles.map((a, i) => `${i}. "${a.title}" (${a.url})`).join("\n")}`;

  const resp = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });

  const text = resp.content.filter(b => b.type === "text").map(b => b.text).join("");
  const cleaned = text.replace(/^```json\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  try {
    return JSON.parse(cleaned).results || [];
  } catch {
    console.warn("   Failed to parse article classification response");
    return [];
  }
}

/**
 * Extract benchmark scores from a single article page using both
 * Stagehand extract() and Claude Vision on viewport screenshots.
 */
async function extractScoresFromArticle(stagehand, anthropic, url, modelName) {
  const page = stagehand.context.activePage();

  // Navigate
  await page.goto(url, { waitUntil: "load", timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  const allScores = [];

  // Method 1: Stagehand extract()
  try {
    const extracted = await stagehand.extract(
      `Extract benchmark scores for "${modelName}" ONLY. Rules:
- ONLY extract scores for "${modelName}". Ignore scores for any other model (older versions, competitors, etc.).
- ONLY extract scores that are explicitly stated as numbers in text or tables.
- Do NOT estimate or infer scores from charts, graphs, or bar heights.
- Prefer scores from the main model card summary table over footnotes or body text.
- If a footnote shows a different score than the main table for the same benchmark, use the main table value.
- Skip any benchmark where you cannot find an explicit numeric score.
- Include the exact model variant (e.g. "with tools", "without tools") if specified.`,
      BenchmarkScoresSchema,
    );
    if (extracted?.scores) {
      for (const s of extracted.scores) {
        if (s.score > 0) {
          allScores.push({
            model_name: s.model_variant || extracted.model_name || "Unknown",
            benchmark: s.benchmark,
            score: s.score,
            notes: s.notes || "",
            method: "extract",
          });
        }
      }
    }
    console.log(`     extract(): ${allScores.length} scores`);
  } catch (err) {
    console.warn(`     extract() failed: ${err.message.substring(0, 100)}`);
  }

  // Method 2: Vision on targeted screenshots of tables, charts, and figures
  let visionCount = 0;

  // Find all visual score containers on the page
  const elements = await page.evaluate(() => {
    const results = [];
    const selectors = [
      "table",
      "figure",
      "[role='table']",
      "[role='figure']",
      "[class*='chart']",
      "[class*='benchmark']",
      "[class*='score']",
      "[class*='comparison']",
      "[class*='table']",
      "[class*='leaderboard']",
    ];

    const seen = new Set();
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        const rect = el.getBoundingClientRect();
        // Skip tiny elements, off-screen, or duplicates
        if (rect.width < 200 || rect.height < 100) continue;
        const key = `${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)},${Math.round(rect.height)}`;
        if (seen.has(key)) continue;

        // Skip if this element is inside an already-captured parent
        let isChild = false;
        for (const existing of seen) {
          const [ex, ey, ew, eh] = existing.split(",").map(Number);
          if (rect.x >= ex && rect.y >= ey &&
              rect.x + rect.width <= ex + ew &&
              rect.y + rect.height <= ey + eh) {
            isChild = true;
            break;
          }
        }
        if (isChild) continue;

        seen.add(key);
        results.push({
          x: Math.max(0, rect.x + window.scrollX),
          y: Math.max(0, rect.y + window.scrollY),
          width: Math.ceil(rect.width),
          height: Math.ceil(rect.height),
          tag: el.tagName.toLowerCase(),
          className: (el.className || "").toString().substring(0, 100),
        });
      }
    }
    return results;
  });

  console.log(`     Found ${elements.length} visual elements (tables/charts/figures)`);

  // Fall back to viewport scrolling if no elements found
  if (elements.length === 0) {
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    const totalHeight = await page.evaluate(() => document.body.scrollHeight);
    const numScreenshots = Math.min(Math.ceil(totalHeight / viewportHeight), 10);
    for (let i = 0; i < numScreenshots; i++) {
      elements.push({
        x: 0,
        y: i * viewportHeight,
        width: await page.evaluate(() => window.innerWidth),
        height: viewportHeight,
        tag: "viewport",
        className: `fallback-${i}`,
      });
    }
    console.log(`     Falling back to ${numScreenshots} viewport screenshots`);
  }

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const viewportHeight = await page.evaluate(() => window.innerHeight);

    // For tall elements, take multiple viewport screenshots to cover the full element
    const numShots = Math.min(Math.ceil(el.height / viewportHeight), 3);

    for (let shot = 0; shot < numShots; shot++) {
    const scrollY = Math.max(0, el.y - 20 + shot * viewportHeight);
    await page.evaluate((y) => window.scrollTo(0, y), scrollY);
    await new Promise(r => setTimeout(r, 300));

    const ssBuffer = await page.screenshot();
    const ssBase64 = Buffer.from(ssBuffer).toString("base64");

    try {
      const resp = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: "You extract benchmark scores from images. Always respond with valid JSON only. No explanations.",
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: ssBase64 } },
            {
              type: "text",
              text: `Extract benchmark scores for "${modelName}" from this image.

RULES:
- If this is a comparison table: find the "${modelName}" column header, then read every score in that column. Use the row label (left side) as benchmark name. Prefer subtitles (e.g. "SWE-bench Verified") over main labels.
- If this is a chart: only extract scores with explicit numeric data labels. Do NOT estimate from bar heights.
- ONLY scores for "${modelName}". Double-check the column.
- Report exact numbers as written. Do not round.
- If variants exist (e.g. "with tools" / "without tools"), extract both.

Respond with ONLY this JSON format, nothing else:
{"scores": [{"benchmark": "...", "score": <number>, "notes": "..."}]}`,
            },
          ],
        }],
      });

      const text = resp.content.filter(b => b.type === "text").map(b => b.text).join("");
      let cleaned = text.replace(/^```json\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
      // If response contains prose around JSON, try to extract the JSON object
      if (!cleaned.startsWith("{")) {
        const jsonMatch = cleaned.match(/\{[\s\S]*"scores"[\s\S]*\}/);
        if (jsonMatch) cleaned = jsonMatch[0];
      }
      const parsed = JSON.parse(cleaned);
      if (parsed.scores) {
        for (const s of parsed.scores) {
          if (s.score > 0) {
            allScores.push({
              model_name: s.model_name || "Unknown",
              benchmark: s.benchmark,
              score: s.score,
              notes: s.notes || "",
              method: "vision",
            });
            visionCount++;
          }
        }
        if (parsed.scores.length > 0) {
          console.log(`     element ${i + 1}/${shot + 1} (${el.tag}): ${parsed.scores.filter(s => s.score > 0).length} scores`);
        }
      }
    } catch (err) {
      console.warn(`     element ${i + 1}/${shot + 1} vision error: ${err.message.substring(0, 150)}`);
    }
    } // end shot loop
  } // end element loop
  console.log(`     vision total: ${visionCount} scores from ${elements.length} elements`);

  // Deduplicate on (benchmark, model, score) - keep first occurrence
  const seen = new Set();
  const deduped = [];
  for (const s of allScores) {
    const key = `${s.benchmark.toLowerCase()}|${s.model_name.toLowerCase()}|${s.score}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(s);
    }
  }
  console.log(`     ${deduped.length} unique scores after dedup (from ${allScores.length} raw)`);

  return deduped;
}

/**
 * Scan a blog index page for article links.
 * Uses DOM extraction (reliable for href values), falls back to Stagehand.
 */
async function scanBlogIndex(stagehand, anthropic, source) {
  const page = stagehand.context.activePage();

  console.log(`   Scanning ${source.name} (${source.indexUrl})...`);
  await page.goto(source.indexUrl, { waitUntil: "load", timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  // Primary: DOM-based extraction (reliable for actual href values)
  let articles = [];
  try {
    articles = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a[href]"));
      const seen = new Set();
      const results = [];

      for (const link of links) {
        const href = link.href;

        // Filter: must be a path-like URL, not already seen
        if (!href || seen.has(href)) continue;
        const path = new URL(href).pathname;
        if (path === "/" || path.split("/").length < 3) continue;
        if (/\.(png|jpg|svg|css|js|xml|pdf)$/i.test(path)) continue;

        // Extract a clean title: prefer heading elements, fall back to first line of text
        const heading = link.querySelector("h1, h2, h3, h4, h5, h6, [class*='title'], [class*='heading']");
        let title = heading
          ? heading.textContent.trim()
          : (link.textContent || "").trim().split("\n")[0].trim();
        title = title.replace(/\s+/g, " ");

        if (title.length < 5 || title.length > 200) continue;

        seen.add(href);
        results.push({ title: title.substring(0, 150), url: href });
      }

      return results;
    });

    // Filter: same domain only, and likely blog post paths (not product/nav pages)
    const sourceHost = new URL(source.indexUrl).hostname;
    articles = articles.filter(a => {
      try {
        const url = new URL(a.url);
        if (url.hostname !== sourceHost) return false;
        // Typical blog patterns: /news/slug, /index/slug, /blog/slug, /research/slug
        return /\/(news|index|blog|research|updates|announcements)\/.+/.test(url.pathname);
      } catch { return false; }
    });

    console.log(`   Found ${articles.length} article links via DOM`);
  } catch (err) {
    console.warn(`   DOM extraction failed: ${err.message.substring(0, 100)}`);
  }

  // Fallback: Stagehand extract if DOM found nothing
  if (articles.length === 0) {
    try {
      const ArticlesSchema = z.object({
        articles: z.array(z.object({
          title: z.string().describe("Article title"),
          url: z.string().describe("Full URL to the article"),
        })).describe("Blog post articles visible on this page"),
      });

      const result = await stagehand.extract(
        "Extract all blog post article titles and their full URLs (href) from this page.",
        ArticlesSchema,
      );
      articles = (result?.articles || [])
        .filter(a => a.url && a.url.startsWith("http"))
        .map(a => ({ title: a.title, url: a.url }));
      console.log(`   Found ${articles.length} articles via Stagehand fallback`);
    } catch (err) {
      console.warn(`   Stagehand fallback failed: ${err.message.substring(0, 100)}`);
    }
  }

  return articles;
}

// ─── Main pipeline ───────────────────────────────────────────

async function main() {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Model Card Extraction Pipeline`);
  console.log(`  ${DRY_RUN ? "DRY RUN (no DB writes)" : "LIVE RUN"}`);
  if (LAB_FILTER) console.log(`  Lab filter: ${LAB_FILTER}`);
  console.log(`${"═".repeat(60)}\n`);

  const supabase = DRY_RUN ? null : createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  // Get last extraction date from DB
  let lastExtractionDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default: 30 days ago
  if (supabase) {
    const { data } = await supabase
      .from("benchmark_raw")
      .select("extracted_at")
      .eq("source", "model_card_auto")
      .order("extracted_at", { ascending: false })
      .limit(1);
    if (data?.[0]?.extracted_at) {
      lastExtractionDate = new Date(data[0].extracted_at);
    }
  }
  console.log(`Last extraction: ${lastExtractionDate.toISOString().split("T")[0]}`);

  // Get existing processed URLs for idempotency
  const processedUrls = new Set();
  if (supabase) {
    const { data } = await supabase
      .from("benchmark_raw")
      .select("source_url")
      .eq("source", "model_card_auto")
      .not("source_url", "is", null);
    if (data) {
      for (const row of data) processedUrls.add(row.source_url);
    }
  }
  console.log(`Already processed: ${processedUrls.size} article URLs\n`);

  // Initialize Browserbase
  console.log("Connecting to Browserbase...");
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    apiKey: BROWSERBASE_API_KEY,
    projectId: BROWSERBASE_PROJECT_ID,
    model: {
      modelName: "anthropic/claude-sonnet-4-5",
      apiKey: ANTHROPIC_API_KEY,
    },
  });
  await stagehand.init();
  console.log("Connected.\n");

  // Filter sources
  const sources = LAB_FILTER
    ? LAB_SOURCES.filter(s => s.lab === LAB_FILTER || s.name.toLowerCase() === LAB_FILTER)
    : LAB_SOURCES;

  // Get current best scores per benchmark+lab for triage
  const currentBest = {};
  if (supabase) {
    const { data } = await supabase
      .from("benchmark_scores")
      .select("benchmark, lab, score")
      .not("score", "is", null);
    if (data) {
      for (const row of data) {
        const key = `${row.benchmark}|${row.lab}`;
        if (!currentBest[key] || row.score > currentBest[key]) {
          currentBest[key] = row.score;
        }
      }
    }
  }

  // ─── Step 1: Scan blog indexes and find new articles ───────

  console.log("Step 1: Scanning blog indexes...\n");
  const newArticles = []; // { source, title, url, modelName }
  const allExtracted = []; // { article, scores[] }

  try {
    for (const source of sources) {
      const articles = await scanBlogIndex(stagehand, anthropic, source);

      if (articles.length === 0) continue;

      // Classify which are model release announcements
      const classifications = await classifyArticles(anthropic, articles);

      for (const cls of classifications) {
        if (!cls.is_model_release) continue;
        const article = articles[cls.index];
        if (!article) continue;

        // Skip already-processed URLs
        if (processedUrls.has(article.url)) {
          console.log(`   Skipping (already processed): ${article.title}`);
          continue;
        }

        newArticles.push({
          source,
          title: article.title,
          url: article.url,
          modelName: cls.model_name || article.title,
        });
        console.log(`   NEW: "${article.title}" -> ${cls.model_name || "unknown model"}`);
      }
    }

    console.log(`\nFound ${newArticles.length} new model release articles.\n`);

    if (newArticles.length === 0) {
      console.log("No new articles to process. Done.");
      return;
    }

    // ─── Step 2: Extract scores from new articles ──────────────

    console.log("Step 2: Extracting scores from articles...\n");

    for (const article of newArticles) {
      console.log(`   Processing: "${article.title}" (${article.url})`);
      const scores = await extractScoresFromArticle(stagehand, anthropic, article.url, article.modelName);
      allExtracted.push({ article, scores });
    }
  } finally {
    await stagehand.close();
    console.log("\nBrowser closed.\n");
  }

  // ─── Step 3: Store ALL scores in benchmark_raw ─────────────

  console.log("Step 3: Storing raw scores...\n");
  const rawRows = [];
  const trackedForTriage = [];

  for (const { article, scores } of allExtracted) {
    for (const s of scores) {
      const normalized = normalizeBenchmarkName(s.benchmark);
      const lab = article.source.lab;

      const row = {
        benchmark: normalized.key || s.benchmark.toLowerCase().replace(/\s+/g, "-"),
        lab,
        model: s.model_name,
        score: Math.round(s.score * 10) / 10,
        date: new Date().toISOString().split("T")[0],
        source: "model_card_auto",
        verified: false,
        source_url: article.url,
        raw_benchmark_name: s.benchmark,
        extracted_at: new Date().toISOString(),
      };

      rawRows.push(row);

      // Track for triage if it's a tracked benchmark
      if (normalized.key && BENCHMARK_META[normalized.key]) {
        const bestKey = `${normalized.key}|${lab}`;
        trackedForTriage.push({
          ...row,
          confidence: normalized.confidence,
          currentBest: currentBest[bestKey] || null,
          notes: s.notes,
        });
      }
    }
  }

  console.log(`   ${rawRows.length} total scores extracted`);
  console.log(`   ${trackedForTriage.length} match tracked benchmarks\n`);

  if (!DRY_RUN && supabase && rawRows.length > 0) {
    const { error } = await supabase
      .from("benchmark_raw")
      .upsert(rawRows, { onConflict: "benchmark,lab,model,source" });
    if (error) {
      console.error("   benchmark_raw upsert FAILED:", error.message);
    } else {
      console.log(`   Stored ${rawRows.length} rows in benchmark_raw.`);
    }
  }

  // ─── Step 4: Triage tracked benchmarks ─────────────────────

  console.log("Step 4: Triaging tracked scores...\n");
  const ingested = [];
  const flagged = [];
  const rejected = [];

  for (const entry of trackedForTriage) {
    const result = triageScore(
      entry.score,
      entry.currentBest,
      entry.benchmark,
      entry.confidence,
      entry.notes
    );

    const summary = `${entry.model} on ${entry.benchmark}: ${entry.score} (${result.action}: ${result.reason})`;

    if (result.action === "ingest") {
      ingested.push({ ...entry, triageResult: result });
      console.log(`   INGEST: ${summary}`);
    } else if (result.action === "review") {
      flagged.push({ ...entry, triageResult: result });
      console.log(`   FLAG:   ${summary}`);
    } else {
      rejected.push({ ...entry, triageResult: result });
      console.log(`   REJECT: ${summary}`);
    }
  }

  // Create GitHub Issues for flagged scores (if not dry-run)
  if (!DRY_RUN && flagged.length > 0) {
    console.log(`\n   Creating ${flagged.length} GitHub Issues for flagged scores...`);
    for (const entry of flagged) {
      const title = `[Auto] Review: ${entry.model} ${entry.benchmark} = ${entry.score}`;
      const body = [
        `**Model**: ${entry.model}`,
        `**Benchmark**: ${entry.benchmark} (${entry.raw_benchmark_name})`,
        `**Score**: ${entry.score}`,
        `**Current best**: ${entry.currentBest || "none"}`,
        `**Source**: ${entry.source_url}`,
        `**Reason**: ${entry.triageResult.reason}`,
        `**Confidence**: ${entry.confidence}`,
        "",
        "Extracted automatically by the model card pipeline.",
      ].join("\n");

      try {
        const { execFileSync } = await import("child_process");
        execFileSync("gh", ["issue", "create", "--title", title, "--body", body, "--label", "auto-triage"], {
          cwd: path.resolve(__dirname, ".."),
          stdio: "pipe",
        });
        console.log(`   Created issue: ${title}`);
      } catch (err) {
        console.warn(`   Failed to create issue: ${err.message.substring(0, 100)}`);
      }
    }
  }

  // ─── Step 5: Summary ───────────────────────────────────────

  console.log(`\n${"═".repeat(60)}`);
  console.log("  Summary");
  console.log(`${"═".repeat(60)}`);
  console.log(`  Articles scanned:  ${newArticles.length}`);
  console.log(`  Total scores:      ${rawRows.length}`);
  console.log(`  Tracked scores:    ${trackedForTriage.length}`);
  console.log(`  Auto-ingested:     ${ingested.length}`);
  console.log(`  Flagged for review: ${flagged.length}`);
  console.log(`  Auto-rejected:     ${rejected.length}`);
  if (DRY_RUN) {
    console.log("\n  DRY RUN: No data was written to Supabase.");
  }
  console.log("");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});

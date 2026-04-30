// scripts/extract-model-cards.mjs
// Production model card extraction pipeline.
// Scans lab blog indexes for new model announcements, extracts benchmark scores
// via Playwright DOM + image download + Claude Vision/Text, stores in benchmark_raw.
//
// Browser backend is per-lab: sources with `useBrowserbase: true` in lab-sources.js
// use Browserbase (cloud browser, residential IPs — bypasses anti-bot like OpenAI's).
// All other sources use local headless Playwright.
//
// Usage:
//   node scripts/extract-model-cards.mjs                         # Full run
//   node scripts/extract-model-cards.mjs --dry-run               # Preview without DB writes
//   node scripts/extract-model-cards.mjs --lab anthropic         # Single lab only
//   node scripts/extract-model-cards.mjs --force                 # Re-extract already-processed URLs
//   node scripts/extract-model-cards.mjs --url <url> --model <name> --lab <name>  # Single article
//   node scripts/extract-model-cards.mjs --local                 # Force local Playwright for ALL sources (debug)

import fs from "fs";
import os from "os";
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
const { normalizeBenchmarkName, triageScore, crossCheckScores } = require("../lib/extraction.js");
const { BENCHMARK_META } = require("../lib/config.js");
const {
  extractRawImageUrl, filterContentImages, buildTextBlock,
  deduplicateScores, parsePublishDate,
} = require("../lib/extraction.js");
const {
  extractScoresFromImage, extractScoresFromText, classifyArticles,
  reviewVariants,
} = require("../lib/llm-extract.js");

// ESM imports
import Anthropic from "@anthropic-ai/sdk";
import { BrowserPool } from "../lib/browser.mjs";

// ─── Config ──────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL || "https://jtrhsqdfevyqzzjjvcdr.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// CLI flags
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
const LOCAL_BROWSER = process.argv.includes("--local");
const NO_REPORT = process.argv.includes("--no-report");

const LAB_FILTER = (() => {
  const idx = process.argv.indexOf("--lab");
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1].toLowerCase() : null;
})();

const SINGLE_URL = (() => {
  const idx = process.argv.indexOf("--url");
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
})();

const SINGLE_MODEL = (() => {
  const idx = process.argv.indexOf("--model");
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

// ─── Browser setup ───────────────────────────────────────────

// Browser launching lives in lib/browser.mjs. Per-lab dispatch happens via the
// BrowserPool below. Each article looks up its source's `useBrowserbase` flag
// and pulls a browser of the right kind from the pool.

/**
 * Pick the BrowserPool kind for a source.
 * `--local` CLI flag overrides everything (debug escape hatch).
 */
function browserKindFor(source) {
  if (LOCAL_BROWSER) return "local";
  return source && source.useBrowserbase === true ? "browserbase" : "local";
}

// ─── Marker files ────────────────────────────────────────────
// Inter-process signals to scripts/run-pipeline.mjs:
//   .extraction-started.json    written immediately on start
//   .extraction-complete.json   written on clean exit (missing → subprocess crashed)
//   .browserbase-skip.json      written if Browserbase was unavailable for any article
//
// All live in os.tmpdir(); the orchestrator reads them after the subprocess returns
// and unlinks them (with safety unlinks at start of every run too).

const MARKER_DIR = os.tmpdir();
const MARKER_STARTED = path.join(MARKER_DIR, "ai-race-extraction-started.json");
const MARKER_COMPLETE = path.join(MARKER_DIR, "ai-race-extraction-complete.json");
const MARKER_BB_SKIP = path.join(MARKER_DIR, "ai-race-browserbase-skip.json");

function writeMarker(filePath, payload) {
  try {
    fs.writeFileSync(filePath, JSON.stringify({ ...payload, ts: new Date().toISOString() }, null, 2));
  } catch (err) {
    console.warn(`   Warning: could not write marker ${filePath}: ${err.message}`);
  }
}

function unlinkMarker(filePath) {
  try { fs.unlinkSync(filePath); } catch { /* not present, fine */ }
}

// ─── RSS/Feed-based discovery ────────────────────────────────

/**
 * Discover articles from an RSS/Atom feed via server-side HTTP (no browser).
 * Avoids triggering anti-bot protections that fire on browser-based blog index visits.
 * Returns same { title, url } shape as scanBlogIndex().
 */
async function discoverViaFeed(source) {
  console.log(`   Fetching feed ${source.name} (${source.feedUrl})...`);
  const resp = await fetch(source.feedUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ai-race-pipeline/1.0)" },
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) {
    console.warn(`   Feed fetch failed: ${resp.status}`);
    return [];
  }
  const xml = await resp.text();

  // Parse RSS <item> entries — extract <title> and <link>
  const articles = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const title = itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1]
      || itemXml.match(/<title>(.*?)<\/title>/)?.[1]
      || "";
    const link = itemXml.match(/<link><!\[CDATA\[(.*?)\]\]><\/link>/)?.[1]
      || itemXml.match(/<link>(.*?)<\/link>/)?.[1]
      || "";
    if (title && link) {
      articles.push({ title: title.trim(), url: link.trim() });
    }
  }

  // Filter by articlePathPattern if set
  const filtered = source.articlePathPattern
    ? articles.filter(a => {
        try { return source.articlePathPattern.test(new URL(a.url).pathname); }
        catch { return false; }
      })
    : articles;

  // RSS feeds are newest-first; cap to a reasonable batch for LLM classification
  const MAX_FEED_ARTICLES = 20;
  const capped = filtered.slice(0, MAX_FEED_ARTICLES);

  console.log(`   Found ${filtered.length} articles via feed (showing newest ${capped.length})`);
  if (source.minExpectedArticles && filtered.length < source.minExpectedArticles) {
    console.warn(`   WARNING: Found ${filtered.length} articles, expected at least ${source.minExpectedArticles}.`);
  }
  return capped;
}

// ─── Blog index scanning ─────────────────────────────────────

/**
 * Scan a blog index page for article links via DOM extraction.
 */
async function scanBlogIndex(page, source) {
  console.log(`   Scanning ${source.name} (${source.indexUrl})...`);
  await page.goto(source.indexUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  // Wait for JS frameworks (React, Next.js) to hydrate — matches extractPageContent() timing
  await page.waitForTimeout(6000);

  let articles = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll("a[href]"));
    const seen = new Set();
    const results = [];

    for (const link of links) {
      const href = link.href;
      if (!href || seen.has(href)) continue;

      const urlPath = new URL(href).pathname;
      if (urlPath === "/" || urlPath.split("/").length < 3) continue;
      if (/\.(png|jpg|svg|css|js|xml|pdf)$/i.test(urlPath)) continue;

      // Extract title: prefer heading elements, fall back to first text line
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

  // Filter: same domain only, matching article path pattern for this source
  const sourceHost = new URL(source.indexUrl).hostname;
  articles = articles.filter(a => {
    try {
      const url = new URL(a.url);
      if (url.hostname !== sourceHost) return false;
      if (source.articlePathPattern) return source.articlePathPattern.test(url.pathname);
      // Fallback: common blog path patterns
      return /\/(news|index|blog|research|updates|announcements|discover)\/.+/.test(url.pathname);
    } catch { return false; }
  });

  console.log(`   Found ${articles.length} article links via DOM`);
  if (source.minExpectedArticles && articles.length < source.minExpectedArticles) {
    console.warn(`   WARNING: Found ${articles.length} articles, expected at least ${source.minExpectedArticles}. Site structure may have changed.`);
  }
  return articles;
}

// ─── Qwen card-based scanning ────────────────────────────────

/**
 * Scan qwen.ai/research for article cards (CSR SPA with div-based navigation).
 * Cards have id="latestAdvancement_blog_id_<slug>" which maps to /blog?id=<slug>.
 */
async function scanQwenCards(page, source) {
  console.log(`   Scanning ${source.name} (${source.indexUrl})...`);
  await page.goto(source.indexUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  // Qwen uses heavy CSR (ICE framework) — wait for cards to render
  await page.waitForSelector('[id^="latestAdvancement_blog_id_"]', { timeout: 15000 })
    .catch(() => console.warn(`   Qwen cards did not appear within 15s, proceeding anyway`));

  const articles = await page.evaluate(() => {
    const results = [];
    // Cards have stable id format: latestAdvancement_blog_id_<slug>
    const cards = document.querySelectorAll('[id^="latestAdvancement_blog_id_"]');
    for (const card of cards) {
      const slug = card.id.replace("latestAdvancement_blog_id_", "");
      if (!slug) continue;

      const titleEl = card.querySelector('[class*="Title"]');
      const title = titleEl ? titleEl.textContent.trim() : "";
      if (!title || title.length < 5) continue;

      results.push({
        title,
        url: `https://qwen.ai/blog?id=${slug}`,
      });
    }
    return results;
  });

  console.log(`   Found ${articles.length} article cards via DOM`);
  if (source.minExpectedArticles && articles.length < source.minExpectedArticles) {
    console.warn(`   WARNING: Found ${articles.length} articles, expected at least ${source.minExpectedArticles}. Site structure may have changed.`);
  }
  return articles;
}

// ─── Page content extraction ─────────────────────────────────

/**
 * Extract all content from an article page: images, text sections, SVG data, publish date.
 */
async function extractPageContent(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

  // Wait for JS frameworks (React, Next.js) to hydrate.
  // SPAs need more time than static sites; 6s covers OpenAI (Next.js) and xAI (React).
  await page.waitForTimeout(6000);

  // Scroll to bottom to trigger lazy loading
  await page.evaluate(async () => {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const totalHeight = document.body.scrollHeight;
    const step = window.innerHeight;
    for (let y = 0; y < totalHeight; y += step) {
      window.scrollTo(0, y);
      await delay(200);
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1000);

  // Extract publish date from DOM
  const dateString = await page.evaluate(() => {
    // Method 1: <meta> tags (most reliable, invisible to user)
    const metaSelectors = [
      "meta[property='article:published_time']",
      "meta[property='og:published_time']",
      "meta[name='date']",
      "meta[name='publish-date']",
    ];
    for (const sel of metaSelectors) {
      const el = document.querySelector(sel);
      if (el && el.getAttribute("content")) return el.getAttribute("content");
    }

    // Method 2: JSON-LD structured data
    const jsonLd = document.querySelector('script[type="application/ld+json"]');
    if (jsonLd) {
      try {
        const data = JSON.parse(jsonLd.textContent);
        const datePublished = data.datePublished || (Array.isArray(data) && data[0]?.datePublished);
        if (datePublished) return datePublished;
      } catch { /* ignore */ }
    }

    // Method 3: <time> elements
    const timeEl = document.querySelector("time[datetime]");
    if (timeEl) return timeEl.getAttribute("datetime");

    // Method 4: Visible date elements
    const dateSelectors = [
      "[class*='date']",
      "[class*='publish']",
      "[class*='posted']",
      "[class*='byline']",
    ];
    for (const sel of dateSelectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const text = el.textContent.trim();
      // Must look like a date (contains a year)
      if (text && text.length < 50 && /20\d{2}/.test(text)) return text;
    }

    return null;
  });

  // Extract images
  const images = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("img")).map(img => ({
      src: img.src || img.getAttribute("data-src") || "",
      width: img.naturalWidth || img.width || 0,
      height: img.naturalHeight || img.height || 0,
      alt: img.alt || "",
    }));
  });

  // Extract text sections with structure
  const sections = await page.evaluate(() => {
    const results = [];
    // Prefer semantic elements (main, article) over class-based matches
    const mainContent = document.querySelector("main") || document.querySelector("article") || document.querySelector("[class*='content']") || document.querySelector("[class*='post']") || document.body;

    // Walk through direct children for structure
    const walker = document.createTreeWalker(mainContent, NodeFilter.SHOW_ELEMENT, null);
    let node = walker.nextNode();

    while (node) {
      const tag = node.tagName.toLowerCase();

      if (/^h[1-6]$/.test(tag)) {
        results.push({ type: "heading", content: node.textContent.trim() });
      } else if (tag === "table") {
        // Extract table as text grid
        const rows = Array.from(node.querySelectorAll("tr")).map(row =>
          Array.from(row.querySelectorAll("th, td")).map(cell => cell.textContent.trim()).join(" | ")
        );
        results.push({ type: "table", content: rows.join("\n") });
      } else if (tag === "ul" || tag === "ol") {
        const items = Array.from(node.querySelectorAll("li")).map(li => `- ${li.textContent.trim()}`);
        results.push({ type: "list", content: items.join("\n") });
      } else if (tag === "p" || tag === "div") {
        const text = node.textContent.trim();
        // Only include text blocks with meaningful content (skip tiny/empty)
        if (text.length > 20 && !node.querySelector("h1, h2, h3, h4, h5, h6, table, ul, ol")) {
          results.push({ type: "paragraph", content: text });
        }
      }

      node = walker.nextNode();
    }

    return results;
  });

  // Extract SVG chart data by finding containers that hold SVGs with text.
  // Charts often split data across sibling SVGs (model names in one, scores in another,
  // title in a parent div), so we extract the full container text to keep context together.
  const svgData = await page.evaluate(() => {
    const svgs = document.querySelectorAll("svg");
    const svgsWithText = Array.from(svgs).filter(svg =>
      Array.from(svg.querySelectorAll("text")).some(t => t.textContent.trim())
    );
    if (svgsWithText.length === 0) return [];

    // For each SVG with text, walk up to find a container with chart context
    const containers = new Set();
    for (const svg of svgsWithText) {
      let el = svg.parentElement;
      let best = null;
      for (let i = 0; i < 8 && el; i++) {
        const text = el.textContent.trim();
        // Look for a container that has meaningful content but isn't the whole page
        if (text.length > 20 && text.length < 500) {
          best = el;
        }
        el = el.parentElement;
      }
      if (best) containers.add(best);
    }

    // Deduplicate: if one container is a parent of another, keep only the parent
    const containerArr = Array.from(containers);
    const results = [];
    for (const c of containerArr) {
      const isChild = containerArr.some(other => other !== c && other.contains(c));
      if (!isChild) {
        results.push({ type: "svg-chart", content: c.textContent.trim() });
      }
    }
    return results;
  });

  return {
    publishDate: parsePublishDate(dateString),
    images,
    sections: [...sections, ...svgData],
    dateString,
  };
}

// ─── Image download ──────────────────────────────────────────

/**
 * Download an image from a URL and return as base64.
 * Uses Node.js fetch (not browser) to bypass CORS.
 */
async function downloadImage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    clearTimeout(timeout);

    if (!resp.ok) return null;

    const contentType = resp.headers.get("content-type") || "image/png";
    const buffer = Buffer.from(await resp.arrayBuffer());

    // Skip very small images (likely not benchmark tables)
    if (buffer.length < 5000) return null;

    return {
      base64Data: buffer.toString("base64"),
      mediaType: contentType.split(";")[0].trim(),
    };
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

// ─── Score extraction from article ───────────────────────────

/**
 * Extract all benchmark scores from a single article.
 * Downloads images in parallel, runs vision + text extraction concurrently.
 */
async function extractFromArticle(page, anthropic, url, modelName, cutoffDate = null) {
  console.log(`\n   Extracting: "${modelName}" from ${url}`);

  // Step 1: Extract page content
  const { publishDate, images, sections, dateString } = await extractPageContent(page, url);
  console.log(`     Publish date: ${publishDate ? publishDate.toISOString().split("T")[0] : `not found (raw: ${dateString})`}`);

  // Date filtering: skip LLM extraction for articles older than cutoff
  if (cutoffDate && publishDate && publishDate < cutoffDate) {
    const pubStr = publishDate.toISOString().split("T")[0];
    const cutStr = cutoffDate.toISOString().split("T")[0];
    console.log(`     Skipping (published ${pubStr}, before cutoff ${cutStr})`);
    return { scores: [], publishDate, skippedOld: true };
  }
  if (cutoffDate && !publishDate) {
    console.log(`     Date not parseable, processing anyway (fail open)`);
  }

  console.log(`     Found ${images.length} images, ${sections.length} text sections`);

  // Step 2: Filter and download content images
  const contentImages = filterContentImages(images);
  console.log(`     ${contentImages.length} content images after filtering`);

  // Resolve raw CDN URLs and download in parallel
  const imageUrls = contentImages.map(img => extractRawImageUrl(img.src)).filter(Boolean);
  const uniqueUrls = [...new Set(imageUrls)];

  const downloadResults = await Promise.all(
    uniqueUrls.map(async (imgUrl) => {
      const result = await downloadImage(imgUrl);
      if (result) return { url: imgUrl, ...result };
      return null;
    })
  );
  const downloadedImages = downloadResults.filter(Boolean);
  console.log(`     Downloaded ${downloadedImages.length}/${uniqueUrls.length} images`);

  // Step 3: Build text block
  const textBlock = buildTextBlock(sections);

  // Step 4: Run LLM calls (vision on each image + text extraction)
  // Cap vision concurrency to avoid rate limits on pages with many images
  const MAX_CONCURRENT_VISION = 5;
  const visionScores = [];
  for (let i = 0; i < downloadedImages.length; i += MAX_CONCURRENT_VISION) {
    const batch = downloadedImages.slice(i, i + MAX_CONCURRENT_VISION);
    const batchResults = await Promise.all(
      batch.map(img =>
        extractScoresFromImage(anthropic, {
          base64Data: img.base64Data,
          mediaType: img.mediaType,
          modelName,
        }).catch(err => {
          console.warn(`     Vision error on ${img.url.substring(0, 80)}: ${err.message.substring(0, 100)}`);
          return [];
        })
      )
    );
    visionScores.push(...batchResults.flat());
  }

  // Text call (runs after vision to stay within rate limits)
  const textScores = await extractScoresFromText(anthropic, { textContent: textBlock, modelName })
    .catch(err => {
      console.warn(`     Text extraction error: ${err.message.substring(0, 100)}`);
      return [];
    });

  console.log(`     Vision: ${visionScores.length} scores from ${downloadedImages.length} images`);
  console.log(`     Text: ${textScores.length} scores`);

  // Debug: print raw scores before normalization
  if (visionScores.length > 0) {
    console.log(`\n     --- Raw vision scores ---`);
    for (const s of visionScores) {
      console.log(`     ${s.benchmark}: ${s.score}${s.model_variant ? ` [variant: ${s.model_variant}]` : ""}${s.notes ? ` [notes: ${s.notes}]` : ""}`);
    }
  }
  if (textScores.length > 0) {
    console.log(`\n     --- Raw text scores ---`);
    for (const s of textScores) {
      console.log(`     ${s.benchmark}: ${s.score}${s.model_variant ? ` [variant: ${s.model_variant}]` : ""}${s.notes ? ` [notes: ${s.notes}]` : ""}`);
    }
  }
  console.log("");

  // Step 5: Deduplicate
  const deduped = deduplicateScores(visionScores, textScores);
  console.log(`     ${deduped.length} unique scores after dedup`);

  return { scores: deduped, publishDate };
}

// ─── Main pipeline ───────────────────────────────────────────

async function main() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Model Card Extraction Pipeline`);
  console.log(`  ${DRY_RUN ? "DRY RUN (no DB writes)" : "LIVE RUN"}`);
  if (LAB_FILTER) console.log(`  Lab filter: ${LAB_FILTER}`);
  if (FORCE) console.log(`  Force: re-extracting already-processed URLs`);
  if (SINGLE_URL) console.log(`  Single URL: ${SINGLE_URL}`);
  console.log(`${"=".repeat(60)}\n`);

  // Marker files: clear stale ones from a prior run, then mark "started".
  unlinkMarker(MARKER_STARTED);
  unlinkMarker(MARKER_COMPLETE);
  unlinkMarker(MARKER_BB_SKIP);
  writeMarker(MARKER_STARTED, { pid: process.pid, dryRun: DRY_RUN });

  const supabase = DRY_RUN ? null : createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  // Single browser pool for the whole run. Per-article dispatch picks
  // local vs Browserbase from each source's `useBrowserbase` flag.
  const pool = new BrowserPool();
  const browserbaseSkipped = []; // { url, reason } — populated if Browserbase is unavailable
  let browserbaseUnavailable = false;

  // Get last extraction date + processed URLs from DB
  let lastExtractionDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const processedUrls = new Set();

  if (supabase) {
    const { data: lastData } = await supabase
      .from("benchmark_raw")
      .select("extracted_at")
      .eq("source", "model_card_auto")
      .order("extracted_at", { ascending: false })
      .limit(1);
    if (lastData?.[0]?.extracted_at) {
      lastExtractionDate = new Date(lastData[0].extracted_at);
    }

    if (!FORCE) {
      const { data: urlData } = await supabase
        .from("benchmark_raw")
        .select("source_url")
        .eq("source", "model_card_auto")
        .not("source_url", "is", null);
      if (urlData) {
        for (const row of urlData) processedUrls.add(row.source_url);
      }
    }
  }

  console.log(`Last extraction: ${lastExtractionDate.toISOString().split("T")[0]}`);
  console.log(`Already processed: ${processedUrls.size} article URLs\n`);

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
        if (currentBest[key] == null || row.score > currentBest[key]) {
          currentBest[key] = row.score;
        }
      }
    }
  }

  const newArticles = [];
  const allExtracted = [];

  // ─── Step 1: Discover articles ─────────────────────────────

  if (SINGLE_URL) {
    // Single URL mode: skip discovery
    if (!SINGLE_MODEL || !LAB_FILTER) {
      console.error("Error: --url requires --model and --lab.");
      process.exit(1);
    }
    newArticles.push({
      source: LAB_SOURCES.find(s => s.lab === LAB_FILTER) || { lab: LAB_FILTER, name: LAB_FILTER },
      title: SINGLE_MODEL,
      url: SINGLE_URL,
      modelName: SINGLE_MODEL,
    });
  } else {
    console.log("Step 1: Scanning blog indexes...\n");

    const sources = LAB_FILTER
      ? LAB_SOURCES.filter(s => s.lab === LAB_FILTER || s.name.toLowerCase() === LAB_FILTER)
      : LAB_SOURCES;

    // Split sources into feed-based (no browser needed) and browser-based
    const feedSources = sources.filter(s => s.feedUrl);
    const browserSources = sources.filter(s => !s.feedUrl);

    // Discover from feeds first (no browser, avoids triggering anti-bot)
    for (const source of feedSources) {
      try {
        const articles = await discoverViaFeed(source);
        if (articles.length === 0) continue;

        const classifications = await classifyArticles(anthropic, articles);

        for (const cls of classifications) {
          if (!cls.is_model_release) continue;
          const article = articles[cls.index];
          if (!article) continue;

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
      } catch (err) {
        console.warn(`   Error fetching feed for ${source.name}: ${err.message.substring(0, 150)}`);
      }
    }

    // Discover from browser-based sources
    if (browserSources.length > 0) {
      console.log("\nScanning browser-based sources...");

      for (const source of browserSources) {
        const kind = browserKindFor(source);
        let browser;
        try {
          browser = await pool.getBrowser(kind);
        } catch (err) {
          if (kind === "browserbase") {
            console.warn(`   Browserbase unavailable for ${source.name}: ${err.message.substring(0, 150)}`);
            browserbaseUnavailable = true;
            // Can't scan this source; record but continue with other sources
            continue;
          }
          throw err;
        }

        let scanCtx;
        try {
          scanCtx = await browser.newContext({
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            viewport: { width: 1280, height: 720 },
          });
        } catch (err) {
          console.warn(`   Could not create context for ${source.name}: ${err.message.substring(0, 150)}`);
          if (kind === "browserbase") browserbaseUnavailable = true;
          continue;
        }

        const scanPage = await scanCtx.newPage();
        try {
          const articles = source.scanMethod === "qwenCards"
            ? await scanQwenCards(scanPage, source)
            : await scanBlogIndex(scanPage, source);
          if (articles.length === 0) {
            await scanCtx.close();
            continue;
          }

          const classifications = await classifyArticles(anthropic, articles);

          for (const cls of classifications) {
            if (!cls.is_model_release) continue;
            const article = articles[cls.index];
            if (!article) continue;

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
        } catch (err) {
          console.warn(`   Error scanning ${source.name}: ${err.message.substring(0, 150)}`);
        } finally {
          try { await scanCtx.close(); } catch { /* ignore */ }
        }
      }
    }
  }

  console.log(`Found ${newArticles.length} articles to process.\n`);

  if (newArticles.length === 0) {
    console.log("No new articles to process. Done.");
    await pool.closeAll();
    writeMarker(MARKER_COMPLETE, {
      articlesProcessed: 0,
      scoresExtracted: 0,
      browserbaseSkipped: 0,
      browserbaseUnavailable,
    });
    return;
  }

  // ─── Step 2: Extract scores from articles ──────────────────
  // Per-article dispatch via BrowserPool: sources with `useBrowserbase: true`
  // (currently OpenAI) get the cloud browser; everything else gets local headless.
  // Browserbase availability errors are isolated per article — other labs ingest normally.

  console.log("Step 2: Extracting scores from articles...\n");

  try {
    for (const article of newArticles) {
      const kind = browserKindFor(article.source);

      // Acquire browser of the right kind. Browserbase failure → skip + mark.
      let browser;
      try {
        browser = await pool.getBrowser(kind);
      } catch (err) {
        if (kind === "browserbase") {
          console.error(`   Browserbase unavailable for "${article.title}": ${err.message.substring(0, 150)}`);
          browserbaseUnavailable = true;
          browserbaseSkipped.push({ url: article.url, reason: err.message.substring(0, 200) });
          allExtracted.push({ article, scores: [], publishDate: null, browserbaseSkipped: true });
          continue;
        }
        throw err;
      }

      // Fresh context per article: avoids cookie/session contamination across articles.
      let ctx;
      try {
        ctx = await browser.newContext({
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          viewport: { width: 1280, height: 720 },
        });
      } catch (err) {
        // Mid-loop browser API rejection (e.g. Browserbase quota tipped over,
        // session disconnected since pool's isConnected check, key rotated).
        if (kind === "browserbase") {
          console.error(`   Browserbase newContext failed for "${article.title}": ${err.message.substring(0, 150)}`);
          browserbaseUnavailable = true;
          browserbaseSkipped.push({ url: article.url, reason: err.message.substring(0, 200) });
          allExtracted.push({ article, scores: [], publishDate: null, browserbaseSkipped: true });
          continue;
        }
        throw err;
      }

      const articlePage = await ctx.newPage();
      try {
        const cutoff = FORCE ? null : lastExtractionDate;
        const { scores, publishDate, skippedOld } = await extractFromArticle(
          articlePage, anthropic, article.url, article.modelName, cutoff
        );
        allExtracted.push({ article, scores, publishDate, skippedOld });
      } catch (err) {
        console.error(`   FAILED: ${article.title}: ${err.message.substring(0, 200)}`);
        allExtracted.push({ article, scores: [], publishDate: null });
      } finally {
        try { await ctx.close(); } catch { /* ignore */ }
      }
    }
  } finally {
    await pool.closeAll();
    console.log("\nExtraction browser pool closed.\n");
  }

  if (browserbaseSkipped.length > 0) {
    writeMarker(MARKER_BB_SKIP, {
      reason: "Browserbase unavailable during extraction",
      skippedUrls: browserbaseSkipped,
    });
    console.warn(`   ${browserbaseSkipped.length} article(s) skipped due to Browserbase unavailability — see ${MARKER_BB_SKIP}`);
  }

  // Log date filtering summary
  const skippedOldCount = allExtracted.filter(e => e.skippedOld).length;
  const processedCount = allExtracted.filter(e => !e.skippedOld).length;
  const noParseDateCount = allExtracted.filter(e => !e.skippedOld && !e.publishDate).length;
  if (skippedOldCount > 0) {
    console.log(`   ${skippedOldCount} article(s) skipped (before cutoff), ${processedCount} processed`);
    if (noParseDateCount > 0) {
      console.log(`   ${noParseDateCount} article(s) with unparseable dates (processed anyway)`);
    }
    console.log("");
  }

  // ─── Step 3: Normalize, triage, and store ────────────────────

  console.log("Step 3: Normalizing and triaging scores...\n");

  const rawRows = [];
  const ingested = [];
  const flagged = [];
  const rejected = [];

  for (const { article, scores, publishDate } of allExtracted) {
    const lab = article.source.lab;
    const scoreDate = publishDate
      ? publishDate.toISOString().split("T")[0]
      : new Date().toISOString().split("T")[0];

    // Build rows and run per-score triage
    const articleRows = [];
    const articleTriageResults = [];

    for (const s of scores) {
      const normalized = normalizeBenchmarkName(s.benchmark);

      const row = {
        benchmark: normalized.key || s.benchmark.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        lab,
        model: article.modelName,
        model_variant: s.model_variant || null,
        score: Math.round(s.score * 10) / 10,
        date: scoreDate,
        source: "model_card_auto",
        verified: false,
        source_url: article.url,
        raw_benchmark_name: s.benchmark,
        extracted_at: new Date().toISOString(),
      };

      rawRows.push(row);

      // Per-score triage (tracked benchmarks only)
      if (normalized.key && BENCHMARK_META[normalized.key]) {
        const bestKey = `${normalized.key}|${lab}`;
        const result = triageScore(
          row.score,
          currentBest[bestKey] ?? null,
          normalized.key,
          normalized.confidence
        );
        articleRows.push({ row, rawScore: s, result });
        articleTriageResults.push(result);
      } else if (normalized.confidence === "none") {
        console.log(`   SKIP:   ${row.model} on ${s.benchmark}: ${row.score} (untracked, stored in raw)`);
      }
    }

    // Cross-score checks: detect conflicts within this article's tracked scores
    const trackedForCrossCheck = articleRows.map(r => ({
      benchmark: r.row.benchmark,
      score: r.row.score,
      model_variant: r.row.model_variant,
    }));
    const crossFlags = crossCheckScores(trackedForCrossCheck);
    // Mark conflicts so the LLM review can see them, but don't flag yet — LLM will resolve or escalate
    for (const cf of crossFlags) {
      articleRows[cf.index]._conflictReason = cf.reason;
    }

    // LLM review: resolve conflicts + flag abnormal variants
    if (scores.length > 0) {
      try {
        const llmDecisions = await reviewVariants(anthropic, scores, article.modelName);
        for (const d of llmDecisions) {
          const matchingRow = articleRows.find(r => r.rawScore === scores[d.index]);
          if (!matchingRow) continue;

          if (d.action === "reject") {
            matchingRow.result = { action: "reject", reason: `LLM review: ${d.reason}` };
          } else if (d.action === "flag") {
            matchingRow.result = { action: "review", reason: `LLM review: ${d.reason}` };
          }
        }

        // For conflicts detected by cross-check: if the LLM resolved them (rejected one side),
        // clear the conflict flag on the surviving score. If not addressed, flag for human review.
        for (const cf of crossFlags) {
          const row = articleRows[cf.index];
          if (!row._conflictReason) continue;

          // Find the conflicting partner(s) for this score
          const partners = crossFlags
            .filter(other => other.index !== cf.index && other.reason === cf.reason)
            .map(other => articleRows[other.index]);

          // If all partners were rejected by LLM, this score's conflict is resolved
          const allPartnersResolved = partners.every(p => p.result.action === "reject");

          if (allPartnersResolved) {
            // Conflict resolved — keep original triage result (ingest)
          } else if (row.result.action === "ingest") {
            // LLM didn't resolve this conflict — flag for human review
            row.result = { action: "review", reason: row._conflictReason };
          }
        }
      } catch (err) {
        console.warn(`   Warning: LLM review failed: ${err.message.substring(0, 100)}`);
        // Fallback: if LLM review fails, flag all conflicts for human review
        for (const cf of crossFlags) {
          if (articleRows[cf.index].result.action === "ingest") {
            articleRows[cf.index].result = { action: "review", reason: cf.reason };
          }
        }
      }
    }

    // Collect final triage results and set triage_status on raw rows
    for (const { row, result } of articleRows) {
      const summary = `${row.model} on ${row.benchmark}: ${row.score}${row.model_variant ? ` [${row.model_variant}]` : ""} (${result.action}: ${result.reason})`;

      // Map triage action to status stored in DB
      const statusMap = { ingest: "ingest", review: "flag", reject: "reject" };
      row.triage_status = statusMap[result.action] || null;
      row.triage_reason = result.reason || null;

      if (result.action === "ingest") {
        ingested.push({ ...row, triageResult: result });
        console.log(`   INGEST: ${summary}`);
      } else if (result.action === "review") {
        flagged.push({ ...row, triageResult: result, rawBenchmark: row.raw_benchmark_name });
        console.log(`   FLAG:   ${summary}`);
      } else {
        rejected.push({ ...row, triageResult: result });
        console.log(`   REJECT: ${summary}`);
      }
    }
  }

  const trackedCount = ingested.length + flagged.length + rejected.length;
  const untrackedCount = rawRows.length - trackedCount;

  console.log(`\n   ${rawRows.length} total scores (all stored in benchmark_raw)`);
  console.log(`   Tracked: ${ingested.length} ingest, ${flagged.length} flagged, ${rejected.length} rejected`);
  console.log(`   Untracked: ${untrackedCount} (stored for future use)\n`);

  // ─── Step 4: Store in benchmark_raw ──────────────────────────

  if (!DRY_RUN && supabase && rawRows.length > 0) {
    console.log("Step 4: Storing in benchmark_raw...\n");

    // Deduplicate rows by composite key
    const rowKey = r => `${r.benchmark}|${r.lab}|${r.model}|${r.model_variant || ""}|${r.source}`;
    const seen = new Set();
    const dedupedRows = rawRows.filter(r => {
      const key = rowKey(r);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (dedupedRows.length < rawRows.length) {
      console.log(`   Deduped ${rawRows.length} → ${dedupedRows.length} rows (removed ${rawRows.length - dedupedRows.length} duplicates)`);
    }

    // Delete existing rows for these source URLs, then insert fresh.
    // Avoids upsert conflict issues when model_variant creates multiple rows
    // with the same (benchmark, lab, model, source) key.
    const sourceUrls = [...new Set(dedupedRows.map(r => r.source_url).filter(Boolean))];
    for (const url of sourceUrls) {
      await supabase
        .from("benchmark_raw")
        .delete()
        .eq("source", "model_card_auto")
        .eq("source_url", url);
    }

    const { error } = await supabase
      .from("benchmark_raw")
      .insert(dedupedRows);

    if (error) {
      console.error(`   benchmark_raw insert FAILED: ${error.message}`);
      process.exit(1);
    } else {
      console.log(`   Stored ${dedupedRows.length} rows in benchmark_raw.`);
    }
  } else if (DRY_RUN) {
    console.log("Step 4: Skipped (dry run).\n");
  }

  // ─── Step 5: Post-run report (GitHub Issue) ──────────────────

  if (!DRY_RUN && rawRows.length > 0 && !NO_REPORT) {
    console.log("\nStep 5: Creating run report...");

    const today = new Date().toISOString().split("T")[0];
    const needsReview = flagged.length > 0;
    const title = needsReview
      ? `[Extraction] ${today}: ${rawRows.length} scores extracted (${flagged.length} need review)`
      : `[Extraction] ${today}: ${rawRows.length} scores extracted`;

    const bodyParts = [];

    // Overview
    bodyParts.push(`## Run Summary (${today})`);
    bodyParts.push(`| Metric | Count |`);
    bodyParts.push(`|--------|-------|`);
    bodyParts.push(`| Articles processed | ${allExtracted.length} |`);
    bodyParts.push(`| Total scores extracted | ${rawRows.length} |`);
    bodyParts.push(`| Tracked: auto-ingested | ${ingested.length} |`);
    bodyParts.push(`| Tracked: needs review | ${flagged.length} |`);
    bodyParts.push(`| Tracked: rejected | ${rejected.length} |`);
    bodyParts.push(`| Untracked (stored for future) | ${untrackedCount} |`);
    bodyParts.push("");

    // Needs Review section (if any)
    if (flagged.length > 0) {
      bodyParts.push("## Needs Review");
      bodyParts.push("These scores were extracted but need human verification before they flow into the charts.");
      bodyParts.push("");
      for (const entry of flagged) {
        const best = currentBest[`${entry.benchmark}|${entry.lab}`];
        bodyParts.push(`- **${entry.model}** on **${entry.benchmark}**: ${entry.score} (current best: ${best || "none"})`);
        bodyParts.push(`  Reason: ${entry.triageResult.reason} | [Source](${entry.source_url})`);
      }
      bodyParts.push("");
    }

    // Auto-rejected section (LLM review decisions, for transparency)
    const llmRejected = rejected.filter(r => r.triageResult.reason.startsWith("LLM review:"));
    if (llmRejected.length > 0) {
      bodyParts.push("## Auto-Rejected (LLM Review)");
      bodyParts.push("These scores were automatically rejected by the LLM triage review. Listed here for transparency.");
      bodyParts.push("");
      for (const entry of llmRejected) {
        bodyParts.push(`- **${entry.model}** on **${entry.benchmark}**: ${entry.score}${entry.model_variant ? ` [${entry.model_variant}]` : ""}`);
        bodyParts.push(`  Reason: ${entry.triageResult.reason} | [Source](${entry.source_url})`);
      }
      bodyParts.push("");
    }

    // Auto-ingested section
    if (ingested.length > 0) {
      bodyParts.push("## Auto-Ingested");
      bodyParts.push("These scores matched tracked benchmarks and passed triage. Stored in `benchmark_raw` as unverified.");
      bodyParts.push("");
      for (const s of ingested) {
        bodyParts.push(`- ${s.model} | ${s.benchmark}: ${s.score} ([source](${s.source_url}))`);
      }
      bodyParts.push("");
    }

    // Articles processed
    bodyParts.push("## Articles Processed");
    for (const { article, scores } of allExtracted) {
      bodyParts.push(`- [${article.title}](${article.url}): ${scores.length} scores`);
    }
    bodyParts.push("");

    // Untracked scores (collapsed)
    if (untrackedCount > 0) {
      bodyParts.push("<details>");
      bodyParts.push(`<summary>Untracked scores (${untrackedCount})</summary>`);
      bodyParts.push("");
      for (const row of rawRows) {
        const normalized = normalizeBenchmarkName(row.raw_benchmark_name);
        if (normalized.confidence === "none") {
          bodyParts.push(`- ${row.model} | ${row.raw_benchmark_name}: ${row.score}`);
        }
      }
      bodyParts.push("");
      bodyParts.push("</details>");
    }

    bodyParts.push("");
    bodyParts.push("*Generated automatically by the extraction pipeline.*");

    const body = bodyParts.join("\n");
    const labels = needsReview ? "extraction-report,needs-review" : "extraction-report";

    const tmpFile = path.resolve(__dirname, "../.extraction-report-body.md");
    try {
      // Write body to temp file to avoid shell escaping issues with markdown tables
      fs.writeFileSync(tmpFile, body, "utf8");
      const { execFileSync } = await import("child_process");
      execFileSync("gh", ["issue", "create", "--title", title, "--body-file", tmpFile, "--label", labels], {
        cwd: path.resolve(__dirname, ".."),
        stdio: "pipe",
      });
      console.log(`   Created report: ${title}`);
    } catch (err) {
      console.warn(`   Failed to create report: ${err.message.substring(0, 150)}`);
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }

  // ─── Step 6: Console summary ───────────────────────────────

  console.log(`\n${"=".repeat(60)}`);
  console.log("  Summary");
  console.log(`${"=".repeat(60)}`);
  console.log(`  Articles processed:  ${allExtracted.length}`);
  console.log(`  Total scores:        ${rawRows.length} (all stored in benchmark_raw)`);
  console.log(`  Tracked benchmarks:  ${ingested.length} ingest + ${flagged.length} flagged + ${rejected.length} rejected`);
  console.log(`  Untracked:           ${untrackedCount} (stored for future use)`);

  if (ingested.length > 0) {
    console.log("\n  Ingested scores:");
    for (const s of ingested) {
      console.log(`    ${s.model} | ${s.benchmark}: ${s.score}`);
    }
  }

  if (flagged.length > 0) {
    console.log("\n  Flagged scores:");
    for (const s of flagged) {
      console.log(`    ${s.model} | ${s.benchmark}: ${s.score} (${s.triageResult.reason})`);
    }
  }

  if (DRY_RUN) {
    console.log("\n  DRY RUN: No data was written to Supabase.");
  }
  console.log("");

  // Marker for the orchestrator: clean exit. Absence of this file = subprocess crashed.
  writeMarker(MARKER_COMPLETE, {
    articlesProcessed: allExtracted.length,
    scoresExtracted: rawRows.length,
    browserbaseSkipped: browserbaseSkipped.length,
    browserbaseUnavailable,
  });
}

main().catch(err => {
  console.error("Fatal error:", err);
  // Intentionally do NOT write the complete marker — orchestrator interprets
  // its absence as "extraction crashed" and posts an alert.
  process.exit(1);
});

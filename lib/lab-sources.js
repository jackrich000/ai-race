// lib/lab-sources.js
// Discovery configuration per lab for automated model card extraction.
// Used by scripts/extract-model-cards.mjs.
//
// Discovery surfaces:
//   feedUrl                       — RSS/Atom feed (no browser, no anti-bot)
//   scanMethod: "huggingfaceApi"  — HF Hub API (no browser; expects hfAuthor)
//   scanMethod: "qwenCards"       — qwen.ai/research card scanner (Playwright)
//   indexUrl + articlePathPattern — generic blog index DOM scan (Playwright)
//
// Browser backend dispatch:
//   useBrowserbase: true → cloud browser (Browserbase) for anti-bot heavy sites
//   default              → local headless Playwright
// HF API and RSS sources skip BrowserPool entirely.

const LAB_SOURCES = [
  {
    lab: "openai",
    name: "OpenAI",
    indexUrl: "https://openai.com/index/",
    feedUrl: "https://openai.com/news/rss.xml",
    articlePathPattern: /\/index\/.+/,
    minExpectedArticles: 5,
    // OpenAI's anti-bot blocks local headless Chromium on individual article pages
    // (defeats both the index scan and direct article visits). Browserbase's cloud
    // browser bypasses it. See project_openai_extraction_history.md for the full saga.
    useBrowserbase: true,
  },
  {
    lab: "anthropic",
    name: "Anthropic",
    indexUrl: "https://www.anthropic.com/news",
    articlePathPattern: /\/news\/.+/,
    minExpectedArticles: 5,
  },
  {
    lab: "google",
    name: "Google DeepMind",
    indexUrl: "https://blog.google/innovation-and-ai/models-and-research/gemini-models/",
    articlePathPattern: /\/gemini-models\/.+/,
    minExpectedArticles: 2,
  },
  {
    lab: "xai",
    name: "xAI",
    indexUrl: "https://x.ai/news",
    articlePathPattern: /\/news\/.+/,
    minExpectedArticles: 2,
  },
  // Chinese Leaders composite. Four labs published to HF (DeepSeek, Kimi, MiniMax, Zhipu)
  // share a single HF API path (no browser, no anti-bot). Qwen flagship cards live on
  // qwen.ai/research instead, so it keeps the dedicated card scanner.
  {
    lab: "chinese",
    name: "DeepSeek",
    slug: "deepseek",
    scanMethod: "huggingfaceApi",
    hfAuthor: "deepseek-ai",
    minExpectedArticles: 1,
  },
  {
    lab: "chinese",
    name: "Kimi",
    slug: "kimi",
    scanMethod: "huggingfaceApi",
    hfAuthor: "moonshotai",
    minExpectedArticles: 1,
  },
  {
    lab: "chinese",
    name: "MiniMax",
    slug: "minimax",
    scanMethod: "huggingfaceApi",
    hfAuthor: "MiniMaxAI",
    minExpectedArticles: 1,
  },
  {
    lab: "chinese",
    name: "Zhipu",
    slug: "zhipu",
    scanMethod: "huggingfaceApi",
    hfAuthor: "zai-org",
    minExpectedArticles: 1,
  },
  {
    lab: "chinese",
    name: "Qwen",
    slug: "qwen",
    indexUrl: "https://qwen.ai/research",
    scanMethod: "qwenCards",
    minExpectedArticles: 2,
  },
];

module.exports = { LAB_SOURCES };

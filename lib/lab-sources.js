// lib/lab-sources.js
// Blog index URLs and metadata per lab for automated model card extraction.
// Used by scripts/extract-model-cards.mjs.

const LAB_SOURCES = [
  {
    lab: "openai",
    name: "OpenAI",
    indexUrl: "https://openai.com/index/",
    articlePathPattern: /\/index\/.+/,
    needsBrowser: true, // Cloudflare on index page
    minExpectedArticles: 5,
  },
  {
    lab: "anthropic",
    name: "Anthropic",
    indexUrl: "https://www.anthropic.com/news",
    articlePathPattern: /\/news\/.+/,
    needsBrowser: false,
    minExpectedArticles: 5,
  },
  {
    lab: "google",
    name: "Google DeepMind",
    indexUrl: "https://blog.google/innovation-and-ai/models-and-research/gemini-models/",
    articlePathPattern: /\/gemini-models\/.+/,
    needsBrowser: false,
    minExpectedArticles: 2,
  },
  {
    lab: "xai",
    name: "xAI",
    indexUrl: "https://x.ai/news",
    articlePathPattern: /\/news\/.+/,
    needsBrowser: true, // Anti-bot on index page
    minExpectedArticles: 2,
  },
  {
    lab: "chinese",
    name: "DeepSeek",
    slug: "deepseek",
    indexUrl: "https://huggingface.co/deepseek-ai",
    articlePathPattern: /\/deepseek-ai\/DeepSeek-/,
    needsBrowser: false,
    minExpectedArticles: 2,
  },
  {
    lab: "chinese",
    name: "Qwen",
    slug: "qwen",
    indexUrl: "https://qwen.ai/research",
    articlePathPattern: /\/blog\/.+/,
    needsBrowser: false,
    minExpectedArticles: 2,
  },
];

module.exports = { LAB_SOURCES };

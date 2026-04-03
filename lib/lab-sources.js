// lib/lab-sources.js
// Blog index URLs and metadata per lab for automated model card extraction.
// Used by scripts/extract-model-cards.mjs.

const LAB_SOURCES = [
  {
    lab: "openai",
    name: "OpenAI",
    indexUrl: "https://openai.com/index/",
    feedUrl: "https://openai.com/news/rss.xml",
    articlePathPattern: /\/index\/.+/,
    minExpectedArticles: 5,
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
  {
    lab: "chinese",
    name: "DeepSeek",
    slug: "deepseek",
    indexUrl: "https://huggingface.co/deepseek-ai",
    articlePathPattern: /\/deepseek-ai\/DeepSeek-/,
    minExpectedArticles: 2,
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

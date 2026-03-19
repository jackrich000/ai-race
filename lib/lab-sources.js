// lib/lab-sources.js
// Blog index URLs and metadata per lab for automated model card extraction.
// Used by scripts/extract-model-cards.mjs.

const LAB_SOURCES = [
  {
    lab: "openai",
    name: "OpenAI",
    indexUrl: "https://openai.com/index/",
    needsBrowser: true, // Blocks plain HTTP
    lastKnownArticleUrl: null,
    minExpectedArticles: 5,
  },
  {
    lab: "anthropic",
    name: "Anthropic",
    indexUrl: "https://www.anthropic.com/news",
    needsBrowser: false,
    lastKnownArticleUrl: null,
    minExpectedArticles: 5,
  },
  {
    lab: "google",
    name: "Google DeepMind",
    indexUrl: "https://blog.google/technology/google-deepmind/",
    needsBrowser: false,
    lastKnownArticleUrl: null,
    minExpectedArticles: 5,
  },
  {
    lab: "xai",
    name: "xAI",
    indexUrl: "https://x.ai/news",
    needsBrowser: true, // Blocks plain HTTP
    lastKnownArticleUrl: null,
    minExpectedArticles: 2,
  },
  {
    lab: "chinese",
    name: "DeepSeek",
    slug: "deepseek",
    indexUrl: "https://huggingface.co/deepseek-ai",
    needsBrowser: false,
    lastKnownArticleUrl: null,
    minExpectedArticles: 2,
  },
  {
    lab: "chinese",
    name: "Qwen",
    slug: "qwen",
    indexUrl: "https://qwen.ai/research",
    needsBrowser: false,
    lastKnownArticleUrl: null,
    minExpectedArticles: 2,
  },
];

module.exports = { LAB_SOURCES };

// tests/extraction-ground-truth.test.js
//
// WARNING: This file needs to be rewritten with real ground truth data.
// The previous version contained FABRICATED data. Real ground truths are
// documented in memory: project_extraction_groundtruths.md
//
// TODO: Rewrite these tests using the verified ground truths for:
//   - Anthropic Claude Sonnet 4.6 (16 scores)
//   - OpenAI GPT 5.4 Mini (16 scores)
//   - xAI Grok 4.1 Fast (5 scores)
//
// Requires: ANTHROPIC_API_KEY + Playwright browsers + RUN_INTEGRATION=1
// Run: RUN_INTEGRATION=1 npm test -- extraction-ground-truth

import { describe, it } from "vitest";

describe("extraction ground truth (integration)", () => {
  it.todo("Anthropic Claude Sonnet 4.6: 16 scores — see project_extraction_groundtruths.md");
  it.todo("OpenAI GPT 5.4 Mini: 16 scores — see project_extraction_groundtruths.md");
  it.todo("xAI Grok 4.1 Fast: 5 scores — see project_extraction_groundtruths.md");
});

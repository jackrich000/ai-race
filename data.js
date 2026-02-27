// Dummy data for AI Benchmark Tracker
// Each benchmark has scores per lab over time (Q1 2023 → Q4 2025)
// Scores are percentages (0-100) representing best model from each lab at that time

const TIME_LABELS = [
  "Q1 2023", "Q2 2023", "Q3 2023", "Q4 2023",
  "Q1 2024", "Q2 2024", "Q3 2024", "Q4 2024",
  "Q1 2025", "Q2 2025", "Q3 2025", "Q4 2025"
];

const LABS = {
  openai:    { name: "OpenAI",          color: "#10a37f" },
  anthropic: { name: "Anthropic",       color: "#d4a574" },
  google:    { name: "Google DeepMind", color: "#4285f4" },
  xai:       { name: "xAI",            color: "#ef4444" },
  meta:      { name: "Meta",           color: "#a855f7" },
};

const BENCHMARKS = {
  "swe-bench": {
    name: "SWE-bench Verified",
    description: "Tests ability to resolve real GitHub issues from popular open-source Python repositories. Models must understand codebases, locate bugs, and generate working patches.",
    category: "Coding",
    link: "https://www.swebench.com/",
    scores: {
      openai:    [null, null, 2.3, 4.8, 12.5, 18.3, 33.2, 38.8, 42.1, 49.0, 55.2, 62.4],
      anthropic: [null, null, null, 3.1, 7.2, 15.9, 27.4, 33.0, 40.5, 50.8, 57.6, 65.1],
      google:    [null, null, null, 2.0, 5.8, 11.4, 22.1, 28.7, 35.3, 41.2, 48.9, 54.7],
      xai:       [null, null, null, null, null, null, 8.5, 15.3, 22.7, 30.4, 38.1, 45.6],
      meta:      [null, null, null, 1.5, 3.8, 8.2, 14.6, 19.1, 24.3, 29.8, 35.2, 40.1],
    }
  },
  "arc-agi-1": {
    name: "ARC-AGI-1",
    description: "Abstract and Reasoning Corpus — tests fluid intelligence through novel visual pattern recognition puzzles that require generalization from few examples.",
    category: "Reasoning",
    link: "https://arcprize.org/",
    scores: {
      openai:    [5.0, 8.2, 12.1, 18.5, 25.3, 33.0, 42.8, 50.1, 58.4, 67.2, 75.0, 82.5],
      anthropic: [3.5, 6.8, 10.4, 15.2, 21.7, 29.5, 38.3, 47.6, 55.1, 64.8, 73.2, 80.1],
      google:    [4.2, 7.5, 11.0, 16.8, 23.4, 30.1, 39.5, 46.2, 54.7, 62.1, 70.8, 78.3],
      xai:       [null, null, null, null, 10.5, 18.2, 28.4, 36.7, 44.2, 53.8, 62.5, 71.0],
      meta:      [2.1, 4.5, 7.8, 12.3, 17.6, 23.8, 31.2, 37.5, 43.9, 50.1, 57.4, 63.8],
    }
  },
  "arc-agi-2": {
    name: "ARC-AGI-2",
    description: "Harder successor to ARC-AGI-1 with more complex abstract reasoning puzzles. Designed to remain challenging as models improve on the original.",
    category: "Reasoning",
    link: "https://arcprize.org/",
    scores: {
      openai:    [null, null, null, null, null, null, null, 4.2, 8.5, 14.3, 21.7, 28.4],
      anthropic: [null, null, null, null, null, null, null, 3.8, 7.1, 12.8, 19.5, 26.2],
      google:    [null, null, null, null, null, null, null, 3.5, 6.8, 11.5, 18.2, 24.9],
      xai:       [null, null, null, null, null, null, null, 2.1, 5.3, 9.7, 15.4, 21.3],
      meta:      [null, null, null, null, null, null, null, 1.8, 4.2, 7.6, 12.1, 17.5],
    }
  },
  "hle": {
    name: "Humanity's Last Exam",
    description: "Expert-level questions spanning dozens of academic disciplines, designed to be at the frontier of human knowledge. Tests deep expertise rather than pattern matching.",
    category: "Knowledge",
    link: "https://lastexam.ai/",
    scores: {
      openai:    [null, null, null, null, null, 2.8, 5.1, 8.4, 12.7, 16.3, 21.5, 26.8],
      anthropic: [null, null, null, null, null, 2.2, 4.5, 7.8, 11.3, 15.9, 20.1, 25.4],
      google:    [null, null, null, null, null, 2.5, 4.8, 7.1, 10.8, 14.2, 18.7, 23.1],
      xai:       [null, null, null, null, null, null, 2.1, 4.3, 7.5, 11.1, 15.8, 20.2],
      meta:      [null, null, null, null, null, 1.5, 3.2, 5.4, 8.1, 10.7, 14.3, 18.0],
    }
  },
  "mmlu": {
    name: "MMLU",
    description: "Massive Multitask Language Understanding — 57 subjects from STEM, humanities, and social sciences. The longest-running LLM benchmark with the most historical data.",
    category: "Knowledge",
    link: "https://arxiv.org/abs/2009.03300",
    scores: {
      openai:    [70.0, 73.5, 78.2, 83.1, 85.8, 87.4, 88.9, 90.1, 91.2, 92.0, 92.8, 93.4],
      anthropic: [65.2, 68.8, 74.5, 79.3, 82.7, 85.1, 87.3, 89.5, 90.8, 91.7, 92.5, 93.1],
      google:    [68.4, 72.1, 76.8, 81.5, 84.3, 86.7, 88.1, 89.8, 91.0, 91.9, 92.6, 93.2],
      xai:       [null, null, null, null, 72.4, 78.5, 83.2, 86.1, 88.4, 90.1, 91.5, 92.3],
      meta:      [55.1, 60.3, 65.8, 70.2, 75.6, 79.8, 83.5, 86.4, 88.1, 89.7, 91.0, 91.8],
    }
  },
  "gpqa": {
    name: "GPQA Diamond",
    description: "Graduate-level science questions in physics, chemistry, and biology that are 'Google-proof' — experts in the field achieve ~65% while non-experts score near random chance.",
    category: "Science",
    link: "https://arxiv.org/abs/2311.12022",
    scores: {
      openai:    [28.5, 31.2, 36.8, 42.1, 48.7, 53.4, 58.2, 63.5, 67.1, 71.8, 75.2, 78.4],
      anthropic: [26.1, 29.4, 34.2, 39.8, 45.6, 51.2, 56.7, 61.3, 65.8, 70.4, 74.1, 77.5],
      google:    [27.3, 30.5, 35.1, 40.7, 47.2, 52.8, 57.4, 62.1, 66.5, 70.9, 74.8, 77.9],
      xai:       [null, null, null, null, 35.2, 42.1, 49.8, 55.3, 60.7, 65.8, 70.2, 74.1],
      meta:      [22.4, 25.8, 30.1, 35.6, 40.3, 45.7, 50.2, 54.8, 59.1, 63.2, 67.4, 71.0],
    }
  },
  "aime": {
    name: "AIME 2024",
    description: "American Invitational Mathematics Examination — competition-level math problems requiring creative problem solving. Scored as percentage of 15 problems solved correctly.",
    category: "Math",
    link: "https://artofproblemsolving.com/wiki/index.php/AIME",
    scores: {
      openai:    [6.7, 6.7, 13.3, 13.3, 20.0, 26.7, 33.3, 46.7, 53.3, 66.7, 73.3, 80.0],
      anthropic: [0.0, 6.7, 6.7, 13.3, 13.3, 20.0, 26.7, 40.0, 46.7, 60.0, 66.7, 73.3],
      google:    [6.7, 6.7, 13.3, 13.3, 20.0, 26.7, 33.3, 40.0, 53.3, 60.0, 73.3, 80.0],
      xai:       [null, null, null, null, 6.7, 13.3, 20.0, 33.3, 40.0, 53.3, 60.0, 66.7],
      meta:      [0.0, 0.0, 6.7, 6.7, 13.3, 13.3, 20.0, 26.7, 33.3, 40.0, 46.7, 53.3],
    }
  },
  "gaia": {
    name: "GAIA",
    description: "General AI Assistants — tests multi-step reasoning with real tool use including web browsing, file handling, and code execution. Designed to measure practical agentic capability.",
    category: "Agentic",
    link: "https://arxiv.org/abs/2311.12983",
    scores: {
      openai:    [null, 15.2, 20.1, 28.4, 35.7, 42.3, 48.9, 54.2, 60.1, 66.8, 72.4, 77.5],
      anthropic: [null, null, 16.8, 24.1, 31.5, 38.7, 45.2, 52.8, 58.4, 64.1, 70.5, 76.2],
      google:    [null, 12.5, 18.3, 25.7, 33.2, 40.1, 46.8, 52.1, 57.8, 63.5, 69.1, 74.8],
      xai:       [null, null, null, null, null, 22.4, 31.5, 38.7, 45.3, 52.6, 59.8, 66.3],
      meta:      [null, null, 10.2, 16.5, 22.8, 28.4, 34.1, 39.7, 45.2, 50.8, 56.3, 61.5],
    }
  },
};

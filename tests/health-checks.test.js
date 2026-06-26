import { describe, it, expect } from "vitest";

const { checkSourceThresholds, detectStreakAlerts, buildIssueLabels } = require("../lib/pipeline.js");

// ─── checkSourceThresholds ───────────────────────────────────

describe("checkSourceThresholds", () => {
  const thresholds = { aa: 100, swe: 30, arc: 50, epoch: 100 };

  it("returns no failures when all sources are above threshold", () => {
    const rows = {
      aa: new Array(569).fill({}),
      swe: new Array(115).fill({}),
      arc: new Array(265).fill({}),
      epoch: new Array(559).fill({}),
    };
    expect(checkSourceThresholds(rows, thresholds)).toEqual([]);
  });

  it("flags a single source returning empty (the ARC failure mode)", () => {
    const rows = {
      aa: new Array(569).fill({}),
      swe: new Array(115).fill({}),
      arc: [],
      epoch: new Array(559).fill({}),
    };
    expect(checkSourceThresholds(rows, thresholds)).toEqual([
      { source: "arc", rowCount: 0, threshold: 50 },
    ]);
  });

  it("flags multiple sources at once (no short-circuit)", () => {
    const rows = {
      aa: new Array(50).fill({}),
      swe: new Array(115).fill({}),
      arc: [],
      epoch: new Array(10).fill({}),
    };
    const failures = checkSourceThresholds(rows, thresholds);
    expect(failures).toHaveLength(3);
    expect(failures.map(f => f.source).sort()).toEqual(["aa", "arc", "epoch"]);
  });

  it("treats a missing source as zero rows", () => {
    const rows = { aa: new Array(569).fill({}) }; // swe, arc, epoch absent
    const failures = checkSourceThresholds(rows, thresholds);
    expect(failures.map(f => f.source).sort()).toEqual(["arc", "epoch", "swe"]);
    expect(failures.every(f => f.rowCount === 0)).toBe(true);
  });

  it("ignores sources without thresholds (model_card, manual)", () => {
    const rows = {
      aa: new Array(569).fill({}),
      swe: new Array(115).fill({}),
      arc: new Array(265).fill({}),
      epoch: new Array(559).fill({}),
      model_card: [],   // no threshold → not checked
      manual: [],       // no threshold → not checked
    };
    expect(checkSourceThresholds(rows, thresholds)).toEqual([]);
  });

  it("borderline: rowCount equal to threshold passes", () => {
    const rows = {
      aa: new Array(100).fill({}),
      swe: new Array(30).fill({}),
      arc: new Array(50).fill({}),
      epoch: new Array(100).fill({}),
    };
    expect(checkSourceThresholds(rows, thresholds)).toEqual([]);
  });

  it("borderline: rowCount one below threshold trips", () => {
    const rows = {
      aa: new Array(99).fill({}),
      swe: new Array(30).fill({}),
      arc: new Array(50).fill({}),
      epoch: new Array(100).fill({}),
    };
    const failures = checkSourceThresholds(rows, thresholds);
    expect(failures).toEqual([{ source: "aa", rowCount: 99, threshold: 100 }]);
  });
});

// ─── detectStreakAlerts ──────────────────────────────────────

// row(articles_scraped, scores_extracted, scores_yielded, run_started_at)
function row(scraped, extracted, yielded, dateStr) {
  return {
    articles_scraped: scraped,
    scores_extracted: extracted,
    scores_yielded: yielded,
    run_started_at: dateStr,
  };
}

describe("detectStreakAlerts", () => {
  it("returns insufficient history when fewer than 4 runs exist", () => {
    const history = {
      openai: [row(5, 8, 10, "2026-05-07"), row(0, 0, 0, "2026-04-30")],
    };
    const result = detectStreakAlerts(history);
    expect(result.alerts).toEqual([]);
    expect(result.info).toEqual([]);
    expect(result.insufficientHistory).toEqual([{ lab: "openai", runsSoFar: 2 }]);
  });

  it("returns insufficient history when lab has no runs", () => {
    const history = { openai: [] };
    const result = detectStreakAlerts(history);
    expect(result.alerts).toEqual([]);
    expect(result.insufficientHistory).toEqual([{ lab: "openai", runsSoFar: 0 }]);
  });

  it("does not alert when one of the 4 runs is healthy", () => {
    const history = {
      anthropic: [
        row(0, 0, 0, "2026-05-07"),
        row(0, 0, 0, "2026-04-30"),
        row(2, 5, 5, "2026-04-23"),  // breaks the streak
        row(0, 0, 0, "2026-04-16"),
      ],
    };
    const result = detectStreakAlerts(history);
    expect(result.alerts).toEqual([]);
    expect(result.info).toEqual([]);
  });

  it("alerts on no_articles when all 4 runs have articles_scraped=0", () => {
    const history = {
      chinese: [
        row(0, 0, 0, "2026-05-07"),
        row(0, 0, 0, "2026-04-30"),
        row(0, 0, 0, "2026-04-23"),
        row(0, 0, 0, "2026-04-16"),
      ],
    };
    const result = detectStreakAlerts(history);
    expect(result.alerts).toEqual([
      { lab: "chinese", kind: "no_articles", since: "2026-04-16" },
    ]);
  });

  it("alerts on no_extraction when articles scraped but ZERO scores extracted for 4 runs", () => {
    const history = {
      google: [
        row(3, 0, 0, "2026-05-07"),
        row(2, 0, 0, "2026-04-30"),
        row(1, 0, 0, "2026-04-23"),
        row(2, 0, 0, "2026-04-16"),
      ],
    };
    const result = detectStreakAlerts(history);
    expect(result.alerts).toEqual([
      { lab: "google", kind: "no_extraction", since: "2026-04-16" },
    ]);
    expect(result.info).toEqual([]);
  });

  it("emits an untracked_only INFO (not an alert) when extraction is healthy but nothing is tracked", () => {
    // The exact false-positive that fired for weeks: pages parse, the LLM pulls
    // plenty of scores, but they're all on untracked benchmarks → yielded=0.
    const history = {
      openai: [
        row(3, 12, 0, "2026-05-07"),
        row(2, 5, 0, "2026-04-30"),
        row(1, 3, 0, "2026-04-23"),
        row(2, 7, 0, "2026-04-16"),
      ],
    };
    const result = detectStreakAlerts(history);
    expect(result.alerts).toEqual([]);
    expect(result.info).toEqual([
      { lab: "openai", kind: "untracked_only", since: "2026-04-16" },
    ]);
  });

  it("does not flag a fully healthy lab (extracted>0 and yielded>0)", () => {
    const history = {
      anthropic: [
        row(3, 12, 4, "d4"), row(2, 5, 2, "d3"), row(1, 3, 1, "d2"), row(2, 7, 3, "d1"),
      ],
    };
    const result = detectStreakAlerts(history);
    expect(result.alerts).toEqual([]);
    expect(result.info).toEqual([]);
  });

  it("does not fire new rules on pre-migration rows where scores_extracted is null", () => {
    // Legacy rows (articles>0, scores_yielded=0, scores_extracted=null) must NOT
    // resurrect the old false alarm: ===0 / >0 are both false against null.
    const legacy = (scraped, yielded, dateStr) => ({
      articles_scraped: scraped, scores_extracted: null, scores_yielded: yielded, run_started_at: dateStr,
    });
    const history = {
      google: [legacy(3, 0, "d4"), legacy(2, 0, "d3"), legacy(1, 0, "d2"), legacy(2, 0, "d1")],
    };
    const result = detectStreakAlerts(history);
    expect(result.alerts).toEqual([]);
    expect(result.info).toEqual([]);
  });

  it("uses only the most recent 4 runs when more history exists", () => {
    const history = {
      openai: [
        row(0, 0, 0, "2026-05-07"),
        row(0, 0, 0, "2026-04-30"),
        row(0, 0, 0, "2026-04-23"),
        row(0, 0, 0, "2026-04-16"),
        row(5, 8, 10, "2026-04-09"), // older healthy run — should be ignored
      ],
    };
    const result = detectStreakAlerts(history);
    expect(result.alerts).toEqual([
      { lab: "openai", kind: "no_articles", since: "2026-04-16" },
    ]);
  });

  it("does not alert no_extraction if any window run has articles=0 (that's no_articles territory)", () => {
    // Mixed: 3 runs with articles>0/extracted=0, 1 run with articles=0.
    // Neither pure pattern matches.
    const history = {
      xai: [
        row(2, 0, 0, "2026-05-07"),
        row(1, 0, 0, "2026-04-30"),
        row(0, 0, 0, "2026-04-23"),  // breaks no_extraction (articles=0)
        row(2, 0, 0, "2026-04-16"),
      ],
    };
    const result = detectStreakAlerts(history);
    expect(result.alerts).toEqual([]);
    expect(result.info).toEqual([]);
  });

  it("classifies independently per lab", () => {
    const history = {
      openai: [row(0, 0, 0, "d4"), row(0, 0, 0, "d3"), row(0, 0, 0, "d2"), row(0, 0, 0, "d1")],
      anthropic: [row(5, 9, 10, "d4"), row(5, 9, 10, "d3"), row(5, 9, 10, "d2"), row(5, 9, 10, "d1")],
      google: [row(2, 0, 0, "d4"), row(2, 0, 0, "d3"), row(2, 0, 0, "d2"), row(2, 0, 0, "d1")],
      xai: [row(2, 4, 0, "d4"), row(2, 4, 0, "d3"), row(2, 4, 0, "d2"), row(2, 4, 0, "d1")],
    };
    const result = detectStreakAlerts(history);
    expect(result.alerts).toHaveLength(2);
    expect(result.alerts.find(a => a.lab === "openai").kind).toBe("no_articles");
    expect(result.alerts.find(a => a.lab === "google").kind).toBe("no_extraction");
    expect(result.info).toEqual([{ lab: "xai", kind: "untracked_only", since: "d1" }]);
    // anthropic is healthy → no alert, no info, no insufficient history
    expect(result.insufficientHistory).toEqual([]);
  });

  it("custom streakThreshold of 2 fires after 2 zero runs", () => {
    const history = {
      openai: [row(0, 0, 0, "d2"), row(0, 0, 0, "d1")],
    };
    const result = detectStreakAlerts(history, { streakThreshold: 2 });
    expect(result.alerts).toEqual([
      { lab: "openai", kind: "no_articles", since: "d1" },
    ]);
  });
});

// ─── buildIssueLabels ────────────────────────────────────────

describe("buildIssueLabels", () => {
  it("always includes pipeline-report and nothing else for a clean run", () => {
    expect(buildIssueLabels({})).toEqual(["pipeline-report"]);
    expect(buildIssueLabels({ totalFlagged: 0, staleLabsCount: 0, hasSourceHealthFailure: false, streakAlertCount: 0 }))
      .toEqual(["pipeline-report"]);
  });

  it("adds needs-review when items are flagged or labs are stale", () => {
    expect(buildIssueLabels({ totalFlagged: 3 })).toEqual(["pipeline-report", "needs-review"]);
    expect(buildIssueLabels({ staleLabsCount: 1 })).toEqual(["pipeline-report", "needs-review"]);
  });

  it("adds pipeline-failure on source health failure", () => {
    expect(buildIssueLabels({ hasSourceHealthFailure: true }))
      .toEqual(["pipeline-report", "pipeline-failure"]);
  });

  it("adds pipeline-alert when streak alerts fire (the 2026-05-29 case)", () => {
    expect(buildIssueLabels({ streakAlertCount: 2 }))
      .toEqual(["pipeline-report", "pipeline-alert"]);
  });

  it("combines all labels and keeps pipeline-report first with no duplicates", () => {
    const labels = buildIssueLabels({
      totalFlagged: 1,
      staleLabsCount: 2,
      hasSourceHealthFailure: true,
      streakAlertCount: 1,
    });
    expect(labels[0]).toBe("pipeline-report");
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toEqual([
      "pipeline-report", "needs-review", "pipeline-failure", "pipeline-alert",
    ]);
  });
});

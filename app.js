// ─── Utilities ──────────────────────────────────────────────
function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Build per-point style arrays for hollow (unverified) vs solid (verified) dots. */
function buildPointStyleArrays(verifiedArr, color) {
  return {
    pointBackgroundColor: verifiedArr.map(v => v === false ? "transparent" : color),
    pointBorderColor: verifiedArr.map(() => color),
    pointBorderWidth: verifiedArr.map(v => v === false ? 2 : 1),
  };
}

// ─── Constants ───────────────────────────────────────────────
const SITE_URL = "ai-race.vercel.app";

const BENCHMARK_SOURCE_MAP = {
  "gpqa":          "Artificial Analysis",
  "aime":          "Epoch AI",
  "arc-agi-1":     "ARC Prize",
  "arc-agi-2":     "ARC Prize",
  "arc-agi-3":     "ARC Prize",
  "hle":           "Artificial Analysis",
  "swe-bench-verified": "SWE-bench",
  "swe-bench-pro": "Scale AI SEAL",
  "frontiermath":  "Epoch AI",
  "math-l5":       "Epoch AI",
  "osworld-verified": "Epoch AI",
  "mmmu-pro":      "Artificial Analysis",
};

const COST_SOURCE = "Artificial Analysis";

// Maps raw source slugs (from Supabase) to display names for tooltips
const SOURCE_DISPLAY_MAP = {
  "artificialanalysis": "Artificial Analysis",
  "epoch":              "Epoch AI",
  "arcprize":           "ARC Prize",
  "swebench":           "SWE-bench",
  "manual":             "Scale AI SEAL",
  "model_card":         "Model card",
};

const CHART_DPR = 3;
const INACTIVE_COLOR = "#4b5563";       // grey-600
const INACTIVE_BORDER_WIDTH = 1.5;      // thinner than active (2.5)
const MOBILE_BREAKPOINT = 640;
const GRID_COLOR = "rgba(45, 49, 64, 0.5)";

// Compute Chart.js font size scaled to viewport width (independent of browser zoom).
// Scales from 1x at ≤960px to 1.25x at 2560px+, matching the CSS clamp() growth.
function chartFontSize(base) {
  const vw = window.innerWidth;
  const scale = Math.min(1.25, Math.max(1, 1 + (vw - 960) * 0.25 / 1600));
  return Math.round(base * scale);
}

// ─── State ───────────────────────────────────────────────────
let currentBenchmark = null; // Set to first benchmark key on init
let currentMode = "frontier"; // "frontier" | "race" | "cost"
let selectedLab = null;   // null = "All Labs", or a lab key like "openai"
let currentCostBenchmark = null; // null = all, or "gpqa" / "mmlu-pro"
let currentDateRange = "all-time";
let chart = null;
let chartMode = null; // tracks which mode the chart was built for
let isolatedIndex = null;
let highlightedInactiveIndex = null; // currently highlighted inactive dataset (single-line hover)
let highlightedCapability = null;    // capability whose defeated group is hover-highlighted
let isolatedCapability = null;       // capability whose defeated group is click-isolated
let endpointLabelTargets = new Map(); // dataset index → { color, label }; consumed by endpointLabelPlugin
let cachedAnalysis = null; // parsed JSON from Supabase

// Clipboard SVG icon for copy buttons
const COPY_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3.5a1.5 1.5 0 00-1.5-1.5H3.5A1.5 1.5 0 002 3.5V9a1.5 1.5 0 001.5 1.5h2"/></svg>';

// Capability colours: the single source of truth for line + dot colour in frontier mode.
// Within a capability, multiple lines (active + deprecated/saturated) share the same hue;
// inactive lines render grey-dashed by default and pick up the capability colour on
// hover/isolation. Keys must match the strings in CAPABILITIES (lib/config.js).
const CAPABILITY_COLORS = {
  "Coding":                "#10b981",
  "Math":                  "#ef4444",
  "Expert Reasoning":      "#8b5cf6",
  "Visual Reasoning":      "#06b6d4",
  "Computer Use":          "#ec4899",
  "Novel Problem Solving": "#f59e0b",
};

// Colors for cost benchmarks
const COST_BENCHMARK_COLORS = {
  gpqa:          "#06b6d4",
  "mmlu-pro":    "#a855f7",
  livecodebench: "#f59e0b",
};

// ─── Source helpers ──────────────────────────────────────────
function getVisibleSources() {
  if (currentMode === "cost") return [COST_SOURCE];

  const benchKeys = currentMode === "race"
    ? [currentBenchmark]
    : Object.keys(BENCHMARKS);

  const sourceOrder = [
    "Artificial Analysis", "Epoch AI", "ARC Prize",
    "SWE-bench", "Scale AI SEAL", "Model cards (unverified)",
  ];
  const seen = new Set();
  for (const key of benchKeys) {
    const src = BENCHMARK_SOURCE_MAP[key];
    if (src) seen.add(src);
  }
  if (hasVisibleUnverifiedData()) seen.add("Model cards (unverified)");
  return sourceOrder.filter(s => seen.has(s));
}

function hasVisibleUnverifiedData() {
  if (!chart) return false;
  return chart.data.datasets.some(ds =>
    ds._verified && ds._verified.some(v => v === false)
  );
}

function updateCitationLine() {
  const el = document.getElementById("chartCitation");
  if (!el) return;
  const sources = getVisibleSources();
  el.innerHTML =
    `<button class="chart-action-btn" id="citationInfoBtn" title="View methodology">` +
    `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">` +
    `<circle cx="8" cy="8" r="6.25"/><path d="M8 7v4"/><circle cx="8" cy="5" r="0.5" fill="currentColor" stroke="none"/>` +
    `</svg></button>` +
    `<span>Source: ${sources.join(", ")}</span>`;
  document.getElementById("citationInfoBtn").addEventListener("click", () => {
    const target = document.getElementById("methodologySection") || document.getElementById("infoCard");
    if (target) target.scrollIntoView({ behavior: "smooth" });
  });
}

// ─── Initialize ──────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  try {
    showLoading(true);
    await loadData(); // from data-loader.js
    // Default to first active benchmark key
    if (!currentBenchmark || !BENCHMARKS[currentBenchmark]) {
      currentBenchmark = Object.keys(BENCHMARKS).find(k => isBenchmarkActive(k, getFilterEndDate())) || Object.keys(BENCHMARKS)[0];
    }
    populateDateRangeYears();
    renderModeToggle();
    renderFilterPills();
    renderChart();
    renderCustomLegend();
    updateCitationLine();
    renderInfoArea();
    showLoading(false);
    fetchAnalysis("all-time");

    // Wire date range dropdown
    document.getElementById("dateRange").addEventListener("change", (e) => {
      currentDateRange = e.target.value;
      applyDateRange();
      fetchAnalysis(currentDateRange);
    });
  } catch (err) {
    console.error("Failed to load data:", err);
    showError("Failed to load benchmark data. Please try refreshing the page.");
  }
});

function showLoading(show) {
  const container = document.querySelector(".chart-container");
  const existing = document.getElementById("loadingIndicator");
  if (show && !existing) {
    const el = document.createElement("div");
    el.id = "loadingIndicator";
    el.className = "chart-status";
    el.innerHTML = '<div class="spinner"></div>Loading benchmark data\u2026';
    container.appendChild(el);
  } else if (!show && existing) {
    existing.remove();
  }
}

function showError(message) {
  const container = document.querySelector(".chart-container");
  container.innerHTML = `<div class="chart-status error">${escapeHtml(message)}<button class="retry-btn" onclick="location.reload()">Try again</button></div>`;
}

// ─── Filter pills (benchmark tabs OR lab tabs) ──────────────
function renderFilterPills() {
  const container = document.getElementById("filterPills");
  container.innerHTML = "";

  if (currentMode === "race") {
    renderBenchmarkPills(container);
  } else if (currentMode === "cost") {
    // No pills — legend handles filtering via click-to-isolate
  } else {
    renderLabPills(container);
  }
}

function renderBenchmarkPills(container) {
  const filterEnd = getFilterEndDate();

  // Only show active benchmarks in Lab Race
  for (const [key, bench] of Object.entries(BENCHMARKS)) {
    if (!isBenchmarkActive(key, filterEnd)) continue;

    const btn = document.createElement("button");
    btn.className = `filter-pill${key === currentBenchmark ? " active" : ""}`;
    btn.dataset.key = key;

    const dot = document.createElement("span");
    dot.className = "pill-dot";
    dot.style.backgroundColor = CAPABILITY_COLORS[bench.capability] || "#6c9eff";

    btn.appendChild(dot);
    btn.appendChild(document.createTextNode(bench.name));

    btn.addEventListener("click", () => {
      currentBenchmark = key;
      container.querySelectorAll(".filter-pill").forEach(t => t.classList.remove("active"));
      btn.classList.add("active");
      isolatedIndex = null;
      updateChart();
      renderInfoArea();
    });

    container.appendChild(btn);
  }

  // If current benchmark is inactive, switch to first active one
  if (!isBenchmarkActive(currentBenchmark, filterEnd)) {
    const firstActive = Object.keys(BENCHMARKS).find(k => isBenchmarkActive(k, filterEnd));
    if (firstActive) {
      currentBenchmark = firstActive;
      container.querySelector(".filter-pill")?.classList.add("active");
    }
  }
}

function renderLabPills(container) {
  // "All Labs" pill
  const allBtn = document.createElement("button");
  allBtn.className = `filter-pill${selectedLab === null ? " active" : ""}`;
  allBtn.dataset.key = "all";
  allBtn.textContent = "All Labs";
  allBtn.addEventListener("click", () => {
    selectedLab = null;
    container.querySelectorAll(".filter-pill").forEach(t => t.classList.remove("active"));
    allBtn.classList.add("active");
    isolatedIndex = null;
    updateChart();
  });
  container.appendChild(allBtn);

  // One pill per lab. The coloured dot was removed — lab colours only matter
  // in the race-mode chart; in frontier mode they're visual noise on the filter.
  for (const [key, lab] of Object.entries(LABS)) {
    const btn = document.createElement("button");
    btn.className = `filter-pill${key === selectedLab ? " active" : ""}`;
    btn.dataset.key = key;
    btn.textContent = lab.name;

    btn.addEventListener("click", () => {
      selectedLab = key;
      container.querySelectorAll(".filter-pill").forEach(t => t.classList.remove("active"));
      btn.classList.add("active");
      isolatedIndex = null;
      updateChart();
    });

    container.appendChild(btn);
  }
}

function renderCostPills(container) {
  // "All Benchmarks" pill
  const allBtn = document.createElement("button");
  allBtn.className = `filter-pill${currentCostBenchmark === null ? " active" : ""}`;
  allBtn.dataset.key = "all";
  allBtn.textContent = "All Benchmarks";
  allBtn.addEventListener("click", () => {
    currentCostBenchmark = null;
    container.querySelectorAll(".filter-pill").forEach(t => t.classList.remove("active"));
    allBtn.classList.add("active");
    isolatedIndex = null;
    updateChart();
  });
  container.appendChild(allBtn);

  // One pill per cost benchmark
  for (const [key, meta] of Object.entries(COST_BENCHMARK_META)) {
    const btn = document.createElement("button");
    btn.className = `filter-pill${key === currentCostBenchmark ? " active" : ""}`;
    btn.dataset.key = key;

    const dot = document.createElement("span");
    dot.className = "pill-dot";
    dot.style.backgroundColor = meta.color;

    btn.appendChild(dot);
    btn.appendChild(document.createTextNode(`${meta.name} (${meta.thresholdLabel})`));

    btn.addEventListener("click", () => {
      currentCostBenchmark = key;
      container.querySelectorAll(".filter-pill").forEach(t => t.classList.remove("active"));
      btn.classList.add("active");
      isolatedIndex = null;
      updateChart();
    });

    container.appendChild(btn);
  }
}

// ─── Mode toggle ─────────────────────────────────────────────
function renderModeToggle() {
  document.querySelectorAll(".mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      currentMode = btn.dataset.mode;
      document.querySelectorAll(".mode-btn").forEach(b => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      isolatedIndex = null;
      highlightedInactiveIndex = null;
      selectedLab = null;
      currentCostBenchmark = null;
      renderFilterPills();
      updateChart(); // also calls renderCustomLegend() + updateCitationLine()
      renderInfoArea();
      renderAnalysisCard(currentMode);
    });
  });
}

// ─── Chart ───────────────────────────────────────────────────
function buildCostDatasets() {
  const keys = currentCostBenchmark ? [currentCostBenchmark] : Object.keys(COST_BENCHMARK_META);

  return keys.map(key => {
    const data = COST_DATA[key];
    if (!data) return null;

    const color = COST_BENCHMARK_COLORS[key];
    return {
      label: `${data.name} (${data.thresholdLabel})`,
      data: data.entries.map(e => e ? e.price : null),
      _models: data.entries.map(e => e ? e.model : null),
      _labs: data.entries.map(e => e ? e.lab : null),
      _scores: data.entries.map(e => e ? e.score : null),
      borderColor: color,
      backgroundColor: color + "33",
      borderWidth: 2.5,
      pointRadius: 4,
      pointHoverRadius: 6,
      pointBackgroundColor: color,
      tension: 0.3,
      spanGaps: true,
    };
  }).filter(Boolean);
}

function buildRaceDatasets() {
  const bench = BENCHMARKS[currentBenchmark];
  if (!bench) return [];

  return Object.entries(LABS).map(([labKey, lab]) => {
    const verifiedArr = bench.scores[labKey].map(d => d ? d.verified : true);
    const pointStyle = buildPointStyleArrays(verifiedArr, lab.color);
    return {
      label: lab.name,
      data: bench.scores[labKey].map(d => d ? d.score : null),
      _models: bench.scores[labKey].map(d => d ? d.model : null),
      _variants: bench.scores[labKey].map(d => d ? d.variant : null),
      _source: bench.scores[labKey].map(d => d ? d.source : null),
      _verified: verifiedArr,
      borderColor: lab.color,
      backgroundColor: lab.color + "33",
      borderWidth: 2.5,
      pointRadius: 4,
      pointHoverRadius: 6,
      ...pointStyle,
      tension: 0.3,
      spanGaps: true,
    };
  });
}

function buildFrontierDatasets() {
  const labKeys = selectedLab ? [selectedLab] : Object.keys(LABS);
  const filterEnd = getFilterEndDate();

  return Object.entries(BENCHMARKS).map(([benchKey, benchData]) => {
    const isInactive = !isBenchmarkActive(benchKey, filterEnd);
    const meta = BENCHMARK_META[benchKey];

    const frontierData = [];
    const frontierModels = [];
    const frontierVariants = [];
    const frontierLabs = [];
    const frontierVerified = [];
    const frontierSources = [];

    // Find the activeUntil quarter index for truncation
    let activeUntilIdx = TIME_LABELS.length - 1;
    if (isInactive && meta.activeUntil) {
      const idx = TIME_LABELS.indexOf(meta.activeUntil);
      if (idx >= 0) activeUntilIdx = idx;
    }

    // Get score at the inactivity point for truncation check
    let inactivityScore = null;

    for (let i = 0; i < TIME_LABELS.length; i++) {
      let bestScore = null;
      let bestModel = null;
      let bestVariant = null;
      let bestLab = null;
      let bestVerified = true;
      let bestSource = null;

      for (const labKey of labKeys) {
        const entry = benchData.scores[labKey][i];
        if (entry !== null && (bestScore === null || entry.score > bestScore)) {
          bestScore = entry.score;
          bestModel = entry.model;
          bestVariant = entry.variant ?? null;
          bestLab = labKey;
          bestVerified = entry.verified !== false;
          bestSource = entry.source || null;
        }
      }

      // Track score at inactivity point
      if (i === activeUntilIdx && bestScore !== null) {
        inactivityScore = bestScore;
      }

      // Truncate inactive lines: null out points after activeUntil unless >10pp improvement
      if (isInactive && i > activeUntilIdx) {
        if (inactivityScore !== null && bestScore !== null && (bestScore - inactivityScore) > 10) {
          // Significant improvement — keep the point
        } else {
          bestScore = null;
          bestModel = null;
          bestVariant = null;
          bestLab = null;
          bestVerified = true;
          bestSource = null;
        }
      }

      frontierData.push(bestScore);
      frontierModels.push(bestModel);
      frontierVariants.push(bestVariant);
      frontierLabs.push(bestLab);
      frontierVerified.push(bestVerified);
      frontierSources.push(bestSource);
    }

    const color = CAPABILITY_COLORS[meta.capability];
    const baseColor = isInactive ? INACTIVE_COLOR : color;
    const pointStyle = buildPointStyleArrays(frontierVerified, baseColor);
    const ds = {
      label: benchData.name,
      data: frontierData,
      _models: frontierModels,
      _variants: frontierVariants,
      _labs: frontierLabs,
      _source: frontierSources,
      _verified: frontierVerified,
      _benchKey: benchKey,
      _isInactive: isInactive,
      _inactiveReason: meta.inactiveReason || null,
      _activeUntil: meta.activeUntil || null,
      borderColor: baseColor,
      backgroundColor: baseColor + "33",
      borderWidth: isInactive ? INACTIVE_BORDER_WIDTH : 2.5,
      pointRadius: isInactive ? 2 : 4,
      pointHoverRadius: isInactive ? 4 : 6,
      ...pointStyle,
      pointHoverBackgroundColor: isInactive ? INACTIVE_COLOR : color,
      tension: 0.3,
      spanGaps: true,
      order: isInactive ? 1 : 0, // higher order draws first → behind; active stays on top
    };

    if (isInactive) {
      ds.borderDash = [4, 4];
    }

    return ds;
  });
}

function buildDatasets() {
  if (currentMode === "cost") return buildCostDatasets();
  if (currentMode === "race") return buildRaceDatasets();
  return buildFrontierDatasets();
}

// ─── Inactivity marker plugin ────────────────────────────────
// Renders per-dataset in afterDatasetDraw so the marker sits with its inactive line
// in z-order — active lines drawn later (lower `order` value) cover it where they
// cross, and tooltips drawn afterwards render on top. Previously used afterDraw, which
// put the marker above every dataset and every tooltip.
const inactivityMarkerPlugin = {
  id: "inactivityMarker",
  afterDatasetDraw(chart, args) {
    if (currentMode !== "frontier") return;
    const ds = chart.data.datasets[args.index];
    if (!ds._isInactive || !ds._activeUntil) return;
    if (!chart.isDatasetVisible(args.index)) return;

    const qIdx = TIME_LABELS.indexOf(ds._activeUntil);
    if (qIdx < 0) return;
    if (ds.data[qIdx] == null) return;

    const meta = chart.getDatasetMeta(args.index);
    const point = meta.data[qIdx];
    if (!point || point.skip) return;

    const ctx = chart.ctx;
    const x = point.x;
    const y = point.y;

    const r = 6;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = "#1a1d27";
    ctx.fill();
    ctx.strokeStyle = INACTIVE_COLOR;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const xr = 2.5;
    ctx.beginPath();
    ctx.moveTo(x - xr, y - xr);
    ctx.lineTo(x + xr, y + xr);
    ctx.moveTo(x + xr, y - xr);
    ctx.lineTo(x - xr, y + xr);
    ctx.strokeStyle = INACTIVE_COLOR;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  },
};

Chart.register(inactivityMarkerPlugin);

// ─── Endpoint label plugin ───────────────────────────────────
// Draws a small coloured label at the last data point of any dataset whose index
// is in endpointLabelTargets. Used by the "N defeated" hover/isolate flow to name
// each defeated line on the chart (same-colour lines need name labels to be
// distinguishable). If two labels would vertically overlap, the later one shifts
// down by labelH + 2px.
const endpointLabelPlugin = {
  id: "endpointLabel",
  afterDatasetsDraw(chart) {
    if (currentMode !== "frontier") return;
    if (!endpointLabelTargets || endpointLabelTargets.size === 0) return;

    const ctx = chart.ctx;
    const fontPx = Math.max(10, chartFontSize ? chartFontSize(11) : 11);
    ctx.save();
    ctx.font = `600 ${fontPx}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.textBaseline = "middle";

    // Collect target screen positions first so we can resolve y-collisions.
    const placements = [];
    for (const [idx, cfg] of endpointLabelTargets) {
      const ds = chart.data.datasets[idx];
      if (!ds || !chart.isDatasetVisible(idx)) continue;
      const meta = chart.getDatasetMeta(idx);
      // Find the last non-null point
      let pIdx = -1;
      for (let i = ds.data.length - 1; i >= 0; i--) {
        if (ds.data[i] != null) { pIdx = i; break; }
      }
      if (pIdx < 0) continue;
      const point = meta.data[pIdx];
      if (!point || point.skip) continue;
      placements.push({ x: point.x, y: point.y, label: cfg.label, color: cfg.color });
    }

    // Resolve overlaps top-to-bottom: if labels are within labelH of each other,
    // push the lower one further down.
    const labelH = fontPx + 8;
    placements.sort((a, b) => a.y - b.y);
    for (let i = 1; i < placements.length; i++) {
      const prev = placements[i - 1];
      const cur = placements[i];
      if (cur.y - prev.y < labelH) cur.y = prev.y + labelH;
    }

    const padX = 6;
    const padY = 3;
    for (const p of placements) {
      const textW = ctx.measureText(p.label).width;
      const boxW = textW + padX * 2;
      const boxH = fontPx + padY * 2;
      // Anchor the label so it sits just to the left of the endpoint when there's
      // not enough room to the right (right-edge chart cases).
      let boxX = p.x + 8;
      if (boxX + boxW > chart.chartArea.right) boxX = p.x - boxW - 8;
      const boxY = p.y - boxH / 2;

      ctx.fillStyle = p.color + "B3"; // ~70% alpha
      const r = 3;
      // Rounded rect
      ctx.beginPath();
      ctx.moveTo(boxX + r, boxY);
      ctx.lineTo(boxX + boxW - r, boxY);
      ctx.quadraticCurveTo(boxX + boxW, boxY, boxX + boxW, boxY + r);
      ctx.lineTo(boxX + boxW, boxY + boxH - r);
      ctx.quadraticCurveTo(boxX + boxW, boxY + boxH, boxX + boxW - r, boxY + boxH);
      ctx.lineTo(boxX + r, boxY + boxH);
      ctx.quadraticCurveTo(boxX, boxY + boxH, boxX, boxY + boxH - r);
      ctx.lineTo(boxX, boxY + r);
      ctx.quadraticCurveTo(boxX, boxY, boxX + r, boxY);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "left";
      ctx.fillText(p.label, boxX + padX, p.y);
    }

    ctx.restore();
  },
};

Chart.register(endpointLabelPlugin);

// Allow points to draw slightly past the chart area on the right (into layout padding)
// so markers at the last quarter aren't clipped. Positive = allow overflow.
Chart.defaults.datasets.line.clip = { left: 0, top: 5, right: 15, bottom: 5 };

function showChartMessage(message) {
  let overlay = document.getElementById("chartMessage");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "chartMessage";
    overlay.className = "chart-status chart-overlay";
    document.querySelector(".chart-canvas-wrapper").appendChild(overlay);
  }
  overlay.textContent = message;
}

function clearChartMessage() {
  const el = document.getElementById("chartMessage");
  if (el) el.remove();
}

/** Check if any dataset has a non-null value within the current date range. */
function hasVisibleDataInRange() {
  if (!chart) return false;
  const dateBounds = computeDateBounds(currentDateRange);
  const startIdx = dateBounds.startLabel ? TIME_LABELS.indexOf(dateBounds.startLabel) : 0;
  const endIdx = dateBounds.endLabel ? TIME_LABELS.indexOf(dateBounds.endLabel) : TIME_LABELS.length - 1;
  if (startIdx < 0 || endIdx < 0) return false;
  return chart.data.datasets.some(ds =>
    ds.data.slice(startIdx, endIdx + 1).some(v => v !== null)
  );
}

function getEmptyStateMessage() {
  if (currentMode === "race" && currentBenchmark && BENCHMARKS[currentBenchmark]) {
    return `No data for ${BENCHMARKS[currentBenchmark].name} in this period.`;
  }
  return "No data available for this view.";
}

function renderChart() {
  clearChartMessage();
  const ctx = document.getElementById("benchmarkChart").getContext("2d");
  const isCost = currentMode === "cost";
  chartMode = currentMode;

  // Cost data failed to load — show message instead of chart
  if (isCost && costLoadFailed) {
    chart = new Chart(ctx, {
      type: "line",
      data: { labels: [], datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        devicePixelRatio: CHART_DPR,
      },
    });
    showChartMessage("Cost data is temporarily unavailable. Please try again later.");
    return;
  }

  const yScale = isCost
    ? {
        type: "logarithmic",
        title: { display: true, text: "$/M tokens", color: "#808690", font: { size: chartFontSize(11) }, padding: { top: 0, bottom: 0 } },
        grid: { color: GRID_COLOR },
        ticks: {
          color: "#808690",
          font: { size: chartFontSize(11) },
          callback: val => {
            // Only show powers of 10 (e.g. $0.01, $0.10, $1, $10)
            if (Math.abs(Math.log10(val) - Math.round(Math.log10(val))) > 0.001) return null;
            if (val >= 1) return "$" + val.toFixed(0);
            if (val >= 0.1) return "$" + val.toFixed(1);
            return "$" + val.toFixed(2);
          },
        },
      }
    : {
        min: 0,
        max: 100,
        grid: { color: GRID_COLOR },
        ticks: {
          color: "#808690",
          font: { size: chartFontSize(11) },
          callback: val => val + "%",
        },
      };

  const tooltipLabel = isCost
    ? function(context) {
        const val = context.parsed.y;
        if (val === null) return null;
        const model = context.dataset._models?.[context.dataIndex];
        const lab = context.dataset._labs?.[context.dataIndex];
        const score = context.dataset._scores?.[context.dataIndex];
        let line = `${context.dataset.label}: $${val < 1 ? val.toFixed(3) : val.toFixed(2)}/M tokens`;
        if (model) line += `\n  Model: ${model}`;
        if (lab) line += ` (${lab})`;
        if (score != null) line += `\n  Score: ${score}%`;
        return line.split("\n");
      }
    : function(context) {
        const val = context.parsed.y;
        if (val === null) return null;
        const model = context.dataset._models?.[context.dataIndex];
        const labKey = context.dataset._labs?.[context.dataIndex];
        const labName = labKey ? (LABS[labKey]?.name || labKey) : null;
        // Defensive trim: pre-normalized writes should yield clean strings, but
        // tolerate stale rows with whitespace by ignoring effectively-empty values.
        const rawVariant = context.dataset._variants?.[context.dataIndex];
        const variant = (typeof rawVariant === "string" && rawVariant.trim() !== "") ? rawVariant.trim() : null;
        const modelLabel = model && variant ? `${model} [${variant}]` : model;
        let line = `${context.dataset.label}: ${val.toFixed(1)}%`;
        if (modelLabel && labName) {
          line += ` (${modelLabel}, ${labName})`;
        } else if (modelLabel) {
          line += ` (${modelLabel})`;
        }
        // OSWorld-Verified absorbed the original OSWorld timeline; mark pre-Q3 2025
        // points so readers know that section of the line is original-OSWorld data.
        const benchKey = context.dataset._benchKey;
        const quarter = TIME_LABELS[context.dataIndex];
        if (benchKey === "osworld-verified" && quarter && compareQuarters(quarter, "Q3 2025") < 0) {
          line += ` · Original OSWorld`;
        }
        const isVerified = context.dataset._verified?.[context.dataIndex] !== false;
        const rawSource = context.dataset._source?.[context.dataIndex];
        if (!isVerified) {
          line += ` · Unverified (model card)`;
        } else if (rawSource) {
          line += ` · ${SOURCE_DISPLAY_MAP[rawSource] || rawSource}`;
        }
        return line;
      };

  const dateBounds = computeDateBounds(currentDateRange);

  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: TIME_LABELS,
      datasets: buildDatasets(),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 15 } },
      interaction: {
        mode: "index",
        intersect: false,
      },
      hover: {
        mode: "nearest",
        intersect: false,
      },
      onHover: () => {}, // inactive line hover is handled via legend, not chart area
      plugins: {
        legend: {
          display: false, // we use a custom HTML legend
        },
        tooltip: {
          enabled: window.innerWidth > MOBILE_BREAKPOINT,
          backgroundColor: "#1a1d27",
          titleColor: "#e8eaed",
          bodyColor: "#9aa0a6",
          borderColor: "#2d3140",
          borderWidth: 1,
          padding: chartFontSize(12),
          cornerRadius: 8,
          titleFont: { size: chartFontSize(13) },
          bodyFont: { size: chartFontSize(12) },
          filter: (tooltipItem) => {
            return !tooltipItem.dataset._isInactive;
          },
          callbacks: { label: tooltipLabel },
        },
      },
      scales: {
        x: {
          grid: { color: GRID_COLOR },
          ticks: { color: "#808690", font: { size: chartFontSize(11) } },
          min: dateBounds.startLabel || undefined,
          max: dateBounds.endLabel || undefined,
        },
        y: yScale,
      },
      devicePixelRatio: CHART_DPR,
    },
  });

  // Empty state: check if any data exists in the visible date range
  if (!hasVisibleDataInRange()) {
    showChartMessage(getEmptyStateMessage());
  }
}

// ─── Custom HTML Legend ──────────────────────────────────────
function renderCustomLegend() {
  const container = document.getElementById("chartLegend");
  container.innerHTML = "";
  // Always strip the frontier-grid class so it doesn't leak into race/cost modes.
  container.classList.remove("frontier-grid");

  if (!chart) return;

  const datasets = chart.data.datasets;
  const activeItems = [];
  const inactiveItems = [];

  datasets.forEach((ds, i) => {
    if (ds._isInactive) {
      inactiveItems.push({ ds, idx: i });
    } else {
      activeItems.push({ ds, idx: i });
    }
  });

  const isMobile = window.innerWidth <= MOBILE_BREAKPOINT;

  // Frontier mode on desktop: capability-grouped 6-column grid.
  // Frontier on mobile + race/cost modes: original flat-list layout.
  if (currentMode === "frontier" && !isMobile) {
    renderFrontierGrid(container, activeItems, inactiveItems);
  } else {
    renderFlatLegend(container, activeItems, inactiveItems, isMobile);
  }
}

// Group datasets by their benchmark's capability, splitting active vs. inactive.
// Returns { "Coding": { active: [{ds, idx}], inactive: [...] }, ... } seeded with
// every entry in CAPABILITIES (so empty capabilities still get rendered as a column
// header — currently unused but kept for taxonomy completeness).
function groupDatasetsByCapability(activeItems, inactiveItems) {
  const grouped = {};
  for (const cap of CAPABILITIES) grouped[cap] = { active: [], inactive: [] };
  const assign = (items, key) => {
    for (const item of items) {
      const meta = BENCHMARK_META[item.ds._benchKey];
      const cap = meta?.capability;
      if (cap && grouped[cap]) grouped[cap][key].push(item);
    }
  };
  assign(activeItems, "active");
  assign(inactiveItems, "inactive");
  return grouped;
}

function renderFrontierGrid(container, activeItems, inactiveItems) {
  container.classList.add("frontier-grid");
  const grouped = groupDatasetsByCapability(activeItems, inactiveItems);

  for (const cap of CAPABILITIES) {
    const col = document.createElement("div");
    col.className = "legend-column";
    col.appendChild(renderCapabilityHeader(cap));

    for (const { ds, idx } of grouped[cap].active) {
      col.appendChild(createLegendButton(ds, idx, false));
    }

    if (grouped[cap].inactive.length > 0) {
      col.appendChild(renderDefeatedLink(cap, grouped[cap].inactive));
    }

    container.appendChild(col);
  }
}

// Blend a hex colour with white by `mix` proportion (0-1). Used to derive the
// lighter "header" hue from the saturated capability line colour — a 0.45 mix
// gives a pastel header that reads as the capability without competing
// with the white-on-dark active benchmark name below it.
function lightenHex(hex, mix) {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const nr = Math.round(r + (255 - r) * mix);
  const ng = Math.round(g + (255 - g) * mix);
  const nb = Math.round(b + (255 - b) * mix);
  return "#" + [nr, ng, nb].map(v => v.toString(16).padStart(2, "0")).join("");
}

function renderFlatLegend(container, activeItems, inactiveItems, isMobile) {
  activeItems.forEach(({ ds, idx }) => {
    container.appendChild(createLegendButton(ds, idx, false));
  });

  // Inactive section only in frontier mode (we only reach here on mobile in that case;
  // race/cost modes never have _isInactive datasets in the current data model).
  if (inactiveItems.length > 0 && currentMode === "frontier" && !isMobile) {
    const divider = document.createElement("div");
    divider.className = "legend-divider";
    container.appendChild(divider);

    const label = document.createElement("span");
    label.className = "legend-section-label";
    label.textContent = "Major Benchmarks ~Defeated";
    container.appendChild(label);

    inactiveItems.forEach(({ ds, idx }) => {
      container.appendChild(createLegendButton(ds, idx, true));
    });
  }
}

function renderCapabilityHeader(capName) {
  const header = document.createElement("div");
  header.className = "legend-cap-header";
  // Text in a span so text-overflow: ellipsis works inside the flex layout.
  const text = document.createElement("span");
  text.className = "legend-cap-header-text";
  text.textContent = capName;
  const capColor = CAPABILITY_COLORS[capName];
  if (capColor) text.style.color = lightenHex(capColor, 0.45);
  header.appendChild(text);
  return header;
}

function renderDefeatedLink(capName, inactiveItems) {
  const btn = document.createElement("button");
  btn.className = "legend-defeated-link";
  if (isolatedCapability === capName) btn.classList.add("isolated");

  const n = inactiveItems.length;
  btn.textContent = `${n} defeated`;

  btn.addEventListener("mouseenter", (e) => {
    highlightCapabilityDefeated(capName, inactiveItems);
    showMultiBenchmarkTooltip(inactiveItems.map(i => i.ds), e.clientX, e.clientY);
  });
  btn.addEventListener("mouseleave", () => {
    unhighlightCapabilityDefeated();
    hideInactiveTooltip();
  });
  btn.addEventListener("click", () => {
    // Clear any hover highlight before toggling
    unhighlightCapabilityDefeated();
    toggleIsolateCapabilityDefeated(capName, inactiveItems);
    renderCustomLegend();
  });

  return btn;
}

function createLegendButton(ds, idx, isInactive) {
  const btn = document.createElement("button");
  btn.className = `legend-item${isInactive ? " inactive" : ""}`;
  if (!chart.isDatasetVisible(idx)) btn.classList.add("hidden");

  const dot = document.createElement("span");
  dot.className = "legend-dot";
  dot.style.backgroundColor = isInactive ? INACTIVE_COLOR : ds.borderColor;
  btn.appendChild(dot);

  const text = document.createTextNode(ds.label);
  btn.appendChild(text);

  // Click: isolate / restore
  btn.addEventListener("click", () => {
    // Clear any hover highlight + group state before toggling individual isolation
    if (highlightedInactiveIndex !== null) {
      unhighlightInactive(highlightedInactiveIndex);
    }
    if (isolatedCapability !== null) {
      isolatedCapability = null;
      endpointLabelTargets.clear();
    }
    handleLegendClick(idx);
    renderCustomLegend();
  });

  // Hover: highlight inactive lines + show tooltip
  if (isInactive) {
    btn.addEventListener("mouseenter", (e) => {
      highlightInactive(idx);
      showInactiveTooltip(ds, e.clientX, e.clientY);
    });
    btn.addEventListener("mouseleave", () => {
      unhighlightInactive(idx);
      hideInactiveTooltip();
    });
  }

  return btn;
}

// ─── Legend click: isolate / restore ─────────────────────────
function handleLegendClick(clickedIndex) {
  if (isolatedIndex === clickedIndex) {
    // Restore all
    isolatedIndex = null;
    chart.data.datasets.forEach((ds, i) => {
      chart.setDatasetVisibility(i, true);
      if (ds._isInactive) resetInactiveStyle(ds);
    });
  } else {
    // Isolate one
    isolatedIndex = clickedIndex;
    const clickedDs = chart.data.datasets[clickedIndex];
    chart.data.datasets.forEach((ds, i) => {
      chart.setDatasetVisibility(i, i === clickedIndex);
      // Show the isolated inactive benchmark in color
      if (i === clickedIndex && ds._isInactive) {
        applyActiveStyle(ds);
      } else if (ds._isInactive) {
        resetInactiveStyle(ds);
      }
    });
  }

  chart.update();
}

// ─── Capability defeated-group highlight + isolation ─────────
// Hovering "N defeated" lights up all defeated lines in that capability in the
// capability colour, paints endpoint labels at each line's last data point, and
// shows a multi-benchmark tooltip. Click toggles full isolation (other lines hidden).

function highlightCapabilityDefeated(capName, inactiveItems) {
  if (highlightedCapability === capName) return;
  if (highlightedCapability !== null) unhighlightCapabilityDefeated();
  highlightedCapability = capName;

  // If a different capability is currently click-isolated, the other capability's
  // datasets aren't visible anyway — skip the chart-visual updates so we don't
  // stomp on the isolated capability's endpoint labels. The tooltip still shows.
  if (isolatedCapability !== null && isolatedCapability !== capName) {
    return;
  }

  inactiveItems.forEach(({ ds }) => applyActiveStyle(ds));

  const color = CAPABILITY_COLORS[capName] || INACTIVE_COLOR;
  endpointLabelTargets.clear();
  for (const { ds, idx } of inactiveItems) {
    endpointLabelTargets.set(idx, { color, label: ds.label });
  }
  chart.update("none");
}

function unhighlightCapabilityDefeated() {
  if (highlightedCapability === null) return;
  highlightedCapability = null;
  // Don't reset styles for the capability that's currently click-isolated.
  if (isolatedCapability) {
    // Click-isolation keeps its own coloured state; just stop drawing endpoint labels
    // for the hover-only case (they're re-set by the isolation logic if still active).
    return;
  }
  chart.data.datasets.forEach((ds) => {
    if (ds._isInactive && chart.data.datasets.indexOf(ds) !== isolatedIndex) {
      resetInactiveStyle(ds);
    }
  });
  endpointLabelTargets.clear();
  chart.update("none");
}

function toggleIsolateCapabilityDefeated(capName, inactiveItems) {
  if (isolatedCapability === capName) {
    // Restore all
    isolatedCapability = null;
    endpointLabelTargets.clear();
    chart.data.datasets.forEach((ds, i) => {
      chart.setDatasetVisibility(i, true);
      if (ds._isInactive) resetInactiveStyle(ds);
    });
  } else {
    // Isolate the group
    isolatedCapability = capName;
    isolatedIndex = null;
    const keepIdx = new Set(inactiveItems.map(({ idx }) => idx));
    chart.data.datasets.forEach((ds, i) => {
      chart.setDatasetVisibility(i, keepIdx.has(i));
      if (keepIdx.has(i) && ds._isInactive) {
        applyActiveStyle(ds);
      } else if (ds._isInactive) {
        resetInactiveStyle(ds);
      }
    });
    const color = CAPABILITY_COLORS[capName] || INACTIVE_COLOR;
    endpointLabelTargets.clear();
    for (const { ds, idx } of inactiveItems) {
      endpointLabelTargets.set(idx, { color, label: ds.label });
    }
  }
  chart.update();
}

// ─── Inactive line styling helpers ───────────────────────────
function applyActiveStyle(ds) {
  const color = CAPABILITY_COLORS[BENCHMARK_META[ds._benchKey]?.capability] || ds.borderColor;
  ds.borderColor = color;
  ds.backgroundColor = color + "33";
  ds.pointHoverBackgroundColor = color;
  ds.pointRadius = 4;
  ds.pointHoverRadius = 6;
  ds.borderWidth = 2.5;
  ds.borderDash = [];
  ds.order = -1;

  // Rebuild per-point arrays if verified data exists
  if (ds._verified) {
    const style = buildPointStyleArrays(ds._verified, color);
    ds.pointBackgroundColor = style.pointBackgroundColor;
    ds.pointBorderColor = style.pointBorderColor;
    ds.pointBorderWidth = style.pointBorderWidth;
  } else {
    ds.pointBackgroundColor = color;
  }

  // Also update resolved element options for immediate visual effect
  const dsIndex = chart.data.datasets.indexOf(ds);
  if (dsIndex >= 0) {
    const meta = chart.getDatasetMeta(dsIndex);
    if (meta.dataset && meta.dataset.options) {
      meta.dataset.options.borderColor = color;
      meta.dataset.options.borderWidth = 2.5;
      meta.dataset.options.borderDash = [];
    }
    meta.data.forEach((pt, idx) => {
      if (pt && pt.options) {
        const isUnverified = ds._verified && ds._verified[idx] === false;
        pt.options.backgroundColor = isUnverified ? "transparent" : color;
        pt.options.borderColor = color;
        pt.options.borderWidth = isUnverified ? 2 : 1;
        pt.options.hoverBackgroundColor = color;
        pt.options.radius = 4;
        pt.options.hoverRadius = 6;
      }
    });
  }
}

function resetInactiveStyle(ds) {
  ds.borderColor = INACTIVE_COLOR;
  ds.backgroundColor = INACTIVE_COLOR + "33";
  ds.pointHoverBackgroundColor = INACTIVE_COLOR;
  ds.pointRadius = 2;
  ds.pointHoverRadius = 4;
  ds.borderWidth = INACTIVE_BORDER_WIDTH;
  ds.borderDash = [4, 4];
  ds.order = 1;

  // Rebuild per-point arrays if verified data exists
  if (ds._verified) {
    const style = buildPointStyleArrays(ds._verified, INACTIVE_COLOR);
    ds.pointBackgroundColor = style.pointBackgroundColor;
    ds.pointBorderColor = style.pointBorderColor;
    ds.pointBorderWidth = style.pointBorderWidth;
  } else {
    ds.pointBackgroundColor = INACTIVE_COLOR;
  }

  // Also update resolved element options
  const dsIndex = chart.data.datasets.indexOf(ds);
  if (dsIndex >= 0) {
    const meta = chart.getDatasetMeta(dsIndex);
    if (meta.dataset && meta.dataset.options) {
      meta.dataset.options.borderColor = INACTIVE_COLOR;
      meta.dataset.options.borderWidth = INACTIVE_BORDER_WIDTH;
      meta.dataset.options.borderDash = [4, 4];
    }
    meta.data.forEach((pt, idx) => {
      if (pt && pt.options) {
        const isUnverified = ds._verified && ds._verified[idx] === false;
        pt.options.backgroundColor = isUnverified ? "transparent" : INACTIVE_COLOR;
        pt.options.borderColor = INACTIVE_COLOR;
        pt.options.borderWidth = isUnverified ? 2 : 1;
        pt.options.hoverBackgroundColor = INACTIVE_COLOR;
        pt.options.radius = 2;
        pt.options.hoverRadius = 4;
      }
    });
  }
}

// ─── Hover highlight for inactive lines ─────────────────────
function highlightInactive(datasetIndex) {
  if (!chart) return;
  // If switching from one inactive line to another, unhighlight the old one
  if (highlightedInactiveIndex !== null && highlightedInactiveIndex !== datasetIndex) {
    const oldDs = chart.data.datasets[highlightedInactiveIndex];
    if (oldDs && oldDs._isInactive) resetInactiveStyle(oldDs);
  }
  if (highlightedInactiveIndex === datasetIndex) return;

  const ds = chart.data.datasets[datasetIndex];
  if (!ds || !ds._isInactive) return;

  highlightedInactiveIndex = datasetIndex;
  applyActiveStyle(ds);
  chart.update("none");
}

function unhighlightInactive(datasetIndex) {
  if (!chart || highlightedInactiveIndex !== datasetIndex) return;
  const ds = chart.data.datasets[datasetIndex];
  if (!ds || !ds._isInactive) return;

  highlightedInactiveIndex = null;
  // Don't reset style if this benchmark is currently isolated (should stay colored)
  if (isolatedIndex === datasetIndex) return;
  resetInactiveStyle(ds);
  chart.update("none");
}

// ─── Inactive tooltip ────────────────────────────────────────
let inactiveTooltipEl = null;

function getOrCreateInactiveTooltip() {
  if (!inactiveTooltipEl) {
    inactiveTooltipEl = document.createElement("div");
    inactiveTooltipEl.className = "inactive-tooltip";
    document.body.appendChild(inactiveTooltipEl);
  }
  return inactiveTooltipEl;
}

// Build one row of tooltip HTML for an inactive dataset: name + status badge + peak line.
// Reason text intentionally omitted (peak score conveys the saturation story; deeper
// context lives in the methodology section).
function buildInactiveTooltipRowHtml(ds) {
  const meta = BENCHMARK_META[ds._benchKey];
  if (!meta) return "";

  const statusLabel = meta.status === "deprecated" ? "Deprecated" : "Saturated";
  const statusClass = meta.status === "deprecated" ? "deprecated" : "saturated";

  // Find the latest non-null data point
  let latestScore = null;
  let latestModel = null;
  let latestLab = null;
  let latestQuarter = null;
  for (let i = ds.data.length - 1; i >= 0; i--) {
    if (ds.data[i] != null) {
      latestScore = ds.data[i];
      latestModel = ds._models[i];
      latestLab = ds._labs ? ds._labs[i] : null;
      latestQuarter = TIME_LABELS[i];
      break;
    }
  }

  const labName = latestLab ? (LABS[latestLab]?.name || latestLab) : null;
  const safeName = escapeHtml(ds.label);
  const safeModel = latestModel ? escapeHtml(latestModel) : null;
  const safeLabName = labName ? escapeHtml(labName) : null;

  let html = `<div class="inactive-tooltip-row">`;
  html += `<div class="inactive-tooltip-name">${safeName} <span class="status-badge ${statusClass}">${statusLabel} ${meta.activeUntil || ""}</span></div>`;
  if (latestScore !== null) {
    html += `<div class="inactive-tooltip-score">Peak: ${latestScore.toFixed(1)}%`;
    if (safeModel && safeLabName) html += ` (${safeModel}, ${safeLabName})`;
    else if (safeModel) html += ` (${safeModel})`;
    if (latestQuarter) html += ` \u2014 ${latestQuarter}`;
    html += `</div>`;
  }
  html += `</div>`;
  return html;
}

function positionTooltip(tip, clientX, clientY) {
  tip.style.display = "block";
  const rect = tip.getBoundingClientRect();
  let left = clientX - rect.width / 2;
  let top = clientY - rect.height - 16;
  if (left < 8) left = 8;
  if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
  if (top < 8) top = clientY + 20; // flip below if no room above
  tip.style.left = left + "px";
  tip.style.top = top + "px";
}

function showInactiveTooltip(ds, clientX, clientY) {
  const tip = getOrCreateInactiveTooltip();
  tip.innerHTML = buildInactiveTooltipRowHtml(ds);
  positionTooltip(tip, clientX, clientY);
}

// Multi-benchmark tooltip used by "N defeated" hover. Stacks one row per defeated dataset.
function showMultiBenchmarkTooltip(datasets, clientX, clientY) {
  const tip = getOrCreateInactiveTooltip();
  tip.innerHTML = datasets.map(buildInactiveTooltipRowHtml).join("");
  positionTooltip(tip, clientX, clientY);
}

function hideInactiveTooltip() {
  if (inactiveTooltipEl) inactiveTooltipEl.style.display = "none";
}

function updateChart() {
  isolatedIndex = null;
  highlightedInactiveIndex = null;
  isolatedCapability = null;
  highlightedCapability = null;
  endpointLabelTargets.clear();
  hideInactiveTooltip();
  clearChartMessage();

  // If switching between cost and non-cost, destroy and recreate (scale type changes)
  const needsCost = currentMode === "cost";
  const hadCost = chartMode === "cost";
  if (needsCost !== hadCost) {
    chart.destroy();
    renderChart();
    renderCustomLegend();
    updateCitationLine();
    return;
  }

  chart.data.datasets = buildDatasets();
  chart.data.datasets.forEach((_, i) => chart.setDatasetVisibility(i, true));
  applyDateRange();
  renderCustomLegend();
  updateCitationLine();

  // Check empty state after update
  if (!hasVisibleDataInRange()) {
    showChartMessage(getEmptyStateMessage());
  }
}

// ─── Info area ───────────────────────────────────────────────
function renderInfoArea() {
  const card = document.getElementById("infoCard");

  const filterEnd = getFilterEndDate();

  // Methodology intro varies by mode
  const methodologyText = currentMode === "cost"
    ? "Shows the cheapest model (any lab) scoring above a fixed threshold on each benchmark, measured in $/M tokens (blended 3:1 input:output). Thresholds are set at what the best model scored when each benchmark launched. Uses cumulative minimum: once a cheaper model exists, the price floor never rises."
    : 'Scores use independently verified sources wherever available (Artificial Analysis, Epoch AI, ARC Prize, SWE-bench, Scale AI SEAL), shown as solid dots. Where no independent evaluation exists yet, self-reported model card scores from official lab announcements are used, shown as <strong>hollow dots</strong>.';

  let html = `
    <div class="methodology-intro" id="methodologySection">
      <p>${methodologyText}</p>
    </div>
  `;
  html += '<div class="benchmark-list">';

  if (currentMode === "cost") {
    for (const [key, meta] of Object.entries(COST_BENCHMARK_META)) {
      const color = COST_BENCHMARK_COLORS[key] || "#6c9eff";
      html += `
        <div class="benchmark-item">
          <button class="benchmark-item-header" aria-expanded="false">
            <span class="pill-dot" style="background-color: ${color}"></span>
            <span class="benchmark-item-name">${meta.name}</span>
            <span class="expand-icon">+</span>
          </button>
          <div class="benchmark-item-detail" hidden>
            <p>${meta.description}</p>
            ${meta.link ? `<a href="${meta.link}" target="_blank" rel="noopener">Learn more &rarr;</a>` : ""}
          </div>
        </div>
      `;
    }
  } else {
    // Group benchmarks by capability in CAPABILITIES order. Within each
    // capability: active first, then inactive (mirrors the legend's
    // header \u2192 active \u2192 "N defeated" structure).
    const benchKeysByCapability = {};
    for (const cap of CAPABILITIES) benchKeysByCapability[cap] = { active: [], inactive: [] };
    for (const [key, bench] of Object.entries(BENCHMARKS)) {
      const meta = BENCHMARK_META[key];
      if (!meta || !benchKeysByCapability[meta.capability]) continue;
      const isInactive = !isBenchmarkActive(key, filterEnd);
      benchKeysByCapability[meta.capability][isInactive ? "inactive" : "active"].push(key);
    }

    for (const cap of CAPABILITIES) {
      const group = benchKeysByCapability[cap];
      const orderedKeys = [...group.active, ...group.inactive];
      for (const key of orderedKeys) {
        const bench = BENCHMARKS[key];
        const isOpen = false;
        const isInactive = !isBenchmarkActive(key, filterEnd);
        const meta = BENCHMARK_META[key];
        const capColor = CAPABILITY_COLORS[meta?.capability] || INACTIVE_COLOR;
        // Capability label always reflects the capability, regardless of lifecycle.
        const badgeColor = lightenHex(capColor, 0.45);
        // Dot mirrors the chart line colour \u2014 grey for inactive, capability colour for active.
        const dotColor = isInactive ? INACTIVE_COLOR : capColor;

        // Status badge
        let statusBadge = "";
        if (isInactive && meta.status === "deprecated") {
          statusBadge = `<span class="status-badge deprecated">Deprecated ${meta.activeUntil}</span>`;
        } else if (isInactive && meta.status === "saturated") {
          statusBadge = `<span class="status-badge saturated">Saturated ${meta.activeUntil}</span>`;
        }

        // Description with inactive reason
        let description = bench.description;
        if (isInactive && meta.inactiveReason) {
          description += ` <em style="color:var(--text-muted);">${meta.inactiveReason}.</em>`;
        }

        html += `
          <div class="benchmark-item" data-bench="${key}">
            <button class="benchmark-item-header" aria-expanded="${isOpen}">
              <span class="pill-dot" style="background-color: ${dotColor}"></span>
              <span class="benchmark-item-name">${bench.name}</span>
              <span class="category-badge" style="color: ${badgeColor}; background: transparent">${bench.capability}</span>
              ${statusBadge}
              <span class="expand-icon">${isOpen ? "\u2212" : "+"}</span>
            </button>
            <div class="benchmark-item-detail"${isOpen ? "" : " hidden"}>
              <p>${description}</p>
              <a href="${bench.link}" target="_blank" rel="noopener">Learn more &rarr;</a>
            </div>
          </div>
        `;
      }
    }
  }

  html += '</div>';
  card.innerHTML = html;

  // Attach toggle listeners
  card.querySelectorAll(".benchmark-item-header").forEach(header => {
    header.addEventListener("click", () => {
      const item = header.closest(".benchmark-item");
      const detail = item.querySelector(".benchmark-item-detail");
      const icon = header.querySelector(".expand-icon");
      const isOpen = !detail.hidden;

      card.querySelectorAll(".benchmark-item-detail").forEach(d => d.hidden = true);
      card.querySelectorAll(".expand-icon").forEach(ic => ic.textContent = "+");
      card.querySelectorAll(".benchmark-item-header").forEach(h => h.setAttribute("aria-expanded", "false"));

      if (!isOpen) {
        detail.hidden = false;
        icon.textContent = "\u2212";
        header.setAttribute("aria-expanded", "true");
      }
    });
  });
}

// ─── Date Range ──────────────────────────────────────────────
function populateDateRangeYears() {
  const select = document.getElementById("dateRange");
  const years = [...new Set(TIME_LABELS.map(q => q.substring(3)))];
  for (const year of years) {
    // Skip single-quarter years (no meaningful change to show)
    const quartersInYear = TIME_LABELS.filter(q => q.endsWith(year));
    if (quartersInYear.length <= 1) continue;
    if (parseInt(year) < 2024) continue;
    const opt = document.createElement("option");
    opt.value = year;
    opt.textContent = year;
    select.appendChild(opt);
  }
}

function computeDateBounds(preset) {
  if (preset === "all-time") return { startLabel: null, endLabel: null };

  const endIdx = TIME_LABELS.length - 1;

  if (preset === "last-12-months") {
    const si = Math.max(0, endIdx - 4);
    return { startLabel: TIME_LABELS[si], endLabel: TIME_LABELS[endIdx] };
  }
  if (preset === "last-6-months") {
    const si = Math.max(0, endIdx - 2);
    return { startLabel: TIME_LABELS[si], endLabel: TIME_LABELS[endIdx] };
  }
  if (preset === "last-3-months") {
    const si = Math.max(0, endIdx - 1);
    return { startLabel: TIME_LABELS[si], endLabel: TIME_LABELS[endIdx] };
  }

  // Year preset
  const year = parseInt(preset);
  if (!isNaN(year)) {
    const q1 = `Q1 ${year}`;
    const q4 = `Q4 ${year}`;
    const si = TIME_LABELS.indexOf(q1);
    const ei = TIME_LABELS.indexOf(q4);
    return {
      startLabel: si >= 0 ? TIME_LABELS[si] : TIME_LABELS[0],
      endLabel: ei >= 0 ? TIME_LABELS[ei] : TIME_LABELS[endIdx],
    };
  }

  return { startLabel: null, endLabel: null };
}

function applyDateRange() {
  if (!chart) return;
  const { startLabel, endLabel } = computeDateBounds(currentDateRange);
  chart.options.scales.x.min = startLabel || undefined;
  chart.options.scales.x.max = endLabel || undefined;
  chart.update();
}

// ─── Analysis fetch & render ─────────────────────────────────
async function fetchAnalysis(preset) {
  const section = document.getElementById("analysisSection");
  section.innerHTML = '<div class="analysis-loading-inline"><div class="spinner"></div></div>';

  try {
    const url = `${SUPABASE_URL}/rest/v1/cached_analyses?date_range=eq.${encodeURIComponent(preset)}&select=analysis&limit=1`;
    const resp = await fetch(url, {
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const rows = await resp.json();

    if (rows.length === 0 || !rows[0].analysis) {
      cachedAnalysis = null;
      section.innerHTML = '<div class="analysis-empty">No analysis available for this time range.</div>';
      return;
    }

    try {
      cachedAnalysis = JSON.parse(rows[0].analysis);
    } catch (e) {
      cachedAnalysis = null;
      section.innerHTML = '<div class="analysis-empty">Failed to parse analysis data.</div>';
      return;
    }

    renderAnalysisCard(currentMode);
  } catch (err) {
    console.error("Failed to fetch analysis:", err);
    cachedAnalysis = null;
    section.innerHTML = '<div class="analysis-empty">Failed to load analysis.</div>';
  }
}

function renderAnalysisCard(mode) {
  const section = document.getElementById("analysisSection");
  if (!cachedAnalysis) {
    section.innerHTML = '<div class="analysis-empty">No analysis available for this time range.</div>';
    return;
  }

  const data = cachedAnalysis[mode];
  if (!data) {
    section.innerHTML = '<div class="analysis-empty">No analysis available for this mode.</div>';
    return;
  }

  const plainParts = [];
  let html = '<div class="analysis-card">';

  // Copy button (top-right)
  // (copyText populated below, wired after innerHTML set)

  // Callout stats (bulleted list)
  html += '<ul class="callout-stats">';

  if (mode === "frontier") {
    const c = data.callouts || {};
    if (c.medianIncrease) {
      html += `<li class="callout-line"><span><span class="callout-obj">\u2191</span> <span class="callout-num">${escapeHtml(c.medianIncrease.value)}</span> <span class="callout-obj">median increase</span> ${escapeHtml(c.medianIncrease.detail)}</span></li>`;
      plainParts.push(`↑ ${c.medianIncrease.value} median increase ${c.medianIncrease.detail}`);
    }
    if (c.biggestMover) {
      const pp = c.biggestMover.ppChange;
      html += `<li class="callout-line"><span><span class="callout-obj">Biggest gain: ${escapeHtml(c.biggestMover.name)}</span>, <span class="callout-num">${pp >= 0 ? "+" : ""}${pp}</span> percentage points${c.biggestMover.periodLabel ? " " + escapeHtml(c.biggestMover.periodLabel) : ""}</span></li>`;
      plainParts.push(`Biggest gain: ${c.biggestMover.name}, ${pp >= 0 ? "+" : ""}${pp} pp`);
    }
    if (c.benchmarksSaturated) {
      const benchWord = c.benchmarksSaturated.count === 1 ? "benchmark" : "benchmarks";
      html += `<li class="callout-line"><span><span class="callout-num">${c.benchmarksSaturated.count}</span> <span class="callout-obj">major ${benchWord} defeated</span>: ${escapeHtml(c.benchmarksSaturated.names.join(", "))}</span></li>`;
      plainParts.push(`${c.benchmarksSaturated.count} defeated: ${c.benchmarksSaturated.names.join(", ")}`);
    }
  } else if (mode === "race") {
    const c = data.callouts || {};
    if (c.leader) {
      const l = c.leader;
      let changeText = "";
      if (l.direction && l.direction !== "unchanged" && l.startAvgRank !== null) {
        const dirWord = l.direction === "down" ? "improving from" : "worsening from";
        changeText = `, ${dirWord} <span class="callout-num">${l.startAvgRank}</span> ${escapeHtml(l.periodLabel || l.monthsBack + " months ago")}`;
      }
      html += `<li class="callout-line"><span><span class="callout-obj">Overall Leader: ${escapeHtml(l.name)}</span> Avg. rank <span class="callout-num">${l.avgRank}</span> across ${l.benchmarkCount} active benchmarks${changeText}. <span class="callout-num">${l.firsts}</span> first-place finishes</span></li>`;
      plainParts.push(`Overall Leader: ${l.name}. Avg rank ${l.avgRank}. ${l.firsts} firsts`);
    }
    if (c.biggestMover) {
      const m = c.biggestMover;
      const dirWord = m.direction === "improved" ? "improving from" : "worsening from";
      const startRank = Math.round((m.avgRank - m.change) * 10) / 10;
      html += `<li class="callout-line"><span><span class="callout-obj">Biggest mover: ${escapeHtml(m.name)}</span> Avg. rank <span class="callout-num">${m.avgRank}</span> across ${m.benchmarkCount || (c.leader ? c.leader.benchmarkCount : 6)} active benchmarks, ${dirWord} <span class="callout-num">${startRank}</span> ${escapeHtml(m.periodLabel || m.monthsBack + " months ago")}. <span class="callout-num">${m.firsts}</span> first-place finishes</span></li>`;
      plainParts.push(`Biggest mover: ${m.name}. Avg rank ${m.avgRank}, ${dirWord} ${startRank}`);
    }
  } else if (mode === "cost") {
    if (data.aggregate) {
      const a = data.aggregate;
      const fellWord = a.decline.endsWith("x") ? "fell" : "fell by";
      html += `<li class="callout-line"><span><span class="callout-obj">Cost of intelligence ${fellWord}</span> <span class="callout-num">${escapeHtml(a.decline)}</span> between ${escapeHtml(a.startQ)} and ${escapeHtml(a.endQ)}</span></li>`;
      plainParts.push(`Cost of intelligence ${fellWord} ${a.decline} between ${a.startQ} and ${a.endQ}`);
    }
  }
  html += '</ul>';

  // Headline + commentary
  if (data.headline) {
    html += `<p class="analysis-headline">${escapeHtml(data.headline)}</p>`;
    plainParts.push(data.headline);
  }
  if (data.commentary) {
    html += `<p class="analysis-commentary">${escapeHtml(data.commentary)}</p>`;
    plainParts.push(data.commentary);
  }

  // Disclaimer
  html += '<div class="analysis-footer">';
  html += '<span class="analysis-disclaimer">Stats computed. Not all labs submit for all benchmarks. Analysis generated by Opus 4.6, may contain errors.</span>';
  html += '</div>';

  // Copy button (top-right, positioned absolute)
  const copyText = plainParts.join("\n");
  html += `<button class="copy-icon-btn" title="Copy analysis" data-copy-text="${escapeHtml(copyText)}">${COPY_ICON_SVG}</button>`;

  html += '</div>';
  section.innerHTML = html;

  // Wire copy button
  section.querySelectorAll(".copy-icon-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const text = btn.getAttribute("data-copy-text");
      navigator.clipboard.writeText(text).then(() => {
        btn.style.color = "#10b981";
        setTimeout(() => { btn.style.color = ""; }, 1500);
      });
    });
  });
}

// ─── Chart Export ─────────────────────────────────────────────
function getExportFilename() {
  if (currentMode === "cost") {
    if (currentCostBenchmark) {
      const meta = COST_BENCHMARK_META[currentCostBenchmark];
      return `Cost of Intelligence — ${meta.name} (${meta.thresholdLabel})`;
    }
    return "Cost of Intelligence — All Benchmarks";
  }
  if (currentMode === "race") {
    const bench = BENCHMARKS[currentBenchmark];
    return bench ? `Lab Race — ${bench.name}` : "Lab Race";
  }
  if (selectedLab) {
    const lab = LABS[selectedLab];
    return lab ? `AI Frontier — ${lab.name}` : "AI Frontier";
  }
  return "AI Frontier — All Labs";
}

function buildExportCanvas() {
  const sourceCanvas = document.getElementById("benchmarkChart");
  const chartW = sourceCanvas.width;
  const chartH = sourceCanvas.height;
  const exportScale = Math.min(1.25, Math.max(1, 1 + (window.innerWidth - 960) * 0.25 / 1600));

  // All pixel values are multiplied by CHART_DPR (device pixel ratio) and exportScale
  // to render crisply at any screen resolution
  const scaled = (base) => Math.round(base * CHART_DPR * exportScale);

  const pad = scaled(16);           // outer padding around entire export
  const rowH = scaled(22);          // height of one legend row inside a column
  const citationH = scaled(36);     // height of the citation footer
  const legendBottomPad = scaled(16); // space between legend and chart
  const fontSize = scaled(11);      // legend label font size
  const smallFontSize = scaled(9);  // capability header font size
  const dotR = scaled(4);           // capability colour dot radius
  const dotTextGap = scaled(6);     // gap between dot and label text
  const citationFontSize = scaled(10); // citation footer font size

  // ─── Build per-capability column groups (frontier mode) or fall back to flat
  // legend (race/cost modes). Mirrors renderCustomLegend's branching.
  const visibleDatasets = chart.data.datasets
    .map((ds, i) => ({ ds, idx: i }))
    .filter(({ idx }) => chart.isDatasetVisible(idx));

  const isFrontier = currentMode === "frontier";
  let columns = []; // [{ cap, active: [{ds, idx}], defeatedCount }]
  let flatItems = []; // race/cost fallback

  if (isFrontier) {
    const grouped = {};
    for (const cap of CAPABILITIES) grouped[cap] = { active: [], inactive: [] };
    for (const { ds, idx } of chart.data.datasets.map((ds, i) => ({ ds, idx: i }))) {
      const meta = BENCHMARK_META[ds._benchKey];
      const cap = meta?.capability;
      if (!cap || !grouped[cap]) continue;
      // For the export, only show defeated entries if they're currently visible
      // (e.g., user clicked "N defeated" and the chart is showing just that group).
      if (ds._isInactive) {
        if (chart.isDatasetVisible(idx)) grouped[cap].inactive.push({ ds, idx });
        else grouped[cap].inactive.push({ ds, idx, hidden: true });
      } else if (chart.isDatasetVisible(idx)) {
        grouped[cap].active.push({ ds, idx });
      }
    }
    columns = CAPABILITIES.map(cap => ({
      cap,
      active: grouped[cap].active,
      defeatedCount: grouped[cap].inactive.length,
    }));
  } else {
    flatItems = visibleDatasets;
  }

  // Compute legend height: max rows per column (header + each active + optional defeated link).
  let legendH;
  if (isFrontier) {
    const maxRows = columns.reduce((m, c) => {
      const rows = 1 /* header */ + c.active.length + (c.defeatedCount > 0 ? 1 : 0);
      return Math.max(m, rows);
    }, 1);
    legendH = maxRows * rowH + legendBottomPad;
  } else {
    legendH = rowH + legendBottomPad;
  }

  const totalW = chartW + pad * 2;
  const totalH = chartH + pad + legendH + citationH;

  const canvas = document.createElement("canvas");
  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#0f1117";
  ctx.fillRect(0, 0, totalW, totalH);

  // Truncate text with ellipsis to fit within maxW (manual measure + char trim).
  function ellipsize(text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(text.slice(0, mid) + "…").width <= maxW) lo = mid;
      else hi = mid - 1;
    }
    return text.slice(0, lo) + "…";
  }

  if (isFrontier) {
    const innerW = totalW - pad * 2;
    const colW = innerW / CAPABILITIES.length;
    const colPadR = scaled(8); // right-side breathing room inside each column

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const colX = pad + i * colW;
      const colTextMaxW = colW - colPadR;
      const capColor = CAPABILITY_COLORS[col.cap] || "#6c9eff";

      let rowY = pad + rowH * 0.6;

      // Capability header: uppercase, in a lightened version of the capability colour
      ctx.font = `700 ${smallFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.fillStyle = lightenHex(capColor, 0.45);
      ctx.textAlign = "left";
      const headerLabel = ellipsize(col.cap.toUpperCase(), colTextMaxW);
      ctx.fillText(headerLabel, colX, rowY + smallFontSize * 0.35);
      rowY += rowH;

      // Active benchmark name(s)
      ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      for (const { ds } of col.active) {
        ctx.fillStyle = "#d4d6dc";
        ctx.fillText(ellipsize(ds.label, colTextMaxW), colX, rowY + fontSize * 0.35);
        rowY += rowH;
      }

      // Defeated link (static text in export — no interactivity)
      if (col.defeatedCount > 0) {
        ctx.fillStyle = "#808690";
        ctx.fillText(`${col.defeatedCount} defeated`, colX, rowY + fontSize * 0.35);
      }
    }
  } else {
    // Flat fallback for race/cost modes
    let legendX = pad;
    const legendY = pad + rowH * 0.6;
    const maxLegendX = totalW - pad;
    const itemGap = scaled(16);
    ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    for (const { ds } of flatItems) {
      const labelWidth = ctx.measureText(ds.label).width;
      const itemWidth = dotR * 2 + dotTextGap + labelWidth + itemGap;
      if (legendX + itemWidth > maxLegendX) break;

      const benchMeta = BENCHMARK_META[ds._benchKey];
      const capColor = benchMeta ? CAPABILITY_COLORS[benchMeta.capability] : null;
      const dotColor = ds._isInactive ? INACTIVE_COLOR : (capColor || ds.borderColor);
      ctx.beginPath();
      ctx.arc(legendX + dotR, legendY, dotR, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.fill();
      legendX += dotR * 2 + dotTextGap;

      ctx.fillStyle = "#9aa0a6";
      ctx.textAlign = "left";
      ctx.fillText(ds.label, legendX, legendY + fontSize * 0.35);
      legendX += labelWidth + itemGap;
    }
  }

  // Chart image
  ctx.drawImage(sourceCanvas, pad, pad + legendH, chartW, chartH);

  // Citation footer
  const citationY = totalH - citationH * 0.35;
  ctx.fillStyle = "#808690";
  ctx.font = `${citationFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText(SITE_URL, pad, citationY);
  ctx.textAlign = "right";
  ctx.fillText("Source: " + getVisibleSources().join(", "), totalW - pad, citationY);

  return canvas;
}

document.addEventListener("DOMContentLoaded", () => {
  const copyBtn = document.getElementById("copyChartBtn");
  const downloadBtn = document.getElementById("downloadChartBtn");

  copyBtn.addEventListener("click", async () => {
    try {
      const canvas = buildExportCanvas();
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      copyBtn.style.color = "#10b981";
      copyBtn.style.borderColor = "#10b981";
      setTimeout(() => { copyBtn.style.color = ""; copyBtn.style.borderColor = ""; }, 1500);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  });

  downloadBtn.addEventListener("click", () => {
    const canvas = buildExportCanvas();
    const link = document.createElement("a");
    const name = getExportFilename().replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "-").toLowerCase();
    link.download = `${name}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  });
});


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
  "hle":           "Artificial Analysis",
  "swe-bench":     "SWE-bench",
  "swe-bench-pro": "Scale AI SEAL",
  "frontiermath":  "Epoch AI",
  "math-l5":       "Epoch AI",
};

const COST_SOURCE = "Artificial Analysis";

const CHART_DPR = 3;
const INACTIVE_COLOR = "#4b5563";       // grey-600
const INACTIVE_BORDER_WIDTH = 1.5;      // thinner than active (2.5)

// ─── State ───────────────────────────────────────────────────
let currentBenchmark = null; // Set to first benchmark key on init
let currentMode = "frontier"; // "frontier" | "race" | "cost"
let selectedLab = null;   // null = "All Labs", or a lab key like "openai"
let currentCostBenchmark = null; // null = all, or "gpqa" / "mmlu-pro"
let currentDateRange = "all-time";
let chart = null;
let chartMode = null; // tracks which mode the chart was built for
let isolatedIndex = null;
let highlightedInactiveIndex = null; // currently highlighted inactive dataset

// Clipboard SVG icon for copy buttons
const COPY_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3.5a1.5 1.5 0 00-1.5-1.5H3.5A1.5 1.5 0 002 3.5V9a1.5 1.5 0 001.5 1.5h2"/></svg>';

// Category colors for tab dots
const CATEGORY_COLORS = {
  Coding:    "#10b981",
  Reasoning: "#f59e0b",
  Knowledge: "#8b5cf6",
  Science:   "#06b6d4",
  Math:      "#ef4444",
  Agentic:   "#ec4899",
};

// Distinct colors for each benchmark line in frontier mode
const BENCHMARK_COLORS = {
  "swe-bench":     "#10b981",
  "arc-agi-1":     "#f59e0b",
  "arc-agi-2":     "#f97316",
  "hle":           "#8b5cf6",
  "gpqa":          "#06b6d4",
  "aime":          "#ef4444",
  "swe-bench-pro": "#34d399",
  "humaneval":     "#6ee7b7",
  "frontiermath":  "#f472b6",
  "math-l5":       "#fb7185",
};

// Colors for cost benchmarks
const COST_BENCHMARK_COLORS = {
  gpqa:       "#06b6d4",
  "mmlu-pro": "#a855f7",
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
    `<span>Source: ${sources.join(", ")}</span>` +
    `<button class="chart-action-btn" id="citationInfoBtn" title="View methodology">` +
    `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">` +
    `<circle cx="8" cy="8" r="6.25"/><path d="M8 7v4"/><circle cx="8" cy="5" r="0.5" fill="currentColor" stroke="none"/>` +
    `</svg></button>`;
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
    renderCostPills(container);
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
    dot.style.backgroundColor = CATEGORY_COLORS[bench.category] || "#6c9eff";

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

  // One pill per lab
  for (const [key, lab] of Object.entries(LABS)) {
    const btn = document.createElement("button");
    btn.className = `filter-pill${key === selectedLab ? " active" : ""}`;
    btn.dataset.key = key;

    const dot = document.createElement("span");
    dot.className = "pill-dot";
    dot.style.backgroundColor = lab.color;

    btn.appendChild(dot);
    btn.appendChild(document.createTextNode(lab.name));

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
      updateChart();
      renderCustomLegend();
      updateCitationLine();
      renderInfoArea();
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

function buildDatasets() {
  if (currentMode === "cost") {
    return buildCostDatasets();
  }

  if (currentMode === "race") {
    const bench = BENCHMARKS[currentBenchmark];
    if (!bench) return [];

    return Object.entries(LABS).map(([labKey, lab]) => {
      const verifiedArr = bench.scores[labKey].map(d => d ? d.verified : true);
      const pointStyle = buildPointStyleArrays(verifiedArr, lab.color);
      return {
        label: lab.name,
        data: bench.scores[labKey].map(d => d ? d.score : null),
        _models: bench.scores[labKey].map(d => d ? d.model : null),
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
  } else {
    // Frontier: one line per benchmark
    const labKeys = selectedLab ? [selectedLab] : Object.keys(LABS);
    const filterEnd = getFilterEndDate();

    return Object.entries(BENCHMARKS).map(([benchKey, benchData]) => {
      const isInactive = !isBenchmarkActive(benchKey, filterEnd);
      const meta = BENCHMARK_META[benchKey];

      const frontierData = [];
      const frontierModels = [];
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
        let bestLab = null;
        let bestVerified = true;
        let bestSource = null;

        for (const labKey of labKeys) {
          const entry = benchData.scores[labKey][i];
          if (entry !== null && (bestScore === null || entry.score > bestScore)) {
            bestScore = entry.score;
            bestModel = entry.model;
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
            bestLab = null;
            bestVerified = true;
            bestSource = null;
          }
        }

        frontierData.push(bestScore);
        frontierModels.push(bestModel);
        frontierLabs.push(bestLab);
        frontierVerified.push(bestVerified);
        frontierSources.push(bestSource);
      }

      const color = BENCHMARK_COLORS[benchKey];
      const baseColor = isInactive ? INACTIVE_COLOR : color;
      const pointStyle = buildPointStyleArrays(frontierVerified, baseColor);
      const ds = {
        label: benchData.name,
        data: frontierData,
        _models: frontierModels,
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
        order: isInactive ? 1 : 0, // inactive lines render behind active
      };

      if (isInactive) {
        ds.borderDash = [4, 4];
      }

      return ds;
    });
  }
}

// ─── Inactivity marker plugin ────────────────────────────────
const inactivityMarkerPlugin = {
  id: "inactivityMarker",
  afterDraw(chart) {
    if (currentMode !== "frontier") return;
    const ctx = chart.ctx;

    chart.data.datasets.forEach((ds, i) => {
      if (!ds._isInactive || !ds._activeUntil) return;
      if (!chart.isDatasetVisible(i)) return;

      const qIdx = TIME_LABELS.indexOf(ds._activeUntil);
      if (qIdx < 0) return;

      // Skip if no data at this point (null value = no marker to draw)
      if (ds.data[qIdx] == null) return;

      const meta = chart.getDatasetMeta(i);
      const point = meta.data[qIdx];
      if (!point || point.skip) return;

      const x = point.x;
      const y = point.y;

      // Draw a small circle with an x
      const r = 6;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = "#1a1d27";
      ctx.fill();
      ctx.strokeStyle = INACTIVE_COLOR;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Draw the x
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
    });
  },
};

Chart.register(inactivityMarkerPlugin);

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
        grid: { color: "rgba(45, 49, 64, 0.5)" },
        ticks: {
          color: "#5f6368",
          font: { size: 11 },
          callback: val => {
            if (val >= 1) return "$" + val.toFixed(0);
            if (val >= 0.1) return "$" + val.toFixed(1);
            return "$" + val.toFixed(2);
          },
        },
      }
    : {
        min: 0,
        max: 100,
        grid: { color: "rgba(45, 49, 64, 0.5)" },
        ticks: {
          color: "#5f6368",
          font: { size: 11 },
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
        line += `\n  Source: Artificial Analysis`;
        return line.split("\n");
      }
    : function(context) {
        const val = context.parsed.y;
        if (val === null) return null;
        const model = context.dataset._models?.[context.dataIndex];
        const labKey = context.dataset._labs?.[context.dataIndex];
        const labName = labKey ? (LABS[labKey]?.name || labKey) : null;
        let line = `${context.dataset.label}: ${val.toFixed(1)}%`;
        if (model && labName) {
          line += ` (${model}, ${labName})`;
        } else if (model) {
          line += ` (${model})`;
        }
        const isVerified = context.dataset._verified?.[context.dataIndex] !== false;
        const rawSource = context.dataset._source?.[context.dataIndex];
        if (!isVerified) {
          line += ` · Unverified (model card)`;
        } else if (rawSource) {
          const sourceDisplayMap = {
            "artificialanalysis": "Artificial Analysis",
            "epoch": "Epoch AI",
            "arcprize": "ARC Prize",
            "swebench": "SWE-bench",
            "manual": "Scale AI SEAL",
            "model_card": "Model card",
          };
          line += ` · ${sourceDisplayMap[rawSource] || rawSource}`;
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
      interaction: {
        mode: "index",
        intersect: false,
      },
      hover: {
        mode: "nearest",
        intersect: false,
      },
      onHover: handleChartHover,
      plugins: {
        legend: {
          display: false, // we use a custom HTML legend
        },
        tooltip: {
          backgroundColor: "#1a1d27",
          titleColor: "#e8eaed",
          bodyColor: "#9aa0a6",
          borderColor: "#2d3140",
          borderWidth: 1,
          padding: 12,
          cornerRadius: 8,
          filter: (tooltipItem) => {
            return !tooltipItem.dataset._isInactive;
          },
          callbacks: { label: tooltipLabel },
        },
      },
      scales: {
        x: {
          grid: { color: "rgba(45, 49, 64, 0.5)" },
          ticks: { color: "#5f6368", font: { size: 11 } },
          min: dateBounds.startLabel || undefined,
          max: dateBounds.endLabel || undefined,
        },
        y: yScale,
      },
      devicePixelRatio: CHART_DPR,
    },
  });

  // Empty state: check if all data points are null
  const hasData = chart.data.datasets.some(ds => ds.data.some(v => v !== null));
  if (!hasData) {
    showChartMessage("No data available for this view.");
  }
}

// ─── Custom HTML Legend ──────────────────────────────────────
function renderCustomLegend() {
  const container = document.getElementById("chartLegend");
  container.innerHTML = "";

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

  // Active items
  activeItems.forEach(({ ds, idx }) => {
    const btn = createLegendButton(ds, idx, false);
    container.appendChild(btn);
  });

  // Inactive section (only in frontier mode)
  if (inactiveItems.length > 0 && currentMode === "frontier") {
    const divider = document.createElement("div");
    divider.className = "legend-divider";
    container.appendChild(divider);

    const label = document.createElement("span");
    label.className = "legend-section-label";
    label.textContent = "~Defeated Benchmarks";
    container.appendChild(label);

    inactiveItems.forEach(({ ds, idx }) => {
      const btn = createLegendButton(ds, idx, true);
      container.appendChild(btn);
    });
  }
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

  // Inactive items get a small info icon hint
  if (isInactive) {
    const hint = document.createElement("span");
    hint.className = "legend-info-icon";
    hint.textContent = "\u24d8"; // ⓘ
    btn.appendChild(hint);
  }

  // Click: isolate / restore
  btn.addEventListener("click", () => {
    // Clear any hover highlight before toggling
    if (highlightedInactiveIndex !== null) {
      unhighlightInactive(highlightedInactiveIndex);
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

// ─── Inactive line styling helpers ───────────────────────────
function applyActiveStyle(ds) {
  const color = BENCHMARK_COLORS[ds._benchKey];
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

function handleChartHover(event, elements) {
  // Inactive line hover is handled via legend only — no chart-area interaction
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

function showInactiveTooltip(ds, clientX, clientY) {
  const tip = getOrCreateInactiveTooltip();
  const meta = BENCHMARK_META[ds._benchKey];

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

  let html = `<div class="inactive-tooltip-name">${safeName} <span class="status-badge ${statusClass}">${statusLabel} ${meta.activeUntil}</span></div>`;
  if (meta.inactiveReason) {
    html += `<div class="inactive-tooltip-reason">${escapeHtml(meta.inactiveReason)}</div>`;
  }
  if (latestScore !== null) {
    html += `<div class="inactive-tooltip-score">Peak: ${latestScore.toFixed(1)}%`;
    if (safeModel && safeLabName) html += ` (${safeModel}, ${safeLabName})`;
    else if (safeModel) html += ` (${safeModel})`;
    if (latestQuarter) html += ` \u2014 ${latestQuarter}`;
    html += `</div>`;
  }

  tip.innerHTML = html;
  tip.style.display = "block";

  // Position above cursor so it doesn't overlap the horizontal line
  const rect = tip.getBoundingClientRect();
  let left = clientX - rect.width / 2;
  let top = clientY - rect.height - 16;

  // Keep within viewport
  if (left < 8) left = 8;
  if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
  if (top < 8) top = clientY + 20; // flip below if no room above

  tip.style.left = left + "px";
  tip.style.top = top + "px";
}

function hideInactiveTooltip() {
  if (inactiveTooltipEl) inactiveTooltipEl.style.display = "none";
}

function updateChart() {
  isolatedIndex = null;
  highlightedInactiveIndex = null;
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
  const hasData = chart.data.datasets.some(ds => ds.data.some(v => v !== null));
  if (!hasData) {
    showChartMessage("No data available for this view.");
  }
}

// ─── Info area ───────────────────────────────────────────────
function renderCostInfoArea(card) {
  let html = '<div class="cost-headlines">';

  for (const [key, meta] of Object.entries(COST_BENCHMARK_META)) {
    const data = COST_DATA[key];
    if (!data) continue;

    const startIdx = TIME_LABELS.indexOf(meta.startQuarter);
    let firstEntry = null, lastEntry = null;
    let firstQ = null, lastQ = null;

    for (let i = startIdx; i < data.entries.length; i++) {
      if (data.entries[i]) {
        if (!firstEntry) { firstEntry = data.entries[i]; firstQ = TIME_LABELS[i]; }
        lastEntry = data.entries[i]; lastQ = TIME_LABELS[i];
      }
    }

    if (firstEntry && lastEntry && firstEntry.price > 0 && lastEntry.price > 0) {
      const decline = Math.round(firstEntry.price / lastEntry.price);
      const fmtPrice = p => p >= 1 ? `$${p.toFixed(2)}` : `$${p.toFixed(3)}`;
      html += `
        <div class="cost-headline-item">
          <span class="pill-dot" style="background-color: ${meta.color}"></span>
          <span class="cost-headline-label">${meta.name} (${meta.thresholdLabel}):</span>
          <span class="cost-decline">${decline}x cheaper</span>
          <span class="cost-range">since ${firstQ} (${fmtPrice(firstEntry.price)} \u2192 ${fmtPrice(lastEntry.price)})</span>
        </div>
      `;
    }
  }

  html += '</div>';
  html += `
    <div class="cost-explanation">
      <p>Shows the cheapest model (any lab) scoring above a fixed threshold on each benchmark, measured in $/M tokens (blended 3:1 input:output). Thresholds are set at what the best model scored when each benchmark launched. Uses cumulative minimum: once a cheaper model exists, the price floor never rises.</p>
    </div>
  `;

  card.innerHTML = html;
}

function renderInfoArea() {
  const card = document.getElementById("infoCard");

  if (currentMode === "cost") {
    renderCostInfoArea(card);
    return;
  }

  const autoExpand = (currentMode === "race") ? currentBenchmark : null;
  const filterEnd = getFilterEndDate();

  let html = `
    <div class="methodology-intro" id="methodologySection">
      <p>Scores use independently verified sources wherever available (Artificial Analysis, Epoch AI, ARC Prize, SWE-bench, Scale AI SEAL), shown as solid dots. Where no independent evaluation exists yet, self-reported model card scores from official lab announcements are used, shown as <strong>hollow dots</strong>.</p>
    </div>
  `;
  html += '<div class="benchmark-list">';

  for (const [key, bench] of Object.entries(BENCHMARKS)) {
    const color = BENCHMARK_COLORS[key] || INACTIVE_COLOR;
    const isOpen = key === autoExpand;
    const isInactive = !isBenchmarkActive(key, filterEnd);
    const meta = BENCHMARK_META[key];

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
          <span class="pill-dot" style="background-color: ${isInactive ? INACTIVE_COLOR : color}"></span>
          <span class="benchmark-item-name">${bench.name}</span>
          <span class="category-badge">${bench.category}</span>
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
function renderMarkdown(md) {
  return escapeHtml(md)
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/^(?!<[hup]|<li|<ul)(.+)$/gm, "<p>$1</p>")
    .replace(/<p><\/p>/g, "");
}

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
      section.innerHTML = '<div class="analysis-empty">No analysis available for this time range.</div>';
      return;
    }

    renderAnalysisSections(rows[0].analysis, section);
  } catch (err) {
    console.error("Failed to fetch analysis:", err);
    section.innerHTML = '<div class="analysis-empty">Failed to load analysis.</div>';
  }
}

function renderAnalysisSections(markdown, container) {
  // Split on ### headers
  const sections = [];
  let currentSection = null;

  for (const line of markdown.split("\n")) {
    if (line.startsWith("### ")) {
      if (currentSection) sections.push(currentSection);
      currentSection = { title: line.substring(4).trim(), lines: [] };
    } else if (line.startsWith("## ")) {
      // Top-level heading — render as intro
      if (currentSection) sections.push(currentSection);
      currentSection = { title: null, rawTitle: line.substring(3).trim(), lines: [] };
    } else {
      if (currentSection) currentSection.lines.push(line);
      else {
        currentSection = { title: null, lines: [line] };
      }
    }
  }
  if (currentSection) sections.push(currentSection);

  let html = '';

  for (const sec of sections) {
    if (sec.rawTitle) {
      // Top-level ## heading with disclaimer
      html += `<div class="analysis-heading"><h2>${escapeHtml(sec.rawTitle)}</h2><span class="analysis-disclaimer">Analysis generated by Opus 4.6 using the benchmark data shown. May contain errors!</span></div>`;
      continue;
    }

    const body = sec.lines.join("\n").trim();
    if (!body && !sec.title) continue;

    if (sec.title === "Headlines") {
      // Render each bullet as a separate item with its own copy button
      const bullets = body.split("\n").filter(l => l.startsWith("- ")).map(l => l.substring(2).trim());
      html += '<div class="analysis-card headlines-card">';
      html += '<div class="section-header"><h3>Headlines</h3></div>';
      html += '<ul class="headline-list">';
      for (const bullet of bullets) {
        const rendered = renderMarkdown("- " + bullet).replace(/<\/?ul>/g, "").replace(/<\/?li>/g, "");
        html += `<li class="headline-item"><span class="headline-text">${rendered.trim()}</span><button class="copy-icon-btn" title="Copy headline" data-copy-text="${escapeHtml(bullet)}">${COPY_ICON_SVG}</button></li>`;
      }
      html += '</ul></div>';
    } else if (sec.title) {
      // Body section with heading + copy icon
      const rendered = renderMarkdown(body);
      const plainText = body.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1");
      html += `<div class="analysis-card"><div class="section-header"><h3>${escapeHtml(sec.title)}</h3><button class="copy-icon-btn" title="Copy section" data-copy-text="${escapeHtml(sec.title + "\n\n" + plainText)}">${COPY_ICON_SVG}</button></div><div class="analysis-text">${rendered}</div></div>`;
    }
  }

  container.innerHTML = html;

  // Wire copy buttons
  container.querySelectorAll(".copy-icon-btn").forEach(btn => {
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
  const pad = 24 * CHART_DPR;
  const legendH = 32 * CHART_DPR;
  const citationH = 36 * CHART_DPR;
  const totalW = chartW + pad * 2;
  const totalH = chartH + pad + legendH + citationH;

  const canvas = document.createElement("canvas");
  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#0f1117";
  ctx.fillRect(0, 0, totalW, totalH);

  // Draw legend row at top — mirror the on-screen layout (active, then defeated section)
  const visibleDatasets = chart.data.datasets
    .map((ds, i) => ({ ds, idx: i }))
    .filter(({ idx }) => chart.isDatasetVisible(idx));
  const activeDs = visibleDatasets.filter(({ ds }) => !ds._isInactive);
  const inactiveDs = visibleDatasets.filter(({ ds }) => ds._isInactive);

  const fontSize = 10 * CHART_DPR;
  const smallFontSize = 8 * CHART_DPR;
  ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;

  let legendX = pad;
  const legendY = pad + legendH * 0.6;
  const dotR = 4 * CHART_DPR;
  const itemGap = 16 * CHART_DPR;
  const maxLegendX = totalW - pad;

  function drawLegendItem(ds, textColor) {
    // Use original color if this benchmark is isolated, otherwise grey for inactive
    const isIsolated = isolatedIndex === chart.data.datasets.indexOf(ds);
    const color = (ds._isInactive && !isIsolated) ? INACTIVE_COLOR : (BENCHMARK_COLORS[ds._benchKey] || ds.borderColor);
    const labelWidth = ctx.measureText(ds.label).width;
    const itemWidth = dotR * 2 + 4 * CHART_DPR + labelWidth + itemGap;
    if (legendX + itemWidth > maxLegendX) return;

    ctx.beginPath();
    ctx.arc(legendX + dotR, legendY, dotR, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    legendX += dotR * 2 + 4 * CHART_DPR;

    ctx.fillStyle = textColor;
    ctx.textAlign = "left";
    ctx.fillText(ds.label, legendX, legendY + fontSize * 0.35);
    legendX += labelWidth + itemGap;
  }

  // Active items
  for (const { ds } of activeDs) drawLegendItem(ds, "#9aa0a6");

  // Defeated section (frontier mode only)
  if (inactiveDs.length > 0 && currentMode === "frontier") {
    const sectionLabel = "~DEFEATED";
    ctx.font = `bold ${smallFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    const sectionWidth = ctx.measureText(sectionLabel).width + itemGap;
    if (legendX + sectionWidth <= maxLegendX) {
      ctx.fillStyle = "#5f6368";
      ctx.textAlign = "left";
      ctx.fillText(sectionLabel, legendX, legendY + smallFontSize * 0.35);
      legendX += sectionWidth;
    }
    ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    for (const { ds } of inactiveDs) drawLegendItem(ds, "#6b7280");
  }

  // Chart image
  ctx.drawImage(sourceCanvas, pad, pad + legendH, chartW, chartH);

  // Citation footer
  const citationY = totalH - citationH * 0.35;
  ctx.fillStyle = "#5f6368";
  ctx.font = `${10 * CHART_DPR}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
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


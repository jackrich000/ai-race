// ─── Utilities ──────────────────────────────────────────────
function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatSourceName(source) {
  const names = {
    artificialanalysis: "Artificial Analysis",
    epoch: "Epoch AI",
    swebench: "SWE-bench",
    arcprize: "ARC Prize",
    manual: "Curated",
    model_card: "Model Card (self-reported)",
  };
  return names[source] || source || "Unknown";
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
const CHART_DPR = 3;
const INACTIVE_COLOR = "#4b5563";       // grey-600
const INACTIVE_BORDER_WIDTH = 1.5;      // thinner than active (2.5)

// ─── State ───────────────────────────────────────────────────
let currentBenchmark = null; // Set to first benchmark key on init
let currentMode = "frontier"; // "frontier" | "race" | "cost"
let selectedLab = null;   // null = "All Labs", or a lab key like "openai"
let currentCostBenchmark = null; // null = all, or "gpqa" / "mmlu-pro"
let chart = null;
let chartMode = null; // tracks which mode the chart was built for
let isolatedIndex = null;
let highlightedInactiveIndex = null; // currently highlighted inactive dataset

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
};

// Colors for cost benchmarks
const COST_BENCHMARK_COLORS = {
  gpqa:       "#06b6d4",
  "mmlu-pro": "#a855f7",
};

// ─── Initialize ──────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  try {
    showLoading(true);
    await loadData(); // from data-loader.js
    // Default to first active benchmark key
    if (!currentBenchmark || !BENCHMARKS[currentBenchmark]) {
      currentBenchmark = Object.keys(BENCHMARKS).find(k => isBenchmarkActive(k, getFilterEndDate())) || Object.keys(BENCHMARKS)[0];
    }
    renderModeToggle();
    renderFilterPills();
    renderChart();
    renderCustomLegend();
    renderInfoArea();
    showLoading(false);
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
      const sourcesArr = bench.scores[labKey].map(d => d ? d.source : null);
      const pointStyle = buildPointStyleArrays(verifiedArr, lab.color);
      return {
        label: lab.name,
        data: bench.scores[labKey].map(d => d ? d.score : null),
        _models: bench.scores[labKey].map(d => d ? d.model : null),
        _verified: verifiedArr,
        _sources: sourcesArr,
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
        _verified: frontierVerified,
        _sources: frontierSources,
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
        const source = context.dataset._sources?.[context.dataIndex];
        if (!isVerified && source) {
          return [line, `  Unverified \u2014 ${formatSourceName(source)}`];
        }
        return line;
      };

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
    return;
  }

  chart.data.datasets = buildDatasets();
  chart.data.datasets.forEach((_, i) => chart.setDatasetVisibility(i, true));
  chart.update();
  renderCustomLegend();

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
      <p>Shows the cheapest model (any lab) scoring above a fixed threshold on each benchmark, measured in $/M tokens (blended 3:1 input:output). Thresholds are set at what the best model scored when each benchmark launched. Uses cumulative minimum \u2014 once a cheaper model exists, the price floor never rises.</p>
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

  let html = '<div class="benchmark-list">';

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
  ctx.fillText("ai-race.vercel.app", pad, citationY);
  ctx.textAlign = "right";
  ctx.fillText("Data: Epoch AI, SWE-bench, ARC Prize, Artificial Analysis", totalW - pad, citationY);

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

// ─── AI Analysis ──────────────────────────────────────────────
(function initAnalysis() {
  let selectedRange = 3;

  document.addEventListener("DOMContentLoaded", () => {
    const pills = document.querySelectorAll(".time-range-pills .filter-pill");
    const customRange = document.getElementById("customRange");
    const rangeFrom = document.getElementById("rangeFrom");
    const rangeTo = document.getElementById("rangeTo");
    const generateBtn = document.getElementById("generateBtn");
    const outputEl = document.getElementById("analysisOutput");
    const textEl = document.getElementById("analysisText");
    const loadingEl = document.getElementById("analysisLoading");
    const copyBtn = document.getElementById("copyBtn");

    // Populate quarter dropdowns
    TIME_LABELS.forEach(q => {
      rangeFrom.appendChild(new Option(q, q));
      rangeTo.appendChild(new Option(q, q));
    });
    rangeTo.value = TIME_LABELS[TIME_LABELS.length - 1];
    if (TIME_LABELS.length > 4) rangeFrom.value = TIME_LABELS[TIME_LABELS.length - 5];

    // Range pill clicks
    pills.forEach(pill => {
      pill.addEventListener("click", () => {
        pills.forEach(p => p.classList.remove("active"));
        pill.classList.add("active");
        const range = pill.dataset.range;
        if (range === "custom") {
          selectedRange = "custom";
          customRange.hidden = false;
        } else {
          selectedRange = parseInt(range);
          customRange.hidden = true;
        }
      });
    });

    generateBtn.addEventListener("click", () => generateAnalysis());
    copyBtn.addEventListener("click", () => copyAnalysis());

    function getQuarterRange() {
      if (selectedRange === "custom") {
        const fromIdx = TIME_LABELS.indexOf(rangeFrom.value);
        const toIdx = TIME_LABELS.indexOf(rangeTo.value);
        return { startIdx: Math.min(fromIdx, toIdx), endIdx: Math.max(fromIdx, toIdx) };
      }
      const quartersBack = Math.ceil(selectedRange / 3);
      const endIdx = TIME_LABELS.length - 1;
      const startIdx = Math.max(0, endIdx - quartersBack);
      return { startIdx, endIdx };
    }

    function getDataForRange(startIdx, endIdx) {
      const filterEnd = getFilterEndDate();
      let lines = [];
      for (const [benchKey, bench] of Object.entries(BENCHMARKS)) {
        const meta = BENCHMARK_META[benchKey];
        const isInactive = !isBenchmarkActive(benchKey, filterEnd);
        let header = `\n## ${bench.name} (${bench.category})`;
        if (isInactive && meta.status === "saturated") {
          header += ` [SATURATED - ${meta.activeUntil}]`;
        } else if (isInactive && meta.status === "deprecated") {
          header += ` [DEPRECATED - ${meta.activeUntil}]`;
        }
        lines.push(header);
        for (const [labKey, lab] of Object.entries(LABS)) {
          const scores = bench.scores[labKey].slice(startIdx, endIdx + 1);
          const labels = TIME_LABELS.slice(startIdx, endIdx + 1);
          const parts = scores.map((d, i) =>
            d ? `${labels[i]}: ${d.score}%${d.model ? " (" + d.model + ")" : ""}` : `${labels[i]}: -`
          );
          lines.push(`${lab.name}: ${parts.join(" | ")}`);
        }
      }
      return lines.join("\n");
    }

    // --- Pre-compute helpers for structured analysis ---

    function getLatestScore(scoresArray, maxIdx) {
      for (let i = maxIdx; i >= 0; i--) {
        if (scoresArray[i]) return { score: scoresArray[i].score, model: scoresArray[i].model };
      }
      return null;
    }

    function computeRankings(startIdx, endIdx) {
      const labKeys = Object.keys(LABS);
      const benchKeys = Object.keys(BENCHMARKS);

      function rankAtIndex(idx) {
        const perLab = {};
        for (const labKey of labKeys) perLab[labKey] = { ranks: [], firsts: 0, detail: {} };

        for (const benchKey of benchKeys) {
          const bench = BENCHMARKS[benchKey];
          // Collect scores for each lab at this index
          const entries = [];
          for (const labKey of labKeys) {
            const entry = getLatestScore(bench.scores[labKey], idx);
            if (entry) entries.push({ labKey, score: entry.score, model: entry.model });
          }
          if (entries.length === 0) continue;

          // Sort descending by score
          entries.sort((a, b) => b.score - a.score);

          // Dense ranking (1,1,2 for ties)
          let rank = 1;
          for (let i = 0; i < entries.length; i++) {
            if (i > 0 && entries[i].score < entries[i - 1].score) rank++;
            const lab = entries[i].labKey;
            perLab[lab].ranks.push(rank);
            perLab[lab].detail[benchKey] = { rank, score: entries[i].score, model: entries[i].model };
            if (rank === 1) perLab[lab].firsts++;
          }
        }

        // Compute averages
        const result = {};
        for (const labKey of labKeys) {
          const d = perLab[labKey];
          if (d.ranks.length === 0) continue;
          result[labKey] = {
            avgRank: Math.round((d.ranks.reduce((a, b) => a + b, 0) / d.ranks.length) * 10) / 10,
            firsts: d.firsts,
            benchmarksRanked: d.ranks.length,
            detail: d.detail,
          };
        }
        return result;
      }

      const startRanks = rankAtIndex(startIdx);
      const endRanks = rankAtIndex(endIdx);

      // Identify leader (lowest avg rank at end)
      let leader = null, lowestAvg = Infinity;
      for (const [labKey, data] of Object.entries(endRanks)) {
        if (data.avgRank < lowestAvg) { lowestAvg = data.avgRank; leader = labKey; }
      }

      // Identify biggest loser (largest increase in avg rank)
      let biggestLoser = null, biggestDrop = -Infinity;
      for (const [labKey, endData] of Object.entries(endRanks)) {
        const startData = startRanks[labKey];
        if (!startData) continue;
        const drop = endData.avgRank - startData.avgRank;
        if (drop > biggestDrop) { biggestDrop = drop; biggestLoser = labKey; }
      }
      // If no one got worse, biggestLoser stays null
      if (biggestDrop <= 0) biggestLoser = null;

      return {
        leader: leader ? {
          lab: LABS[leader].name,
          labKey: leader,
          startAvgRank: startRanks[leader] ? startRanks[leader].avgRank : null,
          startFirsts: startRanks[leader] ? startRanks[leader].firsts : 0,
          endAvgRank: endRanks[leader].avgRank,
          endFirsts: endRanks[leader].firsts,
          detail: endRanks[leader].detail,
        } : null,
        biggestLoser: biggestLoser ? {
          lab: LABS[biggestLoser].name,
          labKey: biggestLoser,
          startAvgRank: startRanks[biggestLoser].avgRank,
          startFirsts: startRanks[biggestLoser].firsts,
          endAvgRank: endRanks[biggestLoser].avgRank,
          endFirsts: endRanks[biggestLoser].firsts,
          detail: endRanks[biggestLoser].detail,
        } : null,
      };
    }

    function computeFrontierGrowth(startIdx, endIdx) {
      const labKeys = Object.keys(LABS);
      const results = [];
      for (const [benchKey, bench] of Object.entries(BENCHMARKS)) {
        let startMax = null, endMax = null;
        for (const labKey of labKeys) {
          const s = getLatestScore(bench.scores[labKey], startIdx);
          const e = getLatestScore(bench.scores[labKey], endIdx);
          if (s && (startMax === null || s.score > startMax)) startMax = s.score;
          if (e && (endMax === null || e.score > endMax)) endMax = e.score;
        }
        if (startMax === null || endMax === null || startMax === 0) continue;
        const growth = Math.round(((endMax - startMax) / startMax) * 1000) / 10;
        results.push({
          benchmark: bench.name,
          description: bench.description.split(" — ")[0],
          startScore: startMax,
          endScore: endMax,
          growthPct: growth,
        });
      }
      results.sort((a, b) => b.growthPct - a.growthPct);
      const avg = results.length > 0 ? Math.round((results.reduce((s, r) => s + r.growthPct, 0) / results.length) * 10) / 10 : 0;
      return { benchmarks: results, avgGrowthPct: avg, biggestMover: results[0] || null };
    }

    function computeCostDecline(startIdx, endIdx) {
      const results = [];
      for (const [benchKey, meta] of Object.entries(COST_BENCHMARK_META)) {
        const data = COST_DATA[benchKey];
        if (!data) continue;

        // Find entry at/before start and end
        let startEntry = null, endEntry = null;
        for (let i = startIdx; i >= 0; i--) {
          if (data.entries[i]) { startEntry = data.entries[i]; break; }
        }
        for (let i = endIdx; i >= 0; i--) {
          if (data.entries[i]) { endEntry = data.entries[i]; break; }
        }

        if (!startEntry || !endEntry || startEntry.price <= 0 || endEntry.price <= 0) {
          results.push({ benchmark: meta.name, threshold: meta.thresholdLabel, cheaperMultiple: null, description: meta.description, context: meta.context });
          continue;
        }

        const multiple = Math.round((startEntry.price / endEntry.price) * 10) / 10;
        results.push({
          benchmark: meta.name,
          threshold: meta.thresholdLabel,
          startPrice: startEntry.price,
          endPrice: endEntry.price,
          startModel: startEntry.model,
          endModel: endEntry.model,
          cheaperMultiple: multiple,
          description: meta.description,
          context: meta.context,
        });
      }
      return results;
    }

    // --- End pre-compute helpers ---

    async function generateAnalysis() {
      const { startIdx, endIdx } = getQuarterRange();
      const startQ = TIME_LABELS[startIdx];
      const endQ = TIME_LABELS[endIdx];
      const benchmarkData = getDataForRange(startIdx, endIdx);

      // Pre-compute statistics for structured analysis
      const frontierGrowth = computeFrontierGrowth(startIdx, endIdx);
      const rankings = computeRankings(startIdx, endIdx);
      const filterEnd = getFilterEndDate();
      const activeBenchKeys = Object.keys(BENCHMARKS).filter(k => isBenchmarkActive(k, filterEnd));
      const labCoverage = {};
      for (const [labKey, lab] of Object.entries(LABS)) {
        let has = 0;
        for (const bk of activeBenchKeys) {
          const latest = getLatestScore(BENCHMARKS[bk].scores[labKey], endIdx);
          if (latest) has++;
        }
        labCoverage[lab.name] = `${has}/${activeBenchKeys.length} active benchmarks`;
      }
      // Benchmarks defeated (saturated/deprecated) during the selected range
      const defeatedThisPeriod = [];
      for (const [benchKey, meta] of Object.entries(BENCHMARK_META)) {
        if (!meta.activeUntil) continue;
        if (compareQuarters(meta.activeUntil, startQ) >= 0 && compareQuarters(meta.activeUntil, endQ) <= 0) {
          defeatedThisPeriod.push({
            name: meta.name,
            status: meta.status,
            activeUntil: meta.activeUntil,
            reason: meta.inactiveReason,
          });
        }
      }
      const stats = {
        frontierGrowth,
        leader: rankings.leader,
        biggestLoser: rankings.biggestLoser,
        activeBenchmarkCount: frontierGrowth.benchmarks.length,
        labDataCoverage: labCoverage,
        defeatedThisPeriod,
      };
      const costData = computeCostDecline(startIdx, endIdx);

      generateBtn.disabled = true;
      loadingEl.hidden = false;
      outputEl.hidden = true;

      try {
        const resp = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startQuarter: startQ, endQuarter: endQ, benchmarkData, stats, costData }),
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${resp.status}`);
        }

        const { analysis } = await resp.json();
        textEl.style.color = "";
        textEl.innerHTML = renderMarkdown(analysis);
        outputEl.hidden = false;
      } catch (err) {
        textEl.textContent = "Error: " + err.message;
        textEl.style.color = "#ef4444";
        outputEl.hidden = false;
      } finally {
        generateBtn.disabled = false;
        loadingEl.hidden = true;
      }
    }

    function copyAnalysis() {
      const text = textEl.innerText;
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.textContent = "Copy to clipboard"; }, 2000);
      });
    }

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
  });
})();

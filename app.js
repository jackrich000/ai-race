// ─── Constants ───────────────────────────────────────────────
const CHART_DPR = 3;

// ─── State ───────────────────────────────────────────────────
let currentBenchmark = null; // Set to first benchmark key on init
let currentMode = "frontier"; // "frontier" | "race" | "cost"
let selectedLab = null;   // null = "All Labs", or a lab key like "openai"
let currentCostBenchmark = null; // null = all, or "gpqa" / "mmlu-pro"
let chart = null;
let chartMode = null; // tracks which mode the chart was built for
let isolatedIndex = null;

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
  "swe-bench":  "#10b981",
  "arc-agi-1":  "#f59e0b",
  "arc-agi-2":  "#f97316",
  "hle":        "#8b5cf6",
  "gpqa":       "#06b6d4",
  "aime":       "#ef4444",
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
    // Default to first benchmark key
    if (!currentBenchmark || !BENCHMARKS[currentBenchmark]) {
      currentBenchmark = Object.keys(BENCHMARKS)[0];
    }
    renderModeToggle();
    renderFilterPills();
    renderChart();
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
    el.style.cssText = "display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-secondary);font-size:0.95rem;";
    el.textContent = "Loading benchmark data\u2026";
    container.appendChild(el);
  } else if (!show && existing) {
    existing.remove();
  }
}

function showError(message) {
  document.querySelector(".chart-container").innerHTML =
    `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#ef4444;font-size:0.95rem;text-align:center;padding:2rem;">${message}</div>`;
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
  // One pill per benchmark
  for (const [key, bench] of Object.entries(BENCHMARKS)) {
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
      selectedLab = null;
      currentCostBenchmark = null;
      renderFilterPills();
      updateChart();
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

    return Object.entries(LABS).map(([labKey, lab]) => ({
      label: lab.name,
      data: bench.scores[labKey].map(d => d ? d.score : null),
      _models: bench.scores[labKey].map(d => d ? d.model : null),
      borderColor: lab.color,
      backgroundColor: lab.color + "33",
      borderWidth: 2.5,
      pointRadius: 4,
      pointHoverRadius: 6,
      pointBackgroundColor: lab.color,
      tension: 0.3,
      spanGaps: true,
    }));
  } else {
    // Frontier: one line per benchmark
    // If a lab is selected, use only that lab's scores; otherwise best across all
    const labKeys = selectedLab ? [selectedLab] : Object.keys(LABS);

    return Object.entries(BENCHMARKS).map(([benchKey, benchData]) => {
      const frontierData = [];
      const frontierModels = [];
      const frontierLabs = [];

      for (let i = 0; i < TIME_LABELS.length; i++) {
        let bestScore = null;
        let bestModel = null;
        let bestLab = null;

        for (const labKey of labKeys) {
          const entry = benchData.scores[labKey][i];
          if (entry !== null && (bestScore === null || entry.score > bestScore)) {
            bestScore = entry.score;
            bestModel = entry.model;
            bestLab = labKey;
          }
        }

        frontierData.push(bestScore);
        frontierModels.push(bestModel);
        frontierLabs.push(bestLab);
      }

      const color = BENCHMARK_COLORS[benchKey];
      return {
        label: benchData.name,
        data: frontierData,
        _models: frontierModels,
        _labs: frontierLabs,
        borderColor: color,
        backgroundColor: color + "33",
        borderWidth: 2.5,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: color,
        tension: 0.3,
        spanGaps: true,
      };
    });
  }
}

function renderChart() {
  const ctx = document.getElementById("benchmarkChart").getContext("2d");
  const isCost = currentMode === "cost";
  chartMode = currentMode;

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
      plugins: {
        legend: {
          position: "top",
          labels: {
            color: "#9aa0a6",
            usePointStyle: true,
            pointStyle: "circle",
            padding: 16,
            font: { size: 12 },
          },
          onClick: handleLegendClick,
        },
        tooltip: {
          backgroundColor: "#1a1d27",
          titleColor: "#e8eaed",
          bodyColor: "#9aa0a6",
          borderColor: "#2d3140",
          borderWidth: 1,
          padding: 12,
          cornerRadius: 8,
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
}

// ─── Legend click: isolate / restore ─────────────────────────
function handleLegendClick(_e, legendItem, legend) {
  const ci = legend.chart;
  const clickedIndex = legendItem.datasetIndex;

  if (isolatedIndex === clickedIndex) {
    isolatedIndex = null;
    ci.data.datasets.forEach((_, i) => ci.setDatasetVisibility(i, true));
  } else {
    isolatedIndex = clickedIndex;
    ci.data.datasets.forEach((_, i) => ci.setDatasetVisibility(i, i === clickedIndex));
  }

  ci.update();
}

function updateChart() {
  isolatedIndex = null;

  // If switching between cost and non-cost, destroy and recreate (scale type changes)
  const needsCost = currentMode === "cost";
  const hadCost = chartMode === "cost";
  if (needsCost !== hadCost) {
    chart.destroy();
    renderChart();
    return;
  }

  chart.data.datasets = buildDatasets();
  chart.data.datasets.forEach((_, i) => chart.setDatasetVisibility(i, true));
  chart.update();
}

// ─── Info area ───────────────────────────────────────────────
// Always renders the same expandable benchmark list in both modes.
// In Lab Race, the currently selected benchmark is auto-expanded.
function renderCostInfoArea(card) {
  let html = '<div class="cost-headlines">';

  for (const [key, meta] of Object.entries(COST_BENCHMARK_META)) {
    const data = COST_DATA[key];
    if (!data) continue;

    // Find first and last non-null entries
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

  let html = '<div class="benchmark-list">';

  for (const [key, bench] of Object.entries(BENCHMARKS)) {
    const color = BENCHMARK_COLORS[key];
    const isOpen = key === autoExpand;
    html += `
      <div class="benchmark-item" data-bench="${key}">
        <button class="benchmark-item-header" aria-expanded="${isOpen}">
          <span class="pill-dot" style="background-color: ${color}"></span>
          <span class="benchmark-item-name">${bench.name}</span>
          <span class="category-badge">${bench.category}</span>
          <span class="expand-icon">${isOpen ? "\u2212" : "+"}</span>
        </button>
        <div class="benchmark-item-detail"${isOpen ? "" : " hidden"}>
          <p>${bench.description}</p>
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

      // Close all others
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
  const citationH = 36 * CHART_DPR;
  const totalW = chartW + pad * 2;
  const totalH = chartH + pad + citationH;

  const canvas = document.createElement("canvas");
  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#0f1117";
  ctx.fillRect(0, 0, totalW, totalH);

  // Chart image
  ctx.drawImage(sourceCanvas, pad, pad, chartW, chartH);

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
      // Map months to quarters: 3mo = 1Q, 6mo = 2Q, 12mo = 4Q
      const quartersBack = Math.ceil(selectedRange / 3);
      const endIdx = TIME_LABELS.length - 1;
      const startIdx = Math.max(0, endIdx - quartersBack);
      return { startIdx, endIdx };
    }

    function getDataForRange(startIdx, endIdx) {
      let lines = [];
      for (const [benchKey, bench] of Object.entries(BENCHMARKS)) {
        lines.push(`\n## ${bench.name} (${bench.category})`);
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
      const stats = {
        frontierGrowth,
        leader: rankings.leader,
        biggestLoser: rankings.biggestLoser,
        activeBenchmarkCount: frontierGrowth.benchmarks.length,
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

    function escapeHtml(str) {
      return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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

// ─── State ───────────────────────────────────────────────────
let currentBenchmark = "all"; // "all" = equal-weight average, or a benchmark key
let currentMode = "frontier"; // "frontier" | "race"
let selectedLab = null;   // null = "All Labs", or a lab key like "openai"
let chart = null;
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
  "mmlu":       "#a78bfa",
  "gpqa":       "#06b6d4",
  "aime":       "#ef4444",
};

// ─── Initialize ──────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  try {
    showLoading(true);
    await loadData(); // from data-loader.js
    renderModeToggle();
    renderFilterPills();
    renderChart();
    renderInfoArea();
    showLoading(false);
    document.querySelector("footer p").innerHTML =
      'Data sourced from <a href="https://epoch.ai/" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none;">Epoch AI</a>. Scores represent cumulative best per lab per quarter.';
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
  } else {
    renderLabPills(container);
  }
}

function renderBenchmarkPills(container) {
  // "All Benchmarks" pill
  const allBtn = document.createElement("button");
  allBtn.className = `filter-pill${currentBenchmark === "all" ? " active" : ""}`;
  allBtn.dataset.key = "all";
  allBtn.textContent = "All Benchmarks";
  allBtn.addEventListener("click", () => {
    currentBenchmark = "all";
    container.querySelectorAll(".filter-pill").forEach(t => t.classList.remove("active"));
    allBtn.classList.add("active");
    isolatedIndex = null;
    updateChart();
    renderInfoArea();
  });
  container.appendChild(allBtn);

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
      renderFilterPills();
      updateChart();
      renderInfoArea();
    });
  });
}

// ─── Chart ───────────────────────────────────────────────────
function buildDatasets() {
  if (currentMode === "race") {
    if (currentBenchmark === "all") {
      // Equal-weight average across all benchmarks for each lab
      return Object.entries(LABS).map(([labKey, lab]) => ({
        label: lab.name,
        data: TIME_LABELS.map((_, i) => {
          let sum = 0;
          let count = 0;
          for (const benchData of Object.values(BENCHMARKS)) {
            const val = benchData.scores[labKey][i];
            if (val !== null) {
              sum += val;
              count++;
            }
          }
          return count > 0 ? Math.round((sum / count) * 10) / 10 : null;
        }),
        borderColor: lab.color,
        backgroundColor: lab.color + "33",
        borderWidth: 2.5,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: lab.color,
        tension: 0.3,
        spanGaps: true,
      }));
    }

    const bench = BENCHMARKS[currentBenchmark];
    return Object.entries(LABS).map(([labKey, lab]) => ({
      label: lab.name,
      data: bench.scores[labKey],
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
      const frontierData = TIME_LABELS.map((_, i) => {
        let best = null;
        for (const labKey of labKeys) {
          const val = benchData.scores[labKey][i];
          if (val !== null && (best === null || val > best)) {
            best = val;
          }
        }
        return best;
      });

      const color = BENCHMARK_COLORS[benchKey];
      return {
        label: benchData.name,
        data: frontierData,
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
          callbacks: {
            label: function(context) {
              const val = context.parsed.y;
              if (val === null) return null;
              return `${context.dataset.label}: ${val.toFixed(1)}%`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: "rgba(45, 49, 64, 0.5)" },
          ticks: { color: "#5f6368", font: { size: 11 } },
        },
        y: {
          min: 0,
          max: 100,
          grid: { color: "rgba(45, 49, 64, 0.5)" },
          ticks: {
            color: "#5f6368",
            font: { size: 11 },
            callback: val => val + "%",
          },
        },
      },
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
  chart.data.datasets = buildDatasets();
  chart.data.datasets.forEach((_, i) => chart.setDatasetVisibility(i, true));
  chart.update();
}

// ─── Info area ───────────────────────────────────────────────
// Always renders the same expandable benchmark list in both modes.
// In Lab Race, the currently selected benchmark is auto-expanded.
function renderInfoArea() {
  const card = document.getElementById("infoCard");
  const autoExpand = (currentMode === "race" && currentBenchmark !== "all") ? currentBenchmark : null;

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

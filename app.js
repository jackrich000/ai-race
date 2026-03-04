// ─── State ───────────────────────────────────────────────────
let currentBenchmark = null; // Set to first benchmark key on init
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
  "gpqa":       "#06b6d4",
  "aime":       "#ef4444",
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
    document.querySelector("footer p").innerHTML =
      'Data sourced from <a href="https://epoch.ai/" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none;">Epoch AI</a>, <a href="https://www.swebench.com/" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none;">SWE-bench</a>, <a href="https://arcprize.org/" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none;">ARC Prize</a> &amp; <a href="https://artificialanalysis.ai/" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none;">Artificial Analysis</a>. Scores represent cumulative best per lab per quarter.';
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

    async function generateAnalysis() {
      const { startIdx, endIdx } = getQuarterRange();
      const startQ = TIME_LABELS[startIdx];
      const endQ = TIME_LABELS[endIdx];
      const benchmarkData = getDataForRange(startIdx, endIdx);

      generateBtn.disabled = true;
      loadingEl.hidden = false;
      outputEl.hidden = true;

      try {
        const resp = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startQuarter: startQ, endQuarter: endQ, benchmarkData }),
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

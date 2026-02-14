/* Copus Dashboard — Webview Script */

(function () {
  "use strict";

  var vscode = acquireVsCodeApi();

  // ── State ──────────────────────────────────────
  var currentData = null;
  var currentMetrics = null;
  var currentOpusPricing = null;
  var charts = {};

  // ── Debounced setState ────────────────────────
  var stateTimer = null;
  function debouncedSetState(state) {
    if (stateTimer) clearTimeout(stateTimer);
    stateTimer = setTimeout(function () { vscode.setState(state); }, 300);
  }

  // ── Tab Navigation ─────────────────────────────
  function initTabs() {
    var tabs = document.querySelectorAll(".tab");
    var contents = document.querySelectorAll(".tab-content");

    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var target = tab.dataset.tab;
        tabs.forEach(function (t) { t.classList.remove("active"); });
        contents.forEach(function (c) { c.classList.remove("active"); });
        tab.classList.add("active");
        var content = document.getElementById("tab-" + target);
        if (content) content.classList.add("active");
      });
    });
  }

  // ── Header Update ──────────────────────────────
  function updateHeader(data, metrics) {
    var promptsEl = document.getElementById("header-prompts");
    var costEl = document.getElementById("header-cost");
    var timeEl = document.getElementById("header-time");
    var savingsEl = document.getElementById("header-savings");

    if (promptsEl) {
      var used = data.current_window.prompt_count;
      promptsEl.textContent = metrics.promptsRemaining + "/1000";
      promptsEl.className = "value" + (used >= 950 ? " error" : used >= 800 ? " warning" : "");
    }
    if (costEl) {
      costEl.textContent = "$" + data.current_window.estimated_cost_usd.toFixed(4);
    }
    if (timeEl) {
      timeEl.textContent = formatTime(metrics.windowTimeRemainingMs);
      timeEl.className = "value" + (metrics.windowTimeRemainingMs < 1800000 ? " warning" : "");
    }
    if (savingsEl) {
      savingsEl.textContent = "$" + metrics.savingsUsd.toFixed(2);
      savingsEl.className = "value savings";
    }
  }

  // ── Formatting Helpers ─────────────────────────
  function formatTime(ms) {
    if (ms <= 0) return "expired";
    var totalMin = Math.floor(ms / 60000);
    var hours = Math.floor(totalMin / 60);
    var minutes = totalMin % 60;
    if (hours > 0) return hours + "h " + minutes + "m";
    return minutes + "m";
  }

  function formatUsd(n) {
    return "$" + n.toFixed(n < 1 ? 4 : 2);
  }

  // ── Chart.js Theme Colors ──────────────────────
  function getThemeColors() {
    var style = getComputedStyle(document.body);
    return {
      foreground: style.getPropertyValue("--vscode-foreground").trim() || "#cccccc",
      dimmed: style.getPropertyValue("--vscode-descriptionForeground").trim() || "#888888",
      border: style.getPropertyValue("--vscode-panel-border").trim() || "#333333",
      green: style.getPropertyValue("--vscode-charts-green").trim() || "#4ec9b0",
      blue: style.getPropertyValue("--vscode-charts-blue").trim() || "#3794ff",
      red: style.getPropertyValue("--vscode-charts-red").trim() || "#f14c4c",
      yellow: style.getPropertyValue("--vscode-charts-yellow").trim() || "#cca700",
      purple: style.getPropertyValue("--vscode-charts-purple").trim() || "#b180d7",
      orange: style.getPropertyValue("--vscode-charts-orange").trim() || "#d18616",
    };
  }

  function configureChartDefaults() {
    if (typeof Chart === "undefined") return;
    var colors = getThemeColors();
    Chart.defaults.color = colors.dimmed;
    Chart.defaults.borderColor = colors.border;
    Chart.defaults.font.family =
      getComputedStyle(document.body).getPropertyValue("--vscode-font-family").trim() || "system-ui";
  }

  /** Destroy a chart by key if it exists, then return null */
  function destroyChart(key) {
    if (charts[key]) {
      charts[key].destroy();
      delete charts[key];
    }
  }

  // ── Opus cost equivalent (uses pricing from extension host) ──
  function opusCost(inputTokens, outputTokens) {
    var pricing = currentOpusPricing || { inputPerMillion: 15, outputPerMillion: 75 };
    return (inputTokens / 1e6) * pricing.inputPerMillion + (outputTokens / 1e6) * pricing.outputPerMillion;
  }

  // ── Cost Savings Tab ──────────────────────────

  function renderCostSavings(data, metrics) {
    var container = document.getElementById("cost-content");
    if (!container) return;

    var dailyTotals = (data.daily_totals || []).slice(-30);
    if (dailyTotals.length === 0 && data.current_window.prompt_count === 0) {
      container.innerHTML =
        '<div class="empty-state"><div class="empty-icon">&dollar;</div>' +
        '<div class="empty-text">Start using MCP tools to see cost savings here</div></div>';
      destroyChart("costDaily");
      return;
    }

    var colors = getThemeColors();

    // Compute monthly totals from daily_totals
    var totalActual = 0;
    var totalOpus = 0;
    var totalPrompts = 0;
    dailyTotals.forEach(function (d) {
      totalActual += d.estimated_cost_usd;
      totalOpus += opusCost(d.total_input_tokens, d.total_output_tokens);
      totalPrompts += d.prompt_count;
    });
    // Include current window if not in daily totals yet
    if (dailyTotals.length === 0) {
      totalActual = data.current_window.estimated_cost_usd;
      totalOpus = metrics.opusCostEquivalent;
      totalPrompts = data.current_window.prompt_count;
    }
    var totalSaved = totalOpus - totalActual;
    var savingsPercent = totalOpus > 0 ? ((totalSaved / totalOpus) * 100).toFixed(1) : "0.0";
    var avgCost = totalPrompts > 0 ? totalActual / totalPrompts : 0;

    container.innerHTML =
      // Hero
      '<div class="card"><div class="hero">' +
        '<div class="big-number">' + formatUsd(totalSaved) + '</div>' +
        '<div class="big-label">Total saved vs Opus this month</div>' +
      '</div></div>' +
      // Comparison
      '<div class="card"><div class="card-title">Cost Comparison</div>' +
        '<div class="comparison">' +
          '<div class="comparison-item"><div class="comp-value" style="color:' + colors.blue + '">' +
            formatUsd(totalActual) + '</div><div class="comp-label">Actual Cost</div></div>' +
          '<div class="comparison-vs">vs</div>' +
          '<div class="comparison-item"><div class="comp-value" style="color:' + colors.red + '">' +
            formatUsd(totalOpus) + '</div><div class="comp-label">Opus Equivalent</div></div>' +
        '</div>' +
      '</div>' +
      // Daily chart
      '<div class="card"><div class="card-title">Daily Cost (30 days)</div>' +
        '<div class="chart-container"><canvas id="chart-cost-daily"></canvas></div>' +
      '</div>' +
      // Stats row
      '<div class="card"><div class="stats-row">' +
        '<div class="stat-item"><div class="stat-value">' + savingsPercent + '%</div>' +
          '<div class="stat-label">Savings</div></div>' +
        '<div class="stat-item"><div class="stat-value">' + totalPrompts + '</div>' +
          '<div class="stat-label">Total Prompts</div></div>' +
        '<div class="stat-item"><div class="stat-value">' + formatUsd(avgCost) + '</div>' +
          '<div class="stat-label">Avg Cost/Prompt</div></div>' +
      '</div></div>';

    // Bar chart: actual vs opus per day
    var labels = dailyTotals.map(function (d) { return d.date.slice(5); }); // MM-DD
    var actualData = dailyTotals.map(function (d) { return d.estimated_cost_usd; });
    var opusData = dailyTotals.map(function (d) {
      return opusCost(d.total_input_tokens, d.total_output_tokens);
    });

    destroyChart("costDaily");
    var canvas = document.getElementById("chart-cost-daily");
    if (canvas && typeof Chart !== "undefined") {
      charts.costDaily = new Chart(canvas, {
        type: "bar",
        data: {
          labels: labels,
          datasets: [
            {
              label: "Actual Cost",
              data: actualData,
              backgroundColor: colors.blue + "cc",
              borderColor: colors.blue,
              borderWidth: 1,
            },
            {
              label: "Opus Equivalent",
              data: opusData,
              backgroundColor: colors.red + "66",
              borderColor: colors.red,
              borderWidth: 1,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "bottom" } },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { callback: function (v) { return "$" + Number(v).toFixed(2); } },
            },
          },
        },
      });
    }
  }

  // ── Usage Patterns Tab ────────────────────────

  function renderUsagePatterns(data, metrics) {
    var container = document.getElementById("usage-content");
    if (!container) return;

    var dailyTotals = (data.daily_totals || []).slice(-30);
    var requests = data.recent_requests || [];

    if (dailyTotals.length === 0 && data.current_window.prompt_count === 0) {
      container.innerHTML =
        '<div class="empty-state"><div class="empty-icon">&sim;</div>' +
        '<div class="empty-text">No usage data yet</div></div>';
      destroyChart("usageDaily");
      destroyChart("tokenDoughnut");
      destroyChart("callerPie");
      return;
    }

    var colors = getThemeColors();
    var used = data.current_window.prompt_count;
    var pct = Math.min(100, (used / 1000) * 100);
    var barColor = pct >= 95 ? colors.red : pct >= 80 ? colors.yellow : colors.blue;

    // Caller breakdown from recent_requests
    var callerMap = {};
    requests.forEach(function (r) {
      var key = r.caller || "unknown";
      callerMap[key] = (callerMap[key] || 0) + r.task_count;
    });
    var callerKeys = Object.keys(callerMap);
    var hasCallers = callerKeys.length > 0 && !(callerKeys.length === 1 && callerKeys[0] === "unknown");

    // Total tokens for doughnut
    var totalInput = data.current_window.total_input_tokens;
    var totalOutput = data.current_window.total_output_tokens;

    container.innerHTML =
      // Progress bar
      '<div class="card"><div class="card-title">Current Window: ' + used + ' / 1000 prompts (' +
        pct.toFixed(0) + '%)</div>' +
        '<div class="progress-bar-container"><div class="progress-bar" style="width:' +
          pct + '%;background:' + barColor + '"></div></div>' +
      '</div>' +
      // Daily prompts line chart
      '<div class="card"><div class="card-title">Daily Prompts (30 days)</div>' +
        '<div class="chart-container"><canvas id="chart-usage-daily"></canvas></div>' +
      '</div>' +
      // Grid: token distribution + caller breakdown
      '<div class="grid-2">' +
        '<div class="card"><div class="card-title">Token Distribution</div>' +
          (totalInput + totalOutput > 0
            ? '<div class="chart-container" style="height:220px"><canvas id="chart-token-doughnut"></canvas></div>'
            : '<div class="empty-state"><div class="empty-text">No token data</div></div>') +
        '</div>' +
        '<div class="card"><div class="card-title">Caller Breakdown</div>' +
          (hasCallers
            ? '<div class="chart-container" style="height:220px"><canvas id="chart-caller-pie"></canvas></div>'
            : '<div class="empty-state"><div class="empty-text">No caller data yet</div></div>') +
        '</div>' +
      '</div>';

    // Daily prompts line chart
    destroyChart("usageDaily");
    var dailyCanvas = document.getElementById("chart-usage-daily");
    if (dailyCanvas && typeof Chart !== "undefined" && dailyTotals.length > 0) {
      charts.usageDaily = new Chart(dailyCanvas, {
        type: "line",
        data: {
          labels: dailyTotals.map(function (d) { return d.date.slice(5); }),
          datasets: [{
            label: "Prompts",
            data: dailyTotals.map(function (d) { return d.prompt_count; }),
            borderColor: colors.blue,
            backgroundColor: colors.blue + "33",
            fill: true,
            tension: 0.3,
            pointRadius: 3,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true } },
        },
      });
    }

    // Token doughnut
    destroyChart("tokenDoughnut");
    var doughnutCanvas = document.getElementById("chart-token-doughnut");
    if (doughnutCanvas && typeof Chart !== "undefined" && (totalInput + totalOutput) > 0) {
      charts.tokenDoughnut = new Chart(doughnutCanvas, {
        type: "doughnut",
        data: {
          labels: ["Input Tokens", "Output Tokens"],
          datasets: [{
            data: [totalInput, totalOutput],
            backgroundColor: [colors.blue + "cc", colors.purple + "cc"],
            borderWidth: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "bottom" },
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  var total = totalInput + totalOutput;
                  var pct = ((ctx.raw / total) * 100).toFixed(1);
                  return ctx.label + ": " + ctx.raw.toLocaleString() + " (" + pct + "%)";
                },
              },
            },
          },
        },
      });
    }

    // Caller pie
    destroyChart("callerPie");
    var pieCanvas = document.getElementById("chart-caller-pie");
    if (pieCanvas && typeof Chart !== "undefined" && hasCallers) {
      var pieColors = [colors.blue, colors.green, colors.purple, colors.orange, colors.yellow, colors.red];
      charts.callerPie = new Chart(pieCanvas, {
        type: "pie",
        data: {
          labels: callerKeys,
          datasets: [{
            data: callerKeys.map(function (k) { return callerMap[k]; }),
            backgroundColor: callerKeys.map(function (_, i) { return pieColors[i % pieColors.length] + "cc"; }),
            borderWidth: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "bottom" } },
        },
      });
    }
  }

  // ── Performance Tab ───────────────────────────

  function renderPerformance(data, metrics) {
    var container = document.getElementById("perf-content");
    if (!container) return;

    var requests = data.recent_requests || [];

    if (requests.length === 0) {
      container.innerHTML =
        '<div class="empty-state"><div class="empty-icon">&rarr;</div>' +
        '<div class="empty-text">No request data yet &mdash; performance metrics appear after MCP tool calls</div></div>';
      destroyChart("responseTime");
      return;
    }

    var colors = getThemeColors();

    // Compute stats
    var totalTime = 0;
    var totalTokens = 0;
    var totalTimeSec = 0;
    var errorCount = 0;
    var batchTasks = 0;
    var queryTasks = 0;
    var batchTokens = 0;
    var batchCost = 0;
    var batchCount = 0;
    var queryTokens = 0;
    var queryCost = 0;
    var queryCount = 0;

    requests.forEach(function (r) {
      totalTime += r.response_time_ms;
      var tokens = r.input_tokens + r.output_tokens;
      totalTokens += tokens;
      totalTimeSec += r.response_time_ms / 1000;
      if (r.error) errorCount++;
      if (r.type === "batch") {
        batchTasks += r.task_count;
        batchTokens += tokens;
        batchCost += r.cost_usd;
        batchCount++;
      } else {
        queryTasks += r.task_count;
        queryTokens += tokens;
        queryCost += r.cost_usd;
        queryCount++;
      }
    });

    var avgResponseMs = Math.round(totalTime / requests.length);
    var throughput = totalTimeSec > 0 ? Math.round(totalTokens / totalTimeSec) : 0;
    var errorRate = ((errorCount / requests.length) * 100).toFixed(1);
    var batchPct = batchTasks + queryTasks > 0
      ? ((batchTasks / (batchTasks + queryTasks)) * 100).toFixed(0) : "0";

    // Trend: compare first half vs second half of recent requests
    var trendIcon = "";
    if (requests.length >= 20) {
      var half = Math.floor(requests.length / 2);
      var oldAvg = requests.slice(0, half).reduce(function (s, r) { return s + r.response_time_ms; }, 0) / half;
      var newAvg = requests.slice(half).reduce(function (s, r) { return s + r.response_time_ms; }, 0) / (requests.length - half);
      trendIcon = newAvg < oldAvg ? " ↓" : newAvg > oldAvg ? " ↑" : "";
    }

    var avgBatchTokens = batchCount > 0 ? Math.round(batchTokens / batchCount) : 0;
    var avgBatchCost = batchCount > 0 ? batchCost / batchCount : 0;
    var avgQueryTokens = queryCount > 0 ? Math.round(queryTokens / queryCount) : 0;
    var avgQueryCost = queryCount > 0 ? queryCost / queryCount : 0;

    container.innerHTML =
      // Hero: avg response time
      '<div class="card"><div class="hero">' +
        '<div class="big-number" style="color:' + colors.blue + '">' + avgResponseMs + 'ms' + trendIcon + '</div>' +
        '<div class="big-label">Average Response Time</div>' +
      '</div></div>' +
      // Response time chart
      '<div class="card"><div class="card-title">Response Time (last ' + requests.length + ' requests)</div>' +
        '<div class="chart-container"><canvas id="chart-response-time"></canvas></div>' +
      '</div>' +
      // Stats grid
      '<div class="grid-3">' +
        '<div class="card"><div class="stat-item">' +
          '<div class="stat-value" style="color:' + colors.green + '">' + batchPct + '%</div>' +
          '<div class="stat-label">Batch Efficiency</div></div></div>' +
        '<div class="card"><div class="stat-item">' +
          '<div class="stat-value" style="color:' + (errorCount > 0 ? colors.red : colors.green) + '">' +
            errorRate + '%</div>' +
          '<div class="stat-label">Error Rate (' + errorCount + '/' + requests.length + ')</div></div></div>' +
        '<div class="card"><div class="stat-item">' +
          '<div class="stat-value" style="color:' + colors.purple + '">' + throughput + '</div>' +
          '<div class="stat-label">Tokens/sec</div></div></div>' +
      '</div>' +
      // Batch vs Query comparison
      '<div class="card"><div class="card-title">Batch vs Query</div>' +
        '<div class="comparison">' +
          '<div class="comparison-item">' +
            '<div class="comp-value" style="color:' + colors.blue + '">' + batchCount + '</div>' +
            '<div class="comp-label">Batch Calls</div>' +
            '<div class="comp-label">' + avgBatchTokens.toLocaleString() + ' avg tokens</div>' +
            '<div class="comp-label">' + formatUsd(avgBatchCost) + ' avg cost</div>' +
          '</div>' +
          '<div class="comparison-vs">vs</div>' +
          '<div class="comparison-item">' +
            '<div class="comp-value" style="color:' + colors.orange + '">' + queryCount + '</div>' +
            '<div class="comp-label">Single Queries</div>' +
            '<div class="comp-label">' + avgQueryTokens.toLocaleString() + ' avg tokens</div>' +
            '<div class="comp-label">' + formatUsd(avgQueryCost) + ' avg cost</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    // Response time line chart
    destroyChart("responseTime");
    var rtCanvas = document.getElementById("chart-response-time");
    if (rtCanvas && typeof Chart !== "undefined") {
      var rtLabels = requests.map(function (_, i) { return i + 1; });
      var rtData = requests.map(function (r) { return r.response_time_ms; });
      var rtColors = requests.map(function (r) { return r.error ? colors.red : r.type === "batch" ? colors.blue : colors.green; });

      charts.responseTime = new Chart(rtCanvas, {
        type: "line",
        data: {
          labels: rtLabels,
          datasets: [{
            label: "Response Time (ms)",
            data: rtData,
            borderColor: colors.blue,
            backgroundColor: colors.blue + "22",
            fill: true,
            tension: 0.2,
            pointRadius: 2,
            pointBackgroundColor: rtColors,
            pointBorderColor: rtColors,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: function (items) { return "Request #" + items[0].label; },
                afterLabel: function (ctx) {
                  var r = requests[ctx.dataIndex];
                  return r.type + (r.caller ? " (" + r.caller + ")" : "") +
                    (r.error ? "\nError: " + r.error : "");
                },
              },
            },
          },
          scales: {
            x: { title: { display: true, text: "Request #" } },
            y: {
              beginAtZero: true,
              title: { display: true, text: "ms" },
            },
          },
        },
      });
    }
  }

  // ── Data Update Handler ────────────────────────
  function handleDataUpdate(payload) {
    currentData = payload.data;
    currentMetrics = payload.metrics;
    if (payload.opusPricing) currentOpusPricing = payload.opusPricing;

    updateHeader(currentData, currentMetrics);
    renderCostSavings(currentData, currentMetrics);
    renderUsagePatterns(currentData, currentMetrics);
    renderPerformance(currentData, currentMetrics);

    // Persist state for webview restore (debounced to avoid rapid writes)
    debouncedSetState({ data: currentData, metrics: currentMetrics, opusPricing: currentOpusPricing });
  }

  // ── Message Listener ───────────────────────────
  window.addEventListener("message", function (event) {
    var message = event.data;
    if (!message) return;

    switch (message.type) {
      case "updateData":
        handleDataUpdate(message.payload);
        break;
    }
  });

  // ── Init ───────────────────────────────────────
  document.addEventListener("DOMContentLoaded", function () {
    initTabs();
    configureChartDefaults();

    // Restore previously saved state
    var state = vscode.getState();
    if (state && state.data && state.metrics) {
      handleDataUpdate(state);
    }
  });
})();

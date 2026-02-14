import * as vscode from "vscode";
import type { UsageData, DerivedMetrics } from "./types.js";
import { computeMetrics } from "./usage-parser.js";
import { MAX_PROMPTS_PER_WINDOW } from "./constants.js";

export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.item.command = "copus.openDashboard";
    this.item.tooltip = "Copus — Click to open dashboard";
    this.showNoData();
    this.item.show();
  }

  /** Update the status bar with fresh usage data */
  update(data: UsageData): void {
    const metrics = computeMetrics(data);
    const used = data.current_window.prompt_count;
    const remaining = metrics.promptsRemaining;
    const cost = data.current_window.estimated_cost_usd;
    const timeStr = formatTimeRemaining(metrics.windowTimeRemainingMs);
    const usagePercent = (used / MAX_PROMPTS_PER_WINDOW) * 100;

    const config = vscode.workspace.getConfiguration("copus");
    const warningThreshold = config.get<number>("warningThreshold") ?? 80;

    if (metrics.windowTimeRemainingMs === 0) {
      this.item.text = `$(error) ${remaining}/${MAX_PROMPTS_PER_WINDOW} | ${formatCostCompact(cost)} | expired`;
      this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
    } else if (usagePercent >= 95) {
      this.item.text = `$(error) ${remaining}/${MAX_PROMPTS_PER_WINDOW} | ${formatCostCompact(cost)} | ${timeStr}`;
      this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
    } else if (usagePercent >= warningThreshold) {
      this.item.text = `$(warning) ${remaining}/${MAX_PROMPTS_PER_WINDOW} | ${formatCostCompact(cost)} | ${timeStr}`;
      this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    } else {
      this.item.text = `$(pulse) ${remaining}/${MAX_PROMPTS_PER_WINDOW} | ${formatCostCompact(cost)} | ${timeStr}`;
      this.item.backgroundColor = undefined;
    }

    this.item.tooltip = buildTooltip(data, metrics);
  }

  /** Show the no-data state */
  showNoData(): void {
    this.item.text = "$(circle-slash) Copus: No data";
    this.item.backgroundColor = undefined;
    this.item.tooltip = "Copus — No usage data found";
  }

  dispose(): void {
    this.item.dispose();
  }
}

function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return "expired";
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/** Format cost for compact display: 4 decimals when < $1, 2 decimals otherwise */
function formatCostCompact(usd: number): string {
  return `$${usd.toFixed(usd < 1 ? 4 : 2)}`;
}

function buildTooltip(data: UsageData, metrics: DerivedMetrics): string {
  const lines = [
    `Prompts: ${data.current_window.prompt_count}/${MAX_PROMPTS_PER_WINDOW} used (${metrics.promptsRemaining} remaining)`,
    `Cost: $${data.current_window.estimated_cost_usd.toFixed(4)}`,
    `Opus equivalent: $${metrics.opusCostEquivalent.toFixed(4)}`,
    `Savings: $${metrics.savingsUsd.toFixed(4)} (${metrics.savingsPercent.toFixed(1)}%)`,
    `Window: ${formatTimeRemaining(metrics.windowTimeRemainingMs)} remaining`,
  ];
  if (metrics.avgResponseTimeMs !== null) {
    lines.push(`Avg response: ${Math.round(metrics.avgResponseTimeMs)}ms`);
  }
  return lines.join("\n");
}

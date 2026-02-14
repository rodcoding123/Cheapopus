import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import * as vscode from "vscode";
import type { UsageData, DerivedMetrics } from "./types.js";
import { MAX_PROMPTS_PER_WINDOW, DEFAULT_OPUS_PRICING, MAX_USAGE_FILE_SIZE } from "./constants.js";

/** Opus pricing from user settings, falling back to defaults */
function getOpusPricing(): { inputPerMillion: number; outputPerMillion: number } {
  const config = vscode.workspace.getConfiguration("copus");
  const pricing = config.get<{ inputPerMillion: number; outputPerMillion: number }>("opusPricing");
  return pricing ?? { ...DEFAULT_OPUS_PRICING };
}

/** Resolve the usage file path from settings or default */
export function getUsageFilePath(): string {
  const config = vscode.workspace.getConfiguration("copus");
  const custom = config.get<string>("usageFilePath");
  if (custom && custom.trim().length > 0) {
    return custom;
  }
  return join(homedir(), ".claude", "llm-swarm-usage.json");
}

/** Read and parse the usage JSON file. Returns null if file is missing, too large, or invalid. */
export async function parseUsageFile(filePath?: string): Promise<UsageData | null> {
  const resolvedPath = filePath ?? getUsageFilePath();
  try {
    // Guard against reading unexpectedly large files
    const fileInfo = await stat(resolvedPath);
    if (fileInfo.size > MAX_USAGE_FILE_SIZE) {
      console.debug(`[Copus] Usage file too large (${fileInfo.size} bytes), skipping`);
      return null;
    }

    const raw = await readFile(resolvedPath, "utf-8");
    const data = JSON.parse(raw) as UsageData;

    // Validate: must have current_window with expected shape
    if (
      !data.current_window ||
      typeof data.current_window.prompt_count !== "number" ||
      typeof data.current_window.window_start !== "string" ||
      typeof data.current_window.window_end !== "string" ||
      typeof data.current_window.estimated_cost_usd !== "number" ||
      typeof data.current_window.total_input_tokens !== "number" ||
      typeof data.current_window.total_output_tokens !== "number"
    ) {
      return null;
    }

    // Ensure arrays exist (backward compatibility)
    if (!Array.isArray(data.daily_totals)) {
      data.daily_totals = [];
    }
    if (!Array.isArray(data.recent_requests)) {
      data.recent_requests = [];
    }

    return data;
  } catch (error) {
    console.debug("[Copus] Failed to parse usage file:", error);
    return null;
  }
}

/** What the given tokens would cost on Opus */
export function opusCostEquivalent(inputTokens: number, outputTokens: number): number {
  const pricing = getOpusPricing();
  return (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (outputTokens / 1_000_000) * pricing.outputPerMillion;
}

/** Get current Opus pricing for passing to webview */
export function getOpusPricingForWebview(): { inputPerMillion: number; outputPerMillion: number } {
  return getOpusPricing();
}

/** Compute all derived metrics from usage data */
export function computeMetrics(data: UsageData): DerivedMetrics {
  const w = data.current_window;
  const totalInputTokens = w.total_input_tokens;
  const totalOutputTokens = w.total_output_tokens;
  const actualCost = w.estimated_cost_usd;

  const opusCost = opusCostEquivalent(totalInputTokens, totalOutputTokens);
  const savingsUsd = opusCost - actualCost;
  const savingsPercent = opusCost > 0 ? (savingsUsd / opusCost) * 100 : 0;

  const windowEnd = new Date(w.window_end).getTime();
  const windowTimeRemainingMs = Math.max(0, windowEnd - Date.now());

  const promptsRemaining = Math.max(0, MAX_PROMPTS_PER_WINDOW - w.prompt_count);

  // Recent request metrics
  const requests = data.recent_requests ?? [];
  let avgResponseTimeMs: number | null = null;
  let batchEfficiency: number | null = null;
  let errorRate: number | null = null;

  if (requests.length > 0) {
    const totalResponseTime = requests.reduce((sum, r) => sum + r.response_time_ms, 0);
    avgResponseTimeMs = totalResponseTime / requests.length;

    const totalTasks = requests.reduce((sum, r) => sum + r.task_count, 0);
    const batchTasks = requests
      .filter((r) => r.type === "batch")
      .reduce((sum, r) => sum + r.task_count, 0);
    batchEfficiency = totalTasks > 0 ? batchTasks / totalTasks : 0;

    const errorCount = requests.filter((r) => r.error != null).length;
    errorRate = errorCount / requests.length;
  }

  return {
    opusCostEquivalent: opusCost,
    savingsUsd,
    savingsPercent,
    windowTimeRemainingMs,
    promptsRemaining,
    avgResponseTimeMs,
    batchEfficiency,
    errorRate,
  };
}

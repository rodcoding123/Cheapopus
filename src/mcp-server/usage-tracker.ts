/**
 * Tracks MiniMax API usage per 5-hour window.
 * Writes to ~/.claude/llm-swarm-usage.json for monitoring.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { PRICING } from "./minimax-client.js";

interface UsageWindow {
  window_start: string; // ISO timestamp
  window_end: string;
  prompt_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  estimated_cost_usd: number;
}

interface DailyTotal {
  date: string;
  prompt_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  estimated_cost_usd: number;
}

interface RequestLog {
  timestamp: string; // ISO
  type: "query" | "batch";
  task_count: number; // 1 for query, N for batch
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  response_time_ms: number;
  caller?: string; // skill name if available
  error?: string; // omitted if success
  failed_count?: number; // batch only: number of tasks that failed
}

interface PipelineRun {
  id: string;
  started: string;
  completed?: string;
  skill_chain: string[];       // e.g. ["copus:review", "copus:fix"]
  findings_total: number;
  findings_by_difficulty: Record<string, number>;
  minimax_tasks: number;
  opus_tasks: number;
  minimax_cost_usd: number;
  status: "running" | "completed" | "failed";
}

interface UsageData {
  current_window: UsageWindow;
  daily_totals: DailyTotal[];
  recent_requests?: RequestLog[]; // backward-compatible (optional)
  pipeline_runs?: PipelineRun[]; // backward-compatible (optional, 10-run rolling window)
  provider?: {
    name: string;
    pricing: { input_per_million: number; output_per_million: number };
  };
}

const WINDOW_DURATION_MS = 5 * 60 * 60 * 1000; // 5 hours
const MAX_PROMPTS_PER_WINDOW = 1000; // MiniMax Coding Plan Max limit

function getUsageFilePath(): string {
  return join(homedir(), ".claude", "llm-swarm-usage.json");
}

function createNewWindow(): UsageWindow {
  const now = new Date();
  const end = new Date(now.getTime() + WINDOW_DURATION_MS);
  return {
    window_start: now.toISOString(),
    window_end: end.toISOString(),
    prompt_count: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    estimated_cost_usd: 0,
  };
}

async function loadUsageData(): Promise<UsageData> {
  try {
    const raw = await readFile(getUsageFilePath(), "utf-8");
    const data = JSON.parse(raw) as UsageData;

    // Ensure new fields exist (backward-compatible)
    if (!data.recent_requests) {
      data.recent_requests = [];
    }
    if (!data.provider) {
      data.provider = {
        name: "minimax-m2.5",
        pricing: { input_per_million: PRICING.input_per_million, output_per_million: PRICING.output_per_million },
      };
    }

    return data;
  } catch {
    return {
      current_window: createNewWindow(),
      daily_totals: [],
      recent_requests: [],
      provider: {
        name: "minimax-m2.5",
        pricing: { input_per_million: PRICING.input_per_million, output_per_million: PRICING.output_per_million },
      },
    };
  }
}

async function saveUsageData(data: UsageData): Promise<void> {
  const filePath = getUsageFilePath();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function isWindowExpired(window: UsageWindow): boolean {
  return new Date() >= new Date(window.window_end);
}

function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export class UsageTracker {
  private data: UsageData | null = null;

  private async ensureLoaded(): Promise<UsageData> {
    if (!this.data) {
      this.data = await loadUsageData();
    }

    // Check if window expired
    if (isWindowExpired(this.data.current_window)) {
      this.data.current_window = createNewWindow();
    }

    return this.data;
  }

  async recordRequest(params: {
    type: "query" | "batch";
    taskCount: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    responseTimeMs: number;
    caller?: string;
    error?: string;
    failedCount?: number;
    pipeline?: {
      skill_chain: string[];
      findings_total?: number;
      minimax_eligible?: number;
      opus_required?: number;
    };
  }): Promise<void> {
    const data = await this.ensureLoaded();

    // Truncate error messages to prevent JSON bloat (API errors can be very long)
    const truncatedError = params.error
      ? params.error.length > 500 ? params.error.slice(0, 500) + "..." : params.error
      : undefined;

    // Create request log entry
    const requestLog: RequestLog = {
      timestamp: new Date().toISOString(),
      type: params.type,
      task_count: params.taskCount,
      input_tokens: params.inputTokens,
      output_tokens: params.outputTokens,
      cost_usd: params.costUsd,
      response_time_ms: params.responseTimeMs,
      caller: params.caller,
      error: truncatedError,
      failed_count: params.failedCount,
    };

    // Add to recent_requests (FIFO cap at 200)
    if (!data.recent_requests) {
      data.recent_requests = [];
    }
    data.recent_requests.push(requestLog);
    if (data.recent_requests.length > 200) {
      data.recent_requests = data.recent_requests.slice(-200);
    }

    // Inline window + daily update
    data.current_window.prompt_count += params.taskCount;
    data.current_window.total_input_tokens += params.inputTokens;
    data.current_window.total_output_tokens += params.outputTokens;
    data.current_window.estimated_cost_usd += params.costUsd;

    const today = getTodayDate();
    let dailyEntry = data.daily_totals.find((d) => d.date === today);
    if (!dailyEntry) {
      dailyEntry = { date: today, prompt_count: 0, total_input_tokens: 0, total_output_tokens: 0, estimated_cost_usd: 0 };
      data.daily_totals.push(dailyEntry);
      if (data.daily_totals.length > 30) {
        data.daily_totals = data.daily_totals.slice(-30);
      }
    }
    dailyEntry.prompt_count += params.taskCount;
    dailyEntry.total_input_tokens += params.inputTokens;
    dailyEntry.total_output_tokens += params.outputTokens;
    dailyEntry.estimated_cost_usd += params.costUsd;

    // Pipeline tracking (backward-compatible)
    if (params.pipeline && params.caller) {
      if (!data.pipeline_runs) {
        data.pipeline_runs = [];
      }

      const run: PipelineRun = {
        id: `run-${Date.now()}`,
        started: new Date().toISOString(),
        completed: new Date().toISOString(),
        skill_chain: params.pipeline.skill_chain,
        findings_total: params.pipeline.findings_total ?? 0,
        findings_by_difficulty: {},
        minimax_tasks: params.pipeline.minimax_eligible ?? 0,
        opus_tasks: params.pipeline.opus_required ?? 0,
        minimax_cost_usd: params.costUsd,
        status: params.error ? "failed" : "completed",
      };

      data.pipeline_runs.push(run);
      // Keep rolling window of 10 runs
      if (data.pipeline_runs.length > 10) {
        data.pipeline_runs = data.pipeline_runs.slice(-10);
      }
    }

    await saveUsageData(data);
  }

  async getRemainingPrompts(): Promise<number> {
    const data = await this.ensureLoaded();
    return Math.max(0, MAX_PROMPTS_PER_WINDOW - data.current_window.prompt_count);
  }

  async getUsageSummary(): Promise<string> {
    const data = await this.ensureLoaded();
    const remaining = MAX_PROMPTS_PER_WINDOW - data.current_window.prompt_count;
    const today = getTodayDate();
    const dailyEntry = data.daily_totals.find((d) => d.date === today);

    return [
      `Window: ${data.current_window.prompt_count}/${MAX_PROMPTS_PER_WINDOW} prompts used`,
      `Remaining: ${remaining} prompts`,
      `Window expires: ${data.current_window.window_end}`,
      dailyEntry
        ? `Today: ${dailyEntry.prompt_count} prompts, $${dailyEntry.estimated_cost_usd.toFixed(4)} estimated`
        : "Today: 0 prompts",
    ].join("\n");
  }
}

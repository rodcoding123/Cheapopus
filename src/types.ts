/** Mirrors the enhanced schema from llm-swarm MCP server's usage-tracker.ts */

export interface UsageWindow {
  window_start: string; // ISO timestamp
  window_end: string;
  prompt_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  estimated_cost_usd: number;
}

export interface DailyTotal {
  date: string; // YYYY-MM-DD
  prompt_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  estimated_cost_usd: number;
}

export interface RequestLog {
  timestamp: string; // ISO
  type: "query" | "batch";
  task_count: number; // 1 for query, N for batch
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  response_time_ms: number;
  caller?: string;
  error?: string;
  failed_count?: number; // batch only: number of tasks that failed
}

export interface ProviderInfo {
  name: string;
  pricing: {
    input_per_million: number;
    output_per_million: number;
  };
}

export interface UsageData {
  current_window: UsageWindow;
  daily_totals: DailyTotal[];
  recent_requests?: RequestLog[];
  provider?: ProviderInfo;
}

export interface DerivedMetrics {
  /** What the same tokens would cost on Opus */
  opusCostEquivalent: number;
  /** Dollar amount saved (opus cost - actual cost) */
  savingsUsd: number;
  /** Percentage saved vs Opus */
  savingsPercent: number;
  /** Milliseconds until current window expires */
  windowTimeRemainingMs: number;
  /** Prompts remaining in current window */
  promptsRemaining: number;
  /** Average response time from recent requests (ms), null if no data */
  avgResponseTimeMs: number | null;
  /** Ratio of batch prompts to total prompts (0-1), null if no data */
  batchEfficiency: number | null;
  /** Error rate from recent requests (0-1), null if no data */
  errorRate: number | null;
}

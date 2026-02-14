/**
 * Parallel batch processor with concurrency control.
 * Fans out multiple MiniMax queries simultaneously with configurable limits.
 */

import { MinimaxClient, type MinimaxUsage, estimateCost } from "./minimax-client.js";

export interface BatchTask {
  id: string;
  prompt: string;
  system?: string;
  max_tokens?: number;
}

export interface BatchResult {
  id: string;
  response: string;
  usage: MinimaxUsage;
  success: boolean;
  error?: string;
}

export interface BatchSummary {
  total_tasks: number;
  succeeded: number;
  failed: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  duration_ms: number;
}

export class BatchProcessor {
  private client: MinimaxClient;
  private defaultConcurrency: number;

  constructor(client: MinimaxClient) {
    this.client = client;
    this.defaultConcurrency = parseInt(process.env.MINIMAX_MAX_CONCURRENCY || "5", 10);
  }

  async processBatch(
    tasks: BatchTask[],
    concurrency?: number
  ): Promise<{ results: BatchResult[]; summary: BatchSummary }> {
    const maxConcurrent = concurrency ?? this.defaultConcurrency;
    const startTime = Date.now();
    const results: BatchResult[] = [];

    // Process in chunks of maxConcurrent
    for (let i = 0; i < tasks.length; i += maxConcurrent) {
      const chunk = tasks.slice(i, i + maxConcurrent);
      const chunkResults = await Promise.allSettled(
        chunk.map((task) => this.processTask(task))
      );

      for (let j = 0; j < chunkResults.length; j++) {
        const result = chunkResults[j];
        if (result.status === "fulfilled") {
          results.push(result.value);
        } else {
          results.push({
            id: chunk[j].id,
            response: "",
            usage: { input_tokens: 0, output_tokens: 0 },
            success: false,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
        }
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const totalInputTokens = results.reduce((sum, r) => sum + r.usage.input_tokens, 0);
    const totalOutputTokens = results.reduce((sum, r) => sum + r.usage.output_tokens, 0);

    return {
      results,
      summary: {
        total_tasks: tasks.length,
        succeeded,
        failed: tasks.length - succeeded,
        total_input_tokens: totalInputTokens,
        total_output_tokens: totalOutputTokens,
        total_cost_usd: estimateCost({ input_tokens: totalInputTokens, output_tokens: totalOutputTokens }),
        duration_ms: Date.now() - startTime,
      },
    };
  }

  private async processTask(task: BatchTask): Promise<BatchResult> {
    const result = await this.client.query(task.prompt, {
      system: task.system,
      max_tokens: task.max_tokens,
    });

    return {
      id: task.id,
      response: result.response,
      usage: result.usage,
      success: true,
    };
  }
}

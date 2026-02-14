#!/usr/bin/env node

/**
 * Copus MCP Server (llm-swarm)
 *
 * Exposes MiniMax M2.5 as tools for Claude Code:
 *   - llm_query: Single prompt -> MiniMax -> response
 *   - llm_batch: Parallel fan-out of multiple prompts
 *
 * Bundled inside the Copus VS Code extension.
 * Registered in ~/.claude/mcp.json and called by Opus
 * for offloading grunt work to a cheaper, faster model.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { MinimaxClient } from "./minimax-client.js";
import { BatchProcessor } from "./batch-processor.js";
import { UsageTracker } from "./usage-tracker.js";

const server = new McpServer({
  name: "llm-swarm",
  version: "1.0.0",
});

let client: MinimaxClient;
let batchProcessor: BatchProcessor;
const usageTracker = new UsageTracker();

try {
  client = new MinimaxClient();
  batchProcessor = new BatchProcessor(client);
} catch (err) {
  // Client creation failed (missing API key) — tools will return errors
  process.stderr.write(`[llm-swarm] Warning: ${err instanceof Error ? err.message : err}\n`);
}

// ── Tool: llm_query ──────────────────────────────────────────────
server.tool(
  "llm_query",
  "Send a single prompt to MiniMax M2.5 and get a response. Use for individual analysis tasks.",
  {
    prompt: z.string().describe("The prompt to send to MiniMax M2.5"),
    system: z.string().optional().describe("Optional system prompt for context/instructions"),
    max_tokens: z.number().int().min(1).max(65536).optional().describe("Max response tokens (default: 4096)"),
    temperature: z.number().min(0).max(2).optional().describe("Sampling temperature 0-2 (default: 0.3)"),
    caller: z.string().max(128).optional().describe("Optional skill/caller name for usage tracking"),
  },
  async ({ prompt, system, max_tokens, temperature, caller }) => {
    const startTime = Date.now();

    if (!client) {
      return {
        content: [{ type: "text" as const, text: "Error: MiniMax client not initialized. Check MINIMAX_API_KEY." }],
        isError: true,
      };
    }

    try {
      const remaining = await usageTracker.getRemainingPrompts();
      if (remaining <= 0) {
        return {
          content: [{ type: "text" as const, text: "Rate limit: 0 prompts remaining in current 5-hour window. Try again later." }],
          isError: true,
        };
      }

      const result = await client.query(prompt, { system, max_tokens, temperature });
      const responseTimeMs = Date.now() - startTime;

      await usageTracker.recordRequest({
        type: "query",
        taskCount: 1,
        inputTokens: result.usage.input_tokens,
        outputTokens: result.usage.output_tokens,
        costUsd: result.cost_estimate_usd,
        responseTimeMs,
        caller,
      });

      const output = {
        response: result.response,
        model: result.model,
        usage: result.usage,
        cost_estimate_usd: result.cost_estimate_usd,
        prompts_remaining: remaining - 1,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
      };
    } catch (err) {
      const responseTimeMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);

      await usageTracker.recordRequest({
        type: "query",
        taskCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        responseTimeMs,
        caller,
        error: errorMsg,
      });

      return {
        content: [{ type: "text" as const, text: `MiniMax API error: ${errorMsg}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: llm_batch ──────────────────────────────────────────────
server.tool(
  "llm_batch",
  "Send multiple prompts to MiniMax M2.5 in parallel. Use for batch analysis, parallel code review, bulk file scanning.",
  {
    tasks: z
      .array(
        z.object({
          id: z.string().describe("Unique identifier for this task"),
          prompt: z.string().describe("The prompt for this task"),
          system: z.string().optional().describe("Optional system prompt"),
          max_tokens: z.number().int().min(1).max(65536).optional().describe("Max response tokens for this task"),
        })
      )
      .min(1)
      .max(50)
      .describe("Array of tasks to process in parallel (1-50)"),
    concurrency: z.number().int().min(1).max(20).optional().describe("Max concurrent requests 1-20 (default: 5)"),
    caller: z.string().max(128).optional().describe("Optional skill/caller name for usage tracking"),
    pipeline: z.object({
      skill_chain: z.array(z.string()).describe("Skill chain that triggered this batch"),
      findings_total: z.number().int().optional().describe("Total findings from review"),
      minimax_eligible: z.number().int().optional().describe("Findings routed to MiniMax"),
      opus_required: z.number().int().optional().describe("Findings routed to Opus"),
    }).optional().describe("Optional pipeline context for dashboard tracking"),
  },
  async ({ tasks, concurrency, caller, pipeline }) => {
    const startTime = Date.now();

    if (!batchProcessor) {
      return {
        content: [{ type: "text" as const, text: "Error: MiniMax client not initialized. Check MINIMAX_API_KEY." }],
        isError: true,
      };
    }

    try {
      const remaining = await usageTracker.getRemainingPrompts();
      if (remaining < tasks.length) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Rate limit: Only ${remaining} prompts remaining but ${tasks.length} requested. Reduce batch size or wait for window reset.`,
            },
          ],
          isError: true,
        };
      }

      const { results, summary } = await batchProcessor.processBatch(tasks, concurrency);
      const responseTimeMs = Date.now() - startTime;

      await usageTracker.recordRequest({
        type: "batch",
        taskCount: summary.succeeded,
        inputTokens: summary.total_input_tokens,
        outputTokens: summary.total_output_tokens,
        costUsd: summary.total_cost_usd,
        responseTimeMs,
        caller,
        failedCount: summary.failed > 0 ? summary.failed : undefined,
        pipeline,
      });

      const output = {
        results,
        summary: {
          ...summary,
          prompts_remaining: remaining - summary.succeeded,
        },
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
      };
    } catch (err) {
      const responseTimeMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);

      await usageTracker.recordRequest({
        type: "batch",
        taskCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        responseTimeMs,
        caller,
        error: errorMsg,
      });

      return {
        content: [{ type: "text" as const, text: `Batch processing error: ${errorMsg}` }],
        isError: true,
      };
    }
  }
);

// ── Start server ─────────────────────────────────────────────────
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[llm-swarm] MCP server started\n");
}

main().catch((err) => {
  process.stderr.write(`[llm-swarm] Fatal error: ${err}\n`);
  process.exit(1);
});

/**
 * MiniMax M2.5 API client using Anthropic Messages API format.
 * Calls https://api.minimax.io/anthropic/v1/messages
 */

export interface MinimaxMessage {
  role: "user" | "assistant";
  content: string;
}

export interface MinimaxRequest {
  model: string;
  max_tokens: number;
  temperature?: number;
  system?: string;
  messages: MinimaxMessage[];
}

export interface MinimaxUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface MinimaxResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{ type: string; text: string }>;
  model: string;
  usage: MinimaxUsage;
}

// MiniMax M2.5 pricing (per million tokens) — single source of truth
export const PRICING = {
  input_per_million: 0.15,
  output_per_million: 1.20,
} as const;

export function estimateCost(usage: MinimaxUsage): number {
  const inputCost = (usage.input_tokens / 1_000_000) * PRICING.input_per_million;
  const outputCost = (usage.output_tokens / 1_000_000) * PRICING.output_per_million;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000; // 6 decimal places
}

export class MinimaxClient {
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private defaultMaxTokens: number;

  constructor() {
    this.baseUrl = process.env.MINIMAX_BASE_URL || "https://api.minimax.io/anthropic";
    this.apiKey = process.env.MINIMAX_API_KEY || "";
    this.model = process.env.MINIMAX_MODEL || "MiniMax-M2.5";
    this.defaultMaxTokens = parseInt(process.env.MINIMAX_MAX_TOKENS_DEFAULT || "4096", 10);

    if (!this.apiKey) {
      throw new Error("MINIMAX_API_KEY environment variable is required");
    }
  }

  async query(
    prompt: string,
    options?: {
      system?: string;
      max_tokens?: number;
      temperature?: number;
    }
  ): Promise<{ response: string; model: string; usage: MinimaxUsage; cost_estimate_usd: number }> {
    const body: MinimaxRequest = {
      model: this.model,
      max_tokens: options?.max_tokens ?? this.defaultMaxTokens,
      temperature: options?.temperature ?? 0.3,
      messages: [{ role: "user", content: prompt }],
    };

    if (options?.system) {
      body.system = options.system;
    }

    const url = `${this.baseUrl}/v1/messages`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      throw new Error(`MiniMax API error ${res.status}: ${errorText}`);
    }

    const data = (await res.json()) as MinimaxResponse;

    const responseText = data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    const usage = data.usage ?? { input_tokens: 0, output_tokens: 0 };

    return {
      response: responseText,
      model: data.model || this.model,
      usage,
      cost_estimate_usd: estimateCost(usage),
    };
  }
}

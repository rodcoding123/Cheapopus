# Copus — MCP Swarm Pipeline for VS Code

Real-time cost analytics and development pipeline for MCP LLM swarms. See how much you're saving versus Claude Opus at a glance, then use the integrated skill chain to route intelligence to Opus and labor to cheaper models.

## Features

**Status Bar** — Always-visible widget showing prompts remaining, current cost, and time left in your window. Color-coded severity: green (normal), yellow (warning threshold), red (>95% or expired). Click to open the full dashboard.

**Cost Savings Tab** — Hero metric showing total saved vs Opus, side-by-side cost comparison, 30-day daily cost bar chart (actual vs Opus equivalent), and savings statistics.

**Usage Patterns Tab** — Current window progress bar, daily prompt line chart, input/output token distribution doughnut, and caller breakdown pie chart.

**Performance Tab** — Average response time with trend indicator, response time line chart (color-coded by type and errors), batch efficiency, error rate, throughput (tokens/sec), and batch vs query comparison.

**Theme Aware** — Automatically matches your VS Code color theme (light, dark, high contrast).

**Zero Coupling** — Reads a JSON file on disk. Works with any MCP server that writes to the expected schema. No network calls, no authentication, no API keys.

## Installation

### From .vsix

```bash
code --install-extension copus-0.2.0.vsix
```

### From Source

```bash
git clone https://github.com/rodcoding123/Cheapopus.git
cd Cheapopus
npm install
npm run compile
```

Then press `F5` in VS Code to launch the Extension Development Host, or package it:

```bash
npx @vscode/vsce package --no-dependencies
code --install-extension copus-0.2.0.vsix
```

## Configuration

Open **Settings > Extensions > Copus** or add to `settings.json`:

| Setting | Type | Default | Description |
|---|---|---|---|
| `copus.usageFilePath` | `string` | `""` | Path to `llm-swarm-usage.json`. Leave empty for default (`~/.claude/llm-swarm-usage.json`). |
| `copus.refreshInterval` | `number` | `30` | Polling interval in seconds (5-300). Fallback when the file watcher misses changes. |
| `copus.opusPricing` | `object` | `{ inputPerMillion: 15, outputPerMillion: 75 }` | Opus pricing for cost comparison. Adjust if Anthropic changes pricing. |
| `copus.warningThreshold` | `number` | `80` | Percentage of prompts used before the status bar turns yellow (50-99). |

## How It Works

```
VS Code Extension Host
  |
  +-- File Watcher (watches ~/.claude/llm-swarm-usage.json)
  |     + 30-second polling fallback
  |
  +-- Status Bar Item (right side, priority 100)
  |     850/1000 | $0.12 | 2h 15m
  |
  +-- Webview Dashboard (opened on click or via command palette)
        3 tabs: Cost Savings | Usage Patterns | Performance
        Chart.js visualizations, VS Code theme colors
```

The extension watches `llm-swarm-usage.json` — a file written by the bundled MCP server. When the file changes, the status bar updates instantly and the dashboard re-renders. No network requests, no API calls — pure local file reads.

### Data Schema

The extension expects a JSON file with this structure:

```jsonc
{
  "current_window": {
    "window_start": "2026-02-13T10:00:00Z",
    "window_end": "2026-02-13T15:00:00Z",
    "prompt_count": 42,
    "total_input_tokens": 150000,
    "total_output_tokens": 50000,
    "estimated_cost_usd": 0.0825
  },
  "daily_totals": [
    {
      "date": "2026-02-13",
      "prompt_count": 42,
      "total_input_tokens": 150000,
      "total_output_tokens": 50000,
      "estimated_cost_usd": 0.0825
    }
  ],
  "recent_requests": [
    {
      "timestamp": "2026-02-13T12:30:00Z",
      "type": "batch",
      "task_count": 4,
      "input_tokens": 5000,
      "output_tokens": 2000,
      "cost_usd": 0.003,
      "response_time_ms": 1200,
      "caller": "copus:review"
    }
  ]
}
```

`daily_totals` and `recent_requests` are optional for backward compatibility.

## Development

```bash
npm install          # Install dependencies
npm run compile      # Build (vendor copy + esbuild)
npm run watch        # Watch mode (auto-rebuild on change)
npm run lint         # Type check (tsc --noEmit)
```

### Project Structure

```
copus/
  src/
    extension.ts       Entry point (activate/deactivate)
    status-bar.ts      Status bar widget with severity colors
    file-watcher.ts    FS watcher + polling fallback
    webview-panel.ts   Singleton webview panel manager
    usage-parser.ts    JSON parser + derived metrics
    types.ts           TypeScript interfaces
    constants.ts       Shared constants
  media/
    dashboard.css      Theme-aware webview styles
    dashboard.js       Tab navigation + Chart.js rendering
    vendor/
      chart.min.js     Chart.js UMD bundle (vendored)
  dist/
    extension.js       Bundled output (esbuild)
```

## License

MIT

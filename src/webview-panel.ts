import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import type { UsageData } from "./types.js";
import { computeMetrics, getOpusPricingForWebview } from "./usage-parser.js";

let currentPanel: SwarmDashboardPanel | undefined;

export class SwarmDashboardPanel implements vscode.Disposable {
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly disposables: vscode.Disposable[] = [];
  private disposed = false;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  /** Create or reveal the singleton dashboard panel */
  static createOrShow(extensionUri: vscode.Uri): SwarmDashboardPanel {
    if (currentPanel) {
      currentPanel.panel.reveal(vscode.ViewColumn.One);
      return currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      "swarmMonitorDashboard",
      "Swarm Monitor",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "media"),
        ],
      },
    );

    const instance = new SwarmDashboardPanel(panel, extensionUri);
    panel.webview.html = instance.getHtmlForWebview();
    currentPanel = instance;
    return instance;
  }

  /** Send usage data + derived metrics + pricing config to the webview */
  postData(data: UsageData): void {
    if (this.disposed) return;
    const metrics = computeMetrics(data);
    const opusPricing = getOpusPricingForWebview();
    this.panel.webview.postMessage({
      type: "updateData",
      payload: { data, metrics, opusPricing },
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }

  /** Resolve a media path to a webview-safe URI */
  private mediaUri(...pathSegments: string[]): vscode.Uri {
    return this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", ...pathSegments),
    );
  }

  private getHtmlForWebview(): string {
    const webview = this.panel.webview;
    const nonce = randomBytes(16).toString("hex");

    const cssUri = this.mediaUri("dashboard.css");
    const chartUri = this.mediaUri("vendor", "chart.min.js");
    const scriptUri = this.mediaUri("dashboard.js");

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:;">
  <link rel="stylesheet" href="${cssUri}">
  <title>Swarm Monitor</title>
</head>
<body>
  <!-- Header: window status -->
  <div class="header">
    <div class="header-stat">
      <span class="label">Prompts Remaining</span>
      <span class="value" id="header-prompts">&mdash;</span>
    </div>
    <div class="header-stat">
      <span class="label">Window Cost</span>
      <span class="value" id="header-cost">&mdash;</span>
    </div>
    <div class="header-stat">
      <span class="label">Time Left</span>
      <span class="value" id="header-time">&mdash;</span>
    </div>
    <div class="header-stat">
      <span class="label">Saved vs Opus</span>
      <span class="value savings" id="header-savings">&mdash;</span>
    </div>
  </div>

  <!-- Tab Navigation -->
  <div class="tabs">
    <button class="tab active" data-tab="cost">Cost Savings</button>
    <button class="tab" data-tab="usage">Usage Patterns</button>
    <button class="tab" data-tab="perf">Performance</button>
  </div>

  <!-- Tab: Cost Savings -->
  <div id="tab-cost" class="tab-content active">
    <div id="cost-content">
      <div class="empty-state">
        <div class="empty-icon">&dollar;</div>
        <div class="empty-text">Start using MCP tools to see cost savings here</div>
      </div>
    </div>
  </div>

  <!-- Tab: Usage Patterns -->
  <div id="tab-usage" class="tab-content">
    <div id="usage-content">
      <div class="empty-state">
        <div class="empty-icon">&sim;</div>
        <div class="empty-text">No usage data yet</div>
      </div>
    </div>
  </div>

  <!-- Tab: Performance -->
  <div id="tab-perf" class="tab-content">
    <div id="perf-content">
      <div class="empty-state">
        <div class="empty-icon">&rarr;</div>
        <div class="empty-text">No request data yet &mdash; performance metrics appear after MCP tool calls</div>
      </div>
    </div>
  </div>

  <script nonce="${nonce}" src="${chartUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

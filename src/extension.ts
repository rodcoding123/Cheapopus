import * as vscode from "vscode";
import { StatusBar } from "./status-bar.js";
import { FileWatcher } from "./file-watcher.js";
import { SwarmDashboardPanel } from "./webview-panel.js";
import { parseUsageFile } from "./usage-parser.js";

let statusBar: StatusBar | undefined;
let fileWatcher: FileWatcher | undefined;
let dashboardPanel: SwarmDashboardPanel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel("Swarm Monitor");
  outputChannel.appendLine("Swarm Monitor activated");

  // Status bar
  statusBar = new StatusBar();

  // File watcher with polling fallback
  fileWatcher = new FileWatcher(statusBar);
  fileWatcher.setDataUpdateCallback((data) => {
    dashboardPanel?.postData(data);
  });
  fileWatcher.start();

  // Command: open dashboard webview
  const openDashboard = vscode.commands.registerCommand(
    "swarmMonitor.openDashboard",
    async () => {
      dashboardPanel = SwarmDashboardPanel.createOrShow(context.extensionUri);

      // Send current data immediately on open
      const data = await parseUsageFile();
      if (data) {
        dashboardPanel.postData(data);
      }
    },
  );

  context.subscriptions.push(outputChannel, statusBar, fileWatcher, openDashboard);
}

export function deactivate(): void {
  // statusBar and fileWatcher are in context.subscriptions — VS Code disposes them.
  // dashboardPanel is created lazily and not in subscriptions, so dispose it here.
  dashboardPanel?.dispose();
  statusBar = undefined;
  fileWatcher = undefined;
  dashboardPanel = undefined;
}

import * as vscode from "vscode";
import { dirname, basename } from "node:path";
import { getUsageFilePath, parseUsageFile } from "./usage-parser.js";
import type { StatusBar } from "./status-bar.js";
import type { UsageData } from "./types.js";

export type DataUpdateCallback = (data: UsageData) => void;

export class FileWatcher implements vscode.Disposable {
  private fsWatcher: vscode.FileSystemWatcher | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly statusBar: StatusBar;
  private onDataUpdate: DataUpdateCallback | undefined;
  private restarting = false;

  constructor(statusBar: StatusBar) {
    this.statusBar = statusBar;
  }

  /** Start watching the usage file. Call once from activate(). */
  start(): void {
    const filePath = getUsageFilePath();
    const fileName = basename(filePath);

    // Initial read
    void this.safeRefresh();

    // File system watcher — glob pattern for the specific file
    const pattern = new vscode.RelativePattern(
      vscode.Uri.file(dirname(filePath)),
      fileName,
    );
    this.fsWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    this.fsWatcher.onDidChange(() => void this.safeRefresh(), undefined, this.disposables);
    this.fsWatcher.onDidCreate(() => void this.safeRefresh(), undefined, this.disposables);
    this.fsWatcher.onDidDelete(() => this.statusBar.showNoData(), undefined, this.disposables);

    // Polling fallback (file watcher can miss changes on some OS)
    const config = vscode.workspace.getConfiguration("swarmMonitor");
    const intervalSec = config.get<number>("refreshInterval") ?? 30;
    this.pollTimer = setInterval(() => void this.safeRefresh(), intervalSec * 1000);

    // Re-initialize if settings change
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("swarmMonitor")) {
        this.restart();
      }
    }, undefined, this.disposables);
  }

  /** Register a callback for data updates (used by webview panel) */
  setDataUpdateCallback(cb: DataUpdateCallback | undefined): void {
    this.onDataUpdate = cb;
  }

  /** Read file and push updates to status bar + webview */
  async refresh(): Promise<void> {
    const data = await parseUsageFile();
    if (data) {
      this.statusBar.update(data);
      this.onDataUpdate?.(data);
    } else {
      this.statusBar.showNoData();
    }
  }

  /** Refresh with error boundary — prevents unhandled rejections from event handlers */
  private async safeRefresh(): Promise<void> {
    try {
      await this.refresh();
    } catch (error) {
      console.debug("[Swarm Monitor] Refresh failed:", error);
    }
  }

  /** Restart watcher (e.g. after settings change). Guarded against re-entrancy. */
  private restart(): void {
    if (this.restarting) return;
    this.restarting = true;
    try {
      this.stopWatching();
      this.start();
    } finally {
      this.restarting = false;
    }
  }

  private stopWatching(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    if (this.fsWatcher) {
      this.fsWatcher.dispose();
      this.fsWatcher = undefined;
    }
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }

  dispose(): void {
    this.stopWatching();
  }
}

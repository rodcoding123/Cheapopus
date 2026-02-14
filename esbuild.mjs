import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");

// ── Vendor copy: Chart.js UMD bundle → media/vendor/ ──
function copyVendorAssets() {
  const src = resolve(__dirname, "node_modules/chart.js/dist/chart.umd.js");
  const destDir = resolve(__dirname, "media/vendor");
  const dest = resolve(destDir, "chart.min.js");

  if (!existsSync(src)) {
    console.warn("Warning: chart.js UMD bundle not found at", src);
    return;
  }
  mkdirSync(destDir, { recursive: true });
  copyFileSync(src, dest);
  console.log("Vendor: chart.js → media/vendor/chart.min.js");
}

copyVendorAssets();

// ── Target 1: VS Code extension (CJS) ──
/** @type {import('esbuild').BuildOptions} */
const extensionOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
  minify: false,
};

// ── Target 2: MCP server (ESM, stdio) ──
/** @type {import('esbuild').BuildOptions} */
const mcpServerOptions = {
  entryPoints: ["src/mcp-server/index.ts"],
  bundle: true,
  outfile: "dist/mcp-server.js",
  format: "esm",
  platform: "node",
  target: "node18",
  sourcemap: true,
  minify: false,
  banner: {
    js: 'import{createRequire}from"module";const require=createRequire(import.meta.url);',
  },
};

if (watch) {
  const [extCtx, mcpCtx] = await Promise.all([
    esbuild.context(extensionOptions),
    esbuild.context(mcpServerOptions),
  ]);
  await Promise.all([extCtx.watch(), mcpCtx.watch()]);
  console.log("Watching for changes (extension + mcp-server)...");
} else {
  await Promise.all([
    esbuild.build(extensionOptions),
    esbuild.build(mcpServerOptions),
  ]);
  console.log("Build complete: dist/extension.js + dist/mcp-server.js");
}

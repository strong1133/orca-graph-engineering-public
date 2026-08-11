import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { panelBootstrapScript } from "./panel-bootstrap.mjs";
import { prepareRuntimeDirectory, resolveRuntimeDirectory } from "./runtime-path.mjs";

const root = process.cwd();
const outputPath = process.env.ORCA_GRAPH_BUILD_OUTPUT
  ? path.resolve(process.env.ORCA_GRAPH_BUILD_OUTPUT)
  : path.join(root, "dist/panel.html");
const fixturesOnly = process.env.ORCA_GRAPH_BUILD_FIXTURES_ONLY === "1";
const runtimeDir = resolveRuntimeDirectory();
if (!fixturesOnly) await prepareRuntimeDirectory(root, runtimeDir, { migrate: !process.env.ORCA_GRAPH_RUNTIME_DIR });
const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH;
const sourceTimestamp = sourceDateEpoch === undefined ? null : Number(sourceDateEpoch);
if (sourceTimestamp !== null && !Number.isFinite(sourceTimestamp)) {
  throw new Error("SOURCE_DATE_EPOCH must be a Unix timestamp");
}
const builtAt = sourceTimestamp === null
  ? new Date().toISOString()
  : new Date(sourceTimestamp * 1000).toISOString();

async function readJson(primary, fallback) {
  try {
    return JSON.parse(await readFile(primary, "utf8"));
  } catch {
    return JSON.parse(await readFile(fallback, "utf8"));
  }
}

const [localStore, currentTargets, defaultTargets, dataSourceConfig, sourceCache, css] = await Promise.all([
  fixturesOnly
    ? readJson(path.join(root, "fixtures/default-store.json"), path.join(root, "fixtures/default-store.json"))
    : readJson(path.join(runtimeDir, "store.json"), path.join(root, "fixtures/default-store.json")),
  fixturesOnly
    ? readJson(path.join(root, "fixtures/default-targets.json"), path.join(root, "fixtures/default-targets.json"))
    : readJson(path.join(runtimeDir, "targets.json"), path.join(root, "fixtures/default-targets.json")),
  readJson(path.join(root, "fixtures/default-targets.json"), path.join(root, "fixtures/default-targets.json")),
  fixturesOnly
    ? readJson(path.join(root, "fixtures/default-data-source.json"), path.join(root, "fixtures/default-data-source.json"))
    : readJson(path.join(runtimeDir, "data-source.json"), path.join(root, "fixtures/default-data-source.json")),
  fixturesOnly
    ? readJson(path.join(root, "fixtures/default-source-cache.json"), path.join(root, "fixtures/default-source-cache.json"))
    : readJson(path.join(runtimeDir, "source-cache.json"), path.join(root, "fixtures/default-source-cache.json")),
  readFile(path.join(root, "src/panel.css"), "utf8"),
]);
const useSourceStore = ["structured", "folder"].includes(dataSourceConfig.mode)
  && sourceCache.mode === dataSourceConfig.mode
  && sourceCache.status === "ready"
  && sourceCache.store?.schemaVersion === 1;
const sourceStore = useSourceStore
  ? sourceCache.store
  : { schemaVersion: 1, activeGraphId: "", graphs: [] };
// 예전 브리지 시절의 런타임 키는 bootstrap에 싣지 않는다.
const {
  bridgeTerminalId: _legacyTerminal, bridgeWorkspace: _legacyWorkspace,
  lastBridgeMessage: _legacyMessage, lastBridgeAt: _legacyAt,
  ...currentLocalStore
} = localStore;
const store = ["structured", "folder"].includes(dataSourceConfig.mode) ? {
  ...sourceStore,
  ...(currentLocalStore.saveTerminalId ? { saveTerminalId: currentLocalStore.saveTerminalId } : {}),
  ...(currentLocalStore.lastSaveMessage ? { lastSaveMessage: currentLocalStore.lastSaveMessage } : {}),
  ...(currentLocalStore.lastSavedAt ? { lastSavedAt: currentLocalStore.lastSavedAt } : {}),
  dispatchLog: currentLocalStore.dispatchLog ?? [],
} : currentLocalStore;
const dataSource = {
  config: dataSourceConfig,
  status: sourceCache.mode === dataSourceConfig.mode ? sourceCache.status : "idle",
  ...(sourceCache.source ? { source: sourceCache.source } : {}),
  ...(sourceCache.refreshedAt ? { refreshedAt: sourceCache.refreshedAt } : {}),
  ...(sourceCache.message ? { message: sourceCache.message } : {}),
  catalog: sourceCache.mode === dataSourceConfig.mode ? sourceCache.catalog ?? [] : [],
  ...(sourceCache.capabilities ? { capabilities: sourceCache.capabilities } : {}),
};
const defaultModelsById = new Map((defaultTargets.models ?? []).map((model) => [model.id, model]));
const targets = {
  ...currentTargets,
  models: (currentTargets.models ?? defaultTargets.models ?? []).map((model) => ({
    ...defaultModelsById.get(model.id),
    ...model,
    reasoningLevels: model.reasoningLevels ?? defaultModelsById.get(model.id)?.reasoningLevels ?? [],
  })),
};

const bootstrap = {
  store,
  targets,
  dataSource,
  pluginRoot: process.env.ORCA_GRAPH_PLUGIN_ROOT ?? root,
  builtAt,
};

const result = await build({
  entryPoints: [path.join(root, "src/panel.ts")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "es2022",
});

const javascript = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text
  ?? result.outputFiles[0]?.text;
if (!javascript) throw new Error("panel bundle was not generated");

const safeJavascript = javascript.replaceAll("</script", "<\\/script");
const html = `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Graph Engineering</title>
    <style>${css}</style>
  </head>
  <body>
    <main id="app" aria-label="Graph Engineering"></main>
    ${panelBootstrapScript(bootstrap)}
    <script>${safeJavascript}</script>
  </body>
</html>`;

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, html, "utf8");
console.log(`built ${path.relative(root, outputPath) || outputPath} (${Buffer.byteLength(html)} bytes)`);

import { copyFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const runtimeFiles = [
  "store.json",
  "targets.json",
  "data-source.json",
  "source-cache.json",
  "executions.json",
];

export function resolveRuntimeDirectory() {
  if (process.env.ORCA_GRAPH_RUNTIME_DIR) return path.resolve(process.env.ORCA_GRAPH_RUNTIME_DIR);
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Orca", "plugin-runtime", "orca-graph-engineering");
  }
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Orca", "plugin-runtime", "orca-graph-engineering");
  }
  return path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "orca", "plugin-runtime", "orca-graph-engineering");
}

export async function prepareRuntimeDirectory(root, runtimeDirectory, { migrate = true } = {}) {
  await mkdir(runtimeDirectory, { recursive: true });
  if (!migrate || path.resolve(runtimeDirectory) === path.resolve(root, "runtime")) return;
  const legacyDirectory = path.join(root, "runtime");
  await Promise.all(runtimeFiles.map(async (filename) => {
    try {
      await copyFile(path.join(legacyDirectory, filename), path.join(runtimeDirectory, filename), 1);
    } catch (error) {
      if (error?.code !== "EEXIST" && error?.code !== "ENOENT") throw error;
    }
  }));
}

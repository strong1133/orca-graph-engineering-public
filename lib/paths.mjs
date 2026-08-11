import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareRuntimeDirectory, resolveRuntimeDirectory } from "../scripts/runtime-path.mjs";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const runtimeDir = resolveRuntimeDirectory();

export const storePath = path.join(runtimeDir, "store.json");
export const targetsPath = path.join(runtimeDir, "targets.json");
export const dataSourcePath = path.join(runtimeDir, "data-source.json");
export const sourceCachePath = path.join(runtimeDir, "source-cache.json");

export const defaultStorePath = path.join(root, "fixtures/default-store.json");
export const defaultTargetsPath = path.join(root, "fixtures/default-targets.json");
export const defaultDataSourcePath = path.join(root, "fixtures/default-data-source.json");
export const defaultSourceCachePath = path.join(root, "fixtures/default-source-cache.json");

export const panelPath = path.join(root, "dist/panel.html");

export async function prepareRuntime() {
  await prepareRuntimeDirectory(root, runtimeDir, { migrate: !process.env.ORCA_GRAPH_RUNTIME_DIR });
}

/** 런타임 파일이 없거나 깨졌으면 패키지에 담긴 공개 기본값으로 물러난다. */
export async function readJson(primary, fallback) {
  try {
    return JSON.parse(await readFile(primary, "utf8"));
  } catch {
    return JSON.parse(await readFile(fallback, "utf8"));
  }
}

export async function atomicJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
}

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareRuntimeDirectory, resolveRuntimeDirectory } from "../scripts/runtime-path.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  delete process.env.ORCA_GRAPH_RUNTIME_DIR;
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("plugin runtime directory", () => {
  it("keeps mutable state outside the plugin root by default and supports an explicit override", async () => {
    const root = process.cwd();
    expect(path.resolve(resolveRuntimeDirectory())).not.toBe(path.join(root, "runtime"));

    const override = await mkdtemp(path.join(tmpdir(), "orca-graph-runtime-"));
    temporaryDirectories.push(override);
    process.env.ORCA_GRAPH_RUNTIME_DIR = override;
    expect(resolveRuntimeDirectory()).toBe(path.resolve(override));
  });

  it("migrates legacy state once without overwriting newer app data", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "orca-graph-plugin-"));
    const target = await mkdtemp(path.join(tmpdir(), "orca-graph-runtime-"));
    temporaryDirectories.push(root, target);
    await mkdir(path.join(root, "runtime"));
    await writeFile(path.join(root, "runtime", "store.json"), '{"source":"legacy"}\n', "utf8");

    await prepareRuntimeDirectory(root, target);
    expect(JSON.parse(await readFile(path.join(target, "store.json"), "utf8"))).toEqual({ source: "legacy" });

    await writeFile(path.join(target, "store.json"), '{"source":"current"}\n', "utf8");
    await prepareRuntimeDirectory(root, target);
    expect(JSON.parse(await readFile(path.join(target, "store.json"), "utf8"))).toEqual({ source: "current" });
  });
});

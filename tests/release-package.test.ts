import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extract as extractTar } from "tar";

const root = process.cwd();
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function archiveFiles(artifact: string, destination: string): Promise<string[]> {
  await extractTar({ cwd: destination, file: artifact, preservePaths: false, strict: true });
  const files: string[] = [];
  async function visit(relative: string): Promise<void> {
    const absolute = relative ? path.join(destination, relative) : destination;
    for (const entry of (await readdir(absolute, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name))) {
      const child = relative ? path.join(relative, entry.name) : entry.name;
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) files.push(child.split(path.sep).join("/"));
    }
  }
  await visit("");
  return files;
}

describe("source and Orca plugin package contracts", () => {
  it("keeps the actual npm tarball aligned with its source or plugin context", async () => {
    const rootPackage = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    const output = await temporaryDirectory("orca-source-package-");
    execFileSync("npm", ["pack", "--pack-destination", output, "--json"], {
      cwd: root,
      encoding: "utf8",
    });
    const artifactNames = (await readdir(output)).filter((file) => file.endsWith(".tgz"));
    expect(artifactNames).toHaveLength(1);
    const extracted = path.join(output, "extracted");
    await mkdir(extracted);
    const files = await archiveFiles(path.join(output, artifactNames[0]!), extracted);
    expect(files).toContain("package/orca-plugin.json");
    expect(files).toContain("package/src/panel.ts");
    expect(files).toContain("package/tests/release-package.test.ts");
    if (rootPackage.private === true) expect(files).toContain("package/dist/panel.html");
    else expect(files).not.toContain("package/dist/panel.html");
    expect(files.some((file) => file.startsWith("package/runtime/"))).toBe(false);
  });

  it("opens and validates the actual plugin tgz independently of packager JSON", async () => {
    const output = await temporaryDirectory("orca-plugin-package-");
    execFileSync(process.execPath, [
      path.join(root, "scripts/package-plugin.mjs"),
      "--output-directory",
      output,
    ], { cwd: root, encoding: "utf8" });
    const artifactNames = (await readdir(output)).filter((file) => file.endsWith(".tgz"));
    expect(artifactNames).toEqual(["orca-graph-engineering-plugin-0.2.0.tgz"]);
    const artifact = path.join(output, artifactNames[0]!);
    const extracted = path.join(output, "extracted");
    await mkdir(extracted);
    const files = await archiveFiles(artifact, extracted);
    expect(files).toEqual(expect.arrayContaining([
      "package/.github/workflows/ci.yml",
      "package/lib/store.mjs",
      "package/scripts/graph-store.mjs",
      "package/dist/panel.html",
      "package/npm-shrinkwrap.json",
      "package/orca-plugin.json",
      "package/tests/release-package.test.ts",
    ]));
    expect(files.some((file) => file.startsWith("package/runtime/"))).toBe(false);
    const internalPlanMarker = ["under", "claw"].join("-");
    expect(files.some((file) => file.includes(internalPlanMarker))).toBe(false);

    const packageJson = JSON.parse(await readFile(
      path.join(extracted, "package/package.json"),
      "utf8",
    ));
    expect(packageJson).toMatchObject({
      packageManager: "npm@10.9.4",
      private: true,
      scripts: {
        check: "npm run typecheck && npm run test && npm run build",
        test: "vitest run",
      },
    });
    expect(packageJson.devDependencies).toMatchObject({ tar: "7.5.22", zod: "4.4.3" });

    const verification = JSON.parse(execFileSync(process.execPath, [
      path.join(root, "scripts/verify-plugin-package.mjs"),
      artifact,
    ], { cwd: root, encoding: "utf8" }));
    expect(verification).toMatchObject({
      ok: true,
      saveCli: "saved",
      panelBootstrapUpdated: true,
      canonicalHeaders: true,
      manifestEntry: "dist/panel.html",
      schemaRevision: "6da7b8e9cfe62e5b4d34bb52e8c570036c1935fc",
    });
  });
});

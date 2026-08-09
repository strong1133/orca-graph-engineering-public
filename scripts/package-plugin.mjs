import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { constants as zlibConstants, gzipSync } from "node:zlib";
import { create as createTar } from "tar";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonicalTimestamp = new Date(0);

async function readDependencyLock() {
  try {
    return await readFile(path.join(root, "package-lock.json"), "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return readFile(path.join(root, "npm-shrinkwrap.json"), "utf8");
  }
}

function parseArguments(arguments_) {
  let dryRun = false;
  let outputDirectory = path.join(root, "release");
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argument === "--output-directory") {
      const value = arguments_[index + 1];
      if (!value) throw new Error("--output-directory requires a path");
      outputDirectory = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  return { dryRun, outputDirectory };
}

async function archiveEntries(stagingRoot, relative = "package") {
  const absolute = path.join(stagingRoot, ...relative.split("/"));
  const stats = await lstat(absolute);
  if (stats.isSymbolicLink()) throw new Error(`plugin bundle cannot contain symlinks: ${relative}`);
  if (stats.isDirectory()) {
    await chmod(absolute, 0o755);
    await utimes(absolute, canonicalTimestamp, canonicalTimestamp);
    const children = (await readdir(absolute)).sort();
    const descendants = [];
    for (const child of children) {
      descendants.push(...await archiveEntries(stagingRoot, `${relative}/${child}`));
    }
    return [relative, ...descendants];
  }
  if (!stats.isFile()) throw new Error(`unsupported plugin bundle entry: ${relative}`);
  await chmod(absolute, 0o644);
  await utimes(absolute, canonicalTimestamp, canonicalTimestamp);
  return [relative];
}

async function createCanonicalArchive(stagingRoot, destination) {
  const rawTar = path.join(stagingRoot, "plugin.tar");
  const entries = await archiveEntries(stagingRoot);
  await createTar({
    cwd: stagingRoot,
    file: rawTar,
    mtime: canonicalTimestamp,
    noDirRecurse: true,
    noPax: true,
    portable: true,
  }, entries);
  try {
    const tarBytes = await readFile(rawTar);
    const archive = gzipSync(tarBytes, {
      level: 9,
      strategy: zlibConstants.Z_FIXED,
    });
    if (archive[0] !== 0x1f || archive[1] !== 0x8b || archive[2] !== 8 || archive[3] !== 0) {
      throw new Error("unexpected gzip header from the pinned Node 22 packaging stack");
    }
    archive.writeUInt32LE(0, 4);
    archive[8] = 2;
    archive[9] = 255;
    const temporary = `${destination}.${process.pid}.tmp`;
    await writeFile(temporary, archive, { mode: 0o644 });
    await rm(destination, { force: true });
    await rename(temporary, destination);
    return {
      entries,
      sha256: createHash("sha256").update(archive).digest("hex"),
    };
  } finally {
    await rm(rawTar, { force: true });
  }
}

const { dryRun, outputDirectory } = parseArguments(process.argv.slice(2));
const [packageJson, manifest, lockfile] = await Promise.all([
  readFile(path.join(root, "package.json"), "utf8").then(JSON.parse),
  readFile(path.join(root, "orca-plugin.json"), "utf8").then(JSON.parse),
  readDependencyLock(),
]);
if (packageJson.version !== manifest.version) throw new Error("package and Orca manifest versions differ");
const panelEntry = manifest.contributes?.panels?.[0]?.entry;
if (typeof panelEntry !== "string" || !panelEntry.startsWith("dist/")) {
  throw new Error("Orca manifest panel entry must be a dist/ path");
}

const stagingRoot = await mkdtemp(path.join(tmpdir(), "orca-graph-plugin-"));
const stagingPackage = path.join(stagingRoot, "package");
const releaseEntries = [
  ".gitignore",
  ".github/workflows/ci.yml",
  "bridge",
  "docs/architecture.md",
  "docs/graph-engineering-reference.md",
  "docs/upstream-proposal.md",
  "fixtures",
  "scripts",
  "src",
  "tests",
  "CONTRIBUTING.md",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "orca-plugin.json",
  "tsconfig.json",
];

try {
  await mkdir(stagingPackage, { recursive: true });
  for (const entry of releaseEntries) {
    const source = path.join(root, entry);
    const destination = path.join(stagingPackage, entry);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true });
  }
  await writeFile(path.join(stagingPackage, "package.json"), `${JSON.stringify({
    ...packageJson,
    private: true,
    files: [...new Set([
      ...(packageJson.files ?? []),
      ".github/",
      "dist/",
      "npm-shrinkwrap.json",
    ])],
  }, null, 2)}\n`, "utf8");
  await writeFile(path.join(stagingPackage, "npm-shrinkwrap.json"), lockfile, "utf8");

  await execFileAsync(process.execPath, [path.join(root, "scripts/build.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      ORCA_GRAPH_BUILD_OUTPUT: path.join(stagingPackage, panelEntry),
      ORCA_GRAPH_BUILD_FIXTURES_ONLY: "1",
      ORCA_GRAPH_PLUGIN_ROOT: ".",
      SOURCE_DATE_EPOCH: "0",
    },
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });

  const filename = `${packageJson.name}-plugin-${packageJson.version}.tgz`;
  const destination = dryRun ? path.join(stagingRoot, filename) : path.join(outputDirectory, filename);
  if (!dryRun) await mkdir(outputDirectory, { recursive: true });
  const packed = await createCanonicalArchive(stagingRoot, destination);
  const files = packed.entries
    .filter((entry) => entry !== "package")
    .map((entry) => entry.slice("package/".length));
  const fileSet = new Set(files);
  for (const required of [
    ".github/workflows/ci.yml",
    ".gitignore",
    "orca-plugin.json",
    panelEntry,
    "bridge/index.mjs",
    "npm-shrinkwrap.json",
    "tests/release-package.test.ts",
  ]) {
    if (!fileSet.has(required)) throw new Error(`plugin bundle is missing ${required}`);
  }
  const panel = await readFile(path.join(stagingPackage, panelEntry), "utf8");
  const forbiddenPath = /\/Users\/[^/]+|[A-Za-z]:\\Users\\|\/home\/[^/]+/u.exec(panel)?.[0];
  if (forbiddenPath || panel.includes(root)) throw new Error("plugin bundle contains a baked contributor path");

  console.log(JSON.stringify({
    ok: true,
    dryRun,
    artifact: dryRun ? null : path.relative(root, destination),
    version: packageJson.version,
    sha256: packed.sha256,
    fileCount: files.length,
  }));
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}

import { spawn } from "node:child_process";
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extract as extractTar, list as listTar } from "tar";
import {
  ORCA_MANIFEST_SCHEMA_REVISION,
  parseOfficialOrcaPanelManifest,
} from "./orca-plugin-manifest-schema.mjs";
import { readPanelBootstrap } from "./panel-bootstrap.mjs";

function savePayload(value) {
  return gzipSync(Buffer.from(JSON.stringify(value), "utf8"), { level: 9 }).toString("base64url");
}

/**
 * 압축을 푼 플러그인에서 저장 CLI가 그대로 도는지 확인한다. 이것이 패널의 유일한
 * 쓰기 경로이므로, 여기가 깨지면 사용자는 편집한 것을 저장할 방법이 없다.
 */
async function verifySaveCli(packageRoot, runtimeDirectory) {
  const panelPath = path.join(packageRoot, "dist/panel.html");
  const panelBefore = await readFile(panelPath, "utf8");
  const store = JSON.parse(await readFile(path.join(packageRoot, "fixtures/default-store.json"), "utf8"));
  const graph = { ...store.graphs[0], name: `${store.graphs[0].name} · extracted save verified` };

  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(packageRoot, "scripts/graph-store.mjs"),
      "save",
      savePayload({ graphs: [graph], activeGraphId: graph.id }),
    ], {
      cwd: packageRoot,
      env: { ...process.env, ORCA_GRAPH_RUNTIME_DIR: runtimeDirectory },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    const deadline = setTimeout(() => {
      child.kill();
      reject(new Error(`extracted save CLI did not exit:\n${output}`));
    }, 15_000);
    child.once("error", (error) => { clearTimeout(deadline); reject(error); });
    child.once("close", (code) => {
      clearTimeout(deadline);
      if (code === 0) resolve(output);
      else reject(new Error(`extracted save CLI exited with ${code}:\n${output}`));
    });
  });
  if (!result.includes("저장 완료")) {
    throw new Error(`extracted save CLI did not report a save:\n${result}`);
  }

  const savedStore = JSON.parse(await readFile(path.join(runtimeDirectory, "store.json"), "utf8"));
  if (savedStore.graphs.find((item) => item.id === graph.id)?.name !== graph.name) {
    throw new Error("extracted save CLI did not update runtime/store.json");
  }
  const panelAfter = await readFile(panelPath, "utf8");
  if (panelAfter === panelBefore) throw new Error("extracted save CLI did not update dist/panel.html");
  const panelBootstrap = readPanelBootstrap(panelAfter);
  if (panelBootstrap.store?.graphs?.find((item) => item.id === graph.id)?.name !== graph.name) {
    throw new Error("extracted save CLI did not embed the saved store in dist/panel.html");
  }
}

async function extractedFiles(root, relative = "") {
  const absolute = relative ? path.join(root, ...relative.split("/")) : root;
  const children = (await readdir(absolute)).sort();
  const files = [];
  for (const child of children) {
    const childRelative = relative ? `${relative}/${child}` : child;
    const stats = await lstat(path.join(root, ...childRelative.split("/")));
    if (stats.isSymbolicLink()) throw new Error(`plugin archive contains a symlink: ${childRelative}`);
    if (stats.isDirectory()) files.push(...await extractedFiles(root, childRelative));
    else if (stats.isFile()) files.push(childRelative);
    else throw new Error(`plugin archive contains an unsupported entry: ${childRelative}`);
  }
  return files;
}

async function verifyArchiveHeaders(artifact) {
  const archive = await readFile(artifact);
  if (archive[0] !== 0x1f || archive[1] !== 0x8b || archive[2] !== 8) {
    throw new Error("plugin artifact is not a gzip archive");
  }
  if (archive[3] !== 0 || archive.readUInt32LE(4) !== 0 || archive[8] !== 2 || archive[9] !== 255) {
    throw new Error("plugin artifact gzip header is not canonical");
  }
  const headers = [];
  await listTar({
    file: artifact,
    strict: true,
    onReadEntry(entry) {
      headers.push({
        path: entry.path,
        type: entry.type,
        mode: entry.mode,
        uid: entry.uid ?? 0,
        gid: entry.gid ?? 0,
        mtime: entry.mtime?.getTime() ?? 0,
      });
      entry.resume();
    },
  });
  const paths = headers.map((header) => header.path);
  if (JSON.stringify(paths) !== JSON.stringify([...paths].sort())) {
    throw new Error("plugin artifact entries are not sorted");
  }
  for (const header of headers) {
    const directory = header.type === "Directory";
    if (header.uid !== 0 || header.gid !== 0 || header.mtime !== 0) {
      throw new Error(`plugin artifact metadata is not canonical: ${header.path}`);
    }
    if (header.mode !== (directory ? 0o755 : 0o644)) {
      throw new Error(`plugin artifact mode is not canonical: ${header.path}`);
    }
  }
  return headers;
}

export async function verifyPluginPackage(artifactPath) {
  const artifact = path.resolve(artifactPath);
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "orca-plugin-verifier-"));
  try {
    const headers = await verifyArchiveHeaders(artifact);
    await extractTar({
      cwd: temporaryRoot,
      file: artifact,
      preservePaths: false,
      strict: true,
    });
    const files = await extractedFiles(temporaryRoot);
    const fileSet = new Set(files);
    for (const required of [
      "package/.github/workflows/ci.yml",
      "package/lib/store.mjs",
      "package/scripts/graph-store.mjs",
      "package/dist/panel.html",
      "package/npm-shrinkwrap.json",
      "package/orca-plugin.json",
      "package/tests/release-package.test.ts",
    ]) {
      if (!fileSet.has(required)) throw new Error(`plugin artifact is missing ${required}`);
    }
    const forbiddenEntries = files.filter((file) =>
      file.startsWith("package/.git/") ||
      file.startsWith("package/docs/internal/") ||
      file.startsWith("package/node_modules/") ||
      file.startsWith("package/runtime/"));
    if (forbiddenEntries.length) {
      throw new Error(`plugin artifact contains forbidden entries: ${forbiddenEntries.join(", ")}`);
    }
    const forbiddenTerms = [
      ["under", "joy"].join(""),
      ["under", "claw"].join("-"),
      ["work", "tasks"].join("-"),
      ["work", "tasks"].join("_"),
      ["ff", "genius"].join("-"),
    ];
    for (const file of files) {
      const content = await readFile(path.join(temporaryRoot, ...file.split("/")));
      const text = content.toString("utf8");
      if (/\/Users\/[^/\0]+|[A-Za-z]:\\Users\\[^\\\0]+|\/home\/[^/\0]+/u.test(text)) {
        throw new Error(`plugin artifact contains an absolute contributor path: ${file}`);
      }
      for (const term of forbiddenTerms) {
        if (text.toLowerCase().includes(term)) throw new Error(`plugin artifact contains private coupling: ${file}`);
      }
    }

    const packageRoot = path.join(temporaryRoot, "package");
    const manifest = parseOfficialOrcaPanelManifest(JSON.parse(
      await readFile(path.join(packageRoot, "orca-plugin.json"), "utf8"),
    ));
    const manifestEntry = manifest.contributes.panels[0]?.entry;
    if (!manifestEntry || !fileSet.has(`package/${manifestEntry}`)) {
      throw new Error(`official Orca manifest entry is missing from plugin artifact: ${manifestEntry}`);
    }
    const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
    if (!packageJson.scripts?.check || !packageJson.scripts?.test || !packageJson.devDependencies?.vitest) {
      throw new Error("plugin artifact does not carry its declared check toolchain");
    }
    await verifySaveCli(packageRoot, path.join(temporaryRoot, "runtime"));
    return {
      ok: true,
      saveCli: "saved",
      panelBootstrapUpdated: true,
      canonicalHeaders: true,
      fileCount: files.length,
      headerCount: headers.length,
      manifestEntry,
      schemaRevision: ORCA_MANIFEST_SCHEMA_REVISION,
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [artifact, ...unknown] = process.argv.slice(2);
  if (!artifact || unknown.length) {
    throw new Error("usage: npm run verify:plugin -- <plugin.tgz>");
  }
  console.log(JSON.stringify(await verifyPluginPackage(artifact)));
}

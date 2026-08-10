import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const [terminalId, operation = "ping"] = process.argv.slice(2);

if (!terminalId) {
  console.error("Usage: npm run bridge:client -- <terminal-handle> bootstrap|refresh|plan|ping|open-wide");
  process.exit(2);
}

async function payloadFor(name) {
  if (name === "bootstrap") {
    const store = JSON.parse(await readFile(path.join(root, "fixtures/default-store.json"), "utf8"));
    store.bridgeTerminalId = terminalId;
    store.bridgeWorkspace = "orca-graph-engineering";
    return { type: "save", store };
  }
  if (name === "refresh") return { type: "refresh" };
  if (name === "plan") return { type: "run", graphId: "graph-orca-demo", dryRun: true };
  if (name === "ping") return { type: "ping" };
  if (name === "open-wide") return { type: "open-wide" };
  throw new Error(`Unknown operation: ${name}`);
}

function framesFor(payload, chunkSize = 2800) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const chunks = encoded.match(new RegExp(`.{1,${chunkSize}}`, "gu")) ?? [""];
  const requestId = crypto.randomUUID();
  return chunks.map((chunk, index) => `OGX1:${requestId}:${index + 1}:${chunks.length}:${chunk}:END`);
}

for (const frame of framesFor(await payloadFor(operation))) {
  await execFileAsync("orca", [
    "terminal", "send", "--terminal", terminalId, "--text", frame, "--enter", "--json",
  ], { cwd: root, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
}

console.log(`sent ${operation} to ${terminalId}`);

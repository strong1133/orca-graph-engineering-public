import { readFile, rename, writeFile } from "node:fs/promises";

const openMarker = '<script id="orca-graph-bootstrap" type="application/json">';
const closeMarker = "</script>";

function encodedBootstrap(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export function panelBootstrapScript(value) {
  return `${openMarker}${encodedBootstrap(value)}${closeMarker}`;
}

export function readPanelBootstrap(html) {
  const start = html.indexOf(openMarker);
  const duplicate = start < 0 ? -1 : html.indexOf(openMarker, start + openMarker.length);
  const end = start < 0 ? -1 : html.indexOf(closeMarker, start + openMarker.length);
  if (start < 0 || end < 0 || duplicate >= 0) {
    throw new Error("panel bootstrap marker must exist exactly once");
  }
  return JSON.parse(html.slice(start + openMarker.length, end));
}

export function replacePanelBootstrap(html, value) {
  const current = readPanelBootstrap(html);
  const start = html.indexOf(openMarker);
  const end = html.indexOf(closeMarker, start + openMarker.length) + closeMarker.length;
  return {
    current,
    html: `${html.slice(0, start)}${panelBootstrapScript(value)}${html.slice(end)}`,
  };
}

export async function updatePanelBootstrap(panelPath, updates) {
  const source = await readFile(panelPath, "utf8");
  const current = readPanelBootstrap(source);
  const next = { ...current, ...updates };
  const output = replacePanelBootstrap(source, next).html;
  const temporary = `${panelPath}.${process.pid}.tmp`;
  await writeFile(temporary, output, { mode: 0o644 });
  await rename(temporary, panelPath);
  return next;
}

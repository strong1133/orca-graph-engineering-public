import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const host = "127.0.0.1";
const port = Number(process.env.ORCA_GRAPH_PREVIEW_PORT || 4177);
const panelPath = path.join(process.cwd(), "dist/panel.html");

const server = http.createServer(async (request, response) => {
  if (request.url !== "/" && request.url !== "/panel.html") {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  try {
    const panel = await readFile(panelPath);
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(panel);
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end(error instanceof Error ? error.message : String(error));
  }
});

server.listen(port, host, () => {
  console.log(`Graph Engineering preview: http://${host}:${port}`);
});

export const BRIDGE_PREFIX = "OGX1";
export const BRIDGE_SUFFIX = ":END";

export interface BridgeFrame {
  requestId: string;
  index: number;
  total: number;
  chunk: string;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function encodeBridgeFrames(payload: unknown, maxChunk = 2800): string[] {
  const json = JSON.stringify(payload);
  const encoded = bytesToBase64Url(new TextEncoder().encode(json));
  const requestId = crypto.randomUUID().slice(0, 12);
  const chunks: string[] = [];
  for (let index = 0; index < encoded.length; index += maxChunk) {
    chunks.push(encoded.slice(index, index + maxChunk));
  }
  const total = Math.max(1, chunks.length);
  return (chunks.length ? chunks : [""]).map(
    (chunk, index) => `${BRIDGE_PREFIX}:${requestId}:${index + 1}:${total}:${chunk}${BRIDGE_SUFFIX}`,
  );
}

export function parseBridgeFrame(line: string): BridgeFrame | null {
  const match = /^OGX1:([a-zA-Z0-9-]+):(\d+):(\d+):([a-zA-Z0-9_-]*):END$/u.exec(line.trim());
  if (!match) return null;
  const index = Number(match[2]);
  const total = Number(match[3]);
  if (!Number.isInteger(index) || !Number.isInteger(total) || index < 1 || total < index || total > 128) {
    return null;
  }
  return { requestId: match[1] ?? "", index, total, chunk: match[4] ?? "" };
}

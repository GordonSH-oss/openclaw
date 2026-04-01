import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");

const assetMap = new Map<string, { filePath: string; contentType: string }>([
  ["/", { filePath: path.join(publicDir, "index.html"), contentType: "text/html; charset=utf-8" }],
  [
    "/ui",
    { filePath: path.join(publicDir, "index.html"), contentType: "text/html; charset=utf-8" },
  ],
  [
    "/embed",
    { filePath: path.join(publicDir, "index.html"), contentType: "text/html; charset=utf-8" },
  ],
  [
    "/assets/doc-assistant-ui.js",
    {
      filePath: path.join(publicDir, "doc-assistant-ui.js"),
      contentType: "text/javascript; charset=utf-8",
    },
  ],
  [
    "/assets/doc-assistant-ui.css",
    {
      filePath: path.join(publicDir, "doc-assistant-ui.css"),
      contentType: "text/css; charset=utf-8",
    },
  ],
]);

const assetCache = new Map<string, Buffer>();

async function loadAsset(filePath: string): Promise<Buffer> {
  const cached = assetCache.get(filePath);
  if (cached) {
    return cached;
  }
  const content = await readFile(filePath);
  assetCache.set(filePath, content);
  return content;
}

export async function serveDocAssistantUi(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const asset = assetMap.get(url.pathname);
  if (!asset) {
    return false;
  }

  const content = await loadAsset(asset.filePath);
  res.writeHead(200, {
    "Content-Type": asset.contentType,
    "Cache-Control": "no-cache",
  });
  res.end(content);
  return true;
}

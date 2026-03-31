import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolveDefaultDocsRoot } from "./doc-index.js";

export function loadDocAssistantDotEnv(): void {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(currentDir, "../.env");
  if (!fs.existsSync(envPath)) {
    return;
  }
  const content = fs.readFileSync(envPath, "utf-8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = value;
  }
}

export function resolveDocAssistantDocsRootFromEnv(): string {
  const configured = process.env.DOC_ASSISTANT_DOCS_ROOT?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return resolveDefaultDocsRoot();
}

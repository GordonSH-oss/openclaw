import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolveDocAssistantDataDir } from "./user-store.js";

export type DocIndexChunk = {
  id: string;
  relativePath: string;
  heading?: string;
  startLine: number;
  endLine: number;
  text: string;
  tokens: string[];
};

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function tokenize(text: string): string[] {
  const stopwords = new Set([
    "the",
    "and",
    "for",
    "how",
    "what",
    "when",
    "where",
    "which",
    "who",
    "does",
    "do",
    "can",
    "with",
    "from",
    "into",
    "your",
    "you",
    "are",
    "not",
  ]);
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && !stopwords.has(part));
}

export function resolveDefaultDocsRoot(): string {
  const cwdDocs = path.resolve(process.cwd(), "docs");
  if (existsSync(cwdDocs)) {
    return cwdDocs;
  }
  return fileURLToPath(new URL("../../../docs/", import.meta.url));
}

export function getDocIndexPath(dataDir?: string): string {
  return path.join(resolveDocAssistantDataDir(dataDir), "doc-index.json");
}

async function collectMarkdownFiles(root: string, current = root): Promise<string[]> {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(root, fullPath)));
      continue;
    }
    if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".mdx"))) {
      files.push(fullPath);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function trimChunkText(lines: string[]): string {
  return lines.join("\n").trim();
}

function pushChunk(params: {
  chunks: DocIndexChunk[];
  relativePath: string;
  heading?: string;
  startLine: number;
  endLine: number;
  lines: string[];
}): void {
  const text = trimChunkText(params.lines);
  if (!text) {
    return;
  }
  const lexicalText = [params.relativePath, params.heading ?? "", text].join("\n");
  params.chunks.push({
    id: `${hashText(params.relativePath)}:${params.startLine}:${params.endLine}`,
    relativePath: params.relativePath,
    heading: params.heading,
    startLine: params.startLine,
    endLine: params.endLine,
    text,
    tokens: tokenize(lexicalText),
  });
}

function skipFrontmatter(lines: string[]): number {
  if (lines[0]?.trim() !== "---") {
    return 0;
  }
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === "---") {
      return index + 1;
    }
  }
  return 0;
}

function extractHeadingChunks(relativePath: string, rawText: string): DocIndexChunk[] {
  const lines = rawText.split(/\r?\n/);
  const chunks: DocIndexChunk[] = [];
  const startIndex = skipFrontmatter(lines);

  let currentHeading: string | undefined;
  let currentStart = startIndex + 1;
  let currentLines: string[] = [];

  const flush = (endLine: number) => {
    pushChunk({
      chunks,
      relativePath,
      heading: currentHeading,
      startLine: currentStart,
      endLine,
      lines: currentLines.length > 0 ? currentLines : currentHeading ? [currentHeading] : [],
    });
  };

  let sawHeading = false;
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      if (sawHeading) {
        flush(index);
      }
      sawHeading = true;
      currentHeading = headingMatch[2]?.trim() || undefined;
      currentStart = index + 1;
      currentLines = [];
      continue;
    }
    currentLines.push(line);
  }

  if (sawHeading) {
    flush(lines.length);
    return chunks;
  }

  let paragraphLines: string[] = [];
  let paragraphStart = startIndex + 1;
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      if (paragraphLines.length > 0) {
        pushChunk({
          chunks,
          relativePath,
          startLine: paragraphStart,
          endLine: index,
          lines: paragraphLines,
        });
        paragraphLines = [];
      }
      paragraphStart = index + 2;
      continue;
    }
    if (paragraphLines.length === 0) {
      paragraphStart = index + 1;
    }
    paragraphLines.push(line);
  }
  if (paragraphLines.length > 0) {
    pushChunk({
      chunks,
      relativePath,
      startLine: paragraphStart,
      endLine: lines.length,
      lines: paragraphLines,
    });
  }
  return chunks;
}

export async function buildDocIndex(params?: {
  docsRoot?: string;
  dataDir?: string;
}): Promise<DocIndexChunk[]> {
  const docsRoot = path.resolve(params?.docsRoot ?? resolveDefaultDocsRoot());
  const files = await collectMarkdownFiles(docsRoot);
  const chunks: DocIndexChunk[] = [];

  for (const filePath of files) {
    const rawText = await fs.readFile(filePath, "utf-8");
    const relativePath = path
      .relative(path.dirname(docsRoot), filePath)
      .split(path.sep)
      .join("/");
    chunks.push(...extractHeadingChunks(relativePath, rawText));
  }

  const indexPath = getDocIndexPath(params?.dataDir);
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, JSON.stringify(chunks, null, 2), "utf-8");
  return chunks;
}

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { resolveLearningAgentDataDir } from "../transcript/store.js";
import {
  listWorkspaceMemoryFiles,
  readWorkspaceMemoryFile,
  resolveMemoryWorkspaceDir,
} from "./files.js";

export type MemoryIndexChunk = {
  id: string;
  path: string;
  text: string;
  heading?: string;
  hash: string;
};

export type MemoryIndex = {
  version: 1;
  workspaceDir: string;
  chunks: MemoryIndexChunk[];
  builtAt: number;
};

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * 这里故意按 Markdown 段落切 chunk，而不是上复杂分词/向量库。
 *
 * 学习重点不是检索算法，而是：
 * - 为什么要有“检索索引”这一层
 * - 为什么索引和 memory files 要分离
 * - 为什么返回结果时仍然要指向源文件
 */
function extractChunksFromMarkdown(filePath: string, text: string): MemoryIndexChunk[] {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const sections = text
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean);

  return sections.map((section, index) => {
    const heading = section
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("#"));
    return {
      id: `${normalizedPath}:${index}`,
      path: normalizedPath,
      text: section,
      heading,
      hash: hashText(`${normalizedPath}:${section}`),
    };
  });
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function scoreChunk(chunk: MemoryIndexChunk, queryTokens: string[]): number {
  const haystack = `${chunk.path}\n${chunk.heading ?? ""}\n${chunk.text}`.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) {
      score += chunk.heading?.toLowerCase().includes(token) ? 3 : 1;
    }
  }
  return score;
}

function getIndexPath(params: { workspaceDir?: string; dataDir?: string }): string {
  const workspaceDir = resolveMemoryWorkspaceDir(params.workspaceDir);
  const key = hashText(workspaceDir).slice(0, 12);
  return path.join(resolveLearningAgentDataDir(params.dataDir), "memory-index", `${key}.json`);
}

export async function buildMemoryIndex(params: {
  workspaceDir?: string;
  dataDir?: string;
}): Promise<MemoryIndex> {
  const workspaceDir = resolveMemoryWorkspaceDir(params.workspaceDir);
  const files = await listWorkspaceMemoryFiles({ workspaceDir });
  const chunks: MemoryIndexChunk[] = [];

  for (const filePath of files) {
    const { text } = await readWorkspaceMemoryFile({
      workspaceDir,
      target: filePath,
    });
    if (!text.trim()) {
      continue;
    }
    chunks.push(...extractChunksFromMarkdown(filePath, text));
  }

  const index: MemoryIndex = {
    version: 1,
    workspaceDir,
    chunks,
    builtAt: Date.now(),
  };

  // index 只是 cache / search 视图，不是 source of truth，所以放到 dataDir 而不是 workspace。
  const indexPath = getIndexPath(params);
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2), "utf-8");
  return index;
}

export async function searchMemoryIndex(params: {
  workspaceDir?: string;
  dataDir?: string;
  query: string;
  maxResults?: number;
}): Promise<MemoryIndexChunk[]> {
  const index = await buildMemoryIndex({
    workspaceDir: params.workspaceDir,
    dataDir: params.dataDir,
  });
  const queryTokens = tokenize(params.query);
  const scored = index.chunks
    .map((chunk) => ({
      chunk,
      score: scoreChunk(chunk, queryTokens),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, params.maxResults ?? 5).map((entry) => entry.chunk);
}

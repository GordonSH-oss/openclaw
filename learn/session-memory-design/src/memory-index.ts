import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { listLearningMemoryFiles, readLearningMemoryFile } from "./workspace-memory.js";
import { resolveLearningSessionMemoryDataDir } from "./session-store.js";

export type LearningMemoryChunk = {
  id: string;
  path: string;
  text: string;
  heading?: string;
};

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function extractChunks(filePath: string, text: string): LearningMemoryChunk[] {
  return text
    .split(/\n\s*\n/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk, index) => ({
      id: `${hashText(filePath)}:${index}`,
      path: filePath,
      text: chunk,
      heading: chunk
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.startsWith("#")),
    }));
}

export async function buildLearningMemoryIndex(params: {
  workspaceDir?: string;
  dataDir?: string;
}): Promise<LearningMemoryChunk[]> {
  const files = await listLearningMemoryFiles({ workspaceDir: params.workspaceDir });
  const chunks: LearningMemoryChunk[] = [];
  for (const filePath of files) {
    const { text } = await readLearningMemoryFile({
      workspaceDir: params.workspaceDir,
      target: filePath,
    });
    if (!text.trim()) {
      continue;
    }
    chunks.push(...extractChunks(filePath, text));
  }
  const indexPath = path.join(resolveLearningSessionMemoryDataDir(params.dataDir), "memory-index.json");
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, JSON.stringify(chunks, null, 2), "utf-8");
  return chunks;
}

export async function searchLearningMemory(params: {
  workspaceDir?: string;
  dataDir?: string;
  query: string;
  maxResults?: number;
}): Promise<LearningMemoryChunk[]> {
  const chunks = await buildLearningMemoryIndex({
    workspaceDir: params.workspaceDir,
    dataDir: params.dataDir,
  });
  const tokens = tokenize(params.query);
  return chunks
    .map((chunk) => ({
      chunk,
      score: tokens.reduce((score, token) => {
        const haystack = `${chunk.path}\n${chunk.heading ?? ""}\n${chunk.text}`.toLowerCase();
        return score + (haystack.includes(token) ? 1 : 0);
      }, 0),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, params.maxResults ?? 5)
    .map((entry) => entry.chunk);
}

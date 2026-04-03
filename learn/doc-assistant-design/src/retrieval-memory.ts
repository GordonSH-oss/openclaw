import path from "node:path";
import { normalizeMemoryQuestion } from "./answer-memory.js";
import { readJsonSafe, writeJsonAtomic } from "./persistence.js";
import { resolveDocAssistantDataDir } from "./user-store.js";

export type RetrievalMemoryEntry = {
  entryId: string;
  questionPattern: string;
  normalizedQuestionPattern: string;
  preferredPaths: string[];
  discouragedPaths: string[];
  requiredClarification?: "platform" | "channel_kind" | "api_layer" | "product";
  createdAt: number;
  updatedAt: number;
  source: "manual" | "eval_tuning";
  note?: string;
};

export type RetrievalMemoryMatch = {
  entry: RetrievalMemoryEntry;
  score: number;
};

function getRetrievalMemoryPath(dataDir?: string): string {
  return path.join(resolveDocAssistantDataDir(dataDir), "retrieval-memory.json");
}

function scorePattern(question: string, pattern: string): number {
  if (!question || !pattern) {
    return 0;
  }
  if (question === pattern) {
    return 1000;
  }
  if (question.includes(pattern) || pattern.includes(question)) {
    return 220;
  }
  const questionTokens = new Set(question.split(/\s+/).filter(Boolean));
  const patternTokens = pattern.split(/\s+/).filter(Boolean);
  let overlap = 0;
  for (const token of patternTokens) {
    if (questionTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap * 48;
}

export async function loadRetrievalMemoryEntries(
  dataDir?: string,
): Promise<RetrievalMemoryEntry[]> {
  return await readJsonSafe<RetrievalMemoryEntry[]>(getRetrievalMemoryPath(dataDir), []);
}

export async function saveRetrievalMemoryEntries(
  entries: RetrievalMemoryEntry[],
  dataDir?: string,
): Promise<void> {
  await writeJsonAtomic(getRetrievalMemoryPath(dataDir), entries);
}

export async function findRetrievalMemoryMatch(params: {
  question: string;
  dataDir?: string;
}): Promise<RetrievalMemoryMatch | null> {
  const entries = await loadRetrievalMemoryEntries(params.dataDir);
  const normalizedQuestion = normalizeMemoryQuestion(params.question);
  let best: RetrievalMemoryMatch | null = null;
  for (const entry of entries) {
    const score = scorePattern(normalizedQuestion, entry.normalizedQuestionPattern);
    if (score < 120) {
      continue;
    }
    if (!best || score > best.score) {
      best = { entry, score };
    }
  }
  return best;
}

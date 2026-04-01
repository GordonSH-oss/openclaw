import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type LearningSessionEntry = {
  sessionId: string;
  sessionKey: string;
  transcriptPath: string;
  createdAt: number;
  updatedAt: number;
  status: "idle" | "running" | "error";
  model?: string;
  provider?: string;
  inputTokens: number;
  outputTokens: number;
  lastChannel?: string;
  startedAt?: number;
  endedAt?: number;
};

export function resolveLearningSessionMemoryDataDir(dataDir?: string): string {
  return dataDir ?? path.resolve(process.cwd(), ".learning-session-memory-data");
}

export function getLearningSessionStorePath(dataDir?: string): string {
  return path.join(resolveLearningSessionMemoryDataDir(dataDir), "sessions.json");
}

export function getLearningTranscriptDir(dataDir?: string): string {
  return path.join(resolveLearningSessionMemoryDataDir(dataDir), "transcripts");
}

export function getLearningTranscriptPath(sessionId: string, dataDir?: string): string {
  return path.join(getLearningTranscriptDir(dataDir), `${sessionId}.jsonl`);
}

export async function loadLearningSessionStore(
  dataDir?: string,
): Promise<Record<string, LearningSessionEntry>> {
  try {
    const raw = await fs.readFile(getLearningSessionStorePath(dataDir), "utf-8");
    return JSON.parse(raw) as Record<string, LearningSessionEntry>;
  } catch {
    return {};
  }
}

export async function saveLearningSessionStore(
  store: Record<string, LearningSessionEntry>,
  dataDir?: string,
): Promise<void> {
  const root = resolveLearningSessionMemoryDataDir(dataDir);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(getLearningSessionStorePath(dataDir), JSON.stringify(store, null, 2), "utf-8");
}

export async function resolveLearningSession(params: {
  sessionKey: string;
  sessionId?: string;
  dataDir?: string;
  initial?: Partial<LearningSessionEntry>;
}): Promise<LearningSessionEntry> {
  const store = await loadLearningSessionStore(params.dataDir);
  const existing = store[params.sessionKey];
  if (existing) {
    return existing;
  }
  const sessionId = params.sessionId ?? randomUUID();
  const entry: LearningSessionEntry = {
    sessionId,
    sessionKey: params.sessionKey,
    transcriptPath: getLearningTranscriptPath(sessionId, params.dataDir),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "idle",
    inputTokens: 0,
    outputTokens: 0,
    ...params.initial,
  };
  store[params.sessionKey] = entry;
  await saveLearningSessionStore(store, params.dataDir);
  return entry;
}

export async function updateLearningSession(params: {
  sessionKey: string;
  dataDir?: string;
  update: Partial<LearningSessionEntry> | ((current: LearningSessionEntry) => LearningSessionEntry);
}): Promise<LearningSessionEntry> {
  const store = await loadLearningSessionStore(params.dataDir);
  const current = store[params.sessionKey];
  if (!current) {
    throw new Error(`Unknown learning session: ${params.sessionKey}`);
  }
  const next =
    typeof params.update === "function"
      ? params.update(current)
      : {
          ...current,
          ...params.update,
          updatedAt: Date.now(),
        };
  store[params.sessionKey] = next;
  await saveLearningSessionStore(store, params.dataDir);
  return next;
}

export async function listLearningSessions(
  dataDir?: string,
): Promise<Array<{ key: string; entry: LearningSessionEntry }>> {
  const store = await loadLearningSessionStore(dataDir);
  return Object.entries(store)
    .map(([key, entry]) => ({ key, entry }))
    .toSorted((a, b) => b.entry.updatedAt - a.entry.updatedAt);
}

export async function deleteLearningSession(sessionKey: string, dataDir?: string): Promise<void> {
  const store = await loadLearningSessionStore(dataDir);
  const entry = store[sessionKey];
  if (entry?.sessionId) {
    await fs.rm(getLearningTranscriptPath(entry.sessionId, dataDir), { force: true });
  }
  delete store[sessionKey];
  await saveLearningSessionStore(store, dataDir);
}

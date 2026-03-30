import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { LearningAgentSessionEntry } from "../types.js";
import { getTranscriptPath, resolveLearningAgentDataDir } from "../transcript/store.js";

function getSessionStorePath(dataDir?: string): string {
  return path.join(resolveLearningAgentDataDir(dataDir), "sessions.json");
}

async function loadSessionStore(dataDir?: string): Promise<Record<string, LearningAgentSessionEntry>> {
  try {
    const raw = await fs.readFile(getSessionStorePath(dataDir), "utf-8");
    return JSON.parse(raw) as Record<string, LearningAgentSessionEntry>;
  } catch {
    return {};
  }
}

async function saveSessionStore(
  store: Record<string, LearningAgentSessionEntry>,
  dataDir?: string,
): Promise<void> {
  const root = resolveLearningAgentDataDir(dataDir);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(getSessionStorePath(dataDir), JSON.stringify(store, null, 2), "utf-8");
}

export async function resolveLearningSession(params: {
  sessionKey: string;
  sessionId?: string;
  dataDir?: string;
}): Promise<LearningAgentSessionEntry> {
  const store = await loadSessionStore(params.dataDir);
  const existing = store[params.sessionKey];
  if (existing) {
    return existing;
  }
  const sessionId = params.sessionId ?? randomUUID();
  const entry: LearningAgentSessionEntry = {
    sessionId,
    sessionKey: params.sessionKey,
    transcriptPath: getTranscriptPath(sessionId, params.dataDir),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "idle",
    inputTokens: 0,
    outputTokens: 0,
  };
  store[params.sessionKey] = entry;
  await saveSessionStore(store, params.dataDir);
  return entry;
}

export async function updateLearningSession(params: {
  sessionKey: string;
  dataDir?: string;
  update:
    | Partial<LearningAgentSessionEntry>
    | ((
        current: LearningAgentSessionEntry,
      ) => LearningAgentSessionEntry);
}): Promise<LearningAgentSessionEntry> {
  const store = await loadSessionStore(params.dataDir);
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
  await saveSessionStore(store, params.dataDir);
  return next;
}

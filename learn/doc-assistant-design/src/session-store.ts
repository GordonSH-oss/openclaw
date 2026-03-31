import path from "node:path";
import {
  loadLearningSessionStore,
  resolveLearningSession,
  updateLearningSession,
  listLearningSessions,
  type LearningSessionEntry as SessionEntry,
} from "../../session-memory-design/src/index.js";
import { resolveDocAssistantDataDir } from "./user-store.js";

const SESSION_RUNTIME_DIRNAME = "runtime";
const AGENT_SCRATCH_DIRNAME = "agent-scratch";

export type { SessionEntry };
export type SessionStore = Record<string, SessionEntry>;

export function resolveDocAssistantRuntimeDataDir(dataDir?: string): string {
  return path.join(resolveDocAssistantDataDir(dataDir), SESSION_RUNTIME_DIRNAME);
}

export function resolveDocAssistantAgentScratchDataDir(dataDir?: string): string {
  return path.join(resolveDocAssistantDataDir(dataDir), AGENT_SCRATCH_DIRNAME);
}

export async function loadSessionStore(dataDir?: string): Promise<SessionStore> {
  return await loadLearningSessionStore(resolveDocAssistantRuntimeDataDir(dataDir));
}

export async function getOrCreateSession(
  sessionKey: string,
  initial?: Partial<SessionEntry>,
  dataDir?: string,
): Promise<{ entry: SessionEntry; isNew: boolean }> {
  const store = await loadSessionStore(dataDir);
  const existing = store[sessionKey];
  if (existing) {
    return { entry: existing, isNew: false };
  }
  const entry = await resolveLearningSession({
    sessionKey,
    dataDir: resolveDocAssistantRuntimeDataDir(dataDir),
    initial,
  });
  return { entry, isNew: true };
}

export async function updateSessionEntry(
  sessionKey: string,
  patchOrEntry:
    | Partial<SessionEntry>
    | SessionEntry
    | ((current: SessionEntry | undefined) => SessionEntry),
  dataDir?: string,
): Promise<SessionEntry> {
  const store = await loadSessionStore(dataDir);
  const current = store[sessionKey];
  if (typeof patchOrEntry === "function") {
    if (!current) {
      throw new Error(`Unknown doc session: ${sessionKey}`);
    }
    return await updateLearningSession({
      sessionKey,
      dataDir: resolveDocAssistantRuntimeDataDir(dataDir),
      update: patchOrEntry(current),
    });
  }
  if (!current) {
    return await resolveLearningSession({
      sessionKey,
      dataDir: resolveDocAssistantRuntimeDataDir(dataDir),
      initial: patchOrEntry,
    });
  }
  return await updateLearningSession({
    sessionKey,
    dataDir: resolveDocAssistantRuntimeDataDir(dataDir),
    update: patchOrEntry,
  });
}

export async function listSessions(
  dataDir?: string,
): Promise<Array<{ key: string; entry: SessionEntry }>> {
  return await listLearningSessions(resolveDocAssistantRuntimeDataDir(dataDir));
}

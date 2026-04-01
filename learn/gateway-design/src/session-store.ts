import path from "node:path";
import {
  deleteLearningSession,
  listLearningSessions,
  loadLearningSessionStore,
  resolveLearningSession,
  updateLearningSession,
  type LearningSessionEntry as SessionEntry,
} from "../../session-memory-design/src/index.js";

const GATEWAY_DATA_DIR = path.resolve(process.cwd(), ".mini-gateway-data");
const GATEWAY_AGENT_DATA_DIR = path.join(GATEWAY_DATA_DIR, "agent-runtime");

export type { SessionEntry };
export type SessionStore = Record<string, SessionEntry>;

export function resolveGatewayAgentDataDir(): string {
  return GATEWAY_AGENT_DATA_DIR;
}

export async function loadSessionStore(): Promise<SessionStore> {
  return await loadLearningSessionStore(resolveGatewayAgentDataDir());
}

export async function getOrCreateSession(
  sessionKey: string,
  initial?: Partial<SessionEntry>,
): Promise<{ entry: SessionEntry; isNew: boolean }> {
  const store = await loadSessionStore();
  const existing = store[sessionKey];
  if (existing) {
    return { entry: existing, isNew: false };
  }
  const entry = await resolveLearningSession({
    sessionKey,
    dataDir: resolveGatewayAgentDataDir(),
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
): Promise<SessionEntry> {
  const store = await loadSessionStore();
  const current = store[sessionKey];
  if (typeof patchOrEntry === "function") {
    if (!current) {
      throw new Error(`Unknown gateway session: ${sessionKey}`);
    }
    return await updateLearningSession({
      sessionKey,
      dataDir: resolveGatewayAgentDataDir(),
      update: patchOrEntry(current),
    });
  }
  if (!current) {
    return await resolveLearningSession({
      sessionKey,
      dataDir: resolveGatewayAgentDataDir(),
      initial: patchOrEntry,
    });
  }
  return await updateLearningSession({
    sessionKey,
    dataDir: resolveGatewayAgentDataDir(),
    update: patchOrEntry,
  });
}

export async function listSessions(): Promise<Array<{ key: string; entry: SessionEntry }>> {
  return await listLearningSessions(resolveGatewayAgentDataDir());
}

export async function deleteSession(sessionKey: string): Promise<void> {
  await deleteLearningSession(sessionKey, resolveGatewayAgentDataDir());
}

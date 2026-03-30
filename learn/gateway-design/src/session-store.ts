import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getTranscriptPath } from "../../agent-design/src/index.js";

const GATEWAY_DATA_DIR = path.resolve(process.cwd(), ".mini-gateway-data");
const SESSION_STORE_PATH = path.join(GATEWAY_DATA_DIR, "sessions.json");
const GATEWAY_AGENT_DATA_DIR = path.join(GATEWAY_DATA_DIR, "agent-runtime");

export type SessionEntry = {
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  status: "idle" | "running" | "error";
  provider?: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  lastChannel?: string;
  lastTo?: string;
  startedAt?: number;
  endedAt?: number;
};

export type SessionStore = Record<string, SessionEntry>;

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(GATEWAY_DATA_DIR, { recursive: true });
  await fs.mkdir(GATEWAY_AGENT_DATA_DIR, { recursive: true });
}

export function resolveGatewayAgentDataDir(): string {
  return GATEWAY_AGENT_DATA_DIR;
}

export async function loadSessionStore(): Promise<SessionStore> {
  try {
    const raw = await fs.readFile(SESSION_STORE_PATH, "utf-8");
    return JSON.parse(raw) as SessionStore;
  } catch {
    return {};
  }
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
  const entry: SessionEntry = {
    sessionId: randomUUID(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "idle",
    inputTokens: 0,
    outputTokens: 0,
    ...initial,
  };
  await updateSessionEntry(sessionKey, entry);
  return { entry, isNew: true };
}

export async function updateSessionEntry(
  sessionKey: string,
  patchOrEntry: Partial<SessionEntry> | SessionEntry | ((current: SessionEntry | undefined) => SessionEntry),
): Promise<SessionEntry> {
  await ensureDataDir();
  const store = await loadSessionStore();
  const current = store[sessionKey];
  const next: SessionEntry =
    typeof patchOrEntry === "function"
      ? patchOrEntry(current)
      : current
        ? {
            ...current,
            ...patchOrEntry,
            updatedAt: Date.now(),
          }
        : {
            sessionId: randomUUID(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            status: "idle",
            inputTokens: 0,
            outputTokens: 0,
            ...(patchOrEntry as Partial<SessionEntry>),
          };
  store[sessionKey] = next;
  await fs.writeFile(SESSION_STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
  return next;
}

export async function listSessions(): Promise<Array<{ key: string; entry: SessionEntry }>> {
  const store = await loadSessionStore();
  return Object.entries(store)
    .map(([key, entry]) => ({ key, entry }))
    .sort((a, b) => b.entry.updatedAt - a.entry.updatedAt);
}

export async function deleteSession(sessionKey: string): Promise<void> {
  const store = await loadSessionStore();
  const entry = store[sessionKey];
  if (entry?.sessionId) {
    await fs.rm(getTranscriptPath(entry.sessionId, GATEWAY_AGENT_DATA_DIR), { force: true });
  }
  delete store[sessionKey];
  await ensureDataDir();
  await fs.writeFile(SESSION_STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

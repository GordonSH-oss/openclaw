import { randomUUID } from "node:crypto";
import path from "node:path";
import { readJsonSafe, writeJsonAtomic } from "./persistence.js";
import type { DocUserRecord } from "./protocol/index.js";

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), ".mini-doc-assistant-data");

export type DocUserStore = Record<string, DocUserRecord>;

export function resolveDocAssistantDataDir(dataDir?: string): string {
  return dataDir ?? DEFAULT_DATA_DIR;
}

export function getDocUserStorePath(dataDir?: string): string {
  return path.join(resolveDocAssistantDataDir(dataDir), "users.json");
}

export async function loadDocUserStore(dataDir?: string): Promise<DocUserStore> {
  return await readJsonSafe<DocUserStore>(getDocUserStorePath(dataDir), {});
}

export async function saveDocUserStore(store: DocUserStore, dataDir?: string): Promise<void> {
  await writeJsonAtomic(getDocUserStorePath(dataDir), store);
}

export async function createTempDocUser(params?: {
  dataDir?: string;
  displayLabel?: string;
}): Promise<DocUserRecord> {
  const userId = randomUUID();
  const user: DocUserRecord = {
    userId,
    sessionKey: `temp/${userId}`,
    createdAt: Date.now(),
    displayLabel: params?.displayLabel?.trim() || undefined,
  };
  const store = await loadDocUserStore(params?.dataDir);
  store[userId] = user;
  await saveDocUserStore(store, params?.dataDir);
  return user;
}

export async function getTempDocUser(
  userId: string,
  dataDir?: string,
): Promise<DocUserRecord | null> {
  const store = await loadDocUserStore(dataDir);
  return store[userId] ?? null;
}

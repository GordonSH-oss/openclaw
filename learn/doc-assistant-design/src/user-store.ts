import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
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
  try {
    const raw = await fs.readFile(getDocUserStorePath(dataDir), "utf-8");
    return JSON.parse(raw) as DocUserStore;
  } catch {
    return {};
  }
}

export async function saveDocUserStore(store: DocUserStore, dataDir?: string): Promise<void> {
  const root = resolveDocAssistantDataDir(dataDir);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(getDocUserStorePath(dataDir), JSON.stringify(store, null, 2), "utf-8");
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

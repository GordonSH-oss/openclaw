import fs from "node:fs/promises";
import path from "node:path";
import { resolveLearningAgentDataDir } from "../transcript/store.js";
import type { AuthProfile, AuthProfileUsage } from "../types.js";

export type AuthProfileStore = {
  profiles: Record<string, AuthProfile>;
  usage: Record<string, AuthProfileUsage>;
};

function getStorePath(dataDir?: string): string {
  return path.join(resolveLearningAgentDataDir(dataDir), "auth-profiles.json");
}

function buildDefaultStore(): AuthProfileStore {
  return {
    profiles: {
      primary: {
        id: "primary",
        provider: "mock",
        type: "oauth",
        label: "Primary OAuth Profile",
      },
      backup: {
        id: "backup",
        provider: "mock",
        type: "token",
        label: "Backup Token Profile",
      },
    },
    usage: {},
  };
}

export async function loadAuthProfileStore(dataDir?: string): Promise<AuthProfileStore> {
  const storePath = getStorePath(dataDir);
  try {
    const raw = await fs.readFile(storePath, "utf-8");
    return JSON.parse(raw) as AuthProfileStore;
  } catch {
    const defaults = buildDefaultStore();
    await saveAuthProfileStore(defaults, dataDir);
    return defaults;
  }
}

export async function saveAuthProfileStore(
  store: AuthProfileStore,
  dataDir?: string,
): Promise<void> {
  const root = resolveLearningAgentDataDir(dataDir);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(getStorePath(dataDir), JSON.stringify(store, null, 2), "utf-8");
}

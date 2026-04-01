import type {
  DocAssistantMode,
  DocsTerminalResult,
  OpenAICompatibleConfig,
} from "./protocol/index.js";
import { DOC_ASSISTANT_MARKETING_VERSION, DOC_ASSISTANT_PACKAGE_VERSION } from "./version.js";

export type EventBroadcaster = {
  broadcast(event: string, data: unknown, connIds?: Set<string>): void;
  registerConn(connId: string, send: (msg: string) => void): void;
  registerClientId(connId: string, clientId: string): void;
  unregisterConn(connId: string): void;
  getConnIdsForClientId(clientId: string): Set<string>;
  getConnCount(): number;
};

export type DedupeEntry = {
  ts: number;
  ok: boolean;
  payload: unknown;
  error?: unknown;
};

export type DocRunEntry = {
  runId: string;
  userId: string;
  sessionKey: string;
  sessionId: string;
  question: string;
  mode: DocAssistantMode;
  startedAt: number;
  connId: string;
  completion: Promise<DocsTerminalResult>;
};

export type DocRunState = {
  activeRuns: Map<string, DocRunEntry>;
  terminalRuns: Map<string, DocsTerminalResult>;
};

export type DocAssistantRuntimeState = {
  broadcaster: EventBroadcaster;
  dedupe: Map<string, DedupeEntry>;
  runs: DocRunState;
  config: {
    version: string;
    packageVersion: string;
    docsRoot: string;
    dataDir?: string;
    defaultMode: DocAssistantMode;
    adminToken?: string;
    defaultAgentConfig?: {
      backend?: "embedded" | "cli";
      provider?: string;
      model?: string;
      openAICompatible?: OpenAICompatibleConfig;
    };
  };
};

export function createEventBroadcaster(): EventBroadcaster {
  const conns = new Map<string, (msg: string) => void>();
  const clientIdToConnIds = new Map<string, Set<string>>();
  const connIdToClientId = new Map<string, string>();
  return {
    broadcast(event, data, connIds) {
      const payload = JSON.stringify({ event, data });
      const targets = connIds ?? new Set(conns.keys());
      for (const connId of targets) {
        conns.get(connId)?.(payload);
      }
    },
    registerConn(connId, send) {
      conns.set(connId, send);
    },
    registerClientId(connId, clientId) {
      const current = clientIdToConnIds.get(clientId) ?? new Set<string>();
      current.add(connId);
      clientIdToConnIds.set(clientId, current);
      connIdToClientId.set(connId, clientId);
    },
    unregisterConn(connId) {
      conns.delete(connId);
      const clientId = connIdToClientId.get(connId);
      if (!clientId) {
        return;
      }
      connIdToClientId.delete(connId);
      const connIds = clientIdToConnIds.get(clientId);
      if (!connIds) {
        return;
      }
      connIds.delete(connId);
      if (connIds.size === 0) {
        clientIdToConnIds.delete(clientId);
      }
    },
    getConnIdsForClientId(clientId) {
      return new Set(clientIdToConnIds.get(clientId) ?? []);
    },
    getConnCount() {
      return conns.size;
    },
  };
}

export function createDocRunState(): DocRunState {
  return {
    activeRuns: new Map(),
    terminalRuns: new Map(),
  };
}

export function createDocAssistantRuntimeState(config: {
  version?: string;
  packageVersion?: string;
  docsRoot: string;
  dataDir?: string;
  defaultMode: DocAssistantMode;
  adminToken?: string;
  defaultAgentConfig?: {
    backend?: "embedded" | "cli";
    provider?: string;
    model?: string;
    openAICompatible?: OpenAICompatibleConfig;
  };
}): DocAssistantRuntimeState {
  return {
    broadcaster: createEventBroadcaster(),
    dedupe: new Map(),
    runs: createDocRunState(),
    config: {
      version: config.version ?? DOC_ASSISTANT_MARKETING_VERSION,
      packageVersion: config.packageVersion ?? DOC_ASSISTANT_PACKAGE_VERSION,
      docsRoot: config.docsRoot,
      dataDir: config.dataDir,
      defaultMode: config.defaultMode,
      adminToken: config.adminToken,
      defaultAgentConfig: config.defaultAgentConfig,
    },
  };
}

export function registerDocRun(state: DocRunState, entry: DocRunEntry): void {
  state.activeRuns.set(entry.runId, entry);
}

export function completeDocRun(
  state: DocRunState,
  runId: string,
  terminal: DocsTerminalResult,
): void {
  state.activeRuns.delete(runId);
  state.terminalRuns.set(runId, terminal);
}

export function setDedupeEntry(
  dedupe: Map<string, DedupeEntry>,
  key: string,
  entry: DedupeEntry,
  ttlMs = 5 * 60_000,
): void {
  dedupe.set(key, entry);
  const timer = setTimeout(() => {
    dedupe.delete(key);
  }, ttlMs);
  timer.unref?.();
}

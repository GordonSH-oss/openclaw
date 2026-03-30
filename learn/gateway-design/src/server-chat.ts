import type { AgentCompletedResult, ConnectedClient } from "./protocol/index.js";

export type GatewayRunEntry = {
  runId: string;
  sessionKey: string;
  sessionId: string;
  startedAt: number;
  requestId?: string;
  client?: ConnectedClient;
  abort: AbortController;
  completion: Promise<AgentCompletedResult>;
};

export type GatewayChatState = {
  activeRuns: Map<string, GatewayRunEntry>;
  terminalRuns: Map<string, AgentCompletedResult>;
  sessionMessageSubscribers: Map<string, Set<string>>;
};

export function createGatewayChatState(): GatewayChatState {
  return {
    activeRuns: new Map(),
    terminalRuns: new Map(),
    sessionMessageSubscribers: new Map(),
  };
}

export function registerChatRun(state: GatewayChatState, entry: GatewayRunEntry): void {
  state.activeRuns.set(entry.runId, entry);
}

export function completeChatRun(
  state: GatewayChatState,
  runId: string,
  terminal: AgentCompletedResult,
): void {
  state.activeRuns.delete(runId);
  state.terminalRuns.set(runId, terminal);
}

export function subscribeSessionMessages(
  state: GatewayChatState,
  sessionKey: string,
  connId: string,
): void {
  const current = state.sessionMessageSubscribers.get(sessionKey) ?? new Set<string>();
  current.add(connId);
  state.sessionMessageSubscribers.set(sessionKey, current);
}

export function unsubscribeSessionMessages(
  state: GatewayChatState,
  sessionKey: string,
  connId: string,
): void {
  const current = state.sessionMessageSubscribers.get(sessionKey);
  if (!current) {
    return;
  }
  current.delete(connId);
  if (current.size === 0) {
    state.sessionMessageSubscribers.delete(sessionKey);
  }
}

export function getMessageSubscriberConnIds(
  state: GatewayChatState,
  sessionKey: string,
): Set<string> {
  return state.sessionMessageSubscribers.get(sessionKey) ?? new Set<string>();
}

export function removeConnFromChatSubscriptions(
  state: GatewayChatState,
  connId: string,
): void {
  for (const [sessionKey, subscribers] of state.sessionMessageSubscribers) {
    subscribers.delete(connId);
    if (subscribers.size === 0) {
      state.sessionMessageSubscribers.delete(sessionKey);
    }
  }
}

import type { SessionsChangedEvent } from "./protocol/index.js";
import { createGatewayChatState, getMessageSubscriberConnIds } from "./server-chat.js";

export type EventBroadcaster = {
  broadcast(event: string, data: unknown, connIds?: Set<string>): void;
  registerConn(connId: string, send: (msg: string) => void): void;
  unregisterConn(connId: string): void;
  getConnCount(): number;
};

export type DedupeEntry = {
  ts: number;
  ok: boolean;
  payload: unknown;
  error?: unknown;
};

export type GatewayRuntimeState = {
  broadcaster: EventBroadcaster;
  dedupe: Map<string, DedupeEntry>;
  sessionSubscribers: Set<string>;
  chat: ReturnType<typeof createGatewayChatState>;
};

export function createEventBroadcaster(): EventBroadcaster {
  const conns = new Map<string, (msg: string) => void>();
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
    unregisterConn(connId) {
      conns.delete(connId);
    },
    getConnCount() {
      return conns.size;
    },
  };
}

export function createGatewayRuntimeState(): GatewayRuntimeState {
  return {
    broadcaster: createEventBroadcaster(),
    dedupe: new Map(),
    sessionSubscribers: new Set(),
    chat: createGatewayChatState(),
  };
}

export function setDedupeEntry(
  dedupe: Map<string, DedupeEntry>,
  key: string,
  entry: DedupeEntry,
  ttlMs = 5 * 60_000,
): void {
  dedupe.set(key, entry);
  setTimeout(() => {
    dedupe.delete(key);
  }, ttlMs);
}

export function broadcastSessionsChanged(
  state: GatewayRuntimeState,
  payload: SessionsChangedEvent,
): void {
  if (state.sessionSubscribers.size === 0) {
    return;
  }
  state.broadcaster.broadcast("sessions.changed", payload, state.sessionSubscribers);
}

export function broadcastSessionMessage(
  state: GatewayRuntimeState,
  sessionKey: string,
  message: unknown,
): void {
  const subscribers = getMessageSubscriberConnIds(state.chat, sessionKey);
  if (subscribers.size === 0) {
    return;
  }
  state.broadcaster.broadcast(
    "sessions.message",
    {
      sessionKey,
      message,
    },
    subscribers,
  );
}

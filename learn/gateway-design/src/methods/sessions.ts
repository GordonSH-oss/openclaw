import type { MethodHandler } from "../method-router.js";
import { makeError } from "../protocol/index.js";
import { subscribeSessionMessages, unsubscribeSessionMessages } from "../server-chat.js";
import {
  listSessions,
  loadSessionStore,
  deleteSession,
  resolveGatewayAgentDataDir,
} from "../session-store.js";
import { loadGatewayTranscript } from "../transcript-store.js";

export const sessionsListHandler: MethodHandler = async ({ respond }) => {
  const sessions = await listSessions();
  respond(true, {
    sessions: sessions.map(({ key, entry }) => ({
      key,
      sessionId: entry.sessionId,
      status: entry.status,
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      lastChannel: entry.lastChannel,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
    })),
  });
};

export const sessionsGetHandler: MethodHandler = async ({ request, respond }) => {
  const params = request.params as Record<string, unknown>;
  const sessionKey = typeof params?.sessionKey === "string" ? params.sessionKey.trim() : "";
  if (!sessionKey) {
    respond(false, undefined, makeError("INVALID_REQUEST", "sessionKey 是必填项"));
    return;
  }
  const store = await loadSessionStore();
  const entry = store[sessionKey];
  if (!entry) {
    respond(false, undefined, makeError("NOT_FOUND", `找不到 session: ${sessionKey}`));
    return;
  }
  respond(true, { key: sessionKey, entry });
};

export const sessionsDeleteHandler: MethodHandler = async ({ request, respond, client, state }) => {
  if (!client.scopes.includes("admin")) {
    respond(false, undefined, makeError("UNAUTHORIZED", "删除 session 需要 admin 权限"));
    return;
  }
  const params = request.params as Record<string, unknown>;
  const sessionKey = typeof params?.sessionKey === "string" ? params.sessionKey.trim() : "";
  if (!sessionKey) {
    respond(false, undefined, makeError("INVALID_REQUEST", "sessionKey 是必填项"));
    return;
  }
  for (const [, run] of state.chat.activeRuns) {
    if (run.sessionKey === sessionKey) {
      respond(
        false,
        undefined,
        makeError("CONFLICT", `Session ${sessionKey} 正在运行，请先取消再删除`),
      );
      return;
    }
  }
  await deleteSession(sessionKey);
  state.broadcaster.broadcast(
    "sessions.changed",
    { sessionKey, reason: "delete", ts: Date.now() },
    state.sessionSubscribers,
  );
  respond(true, { deleted: true, sessionKey });
};

export const sessionsSubscribeHandler: MethodHandler = ({ respond, client, state }) => {
  state.sessionSubscribers.add(client.connId);
  respond(true, { subscribed: true });
};

export const sessionsUnsubscribeHandler: MethodHandler = ({ respond, client, state }) => {
  state.sessionSubscribers.delete(client.connId);
  respond(true, { unsubscribed: true });
};

export const sessionsMessagesSubscribeHandler: MethodHandler = ({
  request,
  respond,
  client,
  state,
}) => {
  const params = request.params as Record<string, unknown>;
  const sessionKey = typeof params?.sessionKey === "string" ? params.sessionKey.trim() : "";
  if (!sessionKey) {
    respond(false, undefined, makeError("INVALID_REQUEST", "sessionKey 是必填项"));
    return;
  }
  subscribeSessionMessages(state.chat, sessionKey, client.connId);
  respond(true, { subscribed: true, sessionKey });
};

export const sessionsMessagesUnsubscribeHandler: MethodHandler = ({
  request,
  respond,
  client,
  state,
}) => {
  const params = request.params as Record<string, unknown>;
  const sessionKey = typeof params?.sessionKey === "string" ? params.sessionKey.trim() : "";
  if (!sessionKey) {
    respond(false, undefined, makeError("INVALID_REQUEST", "sessionKey 是必填项"));
    return;
  }
  unsubscribeSessionMessages(state.chat, sessionKey, client.connId);
  respond(true, { unsubscribed: true, sessionKey });
};

export const sessionsTranscriptGetHandler: MethodHandler = async ({ request, respond }) => {
  const params = request.params as Record<string, unknown>;
  const sessionKey = typeof params?.sessionKey === "string" ? params.sessionKey.trim() : "";
  if (!sessionKey) {
    respond(false, undefined, makeError("INVALID_REQUEST", "sessionKey 是必填项"));
    return;
  }
  const store = await loadSessionStore();
  const entry = store[sessionKey];
  if (!entry) {
    respond(false, undefined, makeError("NOT_FOUND", `找不到 session: ${sessionKey}`));
    return;
  }
  const messages = await loadGatewayTranscript(entry.sessionId, resolveGatewayAgentDataDir());
  respond(true, {
    sessionKey,
    sessionId: entry.sessionId,
    messages,
  });
};

export const gatewayMethodsHandler: MethodHandler = ({ respond }) => {
  respond(true, {
    methods: [
      {
        method: "agent",
        description: "执行一次 agent turn（发消息给 AI）",
        requiredScopes: ["admin"],
      },
      { method: "agent.status", description: "查询 run 状态" },
      { method: "agent.wait", description: "等待 run 完成" },
      { method: "agent.cancel", description: "取消正在运行的 run", requiredScopes: ["admin"] },
      { method: "sessions.list", description: "列出所有 sessions" },
      { method: "sessions.get", description: "获取单个 session 详情" },
      { method: "sessions.delete", description: "删除 session", requiredScopes: ["admin"] },
      { method: "sessions.subscribe", description: "订阅 session 变更事件" },
      { method: "sessions.unsubscribe", description: "取消订阅 session 变更事件" },
      { method: "sessions.messages.subscribe", description: "订阅 session transcript 事件" },
      { method: "sessions.messages.unsubscribe", description: "取消订阅 session transcript 事件" },
      { method: "sessions.transcript.get", description: "获取 session 对话历史" },
      { method: "gateway.methods", description: "列出所有 Gateway 方法" },
      { method: "gateway.status", description: "获取 Gateway 运行状态" },
    ],
  });
};

export const gatewayStatusHandler: MethodHandler = ({ respond, state }) => {
  respond(true, {
    status: "running",
    connections: state.broadcaster.getConnCount(),
    activeRuns: state.chat.activeRuns.size,
    sessionSubscribers: state.sessionSubscribers.size,
    messageSubscribers: state.chat.sessionMessageSubscribers.size,
    uptime: process.uptime(),
    serverTime: Date.now(),
  });
};

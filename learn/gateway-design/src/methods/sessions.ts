/**
 * methods/sessions.ts — sessions.* RPC 方法实现
 *
 * 覆盖以下方法：
 * - sessions.list      列出所有 sessions
 * - sessions.get       获取单个 session 详情
 * - sessions.delete    删除一个 session
 * - sessions.subscribe 订阅 session 变更事件
 * - sessions.transcript.get 获取 session 的对话历史
 */

import { makeError } from "../protocol.js";
import {
  listSessions,
  loadSessionStore,
  deleteSession,
  loadTranscript,
} from "../sessions.js";
import type { MethodHandler } from "../method-router.js";

/**
 * sessions.list — 列出所有 sessions
 *
 * 请求：{ "id": "req-1", "method": "sessions.list" }
 * 响应：{ sessions: [{ key, sessionId, status, model, ... }] }
 */
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

/**
 * sessions.get — 获取单个 session 详情
 *
 * 请求：{ "id": "req-1", "method": "sessions.get", "params": { "sessionKey": "default/main" } }
 */
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

/**
 * sessions.delete — 删除 session（同时删除对应的 transcript 文件）
 *
 * 请求：{ "id": "req-1", "method": "sessions.delete", "params": { "sessionKey": "default/main" } }
 */
export const sessionsDeleteHandler: MethodHandler = async ({ request, respond, client, state }) => {
  // 删除需要 admin 权限
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

  // 检查是否有正在运行的 run
  for (const [, run] of state.activeRuns) {
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

  // 广播 sessions.changed 通知 UI 刷新列表
  state.broadcaster.broadcast(
    "sessions.changed",
    { sessionKey, reason: "delete", ts: Date.now() },
    state.sessionSubscribers,
  );

  respond(true, { deleted: true, sessionKey });
};

/**
 * sessions.subscribe — 订阅 session 变更事件
 *
 * 订阅后，当任意 session 状态变化时（创建、收消息、完成、删除），
 * Gateway 会推送 sessions.changed 事件。
 *
 * 这让 Web UI / macOS App 可以实时更新会话列表，
 * 而不需要轮询 sessions.list。
 *
 * 请求：{ "id": "req-1", "method": "sessions.subscribe" }
 */
export const sessionsSubscribeHandler: MethodHandler = ({ respond, client, state }) => {
  const connId = client.connId;
  state.sessionSubscribers.add(connId);
  console.log(`[sessions] connId=${connId} 订阅了 session 事件，当前订阅者数: ${state.sessionSubscribers.size}`);
  respond(true, { subscribed: true });
};

/**
 * sessions.unsubscribe — 取消订阅 session 变更事件
 */
export const sessionsUnsubscribeHandler: MethodHandler = ({ respond, client, state }) => {
  const connId = client.connId;
  state.sessionSubscribers.delete(connId);
  respond(true, { unsubscribed: true });
};

/**
 * sessions.transcript.get — 获取 session 的完整对话历史（transcript）
 *
 * 请求：{ "id": "req-1", "method": "sessions.transcript.get", "params": { "sessionKey": "default/main" } }
 * 响应：{ messages: [{ id, parentId, role, content, timestamp, ... }] }
 *
 * 这个接口让 Web UI 可以加载对话历史，在页面刷新后恢复上下文。
 */
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

  const messages = await loadTranscript(entry.sessionId);

  respond(true, {
    sessionKey,
    sessionId: entry.sessionId,
    messages,
  });
};

/**
 * gateway.methods — 列出所有可用的 Gateway 方法（用于调试/文档）
 */
export const gatewayMethodsHandler: MethodHandler = ({ respond, state: _ }) => {
  // 这里 hardcode 是为了演示，真实实现里从 router.listMethods() 动态生成
  respond(true, {
    methods: [
      { method: "agent", description: "执行一次 agent turn（发消息给 AI）", requiredScopes: ["admin"] },
      { method: "agent.status", description: "查询 run 状态" },
      { method: "agent.cancel", description: "取消正在运行的 run", requiredScopes: ["admin"] },
      { method: "sessions.list", description: "列出所有 sessions" },
      { method: "sessions.get", description: "获取单个 session 详情" },
      { method: "sessions.delete", description: "删除 session", requiredScopes: ["admin"] },
      { method: "sessions.subscribe", description: "订阅 session 变更事件" },
      { method: "sessions.unsubscribe", description: "取消订阅 session 变更事件" },
      { method: "sessions.transcript.get", description: "获取 session 对话历史" },
      { method: "gateway.methods", description: "列出所有 Gateway 方法" },
      { method: "gateway.status", description: "获取 Gateway 运行状态" },
    ],
  });
};

/**
 * gateway.status — 获取 Gateway 当前运行状态
 */
export const gatewayStatusHandler: MethodHandler = ({ respond, state }) => {
  respond(true, {
    status: "running",
    connections: state.broadcaster.getConnCount(),
    activeRuns: state.activeRuns.size,
    sessionSubscribers: state.sessionSubscribers.size,
    uptime: process.uptime(),
    serverTime: Date.now(),
  });
};

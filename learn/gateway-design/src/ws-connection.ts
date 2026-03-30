/**
 * ws-connection.ts — WebSocket 连接生命周期管理
 *
 * 【职责分离原则】
 * 这个文件只处理"单个 WebSocket 连接"的生命周期问题：
 * - 连接建立时的握手和认证
 * - 消息接收和解析
 * - 连接断开时的清理
 *
 * 它不包含任何业务逻辑（不知道 agent、session 是什么）。
 * 业务逻辑在 method-router.ts 和 methods/*.ts 里。
 *
 * 这种分离让你可以：
 * - 单独测试连接认证逻辑
 * - 单独测试业务方法逻辑
 * - 替换 WebSocket 实现（如从 ws 换到 Bun.serve）而不影响业务代码
 */

import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import {
  parseClientMessage,
  serializeMessage,
  makeError,
  type ConnectedClient,
  type ConnectParams,
  type GatewayResponse,
} from "./protocol.js";
import type { GatewayRuntimeState } from "./runtime-state.js";
import type { MethodRouter } from "./method-router.js";
import { removeConnFromChatSubscriptions } from "./server-chat.js";

// ─── 连接上下文 ────────────────────────────────────────────────────────────────

/**
 * 单个连接的完整上下文
 *
 * 每个 WebSocket 连接都有自己的 connId 和 client 信息。
 * 连接断开后，所有状态都要清理。
 */
export type ConnectionContext = {
  connId: string;
  ws: WebSocket;
  client: ConnectedClient;
  connectedAt: number;
};

// ─── 认证逻辑 ──────────────────────────────────────────────────────────────────

/**
 * 解析连接参数
 *
 * 实际项目里这里会验证 JWT token、API key 等。
 * 本示例简化为：没有 token 就是匿名连接（只读 scope），
 * 有 token 就是管理员连接（admin scope）。
 */
function resolveClientFromQuery(query: Record<string, string | string[] | undefined>): ConnectedClient {
  const tokenRaw = query["token"];
  const token = Array.isArray(tokenRaw) ? tokenRaw[0] : tokenRaw;
  const clientIdRaw = query["clientId"];
  const clientId = Array.isArray(clientIdRaw) ? clientIdRaw[0] : clientIdRaw;

  // 简化的认证：任何非空 token 都授予 admin scope
  // 真实项目里这里要验证 JWT 或对比数据库
  const authenticated = Boolean(token?.trim());
  const scopes: string[] = authenticated ? ["admin", "read"] : ["read"];

  const connectParams: ConnectParams = {
    token: token ?? undefined,
    clientId: clientId ?? undefined,
  };

  return {
    connId: randomUUID(),
    authenticated,
    scopes,
    connect: connectParams,
  };
}

// ─── 连接处理入口 ──────────────────────────────────────────────────────────────

/**
 * 处理一个新的 WebSocket 连接
 *
 * 这是 Gateway 的连接处理核心，在 server.ts 里被调用：
 *
 *   wss.on("connection", (ws, req) => {
 *     handleConnection(ws, parseQuery(req.url), state, router);
 *   });
 *
 * 注意：这个函数是同步的，它注册事件处理器然后立即返回。
 * 实际的消息处理是异步的，在回调里发生。
 */
export function handleConnection(
  ws: WebSocket,
  query: Record<string, string | string[] | undefined>,
  state: GatewayRuntimeState,
  router: MethodRouter,
): void {
  const client = resolveClientFromQuery(query);
  const connId = client.connId;

  const conn: ConnectionContext = {
    connId,
    ws,
    client,
    connectedAt: Date.now(),
  };

  // 发送函数：序列化并发送一帧数据到这个连接
  const send = (msg: string) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(msg);
    }
  };

  // 注册到广播器：后续的 broadcast() 调用就能找到这个连接
  state.broadcaster.registerConn(connId, send);

  console.log(
    `[ws] 连接建立: connId=${connId} authenticated=${client.authenticated} scopes=${client.scopes.join(",")}`,
  );

  // ── 发送欢迎消息（告知客户端它的 connId）──────────────────────
  send(
    serializeMessage({
      event: "gateway.connected",
      data: {
        connId,
        authenticated: client.authenticated,
        scopes: client.scopes,
        serverTime: Date.now(),
      },
    }),
  );

  // ── 消息处理 ────────────────────────────────────────────────────
  ws.on("message", (rawData) => {
    const raw = rawData.toString();

    // 解析请求帧
    const request = parseClientMessage(raw);
    if (!request) {
      send(
        serializeMessage({
          id: "parse-error",
          ok: false,
          error: makeError("INVALID_REQUEST", "无法解析请求，期望格式: { id, method, params }"),
        }),
      );
      return;
    }

    // 构建响应函数：调用方通过这个函数发回响应
    const respond = (ok: boolean, result?: unknown, error?: ReturnType<typeof makeError>) => {
      const frame: GatewayResponse = {
        id: request.id,
        ok,
        result,
        error,
      };
      send(serializeMessage(frame));
    };

    // 委托给方法路由器处理（业务逻辑在那里）
    // 注意：不等待 Promise，避免阻塞后续消息处理
    router.dispatch({ request, respond, client, state }).catch((err) => {
      console.error(`[ws] 方法执行出错: method=${request.method}`, err);
      respond(false, undefined, makeError("INTERNAL_ERROR", String(err)));
    });
  });

  // ── 连接断开处理 ────────────────────────────────────────────────
  ws.on("close", (code, reason) => {
    console.log(
      `[ws] 连接断开: connId=${connId} code=${code} reason=${reason.toString()}`,
    );

    // 从广播器注销
    state.broadcaster.unregisterConn(connId);

    // 从 session 订阅者列表移除
    state.sessionSubscribers.delete(connId);
    removeConnFromChatSubscriptions(state.chat, connId);
  });

  // ── 错误处理 ────────────────────────────────────────────────────
  ws.on("error", (err) => {
    console.error(`[ws] 连接错误: connId=${connId}`, err);
  });
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────────

/**
 * 从 URL query string 解析参数
 * 例："/ws?token=abc&clientId=web-1" → { token: "abc", clientId: "web-1" }
 */
export function parseUrlQuery(url: string): Record<string, string> {
  try {
    const u = new URL(url, "http://localhost");
    const params: Record<string, string> = {};
    for (const [key, value] of u.searchParams) {
      params[key] = value;
    }
    return params;
  } catch {
    return {};
  }
}

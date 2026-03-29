/**
 * protocol.ts — Gateway 线协议定义
 *
 * 【设计原则】协议优先（Protocol-First）
 * 所有客户端（App、Web UI、CLI）都依赖这里的类型，
 * 修改这里等于修改对外合同，需要版本化处理。
 *
 * 通信模型：JSON over WebSocket，类似 JSON-RPC 2.0
 * - 客户端发 Request，Gateway 回 Response（1对1）
 * - Gateway 主动推 Event 给客户端（1对多广播）
 */

// ─── 请求 ────────────────────────────────────────────────────────────────────

/**
 * 客户端发给 Gateway 的请求帧
 *
 * 例：
 * {
 *   "id": "req-001",
 *   "method": "agent",
 *   "params": { "message": "你好", "sessionKey": "default/main", "idempotencyKey": "idem-1" }
 * }
 */
export type GatewayRequest = {
  /** 请求唯一 ID，由客户端生成，用于匹配对应的 Response */
  id: string;
  /** 方法名，如 "agent"、"sessions.list"、"sessions.get" */
  method: string;
  /** 方法参数（各方法自定义） */
  params?: unknown;
};

// ─── 响应 ────────────────────────────────────────────────────────────────────

/**
 * Gateway 回给客户端的响应帧
 *
 * 注意：对于 agent 执行，Gateway 会发两次 Response：
 *   第一次：{ ok: true, result: { status: "accepted", runId } }  ← 立即发
 *   第二次：{ ok: true, result: { status: "ok", ... } }          ← 执行完后发
 */
export type GatewayResponse = {
  /** 对应请求的 ID */
  id: string;
  /** 是否成功 */
  ok: boolean;
  /** 成功时的返回值 */
  result?: unknown;
  /** 失败时的错误信息 */
  error?: GatewayError;
  /** 附加元数据（如 runId、cached 标记） */
  meta?: Record<string, unknown>;
};

export type GatewayError = {
  code: ErrorCode;
  message: string;
};

export type ErrorCode =
  | "INVALID_REQUEST"  // 请求参数格式错误
  | "UNAUTHORIZED"     // 没有权限
  | "NOT_FOUND"        // 资源不存在
  | "CONFLICT"         // 资源冲突（如幂等键冲突）
  | "UNAVAILABLE"      // 服务不可用（执行失败）
  | "INTERNAL_ERROR";  // 内部错误

export function makeError(code: ErrorCode, message: string): GatewayError {
  return { code, message };
}

// ─── 事件 ────────────────────────────────────────────────────────────────────

/**
 * Gateway 主动推送给客户端的事件帧（服务端推送，无对应请求）
 *
 * 例：
 * { "event": "sessions.changed", "data": { "sessionKey": "default/main", "reason": "send" } }
 * { "event": "agent.delta", "data": { "runId": "xxx", "delta": "你好" } }
 */
export type GatewayEvent = {
  /** 事件名 */
  event: string;
  /** 事件数据 */
  data: unknown;
};

// ─── 连接握手 ─────────────────────────────────────────────────────────────────

/**
 * 客户端连接时发送的握手参数（通过 URL query 或首条消息传递）
 *
 * 例：ws://localhost:8789?token=xxx&clientId=web-ui
 */
export type ConnectParams = {
  /** 身份验证 token */
  token?: string;
  /** 客户端自描述 ID */
  clientId?: string;
  /** 客户端声明自己支持的能力（用于功能协商） */
  caps?: string[];
};

/**
 * 连接建立后，Gateway 分配的连接上下文
 */
export type ConnectedClient = {
  /** Gateway 分配的连接唯一 ID */
  connId: string;
  /** 是否通过了身份验证 */
  authenticated: boolean;
  /** 连接携带的 scope，用于权限检查 */
  scopes: string[];
  /** 连接参数 */
  connect: ConnectParams;
};

// ─── Agent 相关协议类型 ───────────────────────────────────────────────────────

/**
 * "agent" 方法的请求参数
 */
export type AgentParams = {
  /** 用户消息正文 */
  message: string;
  /** Session key（如 "default/main" 或 "default/telegram/user:123"）*/
  sessionKey?: string;
  /** 幂等键：同一个 key 的请求只执行一次，重复请求返回缓存结果 */
  idempotencyKey: string;
  /** 可选：指定使用哪个 agent */
  agentId?: string;
  /** 可选：覆盖默认 model provider */
  provider?: string;
  /** 可选：覆盖默认 model */
  model?: string;
  /** 可选：超时秒数（0 = 无超时） */
  timeout?: number;
};

/**
 * "agent" 方法的 accepted 响应（立即返回）
 */
export type AgentAcceptedResult = {
  runId: string;
  status: "accepted";
  acceptedAt: number;
};

/**
 * "agent" 方法的 completed 响应（执行完成后返回）
 */
export type AgentCompletedResult = {
  runId: string;
  status: "ok" | "error";
  summary: string;
  reply?: string;
};

// ─── Session 相关协议类型 ─────────────────────────────────────────────────────

/**
 * sessions.changed 事件的数据结构
 */
export type SessionsChangedEvent = {
  sessionKey: string;
  reason: "create" | "send" | "complete" | "reset" | "error";
  ts: number;
  // 以下是可选的 session 元数据快照（便于客户端更新 UI）
  sessionId?: string;
  status?: "idle" | "running" | "error";
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  updatedAt?: number;
};

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/**
 * 把任意值安全地序列化为 Gateway 消息字符串
 */
export function serializeMessage(frame: GatewayResponse | GatewayEvent): string {
  return JSON.stringify(frame);
}

/**
 * 解析来自客户端的消息，失败时返回 null
 */
export function parseClientMessage(raw: string): GatewayRequest | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).id === "string" &&
      typeof (parsed as Record<string, unknown>).method === "string"
    ) {
      return parsed as GatewayRequest;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 验证 AgentParams 基本合法性
 */
export function validateAgentParams(
  params: unknown,
): params is AgentParams {
  if (typeof params !== "object" || params === null) return false;
  const p = params as Record<string, unknown>;
  return (
    typeof p.message === "string" &&
    p.message.trim().length > 0 &&
    typeof p.idempotencyKey === "string" &&
    p.idempotencyKey.trim().length > 0
  );
}

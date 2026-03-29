/**
 * method-router.ts — RPC 方法分发层
 *
 * 【核心职责】把 Gateway RPC 请求路由到对应的处理函数
 *
 * 这一层类似 Express/Koa 的路由层，但面向 WebSocket 而不是 HTTP。
 * 它负责：
 * 1. 维护 method → handler 的映射表
 * 2. 在调用 handler 之前检查权限（scope 检查）
 * 3. 处理未知 method 的情况
 *
 * 【为什么要有这一层，而不是在 ws-connection.ts 里直接 switch-case？】
 *
 * 因为方法数量会随着时间增长（从 5 个增长到 50 个），
 * 如果都塞在连接处理里，文件会变得很难维护。
 * 分成独立的 router，可以：
 * - 每个 method 模块独立文件，独立测试
 * - router 本身可以测试（注册 mock handler，发请求，验证调用）
 * - 权限逻辑统一在一个地方
 */

import {
  makeError,
  type ConnectedClient,
  type GatewayRequest,
  type GatewayError,
} from "./protocol.js";
import type { GatewayRuntimeState } from "./runtime-state.js";

// ─── Handler 类型定义 ──────────────────────────────────────────────────────────

/**
 * method handler 的上下文参数
 */
export type HandlerContext = {
  /** 当前请求 */
  request: GatewayRequest;
  /**
   * 响应函数：调用它来发回响应
   *
   * 注意：对于 agent 方法，这个函数可能被调用两次：
   * 第一次：立即发 accepted
   * 第二次：执行完成后发 ok/error
   */
  respond: (ok: boolean, result?: unknown, error?: GatewayError) => void;
  /** 当前连接的客户端信息 */
  client: ConnectedClient;
  /** Gateway 运行时状态（用于读取/修改 dedupe、activeRuns、subscribers 等） */
  state: GatewayRuntimeState;
};

/**
 * method handler 函数类型
 *
 * 可以是同步或异步函数。
 * 如果返回 Promise，router 会等待它完成（除了 agent 这种特殊情况）。
 */
export type MethodHandler = (ctx: HandlerContext) => void | Promise<void>;

/**
 * method 注册信息
 */
type RegisteredMethod = {
  handler: MethodHandler;
  /**
   * 需要的 scope（权限）
   * 例：["admin"] 表示需要 admin scope 才能调用
   * 不填表示所有人都可以调用
   */
  requiredScopes?: string[];
  /** 方法描述（用于日志和错误信息） */
  description?: string;
};

// ─── Router 类 ────────────────────────────────────────────────────────────────

/**
 * Gateway 方法路由器
 *
 * 使用方式：
 *
 *   const router = new MethodRouter();
 *
 *   router.register("agent", agentHandler, { requiredScopes: ["admin"] });
 *   router.register("sessions.list", sessionsListHandler);
 *
 *   // 在连接处理里：
 *   router.dispatch({ request, respond, client, state });
 */
export class MethodRouter {
  private methods = new Map<string, RegisteredMethod>();

  /**
   * 注册一个 method handler
   */
  register(
    method: string,
    handler: MethodHandler,
    opts?: { requiredScopes?: string[]; description?: string },
  ): this {
    this.methods.set(method, {
      handler,
      requiredScopes: opts?.requiredScopes,
      description: opts?.description,
    });
    return this;  // 支持链式调用
  }

  /**
   * 分发一个请求到对应的 handler
   *
   * 流程：
   * 1. 查找 method 对应的 handler
   * 2. 检查权限（scope）
   * 3. 调用 handler
   * 4. 处理 handler 抛出的异常
   */
  async dispatch(ctx: HandlerContext): Promise<void> {
    const { request, respond, client } = ctx;
    const method = request.method;

    const registered = this.methods.get(method);

    // ── 未知方法 ────────────────────────────────────────────────────
    if (!registered) {
      respond(
        false,
        undefined,
        makeError("NOT_FOUND", `未知方法: "${method}"`),
      );
      return;
    }

    // ── 权限检查 ────────────────────────────────────────────────────
    if (registered.requiredScopes && registered.requiredScopes.length > 0) {
      const hasScope = registered.requiredScopes.every((scope) =>
        client.scopes.includes(scope),
      );
      if (!hasScope) {
        respond(
          false,
          undefined,
          makeError(
            "UNAUTHORIZED",
            `方法 "${method}" 需要权限: ${registered.requiredScopes.join(", ")}`,
          ),
        );
        return;
      }
    }

    // ── 调用 handler ──────────────────────────────────────────────
    try {
      await registered.handler(ctx);
    } catch (err) {
      console.error(`[router] 方法 ${method} 执行出错:`, err);
      respond(
        false,
        undefined,
        makeError("UNAVAILABLE", String(err)),
      );
    }
  }

  /**
   * 列出所有已注册的方法（用于调试/文档）
   */
  listMethods(): Array<{ method: string; requiredScopes?: string[]; description?: string }> {
    return Array.from(this.methods.entries()).map(([method, info]) => ({
      method,
      requiredScopes: info.requiredScopes,
      description: info.description,
    }));
  }
}

// ─── 辅助工具 ──────────────────────────────────────────────────────────────────

/**
 * 安全地从 handler 的 params 中提取字段
 *
 * 用法：
 *   const message = requireString(params, "message");  // 不存在则抛错
 *   const model = optionalString(params, "model");     // 不存在则返回 undefined
 */
export function requireString(params: unknown, key: string): string {
  if (typeof params !== "object" || params === null) {
    throw new Error(`params 必须是对象`);
  }
  const value = (params as Record<string, unknown>)[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`缺少必填字段: ${key}`);
  }
  return value.trim();
}

export function optionalString(params: unknown, key: string): string | undefined {
  if (typeof params !== "object" || params === null) return undefined;
  const value = (params as Record<string, unknown>)[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function optionalNumber(params: unknown, key: string): number | undefined {
  if (typeof params !== "object" || params === null) return undefined;
  const value = (params as Record<string, unknown>)[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

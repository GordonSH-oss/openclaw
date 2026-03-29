/**
 * runtime-state.ts — Gateway 运行时状态容器
 *
 * 【设计原则】状态集中管理，避免全局变量散落
 *
 * Gateway 在运行时需要维护很多跨请求的共享状态：
 * - 哪些客户端连接着？
 * - 哪些 agent run 正在执行？
 * - 哪些请求已经幂等处理过了？
 * - 哪些连接订阅了 session 事件？
 *
 * 把这些状态集中到 GatewayRuntimeState 这一个对象里，好处是：
 * 1. 所有 method handler 都通过参数接收，而不是访问全局变量
 * 2. 容易测试（可以 mock 整个 state）
 * 3. 生命周期清晰（Gateway 关闭时统一清理）
 */

import type { SessionsChangedEvent } from "./protocol.js";

// ─── 广播器 ───────────────────────────────────────────────────────────────────

/**
 * 事件广播器：向指定的连接推送事件
 *
 * Gateway 不直接持有 WebSocket 对象，而是通过广播器间接操作，
 * 这样 method handler 不需要依赖 ws 库的具体实现。
 */
export type EventBroadcaster = {
  /**
   * 向指定 connId 集合广播事件
   * @param event 事件名
   * @param data  事件数据
   * @param connIds 目标连接 ID 集合（不传则广播给所有连接）
   */
  broadcast(event: string, data: unknown, connIds?: Set<string>): void;

  /**
   * 注册一个连接（WebSocket 连上时调用）
   */
  registerConn(connId: string, send: (msg: string) => void): void;

  /**
   * 注销一个连接（WebSocket 断开时调用）
   */
  unregisterConn(connId: string): void;

  /**
   * 获取当前所有活跃连接数
   */
  getConnCount(): number;
};

/**
 * 创建一个内存广播器实现
 *
 * 生产系统里，这里可以替换成 Redis Pub/Sub 或其他机制，
 * 而 method handler 代码完全不需要修改——这就是"接口隔离"的价值。
 */
export function createEventBroadcaster(): EventBroadcaster {
  // connId → send 函数
  const conns = new Map<string, (msg: string) => void>();

  return {
    broadcast(event, data, connIds) {
      const message = JSON.stringify({ event, data });
      const targets = connIds ?? new Set(conns.keys());
      for (const connId of targets) {
        const send = conns.get(connId);
        if (send) {
          try {
            send(message);
          } catch {
            // 连接已断开，忽略错误
          }
        }
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

// ─── 幂等去重 ─────────────────────────────────────────────────────────────────

/**
 * 幂等去重条目
 *
 * 同一个 idempotencyKey 的请求，只执行一次，后续重复请求返回缓存的结果。
 * 这对于网络不稳定导致的重试非常重要。
 */
export type DedupeEntry = {
  /** 条目创建时间（毫秒时间戳） */
  ts: number;
  /** 是否成功 */
  ok: boolean;
  /** 缓存的响应数据 */
  payload: unknown;
  /** 缓存的错误（如果失败） */
  error?: unknown;
};

export type DedupeMap = Map<string, DedupeEntry>;

/**
 * 写入幂等缓存
 * TTL 默认 5 分钟，超时自动清理（生产实现可以用 LRU cache）
 */
export function setDedupeEntry(
  dedupe: DedupeMap,
  key: string,
  entry: DedupeEntry,
  ttlMs = 5 * 60 * 1000,
): void {
  dedupe.set(key, entry);
  // 简单 TTL：设置后超时自动删除
  setTimeout(() => {
    dedupe.delete(key);
  }, ttlMs);
}

// ─── 正在运行的 Agent Run ─────────────────────────────────────────────────────

export type ActiveRun = {
  /** 取消控制器：调用 abort() 可以终止这个 run */
  abort: AbortController;
  /** 关联的 session key */
  sessionKey: string;
  /** run 开始时间 */
  startedAt: number;
};

// ─── 主状态容器 ───────────────────────────────────────────────────────────────

/**
 * Gateway 运行时状态容器
 *
 * 在 server.ts 里创建，然后注入给所有 method handler。
 * 没有任何全局变量——所有状态都在这里。
 */
export type GatewayRuntimeState = {
  /**
   * 事件广播器
   * 用于向连接的客户端推送 Gateway 事件
   */
  broadcaster: EventBroadcaster;

  /**
   * 幂等去重 map
   * key 格式：`agent:<idempotencyKey>`
   */
  dedupe: DedupeMap;

  /**
   * 正在执行的 agent run
   * key 是 runId，value 包含 AbortController 和 sessionKey
   */
  activeRuns: Map<string, ActiveRun>;

  /**
   * 订阅了 session 事件的连接 ID
   * 当 session 状态变化时，广播给这些连接
   */
  sessionSubscribers: Set<string>;
};

/**
 * 创建初始的 Gateway 运行时状态
 * 在 Gateway 启动时调用一次
 */
export function createGatewayRuntimeState(): GatewayRuntimeState {
  return {
    broadcaster: createEventBroadcaster(),
    dedupe: new Map(),
    activeRuns: new Map(),
    sessionSubscribers: new Set(),
  };
}

// ─── 辅助函数 ─────────────────────────────────────────────────────────────────

/**
 * 广播 sessions.changed 事件给所有订阅了 session 事件的客户端
 *
 * 这个函数在每次 session 状态变化（发消息、执行完成、重置等）时调用，
 * 让 Web UI / macOS App 实时更新会话列表。
 */
export function broadcastSessionsChanged(
  state: GatewayRuntimeState,
  payload: SessionsChangedEvent,
): void {
  if (state.sessionSubscribers.size === 0) return;

  state.broadcaster.broadcast(
    "sessions.changed",
    payload,
    state.sessionSubscribers,
  );
}

/**
 * 注册一个正在进行的 agent run
 */
export function registerActiveRun(
  state: GatewayRuntimeState,
  runId: string,
  run: ActiveRun,
): void {
  state.activeRuns.set(runId, run);
}

/**
 * 完成一个 agent run（成功或失败都要调用）
 */
export function completeActiveRun(
  state: GatewayRuntimeState,
  runId: string,
): void {
  state.activeRuns.delete(runId);
}

/**
 * methods/agent.ts — "agent" RPC 方法实现
 *
 * 【这是整个 Gateway 最重要的方法】
 *
 * 它展示了 Gateway 最核心的设计模式：
 *   "立即 accepted + 异步执行 + 幂等保护 + 事件广播"
 *
 * 完整流程：
 * 1. 校验请求参数
 * 2. 检查幂等缓存（同一 idempotencyKey 只执行一次）
 * 3. 加载/创建 session
 * 4. 立即回复 { status: "accepted", runId }（不等 LLM）
 * 5. 注册 activeRun（用于取消、状态查询）
 * 6. 广播 sessions.changed（让 UI 知道有新消息进来）
 * 7. 异步执行 agent turn（调用 LLM）
 * 8. 执行完成后缓存结果到 dedupe，再次广播 sessions.changed
 */

import { randomUUID } from "node:crypto";
import {
  makeError,
  validateAgentParams,
  type AgentAcceptedResult,
  type AgentCompletedResult,
} from "../protocol.js";
import {
  setDedupeEntry,
  registerActiveRun,
  completeActiveRun,
  broadcastSessionsChanged,
} from "../runtime-state.js";
import { getOrCreateSession, updateSessionEntry } from "../sessions.js";
import { runAgentTurn } from "../agent-runner.js";
import type { MethodHandler } from "../method-router.js";

/**
 * "agent" 方法 handler
 *
 * 调用方式：
 * {
 *   "id": "req-001",
 *   "method": "agent",
 *   "params": {
 *     "message": "你好！",
 *     "sessionKey": "default/main",
 *     "idempotencyKey": "idem-xxx",
 *     "model": "gpt-4o"  // 可选
 *   }
 * }
 */
export const agentHandler: MethodHandler = async ({ request, respond, client, state }) => {
  const params = request.params;

  // ── Step 1：校验参数 ─────────────────────────────────────────────
  if (!validateAgentParams(params)) {
    respond(
      false,
      undefined,
      makeError(
        "INVALID_REQUEST",
        "参数无效：需要 message（非空字符串）和 idempotencyKey（非空字符串）",
      ),
    );
    return;
  }

  const {
    message,
    sessionKey: requestedSessionKey,
    idempotencyKey,
    agentId,
    provider,
    model,
    timeout,
  } = params;

  // ── Step 2：权限检查（model/provider 覆盖需要 admin 权限）───────
  const isAdmin = client.scopes.includes("admin");
  if ((provider || model) && !isAdmin) {
    respond(
      false,
      undefined,
      makeError("UNAUTHORIZED", "覆盖 provider/model 需要 admin 权限"),
    );
    return;
  }

  // ── Step 3：幂等检查 ─────────────────────────────────────────────
  // 如果同一个 idempotencyKey 已经执行过，直接返回缓存的结果
  const dedupeKey = `agent:${idempotencyKey}`;
  const cached = state.dedupe.get(dedupeKey);
  if (cached) {
    console.log(`[agent] 幂等命中: ${idempotencyKey}`);
    respond(cached.ok, cached.payload, cached.error as ReturnType<typeof makeError> | undefined);
    return;
  }

  // ── Step 4：确定 session key ──────────────────────────────────────
  // 如果没有指定 sessionKey，使用默认全局 session
  const sessionKey = requestedSessionKey ?? `${agentId ?? "default"}/main`;

  // ── Step 5：加载或创建 session ───────────────────────────────────
  const { entry: sessionEntry, isNew } = await getOrCreateSession(sessionKey, {
    lastChannel: "gateway",
  });

  // ── Step 6：立即回复 accepted ─────────────────────────────────────
  // ⚠️ 关键：不等 LLM 执行，立即告诉客户端请求已接受
  // 客户端通过 agent.wait 或监听 sessions.changed 事件来知道结果
  const runId = idempotencyKey;
  const acceptedResult: AgentAcceptedResult = {
    runId,
    status: "accepted",
    acceptedAt: Date.now(),
  };

  // 写入 dedupe（in-flight ack），防止 retry 启动第二个 run
  setDedupeEntry(state.dedupe, dedupeKey, {
    ts: Date.now(),
    ok: true,
    payload: acceptedResult,
  });

  respond(true, acceptedResult);

  // ── Step 7：广播 sessions.changed ───────────────────────────────
  if (isNew) {
    broadcastSessionsChanged(state, {
      sessionKey,
      reason: "create",
      ts: Date.now(),
      sessionId: sessionEntry.sessionId,
    });
  }

  broadcastSessionsChanged(state, {
    sessionKey,
    reason: "send",
    ts: Date.now(),
    sessionId: sessionEntry.sessionId,
  });

  // ── Step 8：异步执行 agent turn ──────────────────────────────────
  const abortController = new AbortController();
  const timeoutMs = timeout ? timeout * 1000 : 5 * 60 * 1000; // 默认 5 分钟超时

  // 注册到 activeRuns（可以通过 runId 查询状态或取消）
  registerActiveRun(state, runId, {
    abort: abortController,
    sessionKey,
    startedAt: Date.now(),
  });

  // 超时自动取消
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      abortController.abort();
    }, timeoutMs);
  }

  // 异步执行（不 await，让方法立即返回）
  void runAgentTurn(
    {
      runId,
      message,
      sessionKey,
      sessionEntry,
      provider,
      model,
      timeoutMs,
      signal: abortController.signal,
      // 流式输出：把每个 delta 广播给客户端
      onDelta: (text) => {
        state.broadcaster.broadcast("agent.delta", {
          runId,
          sessionKey,
          text,  // 注意：是累积文本，不是 delta
        });
      },
    },
    state,
  )
    .then((result) => {
      // ── 执行成功 ────────────────────────────────────────────────
      const completedResult: AgentCompletedResult = {
        runId,
        status: "ok",
        summary: "completed",
        reply: result.reply,
      };

      // 更新 dedupe 为最终结果
      setDedupeEntry(state.dedupe, dedupeKey, {
        ts: Date.now(),
        ok: true,
        payload: completedResult,
      });

      // 发送第二个 Response 帧（客户端可以通过 agent.wait 等待这个）
      respond(true, completedResult);

      console.log(`[agent] run=${runId} 成功完成，回复: ${result.reply.slice(0, 50)}...`);
    })
    .catch((err) => {
      // ── 执行失败 ────────────────────────────────────────────────
      const error = makeError("UNAVAILABLE", String(err));
      const failedResult: AgentCompletedResult = {
        runId,
        status: "error",
        summary: String(err),
      };

      setDedupeEntry(state.dedupe, dedupeKey, {
        ts: Date.now(),
        ok: false,
        payload: failedResult,
        error,
      });

      respond(false, failedResult, error);

      console.error(`[agent] run=${runId} 执行失败:`, err);
    })
    .finally(() => {
      // ── 清理 ────────────────────────────────────────────────────
      if (timeoutHandle) clearTimeout(timeoutHandle);
      completeActiveRun(state, runId);
    });
};

/**
 * "agent.status" 方法：查询一个 run 的当前状态
 */
export const agentStatusHandler: MethodHandler = ({ request, respond, state }) => {
  const params = request.params as Record<string, unknown>;
  const runId = typeof params?.runId === "string" ? params.runId.trim() : "";

  if (!runId) {
    respond(false, undefined, makeError("INVALID_REQUEST", "runId 是必填项"));
    return;
  }

  const activeRun = state.activeRuns.get(runId);

  if (activeRun) {
    respond(true, {
      runId,
      status: "running",
      sessionKey: activeRun.sessionKey,
      startedAt: activeRun.startedAt,
      runningForMs: Date.now() - activeRun.startedAt,
    });
    return;
  }

  const cached = state.dedupe.get(`agent:${runId}`);
  if (cached) {
    respond(true, {
      runId,
      status: cached.ok ? "completed" : "failed",
      ...cached.payload as object,
    });
    return;
  }

  respond(false, undefined, makeError("NOT_FOUND", `找不到 run: ${runId}`));
};

/**
 * "agent.cancel" 方法：取消一个正在运行的 run
 */
export const agentCancelHandler: MethodHandler = ({ request, respond, client, state }) => {
  // 取消需要 admin 权限
  if (!client.scopes.includes("admin")) {
    respond(false, undefined, makeError("UNAUTHORIZED", "取消 run 需要 admin 权限"));
    return;
  }

  const params = request.params as Record<string, unknown>;
  const runId = typeof params?.runId === "string" ? params.runId.trim() : "";

  if (!runId) {
    respond(false, undefined, makeError("INVALID_REQUEST", "runId 是必填项"));
    return;
  }

  const activeRun = state.activeRuns.get(runId);
  if (!activeRun) {
    respond(false, undefined, makeError("NOT_FOUND", `没有找到正在运行的 run: ${runId}`));
    return;
  }

  activeRun.abort.abort();
  respond(true, { runId, status: "cancelling" });
};

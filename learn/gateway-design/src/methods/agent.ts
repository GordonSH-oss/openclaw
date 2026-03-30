import { runLearningAgentCommand } from "../../../agent-design/src/index.js";
import {
  makeError,
  validateAgentParams,
  validateAgentWaitParams,
  type AgentAcceptedResult,
  type AgentCompletedResult,
  type ConnectedClient,
  type GatewayError,
} from "../protocol/index.js";
import {
  setDedupeEntry,
  broadcastSessionsChanged,
  broadcastSessionMessage,
  type GatewayRuntimeState,
} from "../server-runtime-state.js";
import { completeChatRun, registerChatRun } from "../server-chat.js";
import {
  getOrCreateSession,
  updateSessionEntry,
  resolveGatewayAgentDataDir,
} from "../session-store.js";
import type { MethodHandler } from "../method-router.js";

export function launchGatewayAgentRun(params: {
  state: GatewayRuntimeState;
  message: string;
  sessionKey: string;
  sessionId: string;
  runId: string;
  requestId?: string;
  client?: ConnectedClient;
  provider?: string;
  model?: string;
  backend?: "embedded" | "cli";
  timeout?: number;
  respond?: (ok: boolean, result?: unknown, error?: GatewayError) => void;
}) {
  const accepted: AgentAcceptedResult = {
    runId: params.runId,
    status: "accepted",
    acceptedAt: Date.now(),
  };
  const abort = new AbortController();
  const handle = runLearningAgentCommand({
    runId: params.runId,
    message: params.message,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
    dataDir: resolveGatewayAgentDataDir(),
    provider: params.provider,
    model: params.model,
    backend: params.backend,
    timeoutMs: params.timeout ? params.timeout * 1000 : undefined,
    signal: abort.signal,
    onEvent: (event) => {
      if (event.type === "delta") {
        params.state.broadcaster.broadcast("agent.delta", {
          runId: params.runId,
          sessionKey: params.sessionKey,
          text: event.text,
          delta: event.delta,
        });
        return;
      }
      if (event.type === "transcript.message") {
        broadcastSessionMessage(params.state, params.sessionKey, event.message);
      }
    },
  });
  const completion = handle.completion.then(
    (result): AgentCompletedResult => ({
      runId: result.runId,
      status: result.status,
      summary: result.summary,
      reply: result.reply,
    }),
  );
  registerChatRun(params.state.chat, {
    runId: params.runId,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
    startedAt: Date.now(),
    requestId: params.requestId,
    client: params.client,
    abort,
    completion,
  });
  return {
    accepted,
    completion,
    abort,
  };
}

export const agentHandler: MethodHandler = async ({ request, respond, client, state }) => {
  const params = request.params;
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
    backend,
  } = params;

  if ((provider || model) && !client.scopes.includes("admin")) {
    respond(false, undefined, makeError("UNAUTHORIZED", "覆盖 provider/model 需要 admin 权限"));
    return;
  }

  const dedupeKey = `agent:${idempotencyKey}`;
  const cached = state.dedupe.get(dedupeKey);
  if (cached) {
    respond(cached.ok, cached.payload, cached.error as GatewayError | undefined);
    return;
  }

  const sessionKey = requestedSessionKey ?? `${agentId ?? "default"}/main`;
  const { entry: sessionEntry, isNew } = await getOrCreateSession(sessionKey, {
    lastChannel: "gateway",
  });
  const runId = idempotencyKey;
  const launch = launchGatewayAgentRun({
    state,
    message,
    sessionKey,
    sessionId: sessionEntry.sessionId,
    runId,
    requestId: request.id,
    client,
    provider,
    model,
    backend: backend === "cli" ? "cli" : "embedded",
    timeout,
    respond,
  });
  setDedupeEntry(state.dedupe, dedupeKey, {
    ts: Date.now(),
    ok: true,
    payload: launch.accepted,
  });
  respond(true, launch.accepted);

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
    status: "running",
  });

  void launch.completion.then(async (terminal) => {
    completeChatRun(state.chat, runId, terminal);
    await updateSessionEntry(sessionKey, (current) => ({
      ...(current ?? sessionEntry),
      status: terminal.status === "ok" ? "idle" : "error",
      endedAt: Date.now(),
      updatedAt: Date.now(),
      model: model ?? current?.model,
    }));
    setDedupeEntry(state.dedupe, dedupeKey, {
      ts: Date.now(),
      ok: terminal.status !== "error",
      payload: terminal,
      error:
        terminal.status === "error"
          ? makeError("UNAVAILABLE", terminal.summary)
          : undefined,
    });
    broadcastSessionsChanged(state, {
      sessionKey,
      reason:
        terminal.status === "cancelled"
          ? "cancel"
          : terminal.status === "ok"
            ? "complete"
            : "error",
      ts: Date.now(),
      sessionId: sessionEntry.sessionId,
      status: terminal.status === "ok" ? "idle" : "error",
      updatedAt: Date.now(),
    });
    respond(
      terminal.status === "error" ? false : true,
      terminal,
      terminal.status === "error"
        ? makeError("UNAVAILABLE", terminal.summary)
        : undefined,
    );
  });
};

export const agentStatusHandler: MethodHandler = ({ request, respond, state }) => {
  const params = request.params as Record<string, unknown>;
  const runId = typeof params?.runId === "string" ? params.runId.trim() : "";
  if (!runId) {
    respond(false, undefined, makeError("INVALID_REQUEST", "runId 是必填项"));
    return;
  }
  const activeRun = state.chat.activeRuns.get(runId);
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
  const terminal = state.chat.terminalRuns.get(runId);
  if (terminal) {
    respond(true, terminal);
    return;
  }
  respond(false, undefined, makeError("NOT_FOUND", `找不到 run: ${runId}`));
};

export const agentWaitHandler: MethodHandler = async ({ request, respond, state }) => {
  if (!validateAgentWaitParams(request.params)) {
    respond(false, undefined, makeError("INVALID_REQUEST", "runId 是必填项"));
    return;
  }
  const { runId, timeoutMs } = request.params;
  const terminal = state.chat.terminalRuns.get(runId);
  if (terminal) {
    respond(true, terminal);
    return;
  }
  const active = state.chat.activeRuns.get(runId);
  if (!active) {
    respond(false, undefined, makeError("NOT_FOUND", `找不到 run: ${runId}`));
    return;
  }
  const winner = await Promise.race([
    active.completion,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs ?? 5_000);
    }),
  ]);
  if (!winner) {
    respond(false, undefined, makeError("TIMEOUT", `等待 run ${runId} 超时`));
    return;
  }
  respond(true, winner);
};

export const agentCancelHandler: MethodHandler = ({ request, respond, state }) => {
  const params = request.params as Record<string, unknown>;
  const runId = typeof params?.runId === "string" ? params.runId.trim() : "";
  if (!runId) {
    respond(false, undefined, makeError("INVALID_REQUEST", "runId 是必填项"));
    return;
  }
  const active = state.chat.activeRuns.get(runId);
  if (!active) {
    respond(false, undefined, makeError("NOT_FOUND", `找不到 run: ${runId}`));
    return;
  }
  active.abort.abort();
  respond(true, {
    runId,
    status: "cancel_requested",
    sessionKey: active.sessionKey,
  });
};

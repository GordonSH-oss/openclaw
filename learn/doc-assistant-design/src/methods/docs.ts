import { isTerminalResultCacheable } from "../answer-cache-policy.js";
import {
  approveAnswerMemoryEntry,
  enqueueGeneratedAnswerMemory,
  getAnswerMemoryCounts,
  getAnswerMemoryEntry,
  listAnswerMemory,
  rejectAnswerMemoryEntry,
  updateAnswerMemoryEntry,
} from "../answer-memory.js";
import { buildTerminalResult } from "../doc-answer.js";
import { searchDocs, toCitation } from "../doc-search.js";
import { updateClarificationStateAfterAnswer } from "../follow-up-context.js";
import type { MethodHandler } from "../method-router.js";
import {
  validateDocsAdminMemoryApproveParams,
  validateDocsAdminMemoryGetParams,
  validateDocsAdminMemoryListParams,
  validateDocsAdminMemoryRejectParams,
  validateDocsAdminMemoryUpdateParams,
  makeError,
  validateDocsAskParams,
  validateDocsHistoryListParams,
  validateDocsRunStatusParams,
  validateDocsRunWaitParams,
  validateDocsSearchPreviewParams,
  validateDocsTranscriptParams,
  validateDocsUserCreateParams,
  type ConnectedClient,
  type DocAssistantError,
  type DocsAcceptedResult,
  type DocsTerminalResult,
} from "../protocol/index.js";
import { executeDocQuestion } from "../question-execution.js";
import {
  appendQuestionHistoryEntry,
  sanitizeHistoryDebugAnswers,
  loadQuestionHistory,
  sanitizeHistoryTaskFrame,
} from "../question-history.js";
import {
  completeDocRun,
  registerDocRun,
  setDedupeEntry,
  type DocAssistantRuntimeState,
} from "../server-runtime-state.js";
import {
  getOrCreateSession,
  loadSessionStore,
  updateSessionEntry,
  type SessionEntry,
} from "../session-store.js";
import {
  appendDocAssistantTranscriptMessage,
  loadDocAssistantTranscript,
} from "../transcript-store.js";
import { createTempDocUser, getTempDocUser, loadDocUserStore } from "../user-store.js";

function resolveTargetConnIds(
  state: DocAssistantRuntimeState,
  client: ConnectedClient,
): Set<string> | undefined {
  const clientId = client.connect.clientId?.trim();
  if (clientId) {
    const connIds = state.broadcaster.getConnIdsForClientId(clientId);
    if (connIds.size > 0) {
      return connIds;
    }
  }
  if (client.connId) {
    return new Set([client.connId]);
  }
  return undefined;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

async function launchDocAssistantRun(params: {
  state: DocAssistantRuntimeState;
  client: ConnectedClient;
  userId: string;
  sessionKey: string;
  sessionEntry: SessionEntry;
  displayLabel?: string;
  question: string;
  runId: string;
  mode: "extractive" | "agent";
  maxResults?: number;
  backend?: "embedded" | "cli";
  provider?: string;
  model?: string;
}): Promise<{ accepted: DocsAcceptedResult; completion: Promise<DocsTerminalResult> }> {
  const accepted: DocsAcceptedResult = {
    runId: params.runId,
    status: "accepted",
    acceptedAt: Date.now(),
  };
  const targetConnIds = resolveTargetConnIds(params.state, params.client);

  await updateSessionEntry(
    params.sessionKey,
    {
      status: "running",
      startedAt: Date.now(),
      updatedAt: Date.now(),
    },
    params.state.config.dataDir,
  );

  const completion = (async (): Promise<DocsTerminalResult> => {
    await appendDocAssistantTranscriptMessage({
      sessionId: params.sessionEntry.sessionId,
      dataDir: params.state.config.dataDir,
      message: {
        role: "user",
        content: params.question,
        timestamp: Date.now(),
      },
    });

    try {
      const execution = await executeDocQuestion({
        runId: params.runId,
        question: params.question,
        sessionId: params.sessionEntry.sessionId,
        mode: params.mode,
        docsRoot: params.state.config.docsRoot,
        dataDir: params.state.config.dataDir,
        maxResults: params.maxResults,
        backend: params.backend,
        provider: params.provider,
        model: params.model,
        openAICompatible: params.state.config.defaultAgentConfig?.openAICompatible,
        onRetrieved: async (hits) => {
          params.state.broadcaster.broadcast(
            "docs.retrieval",
            {
              runId: params.runId,
              userId: params.userId,
              hits: hits.map((hit) => ({
                ...toCitation(hit),
                score: hit.score,
              })),
            },
            targetConnIds,
          );
        },
        onDelta:
          params.mode === "agent"
            ? (delta) => {
                params.state.broadcaster.broadcast(
                  "docs.delta",
                  {
                    runId: params.runId,
                    userId: params.userId,
                    text: delta.text,
                    delta: delta.delta,
                  },
                  targetConnIds,
                );
              }
            : undefined,
      });
      const answer = execution.answer;
      await updateClarificationStateAfterAnswer({
        sessionId: params.sessionEntry.sessionId,
        runId: params.runId,
        question: params.question,
        hits: execution.hits,
        summary: answer.summary,
        pendingQuestion: answer.pendingClarificationQuestion,
        clarificationKind: answer.pendingClarificationKind,
        clarificationHits: answer.clarificationHits,
        route: execution.route,
        dataDir: params.state.config.dataDir,
      });

      await appendDocAssistantTranscriptMessage({
        sessionId: params.sessionEntry.sessionId,
        dataDir: params.state.config.dataDir,
        message: {
          role: "assistant",
          content: answer.answer,
          timestamp: Date.now(),
          model: answer.selectedModel,
          usage: {
            inputTokens: estimateTokens(params.question),
            outputTokens: estimateTokens(answer.answer),
          },
        },
      });

      const terminal = buildTerminalResult({
        runId: params.runId,
        result: answer,
      });
      if (isTerminalResultCacheable(terminal)) {
        const memoryEntry = await enqueueGeneratedAnswerMemory({
          dataDir: params.state.config.dataDir,
          question: terminal.rewrittenQuestion ?? params.question,
          terminal,
          mode: params.mode,
        });
        terminal.memoryEntryId = memoryEntry.entryId;
        terminal.reviewStatus = "pending_review";
      }
      return terminal;
    } catch (error) {
      const fallbackAnswer = `文档助手执行失败：${String(error)}`;
      await appendDocAssistantTranscriptMessage({
        sessionId: params.sessionEntry.sessionId,
        dataDir: params.state.config.dataDir,
        message: {
          role: "assistant",
          content: fallbackAnswer,
          timestamp: Date.now(),
        },
      });
      return {
        runId: params.runId,
        status: "error",
        mode: params.mode,
        answer: fallbackAnswer,
        summary: String(error),
        citations: [],
      };
    }
  })();

  registerDocRun(params.state.runs, {
    runId: params.runId,
    userId: params.userId,
    sessionKey: params.sessionKey,
    sessionId: params.sessionEntry.sessionId,
    question: params.question,
    mode: params.mode,
    startedAt: Date.now(),
    connId: params.client.connId,
    completion,
  });

  void completion.then(async (terminal) => {
    completeDocRun(params.state.runs, params.runId, terminal);
    setDedupeEntry(params.state.dedupe, `docs.ask:${params.userId}:${params.runId}`, {
      ts: Date.now(),
      ok: terminal.status !== "error",
      payload: terminal,
      error: terminal.status === "error" ? makeError("UNAVAILABLE", terminal.summary) : undefined,
    });
    await updateSessionEntry(
      params.sessionKey,
      (current) => ({
        ...(current ?? params.sessionEntry),
        status: terminal.status === "ok" ? "idle" : "error",
        endedAt: Date.now(),
        updatedAt: Date.now(),
        model: terminal.selectedModel ?? current?.model,
        provider: terminal.selectedProvider ?? current?.provider,
        inputTokens: (current?.inputTokens ?? 0) + estimateTokens(params.question),
        outputTokens: (current?.outputTokens ?? 0) + estimateTokens(terminal.answer),
      }),
      params.state.config.dataDir,
    );
    try {
      await appendQuestionHistoryEntry({
        dataDir: params.state.config.dataDir,
        entry: {
          runId: params.runId,
          userId: params.userId,
          sessionKey: params.sessionKey,
          displayLabel: params.displayLabel,
          question: params.question,
          mode: params.mode,
          askedAt: accepted.acceptedAt,
          completedAt: Date.now(),
          terminalStatus: terminal.status,
          summary: terminal.summary,
          citationCount: terminal.citations.length,
          selectedProvider: terminal.selectedProvider,
          selectedModel: terminal.selectedModel,
          answer: terminal.answer,
          answerSource: terminal.answerSource,
          answerSurface: terminal.answerSurface,
          reviewStatus: terminal.reviewStatus,
          memoryEntryId: terminal.memoryEntryId,
          followUpSource: terminal.followUpSource,
          continuedFromRunId: terminal.continuedFromRunId,
          rewrittenQuestion: terminal.rewrittenQuestion,
          taskFrame: sanitizeHistoryTaskFrame(terminal.trace?.taskFrame),
          debugAnswers: sanitizeHistoryDebugAnswers(terminal.trace?.["debugAnswers"]),
        },
      });
    } catch (error) {
      console.error("[doc-assistant] failed to append question history", error);
    }
    params.state.broadcaster.broadcast("docs.completed", terminal, targetConnIds);
  });

  return { accepted, completion };
}

export const docsUserCreateHandler: MethodHandler = async ({ request, respond, state }) => {
  if (!validateDocsUserCreateParams(request.params)) {
    respond(false, undefined, makeError("INVALID_REQUEST", "displayLabel 必须是字符串"));
    return;
  }
  const params = request.params ?? {};
  const user = await createTempDocUser({
    dataDir: state.config.dataDir,
    displayLabel:
      typeof params === "object" && params !== null && "displayLabel" in params
        ? typeof params.displayLabel === "string"
          ? params.displayLabel
          : undefined
        : undefined,
  });
  await getOrCreateSession(
    user.sessionKey,
    {
      lastChannel: "doc-assistant",
    },
    state.config.dataDir,
  );
  respond(true, user);
};

export const docsAskHandler: MethodHandler = async ({ request, respond, client, state }) => {
  if (!validateDocsAskParams(request.params)) {
    respond(
      false,
      undefined,
      makeError(
        "INVALID_REQUEST",
        "参数无效：需要 userId、question、idempotencyKey，mode 只能是 extractive/agent",
      ),
    );
    return;
  }

  const params = request.params;
  if ((params.provider || params.model) && !client.scopes.includes("admin")) {
    respond(false, undefined, makeError("UNAUTHORIZED", "覆盖 provider/model 需要 admin 权限"));
    return;
  }

  const user = await getTempDocUser(params.userId, state.config.dataDir);
  if (!user) {
    respond(false, undefined, makeError("NOT_FOUND", `找不到 temp user: ${params.userId}`));
    return;
  }

  const dedupeKey = `docs.ask:${params.userId}:${params.idempotencyKey}`;
  const cached = state.dedupe.get(dedupeKey);
  if (cached) {
    respond(cached.ok, cached.payload, cached.error as DocAssistantError | undefined);
    return;
  }

  const { entry: sessionEntry } = await getOrCreateSession(
    user.sessionKey,
    {
      lastChannel: "doc-assistant",
    },
    state.config.dataDir,
  );
  const runId = params.idempotencyKey;
  const mode = params.mode ?? state.config.defaultMode;
  const run = await launchDocAssistantRun({
    state,
    client,
    userId: params.userId,
    sessionKey: user.sessionKey,
    sessionEntry,
    displayLabel: user.displayLabel,
    question: params.question,
    runId,
    mode,
    maxResults: params.maxResults,
    backend: params.backend ?? state.config.defaultAgentConfig?.backend,
    provider: params.provider ?? state.config.defaultAgentConfig?.provider,
    model: params.model ?? state.config.defaultAgentConfig?.model,
  });
  setDedupeEntry(state.dedupe, dedupeKey, {
    ts: Date.now(),
    ok: true,
    payload: run.accepted,
  });
  respond(true, run.accepted);
};

export const docsRunStatusHandler: MethodHandler = ({ request, respond, state }) => {
  if (!validateDocsRunStatusParams(request.params)) {
    respond(false, undefined, makeError("INVALID_REQUEST", "runId 是必填项"));
    return;
  }
  const active = state.runs.activeRuns.get(request.params.runId);
  if (active) {
    respond(true, {
      runId: active.runId,
      status: "running",
      mode: active.mode,
      userId: active.userId,
      sessionKey: active.sessionKey,
      startedAt: active.startedAt,
      runningForMs: Date.now() - active.startedAt,
    });
    return;
  }
  const terminal = state.runs.terminalRuns.get(request.params.runId);
  if (terminal) {
    respond(true, terminal);
    return;
  }
  respond(false, undefined, makeError("NOT_FOUND", `找不到 run: ${request.params.runId}`));
};

export const docsRunWaitHandler: MethodHandler = async ({ request, respond, state }) => {
  if (!validateDocsRunWaitParams(request.params)) {
    respond(false, undefined, makeError("INVALID_REQUEST", "runId 是必填项"));
    return;
  }
  const params = request.params;
  const terminal = state.runs.terminalRuns.get(params.runId);
  if (terminal) {
    respond(true, terminal);
    return;
  }
  const active = state.runs.activeRuns.get(params.runId);
  if (!active) {
    respond(false, undefined, makeError("NOT_FOUND", `找不到 run: ${params.runId}`));
    return;
  }
  const winner = await Promise.race([
    active.completion,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), params.timeoutMs ?? 5_000);
    }),
  ]);
  if (!winner) {
    respond(false, undefined, makeError("TIMEOUT", `等待 run ${params.runId} 超时`));
    return;
  }
  respond(true, winner);
};

export const docsTranscriptGetHandler: MethodHandler = async ({ request, respond, state }) => {
  if (!validateDocsTranscriptParams(request.params)) {
    respond(false, undefined, makeError("INVALID_REQUEST", "userId 是必填项"));
    return;
  }
  const user = await getTempDocUser(request.params.userId, state.config.dataDir);
  if (!user) {
    respond(false, undefined, makeError("NOT_FOUND", `找不到 temp user: ${request.params.userId}`));
    return;
  }
  const sessions = await loadSessionStore(state.config.dataDir);
  const entry = sessions[user.sessionKey];
  if (!entry) {
    respond(false, undefined, makeError("NOT_FOUND", `找不到 session: ${user.sessionKey}`));
    return;
  }
  const messages = await loadDocAssistantTranscript(entry.sessionId, state.config.dataDir);
  respond(true, {
    userId: user.userId,
    sessionKey: user.sessionKey,
    sessionId: entry.sessionId,
    messages,
  });
};

export const docsSearchPreviewHandler: MethodHandler = async ({ request, respond, state }) => {
  if (!validateDocsSearchPreviewParams(request.params)) {
    respond(false, undefined, makeError("INVALID_REQUEST", "query 是必填项"));
    return;
  }
  const params = request.params;
  const hits = await searchDocs({
    query: params.query,
    docsRoot: state.config.docsRoot,
    dataDir: state.config.dataDir,
    maxResults: params.maxResults,
  });
  respond(true, {
    query: params.query,
    hits: hits.map((hit) => ({
      ...toCitation(hit),
      score: hit.score,
    })),
  });
};

export const docsHistoryListHandler: MethodHandler = async ({ request, respond, state }) => {
  if (!validateDocsHistoryListParams(request.params)) {
    respond(false, undefined, makeError("INVALID_REQUEST", "history 参数无效"));
    return;
  }
  const params = request.params ?? {};
  const entries = await loadQuestionHistory({
    dataDir: state.config.dataDir,
    userId: params.userId,
    answered: params.answered,
    limit: params.limit,
  });
  respond(true, {
    entries,
    total: entries.length,
  });
};

export const docsAdminMemoryListHandler: MethodHandler = async ({ request, respond, state }) => {
  if (!validateDocsAdminMemoryListParams(request.params)) {
    respond(false, undefined, makeError("INVALID_REQUEST", "memory list 参数无效"));
    return;
  }
  const params = request.params ?? {};
  const entries = await listAnswerMemory({
    dataDir: state.config.dataDir,
    status: params.status,
    query: params.query,
    limit: params.limit,
  });
  respond(true, {
    entries,
    total: entries.length,
  });
};

export const docsAdminMemoryGetHandler: MethodHandler = async ({ request, respond, state }) => {
  if (!validateDocsAdminMemoryGetParams(request.params)) {
    respond(false, undefined, makeError("INVALID_REQUEST", "entryId 是必填项"));
    return;
  }
  const entry = await getAnswerMemoryEntry(request.params.entryId, state.config.dataDir);
  if (!entry) {
    respond(
      false,
      undefined,
      makeError("NOT_FOUND", `找不到 memory entry: ${request.params.entryId}`),
    );
    return;
  }
  respond(true, entry);
};

export const docsAdminMemoryApproveHandler: MethodHandler = async ({ request, respond, state }) => {
  if (!validateDocsAdminMemoryApproveParams(request.params)) {
    respond(false, undefined, makeError("INVALID_REQUEST", "approve 参数无效"));
    return;
  }
  const entry = await approveAnswerMemoryEntry({
    ...request.params,
    dataDir: state.config.dataDir,
  });
  if (!entry) {
    respond(
      false,
      undefined,
      makeError("NOT_FOUND", `找不到 memory entry: ${request.params.entryId}`),
    );
    return;
  }
  respond(true, entry);
};

export const docsAdminMemoryRejectHandler: MethodHandler = async ({ request, respond, state }) => {
  if (!validateDocsAdminMemoryRejectParams(request.params)) {
    respond(false, undefined, makeError("INVALID_REQUEST", "reject 参数无效"));
    return;
  }
  const entry = await rejectAnswerMemoryEntry({
    ...request.params,
    dataDir: state.config.dataDir,
  });
  if (!entry) {
    respond(
      false,
      undefined,
      makeError("NOT_FOUND", `找不到 memory entry: ${request.params.entryId}`),
    );
    return;
  }
  respond(true, entry);
};

export const docsAdminMemoryUpdateHandler: MethodHandler = async ({ request, respond, state }) => {
  if (!validateDocsAdminMemoryUpdateParams(request.params)) {
    respond(false, undefined, makeError("INVALID_REQUEST", "update 参数无效"));
    return;
  }
  const entry = await updateAnswerMemoryEntry({
    ...request.params,
    dataDir: state.config.dataDir,
  });
  if (!entry) {
    respond(
      false,
      undefined,
      makeError("NOT_FOUND", `找不到 memory entry: ${request.params.entryId}`),
    );
    return;
  }
  respond(true, entry);
};

export const docsMethodsHandler: MethodHandler = ({ respond }) => {
  respond(true, {
    methods: [
      { method: "docs.user.create", description: "创建一个临时文档助手 user" },
      { method: "docs.ask", description: "发起一次文档检索和回答 run" },
      { method: "docs.run.status", description: "查询 run 当前状态" },
      { method: "docs.run.wait", description: "等待 run 完成" },
      { method: "docs.session.transcript.get", description: "读取某个 temp user 的 transcript" },
      { method: "docs.history.list", description: "查看历史提问与是否答上" },
      { method: "docs.search.preview", description: "仅执行文档检索，不生成回答" },
      { method: "docs.admin.memory.list", description: "管理员查看 memory / review 队列" },
      { method: "docs.admin.memory.get", description: "管理员读取单条 memory entry" },
      { method: "docs.admin.memory.approve", description: "管理员审批并发布标准答案" },
      { method: "docs.admin.memory.reject", description: "管理员驳回 memory entry" },
      { method: "docs.admin.memory.update", description: "管理员编辑待审核答案" },
      { method: "docs.methods", description: "列出所有文档助手方法" },
      { method: "docs.status", description: "查看文档助手当前运行状态" },
    ],
  });
};

export const docsStatusHandler: MethodHandler = async ({ respond, state }) => {
  const users = await loadDocUserStore(state.config.dataDir);
  const sessions = await loadSessionStore(state.config.dataDir);
  const history = await loadQuestionHistory({
    dataDir: state.config.dataDir,
    limit: Number.MAX_SAFE_INTEGER,
  });
  const memoryCounts = await getAnswerMemoryCounts(state.config.dataDir);
  respond(true, {
    status: "running",
    version: state.config.version,
    packageVersion: state.config.packageVersion,
    docsRoot: state.config.docsRoot,
    defaultMode: state.config.defaultMode,
    dataDir: state.config.dataDir,
    connections: state.broadcaster.getConnCount(),
    activeRuns: state.runs.activeRuns.size,
    terminalRuns: state.runs.terminalRuns.size,
    users: Object.keys(users).length,
    sessions: Object.keys(sessions).length,
    questionHistoryEntries: history.length,
    memoryEntries: memoryCounts.memoryEntries,
    pendingReviewEntries: memoryCounts.pendingReviewEntries,
    approvedStandardEntries: memoryCounts.approvedStandardEntries,
    uptime: process.uptime(),
    serverTime: Date.now(),
  });
};

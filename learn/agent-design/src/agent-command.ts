import {
  markAuthProfileFailure,
  markAuthProfileSuccess,
  resolveAuthProfileOrder,
} from "./auth-profiles/order.js";
import {
  clearSessionAuthProfileOverride,
  getSessionAuthProfileOverride,
} from "./auth-profiles/session-override.js";
import { loadAuthProfileStore, saveAuthProfileStore } from "./auth-profiles/store.js";
import { runLearningAgentAttempt } from "./command/attempt-execution.js";
import { resolveLearningRunContext } from "./command/run-context.js";
import { resolveLearningSession, updateLearningSession } from "./command/session.js";
import {
  resolveModelCandidates,
  runWithModelFallback,
  ModelFallbackError,
  ModelFallbackSummaryError,
} from "./model-fallback.js";
import { buildWorkspaceSkillSnapshot } from "./skills/workspace.js";
import type {
  AgentAcceptedResult,
  LearningAgentCommandParams,
  LearningAgentResult,
  LearningAgentRunHandle,
} from "./types.js";

/**
 * 这两个 map 模拟了 OpenClaw 里“Gateway / session 层可观测 agent run”的效果：
 *
 * - activeRuns: 当前仍在执行中的 run
 * - completedRuns: 已经进入终态，后续 wait/status 可以直接命中
 *
 * 学习时要注意，这里故意把“accepted”和“terminal result”分开保存，
 * 这样才能看清一次长任务为什么需要两段式语义。
 */
const activeRuns = new Map<string, Promise<LearningAgentResult>>();
const completedRuns = new Map<string, LearningAgentResult>();

/**
 * 这是 learning agent 的“真正执行入口”。
 *
 * 如果把整个 agent 看成一条流水线，这个函数主要做三件事：
 *
 * 1. 执行前准备
 *    - 校验输入
 *    - 解析 run context / session
 *    - 加载 auth profile、skills、model candidates
 * 2. 执行中编排
 *    - 用 fallback 包裹 attempt
 *    - 把单次 attempt 派发给 embedded / cli runner
 * 3. 执行后收尾
 *    - 更新 session 元数据
 *    - 写回 auth profile 状态
 *    - 产出 terminal result
 *
 * 这对应真实 OpenClaw `src/agents/agent-command.ts` 的角色：
 * 它不是复杂 runtime 本体，而是“把一次模糊请求收束成一次可执行计划”。
 */
async function executeLearningAgentRun(
  params: LearningAgentCommandParams,
): Promise<LearningAgentResult> {
  if (!params.message.trim()) {
    throw new Error("message is required");
  }
  if (!params.sessionKey.trim()) {
    throw new Error("sessionKey is required");
  }

  // Step 1: 把零散输入归一化成运行时真正使用的上下文。
  // 真正的 runner 不应该再关心默认值、路径归一化和 verbosity/thinking 缺省值。
  const runContext = resolveLearningRunContext(params);

  // Step 2: session 先被解析出来，后面的 transcript、usage、状态更新都围绕它进行。
  const session = await resolveLearningSession({
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
    dataDir: params.dataDir,
  });
  await updateLearningSession({
    sessionKey: params.sessionKey,
    dataDir: params.dataDir,
    update: {
      status: "running",
    },
  });
  params.onEvent?.({
    type: "status",
    runId: params.runId,
    phase: "started",
  });

  // Step 3: 先装配“支撑子系统”，再开始真正执行。
  //
  // 这里故意把 auth / skills / model candidates 都放在入口层，而不是埋进 runner：
  // 这样更容易看懂这些系统是“执行条件”，不是“具体执行算法”的一部分。
  const authStore = await loadAuthProfileStore(params.dataDir);
  const sessionOverride = getSessionAuthProfileOverride(params.sessionKey);
  const authOrder = resolveAuthProfileOrder({
    store: authStore,
    provider: params.provider ?? "mock",
    preferredProfile: params.preferredAuthProfile ?? sessionOverride,
  });
  const skillSnapshot = await buildWorkspaceSkillSnapshot({
    workspaceDir: runContext.workspaceDir,
    skillRoots: params.skillRoots,
  });
  const candidates = resolveModelCandidates({
    provider: params.provider,
    model: params.model,
  });

  try {
    // Step 4: fallback loop 是入口层最重要的“编排动作”之一。
    // runWithModelFallback 不知道 session、skills 的业务语义，只负责：
    // “候选怎么试、失败后是否换下一个候选、最终如何汇总尝试结果”。
    const fallbackResult = await runWithModelFallback({
      candidates,
      run: async (candidate, attempt) => {
        params.onEvent?.({
          type: "status",
          runId: params.runId,
          phase: "attempt",
        });
        try {
          // Step 5: 单次 attempt 在这里派发给具体后端。
          // 到这一层以后，runner 不再处理 auth 顺序或候选选择，只处理“这次怎么跑”。
          const result = await runLearningAgentAttempt({
            command: params,
            sessionId: session.sessionId,
            candidate,
            attempt,
            skillSnapshot,
          });

          // learning 版里把“本次尝试成功”回写到 auth profile usage，
          // 用于帮助理解为什么 auth profile 是一个独立子系统。
          const selectedProfile = authOrder.orderedProfileIds[0];
          if (selectedProfile) {
            markAuthProfileSuccess({
              store: authStore,
              profileId: selectedProfile,
            });
          }
          return result;
        } catch (error) {
          const selectedProfile = authOrder.orderedProfileIds[0];
          if (
            selectedProfile &&
            error instanceof ModelFallbackError &&
            (error.reason === "timeout" || error.reason === "rate_limit" || error.reason === "auth")
          ) {
            markAuthProfileFailure({
              store: authStore,
              profileId: selectedProfile,
              reason: error.reason,
            });
          }
          throw error;
        }
      },
    });

    // Step 6: fallback 成功后，入口层负责把运行时状态折叠回 session/store 语义。
    await saveAuthProfileStore(authStore, params.dataDir);
    clearSessionAuthProfileOverride(params.sessionKey);

    const terminal: LearningAgentResult = {
      ...fallbackResult.result,
      attempts: fallbackResult.attempts,
    };
    await updateLearningSession({
      sessionKey: params.sessionKey,
      dataDir: params.dataDir,
      update: (current) => ({
        ...current,
        updatedAt: Date.now(),
        status: "idle",
        model: terminal.selectedModel,
        provider: terminal.selectedProvider,
        inputTokens: current.inputTokens + (terminal.usage?.inputTokens ?? 0),
        outputTokens: current.outputTokens + (terminal.usage?.outputTokens ?? 0),
      }),
    });
    params.onEvent?.({
      type: "status",
      runId: params.runId,
      phase: "completed",
    });
    return terminal;
  } catch (error) {
    // 失败路径同样是主流程的一部分。
    // 这里不是简单 throw，而是先把 store/session 状态写回，再区分 cancelled / fallback exhausted。
    await saveAuthProfileStore(authStore, params.dataDir);
    await updateLearningSession({
      sessionKey: params.sessionKey,
      dataDir: params.dataDir,
      update: {
        status: "error",
      },
    });
    params.onEvent?.({
      type: "status",
      runId: params.runId,
      phase: "failed",
    });
    if (params.signal?.aborted || (error instanceof Error && error.message === "Run aborted")) {
      return {
        runId: params.runId,
        sessionId: session.sessionId,
        transcriptPath: session.transcriptPath,
        status: "cancelled",
        summary: "run cancelled",
        attempts: [],
        selectedModel: undefined,
        selectedProvider: undefined,
        skillSnapshot: {
          version: skillSnapshot.version,
          roots: skillSnapshot.roots,
          skillNames: skillSnapshot.entries.map((entry) => entry.name),
        },
      };
    }
    if (error instanceof ModelFallbackSummaryError) {
      return {
        runId: params.runId,
        sessionId: session.sessionId,
        transcriptPath: session.transcriptPath,
        status: "error",
        summary: error.message,
        attempts: error.attempts,
        selectedModel: undefined,
        selectedProvider: undefined,
        skillSnapshot: {
          version: skillSnapshot.version,
          roots: skillSnapshot.roots,
          skillNames: skillSnapshot.entries.map((entry) => entry.name),
        },
      };
    }
    throw error;
  }
}

/**
 * 对外暴露的 API 故意采用 “accepted + completion Promise” 两段式返回：
 *
 * - accepted: 适合 Gateway 立即响应客户端
 * - completion: 适合 wait / poll / terminal-result 订阅
 *
 * 这是学习 long-running agent 交互模型的关键点。
 */
export function runLearningAgentCommand(
  params: LearningAgentCommandParams,
): LearningAgentRunHandle {
  const accepted: AgentAcceptedResult = {
    runId: params.runId,
    status: "accepted",
    acceptedAt: Date.now(),
  };
  const completion = executeLearningAgentRun(params)
    .then((result) => {
      completedRuns.set(params.runId, result);
      return result;
    })
    .finally(() => {
      activeRuns.delete(params.runId);
    });
  activeRuns.set(params.runId, completion);
  return {
    runId: params.runId,
    accepted,
    completion,
  };
}

/**
 * 学习版的 wait surface。
 *
 * 它的意义不是功能本身复杂，而是帮助你观察：
 * agent 运行结果并不一定要通过“原始请求的同步返回值”来消费。
 */
export async function waitForLearningAgentRun(runId: string): Promise<LearningAgentResult | null> {
  if (completedRuns.has(runId)) {
    return completedRuns.get(runId) ?? null;
  }
  const active = activeRuns.get(runId);
  if (!active) {
    return null;
  }
  return await active;
}

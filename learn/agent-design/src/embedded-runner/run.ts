import { ModelFallbackError } from "../model-fallback.js";
import { detectToolCall, executeTool } from "../tools/runtime.js";
import {
  appendTranscriptMessage,
  getTranscriptPath,
  loadLearningTranscript,
} from "../transcript/store.js";
import type {
  LearningAgentCommandParams,
  LearningAgentResult,
  ModelCandidate,
  SkillSnapshot,
} from "../types.js";
import { loadBootstrapMemory } from "../workspace-memory/files.js";
import { maybeFlushSessionMemory } from "../workspace-memory/flush.js";

function inputString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

function maybeSimulateProviderFailure(params: {
  message: string;
  candidate: ModelCandidate;
  attempt: number;
}): void {
  if (params.message.includes("[simulate:timeout]") && params.attempt === 0) {
    throw new ModelFallbackError(
      "simulated timeout",
      "timeout",
      params.candidate.provider,
      params.candidate.model,
    );
  }
  if (params.message.includes("[simulate:rate-limit]") && params.attempt === 0) {
    throw new ModelFallbackError(
      "simulated rate limit",
      "rate_limit",
      params.candidate.provider,
      params.candidate.model,
    );
  }
  if (params.message.includes("[simulate:auth]") && params.attempt === 0) {
    throw new ModelFallbackError(
      "simulated auth failure",
      "auth",
      params.candidate.provider,
      params.candidate.model,
    );
  }
}

async function streamText(params: {
  text: string;
  onDelta?: LearningAgentCommandParams["onEvent"];
  runId: string;
  sessionKey: string;
  signal?: AbortSignal;
}): Promise<void> {
  const words = params.text.split(" ");
  let accumulated = "";
  for (const word of words) {
    if (params.signal?.aborted) {
      throw new Error("Run aborted");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
    accumulated += (accumulated ? " " : "") + word;
    params.onDelta?.({
      type: "delta",
      runId: params.runId,
      sessionKey: params.sessionKey,
      text: accumulated,
      delta: word,
    });
  }
}

function renderFinalReply(params: {
  message: string;
  toolOutput?: string;
  skillSnapshot: SkillSnapshot;
  candidate: ModelCandidate;
  bootstrapMemory?: string;
  memoryFlushPath?: string;
}): string {
  const intro = `已通过 ${params.candidate.provider}/${params.candidate.model} 完成这次 learning run。`;
  const toolPart = params.toolOutput ? `\n\n工具结果：${params.toolOutput}` : "";
  const skillPart =
    params.skillSnapshot.entries.length > 0
      ? `\n\n当前可用 skills：${params.skillSnapshot.entries.map((entry) => entry.name).join(", ")}`
      : "";
  const memoryPart = params.bootstrapMemory
    ? `\n\n启动时注入的长期记忆摘要：${params.bootstrapMemory}`
    : "";
  const flushPart = params.memoryFlushPath
    ? `\n\n本次运行触发了 pre-compaction memory flush，已写入：${params.memoryFlushPath}`
    : "";
  return `${intro}\n\n你刚才说的是：${params.message}${toolPart}${skillPart}${memoryPart}${flushPart}`;
}

export async function runEmbeddedBackend(params: {
  command: LearningAgentCommandParams;
  sessionId: string;
  candidate: ModelCandidate;
  attempt: number;
  skillSnapshot: SkillSnapshot;
}): Promise<LearningAgentResult> {
  // 启动前先把 curated memory 注入进来，模拟真实 runtime 在正式生成前装配长期上下文。
  const bootstrapMemory = await loadBootstrapMemory({
    workspaceDir: params.command.workspaceDir,
  });
  maybeSimulateProviderFailure({
    message: params.command.message,
    candidate: params.candidate,
    attempt: params.attempt,
  });

  const userMessage = await appendTranscriptMessage({
    sessionId: params.sessionId,
    dataDir: params.command.dataDir,
    message: {
      role: "user",
      content: params.command.message,
      timestamp: Date.now(),
    },
  });
  params.command.onEvent?.({
    type: "transcript.message",
    runId: params.command.runId,
    sessionKey: params.command.sessionKey,
    message: userMessage,
  });

  const toolCall = detectToolCall(params.command.message);
  let toolOutput: string | undefined;
  if (toolCall) {
    if (params.command.signal?.aborted) {
      throw new Error("Run aborted");
    }
    const toolUseId = `${params.command.runId}:${toolCall.toolName}`;
    params.command.onEvent?.({
      type: "tool",
      runId: params.command.runId,
      stage: "start",
      toolName: toolCall.toolName,
      input: toolCall.input,
    });
    const assistantToolUse = await appendTranscriptMessage({
      sessionId: params.sessionId,
      dataDir: params.command.dataDir,
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            toolUseId,
            toolName: toolCall.toolName,
            input: toolCall.input,
          },
        ],
        timestamp: Date.now(),
        model: params.candidate.model,
      },
    });
    params.command.onEvent?.({
      type: "transcript.message",
      runId: params.command.runId,
      sessionKey: params.command.sessionKey,
      message: assistantToolUse,
    });

    toolOutput = await executeTool({
      call: toolCall,
      sessionId: params.sessionId,
      dataDir: params.command.dataDir,
      workspaceDir: params.command.workspaceDir,
    });
    params.command.onEvent?.({
      type: "tool",
      runId: params.command.runId,
      stage: "result",
      toolName: toolCall.toolName,
      output: toolOutput,
    });
    if (toolCall.toolName === "memory_write" && toolOutput.startsWith("Memory written to ")) {
      params.command.onEvent?.({
        type: "memory",
        runId: params.command.runId,
        action: "write",
        path: toolOutput.split("\n")[0]?.replace("Memory written to ", "") ?? "",
        note: inputString(toolCall.input, "note"),
      });
    }
    const toolResult = await appendTranscriptMessage({
      sessionId: params.sessionId,
      dataDir: params.command.dataDir,
      message: {
        role: "tool",
        content: [
          {
            type: "tool_result",
            toolUseId,
            content: toolOutput,
          },
        ],
        timestamp: Date.now(),
        toolName: toolCall.toolName,
      },
    });
    params.command.onEvent?.({
      type: "transcript.message",
      runId: params.command.runId,
      sessionKey: params.command.sessionKey,
      message: toolResult,
    });
  }

  const transcript = await loadLearningTranscript(params.sessionId, params.command.dataDir);
  // learning 版把 pre-compaction flush 放在最终回答前，目的是把“短期会话记忆写回长期记忆”
  // 这条主线讲清楚，而不去复刻真实 runtime 更复杂的 compaction 生命周期。
  const flush = await maybeFlushSessionMemory({
    workspaceDir: params.command.workspaceDir,
    sessionKey: params.command.sessionKey,
    transcript,
  });
  if (flush.flushed && flush.path && flush.note) {
    params.command.onEvent?.({
      type: "memory",
      runId: params.command.runId,
      action: "flush",
      path: flush.path,
      note: flush.note,
    });
  }

  const reply = renderFinalReply({
    message: params.command.message,
    toolOutput,
    skillSnapshot: params.skillSnapshot,
    candidate: params.candidate,
    bootstrapMemory: bootstrapMemory.combinedText
      ? bootstrapMemory.combinedText.slice(0, 180).replace(/\s+/g, " ")
      : undefined,
    memoryFlushPath: flush.path,
  });
  await streamText({
    text: reply,
    onDelta: params.command.onEvent,
    runId: params.command.runId,
    sessionKey: params.command.sessionKey,
    signal: params.command.signal,
  });

  const assistant = await appendTranscriptMessage({
    sessionId: params.sessionId,
    dataDir: params.command.dataDir,
    message: {
      role: "assistant",
      content: [{ type: "text", text: reply }],
      timestamp: Date.now(),
      model: params.candidate.model,
      usage: {
        inputTokens: Math.ceil(params.command.message.length / 4),
        outputTokens: Math.ceil(reply.length / 4),
      },
    },
  });
  params.command.onEvent?.({
    type: "transcript.message",
    runId: params.command.runId,
    sessionKey: params.command.sessionKey,
    message: assistant,
  });

  return {
    runId: params.command.runId,
    sessionId: params.sessionId,
    transcriptPath: getTranscriptPath(params.sessionId, params.command.dataDir),
    status: "ok",
    summary: toolCall ? `completed with ${toolCall.toolName}` : "completed",
    reply,
    selectedModel: params.candidate.model,
    selectedProvider: params.candidate.provider,
    attempts: [],
    usage: assistant.usage,
    skillSnapshot: {
      version: params.skillSnapshot.version,
      roots: params.skillSnapshot.roots,
      skillNames: params.skillSnapshot.entries.map((entry) => entry.name),
    },
  };
}

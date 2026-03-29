/**
 * agent-runner.ts — Agent 执行引擎
 *
 * 【职责】实际调用 LLM API，执行工具调用，收集并返回最终回复
 *
 * 这是 Gateway 中最核心的"业务引擎"。
 * 它被 methods/agent.ts 调用，完成单次 agent turn 的执行。
 *
 * 【设计要点】
 * 1. 支持取消（AbortController）——用户或超时可以中止长时间运行的 turn
 * 2. 流式输出——LLM 是流式生成的，边生成边推送给客户端
 * 3. 工具调用——LLM 可以触发工具，工具结果再输入回 LLM
 * 4. 执行完成后持久化 transcript 和 session 元数据
 *
 * 【本示例的简化】
 * 本示例使用 mock LLM（不调用真实 API），只演示架构流程。
 * 真实实现里，把 mockLlmCall() 替换成 OpenAI/Anthropic SDK 调用即可。
 */

import {
  appendTurn,
  updateSessionEntry,
  type SessionEntry,
  type TranscriptMessage,
  emitTranscriptUpdate,
  appendTranscriptMessage,
} from "./sessions.js";
import type { GatewayRuntimeState } from "./runtime-state.js";
import { broadcastSessionsChanged } from "./runtime-state.js";

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

export type AgentRunParams = {
  /** 运行 ID（与 idempotencyKey 相同，全局唯一） */
  runId: string;
  /** 用户消息 */
  message: string;
  /** session key */
  sessionKey: string;
  /** session entry（已经从 store 加载） */
  sessionEntry: SessionEntry;
  /** 指定 model provider（可选，覆盖默认） */
  provider?: string;
  /** 指定 model（可选，覆盖默认） */
  model?: string;
  /** 超时毫秒数（0 = 无超时） */
  timeoutMs?: number;
  /** 取消信号 */
  signal?: AbortSignal;
  /** 增量输出回调（流式推送给客户端） */
  onDelta?: (delta: string) => void;
};

export type AgentRunResult = {
  /** 最终回复文本 */
  reply: string;
  /** 实际使用的 model */
  model: string;
  /** Token 使用统计 */
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
};

// ─── Mock LLM 调用（替换成真实 SDK）────────────────────────────────────────

/**
 * Mock LLM 调用
 *
 * 生产环境里，替换成：
 *   - OpenAI：import OpenAI from "openai";
 *   - Anthropic：import Anthropic from "@anthropic-ai/sdk";
 *
 * Mock 实现模拟了流式输出，让架构演示更真实。
 */
async function mockLlmCall(params: {
  messages: Array<{ role: string; content: string }>;
  model: string;
  onChunk: (chunk: string) => void;
  signal?: AbortSignal;
}): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const userMsg = params.messages.at(-1)?.content ?? "";

  // 根据用户消息生成 mock 回复
  const mockReply = generateMockReply(userMsg);

  // 模拟流式输出（每 50ms 推送一个词）
  const words = mockReply.split(" ");
  let accumulated = "";

  for (const word of words) {
    if (params.signal?.aborted) {
      throw new Error("已取消");
    }

    // 模拟网络延迟
    await new Promise<void>((resolve) => setTimeout(resolve, 30));

    accumulated += (accumulated ? " " : "") + word;
    params.onChunk(accumulated);  // 注意：这里发送的是累积文本，不是 delta
  }

  return {
    text: mockReply,
    // mock 的 token 计数
    inputTokens: Math.floor(userMsg.length / 4),
    outputTokens: Math.floor(mockReply.length / 4),
  };
}

function generateMockReply(userMessage: string): string {
  const msg = userMessage.toLowerCase();
  if (msg.includes("你好") || msg.includes("hello") || msg.includes("hi")) {
    return "你好！我是 Mini Gateway 学习示例里的 AI 助手。有什么我可以帮你的吗？";
  }
  if (msg.includes("时间") || msg.includes("几点")) {
    return `现在是 ${new Date().toLocaleString("zh-CN")}。`;
  }
  if (msg.includes("会话") || msg.includes("session")) {
    return "我们当前的会话已经被持久化到了 ~/.mini-gateway/transcripts/ 目录，你可以去查看 JSONL 文件。";
  }
  return `我收到了你的消息："${userMessage}"。这是一个学习用的 mock 回复，展示了 Gateway 的完整执行流程：消息路由 → Session 管理 → Agent 执行 → Transcript 持久化。`;
}

// ─── Agent Run 执行 ───────────────────────────────────────────────────────────

/**
 * 执行一次 agent turn
 *
 * 完整流程：
 * 1. 标记 session 为 "running"
 * 2. 把用户消息写入 transcript
 * 3. 调用 LLM（流式，边生成边推送 delta）
 * 4. 把 LLM 回复写入 transcript
 * 5. 更新 session 元数据（token 数、状态、时间等）
 * 6. 返回结果
 */
export async function runAgentTurn(
  params: AgentRunParams,
  state: GatewayRuntimeState,
): Promise<AgentRunResult> {
  const { sessionKey, sessionEntry, message, runId, signal } = params;
  const sessionId = sessionEntry.sessionId;
  const model = params.model ?? "mock-gpt-4";
  const startedAt = Date.now();

  console.log(`[agent-runner] 开始执行 run=${runId} session=${sessionKey} model=${model}`);

  // ── Step 1：标记 session 为 running ─────────────────────────────
  await updateSessionEntry(sessionKey, {
    status: "running",
    startedAt,
    model,
  });

  broadcastSessionsChanged(state, {
    sessionKey,
    reason: "send",
    ts: Date.now(),
    sessionId,
    status: "running",
    model,
  });

  try {
    // ── Step 2：把用户消息追加到 transcript ──────────────────────
    const userMsg = await appendTranscriptMessage(sessionId, {
      role: "user",
      content: message,
      timestamp: Date.now(),
    });

    emitTranscriptUpdate({ sessionId, sessionKey, message: userMsg });

    // ── Step 3：加载历史消息（用于提供 LLM 上下文）──────────────
    // 简化实现：只发最后 10 条消息给 LLM
    // 真实实现里会用 context window 管理来决定发多少历史
    const historyMessages = [
      {
        role: "system",
        content: "你是一个智能助手。请用中文回复。",
      },
      {
        role: "user",
        content: message,
      },
    ];

    // ── Step 4：调用 LLM（流式） ─────────────────────────────────
    let currentText = "";

    const llmResult = await mockLlmCall({
      messages: historyMessages,
      model,
      signal,
      onChunk: (text) => {
        currentText = text;
        // 把流式输出推送给客户端
        params.onDelta?.(text);
      },
    });

    // ── Step 5：把 LLM 回复写入 transcript ──────────────────────
    const assistantMsg = await appendTranscriptMessage(sessionId, {
      role: "assistant",
      content: [{ type: "text", text: llmResult.text }],
      timestamp: Date.now(),
      model,
      usage: {
        inputTokens: llmResult.inputTokens,
        outputTokens: llmResult.outputTokens,
      },
    });

    emitTranscriptUpdate({ sessionId, sessionKey, message: assistantMsg });

    // ── Step 6：更新 session 元数据 ──────────────────────────────
    const endedAt = Date.now();
    await updateSessionEntry(sessionKey, (current) => ({
      ...(current ?? sessionEntry),
      status: "idle",
      endedAt,
      inputTokens: (current?.inputTokens ?? 0) + llmResult.inputTokens,
      outputTokens: (current?.outputTokens ?? 0) + llmResult.outputTokens,
      updatedAt: endedAt,
      model,
    }));

    broadcastSessionsChanged(state, {
      sessionKey,
      reason: "complete",
      ts: endedAt,
      sessionId,
      status: "idle",
      inputTokens: (sessionEntry.inputTokens) + llmResult.inputTokens,
      outputTokens: (sessionEntry.outputTokens) + llmResult.outputTokens,
      updatedAt: endedAt,
    });

    console.log(
      `[agent-runner] 执行完成 run=${runId} duration=${endedAt - startedAt}ms tokens=${llmResult.inputTokens}+${llmResult.outputTokens}`,
    );

    return {
      reply: llmResult.text,
      model,
      usage: {
        inputTokens: llmResult.inputTokens,
        outputTokens: llmResult.outputTokens,
      },
    };
  } catch (err) {
    // ── 错误处理：标记 session 为 error 状态 ─────────────────────
    const endedAt = Date.now();
    await updateSessionEntry(sessionKey, {
      status: "error",
      endedAt,
      updatedAt: endedAt,
    });

    broadcastSessionsChanged(state, {
      sessionKey,
      reason: "error",
      ts: endedAt,
      sessionId,
      status: "error",
    });

    throw err;
  }
}

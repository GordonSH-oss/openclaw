import { runLearningAgentCommand } from "../../agent-design/src/index.js";
import type { GatewayRuntimeState } from "./server-runtime-state.js";
import type { SessionEntry } from "./session-store.js";

export type AgentRunParams = {
  runId: string;
  message: string;
  sessionKey: string;
  sessionEntry: SessionEntry;
  provider?: string;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
};

export type AgentRunResult = {
  reply: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
};

export async function runAgentTurn(
  params: AgentRunParams,
  _state: GatewayRuntimeState,
): Promise<AgentRunResult> {
  const handle = runLearningAgentCommand({
    runId: params.runId,
    message: params.message,
    sessionKey: params.sessionKey,
    sessionId: params.sessionEntry.sessionId,
    provider: params.provider,
    model: params.model,
    timeoutMs: params.timeoutMs,
    signal: params.signal,
    onEvent: (event) => {
      if (event.type === "delta") {
        params.onDelta?.(event.text);
      }
    },
  });
  const result = await handle.completion;
  return {
    reply: result.reply ?? result.summary,
    model: result.selectedModel ?? "unknown",
    usage: {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
    },
  };
}

import type { LearningTranscriptMessage } from "../types.js";
import { appendDailyMemoryEntry } from "./files.js";

function renderMessage(message: LearningTranscriptMessage): string {
  const content =
    typeof message.content === "string"
      ? message.content
      : message.content
          .map((part) => {
            if (part.type === "text") {
              return part.text;
            }
            if (part.type === "tool_use") {
              return `[tool_use:${part.toolName}]`;
            }
            return `[tool_result:${part.content}]`;
          })
          .join(" ");
  return `${message.role}: ${content}`;
}

/**
 * learning 版 pre-compaction memory flush：
 *
 * 当 transcript 足够长时，把最近几条消息折叠成一段摘要写入 daily memory。
 * 真实 OpenClaw 会在更复杂的 compaction 生命周期里做这件事；这里保留的是
 * “在上下文即将变长时，把 durable notes 从会话写回长期记忆”的核心思想。
 */
export async function maybeFlushSessionMemory(params: {
  workspaceDir?: string;
  sessionKey: string;
  transcript: LearningTranscriptMessage[];
  thresholdMessages?: number;
  recentMessages?: number;
}): Promise<{ flushed: boolean; path?: string; note?: string }> {
  const threshold = params.thresholdMessages ?? 6;
  if (params.transcript.length < threshold) {
    return { flushed: false };
  }

  // 这里只提取最近几条消息，模拟“从热上下文提炼 durable note”而不是原样搬运整份 transcript。
  const recent = params.transcript.slice(-(params.recentMessages ?? 6));
  const marker = `memory-flush:${params.sessionKey}:${recent.at(-1)?.id ?? "none"}`;
  const note = [
    `Session ${params.sessionKey} neared compaction in the learning runtime.`,
    "Recent context worth retaining:",
    ...recent.map(renderMessage),
  ].join("\n");

  const result = await appendDailyMemoryEntry({
    workspaceDir: params.workspaceDir,
    source: "flush",
    note,
    marker,
  });
  return {
    flushed: true,
    path: result.path,
    note,
  };
}

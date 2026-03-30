import { appendLearningDailyMemoryEntry } from "./workspace-memory.js";
import type { LearningTranscriptMessage } from "./transcript-store.js";
import type { LearningSessionEventHub } from "./events.js";

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

export async function flushLearningSessionMemory(params: {
  workspaceDir?: string;
  sessionKey: string;
  transcript: LearningTranscriptMessage[];
  thresholdMessages?: number;
  recentMessages?: number;
  events?: LearningSessionEventHub;
}): Promise<{ flushed: boolean; path?: string; note?: string }> {
  const threshold = params.thresholdMessages ?? 6;
  if (params.transcript.length < threshold) {
    return { flushed: false };
  }
  const recent = params.transcript.slice(-(params.recentMessages ?? 6));
  const marker = `memory-flush:${params.sessionKey}:${recent.at(-1)?.id ?? "none"}`;
  const note = [
    `Session ${params.sessionKey} neared compaction in the learning runtime.`,
    "Recent context worth retaining:",
    ...recent.map(renderMessage),
  ].join("\n");
  const result = await appendLearningDailyMemoryEntry({
    workspaceDir: params.workspaceDir,
    note,
    source: "flush",
    marker,
  });
  params.events?.emit({
    type: "memory.updated",
    path: result.path,
    action: "flush",
    note,
    sessionKey: params.sessionKey,
  });
  return {
    flushed: true,
    path: result.path,
    note,
  };
}

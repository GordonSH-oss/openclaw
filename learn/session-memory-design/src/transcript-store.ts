import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { getLearningTranscriptDir, getLearningTranscriptPath } from "./session-store.js";

export type ToolContentPart =
  | { type: "text"; text: string }
  | { type: "tool_use"; toolUseId: string; toolName: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string };

export type LearningTranscriptMessage = {
  id: string;
  parentId?: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string | ToolContentPart[];
  timestamp: number;
  model?: string;
  toolName?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
};

export async function ensureLearningTranscriptDir(dataDir?: string): Promise<void> {
  await fs.mkdir(getLearningTranscriptDir(dataDir), { recursive: true });
}

export async function loadLearningTranscript(
  sessionId: string,
  dataDir?: string,
): Promise<LearningTranscriptMessage[]> {
  try {
    const raw = await fs.readFile(getLearningTranscriptPath(sessionId, dataDir), "utf-8");
    return raw
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as LearningTranscriptMessage);
  } catch {
    return [];
  }
}

export async function appendLearningTranscriptMessage(params: {
  sessionId: string;
  dataDir?: string;
  message: Omit<LearningTranscriptMessage, "id" | "parentId">;
}): Promise<LearningTranscriptMessage> {
  await ensureLearningTranscriptDir(params.dataDir);
  const transcript = await loadLearningTranscript(params.sessionId, params.dataDir);
  const next: LearningTranscriptMessage = {
    id: randomUUID(),
    parentId: transcript.at(-1)?.id,
    ...params.message,
  };
  await fs.appendFile(
    getLearningTranscriptPath(params.sessionId, params.dataDir),
    JSON.stringify(next) + "\n",
    "utf-8",
  );
  return next;
}

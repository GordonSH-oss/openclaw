import {
  appendLearningTranscriptMessage,
  loadLearningTranscript,
  type LearningTranscriptMessage,
} from "../../session-memory-design/src/index.js";
import { resolveDocAssistantRuntimeDataDir } from "./session-store.js";

export type { LearningTranscriptMessage };

export async function loadDocAssistantTranscript(sessionId: string, dataDir?: string) {
  return await loadLearningTranscript(sessionId, resolveDocAssistantRuntimeDataDir(dataDir));
}

export async function appendDocAssistantTranscriptMessage(params: {
  sessionId: string;
  dataDir?: string;
  message: Omit<LearningTranscriptMessage, "id" | "parentId">;
}) {
  return await appendLearningTranscriptMessage({
    sessionId: params.sessionId,
    dataDir: resolveDocAssistantRuntimeDataDir(params.dataDir),
    message: params.message,
  });
}

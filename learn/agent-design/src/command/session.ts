import type { LearningAgentSessionEntry } from "../types.js";
import {
  resolveLearningSession as sharedResolveLearningSession,
  updateLearningSession as sharedUpdateLearningSession,
} from "../../../session-memory-design/src/index.js";

export async function resolveLearningSession(params: {
  sessionKey: string;
  sessionId?: string;
  dataDir?: string;
}): Promise<LearningAgentSessionEntry> {
  return await sharedResolveLearningSession(params);
}

export async function updateLearningSession(params: {
  sessionKey: string;
  dataDir?: string;
  update:
    | Partial<LearningAgentSessionEntry>
    | ((
        current: LearningAgentSessionEntry,
      ) => LearningAgentSessionEntry);
}): Promise<LearningAgentSessionEntry> {
  return await sharedUpdateLearningSession(params);
}

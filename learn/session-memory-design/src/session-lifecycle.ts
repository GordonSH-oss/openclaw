import {
  deleteLearningSession,
  resolveLearningSession,
  updateLearningSession,
  type LearningSessionEntry,
} from "./session-store.js";
import type { LearningSessionEventHub } from "./events.js";

export async function createLearningSessionLifecycle(params: {
  sessionKey: string;
  dataDir?: string;
  events?: LearningSessionEventHub;
  initial?: Partial<LearningSessionEntry>;
}): Promise<LearningSessionEntry> {
  const entry = await resolveLearningSession({
    sessionKey: params.sessionKey,
    dataDir: params.dataDir,
    initial: params.initial,
  });
  params.events?.emit({
    type: "sessions.changed",
    sessionKey: params.sessionKey,
    sessionId: entry.sessionId,
    reason: "create",
    ts: Date.now(),
  });
  return entry;
}

export async function resetLearningSessionLifecycle(params: {
  sessionKey: string;
  dataDir?: string;
  events?: LearningSessionEventHub;
}): Promise<void> {
  await deleteLearningSession(params.sessionKey, params.dataDir);
  params.events?.emit({
    type: "sessions.changed",
    sessionKey: params.sessionKey,
    reason: "reset",
    ts: Date.now(),
  });
}

export async function updateLearningSessionLifecycle(params: {
  sessionKey: string;
  dataDir?: string;
  events?: LearningSessionEventHub;
  update: Parameters<typeof updateLearningSession>[0]["update"];
}): Promise<LearningSessionEntry> {
  const entry = await updateLearningSession({
    sessionKey: params.sessionKey,
    dataDir: params.dataDir,
    update: params.update,
  });
  params.events?.emit({
    type: "sessions.changed",
    sessionKey: params.sessionKey,
    sessionId: entry.sessionId,
    reason: "update",
    ts: Date.now(),
    status: entry.status,
  });
  return entry;
}

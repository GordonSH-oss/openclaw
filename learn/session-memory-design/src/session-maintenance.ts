import fs from "node:fs/promises";
import { deleteLearningSession, getLearningTranscriptPath, loadLearningSessionStore, saveLearningSessionStore } from "./session-store.js";
import type { LearningSessionEventHub } from "./events.js";

export async function runLearningSessionMaintenance(params: {
  dataDir?: string;
  staleBeforeTs?: number;
  maxEntries?: number;
  rotateTranscriptBytes?: number;
  events?: LearningSessionEventHub;
}): Promise<{ prunedKeys: string[]; rotatedSessionIds: string[] }> {
  const store = await loadLearningSessionStore(params.dataDir);
  const entries = Object.entries(store).sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  const prunedKeys: string[] = [];
  const staleBeforeTs = params.staleBeforeTs;
  if (typeof staleBeforeTs === "number") {
    for (const [key, entry] of entries) {
      if (entry.updatedAt < staleBeforeTs) {
        await deleteLearningSession(key, params.dataDir);
        prunedKeys.push(key);
        params.events?.emit({
          type: "sessions.changed",
          sessionKey: key,
          sessionId: entry.sessionId,
          reason: "maintenance",
          ts: Date.now(),
        });
      }
    }
  }

  const refreshedStore = await loadLearningSessionStore(params.dataDir);
  const refreshedEntries = Object.entries(refreshedStore).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  if (params.maxEntries && refreshedEntries.length > params.maxEntries) {
    for (const [key, entry] of refreshedEntries.slice(params.maxEntries)) {
      await deleteLearningSession(key, params.dataDir);
      prunedKeys.push(key);
      params.events?.emit({
        type: "sessions.changed",
        sessionKey: key,
        sessionId: entry.sessionId,
        reason: "maintenance",
        ts: Date.now(),
      });
    }
  }

  const rotatedSessionIds: string[] = [];
  if (params.rotateTranscriptBytes) {
    const finalStore = await loadLearningSessionStore(params.dataDir);
    for (const entry of Object.values(finalStore)) {
      const transcriptPath = getLearningTranscriptPath(entry.sessionId, params.dataDir);
      try {
        const stat = await fs.stat(transcriptPath);
        if (stat.size <= params.rotateTranscriptBytes) {
          continue;
        }
        await fs.rename(transcriptPath, `${transcriptPath}.rotated`);
        await fs.writeFile(transcriptPath, "", "utf-8");
        rotatedSessionIds.push(entry.sessionId);
      } catch {
        // Missing transcript is fine.
      }
    }
    await saveLearningSessionStore(finalStore, params.dataDir);
  }
  return {
    prunedKeys: Array.from(new Set(prunedKeys)),
    rotatedSessionIds,
  };
}

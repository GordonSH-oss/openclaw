import type { LearningTranscriptMessage } from "./transcript-store.js";

export type LearningSessionEvent =
  | {
      type: "sessions.changed";
      sessionKey: string;
      sessionId?: string;
      reason: "create" | "update" | "reset" | "delete" | "maintenance";
      ts: number;
      status?: "idle" | "running" | "error";
    }
  | {
      type: "transcript.message";
      sessionKey: string;
      sessionId: string;
      message: LearningTranscriptMessage;
    }
  | {
      type: "memory.updated";
      sessionKey?: string;
      path: string;
      action: "write" | "flush";
      note: string;
    };

export type LearningSessionEventHub = {
  subscribe(listener: (event: LearningSessionEvent) => void): () => void;
  emit(event: LearningSessionEvent): void;
};

export function createLearningSessionEventHub(): LearningSessionEventHub {
  const listeners = new Set<(event: LearningSessionEvent) => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(event) {
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
}

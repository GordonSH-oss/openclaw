import path from "node:path";
import type { LearningAgentCommandParams } from "../types.js";

export type LearningRunContext = {
  runId: string;
  sessionKey: string;
  workspaceDir: string;
  timeoutMs: number;
  backend: "embedded" | "cli";
  thinkingLevel: "off" | "low" | "medium" | "high";
  verboseLevel: "off" | "on" | "full";
};

export function resolveLearningRunContext(params: LearningAgentCommandParams): LearningRunContext {
  return {
    runId: params.runId,
    sessionKey: params.sessionKey.trim(),
    workspaceDir: path.resolve(params.workspaceDir ?? process.cwd()),
    timeoutMs: params.timeoutMs ?? 60_000,
    backend: params.backend ?? "embedded",
    thinkingLevel: params.thinkingLevel ?? "medium",
    verboseLevel: params.verboseLevel ?? "on",
  };
}

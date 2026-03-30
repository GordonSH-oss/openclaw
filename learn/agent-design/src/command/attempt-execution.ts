import { runCliBackend } from "../cli-runner/execute.js";
import { runEmbeddedBackend } from "../embedded-runner/run.js";
import type {
  LearningAgentCommandParams,
  LearningAgentResult,
  ModelCandidate,
  SkillSnapshot,
} from "../types.js";

export async function runLearningAgentAttempt(params: {
  command: LearningAgentCommandParams;
  sessionId: string;
  candidate: ModelCandidate;
  attempt: number;
  skillSnapshot: SkillSnapshot;
}): Promise<LearningAgentResult> {
  if (params.command.backend === "cli") {
    return await runCliBackend({
      command: params.command,
      sessionId: params.sessionId,
      candidate: params.candidate,
      skillSnapshot: params.skillSnapshot,
    });
  }
  return await runEmbeddedBackend(params);
}

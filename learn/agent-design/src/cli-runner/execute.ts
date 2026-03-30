import type { LearningAgentCommandParams, LearningAgentResult, ModelCandidate, SkillSnapshot } from "../types.js";
import { appendTranscriptMessage, getTranscriptPath } from "../transcript/store.js";

export async function runCliBackend(params: {
  command: LearningAgentCommandParams;
  sessionId: string;
  candidate: ModelCandidate;
  skillSnapshot: SkillSnapshot;
}): Promise<LearningAgentResult> {
  if (params.command.signal?.aborted) {
    throw new Error("Run aborted");
  }
  const userMessage = await appendTranscriptMessage({
    sessionId: params.sessionId,
    dataDir: params.command.dataDir,
    message: {
      role: "user",
      content: params.command.message,
      timestamp: Date.now(),
    },
  });
  params.command.onEvent?.({
    type: "transcript.message",
    runId: params.command.runId,
    sessionKey: params.command.sessionKey,
    message: userMessage,
  });

  const reply =
    `CLI backend simulated a run for "${params.command.message}". ` +
    `Skills visible: ${params.skillSnapshot.entries.map((entry) => entry.name).join(", ") || "none"}.`;
  params.command.onEvent?.({
    type: "delta",
    runId: params.command.runId,
    sessionKey: params.command.sessionKey,
    text: reply,
    delta: reply,
  });

  const assistant = await appendTranscriptMessage({
    sessionId: params.sessionId,
    dataDir: params.command.dataDir,
    message: {
      role: "assistant",
      content: [{ type: "text", text: reply }],
      timestamp: Date.now(),
      model: params.candidate.model,
      usage: {
        inputTokens: Math.ceil(params.command.message.length / 4),
        outputTokens: Math.ceil(reply.length / 4),
      },
    },
  });
  params.command.onEvent?.({
    type: "transcript.message",
    runId: params.command.runId,
    sessionKey: params.command.sessionKey,
    message: assistant,
  });

  return {
    runId: params.command.runId,
    sessionId: params.sessionId,
    transcriptPath: getTranscriptPath(params.sessionId, params.command.dataDir),
    status: "ok",
    summary: "completed via cli backend",
    reply,
    selectedModel: params.candidate.model,
    selectedProvider: params.candidate.provider,
    attempts: [],
    usage: assistant.usage,
    skillSnapshot: {
      version: params.skillSnapshot.version,
      roots: params.skillSnapshot.roots,
      skillNames: params.skillSnapshot.entries.map((entry) => entry.name),
    },
  };
}

import type { DocAnswerSurface, DocAnswerValidationResult } from "./protocol/index.js";

export type DocAssistantTrace = {
  runId: string;
  question: string;
  route?: "greeting" | "memory" | "search";
  state?: Record<string, unknown>;
  clarification?: Record<string, unknown>;
  retrieval?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  validation?: DocAnswerValidationResult;
  memory?: Record<string, unknown>;
  answerSurface?: DocAnswerSurface;
  transitions: string[];
  createdAt: number;
};

export function createDocAssistantTrace(params: {
  runId: string;
  question: string;
}): DocAssistantTrace {
  return {
    runId: params.runId,
    question: params.question,
    transitions: [],
    createdAt: Date.now(),
  };
}

export function appendTraceTransition(
  trace: DocAssistantTrace,
  transition: string,
): DocAssistantTrace {
  if (trace.transitions.includes(transition)) {
    return trace;
  }
  return {
    ...trace,
    transitions: [...trace.transitions, transition],
  };
}

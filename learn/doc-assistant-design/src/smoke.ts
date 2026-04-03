import { updateClarificationStateAfterAnswer } from "./follow-up-context.js";
import type { OpenAICompatibleConfig } from "./protocol/index.js";
import { executeDocQuestion } from "./question-execution.js";

export async function runDocAssistantSmoke(params: {
  docsRoot: string;
  question: string;
  turns?: string[];
  dataDir?: string;
  mode?: "extractive" | "agent";
  model?: string;
  openAICompatible?: OpenAICompatibleConfig;
}): Promise<{
  question: string;
  retrieval: Array<{
    path: string;
    heading?: string;
    score: number;
    startLine: number;
    endLine: number;
    snippet: string;
  }>;
  answer: string;
  summary: string;
  selectedProvider?: string;
  selectedModel?: string;
  answerSurface?: Awaited<ReturnType<typeof executeDocQuestion>>["answer"]["answerSurface"];
  validation?: Awaited<ReturnType<typeof executeDocQuestion>>["answer"]["validation"];
  trace?: Awaited<ReturnType<typeof executeDocQuestion>>["answer"]["trace"];
}> {
  const turns = params.turns && params.turns.length > 0 ? params.turns : [params.question];
  const sessionId = `smoke-session-${Date.now()}`;
  let execution: Awaited<ReturnType<typeof executeDocQuestion>> | undefined;

  for (const [index, question] of turns.entries()) {
    const runId = `smoke-${Date.now()}-${index}`;
    execution = await executeDocQuestion({
      runId,
      question,
      sessionId,
      mode: params.mode ?? (params.openAICompatible ? "agent" : "extractive"),
      docsRoot: params.docsRoot,
      dataDir: params.dataDir,
      maxResults: 5,
      provider: params.openAICompatible ? "openai-compatible" : undefined,
      model: params.model,
      openAICompatible: params.openAICompatible,
    });
    await updateClarificationStateAfterAnswer({
      sessionId,
      runId,
      question,
      hits: execution.hits,
      summary: execution.answer.summary,
      pendingQuestion: execution.answer.pendingClarificationQuestion,
      clarificationKind: execution.answer.pendingClarificationKind,
      clarificationHits: execution.answer.clarificationHits,
      route: execution.route,
      dataDir: params.dataDir,
    });
  }

  if (!execution) {
    throw new Error("runDocAssistantSmoke requires at least one turn");
  }

  return {
    question: turns.at(-1) ?? params.question,
    retrieval: execution.hits.map((hit) => ({
      path: hit.path,
      heading: hit.heading,
      score: hit.score,
      startLine: hit.startLine,
      endLine: hit.endLine,
      snippet: hit.snippet,
    })),
    answer: execution.answer.answer,
    summary: execution.answer.summary,
    selectedProvider: execution.answer.selectedProvider,
    selectedModel: execution.answer.selectedModel,
    answerSurface: execution.answer.answerSurface,
    validation: execution.answer.validation,
    trace: execution.answer.trace,
  };
}

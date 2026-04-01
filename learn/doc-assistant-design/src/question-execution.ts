import { findAnswerMemoryMatch, noteAnswerMemoryHit } from "./answer-memory.js";
import { buildDocAnswer, type DocAnswerResult } from "./doc-answer.js";
import { searchDocs } from "./doc-search.js";
import {
  detectClarificationFollowUpQuestion,
  getStoredClarificationContext,
  rewriteClarificationQuestion,
  selectPlatformHits,
  shouldReuseClarificationHits,
} from "./follow-up-context.js";
import { buildGreetingAnswer, detectGreetingIntent } from "./greeting-intent.js";
import type { DocAssistantMode, DocSearchHit, OpenAICompatibleConfig } from "./protocol/index.js";

export async function executeDocQuestion(params: {
  runId: string;
  question: string;
  sessionId?: string;
  mode: DocAssistantMode;
  docsRoot: string;
  dataDir?: string;
  maxResults?: number;
  backend?: "embedded" | "cli";
  provider?: string;
  model?: string;
  openAICompatible?: OpenAICompatibleConfig;
  onRetrieved?: (hits: DocSearchHit[]) => void | Promise<void>;
  onDelta?: (data: { text: string; delta: string }) => void;
}): Promise<{
  route: "greeting" | "memory" | "search";
  hits: DocSearchHit[];
  answer: DocAnswerResult;
}> {
  const followUpMatch = detectClarificationFollowUpQuestion(params.question);
  const clarificationFollowUp =
    params.sessionId && followUpMatch
      ? await getStoredClarificationContext(params.sessionId, params.dataDir)
      : null;
  const selectedPlatform = clarificationFollowUp ? followUpMatch?.platform : undefined;
  const followUpBaseQuestion =
    clarificationFollowUp?.pendingQuestion ?? clarificationFollowUp?.originalQuestion;
  const rewrittenQuestion =
    followUpBaseQuestion && selectedPlatform
      ? rewriteClarificationQuestion(followUpBaseQuestion, selectedPlatform)
      : undefined;

  if (clarificationFollowUp && selectedPlatform && rewrittenQuestion) {
    if (shouldReuseClarificationHits(clarificationFollowUp.hits, selectedPlatform)) {
      const hits = selectPlatformHits(clarificationFollowUp.hits, selectedPlatform);
      await params.onRetrieved?.(hits);
      const answer = await buildDocAnswer({
        runId: params.runId,
        question: rewrittenQuestion,
        mode: params.mode,
        hits,
        dataDir: params.dataDir,
        backend: params.backend,
        provider: params.provider,
        model: params.model,
        openAICompatible: params.openAICompatible,
        onDelta: params.onDelta,
      });
      return {
        route: "search",
        hits,
        answer: {
          ...answer,
          followUpSource: "clarification_reuse",
          continuedFromRunId: clarificationFollowUp.runId,
          rewrittenQuestion,
        },
      };
    }

    const memoryMatch = await findAnswerMemoryMatch({
      question: rewrittenQuestion,
      dataDir: params.dataDir,
    });
    if (memoryMatch) {
      await noteAnswerMemoryHit({
        dataDir: params.dataDir,
        match: memoryMatch,
      });
      return {
        route: "memory",
        hits: [],
        answer: {
          mode: params.mode,
          answer: memoryMatch.entry.answer,
          summary: memoryMatch.entry.summary,
          citations: memoryMatch.entry.citations,
          selectedProvider: memoryMatch.entry.selectedProvider,
          selectedModel: memoryMatch.entry.selectedModel,
          answerSource: memoryMatch.answerSource,
          memoryEntryId: memoryMatch.entry.entryId,
          reviewStatus: memoryMatch.reviewStatus,
          followUpSource: "clarification_rewrite",
          continuedFromRunId: clarificationFollowUp.runId,
          rewrittenQuestion,
        },
      };
    }

    const hits = await searchDocs({
      query: rewrittenQuestion,
      docsRoot: params.docsRoot,
      dataDir: params.dataDir,
      maxResults: params.maxResults,
    });
    await params.onRetrieved?.(hits);
    const answer = await buildDocAnswer({
      runId: params.runId,
      question: rewrittenQuestion,
      mode: params.mode,
      hits,
      dataDir: params.dataDir,
      backend: params.backend,
      provider: params.provider,
      model: params.model,
      openAICompatible: params.openAICompatible,
      onDelta: params.onDelta,
    });
    return {
      route: "search",
      hits,
      answer: {
        ...answer,
        followUpSource: "clarification_rewrite",
        continuedFromRunId: clarificationFollowUp.runId,
        rewrittenQuestion,
      },
    };
  }

  const greetingIntent = detectGreetingIntent(params.question);
  if (greetingIntent) {
    return {
      route: "greeting",
      hits: [],
      answer: await buildGreetingAnswer({
        question: params.question,
        mode: params.mode,
        docsRoot: params.docsRoot,
        dataDir: params.dataDir,
        match: greetingIntent,
      }),
    };
  }

  const memoryMatch = await findAnswerMemoryMatch({
    question: params.question,
    dataDir: params.dataDir,
  });
  if (memoryMatch) {
    await noteAnswerMemoryHit({
      dataDir: params.dataDir,
      match: memoryMatch,
    });
    return {
      route: "memory",
      hits: [],
      answer: {
        mode: params.mode,
        answer: memoryMatch.entry.answer,
        summary: memoryMatch.entry.summary,
        citations: memoryMatch.entry.citations,
        selectedProvider: memoryMatch.entry.selectedProvider,
        selectedModel: memoryMatch.entry.selectedModel,
        answerSource: memoryMatch.answerSource,
        memoryEntryId: memoryMatch.entry.entryId,
        reviewStatus: memoryMatch.reviewStatus,
      },
    };
  }

  const hits = await searchDocs({
    query: params.question,
    docsRoot: params.docsRoot,
    dataDir: params.dataDir,
    maxResults: params.maxResults,
  });
  await params.onRetrieved?.(hits);
  const answer = await buildDocAnswer({
    runId: params.runId,
    question: params.question,
    mode: params.mode,
    hits,
    dataDir: params.dataDir,
    backend: params.backend,
    provider: params.provider,
    model: params.model,
    openAICompatible: params.openAICompatible,
    onDelta: params.onDelta,
  });
  return {
    route: "search",
    hits,
    answer,
  };
}

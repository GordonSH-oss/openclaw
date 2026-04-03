import { detectAnswerLanguage } from "./answer-language.js";
import { findAnswerMemoryMatch, noteAnswerMemoryHit } from "./answer-memory.js";
import { validateAnswer } from "./answer-validator.js";
import { decideAnswerability } from "./answerability.js";
import { decideClarification } from "./clarification-policy.js";
import {
  buildDocAnswer,
  buildInsufficientEvidenceAnswer,
  renderClarificationAnswer,
  type DocAnswerResult,
} from "./doc-answer.js";
import {
  loadDocChunks,
  searchDocs,
  searchDocsForPurpose,
  type RetrievalOverrides,
} from "./doc-search.js";
import { buildEvidencePack } from "./evidence-pack.js";
import { getDocAssistantFeatureFlags } from "./feature-flags.js";
import {
  detectClarificationFollowUpQuestion,
  extractQuestionStatePatchFromFollowUp,
  getStoredClarificationContext,
  mergeStoredStateWithFollowUp,
  selectPlatformHits,
  shouldReuseClarificationHits,
} from "./follow-up-context.js";
import { buildGreetingAnswer, detectGreetingIntent } from "./greeting-intent.js";
import type { DocAssistantMode, DocSearchHit, OpenAICompatibleConfig } from "./protocol/index.js";
import {
  buildQuestionState,
  mergeQuestionState,
  rewriteQuestionFromState,
  type QuestionState,
} from "./question-state.js";
import { findRetrievalMemoryMatch } from "./retrieval-memory.js";
import { buildRetrievalPlan } from "./retrieval-plan.js";
import { createDocAssistantTrace } from "./trace.js";

function filterHitsForResolvedState(hits: DocSearchHit[], state: QuestionState): DocSearchHit[] {
  if (!state.platform) {
    return hits;
  }
  const platformTerms =
    state.platform === "ios"
      ? ["ios", "iphone", "ipad"]
      : state.platform === "web"
        ? ["web", "browser", "javascript"]
        : state.platform === "flutter"
          ? ["flutter", "dart"]
          : ["android"];
  const matching = hits.filter((hit) => {
    const normalized = [hit.path, hit.heading ?? "", hit.text].join("\n").toLowerCase();
    return platformTerms.some((term) => normalized.includes(term));
  });
  return matching.length > 0 ? matching : hits;
}

function maybeReturnInsufficientEvidence(params: {
  question: string;
  state: QuestionState;
  mode: DocAssistantMode;
  hits: DocSearchHit[];
}): DocAnswerResult | null {
  if (params.hits.length === 0) {
    return null;
  }
  const decision = decideAnswerability({
    question: params.question,
    hits: params.hits,
    state: params.state,
  });
  if (decision.verdict === "answerable") {
    return null;
  }
  return buildInsufficientEvidenceAnswer(
    params.question,
    detectAnswerLanguage(params.question, params.hits),
    decision.reason,
  );
}

function maybeReturnClarification(params: {
  question: string;
  state: QuestionState;
  mode: DocAssistantMode;
  hits: DocSearchHit[];
}): DocAnswerResult | null {
  const decision = decideClarification({
    state: params.state,
    hits: params.hits,
  });
  if (!decision.shouldClarify) {
    return null;
  }
  return renderClarificationAnswer({
    decision,
    question: params.question,
    hits: params.hits,
    language: detectAnswerLanguage(params.question, params.hits),
    mode: params.mode,
  });
}

async function runStagedRetrieval(params: {
  question: string;
  state: QuestionState;
  docsRoot: string;
  dataDir?: string;
  maxResults?: number;
  overrides?: RetrievalOverrides;
}): Promise<{
  hits: DocSearchHit[];
  plan: ReturnType<typeof buildRetrievalPlan>;
  trace: {
    primaryQueries: Array<{ purpose: string; query: string; hitCount: number }>;
    expansionQueries: Array<{ purpose: string; query: string; hitCount: number }>;
    mergedHitCount: number;
  };
}> {
  const plan = buildRetrievalPlan({
    state: params.state,
    maxResults: params.maxResults,
  });
  const chunks = await loadDocChunks({
    docsRoot: params.docsRoot,
    dataDir: params.dataDir,
  });
  const seen = new Set<string>();
  const merged: DocSearchHit[] = [];
  const primaryQueries: Array<{ purpose: string; query: string; hitCount: number }> = [];
  const expansionQueries: Array<{ purpose: string; query: string; hitCount: number }> = [];

  for (const query of plan.primaryQueries) {
    const hits = searchDocsForPurpose({
      chunks,
      question: query.query,
      purpose: query.purpose,
      state: params.state,
      limit: query.limit,
      overrides: params.overrides,
    });
    primaryQueries.push({
      purpose: query.purpose,
      query: query.query,
      hitCount: hits.length,
    });
    for (const hit of hits) {
      const key = `${hit.path}:${hit.startLine}:${hit.endLine}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(hit);
    }
  }

  const allowExpansionQueries =
    merged.length > 0 ||
    params.state.platform !== undefined ||
    params.state.product !== undefined ||
    params.state.channelKind !== undefined ||
    params.state.referent !== undefined ||
    params.state.taskKind === "first_message" ||
    params.state.taskKind === "send_message" ||
    params.state.taskKind === "start_chat" ||
    params.state.taskKind === "channel_creation";

  if (!allowExpansionQueries) {
    return {
      hits: merged.slice(0, params.maxResults ?? 5),
      plan,
      trace: {
        primaryQueries,
        expansionQueries,
        mergedHitCount: merged.length,
      },
    };
  }

  for (const query of plan.expansionQueries) {
    const hits = searchDocsForPurpose({
      chunks,
      question: query.query,
      purpose: query.purpose,
      state: params.state,
      limit: query.limit,
      overrides: params.overrides,
    });
    expansionQueries.push({
      purpose: query.purpose,
      query: query.query,
      hitCount: hits.length,
    });
    for (const hit of hits) {
      const key = `${hit.path}:${hit.startLine}:${hit.endLine}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(hit);
    }
  }

  return {
    hits: merged.slice(0, params.maxResults ?? 5),
    plan,
    trace: {
      primaryQueries,
      expansionQueries,
      mergedHitCount: merged.length,
    },
  };
}

function finalizeValidatedAnswer(params: {
  question: string;
  state: QuestionState;
  mode: DocAssistantMode;
  hits: DocSearchHit[];
  answer: DocAnswerResult;
  evidence: ReturnType<typeof buildEvidencePack>;
  flags: ReturnType<typeof getDocAssistantFeatureFlags>;
  retrievalTrace?: {
    primaryQueries: Array<{ purpose: string; query: string; hitCount: number }>;
    expansionQueries: Array<{ purpose: string; query: string; hitCount: number }>;
    mergedHitCount: number;
  };
}): DocAnswerResult {
  const normalizedSummary = params.answer.summary.toLowerCase();
  if (!params.flags.validator) {
    return {
      ...params.answer,
      trace: {
        ...params.answer.trace,
        retrieval: params.retrievalTrace,
        evidence: {
          groupCount: params.evidence.groups.length,
          warnings: params.evidence.warnings,
          trimEvents: params.evidence.trimEvents,
        },
      },
    };
  }
  if (
    params.mode === "agent" ||
    normalizedSummary.includes("clarification required") ||
    normalizedSummary.includes("no relevant documentation found") ||
    normalizedSummary.includes("insufficient documentation evidence") ||
    normalizedSummary.includes("guided greeting")
  ) {
    return {
      ...params.answer,
      trace: {
        ...params.answer.trace,
        retrieval: params.retrievalTrace,
        evidence: {
          groupCount: params.evidence.groups.length,
          warnings: params.evidence.warnings,
          trimEvents: params.evidence.trimEvents,
        },
      },
    };
  }

  const validation = validateAnswer({
    question: params.question,
    state: params.state,
    evidence: params.evidence,
    answer: params.answer.answer,
    summary: params.answer.summary,
    citations: params.answer.citations,
  });

  let result: DocAnswerResult = {
    ...params.answer,
    validation,
    trace: {
      ...params.answer.trace,
      retrieval: params.retrievalTrace,
      evidence: {
        groupCount: params.evidence.groups.length,
        warnings: params.evidence.warnings,
        trimEvents: params.evidence.trimEvents,
      },
      validation,
    },
  };

  if (params.flags.validatorDowngrade && validation.downgradeTo === "clarification") {
    const clarification = maybeReturnClarification({
      question: params.question,
      state: params.state,
      mode: params.mode,
      hits: params.hits,
    });
    if (clarification) {
      result = {
        ...clarification,
        validation,
        trace: {
          ...clarification.trace,
          retrieval: params.retrievalTrace,
          evidence: {
            groupCount: params.evidence.groups.length,
            warnings: params.evidence.warnings,
            trimEvents: params.evidence.trimEvents,
          },
          validation,
          transitions: ["validator_downgrade_to_clarification"],
        },
      };
    }
  } else if (params.flags.validatorDowngrade && validation.downgradeTo === "insufficient") {
    result = {
      ...buildInsufficientEvidenceAnswer(
        params.question,
        detectAnswerLanguage(params.question, params.hits),
        validation.issues[0]?.message,
      ),
      validation,
      trace: {
        retrieval: params.retrievalTrace,
        evidence: {
          groupCount: params.evidence.groups.length,
          warnings: params.evidence.warnings,
          trimEvents: params.evidence.trimEvents,
        },
        validation,
        transitions: ["validator_downgrade_to_insufficient"],
      },
    };
  }

  return result;
}

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
  const flags = getDocAssistantFeatureFlags();
  const baseTrace = createDocAssistantTrace({
    runId: params.runId,
    question: params.question,
  });
  const initialState = buildQuestionState(params.question);
  const followUpMatch = detectClarificationFollowUpQuestion(params.question);
  const followUpPatch = followUpMatch
    ? extractQuestionStatePatchFromFollowUp(params.question)
    : null;
  const clarificationFollowUp =
    params.sessionId && followUpPatch
      ? await getStoredClarificationContext(params.sessionId, params.dataDir)
      : null;
  const followUpBaseQuestion =
    clarificationFollowUp?.pendingQuestion ?? clarificationFollowUp?.originalQuestion;
  const followUpBaseState = followUpBaseQuestion
    ? mergeQuestionState(
        buildQuestionState(followUpBaseQuestion),
        clarificationFollowUp?.questionState ?? {},
      )
    : undefined;
  const effectiveState =
    flags.questionState && clarificationFollowUp && followUpPatch && followUpBaseState
      ? mergeStoredStateWithFollowUp(followUpBaseState, followUpPatch)
      : initialState;
  const effectiveQuestion =
    flags.questionState && clarificationFollowUp && followUpPatch && followUpBaseState
      ? rewriteQuestionFromState(effectiveState)
      : params.question;
  const continuedFromRunId = clarificationFollowUp?.runId;
  const selectedPlatform = followUpPatch?.platform;

  if (
    clarificationFollowUp &&
    selectedPlatform &&
    shouldReuseClarificationHits(clarificationFollowUp, selectedPlatform)
  ) {
    const hits = selectPlatformHits(clarificationFollowUp.hits, selectedPlatform);
    await params.onRetrieved?.(hits);
    const evidence = buildEvidencePack({
      state: effectiveState,
      hits,
    });
    const insufficient = maybeReturnInsufficientEvidence({
      question: effectiveQuestion,
      state: effectiveState,
      mode: params.mode,
      hits,
    });
    if (insufficient) {
      return {
        route: "search",
        hits,
        answer: {
          ...insufficient,
          trace: {
            ...baseTrace,
            route: "search",
            state: effectiveState,
            evidence: {
              groupCount: evidence.groups.length,
              warnings: evidence.warnings,
              trimEvents: evidence.trimEvents,
            },
            transitions: ["clarification_reuse", "insufficient_evidence"],
          },
          followUpSource: "clarification_reuse",
          continuedFromRunId,
          rewrittenQuestion: effectiveQuestion,
        },
      };
    }
    const clarification = flags.clarificationPolicy
      ? maybeReturnClarification({
          question: effectiveQuestion,
          state: effectiveState,
          mode: params.mode,
          hits,
        })
      : null;
    if (clarification) {
      return {
        route: "search",
        hits,
        answer: {
          ...clarification,
          trace: {
            ...baseTrace,
            route: "search",
            state: effectiveState,
            clarification: {
              kind: clarification.pendingClarificationKind,
            },
            evidence: {
              groupCount: evidence.groups.length,
              warnings: evidence.warnings,
              trimEvents: evidence.trimEvents,
            },
            transitions: ["clarification_reuse", "clarification_required"],
          },
          followUpSource: "clarification_reuse",
          continuedFromRunId,
          rewrittenQuestion: effectiveQuestion,
        },
      };
    }
    const answer = await buildDocAnswer({
      runId: params.runId,
      question: effectiveQuestion,
      language: detectAnswerLanguage(params.question, hits),
      mode: params.mode,
      hits,
      evidence,
      dataDir: params.dataDir,
      backend: params.backend,
      provider: params.provider,
      model: params.model,
      openAICompatible: params.openAICompatible,
      onDelta: params.onDelta,
    });
    const validated = finalizeValidatedAnswer({
      question: effectiveQuestion,
      state: effectiveState,
      mode: params.mode,
      hits,
      answer,
      evidence,
      flags,
    });
    return {
      route: "search",
      hits,
      answer: {
        ...validated,
        trace: {
          ...baseTrace,
          ...validated.trace,
          route: "search",
          state: effectiveState,
          answerSurface: validated.answerSurface,
          transitions: [
            "clarification_reuse",
            ...((validated.trace?.transitions as string[] | undefined) ?? []).filter(Boolean),
          ],
        },
        followUpSource: "clarification_reuse",
        continuedFromRunId,
        rewrittenQuestion: effectiveQuestion,
      },
    };
  }

  const greetingIntent = detectGreetingIntent(effectiveQuestion);
  if (greetingIntent) {
    return {
      route: "greeting",
      hits: [],
      answer: {
        ...(await buildGreetingAnswer({
          question: effectiveQuestion,
          mode: params.mode,
          docsRoot: params.docsRoot,
          dataDir: params.dataDir,
          match: greetingIntent,
        })),
        trace: {
          ...baseTrace,
          route: "greeting",
          state: effectiveState,
          transitions: [],
        },
      },
    };
  }

  const memoryMatch = await findAnswerMemoryMatch({
    question: effectiveQuestion,
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
        followUpSource: clarificationFollowUp ? "clarification_rewrite" : undefined,
        continuedFromRunId,
        rewrittenQuestion: clarificationFollowUp ? effectiveQuestion : undefined,
        trace: {
          ...baseTrace,
          route: "memory",
          state: effectiveState,
          memory: {
            kind: "answer_memory",
            entryId: memoryMatch.entry.entryId,
            score: memoryMatch.score,
          },
          transitions: ["memory_hit"],
        },
      },
    };
  }

  const retrievalMemoryMatch = await findRetrievalMemoryMatch({
    question: effectiveQuestion,
    dataDir: params.dataDir,
  });
  const retrievalOverrides: RetrievalOverrides | undefined = retrievalMemoryMatch
    ? {
        preferredPaths: retrievalMemoryMatch.entry.preferredPaths,
        discouragedPaths: retrievalMemoryMatch.entry.discouragedPaths,
      }
    : undefined;
  const retrieval = flags.stagedRetrieval
    ? await runStagedRetrieval({
        question: effectiveQuestion,
        state: effectiveState,
        docsRoot: params.docsRoot,
        dataDir: params.dataDir,
        maxResults: params.maxResults,
        overrides: retrievalOverrides,
      })
    : {
        hits: [] as DocSearchHit[],
        plan: buildRetrievalPlan({
          state: effectiveState,
          maxResults: params.maxResults,
        }),
        trace: {
          primaryQueries: [],
          expansionQueries: [],
          mergedHitCount: 0,
        },
      };
  const legacyHits = await searchDocs({
    query: effectiveQuestion,
    docsRoot: params.docsRoot,
    dataDir: params.dataDir,
    maxResults: params.maxResults,
    refinement: {
      taskKind: clarificationFollowUp?.taskKind ?? effectiveState.taskKind,
      preferredDocShape: clarificationFollowUp?.preferredDocShape,
    },
    overrides: retrievalOverrides,
  });
  const mergedHits: DocSearchHit[] = [];
  const seenHitKeys = new Set<string>();
  for (const hit of [...legacyHits, ...retrieval.hits]) {
    const key = `${hit.path}:${hit.startLine}:${hit.endLine}`;
    if (seenHitKeys.has(key)) {
      continue;
    }
    seenHitKeys.add(key);
    mergedHits.push(hit);
  }
  const hits = filterHitsForResolvedState(mergedHits, effectiveState).slice(
    0,
    params.maxResults ?? 5,
  );
  await params.onRetrieved?.(hits);
  const evidence = flags.evidencePack
    ? buildEvidencePack({
        state: effectiveState,
        hits,
      })
    : buildEvidencePack({
        state: effectiveState,
        hits,
        totalBudgetChars: Number.MAX_SAFE_INTEGER,
        groupBudgetChars: Number.MAX_SAFE_INTEGER,
      });
  const insufficient = maybeReturnInsufficientEvidence({
    question: effectiveQuestion,
    state: effectiveState,
    mode: params.mode,
    hits,
  });
  if (insufficient) {
    return {
      route: "search",
      hits,
      answer: {
        ...insufficient,
        trace: {
          ...baseTrace,
          route: "search",
          state: effectiveState,
          retrieval: retrieval.trace,
          evidence: {
            groupCount: evidence.groups.length,
            warnings: evidence.warnings,
            trimEvents: evidence.trimEvents,
          },
          memory: retrievalMemoryMatch
            ? {
                kind: "retrieval_memory",
                score: retrievalMemoryMatch.score,
                preferredPaths: retrievalMemoryMatch.entry.preferredPaths,
                discouragedPaths: retrievalMemoryMatch.entry.discouragedPaths,
              }
            : undefined,
          transitions: ["insufficient_evidence"],
        },
        followUpSource: clarificationFollowUp ? "clarification_rewrite" : undefined,
        continuedFromRunId,
        rewrittenQuestion: clarificationFollowUp ? effectiveQuestion : undefined,
      },
    };
  }
  const clarification = flags.clarificationPolicy
    ? maybeReturnClarification({
        question: effectiveQuestion,
        state: effectiveState,
        mode: params.mode,
        hits,
      })
    : null;
  if (clarification) {
    return {
      route: "search",
      hits,
      answer: {
        ...clarification,
        trace: {
          ...baseTrace,
          route: "search",
          state: effectiveState,
          clarification: {
            kind: clarification.pendingClarificationKind,
          },
          retrieval: retrieval.trace,
          evidence: {
            groupCount: evidence.groups.length,
            warnings: evidence.warnings,
            trimEvents: evidence.trimEvents,
          },
          memory: retrievalMemoryMatch
            ? {
                kind: "retrieval_memory",
                score: retrievalMemoryMatch.score,
                preferredPaths: retrievalMemoryMatch.entry.preferredPaths,
                discouragedPaths: retrievalMemoryMatch.entry.discouragedPaths,
              }
            : undefined,
          transitions: ["clarification_required"],
        },
        followUpSource: clarificationFollowUp ? "clarification_rewrite" : undefined,
        continuedFromRunId,
        rewrittenQuestion: clarificationFollowUp ? effectiveQuestion : undefined,
      },
    };
  }
  const answer = await buildDocAnswer({
    runId: params.runId,
    question: effectiveQuestion,
    language: detectAnswerLanguage(params.question, hits),
    mode: params.mode,
    hits,
    evidence,
    dataDir: params.dataDir,
    backend: params.backend,
    provider: params.provider,
    model: params.model,
    openAICompatible: params.openAICompatible,
    onDelta: params.onDelta,
  });
  const validated = finalizeValidatedAnswer({
    question: effectiveQuestion,
    state: effectiveState,
    mode: params.mode,
    hits,
    answer,
    evidence,
    flags,
    retrievalTrace: retrieval.trace,
  });
  return {
    route: "search",
    hits,
    answer: {
      ...validated,
      trace: {
        ...baseTrace,
        ...validated.trace,
        route: "search",
        state: effectiveState,
        memory: retrievalMemoryMatch
          ? {
              kind: "retrieval_memory",
              score: retrievalMemoryMatch.score,
              preferredPaths: retrievalMemoryMatch.entry.preferredPaths,
              discouragedPaths: retrievalMemoryMatch.entry.discouragedPaths,
              requiredClarification: retrievalMemoryMatch.entry.requiredClarification,
            }
          : undefined,
        answerSurface: validated.answerSurface,
        transitions: [
          ...(retrievalMemoryMatch ? ["retrieval_memory_override"] : []),
          ...((validated.trace?.transitions as string[] | undefined) ?? []).filter(Boolean),
        ],
      },
      followUpSource: clarificationFollowUp ? "clarification_rewrite" : undefined,
      continuedFromRunId,
      rewrittenQuestion: clarificationFollowUp ? effectiveQuestion : undefined,
    },
  };
}

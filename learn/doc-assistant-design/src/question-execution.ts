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
import { buildEvidencePack, type EvidencePack } from "./evidence-pack.js";
import { getDocAssistantFeatureFlags } from "./feature-flags.js";
import {
  detectClarificationFollowUpQuestion,
  detectContextualFollowUpQuestion,
  extractQuestionStatePatchFromFollowUp,
  getStoredClarificationContext,
  isStoredClarificationFollowUpAllowed,
  mergeStoredStateWithFollowUp,
  rewriteContextualFollowUpQuestion,
  rewriteTaskFocusClarificationQuestion,
  selectPlatformHits,
  shouldReuseClarificationHits,
} from "./follow-up-context.js";
import { buildGreetingAnswer, detectGreetingIntent } from "./greeting-intent.js";
import { detectFollowUpRewriteWithOpenAICompatible } from "./openai-compatible.js";
import type { DocAssistantMode, DocSearchHit, OpenAICompatibleConfig } from "./protocol/index.js";
import { isBroadIntegrationRequest } from "./question-anchors.js";
import {
  buildQuestionState,
  detectQuestionProduct,
  mergeQuestionState,
  rewriteQuestionFromState,
  type QuestionState,
} from "./question-state.js";
import { resolveRetrievalBudget, type RetrievalBudget } from "./retrieval-budget.js";
import { findRetrievalMemoryMatch } from "./retrieval-memory.js";
import { buildRetrievalPlan } from "./retrieval-plan.js";
import { createDocAssistantTrace } from "./trace.js";

// This is the top-level runtime entry for one doc-assistant turn. `methods/docs.ts` calls
// `executeDocQuestion()`, and this file coordinates follow-up handling, retrieval, answerability,
// grounded answer generation, optional agent rewrite, and trace persistence.
function filterHitsForResolvedState(hits: DocSearchHit[], state: QuestionState): DocSearchHit[] {
  let filteredHits = hits;
  if (state.product) {
    const matchingProductHits = filteredHits.filter((hit) => {
      return (
        detectQuestionProduct([hit.path, hit.heading ?? "", hit.text].join("\n")) === state.product
      );
    });
    if (matchingProductHits.length > 0) {
      filteredHits = matchingProductHits;
    }
  }
  if (!state.platform) {
    return filteredHits;
  }
  const platformTerms =
    state.platform === "ios"
      ? ["ios", "iphone", "ipad"]
      : state.platform === "web"
        ? ["web", "browser", "javascript"]
        : state.platform === "flutter"
          ? ["flutter", "dart"]
          : ["android"];
  const matching = filteredHits.filter((hit) => {
    const normalized = [hit.path, hit.heading ?? "", hit.text].join("\n").toLowerCase();
    return platformTerms.some((term) => normalized.includes(term));
  });
  return matching.length > 0 ? matching : filteredHits;
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
  const clarification = decideClarification({
    state: params.state,
    hits: params.hits,
  });
  if (
    clarification.shouldClarify &&
    (clarification.kind === "task_focus" ||
      clarification.kind === "platform" ||
      clarification.kind === "channel_kind" ||
      clarification.kind === "api_layer")
  ) {
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

type RetrievalTrace = {
  pass: "initial" | "retry";
  primaryQueries: Array<{ purpose: string; query: string; hitCount: number }>;
  expansionQueries: Array<{ purpose: string; query: string; hitCount: number }>;
  mergedHitCount: number;
  budget: {
    source: RetrievalBudget["source"];
    hitLimit: number;
    maxPrimaryQueries: number;
    maxExpansionQueries: number;
    evidenceTotalBudgetChars: number;
    evidenceGroupBudgetChars: number;
    reasons: string[];
    complexityScore: number;
    overrideMaxResults?: number;
  };
};

function buildEvidenceForBudget(params: {
  state: QuestionState;
  hits: DocSearchHit[];
  budget: RetrievalBudget;
  useEvidencePack: boolean;
}): EvidencePack {
  if (!params.useEvidencePack) {
    return buildEvidencePack({
      state: params.state,
      hits: params.hits,
      totalBudgetChars: Number.MAX_SAFE_INTEGER,
      groupBudgetChars: Number.MAX_SAFE_INTEGER,
    });
  }
  return buildEvidencePack({
    state: params.state,
    hits: params.hits,
    totalBudgetChars: params.budget.evidenceTotalBudgetChars,
    groupBudgetChars: params.budget.evidenceGroupBudgetChars,
  });
}

function shouldRetryRetrieval(params: {
  question: string;
  state: QuestionState;
  hits: DocSearchHit[];
  evidence: EvidencePack;
  budget: RetrievalBudget;
  clarificationDecision: ReturnType<typeof decideClarification>;
}): { retry: boolean; reasons: string[] } {
  if (
    params.budget.source === "override" ||
    params.budget.retryHitLimit <= params.budget.hitLimit
  ) {
    return { retry: false, reasons: [] };
  }

  if (
    params.clarificationDecision.shouldClarify &&
    (params.clarificationDecision.kind === "task_focus" ||
      params.clarificationDecision.kind === "platform" ||
      params.clarificationDecision.kind === "channel_kind" ||
      params.clarificationDecision.kind === "api_layer" ||
      params.clarificationDecision.kind === "product")
  ) {
    return { retry: false, reasons: [] };
  }

  const reasons: string[] = [];
  if (params.hits.length > 0 && params.hits.length < Math.min(4, params.budget.hitLimit)) {
    reasons.push("low_hit_count");
  }
  if (params.evidence.warnings.length > 0) {
    reasons.push(...params.evidence.warnings);
  }
  if (
    params.state.intent === "mixed" &&
    (!params.hits.some((hit) => hit.retrievalBucket === "concept") ||
      !params.hits.some((hit) => hit.retrievalBucket === "procedural"))
  ) {
    reasons.push("mixed_question_unbalanced_hits");
  }
  const answerability = decideAnswerability({
    question: params.question,
    hits: params.hits,
    state: params.state,
  });
  if (
    answerability.verdict !== "answerable" &&
    answerability.reason.toLowerCase().includes("missing required anchors")
  ) {
    reasons.push("missing_required_anchors");
  }

  return {
    retry: reasons.length > 0,
    reasons,
  };
}

async function runStagedRetrieval(params: {
  question: string;
  state: QuestionState;
  docsRoot: string;
  dataDir?: string;
  maxResults?: number;
  budget?: RetrievalBudget;
  overrides?: RetrievalOverrides;
  pass: "initial" | "retry";
}): Promise<{
  hits: DocSearchHit[];
  plan: ReturnType<typeof buildRetrievalPlan>;
  trace: RetrievalTrace;
}> {
  const plan = buildRetrievalPlan({
    state: params.state,
    maxResults: params.maxResults,
    budget: params.budget,
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
    params.state.anchors.nounPhrases.length > 0 ||
    params.state.anchors.constraints.length > 0 ||
    params.state.anchors.apiSymbols.length > 0 ||
    params.state.anchors.verbPhrases.length > 0;

  if (!allowExpansionQueries) {
    return {
      hits: merged.slice(0, params.budget?.hitLimit ?? params.maxResults ?? 5),
      plan,
      trace: {
        pass: params.pass,
        primaryQueries,
        expansionQueries,
        mergedHitCount: merged.length,
        budget: {
          source: params.budget?.source ?? "override",
          hitLimit: params.budget?.hitLimit ?? params.maxResults ?? 5,
          maxPrimaryQueries: params.budget?.maxPrimaryQueries ?? 3,
          maxExpansionQueries: params.budget?.maxExpansionQueries ?? 4,
          evidenceTotalBudgetChars: params.budget?.evidenceTotalBudgetChars ?? 5_000,
          evidenceGroupBudgetChars: params.budget?.evidenceGroupBudgetChars ?? 1_200,
          reasons: params.budget?.reasons ?? ["manual_override"],
          complexityScore: params.budget?.complexityScore ?? 0,
          overrideMaxResults: params.budget?.overrideMaxResults,
        },
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
    hits: merged.slice(0, params.budget?.hitLimit ?? params.maxResults ?? 5),
    plan,
    trace: {
      pass: params.pass,
      primaryQueries,
      expansionQueries,
      mergedHitCount: merged.length,
      budget: {
        source: params.budget?.source ?? "override",
        hitLimit: params.budget?.hitLimit ?? params.maxResults ?? 5,
        maxPrimaryQueries: params.budget?.maxPrimaryQueries ?? 3,
        maxExpansionQueries: params.budget?.maxExpansionQueries ?? 4,
        evidenceTotalBudgetChars: params.budget?.evidenceTotalBudgetChars ?? 5_000,
        evidenceGroupBudgetChars: params.budget?.evidenceGroupBudgetChars ?? 1_200,
        reasons: params.budget?.reasons ?? ["manual_override"],
        complexityScore: params.budget?.complexityScore ?? 0,
        overrideMaxResults: params.budget?.overrideMaxResults,
      },
    },
  };
}

async function runRetrievalPass(params: {
  question: string;
  state: QuestionState;
  docsRoot: string;
  dataDir?: string;
  budget: RetrievalBudget;
  flags: ReturnType<typeof getDocAssistantFeatureFlags>;
  pass: "initial" | "retry";
  preferredDocShape?: "quickstart_step" | "specialized_task";
  overrides?: RetrievalOverrides;
}): Promise<{
  hits: DocSearchHit[];
  evidence: EvidencePack;
  retrievalTrace: RetrievalTrace;
}> {
  const retrieval = params.flags.stagedRetrieval
    ? await runStagedRetrieval({
        question: params.question,
        state: params.state,
        docsRoot: params.docsRoot,
        dataDir: params.dataDir,
        budget: params.budget,
        overrides: params.overrides,
        pass: params.pass,
      })
    : {
        hits: [] as DocSearchHit[],
        plan: buildRetrievalPlan({
          state: params.state,
          budget: params.budget,
        }),
        trace: {
          pass: params.pass,
          primaryQueries: [],
          expansionQueries: [],
          mergedHitCount: 0,
          budget: {
            source: params.budget.source,
            hitLimit: params.budget.hitLimit,
            maxPrimaryQueries: params.budget.maxPrimaryQueries,
            maxExpansionQueries: params.budget.maxExpansionQueries,
            evidenceTotalBudgetChars: params.budget.evidenceTotalBudgetChars,
            evidenceGroupBudgetChars: params.budget.evidenceGroupBudgetChars,
            reasons: params.budget.reasons,
            complexityScore: params.budget.complexityScore,
            overrideMaxResults: params.budget.overrideMaxResults,
          },
        },
      };
  const legacyHits = await searchDocs({
    query: params.question,
    docsRoot: params.docsRoot,
    dataDir: params.dataDir,
    maxResults: params.budget.hitLimit,
    refinement: {
      preferredDocShape: params.preferredDocShape,
      focusAnchors: [
        ...params.state.anchors.nounPhrases,
        ...params.state.anchors.constraints,
        ...params.state.anchors.apiSymbols,
      ],
    },
    overrides: params.overrides,
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
  const hits = filterHitsForResolvedState(mergedHits, params.state).slice(
    0,
    params.budget.hitLimit,
  );
  const evidence = buildEvidenceForBudget({
    state: params.state,
    hits,
    budget: params.budget,
    useEvidencePack: params.flags.evidencePack,
  });
  return {
    hits,
    evidence,
    retrievalTrace: retrieval.trace,
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
  retrievalTrace?: Record<string, unknown>;
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
  const contextualFollowUp = detectContextualFollowUpQuestion(params.question);
  const clarificationFollowUp =
    params.sessionId && (followUpMatch || contextualFollowUp || flags.llmFollowUp)
      ? await getStoredClarificationContext(params.sessionId, params.dataDir)
      : null;
  const followUpPatch = followUpMatch
    ? extractQuestionStatePatchFromFollowUp(
        params.question,
        clarificationFollowUp?.clarificationKind,
      )
    : null;
  const followUpBaseQuestion =
    clarificationFollowUp?.pendingQuestion ?? clarificationFollowUp?.originalQuestion;
  const followUpBaseState = followUpBaseQuestion
    ? mergeQuestionState(
        buildQuestionState(followUpBaseQuestion),
        clarificationFollowUp?.questionState ?? {},
      )
    : undefined;
  const acceptedClarificationFollowUp = Boolean(
    clarificationFollowUp &&
    followUpMatch &&
    isStoredClarificationFollowUpAllowed(clarificationFollowUp, followUpMatch),
  );
  const llmFollowUpRewrite =
    !followUpMatch &&
    !contextualFollowUp &&
    flags.llmFollowUp &&
    params.openAICompatible &&
    clarificationFollowUp &&
    !clarificationFollowUp.clarificationKind &&
    followUpBaseQuestion
      ? await detectFollowUpRewriteWithOpenAICompatible({
          config: {
            ...params.openAICompatible,
            model: params.model ?? params.openAICompatible.model,
          },
          previousQuestion: followUpBaseQuestion,
          currentQuestion: params.question,
        })
      : undefined;
  const acceptedLlmFollowUp = Boolean(llmFollowUpRewrite && followUpBaseQuestion);
  const acceptedContextualFollowUp = Boolean(
    clarificationFollowUp &&
    contextualFollowUp &&
    !clarificationFollowUp.clarificationKind &&
    followUpBaseQuestion,
  );
  const taskFocusFollowUp =
    acceptedClarificationFollowUp &&
    clarificationFollowUp?.clarificationKind === "task_focus" &&
    followUpMatch?.taskFocus &&
    followUpBaseState &&
    followUpBaseQuestion
      ? followUpMatch.taskFocus
      : undefined;
  const effectiveTaskFocusQuestion =
    taskFocusFollowUp && followUpBaseQuestion
      ? rewriteTaskFocusClarificationQuestion(followUpBaseQuestion, taskFocusFollowUp)
      : undefined;
  const effectiveTaskFocusState =
    effectiveTaskFocusQuestion && followUpBaseState
      ? mergeStoredStateWithFollowUp(buildQuestionState(effectiveTaskFocusQuestion), {
          platform: followUpBaseState.platform,
          product: followUpBaseState.product,
          apiLayer: followUpBaseState.apiLayer,
          channelKind: followUpBaseState.channelKind,
          referent: followUpBaseState.referent,
        })
      : undefined;
  const effectiveContextualQuestion =
    acceptedContextualFollowUp && followUpBaseQuestion && contextualFollowUp
      ? rewriteContextualFollowUpQuestion(followUpBaseQuestion, contextualFollowUp)
      : undefined;
  const effectiveContextualState = effectiveContextualQuestion
    ? buildQuestionState(effectiveContextualQuestion)
    : undefined;
  const effectiveLlmFollowUpState = llmFollowUpRewrite
    ? buildQuestionState(llmFollowUpRewrite)
    : undefined;
  const effectiveState = effectiveTaskFocusState
    ? effectiveTaskFocusState
    : effectiveLlmFollowUpState
      ? effectiveLlmFollowUpState
      : effectiveContextualState
        ? effectiveContextualState
        : flags.questionState && acceptedClarificationFollowUp && followUpPatch && followUpBaseState
          ? mergeStoredStateWithFollowUp(followUpBaseState, followUpPatch)
          : initialState;
  const effectiveQuestion = effectiveTaskFocusQuestion
    ? effectiveTaskFocusQuestion
    : llmFollowUpRewrite
      ? llmFollowUpRewrite
      : effectiveContextualQuestion
        ? effectiveContextualQuestion
        : flags.questionState && acceptedClarificationFollowUp && followUpPatch && followUpBaseState
          ? rewriteQuestionFromState(effectiveState)
          : params.question;
  const effectiveQuestionState = buildQuestionState(effectiveQuestion);
  const continuedFromRunId = clarificationFollowUp?.runId;
  const selectedPlatform = acceptedClarificationFollowUp ? followUpPatch?.platform : undefined;
  const canReuseClarificationHits = Boolean(
    clarificationFollowUp &&
    selectedPlatform &&
    !isBroadIntegrationRequest(effectiveQuestionState) &&
    shouldReuseClarificationHits(clarificationFollowUp, selectedPlatform),
  );
  const resolvedFollowUpSource =
    acceptedClarificationFollowUp && canReuseClarificationHits
      ? "clarification_reuse"
      : acceptedLlmFollowUp || acceptedContextualFollowUp
        ? "contextual_rewrite"
        : acceptedClarificationFollowUp || clarificationFollowUp
          ? "clarification_rewrite"
          : "none";
  const retrievalBudget = resolveRetrievalBudget({
    state: effectiveState,
    overrideMaxResults: params.maxResults,
    followUpSource: resolvedFollowUpSource,
  });

  if (
    clarificationFollowUp &&
    followUpMatch &&
    !acceptedClarificationFollowUp &&
    followUpBaseQuestion &&
    followUpBaseState
  ) {
    const clarification = maybeReturnClarification({
      question: followUpBaseQuestion,
      state: followUpBaseState,
      mode: params.mode,
      hits: clarificationFollowUp.hits,
    });
    if (clarification) {
      const evidence = buildEvidencePack({
        state: followUpBaseState,
        hits: clarificationFollowUp.hits,
      });
      return {
        route: "search",
        hits: clarificationFollowUp.hits,
        answer: {
          ...clarification,
          pendingClarificationQuestion: followUpBaseQuestion,
          trace: {
            ...baseTrace,
            route: "search",
            state: followUpBaseState,
            clarification: {
              kind: clarification.pendingClarificationKind,
            },
            evidence: {
              groupCount: evidence.groups.length,
              warnings: evidence.warnings,
              trimEvents: evidence.trimEvents,
            },
            transitions: ["invalid_clarification_followup", "clarification_required"],
          },
        },
      };
    }
  }

  if (clarificationFollowUp && selectedPlatform && canReuseClarificationHits) {
    const hits = selectPlatformHits(clarificationFollowUp.hits, selectedPlatform);
    await params.onRetrieved?.(hits);
    const evidence = buildEvidenceForBudget({
      state: effectiveState,
      hits,
      budget: retrievalBudget,
      useEvidencePack: flags.evidencePack,
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
            retrievalBudget: {
              ...retrievalBudget,
              retryUsed: false,
            },
            transitions: ["clarification_reuse", "insufficient_evidence"],
          },
          followUpSource: acceptedClarificationFollowUp ? "clarification_reuse" : undefined,
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
            retrievalBudget: {
              ...retrievalBudget,
              retryUsed: false,
            },
            transitions: ["clarification_reuse", "clarification_required"],
          },
          followUpSource: acceptedClarificationFollowUp ? "clarification_reuse" : undefined,
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
      docsRoot: params.docsRoot,
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
          retrievalBudget: {
            ...retrievalBudget,
            retryUsed: false,
          },
        },
        followUpSource: acceptedClarificationFollowUp ? "clarification_reuse" : undefined,
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
        followUpSource: acceptedLlmFollowUp
          ? "contextual_rewrite"
          : acceptedContextualFollowUp
            ? "contextual_rewrite"
            : clarificationFollowUp
              ? "clarification_rewrite"
              : undefined,
        continuedFromRunId,
        rewrittenQuestion:
          acceptedLlmFollowUp || acceptedContextualFollowUp || clarificationFollowUp
            ? effectiveQuestion
            : undefined,
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
  let retrievalPass = await runRetrievalPass({
    question: effectiveQuestion,
    state: effectiveState,
    docsRoot: params.docsRoot,
    dataDir: params.dataDir,
    budget: retrievalBudget,
    flags,
    pass: "initial",
    preferredDocShape: clarificationFollowUp?.preferredDocShape,
    overrides: retrievalOverrides,
  });
  const initialRetrievalTrace = retrievalPass.retrievalTrace;
  const clarificationDecision = decideClarification({
    state: effectiveState,
    hits: retrievalPass.hits,
  });
  const retryDecision = shouldRetryRetrieval({
    question: effectiveQuestion,
    state: effectiveState,
    hits: retrievalPass.hits,
    evidence: retrievalPass.evidence,
    budget: retrievalBudget,
    clarificationDecision,
  });
  let retryUsed = false;
  if (retryDecision.retry) {
    const retryBudget: RetrievalBudget = {
      ...retrievalBudget,
      hitLimit: retrievalBudget.retryHitLimit,
      evidenceTotalBudgetChars: retrievalBudget.retryEvidenceTotalBudgetChars,
      evidenceGroupBudgetChars: retrievalBudget.retryEvidenceGroupBudgetChars,
    };
    retrievalPass = await runRetrievalPass({
      question: effectiveQuestion,
      state: effectiveState,
      docsRoot: params.docsRoot,
      dataDir: params.dataDir,
      budget: retryBudget,
      flags,
      pass: "retry",
      preferredDocShape: clarificationFollowUp?.preferredDocShape,
      overrides: retrievalOverrides,
    });
    retryUsed = true;
  }
  const hits = retrievalPass.hits;
  const evidence = retrievalPass.evidence;
  await params.onRetrieved?.(hits);
  const retrievalTrace = retryUsed
    ? {
        initialPass: initialRetrievalTrace,
        finalPass: retrievalPass.retrievalTrace,
        retry: {
          used: true,
          reasons: retryDecision.reasons,
          fromHitLimit: retrievalBudget.hitLimit,
          toHitLimit: retrievalPass.retrievalTrace.budget.hitLimit,
        },
      }
    : initialRetrievalTrace;
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
          retrieval: retrievalTrace,
          evidence: {
            groupCount: evidence.groups.length,
            warnings: evidence.warnings,
            trimEvents: evidence.trimEvents,
          },
          retrievalBudget: {
            ...retrievalBudget,
            retryUsed,
            retryReasons: retryDecision.reasons,
            finalHitLimit: retrievalPass.retrievalTrace.budget.hitLimit,
          },
          memory: retrievalMemoryMatch
            ? {
                kind: "retrieval_memory",
                score: retrievalMemoryMatch.score,
                preferredPaths: retrievalMemoryMatch.entry.preferredPaths,
                discouragedPaths: retrievalMemoryMatch.entry.discouragedPaths,
              }
            : undefined,
          transitions: [
            ...(retryUsed ? ["retrieval_retry_expanded"] : []),
            "insufficient_evidence",
          ],
        },
        followUpSource: resolvedFollowUpSource === "none" ? undefined : resolvedFollowUpSource,
        continuedFromRunId,
        rewrittenQuestion:
          acceptedLlmFollowUp || acceptedContextualFollowUp || clarificationFollowUp
            ? effectiveQuestion
            : undefined,
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
          retrieval: retrievalTrace,
          evidence: {
            groupCount: evidence.groups.length,
            warnings: evidence.warnings,
            trimEvents: evidence.trimEvents,
          },
          retrievalBudget: {
            ...retrievalBudget,
            retryUsed,
            retryReasons: retryDecision.reasons,
            finalHitLimit: retrievalPass.retrievalTrace.budget.hitLimit,
          },
          memory: retrievalMemoryMatch
            ? {
                kind: "retrieval_memory",
                score: retrievalMemoryMatch.score,
                preferredPaths: retrievalMemoryMatch.entry.preferredPaths,
                discouragedPaths: retrievalMemoryMatch.entry.discouragedPaths,
              }
            : undefined,
          transitions: [
            ...(retryUsed ? ["retrieval_retry_expanded"] : []),
            "clarification_required",
          ],
        },
        followUpSource: resolvedFollowUpSource === "none" ? undefined : resolvedFollowUpSource,
        continuedFromRunId,
        rewrittenQuestion:
          acceptedLlmFollowUp || acceptedContextualFollowUp || clarificationFollowUp
            ? effectiveQuestion
            : undefined,
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
    docsRoot: params.docsRoot,
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
    retrievalTrace: retrievalTrace,
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
        retrievalBudget: {
          ...retrievalBudget,
          retryUsed,
          retryReasons: retryDecision.reasons,
          finalHitLimit: retrievalPass.retrievalTrace.budget.hitLimit,
        },
        answerSurface: validated.answerSurface,
        transitions: [
          ...(retryUsed ? ["retrieval_retry_expanded"] : []),
          ...(retrievalMemoryMatch ? ["retrieval_memory_override"] : []),
          ...((validated.trace?.transitions as string[] | undefined) ?? []).filter(Boolean),
        ],
      },
      followUpSource: resolvedFollowUpSource === "none" ? undefined : resolvedFollowUpSource,
      continuedFromRunId,
      rewrittenQuestion:
        acceptedLlmFollowUp || acceptedContextualFollowUp || clarificationFollowUp
          ? effectiveQuestion
          : undefined,
    },
  };
}

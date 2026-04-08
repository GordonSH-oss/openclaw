import path from "node:path";
import { isNonCacheableSummary } from "./answer-cache-policy.js";
import {
  compressConversationContext,
  type StoredConversationSummaryLike,
} from "./context-compressor.js";
import type { DocAnswerResult } from "./doc-answer.js";
import { readJsonSafe, writeJsonAtomic } from "./persistence.js";
import type { ConversationPromptContext, DocFollowUpSource } from "./protocol/index.js";
import { summarizeAnchorFocus } from "./question-anchors.js";
import {
  buildQuestionState,
  mergeQuestionState,
  rewriteQuestionFromState,
  type QuestionAction,
  type QuestionState,
} from "./question-state.js";
import { normalizeSearchText } from "./search-text.js";
import { buildTaskFrame } from "./task-frame.js";
import { loadDocAssistantTranscript, type LearningTranscriptMessage } from "./transcript-store.js";
import { resolveDocAssistantDataDir } from "./user-store.js";

type ConversationStableState = {
  product?: QuestionState["product"];
  platform?: QuestionState["platform"];
  apiLayer?: QuestionState["apiLayer"];
  channelKind?: QuestionState["channelKind"];
  referent?: string;
};

type ConversationTaskAnchors = {
  focus: string[];
  verbs: string[];
  constraints: string[];
  apiSymbols: string[];
};

type OpenClarificationState = {
  kind?: "platform" | "channel_kind" | "api_layer" | "product" | "task_focus" | "referent";
  pendingQuestion?: string;
};

export type StoredConversationContext = StoredConversationSummaryLike & {
  sessionId: string;
  lastResolvedRunId?: string;
  stableState: ConversationStableState;
  taskAnchors: ConversationTaskAnchors;
  openClarification?: OpenClarificationState;
  updatedAt: number;
};

type ConversationContextStore = Record<string, StoredConversationContext>;

export type ResolvedConversationContext = {
  effectiveQuestion: string;
  effectiveState: QuestionState;
  followUpSource?: Extract<DocFollowUpSource, "conversation_rewrite">;
  continuedFromRunId?: string;
  promptContext?: ConversationPromptContext;
  traceContext: {
    source: "conversation_context" | "conversation_rewrite" | "blocked";
    compressionTier: string;
    selectedTurnCount: number;
    summaryUsed: boolean;
    promptChars: number;
    usedStableState: boolean;
    blockedReason?: string;
  };
};

const REFERENCE_LANGUAGE_PATTERNS = [
  /\bit\b/i,
  /\bthat\b/i,
  /\bthis\b/i,
  /\bthem\b/i,
  /\bthose\b/i,
  /\bthese\b/i,
  /\bprevious\b/i,
  /\babove\b/i,
  /它/u,
  /这个/u,
  /上面/u,
];

function getConversationContextPath(dataDir?: string): string {
  return path.join(resolveDocAssistantDataDir(dataDir), "conversation-context.json");
}

async function loadConversationContextStore(dataDir?: string): Promise<ConversationContextStore> {
  return await readJsonSafe<ConversationContextStore>(getConversationContextPath(dataDir), {});
}

async function saveConversationContextStore(
  store: ConversationContextStore,
  dataDir?: string,
): Promise<void> {
  await writeJsonAtomic(getConversationContextPath(dataDir), store);
}

function dedupe(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).filter(Boolean);
}

function extractTranscriptText(content: LearningTranscriptMessage["content"]): string {
  if (typeof content === "string") {
    return content.trim();
  }
  return content
    .map((part) => {
      if (part.type === "text") {
        return part.text;
      }
      if (part.type === "tool_result") {
        return part.content;
      }
      return "";
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function countSpecificAnchors(state: QuestionState): number {
  return (
    state.anchors.nounPhrases.length +
    state.anchors.constraints.length +
    state.anchors.apiSymbols.length +
    state.anchors.qualifiers.length
  );
}

function containsReferenceLanguage(question: string): boolean {
  return REFERENCE_LANGUAGE_PATTERNS.some((pattern) => pattern.test(question));
}

function getClarificationKind(
  answer: Pick<DocAnswerResult, "summary" | "pendingClarificationKind">,
): OpenClarificationState["kind"] {
  if (answer.pendingClarificationKind) {
    return answer.pendingClarificationKind;
  }
  if (answer.summary === "platform clarification required") {
    return "platform";
  }
  if (answer.summary === "channel clarification required") {
    return "channel_kind";
  }
  if (answer.summary === "api layer clarification required") {
    return "api_layer";
  }
  if (answer.summary === "product clarification required") {
    return "product";
  }
  if (answer.summary === "task clarification required") {
    return "task_focus";
  }
  return undefined;
}

function toStableState(state: QuestionState): ConversationStableState {
  return {
    product: state.product,
    platform: state.platform,
    apiLayer: state.apiLayer,
    channelKind: state.channelKind,
    referent: state.referent,
  };
}

function sanitizeTaskAnchors(value: unknown): ConversationTaskAnchors | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const anchors = raw.anchors as Record<string, unknown> | undefined;
  const toStringArray = (input: unknown): string[] =>
    Array.isArray(input)
      ? input.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      : [];
  const focus = toStringArray(anchors?.focus);
  const verbs = toStringArray(anchors?.verbs);
  const constraints = toStringArray(anchors?.constraints);
  const apiSymbols = toStringArray(anchors?.apiSymbols);
  if (
    focus.length === 0 &&
    verbs.length === 0 &&
    constraints.length === 0 &&
    apiSymbols.length === 0
  ) {
    return undefined;
  }
  return {
    focus,
    verbs,
    constraints,
    apiSymbols,
  };
}

function buildTaskAnchorsFromAnswer(
  answer: DocAnswerResult,
  resolvedQuestion: string,
): ConversationTaskAnchors {
  const fromTrace = sanitizeTaskAnchors(answer.trace?.["taskFrame"]);
  if (fromTrace) {
    return fromTrace;
  }
  const state = buildQuestionState(resolvedQuestion);
  const frame = buildTaskFrame({
    question: resolvedQuestion,
    state,
  });
  return {
    focus: frame.anchors.focus,
    verbs: frame.anchors.verbs,
    constraints: frame.anchors.constraints,
    apiSymbols: frame.anchors.apiSymbols,
  };
}

function renderRollingSummary(params: {
  stableState: ConversationStableState;
  taskAnchors: ConversationTaskAnchors;
  lastResolvedQuestion?: string;
  openClarification?: OpenClarificationState;
}): string {
  return [
    params.stableState.product ? `Product: ${params.stableState.product}` : "",
    params.stableState.platform ? `Platform: ${params.stableState.platform}` : "",
    params.stableState.apiLayer ? `API layer: ${params.stableState.apiLayer}` : "",
    params.stableState.channelKind ? `Channel kind: ${params.stableState.channelKind}` : "",
    params.taskAnchors.focus.length > 0
      ? `Current task focus: ${params.taskAnchors.focus.slice(0, 2).join(", ")}`
      : "",
    params.lastResolvedQuestion ? `Last resolved question: ${params.lastResolvedQuestion}` : "",
    params.openClarification?.kind
      ? `Open clarification: ${params.openClarification.kind}${
          params.openClarification.pendingQuestion
            ? ` (${params.openClarification.pendingQuestion})`
            : ""
        }`
      : "",
    params.taskAnchors.constraints.length > 0
      ? `Constraints: ${params.taskAnchors.constraints.slice(0, 2).join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function deriveConversationContextFromTranscript(params: {
  sessionId: string;
  transcript: LearningTranscriptMessage[];
  question: string;
}): StoredConversationContext | null {
  const filtered = params.transcript
    .filter(
      (
        message,
      ): message is LearningTranscriptMessage & {
        role: "user" | "assistant";
      } => message.role === "user" || message.role === "assistant",
    )
    .map((message) => ({
      role: message.role,
      text: extractTranscriptText(message.content),
      timestamp: message.timestamp,
    }))
    .filter((message) => message.text.length > 0);
  const last = filtered.at(-1);
  if (
    last?.role === "user" &&
    normalizeSearchText(last.text) === normalizeSearchText(params.question)
  ) {
    filtered.pop();
  }

  const lastResolvedTurn = filtered.toReversed().find((message) => message.role === "user");
  if (!lastResolvedTurn) {
    return null;
  }

  const state = buildQuestionState(lastResolvedTurn.text);
  const hasUsableState = Boolean(
    state.platform ||
    state.product ||
    state.apiLayer ||
    state.channelKind ||
    state.referent ||
    countSpecificAnchors(state) > 0,
  );
  if (!hasUsableState) {
    return null;
  }

  const frame = buildTaskFrame({
    question: lastResolvedTurn.text,
    state,
  });
  const taskAnchors: ConversationTaskAnchors = {
    focus: frame.anchors.focus,
    verbs: frame.anchors.verbs,
    constraints: frame.anchors.constraints,
    apiSymbols: frame.anchors.apiSymbols,
  };

  return {
    sessionId: params.sessionId,
    lastResolvedQuestion: lastResolvedTurn.text,
    stableState: toStableState(state),
    taskAnchors,
    rollingSummary: renderRollingSummary({
      stableState: toStableState(state),
      taskAnchors,
      lastResolvedQuestion: lastResolvedTurn.text,
    }),
    updatedAt: lastResolvedTurn.timestamp,
  };
}

function hasExplicitConflict(
  state: QuestionState,
  stored: StoredConversationContext,
): string | undefined {
  if (
    state.platform &&
    stored.stableState.platform &&
    state.platform !== stored.stableState.platform
  ) {
    return "explicit_platform_conflict";
  }
  if (state.product && stored.stableState.product && state.product !== stored.stableState.product) {
    return "explicit_product_conflict";
  }
  if (
    state.apiLayer &&
    stored.stableState.apiLayer &&
    state.apiLayer !== stored.stableState.apiLayer
  ) {
    return "explicit_api_layer_conflict";
  }
  if (
    state.channelKind &&
    stored.stableState.channelKind &&
    state.channelKind !== stored.stableState.channelKind
  ) {
    return "explicit_channel_kind_conflict";
  }
  return undefined;
}

function sharesTaskFamily(state: QuestionState, stored: StoredConversationContext): boolean {
  if (stored.stableState.product && state.product && stored.stableState.product !== state.product) {
    return false;
  }
  const currentTerms = new Set(
    dedupe([
      ...summarizeAnchorFocus(state.anchors),
      ...state.anchors.verbPhrases,
      state.heuristicHints?.action ?? "",
      state.heuristicHints?.object ?? "",
    ]),
  );
  const storedTerms = new Set(
    dedupe([
      ...(stored.taskAnchors.focus ?? []),
      ...(stored.taskAnchors.verbs ?? []),
      ...(stored.taskAnchors.constraints ?? []),
      ...(stored.taskAnchors.apiSymbols ?? []),
    ]),
  );
  const overlap = Array.from(currentTerms).filter((term) => storedTerms.has(term)).length;
  if (overlap > 0) {
    return true;
  }
  return Boolean(
    state.heuristicHints?.action &&
    !state.heuristicHints?.object &&
    (stored.taskAnchors.focus.length > 0 || stored.taskAnchors.verbs.length > 0),
  );
}

function deriveTaskFocusNoun(stored: StoredConversationContext): string | undefined {
  const focus = stored.taskAnchors.focus;
  if (focus.includes("message")) {
    return "message";
  }
  for (const noun of [
    "direct channel",
    "group channel",
    "community channel",
    "open channel",
    "notification",
    "webhook",
    "conversation",
    "user",
  ]) {
    if (focus.includes(noun)) {
      return noun;
    }
  }
  return focus[0];
}

function injectTaskFocus(
  question: string,
  noun: string,
  action?: QuestionAction,
  language?: string,
): string {
  const trimmed = question.trim().replace(/[?？!！.。]+$/u, "");
  if (!noun) {
    return trimmed;
  }
  if (language === "zh") {
    if (action === "recall") {
      return trimmed.replace(/(如何|怎么)?撤回/u, (match) => `${match}消息`);
    }
    if (action === "delete") {
      return trimmed.replace(/(如何|怎么)?删除/u, (match) => `${match}消息`);
    }
    return trimmed;
  }

  const article = /^[aeiou]/i.test(noun) ? "an" : "a";
  const patterns: Array<[RegExp, string]> = [
    [/^how to recall\b/i, `How to recall ${article} ${noun}`],
    [/^how do i recall\b/i, `How do I recall ${article} ${noun}`],
    [/^how to delete\b/i, `How to delete ${article} ${noun}`],
    [/^how do i delete\b/i, `How do I delete ${article} ${noun}`],
    [/^how to send\b/i, `How to send ${article} ${noun}`],
    [/^how do i send\b/i, `How do I send ${article} ${noun}`],
    [/^how to query\b/i, `How to query ${article} ${noun}`],
    [/^how do i query\b/i, `How do I query ${article} ${noun}`],
  ];
  for (const [pattern, replacement] of patterns) {
    if (pattern.test(trimmed)) {
      return trimmed.replace(pattern, replacement);
    }
  }
  return trimmed;
}

function buildConversationRewrite(params: {
  question: string;
  currentState: QuestionState;
  stored: StoredConversationContext;
}): {
  rewrittenQuestion?: string;
  rewrittenState?: QuestionState;
  usedStableState: boolean;
  blockedReason?: string;
} {
  const explicitConflict = hasExplicitConflict(params.currentState, params.stored);
  if (explicitConflict) {
    return { usedStableState: false, blockedReason: explicitConflict };
  }

  const hasReference = containsReferenceLanguage(params.question);
  const missingStableSlots =
    (!params.currentState.platform && params.stored.stableState.platform) ||
    (!params.currentState.product && params.stored.stableState.product) ||
    (!params.currentState.apiLayer && params.stored.stableState.apiLayer) ||
    (!params.currentState.channelKind && params.stored.stableState.channelKind);
  const sparseAnchors = countSpecificAnchors(params.currentState) <= 1;
  const shortProcedural =
    params.question.trim().length <= 120 && params.currentState.intent !== "concept";
  const alignedTask = sharesTaskFamily(params.currentState, params.stored);

  if (
    !hasReference &&
    !missingStableSlots &&
    !alignedTask &&
    countSpecificAnchors(params.currentState) >= 2
  ) {
    return { usedStableState: false, blockedReason: "new_topic_detected" };
  }
  if (
    !hasReference &&
    !alignedTask &&
    (params.currentState.intent === "concept" || Boolean(params.currentState.referent)) &&
    countSpecificAnchors(params.currentState) >= 1
  ) {
    return { usedStableState: false, blockedReason: "new_topic_detected" };
  }

  const plausibleDependent = Boolean(
    missingStableSlots ||
    hasReference ||
    (shortProcedural && alignedTask) ||
    (sparseAnchors && alignedTask),
  );
  if (!plausibleDependent) {
    return { usedStableState: false, blockedReason: "standalone_topic" };
  }

  let rewrittenQuestion = params.question.trim().replace(/[?？!！.。]+$/u, "");
  const noun = deriveTaskFocusNoun(params.stored);
  if (!params.currentState.heuristicHints?.object && noun) {
    rewrittenQuestion = injectTaskFocus(
      rewrittenQuestion,
      noun,
      params.currentState.heuristicHints?.action,
      params.currentState.language,
    );
  }

  const rewrittenDraft = buildQuestionState(rewrittenQuestion);
  const mergedState = mergeQuestionState(rewrittenDraft, {
    platform: rewrittenDraft.platform ?? params.stored.stableState.platform,
    product: rewrittenDraft.product ?? params.stored.stableState.product,
    apiLayer: rewrittenDraft.apiLayer ?? params.stored.stableState.apiLayer,
    channelKind: rewrittenDraft.channelKind ?? params.stored.stableState.channelKind,
    referent: rewrittenDraft.referent ?? params.stored.stableState.referent,
  });
  const finalQuestion = rewriteQuestionFromState(mergedState);
  if (finalQuestion === `${params.question.trim().replace(/[?？!！.。]+$/u, "")}?`) {
    return {
      rewrittenQuestion: undefined,
      rewrittenState: params.currentState,
      usedStableState: Boolean(missingStableSlots || noun),
    };
  }
  return {
    rewrittenQuestion: finalQuestion,
    rewrittenState: buildQuestionState(finalQuestion),
    usedStableState: true,
  };
}

export async function getStoredConversationContext(
  sessionId: string,
  dataDir?: string,
): Promise<StoredConversationContext | null> {
  const store = await loadConversationContextStore(dataDir);
  return store[sessionId] ?? null;
}

export async function updateConversationStateAfterAnswer(params: {
  sessionId?: string;
  runId: string;
  question: string;
  answer: DocAnswerResult;
  route?: "greeting" | "memory" | "search";
  dataDir?: string;
}): Promise<void> {
  if (!params.sessionId) {
    return;
  }
  const store = await loadConversationContextStore(params.dataDir);
  const current = store[params.sessionId] ?? {
    sessionId: params.sessionId,
    stableState: {},
    taskAnchors: {
      focus: [],
      verbs: [],
      constraints: [],
      apiSymbols: [],
    },
    updatedAt: Date.now(),
  };

  const clarificationKind = getClarificationKind(params.answer);
  if (clarificationKind) {
    current.openClarification = {
      kind: clarificationKind,
      pendingQuestion: params.answer.pendingClarificationQuestion ?? params.question,
    };
    current.rollingSummary = renderRollingSummary({
      stableState: current.stableState,
      taskAnchors: current.taskAnchors,
      lastResolvedQuestion: current.lastResolvedQuestion,
      openClarification: current.openClarification,
    });
    current.updatedAt = Date.now();
    store[params.sessionId] = current;
    await saveConversationContextStore(store, params.dataDir);
    return;
  }

  const isStableAnswer =
    params.answer.answerSurface?.trust !== "non_authoritative" &&
    params.answer.summary !== "guided greeting" &&
    !isNonCacheableSummary(params.answer.summary);

  if (isStableAnswer && params.route !== "greeting") {
    const resolvedQuestion = params.answer.rewrittenQuestion ?? params.question;
    const resolvedState = buildQuestionState(resolvedQuestion);
    const taskAnchors = buildTaskAnchorsFromAnswer(params.answer, resolvedQuestion);
    current.lastResolvedQuestion = resolvedQuestion;
    current.lastResolvedRunId = params.runId;
    current.stableState = toStableState(resolvedState);
    current.taskAnchors = taskAnchors;
    current.openClarification = undefined;
    current.rollingSummary = renderRollingSummary({
      stableState: current.stableState,
      taskAnchors,
      lastResolvedQuestion: current.lastResolvedQuestion,
    });
    current.updatedAt = Date.now();
    store[params.sessionId] = current;
    await saveConversationContextStore(store, params.dataDir);
    return;
  }

  current.updatedAt = Date.now();
  store[params.sessionId] = current;
  await saveConversationContextStore(store, params.dataDir);
}

export async function resolveConversationContext(params: {
  question: string;
  sessionId?: string;
  dataDir?: string;
  allowRewrite?: boolean;
}): Promise<ResolvedConversationContext | null> {
  if (!params.sessionId) {
    return null;
  }
  const transcript = await loadDocAssistantTranscript(params.sessionId, params.dataDir);
  const stored =
    (await getStoredConversationContext(params.sessionId, params.dataDir)) ??
    deriveConversationContextFromTranscript({
      sessionId: params.sessionId,
      transcript,
      question: params.question,
    });
  if (!stored && transcript.length === 0) {
    return null;
  }

  const currentState = buildQuestionState(params.question);
  const compressed = compressConversationContext({
    transcript,
    question: params.question,
    currentState,
    stored: stored ?? undefined,
  });

  let effectiveQuestion = params.question;
  let effectiveState = currentState;
  let followUpSource: Extract<DocFollowUpSource, "conversation_rewrite"> | undefined;
  let blockedReason: string | undefined;
  let usedStableState = compressed.trace.usedStableState;

  if (params.allowRewrite !== false && stored) {
    const rewrite = buildConversationRewrite({
      question: params.question,
      currentState,
      stored,
    });
    usedStableState = usedStableState || rewrite.usedStableState;
    blockedReason = rewrite.blockedReason;
    if (rewrite.rewrittenQuestion && rewrite.rewrittenState) {
      effectiveQuestion = rewrite.rewrittenQuestion;
      effectiveState = rewrite.rewrittenState;
      followUpSource = "conversation_rewrite";
      blockedReason = undefined;
    }
  }

  return {
    effectiveQuestion,
    effectiveState,
    followUpSource,
    continuedFromRunId: followUpSource ? stored?.lastResolvedRunId : undefined,
    promptContext: compressed.promptContext,
    traceContext: {
      source: followUpSource
        ? "conversation_rewrite"
        : blockedReason
          ? "blocked"
          : "conversation_context",
      compressionTier: compressed.trace.compressionTier,
      selectedTurnCount: compressed.trace.selectedTurnCount,
      summaryUsed: compressed.trace.summaryUsed,
      promptChars: compressed.trace.promptChars,
      usedStableState,
      blockedReason,
    },
  };
}

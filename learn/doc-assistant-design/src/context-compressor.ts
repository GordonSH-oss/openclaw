import type {
  ConversationCompressionTier,
  ConversationPromptContext,
  ConversationPromptTurn,
} from "./protocol/index.js";
import { summarizeAnchorFocus } from "./question-anchors.js";
import { buildQuestionState, type QuestionState } from "./question-state.js";
import { normalizeSearchText } from "./search-text.js";
import type { LearningTranscriptMessage } from "./transcript-store.js";

export const CONVERSATION_TRANSCRIPT_SCAN_LIMIT = 24;
export const CONVERSATION_WORKING_MAX_MESSAGES = 6;
export const CONVERSATION_WORKING_MAX_CHARS = 1_200;
export const CONVERSATION_PROMPT_MAX_CHARS = 900;
export const CONVERSATION_SUMMARY_MAX_CHARS = 480;
export const CONVERSATION_SUMMARY_MAX_LINES = 6;

export type StoredConversationSummaryLike = {
  lastResolvedQuestion?: string;
  rollingSummary?: string;
  stableState?: {
    product?: QuestionState["product"];
    platform?: QuestionState["platform"];
    apiLayer?: QuestionState["apiLayer"];
    channelKind?: QuestionState["channelKind"];
    referent?: string;
  };
  taskAnchors?: {
    focus: string[];
    verbs: string[];
    constraints: string[];
    apiSymbols: string[];
  };
  openClarification?: {
    kind?: string;
    pendingQuestion?: string;
  };
};

type TranscriptTurnPair = {
  messages: ConversationPromptTurn[];
  score: number;
  order: number;
};

export type CompressedConversationContext = {
  promptContext?: ConversationPromptContext;
  trace: {
    compressionTier: ConversationCompressionTier;
    selectedTurnCount: number;
    summaryUsed: boolean;
    promptChars: number;
    usedStableState: boolean;
  };
};

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

function clipText(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  if (maxChars <= 1) {
    return "…";
  }
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}

function renderPromptChars(params: {
  summary?: string;
  recentTurns: ConversationPromptTurn[];
}): number {
  const summaryLines = params.summary ? [`Summary: ${params.summary}`] : [];
  const turnLines = params.recentTurns.map(
    (turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`,
  );
  return [...summaryLines, ...turnLines].join("\n").length;
}

function transcriptToTurns(
  transcript: LearningTranscriptMessage[],
  currentQuestion: string,
): ConversationPromptTurn[] {
  const filtered = transcript
    .filter(
      (
        message,
      ): message is LearningTranscriptMessage & {
        role: "user" | "assistant";
      } => message.role === "user" || message.role === "assistant",
    )
    .map((message) => ({
      role: message.role,
      content: extractTranscriptText(message.content),
    }))
    .filter((message) => message.content.length > 0);
  const last = filtered.at(-1);
  if (
    last?.role === "user" &&
    normalizeSearchText(last.content) === normalizeSearchText(currentQuestion)
  ) {
    filtered.pop();
  }
  return filtered.slice(-CONVERSATION_TRANSCRIPT_SCAN_LIMIT);
}

function groupTurnPairs(turns: ConversationPromptTurn[]): TranscriptTurnPair[] {
  const pairs: TranscriptTurnPair[] = [];
  let pending: ConversationPromptTurn[] = [];
  let order = 0;

  for (const turn of turns) {
    if (turn.role === "user") {
      if (pending.length > 0) {
        pairs.push({ messages: pending, score: 0, order: order++ });
      }
      pending = [turn];
      continue;
    }
    if (pending.length === 0) {
      pending = [turn];
      continue;
    }
    pending.push(turn);
  }

  if (pending.length > 0) {
    pairs.push({ messages: pending, score: 0, order });
  }

  return pairs;
}

function collectStateTerms(state: QuestionState): Set<string> {
  return new Set(
    dedupe([
      state.product ?? "",
      state.platform ?? "",
      state.apiLayer ?? "",
      state.channelKind ?? "",
      state.referent ?? "",
      state.heuristicHints?.action ?? "",
      state.heuristicHints?.object ?? "",
      ...summarizeAnchorFocus(state.anchors),
      ...state.anchors.verbPhrases,
      ...state.anchors.constraints,
      ...state.anchors.apiSymbols,
    ]).map((value) => normalizeSearchText(value)),
  );
}

function collectStoredTerms(store?: StoredConversationSummaryLike): Set<string> {
  if (!store) {
    return new Set();
  }
  return new Set(
    dedupe([
      store.stableState?.product ?? "",
      store.stableState?.platform ?? "",
      store.stableState?.apiLayer ?? "",
      store.stableState?.channelKind ?? "",
      store.stableState?.referent ?? "",
      ...(store.taskAnchors?.focus ?? []),
      ...(store.taskAnchors?.verbs ?? []),
      ...(store.taskAnchors?.constraints ?? []),
      ...(store.taskAnchors?.apiSymbols ?? []),
    ]).map((value) => normalizeSearchText(value)),
  );
}

function scorePair(params: {
  pair: TranscriptTurnPair;
  currentState: QuestionState;
  stored?: StoredConversationSummaryLike;
}): number {
  const pairText = params.pair.messages.map((message) => message.content).join("\n");
  const pairState = buildQuestionState(pairText);
  const currentTerms = collectStateTerms(params.currentState);
  const storedTerms = collectStoredTerms(params.stored);
  const pairTerms = collectStateTerms(pairState);

  let score = 0;
  if (params.currentState.platform && pairState.platform === params.currentState.platform) {
    score += 5;
  }
  if (params.currentState.product && pairState.product === params.currentState.product) {
    score += 5;
  }
  if (params.currentState.apiLayer && pairState.apiLayer === params.currentState.apiLayer) {
    score += 4;
  }
  if (
    params.currentState.channelKind &&
    pairState.channelKind === params.currentState.channelKind
  ) {
    score += 4;
  }
  if (
    params.stored?.stableState?.platform &&
    pairState.platform === params.stored.stableState.platform
  ) {
    score += 3;
  }
  if (
    params.stored?.stableState?.product &&
    pairState.product === params.stored.stableState.product
  ) {
    score += 3;
  }

  const overlap = Array.from(pairTerms).filter(
    (term) => currentTerms.has(term) || storedTerms.has(term),
  ).length;
  score += overlap * 3;

  if (
    params.stored?.lastResolvedQuestion &&
    normalizeSearchText(pairText).includes(normalizeSearchText(params.stored.lastResolvedQuestion))
  ) {
    score += 4;
  }
  if (
    params.stored?.openClarification?.pendingQuestion &&
    normalizeSearchText(pairText).includes(
      normalizeSearchText(params.stored.openClarification.pendingQuestion),
    )
  ) {
    score += 4;
  }

  const recentRelevantTerms = pairTerms.size > 0 ? params.pair.order / 100 : 0;
  score += recentRelevantTerms;
  return score;
}

function clipTurns(
  turns: ConversationPromptTurn[],
  maxCharsPerTurn: number,
): ConversationPromptTurn[] {
  return turns.map((turn) => ({
    role: turn.role,
    content: clipText(turn.content, maxCharsPerTurn),
  }));
}

function clipSummary(summary?: string): string | undefined {
  if (!summary) {
    return undefined;
  }
  const lines = summary
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, CONVERSATION_SUMMARY_MAX_LINES);
  if (lines.length === 0) {
    return undefined;
  }
  return clipText(lines.join("\n"), CONVERSATION_SUMMARY_MAX_CHARS);
}

function buildPromptContext(params: {
  tier: ConversationCompressionTier;
  summary?: string;
  recentTurns: ConversationPromptTurn[];
}): ConversationPromptContext | undefined {
  const summary = clipSummary(params.summary);
  const recentTurns = clipTurns(params.recentTurns, 180);
  const promptChars = renderPromptChars({ summary, recentTurns });
  if (!summary && recentTurns.length === 0) {
    return undefined;
  }
  return {
    summary,
    recentTurns,
    compressionTier: params.tier,
    promptChars,
    selectedTurnCount: recentTurns.length,
    summaryUsed: Boolean(summary),
  };
}

export function compressConversationContext(params: {
  transcript: LearningTranscriptMessage[];
  question: string;
  currentState: QuestionState;
  stored?: StoredConversationSummaryLike;
}): CompressedConversationContext {
  const turns = transcriptToTurns(params.transcript, params.question);
  const pairs = groupTurnPairs(turns).map((pair) => ({
    ...pair,
    score: scorePair({
      pair,
      currentState: params.currentState,
      stored: params.stored,
    }),
  }));

  const rankedPairs = pairs.toSorted(
    (left, right) => right.score - left.score || right.order - left.order,
  );
  const relevantPairs = rankedPairs.filter((pair) => pair.score > 0);
  const selectedPairs = (relevantPairs.length > 0 ? relevantPairs : rankedPairs.slice(0, 1))
    .slice(0, Math.min(3, pairs.length))
    .toSorted((left, right) => left.order - right.order);
  const selectedTurns = selectedPairs
    .flatMap((pair) => pair.messages)
    .slice(-CONVERSATION_WORKING_MAX_MESSAGES);
  const selectedChars = selectedTurns
    .map((turn) => turn.content.length)
    .reduce((total, value) => total + value, 0);
  const baseSummary = clipSummary(params.stored?.rollingSummary);
  const usedStableState = Boolean(
    params.stored?.stableState?.platform ||
    params.stored?.stableState?.product ||
    params.stored?.stableState?.apiLayer ||
    params.stored?.stableState?.channelKind ||
    params.stored?.taskAnchors?.focus.length ||
    params.stored?.openClarification?.pendingQuestion,
  );

  let tier: ConversationCompressionTier = "none";
  let promptContext = buildPromptContext({
    tier,
    recentTurns: selectedTurns,
  });

  const needsTrim = turns.length !== selectedTurns.length;
  const needsSummary =
    selectedChars > CONVERSATION_WORKING_MAX_CHARS ||
    (promptContext?.promptChars ?? 0) > CONVERSATION_PROMPT_MAX_CHARS;
  if (needsTrim && !needsSummary) {
    tier = "trim_irrelevant";
    promptContext = buildPromptContext({
      tier,
      recentTurns: selectedTurns,
    });
  }

  if (needsSummary) {
    const newestPairTurns = selectedPairs.at(-1)?.messages ?? selectedTurns.slice(-2);
    tier = "summary_plus_recent";
    promptContext = buildPromptContext({
      tier,
      summary: baseSummary,
      recentTurns: newestPairTurns,
    });
  }

  const shouldUseSummaryOnly =
    (promptContext?.promptChars ?? 0) > CONVERSATION_PROMPT_MAX_CHARS ||
    (turns.length >= CONVERSATION_TRANSCRIPT_SCAN_LIMIT && Boolean(baseSummary));
  if (shouldUseSummaryOnly) {
    const latestUserTurn =
      selectedTurns.toReversed().find((turn) => turn.role === "user") ?? selectedTurns.at(-1);
    tier = "summary_only";
    promptContext = buildPromptContext({
      tier,
      summary: baseSummary,
      recentTurns: latestUserTurn ? [latestUserTurn] : [],
    });
  }

  if ((promptContext?.promptChars ?? 0) > CONVERSATION_PROMPT_MAX_CHARS && promptContext) {
    const availableSummaryChars = Math.max(
      0,
      CONVERSATION_PROMPT_MAX_CHARS -
        renderPromptChars({ summary: undefined, recentTurns: promptContext.recentTurns }) -
        10,
    );
    promptContext = {
      ...promptContext,
      summary: promptContext.summary
        ? clipText(promptContext.summary, availableSummaryChars)
        : undefined,
      promptChars: renderPromptChars({
        summary: promptContext.summary
          ? clipText(promptContext.summary, availableSummaryChars)
          : undefined,
        recentTurns: promptContext.recentTurns.map((turn) => ({
          ...turn,
          content: clipText(turn.content, 120),
        })),
      }),
      recentTurns: promptContext.recentTurns.map((turn) => ({
        ...turn,
        content: clipText(turn.content, 120),
      })),
    };
  }

  return {
    promptContext,
    trace: {
      compressionTier: promptContext?.compressionTier ?? tier,
      selectedTurnCount: promptContext?.selectedTurnCount ?? 0,
      summaryUsed: promptContext?.summaryUsed ?? false,
      promptChars: promptContext?.promptChars ?? 0,
      usedStableState,
    },
  };
}

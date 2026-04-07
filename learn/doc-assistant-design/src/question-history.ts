import path from "node:path";
import { appendJsonlAtomic, readJsonlSafe } from "./persistence.js";
import type {
  DocAnswerDebugAnswers,
  DocAnswerSurface,
  DocQuestionAnswerOutcome,
  DocQuestionHistoryEntry,
  DocQuestionHistoryTaskFrame,
  DocsHistoryListParams,
  DocsTerminalResult,
} from "./protocol/index.js";
import { resolveDocAssistantDataDir } from "./user-store.js";

function getQuestionHistoryPath(dataDir?: string): string {
  return path.join(resolveDocAssistantDataDir(dataDir), "question-history.jsonl");
}

function toAnswerPreview(answer: string, maxLength = 220): string {
  const lines = answer
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const previewLines: string[] = [];
  let usedLength = 0;

  for (const line of lines) {
    const separatorLength = previewLines.length > 0 ? 1 : 0;
    const remaining = maxLength - usedLength - separatorLength;
    if (remaining <= 0) {
      break;
    }
    if (line.length <= remaining) {
      previewLines.push(line);
      usedLength += separatorLength + line.length;
      continue;
    }
    const clipped = remaining > 1 ? `${line.slice(0, remaining - 1)}…` : "…";
    previewLines.push(clipped);
    usedLength += separatorLength + clipped.length;
    break;
  }

  return previewLines.join("\n");
}

function isAllowedTaskFrameValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function sanitizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  return normalized.length > 0 ? normalized : undefined;
}

function isAllowedDebugAnswerValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

export function sanitizeHistoryDebugAnswers(value: unknown): DocAnswerDebugAnswers | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const normalized: Partial<DocAnswerDebugAnswers> = {};
  if (
    isAllowedDebugAnswerValue(raw.finalAnswerSource, [
      "provider",
      "grounded_fallback",
      "grounded_bypass",
      "learning",
      "learning_fallback",
    ])
  ) {
    normalized.finalAnswerSource = raw.finalAnswerSource;
  }
  if (typeof raw.groundedAnswer === "string" && raw.groundedAnswer.length > 0) {
    normalized.groundedAnswer = raw.groundedAnswer;
  }
  if (typeof raw.providerAnswer === "string" && raw.providerAnswer.length > 0) {
    normalized.providerAnswer = raw.providerAnswer;
  }
  if (typeof raw.providerError === "string" && raw.providerError.length > 0) {
    normalized.providerError = raw.providerError;
  }
  if (isAllowedDebugAnswerValue(raw.providerKind, ["openai_compatible", "learning"])) {
    normalized.providerKind = raw.providerKind;
  }
  return normalized.finalAnswerSource ? (normalized as DocAnswerDebugAnswers) : undefined;
}

export function sanitizeHistoryTaskFrame(value: unknown): DocQuestionHistoryTaskFrame | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const normalized: DocQuestionHistoryTaskFrame = {};
  if (isAllowedTaskFrameValue(raw.intent, ["concept", "procedural", "mixed"])) {
    normalized.intent = raw.intent;
  }
  if (isAllowedTaskFrameValue(raw.product, ["chat", "call", "server"])) {
    normalized.product = raw.product;
  }
  if (isAllowedTaskFrameValue(raw.platform, ["android", "ios", "web", "flutter"])) {
    normalized.platform = raw.platform;
  }
  if (isAllowedTaskFrameValue(raw.apiLayer, ["client", "server"])) {
    normalized.apiLayer = raw.apiLayer;
  }
  if (isAllowedTaskFrameValue(raw.channelKind, ["direct", "group", "community", "open"])) {
    normalized.channelKind = raw.channelKind;
  }
  const focus = sanitizeStringArray((raw.anchors as Record<string, unknown> | undefined)?.focus);
  const constraints = sanitizeStringArray(
    (raw.anchors as Record<string, unknown> | undefined)?.constraints,
  );
  const apiSymbols = sanitizeStringArray(
    (raw.anchors as Record<string, unknown> | undefined)?.apiSymbols,
  );
  if (focus || constraints || apiSymbols) {
    normalized.anchors = {
      focus: focus ?? [],
      constraints: constraints ?? [],
      apiSymbols: apiSymbols ?? [],
    };
  }
  const matched = sanitizeStringArray(
    (raw.coverage as Record<string, unknown> | undefined)?.matched,
  );
  const missing = sanitizeStringArray(
    (raw.coverage as Record<string, unknown> | undefined)?.missing,
  );
  if (matched || missing) {
    normalized.coverage = {
      matched: matched ?? [],
      missing: missing ?? [],
    };
  }
  if (
    isAllowedTaskFrameValue(raw.responseMode, [
      "definition",
      "procedure",
      "mixed",
      "clarification",
      "insufficient",
    ])
  ) {
    normalized.responseMode = raw.responseMode;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function summarizeQuestionOutcome(terminal: DocsTerminalResult): {
  answered: boolean;
  answerOutcome: DocQuestionAnswerOutcome;
} {
  if (terminal.status === "cancelled") {
    return { answered: false, answerOutcome: "cancelled" };
  }
  if (terminal.status === "error") {
    return { answered: false, answerOutcome: "error" };
  }
  if (
    terminal.summary === "platform clarification required" ||
    terminal.summary === "channel clarification required" ||
    terminal.summary === "api layer clarification required" ||
    terminal.summary === "product clarification required" ||
    terminal.summary === "task clarification required"
  ) {
    return { answered: false, answerOutcome: "clarification_required" };
  }
  if (terminal.summary === "guided greeting") {
    return { answered: true, answerOutcome: "guided_greeting" };
  }
  if (terminal.answerSource === "memory_standard") {
    return { answered: true, answerOutcome: "memory_standard" };
  }
  if (terminal.answerSource === "memory_draft") {
    return { answered: true, answerOutcome: "memory_draft" };
  }
  if (terminal.answerSurface?.trust === "non_authoritative") {
    return { answered: false, answerOutcome: "non_authoritative" };
  }
  if (terminal.summary === "no relevant documentation found") {
    return { answered: false, answerOutcome: "no_relevant_docs" };
  }
  if (terminal.summary === "insufficient documentation evidence") {
    return { answered: false, answerOutcome: "no_relevant_docs" };
  }
  return { answered: true, answerOutcome: "answered" };
}

export async function appendQuestionHistoryEntry(params: {
  dataDir?: string;
  entry: Omit<DocQuestionHistoryEntry, "answered" | "answerOutcome" | "answerPreview"> & {
    answer: string;
    answerSurface?: DocAnswerSurface;
    taskFrame?: DocQuestionHistoryTaskFrame;
    debugAnswers?: DocAnswerDebugAnswers;
  };
}): Promise<DocQuestionHistoryEntry> {
  const summary = summarizeQuestionOutcome({
    runId: params.entry.runId,
    status: params.entry.terminalStatus,
    mode: params.entry.mode,
    answer: params.entry.answer,
    summary: params.entry.summary,
    citations: [],
    selectedProvider: params.entry.selectedProvider,
    selectedModel: params.entry.selectedModel,
    answerSource: params.entry.answerSource,
    answerSurface: params.entry.answerSurface,
    memoryEntryId: params.entry.memoryEntryId,
    reviewStatus: params.entry.reviewStatus,
    followUpSource: params.entry.followUpSource,
    continuedFromRunId: params.entry.continuedFromRunId,
    rewrittenQuestion: params.entry.rewrittenQuestion,
  });
  const normalized: DocQuestionHistoryEntry = {
    runId: params.entry.runId,
    userId: params.entry.userId,
    sessionKey: params.entry.sessionKey,
    displayLabel: params.entry.displayLabel,
    question: params.entry.question,
    mode: params.entry.mode,
    askedAt: params.entry.askedAt,
    completedAt: params.entry.completedAt,
    terminalStatus: params.entry.terminalStatus,
    answered: summary.answered,
    answerOutcome: summary.answerOutcome,
    summary: params.entry.summary,
    citationCount: params.entry.citationCount,
    selectedProvider: params.entry.selectedProvider,
    selectedModel: params.entry.selectedModel,
    answerPreview: toAnswerPreview(params.entry.answer),
    answerSource: params.entry.answerSource,
    reviewStatus: params.entry.reviewStatus,
    memoryEntryId: params.entry.memoryEntryId,
    followUpSource: params.entry.followUpSource,
    continuedFromRunId: params.entry.continuedFromRunId,
    rewrittenQuestion: params.entry.rewrittenQuestion,
    taskFrame: sanitizeHistoryTaskFrame(params.entry.taskFrame),
    debugAnswers: sanitizeHistoryDebugAnswers(params.entry.debugAnswers),
  };

  const historyPath = getQuestionHistoryPath(params.dataDir);
  await appendJsonlAtomic(historyPath, normalized);
  return normalized;
}

export async function loadQuestionHistory(
  params?: DocsHistoryListParams & {
    dataDir?: string;
  },
): Promise<DocQuestionHistoryEntry[]> {
  const entries = (
    await readJsonlSafe<DocQuestionHistoryEntry>(getQuestionHistoryPath(params?.dataDir))
  )
    .toReversed()
    .filter((entry) => (params?.userId ? entry.userId === params.userId : true))
    .filter((entry) =>
      params?.answered === undefined ? true : entry.answered === params.answered,
    );

  return entries.slice(0, params?.limit ?? 100);
}

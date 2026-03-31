import fs from "node:fs/promises";
import path from "node:path";
import type {
  DocQuestionAnswerOutcome,
  DocQuestionHistoryEntry,
  DocsHistoryListParams,
  DocsTerminalResult,
} from "./protocol/index.js";
import { resolveDocAssistantDataDir } from "./user-store.js";

function getQuestionHistoryPath(dataDir?: string): string {
  return path.join(resolveDocAssistantDataDir(dataDir), "question-history.jsonl");
}

function toAnswerPreview(answer: string, maxLength = 220): string {
  const compact = answer.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 1)}…`;
}

export function summarizeQuestionOutcome(
  terminal: DocsTerminalResult,
): { answered: boolean; answerOutcome: DocQuestionAnswerOutcome } {
  if (terminal.status === "cancelled") {
    return { answered: false, answerOutcome: "cancelled" };
  }
  if (terminal.status === "error") {
    return { answered: false, answerOutcome: "error" };
  }
  if (
    terminal.summary === "platform clarification required" ||
    terminal.summary === "channel clarification required"
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
  if (terminal.summary === "no relevant documentation found") {
    return { answered: false, answerOutcome: "no_relevant_docs" };
  }
  return { answered: true, answerOutcome: "answered" };
}

export async function appendQuestionHistoryEntry(params: {
  dataDir?: string;
  entry: Omit<DocQuestionHistoryEntry, "answered" | "answerOutcome" | "answerPreview"> & {
    answer: string;
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
  };

  const historyPath = getQuestionHistoryPath(params.dataDir);
  await fs.mkdir(path.dirname(historyPath), { recursive: true });
  await fs.appendFile(historyPath, `${JSON.stringify(normalized)}\n`, "utf-8");
  return normalized;
}

export async function loadQuestionHistory(
  params?: DocsHistoryListParams & {
    dataDir?: string;
  },
): Promise<DocQuestionHistoryEntry[]> {
  let raw = "";
  try {
    raw = await fs.readFile(getQuestionHistoryPath(params?.dataDir), "utf-8");
  } catch {
    return [];
  }

  const entries = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as DocQuestionHistoryEntry)
    .reverse()
    .filter((entry) => (params?.userId ? entry.userId === params.userId : true))
    .filter((entry) => (params?.answered === undefined ? true : entry.answered === params.answered));

  return entries.slice(0, params?.limit ?? 100);
}

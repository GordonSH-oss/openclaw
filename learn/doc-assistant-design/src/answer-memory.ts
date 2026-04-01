import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  isMemoryEntryEligibleForLookup,
  isTerminalResultCacheable,
} from "./answer-cache-policy.js";
import { tokenize } from "./doc-index.js";
import type {
  AnswerMemoryEntry,
  AnswerMemoryMatch,
  DocAnswerReviewStatus,
  DocAnswerSource,
  DocMemoryEntryStatus,
  DocsAdminMemoryApproveParams,
  DocsAdminMemoryListParams,
  DocsAdminMemoryRejectParams,
  DocsAdminMemoryUpdateParams,
  DocsTerminalResult,
} from "./protocol/index.js";
import { resolveDocAssistantDataDir } from "./user-store.js";

type AnswerMemoryIndexItem = {
  entryId: string;
  reviewStatus: DocMemoryEntryStatus;
  normalizedQuestions: string[];
  tokens: string[];
  strongTokens: string[];
  updatedAt: number;
};

type ReviewQueueEvent = {
  id: string;
  entryId: string;
  action: "enqueued" | "approve" | "reject" | "update" | "memory_hit";
  at: number;
  detail?: string;
};

function getAnswerMemoryPath(dataDir?: string): string {
  return path.join(resolveDocAssistantDataDir(dataDir), "answer-memory.jsonl");
}

function getAnswerMemoryIndexPath(dataDir?: string): string {
  return path.join(resolveDocAssistantDataDir(dataDir), "answer-memory-index.json");
}

function getReviewQueuePath(dataDir?: string): string {
  return path.join(resolveDocAssistantDataDir(dataDir), "review-queue.jsonl");
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function normalizeMemoryQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/\bjavascript\b/g, "web")
    .replace(/\bjs\b/g, "web")
    .replace(/\bdms?\b/g, "direct channel")
    .replace(/\bdirect messages?\b/g, "direct channel")
    .replace(/\bprivate messages?\b/g, "direct channel")
    .replace(/\bdirect chats?\b/g, "direct channel")
    .replace(/\bprivate chats?\b/g, "direct channel")
    .replace(/\bsingle chats?\b/g, "direct channel")
    .replace(/\b1[\s\-_/]*to[\s\-_/]*1\b/g, "one to one")
    .replace(/\b1[\s\-_/]*on[\s\-_/]*1\b/g, "one to one")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getNormalizedVariants(
  question: string,
  questionVariants?: string[],
): {
  questions: string[];
  normalizedQuestions: string[];
} {
  const questions = uniqueStrings([question, ...(questionVariants ?? [])]);
  const normalizedQuestions = uniqueStrings(
    questions.map((value) => normalizeMemoryQuestion(value)),
  );
  return { questions, normalizedQuestions };
}

function getStrongTokens(tokens: string[]): string[] {
  return tokens.filter((token) => token.length >= 4 || /[\u4e00-\u9fff]{2,}/.test(token));
}

function toIndexItem(entry: AnswerMemoryEntry): AnswerMemoryIndexItem {
  const tokens = uniqueStrings(
    entry.normalizedQuestionVariants.flatMap((value) => tokenize(value)),
  );
  return {
    entryId: entry.entryId,
    reviewStatus: entry.reviewStatus,
    normalizedQuestions: entry.normalizedQuestionVariants,
    tokens,
    strongTokens: getStrongTokens(tokens),
    updatedAt: entry.updatedAt,
  };
}

async function persistAnswerMemory(entries: AnswerMemoryEntry[], dataDir?: string): Promise<void> {
  const root = resolveDocAssistantDataDir(dataDir);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(
    getAnswerMemoryPath(dataDir),
    entries.map((entry) => JSON.stringify(entry)).join("\n") + (entries.length ? "\n" : ""),
    "utf-8",
  );
  const index = entries.map((entry) => toIndexItem(entry));
  await fs.writeFile(getAnswerMemoryIndexPath(dataDir), JSON.stringify(index, null, 2), "utf-8");
}

export async function replaceAnswerMemoryEntries(
  entries: AnswerMemoryEntry[],
  dataDir?: string,
): Promise<void> {
  await persistAnswerMemory(sortEntries(entries), dataDir);
}

async function appendReviewQueueEvent(
  dataDir: string | undefined,
  event: ReviewQueueEvent,
): Promise<void> {
  const queuePath = getReviewQueuePath(dataDir);
  await fs.mkdir(path.dirname(queuePath), { recursive: true });
  await fs.appendFile(queuePath, `${JSON.stringify(event)}\n`, "utf-8");
}

function sortEntries(entries: AnswerMemoryEntry[]): AnswerMemoryEntry[] {
  return entries.toSorted((left, right) => right.updatedAt - left.updatedAt);
}

export async function loadAnswerMemoryEntries(dataDir?: string): Promise<AnswerMemoryEntry[]> {
  let raw = "";
  try {
    raw = await fs.readFile(getAnswerMemoryPath(dataDir), "utf-8");
  } catch {
    return [];
  }
  return sortEntries(
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AnswerMemoryEntry),
  );
}

function countOverlap(left: string[], right: string[]): number {
  const rightSet = new Set(right);
  return left.reduce((total, token) => total + (rightSet.has(token) ? 1 : 0), 0);
}

function scoreNormalizedQuestion(query: string, candidate: string): number {
  if (!query || !candidate) {
    return 0;
  }
  if (query === candidate) {
    return 1000;
  }
  let score = 0;
  if (candidate.includes(query) || query.includes(candidate)) {
    score += 220;
  }
  const queryTokens = tokenize(query);
  const candidateTokens = tokenize(candidate);
  const overlap = countOverlap(queryTokens, candidateTokens);
  const strongOverlap = countOverlap(
    getStrongTokens(queryTokens),
    getStrongTokens(candidateTokens),
  );
  const union = new Set([...queryTokens, ...candidateTokens]).size || 1;
  const coverage = overlap / union;
  score += overlap * 28;
  score += strongOverlap * 40;
  score += Math.round(coverage * 220);
  if (query.startsWith(candidate) || candidate.startsWith(query)) {
    score += 80;
  }
  return score;
}

function getThresholdForStatus(status: DocMemoryEntryStatus): number {
  return status === "approved_standard" ? 180 : 240;
}

function getReviewStatusForAnswerSource(source: DocAnswerSource): DocAnswerReviewStatus {
  if (source === "memory_standard") {
    return "approved_standard";
  }
  if (source === "memory_draft") {
    return "pending_review";
  }
  if (source === "greeting") {
    return "not_applicable";
  }
  return "pending_review";
}

export async function findAnswerMemoryMatch(params: {
  question: string;
  dataDir?: string;
}): Promise<AnswerMemoryMatch | null> {
  const entries = await loadAnswerMemoryEntries(params.dataDir);
  const normalizedQuestion = normalizeMemoryQuestion(params.question);
  let bestApproved: AnswerMemoryMatch | null = null;

  for (const entry of entries) {
    if (entry.reviewStatus === "rejected" || !isMemoryEntryEligibleForLookup(entry)) {
      continue;
    }
    const scoredVariants = entry.normalizedQuestionVariants.map((candidate, index) => ({
      score: scoreNormalizedQuestion(normalizedQuestion, candidate),
      matchedQuestion: entry.questionVariants[index] ?? entry.question,
    }));
    const topVariant = scoredVariants.toSorted((left, right) => right.score - left.score)[0];
    if (!topVariant) {
      continue;
    }
    if (entry.reviewStatus === "approved_standard") {
      if (
        topVariant.score >= getThresholdForStatus(entry.reviewStatus) &&
        (!bestApproved || topVariant.score > bestApproved.score)
      ) {
        bestApproved = {
          entry,
          score: topVariant.score,
          answerSource: "memory_standard",
          reviewStatus: "approved_standard",
          matchedQuestion: topVariant.matchedQuestion,
        };
      }
    }
  }

  return bestApproved;
}

function findExistingEntryForEnqueue(
  question: string,
  entries: AnswerMemoryEntry[],
): { entry: AnswerMemoryEntry; score: number } | null {
  const normalizedQuestion = normalizeMemoryQuestion(question);
  let best: { entry: AnswerMemoryEntry; score: number } | null = null;

  for (const entry of entries) {
    if (entry.reviewStatus === "rejected") {
      continue;
    }
    const score = entry.normalizedQuestionVariants
      .map((candidate) => scoreNormalizedQuestion(normalizedQuestion, candidate))
      .toSorted((left, right) => right - left)[0];
    if (!score) {
      continue;
    }
    if (!best || score > best.score) {
      best = { entry, score };
    }
  }

  return best;
}

export function toMemoryTerminalResult(params: {
  runId: string;
  mode: "extractive" | "agent";
  match: AnswerMemoryMatch;
}): DocsTerminalResult {
  return {
    runId: params.runId,
    status: "ok",
    mode: params.mode,
    answer: params.match.entry.answer,
    summary: params.match.entry.summary,
    citations: params.match.entry.citations,
    selectedProvider: params.match.entry.selectedProvider,
    selectedModel: params.match.entry.selectedModel,
    answerSource: params.match.answerSource,
    memoryEntryId: params.match.entry.entryId,
    reviewStatus: params.match.reviewStatus,
  };
}

export async function noteAnswerMemoryHit(params: {
  dataDir?: string;
  match: AnswerMemoryMatch;
}): Promise<void> {
  const entries = await loadAnswerMemoryEntries(params.dataDir);
  const now = Date.now();
  const updated = entries.map((entry) =>
    entry.entryId === params.match.entry.entryId
      ? {
          ...entry,
          hitCount: entry.hitCount + 1,
          lastSeenAt: now,
          updatedAt: now,
        }
      : entry,
  );
  await persistAnswerMemory(updated, params.dataDir);
  await appendReviewQueueEvent(params.dataDir, {
    id: randomUUID(),
    entryId: params.match.entry.entryId,
    action: "memory_hit",
    at: now,
    detail: `${params.match.answerSource}:${params.match.matchedQuestion}`,
  });
}

export async function enqueueGeneratedAnswerMemory(params: {
  dataDir?: string;
  question: string;
  terminal: DocsTerminalResult;
  mode: "extractive" | "agent";
}): Promise<AnswerMemoryEntry> {
  if (!isTerminalResultCacheable(params.terminal)) {
    throw new Error(`Terminal result is not cacheable: ${params.terminal.summary}`);
  }
  const entries = await loadAnswerMemoryEntries(params.dataDir);
  const now = Date.now();
  const existing = findExistingEntryForEnqueue(params.question, entries);

  if (existing && existing.score >= 300) {
    const updatedEntries = entries.map((entry) => {
      if (entry.entryId !== existing.entry.entryId) {
        return entry;
      }
      if (entry.reviewStatus === "pending_review") {
        const variants = getNormalizedVariants(params.question, [
          ...entry.questionVariants,
          params.question,
        ]);
        return {
          ...entry,
          questionVariants: variants.questions,
          normalizedQuestionVariants: variants.normalizedQuestions,
          answer: params.terminal.answer,
          summary: params.terminal.summary,
          citations: params.terminal.citations,
          mode: params.mode,
          selectedProvider: params.terminal.selectedProvider,
          selectedModel: params.terminal.selectedModel,
          sourceRunId: params.terminal.runId,
          lastSeenAt: now,
          updatedAt: now,
          hitCount: entry.hitCount + 1,
        };
      }
      return {
        ...entry,
        lastSeenAt: now,
        updatedAt: now,
        hitCount: entry.hitCount + 1,
      };
    });
    await persistAnswerMemory(updatedEntries, params.dataDir);
    const refreshed =
      updatedEntries.find((entry) => entry.entryId === existing.entry.entryId) ?? existing.entry;
    await appendReviewQueueEvent(params.dataDir, {
      id: randomUUID(),
      entryId: refreshed.entryId,
      action: "update",
      at: now,
      detail: "deduped generated answer",
    });
    return refreshed;
  }

  const variants = getNormalizedVariants(params.question);
  const entry: AnswerMemoryEntry = {
    entryId: randomUUID(),
    question: params.question,
    normalizedQuestion: normalizeMemoryQuestion(params.question),
    questionVariants: variants.questions,
    normalizedQuestionVariants: variants.normalizedQuestions,
    answer: params.terminal.answer,
    summary: params.terminal.summary,
    citations: params.terminal.citations,
    mode: params.mode,
    reviewStatus: "pending_review",
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    hitCount: 1,
    provenance: "generated_from_docs",
    selectedProvider: params.terminal.selectedProvider,
    selectedModel: params.terminal.selectedModel,
    sourceRunId: params.terminal.runId,
  };
  await persistAnswerMemory([entry, ...entries], params.dataDir);
  await appendReviewQueueEvent(params.dataDir, {
    id: randomUUID(),
    entryId: entry.entryId,
    action: "enqueued",
    at: now,
    detail: params.question,
  });
  return entry;
}

export async function listAnswerMemory(
  params?: DocsAdminMemoryListParams & {
    dataDir?: string;
  },
): Promise<AnswerMemoryEntry[]> {
  const entries = await loadAnswerMemoryEntries(params?.dataDir);
  const normalizedQuery = params?.query ? normalizeMemoryQuestion(params.query) : "";
  const filtered = entries
    .filter((entry) => (params?.status ? entry.reviewStatus === params.status : true))
    .filter((entry) => {
      if (!normalizedQuery) {
        return true;
      }
      return (
        entry.normalizedQuestionVariants.some((question) => question.includes(normalizedQuery)) ||
        normalizeMemoryQuestion(entry.answer).includes(normalizedQuery)
      );
    });
  return filtered.slice(0, params?.limit ?? 100);
}

export async function getAnswerMemoryEntry(
  entryId: string,
  dataDir?: string,
): Promise<AnswerMemoryEntry | null> {
  const entries = await loadAnswerMemoryEntries(dataDir);
  return entries.find((entry) => entry.entryId === entryId) ?? null;
}

async function mutateAnswerMemoryEntry(params: {
  dataDir?: string;
  entryId: string;
  mutate: (entry: AnswerMemoryEntry) => AnswerMemoryEntry;
  queueAction: ReviewQueueEvent["action"];
  detail?: string;
}): Promise<AnswerMemoryEntry | null> {
  const entries = await loadAnswerMemoryEntries(params.dataDir);
  let updatedEntry: AnswerMemoryEntry | null = null;
  const updatedEntries = entries.map((entry) => {
    if (entry.entryId !== params.entryId) {
      return entry;
    }
    updatedEntry = params.mutate(entry);
    return updatedEntry;
  });
  if (!updatedEntry) {
    return null;
  }
  await persistAnswerMemory(updatedEntries, params.dataDir);
  await appendReviewQueueEvent(params.dataDir, {
    id: randomUUID(),
    entryId: params.entryId,
    action: params.queueAction,
    at: Date.now(),
    detail: params.detail,
  });
  return updatedEntry;
}

export async function approveAnswerMemoryEntry(
  params: DocsAdminMemoryApproveParams & {
    dataDir?: string;
  },
): Promise<AnswerMemoryEntry | null> {
  return await mutateAnswerMemoryEntry({
    dataDir: params.dataDir,
    entryId: params.entryId,
    queueAction: "approve",
    detail: "approved standard answer",
    mutate: (entry) => {
      const variants = getNormalizedVariants(entry.question, [
        ...entry.questionVariants,
        ...(params.questionVariants ?? []),
      ]);
      return {
        ...entry,
        answer: params.editedAnswer?.trim() || entry.answer,
        summary: params.summary?.trim() || entry.summary,
        citations: params.citations ?? entry.citations,
        questionVariants: variants.questions,
        normalizedQuestionVariants: variants.normalizedQuestions,
        reviewStatus: "approved_standard",
        provenance: params.editedAnswer ? "admin_edited" : "admin_approved",
        updatedAt: Date.now(),
      };
    },
  });
}

export async function rejectAnswerMemoryEntry(
  params: DocsAdminMemoryRejectParams & {
    dataDir?: string;
  },
): Promise<AnswerMemoryEntry | null> {
  return await mutateAnswerMemoryEntry({
    dataDir: params.dataDir,
    entryId: params.entryId,
    queueAction: "reject",
    detail: params.reason,
    mutate: (entry) => ({
      ...entry,
      reviewStatus: "rejected",
      reviewNote: params.reason?.trim() || entry.reviewNote,
      updatedAt: Date.now(),
    }),
  });
}

export async function updateAnswerMemoryEntry(
  params: DocsAdminMemoryUpdateParams & {
    dataDir?: string;
  },
): Promise<AnswerMemoryEntry | null> {
  return await mutateAnswerMemoryEntry({
    dataDir: params.dataDir,
    entryId: params.entryId,
    queueAction: "update",
    detail: "updated pending answer",
    mutate: (entry) => {
      const variants = getNormalizedVariants(entry.question, [
        ...entry.questionVariants,
        ...(params.questionVariants ?? []),
      ]);
      return {
        ...entry,
        answer: params.editedAnswer.trim(),
        summary: params.summary?.trim() || entry.summary,
        citations: params.citations ?? entry.citations,
        questionVariants: variants.questions,
        normalizedQuestionVariants: variants.normalizedQuestions,
        provenance: "admin_edited",
        updatedAt: Date.now(),
      };
    },
  });
}

export async function getAnswerMemoryCounts(dataDir?: string): Promise<{
  memoryEntries: number;
  pendingReviewEntries: number;
  approvedStandardEntries: number;
}> {
  const entries = await loadAnswerMemoryEntries(dataDir);
  return {
    memoryEntries: entries.length,
    pendingReviewEntries: entries.filter((entry) => entry.reviewStatus === "pending_review").length,
    approvedStandardEntries: entries.filter((entry) => entry.reviewStatus === "approved_standard")
      .length,
  };
}

export function toTerminalMemoryMetadata(params: {
  entry: AnswerMemoryEntry;
  answerSource: DocAnswerSource;
}): {
  answerSource: DocAnswerSource;
  reviewStatus: DocAnswerReviewStatus;
  memoryEntryId: string;
} {
  return {
    answerSource: params.answerSource,
    reviewStatus: getReviewStatusForAnswerSource(params.answerSource),
    memoryEntryId: params.entry.entryId,
  };
}

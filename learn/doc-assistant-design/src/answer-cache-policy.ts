import type { AnswerMemoryEntry, DocsTerminalResult } from "./protocol/index.js";

const NON_CACHEABLE_SUMMARIES = new Set([
  "platform clarification required",
  "channel clarification required",
  "api layer clarification required",
  "product clarification required",
  "task clarification required",
  "no relevant documentation found",
  "insufficient documentation evidence",
  "guided greeting",
]);

export function isNonCacheableSummary(summary: string | undefined): boolean {
  return NON_CACHEABLE_SUMMARIES.has((summary ?? "").trim());
}

export function isTerminalResultCacheable(terminal: DocsTerminalResult): boolean {
  if (terminal.status !== "ok") {
    return false;
  }
  if (terminal.answerSource && terminal.answerSource !== "generated") {
    return false;
  }
  if (terminal.answerSurface?.trust === "non_authoritative") {
    return false;
  }
  return !isNonCacheableSummary(terminal.summary);
}

export function isMemoryEntryEligibleForLookup(entry: AnswerMemoryEntry): boolean {
  if (entry.reviewStatus !== "approved_standard") {
    return false;
  }
  return !isNonCacheableSummary(entry.summary);
}

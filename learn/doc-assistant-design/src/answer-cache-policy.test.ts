import assert from "node:assert/strict";
import test from "node:test";
import { isTerminalResultCacheable } from "./answer-cache-policy.js";
import type { DocsTerminalResult } from "./protocol/index.js";

function makeTerminal(overrides: Partial<DocsTerminalResult> = {}): DocsTerminalResult {
  return {
    runId: "cacheable-1",
    status: "ok",
    mode: "agent",
    answer: "Answer",
    summary: "answered with mock/learning-primary",
    citations: [],
    answerSource: "generated",
    ...overrides,
  };
}

void test("isTerminalResultCacheable rejects non-authoritative answer surfaces", () => {
  const terminal = makeTerminal({
    answerSurface: {
      kind: "learning_mock",
      trust: "non_authoritative",
      outputContract: "sentinel_prompt",
    },
  });

  assert.equal(isTerminalResultCacheable(terminal), false);
});

void test("isTerminalResultCacheable keeps authoritative extractive answers cacheable", () => {
  const terminal = makeTerminal({
    mode: "extractive",
    summary: "guided answer from 1 documentation chunks",
    answerSurface: {
      kind: "extractive",
      trust: "not_applicable",
      outputContract: "grounded_extractive",
    },
  });

  assert.equal(isTerminalResultCacheable(terminal), true);
});

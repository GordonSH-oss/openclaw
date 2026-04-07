import assert from "node:assert/strict";
import test from "node:test";
import type { DocsTerminalResult } from "./protocol/index.js";
import { sanitizeHistoryTaskFrame, summarizeQuestionOutcome } from "./question-history.js";

function makeTerminal(overrides: Partial<DocsTerminalResult> = {}): DocsTerminalResult {
  return {
    runId: "history-run-1",
    status: "ok",
    mode: "agent",
    answer: "Answer",
    summary: "answered with mock/learning-primary",
    citations: [],
    answerSource: "generated",
    ...overrides,
  };
}

void test("summarizeQuestionOutcome marks non-authoritative answer surfaces as not answered", () => {
  const outcome = summarizeQuestionOutcome(
    makeTerminal({
      selectedProvider: "mock",
      selectedModel: "learning-primary",
      answerSurface: {
        kind: "learning_mock",
        trust: "non_authoritative",
        outputContract: "sentinel_prompt",
      },
    }),
  );

  assert.deepEqual(outcome, {
    answered: false,
    answerOutcome: "non_authoritative",
  });
});

void test("summarizeQuestionOutcome keeps authoritative generated answers as answered", () => {
  const outcome = summarizeQuestionOutcome(
    makeTerminal({
      mode: "extractive",
      summary: "guided answer from 1 documentation chunks",
      answerSurface: {
        kind: "extractive",
        trust: "not_applicable",
        outputContract: "grounded_extractive",
      },
    }),
  );

  assert.deepEqual(outcome, {
    answered: true,
    answerOutcome: "answered",
  });
});

void test("sanitizeHistoryTaskFrame keeps only string task-frame fields", () => {
  const frame = sanitizeHistoryTaskFrame({
    responseMode: "procedure",
    platform: "web",
    anchors: {
      focus: ["message", "webhook signature"],
      constraints: ["permission"],
      apiSymbols: ["MessageHandler"],
    },
    coverage: {
      matched: ["message"],
      missing: ["permission"],
    },
    ignored: 123,
  });

  assert.deepEqual(frame, {
    responseMode: "procedure",
    platform: "web",
    anchors: {
      focus: ["message", "webhook signature"],
      constraints: ["permission"],
      apiSymbols: ["MessageHandler"],
    },
    coverage: {
      matched: ["message"],
      missing: ["permission"],
    },
  });
});
